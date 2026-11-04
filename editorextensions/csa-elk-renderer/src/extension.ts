import { BlockProxy, DocumentProxy, EditorClient, PageProxy } from 'lucid-extension-sdk';
import ELK from 'elkjs/lib/elk.bundled.js';

const client = new EditorClient();
const elk = new ELK();

const SCHEMA_VERSION = 2;
const FALLBACK_CLASS = 'ProcessBlock';
const CANVAS_MARGIN = 100;

interface GraphNode {
  id: string;
  label: string;
  kind: string;
  isContainer: boolean;
  parentId: string | null;
  technology: string | null;
  category: string;
  deltaFlag: string;
  isSoR: boolean;
}

interface GraphEdge {
  id: string;
  sourceId: string;
  targetId: string;
  label: string;
  bidirectional: boolean;
}

interface Diagram {
  key: string;
  pageTitle: string;
  archetype: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

interface BootstrapPayload {
  schemaVersion: number;
  title: string;
  diagrams: Diagram[];
}

function describeError(err: unknown): string {
  try {
    if (err instanceof Error) return err.name + ': ' + err.message + (err.stack ? '\n' + err.stack : '');
    if (typeof err === 'string') return err;
    return JSON.stringify(err, Object.getOwnPropertyNames(Object(err)));
  } catch {
    return String(err);
  }
}

async function stage<T>(tag: string, name: string, fn: () => T | Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw new Error(tag + ' stage=' + name + ': ' + describeError(err));
  }
}

// Drops/repairs bad nodes and edges so one malformed record cannot abort the whole slide.
function sanitizeDiagram(diagram: Diagram): Diagram {
  const tag = '[' + diagram.pageTitle + ']';
  const seen = new Set<string>();
  const nodes: GraphNode[] = [];
  for (const raw of diagram.nodes || []) {
    if (!raw || raw.id === undefined || raw.id === null || raw.id === '') {
      console.warn(tag + ' dropping node with missing id:', JSON.stringify(raw));
      continue;
    }
    const id = String(raw.id);
    if (id === 'root' || seen.has(id)) {
      console.warn(tag + ' dropping node with duplicate/reserved id: ' + id);
      continue;
    }
    seen.add(id);
    nodes.push({
      ...raw,
      id,
      label: String(raw.label === undefined || raw.label === null ? '' : raw.label),
      kind: String(raw.kind || ''),
      deltaFlag: String(raw.deltaFlag || ''),
      category: String(raw.category || ''),
      parentId: raw.parentId === undefined || raw.parentId === null ? null : String(raw.parentId)
    });
  }

  const byId = new Map(nodes.map(n => [n.id, n] as [string, GraphNode]));
  for (const n of nodes) {
    if (n.parentId !== null && (n.parentId === n.id || !byId.has(n.parentId))) {
      console.warn(tag + ' node ' + n.id + ' has missing/self parent "' + n.parentId + '"; moving to top level.');
      n.parentId = null;
    }
  }
  for (const n of nodes) {
    const chain = new Set<string>([n.id]);
    let cur = n.parentId;
    while (cur !== null) {
      if (chain.has(cur)) {
        console.warn(tag + ' parent cycle at node ' + n.id + '; moving to top level.');
        n.parentId = null;
        break;
      }
      chain.add(cur);
      cur = byId.get(cur)?.parentId ?? null;
    }
  }

  const edgeIds = new Set<string>();
  const edges: GraphEdge[] = [];
  (diagram.edges || []).forEach((raw, i) => {
    const sourceId = String(raw?.sourceId);
    const targetId = String(raw?.targetId);
    if (!byId.has(sourceId) || !byId.has(targetId)) {
      console.warn(tag + ' dropping edge ' + raw?.id + ' with unknown endpoint(s): ' + sourceId + ' -> ' + targetId);
      return;
    }
    let id = raw.id === undefined || raw.id === null || raw.id === '' ? 'edge_' + i : String(raw.id);
    if (edgeIds.has(id) || byId.has(id) || id === 'root') {
      id = id + '__' + i;
    }
    edgeIds.add(id);
    edges.push({ ...raw, id, sourceId, targetId, label: String(raw.label || ''), bidirectional: !!raw.bidirectional });
  });

  return { ...diagram, nodes, edges };
}

// Class names from https://developer.lucid.co/docs/gcp-2021-library, keyed by normalizeTool().
// To support a new tool, add its normalized name here (see the "missing from GCP_CLASS_MAP" log).
const GCP_CLASS_MAP: { [tool: string]: string } = {
  cloudrun: 'GCP2021CloudRunIcon',
  kubernetesengine: 'GCP2021GoogleKubernetesEngineIcon',
  gke: 'GCP2021GoogleKubernetesEngineIcon',
  cloudspanner: 'GCP2021CloudSpannerIcon',
  spanner: 'GCP2021CloudSpannerIcon',
  pubsub: 'GCP2021PubsubIcon',
  cloudpubsub: 'GCP2021PubsubIcon',
  cloudsql: 'GCP2021CloudSQLIcon',
  cloudstorage: 'GCP2021CloudStorageIcon',
  computeengine: 'GCP2021ComputeEngineIcon',
  cloudarmor: 'GCP2021CloudArmorIcon',
  cloudfunctions: 'GCP2021CloudFunctionsIcon',
  clouddns: 'GCP2021CloudDNSIcon',
  cloudnat: 'GCP2021CloudNATIcon',
  cloudloadbalancer: 'GCP2021CloudLoadBalancingIcon',
  cloudloadbalancing: 'GCP2021CloudLoadBalancingIcon',
  appengine: 'GCP2021AppEngineIcon',
  bigquery: 'GCP2021BigqueryIcon',
  dataflow: 'GCP2021DataflowIcon',
  dataproc: 'GCP2021DataprocIcon'
};

// "GCP Kubernetes Engine (Standard)" and "Google Kubernetes Engine" both become "kubernetesengine".
function normalizeTool(name: string): string {
  return name
    .toLowerCase()
    .replace(/\(.*?\)/g, '')
    .replace(/^(gcp|google)\s+/, '')
    .replace(/[^a-z0-9]/g, '');
}

function toolName(node: GraphNode): string {
  return node.technology || node.label;
}

function resolveGcpClass(node: GraphNode): string | null {
  return GCP_CLASS_MAP[normalizeTool(toolName(node))] || null;
}

function looksLikeGcp(node: GraphNode): boolean {
  return /^(gcp|google)\b/i.test(toolName(node).trim());
}

const C = {
  user: 'GCP2021ContainerUser1',
  system: 'GCP2021ContainerSystem1',
  capability: 'GCP2021ContainerLogicalGroupingOfServicesInstances',
  cloudProvider: 'GCP2021ContainerProjectZoneCloudServiceProvider',
  onPrem: 'GCP2021ContainerColoDCOnPremises',
  infrastructure: 'GCP2021ContainerInfrastructureSystem2',
  region: 'GCP2021ContainerRegion',
  zone: 'GCP2021ContainerZone',
  subnet: 'GCP2021ContainerSubNetwork',
  saas: 'GCP2021ContainerExternalSaaSProviders',
  dataSource: 'GCP2021ContainerExternalDataSources'
};

// Group shapes for containers, chosen by the container's kind (from the payload "type") and label.
function containerClassFor(node: GraphNode): string {
  const label = node.label.toLowerCase();
  switch (node.kind) {
    case 'enterprise_system':
    case 'system':
      return C.system;
    case 'business_capability':
    case 'capability':
      return C.capability;
    case 'macro_environment':
      if (/on-?prem|colo|data\s*cent|\bdc\b/.test(label)) return C.onPrem;
      if (/gcp|google|cloud|aws|azure/.test(label)) return C.cloudProvider;
      return C.infrastructure;
    case 'location':
      if (/on-?prem|colo|data\s*cent|\bdc\b/.test(label)) return C.onPrem;
      if (/sub-?net/.test(label)) return C.subnet;
      if (/zone/.test(label)) return C.zone;
      return C.region;
    case 'perimeter':
      return C.saas;
    default:
      return C.capability;
  }
}

// Shape for a tool with no GCP icon, so it still reads as the right kind of element.
function inferToolClass(node: GraphNode): string {
  const label = toolName(node).toLowerCase();
  if (node.isSoR || /database|\bdb\b|datastore|data\s*store|warehouse|data\s*lake/.test(label)) return C.dataSource;
  if (node.category === 'external' || /saas|third.?party|vendor/.test(label)) return C.saas;
  if (/\b(user|client|mobile|member|customer|browser|associate)s?\b/.test(label)) return C.user;
  return C.system;
}

function nodeSize(node: GraphNode): { w: number; h: number } {
  const lines = String(node.label || '').split('\n');
  const longest = Math.max(0, ...lines.map(l => l.length));
  return {
    w: Math.min(260, Math.max(140, longest * 7 + 40)),
    h: Math.max(100, lines.length * 18 + 70)
  };
}

function rootLayoutOptions(diagram: Diagram): { [key: string]: string } {
  const hasContainers = diagram.nodes.some(n => n.isContainer);
  const options: { [key: string]: string } = {
    'elk.algorithm': 'layered',
    'elk.direction': 'RIGHT',
    'elk.edgeRouting': 'ORTHOGONAL',
    'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
    'elk.spacing.nodeNode': '50',
    'elk.layered.spacing.nodeNodeBetweenLayers': '100'
  };

  if (diagram.archetype === 'CONTEXT' && !hasContainers) {
    return { 'elk.algorithm': 'radial', 'elk.spacing.nodeNode': '80' };
  }
  if (diagram.archetype === 'DEPLOYMENT') {
    options['elk.direction'] = 'DOWN';
  }
  return options;
}

function buildElkGraph(diagram: Diagram): any {
  const childrenByParent = new Map<string | null, GraphNode[]>();
  for (const node of diagram.nodes) {
    const list = childrenByParent.get(node.parentId) || [];
    list.push(node);
    childrenByParent.set(node.parentId, list);
  }

  const toElk = (node: GraphNode): any => {
    const kids = childrenByParent.get(node.id) || [];
    const elkNode: any = { id: node.id, labels: [{ text: node.label }] };

    if (kids.length > 0) {
      elkNode.layoutOptions = { 'elk.padding': '[top=56,left=32,bottom=32,right=32]' };
      elkNode.children = kids.map(toElk);
    } else if (node.isContainer) {
      elkNode.width = 260;
      elkNode.height = 140;
    } else {
      const size = nodeSize(node);
      elkNode.width = size.w;
      elkNode.height = size.h;
    }
    return elkNode;
  };

  return {
    id: 'root',
    layoutOptions: rootLayoutOptions(diagram),
    children: (childrenByParent.get(null) || []).map(toElk),
    edges: diagram.edges.map(e => ({ id: e.id, sources: [e.sourceId], targets: [e.targetId] }))
  };
}

interface Placed {
  node: GraphNode;
  x: number;
  y: number;
  w: number;
  h: number;
}

// ELK child coordinates are relative to their parent; parents are emitted before children
// so containers sit underneath the blocks they hold.
function flattenLayout(elkNode: any, offsetX: number, offsetY: number, nodeById: Map<string, GraphNode>, out: Placed[]): void {
  for (const child of elkNode.children || []) {
    const x = offsetX + (child.x || 0);
    const y = offsetY + (child.y || 0);
    const node = nodeById.get(child.id);
    if (node) {
      out.push({ node, x, y, w: child.width || 140, h: child.height || 100 });
    }
    flattenLayout(child, x, y, nodeById, out);
  }
}

async function loadClasses(classNames: string[]): Promise<Set<string>> {
  const available = new Set<string>();
  for (const className of classNames) {
    try {
      await client.loadBlockClasses([className]);
      available.add(className);
    } catch (err) {
      console.warn('Block class unavailable, using fallback: ' + className + ' -> ' + describeError(err));
    }
  }
  return available;
}

function trySet(label: string, fn: () => void): void {
  try {
    fn();
  } catch (err) {
    console.warn('Could not set ' + label + ': ' + describeError(err));
  }
}

function createBlock(page: PageProxy, placed: Placed, className: string): BlockProxy {
  const isContainer = placed.node.isContainer;
  const block = page.addBlock({
    className,
    boundingBox: { x: placed.x + CANVAS_MARGIN, y: placed.y + CANVAS_MARGIN, w: placed.w, h: placed.h },
    ...(isContainer && className === FALLBACK_CLASS ? { fillStyle: '#f3f4f6' } : {})
  });

  trySet('text', () => block.textAreas.set('Text', placed.node.label));

  if (/add|chang|red/i.test(placed.node.deltaFlag)) {
    trySet('delta border', () => {
      block.properties.set('LineColor', '#D0021B');
      block.properties.set('LineWidth', 3);
    });
  }
  return block;
}

function createLine(page: PageProxy, source: BlockProxy, target: BlockProxy, edge: GraphEdge): boolean {
  const endpoint = (block: BlockProxy, style?: string) => ({
    connection: block,
    linkX: 0.5,
    linkY: 0.5,
    autoLink: true,
    ...(style ? { style } : {})
  });

  const attempts: Array<[string, () => any]> = [
    ['styled', () => page.addLine({
      endpoint1: endpoint(source, edge.bidirectional ? 'Arrow' : undefined),
      endpoint2: endpoint(target, 'Arrow')
    })],
    ['unstyled', () => page.addLine({ endpoint1: endpoint(source), endpoint2: endpoint(target) })],
    ['bare', () => page.addLine({ endpoint1: { connection: source }, endpoint2: { connection: target } } as any)]
  ];

  let line: any;
  for (const [name, attempt] of attempts) {
    try {
      line = attempt();
      break;
    } catch (err) {
      console.warn('Line ' + edge.id + ' (' + edge.sourceId + ' -> ' + edge.targetId + ') ' + name + ' attempt failed: ' + describeError(err));
    }
  }
  if (!line) return false;

  if (edge.label) {
    trySet('line label', () => line.textAreas.set('Text', edge.label));
  }
  return true;
}

function gridLayout(diagram: Diagram): any {
  const cols = Math.max(1, Math.ceil(Math.sqrt(diagram.nodes.length)));
  return {
    children: diagram.nodes.map((n, i) => {
      const size = n.isContainer ? { w: 260, h: 140 } : nodeSize(n);
      return { id: n.id, x: (i % cols) * 320, y: Math.floor(i / cols) * 200, width: size.w, height: size.h };
    })
  };
}

async function computeLayout(diagram: Diagram, tag: string): Promise<any> {
  const opts = rootLayoutOptions(diagram);
  try {
    return await elk.layout(buildElkGraph(diagram));
  } catch (err) {
    console.error(
      tag + ' ELK layout failed (algorithm=' + opts['elk.algorithm'] + ', nodes=' + diagram.nodes.length +
      ', edges=' + diagram.edges.length + '): ' + describeError(err)
    );
  }
  try {
    const graph = buildElkGraph(diagram);
    graph.layoutOptions = { 'elk.algorithm': 'layered', 'elk.direction': 'RIGHT' };
    return await elk.layout(graph);
  } catch (err) {
    console.error(tag + ' ELK simple retry failed; using grid layout: ' + describeError(err));
  }
  return gridLayout(diagram);
}

async function renderDiagram(page: PageProxy, rawDiagram: Diagram): Promise<void> {
  const tag = '[' + rawDiagram.pageTitle + ']';
  const diagram = await stage(tag, 'validate', () => sanitizeDiagram(rawDiagram));
  const nodeById = new Map(diagram.nodes.map(n => [n.id, n] as [string, GraphNode]));

  const layout = await stage(tag, 'elk-layout', () => computeLayout(diagram, tag));
  const placed: Placed[] = [];
  flattenLayout(layout, 0, 0, nodeById, placed);

  const classFor = new Map<string, string>();
  const wanted = new Set<string>([FALLBACK_CLASS]);
  const unmappedGcp = new Set<string>();
  const inferred: string[] = [];
  for (const p of placed) {
    let className: string;
    if (p.node.isContainer) {
      className = containerClassFor(p.node);
    } else {
      const mapped = resolveGcpClass(p.node);
      if (mapped) {
        className = mapped;
      } else {
        className = inferToolClass(p.node);
        inferred.push(toolName(p.node) + ' -> ' + className);
        if (looksLikeGcp(p.node)) unmappedGcp.add(toolName(p.node));
      }
    }
    classFor.set(p.node.id, className);
    wanted.add(className);
  }

  const available = await stage(tag, 'load-classes', () => loadClasses(Array.from(wanted)));
  const failedClasses = Array.from(wanted).filter(c => !available.has(c));

  const blocks = new Map<string, BlockProxy>();
  let blocksSkipped = 0;
  await stage(tag, 'create-blocks', () => {
    for (const p of placed) {
      const preferred = classFor.get(p.node.id) || FALLBACK_CLASS;
      const className = available.has(preferred) ? preferred : FALLBACK_CLASS;
      try {
        blocks.set(p.node.id, createBlock(page, p, className));
      } catch (err) {
        console.warn(tag + ' block ' + p.node.id + ' ("' + p.node.label + '") failed with class ' + className + ': ' + describeError(err));
        try {
          blocks.set(p.node.id, createBlock(page, p, FALLBACK_CLASS));
        } catch (err2) {
          blocksSkipped++;
          console.error(tag + ' block ' + p.node.id + ' skipped, fallback also failed: ' + describeError(err2));
        }
      }
    }
  });

  if (unmappedGcp.size > 0) {
    console.warn(tag + ' GCP tools missing from GCP_CLASS_MAP (drawn with an inferred shape):', Array.from(unmappedGcp));
  }
  if (failedClasses.length > 0) {
    console.warn(tag + ' classes failed to load (check the class names):', failedClasses);
  }
  if (inferred.length > 0) {
    console.info(tag + ' tools without a GCP icon, drawn with an inferred shape:', inferred);
  }

  let linesCreated = 0;
  let linesSkipped = 0;
  await stage(tag, 'create-lines', () => {
    for (const edge of diagram.edges) {
      const source = blocks.get(edge.sourceId);
      const target = blocks.get(edge.targetId);
      if (source && target && createLine(page, source, target, edge)) {
        linesCreated++;
      } else {
        linesSkipped++;
      }
    }
  });

  console.info(
    tag + ' done: blocks ' + blocks.size + ' created/' + blocksSkipped + ' skipped, lines ' +
    linesCreated + ' created/' + linesSkipped + ' skipped'
  );
}

function parsePayload(data: unknown): BootstrapPayload | null {
  const raw = (data as any)?.csaPayload;
  if (!raw) return null;

  try {
    const payload: BootstrapPayload = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (payload.schemaVersion !== SCHEMA_VERSION || !Array.isArray(payload.diagrams)) {
      console.error('Unsupported CSA payload schema version:', payload.schemaVersion);
      return null;
    }
    return payload;
  } catch (err) {
    console.error('Failed to parse CSA payload:', err);
    return null;
  }
}

client.processAndClearBootstrapData(async data => {
  const payload = parsePayload(data);
  if (!payload) return;

  const document = new DocumentProxy(client);
  const pagesByTitle = new Map<string, PageProxy>();
  for (const page of document.pages.values()) {
    pagesByTitle.set(page.getTitle(), page);
  }

  console.info(
    'CSA payload: ' + payload.diagrams.length + ' diagram(s) [' + payload.diagrams.map(d => d.pageTitle).join(' | ') +
    ']; document pages [' + Array.from(pagesByTitle.keys()).join(' | ') + ']'
  );

  let rendered = 0;
  for (const diagram of payload.diagrams) {
    const page = pagesByTitle.get(diagram.pageTitle);
    if (!page) {
      console.warn('No page titled "' + diagram.pageTitle + '"; skipping diagram.');
      continue;
    }
    try {
      await renderDiagram(page, diagram);
      rendered++;
    } catch (err) {
      console.error('Failed to render "' + diagram.pageTitle + '": ' + describeError(err));
    }
  }
  console.info('Rendered ' + rendered + '/' + payload.diagrams.length + ' diagrams.');
}, true);
