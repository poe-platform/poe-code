export interface Arc {
  from: number;
  to: number;
  minlen: number;
  weight: number;
}
export interface Vertex {
  rank: number;
  width: number;
  height: number;
  x: number;
  y: number;
  order: number;
}

/** Eades' greedy feedback-arc heuristic: peel sinks/sources, then maximum out-in weight. */
export function feedbackOrder(count: number, arcs: Arc[]): number[] {
  const remaining = new Set(Array.from({ length: count }, (_, i) => i));
  const left: number[] = [];
  const right: number[] = [];
  const incoming = Array.from({ length: count }, () => [] as Arc[]);
  const outgoing = Array.from({ length: count }, () => [] as Arc[]);
  for (const arc of arcs)
    if (arc.from !== arc.to) {
      incoming[arc.to]!.push(arc);
      outgoing[arc.from]!.push(arc);
    }
  while (remaining.size) {
    let chosen = -1;
    let best = -Infinity;
    for (const v of remaining) {
      const ins = incoming[v]!.filter((e) => remaining.has(e.from));
      const outs = outgoing[v]!.filter((e) => remaining.has(e.to));
      if (!outs.length) {
        right.push(v);
        chosen = v;
        break;
      }
      if (!ins.length) {
        left.push(v);
        chosen = v;
        break;
      }
      const score = outs.reduce((s, e) => s + e.weight, 0) - ins.reduce((s, e) => s + e.weight, 0);
      if (score > best) {
        chosen = v;
        best = score;
      }
    }
    if (left.at(-1) !== chosen && right.at(-1) !== chosen) left.push(chosen);
    remaining.delete(chosen);
  }
  return [...left, ...right.reverse()];
}

/** Longest-path feasible ranks, tightened by network-simplex tree cut pivots. */
export function assignRanks(count: number, arcs: Arc[], order: number[]): number[] {
  const rank = Array<number>(count).fill(0);
  const outgoing = Array.from({ length: count }, () => [] as Arc[]);
  for (const arc of arcs) outgoing[arc.from]!.push(arc);
  for (const v of order)
    for (const e of outgoing[v]!) rank[e.to] = Math.max(rank[e.to]!, rank[v]! + e.minlen);
  const slack = (e: Arc) => rank[e.to]! - rank[e.from]! - e.minlen;
  // Build a feasible tight spanning forest. Translating an entire tight component
  // to its least-slack boundary adds a tight tree edge without losing feasibility.
  const tree = new Set<Arc>();
  const connected = new Set<number>();
  for (let seed = 0; seed < count; seed++) {
    if (connected.has(seed)) continue;
    const component = new Set([seed]);
    while (true) {
      let boundary: Arc | undefined;
      let least = Infinity;
      for (const e of arcs)
        if (
          component.has(e.from) !== component.has(e.to) &&
          !connected.has(e.from) &&
          !connected.has(e.to)
        ) {
          if (slack(e) < least) {
            least = slack(e);
            boundary = e;
          }
        }
      if (!boundary) break;
      const shift = component.has(boundary.from) ? least : -least;
      for (const v of component) rank[v] = rank[v]! + shift;
      tree.add(boundary);
      component.add(boundary.from);
      component.add(boundary.to);
    }
    for (const v of component) connected.add(v);
  }
  // Each pivot removes a negative cut edge and substitutes the first limiting
  // non-tree edge. The weighted sum of edge lengths decreases on positive pivots.
  const limit = Math.max(32, count * Math.max(1, arcs.length) * 4);
  for (let iteration = 0; iteration < limit; iteration++) {
    let changed = false;
    for (const leaving of tree) {
      const adjacency = Array.from({ length: count }, () => [] as number[]);
      for (const e of tree)
        if (e !== leaving) {
          adjacency[e.from]!.push(e.to);
          adjacency[e.to]!.push(e.from);
        }
      const side = new Set([leaving.to]);
      const queue = [leaving.to];
      for (let i = 0; i < queue.length; i++)
        for (const v of adjacency[queue[i]!]!)
          if (!side.has(v)) {
            side.add(v);
            queue.push(v);
          }
      let cut = 0;
      for (const e of arcs)
        if (side.has(e.from) !== side.has(e.to)) cut += side.has(e.to) ? e.weight : -e.weight;
      // The head side can only increase: decreasing would violate the removed tight edge.
      if (cut >= -1e-9) continue;
      let entering: Arc | undefined;
      let delta = Infinity;
      for (const e of arcs)
        if (side.has(e.from) && !side.has(e.to) && slack(e) < delta) {
          delta = slack(e);
          entering = e;
        }
      if (!entering || delta <= 1e-9) continue;
      for (const v of side) rank[v] = rank[v]! + delta;
      tree.delete(leaving);
      tree.add(entering);
      changed = true;
      break;
    }
    if (!changed) break;
  }
  const min = Math.min(...rank, 0);
  return rank.map((r) => r - min);
}

function crossings(layers: number[][], arcs: Arc[], vertices: Vertex[]): number {
  let count = 0;
  for (let r = 0; r < layers.length - 1; r++) {
    const between = arcs.filter(
      (e) => vertices[e.from]!.rank === r && vertices[e.to]!.rank === r + 1
    );
    for (let i = 0; i < between.length; i++)
      for (let j = i + 1; j < between.length; j++) {
        const a = between[i]!;
        const b = between[j]!;
        if (
          (vertices[a.from]!.order - vertices[b.from]!.order) *
            (vertices[a.to]!.order - vertices[b.to]!.order) <
          0
        )
          count++;
      }
  }
  return count;
}
const median = (values: number[]): number => {
  values.sort((a, b) => a - b);
  const m = Math.floor(values.length / 2);
  return values.length % 2 ? values[m]! : (values[m - 1]! + values[m]!) / 2;
};
export function minimizeCrossings(layers: number[][], vertices: Vertex[], arcs: Arc[]): void {
  const update = () =>
    layers.forEach((layer) =>
      layer.forEach((v, i) => {
        vertices[v]!.order = i;
      })
    );
  update();
  let best = layers.map((layer) => [...layer]);
  let bestCount = crossings(layers, arcs, vertices);
  const incoming = Array.from({ length: vertices.length }, () => [] as number[]);
  const outgoing = Array.from({ length: vertices.length }, () => [] as number[]);
  for (const e of arcs) {
    incoming[e.to]!.push(e.from);
    outgoing[e.from]!.push(e.to);
  }
  for (let pass = 0; pass < 12; pass++) {
    const down = pass % 2 === 0;
    for (let step = 1; step < layers.length; step++) {
      const r = down ? step : layers.length - 1 - step;
      const layer = layers[r]!;
      const scores = new Map<number, number>();
      for (const v of layer) {
        const neighbors = (down ? incoming[v]! : outgoing[v]!).map((n) => vertices[n]!.order);
        scores.set(
          v,
          neighbors.length
            ? pass % 4 < 2
              ? neighbors.reduce((s, n) => s + n, 0) / neighbors.length
              : median(neighbors)
            : vertices[v]!.order
        );
      }
      layer.sort(
        (a, b) => scores.get(a)! - scores.get(b)! || vertices[a]!.order - vertices[b]!.order
      );
      update();
    }
    // Transpose adjacent vertices whenever that strictly reduces crossings.
    for (let sweep = 0; sweep < 4; sweep++) {
      let improved = false;
      for (const layer of layers)
        for (let i = 1; i < layer.length; i++) {
          const before = crossings(layers, arcs, vertices);
          [layer[i - 1], layer[i]] = [layer[i]!, layer[i - 1]!];
          update();
          if (crossings(layers, arcs, vertices) < before) improved = true;
          else {
            [layer[i - 1], layer[i]] = [layer[i]!, layer[i - 1]!];
            update();
          }
        }
      if (!improved) break;
    }
    const count = crossings(layers, arcs, vertices);
    if (count < bestCount) {
      bestCount = count;
      best = layers.map((layer) => [...layer]);
    }
  }
  layers.splice(0, layers.length, ...best);
  update();
}

/** Brandes–Köpf median vertical alignment and horizontal block compaction.
 * Four directional sweeps are balanced to avoid left/right and top/bottom bias.
 */
export function assignCoordinates(
  layers: number[][],
  vertices: Vertex[],
  arcs: Arc[],
  nodesep: number,
  ranksep: number
): void {
  const candidates: number[][] = [];
  for (const down of [true, false])
    for (const right of [false, true]) {
      const rows = layers.map((layer) => (right ? [...layer].reverse() : [...layer]));
      if (!down) rows.reverse();
      const root = vertices.map((_, i) => i);
      const align = [...root];
      const neighbors = Array.from({ length: vertices.length }, () => [] as number[]);
      for (const e of arcs) neighbors[down ? e.to : e.from]!.push(down ? e.from : e.to);
      const positions = new Map<number, number>();
      rows.forEach((row) => row.forEach((v, i) => positions.set(v, i)));
      const blocked = new Set<string>();
      // Type-1 conflicts: do not align a real edge across an inner dummy segment.
      for (const a of arcs)
        for (const b of arcs) {
          if (vertices[a.from]!.rank !== vertices[b.from]!.rank) continue;
          if (vertices[b.from]!.width !== 0 || vertices[b.to]!.width !== 0) continue;
          if (
            (positions.get(a.from)! - positions.get(b.from)!) *
              (positions.get(a.to)! - positions.get(b.to)!) <
            0
          )
            blocked.add(`${a.from}:${a.to}`);
        }
      for (let r = 1; r < rows.length; r++) {
        let previous = -1;
        for (const v of rows[r]!) {
          const ns = neighbors[v]!.sort((a, b) => positions.get(a)! - positions.get(b)!);
          for (const m of [Math.floor((ns.length - 1) / 2), Math.floor(ns.length / 2)]) {
            const u = ns[m];
            if (u === undefined) continue;
            const key = down ? `${u}:${v}` : `${v}:${u}`;
            if (align[v] === v && positions.get(u)! > previous && !blocked.has(key)) {
              align[u] = v;
              root[v] = root[u]!;
              align[v] = root[v]!;
              previous = positions.get(u)!;
            }
          }
        }
      }
      // Solve separation constraints between aligned blocks. An alignment cycle
      // is broken rather than compromising mandatory node separation.
      const roots = [...new Set(root)];
      const x = Array<number>(vertices.length).fill(0);
      const constraints: { from: number; to: number; gap: number }[] = [];
      for (const row of rows)
        for (let i = 1; i < row.length; i++) {
          const a = row[i - 1]!;
          const b = row[i]!;
          if (root[a] !== root[b])
            constraints.push({
              from: root[a]!,
              to: root[b]!,
              gap: (vertices[a]!.width + vertices[b]!.width) / 2 + nodesep
            });
        }
      for (let iteration = 0; iteration < roots.length; iteration++)
        for (const e of constraints) x[e.to] = Math.max(x[e.to]!, x[e.from]! + e.gap);
      const coords = vertices.map((_, v) => (right ? -1 : 1) * x[root[v]!]!);
      // Enforce separation after balancing as well; no box may overlap even when
      // a conflicting alignment was discarded by a directional pass.
      const min = Math.min(...coords, 0);
      candidates.push(coords.map((value) => value - min));
    }
  const extents = candidates.map((values) => Math.max(...values, 0) - Math.min(...values, 0));
  const reference = extents.indexOf(Math.min(...extents));
  const target = candidates[reference]!;
  for (const values of candidates) {
    const delta =
      (Math.min(...target, 0) +
        Math.max(...target, 0) -
        Math.min(...values, 0) -
        Math.max(...values, 0)) /
      2;
    for (let i = 0; i < values.length; i++) values[i] = values[i]! + delta;
  }
  for (let v = 0; v < vertices.length; v++)
    vertices[v]!.x = median(candidates.map((values) => values[v]!));
  for (const layer of layers)
    for (let i = 1; i < layer.length; i++) {
      const a = vertices[layer[i - 1]!]!;
      const b = vertices[layer[i]!]!;
      b.x = Math.max(b.x, a.x + (a.width + b.width) / 2 + nodesep);
    }
  let y = 0;
  let previousHeight = 0;
  for (const layer of layers) {
    const height = Math.max(...layer.map((v) => vertices[v]!.height), 0);
    y += previousHeight / 2 + height / 2 + (y ? ranksep : 0);
    for (const v of layer) vertices[v]!.y = y;
    previousHeight = height;
  }
}
