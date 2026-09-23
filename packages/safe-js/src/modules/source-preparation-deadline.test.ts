import { expect, it, vi } from "vitest";
import { Budget } from "../interp/budget.js";
import { createBuiltinBindings } from "../interp/globals.js";
import { CompileScope } from "../interp/regex/compile-guard.js";
import { Scope } from "../interp/scope.js";
import { createModuleEnvironment } from "./registry.js";
import { SourceModuleGraph } from "./source-graph.js";

it("expires a pending import during synchronous source preparation and releases its deadline", async () => {
  const budget = new Budget({ maxSteps: 200000 });
  const lease = budget.acquireCompileOwner();
  const compilation = new CompileScope(lease.owner);
  const scope = new Scope(
    createBuiltinBindings({ budget, compileOwner: lease.owner }),
    undefined,
    undefined,
    { chargeData: false }
  );
  const controller = new AbortController();
  const abort = vi.fn((reason: unknown) => controller.abort(reason));
  const source = `export function cold(){return /[${"abcd".repeat(375)}]/;}export const value=1;`;
  const graph = new SourceModuleGraph({
    resolver: () => ({ id: "entry", source }),
    scope,
    budget,
    compilation,
    signal: controller.signal,
    modules: createModuleEnvironment(undefined, { budget, compileOwner: lease.owner }),
    importDeadline: { timeoutMs: 1, abort }
  });
  let now = 0;
  const clock = vi.spyOn(Date, "now").mockImplementation(() => ++now);
  try {
    await expect(graph.import("entry", "<host>")).rejects.toMatchObject({
      code: "budgetExceeded",
      budget: "deadline"
    });
    expect(abort).toHaveBeenCalledTimes(1);
    // The source's initial bulk charge precedes the first sampled parse window.
    expect(budget.stepsUsed).toBeLessThan(source.length + 2048);
    expect(graph.sourceModuleStatus().preparedModules).toBe(0);
    now = 1000;
    expect(() => budget.visitNode(1024)).not.toThrow();
  } finally {
    clock.mockRestore();
    controller.abort();
    graph.close();
    compilation.dispose();
    lease.release();
  }
});
