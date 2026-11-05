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

### 2.2 Discrete Protocol Edge Routing & Deduplication Standards

1. **Discrete Operational Protocols:**  
   - Between any unique pair of nodes, distinct operational interactions and protocols (e.g., authentication assertions vs. data-plane traffic, or public egress vs. encrypted VPN tunnels) must be declared as separate, independent connector objects.  
   - Forcibly collapsing different communication channels into a single merged edge is strictly prohibited, as aggregated multi-line labels cause text collisions and obscure architectural protocol distinctions.  
2. **Identical Pairwise Deduplication:**  
   - True duplicate interactions sharing identical endpoints, identical directionality, and identical protocols must be deduplicated into a single edge.  
   - Where bidirectional communication occurs under the same protocol, declare `"type": "bidirectional"` or `"bidirectional": true` on a single edge rather than rendering opposing parallel lines.  
3. **Instance Edge Exclusivity:**  
   - Instance connectors projecting from an Enterprise System to an operational tool (`"type": "instance"`, `"label": "Instance"`) must remain completely separate from runtime interaction connectors linking tools.

---

### 2.3 Universal Label Density, Multi-Line Clearance & Bounding Formulas

1. **Connector Label Density Standard:**  
   - Connector labels must **never exceed 25 characters per line** under any circumstances.  
   - All multi-word interaction descriptions, protocol declarations, and transaction steps must incorporate explicit newline delimiters (`\n`) to break text into compact, balanced blocks (e.g., `"HTTPS Ingress\nvia TLS 1.3"`, `"Order Event\nvia Pub/Sub"`, `"Step 2: Context &\nDevice Posture Attest"`).  
2. **Node and Container Label Wrapping Standards:**  
   - **Operational Tools & Datastores:** Tool labels must not exceed **24 characters per line**. Long product names must be formatted with explicit `\n` linebreaks.  
   - **Containers (Systems, Capabilities, Macro Environments, Locations, Hosts):** Container titles must not exceed **32 characters per line**.  
3. **Container Header Bounding Width Formula:**  
   - To prevent compaction algorithms from squeezing container headers and generating title cutoff warnings on widescreen slide prints, container minimum width (\$W\_{\\min}\$) must be computed using: \$\$W\_{\\min} \= \\min(600, \\max(280, \\text{longestLine} \\times 9.5 \+ 64))\$\$  
   - Every parent container enclosing child nodes must enforce internal padding of at least \$40\\text{ px}\$ on all sides.

---

### 2.4 Natural Boundary Flow, Distributed Ports & Corridor Clearance

1. **System Context Flow (Slide 6):**  
   - Organizes components across three horizontal partitions flowing left-to-right (Partition 0 Inbound Actors \$\\rightarrow\$ Partition 1 Central Core Platform \$\\rightarrow\$ Partition 2 External SaaS & Identity).  
   - **Straight Radial Line Mandate:** All Slide 6 connectors must be rendered as direct straight lines (`LineShape: "straight"`) radiating to and from the central core hub. Orthogonal elbow routing is prohibited on Slide 6\.  
   - **Perimeter Port Distribution:** When multiple incoming or outgoing lines attach to the same side of a node, connection points must be distributed across fractional edge ports (e.g., \$0.35, 0.50, 0.65\$). Lines must never share a single connection point or merge into shared trunk elbows.  
2. **Application Decomposition Routing (Slides 7–9):**  
   - Connectors must travel through dedicated horizontal and vertical routing channels using orthogonal elbow routing.  
   - **Corridor Clearance Baselines:** Layout engines must maintain a minimum edge-to-edge spacing of **\$65\\text{ px}\$** and an edge-to-node spacing of **\$85\\text{ px}\$** to ensure connector labels never overlap adjacent lines or shape borders.  
   - **Reserved Label Slots:** Connector labels are sized and placed by the layout engine as edge labels, so their space is reserved in the corridor and connectors are drawn along the engine's obstacle-free routes.  
   - Connectors must **never slice through the bounding box or title strip of an unrelated container**.  
3. **System Deployment Containment (Slide 10):**  
   - Eliminates logical wiring entirely (`"connectors": []`) in favor of a balanced, row-packed **widescreen layout** (Template v4).  
4. **Information Flow Map (Slide 11):**  
   - Enforces a 2D multi-tier architectural flow map reflecting logical functional tiers (Client \$\\rightarrow\$ Gateway \$\\rightarrow\$ Service \$\\rightarrow\$ Datastore/SIEM) in a compact 16:9 aspect ratio, preventing single-line horizontal sprawl.

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
      "label": "Step 1: Context &\nPosture Signals"
    },
    {
      "stepNumber": 2,
      "source": "tool_s11_acm",
      "target": "tool_s11_idp",
      "label": "Step 2: SAML 2.0 /\nFIDO2 MFA Request"
    },
    {
      "stepNumber": 3,
      "source": "tool_s11_idp",
      "target": "tool_s11_bce",
      "label": "Step 3: Context Token\n& Session Grant"
    },
    {
      "stepNumber": 4,
      "source": "tool_s11_bce",
      "target": "tool_s11_target_app",
      "label": "Step 4: Micro-Segmented\nIngress via mTLS"
    },
    {
      "stepNumber": 5,
      "source": "tool_s11_target_app",
      "target": "tool_s11_pubsub",
      "label": "Step 5: Last-Mile DLP\nEvents via gRPC"
    },
    {
      "stepNumber": 6,
      "source": "tool_s11_pubsub",
      "target": "db_s11_chronicle",
      "label": "Step 6: Audit Record\nCommit to SIEM SoR"
    }
  ]
}
```

---

## 4\. Diagram Topological Invariants & Slide Archetypes

---

### Slide 6: System Context (Tri-Partition Boundary Hub)

- **Tri-Partition Canvas Layout:** The layout engine partitions Slide 6 into three discrete horizontal zones flowing left-to-right to maintain clear boundary orientation without radial line crossings:  
  - **Partition 0 (Left Boundary — Inbound Actors):** Upstream client actors, warehouse personnel, mobile consumers, supplier portals, and depot terminals enclosed within client-facing CAPABILITY containers (`"type": "CAPABILITY"`).  
  - **Partition 1 (Center Canvas — Core Solution Hub):** The central standalone platform tool(s) representing the primary solution scope (`"isCore": true`, `"parent_container": null`).  
  - **Partition 2 (Right Boundary — Identity, SaaS & Enterprise Systems):** External Identity Authorities (PingFederate, Microsoft Entra ID), third-party enterprise platforms (SAP, Workday), and partner SaaS suites enclosed within partner CAPABILITY containers.  
- **Straight Radial Line & Independent Arrow Mandate:**  
  - All connectors on Slide 6 must be rendered as direct straight lines (`LineShape: "straight"`). Orthogonal elbow routing is strictly prohibited on Slide 6\.  
  - **Arrows must never intercept, share elbow trunks, or merge:** Every incoming and outgoing interaction must maintain its own dedicated arrow line with full visual separation from adjacent lines.  
  - Connectors attaching to the central core must anchor to dynamically distributed perimeter ports (e.g., \$0.35, 0.50, 0.65\$) rather than collapsing onto a single midpoint coordinate.  
- **Natural Boundary Flow Invariant:**  
  - Connectors from Partition 0 (Inbound Actors) must route **inward** targeting the central core platform (`source: actor_id`, `target: core_id`).  
  - Connectors from the central core platform to Partition 2 (Downstream SaaS and External Systems) must route **outward** (`source: core_id`, `target: saas_id`).  
  - Connectors interfacing with Identity Providers (SSO/Directory) must declare `"type": "bidirectional"` or `"bidirectional": true`.  
  - Connectors must interface directly with the central core tool; connectors that bypass the central core tool on Slide 6 are strictly prohibited.  
- **Peripheral Capability Container Splitting & Density Limit:**  
  - Peripheral capability containers are strictly capped at a **maximum of 2 adjacent tool nodes per container**.  
  - When an initiative involves more than 2 client personas (e.g., Corporate Managed, BYOD Personal, Warehouse Terminals), Solution Architects and generator pipelines MUST partition them across multiple logically scoped capability containers (e.g., `17.5.8.2.1 - Managed Endpoint Sandbox` enclosing up to 2 managed tools, and `17.5.8.2.2 - BYOD Mobility Sandbox` enclosing personal devices).  
  - Inbound actors and external SaaS/identity partners must never share a capability container.  
- **Unparented Central Core Tool:**  
  - The central core tool(s) MUST declare `"isCore": true` and `"parent_container": null` to anchor at canvas center.  
  - Core platforms must sit standalone at the root canvas and must never be nested inside a container.  
- **Internal Component Exclusion:**  
  - Internal databases, persistent caches, message brokers, internal compute clusters, and telemetry collectors (SIEM) are strictly excluded from Slide 6\.  
- **Label Wrapping Standard:**  
  - All connector labels must incorporate explicit `\n` linebreaks with no line exceeding 25 characters.

---

### Slides 7, 8, & 9: Application Decomposition (Current, Interim, Target)

- **Architectural Ecosystem Mesh Standard:**  
  - Application Decomposition diagrams represent an architectural dependency and control mesh spanning governance planes, authentication authorities, perimeter proxies, runtime services, and target workloads.  
  - Decomposition diagrams must NEVER be collapsed into an unbranched, single-line transaction pipe (which is reserved exclusively for Slide 11).  
- **100% Tech Inventory Coverage Mandate:**  
  - Every active technology declared in the **Slide 5 Technology Inventory** (classified as *Existing*, *Adding*, or *Changing*) MUST appear as an operational tool node in Slide 9 (Target State), or in Slide 8 if transitional.  
  - Management consoles, directory stores, firewalls, and data protection services cannot be omitted for layout brevity.  
- **Multi-System Container Segregation (Cardinality Rule):**  
  - Slides 7–9 must define **2 to 4 distinct "type": "SYSTEM" containers** corresponding to the core functional domains of the architecture (e.g., *Perimeter Ingress & Routing System*, *Enterprise Workload System*, *Enterprise Identity & Federation System*).  
  - Collapsing multi-capability initiatives into a single monolithic System container is strictly prohibited.  
- **Nested Containment (Systems & Capabilities):**  
  - Outer boundaries must be defined as `"type": "SYSTEM"`.  
  - Inner boundaries must be defined as `"type": "CAPABILITY"` and explicitly reference their parent container using `"parent_container": "<system_id>"`.  
- **Zero-Connector Zones (Capabilities):**  
  - Capability containers represent logical groupings, contain zero operational tools, and act as Zero-Connector Zones.  
  - No connector edge may attach to or emanate from a `"type": "CAPABILITY"` container.  
- **Connected Tools Mandate & Quarantined Tool Exclusion Rule:**  
  - Every operational tool on the canvas must declare its `"type"` (`INTERNAL` or `EXTERNAL`) and participate in at least one connector edge.  
  - Tools undergoing deprecation or Proof-of-Concept (POC) quarantine that have no active network routing, coexistence shims, or fallback routes MUST NOT be placed on the Slide 8 diagram canvas as orphaned blocks.  
  - Disconnected decommissioned tools (e.g., Island Secure Browser) must be documented exclusively in the Slide 5 Technology Inventory table and the Slide 8 narrative notes, rather than rendered as unattached nodes.  
- **Corridor Routing Channels & Text Clearance:**  
  - Connectors between operational tools must route along dedicated horizontal and vertical routing channels using orthogonal elbow routing.  
  - Layout engines must allocate at least **\$65\\text{ px}\$** edge-to-edge spacing and **\$85\\text{ px}\$** edge-to-node spacing.  
  - Parallel connector labels must be staggered along lines (\$location: 0.35, 0.50, 0.65\$) to ensure text blocks never collide.  
  - Connectors must **never slice through the bounding box or title strip of an unrelated SYSTEM or CAPABILITY container**.  
- **Discrete Protocol Connectors:**  
  - Separate operational interactions (e.g., identity token assertion vs. raw application ingress) between the same components must use distinct connector lines with clear, independent labels.  
- **Standalone Tool Placement:**  
  - **Internal Tools:** 100% of internal Costco tools, compute nodes, and datastores sit standalone OUTSIDE systems and capabilities at the root canvas level (`"parent_container": null` and `"type": "INTERNAL"`).  
  - **External Tools:** All third-party SaaS, external vendor suites, and partner directories declare `"type": "EXTERNAL"` and sit standalone at root (`"parent_container": null`).  
- **Exhaustive Instance Connector Mapping:**  
  - Every Enterprise System must contain at least one Capability and project at least one outward instance edge (`"source": "<system_id>"`, `"target": "<tool_id>"`, `"label": "Instance"`, `"type": "instance"`) targeting the primary standalone tool or controller that implements its capabilities.  
  - Instance edges must never target containers, and connectors must never point into a SYSTEM.  
- **Destination Workload & Ingress Termination Invariant:**  
  - Ingress controllers, proxies, and edge gateways must route directly to destination application nodes—such as *Internal Web Applications*, *Microservices*, or *Corporate SaaS Suites*.  
  - Edge gateways must NEVER terminate solely into a datastore, database, or SIEM repository. SIEM platforms must be modeled as auxiliary asynchronous telemetry sinks receiving event streams.  
- **Transitive Edge Elimination Rule:**  
  - Prohibit bypass line crossings. If Tool A connects to Tool B, and Tool B connects to Tool C, do not declare a direct connector from Tool A to Tool C.  
- **State Deltas (The Red Circle Rule):**  
  - **Slide 7 (Current Baseline):** 100% of operational nodes must declare `"delta_flag": "Neutral"`.  
  - **Slide 8 (Interim State):** Apply `"delta_flag": "Changing"` EXCLUSIVELY to modified tools, transitional reverse proxies, or pilot deployments. Phased-out legacy tools that participate in fallback routing declare `"delta_flag": "Retiring"` (rendered with a dashed gray border). Unaltered baseline components declare `"delta_flag": "Neutral"`.  
  - **Slide 9 (Target State):** Apply `"delta_flag": "Adding"` EXCLUSIVELY to net-new target platforms, services, and authoritative stores. Surviving baseline tools declare `"delta_flag": "Neutral"`. Decommissioned legacy components (and `"Retiring"` flags) are completely omitted from Slide 9\.

---

### Slide 10: System Deployment (Spatial Hosting Containment)

- **Topological Invariant:**  
  - Strict 2-tier nested containment hierarchy mapping physical and cloud infrastructure without logical connectors.  
- **Zero-Line Mandate:**  
  - The diagram MUST strictly submit an empty connectors array (`"connectors": []`).  
  - Logical interaction lines, network routes, and data flows are strictly prohibited on Slide 10\.  
- **Two-Tier Spatial Hierarchy:**  
  - **Tier 1 (Macro Environments):** Root-level containers defining execution boundaries (`"type": "MACRO_ENV"`), such as *Workforce Endpoint Fleet*, *Google Cloud Platform (GCP)*, *Enterprise SaaS Ecosystem*, and *Costco Corporate Facilities (WDC/QDC)*.  
  - **Tier 2 (Locations):** Nested boundary containers (`"type": "LOCATION"`, `"parent_container": "<macro_env_id>"`) representing cloud regions, availability zones, data center facilities, or endpoint device profiles.  
- **Balanced Row-Packed Spatial Architecture (Costco CSA Template v4 Alignment):**  
  - Deployment topologies are packed into balanced 16:9 rows, as in Costco CSA Template v4, rather than elongated single-row horizontal strips. Wide environments (such as a SaaS location) take a full row; smaller ones share the row below. Tools inside a Location form a uniform grid of up to 3 columns. The `quadrant` attribute sets the reading order (TL, TR, BL, BR):  
    - **Top-Left Quadrant (`quadrant: "TL"`):** *Workforce Endpoint Fleet* containing Location profiles for Corporate Workstations and Workforce BYOD Devices.  
    - **Top-Right Quadrant (`quadrant: "TR"`):** *Google Cloud Platform (GCP)* or *Microsoft Azure* containing regional VPCs, edge points of presence, and control plane Locations.  
    - **Bottom-Left Quadrant (`quadrant: "BL"`):** *Costco Corporate Facilities* containing Production Data Center Locations (WDC/QDC).  
    - **Bottom-Right Quadrant (`quadrant: "BR"`):** *Enterprise SaaS Ecosystem* containing Multi-Tenant Cloud Service Locations.  
  - Macro Environment containers should declare the `"quadrant"` attribute (`"TL" | "TR" | "BL" | "BR"`) to fix their order in the packing.  
- **Container Header Clearance Formula:**  
  - Location and Macro Environment containers must size their width to accommodate title strings without truncation: \$\$W\_{\\min} \= \\min(600, \\max(280, \\text{longestLine} \\times 9.5 \+ 64))\$\$  
  - Child tools packed inside Location containers must not force container dimensions below \$W\_{\\min}\$, guaranteeing that slide prints never trigger geometry cut-off warnings.  
- **Exhaustive Spatial Placement:**  
  - 100% of participating operational tools and datastores must be nested inside a Tier-2 LOCATION container (`"parent_container": "<loc_id>"`).  
  - Tools must never sit unparented at the root canvas level or directly inside a Tier-1 MACRO\_ENV container on Slide 10\.  
- **No Orphaned or Empty Containers:**  
  - Only MACRO\_ENV and LOCATION containers are permitted on Slide 10\.  
  - Every Tier-1 container must hold at least one Tier-2 container, and every Tier-2 container must hold at least one operational tool node. Empty containers are strictly prohibited.

---

### Slide 11: Information Flow (Chronological Execution Cascade)

* **Topological Invariant:**  
    
  * Sequential execution pipeline tracking a chronological transaction cascade from initial client invocation to persistent storage and security telemetry.


* **Strict Contiguous Hop Continuity Rule:**  
    
  * Connectors must form a single, contiguous hop-to-hop transaction chain without parallel multi-cast splits or backward jumps.  
  * Step continuity requires that the source of Step \$N+1\$ MUST match the target of Step \$N\$ (\$Source\_{Step\_{N+1}} \\equiv Target\_{Step\_N}\$) along the primary execution pipeline.  
  * Parallel branching (e.g., an edge gateway splitting simultaneously into internal workloads and external SaaS endpoints on the same step number) is strictly prohibited. Secondary or divergent paths must be collapsed into the primary transaction sequence or documented in subsequent steps.  
  * Asynchronous audit telemetry streaming to SIEM or message brokers (e.g., Google Security Operations / GCP Pub/Sub) MUST NOT originate from upstream client browsers. Telemetry must originate from the terminal processing workload or service as the final chronological step (\$Step\_{max}\$).


* **Authoritative SoR Cylinder Exclusivity Rule:**  
    
  * The Database Cylinder shape primitive (`DatabaseBlock`) is strictly reserved for nodes declaring `"is_sor": true`.  
  * Declaring `"is_sor": true` triggers the rendering engine to format the node as a database cylinder, apply light yellow styling (`#FFF2CC` / `#F2C14E`), and dynamically append `\n(SoR)` to the label.  
  * Client browser profiles, edge proxies, ingress gateways, and compute runtimes that manage local caches or sandboxes MUST declare `"is_sor": false` (or omit the property).  
  * Solution Architects and generator pipelines must avoid using datastore terminology (`Database`, `DB`, `Datastore`, `Data Lake`, `Cache`) in the labels or technology properties of client runtimes to prevent visual shape misclassifications.


* **Persistence Tool Containment:**  
  * Host persistence platforms act as boundary containers (`"type": "HOST"`).  
  * Authoritative stateful datastores and SIEM audit repositories must be nested strictly inside their parent host container (`"parent_container": "<host_id>"`).  
  * Authoritative stateful datastores and SIEM audit repositories must be nested strictly inside their parent host container (`"parent_container": "<host_id>"`)\[cite: 9\].  
  * No `HOST` container may be empty.


* **1:1 Numbered Parity & Connector Labels:**  
    
  * The `connectors` array must include `"stepNumber": N` in ascending order starting at 1 with zero numerical gaps and zero duplicate numbers.  
  * Each connector label must strictly prefix `"Step N: "` matching its numerical `stepNumber`.  
  * All connector descriptions must incorporate explicit newline delimiters (`\n`) to ensure that no single line exceeds 25 characters (e.g., `"Step 3: Context Policy\nInjection & Tunnel"`, `"Step 5: ACID Commit\nto Authoritative SoR"`).  
  * Connector steps must maintain strict 1:1 parity with the narrative step bullets in Deliverable 1 and Deliverable 2 of the CSA Blueprint Specification.


* **Full Node Participation:**  
    
  * Every operational node and datastore on Slide 11 must take part in at least one transaction step.

