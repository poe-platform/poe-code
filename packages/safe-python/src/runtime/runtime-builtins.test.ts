import { expect, it } from "vitest";
import { createRuntimeBuiltins, type RuntimeBuiltinContexts } from "./runtime-builtins.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { createRuntimeRepresentationContext } from "./runtime-representation.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { analyzeModule } from "../analysis.js";
import { compileProgram } from "./program-compilation.js";
import { executeRuntimeProgram } from "./runtime-program.js";
import { CallStack } from "./call-stack.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 }), v = new RuntimeValues(meter), unused = (): never => { throw Error("unexpected guest callback"); };
  const representation = createRuntimeRepresentationContext(v, meter, { defaultRepr: unused });
  const context: RuntimeBuiltinContexts = {
    representation, format: { ...representation, isExactInteger: value => value.kind === "int", lookupFormat: () => undefined },
    identity: { id: () => 101n }, hash: { none: v.none, identity: () => 101n, string: () => 1n, bytes: () => 1n },
    iter: { isCallable: () => false, call: unused, equal: unused, isStopIteration: () => false },
    map: { call: unused, isStopIteration: () => false }, filter: { call: unused, isStopIteration: () => false },
    minMax: { call: unused }, sorted: { callKey: unused },
    attributeLookup: { attribute: unused }, attributeMutation: { setAttribute: unused, deleteAttribute: unused },
    print: { representation, stdout: () => v.none, lookupWrite: unused, flush: unused },
    buildClass: {
      bases: { tupleItems: unused, isType: unused, lookup: unused, call: unused, iterateTuple: unused, tuple: unused },
      preparation: { defaultType: v.none, tupleItems: unused, isType: (_value): _value is RuntimeValue => false, typeOf: unused, mro: unused, typeName: unused, lookupPrepare: unused, callPrepare: unused, emptyNamespace: unused, isMapping: unused },
      construction: { call: unused, isType: unused, reprName: unused, repr: unused }, executeBody: unused, storeOriginalBases: unused
    }
  };
  const keywords = v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>({ hash: () => 1n, equal: (a,b) => a === b }, meter));
  return { meter, v, context, keywords };
}
it("assembles existing builtin families without invoking guest capabilities", () => {
  const { meter, v, context, keywords } = fixture(), builtins = createRuntimeBuiltins(v, meter, context);
  for (const name of ["abs", "all", "any", "bin", "oct", "hex", "callable", "chr", "ord", "len", "iter", "next", "enumerate", "zip", "map", "filter", "min", "max", "sorted", "sum", "pow", "round", "divmod", "id", "hash", "repr", "ascii", "format", "getattr", "hasattr", "setattr", "delattr", "reversed", "print", "__build_class__"]) {
    const value = builtins.get(name); expect(value?.kind).toBe("builtin_function_or_method");
    if (value?.kind === "builtin_function_or_method") expect(value.value.name).toBe(name);
  }
  const len = builtins.get("len"); if (len?.kind !== "builtin_function_or_method") throw Error("expected len");
  expect(len.value.invoke([v.tuple([v.true, v.false])], keywords, meter)).toEqual(v.integer(2));
  expect(builtins.get("None")).toBe(v.none); expect(builtins.get("NotImplemented")).toBe(v.notImplemented);
});
it("allows explicit extensions and replacement without mutating another namespace", () => {
  const { meter, v, context } = fixture(), first = createRuntimeBuiltins(v, meter, context), replacement = v.cell({});
  const second = createRuntimeBuiltins(v, meter, context, [["len", replacement], ["application", v.true]]);
  expect(second.get("len")).toBe(replacement); expect(first.get("len")).not.toBe(replacement); expect(second.get("application")).toBe(v.true); expect(first.has("application")).toBe(false);
});
it("passes configured guest protocols to the registered factory", () => {
  const { meter, v, context, keywords } = fixture(), guest = v.cell({}); let calls = 0;
  context.callable = { callable(value) { expect(value).toBe(guest); calls++; return true; } };
  const builtin = createRuntimeBuiltins(v, meter, context).get("callable");
  if (builtin?.kind !== "builtin_function_or_method") throw Error("expected callable");
  expect(builtin.value.invoke([guest], keywords, meter)).toBe(v.true); expect(calls).toBe(1);
});
it("checks cancellation before allocating the namespace or reading extensions", () => {
  const { v, context } = fixture(), controller = new AbortController(); controller.abort();
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 10000, signal: controller.signal });
  expect(() => createRuntimeBuiltins(v, meter, context, { [Symbol.iterator]() { throw Error("must not iterate"); } })).toThrow(ExecutionLimitError);
});
it("preserves cancellation when an extension iterator throws", () => {
  const { v, context } = fixture(), controller = new AbortController();
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000, signal: controller.signal });
  const extensions = { [Symbol.iterator]() { return { next(): IteratorResult<readonly [string, RuntimeValue]> { controller.abort(); throw Error("extension failed"); } }; } };
  expect(() => createRuntimeBuiltins(v, meter, context, extensions)).toThrow(ExecutionLimitError);
});
it("checks cancellation before unpacking an extension entry", () => {
  const { v, context } = fixture(), controller = new AbortController(); let read = false;
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000, signal: controller.signal });
  const pair: [string, RuntimeValue] = ["extra", v.true];
  Object.defineProperty(pair, "0", { get() { read = true; return "extra"; } });
  const extensions = { *[Symbol.iterator]() { controller.abort(); yield pair; } };
  expect(() => createRuntimeBuiltins(v, meter, context, extensions)).toThrow(ExecutionLimitError); expect(read).toBe(false);
});
it("preserves ordinary extension failures and closes an iterator on cancellation", () => {
  const { v, context, meter } = fixture(), fault = Error("extension failed");
  expect(() => createRuntimeBuiltins(v, meter, context, { [Symbol.iterator](): Iterator<readonly [string, RuntimeValue]> { throw fault; } })).toThrow(fault);
  const controller = new AbortController(), cancelled = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000, signal: controller.signal }); let closed = false;
  const extensions = { *[Symbol.iterator](): Generator<readonly [string, RuntimeValue]> { try { controller.abort(); yield ["extra", v.true]; } finally { closed = true; } } };
  expect(() => createRuntimeBuiltins(v, cancelled, context, extensions)).toThrow(ExecutionLimitError); expect(closed).toBe(true);
});
it("executes a compiled module and nested function with the assembled namespace", () => {
  const { meter, v, context } = fixture(), globals = new Map<string, RuntimeValue>(), chunks: string[] = [], unused = (): never => { throw Error("unexpected guest callback"); };
  context.print = { ...context.print, stdout: () => v.true, lookupWrite: () => value => { if (value.kind !== "str") throw Error("expected text"); chunks.push(String.fromCodePoint(...value.value)); } };
  const program = compileProgram<RuntimeValue>(analyzeModule("def total(): return sum([1,2,3])\nprint(chr(65), len([1,2]))\nresult=total()==6 and max(2,5)==5 and next(iter(sorted([3,1])))==1\n"), { stripDocstring: false }, v, meter);
  executeRuntimeProgram(program, {
    values: v, globals, builtins: createRuntimeBuiltins(v, meter, context), keys: { hash: () => 1n, equal: (a,b) => a === b }, calls: new CallStack<object>(50, meter),
    hooks: { expressions: () => ({ warn() {} }), statements: () => ({ setAttribute: unused, deleteAttribute: unused, executeUnhandled: unused }), callable: () => false, name: () => "function()", keywordName: unused, invoke: unused }
  }, meter);
  expect(globals.get("result")).toBe(v.true); expect(chunks).toEqual(["A", " ", "2", "\n"]);
});
it("lets map invoke compiled callbacks after their creating frame returns", () => {
  const { meter, v, context } = fixture(), globals = new Map<string, RuntimeValue>(), unused = (): never => { throw Error("unexpected guest callback"); };
  delete context.map;
  const program = compileProgram<RuntimeValue>(analyzeModule("def mapped(offset):\n return map(lambda value: value+offset,[4,8])\nitems=mapped(3)\nresult=next(items)==7 and next(items)==11\n"), { stripDocstring: false }, v, meter);
  executeRuntimeProgram(program, {
    values: v, globals, builtins: createRuntimeBuiltins(v, meter, context), keys: { hash: () => 1n, equal: (a,b) => a === b }, calls: new CallStack<object>(50, meter),
    hooks: { expressions: () => ({ warn() {} }), statements: () => ({ setAttribute: unused, deleteAttribute: unused, executeUnhandled: unused }), callable: () => false, name: () => "function()", keywordName: unused, invoke: unused }
  }, meter);
  expect(globals.get("result")).toBe(v.true);
});
