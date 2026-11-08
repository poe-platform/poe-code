import { afterEach, expect, it, vi } from "vitest";
import { createIntrinsicObject, isTrackedIntrinsicObject } from "./object-model.js";

afterEach(() => vi.restoreAllMocks());

it("does not trust later WeakSet hooks to certify foreign values", () => {
  const tracked = createIntrinsicObject();
  const foreign = new Proxy({}, {});
  vi.spyOn(WeakSet.prototype, "has").mockReturnValue(true);
  expect(isTrackedIntrinsicObject(tracked)).toBe(true);
  expect(isTrackedIntrinsicObject(foreign)).toBe(false);
});

it("does not expose ownership certificates through later WeakSet insertion hooks", () => {
  const add = WeakSet.prototype.add;
  const exposed: WeakSet<object>[] = [];
  vi.spyOn(WeakSet.prototype, "add").mockImplementation(function (
    this: WeakSet<object>,
    value: object
  ) {
    exposed.push(this);
    return add.call(this, value);
  });
  const record = createIntrinsicObject({ text: "small" });
  expect(isTrackedIntrinsicObject(record)).toBe(true);
  expect(exposed).toHaveLength(0);
});
