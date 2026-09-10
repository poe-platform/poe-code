import { expect, it } from "vitest";
import { createPrintBuiltin, type PrintContext } from "./builtin-print.js";
import { createRuntimeRepresentationContext } from "./runtime-representation.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { OrderedKeyMap } from "./ordered-key-map.js";

function fixture(signal?: AbortSignal) {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000, signal }), v = new RuntimeValues(meter), file = v.cell({}), trace: string[] = [];
  const keywords = v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>({ hash: () => 1n, equal: (a,b) => a === b }, meter));
  const context: PrintContext = {
    representation: createRuntimeRepresentationContext(v, meter, { defaultRepr() { throw Error("unresolved repr"); } }),
    stdout() { trace.push("stdout"); return file; },
    lookupWrite(target) { expect(target).toBe(file); trace.push("lookup"); return text => { if (text.kind !== "str") throw Error("expected string"); trace.push(String.fromCodePoint(...text.value)); }; },
    flush(target) { expect(target).toBe(file); trace.push("flush"); }
  };
  return { v, meter, file, trace, keywords, context, call: (args: RuntimeValue[]) => createPrintBuiltin(v, meter, context).value.invoke(args, keywords, meter) };
}
it("writes separate converted arguments, separators and terminator, then flushes", () => {
  const { v, keywords, trace, call } = fixture();
  keywords.items.set(v.string("sep"), v.string("|")); keywords.items.set(v.string("end"), v.string("!")); keywords.items.set(v.string("flush"), v.true);
  expect(call([v.integer(12), v.string("x")])).toBe(v.none);
  expect(trace).toEqual(["stdout", "lookup", "12", "lookup", "|", "lookup", "x", "lookup", "!", "flush"]);
});
it("uses explicit files and None defaults and writes a newline with no arguments", () => {
  const { v, file, keywords, trace, call } = fixture();
  keywords.items.set(v.string("file"), file); keywords.items.set(v.string("end"), v.none);
  call([]); expect(trace).toEqual(["lookup", "\n"]);
});
it("converts flush before resolving stdout and suppresses output when stdout is None", () => {
  const { v, keywords, trace, context, call } = fixture();
  context.truth = () => { trace.push("truth"); return true; };
  context.stdout = () => { trace.push("stdout"); return v.none; };
  keywords.items.set(v.string("flush"), v.cell({})); keywords.items.set(v.string("sep"), v.integer(4));
  call([v.cell({})]); expect(trace).toEqual(["truth", "stdout"]);
});
it("validates separators before any stream lookup", () => {
  const { v, keywords, trace, call } = fixture(); keywords.items.set(v.string("sep"), v.integer(4));
  expect(() => call([])).toThrow("sep must be None or a string, not int"); expect(trace).toEqual(["stdout"]);
});
it("looks up write before invoking guest str and stops after a failed write", () => {
  const { v, context, trace, call } = fixture(), object = v.cell({}), error = Error("write failed");
  context.representation.lookupStr = value => value === object ? () => { trace.push("str"); return v.string("guest"); } : undefined;
  context.lookupWrite = () => { trace.push("lookup"); return () => { trace.push("write"); throw error; }; };
  expect(() => call([object, object])).toThrow(error); expect(trace).toEqual(["stdout", "lookup", "str", "write"]);
});
it("checks cancellation after stream lookup before string conversion", () => {
  const controller = new AbortController(), { v, context, call } = fixture(controller.signal);
  context.lookupWrite = () => { controller.abort(); return () => { throw Error("must not write"); }; };
  expect(() => call([v.cell({})])).toThrow(ExecutionLimitError);
});
it("rejects unknown keywords before reading stdout", () => {
  const { v, keywords, trace, call } = fixture(); keywords.items.set(v.string("bad"), v.true);
  expect(() => call([])).toThrow("print() got an unexpected keyword argument 'bad'"); expect(trace).toEqual([]);
});
it("reports the unexpected keyword even when more than four keywords were supplied", () => {
  const { v, keywords, call } = fixture();
  for (let i = 0; i < 5; i++) keywords.items.set(v.string(String(i)), v.true);
  expect(() => call([])).toThrow("print() got an unexpected keyword argument '0'");
});
it("suggests misspelled keyword names", () => {
  const { v, keywords, call } = fixture(); keywords.items.set(v.string("sepp"), v.none);
  expect(() => call([])).toThrow("print() got an unexpected keyword argument 'sepp'. Did you mean 'sep'?");
});
it("retains the selected stream across writes and ignores write return values", () => {
  const { v, context, call, file, trace } = fixture();
  context.lookupWrite = target => {
    expect(target).toBe(file);
    context.stdout = () => { throw Error("must not reselect stdout"); };
    return () => { trace.push("write"); return v.cell({}); };
  };
  call([v.integer(1), v.integer(2)]); expect(trace).toEqual(["stdout", "write", "write", "write", "write"]);
});
it("preserves explicit separator subclass str behavior after type validation", () => {
  const { v, context, keywords, call, trace } = fixture(), separator = v.cell({});
  const string = context.representation.string.bind(context.representation), lookup = context.representation.lookupStr.bind(context.representation);
  context.representation.string = value => value === separator ? v.string("stored").value : string(value);
  context.representation.lookupStr = value => value === separator ? () => v.string("override") : lookup(value);
  keywords.items.set(v.string("sep"), separator);
  call([v.string("a"), v.string("b")]); expect(trace).toEqual(["stdout", "lookup", "a", "lookup", "override", "lookup", "b", "lookup", "\n"]);
});
it("preserves flush failures after all output is written", () => {
  const { v, context, keywords, call, trace } = fixture(), error = Error("flush failed");
  keywords.items.set(v.string("flush"), v.true); context.flush = () => { throw error; };
  expect(() => call([])).toThrow(error); expect(trace).toEqual(["stdout", "lookup", "\n"]);
});
it("does not invoke the truth hook for an omitted flush argument", () => {
  const { context, call } = fixture(); context.truth = () => { throw Error("unexpected truth conversion"); };
  call([]);
});
