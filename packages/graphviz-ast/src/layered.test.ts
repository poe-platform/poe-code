import { expect, it } from "vitest";
import {
  assignRanks,
  feedbackOrder,
  minimizeCrossings,
  assignCoordinates,
  type Vertex,
  type Arc
} from "./layered.js";
import { layoutGraph, parseDot } from "./index.js";

it("tightens weighted ranks beyond the longest-path solution", () => {
  const arcs = [
    { from: 0, to: 1, minlen: 1, weight: 1 },
    { from: 0, to: 2, minlen: 1, weight: 1 },
    { from: 2, to: 3, minlen: 1, weight: 10 },
    { from: 1, to: 3, minlen: 3, weight: 1 }
  ];
  const ranks = assignRanks(4, arcs, [0, 1, 2, 3]);
  expect(ranks[3]! - ranks[2]!).toBe(1);
  expect(arcs.every((e) => ranks[e.to]! - ranks[e.from]! >= e.minlen)).toBe(true);
});
it("reduces crossings and aligns a simple vertical chain", () => {
  const vertices: Vertex[] = Array.from({ length: 4 }, (_, i) => ({
    rank: Math.floor(i / 2),
    width: 50,
    height: 36,
    x: 0,
    y: 0,
    order: i % 2
  }));
  const arcs: Arc[] = [
    { from: 0, to: 3, minlen: 1, weight: 1 },
    { from: 1, to: 2, minlen: 1, weight: 1 }
  ];
  const layers = [
    [0, 1],
    [2, 3]
  ];
  minimizeCrossings(layers, vertices, arcs);
  expect(
    (vertices[0]!.order - vertices[1]!.order) * (vertices[3]!.order - vertices[2]!.order)
  ).toBeGreaterThan(0);
  assignCoordinates(layers, vertices, arcs, 18, 36);
  expect(vertices[0]!.x).toBe(vertices[3]!.x);
  expect(vertices[1]!.x).toBe(vertices[2]!.x);
});
it("produces a complete deterministic feedback order on disconnected graphs", () => {
  const arcs = [
    { from: 0, to: 1, minlen: 1, weight: 1 },
    { from: 1, to: 2, minlen: 1, weight: 1 },
    { from: 2, to: 0, minlen: 1, weight: 1 }
  ];
  expect(new Set(feedbackOrder(5, arcs)).size).toBe(5);
  expect(feedbackOrder(5, arcs)).toEqual(feedbackOrder(5, arcs));
});
it("keeps cluster frames local to their members and reserves space for a graph label", () => {
  const l = layoutGraph(
    parseDot(
      'digraph { label="Title"; subgraph cluster_a { label=""; a; } subgraph cluster_b { label=""; b; } a -> b; }'
    )
  );
  for (const c of l.clusters) {
    const n = l.nodes.find((n) => n.id === c.nodes[0])!;
    expect(c.width).toBeCloseTo(n.width + 16);
    expect(c.height).toBeCloseTo(n.height + 16);
  }
  expect(l.height - Math.max(...l.nodes.map((n) => n.y + n.height / 2))).toBeGreaterThan(24);
});
it("keeps every cubic spline attached to its first and last point", () => {
  const l = layoutGraph(parseDot("digraph { a -> b -> c -> d; a -> d; }"));
  const e = l.edges.at(-1)!;
  const last = e.points.at(-1)!;
  expect(
    e.path.endsWith(`${Math.round(last.x * 1000) / 1000},${Math.round(last.y * 1000) / 1000}`)
  ).toBe(true);
});
it("clips east and west compass points to node boundaries", () => {
  const l = layoutGraph(parseDot("digraph { a:e -> b:w; }"));
  const [a, b] = l.nodes;
  const e = l.edges[0]!;
  expect(e.points[0]!.x).toBeCloseTo(a!.x + a!.width / 2);
  expect(e.points[0]!.y).toBeCloseTo(a!.y);
  expect(e.points.at(-1)!.x).toBeCloseTo(b!.x - b!.width / 2);
});
it("separates sibling clusters across layers", () => {
  const l = layoutGraph(
    parseDot(
      'digraph { subgraph cluster_a {label="First"; a -> b;} subgraph cluster_b {label="Second"; c -> d;} a -> d; c -> b; }'
    )
  );
  const [a, b] = l.clusters;
  expect(
    a!.x + a!.width <= b!.x ||
      b!.x + b!.width <= a!.x ||
      a!.y + a!.height <= b!.y ||
      b!.y + b!.height <= a!.y
  ).toBe(true);
});
