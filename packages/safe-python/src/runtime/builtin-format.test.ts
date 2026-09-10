import { expect, it } from "vitest";
import { createFormatBuiltin } from "./builtin-format.js";
import { createRuntimeRepresentationContext } from "./runtime-representation.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { constructRuntimeDictionary } from "./runtime-dictionary-update.js";
import { PythonRuntimeError } from "./error.js";
import { analyzeModule } from "../analysis.js";
import { compileProgram } from "./program-compilation.js";
import { executeRuntimeProgram } from "./runtime-program.js";
import { CallStack } from "./call-stack.js";
import { createRuntimeFormatContext } from "./runtime-format.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 }), v = new RuntimeValues(meter);
  const keywords = constructRuntimeDictionary([], new Map(), v, { hash: () => 1n, equal: (a, b) => a === b }, meter);
  const context = {
    ...createRuntimeRepresentationContext(v, meter, { defaultRepr() { throw Error("unresolved representation"); } }),
    isExactInteger: (value: RuntimeValue) => value.kind === "int",
    lookupFormat: (_value: RuntimeValue): ((spec: RuntimeValue) => RuntimeValue) | undefined => undefined
  };
  const builtin = createFormatBuiltin(v, meter, context);
  return { meter, v, keywords, context, builtin };
}
it("formats exact str/int with omitted and explicit empty specs", () => {
  const { v, meter, keywords, builtin } = fixture(), source = v.string("hello");
  expect(builtin.value.invoke([source], keywords, meter)).toBe(source);
  expect(builtin.value.invoke([source, v.string("")], keywords, meter)).toBe(source);
  expect(builtin.value.invoke([v.integer(12)], keywords, meter)).toEqual(v.string("12"));
});
it("checks keywords then arity then the public spec-type diagnostic", () => {
  const { v, meter, keywords, builtin } = fixture();
  expect(() => builtin.value.invoke([], keywords, meter)).toThrow("format expected at least 1 argument, got 0");
  expect(() => builtin.value.invoke([v.none, v.none, v.none], keywords, meter)).toThrow("format expected at most 2 arguments, got 3");
  expect(() => builtin.value.invoke([v.cell({}), v.integer(1)], keywords, meter)).toThrow("format() argument 2 must be str, not int");
  expect(() => builtin.value.invoke([v.integer(1), v.none], keywords, meter)).toThrow(new PythonRuntimeError("TypeError", "format() argument 2 must be str, not None"));
  keywords.items.set(v.string("value"), v.none);
  expect(() => builtin.value.invoke([], keywords, meter)).toThrow("format() takes no keyword arguments");
});
it("accepts subclass specs unchanged and preserves the slot result", () => {
  const { v, meter, keywords, context } = fixture(), spec = v.cell({}), guest = v.cell({}), result = v.string("result"), storage = v.string("spec").value;
  const builtin = createFormatBuiltin(v, meter, {
    ...context, string: value => value === spec ? storage : context.string(value),
    lookupFormat: value => value === guest ? received => { expect(received).toBe(spec); return result; } : undefined
  });
  expect(builtin.value.invoke([guest, spec], keywords, meter)).toBe(result);
});
it("bounds public type names at 50 UTF-8 bytes and preserves protocol failures", () => {
  const { v, meter, keywords, context } = fixture(), guest = v.cell({});
  const builtin = createFormatBuiltin(v, meter, { ...context, typeName: () => "é".repeat(100) });
  expect(() => builtin.value.invoke([v.none, guest], keywords, meter)).toThrow(`format() argument 2 must be str, not ${"é".repeat(25)}`);
  const error = Error("guest lookup");
  const failing = createFormatBuiltin(v, meter, { ...context, lookupFormat() { throw error; } });
  expect(() => failing.value.invoke([guest], keywords, meter)).toThrow(error);
  expect(() => failing.value.invoke([guest], keywords, { checkpoint() { throw new ExecutionLimitError("cancelled"); } })).toThrow(ExecutionLimitError);
});
it.each([false, true])("shares compiled formatting policy with f-strings, guest=%s", guest => {
  const { v, meter } = fixture(), value = guest ? v.cell({}) : v.integer(12), globals = new Map<string, RuntimeValue>([["value", value]]), unused = (): never => { throw Error("unexpected lookup or call"); };
  const formatting = guest ? createRuntimeFormatContext(v, meter, { defaultRepr: unused, lookupFormat(received) {
    expect(received).toBe(value);
    return spec => { expect(spec).toEqual(v.string("04")); return v.string("guest result"); };
  } }) : undefined;
  const program = compileProgram<RuntimeValue>(analyzeModule('def render(): return format(value,"04")\nresult=render()\ninterpolated=f"{value:04}"\n'), { stripDocstring: false }, v, meter);
  executeRuntimeProgram(program, {
    values: v, globals, formatting, builtins: new Map([["format", createFormatBuiltin(v, meter)]]), keys: { hash: () => 1n, equal: (a,b) => a === b }, calls: new CallStack<object>(50, meter),
    hooks: { specialMethods: () => ({ typeOf: unused, slots: unused }), expressions: () => ({ warn() {}, attribute: unused }), statements: () => ({ setAttribute: unused, deleteAttribute: unused, executeUnhandled: unused }), callable: () => false, name: () => "render()", keywordName: unused, invoke: unused }
  }, meter);
  expect(globals.get("result")).toEqual(v.string(guest ? "guest result" : "0012"));
  expect(globals.get("interpolated")).toEqual(globals.get("result"));
});
it("provides native formatting without a separate policy", () => {
  const { v, meter, keywords } = fixture(), builtin = createFormatBuiltin(v, meter);
  expect(builtin.value.invoke([v.integer(255), v.string("#06x")], keywords, meter)).toEqual(v.string("0x00ff"));
  expect(builtin.value.invoke([v.float(1.25), v.string(".1f")], keywords, meter)).toEqual(v.string("1.2"));
  expect(builtin.value.invoke([v.string("x"), v.string("*>3")], keywords, meter)).toEqual(v.string("**x"));
  expect(builtin.value.invoke([v.none], keywords, meter)).toEqual(v.string("None"));
});
it("validates arguments before reading invocation policy and preserves explicit priority", () => {
  const { v, meter, keywords, context } = fixture(), builtin = createFormatBuiltin(v, meter);
  const invocation = { get formatting(): typeof context { throw Error("must not read policy"); }, call: () => v.none, isStopIteration: () => false };
  expect(() => builtin.value.invoke([], keywords, meter, invocation)).toThrow("format expected at least 1 argument, got 0");
  expect(() => builtin.value.invoke([v.none, v.none, v.none], keywords, meter, invocation)).toThrow("format expected at most 2 arguments, got 3");
  keywords.items.set(v.string("value"), v.none);
  expect(() => builtin.value.invoke([], keywords, meter, invocation)).toThrow("format() takes no keyword arguments");
  keywords.items.clear();
  expect(createFormatBuiltin(v, meter, context).value.invoke([v.integer(1)], keywords, meter, invocation)).toEqual(v.string("1"));
});
it("retains callback receivers and invocation policies across calls", () => {
  const { v, meter, keywords, context } = fixture(), builtin = createFormatBuiltin(v, meter), guest = v.cell({}), spec = v.cell({}), result = v.cell({});
  const policy = {
    ...context,
    string(value: RuntimeValue) { expect(this).toBe(policy); return value === spec || value === result ? v.string("guest").value : context.string(value); },
    lookupFormat(value: RuntimeValue) { expect(this).toBe(policy); expect(value).toBe(guest); return (received: RuntimeValue) => { expect(received).toBe(spec); return result; }; }
  };
  expect(builtin.value.invoke([guest, spec], keywords, meter, { formatting: policy, call: () => v.none, isStopIteration: () => false })).toBe(result);
  expect(builtin.value.invoke([v.integer(8), v.string("03")], keywords, meter)).toEqual(v.string("008"));
});
it("checks cancellation after acquiring the invocation formatting policy", () => {
  const { v, meter, keywords, context } = fixture(), builtin = createFormatBuiltin(v, meter); let cancelled = false;
  const policy = { ...context, string(): never { throw Error("must stop before reading string storage"); } };
  const invocation = { get formatting() { cancelled = true; return policy; }, call: () => v.none, isStopIteration: () => false };
  expect(() => builtin.value.invoke([v.none, v.string("")], keywords, { checkpoint() { if (cancelled) throw new ExecutionLimitError("cancelled"); } }, invocation)).toThrow(ExecutionLimitError);
});
it.each(["invalid-spec", "invalid-result", "lookup", "call"])("preserves invocation formatting failures during %s", phase => {
  const { v, meter, keywords, context } = fixture(), builtin = createFormatBuiltin(v, meter), guest = v.cell({}), failure = new PythonRuntimeError("AttributeError", "format descriptor failed"); let cancelled = false;
  const policy = {
    ...context, typeName: () => "Guest",
    lookupFormat() {
      if (phase === "lookup") throw failure;
      return () => { if (phase === "call") cancelled = true; return v.none; };
    }
  };
  const invocation = { formatting: policy, call: () => v.none, isStopIteration: () => false };
  const checkedMeter = { checkpoint() { if (cancelled) throw new ExecutionLimitError("cancelled"); } };
  const run = () => builtin.value.invoke([guest, phase === "invalid-spec" ? guest : v.string("x")], keywords, checkedMeter, invocation);
  if (phase === "lookup") expect(run).toThrow(failure);
  else if (phase === "call") expect(run).toThrow(ExecutionLimitError);
  else expect(run).toThrow(phase === "invalid-spec" ? "format() argument 2 must be str, not Guest" : "__format__ must return a str, not Guest");
});
