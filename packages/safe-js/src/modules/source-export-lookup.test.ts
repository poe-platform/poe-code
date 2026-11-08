import { expect, it } from "vitest";
import { Budget } from "../interp/budget.js";
import { Scope } from "../interp/scope.js";
import { isSandboxClosure } from "../interp/values.js";
import { createModuleEnvironment } from "./registry.js";
import { SourceModuleGraph } from "./source-graph.js";

it("builds a large explicit namespace within a linear linking step allowance", async () => {
  const budget = new Budget({ maxSteps: 20000 });
  const graph = new SourceModuleGraph({
    budget,
    scope: new Scope(),
    modules: createModuleEnvironment(undefined, { budget }),
    resolver: () => undefined
  });
  const source = Array.from({ length: 600 }, (_, index) => `export const e${index}=${index};`).join(
    "\n"
  );
  try {
    const namespace = await graph.evaluateSource({ id: "entry", source });
    expect(Object.keys(namespace)).toHaveLength(600);
    expect(namespace.e599).toBe(599);
    expect(budget.stepsUsed).toBeLessThan(20000);
  } finally {
    graph.close();
  }
});

it("accounts for retained lookup storage and releases it when the graph closes", async () => {
  const budget = new Budget();
  const graph = new SourceModuleGraph({
    budget,
    scope: new Scope(),
    modules: createModuleEnvironment(undefined, { budget }),
    resolver: () => undefined
  });
  try {
    await graph.evaluateSource({ id: "entry", source: "export const value=1" });
    budget.reconcileDataUsage(0);
    expect(budget.currentDataSize).toBeGreaterThan(0);
  } finally {
    graph.close();
  }
  budget.reconcileDataUsage(0);
  expect(budget.currentDataSize).toBe(0);
});

it.each([false, true])(
  "enforces lookup storage quotas before evaluation (held=%s)",
  async (held) => {
    const source = "export const value=1";
    const budget = new Budget({
      dataSize: source.length + "entry".length + 1 + "value".length + 1
    });
    const graph = new SourceModuleGraph({
      budget,
      scope: new Scope(),
      modules: createModuleEnvironment(undefined, { budget }),
      resolver: () => undefined
    });
    const release = held ? budget.deferReconciliation() : undefined;
    let evaluated = false;
    try {
      await expect(
        graph.evaluateSource({ id: "entry", source }, () => {
          evaluated = true;
        })
      ).rejects.toMatchObject({ code: "budgetExceeded", budget: "dataSize" });
      expect(evaluated).toBe(false);
    } finally {
      release?.();
      graph.close();
    }
    budget.reconcileDataUsage(0);
    expect(budget.currentDataSize).toBe(0);
  }
);

it("keeps resolved namespace reads live after lookup storage is released", async () => {
  const budget = new Budget();
  const graph = new SourceModuleGraph({
    budget,
    scope: new Scope(),
    modules: createModuleEnvironment(undefined, { budget }),
    resolver: () => undefined
  });
  const namespace = await graph.evaluateSource({ id: "entry", source: "export const value=7" });
  graph.close();
  expect(namespace.value).toBe(7);
});

it.each([false, true])("stops indexing when storage is exhausted (held=%s)", async (held) => {
  const source = Array.from({ length: 600 }, (_, i) => `export const e${i}=${i};`).join("\n");
  // Source storage and the first definition fit; the second definition does not.
  const budget = new Budget({ dataSize: source.length + "entry".length + 1 + 4 });
  const graph = new SourceModuleGraph({
    budget,
    scope: new Scope(),
    modules: createModuleEnvironment(undefined, { budget }),
    resolver: () => undefined
  });
  const release = held ? budget.deferReconciliation() : undefined;
  try {
    await expect(graph.evaluateSource({ id: "entry", source })).rejects.toMatchObject({
      code: "budgetExceeded",
      budget: "dataSize"
    });
    expect(budget.stepsUsed).toBeLessThanOrEqual(2);
  } finally {
    release?.();
    graph.close();
  }
  budget.reconcileDataUsage(0);
  expect(budget.currentDataSize).toBe(0);
});

it("resolves many imported export aliases without caching their live values", async () => {
  const budget = new Budget({ maxSteps: 10000 });
  const names = Array.from({ length: 128 }, (_, i) => `e${i}`);
  const dependency =
    names.map((name, i) => `export let ${name}=${i};`).join("\n") +
    "export function bump(){e127=900}";
  const source =
    `import {${names.map((name) => `${name} as a${name}`).join(",")},bump} from 'dep';` +
    `export {${names.map((name) => `a${name}`).join(",")},bump};`;
  const graph = new SourceModuleGraph({
    budget,
    scope: new Scope(),
    modules: createModuleEnvironment(undefined, { budget }),
    resolver: (id) => (id === "dep" ? { id, source: dependency } : undefined)
  });
  try {
    const namespace = await graph.evaluateSource({ id: "entry", source });
    expect(namespace.ae127).toBe(127);
    const bump = namespace.bump;
    if (!isSandboxClosure(bump)) throw new Error("Missing function");
    await bump.call([]);
    expect(namespace.ae127).toBe(900);
    expect(budget.stepsUsed).toBeLessThan(10000);
  } finally {
    graph.close();
  }
});
