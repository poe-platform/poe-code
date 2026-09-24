import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MermaidError } from "./contracts.js";
import { parseMermaid } from "./parser.js";

describe("scanner and flowchart parser", () => {
  it("parses flowchart directions, node shapes, edge styles, and pipe/inline labels", () => {
    const doc = parseMermaid(`
      flowchart LR
        Start([Start Session]) --> Auth{Authenticated?}
        Auth -->|Yes| Dash[Dashboard<br/>Main View]
        Auth -. No .-> Login(Login Form)
        Login ==> Done((Complete))
    `);
    assert.equal(doc.family, "flowchart");
    assert.equal(doc.direction, "LR");
    assert.equal(doc.nodes.length, 5);

    const byId = new Map(doc.nodes.map((n) => [n.id, n]));
    assert.equal(byId.get("Start")?.shape, "stadium");
    assert.equal(byId.get("Auth")?.shape, "diamond");
    assert.equal(byId.get("Dash")?.shape, "rect");
    assert.equal(byId.get("Login")?.shape, "rounded");
    assert.equal(byId.get("Done")?.shape, "circle");

    assert.equal(doc.edges.length, 4);
    assert.equal(doc.edges[1]?.label, "Yes");
    assert.equal(doc.edges[1]?.lineStyle, "solid");
    assert.equal(doc.edges[2]?.label, "No");
    assert.equal(doc.edges[2]?.lineStyle, "dotted");
    assert.equal(doc.edges[3]?.lineStyle, "thick");
  });

  it("parses nested subgraphs and preserves parent/child membership", () => {
    const doc = parseMermaid(`
      flowchart TB
        subgraph Cloud [Production Cloud]
          subgraph VPC ["Private VPC"]
            API[API Gateway] --> DB[(Primary DB)]
          end
        end
    `);
    assert.equal(doc.groups.length, 2);
    const cloud = doc.groups.find((g) => g.id === "Cloud");
    const vpc = doc.groups.find((g) => g.id === "VPC");
    assert.ok(cloud);
    assert.ok(vpc);
    assert.equal(vpc.parentId, "Cloud");
    assert.equal(doc.nodes.find((n) => n.id === "API")?.groupId, "VPC");
  });

  it("rejects init directives, YAML frontmatter, clickable links, and invalid syntax with source spans", () => {
    assert.throws(
      () => parseMermaid(`%%{init: {'theme': 'dark'}}%%\nflowchart TD\nA --> B`),
      (err: unknown) =>
        err instanceof MermaidError && err.code === "E_UNSUPPORTED" && err.span?.line === 1
    );
    assert.throws(
      () => parseMermaid(`---\ntitle: Test\n---\nflowchart TD\nA --> B`),
      (err: unknown) =>
        err instanceof MermaidError && err.code === "E_UNSUPPORTED" && err.span?.line === 1
    );
    assert.throws(
      () => parseMermaid(`flowchart TD\nA --> B\nclick A "https://example.com"`),
      (err: unknown) =>
        err instanceof MermaidError && err.code === "E_UNSUPPORTED" && err.span?.line === 3
    );
    assert.throws(
      () => parseMermaid(`flowchart TD\nsubgraph Unclosed\nA --> B`),
      (err: unknown) => err instanceof MermaidError && err.code === "E_SYNTAX"
    );
  });
});


describe("flowchart edge and label boundaries", () => {
  for (const [operator, style, marker] of [
    ["-->", "solid", "arrow"], ["---", "solid", "none"],
    ["-.->", "dotted", "arrow"], ["-.-", "dotted", "none"],
    ["--x", "solid", "cross"], ["--o", "solid", "openArrow"],
    ["--->", "solid", "arrow"], ["-..->", "dotted", "arrow"]
  ]) {
    it(`parses unspaced ${operator} without consuming it into an identifier`, () => {
      const doc = parseMermaid(`flowchart LR\nservice-a.v1${operator}service-b.v2`);
      assert.deepEqual(doc.nodes.map(node => node.id), ["service-a.v1", "service-b.v2"]);
      assert.equal(doc.edges.length, 1);
      assert.equal(doc.edges[0]?.from, "service-a.v1");
      assert.equal(doc.edges[0]?.to, "service-b.v2");
      assert.equal(doc.edges[0]?.lineStyle, style);
      assert.equal(doc.edges[0]?.endMarker, marker);
    });
  }

  for (const shape of ["{Decision; Yes?}", "{{Decision; Yes?}}", "[Decision; Yes?]"]) {
    it(`preserves semicolons in ${shape} and pipe labels while splitting statements`, () => {
      const doc = parseMermaid(`flowchart LR; A${shape}-->|step 1; step 2|B; B-->C`);
      assert.deepEqual(doc.nodes.map(node => node.id), ["A", "B", "C"]);
      assert.equal(doc.nodes[0]?.label, "Decision; Yes?");
      assert.equal(doc.edges[0]?.label, "step 1; step 2");
      assert.equal(doc.edges.length, 2);
    });
  }

  it("does not treat pipes in node labels as edge label boundaries", () => {
    const doc = parseMermaid("flowchart LR; A{one | two; three}-->B; B-->C");
    assert.equal(doc.nodes[0]?.label, "one | two; three");
    assert.equal(doc.edges.length, 2);
  });
});
