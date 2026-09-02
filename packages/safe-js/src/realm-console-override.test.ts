import { describe, expect, it, vi } from "vitest";
import { Budget, createRealm, defineExtension, run, type ExtensionContext, type RealmOptions } from "./core.js";

function consoleExtension(name = "browser", capabilities: string[] = []) {
  const cleanup = vi.fn();
  const journals: unknown[][][] = [];
  const setup = vi.fn((context: ExtensionContext) => {
    const journal: unknown[][] = [];
    journals.push(journal);
    context.onCleanup(cleanup);
    const console = context.createHostObject({ methods: {
      log: (...args: unknown[]) => { context.chargeWork(); journal.push(args); },
      warn: (...args: unknown[]) => { context.chargeWork(); journal.push(args); },
      count: () => journal.length
    } });
    const window = context.createHostObject({ properties: { console: { get: () => console } } });
    return { globals: { console, window, self: window } };
  });
  const extension = defineExtension({ manifest: { version: 1, name, capabilities, globals: ["console", "window", "self"] }, setup });
  return { extension, setup, cleanup, journals };
}

describe("explicit owned console replacement", () => {
  it("shares the owned console through window and self across evaluations", async () => {
    const { extension, journals, cleanup } = consoleExtension();
    const realm = createRealm({ extensions: [extension], builtinOverrides: { console: "browser" } });
    try {
      expect(await realm.evaluate('const saved = console; console.log("first"); window.console.warn("second"); return [console === window.console, console === self.console, window === self, console.log === self.console.log];'))
        .toMatchObject({ returnValue: [true, true, true, true] });
      expect(await realm.evaluate('saved.log("third"); return [saved === console, self.console.count()];'))
        .toMatchObject({ returnValue: [true, 3] });
      expect(journals).toEqual([[["first"], ["second"], ["third"]]]);
    } finally { await realm.close(); await realm.close(); }
    expect(cleanup).toHaveBeenCalledTimes(1);
    await expect(realm.evaluate('saved.log("closed");')).rejects.toThrow(/closed/);
  });

  it("rejects default collisions before setup", () => {
    const { extension, setup } = consoleExtension();
    expect(() => createRealm({ extensions: [extension] })).toThrow(/Conflicting global 'console'/);
    expect(setup).not.toHaveBeenCalled();
  });

  it("does not override a caller console or another extension", () => {
    const first = consoleExtension();
    const second = consoleExtension("other");
    expect(() => createRealm({ extensions: [first.extension], bindings: { console: {} }, builtinOverrides: { console: "browser" } })).toThrow(/Conflicting/);
    expect(() => createRealm({ extensions: [first.extension, second.extension], builtinOverrides: { console: "browser" } })).toThrow(/Conflicting/);
    expect(first.setup).not.toHaveBeenCalled();
    expect(second.setup).not.toHaveBeenCalled();
  });

  it("keeps normal capability grants mandatory", () => {
    const { extension, setup } = consoleExtension("browser", ["journal"]);
    expect(() => createRealm({ extensions: [extension], builtinOverrides: { console: "browser" } })).toThrow(/Missing grant/);
    expect(setup).not.toHaveBeenCalled();
  });

  it("supports one-shot runs without silently ignoring authorization", async () => {
    const { extension, cleanup } = consoleExtension();
    expect(await run('console.warn("once"); return console === window.console;', { extensions: [extension], builtinOverrides: { console: "browser" } }))
      .toMatchObject({ returnValue: true });
    expect(cleanup).toHaveBeenCalledTimes(1);
    await expect(run('return 1;', { builtinOverrides: { console: "missing" } })).rejects.toThrow(/registered/);
  });

  it.each([null, [], { JSON: "browser" }, { Object: "browser" }, { console: "" }, { console: 1 }, { console: undefined }, { console: "missing" }])("rejects malformed or unknown authorization %j before setup", (builtinOverrides) => {
    const { extension, setup } = consoleExtension();
    expect(() => createRealm({ extensions: [extension], builtinOverrides } as RealmOptions)).toThrow();
    expect(setup).not.toHaveBeenCalled();
  });

  it("rejects accessor and proxy authorization without running traps", () => {
    const { extension, setup } = consoleExtension();
    const trap = vi.fn(() => { throw new Error("trap"); });
    const accessor = Object.defineProperty({}, "console", { get: trap });
    const proxy = new Proxy({ console: "browser" }, { get: trap, ownKeys: trap, getPrototypeOf: trap });
    for (const builtinOverrides of [accessor, proxy]) {
      expect(() => createRealm({ extensions: [extension], builtinOverrides })).toThrow(/data|record/i);
    }
    expect(trap).not.toHaveBeenCalled();
    expect(setup).not.toHaveBeenCalled();
  });

  it("rejects null authorization even without a colliding registration", () => {
    expect(() => createRealm({ builtinOverrides: null } as unknown as RealmOptions)).toThrow(/record/);
  });

  it("leaves the builtin and caller console behavior unchanged without authorization", async () => {
    const sink = { log: vi.fn(), error: vi.fn() };
    const builtin = createRealm({ sink });
    const log = vi.fn();
    const caller = createRealm({ bindings: { console: { log } }, sink });
    try {
      await builtin.evaluate('console.log("builtin"); console.error("error");');
      await caller.evaluate('console.log("caller");');
      expect(sink.log).toHaveBeenCalledExactlyOnceWith("builtin");
      expect(sink.error).toHaveBeenCalledExactlyOnceWith("error");
      expect(log).toHaveBeenCalledExactlyOnceWith("caller");
    } finally { await builtin.close(); await caller.close(); }
  });

  it("does not duplicate replacement calls into the builtin sink", async () => {
    const { extension, journals } = consoleExtension();
    const sink = { log: vi.fn(), error: vi.fn() };
    const realm = createRealm({ extensions: [extension], builtinOverrides: { console: "browser" }, sink });
    try {
      await realm.evaluate('console.log("owned");');
      expect(journals).toEqual([[["owned"]]]);
      expect(sink.log).not.toHaveBeenCalled();
      expect(sink.error).not.toHaveBeenCalled();
    } finally { await realm.close(); }
  });

  it("rejects proxy replacement objects without traps and still cleans up", async () => {
    const cleanup = vi.fn();
    const trap = vi.fn(() => { throw new Error("trap"); });
    const console = new Proxy({}, { get: trap, ownKeys: trap, getPrototypeOf: trap });
    const extension = defineExtension({ manifest: { version: 1, name: "browser", globals: ["console"] }, setup(context) {
      context.onCleanup(cleanup);
      return { globals: { console } };
    } });
    const realm = createRealm({ extensions: [extension], builtinOverrides: { console: "browser" } });
    await expect(realm.evaluate('console;')).rejects.toThrow(/host object/);
    await realm.close();
    expect(trap).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("requires the authorized extension to declare console and preserves other intrinsics", () => {
    const setup = vi.fn(() => ({}));
    const undeclared = defineExtension({ manifest: { version: 1, name: "browser" }, setup });
    expect(() => createRealm({ extensions: [undeclared], builtinOverrides: { console: "browser" } })).toThrow(/declaring console/);
    const intrinsics = defineExtension({ manifest: { version: 1, name: "browser", globals: ["console", "JSON"] }, setup });
    expect(() => createRealm({ extensions: [intrinsics], builtinOverrides: { console: "browser" } })).toThrow(/Conflicting global 'JSON'/);
    expect(setup).not.toHaveBeenCalled();
  });

  it("rejects a second console claimant in either registration order", () => {
    const first = consoleExtension();
    const second = consoleExtension("other");
    for (const extensions of [[first.extension, second.extension], [second.extension, first.extension]]) {
      expect(() => createRealm({ extensions, builtinOverrides: { console: "browser" } })).toThrow(/Conflicting/);
    }
    expect(first.setup).not.toHaveBeenCalled();
    expect(second.setup).not.toHaveBeenCalled();
  });

  it("snapshots authorization and initializes each realm independently and lazily", async () => {
    const { extension, setup, cleanup, journals } = consoleExtension("browser", ["journal"]);
    const builtinOverrides = { console: "browser" };
    const options = { extensions: [extension], builtinOverrides, grants: ["journal"] };
    const unused = createRealm(options);
    await unused.close();
    expect(setup).not.toHaveBeenCalled();
    expect(cleanup).not.toHaveBeenCalled();
    const first = createRealm(options);
    const second = createRealm(options);
    builtinOverrides.console = "other";
    try {
      await first.evaluate('console.log("first");');
      await second.evaluate('self.console.log("second");');
      expect(journals).toEqual([[["first"]], [["second"]]]);
      expect(await first.evaluate('return console.count();')).toMatchObject({ returnValue: 1 });
    } finally { await first.close(); await second.close(); }
    expect(setup).toHaveBeenCalledTimes(2);
    expect(cleanup).toHaveBeenCalledTimes(2);
  });

  it.each([{}, () => {}, null, 1])("rejects non-owned replacement %j and disposes setup resources", async (console) => {
    const cleanup = vi.fn();
    const extension = defineExtension({ manifest: { version: 1, name: "browser", globals: ["console"] }, setup(context) {
      context.onCleanup(cleanup);
      return { globals: { console } };
    } });
    const realm = createRealm({ extensions: [extension], builtinOverrides: { console: "browser" } });
    await expect(realm.evaluate('console;')).rejects.toThrow(/host object/);
    await realm.close();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("rejects foreign host objects without weakening owner checks", async () => {
    const foreign = consoleExtension();
    const first = createRealm({ extensions: [foreign.extension], builtinOverrides: { console: "browser" } });
    const result = await first.evaluate('return console;');
    if (!result.ok) throw new Error("Foreign fixture failed");
    const cleanup = vi.fn();
    const extension = defineExtension({ manifest: { version: 1, name: "browser", globals: ["console"] }, setup(context) {
      context.onCleanup(cleanup);
      return { globals: { console: result.returnValue as never } };
    } });
    const second = createRealm({ extensions: [extension], builtinOverrides: { console: "browser" } });
    try {
      await expect(second.evaluate('console.log("foreign");')).rejects.toThrow(/host object/);
      expect(foreign.journals).toEqual([[]]);
    } finally { await first.close(); await second.close(); }
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("cleans up a partially initialized replacement exactly once", async () => {
    const cleanup = vi.fn();
    const extension = defineExtension({ manifest: { version: 1, name: "browser", globals: ["console"] }, setup(context) {
      context.onCleanup(cleanup);
      context.createHostObject({});
      throw new Error("setup failed");
    } });
    const realm = createRealm({ extensions: [extension], builtinOverrides: { console: "browser" } });
    await expect(realm.evaluate('return 1;')).rejects.toThrow(/setup failed/);
    await realm.close();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("runs all cleanups despite a replacement disposer failure", async () => {
    const cleanups: string[] = [];
    const extension = defineExtension({ manifest: { version: 1, name: "browser", globals: ["console"] }, setup(context) {
      context.onCleanup(() => { cleanups.push("first"); });
      context.onCleanup(() => { cleanups.push("second"); throw new Error("cleanup failed"); });
      return { globals: { console: context.createHostObject({}) } };
    } });
    const realm = createRealm({ extensions: [extension], builtinOverrides: { console: "browser" } });
    await realm.evaluate('console;');
    await expect(realm.close()).rejects.toThrow(/cleanup/i);
    await expect(realm.close()).rejects.toThrow(/cleanup/i);
    expect(cleanups).toEqual(["second", "first"]);
  });

  it.each([false, true])("handles cancellation before setup=%s", async (beforeSetup) => {
    const controller = new AbortController();
    const { extension, setup, cleanup, journals } = consoleExtension();
    if (beforeSetup) controller.abort(new Error("cancelled"));
    const realm = createRealm({ extensions: [extension], builtinOverrides: { console: "browser" }, signal: controller.signal });
    if (!beforeSetup) {
      await realm.evaluate('const saved = console; console.log("before");');
      controller.abort(new Error("cancelled"));
    }
    await expect(realm.evaluate('console.log("after");')).rejects.toThrow(/cancelled/);
    await realm.close();
    expect(setup).toHaveBeenCalledTimes(beforeSetup ? 0 : 1);
    expect(cleanup).toHaveBeenCalledTimes(beforeSetup ? 0 : 1);
    expect(journals).toEqual(beforeSetup ? [] : [[["before"]]]);
  });

  it("meters calls and prevents access to native prototypes", async () => {
    const { extension, cleanup } = consoleExtension();
    const realm = createRealm({ extensions: [extension], builtinOverrides: { console: "browser" }, budget: new Budget({ maxSteps: 200 }) });
    try {
      expect(await realm.evaluate('return [console.constructor, console.__proto__, console.log.constructor];'))
        .toMatchObject({ returnValue: [undefined, undefined, undefined] });
      await expect(realm.evaluate('while (true) { console.log("bounded"); }')).rejects.toMatchObject({ code: "budgetExceeded" });
    } finally { await realm.close(); }
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("keeps host-object limits and disposes acquired resources on failure", async () => {
    const { extension, cleanup, journals } = consoleExtension();
    const realm = createRealm({ extensions: [extension], builtinOverrides: { console: "browser" }, limits: { hostObjects: 1 } });
    await expect(realm.evaluate('console.log("unreachable");')).rejects.toThrow(/host object/i);
    await realm.close();
    expect(journals).toEqual([[]]);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("disposes the replacement if a later extension setup fails", async () => {
    const { extension, cleanup, journals } = consoleExtension();
    const failed = defineExtension({ manifest: { version: 1, name: "failed" }, setup() { throw new Error("later failure"); } });
    const realm = createRealm({ extensions: [extension, failed], builtinOverrides: { console: "browser" } });
    await expect(realm.evaluate('console.log("unreachable");')).rejects.toThrow(/later failure/);
    await realm.close();
    expect(journals).toEqual([[]]);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});
