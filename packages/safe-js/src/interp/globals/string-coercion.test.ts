import { describe, expect, it, vi } from "vitest";

import { run } from "../../run.js";
import { Budget } from "../budget.js";
import { createObjectArrayGlobals } from "./object-array.js";

const originalObjectSource = "return String({});";
const originalHookSource =
  'const failure = new TypeError("example failure"); failure.toString = () => "custom"; return String(failure);';

describe("approved Float32Array integration preservation", () => {
  it.each([
    "return [String(new Float32Array([1, 2.5, -0, NaN, Infinity, -Infinity])), String(new Float32Array())];",
    "const value = new Float32Array([1, 0.1, 3]); return [String(value.subarray(1)), String(value.slice(1))];",
    "return String([new Float32Array([1, 2]), new Float32Array([3])]);",
    "const value = new Float32Array([1, 2]); value.join = 0; return String(value);"
  ])("retains typed numeric storage conversion: %s", async (source) => {
    const native: unknown = new Function(source)();
    const result = await run(source);
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.returnValue).toEqual(native);
  });

  it("uses intrinsic typed length rather than a shadowing data property", async () => {
    const value = new Float32Array([1, 2]);
    Object.defineProperty(value, "length", { value: 0 });
    const globals = createObjectArrayGlobals({ budget: new Budget() });
    expect(await globals.String.call([value])).toBe(String(value));
    expect(String(value)).toBe("1,2");
  });

  it("keeps typed join output subject to the string budget", async () => {
    await expect(
      run("return String(new Float32Array([12345, 67890]));", {
        budget: new Budget({ stringLength: 10 })
      })
    ).rejects.toMatchObject({ code: "budgetExceeded", budget: "stringLength" });
  });

  it.each(["toString", "join"])("calls a typed own %s hook through the sandbox", async (hook) => {
    const source = `const value = new Float32Array([1, 2]); const log = [];
      value.${hook} = function () { log.push(this === value); return "typed"; };
      return [String(value), log];`;
    const result = await run(source);
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.returnValue).toEqual(new Function(source)());
  });
});

const cases = [
  ["exact ordinary object finding", originalObjectSource, "[object Object]"],
  ["exact guest hook finding", originalHookSource, "custom"],
  [
    "empty call and primitives",
    "return [String(), String(undefined), String(null), String(false), String(-0), String(NaN), String(Infinity)];",
    ["", "undefined", "null", "false", "0", "NaN", "Infinity"]
  ],
  [
    "ordinary alias graph is unchanged",
    "const child = {}; const value = { child, alias: child }; const text = String(value); return [text, value.child === value.alias, Object.keys(value)];",
    ["[object Object]", true, ["child", "alias"]]
  ],
  [
    "missing default wins before own valueOf",
    "let calls = 0; const value = { valueOf() { calls++; return 7; } }; return [String(value), calls];",
    ["[object Object]", 0]
  ],
  [
    "original receiver and primitive short circuit",
    'const log = []; const value = { label: "yes", toString() { log.push(this === value); return this.label; }, valueOf() { log.push("wrong"); return 7; } }; return [String(value), log];',
    ["yes", [true]]
  ],
  [
    "object result falls through to valueOf",
    'const log = []; const value = { toString() { log.push("string"); return {}; }, valueOf() { log.push(this === value); return 12; } }; return [String(value), log];',
    ["12", ["string", true]]
  ],
  [
    "mutated second hook is looked up after first",
    "const value = { toString() { this.valueOf = () => 9; return {}; }, valueOf() { return 1; } }; return String(value);",
    "9"
  ],
  [
    "null toString skips to callable valueOf",
    "return String({ toString: null, valueOf() { return false; } });",
    "false"
  ],
  [
    "undefined toString is not missing",
    "try { String({ toString: undefined }); } catch (error) { return error.name; }",
    "TypeError"
  ],
  [
    "both hooks nonprimitive",
    "try { String({ toString() { return {}; }, valueOf() { return []; } }); } catch (error) { return error.name; }",
    "TypeError"
  ],
  [
    "callable result is not primitive",
    "try { String({ toString() { return () => 1; }, valueOf: 0 }); } catch (error) { return error.name; }",
    "TypeError"
  ],
  [
    "throw preserves sentinel identity and stops",
    "const sentinel = { marker: 7 }; let calls = 0; try { String({ toString() { throw sentinel; }, valueOf() { calls++; return 1; } }); } catch (error) { return [error === sentinel, calls]; }",
    [true, 0]
  ],
  [
    "valueOf throw preserves sentinel",
    "const sentinel = {}; try { String({ toString: 0, valueOf() { throw sentinel; } }); } catch (error) { return error === sentinel; }",
    true
  ],
  [
    "async hook promise is not awaited to a primitive",
    'const log = []; const value = { async toString() { log.push("string"); return "wrong"; }, valueOf() { log.push("value"); return 8; } }; return [String(value), log];',
    ["8", ["string", "value"]]
  ],
  [
    "arrays retain holes nulls and nesting",
    "return [String([]), String([1, null, undefined, , [2, 3], {}])];",
    ["", "1,,,,2,3,[object Object]"]
  ],
  [
    "array elements invoke owned hooks",
    'const log = []; const value = { toString() { log.push("element"); return "ok"; } }; return [String([value, value]), log];',
    ["ok,ok", ["element", "element"]]
  ],
  [
    "array join override receives original array",
    "const value = [1]; value.join = function () { return this === value ? 12 : 0; }; return String(value);",
    "12"
  ],
  [
    "noncallable array join uses array tag",
    "const value = [1]; value.join = 0; return String(value);",
    "[object Array]"
  ],
  [
    "array toString override precedes join",
    'const value = [1]; value.toString = () => "owned"; return String(value);',
    "owned"
  ],
  [
    "array cycle does not recurse indefinitely",
    "const value = [1]; value.push(value); value.push(2); return String(value);",
    "1,,2"
  ],
  [
    "array join captures length but reads later elements",
    'const value = [{ toString() { value[1] = 8; value.push(9); return "first"; } }, 2]; return [String(value), value.length];',
    ["first,8", 3]
  ],
  [
    "error object fields use guest hooks in order",
    'const log = []; const value = new TypeError("before"); value.name = { toString() { log.push("name"); return "Named"; } }; value.message = { toString() { log.push("message"); return "text"; } }; return [String(value), log];',
    ["Named: text", ["name", "message"]]
  ],
  ["known intrinsic can serve as an own hook", "return String({ toString: String });", ""],
  [
    "bound hooks keep the bound receiver",
    'const receiver = { text: "bound" }; function convert() { return this.text; } return String({ toString: convert.bind(receiver) });',
    "bound"
  ],
  [
    "nonprimitive array join falls through",
    "const value = []; value.join = () => ({}); value.valueOf = () => 5; return String(value);",
    "5"
  ],
  [
    "error message lookup follows name conversion",
    'const value = new Error("old"); value.name = { toString() { value.message = "new"; return "Name"; } }; return String(value);',
    "Name: new"
  ],
  [
    "number-hint existing path remains independent",
    'const log = []; const value = { toString() { log.push("string"); return "s"; }, valueOf() { log.push("number"); return 3; } }; return [+value, String(value), log];',
    [3, "s", ["number", "string"]]
  ],
  [
    "sync hook promise result is not awaited to a primitive",
    'const log = []; const value = { toString() { log.push("string"); return Promise.resolve("wrong"); }, valueOf() { log.push("value"); return 8; } }; return [String(value), log];',
    ["8", ["string", "value"]]
  ],
  [
    "sync hook thenable result is neither called nor awaited",
    'const log = []; const value = { toString() { log.push("string"); return { then(resolve) { log.push("wrong"); resolve("wrong"); } }; }, valueOf() { log.push("value"); return 8; } }; return [String(value), log];',
    ["8", ["string", "value"]]
  ]
] as const;

describe("owned explicit String conversion", () => {
  it.each(cases)("%s", async (_name, source, expected) => {
    const native: unknown = await new Function(source)();
    expect(native).toEqual(expected);
    const result = await run(source);
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.returnValue).toEqual(native);
  });

  it.each(["undefined", "null", "true", "0", '"text"'])(
    "accepts primitive hook result %s",
    async (primitive) => {
      const source = `return String({ toString() { return ${primitive}; } });`;
      const result = await run(source);
      expect(result.ok).toBe(true);
      if (!result.ok) throw result.error;
      expect(result.returnValue).toBe(new Function(source)());
    }
  );

  it("charges hook execution to the step budget", async () => {
    await expect(
      run(
        'return String({ toString() { let count = 0; while (count < 1000) count++; return "done"; } });',
        {
          budget: new Budget({ maxSteps: 100 })
        }
      )
    ).rejects.toMatchObject({ code: "budgetExceeded", budget: "steps" });
  });

  it("charges recursive hooks to the call-depth budget", async () => {
    await expect(
      run("const value = { toString() { return String(this); } }; return String(value);", {
        budget: new Budget({ maxCallDepth: 12 })
      })
    ).rejects.toMatchObject({ code: "budgetExceeded", budget: "callDepth" });
  });

  it("bounds recursive default error fields", async () => {
    await expect(
      run('const value = new Error("x"); value.name = value; return String(value);', {
        budget: new Budget({ maxCallDepth: 12 })
      })
    ).rejects.toMatchObject({ code: "budgetExceeded", budget: "callDepth" });
  });

  it("checks accumulated array string length", async () => {
    await expect(
      run('return String(["abcd", "efgh"]);', {
        budget: new Budget({ stringLength: 8 })
      })
    ).rejects.toMatchObject({ code: "budgetExceeded", budget: "stringLength" });
  });

  it("never executes a raw native hook or accessor", async () => {
    const nativeHook = vi.fn(() => "unsafe");
    const accessor = vi.fn(() => nativeHook);
    const rawHook = Object.create(null);
    Object.defineProperty(rawHook, "toString", { value: nativeHook });
    const rawAccessor = Object.create(null);
    Object.defineProperty(rawAccessor, "toString", { get: accessor });
    const globals = createObjectArrayGlobals({ budget: new Budget() });
    for (const value of [rawHook, rawAccessor]) {
      await expect(
        Promise.resolve().then(() => globals.String.call([value]))
      ).rejects.toBeInstanceOf(TypeError);
    }
    expect(nativeHook).not.toHaveBeenCalled();
    expect(accessor).not.toHaveBeenCalled();
  });
});
