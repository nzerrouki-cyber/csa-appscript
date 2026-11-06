# Costco CSA Blueprint \- Lucidchart JSON Standards, Architecture Schemas & Object Specifications

## 1\. Visual Architecture & JSON Payload Directives

When synthesizing the \<csa\_lucidchart\_payload\> (specifically the diagrams array) for direct ELK layout injection, prioritize semantic hierarchy, structural containment, and relational accuracy. The ELK layout generator relies on these explicit properties:

- **Organic Domain Theming & Consistency:** Containers and nodes are grouped logically using the parent\_container attribute.  
- **Scope Delta Standard (The Red Circle Rule):**  
  - **Slide 7 (Current Baseline):** 100% of operational tools must declare `"delta_flag": "Neutral"` (or omit the property).  
  - **Slide 8 (Interim State):** Transitional shims, pilot deployments, and modified components MUST strictly declare `"delta_flag": "Changing"`. Phased-out legacy tools that participate in active fallback routing declare `"delta_flag": "Retiring"` (rendered with a dashed stroke). Declaring `"Adding"` on Slide 8 is strictly prohibited and triggers an automated validation error.  
  - **Slide 9 (Target State):** Net-new platform services, compute runtimes, and authoritative stores MUST strictly declare `"delta_flag": "Adding"`. Baseline surviving tools declare `"delta_flag": "Neutral"`. Retired tools must be completely omitted from Slide 9\.  
- **System of Record (SoR) & Datastore Primitives:** Authoritative datastores must explicitly declare "is\_sor": true.  
- **Capability Containment Anchors:** Treat capabilities strictly as JSON container objects ("type": "CAPABILITY").  
- **Technology Binding & GCP Icon Badging:** Nodes must include the `"technology"` attribute (e.g., `"Google Kubernetes Engine"`, `"Google Cloud Spanner"`, `"SaaS"`, `"Desktop"`). For GCP products on **Slides 7 through 11**, the renderer dynamically overlays a 32x32 px GCP 2021 icon badge in the top-left corner of the shape.  
  - **Canonical Supported GCP Tools:** `Cloud Run`, `Google Kubernetes Engine` (or `GKE`), `Google Cloud Spanner` (or `Cloud Spanner`), `Google Cloud Pub/Sub` (or `Pub/Sub`), `Cloud SQL`, `Cloud Storage`, `Compute Engine`, `Google Cloud Armor` (or `Cloud Armor`), `Cloud Functions`, `Cloud DNS`, `Cloud NAT`, `Cloud Load Balancing` (or `Cloud Load Balancer`), `App Engine`, `BigQuery`, `Dataflow`, and `Dataproc`.  
  - **Context Slide Badge Suppression:** Icon badging is automatically disabled on Slide 6 (System Context) to prevent rectangular badges from overlapping centered circular node labels.

### 1.1 Visual Key (matches the CSA reference template slides)

The renderer draws every element as a plain Lucid shape coloured by its role and adds a **Key** box to the right of each diagram listing the roles used on that slide.

| Role | JSON source | Shape | Fill / Border |
| :---- | :---- | :---- | :---- |
| Tool | node, `type` INTERNAL (or no type) | Rounded rectangle (circle on Slide 6\) | Light blue `#EAF2FF` / `#6FA8F5` |
| External Tool | node, `"type": "EXTERNAL"` | Rounded rectangle | Light gray `#F3F4F6` / `#6B7280` |
| Data Store | node with `"is_sor": true` (label gets `(SoR)`) | Database cylinder | Light yellow `#FFF2CC` / `#F2C14E` |
| Enterprise System | container `"type": "SYSTEM"` | Rectangle, bold title strip | Light green `#C9F2C7` / `#5CB85C` |
| Business Capability | container `"type": "CAPABILITY"` | Rectangle | Light yellow `#FFF2CC` / `#F2C14E` (light gray on Slide 6\) |
| Deployment Environment | container `"type": "MACRO_ENV"` | Rectangle, bold title strip | Light red `#FDE2E2` / `#F08080` |
| Location | container `"type": "LOCATION"` | Rectangle, bold title strip | Light purple `#F2D9FA` / `#D58CEB` |
| Host | container `"type": "HOST"` | Rectangle, bold title strip | Light blue `#EAF2FF` / `#6FA8F5` |
| Adding / Changing | `"delta_flag": "Adding"` or `"Changing"` | Red ellipse (`#D0021B`) drawn around the tool | \- |
| Retiring | `"delta_flag": "Retiring"` | Tool with a dashed gray border | \- |

---

## 2\. Dynamic Topological Graph Heuristics

Layout generation relies on deterministic topological graph heuristics codified into the JSON arrays (`nodes`, `containers`, `connectors`) to ensure parse-safe, collision-free diagram generation across any architectural domain:

### 2.1 Nested Containment & Standalone Isolation

1. **Container Hierarchy Scope:**  
   - Use the `parent_container` attribute (referencing a valid container id) exclusively to nest Business Capabilities inside Enterprise Systems, or Tools inside Spatial Locations and Hosts.  
2. **Standalone Root Layer Placement:**  
   - All internal tools, microservices, cloud runtimes, datastores, and third-party SaaS platforms must declare `"parent_container": null` to sit standalone at the root canvas layer.

---

### 2.2 Edge Routing & Connector Labels

1. **One Connector per Distinct Interaction:**  
   - Represent each distinct interaction as its own connector, even when another interaction links the same two nodes. Preserve each connector's source, target, type, and supplied description; do not combine descriptions with `\\n---\\n` or replace them with a generic label.
   - Represent reverse-direction interactions as separate directed connectors. Set `"type": "bidirectional"` or `"bidirectional": true` only when the interaction itself is explicitly bidirectional.
   - Exact duplicate connectors may be deduplicated only when their ordered endpoints, label, type, explicit bidirectional setting, and `stepNumber` are identical. Reversed endpoints are not an exact duplicate.
2. **Native Connector Text:**  
   - Put the interaction description in the connector's `label`. Render it as text attached to the native Lucid connector, not as a separate floating text block or node.
   - Use ELK's edge-label placement to choose a clear point on the routed connector and attach the native line text at that position. If ELK does not provide a label position, place the label near the connector midpoint.
   - Keep descriptions concise and readable against the connector. Do not add a generic label or alter the interaction wording to satisfy layout.
3. **Interaction Types:**  
   - Use concise labels that describe the relationship or payload shown in the reference diagrams, such as `Interacts`, `Instance`, or `Data Entity`. An `Instance` connector from a System to its implementing tool is a distinct, labelled connector and must not be merged with runtime interactions.

---

### 2.3 Universal Label Density, Multi-Line Clearance & Bounding Formulas

1. **Connector Label Density Standard:**  
   - Keep connector label lines to 25 characters or fewer where practical. Preserve the supplied interaction wording; line breaks may be added for readability, but do not merge separate interactions or rewrite their descriptions.  
   - Use explicit newline delimiters (`\n`) to format longer descriptions into compact, readable blocks.
2. **Node and Container Label Wrapping Standards:**  
   - **Operational Tools & Datastores:** Tool labels must not exceed **24 characters per line**. Long product names must be formatted with explicit `\n` linebreaks.  
   - **Containers (Systems, Capabilities, Macro Environments, Locations, Hosts):** Container titles must not exceed **28 characters per line** to prevent downstream text clipping and bounds overflow.  
3. **Container Header Bounding Width Formula:**  
   - To prevent compaction algorithms from squeezing container headers and generating title cutoff warnings on widescreen slide prints, container minimum width (\$W\_{\\min}\$) must be computed using an expanded maximum cap and safety padding buffer: \$\$W\_{\\min} \= \\min(800, \\max(280, \\text{longestLine} \\times 9.5 \+ 90))\$\$  
   - Every parent container enclosing child nodes must enforce internal padding of at least \$40\\text{ px}\$ on all sides.

---

### 2.4 Natural Boundary Flow, Distributed Ports & Corridor Clearance

1. **System Context Flow (Slide 6):**  
   - Organizes components across three horizontal partitions flowing left-to-right (Partition 0 Inbound Actors \$\\rightarrow\$ Partition 1 Central Core Platform \$\\rightarrow\$ Partition 2 External SaaS & Identity).  
   - **ELK-Routed Connector Mandate:** Use the ELK-computed path for each connector. Paths may use direct or orthogonal segments as needed to reflect the actual relationships and avoid collisions.  
   - **Radial Layer Separation:** The layout engine must maintain a wide horizontal layer spacing (nodeNodeBetweenLayers) of at least **\$260\\text{ px}\$** between partitions to preserve unobstructed line corridors and prevent label crowding around the central hub.  
   - **Target-Sorted Port Distribution:** Connector endpoints attaching to the central core or peripheral containers must be sorted by the vertical (\$Y\$) coordinate of the remote node prior to port assignment. Ports must distribute evenly across fractional offsets (\$0.20\$ to \$0.80\$) along the node perimeter, preventing overlapping endpoints and diagonal crossing ("X") lines.  
2. **Application Decomposition Routing (Slides 7–9):**  
   - Connectors must travel through dedicated horizontal and vertical routing channels strictly using rigid polyline routing (LineShape: "polyline") with explicitly injected vertex coordinates (bendPoints) to enforce safe layout corridors and bypass internal auto-routers.  
   - **Horizontal Layer Corridor Baselines:** Horizontal layer separation (nodeNodeBetweenLayers) must be maintained at a minimum of **\$240\\text{ px}\$** where the diagram size permits, providing clearance for connectors and their attached labels.  
   - **Corridor Clearance Baselines:** Use ELK's edge, node, and label spacing to reduce connector crossings and label collisions while keeping each label attached to its own arrow.  
   - **East-to-West Port Anchor Mandate:** Connectors in left-to-right flows must anchor strictly to horizontal faces (East face \$x=1\$ on source, West face \$x=0\$ on target) with distributed offsets between \$0.20\$ and \$0.80\$. Connectors must **never plunge out of node top or bottom faces into unrelated containers**, nor slice through the bounding box or title strip of an unrelated container.  
   - **Native Connector Labels:** Use ELK's edge-label placement to choose a clear point on each connector, then render the description as native Lucid line text at that point. Do not create a separate text block.
3. **System Deployment Containment (Slide 10):**  
   - Eliminates logical wiring entirely ("connectors": \[\]) in favor of a balanced, row-packed **widescreen layout** (Template v4).  
4. **Information Flow Map (Slide 11):**  
   - Uses ELK to lay out the actual information-flow graph, including its real branches, directions, and data entities. A compact multi-tier arrangement is preferred where it fits, but the flow must not be changed into a single chain merely to meet a prescribed shape.

---

## 3\. Lucidchart JSON Specification Schema (System of Record)

*When compiling State 2 diagram specifications, output the semantic graph strictly using the following nested JSON schema inside the `<csa_lucidchart_payload>` payload.*

### Section 3.1: Slide 6 Archetype (System Context)

```json
{
  "slide_number": 6,
  "title": "System Context",
  "nodes": [
    {
      "id": "core_s6_platform",
      "label": "Google Chrome Enterprise\nBrowser & CBCM Core",
      "technology": "Google Chrome",
      "isCore": true,
      "parent_container": null
    },
    {
      "id": "actor_s6_managed",
      "label": "Corporate Managed\nWorkstation (Win/Mac)",
      "technology": "Desktop",
      "isCore": false,
      "parent_container": "cap_s6_endpoint_mgmt"
    },
    {
      "id": "actor_s6_byod",
      "label": "Workforce BYOD Device\n(Managed Profile)",
      "technology": "Mobile",
      "isCore": false,
      "parent_container": "cap_s6_endpoint_mgmt"
    },
    {
      "id": "partner_s6_idp",
      "label": "PingFederate / PingID\nIdentity Authority",
      "technology": "PingFederate",
      "isCore": false,
      "parent_container": "cap_s6_fed_auth"
    },
    {
      "id": "partner_s6_acm",
      "label": "GCP Access Context\nManager (ACM)",
      "technology": "Google Cloud",
      "isCore": false,
      "parent_container": "cap_s6_fed_auth"
    },
    {
      "id": "target_s6_internal",
      "label": "Costco Internal Apps\n(Private Web Services)",
      "technology": "Custom",
      "isCore": false,
      "parent_container": "cap_s6_sdp_mgmt"
    },
    {
      "id": "target_s6_saas",
      "label": "Enterprise SaaS Suite\n(M365 / Workday / SNOW)",
      "technology": "SaaS",
      "isCore": false,
      "parent_container": "cap_s6_sdp_mgmt"
    }
  ],
  "containers": [
    {
      "id": "cap_s6_endpoint_mgmt",
      "label": "17.5.8.2 - Endpoint Security\nManagement",
      "type": "CAPABILITY"
    },
    {
      "id": "cap_s6_fed_auth",
      "label": "17.9.1.3 - Federated\nAuthentication",
      "type": "CAPABILITY"
    },
    {
      "id": "cap_s6_sdp_mgmt",
      "label": "17.5.5.2.2 - Remote Access\nSDP Management",
      "type": "CAPABILITY"
    }
  ],
  "connectors": [
    {
      "id": "edge_s6_corp_inbound",
      "source": "actor_s6_managed",
      "target": "core_s6_platform",
      "label": "HTTPS Ingress\nvia TLS 1.3",
      "type": "straight"
    },
    {
      "id": "edge_s6_byod_inbound",
      "source": "actor_s6_byod",
      "target": "core_s6_platform",
      "label": "Sandboxed Ingress\nvia TLS 1.3",
      "type": "straight"
    },
    {
      "id": "edge_s6_auth_assertion",
      "source": "core_s6_platform",
      "target": "partner_s6_idp",
      "label": "SAML 2.0 / OIDC\nAuth Assertion",
      "type": "straight",
      "bidirectional": true
    },
    {
      "id": "edge_s6_posture_signals",
      "source": "core_s6_platform",
      "target": "partner_s6_acm",
      "label": "Context & Posture\nSignals Attest",
      "type": "straight",
      "bidirectional": true
    },
    {
      "id": "edge_s6_internal_traffic",
      "source": "core_s6_platform",
      "target": "target_s6_internal",
      "label": "Internal App Traffic\nvia TLS 1.3",
      "type": "straight"
    },
    {
      "id": "edge_s6_saas_traffic",
      "source": "core_s6_platform",
      "target": "target_s6_saas",
      "label": "Downstream SaaS API\nvia TLS 1.3",
      "type": "straight"
    }
  ]
}
```

### Section 3.2: Slides 7–9 Archetype (Application Decomposition)

```json
{
  "slide_number": 9,
  "title": "Target State",
  "nodes": [
    {
      "id": "tool_s9_edge_gateway",
      "label": "Cloud Edge Ingress\nGateway\n(WAF / Apigee / BCE)",
      "technology": "Apigee X",
      "type": "INTERNAL",
      "delta_flag": "Neutral",
      "parent_container": null
    },
    {
      "id": "tool_s9_core_service",
      "label": "Domain Microservice\nPlatform\n(GKE / Cloud Run / AKS)",
      "technology": "Google Kubernetes Engine",
      "type": "INTERNAL",
      "delta_flag": "Adding",
      "parent_container": null
    },
    {
      "id": "tool_s9_event_broker",
      "label": "Enterprise Event Broker\n(Pub/Sub / Service Bus)",
      "technology": "Google Cloud Pub/Sub",
      "type": "INTERNAL",
      "delta_flag": "Adding",
      "parent_container": null
    },
    {
      "id": "db_s9_primary_store",
      "label": "Authoritative\nTransaction Store\n(Spanner / Azure SQL)",
      "technology": "Google Cloud Spanner",
      "type": "INTERNAL",
      "is_sor": true,
      "delta_flag": "Adding",
      "parent_container": null
    },
    {
      "id": "db_s9_audit_store",
      "label": "Enterprise Telemetry\n& SIEM (Chronicle)",
      "technology": "Chronicle",
      "type": "INTERNAL",
      "is_sor": true,
      "delta_flag": "Neutral",
      "parent_container": null
    },
    {
      "id": "ext_s9_partner_api",
      "label": "External Enterprise\nSaaS API (Partner)",
      "technology": "SaaS",
      "type": "EXTERNAL",
      "delta_flag": "Neutral",
      "parent_container": null
    }
  ],
  "containers": [
    {
      "id": "sys_s9_ingress",
      "label": "Perimeter Ingress &\nRouting System",
      "type": "SYSTEM"
    },
    {
      "id": "cap_s9_apim",
      "label": "17.6.2.2 - API Gateway\nManagement",
      "type": "CAPABILITY",
      "parent_container": "sys_s9_ingress"
    },
    {
      "id": "sys_s9_processing",
      "label": "Core Business\nProcessing System",
      "type": "SYSTEM"
    },
    {
      "id": "cap_s9_compute",
      "label": "17.1.3.1 - Container\nOrchestration",
      "type": "CAPABILITY",
      "parent_container": "sys_s9_processing"
    },
    {
      "id": "cap_s9_eventing",
      "label": "17.6.4.1 - Message\nBroker Management",
      "type": "CAPABILITY",
      "parent_container": "sys_s9_processing"
    },
    {
      "id": "sys_s9_persistence",
      "label": "Enterprise Persistence &\nAnalytics System",
      "type": "SYSTEM"
    },
    {
      "id": "cap_s9_data",
      "label": "14.5.2.1 - Relational DB\nManagement",
      "type": "CAPABILITY",
      "parent_container": "sys_s9_persistence"
    },
    {
      "id": "cap_s9_siem",
      "label": "17.1.1.1.2 - SIEM\nManagement",
      "type": "CAPABILITY",
      "parent_container": "sys_s9_persistence"
    }
  ],
  "connectors": [
    {
      "source": "sys_s9_ingress",
      "target": "tool_s9_edge_gateway",
      "label": "Instance",
      "type": "instance"
    },
    {
      "source": "sys_s9_processing",
      "target": "tool_s9_core_service",
      "label": "Instance",
      "type": "instance"
    },
    {
      "source": "sys_s9_persistence",
      "target": "db_s9_primary_store",
      "label": "Instance",
      "type": "instance"
    },
    {
      "source": "tool_s9_edge_gateway",
      "target": "tool_s9_core_service",
      "label": "Validated Ingress\nvia TLS 1.3"
    },
    {
      "source": "tool_s9_core_service",
      "target": "tool_s9_event_broker",
      "label": "Asynchronous Events\nPublish via gRPC"
    },
    {
      "source": "tool_s9_core_service",
      "target": "db_s9_primary_store",
      "label": "State Persistence\nvia PSC"
    },
    {
      "source": "tool_s9_core_service",
      "target": "ext_s9_partner_api",
      "label": "External Partner Sync\nvia Mutual TLS"
    },
    {
      "source": "tool_s9_edge_gateway",
      "target": "db_s9_audit_store",
      "label": "Ingress Audit Logs\nStreaming Pipeline"
    }
  ]
}
```

### Section 3.3: Slide 10 Archetype (System Deployment)

```json
{
  "slide_number": 10,
  "title": "System Deployment",
  "nodes": [
    {
      "id": "node_s10_managed_client",
      "label": "Google Chrome Enterprise\nManaged Desktop Client",
      "technology": "Google Chrome",
      "parent_container": "loc_s10_corporate_fleet"
    },
    {
      "id": "node_s10_byod_profile",
      "label": "Google Chrome Enterprise\nSandboxed BYOD Profile",
      "technology": "Google Chrome",
      "parent_container": "loc_s10_byod_fleet"
    },
    {
      "id": "node_s10_admin_console",
      "label": "Google Admin Console\n(CBCM Policy Engine)",
      "technology": "Google Workspace",
      "parent_container": "loc_s10_gcp_sec"
    },
    {
      "id": "node_s10_acm_svc",
      "label": "Google Access Context\nManager Service",
      "technology": "Google Cloud",
      "parent_container": "loc_s10_gcp_sec"
    },
    {
      "id": "node_s10_pubsub_dlq",
      "label": "GCP Pub/Sub Queue\n(DLQ Buffered Telemetry)",
      "technology": "Google Cloud Pub/Sub",
      "parent_container": "loc_s10_gcp_telemetry"
    },
    {
      "id": "db_s10_chronicle",
      "label": "Google Security Operations\n(Chronicle SIEM Repository)",
      "technology": "Chronicle",
      "is_sor": true,
      "parent_container": "loc_s10_gcp_telemetry"
    },
    {
      "id": "node_s10_gcds",
      "label": "Google Cloud Directory\nSync (GCDS Agent)",
      "technology": "Google Cloud",
      "parent_container": "loc_s10_onprem_core"
    },
    {
      "id": "node_s10_ping",
      "label": "PingFederate / PingID\nCluster Node",
      "technology": "PingFederate",
      "parent_container": "loc_s10_onprem_core"
    },
    {
      "id": "db_s10_adds",
      "label": "Microsoft Active Directory\nDomain Services (ADDS)",
      "technology": "Active Directory",
      "is_sor": true,
      "parent_container": "loc_s10_onprem_core"
    },
    {
      "id": "node_s10_internal_web",
      "label": "Costco Internal Web Apps\n(Private Data Center)",
      "technology": "Custom",
      "parent_container": "loc_s10_onprem_core"
    },
    {
      "id": "node_s10_saas_apps",
      "label": "Costco SaaS Applications\n(M365 / Workday / SNOW)",
      "technology": "SaaS",
      "parent_container": "loc_s10_saas_cloud"
    }
  ],
  "containers": [
    {
      "id": "env_s10_fleet",
      "label": "Workforce Endpoint Fleet",
      "type": "MACRO_ENV",
      "quadrant": "TL"
    },
    {
      "id": "loc_s10_corporate_fleet",
      "label": "Corporate Workstations\n(Win/Mac)",
      "type": "LOCATION",
      "parent_container": "env_s10_fleet"
    },
    {
      "id": "loc_s10_byod_fleet",
      "label": "Workforce Mobility\n(BYOD Personal Devices)",
      "type": "LOCATION",
      "parent_container": "env_s10_fleet"
    },
    {
      "id": "env_s10_gcp",
      "label": "Google Cloud Platform (GCP)",
      "type": "MACRO_ENV",
      "quadrant": "TR"
    },
    {
      "id": "loc_s10_gcp_sec",
      "label": "GCP Security &\nManagement Region",
      "type": "LOCATION",
      "parent_container": "env_s10_gcp"
    },
    {
      "id": "loc_s10_gcp_telemetry",
      "label": "GCP Ingestion &\nTelemetry Buffer",
      "type": "LOCATION",
      "parent_container": "env_s10_gcp"
    },
    {
      "id": "env_s10_corp",
      "label": "Costco Corporate Facilities\n(WDC / QDC)",
      "type": "MACRO_ENV",
      "quadrant": "BL"
    },
    {
      "id": "loc_s10_onprem_core",
      "label": "Enterprise Identity &\nCore Network",
      "type": "LOCATION",
      "parent_container": "env_s10_corp"
    },
    {
      "id": "env_s10_saas",
      "label": "Enterprise SaaS Ecosystem",
      "type": "MACRO_ENV",
      "quadrant": "BR"
    },
    {
      "id": "loc_s10_saas_cloud",
      "label": "Multi-Tenant Cloud\nServices",
      "type": "LOCATION",
      "parent_container": "env_s10_saas"
    }
  ],
  "connectors": []
}
```

### Section 3.4: Slide 11 Archetype (Information Flow)

```json
{
  "slide_number": 11,
  "title": "Information Flow",
  "nodes": [
    {
      "id": "actor_s11_endpoint",
      "label": "Associate Endpoint\n(Managed Chrome Profile)",
      "technology": "Google Chrome",
      "tier": "client",
      "parent_container": null
    },
    {
      "id": "tool_s11_acm",
      "label": "GCP Access Context\nManager (ACM)",
      "technology": "Google Cloud",
      "tier": "gateway",
      "parent_container": null
    },
    {
      "id": "tool_s11_idp",
      "label": "PingFederate / PingID\nIdentity Provider",
      "technology": "PingFederate",
      "tier": "gateway",
      "parent_container": null
    },
    {
      "id": "tool_s11_bce",
      "label": "BeyondCorp Enterprise\nIngress Gateway",
      "technology": "Google Cloud",
      "tier": "processing",
      "parent_container": null
    },
    {
      "id": "tool_s11_target_app",
      "label": "Costco Web Application\n(Target Resource)",
      "technology": "Custom",
      "tier": "processing",
      "parent_container": null
    },
    {
      "id": "tool_s11_pubsub",
      "label": "GCP Pub/Sub Queue\n(Dead-Letter Buffer)",
      "technology": "Google Cloud Pub/Sub",
      "tier": "processing",
      "parent_container": null
    },
    {
      "id": "db_s11_chronicle",
      "label": "Google Security Operations\n(Chronicle SIEM)",
      "technology": "Chronicle",
      "is_sor": true,
      "tier": "persistence",
      "parent_container": "host_s11_chronicle"
    }
  ],
  "containers": [
    {
      "id": "host_s11_chronicle",
      "label": "Google Security Operations\nData Lake",
      "type": "HOST"
    }
  ],
  "connectors": [
    {
      "stepNumber": 1,
      "source": "actor_s11_endpoint",
      "target": "tool_s11_acm",
      "label": "Data Entity"
    },
    {
      "stepNumber": 2,
      "source": "tool_s11_acm",
      "target": "tool_s11_idp",
      "label": "Data Entity"
    },
    {
      "stepNumber": 3,
      "source": "tool_s11_idp",
      "target": "tool_s11_bce",
      "label": "Data Entity"
    },
    {
      "stepNumber": 4,
      "source": "tool_s11_bce",
      "target": "tool_s11_target_app",
      "label": "Data Entity"
    },
    {
      "stepNumber": 5,
      "source": "tool_s11_target_app",
      "target": "tool_s11_pubsub",
      "label": "Data Entity"
    },
    {
      "stepNumber": 6,
      "source": "tool_s11_pubsub",
      "target": "db_s11_chronicle",
      "label": "Data Entity"
    }
  ]
}
```

---

## 4\. Diagram Topological Invariants & Slide Archetypes

### Slide 6: System Context (Tri-Partition Boundary Hub)

- **Tri-Partition Canvas Layout:** The layout engine partitions Slide 6 into three discrete horizontal zones flowing left-to-right to maintain clear boundary orientation without radial line crossings:  
  - **Partition 0 (Left Boundary — Inbound Actors):** Upstream client actors, warehouse personnel, mobile consumers, supplier portals, and depot terminals enclosed within client-facing CAPABILITY containers ("type": "CAPABILITY").  
  - **Partition 1 (Center Canvas — Core Solution Hub):** The central standalone platform tool(s) representing the primary solution scope ("isCore": true, "parent\_container": null).  
  - **Partition 2 (Right Boundary — Identity, SaaS & Enterprise Systems):** External Identity Authorities (PingFederate, Microsoft Entra ID), third-party enterprise platforms (SAP, Workday), and partner SaaS suites enclosed within partner CAPABILITY containers.  
- **Tri-Partition Completeness & Container Segregation:**  
  - Solution Architects and automated pipelines must never collapse Identity Authorities (IdP) and Target Applications (Internal Web Apps, SaaS suites) into a single shared capability container.  
  - Partition 2 must define separate, dedicated capability containers (e.g., 17.9.1.3 \- Federated Authentication for IdPs and 17.5.5.2.2 \- Remote Access SDP Management for internal apps or downstream SaaS suites). Merging these domains into a single container forces opposing authentication assertions and application data lines to converge on the same target blocks, causing severe line congestion.  
- **ELK-Routed Connectors:**  
  - Use ELK's routed connector paths, including direct or orthogonal segments as needed to keep the graph legible. Do not force every connector to be a straight line.  
  - Keep each distinct interaction on its own arrow and attach its supplied description to that connector as native Lucid line text. Do not combine separate interactions between the same pair of nodes.  
- **Natural Boundary Flow Invariant:**  
  - Preserve the actual source, target, and direction of each interaction. Connectors may flow through the central platform or directly between other components when that is what the reference architecture shows.  
  - Connectors interfacing with Identity Providers (SSO/Directory) must declare "type": "bidirectional" or "bidirectional": true.  
- **Peripheral Capability Container Splitting & Density Limit:**  
  - Peripheral capability containers are strictly capped at a **maximum of 2 adjacent tool nodes per container**.  
  - When an initiative involves more than 2 client personas (e.g., Corporate Managed, BYOD Personal, Warehouse Terminals), Solution Architects and generator pipelines MUST partition them across multiple logically scoped capability containers (e.g., 17.5.8.2.1 \- Managed Endpoint Sandbox enclosing up to 2 managed tools, and 17.5.8.2.2 \- BYOD Mobility Sandbox enclosing personal devices).  
  - Inbound actors and external SaaS/identity partners must never share a capability container.  
- **Vertical Target Sorting & Radial Clearance:**  
  - Outgoing and incoming radial lines must be sorted by the remote node's vertical (\$Y\$) position before port assignment. Connectors must distribute evenly along fractional anchor ports (\$0.20\$ to \$0.80\$) along the perimeter of the central hub and peripheral tools to eliminate crisscrossing lines.  
  - Horizontal partition spacing should maintain at least **260 px** between columns where canvas size permits, leaving room for legible routed connectors and their labels.  
- **Unparented Central Core Tool:**  
  - The central core tool(s) MUST declare "isCore": true and "parent\_container": null to anchor at canvas center.  
  - Core platforms must sit standalone at the root canvas and must never be nested inside a container.  
- **Internal Component Exclusion:**  
  - Internal databases, persistent caches, message brokers, internal compute clusters, and telemetry collectors (SIEM) are strictly excluded from Slide 6\.  
- **Native Connector Label Standard:**  
  - Keep labels concise and attach each supplied interaction description to its own connector as native Lucid line text. Use ELK's label placement to position it clearly on the arrow; do not render a separate floating text block or combine distinct interactions.

### Slides 7, 8, & 9: Application Decomposition (Current, Interim, Target)

- **Architectural Ecosystem Mesh Standard:**  
  - Application Decomposition diagrams represent an architectural dependency and control mesh spanning governance planes, authentication authorities, perimeter proxies, runtime services, and target workloads.  
  - Preserve the actual dependency graph; do not omit interactions or force the diagram into a single chain.
- **100% Tech Inventory Coverage Mandate:**  
  - Every active technology declared in the **Slide 5 Technology Inventory** (classified as *Existing*, *Adding*, or *Changing*) MUST appear as an operational tool node in Slide 9 (Target State), or in Slide 8 if transitional.  
  - Management consoles, directory stores, firewalls, and data protection services cannot be omitted for layout brevity.  
- **Multi-System Container Segregation (Cardinality Rule):**  
  - Slides 7–9 must define **2 to 4 distinct "type": "SYSTEM" containers** corresponding to the core functional domains of the architecture (e.g., *Perimeter Ingress & Routing System*, *Enterprise Workload System*, *Enterprise Identity & Federation System*).  
  - Collapsing multi-capability initiatives into a single monolithic System container is strictly prohibited.  
- **Nested Containment (Systems & Capabilities):**  
  - Outer boundaries must be defined as "type": "SYSTEM".  
  - Inner boundaries must be defined as "type": "CAPABILITY" and explicitly reference their parent container using "parent\_container": "\<system\_id\>".  
- **Zero-Connector Zones (Capabilities):**  
  - Capability containers represent logical groupings, contain zero operational tools, and act as Zero-Connector Zones.  
  - No connector edge may attach to or emanate from a "type": "CAPABILITY" container.  
- **Connected Tools Mandate & Quarantined Tool Exclusion Rule:**  
  - Every operational tool on the canvas must declare its "type" (INTERNAL or EXTERNAL) and participate in at least one connector edge.  
  - Tools undergoing deprecation or Proof-of-Concept (POC) quarantine that have no active network routing, coexistence shims, or fallback routes MUST NOT be placed on the Slide 8 diagram canvas as orphaned blocks.  
  - Disconnected decommissioned tools (e.g., Island Secure Browser) must be documented exclusively in the Slide 5 Technology Inventory table and the Slide 8 narrative notes, rather than rendered as unattached nodes.  
- **Corridor Routing Channels & Text Clearance:**  
  - Connectors between operational tools must route along dedicated horizontal and vertical routing channels strictly using rigid polyline routing (LineShape: "polyline") with explicitly injected vertex coordinates to bypass internal auto-routers.  
  - Layout engines must allocate at least **100 px** edge-to-edge spacing, **90 px** edge-to-node spacing, and a dedicated edge-label buffer of **24 px**.  
  - ELK must route connectors to avoid unrelated SYSTEM or CAPABILITY container bounds. Use the ELK label position to place each description as native text on its connector; do not create a separate floating label block.  
- **Distinct Interaction Connectors:**  
  - Keep separate operational interactions (e.g., identity assertion and application ingress) on separate connectors, even when they share endpoints. Preserve direction and label each connector with its own interaction description.
- **Standalone Tool Placement:**  
  - **Internal Tools:** 100% of internal Costco tools, compute nodes, and datastores sit standalone OUTSIDE systems and capabilities at the root canvas level ("parent\_container": null and "type": "INTERNAL").  
  - **External Tools:** All third-party SaaS, external vendor suites, and partner directories declare "type": "EXTERNAL" and sit standalone at root ("parent\_container": null).  
- **Exhaustive Instance Connector Mapping:**  
  - Every Enterprise System must contain at least one Capability and project at least one outward instance edge ("source": "\<system\_id\>", "target": "\<tool\_id\>", "label": "Instance", "type": "instance") targeting the primary standalone tool or controller that implements its capabilities.  
  - Instance edges must never target containers, and connectors must never point into a SYSTEM.  
- **Destination Workload & Ingress Termination Invariant:**  
  - Ingress controllers, proxies, and edge gateways must route directly to destination application nodes—such as *Internal Web Applications*, *Microservices*, or *Corporate SaaS Suites*.  
  - Edge gateways must NEVER terminate solely into a datastore, database, or SIEM repository. SIEM platforms must be modeled as auxiliary asynchronous telemetry sinks receiving event streams.  
- **Transitive Edge Elimination Rule:**  
  - Prohibit bypass line crossings. If Tool A connects to Tool B, and Tool B connects to Tool C, do not declare a direct connector from Tool A to Tool C.  
- **State Deltas (The Red Circle Rule):**  
  - **Slide 7 (Current Baseline):** 100% of operational nodes must declare "delta\_flag": "Neutral".  
  - **Slide 8 (Interim State):** Apply "delta\_flag": "Changing" EXCLUSIVELY to modified tools, transitional reverse proxies, or pilot deployments. Phased-out legacy tools that participate in fallback routing declare "delta\_flag": "Retiring" (rendered with a dashed gray border). Unaltered baseline components declare "delta\_flag": "Neutral".  
  - **Slide 9 (Target State):** Apply "delta\_flag": "Adding" EXCLUSIVELY to net-new target platforms, services, and authoritative stores. Surviving baseline tools declare "delta\_flag": "Neutral". Decommissioned legacy components (and "Retiring" flags) are completely omitted from Slide 9\.

### Slide 10: System Deployment (Spatial Hosting Containment)

- **Topological Invariant:**  
  - Strict 2-tier nested containment hierarchy mapping physical and cloud infrastructure without logical connectors.  
- **Zero-Line Mandate:**  
  - The diagram MUST strictly submit an empty connectors array ("connectors": \[\]).  
  - Logical interaction lines, network routes, and data flows are strictly prohibited on Slide 10\.  
- **Two-Tier Spatial Hierarchy:**  
  - **Tier 1 (Macro Environments):** Root-level containers defining execution boundaries ("type": "MACRO\_ENV"), such as *Workforce Endpoint Fleet*, *Google Cloud Platform (GCP)*, *Enterprise SaaS Ecosystem*, and *Costco Corporate Facilities (WDC/QDC)*.  
  - **Tier 2 (Locations):** Nested boundary containers ("type": "LOCATION", "parent\_container": "\<macro\_env\_id\>") representing cloud regions, availability zones, data center facilities, or endpoint device profiles.  
- **Balanced Row-Packed Spatial Architecture (Costco CSA Template v4 Alignment):**  
  - Deployment topologies are packed into balanced 16:9 rows, as in Costco CSA Template v4, rather than elongated single-row horizontal strips. Wide environments (such as a SaaS location) take a full row; smaller ones share the row below. Tools inside a Location form a uniform grid of up to 3 columns. The quadrant attribute sets the reading order (TL, TR, BL, BR):  
    - **Top-Left Quadrant (quadrant: "TL"):** *Workforce Endpoint Fleet* containing Location profiles for Corporate Workstations and Workforce BYOD Devices.  
    - **Top-Right Quadrant (quadrant: "TR"):** *Google Cloud Platform (GCP)* or *Microsoft Azure* containing regional VPCs, edge points of presence, and control plane Locations.  
    - **Bottom-Left Quadrant (quadrant: "BL"):** *Costco Corporate Facilities* containing Production Data Center Locations (WDC/QDC).  
    - **Bottom-Right Quadrant (quadrant: "BR"):** *Enterprise SaaS Ecosystem* containing Multi-Tenant Cloud Service Locations.  
  - Macro Environment containers should declare the "quadrant" attribute ("TL" \| "TR" \| "BL" \| "BR") to fix their order in the packing.  
- **Container Header Clearance Formula:**  
  - Location and Macro Environment containers must size their width to accommodate title strings without truncation using the updated padding buffer: \$W\_{\\min} \= \\min(800, \\max(280, \\text{longestLine} \\times 9.5 \+ 90))\$  
  - Child tools packed inside Location containers must not force container dimensions below \$W\_{\\min}\$, guaranteeing that slide prints never trigger geometry cut-off warnings.  
- **Exhaustive Spatial Placement:**  
  - 100% of participating operational tools and datastores must be nested inside a Tier-2 LOCATION container ("parent\_container": "\<loc\_id\>").  
  - Tools must never sit unparented at the root canvas level or directly inside a Tier-1 MACRO\_ENV container on Slide 10\.  
- **No Orphaned or Empty Containers:**  
  - Only MACRO\_ENV and LOCATION containers are permitted on Slide 10\.  
  - Every Tier-1 container must hold at least one Tier-2 container, and every Tier-2 container must hold at least one operational tool node. Empty containers are strictly prohibited.

### Slide 11: Information Flow (Data Entity Interaction Map)

- **Topological Invariant:**  
  - Show data entities and other actual interactions between participating systems, services, and datastores, preserving their real directions and relationships.  
- **Traceable Interaction Flow:**  
  - Show each actual data or control interaction as its own connector with the correct source, target, direction, and description. Flows may branch or be bidirectional where the architecture requires; do not force unrelated interactions into one linear chain.  
  - `stepNumber` may be supplied as ordering metadata when a sequence needs to be communicated. Do not invent step numbers or require the visible label to begin with `Step N:`; concise labels such as `Data Entity` are valid when they match the interaction shown.  
  - Show asynchronous audit telemetry as a separate interaction from its actual source to its destination.
- **Authoritative SoR Cylinder Exclusivity Rule:**  
  - The Database Cylinder shape primitive (DatabaseBlock) is strictly reserved for nodes declaring "is\_sor": true.  
  - Declaring "is\_sor": true triggers the rendering engine to format the node as a database cylinder, apply light yellow styling (\#FFF2CC / \#F2C14E), and dynamically append \\n(SoR) to the label.  
  - Client browser profiles, edge proxies, ingress gateways, and compute runtimes that manage local caches or sandboxes MUST declare "is\_sor": false (or omit the property).  
  - Solution Architects and generator pipelines must avoid using datastore terminology (Database, DB, Datastore, Data Lake, Cache) in the labels or technology properties of client runtimes to prevent visual shape misclassifications.  
- **Persistence Tool Containment:**  
  - Host persistence platforms act as boundary containers ("type": "HOST").  
  - Authoritative stateful datastores and SIEM audit repositories must be nested strictly inside their parent host container ("parent\_container": "\<host\_id\>").  
  - No HOST container may be empty.  
- **Information Flow Connector Labels:**  
  - Put each concise interaction description (for example, `Data Entity`) on its own native connector as Lucid line text. Preserve the wording supplied for the interaction; use line breaks only to improve readability.  
  - When `stepNumber` is supplied, use it only to order connectors. It is metadata and does not have to appear in the visible connector label.
- **Full Node Participation:**  
  - Every operational node and datastore on Slide 11 must take part in at least one transaction step.
