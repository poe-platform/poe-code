import { expect, it } from "vitest";
import { ExecutionBudget } from "./execution-budget.js";
import { ProtocolIterator, type IterationContext } from "./protocol-iterator.js";
import type { CompletionIterator } from "./iterator-completion.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 }), v = new RuntimeValues(meter);
  const source = v.cell({}), native: CompletionIterator<RuntimeValue> = { next: () => ({ done: true, value: undefined }) }, cursor = v.iterator(native);
  const context: IterationContext<RuntimeValue> = {
    lookupIter: () => () => cursor, hasNext: () => true,
    nativeIterator(value) { expect(this).toBe(context); expect(value).toBe(cursor); return native; },
    next(): never { throw Error("must not translate native completion"); },
    isStopIteration(): never { throw Error("must not reclassify native completion"); },
    hasSequenceItem: () => false, getItem: () => v.none, isIndexError: () => false, typeName: () => "Guest"
  };
  return { meter, v, source, cursor, native, context };
}

it("returns native completion records intact without latching exhaustion", () => {
  const { meter, v, source, native, context } = fixture(), step = { done: true as const, value: undefined, exception: { value: undefined } };
  let pulls = 0;
  native.next = () => ++pulls === 1 ? step : { done: false, value: v.true };
  const iterator = new ProtocolIterator(source, context, meter);
  expect(iterator.next()).toBe(step); expect(iterator.next()).toEqual({ done: false, value: v.true }); expect(pulls).toBe(2);
});

it("keeps indexed fallback separate from native-cursor adaptation", () => {
  const { meter, v, source, context } = fixture();
  context.lookupIter = () => undefined; context.hasSequenceItem = () => true;
  context.getItem = (value, index) => { expect(value).toBe(source); expect(index).toBe(0n); return v.false; };
  context.nativeIterator = (): never => { throw Error("must not adapt indexed fallback"); };
  expect(new ProtocolIterator(source, context, meter).next()).toEqual({ done: false, value: v.false });
});

it.each(["adapt", "pull"])("observes cancellation after native %s callbacks", phase => {
  const state = fixture(), controller = new AbortController();
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000, signal: controller.signal });
  state.context.nativeIterator = () => { if (phase === "adapt") controller.abort(); return state.native; };
  state.native.next = () => { controller.abort(); return { done: true, value: undefined }; };
  expect(() => new ProtocolIterator(state.source, state.context, meter).next()).toThrow("execution cancelled");
});

it("propagates native cursor failures without guest exception classification", () => {
  const { meter, source, native, context } = fixture(), failure = new Error("native fault");
  native.next = () => { throw failure; };
  expect(() => new ProtocolIterator(source, context, meter).next()).toThrow(failure);
});

it("reacquires native cursors without advancing them during acquisition", () => {
  const { meter, source, cursor, native, context } = fixture(); let acquisitions = 0;
  context.lookupIter = value => { expect(value === source || value === cursor).toBe(true); acquisitions++; return () => cursor; };
  native.next = (): never => { throw Error("must not pull during acquisition"); };
  const iterator = new ProtocolIterator(source, context, meter);
  expect(iterator.reacquire() === iterator).toBe(false); expect(acquisitions).toBe(2);
});
