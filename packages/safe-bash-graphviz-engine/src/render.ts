import {
  parseDot,
  serializeDot,
  layoutGraph,
  renderSvg,
  type DotGraph,
  type Statement,
  type LayoutOptions,
  type GraphLayout
} from "@poe-code/graphviz-ast";
import { UsageError, type GraphvizLimits } from "./index.js";
function admit(graph: DotGraph, limits: GraphvizLimits): void {
  const nodes = new Set<string>();
  let edges = 0,
    minlen = 1,
    count = 0,
    extremal = false;
  const visit = (statements: Statement[]): Set<string> => {
    const local = new Set<string>();
    for (const s of statements) {
      count++;
      if ("attributes" in s) {
        if (Number.isFinite(Number(s.attributes.minlen)))
          minlen = Math.max(minlen, Math.round(Number(s.attributes.minlen)));
        if (["min", "max", "source", "sink"].includes(s.attributes.rank ?? "")) extremal = true;
      }
      if (s.kind === "node") {
        nodes.add(s.node.id);
        local.add(s.node.id);
      } else if (s.kind === "subgraph") for (const id of visit(s.statements)) local.add(id);
      else if (s.kind === "edge") {
        let previous = 0;
        for (const end of s.endpoints) {
          const ids = "kind" in end ? visit(end.statements) : new Set([end.id]);
          edges += previous * ids.size;
          previous = ids.size;
          for (const id of ids) {
            nodes.add(id);
            local.add(id);
          }
          if (edges > limits.maxEdges) throw new UsageError("edge limit exceeded");
        }
      }
      if (nodes.size > limits.maxNodes) throw new UsageError("node limit exceeded");
    }
    return local;
  };
  visit(graph.statements);
  const expanded = count + (edges + (extremal ? count * count : 0)) * count * minlen;
  const cost = expanded * expanded;
  if (!Number.isSafeInteger(cost) || cost > limits.maxLayoutCost)
    throw new UsageError("graph layout cost limit exceeded");
}
/** Deterministic bounded spring layout. All geometry remains in points. */
function spring(graph: GraphLayout): void {
  const nodes = graph.nodes,
    n = nodes.length;
  if (!n) return;
  const radius = Math.max(72, n * 18),
    positions = nodes.map((_, i) => ({
      x: radius * Math.cos((2 * Math.PI * i) / n),
      y: radius * Math.sin((2 * Math.PI * i) / n)
    }));
  const indices = new Map(nodes.map((v, i) => [v.id, i]));
  for (let iteration = 0; iteration < 120; iteration++) {
    const force = nodes.map(() => ({ x: 0, y: 0 }));
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        const dx = positions[i]!.x - positions[j]!.x,
          dy = positions[i]!.y - positions[j]!.y,
          d = Math.max(1, Math.hypot(dx, dy)),
          f = 6400 / (d * d);
        force[i]!.x += dx * f;
        force[i]!.y += dy * f;
        force[j]!.x -= dx * f;
        force[j]!.y -= dy * f;
      }
    for (const edge of graph.edges) {
      const a = indices.get(edge.tail.id)!,
        b = indices.get(edge.head.id)!;
      if (a === b) continue;
      const dx = positions[b]!.x - positions[a]!.x,
        dy = positions[b]!.y - positions[a]!.y,
        d = Math.max(1, Math.hypot(dx, dy)),
        f = d / 80;
      force[a]!.x += dx * f;
      force[a]!.y += dy * f;
      force[b]!.x -= dx * f;
      force[b]!.y -= dy * f;
    }
    const temperature = 12 * (1 - iteration / 120);
    for (let i = 0; i < n; i++) {
      const f = force[i]!,
        length = Math.max(1, Math.hypot(f.x, f.y));
      positions[i]!.x += (f.x / length) * Math.min(length, temperature);
      positions[i]!.y += (f.y / length) * Math.min(length, temperature);
    }
  }
  const minX = Math.min(...nodes.map((v, i) => positions[i]!.x - v.width / 2)) - 18,
    minY = Math.min(...nodes.map((v, i) => positions[i]!.y - v.height / 2)) - 18;
  for (let i = 0; i < n; i++) {
    const node = nodes[i]!,
      x = positions[i]!.x - minX,
      y = positions[i]!.y - minY;
    for (const port of Object.values(node.ports)) {
      port.x += x - node.x;
      port.y += y - node.y;
    }
    node.x = x;
    node.y = y;
  }
  graph.width = Math.max(...nodes.map((v) => v.x + v.width / 2)) + 18;
  graph.height = Math.max(...nodes.map((v) => v.y + v.height / 2)) + 18;
  for (const edge of graph.edges) {
    const a = nodes[indices.get(edge.tail.id)!]!,
      b = nodes[indices.get(edge.head.id)!]!;
    if (a === b) {
      edge.points = [
        { x: a.x, y: a.y - a.height / 2 },
        { x: a.x + a.width, y: a.y - a.height },
        { x: a.x + a.width, y: a.y },
        { x: a.x + a.width / 2, y: a.y }
      ];
      edge.path = `M${edge.points[0]!.x},${edge.points[0]!.y}C${edge.points
        .slice(1)
        .map((p) => `${p.x},${p.y}`)
        .join(" ")}`;
    } else {
      const dx = b.x - a.x,
        dy = b.y - a.y;
      const attachment = (v: typeof a, sign: number) => {
        const scale = 1 / Math.max(Math.abs(dx) / (v.width / 2), Math.abs(dy) / (v.height / 2), 1);
        return { x: v.x + sign * dx * scale, y: v.y + sign * dy * scale };
      };
      edge.points = [attachment(a, 1), attachment(b, -1)];
      edge.path = edge.points.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join("");
    }
    edge.label = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }
  for (const cluster of graph.clusters) {
    const members = nodes.filter((v) => cluster.nodes.includes(v.id));
    if (!members.length) continue;
    cluster.x = Math.min(...members.map((v) => v.x - v.width / 2)) - 10;
    cluster.y = Math.min(...members.map((v) => v.y - v.height / 2)) - 20;
    cluster.width = Math.max(...members.map((v) => v.x + v.width / 2)) + 10 - cluster.x;
    cluster.height = Math.max(...members.map((v) => v.y + v.height / 2)) + 10 - cluster.y;
  }
}
function plain(g: GraphLayout): string {
  const quote = (s: string) => JSON.stringify(s),
    inch = (n: number) => String(Number((n / 72).toFixed(5)));
  return [
    `graph 1 ${inch(g.width)} ${inch(g.height)}`,
    ...g.nodes.map(
      (n) =>
        `node ${quote(n.id)} ${inch(n.x)} ${inch(g.height - n.y)} ${inch(n.width)} ${inch(n.height)} ${quote(n.attributes.label ?? n.id)} ${quote(n.attributes.style ?? "solid")} ${quote(n.attributes.shape ?? "ellipse")} ${quote(n.attributes.color ?? "black")} ${quote(n.attributes.fillcolor ?? "lightgrey")}`
    ),
    ...g.edges.map(
      (e) =>
        `edge ${quote(e.tail.id)} ${quote(e.head.id)} ${e.points.length} ${e.points.map((p) => `${inch(p.x)} ${inch(g.height - p.y)}`).join(" ")}${e.attributes.label ? ` ${quote(e.attributes.label)} ${inch(e.label.x)} ${inch(g.height - e.label.y)}` : ""} ${quote(e.attributes.style ?? "solid")} ${quote(e.attributes.color ?? "black")}`
    ),
    "stop",
    ""
  ].join("\n");
}
export async function renderGraph(
  source: string,
  format: string,
  layout: string,
  options: LayoutOptions,
  limits: GraphvizLimits,
  signal?: AbortSignal
): Promise<Uint8Array> {
  const ast = parseDot(source);
  for (const target of ["edge", "node", "graph"] as const)
    if (options[target])
      ast.statements.unshift({ kind: "attributes", target, attributes: options[target]! });
  admit(ast, limits);
  if (format === "canon") return new TextEncoder().encode(serializeDot(ast));
  const graph = layoutGraph(ast, options);
  if (layout === "neato") {
    if (120 * graph.nodes.length ** 2 > limits.maxLayoutCost)
      throw new UsageError("graph layout cost limit exceeded");
    spring(graph);
  }
  if (format === "json") return new TextEncoder().encode(JSON.stringify(graph) + "\n");
  if (format === "plain") return new TextEncoder().encode(plain(graph));
  if (format === "dot") {
    ast.statements.push({
      kind: "attributes",
      target: "graph",
      attributes: { bb: `0,0,${graph.width},${graph.height}` }
    });
    for (const node of graph.nodes)
      ast.statements.push({
        kind: "node",
        node: { id: node.id },
        attributes: {
          pos: `${node.x},${graph.height - node.y}`,
          width: String(node.width / 72),
          height: String(node.height / 72)
        }
      });
    return new TextEncoder().encode(serializeDot(ast));
  }
  const svg = new TextEncoder().encode(renderSvg(graph));
  if (format === "svg") return svg;
  if (format === "pdf")
    return (await import("safe-bash-svg-engine")).renderSvgDocument(new TextDecoder().decode(svg), "pdf", {
      ...(signal ? { signal } : {}),
      maxNodes: limits.maxNodes * 20,
      maxPixels: limits.maxPixels
    });
  if (
    !Number.isFinite(graph.width * graph.height) ||
    Math.ceil(graph.width) * Math.ceil(graph.height) > limits.maxPixels
  )
    throw new UsageError("raster pixel limit exceeded");
  if (!["png", "jpg", "jpeg", "webp"].includes(format))
    throw new UsageError(`unknown format: ${format}`);
  return (await import("@poe-code/image-ast")).default(svg)
    .toFormat({ id: format === "jpg" ? "jpeg" : format })
    .toBuffer();
}
