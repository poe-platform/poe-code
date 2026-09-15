import { describe, expect, it } from "vitest";
import { createRuntimeExpressionContext, type RuntimeExpressionBindings } from "./runtime-expression-context.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { evaluateExpression, UnsupportedExpressionError } from "./expression-evaluation.js";
import { parseExpression } from "../expression.js";
import { createRuntimeFormatContext } from "./runtime-format.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 }), v = new RuntimeValues(meter);
  const names = new Map<string, RuntimeValue>(), events: string[] = [];
  const bindings: RuntimeExpressionBindings & { names: typeof names; events: string[] } = {
    names, events,
    load(name) { this.events.push(`load:${name}`); const value = this.names.get(name); if (value === undefined) throw new Error(`missing:${name}`); return value; },
    store(name, value) { this.events.push(`store:${name}`); this.names.set(name, value); },
    attribute(object, name) { this.events.push(`attribute:${name}`); return object; },
    beginCall(callee) { this.events.push("prepare"); const args: RuntimeValue[] = []; return {
      positional: value => { args.push(value); }, starred: () => { throw new Error("unused"); },
      keywords: () => { throw new Error("unused"); }, mapping: () => { throw new Error("unused"); },
      invoke: () => { this.events.push("invoke"); return v.tuple([callee, ...args]); }
    }; },
    beginSet() { throw new UnsupportedExpressionError("set"); },
    beginDictionary() { throw new UnsupportedExpressionError("dictionary"); },
    warn(category) { this.events.push(category); }
  };
  const context = createRuntimeExpressionContext(v, bindings, meter);
  return { meter, v, names, events, bindings, context, run: (source: string) => evaluateExpression(parseExpression(source), context, meter) };
}

describe("concrete runtime expression context", () => {
  it("does not acquire formatting capabilities for ordinary arithmetic", () => {
    const { meter, v, bindings } = fixture();
    const context = createRuntimeExpressionContext(v, { ...bindings,
      get formatting(): never { throw Error("unused formatting policy"); },
      get formattedString(): never { throw Error("unused f-string policy"); }
    }, meter);
    expect(evaluateExpression(parseExpression("1+2"), context, meter)).toEqual(v.integer(3));
  });
  it("acquires formatting once on first use and permits disabling f-string support", () => {
    const { meter, v, bindings } = fixture(); let reads = 0;
    const formatting = createRuntimeFormatContext(v, meter, { defaultRepr() { throw Error("unexpected repr"); } });
    const context = createRuntimeExpressionContext(v, { ...bindings, get formatting() { reads++; return formatting; } }, meter);
    expect(reads).toBe(0);
    for (let i = 0; i < 2; i++) expect(evaluateExpression(parseExpression('f"{12:04}"'), context, meter)).toEqual(v.string("0012"));
    expect(reads).toBe(1);
    const original = context.formattedString;
    context.formattedString = undefined;
    expect(() => evaluateExpression(parseExpression('f"{12}"'), context, meter)).toThrow(UnsupportedExpressionError);
    context.formattedString = original;
    expect(evaluateExpression(parseExpression('f"{12}"'), context, meter)).toEqual(v.string("12"));
    expect(reads).toBe(1);
  });
  it("checks cancellation after deferred formatting policy acquisition", () => {
    const { v, bindings, meter: initialMeter } = fixture(); let cancelled = false;
    const formatting = createRuntimeFormatContext(v, initialMeter, { defaultRepr() { throw Error("unexpected repr"); } });
    const meter = { checkpoint() { if (cancelled) throw new ExecutionLimitError("cancelled"); } };
    const context = createRuntimeExpressionContext(v, { ...bindings, get formatting() { cancelled = true; return formatting; } }, meter);
    expect(() => evaluateExpression(parseExpression('f"{12}"'), context, meter)).toThrow(ExecutionLimitError);
  });
  it("evaluates native f-strings without custom formatting hooks", () => {
    const { v, names, run } = fixture(), value = v.string("😀éz");
    names.set("x", value);
    expect(run('f"{x}"')).toBe(value);
    expect(run('f""')).toEqual(v.string(""));
    expect(run('f"[{x:_>6.2s}]"')).toEqual(v.string("[____😀é]"));
    expect(run('f"{x!a}"')).toEqual(v.string("'\\U0001f600\\xe9z'"));
    expect(run('f"{123}:{None}:{[1, 2]}"')).toEqual(v.string("123:None:[1, 2]"));
    expect(run('f"{1.5}:{True}:{1+2j}:{-0.0:}"')).toEqual(v.string("1.5:True:(1+2j):-0.0"));
    names.set("x", v.stringPoints(Uint32Array.of(0xd800, 0xdc00)));
    expect(run('f"a{x}b"')).toEqual(v.stringPoints(Uint32Array.of(97, 0xd800, 0xdc00, 98)));
  });
  it("evaluates nested format specs and debug text using native capabilities", () => {
    const { v, names, run, events } = fixture();
    names.set("x", v.string("ab")); names.set("width", v.integer(5));
    expect(run('f"{x:>{width}}"')).toEqual(v.string("   ab"));
    expect(events).toEqual(["load:x", "load:width"]);
    expect(run('f"{x = }"')).toEqual(v.string("x = 'ab'"));
    expect(() => run('f"{x:+s}"')).toThrow("Sign not allowed in string format specifier");
    expect(() => run('t"{x}"')).toThrow(UnsupportedExpressionError);
  });
  it("passes the explicit formatted-string capability into evaluation", () => {
    const { v, meter, bindings } = fixture();
    const result = v.string("formatted");
    const formattedString = {
      text: () => v.string(""), convert: () => result, format: () => result,
      join: (parts: readonly RuntimeValue[]) => parts[0] ?? v.string("")
    };
    const context = createRuntimeExpressionContext(v, { ...bindings, formattedString }, meter);
    expect(context.formattedString).toBe(formattedString);
    expect(evaluateExpression(parseExpression('f"{1!r}"'), context, meter)).toBe(result);
  });
  it("assembles arithmetic, subscription, comparison and membership", () => {
    const { v, run } = fixture();
    expect(run("([1, 2] + [3] * 2)[-1]")).toEqual(v.integer(3));
    expect(run("[1, [2]] < [1, [3]]")).toBe(v.true);
    expect(run("[1] in [[1], [2]]")).toBe(v.true);
    expect(run("not [] and 0 not in []")).toBe(v.true);
    expect(run("(*[1, 2], *b'a')")).toEqual(v.tuple([v.integer(1), v.integer(2), v.integer(97)]));
  });
  it("binds namespace methods to their owner and supports named expressions", () => {
    const { names, events, run, v } = fixture();
    expect(events).toEqual([]);
    expect(run("(x := [1])[0]")).toEqual(v.integer(1));
    expect(run("x[0]")).toEqual(v.integer(1));
    expect(names.get("x")?.kind).toBe("list"); expect(events).toEqual(["store:x", "load:x"]);
  });
  it("delegates object/call hooks only during expression execution", () => {
    const { names, events, run, v } = fixture(); names.set("f", v.none);
    expect(run("f.member(1, 2)")).toEqual(v.tuple([v.none, v.integer(1), v.integer(2)]));
    expect(events).toEqual(["load:f", "attribute:member", "prepare", "invoke"]);
  });
  it("preserves branching short circuit and the warning hook receiver", () => {
    const { run, context, meter, events, v } = fixture();
    expect(run("[] and missing")).toMatchObject({ kind: "list" });
    expect(evaluateExpression(parseExpression("[] and missing"), context, meter, "branch")).toBe(false);
    expect(run("~True")).toEqual(v.integer(-2)); expect(events).toEqual(["DeprecationWarning"]);
  });
  it("never publishes declined binary operations as successful values", () => {
    const { run } = fixture();
    expect(() => run("None + 1")).toThrow("unsupported operand type(s) for +: 'NoneType' and 'int'");
    expect(run("4.0 ** 0.5")).toEqual({ kind: "float", value: 2 });
    expect(run("1j ** 2")).toEqual({ kind: "complex", real: -1, imaginary: 0 });
    expect(() => run("'x' ** 0.5")).toThrow("unsupported operand type(s) for ** or pow(): 'str' and 'float'");
    expect(() => run("1 / 0")).toThrow("division by zero");
  });
  it("reports native sequence concatenation errors through ordinary addition", () => {
    const { run } = fixture();
    for (const [source, kind] of [["[]", "list"], ["()", "tuple"], ["''", "str"]]) {
      expect(() => run(`${source} + 1`)).toThrow(`can only concatenate ${kind} (not "int") to ${kind}`);
      expect(() => run(`1 + ${source}`)).toThrow(`unsupported operand type(s) for +: 'int' and '${kind}'`);
    }
    expect(() => run("b'' + None")).toThrow("can't concat NoneType to bytes");
  });
  it("prepares guest addition slots only after evaluating both operands", () => {
    const { v, bindings, run, events, names } = fixture(), guest = v.cell({}), answer = v.string("reflected");
    names.set("left", v.list([])); names.set("right", guest);
    bindings.addition = function(left, right) {
      expect(this).toBe(bindings); expect(left.kind).toBe("list"); expect(right).toBe(guest);
      events.push("slots");
      return { numeric: { relation: "other", notImplemented: v.notImplemented,
        forward: () => v.notImplemented, reflected: () => answer, reflectedIsOverridden: () => false } };
    };
    expect(run("left + right")).toBe(answer);
    expect(events).toEqual(["load:left", "load:right", "slots"]);
  });
  it("reports native repetition errors through multiplication", () => {
    const { run } = fixture();
    expect(() => run("[] * None")).toThrow("can't multiply sequence by non-int of type 'NoneType'");
    expect(() => run("None * 2")).toThrow("unsupported operand type(s) for *: 'NoneType' and 'int'");
  });
  it("prepares multiplication slots after both operands and preserves the hook receiver", () => {
    const { v, bindings, run, events, names } = fixture(), guest = v.cell({});
    names.set("left", v.list([])); names.set("right", guest);
    bindings.multiplication = function(left, right) {
      expect(this).toBe(bindings); expect(left.kind).toBe("list"); expect(right).toBe(guest);
      events.push("slots");
      return { numeric: { relation: "other", notImplemented: v.notImplemented,
        forward: () => v.notImplemented, reflected: () => v.false, reflectedIsOverridden: () => false } };
    };
    expect(run("left * right")).toBe(v.false);
    expect(events).toEqual(["load:left", "load:right", "slots"]);
  });
  it("uses the same guest truth hook for not and Boolean short-circuiting", () => {
    const { v, bindings, run, names } = fixture(), guest = v.cell({}); let truth = false, calls = 0;
    names.set("guest", guest);
    bindings.truth = function(value) { expect(this).toBe(bindings); expect(value).toBe(guest); calls++; return truth; };
    expect(run("not guest")).toBe(v.true);
    expect(run("guest and missing")).toBe(guest);
    expect(run("guest or 42")).toBe(v.integer(42));
    truth = true;
    expect(run("not guest")).toBe(v.false);
    expect(run("guest or missing")).toBe(guest);
    expect(calls).toBe(5);
  });
  it("checks cancellation immediately after guest truth returns", () => {
    const { v, bindings } = fixture(); let cancelled = false;
    bindings.truth = () => { cancelled = true; return false; };
    const context = createRuntimeExpressionContext(v, bindings, { checkpoint() { if (cancelled) throw new ExecutionLimitError("cancelled"); } });
    expect(() => context.truth(v.cell({}))).toThrow(ExecutionLimitError);
  });
  it("retains arbitrary rich comparison results and truth-tests chain links once", () => {
    const { v, bindings, run, names } = fixture(), a = v.cell({}), b = v.cell({}), result = v.cell({}); let compared = 0, tested = 0;
    names.set("a", a); names.set("b", b);
    bindings.richComparison = () => ({ slots: { rightIsStrictSubtype: false, notImplemented: v.notImplemented,
      forward() { compared++; return result; }, reflected: () => v.notImplemented } });
    bindings.truth = value => { expect(value).toBe(result); tested++; return false; };
    expect(run("a < b")).toBe(result); expect(tested).toBe(0);
    expect(run("a < b < missing")).toBe(result); expect(tested).toBe(1); expect(compared).toBe(2);
    expect(run("a is b")).toBe(v.false); expect(compared).toBe(2);
  });
  it("retains explicit unsupported object operations rather than inventing defaults", () => {
    const { run } = fixture();
    expect(() => run("{1}")).toThrow(UnsupportedExpressionError);
    expect(() => run("{}" )).toThrow(UnsupportedExpressionError);
    expect(() => run("lambda: 1")).toThrow(UnsupportedExpressionError);
  });
  it("charges setup before binding a context", () => {
    const { v, bindings } = fixture();
    expect(() => createRuntimeExpressionContext(v, bindings, new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 0 }))).toThrow(ExecutionLimitError);
  });
});
