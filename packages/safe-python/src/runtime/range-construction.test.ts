import { describe, expect, it } from "vitest";
import { constructRange } from "./range-construction.js";
import type { IntegerIndexContext } from "./index-protocol.js";
import { RangeIterator } from "./range-iterator.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

interface Value { name: string; value?: bigint; index?: () => Value }
const int = (value: bigint, name = "int"): Value => ({ name, value });
const budget = () => new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 });
const context: IntegerIndexContext<Value> = {
  integer: value => value.value, isExactInteger: value => value.name === "int",
  lookupIndex: value => value.index, typeName: value => value.name,
  warn: () => { throw new Error("unexpected warning"); }
};

describe("guest range construction", () => {
  it("uses zero start and unit step for one argument", () => {
    expect(constructRange([int(3n)], new Map(), context, budget())).toEqual({ start: 0n, stop: 3n, step: 1n, length: 3n });
  });
  it("normalizes direct integer subclass payloads without calling overrides", () => {
    const range = constructRange([{ ...int(2n, "Sub"), index: () => { throw new Error("unexpected override"); } }, int(8n)], new Map(), context, budget());
    expect([...new RangeIterator(range, false, budget())]).toEqual([2n, 3n, 4n, 5n, 6n, 7n]);
  });
  it("converts start, stop and step left to right", () => {
    const events: number[] = [];
    const args = [1n, 8n, 2n].map((value, index) => ({ name: "Index", index: () => { events.push(index); return int(value); } }));
    expect(constructRange(args, new Map(), context, budget())).toEqual({ start: 1n, stop: 8n, step: 2n, length: 4n });
    expect(events).toEqual([0, 1, 2]);
  });
  it.each([0, 1, 2])("stops conversion at failure in argument %s", failed => {
    const events: number[] = [], failure = new Error("index failed");
    const args = [1n, 8n, 2n].map((value, index) => ({ name: "Index", index: () => { events.push(index); if (index === failed) throw failure; return int(value); } }));
    expect(() => constructRange(args, new Map(), context, budget())).toThrow(failure);
    expect(events).toEqual([0, 1, 2].slice(0, failed + 1));
  });
  it("rejects zero step only after converting all arguments", () => {
    let converted = false;
    expect(() => constructRange([int(1n), int(1n), { name: "Index", index: () => { converted = true; return int(0n); } }], new Map(), context, budget()))
      .toThrow("range() arg 3 must not be zero");
    expect(converted).toBe(true);
  });
  it.each([0, 4])("rejects %s arguments before conversion", count => {
    expect(() => constructRange(Array(count).fill({ name: "Bad" }), new Map(), context, budget())).toThrow(count === 0
      ? "range expected at least 1 argument, got 0" : "range expected at most 3 arguments, got 4");
  });
  it("rejects keywords before arity", () => {
    expect(() => constructRange([], new Map([["stop", int(3n)]]), context, budget())).toThrow("range() takes no keyword arguments");
  });
  it("supports huge ranges without materializing values", () => {
    const end = 1n << 200n;
    expect(constructRange([int(-end), int(end), int(2n)], new Map(), context, budget()).length).toBe(end);
  });
  it("checks cancellation after index conversion before the next argument", () => {
    let cancelled = false;
    expect(() => constructRange([{ name: "Index", index: () => { cancelled = true; return int(1n); } },
      { name: "Index", index: () => { throw new Error("unexpected second conversion"); } }], new Map(), context,
    { checkpoint: () => { if (cancelled) throw new ExecutionLimitError("cancelled"); } })).toThrow(ExecutionLimitError);
  });
});
