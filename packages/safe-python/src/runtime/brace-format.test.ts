import { expect, it } from "vitest";
import { braceFormat } from "./brace-format.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { createRuntimeFormatContext } from "./runtime-format.js";
import { PythonRuntimeError } from "./error.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 }), v = new RuntimeValues(meter);
  const named = new Map<string, RuntimeValue>(), events: string[] = [];
  const hooks = {
    keyword(name: Iterable<number>): RuntimeValue {
      const key = String.fromCodePoint(...name); events.push("lookup:" + key);
      const result = named.get(key); if (result === undefined) throw new PythonRuntimeError("KeyError", key); return result;
    },
    attribute(): RuntimeValue { throw Error("unused attribute"); }, item(): RuntimeValue { throw Error("unused item"); }
  };
  const context = createRuntimeFormatContext(v, meter, {
    defaultRepr() { events.push("repr"); return v.string("guest"); },
    lookupFormat() { return spec => { events.push("format:" + (spec.kind === "str" ? String.fromCodePoint(...spec.value) : "invalid")); return v.string("rendered"); }; }
  });
  const run = (source: string, positional: readonly RuntimeValue[] | null = []) => String.fromCodePoint(...braceFormat(v.string(source).value, positional, hooks, context, meter).storage);
  return { meter, v, named, events, hooks, context, run };
}
it("renders native fields, escapes and shared nested automatic numbering", () => {
  const { v, run } = fixture();
  expect(run("{{{}}}: {:>{}}", [v.integer(12), v.string("x"), v.integer(4)])).toBe("{12}:    x");
  expect(run("{0:{1}.{2}f}", [v.float(12.345), v.integer(8), v.integer(2)])).toBe("   12.35");
  expect(run("{0:n}:{1:n}", [v.float(1234.5), v.complex(1, 2)])).toBe("1234.5:1+2j");
  expect(run("")).toBe("");
});
it("supports named map fields and all three conversions", () => {
  const { v, named, run } = fixture(); named.set("x", v.string("é"));
  expect(run("{x!s}|{x!r}|{x!a}", null)).toBe("é|'é'|'\\xe9'");
  expect(() => run("{}", null)).toThrow("Format string contains positional fields");
  expect(run("{x!\0}", null)).toBe("é");
});
it("looks up and converts the outer value before expanding nested specs", () => {
  const { v, named, events, run } = fixture(); named.set("x", v.cell({})); named.set("w", v.integer(8));
  expect(run("{x!r:>{w}}", null)).toBe("   guest");
  expect(events).toEqual(["lookup:x", "repr", "lookup:w"]);
  events.length = 0;
  expect(run("{x:{w}}", null)).toBe("rendered");
  expect(events).toEqual(["lookup:x", "lookup:w", "format:8"]);
});
it("limits recursive spec expansion after lookup and conversion", () => {
  const { v, named, events, run } = fixture(); named.set("x", v.cell({})); named.set("y", v.cell({}));
  expect(() => run("{x!r:{y!r:{missing}}}", null)).toThrow("Max string recursion exceeded");
  expect(events).toEqual(["lookup:x", "repr", "lookup:y", "repr"]);
  events.length = 0;
  expect(run("{x:{{}}}", null)).toBe("rendered");
  expect(events).toEqual(["lookup:x", "format:{}"]);
});
it("preserves field errors before invalid conversions and later malformed markup", () => {
  const { v, named, events, run } = fixture();
  expect(() => run("{missing!q}", null)).toThrow("missing");
  named.set("x", v.cell({})); events.length = 0;
  expect(() => run("{x!q:{missing}}", null)).toThrow("Unknown conversion specifier q");
  expect(events).toEqual(["lookup:x"]);
  expect(() => run("{x!😀}", null)).toThrow("Unknown conversion specifier \\x1f600");
  events.length = 0;
  expect(() => run("{x}later{", null)).toThrow("Single '{'");
  expect(events).toEqual(["lookup:x", "format:"]);
});
it("meters output allocation and preserves independent surrogate code points", () => {
  const { v, hooks, context, meter } = fixture();
  const source = v.string("a{0}b").value, value = v.stringPoints(Uint32Array.of(0xd800, 0xdc00));
  expect([...braceFormat(source, [value], hooks, context, meter).storage]).toEqual([97, 0xd800, 0xdc00, 98]);
  expect(() => braceFormat(source, [value], hooks, context, new ExecutionBudget({ maxSteps: 1, maxAllocatedBytes: 100000 }))).toThrow(ExecutionLimitError);
});
