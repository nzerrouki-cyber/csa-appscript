// Converts the pasted CSA payload into the layout-free graph contract consumed by the
// csa-elk-renderer extension. Contains no Apps Script service calls so it can be tested directly.

const BOOTSTRAP_SCHEMA_VERSION = 2;

const SLIDE_ARCHETYPES = { 6: 'CONTEXT', 7: 'DECOMPOSITION', 8: 'DECOMPOSITION', 9: 'DECOMPOSITION', 10: 'DEPLOYMENT', 11: 'INFO_FLOW' };
const SLIDE_SHORT_TITLES = { 6: 'System Context', 7: 'Current State', 8: 'Interim State', 9: 'Target State', 10: 'System Deployment', 11: 'Information Flow' };

function buildBootstrapPayload(raw) {
  const root = raw && raw.csa_lucidchart_payload ? raw.csa_lucidchart_payload : raw;
  const diagrams = root && root.diagrams;
  if (!Array.isArray(diagrams) || diagrams.length === 0) {
    throw new Error('Payload must contain a non-empty "csa_lucidchart_payload.diagrams" array.');
  }

  const metadata = root.metadata || {};
  const errors = [];
  const normalized = diagrams.map((diagram, index) => normalizeDiagram(diagram, index, errors));

  if (errors.length > 0) {
    throw new Error('Invalid payload:\n- ' + errors.join('\n- '));
  }

  return {
    schemaVersion: BOOTSTRAP_SCHEMA_VERSION,
    title: metadata.project_title ? 'CSA - ' + metadata.project_title : 'CSA - Initiative Architecture',
    diagrams: normalized
  };
}

function normalizeDiagram(diagram, index, errors) {
  const slideNumber = Number(diagram.slide_number);
  const hasSlide = Number.isFinite(slideNumber);
  const ctx = hasSlide ? 'Slide ' + slideNumber : 'Diagram ' + (index + 1);
  const shortTitle = (hasSlide && SLIDE_SHORT_TITLES[slideNumber]) || diagram.title || ('Diagram ' + (index + 1));
  const pageTitle = hasSlide ? 'Slide ' + slideNumber + ': ' + shortTitle : shortTitle;

  const nodes = [];
  const ids = new Set();
  const labelToId = new Map();

  const addNode = (item, isContainer) => {
    if (item.id === undefined || item.id === null || item.id === '') {
      errors.push(ctx + ': an item is missing "id".');
      return;
    }
    const id = String(item.id);
    if (ids.has(id)) {
      errors.push(ctx + ': duplicate id "' + id + '".');
      return;
    }
    const label = String(item.label || item.name || id);
    ids.add(id);
    if (!labelToId.has(label)) labelToId.set(label, id);

    nodes.push({
      id: id,
      label: label,
      kind: isContainer ? String(item.type || 'container').toLowerCase() : 'tool',
      isContainer: isContainer,
      parentId: item.parent_container ? String(item.parent_container) : null,
      technology: isContainer ? null : String(item.Technology || item.technology || item.name || item.label || '') || null,
      category: isContainer ? '' : String(item.type || '').toLowerCase(),
      deltaFlag: isContainer ? '' : String(item.delta_flag || 'Neutral'),
      isSoR: !isContainer && item.is_sor === true,
      isCore: !isContainer && item.isCore === true
    });
  };

  (diagram.containers || []).forEach(c => addNode(c, true));
  (diagram.nodes || []).forEach(n => addNode(n, false));

  const parentById = new Map(nodes.map(n => [n.id, n.parentId]));
  nodes.forEach(n => {
    if (n.parentId && !ids.has(n.parentId)) {
      errors.push(ctx + ': "' + n.id + '" references unknown parent "' + n.parentId + '".');
    }
  });
  nodes.forEach(n => {
    let cursor = n.parentId;
    for (let depth = 0; cursor && depth <= nodes.length; depth++) {
      if (cursor === n.id) {
        errors.push(ctx + ': parent cycle detected at "' + n.id + '".');
        break;
      }
      cursor = parentById.get(cursor) || null;
    }
  });

  const resolveRef = ref => {
    const key = String(ref);
    if (ids.has(key)) return key;
    return labelToId.get(key) || null;
  };

  const edgeMap = new Map();
  (diagram.connectors || []).forEach((c, i) => {
    const sourceId = resolveRef(c.source);
    const targetId = resolveRef(c.target);
    if (!sourceId || !targetId) {
      errors.push(ctx + ': connector #' + (i + 1) + ' ("' + c.source + '" -> "' + c.target + '") references an unknown node.');
      return;
    }

    const pairKey = sourceId < targetId ? sourceId + '||' + targetId : targetId + '||' + sourceId;
    const existing = edgeMap.get(pairKey);
    const bidirectionalFlag = c.type === 'bidirectional';
    const step = Number(c.stepNumber);
    const hasStep = c.stepNumber !== undefined && c.stepNumber !== null && c.stepNumber !== '' && Number.isFinite(step);

    if (!existing) {
      edgeMap.set(pairKey, {
        id: sourceId + '__' + targetId,
        sourceId: sourceId,
        targetId: targetId,
        labels: c.label ? [String(c.label)] : [],
        bidirectional: bidirectionalFlag,
        stepNumbers: hasStep ? [step] : []
      });
    } else {
      if (c.label && existing.labels.indexOf(String(c.label)) === -1) existing.labels.push(String(c.label));
      if (existing.sourceId !== sourceId || bidirectionalFlag) existing.bidirectional = true;
      if (hasStep && existing.stepNumbers.indexOf(step) === -1) existing.stepNumbers.push(step);
    }
  });

  const edges = Array.from(edgeMap.values()).map(e => ({
    id: e.id,
    sourceId: e.sourceId,
    targetId: e.targetId,
    label: e.labels.join('\n'),
    bidirectional: e.bidirectional,
    stepNumbers: e.stepNumbers
  }));

  return {
    key: hasSlide ? 'slide_' + slideNumber : 'diagram_' + (index + 1),
    pageTitle: pageTitle,
    archetype: (hasSlide && SLIDE_ARCHETYPES[slideNumber]) || 'GENERIC',
    nodes: nodes,
    edges: edges
  };
}
