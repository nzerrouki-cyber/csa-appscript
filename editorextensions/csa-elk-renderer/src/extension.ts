import { EditorClient } from 'lucid-extension-sdk';
import ELK from 'elkjs/lib/elk.bundled.js';

const client = new EditorClient();
const elk = new ELK();

function mapNodeToGcpShape(node: any): string {
  const text = (node.text || '').toLowerCase();
  const type = (node.type || '').toLowerCase();

  if (type === 'container' || type === 'system' || type === 'capability') {
    return 'GCPContainer';
  }
  if (text.includes('gke') || text.includes('kubernetes') || text.includes('cluster')) {
    return 'gcp-google-kubernetes-engine';
  }
  if (text.includes('database') || text.includes('spanner') || text.includes('sql') || node.isSoR) {
    return 'gcp-cloud-sql';
  }
  if (text.includes('pubsub') || text.includes('kafka') || text.includes('queue') || text.includes('event')) {
    return 'gcp-cloud-pub-sub';
  }
  if (text.includes('storage') || text.includes('bucket') || text.includes('gcs')) {
    return 'gcp-cloud-storage';
  }
  if (text.includes('function') || text.includes('run') || text.includes('lambda')) {
    return 'gcp-cloud-run';
  }

  return 'gcp-compute-engine';
}

client.registerStartupHook(async () => {
  const bootstrap = await client.processAndClearBootstrapData();
  if (!bootstrap?.data?.csaPayload) {
    return;
  }

  let architectureData: any;
  try {
    architectureData = JSON.parse(bootstrap.data.csaPayload);
  } catch (err) {
    console.error('Failed to parse incoming CSA payload:', err);
    return;
  }

  const viewport = client.getViewport();
  const pages = viewport.getPages();

  for (const page of pages) {
    const title = page.getTitle() || '';
    let graphData: any = null;

    if (title.includes('System Context') && architectureData.systemContext) {
      graphData = architectureData.systemContext;
    } else if (title.includes('Current State') && architectureData.decomposition?.current) {
      graphData = architectureData.decomposition.current;
    } else if (title.includes('Interim State') && architectureData.decomposition?.interim) {
      graphData = architectureData.decomposition.interim;
    } else if (title.includes('Target State') && architectureData.decomposition?.target) {
      graphData = architectureData.decomposition.target;
    } else if (title.includes('Deployment') && architectureData.deployment) {
      graphData = architectureData.deployment;
    } else if (title.includes('Information Flow') && architectureData.informationFlow) {
      graphData = architectureData.informationFlow;
    }

    if (!graphData || !graphData.nodes) continue;

    const elkGraph = {
      id: 'root',
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': 'RIGHT',
        'elk.edgeRouting': 'ORTHOGONAL',
        'elk.spacing.nodeNode': '50',
        'elk.layered.spacing.nodeNodeBetweenLayers': '90'
      },
      children: graphData.nodes.map((node: any) => ({
        id: String(node.id),
        width: 140,
        height: 100,
        labels: [{ text: node.text || node.id }]
      })),
      edges: (graphData.edges || []).map((edge: any, idx: number) => ({
        id: String(edge.id || `e_${idx}`),
        sources: [String(edge.sourceId || edge.endpoint1?.shapeId)],
        targets: [String(edge.targetId || edge.endpoint2?.shapeId)]
      }))
    };

    const layout = await elk.layout(elkGraph);
    if (!layout.children) continue;

    const shapeIdMap = new Map<string, any>();

    for (const n of layout.children) {
      const originalNode = graphData.nodes.find((item: any) => String(item.id) === n.id);
      const gcpShape = mapNodeToGcpShape(originalNode || {});

      const block = page.addBlock({
        className: 'GCPBlockProxy',
        shape: gcpShape,
        boundingBox: {
          x: (n.x || 0) + 100,
          y: (n.y || 0) + 100,
          w: n.width || 140,
          h: n.height || 100
        }
      });

      if (originalNode?.text) {
        block.setProperty('label', originalNode.text);
      }

      shapeIdMap.set(n.id, block);
    }

    for (const e of graphData.edges || []) {
      const srcId = String(e.sourceId || e.endpoint1?.shapeId);
      const tgtId = String(e.targetId || e.endpoint2?.shapeId);

      const srcBlock = shapeIdMap.get(srcId);
      const tgtBlock = shapeIdMap.get(tgtId);

      if (srcBlock && tgtBlock) {
        page.addLine({
          endpoint1: { connection: srcBlock },
          endpoint2: { connection: tgtBlock }
        });
      }
    }
  }
});