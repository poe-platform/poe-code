import { expect, it, vi } from "vitest";
import { withMeasurementSeen } from "./measurement-seen.js";

it("keeps nested visited registries private from later native binding hooks", () => {
  const bind = Function.prototype.bind;
  const nativeGet = WeakMap.prototype.get;
  const nativeSet = WeakMap.prototype.set;
  const exposed: unknown[] = [];
  const root = {};
  let outerAfter = false;
  let innerBefore = true;
  let innerAfter = false;
  Function.prototype.bind = function (this: (...args: any[]) => any, receiver: unknown, ...args: unknown[]) {
    if (this === nativeGet || this === nativeSet) exposed.push(receiver);
    return Reflect.apply(bind, this, [receiver, ...args]);
  };
  try {
    withMeasurementSeen(outer => {
      outer.add(root);
      withMeasurementSeen(inner => {
        innerBefore = inner.has(root);
        inner.add(root);
        innerAfter = inner.has(root);
      });
      outerAfter = outer.has(root);
    });
  } finally {
    Function.prototype.bind = bind;
  }
  expect(exposed).toEqual([]);
  expect([innerBefore, innerAfter, outerAfter]).toEqual([false, true, true]);
});

it("rebinds a fresh private registry when the numeric generation rolls over", async () => {
  vi.resetModules();
  const { withMeasurementSeen: measure } = await import("./measurement-seen.js");
  const root = {};
  measure(seen => seen.add(root));
  const originalNumber = globalThis.Number;
  // Force the rollover boundary without executing MAX_SAFE_INTEGER walks.
  // No other Number operations run while this synchronous callback is active.
  const rolloverNumber = Object.create(originalNumber);
  Object.defineProperty(rolloverNumber, "MAX_SAFE_INTEGER", { value: 1 });
  let before = true;
  let after = false;
  globalThis.Number = rolloverNumber;
  try {
    measure(seen => {
      before = seen.has(root);
      seen.add(root);
      after = seen.has(root);
    });
  } finally {
    globalThis.Number = originalNumber;
  }
  expect([before, after]).toEqual([false, true]);
  expect(measure(seen => seen.has(root))).toBe(false);
});
