import { describe, expect, it } from "vitest";
import { createRuntimeFunctionDefinitions } from "./runtime-function-definition.js";
import { executeFunctionDefinition } from "./function-definition.js";
import { invokeRuntimeFunction } from "./runtime-function-call.js";
import { beginRuntimeCall } from "./runtime-call.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { ExecutionBudget } from "./execution-budget.js";
import { compileProgram } from "./program-compilation.js";
import { analyzeModule } from "../analysis.js";
import { evaluateExpression } from "./expression-evaluation.js";
import { executeModule } from "./module-execution.js";
import { CallStack } from "./call-stack.js";
import { LexicalFrame } from "./lexical-frame.js";
import type { ModuleFrame } from "./module-frame.js";
import { runtimeHash } from "./runtime-hash.js";
import { runtimeComparison } from "./runtime-comparison.js";
import { createRuntimeExpressionContext } from "./runtime-expression-context.js";
import { createRuntimeStatementContext } from "./runtime-statement-context.js";
import { UnsupportedStatementError } from "./statement-execution.js";

function fixture(source: string) {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 }), v = new RuntimeValues(meter);
  const program = compileProgram<RuntimeValue>(analyzeModule(source), { stripDocstring: false }, v, meter);
  const globals = new Map<string, RuntimeValue>(), builtins = new Map<string, RuntimeValue>(), calls = new CallStack<object>(50, meter);
  const hash = { none: v.none, identity: () => 17n, string: () => 23n, bytes: () => 29n };
  const keys = { hash: (key: RuntimeValue) => runtimeHash(key, hash, meter), equal: (a: RuntimeValue, b: RuntimeValue) => runtimeComparison("==", a, b, v, meter).value };
  const unused = (): never => { throw new Error("unimplemented hook"); };
  const beginCall = (callee: RuntimeValue) => beginRuntimeCall(callee, {
    values: v, keys, callable: value => value.kind === "function", name: () => "function()",
    keywordName: key => { if (key.kind !== "str") return unused(); return String.fromCodePoint(...key.value); },
    invoke(value, positional, keywords) {
      if (value.kind !== "function") return unused();
      return invokeRuntimeFunction(value, positional, keywords, { values: v, keys, calls, body }, meter);
    }
  }, meter);
  function body(frame: LexicalFrame<RuntimeValue> | ModuleFrame<RuntimeValue>) {
    const definitions = createRuntimeFunctionDefinitions(program, {
      globals, builtins, evaluate: expression => evaluateExpression(expression, expressions, meter), beginCall,
      store: frame.store.bind(frame), capture: frame instanceof LexicalFrame ? frame.capture.bind(frame) : undefined
    }, v, meter);
    const expressions = createRuntimeExpressionContext(v, {
      load: frame.load.bind(frame), store: frame.store.bind(frame), attribute: unused, beginSet: unused,
      beginCall, dictionaryKeys: keys, warn: unused, createLambda: definitions.create.bind(definitions)
    }, meter);
    return createRuntimeStatementContext(expressions, {
      deleteName: frame.delete.bind(frame), setAttribute: unused, deleteAttribute: unused,
      executeUnhandled(statement) {
        if (statement.kind === "function") executeFunctionDefinition(statement, definitions, meter);
        else throw new UnsupportedStatementError(statement.kind);
      }
    }, v, meter);
  }
  return { v, globals, calls, run: () => executeModule(program.module, { globals, builtins, calls, body }, meter) };
}

describe("runtime function definition installation", () => {
  it("creates suspended function kinds without running their bodies", () => {
    const state = fixture("async def f():\n return missing\ndef g():\n yield missing\nasync def h():\n yield missing\n"); state.run();
    for (const [name, kind] of [["f", "coroutine"], ["g", "generator"], ["h", "async-generator"]]) {
      const value = state.globals.get(name); if (value?.kind !== "function") throw new Error("function expected");
      expect(value.value.code.kind).toBe(kind);
    }
    expect(state.calls.depth).toBe(0);
  });
  it("evaluates mutable defaults once per definition and ignores annotations", () => {
    const state = fixture("def f(x: missing() = [0]) -> unavailable():\n x[0] += 1\n return x[0]\na = f()\nb = f()\n"); state.run();
    expect(state.globals.get("a")).toEqual(state.v.integer(1)); expect(state.globals.get("b")).toEqual(state.v.integer(2)); expect(state.calls.depth).toBe(0);
  });
  it("evaluates decorators before defaults and applies them in reverse order", () => {
    const state = fixture("events = [0]\ndef mark(x):\n events[0] = events[0] * 10 + x\n return x\ndef deco(n):\n mark(n)\n def apply(fn):\n  mark(n + 3)\n  return fn\n return apply\n@deco(1)\n@deco(2)\ndef f(a=mark(3)):\n return a\nresult = f()\ntrace = events[0]\n"); state.run();
    expect(state.globals.get("trace")).toEqual(state.v.integer(12354)); expect(state.globals.get("result")).toEqual(state.v.integer(3));
  });
  it("captures live cells in lambdas while retaining definition-time defaults", () => {
    const state = fixture("def outer(x):\n f = lambda y=x: x + y\n x += 1\n return f\na = outer(10)\nb = outer(20)\nx = a()\ny = b()\n"); state.run();
    expect(state.globals.get("x")).toEqual(state.v.integer(21)); expect(state.globals.get("y")).toEqual(state.v.integer(41));
  });
  it("shares nonlocal cells after the defining frame has returned", () => {
    const state = fixture("def outer():\n n = 0\n def inc():\n  nonlocal n\n  n += 1\n  return n\n return inc\nf = outer()\na = f()\nb = f()\n"); state.run();
    expect(state.globals.get("a")).toEqual(state.v.integer(1)); expect(state.globals.get("b")).toEqual(state.v.integer(2));
  });
  it("stores arbitrary decorator results and leaves old bindings on failure", () => {
    const state = fixture("def replace(fn):\n return 7\n@replace\ndef f():\n pass\na = f\ndef fail(fn):\n return 1 / 0\n@fail\ndef f():\n pass\n");
    expect(state.run).toThrow("division by zero"); expect(state.globals.get("a")).toEqual(state.v.integer(7)); expect(state.globals.get("f")).toEqual(state.v.integer(7)); expect(state.calls.depth).toBe(0);
  });
  it("installs recursive functions before their first call", () => {
    const state = fixture("def f(n):\n if n == 0:\n  return 1\n return n * f(n - 1)\nresult = f(6)\n"); state.run();
    expect(state.globals.get("result")).toEqual(state.v.integer(720)); expect(state.calls.depth).toBe(0);
  });
});
