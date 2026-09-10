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
import { runtimeTruth } from "./runtime-truth.js";

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
it.each(["map", "filter"])("lets %s retain frame-owned guest iteration after its creating frame returns", name => {
  const { meter, v, context } = fixture(), source = v.cell({}), globals = new Map<string, RuntimeValue>([["source", source]]), events: string[] = [], unused = (): never => { throw Error("unexpected guest callback"); };
  delete context.map; delete context.filter;
  const stop = Error("guest exhaustion"); let index = 0;
  const program = compileProgram<RuntimeValue>(analyzeModule(`def create(): return ${name}(lambda value: value,source)\nitems=create()\nfirst=next(items)\nsecond=next(items)\nlast=next(items,99)\n`), { stripDocstring: false }, v, meter);
  executeRuntimeProgram(program, {
    values: v, globals, builtins: createRuntimeBuiltins(v, meter, context), keys: { hash: () => 1n, equal: (a,b) => a === b }, calls: new CallStack<object>(50, meter),
    hooks: { expressions: () => ({ warn() {}, iteration: {
      lookupIter(value) { expect(value).toBe(source); events.push("iter"); return () => source; }, hasNext: () => true,
      next() { events.push("next"); if (index === 2) throw stop; return v.integer(++index); },
      hasSequenceItem: () => false, getItem: unused, isStopIteration: error => error === stop, isIndexError: () => false, typeName: () => "Guest"
    } }), statements: () => ({ setAttribute: unused, deleteAttribute: unused, executeUnhandled: unused }), callable: () => false, name: () => "function()", keywordName: unused, invoke: unused }
  }, meter);
  expect(globals.get("first")).toEqual(v.integer(1)); expect(globals.get("second")).toEqual(v.integer(2)); expect(globals.get("last")).toEqual(v.integer(99));
  expect(events).toEqual(["iter", "next", "next", "next"]);
});
it.each(["map", "filter"] as const)("preserves explicit %s input iteration over invocation iteration", name => {
  const { meter, v, context, keywords } = fixture(), source = v.cell({}), unused = (): never => { throw Error("unexpected invocation callback"); }; let acquisitions = 0;
  const iteration = {
    lookupIter(value: RuntimeValue) { expect(value).toBe(source); acquisitions++; return () => source; }, hasNext: () => true, next: unused,
    hasSequenceItem: () => false, getItem: unused, isStopIteration: () => false, isIndexError: () => false, typeName: () => "Guest"
  };
  context[name] = { iteration };
  const builtin = createRuntimeBuiltins(v, meter, context).get(name); if (builtin?.kind !== "builtin_function_or_method") throw Error("expected builtin");
  const result = builtin.value.invoke([v.none, source], keywords, meter, { call: unused, isStopIteration: unused, iteration: { ...iteration, lookupIter: unused } });
  expect(result.kind).toBe("iterator"); expect(acquisitions).toBe(1);
});
it("routes map strict truth through the frame", () => {
  const { meter, v, context } = fixture(), decision = v.cell({}), globals = new Map<string, RuntimeValue>([["decision", decision]]), unused = (): never => { throw Error("unexpected guest callback"); }; let conversions = 0;
  delete context.map;
  const program = compileProgram<RuntimeValue>(analyzeModule("items=map(lambda a,b:a+b,[1],[2,3],strict=decision)\nfirst=next(items)\nlast=next(items,99)\n"), { stripDocstring: false }, v, meter);
  executeRuntimeProgram(program, {
    values: v, globals, builtins: createRuntimeBuiltins(v, meter, context), keys: { hash: () => 1n, equal: (a,b) => a === b }, calls: new CallStack<object>(50, meter),
    hooks: { expressions: () => ({ warn() {}, truth(value) { expect(value).toBe(decision); conversions++; return false; } }), statements: () => ({ setAttribute: unused, deleteAttribute: unused, executeUnhandled: unused }), callable: () => false, name: () => "function()", keywordName: unused, invoke: unused }
  }, meter);
  expect(globals.get("first")).toEqual(v.integer(3)); expect(globals.get("last")).toEqual(v.integer(99)); expect(conversions).toBe(1);
});
it("lets filter invoke a captured predicate after its creating frame returns", () => {
  const { meter, v, context } = fixture(), globals = new Map<string, RuntimeValue>(), unused = (): never => { throw Error("unexpected guest callback"); };
  delete context.filter;
  const program = compileProgram<RuntimeValue>(analyzeModule("def selected(limit):\n return filter(lambda value: value>limit,[1,4,8])\nitems=selected(3)\nresult=next(items)==4 and next(items)==8\n"), { stripDocstring: false }, v, meter);
  executeRuntimeProgram(program, {
    values: v, globals, builtins: createRuntimeBuiltins(v, meter, context), keys: { hash: () => 1n, equal: (a,b) => a === b }, calls: new CallStack<object>(50, meter),
    hooks: { expressions: () => ({ warn() {} }), statements: () => ({ setAttribute: unused, deleteAttribute: unused, executeUnhandled: unused }), callable: () => false, name: () => "function()", keywordName: unused, invoke: unused }
  }, meter);
  expect(globals.get("result")).toBe(v.true);
});
it("routes filter predicate-result truth through the execution frame", () => {
  const { meter, v, context } = fixture(), decision = v.cell({}), globals = new Map<string, RuntimeValue>([["decision", decision]]), unused = (): never => { throw Error("unexpected guest callback"); }; let conversions = 0;
  delete context.filter;
  const program = compileProgram<RuntimeValue>(analyzeModule("items=filter(lambda value: decision,[1,2])\nresult=next(items,99)\n"), { stripDocstring: false }, v, meter);
  executeRuntimeProgram(program, {
    values: v, globals, builtins: createRuntimeBuiltins(v, meter, context), keys: { hash: () => 1n, equal: (a,b) => a === b }, calls: new CallStack<object>(50, meter),
    hooks: { expressions: () => ({ warn() {}, truth(value) { if (value === decision) { conversions++; return false; } return runtimeTruth(value, meter); } }), statements: () => ({ setAttribute: unused, deleteAttribute: unused, executeUnhandled: unused }), callable: () => false, name: () => "function()", keywordName: unused, invoke: unused }
  }, meter);
  expect(globals.get("result")).toEqual(v.integer(99)); expect(conversions).toBe(2);
});
it.each(["min", "max"])("lets %s invoke compiled key functions", name => {
  const { meter, v, context } = fixture(), globals = new Map<string, RuntimeValue>(), unused = (): never => { throw Error("unexpected guest callback"); };
  delete context.minMax;
  const program = compileProgram<RuntimeValue>(analyzeModule(`def key(value): return -value\nresult=${name}([1,4,8],key=key)\n`), { stripDocstring: false }, v, meter);
  executeRuntimeProgram(program, {
    values: v, globals, builtins: createRuntimeBuiltins(v, meter, context), keys: { hash: () => 1n, equal: (a,b) => a === b }, calls: new CallStack<object>(50, meter),
    hooks: { expressions: () => ({ warn() {} }), statements: () => ({ setAttribute: unused, deleteAttribute: unused, executeUnhandled: unused }), callable: () => false, name: () => "function()", keywordName: unused, invoke: unused }
  }, meter);
  expect(globals.get("result")).toEqual(v.integer(name === "min" ? 8 : 1));
});
it.each(["all", "any"])("routes %s input iteration and short-circuit truth through the frame", name => {
  const { meter, v, context } = fixture(), source = v.cell({}), decision = v.cell({}), globals = new Map<string, RuntimeValue>([["source", source]]), events: string[] = [], unused = (): never => { throw Error("unexpected guest callback"); };
  const program = compileProgram<RuntimeValue>(analyzeModule(`result=${name}(source)\n`), { stripDocstring: false }, v, meter);
  executeRuntimeProgram(program, {
    values: v, globals, builtins: createRuntimeBuiltins(v, meter, context), keys: { hash: () => 1n, equal: (a,b) => a === b }, calls: new CallStack<object>(50, meter),
    hooks: { expressions: () => ({ warn() {}, iteration: {
      lookupIter(value) { expect(value).toBe(source); events.push("iter"); return () => source; }, hasNext: () => true,
      next() { events.push("next"); if (events.length > 3) throw Error("over-pulled"); return decision; },
      hasSequenceItem: () => false, getItem: unused, isStopIteration: () => false, isIndexError: () => false, typeName: () => "Guest"
    }, truth(value) { expect(value).toBe(decision); events.push("truth"); return name === "any"; } }), statements: () => ({ setAttribute: unused, deleteAttribute: unused, executeUnhandled: unused }), callable: () => false, name: () => "function()", keywordName: unused, invoke: unused }
  }, meter);
  expect(globals.get("result")).toBe(v.boolean(name === "any")); expect(events).toEqual(["iter", "next", "truth"]);
});
it.each(["min", "max", "sorted"])("lets %s consume guest iteration through the frame", name => {
  const { meter, v, context } = fixture(), source = v.cell({}), globals = new Map<string, RuntimeValue>([["source", source]]), events: string[] = [], unused = (): never => { throw Error("unexpected guest callback"); };
  delete context.minMax; delete context.sorted;
  const members = [4,1,3].map(value => v.integer(value)), stop = Error("guest exhaustion"); let index = 0;
  const program = compileProgram<RuntimeValue>(analyzeModule(`result=${name}(source,key=lambda value:-value)\n`), { stripDocstring: false }, v, meter);
  executeRuntimeProgram(program, {
    values: v, globals, builtins: createRuntimeBuiltins(v, meter, context), keys: { hash: () => 1n, equal: (a,b) => a === b }, calls: new CallStack<object>(50, meter),
    hooks: { expressions: () => ({ warn() {}, iteration: {
      lookupIter(value) { expect(value).toBe(source); events.push("iter"); return () => source; }, hasNext: () => true,
      next() { events.push("next"); if (index === members.length) throw stop; return members[index++]; },
      hasSequenceItem: () => false, getItem: unused, isStopIteration: error => error === stop, isIndexError: () => false, typeName: () => "Guest"
    } }), statements: () => ({ setAttribute: unused, deleteAttribute: unused, executeUnhandled: unused }), callable: () => false, name: () => "function()", keywordName: unused, invoke: unused }
  }, meter);
  const result = globals.get("result");
  if (name === "sorted") { if (result?.kind !== "list") throw Error("expected list"); expect(result.items.snapshot()).toEqual([members[0], members[2], members[1]]); }
  else expect(result).toBe(members[name === "min" ? 0 : 1]);
  expect(events).toEqual(["iter", "next", "next", "next", "next"]);
});
it.each([false, true])("routes iter/next through frame protocols with sequence fallback=%s", sequence => {
  const { meter, v, context } = fixture(), source = v.cell({}), cursor = v.cell({}), member = v.cell({}), fallback = v.cell({}), globals = new Map<string, RuntimeValue>([["source", source], ["fallback", fallback]]), events: string[] = [], unused = (): never => { throw Error("unexpected guest callback"); };
  const stop = Error("guest exhaustion"); let pulls = 0;
  const program = compileProgram<RuntimeValue>(analyzeModule("items=iter(source)\nfirst=next(items)\nlast=next(items,fallback)\n"), { stripDocstring: false }, v, meter);
  executeRuntimeProgram(program, {
    values: v, globals, builtins: createRuntimeBuiltins(v, meter, context), keys: { hash: () => 1n, equal: (a,b) => a === b }, calls: new CallStack<object>(50, meter),
    hooks: { expressions: () => ({ warn() {}, iteration: {
      lookupIter(value) { expect(value).toBe(source); events.push("iter"); return sequence ? undefined : () => cursor; }, hasNext: value => value === cursor,
      next(value) { expect(value).toBe(cursor); events.push("next"); if (pulls++ > 0) throw stop; return member; },
      hasSequenceItem: value => sequence && value === source,
      getItem(value, index) { expect(value).toBe(source); events.push(`get:${index}`); if (index > 0n) throw stop; return member; },
      isStopIteration: error => !sequence && error === stop, isIndexError: error => sequence && error === stop, typeName: () => "Guest"
    } }), statements: () => ({ setAttribute: unused, deleteAttribute: unused, executeUnhandled: unused }), callable: () => false, name: () => "function()", keywordName: unused, invoke: unused }
  }, meter);
  expect(globals.get("first")).toBe(member); expect(globals.get("last")).toBe(fallback);
  if (!sequence) expect(globals.get("items")).toBe(cursor);
  expect(events).toEqual(sequence ? ["iter", "get:0", "get:1"] : ["iter", "next", "next"]);
});
it("lets sorted invoke compiled keys with stable reverse ordering", () => {
  const { meter, v, context } = fixture(), globals = new Map<string, RuntimeValue>(), unused = (): never => { throw Error("unexpected guest callback"); };
  delete context.sorted;
  const program = compileProgram<RuntimeValue>(analyzeModule("result=sorted([1,4,3,2],key=lambda value:value%2,reverse=True)\n"), { stripDocstring: false }, v, meter);
  executeRuntimeProgram(program, {
    values: v, globals, builtins: createRuntimeBuiltins(v, meter, context), keys: { hash: () => 1n, equal: (a,b) => a === b }, calls: new CallStack<object>(50, meter),
    hooks: { expressions: () => ({ warn() {} }), statements: () => ({ setAttribute: unused, deleteAttribute: unused, executeUnhandled: unused }), callable: () => false, name: () => "function()", keywordName: unused, invoke: unused }
  }, meter);
  const result = globals.get("result"); if (result?.kind !== "list") throw Error("expected list");
  expect(result.items.snapshot()).toEqual([1,3,4,2].map(value => v.integer(value)));
});
it.each(["min", "max"])("routes %s ordering through frame rich comparison", name => {
  const { meter, v, context } = fixture(), first = v.cell({}), second = v.cell({}), answer = v.cell({}), globals = new Map<string, RuntimeValue>([["first", first], ["second", second]]), unused = (): never => { throw Error("unexpected guest callback"); }; let comparisons = 0;
  const program = compileProgram<RuntimeValue>(analyzeModule(`result=${name}([first,second])\n`), { stripDocstring: false }, v, meter);
  executeRuntimeProgram(program, {
    values: v, globals, builtins: createRuntimeBuiltins(v, meter, context), keys: { hash: () => 1n, equal: (a,b) => a === b }, calls: new CallStack<object>(50, meter),
    hooks: { expressions: () => ({ warn() {}, richComparison(operator, left, right) {
      expect(operator).toBe(name === "min" ? "<" : ">"); expect(left).toBe(second); expect(right).toBe(first); comparisons++;
      return { slots: { rightIsStrictSubtype: false, notImplemented: v.notImplemented, forward: () => answer, reflected: () => v.notImplemented } };
    }, truth(value) { expect(value).toBe(answer); return true; } }), statements: () => ({ setAttribute: unused, deleteAttribute: unused, executeUnhandled: unused }), callable: () => false, name: () => "function()", keywordName: unused, invoke: unused }
  }, meter);
  expect(globals.get("result")).toBe(second); expect(comparisons).toBe(1);
});
