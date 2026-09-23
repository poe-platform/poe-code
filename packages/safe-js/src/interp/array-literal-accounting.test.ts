import { expect, it, vi } from "vitest";
import { createRealm, defineExtension } from "../core.js";
import { createEvalSource } from "../parse/dynamic-source.js";
import { Budget } from "./budget.js";
import { accessorAdapter } from "./accessors.js";
import { createBuiltinBindings } from "./globals.js";
import { interpret, Scope } from "./interpreter.js";
import {
  markDescriptorObject,
  releaseObjectPrototype,
  setSandboxPrototype
} from "./object-model.js";
import {
  createSandboxClosure,
  measureSandboxData,
  reconcileCompiledValues,
  type SandboxArray
} from "./values.js";

async function array(): Promise<SandboxArray> {
  const { node } = createEvalSource('["first", , "last"];', {});
  const budget = new Budget();
  const scope = new Scope(createBuiltinBindings({ budget })).child({}, { globalEnvironment: true });
  const result = await interpret(
    { type: "BlockStatement", body: node.body, span: node.span },
    { script: { strict: true }, captureSnapshot: false, scope, budget, useScopeDirectly: true }
  );
  releaseObjectPrototype(budget);
  if (!result.ok || !Array.isArray(result.returnValue)) throw Error("Expected array literal");
  setSandboxPrototype(result.returnValue, null);
  return result.returnValue;
}

it("reuses warmed classic array literal descriptors", async () => {
  const value = await array();
  const before = measureSandboxData([value]);
  const names = vi.spyOn(Object, "getOwnPropertyNames");
  const keys = vi.spyOn(Object, "keys");
  const descriptors = vi.spyOn(Object, "getOwnPropertyDescriptor");
  let captures: number, after: number;
  try {
    after = measureSandboxData([value]);
    captures = [names, keys, descriptors].reduce(
      (count, read) => count + read.mock.calls.filter(([owner]) => owner === value).length,
      0
    );
  } finally {
    names.mockRestore();
    keys.mockRestore();
    descriptors.mockRestore();
  }
  expect(after).toBe(before);
  expect(captures).toBe(0);
});

it("invalidates a partly rejected length shrink and native alias mutations", async () => {
  const value = await array();
  value.push("removed");
  Object.defineProperty(value, "2", { configurable: false });
  measureSandboxData([value]);
  expect(Reflect.defineProperty(value, "length", { value: 1 })).toBe(false);
  expect(value.length).toBe(3);
  expect(3 in value).toBe(false);
  const expected = new Array<string>(3);
  expected[0] = "first";
  expected[2] = "last";
  expect(measureSandboxData([value])).toBe(measureSandboxData([expected]));
  delete value[0];
  value[1] = "changed";
  delete expected[0];
  expected[1] = "changed";
  expect(measureSandboxData([value])).toBe(measureSandboxData([expected]));
  Object.freeze(value);
  const frozen = measureSandboxData([value]);
  expect(Reflect.set(value, "1", "rejected")).toBe(false);
  expect(measureSandboxData([value])).toBe(frozen);
});

it.each([false, true])(
  "remeasures array descendants and enforces quotas (held=%s)",
  async (held) => {
    const value = await array();
    const child = { text: "small" };
    value[0] = child;
    value[1] = child;
    const before = measureSandboxData([value]);
    child.text = "x".repeat(1005);
    expect(measureSandboxData([value])).toBe(before + 1000);
    const budget = new Budget({ dataSize: before + 500 });
    const release = held ? budget.deferReconciliation() : undefined;
    try {
      expect(() => reconcileCompiledValues(budget, [value])).toThrow(
        expect.objectContaining({ code: "budgetExceeded", budget: "dataSize" })
      );
    } finally {
      release?.();
    }
  }
);

it.each([false, true])(
  "keeps early array snapshots across prototype callbacks (managed=%s)",
  async (managed) => {
    const value = await array();
    if (managed) markDescriptorObject(value);
    let mutate = false;
    const prototype = createSandboxClosure({
      call: () => undefined,
      retainedValues: () => {
        if (mutate) value[2] = "x".repeat(1004);
        return [];
      }
    });
    setSandboxPrototype(value, prototype);
    const before = measureSandboxData([value]);
    mutate = true;
    expect(measureSandboxData([value])).toBe(before);
    expect(measureSandboxData([value])).toBe(before + 1000);
  }
);

it("refreshes symbols, managed accessors and sparse index growth", async () => {
  const value = await array();
  const symbol = Symbol("array payload");
  const payload = { text: "small" };
  Object.defineProperty(value, symbol, { value: payload, configurable: true });
  markDescriptorObject(value);
  let captured = "small";
  const getter = createSandboxClosure({
    call: () => {
      throw Error("getter must not run during accounting");
    },
    retainedValues: () => [captured]
  });
  Object.defineProperty(value, "0", { get: accessorAdapter(getter, "get"), configurable: true });
  const before = measureSandboxData([value]);
  captured = "x".repeat(1005);
  payload.text = "y".repeat(1005);
  expect(measureSandboxData([value])).toBe(before + 2000);
  Reflect.deleteProperty(value, symbol);
  expect(measureSandboxData([value])).toBeLessThan(before + 1000);
  value[4095] = "tail";
  expect(value.length).toBe(4096);
  const after = measureSandboxData([value]);
  value.length = 3;
  expect(measureSandboxData([value])).toBe(after - 4093 - 9);
});

it("does not expose cached array descriptors through iterator hooks", async () => {
  const value = await array();
  const expected = measureSandboxData([value]);
  const original = Array.prototype[Symbol.iterator];
  let exposed = false;
  let actual: number;
  Array.prototype[Symbol.iterator] = function () {
    if (
      this.length === 2 &&
      typeof this[0] === "string" &&
      this[1] &&
      typeof this[1] === "object" &&
      Object.hasOwn(this[1], "configurable")
    )
      exposed = true;
    return original.call(this);
  };
  try {
    actual = measureSandboxData([value]);
  } finally {
    Array.prototype[Symbol.iterator] = original;
  }
  expect(actual).toBe(expected);
  expect(exposed).toBe(false);
});

it("keeps classic array identity, methods, holes and host copies compatible", async () => {
  const extension = defineExtension({
    manifest: { version: 1, name: "array-copy", globals: ["copy"] },
    setup: () => ({ globals: { copy: (value: unknown) => structuredClone(value) } })
  });
  const realm = createRealm({ classicScripts: true, extensions: [extension] });
  try {
    const result = await realm.evaluate(`var list=["a",,"c"], alias=list;
      list.push("d");list.splice(0,1,"b");list.reverse();
      var copied=copy(list);var cloned=structuredClone(list);
      [list===alias,Array.isArray(list),list.join("-"),copied.join("-"),cloned.join("-"),2 in list];`);
    expect(result).toMatchObject({
      ok: true,
      returnValue: [true, true, "d-c--b", "d-c--b", "d-c--b", false]
    });
    if (!result.ok) throw Error("Expected array result");
    expect(structuredClone(result.returnValue)).toEqual(result.returnValue);
  } finally {
    await realm.close();
  }
});
