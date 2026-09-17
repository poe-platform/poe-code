import {expect, it, vi} from "vitest";
import {Budget} from "../interp/budget.js";
import {createRealm} from "../realm.js";
import {Scope} from "../interp/scope.js";
import {createModuleEnvironment} from "./registry.js";
import {SourceModuleGraph} from "./source-graph.js";

it.each(["aliases", "denials"])("charges retained source request %s against the data budget", async mode => {
  const budget = new Budget({dataSize: 12_000});
  let calls = 0;
  const realm = createRealm({budget, sourceResolver: () => {
    calls++;
    return mode === "aliases" ? {id: "canonical", source: "export const x=1"} : undefined;
  }});
  try {
    await expect(realm.evaluate(`
      for(let i=0;i<400;i++) {
        try { await import('request-with-retained-identity-'+i); } catch {}
      }
      export const survived=true;
    `, {filename: "entry", sourceType: "module"})).rejects.toMatchObject({
      code: "budgetExceeded", budget: "dataSize"
    });
    expect(calls).toBeLessThan(400);
  } finally {
    await realm.close();
  }
});

it("charges a cached identity once, retains it across reconciliation, and releases it on close", async () => {
  const budget = new Budget({dataSize: 100});
  const resolver = vi.fn(() => undefined);
  const graph = new SourceModuleGraph({budget, resolver, scope: new Scope(),
    modules: createModuleEnvironment(undefined, {budget})});
  try {
    await expect(graph.import("denied", "entry")).rejects.toThrow("Source resolver denied");
    budget.reconcileDataUsage(0);
    const retained = budget.currentDataSize;
    expect(retained).toBeGreaterThan(0);
    for (let i=0;i<20;i++) {
      await expect(graph.import("denied", "entry")).rejects.toThrow("Source resolver denied");
      budget.reconcileDataUsage(0);
      expect(budget.currentDataSize).toBe(retained);
    }
    expect(resolver).toHaveBeenCalledTimes(1);
  } finally {
    graph.close();
  }
  expect(budget.currentDataSize).toBe(0);
});

it("rejects an over-budget request before invoking the host resolver", async () => {
  const budget = new Budget({dataSize: 10});
  const resolver = vi.fn(() => undefined);
  const graph = new SourceModuleGraph({budget, resolver, scope: new Scope(),
    modules: createModuleEnvironment(undefined, {budget})});
  try {
    await expect(graph.import("denied", "entry")).rejects.toMatchObject({
      code: "budgetExceeded", budget: "dataSize"
    });
    expect(resolver).not.toHaveBeenCalled();
    expect(budget.currentDataSize).toBe(0);
  } finally {
    graph.close();
  }
});
