import { expect, it } from "vitest";
import { runtimeAddition } from "./runtime-addition.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { RuntimeValues } from "./runtime-values.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 });
  return { meter, v: new RuntimeValues(meter) };
}
it("finishes native numeric addition and sequence concatenation", () => {
  const { v, meter } = fixture();
  expect(runtimeAddition(v.integer(1), v.integer(2), v, meter)).toBe(v.integer(3));
  expect(runtimeAddition(v.list([v.true]), v.list([v.false]), v, meter)).toEqual(v.list([v.true, v.false]));
  expect(runtimeAddition(v.string("a"), v.string("b"), v, meter)).toEqual(v.string("ab"));
});
it("reports sequence-specific errors only after numeric negotiation declines", () => {
  const { v, meter } = fixture();
  for (const value of [v.list([]), v.tuple([]), v.string("")]) expect(() => runtimeAddition(value, v.none, v, meter)).toThrow(`can only concatenate ${value.kind} (not "NoneType") to ${value.kind}`);
  expect(() => runtimeAddition(v.bytes(new Uint8Array()), v.integer(1), v, meter)).toThrow("can't concat int to bytes");
  expect(() => runtimeAddition(v.integer(1), v.none, v, meter)).toThrow("unsupported operand type(s) for +: 'int' and 'NoneType'");
});
it("allows reflected guest addition to win before native sequence fallback", () => {
  const { v, meter } = fixture(), guest = v.cell({}), answer = v.string("reflected"), events: string[] = [];
  const context = { numeric: { relation: "other" as const, notImplemented: v.notImplemented,
    forward() { events.push("forward"); return v.notImplemented; }, reflected() { events.push("reflected"); return answer; }, reflectedIsOverridden: () => false } };
  expect(runtimeAddition(v.list([]), guest, v, meter, context)).toBe(answer);
  expect(events).toEqual(["forward", "reflected"]);
});
it("falls back to concatenation after both numeric methods decline", () => {
  const { v, meter } = fixture(), source = v.list([v.true]);
  const context = { numeric: { relation: "same" as const, notImplemented: v.notImplemented,
    forward: () => v.notImplemented, reflected: () => { throw Error("must not reflect same type"); }, reflectedIsOverridden: () => false } };
  expect(runtimeAddition(source, source, v, meter, context)).toEqual(v.list([v.true, v.true]));
});
it("checks cancellation after a successful guest slot and bounds diagnostic type names", () => {
  const { v, meter } = fixture(); let cancelled = false;
  const numeric = { relation: "same" as const, notImplemented: v.notImplemented, forward() { cancelled = true; return v.true; }, reflected: () => v.notImplemented, reflectedIsOverridden: () => false };
  expect(() => runtimeAddition(v.none, v.none, v, { checkpoint() { if (cancelled) throw new ExecutionLimitError("cancelled"); } }, { numeric })).toThrow(ExecutionLimitError);
  expect(() => runtimeAddition(v.list([]), v.cell({}), v, meter, { typeName: () => "x".repeat(300) })).toThrow(`can only concatenate list (not "${"x".repeat(200)}") to list`);
  expect(() => runtimeAddition(v.bytes(new Uint8Array()), v.cell({}), v, meter, { typeName: () => "x".repeat(300) })).toThrow(`can't concat ${"x".repeat(100)} to bytes`);
  expect(() => runtimeAddition(v.integer(1), v.cell({}), v, meter, { typeName: value => value.kind === "int" ? "int" : "x".repeat(300) })).toThrow(`unsupported operand type(s) for +: 'int' and '${"x".repeat(100)}'`);
});
