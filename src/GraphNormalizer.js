// GraphNormalizer.js - Production Enterprise Version
const BOOTSTRAP_SCHEMA_VERSION = 2;

const SLIDE_ARCHETYPES = {
  6: 'CONTEXT',
  7: 'DECOMPOSITION',
  8: 'DECOMPOSITION',
  9: 'DECOMPOSITION',
  10: 'DEPLOYMENT',
  11: 'INFO_FLOW'
};

const SLIDE_SHORT_TITLES = {
  6: 'System Context',
  7: 'Current State',
  8: 'Interim State',
  9: 'Target State',
  10: 'System Deployment',
  11: 'Information Flow'
};

function wrapLabel(text, maxChars = 25) {
  if (!text) return '';
  const lines = String(text).split('\n');
  const wrapped = [];

  for (const line of lines) {
    if (line.length <= maxChars) {
      wrapped.push(line);
      continue;
    }
    const words = line.split(' ');
    let currentLine = '';
    for (const word of words) {
      if ((currentLine + ' ' + word).trim().length <= maxChars) {
        currentLine = (currentLine + ' ' + word).trim();
      } else {
        if (currentLine) wrapped.push(currentLine);
        currentLine = word;
      }
    }
    if (currentLine) wrapped.push(currentLine);
  }
  return wrapped.join('\n');
}

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
  const archetype = (hasSlide && SLIDE_ARCHETYPES[slideNumber]) || 'GENERIC';

  const nodes = [];
  const ids = new Set();
  const labelToId = new Map();
  const labelToIdFuzzy = new Map();

  // Aggressive String Normalizer for fuzzy matching
  const normalizeString = (str) => String(str || '').toLowerCase().replace(/[^a-z0-9]/g, '');

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

    const rawLabel = String(item.label || item.name || id);
    const rawKind = isContainer ? String(item.type || 'container').toLowerCase().replace(/[\s-]+/g, '_') : 'tool';
    const deltaFlag = isContainer ? '' : String(item.delta_flag || item.deltaFlag || 'Neutral');

    // Strict Slide 9 Omission Rule (Silently drop retired legacy components)
    if (slideNumber === 9 && deltaFlag.toLowerCase() === 'retiring') {
      errors.push(ctx + ': Omitted "' + id + '" (Retired tools are strictly prohibited on Slide 9).');
      return; 
    }

    ids.add(id);

    if (!labelToId.has(rawLabel)) labelToId.set(rawLabel, id);
    labelToIdFuzzy.set(normalizeString(rawLabel), id);
    labelToIdFuzzy.set(normalizeString(id), id);

    const isSoR = !isContainer && (item.is_sor === true || item.isSoR === true);
    const isCore = !isContainer && (item.isCore === true || item.is_core === true);

    // Apply label wrapping to prevent container text blowout
    let label = isContainer ? wrapLabel(rawLabel, 28) : wrapLabel(rawLabel, 24);
    if (isSoR && !/\(SoR\)$/i.test(label.trim())) {
      label = label ? label + '\n(SoR)' : '(SoR)';
    }
    
    if (!labelToId.has(label)) labelToId.set(label, id);
    labelToIdFuzzy.set(normalizeString(label), id);

    const parentContainer = item.parent_container || item.parentContainer || item.parentId || item.parent || null;

    nodes.push({
      id: id,
      label: label,
      kind: rawKind,
      isContainer: isContainer,
      parentId: parentContainer ? String(parentContainer) : null,
      technology: isContainer ? null : String(item.Technology || item.technology || item.name || item.label || '') || null,
      category: isContainer ? '' : String(item.type || item.category || 'internal').toLowerCase(),
      deltaFlag: deltaFlag,
      isSoR: isSoR,
      isCore: isCore,
      quadrant: item.quadrant || null // Layout hint for Slide 10
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

  const resolveRef = ref => {
    const key = String(ref);
    if (ids.has(key)) return key; // Direct ID match
    if (labelToId.has(key)) return labelToId.get(key); // Exact label match
    
    // Fallback: Aggressive fuzzy match
    const fuzzyKey = normalizeString(key);
    return labelToIdFuzzy.get(fuzzyKey) || null;
  };

  // Slide 10: Zero-Line Mandate
  if (archetype === 'DEPLOYMENT') {
    return {
      key: hasSlide ? 'slide_' + slideNumber : 'diagram_' + (index + 1),
      pageTitle: pageTitle,
      archetype: archetype,
      nodes: nodes,
      edges: []
    };
  }

  // Hardened Edge Grouping Logic
  const edgeGroups = new Map();
  
  (diagram.connectors || []).forEach((c, i) => {
    const sourceId = resolveRef(c.source);
    const targetId = resolveRef(c.target);
    
    if (!sourceId || !targetId) {
      errors.push(ctx + ': connector references an unknown node. Source: "' + c.source + '", Target: "' + c.target + '".');
      return;
    }

    // Determine edge type
    let stepNum = Number(c.stepNumber !== undefined && c.stepNumber !== null ? c.stepNumber : c.step_number);
    if (!Number.isFinite(stepNum) && c.label) {
      const stepMatch = /^\s*step\s+(\d+)/i.exec(String(c.label));
      if (stepMatch) stepNum = Number(stepMatch[1]);
    }
    const hasStep = Number.isFinite(stepNum);
    const isInstanceEdge = c.type === 'instance' || /^\s*instance\s*$/i.test(String(c.label || ''));
    
    // Create an immutable pair key that ignores directionality where applicable
    let pairKey;
    if (archetype === 'INFO_FLOW') {
      pairKey = `infoflow::${sourceId}::${targetId}::${hasStep ? stepNum : i}`;
    } else if (isInstanceEdge) {
      pairKey = `instance::${sourceId}::${targetId}`;
    } else {
      const sortedPair = [sourceId, targetId].sort();
      pairKey = `runtime::${sortedPair[0]}::${sortedPair[1]}`;
    }
    
    if (!edgeGroups.has(pairKey)) {
      edgeGroups.set(pairKey, {
        id: c.id || (sourceId + '__' + targetId),
        sourceId: sourceId,
        targetId: targetId,
        labels: [],
        bidirectional: false,
        type: isInstanceEdge ? 'instance' : (c.type || 'directed'),
        stepNumbers: []
      });
    }
    
    const group = edgeGroups.get(pairKey);
    
    // Automatically flag bidirectional if traffic flows both ways or is explicitly set
    if (group.sourceId !== sourceId || c.bidirectional === true || c.type === 'bidirectional') {
      group.bidirectional = true;
    }

    if (c.label) {
      const wrapped = wrapLabel(c.label, 25);
      // Only push the label if it's not an exact duplicate
      if (!group.labels.includes(wrapped)) {
        group.labels.push(wrapped);
      }
    }
    if (hasStep) group.stepNumbers.push(stepNum);
  });

  const edges = Array.from(edgeGroups.values()).map(g => ({
    ...g,
    // Collapse all distinct interactions into a single malleable arrow with a combined label
    label: g.labels.join('\n---\n') 
  }));

  if (archetype === 'INFO_FLOW') {
    edges.sort((a, b) => (a.stepNumbers[0] || 0) - (b.stepNumbers[0] || 0));
  }

  return {
    key: hasSlide ? 'slide_' + slideNumber : 'diagram_' + (index + 1),
    pageTitle: pageTitle,
    archetype: archetype,
    nodes: nodes,
    edges: edges
  };
}