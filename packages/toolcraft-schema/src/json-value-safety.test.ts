import { expect, it, vi } from "vitest";
import { S, validate } from "./index.js";

it("rejects getter-backed JSON values without executing them", () => {
  const getter = vi.fn(() => "hidden");
  const value = Object.defineProperty({}, "secret", { enumerable: true, get: getter });
  expect(validate(S.Json(), value).ok).toBe(false);
  expect(getter).not.toHaveBeenCalled();
});

it("rejects hidden JSON serialization hooks without executing them", () => {
  const toJSON = vi.fn(() => "changed");
  const value = Object.defineProperty({}, "toJSON", { value: toJSON });
  expect(validate(S.Json(), value).ok).toBe(false);
  expect(toJSON).not.toHaveBeenCalled();
});

it("rejects sparse arrays and cycles while accepting shared JSON references", () => {
  expect(validate(S.Json(), new Array(2)).ok).toBe(false);
  const value: Record<string, unknown> = {}; value.self = value;
  expect(validate(S.Json(), value).ok).toBe(false);
  const shared = { status: "ready" };
  expect(validate(S.Json(), { first: shared, second: shared }).ok).toBe(true);
});

it("rejects inherited serialization hooks without executing them", () => {
  const original = Object.getOwnPropertyDescriptor(Object.prototype, "toJSON");
  const hook = vi.fn(() => "changed");
  let accepted = false;
  try {
    Object.defineProperty(Object.prototype, "toJSON", { value: hook, configurable: true });
    accepted = validate(S.Json(), { status: "ready" }).ok;
  } finally {
    if (original === undefined) Reflect.deleteProperty(Object.prototype, "toJSON");
    else Object.defineProperty(Object.prototype, "toJSON", original);
  }
  expect(accepted).toBe(false);
  expect(hook).not.toHaveBeenCalled();
});
