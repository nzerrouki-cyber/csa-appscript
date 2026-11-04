# Costco CSA Blueprint \- Lucidchart JSON Standards, Architecture Schemas & Object Specifications

## 1\. Visual Architecture & JSON Payload Directives

When synthesizing the `<csa_lucidchart_payload>` (specifically the `diagrams` array) for direct ELK layout injection, prioritize semantic hierarchy, structural containment, and relational accuracy. The ELK layout generator relies on these explicit properties:

- **Organic Domain Theming & Consistency:** Containers and nodes are grouped logically using the `parent_container` attribute.  
- **Scope Delta Standard (The Red Circle Rule):** On Slides 8 (Interim State) and 9 (Target State), all added, modified, or transitional tools MUST explicitly be flagged with `"delta_flag": "Adding"` or `"delta_flag": "Changing"`. Slide 7 nodes must strictly omit this flag or set it to `"Neutral"`.  
- **System of Record (SoR) & Datastore Primitives:** Authoritative datastores must explicitly declare `"is_sor": true`.  
- **Capability Containment Anchors:** Treat capabilities strictly as JSON container objects (`"type": "CAPABILITY"`).  
- **Technology Binding:** Nodes must include the `"technology"` attribute (product or platform name, e.g. `"Google Cloud Spanner"`, `"SaaS"`, `"Desktop"`). Shapes are drawn from the visual key in Section 1.1, not from the technology value; for GCP products the renderer adds a small GCP 2021 icon badge when the technology or label matches a known product.

### 1.1 Visual Key (matches the CSA reference template slides)

The renderer draws every element as a plain Lucid shape coloured by its role and adds a **Key** box to the right of each diagram listing the roles used on that slide.

| Role | JSON source | Shape | Fill / Border |
| :---- | :---- | :---- | :---- |
| Tool | node, `type` INTERNAL (or no type) | Rounded rectangle (circle on Slide 6) | Light blue `#EAF2FF` / `#6FA8F5` |
| External Tool | node, `"type": "EXTERNAL"` | Rounded rectangle | Light gray `#F3F4F6` / `#6B7280` |
| Data Store | node with `"is_sor": true` (label gets `(SoR)`) | Database cylinder | Light yellow `#FFF2CC` / `#F2C14E` |
| Enterprise System | container `"type": "SYSTEM"` | Rectangle, bold title strip | Light green `#C9F2C7` / `#5CB85C` |
| Business Capability | container `"type": "CAPABILITY"` | Rectangle | Light yellow `#FFF2CC` / `#F2C14E` (light gray on Slide 6) |
| Deployment Environment | container `"type": "MACRO_ENV"` | Rectangle, bold title strip | Light red `#FDE2E2` / `#F08080` |
| Location | container `"type": "LOCATION"` | Rectangle, bold title strip | Light purple `#F2D9FA` / `#D58CEB` |
| Host | container `"type": "HOST"` | Rectangle, bold title strip | Light blue `#EAF2FF` / `#6FA8F5` |
| Adding / Changing | `"delta_flag": "Adding"` or `"Changing"` | Red ellipse (`#D0021B`) drawn around the tool | - |
| Retiring | `"delta_flag": "Retiring"` | Tool with a dashed gray border | - |

---

## 2\. Dynamic Topological Graph Heuristics

Layout generation relies entirely on topological graph principles codified into the JSON arrays (`nodes`, `containers`, `connectors`):

1. **Nested Containment:** Use the `parent_container` property (referencing a valid container id) to nest Business Capabilities inside Enterprise Systems, or Tools inside Deployment Locations. Nodes with `"parent_container": null` sit standalone at the root canvas level.  
2. **Strict Pairwise Edge Deduplication:** Between any unique pair of nodes, there must be AT MOST ONE edge object in the `connectors` array. Consolidate multiple interactions into a single connector with an aggregated `"label"`, or use `"type": "bidirectional"`. Parallel duplicate lines are strictly prohibited.  
3. **Flow Gradients:**  
   - *Application Decomposition (Slides 7–9):* Enterprise Systems project "Instance" connectors outward from their boundaries to instantiated tools (where `source` is a SYSTEM container).  
   - *Information Flow (Slide 11):* Cascade data movements chronologically. The JSON `connectors` array must include a `"stepNumber": N` property to dictate the strict sequential transaction flow.

---

## 3\. Lucidchart JSON Specification Schema (System of Record)

*When compiling State 2 diagram specifications, output the semantic graph strictly using the following nested JSON schema inside the `<csa_lucidchart_payload>` payload.*

### Section 3.1: Slide 6 Archetype (System Context)

```json
{
  "slide_number": 6,
  "title": "System Context",
  "nodes": [
    { "id": "core_1", "label": "Central Core Platform", "technology": "Custom", "isCore": true, "parent_container": null },
    { "id": "actor_1", "label": "Member Mobile App", "technology": "Mobile", "isCore": false, "parent_container": "cap_1" },
    { "id": "partner_1", "label": "External SaaS Provider", "technology": "SaaS", "isCore": false, "parent_container": "cap_1" }
  ],
  "containers": [
    { "id": "cap_1", "label": "10.2.2 - Candidate Recruiting and Sourcing", "type": "CAPABILITY" }
  ],
  "connectors": [
    { "source": "actor_1", "target": "core_1", "label": "HTTPS Requests via Fastly WAF" },
    { "source": "partner_1", "target": "core_1", "label": "Partner Webhook via mTLS" }
  ]
}
```

### Section 3.2: Slides 7–9 Archetype (Application Decomposition)

```js
{
  "slide_number": 9,
  "title": "Target State",
  "nodes": [
    { "id": "tool_apigee", "label": "Google Apigee X", "technology": "Google Apigee", "type": "INTERNAL", "delta_flag": "Neutral", "parent_container": null },
    { "id": "tool_order_svc", "label": "Order Processing Microservice", "technology": "Google Kubernetes Engine", "type": "INTERNAL", "delta_flag": "Adding", "parent_container": null },
    { "id": "db_order_store", "label": "Google Cloud Spanner", "technology": "Google Cloud Spanner", "type": "INTERNAL", "is_sor": true, "delta_flag": "Adding", "parent_container": null },
    { "id": "tool_tax_engine", "label": "Avalara Tax Compliance Cloud", "technology": "SaaS", "type": "EXTERNAL", "delta_flag": "Neutral", "parent_container": null }
  ],
  "containers": [
    { "id": "sys_commerce", "label": "Digital Commerce System", "type": "SYSTEM" },
    { "id": "cap_order", "label": "10.4.1 - Order Processing", "type": "CAPABILITY", "parent_container": "sys_commerce" },
    { "id": "sys_edge", "label": "Edge Security System", "type": "SYSTEM" },
    { "id": "cap_gateway", "label": "17.6.2.2 - API Gateway", "type": "CAPABILITY", "parent_container": "sys_edge" }
  ],
  "connectors": [
    { "source": "sys_edge", "target": "tool_apigee", "label": "Instance", "type": "instance" },
    { "source": "sys_commerce", "target": "tool_order_svc", "label": "Instance", "type": "instance" },
    { "source": "tool_apigee", "target": "tool_order_svc", "label": "REST Ingress via TLS 1.3" },
    { "source": "tool_order_svc", "target": "db_order_store", "label": "gRPC ACID Commits" },
    { "source": "tool_order_svc", "target": "tool_tax_engine", "label": "Tax Lookup via TLS 1.3" }
  ]
}
```

### Section 3.3: Slide 10 Archetype (System Deployment)

```js
{
  "slide_number": 10,
  "title": "System Deployment",
  "nodes": [
    { "id": "node_gke", "label": "GKE Standard Ingress Cluster", "technology": "Google Kubernetes Engine", "parent_container": "loc_us_west1" },
    { "id": "node_spanner", "label": "Cloud Spanner Multi-Region Instance", "technology": "Google Cloud Spanner", "is_sor": true, "parent_container": "loc_us_west1" }
  ],
  "containers": [
    { "id": "env_gcp", "label": "Google Cloud Platform (GCP)", "type": "MACRO_ENV" },
    { "id": "loc_us_west1", "label": "us-west1 (Oregon)", "type": "LOCATION", "parent_container": "env_gcp" }
  ],
  "connectors": []
}
```

### Section 3.4: Slide 11 Archetype (Information Flow)

```js
{
  "slide_number": 11,
  "title": "Information Flow",
  "nodes": [
    { "id": "actor_pos", "label": "Warehouse POS Terminal", "technology": "Hardware", "parent_container": null },
    { "id": "tool_gateway", "label": "Apigee X API Gateway", "technology": "Google Apigee", "parent_container": null },
    { "id": "db_pos_state", "label": "Order Transaction Store", "technology": "Google Cloud Spanner", "is_sor": true, "parent_container": "host_spanner" }
  ],
  "containers": [
    { "id": "host_spanner", "label": "GCP Cloud Spanner", "type": "HOST" }
  ],
  "connectors": [
    { "stepNumber": 1, "source": "actor_pos", "target": "tool_gateway", "label": "Step 1: Auth and Ingress via mTLS" },
    { "stepNumber": 2, "source": "tool_gateway", "target": "db_pos_state", "label": "Step 2: ACID State Commit via gRPC" }
  ]
}
```

## ---

## 4\. Diagram Topological Invariants & Slide Archetypes

### Slide 6: System Context (Radial Boundary Hub)

- **Unparented Central Tool:** The central core tool(s) MUST declare `"isCore": true` and `"parent_container": null`. It sits standalone at the root of the layout.  
- **Peripheral Boundary Scope Mandate:** Containers must enclose ONLY upstream client channels/actors and external enterprise/SaaS partners.  
- **Inward Flow Invariant:** Peripheral tools must point strictly inward. The `connectors` array must define the central core tool strictly as the `target` for all connections.  
- **Containment:** Every peripheral tool sits inside a `"type": "CAPABILITY"` container; no other container types and no empty containers are allowed on Slide 6.

### Slides 7, 8, & 9: Application Decomposition (Current, Interim, Target)

- **Nested Containment (Enterprise Systems & Capabilities):**  
  - Outer boundaries must be defined as `"type": "SYSTEM"`.  
  - Inner boundaries must be defined as `"type": "CAPABILITY"` and explicitly reference their parent using the `"parent_container"` key.  
- **Zero-Connector Zones:** Capability containers contain ZERO operational tools and act as Zero-Connector Zones. No connector object may use a `"type": "CAPABILITY"` container as a `source` or `target`.  
- **Internal Tool Standalone Placement:** 100% of internal Costco Tools sit standalone OUTSIDE systems and capabilities at the root canvas level (`"parent_container": null` and `"type": "INTERNAL"`).  
- **Standalone External Tools:** All external tools MUST declare `"type": "EXTERNAL"` and sit standalone at the root (`"parent_container": null`), like internal tools; they are distinguished by colour (see Section 1.1). A `"type": "PERIMETER"` container is optional and, if used, must sit at the root.  
- **Exhaustive Instance Connector Mapping:** Every internal standalone tool that implements capabilities within an Enterprise System MUST receive an instance edge originating from that parent system (e.g., `"source": "sys_core"`, `"target": "tool_api"`, `"label": "Instance"`, `"type": "instance"`). Every SYSTEM must hold at least one CAPABILITY and project at least one Instance edge; Instance edges must target a tool, and no connector may point into a SYSTEM.  
- **Connected Tools:** Every tool must declare its `"type"` and take part in at least one connector.  
- **State Deltas (The Red Circle Rule):**  
  - *Slide 7 (Current Baseline):* Ensure `"delta_flag": "Neutral"` on all nodes.  
  - *Slide 8 (Interim State):* Apply `"delta_flag": "Changing"` EXCLUSIVELY to changing tools, transitional shims, or pilot proxies. Retiring legacy tools declare `"delta_flag": "Retiring"`.  
  - *Slide 9 (Target State):* Apply `"delta_flag": "Adding"` EXCLUSIVELY to net-new target platforms and databases. Retired legacy tools are entirely omitted (no `"Retiring"` flags).  
  - *Rendering:* Adding/Changing tools are circled with a red ellipse; Retiring tools get a dashed gray border.

### Slide 10: System Deployment (Spatial Hosting Containment)

- **Topological Invariant:** 2-tier nested containment map.  
- **Zero-Line Mandate:** The diagram MUST submit an empty `connectors: []` array.  
- **Hierarchy:** MACRO\_ENV containers sit at the root and enclose LOCATION containers (via `parent_container`), which enclose 100% of participating tools. Only MACRO\_ENV and LOCATION containers are allowed, and none may be empty.

### Slide 11: Information Flow (Chronological Execution Cascade)

- **Topological Invariant:** Sequential execution pipeline tracking upstream initiators to downstream persistence.  
- **Persistence Tool Containment:** Host persistence tools act as boundary containers (`"type": "HOST"`). Stateful databases and caches are nested strictly inside their parent host container.  
- **System of Record (SoR):** Authoritative persistence stores mandate `"is_sor": true`.  
- **1:1 Numbered Parity:** The `connectors` array must include `"stepNumber": N` in ascending order, starting at 1 with no gaps or duplicates, to maintain strict sequential parity with the narrative bullets in the presentation specification.  
- **Step Labels:** Each connector label starts with `"Step N: "` matching its `stepNumber` (e.g. `"stepNumber": 3` -> `"Step 3: Identity Auth via SAML"`).  
- **Full Participation:** Every node takes part in at least one step, and no HOST container is empty.

