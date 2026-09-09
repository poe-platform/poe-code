import { describe, expect, it } from "vitest";
import { executeRuntimeProgram, type RuntimeProgramHooks } from "./runtime-program.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { compileProgram } from "./program-compilation.js";
import { analyzeModule } from "../analysis.js";
import { CallStack } from "./call-stack.js";
import { runtimeHash } from "./runtime-hash.js";
import { runtimeComparison } from "./runtime-comparison.js";
import { UnsupportedStatementError } from "./statement-execution.js";
import { ModuleFrame, type LocalNamespace } from "./module-frame.js";
import { createLenBuiltin } from "./builtin-len.js";

function fixture(source: string, maxSteps = 100000, signal?: AbortSignal) {
  const meter = new ExecutionBudget({ maxSteps, maxAllocatedBytes: 1000000, signal }), values = new RuntimeValues(meter);
  const program = compileProgram<RuntimeValue>(analyzeModule(source), { stripDocstring: false }, values, meter);
  const globals = new Map<string, RuntimeValue>(), builtins = new Map<string, RuntimeValue>(), calls = new CallStack<object>(50, meter);
  const hash = { none: values.none, identity: () => 17n, string: () => 23n, bytes: () => 29n };
  const keys = { hash: (key: RuntimeValue) => runtimeHash(key, hash, meter), equal: (a: RuntimeValue, b: RuntimeValue) => runtimeComparison("==", a, b, values, meter).value };
  const unused = (): never => { throw new Error("unimplemented object hook"); };
  const hooks: RuntimeProgramHooks = {
    expressions: () => ({ attribute: unused, beginSet: unused, warn: unused }),
    statements: () => ({ setAttribute: unused, deleteAttribute: unused, executeUnhandled: statement => { throw new UnsupportedStatementError(statement.kind); } }),
    callable: () => false, invoke: unused, name: () => "function()",
    keywordName: key => { if (key.kind !== "str") return unused(); return String.fromCodePoint(...key.value); }
  };
  return { values, meter, globals, builtins, calls, hooks, run: (locals?: LocalNamespace<RuntimeValue>) => executeRuntimeProgram(program, { globals, builtins, locals, calls, values, keys, hooks }, meter) };
}

describe("assembled concrete runtime programs", () => {
  it("does not publish a builtin result after its capability cancels execution", () => {
    const controller = new AbortController(), state = fixture("result = native()\nafter = 1\n", 100000, controller.signal);
    state.builtins.set("native", state.values.builtinFunction({ name: "native", invoke() { controller.abort(); return state.values.true; } }));
    expect(state.run).toThrow(ExecutionLimitError); expect(state.globals.has("result")).toBe(false); expect(state.globals.has("after")).toBe(false); expect(state.calls.depth).toBe(0);
  });
  it("stops between error-formatting callbacks after cancellation", () => {
    const controller = new AbortController(), state = fixture("def f():\n pass\nf(**{'x': 1}, **{'x': 2})\n", 100000, controller.signal);
    let formatted = false;
    state.hooks.name = () => { controller.abort(); return "f()"; };
    state.hooks.keywordName = () => { formatted = true; return "x"; };
    expect(state.run).toThrow(ExecutionLimitError); expect(formatted).toBe(false); expect(state.calls.depth).toBe(0);
  });
  it("runs registered len calls inside guest functions and formats expansion errors", () => {
    const state = fixture("def f(x):\n return len(x)\nresult = f({'a': 1, 'b': 2})\nlen(*1)\n");
    state.builtins.set("len", createLenBuiltin(state.values, state.meter));
    expect(state.run).toThrow("len() argument after * must be an iterable, not int");
    expect(state.globals.get("result")).toEqual(state.values.integer(2)); expect(state.calls.depth).toBe(0);
  });
  it("invokes explicitly registered builtins with their retained method owner", () => {
    const state = fixture("result = native(3, x=4)\n");
    const capability = { name: "native", result: state.values.integer(7), invoke(positional: readonly RuntimeValue[]) { expect(positional).toEqual([state.values.integer(3)]); return this.result; } };
    state.builtins.set("native", state.values.builtinFunction(capability));
    state.run(); expect(state.globals.get("result")).toBe(capability.result); expect(state.calls.depth).toBe(0);
  });
  it("keeps separate module locals out of function global lookup", () => {
    const state = fixture("x = 2\ndef f():\n return x\nresult = f()\n"), locals = new Map<string, RuntimeValue>();
    state.globals.set("x", state.values.integer(1));
    state.run({ lookup: name => locals.has(name) ? { value: locals.get(name)! } : undefined, store: (name, value) => { locals.set(name, value); }, delete: name => locals.delete(name), isGuest: () => false });
    expect(locals.get("x")).toEqual(state.values.integer(2)); expect(locals.get("result")).toEqual(state.values.integer(1));
    expect(state.globals.has("f")).toBe(false); expect(state.globals.get("x")).toEqual(state.values.integer(1));
  });
  it("runs modules, nested definitions, lambdas and dictionary kwargs together", () => {
    const state = fixture("def outer(x):\n def f(a=1, **kw):\n  return x + a + kw['b']\n return lambda y: f(y, **{'b': 3})\nf = outer(10)\nresult = f(2)\n"); state.run();
    expect(state.globals.get("result")).toEqual(state.values.integer(15)); expect(state.calls.depth).toBe(0);
  });
  it("uses each function's captured builtins when defining nested functions", () => {
    const state = fixture("__builtins__ = {'token': 1}\ndef outer():\n def inner():\n  return token\n return inner\n__builtins__ = {'token': 2}\ndel __builtins__\nf = outer()\nresult = f()\n");
    state.builtins.set("token", state.values.integer(3));
    state.hooks.resolveBuiltins = value => {
      if (value.kind !== "dict") throw new Error("dictionary expected");
      return { lookup: name => value.items.lookup(state.values.string(name)) };
    };
    state.run(); expect(state.globals.get("result")).toEqual(state.values.integer(1));
  });
  it("preserves hook method owners while supplying the active frame", () => {
    const state = fixture("sink.value = 3\nresult = sink.value\n"), frames: string[] = [];
    state.globals.set("sink", state.values.none);
    const object = { value: state.values.integer(0) as RuntimeValue };
    state.hooks.expressions = frame => {
      frames.push(frame instanceof ModuleFrame ? "module" : frame.scope.scope.kind);
      return { object, attribute() { return this.object.value; }, beginSet() { throw new Error("unused"); }, warn() { throw new Error("unused"); } };
    };
    state.hooks.statements = () => ({ object, setAttribute(_receiver, _name, value) { this.object.value = value; }, deleteAttribute() { throw new Error("unused"); }, executeUnhandled() { throw new Error("unused"); } });
    state.run(); expect(state.globals.get("result")).toEqual(state.values.integer(3)); expect(frames).toEqual(["module"]);
  });
  it("delegates non-function call capabilities without implicit host calls", () => {
    const state = fixture("result = native(3)\n"); state.globals.set("native", state.values.true);
    state.hooks.callable = value => value === state.values.true;
    state.hooks.invoke = (callee, positional, keywords, frame) => {
      expect(callee).toBe(state.values.true); expect(keywords.items.size).toBe(0); expect(frame).toBeInstanceOf(ModuleFrame);
      return positional[0];
    };
    state.run(); expect(state.globals.get("result")).toEqual(state.values.integer(3));
  });
  it("keeps unsupported leaves explicit and restores frames on failure", () => {
    const state = fixture("x = 1\ndef f():\n import unavailable\nf()\n");
    expect(state.run).toThrow(UnsupportedStatementError); expect(state.globals.get("x")).toEqual(state.values.integer(1)); expect(state.calls.depth).toBe(0);
  });
  it("shares fatal budgets across execution and stops after hook cancellation", () => {
    const loop = fixture("while True:\n pass\n", 1000); expect(loop.run).toThrow(ExecutionLimitError); expect(loop.calls.depth).toBe(0);
    const controller = new AbortController(), state = fixture("result = 1\n", 100000, controller.signal);
    let statements = false;
    state.hooks.expressions = () => { controller.abort(); return { attribute() { throw new Error("unused"); }, beginSet() { throw new Error("unused"); }, warn() { throw new Error("unused"); } }; };
    state.hooks.statements = () => { statements = true; throw new Error("must not run"); };
    expect(state.run).toThrow(ExecutionLimitError); expect(statements).toBe(false); expect(state.calls.depth).toBe(0);
  });
});
