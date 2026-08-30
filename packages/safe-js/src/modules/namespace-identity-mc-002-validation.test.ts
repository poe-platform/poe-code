import { createHash } from "node:crypto";
import { vol } from "memfs";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { dump } from "../dump.js";
import { Budget } from "../interp/budget.js";
import { restore } from "../restore.js";
import { run } from "../run.js";
import { runHarness } from "../runner/run-harness.js";
import { makeHarnessModule } from "./harness.js";
import { makeMetricModule } from "./metric.js";
import type { ModuleExports, ModuleRegistry } from "./registry.js";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return fs.promises;
});

const originalGraph = `import alphaData from "planA";
import {tasks as alphaTasks, decorate as labelAlpha} from "planA";
import * as alphaPlan from "planA";
import {tasks as betaTasks, applyConstraints as labelBeta} from "planB";
import * as betaPlan from "planB";
import alphaScore from "metricA";
import {run as scoreAlias} from "metricA";
import * as alphaMetric from "metricA";
import * as betaMetric from "metricB";
import * as alphaAgain from "planA";
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

const alphaScale = await alphaScore("scale");
const betaScale = await betaMetric.run("scale");
const alphaBias = await scoreAlias("bias");
const betaBias = await betaMetric.run("bias");
return {
  imports: {
    defaultDataAlias: alphaData === alphaTasks,
    namespaceDataAlias: alphaTasks === alphaPlan.tasks,
    renamedDataAlias: alphaPlan.records === alphaTasks,
    callableAlias: labelAlpha === alphaPlan.applyConstraints,
    defaultCallableAlias: alphaScore === scoreAlias,
    namespaceCallableAlias: scoreAlias === alphaMetric.run,
    factoryDataDistinct: alphaTasks !== betaTasks,
    factoryCallableDistinct: alphaMetric.run !== betaMetric.run,
    frontmatterTasksDistinct: alphaTasks !== alphaPlan.meta.frontmatter.tasks,
    namespaceContainerSame: alphaPlan === alphaAgain
  },
  titles: [alphaTasks[0].title, betaTasks[0].title],
  labels: [labelAlpha(alphaTasks[0].title), labelBeta(betaTasks[0].title)],
  metrics: [alphaScale, betaScale, alphaBias, betaBias],
  alpha: workflow(alphaTasks[0], alphaScale, alphaBias),
  beta: workflow(betaTasks[0], betaScale, betaBias)
};

`;
const fixtures = {
  createdAt: "2026-08-27T17:49:11.060Z",
  origin: "out/safejs-audit-2026-08-27/module-composition/fixtures.json",
  registryShape: "object-object",
  datasets: [
    {
      title: "alpha-paths",
      nodes: ["a", "b", "c", "d"],
      source: "a",
      edges: [
        {
          from: "a",
          to: "b",
          weight: 4
        },
        {
          from: "a",
          to: "c",
          weight: 1
        },
        {
          from: "c",
          to: "b",
          weight: 2
        },
        {
          from: "b",
          to: "d",
          weight: 1
        },
        {
          from: "c",
          to: "d",
          weight: 7
        }
      ]
    },
    {
      title: "beta-paths",
      nodes: ["s", "t", "u", "v"],
      source: "s",
      edges: [
        {
          from: "s",
          to: "t",
          weight: 5
        },
        {
          from: "s",
          to: "u",
          weight: 2
        },
        {
          from: "u",
          to: "t",
          weight: 1
        },
        {
          from: "t",
          to: "v",
          weight: 2
        },
        {
          from: "u",
          to: "v",
          weight: 8
        }
      ]
    }
  ],
  metricStdout: {
    alpha: {
      "metric:scale": "progress\n2\n\n",
      "metric:bias": "done\n1\n"
    },
    beta: {
      "metric:scale": "progress\n3\n",
      "metric:bias": "done\n2\n"
    }
  },
  factorySetup: {
    alpha: {
      principles: ["keep-order", "keep-order"],
      constraints: ["bounded"],
      filepath: "/virtual/alpha"
    },
    beta: {
      principles: ["separate-state"],
      constraints: [],
      filepath: "/virtual/beta"
    },
    kind: "module-audit",
    version: 1,
    postConstructionTitleEdits: [
      "host-edited-after-factory-alpha",
      "host-edited-after-factory-beta"
    ]
  }
};
const expectedGraph = {
  returnValue: {
    imports: {
      defaultDataAlias: true,
      namespaceDataAlias: true,
      renamedDataAlias: true,
      callableAlias: true,
      defaultCallableAlias: true,
      namespaceCallableAlias: true,
      factoryDataDistinct: true,
      factoryCallableDistinct: true,
      frontmatterTasksDistinct: true,
      namespaceContainerSame: true
    },
    titles: ["alpha-paths", "beta-paths"],
    labels: [
      "CONSTRAINTS (hard rules, honor all):\n- keep-order\n- bounded\n\nalpha-paths",
      "CONSTRAINTS (hard rules, honor all):\n- separate-state\n\nbeta-paths"
    ],
    metrics: [2, 3, 1, 2],
    alpha: [
      {
        node: "a",
        distance: 0,
        adjusted: 1,
        route: ["a"]
      },
      {
        node: "b",
        distance: 6,
        adjusted: 7,
        route: ["a", "c", "b"]
      },
      {
        node: "c",
        distance: 2,
        adjusted: 3,
        route: ["a", "c"]
      },
      {
        node: "d",
        distance: 8,
        adjusted: 9,
        route: ["a", "c", "b", "d"]
      }
    ],
    beta: [
      {
        node: "s",
        distance: 0,
        adjusted: 2,
        route: ["s"]
      },
      {
        node: "t",
        distance: 9,
        adjusted: 11,
        route: ["s", "u", "t"]
      },
      {
        node: "u",
        distance: 6,
        adjusted: 8,
        route: ["s", "u"]
      },
      {
        node: "v",
        distance: 15,
        adjusted: 17,
        route: ["s", "u", "t", "v"]
      }
    ]
  },
  calls: [
    {
      instance: "alpha",
      script: "metric:scale",
      call: 1
    },
    {
      instance: "beta",
      script: "metric:scale",
      call: 1
    },
    {
      instance: "alpha",
      script: "metric:bias",
      call: 2
    },
    {
      instance: "beta",
      script: "metric:bias",
      call: 2
    }
  ]
};
const registryShapes = [
  ["object", "object"],
  ["object", "map"],
  ["map", "object"],
  ["map", "map"]
] as const;

function createGraphModules(registryKind: string, exportsKind: string) {
  const instances = ["alpha", "beta"] as const;
  const calls: Array<{ instance: string; script: string; call: number }> = [];
  const frontmatters = fixtures.datasets.map((dataset, index) => ({
    tasks: [structuredClone(dataset)],
    agents: [],
    principles: [...fixtures.factorySetup[instances[index]].principles],
    constraints: [...fixtures.factorySetup[instances[index]].constraints]
  }));
  const plans = frontmatters.map((frontmatter, index) =>
    makeHarnessModule(frontmatter, {
      kind: fixtures.factorySetup.kind,
      version: fixtures.factorySetup.version,
      filepath: fixtures.factorySetup[instances[index]].filepath
    })
  );
  frontmatters.forEach((frontmatter, index) => {
    frontmatter.tasks[0].title = fixtures.factorySetup.postConstructionTitleEdits[index];
  });
  const metrics = instances.map((instance) => {
    let count = 0;
    const outputs = new Map(Object.entries(fixtures.metricStdout[instance]));
    return makeMetricModule(async (script) => {
      const output = outputs.get(script);
      if (output === undefined) throw new Error("Unexpected metric request");
      calls.push({ instance, script, call: ++count });
      return output;
    });
  });
  const exports = {
    planA: {
      ...plans[0],
      default: plans[0].tasks,
      records: plans[0].tasks,
      decorate: plans[0].applyConstraints
    },
    planB: {
      ...plans[1],
      default: plans[1].tasks,
      records: plans[1].tasks,
      decorate: plans[1].applyConstraints
    },
    metricA: { ...metrics[0], default: metrics[0].run, score: metrics[0].run },
    metricB: { ...metrics[1], default: metrics[1].run, score: metrics[1].run }
  };
  const entries: Array<[string, ModuleExports]> = Object.entries(exports).map(([name, values]) => [
    name,
    exportsKind === "map" ? new Map(Object.entries(values)) : values
  ]);
  const modules: ModuleRegistry =
    registryKind === "map" ? new Map(entries) : Object.fromEntries(entries);
  return { modules, calls };
}

const checkpointSource =
  'import * as first from "api";\nimport * as second from "api";\nimport { read, data } from "api";\nconst saved = [first, { namespace: second }];\nlet total = 0;\nfor (let index = 0; index < 80; index += 1) total += index;\ndata.count += 1;\nconst firstValue = await first.read(data.count);\nfor (let index = 0; index < 80; index += 1) total += index;\ndata.count += 1;\nconst secondValue = await read(data.count);\nfor (let index = 0; index < 80; index += 1) total += index;\nreturn [first === second, saved[0] === saved[1].namespace,\nfirst.read === read, first.data === data, data.count, firstValue, secondValue, total];';
const checkpointExpected = [true, true, true, true, 2, 11, 12, 9480];

beforeEach(() => {
  vol.reset();
});

describe("MC-002 independent original graph validation", () => {
  it("retains the exact substantial original source bytes", () => {
    expect(createHash("sha256").update(originalGraph).digest("hex")).toBe(
      "ad3ff24fe77d0813d0e24def6984d52c1c6014e36fa9b3a5dfd5c0d795b7fc9b"
    );
  });

  it.each(registryShapes)(
    "matches all native-anchored fields with %s/%s registries",
    async (registryKind, exportsKind) => {
      const { modules, calls } = createGraphModules(registryKind, exportsKind);
      const result = await run(originalGraph, {
        modules,
        budget: new Budget({ maxSteps: 100_000 })
      });
      expect(result.ok).toBe(true);
      if (!result.ok) throw result.error;
      expect(result.returnValue).toMatchObject({
        alpha: expectedGraph.returnValue.alpha,
        beta: expectedGraph.returnValue.beta
      });
      expect(calls).toEqual(expectedGraph.calls);
      expect(result.returnValue).toEqual(expectedGraph.returnValue);
    }
  );

  it("matches the complete original graph through the public memfs harness", async () => {
    const filepath = "/validation/original-graph.safejs";
    vol.fromJSON({ [filepath]: originalGraph });
    const { modules, calls } = createGraphModules("object", "object");
    const modulesFor = vi.fn(() => modules);
    const result = await runHarness(filepath, {
      modulesFor,
      budget: new Budget({ maxSteps: 100_000 })
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.returnValue).toMatchObject({
      alpha: expectedGraph.returnValue.alpha,
      beta: expectedGraph.returnValue.beta
    });
    expect(calls).toEqual(expectedGraph.calls);
    expect(result.returnValue).toEqual(expectedGraph.returnValue);
    expect(modulesFor).toHaveBeenCalledOnce();
  });
});

describe("MC-002 independent execution-local identity", () => {
  it.each([
    'import * as first from "api"; import data from "api"; import { read as operation } from "api";',
    'import data from "api"; import { read as operation } from "api"; import * as first from "api";',
    'import { default as data, read as operation } from "api"; import * as first from "api";',
    'import { read as operation } from "api"; import * as first from "api"; import data from "api";'
  ])("preserves standalone import ordering: %s", async (prefix) => {
    const data = { count: 4 };
    const read = vi.fn(async () => 17);
    const source =
      prefix +
      '\nimport * as again from "api";\n' +
      "return [first === again, first.default === data, first.data === data, first.read === operation, await again.read()];";
    const result = await run(source, {
      modules: { api: { default: data, data, read } },
      budget: new Budget({ maxSteps: 1_000 })
    });
    expect(result).toMatchObject({ ok: true, returnValue: [true, true, true, true, 17] });
    expect(read).toHaveBeenCalledOnce();
  });

  it("copies namespace data separately for overlapping and later executions", async () => {
    const hostData = { count: 0 };
    const modules = { api: { data: hostData } };
    const source =
      'import * as first from "api"; import * as again from "api"; first.data.count += 1; return [first === again, first.data.count, first];';
    const results = await Promise.all([run(source, { modules }), run(source, { modules })]);
    hostData.count = 20;
    results.push(await run(source, { modules }));
    const namespaces: unknown[] = [];
    for (const [index, result] of results.entries()) {
      expect(result.ok).toBe(true);
      if (!result.ok) throw result.error;
      const value = result.returnValue as unknown[];
      expect(value.slice(0, 2)).toEqual([true, index === 2 ? 21 : 1]);
      expect(namespaces).not.toContain(value[2]);
      namespaces.push(value[2]);
    }
    expect(hostData.count).toBe(20);
  });

  it("keeps distinct module names separate even with the same host export object", async () => {
    const exports = { data: { count: 0 } };
    const source =
      'import * as alpha from "alpha"; import * as beta from "beta"; alpha.data.count = 9; return [alpha !== beta, alpha.data.count, beta.data.count];';
    expect(await run(source, { modules: { alpha: exports, beta: exports } })).toMatchObject({
      ok: true,
      returnValue: [true, 9, 0]
    });
    expect(exports.data.count).toBe(0);
  });

  it("shares an empty namespace across repeated standalone imports", async () => {
    const source =
      'import * as first from "empty"; import * as second from "empty"; return [first === second, Object.keys(first).length];';
    expect(await run(source, { modules: { empty: {} } })).toMatchObject({
      ok: true,
      returnValue: [true, 0]
    });
  });
});

describe("MC-002 independent public replay and checkpoints", () => {
  it.each(["object", "map"])(
    "keeps aliases through three completed %s-registry replays",
    async (shape) => {
      const read = vi.fn(async (count: number) => count + 10);
      const exports = { data: { count: 0 }, read };
      const modules: ModuleRegistry =
        shape === "map" ? new Map([["api", new Map(Object.entries(exports))]]) : { api: exports };
      let result = await run(checkpointSource, {
        modules,
        budget: new Budget({ maxSteps: 10_000 })
      });
      expect(result).toMatchObject({ ok: true, returnValue: checkpointExpected });
      const replacement = vi.fn(async () => 999);
      for (let repeat = 0; repeat < 3; repeat += 1) {
        const snapshot = restore(JSON.parse(await dump(result)), { source: checkpointSource });
        result = await run(checkpointSource, {
          snapshot,
          modules: { api: { read: replacement } },
          budget: new Budget({ maxSteps: 10_000 })
        });
        expect(result).toMatchObject({ ok: true, returnValue: checkpointExpected });
      }
      expect(read.mock.calls).toEqual([[1], [2]]);
      expect(replacement).not.toHaveBeenCalled();
      expect(exports.data.count).toBe(0);
    }
  );

  it.each([
    { steps: 25, completedCalls: 0 },
    { steps: 900, completedCalls: 1 },
    { steps: 1800, completedCalls: 2 }
  ])(
    "restores identity after a $steps-step checkpoint with $completedCalls calls",
    async ({ steps, completedCalls }) => {
      const read = vi.fn(async (count: number) => count + 10);
      const modules = { api: { data: { count: 0 }, read } };
      const execution = run(checkpointSource, { modules, budget: new Budget({ maxSteps: steps }) });
      await expect(execution).rejects.toMatchObject({ code: "budgetExceeded", budget: "steps" });
      expect(read).toHaveBeenCalledTimes(completedCalls);
      const snapshot = restore(JSON.parse(await dump(execution, { onFailure: "checkpoint" })), {
        source: checkpointSource
      });
      const recovered = await run(checkpointSource, {
        snapshot,
        modules,
        budget: new Budget({ maxSteps: 10_000 })
      });
      expect(read.mock.calls).toEqual([[1], [2]]);
      expect(recovered).toMatchObject({ ok: true, returnValue: checkpointExpected });
      const replay = await run(checkpointSource, {
        snapshot: restore(JSON.parse(await dump(recovered)), { source: checkpointSource }),
        modules,
        budget: new Budget({ maxSteps: 10_000 })
      });
      expect(replay).toMatchObject({ ok: true, returnValue: checkpointExpected });
      expect(read.mock.calls).toEqual([[1], [2]]);
      expect(modules.api.data.count).toBe(0);
    }
  );
});
