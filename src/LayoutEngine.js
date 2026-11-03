// ============================================================================
// REFACTORED LAYOUT ENGINE: DETERMINISTIC SPATIAL HASHING & DYNAMIC SCALING
// ============================================================================

const SIZE_CONFIG = {
  CHAR_UPPER_PX: 9, CHAR_LOWER_PX: 7, CHAR_SYMBOL_PX: 6, LINE_HEIGHT: 18,
  NODE_WIDTH: 120, NODE_BASE_HEIGHT: 120,
  CONTAINER_PADDING: 40, MIN_CAP_WIDTH: 250, MIN_CAP_HEIGHT: 100,
  EDGE_STAGGER_PITCH: 15 
};

function parseAndDeduplicateGraph(rawData) {
  const { nodes = [], containers = [], edges = [] } = rawData;
  const deduplicatedEdgesMap = new Map();

  edges.forEach(edge => {
    const [node1, node2] = [edge.sourceId, edge.targetId].sort();
    const pairKey = `${node1}_${node2}`;

    // Replace the id assignment inside parseAndDeduplicateGraph:
    if (!deduplicatedEdgesMap.has(pairKey)) {
        deduplicatedEdgesMap.set(pairKey, {
            id: Utilities.getUuid(),
            sourceId: edge.sourceId,
            targetId: edge.targetId,
            labels: [edge.label],
            type: "directional",
            overlapIndex: 0 
        });
    } else {
      const existingEdge = deduplicatedEdgesMap.get(pairKey);
      if (edge.label && !existingEdge.labels.includes(edge.label)) existingEdge.labels.push(edge.label);
      if (existingEdge.sourceId !== edge.sourceId) existingEdge.type = "bidirectional";
    }
  });

  const deduplicatedEdges = Array.from(deduplicatedEdgesMap.values()).map(edge => ({
    id: edge.id,
    endpoint1: { type: "shape", shapeId: edge.sourceId },
    endpoint2: { type: "shape", shapeId: edge.targetId },
    text: edge.labels.join(" \\n "), 
    style: edge.type === "bidirectional" ? { endpoint2: "arrow", endpoint1: "arrow" } : { endpoint2: "arrow" }
  }));

  return { nodes, containers, edges: deduplicatedEdges, edgeMap: deduplicatedEdgesMap };
}

function applyArchetypeLayout(slideArchetype, graph) {
  switch (slideArchetype) {
    case 'CONTEXT': return layoutRadialContext(graph);
    case 'DECOMPOSITION': return layoutDecompositionGrid(graph);
    case 'DEPLOYMENT': return layoutSpatialDeployment(graph);
    case 'INFO_FLOW': return layoutChronologicalPipeline(graph);
    default: throw new Error(`Unsupported slide archetype: ${slideArchetype}`);
  }
}

function layoutRadialContext(graph) {
  const { nodes, edges } = graph;
  const layout = [];
  const coreNode = nodes.find(n => n.isCore);
  
  if (coreNode) {
    coreNode.boundingBox = { x: 800, y: 800, w: SIZE_CONFIG.NODE_WIDTH, h: SIZE_CONFIG.NODE_BASE_HEIGHT };
    layout.push(coreNode);
  }

  const peripherals = nodes.filter(n => !n.isCore);
  const requiredCircumference = peripherals.length * (SIZE_CONFIG.NODE_WIDTH * 1.5);
  const radius = Math.max(350, requiredCircumference / (2 * Math.PI));
  const angleStep = (2 * Math.PI) / (peripherals.length || 1);

  peripherals.forEach((node, index) => {
    const angle = index * angleStep;
    node.boundingBox = {
      x: 800 + (radius * Math.cos(angle)),
      y: 800 + (radius * Math.sin(angle)),
      w: SIZE_CONFIG.NODE_WIDTH,
      h: SIZE_CONFIG.NODE_BASE_HEIGHT
    };
    layout.push(node);
  });

  return layout.concat(edges);
}

function layoutDecompositionGrid(graph) {
  const { nodes = [], containers = [], edges = [] } = graph;
  let layout = [];
  
  // Track 1 (Left): Enterprise Systems & Business Capabilities
  const sysStartX = 100;
  const capabilities = containers.filter(c => c.type === 'CAPABILITY');
  const systems = containers.filter(c => c.type === 'SYSTEM');
  const systemLayout = computeDecompositionContainment(systems, capabilities, sysStartX, 100);
  layout.push(...systemLayout);

  // Track 2 (Center): Internal Standalone Tools (Root canvas level)
  const internalTools = nodes.filter(n => n.type === 'INTERNAL');
  const track2StartX = sysStartX + 600; // Force distinct vertical corridor
  const positionedInternal = applyDynamicGridLayout(internalTools, { 
    startX: track2StartX, 
    startY: 100, 
    maxWidth: track2StartX + 600 
  });
  layout.push(...positionedInternal);

  // Track 3 (Right): External SaaS Perimeter
  const externalTools = nodes.filter(n => n.type === 'EXTERNAL');
  const track3StartX = track2StartX + 700;
  const positionedExternal = applyDynamicGridLayout(externalTools, { 
    startX: track3StartX, 
    startY: 100, 
    maxWidth: track3StartX + 400 
  });
  
  if (positionedExternal.length > 0) {
    const extBounds = calculateWrapperBounds(positionedExternal, SIZE_CONFIG.CONTAINER_PADDING);
    
    // Dynamically retrieve the slide-specific perimeter container ID (e.g., ext_s7_perimeter)
    const perimeterDef = containers.find(c => c.type === 'PERIMETER');
    const extContainerId = perimeterDef 
      ? perimeterDef.id 
      : `ext_perimeter_${Utilities.getUuid().substring(0, 8)}`;
    const extContainerText = perimeterDef 
      ? perimeterDef.text 
      : "External Tools & Third-Party SaaS";
    
    const extContainer = {
      id: extContainerId, 
      type: "CONTAINER", 
      text: extContainerText, 
      boundingBox: extBounds
    };
    
    layout.push(extContainer, ...positionedExternal);
  }
  
  // Staggered Edge Routing Generation across all positioned shapes
  const allShapes = [...systemLayout, ...positionedInternal, ...positionedExternal];
  const routedEdges = routeStaggeredEdges(edges, allShapes);
  return layout.concat(routedEdges);
}

function layoutSpatialDeployment(graph) {
  const { nodes, containers } = graph;
  return computeDeploymentContainment(
    containers.filter(c => c.type === 'MACRO_ENV'), 
    containers.filter(c => c.type === 'LOCATION'), 
    nodes, 
    100, 100
  );
}

function layoutChronologicalPipeline(graph) {
  const { nodes, edges } = graph;
  const layout = [];
  let currentX = 100;
  const sortedNodes = topologicalSort(nodes, edges);

  sortedNodes.forEach(node => {
    if (node.isSoR) {
      node.shape = "Cylinder";
      node.text = `${node.text} \\n (SoR)`;
    }
    
    const dynamicStepX = Math.max(250, estimateTextWidth(node.text) + 100);
    node.boundingBox = { x: currentX, y: 300, w: SIZE_CONFIG.NODE_WIDTH, h: Math.max(SIZE_CONFIG.NODE_BASE_HEIGHT, calculateToolNodeSize(node.text).h) };
    
    layout.push(node);
    currentX += dynamicStepX;
  });

  const routedEdges = routeStaggeredEdges(edges, layout);
  return layout.concat(routedEdges);
}

function routeStaggeredEdges(edges, layoutShapes) {
  const shapeMap = new Map(layoutShapes.map(s => [s.id, s]));
  const collisionMatrix = new Map(); 

  return edges.map(edge => {
    // If endpoint paths aren't defined properly, try to grab them from sourceId/targetId
    const e1 = edge.endpoint1 ? edge.endpoint1.shapeId : edge.sourceId;
    const e2 = edge.endpoint2 ? edge.endpoint2.shapeId : edge.targetId;
    
    const s = shapeMap.get(e1)?.boundingBox;
    const t = shapeMap.get(e2)?.boundingBox;
    
    if (!s || !t) return edge;

    const isLeftToRight = s.x < t.x;
    const startX = isLeftToRight ? s.x + s.w : s.x;
    const endX = isLeftToRight ? t.x : t.x + t.w;
    
    const gapKey = `gap_${Math.floor(Math.min(startX, endX))}_${Math.floor(Math.max(startX, endX))}`;
    const overlapCount = collisionMatrix.get(gapKey) || 0;
    collisionMatrix.set(gapKey, overlapCount + 1);

    const gapSize = 80 + (overlapCount * SIZE_CONFIG.EDGE_STAGGER_PITCH);
    const channelX = isLeftToRight ? startX + (gapSize / 2) : startX - (gapSize / 2);

    edge.linePath = {
      points: [
        { x: channelX, y: s.y + (s.h / 2) },
        { x: channelX, y: t.y + (t.h / 2) }
      ]
    };
    return edge;
  });
}

// ============================================================================
// SPATIAL LAYOUT & SIZING HELPERS
// ============================================================================

function applyDynamicGridLayout(nodes, config) {
  const { startX, startY, maxWidth } = config;
  let currentX = startX;
  let currentY = startY;
  const layout = [];

  nodes.forEach(node => {
    if (currentX + SIZE_CONFIG.NODE_WIDTH > maxWidth) {
      currentX = startX;
      currentY += SIZE_CONFIG.NODE_BASE_HEIGHT + SIZE_CONFIG.CONTAINER_PADDING;
    }
    node.boundingBox = { x: currentX, y: currentY, w: SIZE_CONFIG.NODE_WIDTH, h: SIZE_CONFIG.NODE_BASE_HEIGHT };
    layout.push(node);
    currentX += SIZE_CONFIG.NODE_WIDTH + 40;
  });

  return layout;
}

function calculateWrapperBounds(shapes, padding) {
  if (!shapes || shapes.length === 0) return { x: 0, y: 0, w: 200, h: 200 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  shapes.forEach(s => {
    if (s.boundingBox.x < minX) minX = s.boundingBox.x;
    if (s.boundingBox.y < minY) minY = s.boundingBox.y;
    if (s.boundingBox.x + s.boundingBox.w > maxX) maxX = s.boundingBox.x + s.boundingBox.w;
    if (s.boundingBox.y + s.boundingBox.h > maxY) maxY = s.boundingBox.y + s.boundingBox.h;
  });

  return {
    x: minX - padding,
    y: minY - padding,
    w: (maxX - minX) + (padding * 2),
    h: (maxY - minY) + (padding * 2)
  };
}

function computeDecompositionContainment(systems, capabilities, startX, startY) {
  const layout = [];
  let currentY = startY;

  systems.forEach(sys => {
    const sysCaps = capabilities.filter(c => c.parentId === sys.id);
    let capY = currentY + SIZE_CONFIG.CONTAINER_PADDING;
    const sysLayout = [];

    sysCaps.forEach(cap => {
      cap.boundingBox = { x: startX + SIZE_CONFIG.CONTAINER_PADDING, y: capY, w: SIZE_CONFIG.MIN_CAP_WIDTH, h: Math.max(SIZE_CONFIG.MIN_CAP_HEIGHT, estimateTextWidth(cap.text) / 2) };
      sysLayout.push(cap);
      capY += cap.boundingBox.h + 20;
    });

    const sysBounds = calculateWrapperBounds(sysLayout, SIZE_CONFIG.CONTAINER_PADDING);
    sys.boundingBox = { x: startX, y: currentY, w: Math.max(sysBounds.w, 350), h: sysBounds.h + 40 };
    
    layout.push(sys, ...sysLayout);
    currentY += sys.boundingBox.h + 40;
  });

  return layout;
}

function computeDeploymentContainment(macros, locations, nodes, startX, startY) {
  const layout = [];
  let currentMacroY = startY;

  macros.forEach(macro => {
    const childLocs = locations.filter(l => l.parentId === macro.id);
    let currentLocX = startX + SIZE_CONFIG.CONTAINER_PADDING;
    const macroLayout = [];

    childLocs.forEach(loc => {
      const locNodes = nodes.filter(n => n.parentContainer === loc.id);
      const positionedNodes = applyDynamicGridLayout(locNodes, { startX: currentLocX + SIZE_CONFIG.CONTAINER_PADDING, startY: currentMacroY + 80, maxWidth: currentLocX + 400 });
      
      const locBounds = calculateWrapperBounds(positionedNodes, SIZE_CONFIG.CONTAINER_PADDING);
      loc.boundingBox = { x: currentLocX, y: currentMacroY + 40, w: Math.max(locBounds.w, 250), h: Math.max(locBounds.h, 150) };
      
      macroLayout.push(loc, ...positionedNodes);
      currentLocX += loc.boundingBox.w + 40;
    });

    const macroBounds = calculateWrapperBounds(macroLayout, SIZE_CONFIG.CONTAINER_PADDING);
    macro.boundingBox = { x: startX, y: currentMacroY, w: Math.max(macroBounds.w, 600), h: macroBounds.h + 40 };
    
    layout.push(macro, ...macroLayout);
    currentMacroY += macro.boundingBox.h + 40;
  });

  return layout;
}

function estimateTextWidth(text) {
  if (!text) return 100;
  const length = text.replace(/\\n/g, '').length;
  return Math.max(100, length * SIZE_CONFIG.CHAR_UPPER_PX);
}

function calculateToolNodeSize(text) {
  if (!text) return { w: SIZE_CONFIG.NODE_WIDTH, h: SIZE_CONFIG.NODE_BASE_HEIGHT };
  const lines = text.split('\\n');
  const maxLineLength = Math.max(...lines.map(l => l.length));
  return {
    w: Math.max(SIZE_CONFIG.NODE_WIDTH, maxLineLength * SIZE_CONFIG.CHAR_LOWER_PX + 20),
    h: Math.max(SIZE_CONFIG.NODE_BASE_HEIGHT, (lines.length * SIZE_CONFIG.LINE_HEIGHT) + 40)
  };
}

// ============================================================================
// GRAPH TRAVERSAL & SORTING
// ============================================================================

function topologicalSort(nodes, edges) {
  const inDegree = new Map();
  const adjList = new Map();
  const nodeMap = new Map();

  nodes.forEach(node => {
    inDegree.set(node.id, 0);
    adjList.set(node.id, []);
    nodeMap.set(node.id, node);
  });

  edges.forEach(edge => {
    const source = edge.sourceId || (edge.endpoint1 && edge.endpoint1.shapeId);
    const target = edge.targetId || (edge.endpoint2 && edge.endpoint2.shapeId);
    
    if (source && target && adjList.has(source) && inDegree.has(target)) {
      adjList.get(source).push(target);
      inDegree.set(target, inDegree.get(target) + 1);
    }
  });

  const queue = [];
  const sorted = [];

  inDegree.forEach((degree, id) => {
    if (degree === 0) queue.push(id);
  });

  while (queue.length > 0) {
    const currentId = queue.shift();
    sorted.push(nodeMap.get(currentId));

    adjList.get(currentId).forEach(neighborId => {
      inDegree.set(neighborId, inDegree.get(neighborId) - 1);
      if (inDegree.get(neighborId) === 0) {
        queue.push(neighborId);
      }
    });
  }

  // Fallback for cyclical graphs: append any unprocessed nodes
  if (sorted.length < nodes.length) {
    nodes.forEach(node => {
      if (!sorted.includes(node)) sorted.push(node);
    });
  }

  return sorted;
}