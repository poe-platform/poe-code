import { describe, expect, it } from "vitest";
import { Budget, createRealm, run } from "./core.js";
import { dump, restore, deepCopyFromSandbox } from "./index.js";

describe("sandbox Object intrinsic", () => {
  it.each([
    ["undefined", undefined],
    ["null", null],
    ["true", true],
    ["3", 3],
    ["'text'", "text"],
    ["[]", []],
    ["({})", {}],
    ["function named() {}", function named() {}],
    ["() => 1", () => 1],
    ["new Date(0)", new Date(0)],
    ["/x/", /x/],
    ["new Map()", new Map()],
    ["new Set()", new Set()],
    ["new Float32Array(2)", new Float32Array(2)],
    ["new Error('x')", new Error("x")],
    ["async function () {}", async function () {}],
    ["function* () {}", function* () {}],
    ["(function* () {})()", (function* () {})()],
    ["Promise.resolve(1)", Promise.resolve(1)]
  ])("matches native cached type inspection for %s", async (source, native) => {
    const tag = Object.prototype.toString.call(native);
    expect(
      await run(`const inspect = ({}).toString; return inspect.call(${source});`)
    ).toMatchObject({ ok: true, returnValue: tag });
  });

  it("constructs ordinary objects and provides stable prototype identity", async () => {
    expect(
      await run(`const value = {}; return [typeof Object, Object(value) === value,
      Object.getPrototypeOf(value) === Object.prototype,
      Object.getPrototypeOf(new Object()) === Object.prototype,
      Object.getPrototypeOf(Object.prototype) === null,
      Object.prototype.constructor === Object, value instanceof Object,
      Object.keys(Object.prototype), Object.keys(Object)];`)
    ).toMatchObject({
      ok: true,
      returnValue: ["function", true, true, true, true, true, true, [], []]
    });
  });

  it("does not expose interpreter fields through own-property inspection", async () => {
    expect(
      await run(`const own = Object.prototype.hasOwnProperty; const enumerable = Object.prototype.propertyIsEnumerable;
      function sample() {} return [own.call(sample, 'kind'), own.call(sample, 'call'),
      own.call(sample, 'name'), enumerable.call(sample, 'name'), own.call({ x: 1 }, 'x'),
      own.call('abc', 'length'), enumerable.call('abc', '0'), own.call(Object, 'keys')];`)
    ).toMatchObject({ ok: true, returnValue: [false, false, true, false, true, true, true, true] });
  });

  it("supports ordinary constructor inheritance and own/enumerable rules", async () => {
    expect(
      await run(`Object.prototype.shared = 9; function Item() { this.own = 2; }
      const item = new Item(); const keys = []; for (const key in item) keys.push(key);
      return [item.shared, Object.getPrototypeOf(Item.prototype) === Object.prototype,
        Object.prototype.isPrototypeOf(item), item.hasOwnProperty('shared'), keys,
        Object.keys(item), Object.prototype.valueOf.call(item) === item];`)
    ).toMatchObject({
      ok: true,
      returnValue: [9, true, true, false, ["own", "shared"], ["own"], true]
    });
  });

  it("distinguishes null/custom literal prototypes from computed own keys", async () => {
    expect(
      await run(`const base = { inherited: 3 }; const custom = { __proto__: base };
      const empty = { __proto__: null }; const own = { ['__proto__']: base };
      return [custom.inherited, Object.getPrototypeOf(custom) === base,
        Object.getPrototypeOf(empty) === null, empty.toString,
        Object.getPrototypeOf(own) === Object.prototype, own.hasOwnProperty('__proto__'),
        Object.getPrototypeOf(Object.create(null)) === null];`)
    ).toMatchObject({ ok: true, returnValue: [3, true, true, undefined, true, true, true] });
  });

  it("does not trust spoofed runtime tags", async () => {
    expect(
      await run(`return Object.prototype.toString.call({ kind: 'closure', call: 1 });`)
    ).toMatchObject({ ok: true, returnValue: "[object Object]" });
  });

  it.each(["hasOwnProperty", "propertyIsEnumerable", "valueOf", "isPrototypeOf"])(
    "rejects a null receiver for %s",
    async (method) => {
      await expect(run(`Object.prototype.${method}.call(null, {});`)).rejects.toMatchObject({
        name: "TypeError"
      });
    }
  );

  it("isolates mutable prototypes in concurrent and sequential realms", async () => {
    const first = createRealm();
    const second = createRealm();
    try {
      await first.evaluate("Object.prototype.local = 7;");
      expect(await first.evaluate("return ({}).local;")).toMatchObject({ returnValue: 7 });
      expect(await second.evaluate("return ({}).local;")).toMatchObject({ returnValue: undefined });
      expect(Object.hasOwn(Object.prototype, "local")).toBe(false);
    } finally {
      await first.close();
      await second.close();
    }
    expect(await run("return ({}).local;")).toMatchObject({ returnValue: undefined });
  });

  it("ignores native prototype pollution", async () => {
    Object.defineProperty(Object.prototype, "safejsPollutionProbe", {
      value: 73,
      configurable: true
    });
    try {
      expect(
        await run("return [({}).safejsPollutionProbe, Object.prototype.safejsPollutionProbe];")
      ).toMatchObject({ ok: true, returnValue: [undefined, undefined] });
    } finally {
      Reflect.deleteProperty(Object.prototype, "safejsPollutionProbe");
    }
  });

  it("runs the cached jQuery class-to-type lookup without source rewriting", async () => {
    expect(
      await run(`const class2type = {}; const core_toString = class2type.toString;
      for (const name of 'Boolean Number String Function Array Date RegExp Object Error'.split(' ')) {
        class2type['[object ' + name + ']'] = name.toLowerCase();
      }
      function type(obj) { return obj == null ? String(obj) :
        typeof obj === 'object' || typeof obj === 'function' ?
        class2type[core_toString.call(obj)] || 'object' : typeof obj; }
      return [type([]), type(function () {}), type(new Date(0)), type(null), type({})];`)
    ).toMatchObject({ returnValue: ["array", "function", "date", "null", "object"] });
  });

  it("honors inherited read-only properties and forbids cycles", async () => {
    await expect(
      run("Object.defineProperty(Object.prototype, 'locked', { value: 1 }); ({}).locked = 2;")
    ).rejects.toMatchObject({ name: "TypeError" });
    await expect(run("Object.setPrototypeOf(Object.prototype, {});")).rejects.toMatchObject({
      name: "TypeError"
    });
    await expect(run("Object.prototype = {};")).rejects.toMatchObject({ name: "TypeError" });
  });

  it("preserves mutated intrinsic checkpoint data while rejecting lossy plain data copies", async () => {
    const source = "return ({}).toString.call([]);";
    const first = await run(source);
    expect(
      await run(source, { snapshot: restore(JSON.parse(await dump(first)), { source }) })
    ).toMatchObject({ returnValue: "[object Array]" });
    const mutatedSource = "Object.prototype.changed = 1;return ({}).changed;";
    const mutated = await run(mutatedSource);
    expect(mutated).toMatchObject({ ok: true, returnValue: 1 });
    const snapshot = JSON.parse(await dump(mutated));
    const resumed = await run(mutatedSource, { snapshot: restore(snapshot, { source: mutatedSource }) });
    expect(resumed).toMatchObject({ ok: true, returnValue: 1 });
    const recaptured = JSON.parse(await dump(resumed));
    expect(recaptured.heap).toEqual(snapshot.heap);
    expect(recaptured.bindings).toEqual(snapshot.bindings);
    const linked = await run("return Object.create({ inherited: 1 });");
    expect(() => deepCopyFromSandbox(linked.returnValue as never)).toThrow(/prototype/);
  });

  it("retains detached prototype data and releases intrinsic roots on close", async () => {
    const budget = new Budget({ dataSize: 50_000 });
    const realm = createRealm({ budget });
    try {
      await realm.evaluate("Object.prototype.content = 'x'.repeat(2000);");
      const retained = budget.currentDataSize;
      await realm.evaluate("delete Object.prototype.content;");
      expect(budget.currentDataSize).toBeLessThan(retained - 1900);
    } finally {
      await realm.close();
    }
    expect([...budget.retainedValues()]).toEqual([]);
  });

  it("keeps native capabilities read-only and implementation fields private", async () => {
    expect(
      await run(
        "return [Object.keys(host), Object.prototype.toString.call(host), Object.hasOwn(host, 'call'), Object.hasOwn(host, 'kind')];",
        { bindings: { host: () => 1 } }
      )
    ).toMatchObject({ returnValue: [[], "[object Function]", false, false] });
    await expect(
      run("Object.defineProperty(host, 'x', { value: 1 });", { bindings: { host: () => 1 } })
    ).rejects.toMatchObject({ name: "TypeError" });
  });

  it("keeps the intrinsic root prototype immutable", async () => {
    await expect(
      run("Object.setPrototypeOf(Object.prototype, Object.create(null));")
    ).rejects.toMatchObject({ name: "TypeError" });
  });

  it("cannot evade retained-data limits through caught prototype writes", async () => {
    await expect(
      run("try { Object.prototype.data = 'x'.repeat(2000); } catch (error) {} return 1;", {
        budget: new Budget({ dataSize: 1000 })
      })
    ).rejects.toMatchObject({ code: "budgetExceeded", budget: "dataSize" });
  });
});
