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
    
    // Feature 1: Append (SoR) to labels for authoritative stores dynamically
    let label = String(raw.label === undefined || raw.label === null ? '' : raw.label);
    if (raw.isSoR && !label.endsWith('(SoR)')) {
      label = label ? `${label}\n(SoR)` : '(SoR)';
    }

    nodes.push({
      ...raw,
      id,
      label,
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
  
  // Feature 2: Slide 10 (Deployment) Zero-Line Mandate
  if (diagram.archetype !== 'DEPLOYMENT') {
    (diagram.edges || []).forEach((raw, i) => {
      const sourceId = String(raw?.sourceId);
      const targetId = String(raw?.targetId);
      
      if (!byId.has(sourceId) || !byId.has(targetId)) {
        console.warn(tag + ' dropping edge ' + raw?.id + ' with unknown endpoint(s): ' + sourceId + ' -> ' + targetId);
        return;
      }

      // Feature 3: Capability Zero-Connector Zone Enforcement
      const sourceNode = byId.get(sourceId);
      const targetNode = byId.get(targetId);
      if (sourceNode?.kind === 'capability' || targetNode?.kind === 'capability') {
        console.warn(tag + ' dropping invalid capability edge (Zero-Connector Zone): ' + sourceId + ' -> ' + targetId);
        return;
      }

      let id = raw.id === undefined || raw.id === null || raw.id === '' ? 'edge_' + i : String(raw.id);
      if (edgeIds.has(id) || byId.has(id) || id === 'root') {
        id = id + '__' + i;
      }
      edgeIds.add(id);
      edges.push({ ...raw, id, sourceId, targetId, label: String(raw.label || ''), bidirectional: !!raw.bidirectional });
    });
  } else {
    if ((diagram.edges || []).length > 0) {
      console.warn(tag + ' DEPLOYMENT archetype detected; stripping all edges to enforce zero-line mandate.');
    }
  }

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
    case 'macro_env':
    case 'macro_environment':
      if (/on-?prem|colo|data\s*cent|\bdc\b/.test(label)) return C.onPrem;
      if (/gcp|google|cloud|aws|azure/.test(label)) return C.cloudProvider;
      return C.infrastructure;
    case 'location':
      if (/on-?prem|colo|data\s*cent|\bdc\b/.test(label)) return C.onPrem;
      if (/sub-?net/.test(label)) return C.subnet;
      if (/zone/.test(label)) return C.zone;
      return C.region;
    case 'host':
      return C.infrastructure;
    case 'perimeter':
      return C.saas;
    default:
      console.warn('Unknown container type "' + node.kind + '" for ' + node.id + '; drawn as a capability group.');
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

const LABEL_KEYS = ['Name', 'Title', 'Text', 'Service Name', 'Header'];

// set() on an unknown text area key does not throw, so each write is read back to confirm it took.
function setLabel(block: BlockProxy, label: string): boolean {
  let existing: string[] = [];
  try {
    existing = Array.from(block.textAreas.keys());
  } catch (err) {
    console.warn('Could not list text areas: ' + describeError(err));
  }

  const preferred = LABEL_KEYS.filter(k => existing.some(e => e.toLowerCase() === k.toLowerCase()))
    .map(k => existing.find(e => e.toLowerCase() === k.toLowerCase()) as string);
  const candidates = Array.from(new Set([...preferred, ...existing, ...LABEL_KEYS]));

  for (const key of candidates) {
    try {
      block.textAreas.set(key, label);
      if (String(block.textAreas.get(key) ?? '').replace(/\s+/g, '') === label.replace(/\s+/g, '')) return true;
    } catch {
      // try the next key
    }
  }
  return false;
}

function createBlock(page: PageProxy, placed: Placed, className: string, issues: string[]): BlockProxy {
  const isContainer = placed.node.isContainer;
  const block = page.addBlock({
    className,
    boundingBox: { x: placed.x + CANVAS_MARGIN, y: placed.y + CANVAS_MARGIN, w: placed.w, h: placed.h },
    ...(isContainer && className === FALLBACK_CLASS ? { fillStyle: '#f3f4f6' } : {})
  });

  if (!setLabel(block, placed.node.label)) {
    console.warn('[Renderer] Could not set text on shape ' + placed.node.id);
    issues.push('Label not written on "' + placed.node.label + '" (' + className + '); the shape shows its default text.');
  }

  // Handle Adding/Changing (Red Border)
  if (/add|chang|red/i.test(placed.node.deltaFlag)) {
    trySet('delta border', () => {
      block.properties.set('LineColor', '#D0021B');
      block.properties.set('LineWidth', 3);
    });
  } 
  // Handle Retiring (Dashed Gray Border)
  else if (/retir/i.test(placed.node.deltaFlag)) {
    trySet('retiring border', () => {
      block.properties.set('LineColor', '#9CA3AF'); // Gray-400
      block.properties.set('LineWidth', 2);
      block.properties.set('StrokeStyle', 'dashed');
    });
  }
  
  return block;
}

// Attach each end to the border facing the other shape instead of the centre, so lines leave
// and enter at box edges rather than being drawn through neighbouring shapes.
function facingLinks(a: Placed, b: Placed): { from: { x: number; y: number }; to: { x: number; y: number } } {
  const dx = b.x + b.w / 2 - (a.x + a.w / 2);
  const dy = b.y + b.h / 2 - (a.y + a.h / 2);
  if (Math.abs(dx) / (a.w + b.w) >= Math.abs(dy) / (a.h + b.h)) {
    return dx >= 0 ? { from: { x: 1, y: 0.5 }, to: { x: 0, y: 0.5 } } : { from: { x: 0, y: 0.5 }, to: { x: 1, y: 0.5 } };
  }
  return dy >= 0 ? { from: { x: 0.5, y: 1 }, to: { x: 0.5, y: 0 } } : { from: { x: 0.5, y: 0 }, to: { x: 0.5, y: 1 } };
}

function createLine(page: PageProxy, source: BlockProxy, target: BlockProxy, edge: GraphEdge, links: { from: { x: number; y: number }; to: { x: number; y: number } }): boolean {
  const endpoint = (block: BlockProxy, at: { x: number; y: number }, style?: string) => ({
    connection: block,
    linkX: at.x,
    linkY: at.y,
    autoLink: false,
    ...(style ? { style } : {})
  });

  const attempts: Array<[string, () => any]> = [
    ['styled', () => page.addLine({
      endpoint1: endpoint(source, links.from, edge.bidirectional ? 'Arrow' : undefined),
      endpoint2: endpoint(target, links.to, 'Arrow')
    })],
    ['unstyled', () => page.addLine({ endpoint1: endpoint(source, links.from), endpoint2: endpoint(target, links.to) })],
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

function shortError(err: unknown): string {
  const first = describeError(err).split('\n')[0];
  return first.length > 300 ? first.substring(0, 300) + '...' : first;
}

const KNOWN_CONTAINER_KINDS = ['system', 'enterprise_system', 'capability', 'business_capability', 'macro_env', 'macro_environment', 'location', 'host', 'perimeter'];

// Checks the normalized graph against the CSA Diagram Standards so structural mistakes are reported on the page.
function checkStandards(diagram: Diagram): string[] {
  const out: string[] = [];
  const byId = new Map(diagram.nodes.map(n => [n.id, n] as [string, GraphNode]));
  const kindOf = (id: string | null) => (id ? (byId.get(id)?.kind || '') : '');
  const childCount = new Map<string, number>();
  for (const n of diagram.nodes) {
    if (n.parentId) childCount.set(n.parentId, (childCount.get(n.parentId) || 0) + 1);
  }
  const isSystem = (k: string) => k === 'system' || k === 'enterprise_system';
  const isCapability = (k: string) => k === 'capability' || k === 'business_capability';
  const isMacro = (k: string) => k === 'macro_env' || k === 'macro_environment';

  for (const n of diagram.nodes) {
    if (n.isContainer && KNOWN_CONTAINER_KINDS.indexOf(n.kind) < 0) {
      out.push('Container "' + n.label + '" has unknown type "' + n.kind + '" (expected SYSTEM, CAPABILITY, MACRO_ENV, LOCATION, HOST or PERIMETER); drawn as a capability group.');
    }
  }

  for (const e of diagram.edges) {
    const s = byId.get(e.sourceId);
    const t = byId.get(e.targetId);
    if ((s && isCapability(s.kind)) || (t && isCapability(t.kind))) {
      out.push('Connector "' + (s ? s.label : e.sourceId) + '" -> "' + (t ? t.label : e.targetId) + '" touches a CAPABILITY container; capabilities must have no connectors.');
    }
  }

  const a = diagram.archetype;
  if (a === 'DECOMPOSITION') {
    for (const n of diagram.nodes) {
      if (n.isContainer) {
        if (isCapability(n.kind) && !isSystem(kindOf(n.parentId))) {
          out.push('Capability "' + n.label + '" must be nested inside a SYSTEM container.');
        }
        continue;
      }
      if (n.category === 'internal') {
        if (n.parentId !== null) out.push('Internal tool "' + n.label + '" must sit at the root canvas (parent_container null).');
        const hasInstance = diagram.edges.some(e => e.targetId === n.id && isSystem(kindOf(e.sourceId)));
        if (!hasInstance) out.push('Internal tool "' + n.label + '" has no Instance connector from an Enterprise System.');
      } else if (n.category === 'external') {
        if (kindOf(n.parentId) !== 'perimeter') out.push('External tool "' + n.label + '" must be inside the PERIMETER container (ext_perimeter).');
      } else {
        out.push('Tool "' + n.label + '" has no type of INTERNAL or EXTERNAL.');
      }
    }
  } else if (a === 'DEPLOYMENT') {
    if (diagram.edges.length > 0) out.push('System Deployment must have no connectors (found ' + diagram.edges.length + ').');
    for (const n of diagram.nodes) {
      if (n.isContainer) {
        if (n.kind === 'location' && !isMacro(kindOf(n.parentId))) out.push('Location "' + n.label + '" must be nested inside a MACRO_ENV container.');
        if (!childCount.get(n.id)) out.push('Container "' + n.label + '" is empty.');
      } else if (kindOf(n.parentId) !== 'location') {
        out.push('Tool "' + n.label + '" must be inside a LOCATION container.');
      }
    }
  } else if (a === 'INFO_FLOW') {
    for (const n of diagram.nodes) {
      if (n.isContainer && n.kind === 'host' && !childCount.get(n.id)) out.push('HOST container "' + n.label + '" holds no datastore.');
      if (!n.isContainer && n.isSoR && kindOf(n.parentId) !== 'host') out.push('System of Record "' + n.label + '" should be nested inside a HOST container.');
    }
  } else if (a === 'CONTEXT') {
    for (const n of diagram.nodes) {
      if (n.isContainer && !childCount.get(n.id)) out.push('Container "' + n.label + '" is empty.');
    }
  }
  return out;
}

// failure is set when ELK could not lay the diagram out as requested.
async function computeLayout(diagram: Diagram, tag: string): Promise<{ layout: any; failure: string | null }> {
  const opts = rootLayoutOptions(diagram);
  let firstError = '';
  try {
    return { layout: await elk.layout(buildElkGraph(diagram)), failure: null };
  } catch (err) {
    firstError = shortError(err);
    console.error(
      tag + ' ELK layout failed (algorithm=' + opts['elk.algorithm'] + ', nodes=' + diagram.nodes.length +
      ', edges=' + diagram.edges.length + '): ' + describeError(err)
    );
  }
  let retryError = '';
  try {
    const graph = buildElkGraph(diagram);
    graph.layoutOptions = { 'elk.algorithm': 'layered', 'elk.direction': 'RIGHT' };
    return { layout: await elk.layout(graph), failure: 'ELK full layout failed (' + firstError + '); a simplified layout was used instead.' };
  } catch (err) {
    retryError = shortError(err);
    console.error(tag + ' ELK simple retry failed; using grid layout: ' + describeError(err));
  }
  return {
    layout: gridLayout(diagram),
    failure: 'ELK failed, so a flat grid with no nesting was used. Full layout: ' + firstError + ' | Simple retry: ' + retryError
  };
}

function addIssuesNote(page: PageProxy, issues: string[]): void {
  const MAX = 14;
  const shown = issues.slice(0, MAX).map(i => '- ' + i);
  if (issues.length > MAX) shown.push('... and ' + (issues.length - MAX) + ' more (see the browser console).');
  const h = 60 + shown.length * 34;
  trySet('render issues note', () => {
    const note = page.addBlock({
      className: FALLBACK_CLASS,
      boundingBox: { x: CANVAS_MARGIN, y: 60 - h, w: 1100, h },
      fillStyle: '#fde8e8'
    });
    setLabel(note, 'RENDER ISSUES (' + issues.length + ')\n' + shown.join('\n'));
    note.properties.set('LineColor', '#D0021B');
    note.properties.set('LineWidth', 3);
  });
}

async function renderDiagram(page: PageProxy, rawDiagram: Diagram): Promise<string[]> {
  const tag = '[' + rawDiagram.pageTitle + ']';
  const issues: string[] = [];
  const diagram = await stage(tag, 'validate', () => sanitizeDiagram(rawDiagram));
  const nodeById = new Map(diagram.nodes.map(n => [n.id, n] as [string, GraphNode]));
  issues.push(...checkStandards(rawDiagram));

  const { layout, failure } = await stage(tag, 'elk-layout', () => computeLayout(diagram, tag));
  if (failure) issues.unshift(failure);
  const placed: Placed[] = [];
  flattenLayout(layout, 0, 0, nodeById, placed);
  if (placed.length < diagram.nodes.length) {
    issues.push('Layout positioned ' + placed.length + ' of ' + diagram.nodes.length + ' items.');
  }

  const classFor = new Map<string, string>();
  const wanted = new Set<string>([FALLBACK_CLASS]);
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
        if (looksLikeGcp(p.node)) {
          issues.push('GCP tool "' + p.node.label + '" (technology "' + toolName(p.node) + '") has no GCP 2021 icon mapping; drawn as a generic ' + className.replace('GCP2021Container', '') + ' shape.');
        }
      }
    }
    classFor.set(p.node.id, className);
    wanted.add(className);
  }

  const available = await stage(tag, 'load-classes', () => loadClasses(Array.from(wanted)));
  const failedClasses = Array.from(wanted).filter(c => !available.has(c));
  for (const cls of failedClasses) {
    const users = placed.filter(p => classFor.get(p.node.id) === cls).map(p => p.node.label);
    issues.push('Shape class "' + cls + '" failed to load, so ' + (users.length > 0 ? users.length + ' shape(s) (' + users.slice(0, 3).join(', ') + (users.length > 3 ? ', ...' : '') + ')' : 'its shapes') + ' use a plain box.');
  }

  const blocks = new Map<string, BlockProxy>();
  let blocksSkipped = 0;
  await stage(tag, 'create-blocks', () => {
    for (const p of placed) {
      const preferred = classFor.get(p.node.id) || FALLBACK_CLASS;
      const className = available.has(preferred) ? preferred : FALLBACK_CLASS;
      try {
        blocks.set(p.node.id, createBlock(page, p, className, issues));
      } catch (err) {
        console.warn(tag + ' block ' + p.node.id + ' ("' + p.node.label + '") failed with class ' + className + ': ' + describeError(err));
        issues.push('Shape "' + p.node.label + '" could not be created with class ' + className + ' (' + shortError(err) + '); retried as a plain box.');
        try {
          blocks.set(p.node.id, createBlock(page, p, FALLBACK_CLASS, issues));
        } catch (err2) {
          blocksSkipped++;
          console.error(tag + ' block ' + p.node.id + ' skipped, fallback also failed: ' + describeError(err2));
          issues.push('Shape "' + p.node.label + '" was skipped; the plain box also failed (' + shortError(err2) + ').');
        }
      }
    }
  });

  if (inferred.length > 0) {
    console.info(tag + ' tools without a GCP icon, drawn with an inferred shape:', inferred);
  }

  let linesCreated = 0;
  let linesSkipped = 0;
  await stage(tag, 'create-lines', () => {
    for (const edge of diagram.edges) {
      const source = blocks.get(edge.sourceId);
      const target = blocks.get(edge.targetId);
      const a = placed.find(p => p.node.id === edge.sourceId);
      const b = placed.find(p => p.node.id === edge.targetId);
      if (source && target && a && b && createLine(page, source, target, edge, facingLinks(a, b))) {
        linesCreated++;
      } else {
        linesSkipped++;
        issues.push('Connector "' + (nodeById.get(edge.sourceId)?.label || edge.sourceId) + '" -> "' + (nodeById.get(edge.targetId)?.label || edge.targetId) + '" was not drawn.');
      }
    }
  });

  if (issues.length > 0) addIssuesNote(page, issues);

  console.info(
    tag + ' done: blocks ' + blocks.size + ' created/' + blocksSkipped + ' skipped, lines ' +
    linesCreated + ' created/' + linesSkipped + ' skipped, issues ' + issues.length
  );
  return issues;
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
  const problems: string[] = [];
  for (const diagram of payload.diagrams) {
    const page = pagesByTitle.get(diagram.pageTitle);
    if (!page) {
      console.warn('No page titled "' + diagram.pageTitle + '"; skipping diagram.');
      problems.push(diagram.pageTitle + ': no matching page in the document; diagram skipped.');
      continue;
    }
    try {
      const issues = await renderDiagram(page, diagram);
      if (issues.length > 0) {
        problems.push(
          diagram.pageTitle + ' (' + issues.length + '):\n  - ' + issues.slice(0, 5).join('\n  - ') +
          (issues.length > 5 ? '\n  - ... ' + (issues.length - 5) + ' more, listed in the red note on the page' : '')
        );
      }
      rendered++;
    } catch (err) {
      console.error('Failed to render "' + diagram.pageTitle + '": ' + describeError(err));
      problems.push(diagram.pageTitle + ': render failed: ' + shortError(err));
    }
  }
  console.info('Rendered ' + rendered + '/' + payload.diagrams.length + ' diagrams.');

  if (problems.length > 0) {
    const alertFn = (client as any).alert;
    if (typeof alertFn === 'function') {
      try {
        await alertFn.call(client, 'CSA renderer found problems on ' + problems.length + ' slide(s):\n\n' + problems.join('\n\n'));
      } catch (err) {
        console.warn('Could not show alert: ' + describeError(err));
      }
    } else {
      console.warn('client.alert is unavailable; problems were only written to the page notes and console.');
    }
  }
}, true);
