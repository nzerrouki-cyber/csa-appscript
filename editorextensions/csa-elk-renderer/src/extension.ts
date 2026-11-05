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
}

interface GraphEdge {
  id: string;
  sourceId: string;
  targetId: string;
  label: string;
  bidirectional: boolean;
  stepNumbers?: number[];
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

// Shape key from the CSA reference template slides: every element is a plain Lucid shape coloured by its role.
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

// Lucid classes to try, best first; FALLBACK_CLASS is always tried last.
const RECT_CLASSES = [FALLBACK_CLASS];
const CIRCLE_CLASSES = ['ConnectorBlock', 'CircleBlock'];
const DATASTORE_CLASSES = ['DatabaseBlock', 'StoredDataBlock'];
const ELLIPSE_CLASSES = ['ConnectorBlock', 'CircleBlock'];

// A small GCP 2021 icon in the corner of a tool. The tool shape itself always follows the key.
const SHOW_GCP_BADGES = true;
const BADGE_SIZE = 32;

// Class names from https://developer.lucid.co/docs/gcp-2021-library, keyed by normalizeTool().
// To support a new tool, add its normalized name here (see the "no GCP 2021 icon mapping" issue).
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

// technology is often generic ("Google Cloud Platform"), so the label is tried when it has no mapping.
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
  return node.isSoR || /database|\bdb\b|datastore|data\s*store|data\s*lake|\bcache\b/i.test(node.label + ' ' + (node.technology || ''));
}

function roleFor(node: GraphNode, archetype: string): string {
  if (node.isContainer) {
    switch (node.kind) {
      case 'system':
      case 'enterprise_system':
        return 'system';
      case 'capability':
      case 'business_capability':
        return archetype === 'CONTEXT' ? 'contextCapability' : 'capability';
      case 'macro_env':
      case 'macro_environment':
        return 'environment';
      case 'location':
        return 'location';
      case 'host':
        return 'host';
      case 'perimeter':
        return 'perimeter';
      default:
        return 'unknown';
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

// Red Circle Rule: Adding/Changing tools get a red ellipse drawn around them. "Retired" must not match.
function isRedCircle(node: GraphNode): boolean {
  return !node.isContainer && /^\s*(add|chang|red\b)/i.test(node.deltaFlag || '');
}

function isRetiring(node: GraphNode): boolean {
  return !node.isContainer && /^\s*retir/i.test(node.deltaFlag || '');
}

// An ellipse scaled by sqrt(2) passes through the corners of the box it surrounds.
const ELLIPSE_SCALE = 1.42;

function ellipseMargin(w: number, h: number): { mx: number; my: number } {
  return { mx: Math.ceil(((ELLIPSE_SCALE - 1) * w) / 2) + 4, my: Math.ceil(((ELLIPSE_SCALE - 1) * h) / 2) + 4 };
}

const CHAR_W = 7;
const LINE_H = 18;

function wrappedLines(label: string, width: number): number {
  const usable = Math.max(40, width - 30);
  return String(label || '').split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil((line.length * CHAR_W) / usable)), 0);
}

function longestLine(label: string): number {
  return Math.max(0, ...String(label || '').split('\n').map(l => l.length));
}

function nodeSize(node: GraphNode, archetype: string): { w: number; h: number } {
  const longest = longestLine(node.label);
  if (node.isContainer) {
    const w = Math.min(320, Math.max(220, longest * CHAR_W + 40));
    return { w, h: Math.max(90, wrappedLines(node.label, w) * LINE_H + 50) };
  }
  if (archetype === 'CONTEXT') {
    const d = Math.min(220, Math.max(140, longest * 5 + 70));
    return { w: d, h: d };
  }
  const w = Math.min(240, Math.max(150, longest * CHAR_W + 30));
  return { w, h: Math.max(80, wrappedLines(node.label, w) * LINE_H + 44) };
}

// Containers that hold children get their title in a strip along the top edge.
function headerMinWidth(label: string): number {
  return Math.min(480, Math.max(220, longestLine(label) * CHAR_W + 48));
}

function headerHeight(label: string, width: number): number {
  return Math.max(40, wrappedLines(label, width) * LINE_H + 16);
}
function rootLayoutOptions(diagram: Diagram): { [key: string]: string } {
  const hasContainers = diagram.nodes.some(n => n.isContainer);
  const options: { [key: string]: string } = {
    'elk.algorithm': 'layered',
    'elk.direction': 'RIGHT',
    'elk.edgeRouting': 'ORTHOGONAL',
    'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
    'elk.spacing.nodeNode': '70',
    'elk.spacing.edgeNode': '30',
    'elk.spacing.edgeEdge': '20',
    'elk.layered.spacing.edgeNodeBetweenLayers': '30',
    // Wide enough for Lucid's connector labels, which ELK does not size.
    'elk.layered.spacing.nodeNodeBetweenLayers': '140'
  };

  if (diagram.archetype === 'CONTEXT' && !hasContainers) {
    return { 'elk.algorithm': 'radial', 'elk.spacing.nodeNode': '80' };
  }
  if (diagram.archetype === 'DEPLOYMENT') {
    options['elk.direction'] = 'DOWN';
  }
  if (diagram.archetype === 'INFO_FLOW') {
    // Keep the payload's step order where the layering allows it.
    options['elk.layered.considerModelOrder.strategy'] = 'NODES_AND_EDGES';
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
    const elkNode: any = { id: node.id };

    if (kids.length > 0) {
      const minW = headerMinWidth(node.label);
      const top = headerHeight(node.label, minW) + 16;
      elkNode.layoutOptions = {
        'elk.padding': '[top=' + top + ',left=32,bottom=32,right=32]',
        'elk.nodeSize.constraints': 'MINIMUM_SIZE',
        'elk.nodeSize.minimum': '(' + minW + ', ' + (top + 40) + ')'
      };
      elkNode.children = kids.map(toElk);
    } else {
      const size = nodeSize(node, diagram.archetype);
      elkNode.width = size.w;
      elkNode.height = size.h;
      if (isRedCircle(node)) {
        // Reserve room for the red ellipse so it does not overlap neighbours.
        const m = ellipseMargin(size.w, size.h);
        elkNode.layoutOptions = { 'elk.margins': '[top=' + m.my + ',left=' + m.mx + ',bottom=' + m.my + ',right=' + m.mx + ']' };
      }
    }
    return elkNode;
  };

  return {
    id: 'root',
    layoutOptions: { ...rootLayoutOptions(diagram), 'elk.json.edgeCoords': 'ROOT' },
    children: (childrenByParent.get(null) || []).map(toElk),
    edges: diagram.edges.map(e => ({ id: e.id, sources: [e.sourceId], targets: [e.targetId] }))
  };
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
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

function canvasBox(p: Placed): Box {
  return { x: p.x + CANVAS_MARGIN, y: p.y + CANVAS_MARGIN, w: p.w, h: p.h };
}

// The area a shape really covers, including its red ellipse.
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
// Returns the text area that holds the label, or null.
function setLabel(block: BlockProxy, label: string): string | null {
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
      if (String(block.textAreas.get(key) ?? '').replace(/\s+/g, '') === label.replace(/\s+/g, '')) return key;
    } catch {
      // try the next key
    }
  }
  return null;
}

function setBold(block: BlockProxy, key: string): void {
  try {
    const styles = (block as any).textStyles;
    if (styles && typeof styles.set === 'function') {
      Promise.resolve(styles.set(key, { bold: true })).catch((err: unknown) => console.warn('Could not bold ' + key + ': ' + describeError(err)));
    }
  } catch (err) {
    console.warn('Could not bold ' + key + ': ' + describeError(err));
  }
}

// Text left in other areas is usually a shape's built-in placeholder ("Service Name", "Text", ...).
function leftoverText(block: BlockProxy, keep: string | null): string[] {
  const out: string[] = [];
  try {
    for (const key of Array.from(block.textAreas.keys())) {
      if (key === keep) continue;
      const value = String(block.textAreas.get(key) ?? '').trim();
      if (value) out.push(key + '="' + (value.length > 40 ? value.substring(0, 40) + '...' : value) + '"');
    }
  } catch (err) {
    console.warn('Could not read text areas: ' + describeError(err));
  }
  return out;
}

// Some classes force their own size or snap position, which breaks the ELK layout.
function checkBlockBox(block: BlockProxy, want: Box, what: string, issues: string[]): void {
  let got: Box | undefined;
  try {
    got = (block as any).getBoundingBox();
  } catch (err) {
    console.warn('Could not read bounding box of ' + what + ': ' + describeError(err));
    return;
  }
  if (!got) return;
  const off = Math.max(Math.abs(got.x - want.x), Math.abs(got.y - want.y), Math.abs(got.w - want.w), Math.abs(got.h - want.h));
  if (off > 2) {
    issues.push(what + ' was placed at ' + fmtBox(got) + ' instead of ' + fmtBox(want) + '; the shape class may force its own size or position.');
  }
}
// Shapes ship with placeholder text ("Process", "A"); blank every area that does not hold the label.
function clearOtherText(block: BlockProxy, keep: string | null): void {
  let keys: string[] = [];
  try {
    keys = Array.from(block.textAreas.keys());
  } catch {
    return;
  }
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
  } catch {
    // FillColor is not readable on every class
  }
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
      console.warn('addBlock failed for ' + what + ' with class ' + className + ': ' + describeError(err));
      if (className !== FALLBACK_CLASS) ctx.unavailable.add(className);
    }
  }
  if (!block) {
    try {
      block = page.addBlock({ className: FALLBACK_CLASS, boundingBox: spec.box });
      used = FALLBACK_CLASS;
      ctx.issues.push(what + ' was drawn without its key colour (fill ' + spec.fill + ' was rejected).');
    } catch (err) {
      ctx.issues.push(what + ' could not be drawn (' + shortError(err) + ').');
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
      console.warn('[Renderer] Could not set text on ' + what);
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
  } catch (err) {
    issues.push(what + ' could not be added (' + shortError(err) + ').');
  }
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

function createLine(page: PageProxy, source: BlockProxy, target: BlockProxy, edge: GraphEdge, links: { from: { x: number; y: number }; to: { x: number; y: number } }, issues: string[]): boolean {
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

  if (edge.label && !setLineLabel(line, edge.label)) {
    issues.push('Connector label "' + edge.label.split('\n')[0] + '" could not be written.');
  }
  return true;
}

// textAreas.set on a line can succeed without showing anything, so it is read back; addTextArea is the fallback.
function setLineLabel(line: any, text: string): boolean {
  try {
    line.textAreas.set('Text', text);
    if (String(line.textAreas.get('Text') ?? '').replace(/\s+/g, '') === text.replace(/\s+/g, '')) return true;
  } catch {
    // fall through to addTextArea
  }
  try {
    line.addTextArea(text, { location: 0.5, side: 0 });
    return true;
  } catch (err) {
    console.warn('Could not label line: ' + describeError(err));
    return false;
  }
}

// Draws the ELK-routed path as straight segments so lines follow ELK's obstacle-free route instead of
// Lucid's own elbow routing. The ends stay attached to the shapes; bend points are free-floating.
function createRoutedLine(page: PageProxy, source: BlockProxy, target: BlockProxy, edge: GraphEdge, a: Placed, b: Placed, route: Pt[], issues: string[]): boolean {
  const rel = (p: Placed, pt: Pt) => ({
    x: Math.min(1, Math.max(0, (pt.x - p.x) / p.w)),
    y: Math.min(1, Math.max(0, (pt.y - p.y) / p.h))
  });
  const abs = (pt: Pt) => ({ x: pt.x + CANVAS_MARGIN, y: pt.y + CANVAS_MARGIN });

  let longest = 0;
  let best = -1;
  for (let i = 0; i < route.length - 1; i++) {
    const len = Math.abs(route[i + 1].x - route[i].x) + Math.abs(route[i + 1].y - route[i].y);
    if (len > best) {
      best = len;
      longest = i;
    }
  }

  for (let i = 0; i < route.length - 1; i++) {
    const first = i === 0;
    const last = i === route.length - 2;
    const r1 = rel(a, route[i]);
    const r2 = rel(b, route[i + 1]);
    const from: any = first
      ? { connection: source, linkX: r1.x, linkY: r1.y, autoLink: false, ...(edge.bidirectional ? { style: 'Arrow' } : {}) }
      : abs(route[i]);
    const to: any = last ? { connection: target, linkX: r2.x, linkY: r2.y, autoLink: false, style: 'Arrow' } : abs(route[i + 1]);
    const line: any = page.addLine({ endpoint1: from, endpoint2: to });
    trySet('line shape', () => line.setShape('diagonal'));
    if (edge.label && i === longest && !setLineLabel(line, edge.label)) {
      issues.push('Connector label "' + edge.label.split('\n')[0] + '" could not be written.');
    }
  }
  return true;
}

function createEdge(page: PageProxy, source: BlockProxy, target: BlockProxy, edge: GraphEdge, a: Placed, b: Placed, route: Pt[] | undefined, issues: string[]): boolean {
  if (route && route.length >= 2) {
    try {
      return createRoutedLine(page, source, target, edge, a, b, route, issues);
    } catch (err) {
      console.warn('Routed line ' + edge.id + ' failed, using a plain line: ' + describeError(err));
    }
  }
  return createLine(page, source, target, edge, facingLinks(a, b), issues);
}

function gridLayout(diagram: Diagram): any {
  const cols = Math.max(1, Math.ceil(Math.sqrt(diagram.nodes.length)));
  return {
    children: diagram.nodes.map((n, i) => {
      const size = nodeSize(n, diagram.archetype);
      return { id: n.id, x: (i % cols) * 340, y: Math.floor(i / cols) * 260, width: size.w, height: size.h };
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

// Step numbers come from the normalizer; older payloads only carry them in "Step N: ..." labels.
function stepsOf(edge: GraphEdge): number[] {
  if (Array.isArray(edge.stepNumbers) && edge.stepNumbers.length > 0) return edge.stepNumbers;
  const found: number[] = [];
  String(edge.label || '').split('\n').forEach(l => {
    const m = /^\s*step\s+(\d+)/i.exec(l);
    if (m) found.push(Number(m[1]));
  });
  return found;
}
// Checks the payload graph against the CSA Diagram Standards so structural mistakes are reported on the page.
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

  // Red Circle Rule / delta flags.
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
      } else {
        out.push('Tool "' + firstLine(n) + '" has no type of INTERNAL or EXTERNAL.');
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
  } else if (a === 'CONTEXT') {
    for (const n of diagram.nodes) {
      if (!n.isContainer) continue;
      if (!childCount.get(n.id)) out.push('Container "' + firstLine(n) + '" is empty.');
      if (!isCapability(n.kind)) out.push('Container "' + firstLine(n) + '" is type ' + n.kind.toUpperCase() + '; slide 6 groups peripheral tools in CAPABILITY containers.');
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
      if (!coreIds.has(e.targetId)) out.push('Connector ' + edgeName(e) + ' does not point at the core tool; slide 6 flows point inward.');
    }
  }
  return out;
}
// Post-layout checks: problems here mean ELK's output, not the payload, is off.
function checkGeometry(placed: Placed[], layout: any): string[] {
  const out: string[] = [];
  const byId = new Map(placed.map(p => [p.node.id, p] as [string, Placed]));
  const parents = new Set(placed.map(p => p.node.parentId).filter(id => id !== null) as string[]);

  const bad = placed.filter(p => ![p.x, p.y, p.w, p.h].every(v => typeof v === 'number' && isFinite(v)) || p.w <= 0 || p.h <= 0);
  if (bad.length > 0) out.push('ELK returned invalid coordinates or size for ' + bad.length + ' item(s): ' + listSome(bad.map(p => '"' + firstLine(p.node) + '"')) + '.');

  const spills: string[] = [];
  for (const p of placed) {
    const parent = p.node.parentId ? byId.get(p.node.parentId) : undefined;
    if (!parent) continue;
    const o = outerBox(p);
    const top = parent.y + headerHeight(parent.node.label, parent.w);
    if (o.x < parent.x - 1 || o.y < top - 1 || o.x + o.w > parent.x + parent.w + 1 || o.y + o.h > parent.y + parent.h + 1) {
      spills.push('"' + firstLine(p.node) + '" in "' + firstLine(parent.node) + '"');
    }
  }
  if (spills.length > 0) out.push(spills.length + ' shape(s) spill outside their container or under its title: ' + listSome(spills) + '.');

  const narrow = placed.filter(p => parents.has(p.node.id) && p.w < headerMinWidth(p.node.label) - 2);
  if (narrow.length > 0) out.push('Container title may be cut off (ELK ignored the minimum width): ' + listSome(narrow.map(p => '"' + firstLine(p.node) + '"')) + '.');

  const groups = new Map<string | null, Placed[]>();
  for (const p of placed) {
    const list = groups.get(p.node.parentId) || [];
    list.push(p);
    groups.set(p.node.parentId, list);
  }
  const overlaps: string[] = [];
  groups.forEach(list => {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const r1 = outerBox(list[i]);
        const r2 = outerBox(list[j]);
        if (r1.x + 1 < r2.x + r2.w && r2.x + 1 < r1.x + r1.w && r1.y + 1 < r2.y + r2.h && r2.y + 1 < r1.y + r1.h) {
          overlaps.push('"' + firstLine(list[i].node) + '" / "' + firstLine(list[j].node) + '"');
        }
      }
    }
  });
  if (overlaps.length > 0) out.push(overlaps.length + ' overlapping shape pair(s): ' + listSome(overlaps) + '.');

  const W = Math.round(layout?.width || 0);
  const H = Math.round(layout?.height || 0);
  if (W > 5000 || H > 4000) out.push('Layout is ' + W + 'x' + H + ' px, far larger than a slide; consider fewer items or shorter labels.');
  return out;
}

// Liang-Barsky clip test.
function segmentHitsRect(x1: number, y1: number, x2: number, y2: number, r: Box): boolean {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const p = [-dx, dx, -dy, dy];
  const q = [x1 - r.x, r.x + r.w - x1, y1 - r.y, r.y + r.h - y1];
  let t0 = 0;
  let t1 = 1;
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return false;
      continue;
    }
    const t = q[i] / p[i];
    if (p[i] < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
  }
  return true;
}

interface Pt {
  x: number;
  y: number;
}

function collectRoutes(elkNode: any, out: Map<string, Pt[]>): void {
  for (const e of elkNode.edges || []) {
    const s = e.sections && e.sections[0];
    if (!s || !s.startPoint || !s.endPoint) continue;
    const pts: Pt[] = [s.startPoint].concat(s.bendPoints || [], [s.endPoint]).map((q: any) => ({ x: q.x, y: q.y }));
    if (pts.every(q => isFinite(q.x) && isFinite(q.y))) out.set(e.id, pts);
  }
  for (const c of elkNode.children || []) collectRoutes(c, out);
}

function distanceToBox(pt: Pt, p: Placed): number {
  const dx = Math.max(p.x - pt.x, 0, pt.x - (p.x + p.w));
  const dy = Math.max(p.y - pt.y, 0, pt.y - (p.y + p.h));
  return Math.sqrt(dx * dx + dy * dy);
}

// Fills routes with ELK's edge paths (root coordinates) that really start and end on their shapes.
function usableRoutes(diagram: Diagram, placed: Placed[], layout: any, routes: Map<string, Pt[]>): string[] {
  const all = new Map<string, Pt[]>();
  collectRoutes(layout, all);
  const byId = new Map(placed.map(p => [p.node.id, p] as [string, Placed]));
  const nodeById = new Map(diagram.nodes.map(n => [n.id, n] as [string, GraphNode]));
  const nameOf = (e: GraphEdge) => '"' + (nodeById.has(e.sourceId) ? firstLine(nodeById.get(e.sourceId) as GraphNode) : e.sourceId) + '" -> "' + (nodeById.has(e.targetId) ? firstLine(nodeById.get(e.targetId) as GraphNode) : e.targetId) + '"';
  const missing: string[] = [];
  const misplaced: string[] = [];
  for (const e of diagram.edges) {
    const a = byId.get(e.sourceId);
    const b = byId.get(e.targetId);
    const raw = all.get(e.id);
    if (!raw || !a || !b) {
      missing.push(nameOf(e));
      continue;
    }
    const pts = raw.filter((q, i) => i === 0 || Math.abs(q.x - raw[i - 1].x) + Math.abs(q.y - raw[i - 1].y) > 0.5);
    if (pts.length < 2 || distanceToBox(pts[0], a) > 8 || distanceToBox(pts[pts.length - 1], b) > 8) {
      misplaced.push(nameOf(e));
      continue;
    }
    routes.set(e.id, pts);
  }
  const out: string[] = [];
  if (missing.length > 0) out.push(missing.length + ' connector(s) have no ELK route and use Lucid routing instead: ' + listSome(missing) + '.');
  if (misplaced.length > 0) out.push(misplaced.length + ' ELK route(s) do not start/end on their shapes (edge coordinate mismatch) and use Lucid routing instead: ' + listSome(misplaced) + '.');
  return out;
}

// Checks the path each connector will take (ELK route, or a direct line when there is none) against unrelated shapes.
function checkConnectorPaths(diagram: Diagram, placed: Placed[], routes: Map<string, Pt[]>): string[] {
  const byId = new Map(placed.map(p => [p.node.id, p] as [string, Placed]));
  const ancestors = (id: string): string[] => {
    const seen: string[] = [];
    let cur = byId.get(id)?.node.parentId ?? null;
    while (cur && seen.indexOf(cur) < 0) {
      seen.push(cur);
      cur = byId.get(cur)?.node.parentId ?? null;
    }
    return seen;
  };
  const hits: string[] = [];
  for (const e of diagram.edges) {
    const a = byId.get(e.sourceId);
    const b = byId.get(e.targetId);
    if (!a || !b) continue;
    let pts = routes.get(e.id);
    if (!pts) {
      const links = facingLinks(a, b);
      pts = [{ x: a.x + a.w * links.from.x, y: a.y + a.h * links.from.y }, { x: b.x + b.w * links.to.x, y: b.y + b.h * links.to.y }];
    }
    const skip = new Set<string>([a.node.id, b.node.id].concat(ancestors(a.node.id), ancestors(b.node.id)));
    let crossed: Placed | null = null;
    for (const p of placed) {
      if (skip.has(p.node.id) || crossed) continue;
      const r = { x: p.x + 2, y: p.y + 2, w: p.w - 4, h: p.h - 4 };
      if (r.w <= 0 || r.h <= 0) continue;
      for (let i = 0; i < pts.length - 1; i++) {
        if (segmentHitsRect(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y, r)) {
          crossed = p;
          break;
        }
      }
    }
    if (crossed) hits.push('"' + firstLine(a.node) + '" -> "' + firstLine(b.node) + '" crosses "' + firstLine(crossed.node) + '"');
  }
  if (hits.length === 0) return [];
  return [hits.length + ' connector(s) cross other shapes: ' + listSome(hits) + '.'];
}
interface LayoutResult {
  layout: any;
  failure: string | null;
  mode: 'elk' | 'elk-simple' | 'grid';
}

// failure is set when ELK could not lay the diagram out as requested.
async function computeLayout(diagram: Diagram, tag: string): Promise<LayoutResult> {
  const opts = rootLayoutOptions(diagram);
  const summary = 'algorithm=' + opts['elk.algorithm'] + ', nodes=' + diagram.nodes.length + ', edges=' + diagram.edges.length;
  let started = Date.now();
  let firstError = '';
  try {
    const layout = await elk.layout(buildElkGraph(diagram));
    console.info(tag + ' ELK layout ok in ' + (Date.now() - started) + ' ms (' + summary + '), canvas ' + Math.round(layout.width || 0) + 'x' + Math.round(layout.height || 0));
    return { layout, failure: null, mode: 'elk' };
  } catch (err) {
    firstError = shortError(err);
    console.error(tag + ' ELK layout failed after ' + (Date.now() - started) + ' ms (' + summary + '): ' + describeError(err));
  }
  let retryError = '';
  started = Date.now();
  try {
    const graph = buildElkGraph(diagram);
    graph.layoutOptions = { 'elk.algorithm': 'layered', 'elk.direction': 'RIGHT', 'elk.json.edgeCoords': 'ROOT' };
    const layout = await elk.layout(graph);
    console.info(tag + ' ELK simple retry ok in ' + (Date.now() - started) + ' ms');
    return { layout, failure: 'ELK full layout failed (' + firstError + '); a simplified layout was used instead.', mode: 'elk-simple' };
  } catch (err) {
    retryError = shortError(err);
    console.error(tag + ' ELK simple retry failed; using grid layout: ' + describeError(err));
  }
  return {
    layout: gridLayout(diagram),
    failure: 'ELK failed, so a flat grid with no nesting was used. Full layout: ' + firstError + ' | Simple retry: ' + retryError,
    mode: 'grid'
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
    note.properties.set('LineColor', RED);
    note.properties.set('LineWidth', 3);
  });
}
// Key box to the right of the diagram, listing only the roles that appear on the page.
function drawLegend(page: PageProxy, placed: Placed[], roles: Map<string, string>, ctx: DrawContext): void {
  if (placed.length === 0) return;
  const right = Math.max(...placed.map(p => {
    const o = outerBox(p);
    return o.x + o.w;
  }));
  const x = right + CANVAS_MARGIN + 100;
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
  if (placed.length < diagram.nodes.length) {
    const missing = diagram.nodes.filter(n => !placed.some(p => p.node.id === n.id)).map(n => '"' + firstLine(n) + '"');
    issues.push('Layout positioned ' + placed.length + ' of ' + diagram.nodes.length + ' items; missing ' + listSome(missing) + '.');
  }
  const routes = new Map<string, Pt[]>();
  if (mode !== 'grid') {
    issues.push(...checkGeometry(placed, layout));
    issues.push(...usableRoutes(diagram, placed, layout, routes));
    issues.push(...checkConnectorPaths(diagram, placed, routes));
  }

  const parents = new Set(diagram.nodes.map(n => n.parentId).filter(id => id !== null) as string[]);
  const roles = new Map<string, string>();
  const badgeFor = new Map<string, string>();
  const wanted = new Set<string>([FALLBACK_CLASS]);
  const unmapped: string[] = [];
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
      } else if (looksLikeGcp(p.node)) {
        unmapped.push('"' + firstLine(p.node) + '" (technology "' + toolName(p.node) + '")');
      }
    }
  }
  if (unmapped.length > 0) {
    console.info(tag + ' ' + unmapped.length + ' GCP tool(s) have no GCP 2021 icon mapping and are drawn without an icon (add to GCP_CLASS_MAP): ' + unmapped.join(', '));
  }

  const available = await stage(tag, 'load-classes', () => loadClasses(Array.from(wanted)));
  const ctx: DrawContext = {
    issues,
    unavailable: new Set(Array.from(wanted).filter(c => !available.has(c))),
    substitutions: new Map<string, number>(),
    fillMismatches: []
  };
  const failedBadges = Array.from(new Set(Array.from(badgeFor.values()))).filter(c => !available.has(c));
  if (failedBadges.length > 0) {
    issues.push('GCP 2021 icon class(es) failed to load, so those icons are missing: ' + listSome(failedBadges) + '.');
  }

  const blocks = new Map<string, BlockProxy>();
  let blocksSkipped = 0;
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
        drawShape(page, { classes: RECT_CLASSES, box: titleBox, fill: TRANSPARENT, line: TRANSPARENT, lineWidth: 0, text: p.node.label, bold: true }, swatch.legend + ' title "' + name + '"', ctx);
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

      if (block) {
        blocks.set(p.node.id, block);
      } else {
        blocksSkipped++;
      }
    }
  });

  let linesCreated = 0;
  let linesSkipped = 0;
  const placedById = new Map(placed.map(p => [p.node.id, p] as [string, Placed]));
  await stage(tag, 'create-lines', () => {
    for (const edge of diagram.edges) {
      const source = blocks.get(edge.sourceId);
      const target = blocks.get(edge.targetId);
      const a = placedById.get(edge.sourceId);
      const b = placedById.get(edge.targetId);
      if (source && target && a && b && createEdge(page, source, target, edge, a, b, routes.get(edge.id), issues)) {
        linesCreated++;
      } else {
        linesSkipped++;
        issues.push('Connector "' + (nodeById.get(edge.sourceId)?.label || edge.sourceId) + '" -> "' + (nodeById.get(edge.targetId)?.label || edge.targetId) + '" was not drawn.');
      }
    }
  });

  await stage(tag, 'legend', () => drawLegend(page, placed, roles, ctx));

  ctx.substitutions.forEach((count, key) => {
    issues.push(count + ' shape(s) wanted class ' + key.replace(' -> ', ' but were drawn as ') + ', so they will not match the reference key.');
  });
  if (ctx.fillMismatches.length > 0) {
    issues.push(ctx.fillMismatches.length + ' shape(s) did not take their key colour: ' + listSome(ctx.fillMismatches) + '.');
  }

  if (issues.length > 0) addIssuesNote(page, issues);

  console.info(
    tag + ' done (layout ' + mode + '): blocks ' + blocks.size + ' created/' + blocksSkipped + ' skipped, lines ' +
    linesCreated + ' created/' + linesSkipped + ' skipped, issues ' + issues.length +
    (ctx.unavailable.size > 0 ? ', unavailable classes ' + Array.from(ctx.unavailable).join(', ') : '')
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
