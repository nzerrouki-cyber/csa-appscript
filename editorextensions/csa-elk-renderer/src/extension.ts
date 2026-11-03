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
  const lines = node.label.split('\n');
  const longest = Math.max(...lines.map(l => l.length));
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
      console.warn('Block class unavailable, using fallback:', className, err);
    }
  }
  return available;
}

function trySet(label: string, fn: () => void): void {
  try {
    fn();
  } catch (err) {
    console.warn('Could not set ' + label + ':', err);
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

function createLine(page: PageProxy, source: BlockProxy, target: BlockProxy, edge: GraphEdge): void {
  const endpoint = (block: BlockProxy, style?: string) => ({
    connection: block,
    linkX: 0.5,
    linkY: 0.5,
    autoLink: true,
    ...(style ? { style } : {})
  });

  let line;
  try {
    line = page.addLine({
      endpoint1: endpoint(source, edge.bidirectional ? 'Arrow' : undefined),
      endpoint2: endpoint(target, 'Arrow')
    });
  } catch (err) {
    console.warn('Styled line failed, retrying without arrow styles:', err);
    line = page.addLine({ endpoint1: endpoint(source), endpoint2: endpoint(target) });
  }

  if (edge.label) {
    trySet('line label', () => line.textAreas.set('Text', edge.label));
  }
}

async function renderDiagram(page: PageProxy, diagram: Diagram): Promise<void> {
  const nodeById = new Map(diagram.nodes.map(n => [n.id, n] as [string, GraphNode]));

  const layout = await elk.layout(buildElkGraph(diagram));
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

  const available = await loadClasses(Array.from(wanted));
  const failedClasses = Array.from(wanted).filter(c => !available.has(c));

  const blocks = new Map<string, BlockProxy>();
  for (const p of placed) {
    const preferred = classFor.get(p.node.id) || FALLBACK_CLASS;
    const className = available.has(preferred) ? preferred : FALLBACK_CLASS;
    blocks.set(p.node.id, createBlock(page, p, className));
  }

  const tag = '[' + diagram.pageTitle + ']';
  if (unmappedGcp.size > 0) {
    console.warn(tag + ' GCP tools missing from GCP_CLASS_MAP (drawn with an inferred shape):', Array.from(unmappedGcp));
  }
  if (failedClasses.length > 0) {
    console.warn(tag + ' classes failed to load (check the class names):', failedClasses);
  }
  if (inferred.length > 0) {
    console.info(tag + ' tools without a GCP icon, drawn with an inferred shape:', inferred);
  }

  for (const edge of diagram.edges) {
    const source = blocks.get(edge.sourceId);
    const target = blocks.get(edge.targetId);
    if (source && target) {
      createLine(page, source, target, edge);
    }
  }
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

  for (const diagram of payload.diagrams) {
    const page = pagesByTitle.get(diagram.pageTitle);
    if (!page) {
      console.warn('No page titled "' + diagram.pageTitle + '"; skipping diagram.');
      continue;
    }
    try {
      await renderDiagram(page, diagram);
    } catch (err) {
      console.error('Failed to render "' + diagram.pageTitle + '":', err);
    }
  }
}, true);
