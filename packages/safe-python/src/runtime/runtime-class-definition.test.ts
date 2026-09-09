import { describe, expect, it } from "vitest";
import { analyzeModule } from "../analysis.js";
import { compileProgram } from "./program-compilation.js";
import { executeRuntimeProgram, type RuntimeProgramHooks } from "./runtime-program.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { ExecutionBudget } from "./execution-budget.js";
import { CallStack } from "./call-stack.js";
import { runtimeHash } from "./runtime-hash.js";
import { runtimeComparison } from "./runtime-comparison.js";

function fixture(source: string) {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 2000000 }), values = new RuntimeValues(meter);
  const globals = new Map<string, RuntimeValue>([["__name__", values.string("example")]]), builtins = new Map<string, RuntimeValue>(), calls = new CallStack<object>(50, meter);
  const hash = { none: values.none, identity: () => 17n, string: () => 23n, bytes: () => 29n };
  const keys = { hash: (k: RuntimeValue) => runtimeHash(k, hash, meter), equal: (a: RuntimeValue, b: RuntimeValue) => runtimeComparison("==", a, b, values, meter).value };
  const unused = (): never => { throw new Error("unexpected hook"); };
  const hooks: RuntimeProgramHooks = { expressions: () => ({ attribute: unused, beginSet: unused, warn: unused }), statements: () => ({ setAttribute: unused, deleteAttribute: unused, executeUnhandled: unused }), callable: () => false, invoke: unused, name: () => "function()", keywordName: key => key.kind === "str" ? String.fromCodePoint(...key.value) : unused() };
  const seen: RuntimeValue[][] = [];
  builtins.set("__build_class__", values.builtinFunction({ name: "capture", invoke(positional) { seen.push([...positional]); return positional[0]; } }));
  const program = compileProgram<RuntimeValue>(analyzeModule(source), { stripDocstring: false }, values, meter);
  const context = { globals, builtins, calls, keys, values, hooks };
  return { ...context, meter, seen, run: () => executeRuntimeProgram(program, context, meter) };
}

describe("runtime class statements and body functions", () => {
  it("passes a real unexecuted function and the class name to the builtin builder", () => {
    const state = fixture('class C:\n "class doc"\n x = 3\n'); state.run();
    const fn = state.globals.get("C"); expect(fn?.kind).toBe("function"); if (fn?.kind !== "function") throw new Error("expected function");
    expect(fn.value.name).toEqual(state.values.string("C")); expect(fn.value.doc).toBe(state.values.none);
    expect(state.seen[0][0]).toBe(fn); expect(state.seen[0][1]).toEqual(state.values.string("C")); expect(state.globals.has("x")).toBe(false);
  });
  it("ordinary calls execute class-body code in defining globals and return its published cell", () => {
    const state = fixture("class C:\n x = 3\n def f(): return __class__\nresult = C()\n"); state.run();
    const cell = state.globals.get("result"); expect(cell?.kind).toBe("cell");
    expect(cell).toBe(state.globals.get("__classcell__")); expect(state.globals.get("x")).toEqual(state.values.integer(3));
    expect(state.calls.depth).toBe(0);
  });
  it("returns None from a class body without an owned construction cell", () => {
    const state = fixture("class C:\n x = 3\nresult = C()\n"); state.run(); expect(state.globals.get("result")).toBe(state.values.none);
  });
  it.each([["C(1)", "C() takes 0 positional arguments but 1 was given"], ["C(x=1)", "C() got an unexpected keyword argument 'x'"]])("binds zero parameters before running %s", (call, message) => {
    const state = fixture(`class C:\n x = 3\n${call}\n`); expect(state.run).toThrow(message); expect(state.globals.has("x")).toBe(false); expect(state.calls.depth).toBe(0);
  });
  it("looks up the builder in builtins instead of globals and reports an absent builder", () => {
    const state = fixture("class C: pass\n"); state.globals.set("__build_class__", state.values.none); state.run(); expect(state.seen).toHaveLength(1);
    const missing = fixture("class C: pass\n"); missing.builtins.delete("__build_class__"); expect(missing.run).toThrow(expect.objectContaining({ name: "NameError", message: "__build_class__ not found" }));
  });
  it("captures enclosing cells and creates class-local nested definitions on direct invocation", () => {
    const state = fixture("def outer(x):\n class C:\n  y = x\n  def f(): return x\n return C\nC = outer(7)\nC()\nresult = f()\n"); state.run(); expect(state.globals.get("result")).toEqual(state.values.integer(7));
  });
  it("preserves decorator/header/builder ordering without prematurely executing the suite", () => {
    const state = fixture("trace = [0]\ndef mark(n):\n trace[0] = trace[0] * 10 + n\n return n\ndef deco(n):\n mark(n)\n def apply(value):\n  mark(5)\n  return value\n return apply\n@deco(1)\nclass C(mark(2), flag=mark(3)):\n mark(9)\n");
    state.builtins.set("__build_class__", state.values.builtinFunction({ name: "capture", invoke(positional, keywords) {
      expect(positional[2]).toEqual(state.values.integer(2)); expect(keywords.items.lookup(state.values.string("flag"))?.value).toEqual(state.values.integer(3));
      const trace = state.globals.get("trace"); if (trace?.kind !== "list") throw new Error("expected trace");
      const n = trace.items.get(0n); if (n.kind !== "int") throw new Error("expected int");
      trace.items.set(0n, state.values.integer(n.value * 10n + 4n)); return positional[0];
    } }));
    state.run(); const trace = state.globals.get("trace"); expect(trace?.kind === "list" && trace.items.get(0n)).toEqual(state.values.integer(12345));
  });
  it("retains nested class and function registries when a captured body crosses programs", () => {
    const state = fixture("class Outer:\n class Inner:\n  def f(): return 7\n"); state.run();
    const globals = new Map<string, RuntimeValue>([["body", state.globals.get("Outer")!]]);
    const caller = compileProgram<RuntimeValue>(analyzeModule("body()\n"), { stripDocstring: false }, state.values, state.meter);
    executeRuntimeProgram(caller, { ...state, globals }, state.meter);
    expect(state.globals.get("Inner")?.kind).toBe("function"); expect(globals.has("Inner")).toBe(false);
    const second = compileProgram<RuntimeValue>(analyzeModule("Inner()\nresult = f()\n"), { stripDocstring: false }, state.values, state.meter);
    executeRuntimeProgram(second, state, state.meter); expect(state.globals.get("result")).toEqual(state.values.integer(7));
  });
});
