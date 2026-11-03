import { EditorClient } from '@lucidsoftware/extension-sdk';
import ELK from 'elkjs/lib/elk.bundled.js';

const client = new EditorClient();
const elk = new ELK();

client.registerStartupHook(async () => {
  // 1. Grab raw payload passed from Apps Script
  const bootstrap = await client.processAndClearBootstrapData();
  if (!bootstrap?.data?.payload) return;

  const rawGraph = JSON.parse(bootstrap.data.payload);

  // 2. Format graph for ELK
  const elkGraph = {
    id: "root",
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.spacing.nodeNode': '40'
    },
    children: rawGraph.nodes.map((n: any) => ({
      id: n.id,
      width: 120,
      height: 120,
      labels: [{ text: n.text }]
    })),
    edges: rawGraph.edges.map((e: any) => ({
      id: e.id,
      sources: [e.sourceId],
      targets: [e.targetId]
    }))
  };

  // 3. Run layout calculation right in the browser session
  const layout = await elk.layout(elkGraph);

  // 4. Place native GCP 2021 stencils onto the page
  const page = client.getViewport().getCurrentPage();
  if (!page || !layout.children) return;

  for (const node of layout.children) {
    page.addBlock({
      className: 'GCPBlockProxy', // Native GCP 2021 class
      shape: 'gcp-compute-engine', // Or map dynamically from node metadata
      boundingBox: {
        x: node.x || 0,
        y: node.y || 0,
        w: node.width || 120,
        h: node.height || 120
      }
    });
  }
});