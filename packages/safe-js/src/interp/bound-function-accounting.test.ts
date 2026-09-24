import { expect, it, vi } from "vitest";
import { Budget } from "./budget.js";
import { createBoundFunction } from "./bound-function.js";
import {
  createSandboxClosure,
  measureSandboxData,
  reconcileCompiledValues,
  type SandboxValue
} from "./values.js";

it.each([false, true])(
  "preserves a construction hook's retained provider (accessor=%s)",
  (accessor) => {
    const target = createSandboxClosure({ call: () => undefined });
    const payload = { text: "old" };
    let reads = 0;
    let calls = 0;
    const provider = () => {
      calls++;
      return [payload];
    };
    const define = Object.defineProperty;
    const hook = vi.spyOn(Object, "defineProperty").mockImplementation((owner, key, descriptor) => {
      if (
        typeof key === "symbol" &&
        typeof descriptor.value === "function" &&
        owner.boundTarget === target
      )
        descriptor = accessor
          ? {
              get: () => {
                reads++;
                return provider;
              }
            }
          : { ...descriptor, value: provider };
      return define(owner, key, descriptor);
    });
    let bound: ReturnType<typeof createBoundFunction>;
    try {
      bound = createBoundFunction(
        { target, thisValue: undefined, args: [] },
        "bound test",
        0,
        () => undefined
      );
    } finally {
      hook.mockRestore();
    }
    const before = measureSandboxData([bound]);
    payload.text = "x".repeat(1003);
    expect(measureSandboxData([bound])).toBe(before + 1000);
    expect(calls).toBe(2);
    expect(reads).toBe(accessor ? 2 : 0);
  }
);

it.each([false, true])(
  "keeps private bound capture snapshots out of native iterator hooks (held=%s)",
  (held) => {
    const target = createSandboxClosure({ call: () => undefined });
    const receiver = { receiver: "r" };
    const payload = { text: "x".repeat(1000) };
    const bound = createBoundFunction(
      { target, thisValue: receiver, args: [payload] },
      "bound test",
      0,
      () => undefined
    );
    const expected = measureSandboxData([bound]);
    const iterator = Array.prototype[Symbol.iterator];
    let exposed = 0;
    Array.prototype[Symbol.iterator] = function () {
      if (this[0] === target && this[1] === receiver && this[2] === payload) {
        exposed++;
        return iterator.call([]);
      }
      return iterator.call(this);
    };
    const budget = new Budget({ dataSize: expected - 1 });
    const release = held ? budget.deferReconciliation() : undefined;
    let actual: number;
    let failure: unknown;
    try {
      actual = measureSandboxData([bound]);
      try {
        reconcileCompiledValues(budget, [bound]);
      } catch (error) {
        failure = error;
      }
    } finally {
      release?.();
      Array.prototype[Symbol.iterator] = iterator;
    }
    expect({ actual, exposed }).toEqual({ actual: expected, exposed: 0 });
    expect(failure).toMatchObject({ code: "budgetExceeded", budget: "dataSize" });
  }
);

it("keeps source argument iterators, their changes and their failures observable", () => {
  const target = createSandboxClosure({ call: () => undefined });
  const args: SandboxValue[] = [];
  let payload: SandboxValue = "old";
  let reads = 0;
  let fail = false;
  args[Symbol.iterator] = function* () {
    reads++;
    if (fail) throw new Error("argument iteration");
    yield payload;
  };
  const bound = createBoundFunction(
    { target, thisValue: undefined, args },
    "bound test",
    0,
    () => undefined
  );
  const before = measureSandboxData([bound]);
  payload = "x".repeat(1003);
  expect(measureSandboxData([bound])).toBe(before + 1000);
  fail = true;
  expect(() => measureSandboxData([bound])).toThrow("argument iteration");
  fail = false;
  expect(measureSandboxData([bound])).toBe(before + 1000);
  expect(reads).toBe(4);
});

it("captures every bound root before target callbacks mutate the remaining state", () => {
  const receiver = { text: "receiver" };
  const payload = { text: "old" };
  let mutate = false;
  const target = createSandboxClosure({
    call: () => undefined,
    retainedValues: () => {
      if (mutate) {
        state.thisValue = undefined;
        state.args[0] = "x".repeat(1003);
      }
      return [];
    }
  });
  const state: { target: typeof target; thisValue: SandboxValue; args: SandboxValue[] } = {
    target,
    thisValue: receiver,
    args: [payload, payload]
  };
  const bound = createBoundFunction(state, "bound test", 0, () => undefined);
  const before = measureSandboxData([bound]);
  expect(measureSandboxData([bound, receiver, payload])).toBe(before);
  mutate = true;
  expect(measureSandboxData([bound])).toBe(before);
  expect(measureSandboxData([bound])).toBeGreaterThan(before + 900);
});

it("isolates a nested measurement invoked by the source argument iterator", () => {
  const target = createSandboxClosure({ call: () => undefined });
  const payload = { text: "nested" };
  const args: SandboxValue[] = [];
  let nested: number | undefined;
  args[Symbol.iterator] = function* () {
    nested = measureSandboxData([payload]);
    yield payload;
  };
  const bound = createBoundFunction(
    { target, thisValue: payload, args },
    "bound test",
    0,
    () => undefined
  );
  const expected = measureSandboxData([bound]);
  expect(nested).toBe(measureSandboxData([payload]));
  expect(measureSandboxData([bound, payload])).toBe(expected);
});
