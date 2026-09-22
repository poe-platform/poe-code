import { vi } from "vitest";

// These fixtures exercise archive contents, not host timer scheduling.
vi.mock("../../../office-package/src/runtime.js", async importOriginal => {
  const runtime = await importOriginal<typeof import("../../../office-package/src/runtime.js")>();
  return { ...runtime, defaultRuntime: { ...runtime.defaultRuntime,
    async yieldTurn(signal: AbortSignal) {
      signal.throwIfAborted();
      await Promise.resolve();
      signal.throwIfAborted();
    }
  } };
});

vi.mock("../../src/budget.js", async importOriginal => {
  const budget = await importOriginal<typeof import("../../src/budget.js")>();
  return { ...budget, DocumentBudget: class extends budget.DocumentBudget {
    constructor(limits?: Partial<import("../../src/budget.js").DocumentLimits>, signal?: AbortSignal,
      yieldTurn = async (signal: AbortSignal) => {
        signal.throwIfAborted();
        await Promise.resolve();
        signal.throwIfAborted();
      }) {
      super(limits, signal, yieldTurn);
    }
  } };
});

