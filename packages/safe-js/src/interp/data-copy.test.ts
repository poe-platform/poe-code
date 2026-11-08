import { expect, it } from "vitest";
import { runDataCopy, type DataCopyOperation } from "./data-copy.js";

it("drives deeply nested operations without recursive native calls", () => {
  function* copy(depth: number): DataCopyOperation<number> {
    return depth === 0 ? 0 : 1 + (yield copy(depth - 1));
  }
  expect(runDataCopy(copy(10000))).toBe(10000);
});

it("unwinds parent iterators in order and preserves a child failure over close errors", () => {
  const failure = new Error("child failure");
  const closed: string[] = [];
  const iterable = (name: string) => ({ [Symbol.iterator]() {
    return {
      next: () => ({ done: false, value: 1 }),
      return() { closed.push(name); throw new Error("close failure"); }
    };
  } });
  // eslint-disable-next-line require-yield -- A failing leaf has no child operation.
  function* leaf(): DataCopyOperation<number> { throw failure; }
  function* inner(): DataCopyOperation<number> {
    for (const item of iterable("inner")) { void item; yield leaf(); }
    return 0;
  }
  function* outer(): DataCopyOperation<number> {
    for (const item of iterable("outer")) { void item; yield inner(); }
    return 0;
  }
  expect(() => runDataCopy(outer())).toThrow(failure);
  expect(closed).toEqual(["inner", "outer"]);
});

it("allows a parent to recover from a child failure and resume with another child", () => {
  // eslint-disable-next-line require-yield -- A failing leaf has no child operation.
  function* failed(): DataCopyOperation<number> { throw new Error("failed"); }
  // eslint-disable-next-line require-yield -- A completed leaf has no child operation.
  function* recovered(): DataCopyOperation<number> { return 42; }
  function* parent(): DataCopyOperation<number> {
    try { return yield failed(); }
    catch { return yield recovered(); }
  }
  expect(runDataCopy(parent())).toBe(42);
});

it("does not expose private operations to replaced generator methods", () => {
  // eslint-disable-next-line require-yield -- A completed leaf has no child operation.
  function* child(): DataCopyOperation<number> { return 42; }
  function* parent(): DataCopyOperation<number> { return yield child(); }
  const operation = parent();
  const prototype = Object.getPrototypeOf(Object.getPrototypeOf(operation));
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "next")!;
  Object.defineProperty(prototype, "next", { ...descriptor, value() {
    throw new Error("Private generator exposed");
  } });
  let result: number;
  try { result = runDataCopy(operation); }
  finally { Object.defineProperty(prototype, "next", descriptor); }
  expect(result).toBe(42);
});
