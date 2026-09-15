import { expect, it } from "vitest";
import { RepresentationStack } from "./representation-stack.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

const budget = () => new ExecutionBudget({ maxSteps: 1000, maxAllocatedBytes: 10000 });
it("identifies active-path cycles without confusing repeated siblings", () => {
  const stack = new RepresentationStack<object>(10, budget()), value = {};
  const leave = stack.enter(value);
  expect(leave).toBeTypeOf("function"); expect(stack.enter(value)).toBeUndefined();
  leave!();
  const again = stack.enter(value); expect(again).toBeTypeOf("function"); again!();
});
it("tracks identity rather than structural equality", () => {
  const stack = new RepresentationStack<object>(10, budget()), a = {}, b = {};
  const leaveA = stack.enter(a), leaveB = stack.enter(b);
  expect(leaveB).toBeTypeOf("function"); expect(stack.enter(a)).toBeUndefined();
  leaveB!(); leaveA!();
});
it("limits new nesting while permitting a cycle marker at the depth boundary", () => {
  const stack = new RepresentationStack<object>(1, budget()), a = {}, b = {};
  const leave = stack.enter(a);
  expect(stack.enter(a)).toBeUndefined();
  expect(() => stack.enter(b)).toThrow("maximum recursion depth exceeded while getting the repr of an object");
  leave!(); const next = stack.enter(b); expect(next).toBeTypeOf("function"); next!();
});
it("requires LIFO cleanup but makes repeated restores inert", () => {
  const stack = new RepresentationStack<object>(10, budget()), a = {}, b = {};
  const leaveA = stack.enter(a), leaveB = stack.enter(b);
  expect(() => leaveA!()).toThrow("representation entries must be restored in LIFO order");
  expect(stack.enter(a)).toBeUndefined(); expect(stack.enter(b)).toBeUndefined();
  leaveB!(); leaveB!(); leaveA!(); leaveA!();
  const again = stack.enter(a); expect(again).toBeTypeOf("function"); again!();
});
it("cleans up after exceptions so later representations are not marked recursive", () => {
  const stack = new RepresentationStack<object>(10, budget()), value = {}, error = new Error("guest repr");
  expect(() => { const leave = stack.enter(value); try { throw error; } finally { leave!(); } }).toThrow(error);
  const leave = stack.enter(value); expect(leave).toBeTypeOf("function"); leave!();
});
it("allows unmetered cleanup after fatal cancellation", () => {
  let cancelled = false;
  const meter = { checkpoint() { if (cancelled) throw new ExecutionLimitError("cancelled"); } };
  const stack = new RepresentationStack<object>(10, meter), value = {}, leave = stack.enter(value);
  cancelled = true;
  expect(() => stack.enter({})).toThrow(ExecutionLimitError);
  expect(() => leave!()).not.toThrow();
  cancelled = false;
  const next = stack.enter(value); expect(next).toBeTypeOf("function"); next!();
});
it("precharges entry allocation before mutating the active path", () => {
  let reject = false;
  const meter = { checkpoint(_steps = 1, bytes = 0) { if (reject && bytes > 0) throw new ExecutionLimitError("allocation"); } };
  const stack = new RepresentationStack<object>(10, meter), value = {};
  reject = true; expect(() => stack.enter(value)).toThrow(ExecutionLimitError);
  reject = false; const leave = stack.enter(value); expect(leave).toBeTypeOf("function"); leave!();
});
it("requires an explicit positive safe depth limit", () => {
  for (const depth of [0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) expect(() => new RepresentationStack(depth, budget())).toThrow(RangeError);
});
