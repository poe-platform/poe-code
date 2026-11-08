import type { Attributes, DotGraph, NodeRef } from "./dot.js";
import { resolveGraph } from "./model.js";
import { nodeSize, numeric, pair, recordFields, type RecordField } from "./metrics.js";
import {
  feedbackOrder,
  assignRanks,
  minimizeCrossings,
  assignCoordinates,
  type Arc,
  type Vertex
} from "./layered.js";
export interface Point {
  x: number;
  y: number;
}
export interface LayoutNode extends Point {
  id: string;
  width: number;
  height: number;
  rank: number;
  attributes: Attributes;
  ports: Record<string, Point>;
}
export interface LayoutEdge {
  tail: NodeRef;
  head: NodeRef;
  attributes: Attributes;
  reversed: boolean;
  points: Point[];
  path: string;
  label: Point;
}
export interface LayoutCluster {
  id: string;
  attributes: Attributes;
  nodes: string[];
  parent?: string;
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface GraphLayout {
  id?: string;
  directed: boolean;
  strict: boolean;
  attributes: Attributes;
  width: number;
  height: number;
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  clusters: LayoutCluster[];
}
export interface LayoutOptions {
  graph?: Attributes;
  node?: Attributes;
  edge?: Attributes;
}
const fmt = (n: number) => String(Math.round(n * 1000) / 1000);
const xy = (p: Point) => `${fmt(p.x)},${fmt(p.y)}`;

/** Cubic uniform B-spline segments, clamped to the two edge endpoints. */
function splinePath(points: Point[]): string {
  if (points.length < 2) return "";
  if (points.length === 2) {
    const a = points[0]!;
    const b = points[1]!;
    return `M${xy(a)}C${xy({ x: a.x, y: (a.y + b.y) / 2 })} ${xy({ x: b.x, y: (a.y + b.y) / 2 })} ${xy(b)}`;
  }
  const p = [points[0]!, points[0]!, ...points, points.at(-1)!, points.at(-1)!];
  let result = `M${xy(points[0]!)}`;
  for (let i = 0; i + 3 < p.length; i++) {
    const a = p[i]!;
    const b = p[i + 1]!;
    const c = p[i + 2]!;
    const d = p[i + 3]!;
    const c1 = { x: (2 * b.x + c.x) / 3, y: (2 * b.y + c.y) / 3 };
    const c2 = { x: (b.x + 2 * c.x) / 3, y: (b.y + 2 * c.y) / 3 };
    const end = { x: (b.x + 4 * c.x + d.x) / 6, y: (b.y + 4 * c.y + d.y) / 6 };
    // First degenerate segment is omitted; the final clamped segment reaches the endpoint.
    if (i > 0) result += `C${xy(c1)} ${xy(c2)} ${xy(end)}`;
    void a;
  }
  return result;
}
function boundary(node: LayoutNode, toward: Point, ref: NodeRef): Point {
  const center = ref.port !== undefined && node.ports[ref.port] ? node.ports[ref.port]! : node;
  let dx = toward.x - center.x;
  let dy = toward.y - center.y;
  const directions: Record<string, [number, number]> = {
    n: [0, -1],
    ne: [1, -1],
    e: [1, 0],
    se: [1, 1],
    s: [0, 1],
    sw: [-1, 1],
    w: [-1, 0],
    nw: [-1, -1]
  };
  if (ref.compass === "c") return { x: center.x, y: center.y };
  if (ref.compass && directions[ref.compass]) [dx, dy] = directions[ref.compass]!;
  if (!dx && !dy) dy = 1;
  const rx = node.width / 2;
  const ry = node.height / 2;
  const shape = node.attributes.shape ?? "ellipse";
  let scale: number;
  if (["ellipse", "oval", "circle", "doublecircle"].includes(shape))
    scale = 1 / Math.sqrt((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry));
  else if (shape === "diamond") scale = 1 / (Math.abs(dx) / rx + Math.abs(dy) / ry);
  else scale = Math.min(dx ? rx / Math.abs(dx) : Infinity, dy ? ry / Math.abs(dy) : Infinity);
  if (ref.port && !ref.compass) return { x: center.x, y: center.y };
  return { x: center.x + dx * scale, y: center.y + dy * scale };
}
function ports(node: LayoutNode): void {
  if (!["record", "Mrecord"].includes(node.attributes.shape ?? "")) return;
  const walk = (
    fields: RecordField[],
    x: number,
    y: number,
    w: number,
    h: number,
    horizontal: boolean
  ) => {
    fields.forEach((field, i) => {
      const width = horizontal ? w / fields.length : w;
      const height = horizontal ? h : h / fields.length;
      const left = x + (horizontal ? i * width : 0);
      const top = y + (horizontal ? 0 : i * height);
      if (field.port !== undefined)
        node.ports[field.port] = { x: left + width / 2, y: top + height / 2 };
      if (field.children) walk(field.children, left, top, width, height, !horizontal);
    });
  };
  walk(
    recordFields(node.attributes.label ?? node.id),
    node.x - node.width / 2,
    node.y - node.height / 2,
    node.width,
    node.height,
    true
  );
}

export function layoutGraph(graph: DotGraph, options: LayoutOptions = {}): GraphLayout {
  const model = resolveGraph(graph);
  const attributes = { ...model.attributes, ...options.graph };
  const rankdir = attributes.rankdir ?? "TB";
  const horizontal = rankdir === "LR" || rankdir === "RL";
  const nodes: LayoutNode[] = model.nodes.map((n) => {
    const attrs = { ...n.attributes, ...options.node };
    const [width, height] = nodeSize(n.id, attrs);
    return { id: n.id, attributes: attrs, width, height, x: 0, y: 0, rank: 0, ports: {} };
  });
  const index = new Map(nodes.map((n, i) => [n.id, i]));
  const parent = nodes.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  for (const group of model.ranks)
    for (const id of group.nodes.slice(1))
      parent[find(index.get(id)!)] = find(index.get(group.nodes[0]!)!);
  const representatives = [...new Set(parent.map((_, i) => find(i)))];
  const groupIndex = new Map(representatives.map((r, i) => [r, i]));
  const groupOf = nodes.map((_, i) => groupIndex.get(find(i))!);
  const edgeAttributes = model.edges.map((e) => ({ ...e.attributes, ...options.edge }));
  const originalArcs: Arc[] = model.edges.flatMap((e, i) => {
    const from = groupOf[index.get(e.tail.id)!]!;
    const to = groupOf[index.get(e.head.id)!]!;
    if (from === to || edgeAttributes[i]!.constraint === "false") return [];
    return [
      {
        from,
        to,
        minlen: Math.max(1, Math.round(numeric(edgeAttributes[i]!.minlen, 1))),
        weight: numeric(edgeAttributes[i]!.weight, 1)
      }
    ];
  });
  let order = feedbackOrder(representatives.length, originalArcs);
  const minGroups = new Set<number>();
  const maxGroups = new Set<number>();
  for (const group of model.ranks) {
    const target =
      group.rank === "min" || group.rank === "source"
        ? minGroups
        : group.rank === "max" || group.rank === "sink"
          ? maxGroups
          : undefined;
    if (target) for (const id of group.nodes) target.add(groupOf[index.get(id)!]!);
  }
  order = [
    ...order.filter((v) => minGroups.has(v)),
    ...order.filter((v) => !minGroups.has(v) && !maxGroups.has(v)),
    ...order.filter((v) => !minGroups.has(v) && maxGroups.has(v))
  ];
  const ordinal = new Map(order.map((v, i) => [v, i]));
  const arcs = originalArcs.map((e) =>
    ordinal.get(e.from)! < ordinal.get(e.to)! ? { ...e } : { ...e, from: e.to, to: e.from }
  );
  // Extremal rank sets constrain every other component, including disconnected nodes.
  for (const min of minGroups)
    for (let v = 0; v < representatives.length; v++)
      if (v !== min && !minGroups.has(v)) arcs.push({ from: min, to: v, minlen: 1, weight: 0 });
  for (const max of maxGroups)
    for (let v = 0; v < representatives.length; v++)
      if (v !== max && !maxGroups.has(v)) arcs.push({ from: v, to: max, minlen: 1, weight: 0 });
  const ranks = assignRanks(representatives.length, arcs, order);
  const vertices: Vertex[] = nodes.map((n, i) => ({
    rank: ranks[groupOf[i]!] ?? 0,
    width: horizontal ? n.height : n.width,
    height: horizontal ? n.width : n.height,
    x: 0,
    y: 0,
    order: 0
  }));
  const segments: Arc[] = [];
  const routes: number[][] = [];
  model.edges.forEach((e, i) => {
    let from = index.get(e.tail.id)!;
    let to = index.get(e.head.id)!;
    const reverse = vertices[from]!.rank > vertices[to]!.rank;
    if (reverse) [from, to] = [to, from];
    const route = [from];
    for (let rank = vertices[from]!.rank + 1; rank < vertices[to]!.rank; rank++) {
      route.push(vertices.length);
      vertices.push({ rank, width: 0, height: 0, x: 0, y: 0, order: 0 });
    }
    route.push(to);
    for (let j = 1; j < route.length; j++)
      if (vertices[route[j - 1]!]!.rank !== vertices[route[j]!]!.rank)
        segments.push({
          from: route[j - 1]!,
          to: route[j]!,
          minlen: 1,
          weight: numeric(edgeAttributes[i]!.weight, 1)
        });
    routes.push(reverse ? route.reverse() : route);
  });
  const layers: number[][] = Array.from(
    { length: Math.max(...vertices.map((v) => v.rank), 0) + 1 },
    () => []
  );
  vertices.forEach((v, i) => layers[v.rank]!.push(i));
  const clusterOf = new Map<string, number>();
  model.clusters.forEach((c, i) => c.nodes.forEach((id) => clusterOf.set(id, i)));
  for (const layer of layers)
    layer.sort(
      (a, b) =>
        (clusterOf.get(nodes[a]?.id ?? "") ?? -1) - (clusterOf.get(nodes[b]?.id ?? "") ?? -1)
    );
  minimizeCrossings(layers, vertices, segments);
  assignCoordinates(
    layers,
    vertices,
    segments,
    numeric(attributes.nodesep, 0.25) * 72,
    numeric(attributes.ranksep?.split(" ")[0], 0.5) * 72
  );
  const maxY = Math.max(...vertices.map((v) => v.y), 0);
  const transform = (p: Point): Point => {
    const y = rankdir === "BT" || rankdir === "RL" ? maxY - p.y : p.y;
    return horizontal ? { x: y, y: p.x } : { x: p.x, y };
  };
  nodes.forEach((n, i) => {
    Object.assign(n, transform(vertices[i]!));
    n.rank = vertices[i]!.rank;
    ports(n);
  });
  const clusters: LayoutCluster[] = model.clusters.map((c) => {
    const members = c.nodes.map((id) => nodes[index.get(id)!]!);
    const margin = numeric(c.attributes.margin, 8);
    const x = (members.length ? Math.min(...members.map((n) => n.x - n.width / 2)) : 0) - margin;
    const y =
      (members.length ? Math.min(...members.map((n) => n.y - n.height / 2)) : 0) -
      margin -
      (c.attributes.label ? 24 : 0);
    const right = Math.max(...members.map((n) => n.x + n.width / 2), x) + margin;
    const bottom = Math.max(...members.map((n) => n.y + n.height / 2), y) + margin;
    return { ...c, x, y, width: right - x, height: bottom - y };
  });
  // Nested cluster extents include child frames.
  for (const c of clusters)
    if (c.parent) {
      const p = clusters.find((item) => item.id === c.parent);
      if (!p) continue;
      const right = Math.max(p.x + p.width, c.x + c.width + 8);
      const bottom = Math.max(p.y + p.height, c.y + c.height + 8);
      p.x = Math.min(p.x, c.x - 8);
      p.y = Math.min(p.y, c.y - 8);
      p.width = right - p.x;
      p.height = bottom - p.y;
    }
  const splines = attributes.splines ?? "true";
  const parallels = new Map<string, number>();
  const edges: LayoutEdge[] = model.edges.map((e, i) => {
    const tail = nodes[index.get(e.tail.id)!]!;
    const head = nodes[index.get(e.head.id)!]!;
    let points = routes[i]!.map((v) => transform(vertices[v]!));
    const key = JSON.stringify([e.tail.id, e.head.id]);
    const parallel = parallels.get(key) ?? 0;
    parallels.set(key, parallel + 1);
    if (tail === head) {
      points = [
        { x: tail.x + tail.width / 2, y: tail.y },
        { x: tail.x + tail.width / 2 + 32 + parallel * 12, y: tail.y - tail.height },
        { x: tail.x + tail.width / 2 + 32 + parallel * 12, y: tail.y + tail.height },
        { x: tail.x + tail.width / 2, y: tail.y + tail.height / 4 }
      ];
    } else {
      if (tail.rank === head.rank) {
        const offset = 30 + parallel * 12;
        points = [
          tail,
          horizontal
            ? { x: tail.x - tail.width / 2 - offset, y: tail.y }
            : { x: tail.x, y: tail.y - tail.height / 2 - offset },
          horizontal
            ? { x: head.x - head.width / 2 - offset, y: head.y }
            : { x: head.x, y: head.y - head.height / 2 - offset },
          head
        ];
      } else if (points.length === 2 && parallel)
        points.splice(1, 0, {
          x: (tail.x + head.x) / 2 + (horizontal ? 0 : parallel * 16),
          y: (tail.y + head.y) / 2 + (horizontal ? parallel * 16 : 0)
        });
      points[0] = boundary(tail, points[1]!, e.tail);
      points[points.length - 1] = boundary(head, points.at(-2)!, e.head);
    }
    if (splines === "line" || splines === "false") points = [points[0]!, points.at(-1)!];
    if (splines === "ortho") {
      const orthogonal: Point[] = [points[0]!];
      for (let j = 1; j < points.length; j++) {
        const a = points[j - 1]!;
        const b = points[j]!;
        if (horizontal)
          orthogonal.push({ x: (a.x + b.x) / 2, y: a.y }, { x: (a.x + b.x) / 2, y: b.y });
        else orthogonal.push({ x: a.x, y: (a.y + b.y) / 2 }, { x: b.x, y: (a.y + b.y) / 2 });
        orthogonal.push(b);
      }
      points = orthogonal;
    }
    return {
      ...e,
      attributes: edgeAttributes[i]!,
      reversed: tail.rank > head.rank,
      points,
      path: "",
      label: points[Math.floor(points.length / 2)]!
    };
  });
  const [mx, my] = pair(attributes.margin, 0);
  const [px, py] = pair(attributes.pad, 0.0555);
  const all = [
    ...nodes.flatMap((n) => [
      { x: n.x - n.width / 2, y: n.y - n.height / 2 },
      { x: n.x + n.width / 2, y: n.y + n.height / 2 }
    ]),
    ...clusters.flatMap((c) => [
      { x: c.x, y: c.y },
      { x: c.x + c.width, y: c.y + c.height }
    ]),
    ...edges.flatMap((e) => e.points)
  ];
  const minX = Math.min(...all.map((p) => p.x), 0);
  const minY = Math.min(...all.map((p) => p.y), 0);
  const maxX = Math.max(...all.map((p) => p.x), 0);
  const maxExtentY = Math.max(...all.map((p) => p.y), 0);
  const dx = (mx + px) * 72 - minX;
  const dy = (my + py) * 72 - minY;
  for (const n of nodes) {
    n.x += dx;
    n.y += dy;
    for (const p of Object.values(n.ports)) {
      p.x += dx;
      p.y += dy;
    }
  }
  for (const c of clusters) {
    c.x += dx;
    c.y += dy;
  }
  for (const e of edges) {
    e.points = e.points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
    e.label = { x: e.label.x + dx, y: e.label.y + dy };
    e.path =
      splines === "none" || splines === ""
        ? ""
        : splines === "true" || splines === "spline"
          ? splinePath(e.points)
          : e.points.map((p, i) => `${i ? "L" : "M"}${xy(p)}`).join("");
  }
  const labelHeight = attributes.label ? numeric(attributes.fontsize, 14) * 1.2 + 12 : 0;
  return {
    ...(graph.id !== undefined ? { id: graph.id } : {}),
    directed: graph.directed,
    strict: graph.strict,
    attributes,
    nodes,
    edges,
    clusters,
    width: Math.max(1, maxX - minX + (mx + px) * 144),
    height: Math.max(1, maxExtentY - minY + (my + py) * 144 + labelHeight)
  };
}
