import { describe, expect, it } from "vitest";
import { createRuntimeStatementContext } from "./runtime-statement-context.js";
import { createRuntimeExpressionContext } from "./runtime-expression-context.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { CallStack } from "./call-stack.js";
import { compileProgram } from "./program-compilation.js";
import { executeModule } from "./module-execution.js";
import { UnsupportedStatementError } from "./statement-execution.js";
import { analyzeModule } from "../analysis.js";
import { runtimeHash } from "./runtime-hash.js";
import { runtimeComparison } from "./runtime-comparison.js";

function fixture(source: string, maxSteps = 100000) {
  const meter = new ExecutionBudget({ maxSteps, maxAllocatedBytes: 1000000 }), v = new RuntimeValues(meter);
  const code = compileProgram<RuntimeValue>(analyzeModule(source), { stripDocstring: false }, v, meter).module;
  const globals = new Map<string, RuntimeValue>(), calls = new CallStack<object>(100, meter);
  const hash = { none: v.none, identity: () => 17n, string: () => 23n, bytes: () => 29n };
  const dictionaryKeys = { hash: (key: RuntimeValue) => runtimeHash(key, hash, meter), equal: (a: RuntimeValue, b: RuntimeValue) => runtimeComparison("==", a, b, v, meter).value };
  const unused = (): never => { throw new Error("unimplemented object hook"); };
  const context = {
    globals, builtins: new Map<string, RuntimeValue>(), calls,
    body(frame: { load(name: string): RuntimeValue; store(name: string, value: RuntimeValue): void; delete(name: string): void }) {
      const expressions = createRuntimeExpressionContext(v, {
        load: frame.load.bind(frame), store: frame.store.bind(frame), attribute: unused,
        beginCall: unused, beginSet: unused, dictionaryKeys, warn: unused
      }, meter);
      return createRuntimeStatementContext(expressions, {
        deleteName: frame.delete.bind(frame), setAttribute: unused, deleteAttribute: unused,
        executeUnhandled(statement) { throw new UnsupportedStatementError(statement.kind); }
      }, v, meter);
    }
  };
  return { v, meter, globals, calls, run: () => executeModule(code, context, meter) };
}

describe("concrete runtime statement context", () => {
  it("executes dictionary assignment, augmented mutation, reads and deletion", () => {
    const state = fixture("d = {1: [2]}\nalias = d[True]\nd[1.0] += [3]\nd = {**d, 'next': d[1]}\ndel d[1]\nresult = d['next']\nmissing = d[1]\n");
    const { v } = state;
    expect(state.run).toThrow(expect.objectContaining({ name: "KeyError", args: [v.integer(1)] }));
    const result = state.globals.get("result"); if (result?.kind !== "list") throw new Error("list expected");
    const dict = state.globals.get("d"); if (dict?.kind !== "dict") throw new Error("dictionary expected");
    expect(result.items.snapshot()).toEqual([v.integer(2), v.integer(3)]); expect(result).toBe(state.globals.get("alias"));
    expect(dict.items.size).toBe(1); expect(state.globals.has("missing")).toBe(false); expect(state.calls.depth).toBe(0);
  });
  it("executes compiled modules with shared list aliases and item mutation", () => {
    const state = fixture('"module doc"\na = [1]\nalias = a\nfor x in [2, 3]:\n a += [x]\na[0] = 9\ndel a[1]\n');
    state.run(); const list = state.globals.get("a");
    expect(list?.kind).toBe("list"); if (list?.kind !== "list") throw new Error("list expected");
    expect(state.globals.get("alias")).toBe(list); expect(list.items.snapshot()).toEqual([state.v.integer(9), state.v.integer(3)]);
    expect(state.globals.get("__doc__")).toEqual(state.v.string("module doc")); expect(state.calls.depth).toBe(0);
  });
  it("connects if, while, for, break, continue and loop else control flow", () => {
    const state = fixture("total = 0\nfor x in [1, 2, 3]:\n if x == 2:\n  continue\n total += x\nelse:\n total += 10\nn = 0\nwhile n < 3:\n n += 1\n if n == 2:\n  break\nelse:\n total = 0\n");
    state.run(); expect(state.globals.get("total")).toEqual(state.v.integer(14)); expect(state.globals.get("n")).toEqual(state.v.integer(2));
  });
  it("supports starred unpacking and ignores annotation expressions", () => {
    const state = fixture("first, *middle, last = [1, 2, 3, 4]\nx: forbidden() = first + last\nghost: forbidden()\n");
    state.run(); expect(state.globals.get("x")).toEqual(state.v.integer(5)); expect(state.globals.has("ghost")).toBe(false);
    const middle = state.globals.get("middle"); if (middle?.kind !== "list") throw new Error("list expected");
    expect(middle.items.snapshot()).toEqual([state.v.integer(2), state.v.integer(3)]);
  });
  it("resolves targets in assignment order after evaluating and unpacking the RHS", () => {
    const state = fixture("i = 0\na = [0, 1]\ni, a[i] = 1, 2\n"); state.run();
    const list = state.globals.get("a"); if (list?.kind !== "list") throw new Error("list expected");
    expect(list.items.snapshot()).toEqual([state.v.integer(0), state.v.integer(2)]);
  });
  it("unpacks for targets and applies slice assignment/deletion", () => {
    const state = fixture("a = []\nfor x, y in [(1, 2), (3, 4)]:\n a += [x + y]\na[:] = [5, 6, 7]\ndel a[::2]\n"); state.run();
    const list = state.globals.get("a"); if (list?.kind !== "list") throw new Error("list expected");
    expect(list.items.snapshot()).toEqual([state.v.integer(6)]);
  });
  it("preserves earlier mutations and restores module frames after errors", () => {
    const state = fixture("a = [1]\na[0] = 2\nmissing\n");
    expect(state.run).toThrow("name 'missing' is not defined"); expect(state.calls.depth).toBe(0);
    const list = state.globals.get("a"); if (list?.kind !== "list") throw new Error("list expected");
    expect(list.items.get(0n)).toEqual(state.v.integer(2));
  });
  it("reports non-iterable unpacking errors without storing any targets", () => {
    const state = fixture("a, b = 1\n");
    expect(state.run).toThrow("cannot unpack non-iterable int object"); expect(state.globals.has("a")).toBe(false); expect(state.globals.has("b")).toBe(false);
  });
  it("keeps unimplemented leaf statements explicit", () => {
    const state = fixture("import unavailable\n"); expect(state.run).toThrow(UnsupportedStatementError); expect(state.calls.depth).toBe(0);
  });
  it("terminates unbounded module loops with the shared fatal budget", () => {
    const state = fixture("while True:\n pass\n", 1000);
    expect(state.run).toThrow(ExecutionLimitError); expect(state.calls.depth).toBe(0);
  });
});
