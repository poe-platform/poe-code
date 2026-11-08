import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { verifySceneGeometry } from "./geometry.js";
import { layoutMermaid } from "./layout.js";
import { parseMermaid } from "./parser.js";

export const FLOWCHART_FIXTURES: Readonly<Record<string, string>> = Object.freeze({
  "flowchart-skip-rank-obstacle": `
    flowchart TD
      subgraph Edge ["Edge Layer"]
        Client(["Client App"]) -- HTTPS --> WAF{"WAF & Rate Limit"}
        WAF --> GW["API Gateway"]
      end
      GW -- gRPC --> Auth
      subgraph Core ["Core Services"]
        Auth{"Token Valid?"} -- Yes --> DB[("Order DB")]
        Auth -- No --> Audit["Audit Logger"]
        DB -. Event .-> Audit
      end
  `,
  "flowchart-lr-backedge-column-obstacle": `
    flowchart LR
      Ingest(["Ingest Δt ≤ 5ms"]) --> Check{"Schema OK?"}
      Check -- Valid --> Commit["Commit 完了"]
      Check -- Retry --> Backoff["Exponential Backoff<br/>λ = 2^k · 100ms"]
      Backoff --> Ingest
  `,
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
  it("wraps long prose without losing text or making excessively wide nodes", () => {
    const label = "A long sentence with multiple words ".repeat(12).trim();
    const scene = layoutMermaid(parseMermaid(`flowchart TD\n A["${label}"] --> B[Done]`));
    const node = scene.nodes.find((entry) => entry.id === "A")!;
    assert.ok(node.width <= 288, `node width ${node.width}`);
    assert.ok(node.lines.length > 1);
    assert.equal(node.lines.map((line) => line.text).join(" "), label);
    assert.deepEqual(verifySceneGeometry(scene).violations, []);
  });

  it("renders wrapped class titles inside the measured header", () => {
    const label = "ExtremelyLongClassName".repeat(12);
    const scene = layoutMermaid(parseMermaid(`classDiagram\n class ${label}`));
    const node = scene.nodes[0]!;
    assert.ok(node.lines.length > 1);
    assert.equal(node.lines.map((line) => line.text).join(""), label);
    for (const line of node.lines) assert.ok(line.width <= node.width - 36);
  });

  it("centers fan-out and fan-in and gives every connector a distinct perimeter port", () => {
    for (const direction of ["TD", "BT", "LR", "RL"]) {
      const source = `flowchart ${direction}\n` + Array.from({ length: 12 }, (_, i) =>
        `Root -->|Route ${i}| N${i}[Worker ${i}]\nN${i} --> Sink`).join("\n");
      const scene = layoutMermaid(parseMermaid(source));
      const horizontal = direction === "LR" || direction === "RL";
      const center = (node: typeof scene.nodes[number]): number => horizontal ? node.y + node.height / 2 : node.x + node.width / 2;
      const workers = scene.nodes.filter((node) => node.id.startsWith("N"));
      const mean = workers.reduce((sum, node) => sum + center(node), 0) / workers.length;
      for (const id of ["Root", "Sink"]) {
        assert.ok(Math.abs(center(scene.nodes.find((node) => node.id === id)!) - mean) <= 1, `${direction} ${id} is off-center`);
      }
      const incoming = scene.edges.filter((edge) => edge.to === "Sink");
      assert.equal(new Set(incoming.map((edge) => JSON.stringify(edge.points.at(-1)))).size, 12, `${direction} reused sink ports`);
      for (const edge of scene.edges) {
        if (!edge.labelPill) continue;
        const center = { x: edge.labelPill.x + edge.labelPill.width / 2, y: edge.labelPill.y + edge.labelPill.height / 2 };
        let distance = Infinity;
        for (let i = 0; i + 1 < edge.points.length; i++) {
          const a = edge.points[i]!;
          const b = edge.points[i + 1]!;
          const x = Math.max(Math.min(a.x, b.x), Math.min(Math.max(a.x, b.x), center.x));
          const y = Math.max(Math.min(a.y, b.y), Math.min(Math.max(a.y, b.y), center.y));
          distance = Math.min(distance, Math.hypot(center.x - x, center.y - y));
        }
        assert.ok(distance <= 1, `${direction} detached edge label ${edge.id}: ${distance}px`);
      }
      for (let i = 0; i < scene.edges.length; i++) {
        for (const other of scene.edges.slice(i + 1)) {
          const edge = scene.edges[i]!;
          for (let a = 0; a + 1 < edge.points.length; a++) {
            for (let b = 0; b + 1 < other.points.length; b++) {
              const p = edge.points[a]!;
              const q = edge.points[a + 1]!;
              const u = other.points[b]!;
              const v = other.points[b + 1]!;
              const horizontalOverlap = p.y === q.y && u.y === v.y && p.y === u.y
                ? Math.min(Math.max(p.x, q.x), Math.max(u.x, v.x)) - Math.max(Math.min(p.x, q.x), Math.min(u.x, v.x)) : 0;
              const verticalOverlap = p.x === q.x && u.x === v.x && p.x === u.x
                ? Math.min(Math.max(p.y, q.y), Math.max(u.y, v.y)) - Math.max(Math.min(p.y, q.y), Math.min(u.y, v.y)) : 0;
              assert.ok(Math.max(horizontalOverlap, verticalOverlap) <= 8, `${direction} shared tracks on ${edge.id} and ${other.id}`);
            }
          }
        }
      }
      assert.deepEqual(verifySceneGeometry(scene).violations, []);
    }
  });

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
