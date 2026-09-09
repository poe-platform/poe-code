import { describe, expect, it } from "vitest";
import { createBuildClassBuiltin, type RuntimeClassBuilderContext } from "./builtin-build-class.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { runtimeHash } from "./runtime-hash.js";
import { runtimeComparison } from "./runtime-comparison.js";
import { analyzeModule } from "../analysis.js";
import { compileProgram } from "./program-compilation.js";
import { executeRuntimeProgram, type RuntimeProgramHooks } from "./runtime-program.js";
import { executeRuntimeBuilderBody } from "./runtime-builder-body.js";
import { CallStack } from "./call-stack.js";

function fixture(source: string, signal?: AbortSignal) {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 2000000, signal }), values = new RuntimeValues(meter);
  const hash = { none: values.none, identity: () => 17n, string: () => 23n, bytes: () => 29n }, keys = { hash: (key: RuntimeValue) => runtimeHash(key, hash, meter), equal: (a: RuntimeValue, b: RuntimeValue) => runtimeComparison("==", a, b, values, meter).value };
  const dictionary = () => values.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter));
  const globals = new Map<string, RuntimeValue>([["__name__", values.string("example")]]), builtins = new Map<string, RuntimeValue>(), calls = new CallStack<object>(50, meter);
  const program = compileProgram<RuntimeValue>(analyzeModule(source), { stripDocstring: false }, values, meter);
  const unused = (): never => { throw new Error("unexpected hook"); }, events: string[] = [], forwarded: ReadonlyMap<RuntimeValue, RuntimeValue>[] = [];
  const hooks: RuntimeProgramHooks = { expressions: () => ({ attribute: unused, beginSet: unused, warn: unused }), statements: () => ({ setAttribute: unused, deleteAttribute: unused, executeUnhandled: unused }), callable: () => false, invoke: unused, name: () => "function()", keywordName: key => key.kind === "str" ? String.fromCodePoint(...key.value) : unused() };
  const context = { values, keys, globals, builtins, calls, hooks };
  const meta = values.builtinFunction({ name: "Meta", invoke: positional => positional[2] }); globals.set("Meta", meta);
  const policy: RuntimeClassBuilderContext = {
    bases: { tupleItems: v => v.kind === "tuple" ? v.items : undefined, isType: () => false, lookup: () => undefined, call: unused, iterateTuple: v => { if (v.kind !== "tuple") return unused(); return v.items[Symbol.iterator](); }, tuple: items => values.tuple(items) },
    preparation: {
      defaultType: meta, tupleItems: v => v.kind === "tuple" ? v.items : undefined, isType: (_v): _v is RuntimeValue => false,
      typeOf: () => meta, mro: () => [], typeName: () => "marker", lookupPrepare() { expect(this).toBe(policy.preparation); events.push("prepare"); return undefined; },
      callPrepare: unused, emptyNamespace: dictionary, isMapping: v => v.kind === "dict"
    },
    executeBody(fn, namespace) {
      expect(this).toBe(policy); events.push("body");
      if (fn.kind !== "function") return unused();
      return executeRuntimeBuilderBody(fn, namespace, program, context, meter);
    },
    storeOriginalBases(namespace, original) { expect(this).toBe(policy); if (namespace.kind !== "dict") return unused(); namespace.items.set(values.string("__orig_bases__"), original); },
    construction: {
      call(selected, name, bases, namespace, kw) {
        expect(this).toBe(policy.construction); events.push("construct"); forwarded.push(kw);
        if (selected.kind !== "builtin_function_or_method") return unused(); const kwargs = dictionary(); for (const [k, v] of kw) kwargs.items.set(k, v);
        return selected.value.invoke([name, bases, namespace], kwargs, meter);
      }, isType: () => false, reprName: () => "'C'", repr: () => "marker"
    }
  };
  const builtin = createBuildClassBuiltin(policy, values, meter); builtins.set("__build_class__", builtin);
  return { ...context, meter, dictionary, policy, builtin, events, forwarded, run: () => executeRuntimeProgram(program, context, meter) };
}

describe("concrete __build_class__ builtin", () => {
  it("executes a compiled class suite through the explicit metaclass lifecycle", () => {
    const state = fixture("class C(metaclass=Meta, flag=2):\n x = 7\n def f(): return __class__\n"); state.run();
    const cls = state.globals.get("C"); expect(cls?.kind).toBe("dict"); if (cls?.kind !== "dict") throw new Error("expected namespace result");
    expect(cls.items.lookup(state.values.string("x"))?.value).toEqual(state.values.integer(7)); expect(cls.items.lookup(state.values.string("__classcell__"))?.value.kind).toBe("cell");
    expect(state.globals.has("x")).toBe(false); expect(state.events).toEqual(["prepare", "body", "construct"]); expect(state.calls.depth).toBe(0);
  });
  it.each([["__build_class__()", "not enough arguments"], ["__build_class__(1, 'C')", "func must be a function"], ["def f(): pass\n__build_class__(f, 1)", "name is not a string"], ["__build_class__(Meta, 'C')", "func must be a function"]])("validates intrinsic arguments for %s before metaclass operations", (source, message) => {
    const state = fixture(source); expect(state.run).toThrow(message); expect(state.events).toEqual([]);
  });
  it("forwards original runtime keyword keys without host-string collapse", () => {
    const state = fixture("class C(**kw): pass\n"), { values: v } = state, kw = state.dictionary();
    const pair = v.stringPoints(new Uint32Array([0xd800, 0xdc00])), astral = v.string("𐀀");
    kw.items.set(v.string("metaclass"), state.globals.get("Meta")!); kw.items.set(pair, v.integer(1)); kw.items.set(astral, v.integer(2)); state.globals.set("kw", kw);
    state.run(); expect([...state.forwarded[0].keys()]).toEqual([pair, astral]); expect([...state.forwarded[0].keys()][0]).toBe(pair); expect([...state.forwarded[0].keys()][1]).toBe(astral);
  });
  it("does not construct or bind a class after its body fails", () => {
    const state = fixture("class C(metaclass=Meta):\n x = 1 / 0\n"); expect(state.run).toThrow(expect.objectContaining({ name: "ZeroDivisionError" }));
    expect(state.globals.has("C")).toBe(false); expect(state.events).toEqual(["prepare", "body"]); expect(state.calls.depth).toBe(0);
  });
  it("runs explicitly supplied ordinary functions without leaking optimized locals", () => {
    const state = fixture("def f():\n global changed\n changed = 7\n local = 3\n return 42\nC = __build_class__(f, 'C', metaclass=Meta)\n"); state.run();
    const cls = state.globals.get("C"); expect(cls?.kind === "dict" && cls.items.size).toBe(0);
    expect(state.globals.get("changed")).toEqual(state.values.integer(7)); expect(state.globals.has("local")).toBe(false); expect(state.calls.depth).toBe(0);
  });
  it("accepts standalone returned cells during non-type metaclass construction", () => {
    const state = fixture("def f(): return cell\nC = __build_class__(f, 'C', metaclass=Meta)\n"); state.globals.set("cell", state.values.cell({ content: { value: state.values.true } }));
    state.run(); expect(state.globals.get("C")?.kind).toBe("dict"); expect(state.calls.depth).toBe(0);
  });
  it("does not publish a metaclass result after cancellation", () => {
    const controller = new AbortController(), state = fixture("class C(metaclass=Meta): pass\n", controller.signal);
    state.policy.construction.call = () => { controller.abort(); return state.values.none; };
    expect(state.run).toThrow(ExecutionLimitError); expect(state.globals.has("C")).toBe(false); expect(state.calls.depth).toBe(0);
  });
  it("rejects non-string keyword records even for direct capability invocation", () => {
    const state = fixture(""), kw = state.dictionary(); kw.items.set(state.values.integer(1), state.values.none);
    expect(() => state.builtin.value.invoke([], kw, state.meter)).toThrow("keywords must be strings"); expect(state.events).toEqual([]);
  });
});
