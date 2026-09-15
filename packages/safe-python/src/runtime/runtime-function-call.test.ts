import { describe, expect, it } from "vitest";
import { invokeRuntimeFunction } from "./runtime-function-call.js";
import { beginRuntimeCall } from "./runtime-call.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { ExecutionBudget } from "./execution-budget.js";
import { createFunctionState } from "./function-state.js";
import { compileProgram } from "./program-compilation.js";
import { analyzeModule } from "../analysis.js";
import { parseExpression } from "../expression.js";
import { evaluateExpression } from "./expression-evaluation.js";
import { CallStack } from "./call-stack.js";
import { runtimeHash } from "./runtime-hash.js";
import { runtimeComparison } from "./runtime-comparison.js";
import { createRuntimeExpressionContext } from "./runtime-expression-context.js";
import { createRuntimeStatementContext } from "./runtime-statement-context.js";
import type { LexicalFrame } from "./lexical-frame.js";

function fixture(source: string) {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 }), v = new RuntimeValues(meter);
  const program = compileProgram<RuntimeValue>(analyzeModule(source), { stripDocstring: false }, v, meter), code = program.functions.values().next().value!;
  const globals = new Map<string, RuntimeValue>(), builtins = new Map<string, RuntimeValue>(), calls = new CallStack<object>(50, meter);
  const hash = { none: v.none, identity: () => 17n, string: () => 23n, bytes: () => 29n };
  const keys = { hash: (key: RuntimeValue) => runtimeHash(key, hash, meter), equal: (a: RuntimeValue, b: RuntimeValue) => runtimeComparison("==", a, b, v, meter).value };
  const unused = (): never => { throw new Error("unimplemented hook"); };
  const expressions = (frame: { load(name: string): RuntimeValue; store(name: string, value: RuntimeValue): void }) => createRuntimeExpressionContext(v, {
    load: frame.load.bind(frame), store: frame.store.bind(frame), attribute: unused, beginSet: unused, dictionaryKeys: keys, warn: unused,
    beginCall: callee => beginRuntimeCall(callee, {
      values: v, keys, callable: value => value.kind === "function", name: () => "__main__.f()",
      keywordName: key => { if (key.kind !== "str") return unused(); return String.fromCodePoint(...key.value); },
      invoke(value, positional, keywords) {
        if (value.kind !== "function") return unused();
        return invokeRuntimeFunction(value, positional, keywords, { values: v, keys, calls, body }, meter);
      }
    }, meter)
  }, meter);
  function body(frame: LexicalFrame<RuntimeValue>) {
    return createRuntimeStatementContext(expressions(frame), { deleteName: frame.delete.bind(frame), setAttribute: unused, deleteAttribute: unused, executeUnhandled: unused }, v, meter);
  }
  const fn = v.function(createFunctionState(code, new Map([["b", v.integer(2)], ["c", v.integer(3)]]), { globals, builtins, none: v.none }, meter));
  globals.set("f", fn);
  const root = expressions({ load(name) { const value = globals.get(name); if (value === undefined) throw new Error(`missing:${name}`); return value; }, store(name, value) { globals.set(name, value); } });
  return { v, calls, globals, run: (source: string) => evaluateExpression(parseExpression(source), root, meter) };
}

describe("concrete runtime function calls", () => {
  it("creates positional storage for function-bound keyword dictionaries", () => {
    const { run, v } = fixture("def f(**kw):\n return kw\n");
    const result = run("f(a=1, b=2)");
    if (result.kind !== "dict") throw Error("expected dict");
    expect(result.items.nextDictionaryEntry(1)).toEqual({ position: 2, key: v.string("b"), value: v.integer(2) });
  });
  it("binds all argument kinds and produces concrete variadic containers", () => {
    const { run, v, calls } = fixture("def f(a, /, b=2, *rest, c=3, **kw):\n return a, b, rest, c, kw\n");
    const result = run("f(1, *[4, 5], c=6, **{'a': 7, 'x': 8})");
    if (result.kind !== "tuple") throw new Error("tuple expected");
    expect(result.items.slice(0, 4)).toEqual([v.integer(1), v.integer(4), v.tuple([v.integer(5)]), v.integer(6)]);
    const kw = result.items[4]; if (kw.kind !== "dict") throw new Error("dictionary expected");
    expect(kw.items.snapshot()).toEqual([[v.string("a"), v.integer(7)], [v.string("x"), v.integer(8)]]); expect(calls.depth).toBe(0);
  });
  it("preserves distinct surrogate keys without matching an astral parameter", () => {
    const { run, v } = fixture("def f(𐀀, **kw):\n return 𐀀, kw\n");
    const result = run("f(**{'\\ud800\\udc00': 1, '\\U00010000': 2})");
    if (result.kind !== "tuple" || result.items[1].kind !== "dict") throw new Error("tuple/dict expected");
    expect(result.items[0]).toEqual(v.integer(2)); const entries = result.items[1].items.snapshot(); expect(entries).toHaveLength(1);
    const key = entries[0][0]; if (key.kind !== "str") throw new Error("string expected"); expect([...key.value]).toEqual([0xd800, 0xdc00]);
  });
  it("uses defaults and live globals and allocates fresh kwargs", () => {
    const { run, v, globals } = fixture("def f(a, b=2, **kw):\n return a + b + offset, kw\n"); globals.set("offset", v.integer(10));
    const first = run("f(1)"); globals.set("offset", v.integer(20)); const second = run("f(1)");
    if (first.kind !== "tuple" || second.kind !== "tuple") throw new Error("tuple expected");
    expect(first.items[0]).toEqual(v.integer(13)); expect(second.items[0]).toEqual(v.integer(23)); expect(first.items[1]).not.toBe(second.items[1]);
  });
  it("reports binding failures without leaving active frames", () => {
    const { run, calls } = fixture("def f(a):\n return a\n");
    expect(() => run("f(1, a=2)")).toThrow("f() got multiple values for argument 'a'");
    expect(() => run("f()")).toThrow("f() missing 1 required positional argument: 'a'"); expect(calls.depth).toBe(0);
  });
  it("executes recursive calls with shared depth accounting", () => {
    const { run, v, calls } = fixture("def f(n):\n if n == 0:\n  return 1\n return n * f(n - 1)\n");
    expect(run("f(6)")).toEqual(v.integer(720)); expect(calls.depth).toBe(0);
    expect(() => run("f(60)")).toThrow("maximum recursion depth exceeded"); expect(calls.depth).toBe(0);
  });
});
