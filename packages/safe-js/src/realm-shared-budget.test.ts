import { expect, it } from "vitest";
import { Budget, createRealm, defineExtension } from "./core.js";

it("leases explicit realm views without resetting usage or weakening ordinary compile ownership", () => {
  const root = new Budget({ maxSteps: 5 });
  const parent = root.acquireRealmOwner();
  root.visitNode(3);
  const view = root.forkRealm();
  const child = view.acquireRealmOwner();
  try {
    expect(child.owner).toBe(parent.owner);
    expect(view.stepsUsed).toBe(3);
    expect(() => root.acquireRealmOwner()).toThrow("already running");
    expect(() => view.acquireRealmOwner()).toThrow("already running");
    expect(() => view.acquireCompileOwner(true)).toThrow("already running");
    expect(() => new Budget().acquireCompileOwner(false, child.owner)).toThrow("already running");
    parent.release();
    parent.release();
    expect(() => root.reset()).toThrow("already running");
    view.visitNode(2);
    expect(() => root.forkRealm().visitNode()).toThrow("steps");
  } finally {
    child.release();
    parent.release();
  }
  root.reset();
  expect(root.stepsUsed).toBe(0);
});

it("does not grant a fresh allowance when a view starts before or after other realms", async () => {
  const root = new Budget({ maxSteps: 100000 });
  root.visitNode(1000);
  const first = createRealm({ budget: root.forkRealm() });
  try {
    expect(root.stepsUsed).toBe(1000);
    expect(await first.evaluate("return 7")).toMatchObject({
      ok: true,
      returnValue: 7
    });
  } finally {
    await first.close();
  }
  const previous = root.stepsUsed;
  const next = createRealm({ budget: root.forkRealm() });
  try {
    expect(root.stepsUsed).toBe(previous);
    expect(await next.evaluate("return 8")).toMatchObject({
      ok: true,
      returnValue: 8
    });
    expect(root.stepsUsed).toBeGreaterThan(previous);
  } finally {
    await next.close();
  }
  expect(root.currentDataSize).toBe(0);
});

it("isolates globals and intrinsic prototypes while retaining sibling compiled closures", async () => {
  const root = new Budget({ dataSize: 100000 });
  const parent = createRealm({ budget: root });
  const child = createRealm({ budget: root.forkRealm() });
  try {
    expect(
      await parent.evaluate(
        `globalThis.held = 'p'.repeat(1000); Number.prototype.marker = 'parent'; globalThis.f = function(x) {return held.length + x;}; return true;`
      )
    ).toMatchObject({ ok: true, returnValue: true });
    expect(
      await child.evaluate(
        `globalThis.held = 'c'.repeat(2000); return [Number.prototype.marker === undefined, held.length];`
      )
    ).toMatchObject({ ok: true, returnValue: [true, 2000] });
    const both = root.currentDataSize;
    await child.close();
    expect(root.currentDataSize).toBeGreaterThanOrEqual(1000);
    expect(root.currentDataSize).toBeLessThan(both);
    expect(await parent.evaluate("return [f(2), Number.prototype.marker]")).toMatchObject({
      ok: true,
      returnValue: [1002, "parent"]
    });
    expect(() => root.reset()).toThrow("already running");
  } finally {
    await parent.close();
    await child.close();
  }
  expect(root.currentDataSize).toBe(0);
});

it("keeps a surviving child alive after its parent's globals and prototypes are released", async () => {
  const root = new Budget();
  const parent = createRealm({ budget: root });
  const child = createRealm({ budget: root.forkRealm() });
  try {
    await parent.evaluate("globalThis.parentOnly = 'p'.repeat(500);");
    await child.evaluate(
      "globalThis.childOnly = 'c'.repeat(800); globalThis.f = x => childOnly.length + x;"
    );
    await parent.close();
    expect(root.currentDataSize).toBeGreaterThanOrEqual(800);
    expect(
      await child.evaluate("return [f(2), globalThis.parentOnly === undefined];")
    ).toMatchObject({ ok: true, returnValue: [802, true] });
  } finally {
    await parent.close();
    await child.close();
  }
  expect(root.currentDataSize).toBe(0);
});

it("enforces aggregate live data rather than independent per-realm allowances", async () => {
  const independentBudget = new Budget({ dataSize: 6000 });
  const independent = createRealm({ budget: independentBudget });
  try {
    expect(await independent.evaluate("globalThis.held = 'c'.repeat(2000);")).toMatchObject({
      ok: true
    });
  } finally {
    await independent.close();
  }
  expect(independentBudget.currentDataSize).toBe(0);
  const root = new Budget({ dataSize: 6000 });
  const parent = createRealm({ budget: root });
  const child = createRealm({ budget: root.forkRealm() });
  try {
    expect(
      await parent.evaluate("globalThis.held = 'p'.repeat(2000); return held.length;")
    ).toMatchObject({ ok: true, returnValue: 2000 });
    await expect(child.evaluate("globalThis.held = 'c'.repeat(2000);")).rejects.toMatchObject({
      code: "budgetExceeded",
      budget: "dataSize"
    });
    await child.close();
    expect(root.currentDataSize).toBeGreaterThanOrEqual(2000);
    expect(await parent.evaluate("return held.length;")).toMatchObject({
      ok: true,
      returnValue: 2000
    });
  } finally {
    await parent.close();
    await child.close();
  }
  expect(root.currentDataSize).toBe(0);
});

it("keeps aggregate steps exhausted across sibling closure and later fork creation", async () => {
  const root = new Budget({ maxSteps: 1000 });
  const parent = createRealm({ budget: root });
  const child = createRealm({ budget: root.forkRealm() });
  try {
    expect(await parent.evaluate("return 7;")).toMatchObject({
      ok: true,
      returnValue: 7
    });
    const previous = root.stepsUsed;
    expect(await child.evaluate("return 8;")).toMatchObject({
      ok: true,
      returnValue: 8
    });
    expect(root.stepsUsed).toBeGreaterThan(previous);
    await expect(child.evaluate("while(true) {};")).rejects.toMatchObject({
      code: "budgetExceeded",
      budget: "steps"
    });
    await child.close();
    const last = createRealm({ budget: root.forkRealm() });
    try {
      await expect(last.evaluate("return 9;")).rejects.toMatchObject({
        code: "budgetExceeded",
        budget: "steps"
      });
    } finally {
      await last.close();
    }
  } finally {
    await parent.close();
    await child.close();
  }
  expect(root.currentDataSize).toBe(0);
});

it("releases a failed constructor's view lease without releasing a live sibling", async () => {
  const root = new Budget(),
    view = root.forkRealm();
  const parent = createRealm({ budget: root });
  const extension = defineExtension({
    manifest: { version: 1, name: "duplicate" },
    setup() {
      return {};
    }
  });
  try {
    expect(() => createRealm({ budget: view, extensions: [extension, extension] })).toThrow(
      "Duplicate extension"
    );
    const child = createRealm({ budget: view });
    try {
      expect(await child.evaluate("return 42;")).toMatchObject({
        ok: true,
        returnValue: 42
      });
    } finally {
      await child.close();
    }
    expect(await parent.evaluate("return 7;")).toMatchObject({
      ok: true,
      returnValue: 7
    });
  } finally {
    await parent.close();
  }
  expect(root.currentDataSize).toBe(0);
});

it("rejects duplicate realm views and keeps cancellation local to the canceled realm", async () => {
  const root = new Budget(),
    view = root.forkRealm(),
    controller = new AbortController();
  const parent = createRealm({ budget: root });
  const child = createRealm({ budget: view, signal: controller.signal });
  try {
    expect(() => createRealm({ budget: root })).toThrow("already running");
    expect(() => createRealm({ budget: view })).toThrow("already running");
    await child.evaluate("globalThis.held = 'x'.repeat(1000);");
    controller.abort();
    await child.close();
    expect(await parent.evaluate("return 42;")).toMatchObject({
      ok: true,
      returnValue: 42
    });
  } finally {
    await parent.close();
    await child.close();
  }
  expect(root.currentDataSize).toBe(0);
});

it("does not discard suspended callback roots while another realm reconciles or closes", async () => {
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let callback: unknown;
  const root = new Budget({ dataSize: 100000 });
  const parent = createRealm({
    budget: root,
    bindings: {
      save(value) {
        callback = value;
      },
      wait: () => pending
    }
  });
  const child = createRealm({
    budget: root.forkRealm()
  });
  let invocation: ReturnType<typeof parent.startCallback> | undefined;
  try {
    await parent.evaluate(
      "save(async () => {const held = 'h'.repeat(3000); await wait(); return held.length;});"
    );
    invocation = parent.startCallback(callback);
    await invocation.synchronous;
    expect(await child.evaluate("return 42;")).toMatchObject({
      ok: true,
      returnValue: 42
    });
    await child.close();
    expect(root.currentDataSize).toBeGreaterThanOrEqual(3000);
    finish();
    expect(await invocation.result).toBe(3000);
    expect(await parent.evaluate("return 7;")).toMatchObject({
      ok: true,
      returnValue: 7
    });
  } finally {
    finish();
    await parent.close();
    await child.close();
    await invocation?.result.catch(() => undefined);
  }
  expect(root.currentDataSize).toBe(0);
});

it("releases the view lease even when cleanup rejects", async () => {
  const root = new Budget(),
    view = root.forkRealm();
  const parent = createRealm({ budget: root });
  const extension = defineExtension({
    manifest: { version: 1, name: "cleanup" },
    setup(context) {
      context.onCleanup(() => {
        throw new Error("expected cleanup failure");
      });
      return {};
    }
  });
  const child = createRealm({ budget: view, extensions: [extension] });
  try {
    await child.evaluate("return 1;");
    await expect(child.close()).rejects.toThrow("Realm cleanup failed");
    const replacement = createRealm({ budget: view });
    try {
      expect(await replacement.evaluate("return 42;")).toMatchObject({
        ok: true,
        returnValue: 42
      });
    } finally {
      await replacement.close();
    }
    expect(await parent.evaluate("return 7;")).toMatchObject({
      ok: true,
      returnValue: 7
    });
  } finally {
    await parent.close();
    await child.close().catch(() => undefined);
  }
  expect(root.currentDataSize).toBe(0);
});

it("keeps nested block locals measured during a granted synchronous host suspension", async () => {
  let finish!: () => void;
  let entered!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const root = new Budget({ dataSize: 100000 });
  const extension = defineExtension({
    manifest: {
      version: 1,
      name: "suspension",
      globals: ["port"],
      capabilities: ["source:nested"]
    },
    setup(context) {
      return {
        globals: {
          port: context.createHostObject({
            methods: {
              wait: context.nestedOperation(() => {
                entered();
                return pending;
              })
            }
          })
        }
      };
    }
  });
  const parent = createRealm({ budget: root, extensions: [extension], grants: ["source:nested"] });
  const child = createRealm({ budget: root.forkRealm() });
  const evaluation = parent.evaluate(
    "return (()=>{ { const held='h'.repeat(3000); port.wait(); return held.length; } })();"
  );
  try {
    await started;
    expect(await child.evaluate("return 42;")).toMatchObject({ ok: true, returnValue: 42 });
    await child.close();
    expect(root.currentDataSize).toBeGreaterThanOrEqual(3000);
    finish();
    expect(await evaluation).toMatchObject({ ok: true, returnValue: 3000 });
  } finally {
    finish();
    await parent.close();
    await child.close();
    await evaluation.catch(() => undefined);
  }
  expect(root.currentDataSize).toBe(0);
});
