import { expect, it, vi } from "vitest";
import { Budget } from "../budget.js";
import { accessorAdapter } from "../accessors.js";
import { getSandboxPrototype, markDescriptorObject } from "../object-model.js";
import {
  createSandboxClosure,
  measureSandboxData,
  reconcileCompiledValues,
  type SandboxClosure,
  type SandboxObject
} from "../values.js";
import { createObjectArrayGlobals } from "./object-array.js";

async function create(prototype: SandboxObject | null = null): Promise<SandboxObject> {
  const globals = createObjectArrayGlobals({ budget: new Budget() });
  const method = (globals.Object as SandboxClosure).properties!.create as SandboxClosure;
  return (await method.call([
    prototype,
    {
      visible: { value: "abc", writable: true, enumerable: true, configurable: true },
      hidden: { value: "xyz", writable: true, configurable: true }
    }
  ])) as SandboxObject;
}

it("reuses Object.create property snapshots across repeated accounting walks", async () => {
  const value = await create();
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

it("keeps native descriptor changes, descendants and held quotas live", async () => {
  const prototype = { inherited: "shared" };
  const value = await create(prototype);
  expect(getSandboxPrototype(value)).toBe(prototype);
  const plain = Object.create(null, Object.getOwnPropertyDescriptors(value)) as SandboxObject;
  markDescriptorObject(plain);
  // Compare own property accounting without the deliberately shared prototype.
  const initial = measureSandboxData([value]);
  const ownInitial = measureSandboxData([plain]);
  const child = { text: "small" };
  for (const target of [value, plain]) {
    Object.defineProperty(target, "hidden", { value: child });
    Reflect.deleteProperty(target, "visible");
  }
  expect(measureSandboxData([value]) - initial).toBe(measureSandboxData([plain]) - ownInitial);
  const before = measureSandboxData([value]);
  child.text = "x".repeat(1005);
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
});

it("reads accessor captures freshly after warming Object.create snapshots", async () => {
  const value = await create();
  measureSandboxData([value]);
  let payload = "small";
  const getter = createSandboxClosure({
    call: () => {
      throw Error("getter invoked");
    },
    retainedValues: () => [payload]
  });
  Object.defineProperty(value, "hidden", { get: accessorAdapter(getter, "get") });
  const before = measureSandboxData([value]);
  payload = "x".repeat(1005);
  expect(measureSandboxData([value]) - before).toBe(1000);
  Object.freeze(value);
  expect(Reflect.defineProperty(value, "hidden", { value: "replacement" })).toBe(false);
  expect(measureSandboxData([value])).toBe(before + 1000);
});
