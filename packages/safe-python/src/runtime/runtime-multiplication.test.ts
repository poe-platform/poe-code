import { expect, it, vi } from "vitest";
import { runtimeMultiplication } from "./runtime-multiplication.js";
import { ExecutionBudget } from "./execution-budget.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";

it.each(["list", "tuple", "str", "bytes"] as const)("repeats %s through a guest index in either operand order", kind => {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 }), v = new RuntimeValues(meter);
  const guest = v.cell({});
  const sequence = (count: number): RuntimeValue => kind === "list" ? v.list(Array(count).fill(v.true))
    : kind === "tuple" ? v.tuple(Array(count).fill(v.true)) : kind === "str" ? v.string("x".repeat(count)) : v.bytes(new Uint8Array(count).fill(120));
  const lookupIndex = vi.fn(() => () => v.integer(2));
  const index = {
    integer: (value: RuntimeValue) => value.kind === "int" ? value.value : undefined,
    isExactInteger: (value: RuntimeValue) => value.kind === "int", lookupIndex,
    typeName: () => "Index", warn: vi.fn()
  };
  for (const reversed of [false, true]) {
    const source = sequence(1);
    const result = runtimeMultiplication(reversed ? guest : source, reversed ? source : guest, v, meter, { integerIndex: index });
    expect(result).toEqual(sequence(2));
    if (result.kind === "list") { expect(result.items.snapshot()).toEqual([v.true, v.true]); expect(result).not.toBe(source); }
    if (result.kind === "bytes") expect([...result.value]).toEqual([120, 120]);
  }
  expect(index.lookupIndex).toHaveBeenCalledTimes(2);
});

it("tries numeric slots before acquiring the index policy", () => {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 }), v = new RuntimeValues(meter);
  const events: string[] = [];
  const result = runtimeMultiplication(v.list([]), v.cell({}), v, meter, {
    numeric: { relation: "other", notImplemented: v.notImplemented,
      forward() { events.push("forward"); return v.notImplemented; },
      reflected() { events.push("reflected"); return v.false; }, reflectedIsOverridden: () => false },
    get integerIndex(): never { throw Error("unnecessary index acquisition"); }
  });
  expect(result).toBe(v.false);
  expect(events).toEqual(["forward", "reflected"]);
});

it("retains native arithmetic and repeats native counts without an index policy", () => {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 }), v = new RuntimeValues(meter);
  const context = { get integerIndex(): never { throw Error("unnecessary index acquisition"); } };
  expect(runtimeMultiplication(v.integer(3), v.integer(7), v, meter, context)).toBe(v.integer(21));
  expect(runtimeMultiplication(v.string("xy"), v.true, v, meter, context)).toEqual(v.string("xy"));
  expect(runtimeMultiplication(v.integer(-2), v.tuple([v.true]), v, meter, context)).toEqual(v.tuple([]));
});

it.each(["missing", "invalid", "overflow", "negative", "boolean"])("validates %s guest indexes before empty-sequence shortcuts", mode => {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 }), v = new RuntimeValues(meter), guest = v.cell({});
  const warn = vi.fn(), lookupIndex = vi.fn(() => mode === "missing" ? undefined : () => mode === "invalid" ? v.string("bad") : mode === "boolean" ? v.true : v.integer(mode === "overflow" ? 1n << 100n : -2n));
  const context = { integerIndex: {
    integer: (value: RuntimeValue) => value.kind === "int" ? value.value : value.kind === "bool" ? value.value ? 1n : 0n : undefined,
    isExactInteger: (value: RuntimeValue) => value.kind === "int", lookupIndex, warn,
    typeName: (value: RuntimeValue) => value === guest ? "Index" : value.kind
  } };
  for (const source of [v.list([]), v.tuple([]), v.string(""), v.bytes(new Uint8Array())]) {
    const run = () => runtimeMultiplication(source, guest, v, meter, context);
    if (mode === "missing") expect(run).toThrow("can't multiply sequence by non-int of type 'Index'");
    else if (mode === "invalid") expect(run).toThrow("__index__ returned non-int (type str)");
    else if (mode === "overflow") expect(run).toThrow("cannot fit 'Index' into an index-sized integer");
    else expect(run()).toEqual(source);
  }
  expect(lookupIndex).toHaveBeenCalledTimes(4);
  expect(warn).toHaveBeenCalledTimes(mode === "boolean" ? 4 : 0);
});

it("reports sequence and numeric failures after declined negotiation", () => {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 }), v = new RuntimeValues(meter);
  expect(() => runtimeMultiplication(v.none, v.string("x"), v, meter)).toThrow("can't multiply sequence by non-int of type 'NoneType'");
  expect(() => runtimeMultiplication(v.none, v.integer(2), v, meter)).toThrow("unsupported operand type(s) for *: 'NoneType' and 'int'");
  const numeric = { relation: "same" as const, notImplemented: v.notImplemented,
    forward: () => v.notImplemented, reflected: () => v.notImplemented, reflectedIsOverridden: () => false };
  expect(runtimeMultiplication(v.string("x"), v.integer(3), v, meter, { numeric })).toEqual(v.string("xxx"));
  expect(() => runtimeMultiplication(v.integer(2), v.integer(3), v, meter, { numeric })).toThrow("unsupported operand type(s) for *: 'int' and 'int'");
});
