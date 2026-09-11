import { describe, expect, it } from "vitest";
import { createRuntimeStatementContext } from "./runtime-statement-context.js";
import { createRuntimeExpressionContext } from "./runtime-expression-context.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { CallStack } from "./call-stack.js";
import { compileProgram } from "./program-compilation.js";
import { executeModule } from "./module-execution.js";
import { createStatementContinuation, UnsupportedStatementError } from "./statement-execution.js";
import { parseModule } from "../module.js";
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
  return { v, meter, globals, calls, run: () => executeModule(code, context, meter),
    continuation(source: string) {
      const bound = context.body({
        load: name => globals.get(name)!, store: (name, value) => { globals.set(name, value); },
        delete: name => { globals.delete(name); }
      });
      return createStatementContinuation(parseModule(source).body, bound.suspend(), meter);
    }
  };
}

describe("native pattern control flow",()=>{
  it("matches nested sequences and produces fresh starred capture lists",()=>{
    const state=fixture("subject=[1,[2,3],4,5]\nmatch subject:\n case [1,[a,b],*middle,last]:result=(a,b,middle,last)\n case _:result=None\n");
    state.run();const value=state.globals.get("result");
    expect(value?.kind).toBe("tuple");if(value?.kind!=="tuple")throw Error("expected tuple");
    expect(value.items[0]).toEqual(state.v.integer(2));expect(value.items[1]).toEqual(state.v.integer(3));
    const middle=value.items[2];expect(middle.kind).toBe("list");if(middle.kind!=="list")throw Error("expected list");
    expect(middle.items.snapshot()).toEqual([state.v.integer(4)]);expect(value.items[3]).toEqual(state.v.integer(5));
  });
  it.each(["'ab'","b'ab'","{1:2}","1","[1]"])("rejects nonsequences or incorrect fixed lengths: %s",subject=>{
    const state=fixture("match "+subject+":\n case [a,b]:result=True\n case _:result=False\n");
    state.run();expect(state.globals.get("result")).toBe(state.v.false);
  });
  it("distinguishes singleton identity from value equality and binds before guards",()=>{
    const state=fixture("match 1:\n case True:result=0\n case (1|2) as x if x==2:result=1\n case y if x==1:result=y+2\n");
    state.run();expect(state.globals.get("result")).toEqual(state.v.integer(3));
    expect(state.globals.get("x")).toEqual(state.v.integer(1));expect(state.globals.get("y")).toEqual(state.v.integer(1));
  });
  it("evaluates the subject once and leaves unmatched case captures absent",()=>{
    const state=fixture("n=0\nmatch (n:=n+1):\n case 3 as missing:result=0\n case 1:result=n\n case _:result=99\n");
    state.run();expect(state.globals.get("result")).toEqual(state.v.integer(1));expect(state.globals.has("missing")).toBe(false);
  });
  it("retains a match subject and captures across suspended guards",()=>{
    const state=fixture(""),{v}=state;
    const cursor=state.continuation("match (yield 1):\n case 7 as x if (yield x):return 8\n case y:return y\n");
    expect(cursor.next()).toEqual({done:false,value:v.integer(1)});
    expect(cursor.next(v.integer(7))).toEqual({done:false,value:v.integer(7)});
    expect(state.globals.get("x")).toEqual(v.integer(7));
    expect(cursor.next(v.false)).toEqual({done:true,value:{kind:"return",value:v.integer(7)}});
    expect(state.globals.get("y")).toEqual(v.integer(7));
  });
});

describe("native suspended mutation operations", () => {
  it("keeps the evaluated RHS and unpacked starred list across a target yield", () => {
    const state = fixture(""), { v, globals } = state, obj = v.list([v.none]); globals.set("obj", obj);
    const cursor = state.continuation("a = (yield 1)\nfirst, *obj[(yield 2)], last = a\nreturn last");
    expect(cursor.next()).toEqual({ done: false, value: v.integer(1) });
    const rhs = v.list([v.integer(3), v.integer(4), v.integer(5), v.integer(6)]);
    expect(cursor.next(rhs)).toEqual({ done: false, value: v.integer(2) });
    expect(globals.get("first")).toEqual(v.integer(3)); expect(globals.has("last")).toBe(false);
    rhs.items.append(v.integer(99)); globals.set("a", v.none); globals.set("obj", v.list([]));
    expect(cursor.next(v.integer(0))).toEqual({ done: true, value: { kind: "return", value: v.integer(6) } });
    const middle = obj.items.get(0n); if (middle.kind !== "list") throw Error("expected starred list");
    expect(middle.items.snapshot()).toEqual([v.integer(4), v.integer(5)]);
  });

  it("retains the old augmented value and receiver across both target and RHS yields", () => {
    const state = fixture(""), { v, globals } = state, old = v.list([v.integer(1)]), obj = v.list([old]); globals.set("obj", obj);
    const cursor = state.continuation("obj[(yield 1)] += (yield 2)\nreturn 3");
    expect(cursor.next()).toEqual({ done: false, value: v.integer(1) });
    expect(cursor.next(v.integer(0))).toEqual({ done: false, value: v.integer(2) });
    obj.items.set(0n, v.none); globals.set("obj", v.list([]));
    expect(cursor.next(v.list([v.integer(4)]))).toEqual({ done: true, value: { kind: "return", value: v.integer(3) } });
    expect(obj.items.get(0n)).toBe(old); expect(old.items.snapshot()).toEqual([v.integer(1), v.integer(4)]);
  });

  it("preserves earlier deletes and the current receiver when a later target suspends", () => {
    const state = fixture(""), { v, globals } = state, obj = v.list([v.integer(1), v.integer(2)]);
    globals.set("obj", obj); globals.set("first", v.true); globals.set("last", v.false);
    const cursor = state.continuation("del first, obj[(yield 0)], last\nreturn 7");
    expect(cursor.next()).toEqual({ done: false, value: v.integer(0) });
    expect(globals.has("first")).toBe(false); expect(globals.has("last")).toBe(true);
    globals.set("obj", v.list([]));
    expect(cursor.next(v.integer(1))).toEqual({ done: true, value: { kind: "return", value: v.integer(7) } });
    expect(obj.items.snapshot()).toEqual([v.integer(1)]); expect(globals.has("last")).toBe(false);
  });

  it("ignores annotations while suspending valueless target expressions without reading them", () => {
    const state = fixture(""), { v, globals } = state, obj = v.list([]); globals.set("obj", obj);
    const cursor = state.continuation("obj[(yield 1)]: forbidden()\nx: forbidden() = (yield 2)\nreturn x");
    expect(cursor.next()).toEqual({ done: false, value: v.integer(1) });
    expect(cursor.next(v.integer(99))).toEqual({ done: false, value: v.integer(2) });
    expect(cursor.next(v.true)).toEqual({ done: true, value: { kind: "return", value: v.true } });
    expect(obj.items.length).toBe(0);
  });

  it("writes an augmented name back after the paused RHS replaces its binding", () => {
    const state = fixture(""), { v, globals } = state; globals.set("x", v.integer(3));
    const cursor = state.continuation("x *= (yield 1)\nreturn x");
    expect(cursor.next()).toEqual({ done: false, value: v.integer(1) }); globals.set("x", v.integer(99));
    expect(cursor.next(v.integer(4))).toEqual({ done: true, value: { kind: "return", value: v.integer(12) } });
    expect(globals.get("x")).toEqual(v.integer(12));
  });

  it("preserves in-place mutation when a paused RHS leaves an invalid write-back target", () => {
    const state = fixture(""), { v, globals } = state, old = v.list([v.integer(1)]), obj = v.list([old]); globals.set("obj", obj);
    const cursor = state.continuation("obj[0] += (yield 1)\nafter = 7");
    expect(cursor.next()).toEqual({ done: false, value: v.integer(1) }); obj.items.delete(0n);
    expect(() => cursor.next(v.list([v.integer(2)]))).toThrow("list assignment index out of range");
    expect(old.items.snapshot()).toEqual([v.integer(1), v.integer(2)]); expect(globals.has("after")).toBe(false);
  });

  it("does not undo earlier chained stores when a later target receives an exception", () => {
    const state = fixture(""), { v, globals } = state, obj = v.list([v.none]); globals.set("obj", obj);
    const cursor = state.continuation("first = obj[(yield 1)] = last = (yield 0)"), failure = Error("injected");
    expect(cursor.next()).toEqual({ done: false, value: v.integer(0) });
    expect(cursor.next(v.true)).toEqual({ done: false, value: v.integer(1) });
    expect(globals.get("first")).toBe(v.true); expect(() => cursor.throw(failure)).toThrow(failure);
    expect(globals.has("last")).toBe(false); expect(obj.items.get(0n)).toBe(v.none);
  });

  it("leaves previous deletes intact and later targets untouched after an injected error", () => {
    const state = fixture(""), { v, globals } = state, obj = v.list([v.true]);
    globals.set("obj", obj); globals.set("first", v.true); globals.set("last", v.false);
    const cursor = state.continuation("del first, obj[(yield 0)], last"), failure = Error("injected");
    expect(cursor.next()).toEqual({ done: false, value: v.integer(0) });
    expect(() => cursor.throw(failure)).toThrow(failure);
    expect(globals.has("first")).toBe(false); expect(globals.get("last")).toBe(v.false); expect(obj.items.get(0n)).toBe(v.true);
  });

  it("retains a previous target store when a later nested unpack fails after suspension", () => {
    const state = fixture(""), { v, globals } = state, obj = v.list([v.none]); globals.set("obj", obj);
    const cursor = state.continuation("obj[(yield 1)], (a, b) = [7, [8]]");
    expect(cursor.next()).toEqual({ done: false, value: v.integer(1) });
    expect(() => cursor.next(v.integer(0))).toThrow("not enough values to unpack");
    expect(obj.items.get(0n)).toEqual(v.integer(7)); expect(globals.has("a")).toBe(false); expect(globals.has("b")).toBe(false);
  });

  it("does not mutate targets when a suspended RHS resumes after a fatal limit", () => {
    const state = fixture(""), { v, globals, meter } = state;
    // Independent storage remains inspectable after the execution meter fails.
    const storage = new RuntimeValues(new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 }));
    const old = storage.list([v.true]); globals.set("x", old);
    const cursor = state.continuation("x += (yield 1)\nafter = 7");
    expect(cursor.next()).toEqual({ done: false, value: v.integer(1) });
    expect(() => meter.checkpoint(100000)).toThrow(ExecutionLimitError);
    expect(() => cursor.next(v.none)).toThrow(ExecutionLimitError);
    expect(old.items.snapshot()).toEqual([v.true]); expect(globals.has("after")).toBe(false);
  });

  it("uses resumable assignment for for-loop targets and leaves the final binding", () => {
    const state = fixture(""), { v, globals } = state, obj = v.list([v.none]); globals.set("obj", obj);
    const cursor = state.continuation("for obj[(yield 1)] in [3, 4]:\n yield obj[0]\nelse:\n return obj[0]");
    expect(cursor.next()).toEqual({ done: false, value: v.integer(1) });
    expect(cursor.next(v.integer(0))).toEqual({ done: false, value: v.integer(3) });
    expect(cursor.next(v.none)).toEqual({ done: false, value: v.integer(1) });
    expect(cursor.next(v.integer(0))).toEqual({ done: false, value: v.integer(4) });
    expect(cursor.next(v.none)).toEqual({ done: true, value: { kind: "return", value: v.integer(4) } });
  });

  it.each(["import pending", "def pending():\n pass", "class Pending:\n pass", "raise pending"])("keeps missing resumable leaf adapters explicit: %s", source => {
    const state = fixture(""), cursor = state.continuation(source);
    expect(() => cursor.next()).toThrow(UnsupportedStatementError);
    expect(state.globals.size).toBe(0);
  });
});

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
