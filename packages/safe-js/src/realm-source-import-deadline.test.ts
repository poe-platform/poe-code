import { afterEach, expect, it, vi } from "vitest";
import { Budget, createRealm, defineExtension, type RealmOptions } from "./core.js";

afterEach(() => vi.useRealTimers());

function deferred<Value = void>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((fulfill) => {
    resolve = fulfill;
  });
  return { promise, resolve };
}

function fixture(options: RealmOptions = {}) {
  const budget = new Budget({ maxSteps: 2000000, dataSize: 200000 });
  const cleanup = vi.fn();
  const realm = createRealm({
    classicScripts: true,
    classicScriptErrors: "report",
    callbackScheduling: "after-prefix",
    sourceImportTimeoutMs: 100,
    budget,
    extensions: [
      defineExtension({
        manifest: { version: 1, name: "import-deadline-cleanup" },
        setup(context) {
          context.onCleanup(cleanup);
          return {};
        }
      })
    ],
    ...options
  });
  return { realm, budget, cleanup };
}

async function launch(
  realm: ReturnType<typeof createRealm>,
  source = "void import('dep').catch(()=>{});"
) {
  expect(await realm.evaluate(source, { filename: "classic", discardResult: true })).toMatchObject({
    ok: true
  });
}

it("publishes an immutable import timeout and leaves it disabled by default", async () => {
  for (const timeout of [undefined, 100]) {
    const realm = createRealm(timeout === undefined ? {} : { sourceImportTimeoutMs: timeout });
    try {
      expect(Object.getOwnPropertyDescriptor(realm, "sourceImportTimeoutMs")).toEqual({
        value: timeout,
        enumerable: true,
        configurable: false,
        writable: false
      });
    } finally {
      await realm.close();
    }
  }
});

it.each([0, -1, 0.5, NaN, Infinity, 2147483648, "100", null])(
  "rejects invalid import timeout %s before creating a realm",
  (sourceImportTimeoutMs) => {
    expect(() => createRealm({ sourceImportTimeoutMs } as unknown as RealmOptions)).toThrow(
      TypeError
    );
  }
);

it.each([undefined, "after-prefix"] as const)(
  "revokes an unresolved classic import after the originating task ends (%s)",
  async (callbackScheduling) => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let signal: AbortSignal | undefined;
    const resolved = deferred<{ id: string; source: string }>();
    const resumed = vi.fn();
    const { realm, budget, cleanup } = fixture({
      callbackScheduling,
      bindings: { resumed },
      sourceResolver: (_specifier, _referrer, context) => {
        signal = context.signal;
        return resolved.promise;
      }
    });
    try {
      await launch(realm, "void import('dep').then(()=>resumed(),()=>{});");
      expect(signal?.aborted).toBe(false);
      expect(realm.sourceModuleStatus().pendingImports).toBe(1);
      await vi.advanceTimersByTimeAsync(99);
      expect(signal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(signal?.reason).toMatchObject({
        code: "budgetExceeded",
        budget: "deadline"
      });
      await realm.close();
      resolved.resolve({
        id: "dep",
        source: "resumed();export const answer=42;"
      });
      await Promise.resolve();
      expect(resumed).not.toHaveBeenCalled();
      expect(cleanup).toHaveBeenCalledOnce();
      expect(budget.currentDataSize).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
      await expect(realm.evaluate("return 1")).rejects.toMatchObject({
        code: "budgetExceeded",
        budget: "deadline"
      });
    } finally {
      await realm.close();
    }
  }
);

it("times out an unresolving top-level await and prevents dependent evaluation", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const started = deferred();
  const resumed = vi.fn();
  let signal: AbortSignal | undefined;
  const { realm, budget, cleanup } = fixture({
    bindings: { ready: () => started.resolve(), resumed },
    sourceResolver: (id, _referrer, context) => {
      signal = context.signal;
      return {
        id,
        source:
          id === "dep"
            ? "import 'child';resumed();"
            : "ready();await new Promise(()=>{});resumed();"
      };
    }
  });
  try {
    await launch(realm);
    await started.promise;
    expect(realm.sourceModuleStatus()).toMatchObject({
      pendingImports: 1,
      preparedModules: 2
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(signal?.reason).toMatchObject({
      code: "budgetExceeded",
      budget: "deadline"
    });
    await realm.close();
    expect(resumed).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledOnce();
    expect(budget.currentDataSize).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    await realm.close();
  }
});

it("does not renew an earlier import deadline when another import starts", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const signals: AbortSignal[] = [];
  const { realm, budget } = fixture({
    sourceResolver: (_specifier, _referrer, context) => {
      signals.push(context.signal!);
      return new Promise(() => {});
    }
  });
  try {
    await launch(realm);
    await vi.advanceTimersByTimeAsync(60);
    await launch(realm, "void import('later').catch(()=>{});");
    expect(realm.sourceModuleStatus().pendingImports).toBe(2);
    await vi.advanceTimersByTimeAsync(40);
    expect(signals).toHaveLength(2);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    await realm.close();
    expect(budget.currentDataSize).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    await realm.close();
  }
});

it("revokes a module cycle suspended in top-level await without running its continuation", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const started = deferred();
  const resumed = vi.fn();
  let signal: AbortSignal | undefined;
  const { realm, budget } = fixture({
    bindings: { ready: () => started.resolve(), resumed },
    sourceResolver: (id, _referrer, context) => {
      signal = context.signal;
      return {
        id,
        source:
          id === "dep"
            ? "import 'child';ready();await new Promise(()=>{});resumed();"
            : "import 'dep';export const token=1;"
      };
    }
  });
  try {
    await launch(realm);
    await started.promise;
    expect(realm.sourceModuleStatus()).toMatchObject({
      pendingImports: 1,
      preparedModules: 2
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(signal?.reason).toMatchObject({
      code: "budgetExceeded",
      budget: "deadline"
    });
    await realm.close();
    expect(resumed).not.toHaveBeenCalled();
    expect(budget.currentDataSize).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    await realm.close();
  }
});

it("keeps one elapsed deadline across source resolution and top-level await", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const resolved = deferred<{ id: string; source: string }>();
  const started = deferred();
  let signal: AbortSignal | undefined;
  const { realm, budget } = fixture({
    bindings: { ready: () => started.resolve() },
    sourceResolver: (_specifier, _referrer, context) => {
      signal = context.signal;
      return resolved.promise;
    }
  });
  try {
    await launch(realm);
    await vi.advanceTimersByTimeAsync(60);
    resolved.resolve({
      id: "dep",
      source: "ready();await new Promise(()=>{});"
    });
    await started.promise;
    await vi.advanceTimersByTimeAsync(39);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(signal?.reason).toMatchObject({
      code: "budgetExceeded",
      budget: "deadline"
    });
    await realm.close();
    expect(budget.currentDataSize).toBe(0);
  } finally {
    await realm.close();
  }
});

it.each([true, false])(
  "clears the deadline after a successful or caught denied import (%s)",
  async (success) => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const done = deferred();
    const { realm, budget } = fixture({
      bindings: { done: () => done.resolve() },
      sourceResolver: () => (success ? { id: "dep", source: "export const answer=42;" } : undefined)
    });
    try {
      await launch(realm, "void import('dep').then(()=>done(),()=>done());");
      await done.promise;
      expect(realm.sourceModuleStatus()).toMatchObject({
        pendingImports: 0,
        fulfilledImports: success ? 1 : 0,
        rejectedImports: success ? 0 : 1
      });
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(1000);
      expect(await realm.evaluate("var alive=42;")).toMatchObject({ ok: true });
    } finally {
      await realm.close();
    }
    expect(budget.currentDataSize).toBe(0);
  }
);

it("clears the deadline on explicit close without overwriting the close reason", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  let signal: AbortSignal | undefined;
  const { realm, budget } = fixture({
    sourceResolver: (_specifier, _referrer, context) => {
      signal = context.signal;
      return new Promise(() => {});
    }
  });
  await launch(realm);
  await realm.close();
  const reason = signal?.reason;
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(1000);
  expect(signal?.reason).toBe(reason);
  expect(budget.currentDataSize).toBe(0);
});

it("leaves pending imports unbounded when the timeout is not configured", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const { realm, budget } = fixture({
    sourceImportTimeoutMs: undefined,
    sourceResolver: () => new Promise(() => {})
  });
  try {
    await launch(realm);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(realm.sourceModuleStatus().pendingImports).toBe(1);
  } finally {
    await realm.close();
  }
  expect(budget.currentDataSize).toBe(0);
});

it("clears the deadline on owner revocation and preserves its reason", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const controller = new AbortController();
  let signal: AbortSignal | undefined;
  const reason = new Error("owner revoked");
  const { realm, budget } = fixture({
    signal: controller.signal,
    sourceResolver: (_specifier, _referrer, context) => {
      signal = context.signal;
      return new Promise(() => {});
    }
  });
  try {
    await launch(realm);
    controller.abort(reason);
    await realm.close();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(signal?.reason).toBe(reason);
    expect(budget.currentDataSize).toBe(0);
  } finally {
    await realm.close();
  }
});

it("interrupts executing module code at controlled checkpoints with a real host timer", async () => {
  let signal: AbortSignal | undefined;
  const started = deferred();
  const { realm, budget } = fixture({
    sourceImportTimeoutMs: 200,
    bindings: { ready: () => started.resolve() },
    sourceResolver: (_specifier, _referrer, context) => {
      signal = context.signal;
      return { id: "dep", source: "ready();while(true){}" };
    }
  });
  try {
    const execution = realm.evaluate("void import('dep').catch(()=>{});", {
      filename: "classic",
      discardResult: true
    });
    const outcome = execution.then(
      (result) => ({ result }),
      (error: unknown) => ({ error })
    );
    await started.promise;
    if (!signal!.aborted)
      await new Promise<void>((resolve) =>
        signal!.addEventListener("abort", () => resolve(), { once: true })
      );
    const settled = await outcome;
    if ("error" in settled)
      expect(settled.error).toMatchObject({
        code: "budgetExceeded",
        budget: "deadline"
      });
    else expect(settled.result).toMatchObject({ ok: true });
    expect(signal?.reason).toMatchObject({
      code: "budgetExceeded",
      budget: "deadline"
    });
    await realm.close();
    expect(budget.currentDataSize).toBe(0);
  } finally {
    await realm.close();
  }
});
