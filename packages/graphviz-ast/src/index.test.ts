import { describe, expect, it } from "vitest";
import { parseDot, serializeDot, layoutGraph, renderSvg, optimizeSvg } from "./index.js";

describe("DOT syntax and semantics", () => {
  it("round trips clusters, chains, defaults, ports and HTML labels", () => {
    const graph = parseDot(`strict digraph "demo graph" {
      // defaults are scoped
      node [shape=box]; edge [color=blue];
      subgraph cluster_a { label="Group"; a [label=<<table><tr><td>A</td></tr></table>>]; b; }
      a:out:ne -> b:sw -> "c d" [weight=2][color="#ff0000"];
      { rank=same; b; "c d"; }
    }`);
    expect(graph.strict).toBe(true);
    expect(parseDot(serializeDot(graph))).toEqual(graph);
    const layout = layoutGraph(graph);
    expect(layout.nodes.map((n) => n.id).sort()).toEqual(["a", "b", "c d"]);
    expect(layout.edges).toHaveLength(2);
    expect(layout.clusters).toHaveLength(1);
    expect(layout.nodes.find((n) => n.id === "b")?.rank).toBe(
      layout.nodes.find((n) => n.id === "c d")?.rank
    );
  });
  it("expands subgraph endpoints, applies defaults at declaration time and merges strict duplicates", () => {
    const layout = layoutGraph(
      parseDot(
        `strict graph { node [color=red]; a; node [color=blue]; b; {a b} -- {c d}; a -- c [label=x]; }`
      )
    );
    expect(layout.edges).toHaveLength(4);
    expect(layout.nodes.find((n) => n.id === "a")?.attributes.color).toBe("red");
    expect(layout.nodes.find((n) => n.id === "b")?.attributes.color).toBe("blue");
    expect(layout.edges.find((e) => e.tail.id === "a" && e.head.id === "c")?.attributes.label).toBe(
      "x"
    );
  });
  it("handles comments, escaped strings, concatenation and numeric IDs", () => {
    const graph = parseDot(
      'graph { /* comment */ -1.5 -- .2; "a" + "b" [label="a\\"b\\nline"]; # comment\n }'
    );
    expect(parseDot(serializeDot(graph))).toEqual(graph);
  });
  it.each([
    "digraph { a -- b }",
    "graph { a -> b }",
    "digraph { a [x=] }",
    "digraph { a",
    "digraph { a } junk",
    'digraph { a [label="bad] }'
  ])("rejects malformed DOT: %s", (source) => expect(() => parseDot(source)).toThrow(SyntaxError));
});

describe("layered graph geometry", () => {
  it("removes cycles while retaining original edge direction and routes self loops", () => {
    const layout = layoutGraph(parseDot("digraph { a -> b -> c -> a; b -> b; }"));
    expect(layout.edges.some((e) => e.reversed)).toBe(true);
    for (const edge of layout.edges) {
      expect(edge.points.length).toBeGreaterThanOrEqual(2);
      expect(edge.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
    }
    expect(layout.edges.find((e) => e.tail.id === e.head.id)?.path).toContain("C");
  });
  it.each(["TB", "BT", "LR", "RL"])("orients ranks in %s with nonoverlapping nodes", (rankdir) => {
    const layout = layoutGraph(parseDot(`digraph { rankdir=${rankdir}; a -> b -> c; a -> d; }`));
    const a = layout.nodes.find((n) => n.id === "a")!;
    const c = layout.nodes.find((n) => n.id === "c")!;
    expect(
      rankdir === "TB"
        ? c.y > a.y
        : rankdir === "BT"
          ? c.y < a.y
          : rankdir === "LR"
            ? c.x > a.x
            : c.x < a.x
    ).toBe(true);
    for (const n of layout.nodes)
      for (const m of layout.nodes)
        if (n.id < m.id) {
          expect(
            Math.abs(n.x - m.x) >= (n.width + m.width) / 2 ||
              Math.abs(n.y - m.y) >= (n.height + m.height) / 2
          ).toBe(true);
        }
  });
  it.each(["same", "min", "max", "source", "sink"])("honors rank=%s", (rank) => {
    const l = layoutGraph(parseDot(`digraph { a -> b -> c; {rank=${rank}; a; c;} }`));
    expect(l.nodes.find((n) => n.id === "a")!.rank).toBe(l.nodes.find((n) => n.id === "c")!.rank);
    if (rank === "min" || rank === "source")
      expect(l.nodes.find((n) => n.id === "a")!.rank).toBe(0);
    if (rank === "max" || rank === "sink")
      expect(l.nodes.find((n) => n.id === "a")!.rank).toBe(Math.max(...l.nodes.map((n) => n.rank)));
  });
  it.each(["true", "ortho", "polyline", "line", "none"])("routes splines=%s", (splines) => {
    const l = layoutGraph(parseDot(`digraph { splines=${splines}; a -> b -> c; a:e -> c:w; }`));
    const e = l.edges[2]!;
    if (splines === "none") expect(e.path).toBe("");
    else if (splines === "true") expect(e.path).toContain("C");
    else expect(e.path).toContain("L");
    if (splines === "ortho")
      for (let i = 1; i < e.points.length; i++) {
        expect(e.points[i]!.x === e.points[i - 1]!.x || e.points[i]!.y === e.points[i - 1]!.y).toBe(
          true
        );
      }
  });
  it("uses dimension and spacing attributes, margins, padding and text metrics", () => {
    const small = layoutGraph(parseDot('digraph { a [label="iii"]; b [label="WWW"]; a -> b; }'));
    const big = layoutGraph(
      parseDot(
        'digraph { nodesep=2; ranksep=2; margin=1; pad=1; a [label="iii"]; b [label="WWW"]; a -> b; }'
      )
    );
    expect(big.height).toBeGreaterThan(small.height);
    expect(
      layoutGraph(parseDot('graph { a [label="iiiiiiiiiiii"]; b [label="WWWWWWWWWWWW"]; }'))
        .nodes[1]!.width
    ).toBeGreaterThan(
      layoutGraph(parseDot('graph { a [label="iiiiiiiiiiii"]; b [label="WWWWWWWWWWWW"]; }'))
        .nodes[0]!.width
    );
  });
});

describe("SVG output", () => {
  it.each([
    "box",
    "rect",
    "rectangle",
    "ellipse",
    "oval",
    "circle",
    "doublecircle",
    "diamond",
    "plaintext",
    "none",
    "record",
    "Mrecord",
    "cylinder",
    "folder",
    "component",
    "note",
    "tab"
  ])("renders %s deterministically", (shape) => {
    const graph = parseDot(
      `digraph { subgraph cluster_a { label="Cluster"; a [shape=${shape}, label="A & B"]; } a -> b; }`
    );
    const svg = renderSvg(layoutGraph(graph));
    expect(svg).toBe(renderSvg(layoutGraph(graph)));
    for (const klass of ["graph", "cluster", "node", "edge"])
      expect(svg).toContain(`class="${klass}"`);
    expect(svg).toContain("<polygon");
    expect(svg).toContain("A &amp; B");
    expect(svg).not.toContain("NaN");
  });
  it("escapes arbitrary labels and renders HTML and record label content", () => {
    const svg = renderSvg(
      layoutGraph(
        parseDot(
          'digraph { a [label=<<table><tr><td>Hello</td><td>World</td></tr></table>>]; b [shape=record,label="{left|<p>right}"]; a -> b:p; }'
        )
      )
    );
    expect(svg).toContain("Hello");
    expect(svg).toContain("World");
    expect(svg).toContain("right");
    expect(svg).not.toContain("<table>");
  });
  it("optimizes parsed SVG without corrupting text, transforms, IDs or namespaces", () => {
    const source =
      '<svg xmlns="http://www.w3.org/2000/svg" width="100px" height="50px"><!--x--><metadata>secret</metadata><g><g id="keep"><path d="M 0.123456 0 L 10.123456 0 L 10.123456 20 Z"/></g></g><text>1.234567 &amp; 2</text></svg>';
    const result = optimizeSvg(source, { precision: 2 });
    expect(result).not.toContain("metadata");
    expect(result).not.toContain("<!--");
    expect(result).toContain('viewBox="0 0 100 50"');
    expect(result).toContain('id="keep"');
    expect(result).toContain("1.234567 &amp; 2");
    expect(result).toContain("H");
    expect(result).toContain("V");
    expect(result.length).toBeLessThan(source.length);
    expect(optimizeSvg(result, { precision: 2 })).toBe(result);
    expect(() => optimizeSvg("<svg><g></svg>")).toThrow();
  });
  it("normalizes whitespace in viewBox and preserves relative path semantics", () => {
    const result = optimizeSvg(
      '<svg viewBox="0,\t0\n100.12345 50"><path d="m 10 10 l 5 0 l 0 5 c 1 2 3 4 5 6 z"/><g transform="translate(1.12345 2.54321)"><text>unchanged</text></g></svg>',
      { precision: 2 }
    );
    expect(result).toContain('viewBox="0 0 100.12 50"');
    expect(result).toContain('d="m10 10H15V15c1 2 3 4 5 6Z"');
    expect(result).toContain('transform="translate(1.12 2.54)"');
  });
});
