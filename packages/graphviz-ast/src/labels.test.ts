import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { layoutGraph, parseDot, renderSvg } from "./index.js";
import { labelLines, textWidth } from "./metrics.js";

const bounds = (label: string, x: number, y: number, size = 14) => {
  const lines = labelLines(label);
  return {
    x,
    y,
    width: Math.max(...lines.map((line) => textWidth(line, size))),
    height: lines.length * size * 1.2
  };
};
const overlaps = (a: ReturnType<typeof bounds>, b: ReturnType<typeof bounds>) =>
  Math.abs(a.x - b.x) < (a.width + b.width) / 2 && Math.abs(a.y - b.y) < (a.height + b.height) / 2;

describe("edge label clearance", () => {
  it.each(["TB", "BT", "LR", "RL"])(
    "keeps multiline labels clear of nodes, labels and canvas edges in %s",
    (rankdir) => {
      const graph = layoutGraph(
        parseDot(`digraph { rankdir=${rankdir}; ranksep=0.1; node [shape=box];
      a -> b [label="no break\\nnext meeting"]; a -> c [label="overlap: 3–3:30"];
      a -> d [label="follow-ups"]; b -> e [label="a longer description"]; a -> e [label="skip"];
    }`)
      );
      const labels = graph.edges.map((edge) =>
        bounds(edge.attributes.label!, edge.label.x, edge.label.y)
      );
      for (const label of labels) {
        for (const node of graph.nodes) expect(overlaps(label, node)).toBe(false);
        for (const other of labels) if (other !== label) expect(overlaps(label, other)).toBe(false);
        expect(label.x - label.width / 2).toBeGreaterThanOrEqual(0);
        expect(label.y - label.height / 2).toBeGreaterThanOrEqual(0);
        expect(label.x + label.width / 2).toBeLessThanOrEqual(graph.width);
        expect(label.y + label.height / 2).toBeLessThanOrEqual(graph.height);
      }
    }
  );
  it("places vertical chain labels beside the connector in the gap", () => {
    const graph = layoutGraph(parseDot('digraph { a -> b [label="no break"]; }'));
    const edge = graph.edges[0]!;
    const label = bounds(edge.attributes.label!, edge.label.x, edge.label.y);
    expect(label.x - label.width / 2).toBeGreaterThan(edge.points[0]!.x);
    expect(label.y).toBeCloseTo((edge.points[0]!.y + edge.points.at(-1)!.y) / 2);
    const svg = renderSvg(graph);
    expect(svg).toContain(`y="${Math.round((edge.label.y + 14 * 0.35) * 1000) / 1000}"`);
  });
});

it("preserves straight-line routing when labels reserve space", () => {
  const graph = layoutGraph(
    parseDot('digraph { splines=line; a -> b [label="one"]; a -> c [label="two"]; }')
  );
  for (const edge of graph.edges) expect(edge.points).toHaveLength(2);
});

it.each(["TB", "LR"])("reserves a separate lane for each fan-out label in %s", (rankdir) => {
  const graph = layoutGraph(
    parseDot(
      `digraph {rankdir=${rankdir}; node [shape=box]; edge [label="no break\\nnext meeting"]; a -> b; a -> c; a -> d;}`
    )
  );
  for (const edge of graph.edges) {
    const label = bounds(edge.attributes.label!, edge.label.x, edge.label.y);
    const point = edge.points[Math.floor(edge.points.length / 2)]!;
    if (rankdir === "TB") {
      expect(label.x - label.width / 2).toBeGreaterThan(point.x);
      expect(label.y).toBe(point.y);
    } else {
      expect(label.y + label.height / 2).toBeLessThan(point.y);
      expect(label.x).toBe(point.x);
    }
  }
});

it.each(["TB", "BT", "LR", "RL"])(
  "keeps spline strokes outside multiline fan-out labels in %s",
  (rankdir) => {
    const graph = layoutGraph(
      parseDot(
        `digraph {rankdir=${rankdir}; node [shape=box]; edge [label="no break\\nnext meeting"]; a -> b; a -> c; a -> d;}`
      )
    );
    const labels = graph.edges.map((e) => bounds(e.attributes.label!, e.label.x, e.label.y));
    for (const edge of graph.edges) {
      const commands = edge.path.split("C");
      let start = commands.shift()!.slice(1).split(",").map(Number);
      for (const command of commands) {
        const [c1, c2, end] = command.split(" ").map((p) => p.split(",").map(Number));
        for (let i = 0; i <= 20; i++) {
          const t = i / 20,
            u = 1 - t;
          const point = {
            x:
              u ** 3 * start[0]! +
              3 * u * u * t * c1![0]! +
              3 * u * t * t * c2![0]! +
              t ** 3 * end![0]!,
            y:
              u ** 3 * start[1]! +
              3 * u * u * t * c1![1]! +
              3 * u * t * t * c2![1]! +
              t ** 3 * end![1]!,
            width: 1,
            height: 1
          };
          for (const label of labels) expect(overlaps(point, label)).toBe(false);
        }
        start = end!;
      }
    }
  }
);

it.each(["polyline", "line", "ortho"])("keeps %s fan-out strokes out of labels", (splines) => {
  const graph = layoutGraph(
    parseDot(
      `digraph {rankdir=LR; splines=${splines}; edge [label="follow-ups"]; a -> b; a -> c; a -> d;}`
    )
  );
  for (const edge of graph.edges) {
    for (let j = 1; j < edge.points.length; j++) {
      const a = edge.points[j - 1]!,
        b = edge.points[j]!;
      for (let k = 0; k <= 100; k++) {
        const point = {
          x: a.x + ((b.x - a.x) * k) / 100,
          y: a.y + ((b.y - a.y) * k) / 100,
          width: 0,
          height: 0
        };
        for (const other of graph.edges)
          expect(
            overlaps(point, bounds(other.attributes.label!, other.label.x, other.label.y))
          ).toBe(false);
      }
    }
  }
});

it.each(["TB", "LR"])("separates self-loop labels from other labels in %s", (rankdir) => {
  const graph = layoutGraph(
    parseDot(
      `digraph {rankdir=${rankdir}; ranksep=0.1; node [shape=box, fontsize=12]; edge [fontsize=12, label="no break\\nnext meeting"]; a [label="Intake"]; b [label="Build"]; c [label="Review"]; d [label="Publish"]; a -> a; a -> b; b -> b; c; d;}`
    )
  );
  const labels = graph.edges.map((e) => bounds(e.attributes.label!, e.label.x, e.label.y));
  for (const label of labels)
    for (const other of labels) if (label !== other) expect(overlaps(label, other)).toBe(false);
  for (const edge of graph.edges.filter((e) => e.tail.id === e.head.id)) {
    for (const p of edge.points)
      for (const node of graph.nodes.filter((n) => n.id !== edge.tail.id))
        expect(overlaps({ ...p, width: 0, height: 0 }, node)).toBe(false);
  }
});

it.each(["line", "ortho", "true"])("preserves visible self-loops with %s routing", (splines) => {
  const graph = layoutGraph(parseDot(`digraph {splines=${splines}; a -> a; a -> b; c;}`));
  const loop = graph.edges[0]!;
  expect(loop.points.length).toBeGreaterThan(2);
  for (let i = 1; i < loop.points.length; i++)
    for (let k = 0; k <= 20; k++) {
      const a = loop.points[i - 1]!,
        b = loop.points[i]!;
      for (const n of graph.nodes.filter((n) => n.id !== "a"))
        expect(
          overlaps(
            {
              x: a.x + ((b.x - a.x) * k) / 20,
              y: a.y + ((b.y - a.y) * k) / 20,
              width: 0,
              height: 0
            },
            n
          )
        ).toBe(false);
    }
});

it("keeps orthogonal self-loop segments axis aligned", () => {
  const graph = layoutGraph(parseDot("digraph {splines=ortho; a -> a;}"));
  const points = graph.edges[0]!.points;
  for (let i = 1; i < points.length; i++)
    expect(points[i]!.x === points[i - 1]!.x || points[i]!.y === points[i - 1]!.y).toBe(true);
});

it("keeps diagonal straight-edge labels close to their connectors", () => {
  const graph = layoutGraph(
    parseDot(`digraph {
    splines=line; node [shape=diamond, fontsize=12];
    edge [label="follow-ups", fontsize=12, fontname="Arial"];
    a [label="Intake"]; b [label="Build"]; c [label="Review"]; d [label="Publish"];
    a -> b; a -> c; a -> d;
  }`)
  );
  for (const edge of graph.edges) {
    const a = edge.points[0]!,
      b = edge.points[1]!;
    const distance = Math.hypot(edge.label.x - (a.x + b.x) / 2, edge.label.y - (a.y + b.y) / 2);
    expect(distance).toBeLessThan(45);
  }
});

it("reserves room beside self-loops for their labels", () => {
  const graph = layoutGraph(
    parseDot(`digraph {
    node [shape=box]; edge [label="no break\\nnext meeting"];
    a -> a; a -> b; b -> b; c;
  }`)
  );
  for (const edge of graph.edges.filter((e) => e.tail.id === e.head.id)) {
    const node = graph.nodes.find((n) => n.id === edge.tail.id)!;
    expect(Math.abs(edge.label.y - node.y)).toBeLessThan(30);
  }
});

it("keeps parallel connectors clear of neighboring disconnected nodes", () => {
  const graph = layoutGraph(
    parseDot(`digraph {
    ranksep=0.1; node [shape=box, fontsize=12];
    edge [label="no break\\nnext meeting", fontsize=12];
    a [label="Intake"]; b [label="Build"]; c [label="Review"]; d [label="Publish"];
    a -> b; a -> b; a -> b; b -> c;
  }`)
  );
  const node = graph.nodes.find((n) => n.id === "d")!;
  for (const edge of graph.edges) {
    for (let i = 1; i < edge.points.length; i++) {
      const a = edge.points[i - 1]!,
        b = edge.points[i]!;
      for (let k = 0; k <= 100; k++) {
        expect(
          overlaps(
            {
              x: a.x + ((b.x - a.x) * k) / 100,
              y: a.y + ((b.y - a.y) * k) / 100,
              width: 0,
              height: 0
            },
            node
          )
        ).toBe(false);
      }
    }
  }
});

it.each(["TB", "BT"])("renders the calendar with clear labels in %s", (direction) => {
  const fixture = readFileSync(new URL("../fixtures/calendar.dot", import.meta.url), "utf8");
  for (const multiline of [false, true]) {
    let source = fixture.replace("rankdir=TB", `rankdir=${direction}`);
    if (multiline) source = source.replace("no break", "no break\\nnext meeting");
    const defaults = { fontsize: "20", fontname: "Helvetica" };
    const graph = layoutGraph(parseDot(source), { node: defaults, edge: defaults });
    const svg = renderSvg(graph);
    for (const edge of graph.edges) {
      if (!edge.attributes.label) {
        expect(Math.abs(edge.points[0]!.y - edge.points.at(-1)!.y)).toBeLessThanOrEqual(60.001);
        continue;
      }
      const lines = labelLines(edge.attributes.label);
      const label = {
        ...edge.label,
        width: Math.max(...lines.map((line) => textWidth(line, 20, "Helvetica"))),
        height: lines.length * 24
      };
      for (const node of graph.nodes) expect(overlaps(label, node)).toBe(false);
      const left = label.x - label.width / 2;
      expect(left).toBeGreaterThanOrEqual(0);
      expect(label.x + label.width / 2).toBeLessThanOrEqual(graph.width);
      expect(label.y - label.height / 2).toBeGreaterThanOrEqual(0);
      expect(label.y + label.height / 2).toBeLessThanOrEqual(graph.height);
      for (const connector of graph.edges) {
        for (const point of connector.points) {
          expect(point.x).toBeCloseTo(connector.points[0]!.x);
          expect(left).toBeGreaterThan(point.x + 0.5);
        }
        expect(svg).toContain(`d="${connector.path}"`);
      }
      // Every polygon in this rounded-box fixture is an actual rendered arrowhead.
      for (const match of svg.matchAll(/<polygon[^>]*points="([^"]+)"/g)) {
        for (const point of match[1]!.trim().split(/\s+/)) {
          expect(left).toBeGreaterThan(Number(point.split(",")[0]) + 0.5);
        }
      }
      for (const [i, line] of lines.entries()) {
        const y = label.y + (i - (lines.length - 1) / 2) * 24 + 7;
        expect(svg).toContain(`y="${Math.round(y * 1000) / 1000}"`);
        expect(svg).toContain(`>${line}</text>`);
      }
    }
  }
});

it("keeps unlabeled calendar chains compact", () => {
  const graph = layoutGraph(parseDot("digraph { a -> b -> c -> d -> e }"));
  for (const edge of graph.edges)
    expect(Math.abs(edge.points[0]!.y - edge.points.at(-1)!.y)).toBeCloseTo(36);
});
