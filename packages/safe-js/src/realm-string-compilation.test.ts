import { expect, it } from "vitest";
import { Budget, createRealm } from "./core.js";

const attempts = [
  'eval("globalThis.ran = true")',
  '(0, eval)("globalThis.ran = true")',
  'globalThis.eval("globalThis.ran = true")',
  'Function("globalThis.ran = true")()',
  'new Function("globalThis.ran = true")()',
  '(async function(){}).constructor("globalThis.ran = true")()',
  '(function*(){}).constructor("globalThis.ran = true")().next()',
  '(async function*(){}).constructor("globalThis.ran = true")().next()'
];

it.each(attempts)("denies %s with a catchable guest EvalError", async (source) => {
  const realm = createRealm({ stringCompilation: "deny" });
  try {
    expect(
      await realm.evaluate(
        `let errorName; try { ${source}; } catch (error) { errorName = error.name; } return [errorName, globalThis.ran === undefined];`
      )
    ).toMatchObject({ ok: true, returnValue: ["EvalError", true] });
    expect(await realm.evaluate("return 6 * 7")).toMatchObject({ ok: true, returnValue: 42 });
  } finally {
    await realm.close();
  }
});

it.each([undefined, "allow"] as const)(
  "preserves allowed compilation (%s)",
  async (stringCompilation) => {
    const realm = createRealm({ stringCompilation });
    try {
      expect(await realm.evaluate('return eval("20 + 1") + Function("return 21")()')).toMatchObject(
        {
          ok: true,
          returnValue: 42
        }
      );
    } finally {
      await realm.close();
    }
  }
);

it("isolates policy between realms with shared budget accounting", async () => {
  const budget = new Budget();
  const denied = createRealm({ budget, stringCompilation: "deny" });
  const allowed = createRealm({ budget: budget.forkRealm(), stringCompilation: "allow" });
  try {
    expect(
      await denied.evaluate(
        'let errorName; try { eval("1"); } catch (error) { errorName = error.name; } return errorName;'
      )
    ).toMatchObject({ ok: true, returnValue: "EvalError" });
    expect(await allowed.evaluate('return eval("42")')).toMatchObject({
      ok: true,
      returnValue: 42
    });
    expect(await denied.evaluate("return eval({ value:42 }).value")).toMatchObject({
      ok: true,
      returnValue: 42
    });
  } finally {
    await denied.close();
    await allowed.close();
  }
});

it("preserves immutable policy metadata after caller option mutation", async () => {
  const options = { stringCompilation: "deny" as "deny" | "allow" };
  const realm = createRealm(options);
  options.stringCompilation = "allow";
  try {
    expect(Object.getOwnPropertyDescriptor(realm, "stringCompilation")).toMatchObject({
      value: "deny",
      writable: false,
      configurable: false
    });
    expect(
      await realm.evaluate(
        'let errorName; try { Function("return 42"); } catch (error) { errorName = error.name; } return errorName;'
      )
    ).toMatchObject({ ok: true, returnValue: "EvalError" });
  } finally {
    await realm.close();
  }
});

it.each([null, true, 1, "disabled", {}, []])("rejects malformed policy %s", (stringCompilation) => {
  expect(() => createRealm({ stringCompilation } as never)).toThrow(TypeError);
});

it("rejects policy accessors without invoking them", () => {
  let calls = 0;
  const options = Object.defineProperty({}, "stringCompilation", {
    enumerable: true,
    get() {
      calls++;
      return "deny";
    }
  });
  expect(() => createRealm(options)).toThrow(TypeError);
  expect(calls).toBe(0);
});

it("keeps compilation denied in a host-retained guest callback", async () => {
  let callback: unknown;
  const realm = createRealm({
    stringCompilation: "deny",
    bindings: {
      capture(value: unknown) {
        callback = value;
      }
    }
  });
  try {
    expect(
      await realm.evaluate(
        'capture(() => { try { return eval("42"); } catch (error) { return error.name; } });'
      )
    ).toMatchObject({ ok: true });
    expect(await realm.invokeCallback(callback)).toBe("EvalError");
  } finally {
    await realm.close();
  }
});

it.each(attempts)("denies classic Script compilation: %s", async (source) => {
  const realm = createRealm({
    classicScripts: true,
    stringCompilation: "deny",
    callbackScheduling: "after-prefix"
  });
  try {
    expect(
      await realm.evaluate(
        `var errorName; try { ${source}; } catch (error) { errorName = error.name; } [errorName, globalThis.ran === undefined];`
      )
    ).toMatchObject({ ok: true, returnValue: ["EvalError", true] });
    expect(await realm.evaluate("6 * 7")).toMatchObject({ ok: true, returnValue: 42 });
  } finally {
    await realm.close();
  }
});

it("allows host source modules while denying guest compilation", async () => {
  const realm = createRealm({ stringCompilation: "deny" });
  try {
    expect(
      await realm.evaluate("export const value = 42;", {
        sourceType: "module",
        filename: "host-module"
      })
    ).toMatchObject({ ok: true, returnValue: { value: 42 } });
    expect(await realm.evaluate("return eval(42);")).toMatchObject({ ok: true, returnValue: 42 });
  } finally {
    await realm.close();
  }
});
