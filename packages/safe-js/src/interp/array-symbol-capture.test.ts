import { expect, it } from "vitest";
import { createSandboxClosure, measureSandboxData } from "./values.js";
import { markDescriptorObject } from "./object-model.js";

it.each([false, true])("captures array data before symbol callbacks can erase it (managed: %s)", managed => {
  const value = ["x".repeat(400)];
  Object.defineProperty(value, Symbol(), { value: createSandboxClosure({
    call: () => undefined,
    retainedValues: () => {
      value.length = 0;
      return [];
    }
  }) });
  if (managed) markDescriptorObject(value);
  expect(measureSandboxData([value])).toBe(managed ? 407 : 405);
});

it("captures managed named data before symbol callbacks can delete it", () => {
  const value: unknown[] = [];
  Object.defineProperty(value, "payload", { value: "x".repeat(400), configurable: true });
  Object.defineProperty(value, Symbol(), { value: createSandboxClosure({
    call: () => undefined,
    retainedValues: () => {
      Reflect.deleteProperty(value, "payload");
      return [];
    }
  }) });
  markDescriptorObject(value);
  expect(measureSandboxData([value])).toBe(412);
});

it("still captures symbols before indexed callbacks can delete them", () => {
  const value: unknown[] = [];
  const key = Symbol();
  Object.defineProperty(value, key, { value: "x".repeat(400), configurable: true });
  value.push(createSandboxClosure({ call: () => undefined, retainedValues: () => {
    Reflect.deleteProperty(value, key);
    return [];
  }}));
  expect(measureSandboxData([value])).toBe(405);
});
