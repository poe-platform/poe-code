import { expect, it, vi } from "vitest";
import { Budget } from "../interp/budget.js";
import { CompileScope } from "../interp/regex/compile-guard.js";
import { Scope } from "../interp/scope.js";
import { createModuleEnvironment } from "./registry.js";
import { SourceModuleGraph } from "./source-graph.js";

function fixture(budget = new Budget(), scope = new Scope()) {
  const lease = budget.acquireCompileOwner();
  const compilation = new CompileScope(lease.owner);
  const graph = new SourceModuleGraph({
    resolver: () => undefined,
    scope,
    budget,
    compilation,
    modules: createModuleEnvironment(undefined, { budget, compileOwner: lease.owner })
  });
  return {
    graph,
    close() {
      graph.close();
      compilation.dispose();
      lease.release();
    }
  };
}

it("does not allocate unused public binding snapshots during source-module execution", async () => {
  const spy = vi.spyOn(Scope.prototype, "snapshot");
  const { graph, close } = fixture();
  try {
    const namespace = await graph.evaluateSource({
      id: "entry",
      source: "export function cold(){return 7}export const ready=true"
    });
    expect(namespace.ready).toBe(true);
    expect(spy).not.toHaveBeenCalled();
    expect(namespace.cold).toBe(namespace.cold);
  } finally {
    spy.mockRestore();
    close();
  }
});

it.each([false, true])(
  "still reconciles fresh retained data without snapshots (held=%s)",
  async (held) => {
    const budget = new Budget({ dataSize: 1000 });
    const parent = new Scope();
    let reads = 0;
    parent.retainedDataRoots = () => (++reads < 3 ? [] : ["x".repeat(2000)]);
    const { graph, close } = fixture(budget, parent);
    const release = held ? budget.deferReconciliation() : undefined;
    try {
      await expect(
        graph.evaluateSource({
          id: "entry",
          source: "function cold(){return 7}export const ready=true"
        })
      ).rejects.toMatchObject({ code: "budgetExceeded", budget: "dataSize" });
      expect(reads).toBeGreaterThanOrEqual(3);
    } finally {
      release?.();
      close();
    }
  }
);
