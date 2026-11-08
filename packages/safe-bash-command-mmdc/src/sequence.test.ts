import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  layoutMermaid,
  parseMermaid,
  renderMermaidPng,
  renderMermaidSvg,
  verifySceneGeometry
} from "./index.js";

const SEQUENCE_FIXTURES: Record<string, string> = {
  "sequence-participants-messages": `sequenceDiagram
    actor User as End User
    participant Edge as API Gateway
    participant Auth as Auth Service
    participant DB as Primary DB
    User->>Edge: POST /v1/checkout
    Edge->>Auth: Verify JWT Token
    Auth-->>Edge: Claims Valid (200 OK)
    Edge->>DB: INSERT Order Record
    DB-->>Edge: Committed (#4821)
    Edge-->>User: 201 Created
  `,
  "sequence-activations-self": `sequenceDiagram
    participant Client as Web Client
    participant Worker as Job Worker
    participant Cache as Redis Cache
    Client->>+Worker: Enqueue Render Job
    Worker->>Worker: Validate & Normalize AST
    Worker->>+Cache: Acquire Distributed Lock
    Cache-->>-Worker: Lock Token Granted
    Worker->>Worker: Compute Subpixel Layout
    Worker-->>-Client: Signed Asset URL
  `,
  "sequence-alt-loop-opt-notes": `sequenceDiagram
    participant CLI as mmdc CLI
    participant Parser as Scanner & Parser
    participant Layout as Sugiyama Engine
    Note over CLI,Parser: Zero-DOM Deterministic Pipeline
    CLI->>Parser: parseMermaid(source)
    alt Valid Grammar
      Parser-->>CLI: MermaidDocument AST
      loop Orthogonal Pass (1..4)
        CLI->>Layout: minimizeCrossings()
        Layout-->>CLI: Ranked Coordinates
      end
      opt PNG Output Requested
        Note right of Layout: 4x4 Analytic Supersampling
        CLI->>Layout: rasterizeScene(scale=2)
      end
    else Syntax Error
      Parser--xCLI: MermaidError (E_SYNTAX)
    end
  `
};

describe("sequenceDiagram parser, layout, and geometry invariants", () => {
  for (const [name, source] of Object.entries(SEQUENCE_FIXTURES)) {
    it(`parses, lays out, and satisfies all geometric invariants for ${name}`, () => {
      const doc = parseMermaid(source);
      assert.equal(doc.family, "sequence");
      for (const mode of ["light", "dark"] as const) {
        const scene = layoutMermaid(doc, { theme: mode });
        const check = verifySceneGeometry(scene);
        assert.equal(
          check.ok,
          true,
          `Geometry violations for ${name} (${mode}): ${check.violations.join("; ")}`
        );
        const svgRes = renderMermaidSvg(source, { theme: mode });
        assert.ok(svgRes.svg.includes("<svg"));
        const pngRes = renderMermaidPng(source, { theme: mode, scale: 2 });
        assert.ok(pngRes.png.byteLength > 100);
      }
    });
  }
});


describe("sequence participant arrow boundaries", () => {
  for (const source of ["service-x", "service-X", "api-xml", "api-XML"]) {
    for (const arrow of ["->>", "-->>", "->", "-->", "->>+", "-->>-"]) {
      it(`preserves ${source} with ${arrow}`, () => {
        const doc = parseMermaid(`sequenceDiagram\n${source}${arrow}service-y: call`);
        assert.deepEqual(doc.nodes.map(node => node.id), [source, "service-y"]);
        assert.equal(doc.edges[0]?.from, source);
        assert.equal(doc.edges[0]?.to, "service-y");
        assert.notEqual(doc.edges[0]?.endMarker, "cross");
      });
    }
  }
  for (const arrow of ["-x", "-X", "--x", "--X", "-x+", "--x-"]) {
    it(`retains cross arrow ${arrow}`, () => {
      const doc = parseMermaid(`sequenceDiagram\nA${arrow}B: call ->> later`);
      assert.deepEqual(doc.nodes.map(node => node.id), ["A", "B"]);
      assert.equal(doc.edges[0]?.endMarker, "cross");
    });
  }
});
