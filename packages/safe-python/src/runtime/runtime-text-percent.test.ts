import { expect, it } from "vitest";
import { runtimeBinary } from "./runtime-binary.js";
import { runtimeInPlace } from "./runtime-inplace.js";
import { createRuntimeExpressionContext } from "./runtime-expression-context.js";
import { evaluateExpression, UnsupportedExpressionError } from "./expression-evaluation.js";
import { parseExpression } from "../expression.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 }), v = new RuntimeValues(meter);
  return { meter, v, format: (source: string, argument: RuntimeValue) => runtimeBinary("%", v.string(source), argument, v, meter) };
}
const text = (value: RuntimeValue) => { if (value.kind !== "str") throw Error("expected str"); return String.fromCodePoint(...value.value); };
it("executes native mixed string percent formatting", () => {
  const { v, format } = fixture();
  expect(text(format("[%#x|%+.2f|%s|%r|%a|%c]", v.tuple([v.integer(255), v.float(1.25), v.string("é"), v.true, v.string("é"), v.integer(65)])))).toBe("[0xff|+1.25|é|True|'\\xe9'|A]");
});
it("routes string formats before dictionary/proxy operand-family rejection", () => {
  const { meter, v, format } = fixture();
  const dictionary = v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>({ hash: () => 1n, equal: (a, b) => a.kind === "str" && b.kind === "str" && a.value.compare(b.value, meter) === 0 }, meter));
  dictionary.items.set(v.string("name"), v.string("Ada"));
  expect(text(format("Hello %(name)s", dictionary))).toBe("Hello Ada");
  expect(text(format("Hello %(name)s", v.mappingProxy(dictionary)))).toBe("Hello Ada");
  expect(() => format("%(name)s", v.list([]))).toThrow("list indices must be integers or slices");
});
it("reports the original string-modulo gap as a guest TypeError", () => {
  const { v, format } = fixture();
  expect(() => format("a", v.integer(2))).toThrow(expect.objectContaining({ name: "TypeError", message: "not all arguments converted during string formatting" }));
  expect(() => format("%q", v.tuple([]))).toThrow("not enough arguments");
  expect(() => format("%q", v.integer(1))).toThrow("unsupported format character 'q'");
});
it("preserves source and field identity through binary and in-place entrypoints", () => {
  const { meter, v } = fixture(), source = v.string("literal"), value = v.string("hello");
  expect(runtimeBinary("%", source, v.tuple([]), v, meter)).toBe(source);
  expect(runtimeBinary("%", v.string("%s"), value, v, meter)).toBe(value);
  expect(runtimeInPlace("%", v.string("%s"), value, v, meter)).toBe(value);
});
it("executes parsed formatting through the normal expression context", () => {
  const { meter, v } = fixture(), unsupported = () => { throw Error("unexpected hook"); };
  const context = createRuntimeExpressionContext(v, { load: unsupported, store: unsupported, beginCall: unsupported, beginSet: unsupported, beginDictionary: unsupported, warn: unsupported }, meter);
  expect(text(evaluateExpression(parseExpression("'%04d / %.2f' % (7, 1.25)"), context, meter))).toBe("0007 / 1.25");
  expect(() => evaluateExpression(parseExpression("'a' % 2"), context, meter)).toThrow("not all arguments converted");
});
it("keeps unfinished representations explicit and numeric modulo unchanged", () => {
  const { meter, v, format } = fixture();
  expect(text(format("%s", v.list([])))).toBe("[]");
  expect(() => format("%s", v.cell({}))).toThrow(UnsupportedExpressionError);
  expect(runtimeBinary("%", v.integer(-7), v.integer(3), v, meter)).toEqual(v.integer(2));
  expect(runtimeBinary("%", v.bytes(Uint8Array.of(37, 100)), v.integer(1), v, meter)).toBe(v.bytes(Uint8Array.of(49)));
});
it("checks execution cancellation before entering formatting", () => {
  const { v } = fixture(), controller = new AbortController(); controller.abort();
  expect(() => runtimeBinary("%", v.string("%s"), v.string("x"), v, new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 10000, signal: controller.signal }))).toThrow(ExecutionLimitError);
});
