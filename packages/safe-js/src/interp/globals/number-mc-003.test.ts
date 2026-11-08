import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

import { run } from "../../run.js";
import { Budget } from "../budget.js";
import { createObjectArrayGlobals } from "./object-array.js";

const constants = [
  "EPSILON",
  "MAX_SAFE_INTEGER",
  "MIN_SAFE_INTEGER",
  "MAX_VALUE",
  "MIN_VALUE",
  "NaN",
  "NEGATIVE_INFINITY",
  "POSITIVE_INFINITY"
] as const;

const graphWorkflow = `
  function heapSwap(queue, firstIndex, secondIndex) {
    const first = queue.items[firstIndex];
    const second = queue.items[secondIndex];
    queue.items[firstIndex] = second;
    queue.items[secondIndex] = first;
    queue.indices[second.key] = firstIndex;
    queue.indices[first.key] = secondIndex;
  }
  function heapDecrease(queue, index) {
    const priority = queue.items[index].priority;
    while (index !== 0) {
      const parent = index >> 1;
      if (queue.items[parent].priority < priority) break;
      heapSwap(queue, index, parent);
      index = parent;
    }
  }
  function heapify(queue, index) {
    const left = 2 * index;
    const right = left + 1;
    let smallest = index;
    if (left < queue.items.length) {
      smallest = queue.items[left].priority < queue.items[smallest].priority ? left : smallest;
      if (right < queue.items.length) {
        smallest = queue.items[right].priority < queue.items[smallest].priority ? right : smallest;
      }
      if (smallest !== index) {
        heapSwap(queue, index, smallest);
        heapify(queue, smallest);
      }
    }
  }
  function queueAdd(queue, key, priority) {
    key = String(key);
    if (!Object.hasOwn(queue.indices, key)) {
      const index = queue.items.length;
      queue.indices[key] = index;
      queue.items.push({key, priority});
      heapDecrease(queue, index);
      return true;
    }
    return false;
  }
  function removeMin(queue) {
    heapSwap(queue, 0, queue.items.length - 1);
    const minimum = queue.items.pop();
    delete queue.indices[minimum.key];
    heapify(queue, 0);
    return minimum.key;
  }
  function decreasePriority(queue, key, priority) {
    const index = queue.indices[key];
    if (priority > queue.items[index].priority) throw new Error("New priority is greater than current priority");
    queue.items[index].priority = priority;
    heapDecrease(queue, index);
  }
  function runDijkstra(graph, source, weightOf, edgesOf) {
    const results = {};
    const queue = {items: [], indices: {}};
    let current;
    let currentEntry;
    function updateNeighbors(edge) {
      const neighbor = edge.from !== current ? edge.from : edge.to;
      const entry = results[neighbor];
      const weight = weightOf(edge);
      const distance = currentEntry.distance + weight;
      if (weight < 0) throw new Error("dijkstra does not allow negative edge weights");
      if (distance < entry.distance) {
        entry.distance = distance;
        entry.predecessor = current;
        decreasePriority(queue, neighbor, distance);
      }
    }
    graph.nodes.forEach(function(node) {
      const distance = node === source ? 0 : Number.POSITIVE_INFINITY;
      results[node] = {distance};
      queueAdd(queue, node, distance);
    });
    while (queue.items.length > 0) {
      current = removeMin(queue);
      currentEntry = results[current];
      if (currentEntry.distance === Number.POSITIVE_INFINITY) break;
      edgesOf(current).forEach(updateNeighbors);
    }
    return results;
  }
  function workflow(graph, scale, bias) {
    const distances = runDijkstra(graph, graph.source, edge => edge.weight * scale,
      node => graph.edges.filter(edge => edge.from === node));
    return graph.nodes.map(node => {
      const route = [];
      let current = node;
      while (current !== undefined) {
        route.push(current);
        current = distances[current].predecessor;
      }
      return {node, distance: distances[node].distance,
        adjusted: distances[node].distance + bias, route: route.reverse()};
    });
  }
`;

const graphs = [
  {
    name: "alpha",
    graph: {
      nodes: ["a", "b", "c", "d"],
      source: "a",
      edges: [
        { from: "a", to: "b", weight: 4 },
        { from: "a", to: "c", weight: 1 },
        { from: "c", to: "b", weight: 2 },
        { from: "b", to: "d", weight: 1 },
        { from: "c", to: "d", weight: 7 }
      ]
    },
    scale: 2,
    bias: 1,
    expected: [
      { node: "a", distance: 0, adjusted: 1, route: ["a"] },
      { node: "b", distance: 6, adjusted: 7, route: ["a", "c", "b"] },
      { node: "c", distance: 2, adjusted: 3, route: ["a", "c"] },
      { node: "d", distance: 8, adjusted: 9, route: ["a", "c", "b", "d"] }
    ]
  },
  {
    name: "beta",
    graph: {
      nodes: ["s", "t", "u", "v"],
      source: "s",
      edges: [
        { from: "s", to: "t", weight: 5 },
        { from: "s", to: "u", weight: 2 },
        { from: "u", to: "t", weight: 1 },
        { from: "t", to: "v", weight: 2 },
        { from: "u", to: "v", weight: 8 }
      ]
    },
    scale: 3,
    bias: 2,
    expected: [
      { node: "s", distance: 0, adjusted: 2, route: ["s"] },
      { node: "t", distance: 9, adjusted: 11, route: ["s", "u", "t"] },
      { node: "u", distance: 6, adjusted: 8, route: ["s", "u"] },
      { node: "v", distance: 15, adjusted: 17, route: ["s", "u", "t", "v"] }
    ]
  }
];

describe("MC-003 standard Number constants", () => {
  it.each(constants)("registers Number.%s with its native value", (name) => {
    const globals = createObjectArrayGlobals({ budget: new Budget() });

    expect(globals.Number.properties?.[name]).toBe(Number[name]);
  });

  it.each(constants)("evaluates Number.%s with its native value", async (name) => {
    const result = await run(`return Number.${name};`, {
      budget: new Budget({ maxSteps: 100 })
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.returnValue).toBe(Number[name]);
  });

  it("preserves special-value arithmetic and numeric predicates", async () => {
    const source = `
      return [
        Number.POSITIVE_INFINITY === Infinity,
        Number.NEGATIVE_INFINITY === -Infinity,
        Number.isNaN(Number.NaN),
        Number.isFinite(Number.POSITIVE_INFINITY),
        Number.isFinite(Number.NEGATIVE_INFINITY),
        Number.isNaN(Number.POSITIVE_INFINITY + Number.NEGATIVE_INFINITY),
        1 / Number.POSITIVE_INFINITY,
        1 / Number.NEGATIVE_INFINITY,
        Math.min(Number.POSITIVE_INFINITY, 6),
        Math.max(Number.NEGATIVE_INFINITY, -6)
      ];
    `;
    const expected = [true, true, true, false, false, true, 0, -0, 6, -6];

    expect(runInNewContext(`(function() { ${source} })()`, {}, { timeout: 1_000 })).toEqual(
      expected
    );
    await expect(run(source, { budget: new Budget({ maxSteps: 1_000 }) })).resolves.toMatchObject({
      ok: true,
      returnValue: expected
    });
  });

  it("preserves existing coercion, parsing, predicates, and finite constants", async () => {
    const source = `
      return [
        Number("42.5"), Number(false), Number(null), Number("-0"),
        Number.parseInt("11", 2), Number.parseFloat("3.14more"),
        Number.isFinite("1"), Number.isNaN("NaN"), Number.isInteger(1.5),
        Number.isSafeInteger(Number.MAX_SAFE_INTEGER),
        Number.isSafeInteger(Number.MIN_SAFE_INTEGER),
        Number.isSafeInteger(Number.MAX_SAFE_INTEGER + 1),
        Number.isSafeInteger(Number.MIN_SAFE_INTEGER - 1),
        1 + Number.EPSILON > 1, Number.MIN_VALUE > 0,
        Number.MAX_VALUE < Infinity
      ];
    `;
    const expected = runInNewContext(`(function() { ${source} })()`, {}, { timeout: 1_000 });

    await expect(run(source, { budget: new Budget({ maxSteps: 1_000 }) })).resolves.toMatchObject({
      ok: true,
      returnValue: expected
    });
  });
});

describe("MC-003 original graph-distance anchors", () => {
  it.each(graphs)("matches every original $name distance and route", async (fixture) => {
    const source = `${graphWorkflow}
      return workflow(${JSON.stringify(fixture.graph)}, ${fixture.scale}, ${fixture.bias});`;

    expect(runInNewContext(`(function() { ${source} })()`, {}, { timeout: 1_000 })).toEqual(
      fixture.expected
    );
    await expect(run(source, { budget: new Budget({ maxSteps: 20_000 }) })).resolves.toMatchObject({
      ok: true,
      returnValue: fixture.expected
    });
  });

  it.each(graphs)("preserves the original $name global-Infinity control", async (fixture) => {
    const source = `${graphWorkflow.split("Number.POSITIVE_INFINITY").join("Infinity")}
      return workflow(${JSON.stringify(fixture.graph)}, ${fixture.scale}, ${fixture.bias});`;

    expect(runInNewContext(`(function() { ${source} })()`, {}, { timeout: 1_000 })).toEqual(
      fixture.expected
    );
    await expect(run(source, { budget: new Budget({ maxSteps: 20_000 }) })).resolves.toMatchObject({
      ok: true,
      returnValue: fixture.expected
    });
  });

  it("retains infinity for an unreachable vertex without corrupting reachable routes", async () => {
    const fixture = graphs[0];
    const graph = { ...fixture.graph, nodes: [...fixture.graph.nodes, "isolated"] };
    const expected = [
      ...fixture.expected,
      { node: "isolated", distance: Infinity, adjusted: Infinity, route: ["isolated"] }
    ];
    const source = `${graphWorkflow}
      return workflow(${JSON.stringify(graph)}, ${fixture.scale}, ${fixture.bias});`;

    expect(runInNewContext(`(function() { ${source} })()`, {}, { timeout: 1_000 })).toEqual(
      expected
    );
    await expect(run(source, { budget: new Budget({ maxSteps: 20_000 }) })).resolves.toMatchObject({
      ok: true,
      returnValue: expected
    });
  });
});
