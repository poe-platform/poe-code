import { describe, expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";
import { Budget, createRealm, defineExtension, lint, run } from "../core.js";
import { dump } from "../dump.js";

describe("binary in through the public core", () => {
  it.each([
    ["own and missing values", 'return ["present" in { present: undefined }, "missing" in {}];', [true, false]],
    ["inherited properties", 'const object = Object.create({ inherited: undefined }); return ["inherited" in object, "toString" in object, Object.hasOwn(object, "inherited")];', [true, true, false]],
    ["null prototypes", 'const object = Object.create(null); object.value = 1; return ["value" in object, "toString" in object, "constructor" in object];', [true, false, false]],
    ["array holes", 'const array = [undefined, 2]; delete array[1]; return [0 in array, 1 in array, "length" in array, "map" in array];', [true, false, true, true]],
    ["function properties", 'function f() {} f.extra = undefined; const arrow = () => 1; return ["extra" in f, "prototype" in f, "prototype" in arrow, "length" in f, "call" in f];', [true, true, false, true, true]],
    ["primitive property keys", 'return [null in { "null": 1 }, undefined in { "undefined": 1 }, true in { "true": 1 }, -0 in { 0: 1 }];', [true, true, true, true]],
    ["built-in members", 'return ["get" in new Map(), "size" in new Set(), "then" in Promise.resolve(1), "source" in /a/, "getTime" in new Date(0), "byteLength" in new Float32Array(2)];', [true, true, true, true, true, true]],
    ["hidden interpreter state", 'function f() {} return ["kind" in f, "call" in new Map(), "entries" in new Map(), "values" in Promise.resolve(1), "kind" in /a/];', [false, false, true, false, false]],
    ["prototype mutation", 'const parent = { value: undefined }; const child = Object.create(parent); const before = "value" in child; delete parent.value; return [before, "value" in child];', [true, false]],
    ["parenthesized for initializer", 'let count = 0; for (let present = ("x" in { x: 1 }); present; present = false) count++; return count;', 1]
  ])("supports %s", async (_label, source, expected) => {
    expect(await run(String(source))).toMatchObject({ ok: true, returnValue: expected });
  });

  it.each(["null", "undefined", "1", '"text"', "true"])("rejects non-object RHS %s before coercing the key", async (rhs) => {
    const result = await run(`
      let calls = 0;
      const key = { toString() { calls++; return "x"; } };
      try { key in ${rhs}; } catch (error) { return [error.name, calls]; }
    `);
    expect(result).toMatchObject({ ok: true, returnValue: ["TypeError", 0] });
  });

  it("evaluates operands before coercing the key and uses inherited coercion", async () => {
    const result = await run(`
      const order = [];
      const key = Object.create({ toString() { order.push("key"); return "present"; } });
      function left() { order.push("left"); return key; }
      function right() { order.push("right"); return { present: undefined }; }
      return [left() in right(), order];
    `);
    expect(result).toMatchObject({ ok: true, returnValue: [true, ["left", "right", "key"]] });
  });

  it("propagates key coercion exceptions and rejects non-primitive coercion results", async () => {
    expect(await run(`
      const marker = {};
      try { ({ toString() { throw marker; } }) in {}; }
      catch (error) { return error === marker; }
    `)).toMatchObject({ ok: true, returnValue: true });
    expect(await run(`
      try { Object.create(null) in {}; }
      catch (error) { return error.name; }
    `)).toMatchObject({ ok: true, returnValue: "TypeError" });
  });

  it("does not read a host property when testing its existence", async () => {
    const read = vi.fn(() => { throw new Error("membership must not read"); });
    const extension = defineExtension({
      manifest: { version: 1, name: "membership", globals: ["host"] },
      setup(context) { return { globals: { host: context.createHostObject({ properties: { value: { get: read } } }) } }; }
    });
    expect(await run('return ["value" in host, "missing" in host];', { extensions: [extension] }))
      .toMatchObject({ ok: true, returnValue: [true, false] });
    expect(read).not.toHaveBeenCalled();
  });

  it("preserves inherited membership across realm evaluations", async () => {
    const realm = createRealm({ budget: new Budget({ maxSteps: 10_000 }) });
    try {
      expect(await realm.evaluate('const parent = { value: undefined }; const child = Object.create(parent);')).toMatchObject({ ok: true });
      expect(await realm.evaluate('return "value" in child;')).toMatchObject({ ok: true, returnValue: true });
      expect(await realm.evaluate('delete parent.value; return "value" in child;')).toMatchObject({ ok: true, returnValue: false });
    } finally { await realm.close(); }
  });

  it.each([
    'const parent = { value: undefined }; const child = Object.create(parent); return ["value" in child, "missing" in child];',
    'const object = {}; Object.defineProperty(object, "hidden", { value: undefined }); return ["hidden" in object, Object.keys(object)];',
    'const key = { toString: 1, valueOf() { return "value"; } }; return key in { value: 1 };',
    'const key = { toString() { return {}; }, valueOf() { return 2; } }; return key in { 2: 1 };',
    'const object = { value: 1 }; const key = { toString() { delete object.value; return "value"; } }; return key in object;',
    'let right = 0; try { (function () { throw 1; })() in (right++, {}); } catch (error) { return [error, right]; }',
    'function tag(parts) { return ["raw" in parts, 0 in parts.raw, 1 in parts.raw]; } return tag`text`;',
    'function* values() { yield 1; } return ["next" in values(), "return" in values(), "throw" in values()];'
  ])("matches bounded native semantics: %s", async (source) => {
    const expected = runInNewContext(`(function () { ${source} })()`, {}, { timeout: 1_000 });
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });

  it("keeps lint and completed checkpoint replay consistent", async () => {
    const source = 'const object = { value: undefined }; return ["value" in object, "missing" in object];';
    expect(lint(source)).toEqual([]);
    const first = await run(source);
    expect(first).toMatchObject({ ok: true, returnValue: [true, false] });
    expect(await run(source, { snapshot: JSON.parse(await dump(first)) }))
      .toMatchObject({ ok: true, returnValue: [true, false] });
  });

  it("charges prototype traversal against the execution budget", async () => {
    const source = 'let object = {}; for (let i = 0; i < 8; i++) object = Object.create(object); return "absent" in object;';
    const baseline = new Budget();
    expect(await run(source, { budget: baseline })).toMatchObject({ ok: true, returnValue: false });
    await expect(run(source, { budget: new Budget({ maxSteps: baseline.stepsUsed - 1 }) }))
      .rejects.toMatchObject({ code: "budgetExceeded", budget: "steps" });
  });
});
