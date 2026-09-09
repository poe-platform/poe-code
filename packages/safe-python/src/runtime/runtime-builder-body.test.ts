import { describe, expect, it } from "vitest";
import { executeRuntimeBuilderBody, type RuntimeBuilderBodyContext } from "./runtime-builder-body.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { runtimeHash } from "./runtime-hash.js";
import { runtimeComparison } from "./runtime-comparison.js";
import { analyzeModule } from "../analysis.js";
import { compileProgram } from "./program-compilation.js";
import { createFunctionState } from "./function-state.js";
import { CallStack } from "./call-stack.js";

function fixture(source: string, signal?: AbortSignal) {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 2000000, signal }), values = new RuntimeValues(meter);
  const program = compileProgram<RuntimeValue>(analyzeModule(source), { stripDocstring: false }, values, meter);
  const code = program.classFunctions.values().next().value ?? program.functions.values().next().value!;
  const globals = new Map<string, RuntimeValue>([["__name__", values.string("example")]]), builtins = new Map<string, RuntimeValue>(), calls = new CallStack<object>(50, meter);
  const fn = values.function(createFunctionState(code, new Map(), { globals, builtins, none: values.none }, meter));
  const hash = { none: values.none, identity: () => 17n, string: () => 23n, bytes: () => 29n }, keys = { hash: (k: RuntimeValue) => runtimeHash(k, hash, meter), equal: (a: RuntimeValue, b: RuntimeValue) => runtimeComparison("==", a, b, values, meter).value };
  const namespace = values.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter)), unused = (): never => { throw new Error("unexpected hook"); };
  const context: RuntimeBuilderBodyContext = { values, keys, calls, hooks: { expressions: () => ({ attribute: unused, beginSet: unused, warn: unused }), statements: () => ({ setAttribute: unused, deleteAttribute: unused, executeUnhandled: unused }), callable: () => false, invoke: unused, name: () => "function()", keywordName: unused } };
  return { values, meter, program, fn, namespace, globals, builtins, calls, context, run: () => executeRuntimeBuilderBody(fn, namespace, program, context, meter) };
}

describe("prepared builder body execution", () => {
  it("executes class code against prepared locals and returns the published cell storage", () => {
    const state = fixture("class C:\n x = 7\n def f(): return __class__\n"), cell = state.run();
    const published = state.namespace.items.lookup(state.values.string("__classcell__"))?.value;
    expect(published?.kind === "cell" && published.value).toBe(cell); expect(cell).toBeDefined();
    expect(state.namespace.items.lookup(state.values.string("x"))?.value).toEqual(state.values.integer(7)); expect(state.globals.has("x")).toBe(false); expect(state.calls.depth).toBe(0);
  });
  it("keeps ordinary function locals out of the prepared namespace and ignores non-cell results", () => {
    const state = fixture("def f():\n x = 7\n return x\n");
    expect(state.run()).toBeUndefined(); expect(state.namespace.items.size).toBe(0); expect(state.globals.has("x")).toBe(false); expect(state.calls.depth).toBe(0);
  });
  it("returns ordinary function cell storage without requiring lexical ownership metadata", () => {
    const state = fixture("def f(): return cell\n"), cell = state.values.cell({ content: { value: state.values.integer(42) } }); state.globals.set("cell", cell);
    expect(state.run()).toBe(cell.value); expect(state.namespace.items.size).toBe(0);
  });
  it("binds ordinary function parameters before running their bodies", () => {
    const state = fixture("def f(x):\n global marker\n marker = 1\n");
    expect(state.run).toThrow("f() missing 1 required positional argument: 'x'"); expect(state.globals.has("marker")).toBe(false); expect(state.calls.depth).toBe(0);
  });
  it("uses an explicit custom mapping adapter for class code and preserves its method owner", () => {
    const state = fixture("class C:\n x = 3\n"), storage = new Map<string, RuntimeValue>(), marker = state.values.list([]);
    state.context.namespace = function(value) { expect(this).toBe(state.context); expect(value).toBe(marker); return { lookup: name => storage.has(name) ? { value: storage.get(name)! } : undefined, store: (name, value) => { storage.set(name, value); }, delete: name => storage.delete(name), isGuest: () => false }; };
    expect(executeRuntimeBuilderBody(state.fn, marker, state.program, state.context, state.meter)).toBeUndefined();
    expect(storage.get("x")).toEqual(state.values.integer(3)); expect(storage.get("__module__")).toEqual(state.values.string("example"));
  });
  it("does not access the prepared mapping when ordinary function flags select optimized locals", () => {
    const state = fixture("def f(): return 1\n"); state.context.namespace = () => { throw new Error("must not adapt"); };
    expect(executeRuntimeBuilderBody(state.fn, state.values.none, state.program, state.context, state.meter)).toBeUndefined();
  });
  it("uses originating registries for definitions inside a foreign class body", () => {
    const state = fixture("class C:\n def f(): return 1\n");
    const caller = compileProgram<RuntimeValue>(analyzeModule("pass\n"), { stripDocstring: false }, state.values, state.meter);
    executeRuntimeBuilderBody(state.fn, state.namespace, caller, state.context, state.meter);
    expect(state.namespace.items.lookup(state.values.string("f"))?.value.kind).toBe("function");
  });
  it("checks cancellation after adapting custom mappings before executing a class suite", () => {
    const controller = new AbortController(), state = fixture("class C: pass\n", controller.signal); let stored = false;
    state.context.namespace = () => { controller.abort(); return { lookup: () => undefined, store: () => { stored = true; }, delete: () => false, isGuest: () => false }; };
    expect(() => executeRuntimeBuilderBody(state.fn, state.values.none, state.program, state.context, state.meter)).toThrow(ExecutionLimitError); expect(stored).toBe(false); expect(state.calls.depth).toBe(0);
  });
  it("does not return a construction cell after the final mapping store cancels execution", () => {
    const controller = new AbortController(), state = fixture("class C:\n def f(): return __class__\n", controller.signal);
    state.context.namespace = () => ({ lookup: () => undefined, store(name) { if (name === "__classcell__") controller.abort(); }, delete: () => false, isGuest: () => false });
    expect(() => executeRuntimeBuilderBody(state.fn, state.values.none, state.program, state.context, state.meter)).toThrow(ExecutionLimitError); expect(state.calls.depth).toBe(0);
  });
});
