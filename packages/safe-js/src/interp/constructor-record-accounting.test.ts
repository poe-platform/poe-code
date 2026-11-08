import { expect, it, vi } from "vitest";
import { run } from "../run.js";
import { accessorAdapter } from "./accessors.js";
import { Budget } from "./budget.js";
import { getSandboxPrototype } from "./object-model.js";
import { defineDataProperty } from "./globals/object-array.js";
import {
  createSandboxClosure,
  isSandboxClosure,
  measureSandboxData,
  reconcileCompiledValues,
  type SandboxObject
} from "./values.js";

// React's DOM property records have this shape in the live Zoom external library.
const source = `return function PropertyInfo(name, type, property, attribute, namespace, sanitize, remove) {
  this.acceptsBooleans = type === 2 || type === 3 || type === 4;
  this.attributeName = attribute;
  this.attributeNamespace = namespace;
  this.mustUseProperty = property;
  this.propertyName = name;
  this.type = type;
  this.sanitizeURL = sanitize;
  this.removeEmptyString = remove;
}`;

async function record(): Promise<SandboxObject> {
  const result = await run(source);
  if (!isSandboxClosure(result.returnValue) || result.returnValue.construct === undefined)
    throw Error("Expected a constructor");
  return (await result.returnValue.construct([
    "checked",
    3,
    true,
    "checked",
    null,
    false,
    false
  ])) as SandboxObject;
}

it("reuses constructor record descriptors across accounting walks", async () => {
  const value = await record();
  const expected = measureSandboxData([value]);
  const names = vi.spyOn(Object, "getOwnPropertyNames");
  const descriptors = vi.spyOn(Object, "getOwnPropertyDescriptor");
  let actual: number;
  let captures: number;
  try {
    actual = measureSandboxData([value]);
    captures =
      names.mock.calls.filter(([owner]) => owner === value).length +
      descriptors.mock.calls.filter(([owner, key]) => owner === value && typeof key === "string")
        .length;
  } finally {
    names.mockRestore();
    descriptors.mockRestore();
  }
  expect(actual).toBe(expected);
  expect(captures).toBe(0);
});

it("keeps native receiver aliases, property transitions and held quotas live", async () => {
  const value = await record();
  const prototype = getSandboxPrototype(value);
  value.self = value;
  const child = { text: "small" };
  await defineDataProperty(value, "hidden", { value: child, configurable: true }, new Budget());
  const before = measureSandboxData([value]);
  child.text = "x".repeat(1005);
  expect(value.self).toBe(value);
  expect(getSandboxPrototype(value)).toBe(prototype);
  expect(measureSandboxData([value]) - before).toBe(1000);
  for (const held of [false, true]) {
    const budget = new Budget({ dataSize: before + 100 });
    const release = held ? budget.deferReconciliation() : undefined;
    try {
      expect(() => reconcileCompiledValues(budget, [value])).toThrow(
        expect.objectContaining({ code: "budgetExceeded", budget: "dataSize" })
      );
    } finally {
      release?.();
    }
  }
  Reflect.deleteProperty(value, "hidden");
  expect(measureSandboxData([value])).toBeLessThan(before);
});

it("keeps accessor and symbol payloads fresh on constructor instances", async () => {
  const value = await record();
  const key = Symbol("payload");
  let payload = "small";
  const getter = createSandboxClosure({
    call: () => {
      throw Error("getter invoked");
    },
    retainedValues: () => [payload]
  });
  Object.defineProperty(value, "attributeName", { get: accessorAdapter(getter, "get") });
  value[key] = { text: "small" };
  const before = measureSandboxData([value]);
  payload = "x".repeat(1005);
  expect(measureSandboxData([value]) - before).toBe(1000);
  (value[key] as SandboxObject).text = "y".repeat(1005);
  expect(measureSandboxData([value]) - before).toBe(2000);
  Object.freeze(value);
  expect(Reflect.defineProperty(value, "type", { value: 4 })).toBe(false);
  expect(measureSandboxData([value]) - before).toBe(2000);
});

it("preserves an explicit constructor result instead of copying its identity", async () => {
  const result = await run(
    "return function Constructor(replacement) { this.unused = true; return replacement; }"
  );
  if (!isSandboxClosure(result.returnValue) || result.returnValue.construct === undefined)
    throw Error("Expected a constructor");
  const replacement = { retained: "shared" };
  expect(await result.returnValue.construct([replacement])).toBe(replacement);
});
