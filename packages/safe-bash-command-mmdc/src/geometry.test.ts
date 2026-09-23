import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { verifySceneGeometry } from "./geometry.js";
import { layoutMermaid } from "./layout.js";
import { parseMermaid } from "./parser.js";

export const FLOWCHART_FIXTURES: Readonly<Record<string, string>> = Object.freeze({
  "flowchart-basic": `
    flowchart TD
      Start([Client Request]) --> Gateway[API Gateway]
      Gateway --> Auth{Valid Token?}
      Auth -->|Authorized| Service(Order Service)
      Auth -.->|Rejected| Denied([401 Unauthorized])
      Service ==> Database[(Primary Ledger)]
  `,
  "flowchart-directions-lr": `
    flowchart LR
      Ingest([Raw Events]) --> Validate{Schema OK?}
      Validate -->|Valid| Enrich[Enrich Payload]
      Validate -.->|Invalid| DLQ(Dead Letter Queue)
      Enrich --> Store[(Warehouse)]
  `,
  "flowchart-directions-bt": `
    flowchart BT
      Hardware[Physical Hosts] --> Runtime(Container Runtime)
      Runtime --> Mesh[Service Mesh]
      Mesh --> Edge([Public Ingress])
  `,
  "flowchart-directions-rl": `
    flowchart RL
      Output([Published Artifact]) --> Sign[Cryptographic Signer]
      Sign --> Build(Compile Workspace)
      Build --> Source[Git Checkout]
  `,
  "flowchart-cycles-backedges": `
    flowchart TB
      Init([Start Job]) --> Fetch[Fetch Batch]
      Fetch --> Process(Transform Records)
      Process --> Check{All Succeeded?}
      Check -->|Retry Failed| Fetch
      Check -->|Needs Re-init| Init
      Check -->|Complete| Done([Job Finished])
  `,
  "flowchart-self-loop-parallel": `
    flowchart LR
      Worker[Queue Worker] -->|Poll Tick| Worker
      Worker -->|Heartbeat| Monitor(Health Monitor)
      Worker -.->|Metrics| Monitor
      Monitor -->|Ack| Ready([Active Pool])
  `,
  "flowchart-nested-subgraphs": `
    flowchart TB
      subgraph Cloud [Cloud Region us-west]
        subgraph EdgeZone [Public Edge Zone]
          CDN[Edge CDN] --> WAF(Web Firewall)
        end
        subgraph PrivateZone [Private App Zone]
          API[App Server] --> Cache[(Redis Cache)]
        end
        WAF -->|Forwarded| API
      end
      Client([Browser Client]) --> CDN
  `,
  "flowchart-unicode-multiline": `
    flowchart LR
      Start(["開始 / Start<br/>αβγ — Δ=0"]) --> Check{"検証 OK?<br/>Status ≥ 200"}
      Check -->|はい / Yes| Success["完了 • Ready<br/>Latency ≤ 12ms"]
      Check -.->|いいえ / No| Fallback("再試行 / Retry")
  `
});

describe("geometry invariants and flowchart layout/routing", () => {
  for (const [name, source] of Object.entries(FLOWCHART_FIXTURES)) {
    it(`satisfies all 5 geometric invariants for ${name}`, () => {
      const doc = parseMermaid(source);
      const scene = layoutMermaid(doc, { theme: "light" });
      const report = verifySceneGeometry(scene);
      assert.equal(
        report.ok,
        true,
        `Geometry invariant failures in ${name}:\n${report.violations.join("\n")}`
      );
      assert.ok(scene.width > 100 && scene.height > 80);
      assert.equal(scene.padding, 32);
    });
  }
});
