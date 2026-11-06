import { BlockProxy, DocumentProxy, EditorClient, PageProxy } from 'lucid-extension-sdk';
import ELK from 'elkjs/lib/elk.bundled.js';

const client = new EditorClient();

// The Lucid extension sandbox has no timers, but ELK's in-process worker and its GWT runtime call
// setTimeout/clearTimeout. Delays are only used to defer work, so a microtask queue is enough.
(function installTimerShim() {
  const g: any = globalThis as any;
  if (typeof g.setTimeout === 'function') return;
  let nextId = 1;
  const cancelled = new Set<number>();
  g.setTimeout = (fn: any, _ms?: number, ...args: any[]) => {
    const id = nextId++;
    Promise.resolve().then(() => {
      if (cancelled.delete(id)) return;
      if (typeof fn === 'function') fn(...args);
    });
    return id;
  };
  g.clearTimeout = (id: number) => {
    if (typeof id === 'number') cancelled.add(id);
  };
})();

const elk = new ELK();

const SCHEMA_VERSION = 2;
const FALLBACK_CLASS = 'ProcessBlock';
const CANVAS_MARGIN = 100;
// The key sits top-left like Template v4, so the diagram starts to its right.
const LEGEND_SPACE = 340;
const DIAGRAM_X = CANVAS_MARGIN + LEGEND_SPACE;

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
  isCore?: boolean;
  quadrant?: string; // Layout hint for Slide 10
}

interface GraphEdge {
  id: string;
  sourceId: string;
  targetId: string;
  label: string;
  bidirectional: boolean;
  stepNumbers?: number[];
  type?: string;
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

function sanitizeDiagram(diagram: Diagram): Diagram {
  const tag = '[' + diagram.pageTitle + ']';
  const seen = new Set<string>();
  const nodes: GraphNode[] = [];

  for (const raw of diagram.nodes || []) {
    if (!raw || raw.id === undefined || raw.id === null || raw.id === '') continue;
    const id = String(raw.id);
    if (id === 'root' || seen.has(id)) continue;
    seen.add(id);

    nodes.push({
      ...raw,
      id,
      label: String(raw.label || ''),
      kind: String(raw.kind || ''),
      deltaFlag: String(raw.deltaFlag || ''),
      category: String(raw.category || ''),
      parentId: raw.parentId === undefined || raw.parentId === null ? null : String(raw.parentId),
      quadrant: raw.quadrant
    });
  }

  const byId = new Map(nodes.map(n => [n.id, n] as [string, GraphNode]));

  for (const n of nodes) {
    if (n.parentId !== null && (n.parentId === n.id || !byId.has(n.parentId))) {
      n.parentId = null;
    }
  }

  for (const n of nodes) {
    const chain = new Set<string>([n.id]);
    let cur = n.parentId;
    while (cur !== null) {
      if (chain.has(cur)) {
        n.parentId = null;
        break;
      }
      chain.add(cur);
      cur = byId.get(cur)?.parentId ?? null;
    }
  }

  const edgeIds = new Set<string>();
  const edges: GraphEdge[] = [];

  if (diagram.archetype !== 'DEPLOYMENT') {
    (diagram.edges || []).forEach((raw, i) => {
      const sourceId = String(raw?.sourceId);
      const targetId = String(raw?.targetId);
      if (!byId.has(sourceId) || !byId.has(targetId)) return;

      const sourceNode = byId.get(sourceId);
      const targetNode = byId.get(targetId);
      if (sourceNode?.kind === 'capability' || targetNode?.kind === 'capability') return;

      let id = raw.id === undefined || raw.id === null || raw.id === '' ? 'edge_' + i : String(raw.id);
      if (edgeIds.has(id) || byId.has(id) || id === 'root') {
        id = id + '__' + i;
      }
      edgeIds.add(id);
      edges.push({ ...raw, id, sourceId, targetId, label: String(raw.label || ''), bidirectional: !!raw.bidirectional });
    });
  }

  return { ...diagram, nodes, edges };
}

interface Swatch {
  fill: string;
  line: string;
  legend: string;
}

const KEY: { [role: string]: Swatch } = {
  tool: { fill: '#EAF2FF', line: '#6FA8F5', legend: 'Tool' },
  externalTool: { fill: '#F3F4F6', line: '#6B7280', legend: 'External Tool' },
  dataStore: { fill: '#FFF2CC', line: '#F2C14E', legend: 'Data Store' },
  system: { fill: '#C9F2C7', line: '#5CB85C', legend: 'Enterprise System' },
  capability: { fill: '#FFF2CC', line: '#F2C14E', legend: 'Business Capability' },
  contextCapability: { fill: '#F3F4F6', line: '#9CA3AF', legend: 'Business Capability' },
  location: { fill: '#F2D9FA', line: '#D58CEB', legend: 'Location' },
  environment: { fill: '#FDE2E2', line: '#F08080', legend: 'Deployment Environment' },
  host: { fill: '#EAF2FF', line: '#6FA8F5', legend: 'Host' },
  perimeter: { fill: '#FFFFFF', line: '#9CA3AF', legend: 'External Boundary' },
  unknown: { fill: '#FFFFFF', line: '#D0021B', legend: 'Unknown Type' }
};

const RED = '#D0021B';
const RETIRING_LINE = '#9CA3AF';
const TRANSPARENT = '#FFFFFF00';

const RECT_CLASSES = [FALLBACK_CLASS];
const CIRCLE_CLASSES = ['ConnectorBlock', 'CircleBlock'];
const DATASTORE_CLASSES = ['DatabaseBlock', 'StoredDataBlock'];
const ELLIPSE_CLASSES = ['ConnectorBlock', 'CircleBlock'];

const SHOW_GCP_BADGES = true;
const BADGE_SIZE = 32;

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

function normalizeTool(name: string): string {
  return name.toLowerCase().replace(/\(.*?\)/g, '').replace(/^(gcp|google)\s+/, '').replace(/[^a-z0-9]/g, '');
}

function toolName(node: GraphNode): string {
  return node.technology || node.label;
}

function resolveGcpClass(node: GraphNode): string | null {
  return GCP_CLASS_MAP[normalizeTool(toolName(node))] || GCP_CLASS_MAP[normalizeTool(node.label.split('\n')[0])] || null;
}

function looksLikeGcp(node: GraphNode): boolean {
  return /^(gcp|google)\b/i.test(toolName(node).trim());
}

function firstLine(node: GraphNode): string {
  return String(node.label || node.id).split('\n')[0];
}

function isDataStore(node: GraphNode): boolean {
  if (node.isSoR) return true;
  const text = (node.label + ' ' + (node.technology || '')).toLowerCase();
  if (/browser|chrome|endpoint|client|gateway|proxy|ingress/i.test(text)) return false;
  return /\b(database|datastore|data\s*lake|spanner|bigquery|sql|oracle|dynamodb|cosmos)\b/i.test(text);
}

function roleFor(node: GraphNode, archetype: string): string {
  if (node.isContainer) {
    switch (node.kind) {
      case 'system': case 'enterprise_system': return 'system';
      case 'capability': case 'business_capability': return archetype === 'CONTEXT' ? 'contextCapability' : 'capability';
      case 'macro_env': case 'macro_environment': return 'environment';
      case 'location': return 'location';
      case 'host': return 'host';
      case 'perimeter': return 'perimeter';
      default: return 'unknown';
    }
  }
  if (isDataStore(node)) return 'dataStore';
  if (node.category === 'external') return 'externalTool';
  return 'tool';
}

function shapeClassesFor(node: GraphNode, role: string, archetype: string): string[] {
  if (node.isContainer) return RECT_CLASSES;
  if (archetype === 'CONTEXT') return CIRCLE_CLASSES;
  if (role === 'dataStore') return DATASTORE_CLASSES;
  return RECT_CLASSES;
}

function isRedCircle(node: GraphNode): boolean {
  return !node.isContainer && /^\s*(add|chang|red\b)/i.test(node.deltaFlag || '');
}

function isRetiring(node: GraphNode): boolean {
  return !node.isContainer && /^\s*retir/i.test(node.deltaFlag || '');
}

const ELLIPSE_SCALE = 1.42;

function ellipseMargin(w: number, h: number): { mx: number; my: number } {
  return { mx: Math.ceil(((ELLIPSE_SCALE - 1) * w) / 2) + 6, my: Math.ceil(((ELLIPSE_SCALE - 1) * h) / 2) + 6 };
}

const CHAR_W = 8.5;
// Container titles are bold, which renders wider than body text.
const BOLD_CHAR_W = 9.5;
const LINE_H = 20;
const EDGE_LABEL_CHAR_W = 7;
const EDGE_LABEL_LINE_H = 16;

function wrappedLines(label: string, width: number, charW = CHAR_W): number {
  const usable = Math.max(50, width - 24);
  return String(label || '').split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil((line.length * charW) / usable)), 0);
}

function longestLine(label: string): number {
  return Math.max(0, ...String(label || '').split('\n').map(l => l.length));
}

function headerMinWidth(label: string): number {
  // Increased max cap to 800 and padding buffer to 90 to prevent title clipping
  return Math.min(800, Math.max(280, longestLine(label) * BOLD_CHAR_W + 90));
}

function edgeLabelSize(label: string): { w: number; h: number } {
  const lines = String(label || '').split('\n').length;
  return { w: Math.ceil(longestLine(label) * EDGE_LABEL_CHAR_W + 16), h: lines * EDGE_LABEL_LINE_H + 8 };
}

function nodeSize(node: GraphNode, archetype: string): { w: number; h: number } {
  const longest = longestLine(node.label);
  if (node.isContainer) {
    // Increased max cap to 800 and padding buffer to 90
    const w = Math.min(800, Math.max(300, longest * BOLD_CHAR_W + 90));
    return { w, h: Math.max(110, wrappedLines(node.label, w, BOLD_CHAR_W) * LINE_H + 58) };
  }
  if (archetype === 'CONTEXT') {
    const d = Math.min(220, Math.max(150, longest * 6.5 + 45));
    return { w: d, h: d };
  }
  if (isDataStore(node)) {
    const w = Math.min(320, Math.max(200, longest * CHAR_W + 44));
    return { w, h: Math.max(110, wrappedLines(node.label, w) * LINE_H + 58) };
  }
  const w = Math.min(300, Math.max(180, longest * CHAR_W + 40));
  const h = Math.max(88, wrappedLines(node.label, w) * LINE_H + 42);
  return { w, h };
}

function headerHeight(label: string, width: number): number {
  return Math.max(40, wrappedLines(label, width, BOLD_CHAR_W) * LINE_H + 16);
}

// Template v4 draws every tool on a decomposition slide at one size.
function uniformToolSize(diagram: Diagram): { w: number; h: number } | null {
  if (diagram.archetype !== 'DECOMPOSITION') return null;
  const parents = new Set(diagram.nodes.map(n => n.parentId));
  const tools = diagram.nodes.filter(n => !n.isContainer && !parents.has(n.id) && !isDataStore(n));
  if (tools.length === 0) return null;
  const sizes = tools.map(t => nodeSize(t, diagram.archetype));
  return { w: Math.max(...sizes.map(s => s.w)), h: Math.max(...sizes.map(s => s.h)) };
}

const WRAPPING_KEY = 'elk.layered.wrapping.strategy';

// Connector labels are sized ELK edge labels, so ELK reserves their space and corridor gaps can stay tight.
function rootLayoutOptions(diagram: Diagram): { [key: string]: string } {
  const options: { [key: string]: string } = {
    'elk.algorithm': 'layered',
    'elk.direction': 'RIGHT',
    'elk.edgeRouting': 'ORTHOGONAL',
    'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
    'elk.edgeLabels.inline': 'true',
    'elk.edgeLabels.placement': 'CENTER',
    'elk.spacing.nodeNode': '60',
    'elk.spacing.edgeNode': '30',
    'elk.spacing.edgeEdge': '25',
    'elk.spacing.edgeLabel': '6',
    'elk.layered.spacing.edgeNodeBetweenLayers': '30',
    'elk.layered.spacing.edgeEdgeBetweenLayers': '20',
    'elk.layered.spacing.nodeNodeBetweenLayers': '90',
    'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
    'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES'
  };

  if (diagram.archetype === 'CONTEXT') {
    options['elk.partitioning.activate'] = 'true';
    options['elk.layered.spacing.nodeNodeBetweenLayers'] = '220';
    options['elk.spacing.nodeNode'] = '70';
    options['elk.spacing.edgeNode'] = '40';
  }

  // Template v4 information flow is a 2D map, so long hop chains wrap onto new rows.
  if (diagram.archetype === 'INFO_FLOW') {
    options['elk.aspectRatio'] = '1.78';
    options[WRAPPING_KEY] = 'MULTI_EDGE';
    options['elk.layered.spacing.nodeNodeBetweenLayers'] = '80';
    options['elk.spacing.nodeNode'] = '50';
  }

  return options;
}

function getContextPartition(node: GraphNode, kids: GraphNode[]): number {
  if (node.isCore) return 1;
  const combinedText = (
    node.label + ' ' + (node.technology || '') + ' ' + node.category + ' ' + kids.map(k => k.label + ' ' + (k.technology || '')).join(' ')
  ).toLowerCase();

  if (/saas|directory|partner|external|provider|vendor|target|chronicle|siem|ping|entra|workday|servicenow/i.test(combinedText)) {
    return 2;
  }
  return 0;
}

const DEP_GAP = 30;
const DEP_PAD = 24;
const QUADRANT_ORDER = ['TL', 'TR', 'BL', 'BR'];

function deploymentOrder(env: GraphNode): number {
  const hinted = QUADRANT_ORDER.indexOf(String(env.quadrant || '').toUpperCase());
  if (hinted >= 0) return hinted;
  const text = (env.label + ' ' + env.id).toLowerCase();
  if (/fleet|endpoint|client|workforce/.test(text)) return 0;
  if (/gcp|google|cloud|azure|aws/.test(text)) return 1;
  if (/corporate|facilities|data\s*center|wdc|qdc/.test(text)) return 2;
  if (/saas|third|external/.test(text)) return 3;
  return 4;
}

// Shelf packing: fill rows left to right, wrap past maxWidth, then centre each row.
function packRows(items: any[], maxWidth: number): { width: number; height: number } {
  const rows: any[][] = [];
  let x = 0;
  let y = 0;
  let rowH = 0;
  let width = 0;
  for (const item of items) {
    if (rows.length === 0 || (x > 0 && x + item.width > maxWidth)) {
      if (rows.length > 0) y += rowH + DEP_GAP;
      rows.push([]);
      x = 0;
      rowH = 0;
    }
    item.x = x;
    item.y = y;
    rows[rows.length - 1].push(item);
    x += item.width + DEP_GAP;
    rowH = Math.max(rowH, item.height);
    width = Math.max(width, x - DEP_GAP);
  }
  for (const row of rows) {
    const last = row[row.length - 1];
    const shift = (width - (last.x + last.width)) / 2;
    row.forEach(i => { i.x += shift; });
  }
  return { width, height: rows.length ? y + rowH : 0 };
}

// Template v4 deployment: tools in a grid inside each Location, containers sized bottom-up, rows packed to 16:9.
function layoutDeployment(diagram: Diagram): any {
  const kids = new Map<string | null, GraphNode[]>();
  diagram.nodes.forEach(n => {
    const list = kids.get(n.parentId) || [];
    list.push(n);
    kids.set(n.parentId, list);
  });

  const build = (node: GraphNode): any => {
    const children = kids.get(node.id) || [];
    if (children.length === 0) {
      const s = nodeSize(node, diagram.archetype);
      return { id: node.id, width: s.w, height: s.h };
    }
    const built = children.map(build);
    let content: { width: number; height: number };
    if (built.every(c => !c.children)) {
      const cellW = Math.max(...built.map(c => c.width));
      const cellH = Math.max(...built.map(c => c.height));
      const cols = built.length <= 3 ? built.length : built.length === 4 ? 2 : 3;
      const rows = Math.ceil(built.length / cols);
      built.forEach((c, i) => {
        c.width = cellW;
        c.height = cellH;
        c.x = (i % cols) * (cellW + DEP_GAP);
        c.y = Math.floor(i / cols) * (cellH + DEP_GAP);
      });
      content = { width: cols * cellW + (cols - 1) * DEP_GAP, height: rows * cellH + (rows - 1) * DEP_GAP };
    } else {
      content = packRows(built, Math.max(1500, ...built.map(c => c.width)));
    }
    const width = Math.max(headerMinWidth(node.label), content.width + 2 * DEP_PAD);
    const top = headerHeight(node.label, width) + 12;
    const shiftX = (width - content.width) / 2;
    built.forEach(c => {
      c.x += shiftX;
      c.y += top;
    });
    return { id: node.id, width, height: top + content.height + DEP_PAD, children: built };
  };

  const roots = (kids.get(null) || []).slice().sort((a, b) => deploymentOrder(a) - deploymentOrder(b));
  const built = roots.map(build);
  const area = built.reduce((sum, c) => sum + c.width * c.height, 0);
  const target = Math.max(0, ...built.map(c => c.width), Math.sqrt(area * 1.78));
  const size = packRows(built, target);
  return { id: 'root', width: size.width, height: size.height, children: built };
}

function buildElkGraph(diagram: Diagram): any {
  if (diagram.archetype === 'DEPLOYMENT') {
    return layoutDeployment(diagram);
  }
  const toolSize = uniformToolSize(diagram);

  const childrenByParent = new Map<string | null, GraphNode[]>();
  for (const node of diagram.nodes) {
    const list = childrenByParent.get(node.parentId) || [];
    list.push(node);
    childrenByParent.set(node.parentId, list);
  }

  const toElk = (node: GraphNode): any => {
    const kids = childrenByParent.get(node.id) || [];
    const elkNode: any = { id: node.id };

    if (kids.length > 0) {
      const minW = headerMinWidth(node.label);
      const top = headerHeight(node.label, minW) + 24;
      elkNode.layoutOptions = {
        'elk.padding': '[top=' + top + ',left=40,bottom=40,right=40]',
        'elk.nodeSize.constraints': 'MINIMUM_SIZE',
        'elk.nodeSize.minimum': '(' + minW + ', ' + (top + 50) + ')'
      };

      if (diagram.archetype === 'CONTEXT' && node.parentId === null) {
        const part = String(getContextPartition(node, kids));
        elkNode.layoutOptions['elk.partitioning.partition'] = part;
        elkNode.layoutOptions['elk.partition'] = part;
      }

      elkNode.children = kids.map(toElk);
    } else {
      const size = toolSize && !node.isContainer && !isDataStore(node) ? toolSize : nodeSize(node, diagram.archetype);
      elkNode.width = size.w;
      elkNode.height = size.h;
      elkNode.layoutOptions = {};

      if (isRedCircle(node)) {
        const m = ellipseMargin(size.w, size.h);
        elkNode.layoutOptions['elk.margins'] = '[top=' + m.my + ',left=' + m.mx + ',bottom=' + m.my + ',right=' + m.mx + ']';
      }

      if (diagram.archetype === 'CONTEXT' && node.parentId === null) {
        const part = String(getContextPartition(node, []));
        elkNode.layoutOptions['elk.partitioning.partition'] = part;
        elkNode.layoutOptions['elk.partition'] = part;
      }
    }
    return elkNode;
  };

  return {
    id: 'root',
    layoutOptions: { ...rootLayoutOptions(diagram), 'elk.json.edgeCoords': 'ROOT' },
    children: (childrenByParent.get(null) || []).map(toElk),
    edges: diagram.edges.map(e => {
      const elkEdge: any = { id: e.id, sources: [e.sourceId], targets: [e.targetId] };
      if (e.label) {
        const s = edgeLabelSize(e.label);
        elkEdge.labels = [{ id: e.id + '__label', text: e.label, width: s.w, height: s.h }];
      }
      return elkEdge;
    })
  };
}

interface Box { x: number; y: number; w: number; h: number; }
interface Placed { node: GraphNode; x: number; y: number; w: number; h: number; }

function flattenLayout(elkNode: any, offsetX: number, offsetY: number, nodeById: Map<string, GraphNode>, out: Placed[]): void {
  for (const child of elkNode.children || []) {
    const x = offsetX + (child.x || 0);
    const y = offsetY + (child.y || 0);
    const node = nodeById.get(child.id);
    if (node) {
      out.push({ node, x, y, w: child.width || 160, h: child.height || 100 });
    }
    flattenLayout(child, x, y, nodeById, out);
  }
}

function canvasBox(p: Placed): Box {
  return { x: p.x + DIAGRAM_X, y: p.y + CANVAS_MARGIN, w: p.w, h: p.h };
}

function outerBox(p: Placed): Box {
  if (!isRedCircle(p.node)) return { x: p.x, y: p.y, w: p.w, h: p.h };
  const m = ellipseMargin(p.w, p.h);
  return { x: p.x - m.mx, y: p.y - m.my, w: p.w + 2 * m.mx, h: p.h + 2 * m.my };
}

function fmtBox(b: Box): string {
  return Math.round(b.x) + ',' + Math.round(b.y) + ' ' + Math.round(b.w) + 'x' + Math.round(b.h);
}

async function loadClasses(classNames: string[]): Promise<Set<string>> {
  const available = new Set<string>();
  for (const className of classNames) {
    try {
      await client.loadBlockClasses([className]);
      available.add(className);
    } catch (err) {}
  }
  return available;
}

function trySet(label: string, fn: () => void): void {
  try { fn(); } catch (err) {}
}

const LABEL_KEYS = ['Name', 'Title', 'Text', 'Service Name', 'Header'];

function setLabel(block: BlockProxy, label: string): string | null {
  let existing: string[] = [];
  try { existing = Array.from(block.textAreas.keys()); } catch (err) {}

  const preferred = LABEL_KEYS.filter(k => existing.some(e => e.toLowerCase() === k.toLowerCase()))
    .map(k => existing.find(e => e.toLowerCase() === k.toLowerCase()) as string);
  const candidates = Array.from(new Set([...preferred, ...existing, ...LABEL_KEYS]));

  for (const key of candidates) {
    try {
      block.textAreas.set(key, label);
      if (String(block.textAreas.get(key) ?? '').replace(/\s+/g, '') === label.replace(/\s+/g, '')) return key;
    } catch {}
  }
  return null;
}

function setBold(block: BlockProxy, key: string): void {
  try {
    const styles = (block as any).textStyles;
    if (styles && typeof styles.set === 'function') {
      Promise.resolve(styles.set(key, { bold: true })).catch(() => {});
    }
  } catch (err) {}
}

function leftoverText(block: BlockProxy, keep: string | null): string[] {
  const out: string[] = [];
  try {
    for (const key of Array.from(block.textAreas.keys())) {
      if (key === keep) continue;
      const value = String(block.textAreas.get(key) ?? '').trim();
      if (value) out.push(key + '="' + (value.length > 40 ? value.substring(0, 40) + '...' : value) + '"');
    }
  } catch (err) {}
  return out;
}

function checkBlockBox(block: BlockProxy, want: Box, what: string, issues: string[]): void {
  let got: Box | undefined;
  try { got = (block as any).getBoundingBox(); } catch (err) { return; }
  if (!got) return;
  const off = Math.max(Math.abs(got.x - want.x), Math.abs(got.y - want.y), Math.abs(got.w - want.w), Math.abs(got.h - want.h));
  if (off > 2) {
    issues.push(what + ' was placed at ' + fmtBox(got) + ' instead of ' + fmtBox(want) + '; the shape class may force its own size or position.');
  }
}

function clearOtherText(block: BlockProxy, keep: string | null): void {
  let keys: string[] = [];
  try { keys = Array.from(block.textAreas.keys()); } catch { return; }
  for (const key of keys) {
    if (key === keep) continue;
    trySet('placeholder text ' + key, () => block.textAreas.set(key, ''));
  }
}

interface ShapeSpec {
  classes: string[];
  box: Box;
  fill: string;
  line: string;
  lineWidth: number;
  dashed?: boolean;
  rounding?: number;
  text?: string;
  bold?: boolean;
}

interface DrawContext {
  issues: string[];
  unavailable: Set<string>;
  substitutions: Map<string, number>;
  fillMismatches: string[];
}

function verifyFill(block: BlockProxy, fill: string, what: string, ctx: DrawContext): void {
  try {
    const actual = block.properties.get('FillColor');
    if (typeof actual !== 'string') return;
    const norm = (c: string) => c.toLowerCase().replace(/^#/, '').substring(0, 6);
    if (norm(actual) !== norm(fill)) ctx.fillMismatches.push(what + ' is ' + actual + ' (wanted ' + fill + ')');
  } catch {}
}

function drawShape(page: PageProxy, spec: ShapeSpec, what: string, ctx: DrawContext): BlockProxy | null {
  const candidates = spec.classes.filter(c => !ctx.unavailable.has(c));
  if (candidates.indexOf(FALLBACK_CLASS) < 0) candidates.push(FALLBACK_CLASS);

  let block: BlockProxy | null = null;
  let used = '';
  for (const className of candidates) {
    try {
      block = page.addBlock({ className, boundingBox: spec.box, fillStyle: spec.fill });
      used = className;
      break;
    } catch (err) {
      if (className !== FALLBACK_CLASS) ctx.unavailable.add(className);
    }
  }
  if (!block) {
    try {
      block = page.addBlock({ className: FALLBACK_CLASS, boundingBox: spec.box });
      used = FALLBACK_CLASS;
      ctx.issues.push(what + ' was drawn without its key colour (fill ' + spec.fill + ' was rejected).');
    } catch (err) {
      return null;
    }
  }
  if (used !== spec.classes[0]) {
    const key = spec.classes[0] + ' -> ' + used;
    ctx.substitutions.set(key, (ctx.substitutions.get(key) || 0) + 1);
  }

  const b = block;
  trySet('line style of ' + what, () => {
    b.properties.set('LineColor', spec.line);
    b.properties.set('LineWidth', spec.lineWidth);
  });
  if (spec.dashed) trySet('dashed line of ' + what, () => b.properties.set('StrokeStyle', 'dashed'));
  const rounding = spec.rounding || 0;
  if (rounding > 0) trySet('rounding of ' + what, () => b.properties.set('Rounding', rounding));
  verifyFill(b, spec.fill, what, ctx);

  let labelKey: string | null = null;
  if (spec.text !== undefined) {
    labelKey = setLabel(b, spec.text);
    if (labelKey === null) {
      ctx.issues.push('Label not written on ' + what + ' (' + used + '); the shape shows its default text.');
    } else if (spec.bold) {
      setBold(b, labelKey);
    }
  }
  clearOtherText(b, labelKey);
  const leftover = leftoverText(b, labelKey);
  if (leftover.length > 0) ctx.issues.push(what + ' (' + used + ') still shows default text: ' + leftover.join(', ') + '.');
  checkBlockBox(b, spec.box, what + ' (' + used + ')', ctx.issues);
  return b;
}

function drawGcpBadge(page: PageProxy, className: string, tool: Box, label: string, issues: string[]): void {
  const box = { x: tool.x + 6, y: tool.y + 6, w: BADGE_SIZE, h: BADGE_SIZE };
  const what = 'GCP icon ' + className + ' on "' + label + '"';
  try {
    const icon = page.addBlock({ className, boundingBox: box });
    for (const key of Array.from(icon.textAreas.keys())) {
      trySet('icon text ' + key, () => icon.textAreas.set(key, ''));
    }
    const leftover = leftoverText(icon, null);
    if (leftover.length > 0) issues.push(what + ' still shows default text: ' + leftover.join(', ') + '.');
    checkBlockBox(icon, box, what, issues);
  } catch (err) {}
}

interface EdgePort {
  from: { x: number; y: number };
  to: { x: number; y: number };
}

// Perimeter dynamic port distribution to prevent shared line trunk merging
function getDistributedPorts(
  source: Placed,
  target: Placed,
  edgeIndex: number,
  totalEdgesOnNode: number,
  archetype: string
): EdgePort {
  if (archetype === 'CONTEXT') {
    const dx = target.x + target.w / 2 - (source.x + source.w / 2);
    const dy = target.y + target.h / 2 - (source.y + source.h / 2);
    const portOffset = totalEdgesOnNode > 1 ? 0.35 + (edgeIndex % 3) * 0.15 : 0.5;

    if (Math.abs(dx) >= Math.abs(dy)) {
      return dx > 0
        ? { from: { x: 1, y: portOffset }, to: { x: 0, y: portOffset } }
        : { from: { x: 0, y: portOffset }, to: { x: 1, y: portOffset } };
    } else {
      return dy > 0
        ? { from: { x: portOffset, y: 1 }, to: { x: portOffset, y: 0 } }
        : { from: { x: portOffset, y: 0 }, to: { x: portOffset, y: 1 } };
    }
  }

  const dx = target.x + target.w / 2 - (source.x + source.w / 2);
  const dy = target.y + target.h / 2 - (source.y + source.h / 2);
  const offset = totalEdgesOnNode > 1 ? 0.25 + (edgeIndex % 3) * 0.25 : 0.5;

  if (Math.abs(dx) / (source.w + target.w) >= Math.abs(dy) / (source.h + target.h)) {
    return dx >= 0
      ? { from: { x: 1, y: offset }, to: { x: 0, y: offset } }
      : { from: { x: 0, y: offset }, to: { x: 1, y: offset } };
  }
  return dy >= 0
    ? { from: { x: offset, y: 1 }, to: { x: offset, y: 0 } }
    : { from: { x: offset, y: 0 }, to: { x: offset, y: 1 } };
}

function routeLinks(a: Placed, b: Placed, edgeIndex: number, totalEdgesOnNode: number, archetype: string): EdgePort {
  return getDistributedPorts(a, b, edgeIndex, totalEdgesOnNode, archetype);
}

// Straight lines for System Context (Template v4 standard); elbow for others
function createLine(
  page: PageProxy,
  source: BlockProxy,
  target: BlockProxy,
  edge: GraphEdge,
  links: EdgePort,
  archetype: string,
  edgeIndex: number,
  issues: string[]
): boolean {
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
    ['unstyled', () => page.addLine({
      endpoint1: endpoint(source, links.from),
      endpoint2: endpoint(target, links.to)
    })],
    ['bare', () => page.addLine({
      endpoint1: { connection: source },
      endpoint2: { connection: target }
    } as any)]
  ];

  let line: any;
  for (const [name, attempt] of attempts) {
    try {
      line = attempt();
      break;
    } catch (err) {}
  }
  if (!line) return false;

  trySet('line shape', () => {
    const shapeType = archetype === 'CONTEXT' ? 'diagonal' : 'elbow';
    if (typeof line.setShape === 'function') {
      line.setShape(shapeType);
    } else if (line.properties && typeof line.properties.set === 'function') {
      line.properties.set('LineShape', shapeType);
    }
  });

  // Stagger label placement along lines to avoid parallel text box overlap
  const locationOffset = 0.35 + (edgeIndex % 3) * 0.15;
  if (edge.label && !setLineLabel(line, edge.label, locationOffset)) {
    issues.push('Connector label "' + edge.label.split('\n')[0] + '" could not be written.');
  }
  return true;
}

function setLineLabel(line: any, text: string, location = 0.45): boolean {
  try {
    line.addTextArea(text, { location, side: 0 });
    return true;
  } catch {
    try {
      line.textAreas.set('Text', text);
      return true;
    } catch {
      return false;
    }
  }
}

function createEdge(
  page: PageProxy,
  source: BlockProxy,
  target: BlockProxy,
  edge: GraphEdge,
  a: Placed,
  b: Placed,
  edgeIndex: number,
  totalEdgesOnNode: number,
  archetype: string,
  issues: string[]
): boolean {
  const links = routeLinks(a, b, edgeIndex, totalEdgesOnNode, archetype);
  return createLine(page, source, target, edge, links, archetype, edgeIndex, issues);
}

function gridLayout(diagram: Diagram): any {
  const cols = Math.max(1, Math.ceil(Math.sqrt(diagram.nodes.length)));
  return {
    children: diagram.nodes.map((n, i) => {
      const size = nodeSize(n, diagram.archetype);
      return { id: n.id, x: (i % cols) * 360, y: Math.floor(i / cols) * 280, width: size.w, height: size.h };
    })
  };
}

function shortError(err: unknown): string {
  const first = describeError(err).split('\n')[0];
  return first.length > 300 ? first.substring(0, 300) + '...' : first;
}

function listSome(items: string[], max = 3): string {
  return items.slice(0, max).join('; ') + (items.length > max ? '; ... (' + (items.length - max) + ' more)' : '');
}

const KNOWN_CONTAINER_KINDS = ['system', 'enterprise_system', 'capability', 'business_capability', 'macro_env', 'macro_environment', 'location', 'host', 'perimeter'];
const DELTA_VALUES = ['neutral', 'adding', 'changing', 'retiring'];

function stepsOf(edge: GraphEdge): number[] {
  if (Array.isArray(edge.stepNumbers) && edge.stepNumbers.length > 0) return edge.stepNumbers;
  const found: number[] = [];
  String(edge.label || '').split('\n').forEach(l => {
    const m = /^\s*step\s+(\d+)/i.exec(l);
    if (m) found.push(Number(m[1]));
  });
  return found;
}

function checkStandards(diagram: Diagram): string[] {
  const out: string[] = [];
  const byId = new Map(diagram.nodes.map(n => [n.id, n] as [string, GraphNode]));
  const kindOf = (id: string | null) => (id ? (byId.get(id)?.kind || '') : '');
  const nameOf = (id: string) => {
    const n = byId.get(id);
    return n ? firstLine(n) : id;
  };
  const edgeName = (e: GraphEdge) => '"' + nameOf(e.sourceId) + '" -> "' + nameOf(e.targetId) + '"';
  const childCount = new Map<string, number>();
  const toolChildren = new Map<string, number>();
  for (const n of diagram.nodes) {
    if (!n.parentId) continue;
    childCount.set(n.parentId, (childCount.get(n.parentId) || 0) + 1);
    if (!n.isContainer) toolChildren.set(n.parentId, (toolChildren.get(n.parentId) || 0) + 1);
  }
  const degree = new Map<string, number>();
  for (const e of diagram.edges) {
    degree.set(e.sourceId, (degree.get(e.sourceId) || 0) + 1);
    degree.set(e.targetId, (degree.get(e.targetId) || 0) + 1);
  }
  const isSystem = (k: string) => k === 'system' || k === 'enterprise_system';
  const isCapability = (k: string) => k === 'capability' || k === 'business_capability';
  const isMacro = (k: string) => k === 'macro_env' || k === 'macro_environment';
  const tools = diagram.nodes.filter(n => !n.isContainer);
  const a = diagram.archetype;

  for (const n of diagram.nodes) {
    if (n.isContainer && KNOWN_CONTAINER_KINDS.indexOf(n.kind) < 0) {
      out.push('Container "' + firstLine(n) + '" has unknown type "' + n.kind + '" (expected SYSTEM, CAPABILITY, MACRO_ENV, LOCATION, HOST or PERIMETER); drawn with a red outline.');
    }
  }

  for (const e of diagram.edges) {
    if (isCapability(kindOf(e.sourceId)) || isCapability(kindOf(e.targetId))) {
      out.push('Connector ' + edgeName(e) + ' touches a CAPABILITY container; capabilities must have no connectors.');
    }
  }

  for (const n of tools) {
    const raw = String(n.deltaFlag || 'Neutral').trim();
    const flag = raw.toLowerCase();
    if (DELTA_VALUES.indexOf(flag) < 0) {
      out.push('Tool "' + firstLine(n) + '" has unknown delta_flag "' + raw + '" (expected Neutral, Adding, Changing or Retiring).');
      continue;
    }
    if (flag === 'neutral') continue;
    if (a !== 'DECOMPOSITION') {
      out.push('Tool "' + firstLine(n) + '" is flagged "' + raw + '"; delta flags only apply to slides 7-9.');
    } else if (diagram.key === 'slide_7') {
      out.push('Current State tool "' + firstLine(n) + '" is flagged "' + raw + '"; slide 7 must be all Neutral.');
    } else if (diagram.key === 'slide_8' && flag === 'adding') {
      out.push('Interim State tool "' + firstLine(n) + '" is flagged Adding; slide 8 uses Changing for new, pilot or transitional tools.');
    } else if (diagram.key === 'slide_9' && flag === 'retiring') {
      out.push('Target State tool "' + firstLine(n) + '" is flagged Retiring; retired tools must be left off slide 9.');
    }
  }

  if (a === 'DECOMPOSITION') {
    for (const n of diagram.nodes) {
      if (!n.isContainer) continue;
      if (isCapability(n.kind)) {
        if (!isSystem(kindOf(n.parentId))) out.push('Capability "' + firstLine(n) + '" must be nested inside a SYSTEM container.');
        if (toolChildren.get(n.id)) out.push('Capability "' + firstLine(n) + '" holds ' + toolChildren.get(n.id) + ' tool(s); capabilities must not contain tools.');
      } else if (isSystem(n.kind)) {
        if (n.parentId) out.push('Enterprise System "' + firstLine(n) + '" must sit at the root canvas, not inside "' + nameOf(n.parentId) + '".');
        const hasCapability = diagram.nodes.some(c => c.parentId === n.id && isCapability(c.kind));
        if (!hasCapability) out.push('Enterprise System "' + firstLine(n) + '" has no Business Capability inside it.');
        const instances = diagram.edges.filter(e => e.sourceId === n.id && !byId.get(e.targetId)?.isContainer);
        if (instances.length === 0) out.push('Enterprise System "' + firstLine(n) + '" has no Instance connector to a tool.');
      }
    }
    for (const e of diagram.edges) {
      const fromSystem = isSystem(kindOf(e.sourceId));
      if (fromSystem && byId.get(e.targetId)?.isContainer) {
        out.push('Instance connector ' + edgeName(e) + ' must point at a tool, not a container.');
      }
      if (/^\s*instance\s*$/i.test(e.label || '') && !fromSystem) {
        out.push('Connector ' + edgeName(e) + ' is labelled Instance but does not start at an Enterprise System.');
      }
      if (isSystem(kindOf(e.targetId))) {
        out.push('Connector ' + edgeName(e) + ' points into an Enterprise System; Instance connectors go from the system to the tool.');
      }
    }
    for (const n of tools) {
      if (n.category === 'internal') {
        if (n.parentId !== null) out.push('Internal tool "' + firstLine(n) + '" must sit at the root canvas (parent_container null).');
      } else if (n.category === 'external') {
        const pk = kindOf(n.parentId);
        if (pk && pk !== 'perimeter') out.push('External tool "' + firstLine(n) + '" is inside "' + nameOf(n.parentId as string) + '"; external tools sit standalone at the root.');
      }
      if (!degree.get(n.id)) out.push('Tool "' + firstLine(n) + '" has no connectors.');
    }
  } else if (a === 'DEPLOYMENT') {
    if (diagram.edges.length > 0) out.push('System Deployment must have no connectors (found ' + diagram.edges.length + ').');
    for (const n of diagram.nodes) {
      if (n.isContainer) {
        if (n.kind === 'location' && !isMacro(kindOf(n.parentId))) out.push('Location "' + firstLine(n) + '" must be nested inside a MACRO_ENV container.');
        if (isMacro(n.kind) && n.parentId) out.push('Environment "' + firstLine(n) + '" must sit at the root canvas.');
        if (n.kind !== 'location' && !isMacro(n.kind)) out.push('Container "' + firstLine(n) + '" is type ' + n.kind.toUpperCase() + '; slide 10 only uses MACRO_ENV and LOCATION.');
        if (!childCount.get(n.id)) out.push('Container "' + firstLine(n) + '" is empty.');
      } else if (kindOf(n.parentId) !== 'location') {
        out.push('Tool "' + firstLine(n) + '" must be inside a LOCATION container.');
      }
    }
  } else if (a === 'INFO_FLOW') {
    for (const n of diagram.nodes) {
      if (n.isContainer && n.kind === 'host' && !childCount.get(n.id)) out.push('HOST container "' + firstLine(n) + '" holds no datastore.');
      if (!n.isContainer && n.isSoR && kindOf(n.parentId) !== 'host') out.push('System of Record "' + firstLine(n) + '" should be nested inside a HOST container.');
      if (!n.isContainer && !degree.get(n.id)) out.push('"' + firstLine(n) + '" is not part of any step.');
    }
    const unnumbered: string[] = [];
    const mislabeled: string[] = [];
    const firsts: number[] = [];
    const all: number[] = [];
    for (const e of diagram.edges) {
      const nums = stepsOf(e);
      if (nums.length === 0) {
        unnumbered.push(edgeName(e));
        continue;
      }
      firsts.push(nums[0]);
      nums.forEach(num => {
        all.push(num);
        if (!new RegExp('\\bstep\\s+' + num + '\\b', 'i').test(e.label || '')) mislabeled.push(edgeName(e) + ' (step ' + num + ')');
      });
    }
    if (unnumbered.length > 0) out.push(unnumbered.length + ' connector(s) have no stepNumber: ' + listSome(unnumbered) + '.');
    if (mislabeled.length > 0) out.push('Connector label does not include its "Step N": ' + listSome(mislabeled) + '.');
    const sorted = all.slice().sort((x, y) => x - y);
    const dups = sorted.filter((n, i) => i > 0 && n === sorted[i - 1]);
    if (dups.length > 0) out.push('Duplicate step number(s): ' + Array.from(new Set(dups)).join(', ') + '.');
    if (firsts.some((n, i) => i > 0 && n < firsts[i - 1])) out.push('Steps are not in ascending order in the connectors array: ' + firsts.join(', ') + '.');
    const gaps: number[] = [];
    for (let i = 1; i <= (sorted[sorted.length - 1] || 0); i++) if (sorted.indexOf(i) < 0) gaps.push(i);
    if (gaps.length > 0) out.push('Step numbering has gaps; missing step(s) ' + gaps.join(', ') + '.');

    const edgesByStep = new Map<number, GraphEdge>();
    for (const e of diagram.edges) {
      const nums = stepsOf(e);
      if (nums.length > 0 && !edgesByStep.has(nums[0])) edgesByStep.set(nums[0], e);
    }
    for (let s = 1; s < edgesByStep.size; s++) {
      const cur = edgesByStep.get(s);
      const next = edgesByStep.get(s + 1);
      if (cur && next && cur.targetId !== next.sourceId && cur.sourceId !== next.sourceId) {
        out.push('Information Flow break between Step ' + s + ' and Step ' + (s + 1) + ': "' + nameOf(cur.targetId) + '" does not connect to "' + nameOf(next.sourceId) + '".');
      }
    }
  } else if (a === 'CONTEXT') {
    for (const n of diagram.nodes) {
      if (!n.isContainer) continue;
      if (!childCount.get(n.id)) out.push('Container "' + firstLine(n) + '" is empty.');
      if (!isCapability(n.kind)) out.push('Container "' + firstLine(n) + '" is type ' + n.kind.toUpperCase() + '; slide 6 groups peripheral tools in CAPABILITY containers.');
      if ((childCount.get(n.id) || 0) > 2) {
        out.push('Capability container "' + firstLine(n) + '" contains ' + childCount.get(n.id) + ' tools; slide 6 density limit is max 2 tools per container.');
      }
    }
    const flagged = tools.filter(n => n.isCore === true);
    const cores = flagged.length > 0 ? flagged : tools.filter(n => !n.parentId);
    const coreIds = new Set(cores.map(n => n.id));
    if (cores.length === 0) out.push('System Context has no central core tool (isCore true, parent_container null).');
    for (const n of cores) {
      if (n.parentId) out.push('Core tool "' + firstLine(n) + '" must sit at the root canvas, not inside "' + nameOf(n.parentId) + '".');
    }
    for (const n of tools) {
      if (!coreIds.has(n.id) && !n.parentId) out.push('Peripheral tool "' + firstLine(n) + '" should be inside a capability container.');
    }

    for (const e of diagram.edges) {
      const isSrcCore = coreIds.has(e.sourceId);
      const isTgtCore = coreIds.has(e.targetId);
      if (!isSrcCore && !isTgtCore) {
        out.push('Connector ' + edgeName(e) + ' bypasses the central core tool; slide 6 flows must interface with the central core.');
      }
    }
  }
  return out;
}

function checkGeometry(placed: Placed[], layout: any): string[] {
  const out: string[] = [];
  const W = Math.round(layout?.width || 0);
  const H = Math.round(layout?.height || 0);
  if (W > 5000 || H > 4000) out.push('Layout is ' + W + 'x' + H + ' px, far larger than a slide; consider fewer items or shorter labels.');
  return out;
}

interface LayoutResult { layout: any; failure: string | null; mode: 'elk' | 'elk-simple' | 'grid'; }

// Template v4 context slides use full-height capability columns with a shared top edge.
function stretchContextColumns(layout: any): void {
  const columns = (layout.children || []).filter((c: any) => Array.isArray(c.children) && c.children.length > 0);
  if (columns.length < 2) return;
  const top = Math.min(...columns.map((c: any) => c.y || 0));
  const bottom = Math.max(...columns.map((c: any) => (c.y || 0) + (c.height || 0)));
  for (const c of columns) {
    const shift = (bottom - top - c.height) / 2;
    c.children.forEach((k: any) => { k.y = (k.y || 0) + shift; });
    c.y = top;
    c.height = bottom - top;
  }
}

async function computeLayout(diagram: Diagram, tag: string): Promise<LayoutResult> {
  if (diagram.archetype === 'DEPLOYMENT') {
    return { layout: buildElkGraph(diagram), failure: null, mode: 'elk' };
  }
  let firstError = '';
  try {
    const layout = await elk.layout(buildElkGraph(diagram));
    if (diagram.archetype === 'CONTEXT') stretchContextColumns(layout);
    return { layout, failure: null, mode: 'elk' };
  } catch (err) {
    firstError = shortError(err);
  }
  try {
    const graph = buildElkGraph(diagram);
    if (graph.layoutOptions && graph.layoutOptions[WRAPPING_KEY]) {
      delete graph.layoutOptions[WRAPPING_KEY];
      const layout = await elk.layout(graph);
      return { layout, failure: null, mode: 'elk' };
    }
  } catch (err) {}
  try {
    const graph = buildElkGraph(diagram);
    graph.layoutOptions = { 'elk.algorithm': 'layered', 'elk.direction': 'RIGHT', 'elk.json.edgeCoords': 'ROOT' };
    const layout = await elk.layout(graph);
    return { layout, failure: 'ELK full layout failed (' + firstError + '); a simplified layout was used instead.', mode: 'elk-simple' };
  } catch (err) {}
  return {
    layout: gridLayout(diagram),
    failure: 'ELK failed, so a flat grid with no nesting was used. Full layout: ' + firstError,
    mode: 'grid'
  };
}

function addIssuesNote(page: PageProxy, issues: string[]): void {
  const MAX = 14;
  const shown = issues.slice(0, MAX).map(i => '- ' + i);
  if (issues.length > MAX) shown.push('... and ' + (issues.length - MAX) + ' more (see the browser console).');
  const h = 60 + shown.length * 34;
  trySet('render issues note', () => {
    const note = page.addBlock({ className: FALLBACK_CLASS, boundingBox: { x: CANVAS_MARGIN, y: 60 - h, w: 1100, h }, fillStyle: '#fde8e8' });
    setLabel(note, 'RENDER ISSUES (' + issues.length + ')\n' + shown.join('\n'));
    note.properties.set('LineColor', RED);
    note.properties.set('LineWidth', 3);
  });
}

function drawLegend(page: PageProxy, placed: Placed[], roles: Map<string, string>, ctx: DrawContext): void {
  if (placed.length === 0) return;
  // Template v4 puts the key in the top-left corner, in the LEGEND_SPACE strip left of the diagram.
  const x = CANVAS_MARGIN + 20;
  const top = CANVAS_MARGIN;

  const seen = new Set<string>();
  const entries: Array<{ swatch: Swatch; text: string; classes: string[]; dashed?: boolean; lineWidth?: number }> = [];
  roles.forEach(role => {
    const swatch = KEY[role] || KEY.unknown;
    if (seen.has(swatch.legend)) return;
    seen.add(swatch.legend);
    entries.push({ swatch, text: swatch.legend, classes: RECT_CLASSES });
  });
  if (placed.some(p => isRedCircle(p.node))) {
    entries.push({ swatch: { fill: TRANSPARENT, line: RED, legend: '' }, text: 'Adding / Changing', classes: ELLIPSE_CLASSES, lineWidth: 3 });
  }
  if (placed.some(p => isRetiring(p.node))) {
    entries.push({ swatch: { fill: KEY.tool.fill, line: RETIRING_LINE, legend: '' }, text: 'Retiring', classes: RECT_CLASSES, dashed: true });
  }
  if (entries.length === 0) return;

  const ENTRY_W = 220;
  const ENTRY_H = 36;
  const GAP = 12;
  const frameH = 56 + entries.length * (ENTRY_H + GAP) + 8;
  drawShape(page, { classes: RECT_CLASSES, box: { x: x - 20, y: top, w: ENTRY_W + 40, h: frameH }, fill: '#FFFFFF', line: '#9CA3AF', lineWidth: 1 }, 'Key frame', ctx);
  drawShape(page, { classes: RECT_CLASSES, box: { x, y: top + 8, w: ENTRY_W, h: 36 }, fill: TRANSPARENT, line: TRANSPARENT, lineWidth: 0, text: 'Key', bold: true }, 'Key title', ctx);
  entries.forEach((e, i) => {
    drawShape(page, {
      classes: e.classes,
      box: { x, y: top + 56 + i * (ENTRY_H + GAP), w: ENTRY_W, h: ENTRY_H },
      fill: e.swatch.fill,
      line: e.swatch.line,
      lineWidth: e.lineWidth || 2,
      dashed: e.dashed,
      text: e.text
    }, 'Key entry "' + e.text + '"', ctx);
  });
}

async function renderDiagram(page: PageProxy, rawDiagram: Diagram): Promise<string[]> {
  const tag = '[' + rawDiagram.pageTitle + ']';
  const issues: string[] = [];
  const diagram = await stage(tag, 'validate', () => sanitizeDiagram(rawDiagram));
  const nodeById = new Map(diagram.nodes.map(n => [n.id, n] as [string, GraphNode]));
  issues.push(...checkStandards(rawDiagram));

  const { layout, failure, mode } = await stage(tag, 'elk-layout', () => computeLayout(diagram, tag));
  if (failure) issues.unshift(failure);
  const placed: Placed[] = [];
  flattenLayout(layout, 0, 0, nodeById, placed);
  
  if (mode !== 'grid') {
    issues.push(...checkGeometry(placed, layout));
  }

  const parents = new Set(diagram.nodes.map(n => n.parentId).filter(id => id !== null) as string[]);
  const roles = new Map<string, string>();
  const badgeFor = new Map<string, string>();
  const wanted = new Set<string>([FALLBACK_CLASS]);
  const useBadges = SHOW_GCP_BADGES && diagram.archetype !== 'CONTEXT';
  
  for (const p of placed) {
    const role = roleFor(p.node, diagram.archetype);
    roles.set(p.node.id, role);
    shapeClassesFor(p.node, role, diagram.archetype).forEach(c => wanted.add(c));
    if (isRedCircle(p.node)) ELLIPSE_CLASSES.forEach(c => wanted.add(c));
    if (useBadges && !p.node.isContainer) {
      const gcp = resolveGcpClass(p.node);
      if (gcp) {
        badgeFor.set(p.node.id, gcp);
        wanted.add(gcp);
      }
    }
  }

  const available = await stage(tag, 'load-classes', () => loadClasses(Array.from(wanted)));
  const ctx: DrawContext = { issues, unavailable: new Set(Array.from(wanted).filter(c => !available.has(c))), substitutions: new Map<string, number>(), fillMismatches: [] };
  const blocks = new Map<string, BlockProxy>();
  
  await stage(tag, 'create-blocks', () => {
    for (const p of placed) {
      const role = roles.get(p.node.id) || 'unknown';
      const swatch = KEY[role] || KEY.unknown;
      const box = canvasBox(p);
      const name = firstLine(p.node);
      let block: BlockProxy | null;

      if (p.node.isContainer && parents.has(p.node.id)) {
        block = drawShape(page, { classes: RECT_CLASSES, box, fill: swatch.fill, line: swatch.line, lineWidth: 2 }, swatch.legend + ' "' + name + '"', ctx);
        const titleBox = { x: box.x, y: box.y, w: box.w, h: headerHeight(p.node.label, box.w) };
        // Template v4 context swimlanes carry a white, outlined header strip.
        const strip = diagram.archetype === 'CONTEXT';
        drawShape(page, {
          classes: RECT_CLASSES,
          box: titleBox,
          fill: strip ? '#FFFFFF' : TRANSPARENT,
          line: strip ? swatch.line : TRANSPARENT,
          lineWidth: strip ? 2 : 0,
          text: p.node.label,
          bold: true
        }, swatch.legend + ' title "' + name + '"', ctx);
      } else if (p.node.isContainer) {
        block = drawShape(page, { classes: RECT_CLASSES, box, fill: swatch.fill, line: swatch.line, lineWidth: 2, text: p.node.label, bold: true }, swatch.legend + ' "' + name + '"', ctx);
      } else {
        if (isRedCircle(p.node)) {
          const m = ellipseMargin(box.w, box.h);
          drawShape(page, {
            classes: ELLIPSE_CLASSES,
            box: { x: box.x - m.mx + 4, y: box.y - m.my + 4, w: box.w + 2 * (m.mx - 4), h: box.h + 2 * (m.my - 4) },
            fill: TRANSPARENT,
            line: RED,
            lineWidth: 3
          }, 'Red circle around "' + name + '"', ctx);
        }
        const retiring = isRetiring(p.node);
        const rect = shapeClassesFor(p.node, role, diagram.archetype) === RECT_CLASSES;
        block = drawShape(page, {
          classes: shapeClassesFor(p.node, role, diagram.archetype),
          box,
          fill: swatch.fill,
          line: retiring ? RETIRING_LINE : swatch.line,
          lineWidth: 2,
          dashed: retiring,
          rounding: rect && (role === 'tool' || role === 'externalTool') ? 10 : 0,
          text: p.node.label
        }, swatch.legend + ' "' + name + '"', ctx);
        const badge = badgeFor.get(p.node.id);
        if (block && badge && available.has(badge)) drawGcpBadge(page, badge, box, name, issues);
      }

      if (block) blocks.set(p.node.id, block);
    }
  });

  const placedById = new Map(placed.map(p => [p.node.id, p] as [string, Placed]));
  
  // Track edge distribution per node to prevent line collisions
  const edgeCount = new Map<string, number>();
  for (const edge of diagram.edges) {
    edgeCount.set(edge.sourceId, (edgeCount.get(edge.sourceId) || 0) + 1);
    edgeCount.set(edge.targetId, (edgeCount.get(edge.targetId) || 0) + 1);
  }

  const currentEdgeIndex = new Map<string, number>();

  await stage(tag, 'create-lines', () => {
    for (const edge of diagram.edges) {
      const source = blocks.get(edge.sourceId);
      const target = blocks.get(edge.targetId);
      const a = placedById.get(edge.sourceId);
      const b = placedById.get(edge.targetId);
      
      const sCount = edgeCount.get(edge.sourceId) || 1;
      const tCount = edgeCount.get(edge.targetId) || 1;
      const maxEdges = Math.max(sCount, tCount);
      
      const sIndex = currentEdgeIndex.get(edge.sourceId) || 0;
      const tIndex = currentEdgeIndex.get(edge.targetId) || 0;
      const edgeIndex = Math.max(sIndex, tIndex);
      
      currentEdgeIndex.set(edge.sourceId, sIndex + 1);
      currentEdgeIndex.set(edge.targetId, tIndex + 1);

      if (source && target && a && b) {
        // BYPASS: We no longer call drawRoute(..., route). 
        // We force createEdge so Lucidchart generates a single, native, malleable line.
        createEdge(page, source, target, edge, a, b, edgeIndex, maxEdges, diagram.archetype, issues);
      }
    }
  });

  await stage(tag, 'legend', () => drawLegend(page, placed, roles, ctx));

  if (issues.length > 0) addIssuesNote(page, issues);

  return issues;
}

function parsePayload(data: unknown): BootstrapPayload | null {
  const raw = (data as any)?.csaPayload;
  if (!raw) return null;
  try {
    const payload: BootstrapPayload = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (payload.schemaVersion !== SCHEMA_VERSION || !Array.isArray(payload.diagrams)) return null;
    return payload;
  } catch (err) {
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

  const problems: string[] = [];
  let rendered = 0;
  for (const diagram of payload.diagrams) {
    const page = pagesByTitle.get(diagram.pageTitle);
    if (!page) {
      console.warn('No page titled "' + diagram.pageTitle + '"; skipping. Pages: ' + Array.from(pagesByTitle.keys()).join(' | '));
      continue;
    }
    try {
      await renderDiagram(page, diagram);
      rendered++;
    } catch (err) {
      problems.push(diagram.pageTitle);
      console.error('Failed to render "' + diagram.pageTitle + '": ' + describeError(err));
    }
  }
  console.info('Rendered ' + rendered + '/' + payload.diagrams.length + ' diagrams.' + (problems.length ? ' Failed: ' + problems.join(', ') : ''));
}, true);