import { describe, expect, it } from "vitest";
import { analyzeModule } from "../analysis.js";
import { compileProgram } from "./program-compilation.js";
import { executeRuntimeClassBody } from "./runtime-class-body.js";
import { createRuntimeFrameBody, type RuntimeProgramHooks } from "./runtime-program.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { ExecutionBudget } from "./execution-budget.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { runtimeHash } from "./runtime-hash.js";
import { runtimeComparison } from "./runtime-comparison.js";
import { CallStack } from "./call-stack.js";
import { invokeRuntimeFunction } from "./runtime-function-call.js";
import { mutateRuntimeCell } from "./runtime-cell.js";
import { UnsupportedStatementError } from "./statement-execution.js";
import type { LexicalCell } from "./lexical-frame.js";

function fixture(source: string) {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 }), values = new RuntimeValues(meter);
  const program = compileProgram<RuntimeValue>(analyzeModule(source), { stripDocstring: false }, values, meter);
  const statement = program.classes.keys().next().value!;
  const hash = { none: values.none, identity: () => 17n, string: () => 23n, bytes: () => 29n };
  const keys = { hash: (k: RuntimeValue) => runtimeHash(k, hash, meter), equal: (a: RuntimeValue, b: RuntimeValue) => runtimeComparison("==", a, b, values, meter).value };
  const dictionary = () => values.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter));
  const globals = new Map<string, RuntimeValue>([["__name__", values.string("example")], ["x", values.integer(99)]]), builtins = new Map<string, RuntimeValue>(), calls = new CallStack<object>(50, meter);
  const unused = (): never => { throw new Error("unexpected hook"); };
  const hooks: RuntimeProgramHooks = {
    expressions: () => ({ attribute: unused, beginSet: unused, warn: unused }),
    statements: () => ({ setAttribute: unused, deleteAttribute: unused, executeUnhandled: node => { throw new UnsupportedStatementError(node.kind); } }),
    callable: () => false, invoke: unused, name: () => "function()", keywordName: unused
  };
  const namespace = dictionary(), context = { values, keys, globals, builtins, calls, hooks, namespace };
  const get = (name: string) => namespace.items.lookup(values.string(name))?.value;
  const invoke = (name: string) => {
    const fn = get(name); if (fn?.kind !== "function") throw new Error("expected method");
    const body = createRuntimeFrameBody(program, context, meter);
    return invokeRuntimeFunction(fn, [], dictionary(), { values, keys, calls, body: frame => body(frame, fn.value) }, meter);
  };
  return { values, meter, program, statement, context, get, invoke, run: () => executeRuntimeClassBody(program, statement, context, meter) };
}

describe("assembled runtime class suites", () => {
  it("executes ordinary statements and method defaults in the prepared dictionary", () => {
    const state = fixture('class C:\n "doc"\n x = 3\n y = [x, x + 1]\n def f(a=x):\n  return a, x\n');
    expect(state.run()).toBeUndefined();
    expect(state.get("__module__")).toEqual(state.values.string("example"));
    expect(state.get("__qualname__")).toEqual(state.values.string("C")); expect(state.get("__doc__")).toEqual(state.values.string("doc"));
    expect(state.get("x")).toEqual(state.values.integer(3));
    expect(state.invoke("f")).toEqual(state.values.tuple([state.values.integer(3), state.values.integer(99)]));
    expect(state.context.calls.depth).toBe(0);
  });
  it("publishes a guest class cell shared with method and lambda captures", () => {
    const state = fixture("class C:\n def f(): return __class__\n g = lambda: __class__\n");
    const internal = state.run(), cell = state.get("__classcell__");
    expect(cell?.kind).toBe("cell"); if (cell?.kind !== "cell") throw new Error("expected cell");
    expect(cell.value).toBe(internal);
    mutateRuntimeCell(cell, { kind: "set", value: state.values.integer(42) }, state.meter);
    expect(state.invoke("f")).toEqual(state.values.integer(42)); expect(state.invoke("g")).toEqual(state.values.integer(42));
  });
  it("creates fresh construction cells on repeated class-suite execution", () => {
    const state = fixture("class C:\n def f(): return __class__\n"), first = state.run(), oldMethod = state.get("f");
    const second = state.run(); expect(first).not.toBe(second);
    expect(oldMethod?.kind === "function" && oldMethod.value.closure.get("__class__")).toBe(first);
    const cell = state.get("__classcell__"); expect(cell?.kind === "cell" && cell.value).toBe(second);
  });
  it("forwards enclosing cells to methods without substituting class locals", () => {
    const state = fixture("def outer():\n token = 8\n class C:\n  y = token\n  def f(): return token\n");
    const scope = state.program.classes.get(state.statement)!.scope;
    const cell: LexicalCell<RuntimeValue> = { owner: scope.free.get("token")!, content: { value: state.values.integer(8) } };
    executeRuntimeClassBody(state.program, state.statement, { ...state.context, closure: new Map([["token", cell]]) }, state.meter);
    expect(state.get("y")).toEqual(state.values.integer(8));
    cell.content = { value: state.values.integer(9) }; expect(state.invoke("f")).toEqual(state.values.integer(9));
  });
  it("runs class-local decorators and nested function definitions through shared call machinery", () => {
    const state = fixture("class C:\n def deco(fn):\n  def wrapped(): return fn() + 2\n  return wrapped\n @deco\n def f(): return 3\n");
    state.run(); expect(state.invoke("f")).toEqual(state.values.integer(5));
  });
  it("rejects unmatched compiled class identity before namespace writes", () => {
    const state = fixture("class C: pass\n"), other = fixture("class C: pass\n");
    expect(() => executeRuntimeClassBody(state.program, other.statement, state.context, state.meter)).toThrow("class definition has no matching compiled code");
    expect(state.context.namespace.items.size).toBe(0); expect(state.context.calls.depth).toBe(0);
  });
  it("ignores annotations while retaining annotated assignment values", () => {
    const state = fixture("class C:\n x: missing() = 2\n y: missing()\n def f(a: missing()) -> missing():\n  return a\n");
    state.run(); expect(state.get("x")).toEqual(state.values.integer(2)); expect(state.get("y")).toBeUndefined();
    expect(state.get("__annotations__")).toBeUndefined();
  });
  it("preserves earlier writes and restores the call stack after a suite error", () => {
    const state = fixture("class C:\n x = 3\n y = 1 / 0\n def f(): return __class__\n");
    expect(state.run).toThrow(expect.objectContaining({ name: "ZeroDivisionError" }));
    expect(state.get("x")).toEqual(state.values.integer(3)); expect(state.get("__classcell__")).toBeUndefined();
    expect(state.context.calls.depth).toBe(0);
  });
});
