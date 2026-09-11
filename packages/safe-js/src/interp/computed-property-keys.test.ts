import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { Budget, createRealm, defineExtension, lint, run } from "../core.js";
import { dump } from "../dump.js";

describe("computed property keys through the public core", () => {
  it.each([
    ["read", "return object[key];", 7],
    ["write", "object[key] = 8; return object.x;", 8],
    ["delete", "return [delete object[key], Object.hasOwn(object, 'x')];", [true, false]],
    ["object literal", "return { [key]: 8 }.x;", 8],
    ["method definition", "return { [key]() { return 8; } }.x();", 8],
    ["method call receiver", "return { x() { return this.value; }, value: 8 }[key]();", 8],
    ["binding", "const { [key]: value } = object; return value;", 7],
    ["assignment pattern", "let value; ({ [key]: value } = object); return value;", 7],
    ["assignment target", "[object[key]] = [8]; return object.x;", 8],
    ["parameter", "function f({ [key]: value }) { return value; } return f(object);", 7],
    ["catch", "try { throw object; } catch ({ [key]: value }) { return value; }", 7],
    ["for-of binding", "for (const { [key]: value } of [object]) return value;", 7],
    [
      "binding rest",
      "const { [key]: value, ...rest } = { x: 7, y: 8 }; return [value, rest];",
      [7, { y: 8 }]
    ],
    ["constructor", "function F() { this.value = 8; } return new ({ x: F })[key]().value;", 8]
  ])("coerces an object key for %s", async (_name, body, expected) => {
    const source = 'const key = { toString() { return "x"; } }; const object = { x: 7 }; ' + body;
    expect(runInNewContext(`(() => { ${source} })()`)).toEqual(expected);
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });

  it.each(["true", "false", "null", "undefined", "NaN", "Infinity", "-0", '["x"]'])(
    "supports the key %s",
    async (key) => {
      const source = `const key = ${key}; const object = { [key]: 7 }; return object[key];`;
      expect(runInNewContext(`(() => { ${source} })()`)).toBe(7);
      expect(await run(source)).toMatchObject({ ok: true, returnValue: 7 });
    }
  );

  it("evaluates the reference once and delays assignment coercion until after the RHS", async () => {
    const source = `
      const events = []; const object = {};
      const key = { toString() { events.push("coerce"); return "x"; } };
      function base() { events.push("base"); return object; }
      function index() { events.push("index"); return key; }
      base()[index()] = (events.push("rhs"), 7);
      return [object.x, events];
    `;
    const expected = [7, ["base", "index", "rhs", "coerce"]];
    expect(runInNewContext(`(() => { ${source} })()`)).toEqual(expected);
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });

  it.each([
    ["object[key] += (events.push('rhs'), 2)", 9, ["coerce", "rhs"]],
    ["object[key]++", 8, ["coerce"]],
    ["++object[key]", 8, ["coerce"]],
    ["object[key] &&= (events.push('rhs'), 2)", 2, ["coerce", "rhs"]],
    ["object[key] ||= (events.push('rhs'), 2)", 7, ["coerce"]],
    ["object[key] ??= (events.push('rhs'), 2)", 7, ["coerce"]]
  ])("retains the converted reference key for %s", async (expression, value, events) => {
    // ECMAScript 2026 GetValue retains the converted key for PutValue.
    // Node v22's compound/update behavior is not a conforming oracle here.
    expect(
      await run(`
      const events = []; const object = { x: 7, y: 100 }; let calls = 0;
      const key = { toString() { events.push("coerce"); return ++calls === 1 ? "x" : "y"; } };
      ${expression}; return [object.x, object.y, events];
    `)
    ).toMatchObject({ ok: true, returnValue: [value, 100, events] });
  });

  it.each([
    ["null[index()]", ["index"]],
    ["null[index()] = (events.push('rhs'), 1)", ["index", "rhs"]],
    ["null[index()] += (events.push('rhs'), 1)", ["index"]],
    ["delete null[index()]", ["index"]],
    ["null?.[index()]", []]
  ])("checks the null base in the correct order: %s", async (expression, events) => {
    const source = `
      const events = []; const key = { toString() { events.push("coerce"); return "x"; } };
      function index() { events.push("index"); return key; }
      try { ${expression}; } catch {} return events;
    `;
    expect(runInNewContext(`(() => { ${source} })()`)).toEqual(events);
    expect(await run(source)).toMatchObject({ ok: true, returnValue: events });
  });

  it("uses inherited hooks, the original receiver, and the string-hint fallback order", async () => {
    const source = `
      const events = []; const key = Object.create({
        toString() { events.push(this.name); return {}; },
        valueOf() { events.push("valueOf"); return "x"; }
      }); key.name = "toString";
      return [{ x: 7 }[key], events];
    `;
    expect(await run(source)).toMatchObject({
      ok: true,
      returnValue: [7, ["toString", "valueOf"]]
    });
  });

  it("preserves a thrown coercion value and rejects keys without a primitive conversion", async () => {
    expect(
      await run(`
      const marker = {}; const key = { toString() { throw marker; } };
      try { ({}[key]); } catch (error) { return error === marker; }
    `)
    ).toMatchObject({ ok: true, returnValue: true });
    expect(
      await run(`
      try { ({}[Object.create(null)]); } catch (error) { return error.name; }
    `)
    ).toMatchObject({ ok: true, returnValue: "TypeError" });
  });

  it("does not adopt an async key conversion result", async () => {
    expect(
      await run(`
      const events = []; const key = {
        async toString() { events.push(1); events.push(2); return "wrong"; },
        valueOf() { events.push(3); return "x"; }
      }; return [{ x: 7 }[key], events];
    `)
    ).toMatchObject({ ok: true, returnValue: [7, [1, 2, 3]] });
  });

  it.each([
    'const key = { toString: 1, valueOf() { return "x"; } }; return { x: 7 }[key];',
    "const key = { toString() { return {}; }, valueOf() { return {}; } }; try { ({}[key]); } catch (error) { return error.name; }",
    'const events = []; const key = { toString() { events.push("key"); return "x"; } }; try { ({}[key] = (() => { throw 7; })()); } catch {} return events;',
    'const events = []; const key = { toString() { events.push("key"); return "x"; } }; const object = { [key]: (events.push("value"), 7) }; return [object.x, events];',
    'const events = []; function key() { events.push("key"); return "x"; } try { [null[key()]] = [7]; } catch {} return events;',
    'const key = { toString() { return "missing"; } }; return ({}[key]?.());',
    "try { return null.x?.(); } catch (error) { return error.name; }"
  ])("matches native abrupt and ordering behavior: %s", async (source) => {
    const expected = runInNewContext(`(() => { ${source} })()`);
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });

  it("retains host capability checks after key conversion", async () => {
    const read = vi.fn(() => 7);
    const extension = defineExtension({
      manifest: { version: 1, name: "computed-keys", globals: ["host"] },
      setup(context) {
        return {
          globals: { host: context.createHostObject({ properties: { value: { get: read } } }) }
        };
      }
    });
    expect(
      await run(
        `
      const key = { toString() { return "value"; } };
      const hidden = { toString() { return "constructor"; } };
      return [host[key], host[hidden]];
    `,
        { extensions: [extension] }
      )
    ).toMatchObject({ ok: true, returnValue: [7, undefined] });
    expect(read).toHaveBeenCalledOnce();
  });

  it("preserves coercion through completed replay and persistent realms", async () => {
    const source = 'const key = { toString() { return "x"; } }; return { [key]: 7 }[key];';
    expect(lint(source)).toEqual([]);
    const first = await run(source);
    expect(first).toMatchObject({ ok: true, returnValue: 7 });
    if (!first.ok) throw new Error("Expected completed run");
    expect(await run(source, { snapshot: JSON.parse(await dump(first)) })).toMatchObject({
      ok: true,
      returnValue: 7
    });
    const realm = createRealm();
    try {
      await realm.evaluate('const key = { toString() { return "x"; } };');
      expect(await realm.evaluate("return { x: 7 }[key];")).toMatchObject({
        ok: true,
        returnValue: 7
      });
    } finally {
      await realm.close();
    }
  });

  it("keeps recursive key coercion within the call budget", async () => {
    await expect(
      run("const key = { toString() { return {}[key]; } }; return {}[key];", {
        budget: new Budget({ maxCallDepth: 8, maxSteps: 1000 })
      })
    ).rejects.toMatchObject({ code: "budgetExceeded", budget: "callDepth" });
  });
});
