import { describe, expect, it } from "vitest";
import { Budget, createRealm, defineExtension, type ExtensionContext } from "./core.js";

describe("realm callback phases", () => {
  it("exposes synchronous effects before a pending tail and permits the next listener", async () => {
    const callbacks: unknown[] = [];
    const effects: unknown[] = [];
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    let context!: ExtensionContext;
    const realm = createRealm({ extensions: [defineExtension({
      manifest: { version: 1, name: "listeners", globals: ["save", "mark", "wait"] },
      setup(extension) {
        context = extension;
        return { globals: {
          save: (callback: unknown) => { callbacks.push(callback); },
          mark: (value: unknown) => { effects.push(value); },
          wait: () => pending
        } };
      }
    })] });
    try {
      await realm.evaluate(`
        save(async () => { mark("prefix"); await wait(); mark("tail"); return 42; });
        save(() => { mark("next"); return 7; });
      `);
      const first = context.startCallback(callbacks[0]);
      let settled = false;
      void first.result.then(() => { settled = true; }, () => { settled = true; });
      await first.synchronous;
      expect(effects).toEqual(["prefix"]);
      expect(settled).toBe(false);
      const next = realm.startCallback(callbacks[1]);
      await next.synchronous;
      expect(await next.result).toBe(7);
      expect(effects).toEqual(["prefix", "next"]);
      expect(settled).toBe(false);
      release();
      expect(await first.result).toBe(42);
      expect(effects).toEqual(["prefix", "next", "tail"]);
    } finally {
      release();
      await realm.close();
    }
  });

  it.each([
    ["ordinary throw", '() => { throw "failure"; }', false],
    ["async pre-await rejection", 'async () => { throw "failure"; }', true],
    ["async post-await rejection", 'async () => { await 0; throw "failure"; }', true]
  ])("distinguishes %s", async (_label, source, prefixSucceeds) => {
    let callback: unknown;
    const realm = createRealm({ bindings: { save: (value: unknown) => { callback = value; } } });
    try {
      await realm.evaluate(`save(${source});`);
      const invocation = realm.startCallback(callback);
      const [prefix, result] = await Promise.allSettled([invocation.synchronous, invocation.result]);
      expect(prefix.status).toBe(prefixSucceeds ? "fulfilled" : "rejected");
      expect(result).toEqual({ status: "rejected", reason: "failure" });
      if (!prefixSucceeds) expect(prefix).toEqual(result);
    } finally {
      await realm.close();
    }
  });

  it("rejects a pending tail on close without releasing the host wait", async () => {
    let callback: unknown;
    const realm = createRealm({ bindings: {
      save: (value: unknown) => { callback = value; },
      wait: () => new Promise(() => {})
    } });
    await realm.evaluate("save(async () => { await wait(); return 1; });");
    const invocation = realm.startCallback(callback);
    await invocation.synchronous;
    await realm.close();
    await expect(invocation.synchronous).resolves.toBeUndefined();
    await expect(invocation.result).rejects.toThrow(/closed/);
    const afterClose = realm.startCallback(callback);
    expect((await Promise.allSettled([afterClose.synchronous, afterClose.result]))
      .every((result) => result.status === "rejected")).toBe(true);
  });

  it("does not report prefix success for a fatal budget error", async () => {
    let callback: unknown;
    const realm = createRealm({
      budget: new Budget({ maxSteps: 100 }),
      bindings: { save: (value: unknown) => { callback = value; } }
    });
    try {
      await realm.evaluate("save(async () => { while (true) {} });");
      const invocation = realm.startCallback(callback);
      const results = await Promise.allSettled([invocation.synchronous, invocation.result]);
      expect(results.every((result) => result.status === "rejected")).toBe(true);
      expect(results[1]).toMatchObject({ reason: { name: "SandboxError" } });
    } finally {
      await realm.close();
    }
  });

  it.each(["0", "Promise.resolve(0)"])("observes the boundary before an already-settled await: %s", async (awaited) => {
    let callback: unknown;
    const effects: unknown[] = [];
    const realm = createRealm({ bindings: {
      save: (value: unknown) => { callback = value; },
      mark: (value: unknown) => { effects.push(value); }
    } });
    try {
      await realm.evaluate(`save(async () => { mark("before"); await ${awaited}; mark("after"); });`);
      const invocation = realm.startCallback(callback);
      await invocation.synchronous;
      expect(effects).toEqual(["before"]);
      await invocation.result;
      expect(effects).toEqual(["before", "after"]);
    } finally {
      await realm.close();
    }
  });

  it.each(["", "async "])("finishes a %sfunction prefix when it returns a pending promise", async (modifier) => {
    let callback: unknown;
    let release!: (value: number) => void;
    const pending = new Promise<number>((resolve) => { release = resolve; });
    const realm = createRealm({ bindings: {
      save: (value: unknown) => { callback = value; }, wait: () => pending
    } });
    try {
      await realm.evaluate(`save(${modifier}() => wait());`);
      const invocation = realm.startCallback(callback);
      let settled = false;
      void invocation.result.then(() => { settled = true; });
      await invocation.synchronous;
      expect(settled).toBe(false);
      release(3);
      expect(await invocation.result).toBe(3);
    } finally {
      release(3);
      await realm.close();
    }
  });

  it("preserves retained callback, receiver and argument identity", async () => {
    let callback: unknown;
    let receiver: unknown;
    let argument: unknown;
    const effects: unknown[] = [];
    const realm = createRealm({ grants: ["guest:retain"], extensions: [defineExtension({
      manifest: { version: 1, name: "identity", capabilities: ["guest:retain"], globals: ["save", "mark"] },
      setup(context) {
        return { globals: {
          save: context.retainGuestArguments((fn: unknown, self: unknown, value: unknown) => {
            callback = fn; receiver = self; argument = value;
          }, 1),
          mark: (value: unknown) => { effects.push(value); }
        } };
      }
    })] });
    try {
      await realm.evaluate(`
        const object = { value: 1 }; object.self = object;
        async function listener(value) { mark([this === object, value === object, value.self === value, value.value]); await 0; return listener; }
        save(listener, object, object); object.value = 2;
      `);
      const invocation = realm.startCallback(callback, { thisValue: receiver, args: [argument] });
      await invocation.synchronous;
      expect(effects).toEqual([[true, true, true, 2]]);
      expect(await invocation.result).toBe(callback);
      realm.releaseGuestReference(argument);
      const revoked = realm.startCallback(callback, { args: [argument] });
      expect((await Promise.allSettled([revoked.synchronous, revoked.result]))
        .every((result) => result.status === "rejected")).toBe(true);
    } finally {
      await realm.close();
    }
  });

  it.each(["foreign", "revoked", "invalid"])("rejects both handles for %s callbacks", async (kind) => {
    let callback: unknown;
    const owner = createRealm({ bindings: { save: (value: unknown) => { callback = value; } } });
    const other = createRealm();
    try {
      await owner.evaluate("save(() => 1);");
      if (kind === "revoked") owner.releaseCallback(callback);
      const invocation = (kind === "foreign" ? other : owner).startCallback(kind === "invalid" ? () => 1 : callback);
      const results = await Promise.allSettled([invocation.synchronous, invocation.result]);
      expect(results.every((result) => result.status === "rejected")).toBe(true);
      expect(results[0]).toEqual(results[1]);
    } finally {
      await owner.close();
      await other.close();
    }
  });

  it("keeps overlapping callbacks queued until the preceding prefix finishes", async () => {
    const callbacks: unknown[] = [];
    const effects: unknown[] = [];
    const budget = new Budget({ maxSteps: 20_000 });
    const realm = createRealm({ budget, bindings: {
      save: (value: unknown) => { callbacks.push(value); },
      mark: (value: unknown) => { effects.push(value); },
      wait: () => new Promise(() => {})
    } });
    try {
      await realm.evaluate(`
        save(async () => { let count = 0; for (let index = 0; index < 200; index++) count++; mark(count); await wait(); });
        save(() => { mark("next"); });
      `);
      const first = realm.startCallback(callbacks[0]);
      const next = realm.startCallback(callbacks[1]);
      expect(effects).toEqual([]);
      await first.synchronous;
      expect(effects[0]).toBe(200);
      expect(budget.stepsUsed).toBeGreaterThan(1000);
      await next.result;
      expect(effects).toEqual([200, "next"]);
      await realm.close();
      await expect(first.result).rejects.toThrow(/closed/);
    } finally {
      await realm.close();
    }
  });

  it("awaits nested dispatch without lending source reentry authority", async () => {
    const callbacks: unknown[] = [];
    const effects: unknown[] = [];
    const realm = createRealm({ extensions: [defineExtension({
      manifest: { version: 1, name: "dispatch", capabilities: ["source:nested"], globals: ["save", "mark", "dispatch", "wait"] },
      setup(context) {
        return { globals: {
          save: (value: unknown) => { callbacks.push(value); },
          mark: (value: unknown) => { effects.push(value); },
          dispatch: context.nestedOperation(async () => {
            const nested = context.startCallback(callbacks[1]);
            await nested.synchronous;
            effects.push("host");
          }),
          wait: () => new Promise(() => {})
        } };
      }
    })], grants: ["source:nested"] });
    try {
      await realm.evaluate(`
        save(() => { mark("outer"); dispatch(); mark("returned"); });
        save(async () => { mark("inner"); await wait(); });
      `);
      const invocation = realm.startCallback(callbacks[0]);
      await invocation.synchronous;
      expect(effects).toEqual(["outer", "inner", "host", "returned"]);
      await invocation.result;
    } finally {
      await realm.close();
    }
  });

  it.each(["close", "abort"])("rejects unfinished prefixes and queued calls on %s", async (action) => {
    const callbacks: unknown[] = [];
    const controller = new AbortController();
    const realm = createRealm({ signal: controller.signal, bindings: {
      save: (value: unknown) => { callbacks.push(value); }
    } });
    await realm.evaluate("save(() => 1); save(() => 2);");
    const first = realm.startCallback(callbacks[0]);
    const next = realm.startCallback(callbacks[1]);
    if (action === "abort") controller.abort(new Error("stopped"));
    await realm.close();
    const outcomes = await Promise.allSettled([first.synchronous, first.result, next.synchronous, next.result]);
    expect(outcomes.every((outcome) => outcome.status === "rejected")).toBe(true);
  });

  it("keeps pending callbacks bounded and allows reuse after settlement", async () => {
    const callbacks: unknown[] = [];
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const realm = createRealm({ limits: { callbacks: 2 }, bindings: {
      save: (value: unknown) => { callbacks.push(value); }, wait: () => pending
    } });
    try {
      await realm.evaluate("save(async () => { await wait(); return 1; }); save(async () => { await wait(); return 2; });");
      const first = realm.startCallback(callbacks[0]);
      await first.synchronous;
      const next = realm.startCallback(callbacks[1]);
      await next.synchronous;
      const excess = realm.startCallback(callbacks[0]);
      await expect(excess.synchronous).rejects.toThrow(/pending callback limit/);
      await expect(excess.result).rejects.toThrow(/pending callback limit/);
      release();
      expect(await Promise.all([first.result, next.result])).toEqual([1, 2]);
      expect(await realm.startCallback(callbacks[0]).result).toBe(1);
    } finally {
      release();
      await realm.close();
    }
  });

  it("rejects overlapping invocation of the same callback and aborts its tail", async () => {
    let callback: unknown;
    const realm = createRealm({ bindings: {
      save: (value: unknown) => { callback = value; }, wait: () => new Promise(() => {})
    } });
    try {
      await realm.evaluate("save(async () => { await wait(); });");
      const first = realm.startCallback(callback);
      await first.synchronous;
      const next = realm.startCallback(callback);
      await expect(next.synchronous).rejects.toMatchObject({ code: "reentry" });
      await expect(next.result).rejects.toMatchObject({ code: "reentry" });
      await expect(first.result).rejects.toMatchObject({ code: "reentry" });
    } finally {
      await realm.close();
    }
  });

  it("does not confuse a child's suspension with the enclosing callback prefix", async () => {
    let callback: unknown;
    const effects: unknown[] = [];
    const realm = createRealm({ bindings: {
      save: (value: unknown) => { callback = value; },
      mark: (value: unknown) => { effects.push(value); },
      wait: () => new Promise(() => {})
    } });
    try {
      await realm.evaluate(`
        save(async () => {
          async function child() { mark("child"); await wait(); }
          child(); mark("parent"); await wait();
        });
      `);
      const invocation = realm.startCallback(callback);
      await invocation.synchronous;
      expect(effects).toEqual(["child", "parent"]);
    } finally {
      await realm.close();
    }
  });

  it("does not treat a host implementation yield as a guest suspension", async () => {
    let callback: unknown;
    let entered!: () => void;
    let release!: () => void;
    const entering = new Promise<void>((resolve) => { entered = resolve; });
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const effects: unknown[] = [];
    const realm = createRealm({ grants: ["source:nested"], extensions: [defineExtension({
      manifest: { version: 1, name: "yield", capabilities: ["source:nested"], globals: ["save", "work", "mark"] },
      setup(context) {
        return { globals: {
          save: (value: unknown) => { callback = value; },
          mark: (value: unknown) => { effects.push(value); },
          work: context.nestedOperation(async () => {
            context.chargeWork(100);
            entered();
            await pending;
            context.chargeWork(100);
          })
        } };
      }
    })] });
    try {
      await realm.evaluate('save(async () => { work(); mark("done"); });');
      const invocation = realm.startCallback(callback);
      let completed = false;
      void invocation.synchronous.then(() => { completed = true; }, () => {});
      await entering;
      expect(completed).toBe(false);
      expect(effects).toEqual([]);
      release();
      await invocation.synchronous;
      expect(effects).toEqual(["done"]);
      await invocation.result;
    } finally {
      release();
      await realm.close();
    }
  });

  it.each(["abort", "fatal"])("cancels all tails after %s without changing completed prefixes", async (action) => {
    const callbacks: unknown[] = [];
    const controller = new AbortController();
    const budget = new Budget({ maxSteps: 300 });
    const realm = createRealm({ signal: controller.signal, budget, bindings: {
      save: (value: unknown) => { callbacks.push(value); },
      wait: () => new Promise(() => {})
    } });
    try {
      await realm.evaluate("save(async () => { await wait(); }); save(async () => { while (true) {} });");
      const first = realm.startCallback(callbacks[0]);
      await first.synchronous;
      if (action === "abort") controller.abort(new Error("stopped"));
      else {
        const fatal = realm.startCallback(callbacks[1]);
        const results = await Promise.allSettled([fatal.synchronous, fatal.result]);
        expect(results.every((result) => result.status === "rejected")).toBe(true);
      }
      await expect(first.synchronous).resolves.toBeUndefined();
      await expect(first.result).rejects.toBeDefined();
      await realm.close();
      expect(budget.currentCallDepth).toBe(0);
      const replacement = createRealm({ budget });
      await replacement.close();
    } finally {
      await realm.close();
    }
  });

  it("keeps source evaluation reentry denied during a suspended callback", async () => {
    let callback: unknown;
    const realm = createRealm({ bindings: {
      save: (value: unknown) => { callback = value; }, wait: () => new Promise(() => {})
    } });
    try {
      await realm.evaluate("save(async () => { await wait(); });");
      const invocation = realm.startCallback(callback);
      await invocation.synchronous;
      await expect(realm.evaluate("return 1;")).rejects.toMatchObject({ code: "reentry" });
    } finally {
      await realm.close();
    }
  });

  it.each(["close", "abort"])("interrupts a host wait inside an unfinished prefix on %s", async (action) => {
    let callback: unknown;
    let entered!: () => void;
    const entering = new Promise<void>((resolve) => { entered = resolve; });
    const controller = new AbortController();
    const realm = createRealm({ signal: controller.signal, grants: ["source:nested"], extensions: [defineExtension({
      manifest: { version: 1, name: "blocked-prefix", capabilities: ["source:nested"], globals: ["save", "work"] },
      setup(context) {
        return { globals: {
          save: (value: unknown) => { callback = value; },
          work: context.nestedOperation(() => { entered(); return new Promise(() => {}); })
        } };
      }
    })] });
    try {
      await realm.evaluate("save(async () => { work(); });");
      const invocation = realm.startCallback(callback);
      await entering;
      if (action === "abort") controller.abort(new Error("stopped"));
      await realm.close();
      const results = await Promise.allSettled([invocation.synchronous, invocation.result]);
      expect(results.every((result) => result.status === "rejected")).toBe(true);
    } finally {
      await realm.close();
    }
  });
});
