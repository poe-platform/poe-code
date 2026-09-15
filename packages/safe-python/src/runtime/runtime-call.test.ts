import { describe, expect, it } from "vitest";
import { beginRuntimeCall } from "./runtime-call.js";
import { RuntimeValues, type RuntimeValue, type DictionaryValue } from "./runtime-values.js";
import { runtimeHash } from "./runtime-hash.js";
import { runtimeComparison } from "./runtime-comparison.js";
import { createRuntimeExpressionContext } from "./runtime-expression-context.js";
import { evaluateExpression } from "./expression-evaluation.js";
import { parseExpression } from "../expression.js";
import { ExecutionBudget } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 }), v = new RuntimeValues(meter);
  const hash = { none: v.none, identity: () => 17n, string: () => 23n, bytes: () => 29n };
  const keys = { hash: (key: RuntimeValue) => runtimeHash(key, hash, meter), equal: (a: RuntimeValue, b: RuntimeValue) => runtimeComparison("==", a, b, v, meter).value };
  const events: string[] = [], names = new Map<string, RuntimeValue>([["f", v.none]]);
  let captured: { positional: readonly RuntimeValue[]; keywords: DictionaryValue } | undefined;
  const unused = (): never => { throw new Error("unused"); };
  const context = createRuntimeExpressionContext(v, {
    load(name) { events.push(name); const found = names.get(name); if (found === undefined) throw new Error(`missing:${name}`); return found; },
    store: unused, attribute: unused, beginSet: unused, dictionaryKeys: keys, warn: unused,
    beginCall: callee => beginRuntimeCall(callee, {
      values: v, keys, name: () => "__main__.f()",
      callable: callee => callee.kind !== "int",
      keywordName: key => key.kind === "str" ? String.fromCodePoint(...key.value) : key.kind === "bool" ? key.value ? "True" : "False" : key.kind === "int" ? String(key.value) : unused(),
      invoke(_callee, positional, keywords) { events.push("invoke"); captured = { positional, keywords }; return v.tuple(positional); }
    }, meter)
  }, meter);
  return { v, events, names, captured: () => captured, run: (source: string) => evaluateExpression(parseExpression(source), context, meter) };
}

describe("runtime call collection", () => {
  it("checks callability after expansion but before non-string keyword validation", () => {
    const { run, names, v, events } = fixture(); names.set("bad", v.integer(1));
    expect(() => run("bad(**{1: 2})")).toThrow("'int' object is not callable");
    expect(() => run("bad(missing)")).toThrow("missing:missing");
    expect(events).not.toContain("invoke");
  });
  it("preserves distinct Python keyword strings that share a UTF-16 spelling", () => {
    const { run, captured } = fixture();
    run("f(**{'\\ud83d\\ude00': 1, '\\U0001f600': 2})");
    expect(captured()!.keywords.items.size).toBe(2);
    const keys = captured()!.keywords.items.snapshot().map(([key]) => { if (key.kind !== "str") throw new Error("string expected"); return [...key.value]; });
    expect(keys).toEqual([[0xd83d, 0xde00], [0x1f600]]);
  });
  it("propagates iterator next errors without relabeling or closing them", () => {
    const { run, names, events, v } = fixture(), failure = new PythonRuntimeError("TypeError", "next failed");
    const source = v.iterator({ next() { throw failure; }, return() { events.push("closed"); return { done: true, value: v.none }; } });
    names.set("source", source); expect(() => run("f(*source)")).toThrow(failure);
    expect(events).toEqual(["f", "source"]);
  });
  it("collects mixed positional expansion and keyword mappings", () => {
    const { run, v, captured } = fixture();
    expect(run("f(1, *[2, 3], x=4, **{'y': 5})")).toEqual(v.tuple([v.integer(1), v.integer(2), v.integer(3)]));
    expect(captured()!.keywords.items.snapshot()).toEqual([[v.string("x"), v.integer(4)], [v.string("y"), v.integer(5)]]);
  });
  it("rejects duplicate keywords before invoking or evaluating later groups", () => {
    const { run, events } = fixture();
    expect(() => run("f(**{'x': 1}, **{'x': 2}, y=missing)")).toThrow("__main__.f() got multiple values for keyword argument 'x'");
    expect(events).toEqual(["f"]);
  });
  it("defers string-key validation, retaining numeric key equivalence", () => {
    const { run } = fixture();
    expect(() => run("f(**{1: 2})")).toThrow("keywords must be strings");
    expect(() => run("f(**{1: 2}, **{True: 3})")).toThrow("__main__.f() got multiple values for keyword argument 'True'");
    expect(() => run("f(**{1: 2}, **[])")).toThrow("__main__.f() argument after ** must be a mapping, not list");
  });
  it("distinguishes lone-star and incremental-star expansion diagnostics", () => {
    const { run } = fixture();
    expect(() => run("f(*1)")).toThrow("__main__.f() argument after * must be an iterable, not int");
    expect(() => run("f(0, *1)")).toThrow("Value after * must be an iterable, not int");
    expect(() => run("f(*1, **{1: 2})")).toThrow("__main__.f() argument after * must be an iterable, not int");
  });
  it("does not consume a deferred star after keyword merging fails", () => {
    const { run, names, v, events } = fixture();
    function* source() { events.push("next"); yield v.true; }
    names.set("source", v.iterator(source()));
    expect(() => run("f(*source, **{'x': 1}, **{'x': 2})")).toThrow("multiple values");
    expect(events).toEqual(["f", "source"]);
  });
  it("keeps nested collector state separate", () => {
    const { run, v } = fixture();
    expect(run("f(f(1), *f(2, 3))")).toEqual(v.tuple([v.tuple([v.integer(1)]), v.integer(2), v.integer(3)]));
  });
});
