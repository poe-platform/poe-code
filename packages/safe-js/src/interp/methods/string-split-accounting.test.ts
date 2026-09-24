import { afterEach, expect, it, vi } from "vitest";
import { Budget } from "../budget.js";
import { createIntrinsicArray } from "../object-model.js";
import {
  measureSandboxData,
  reconcileCompiledValues,
  type SandboxArray,
  type SandboxCallContext
} from "../values.js";
import { callStringMethod } from "./string.js";

afterEach(() => vi.restoreAllMocks());

const context: SandboxCallContext = {
  stack: [],
  thisValue: undefined,
  getProperty: () => undefined
};

function split(separator: string | undefined, budget = new Budget()): SandboxArray {
  const result = callStringMethod(
    "left,right",
    "split",
    [separator],
    budget,
    undefined,
    undefined,
    context
  );
  if (!Array.isArray(result)) throw new Error("Expected a synchronous split array");
  return result;
}

it.each([",", "", undefined])("reuses native split descriptors for separator %j", (separator) => {
  const result = split(separator);
  const before = measureSandboxData([result]);
  const inspect = vi.spyOn(Object, "getOwnPropertyDescriptor");
  for (let index = 0; index < 5; index++) expect(measureSandboxData([result])).toBe(before);
  expect(inspect.mock.calls.filter(([target]) => target === result)).toHaveLength(0);
});

it("copies initial array descriptors without exposing source aliases or reading accessors", () => {
  const child = { text: "small" };
  const source: SandboxArray = new Array(4);
  source[1] = child;
  const getter = vi.fn(() => child);
  Object.defineProperty(source, "2", { get: getter, enumerable: true, configurable: true });
  Object.defineProperty(source, "3", { value: "tail", writable: false, configurable: true });
  const symbol = Symbol("child");
  Object.defineProperty(source, symbol, { value: child, configurable: true });
  const result = createIntrinsicArray(source);
  expect(Object.getOwnPropertyDescriptors(result)).toEqual(
    Object.getOwnPropertyDescriptors(source)
  );
  expect(Object.getPrototypeOf(result)).toBe(Object.getPrototypeOf(source));
  expect(getter).not.toHaveBeenCalled();
  const before = measureSandboxData([result]);
  source[1] = "foreign";
  expect(result[1]).toBe(child);
  child.text = "x".repeat(1005);
  expect(measureSandboxData([result])).toBe(before + 1000);
  expect(getter).not.toHaveBeenCalled();
});

it.each([false, true])("observes mutations through an array iterator alias (held=%s)", (held) => {
  const iterate = Array.prototype[Symbol.iterator];
  const aliases: SandboxArray[] = [];
  let result: SandboxArray;
  Array.prototype[Symbol.iterator] = function () {
    if (this.length === 2 && this[0] === "left" && this[1] === "right") aliases.push(this);
    return Reflect.apply(iterate, this, []);
  };
  try {
    result = split(",");
  } finally {
    Array.prototype[Symbol.iterator] = iterate;
  }
  const alias = aliases[0];
  expect(alias).toBe(result);
  const before = measureSandboxData([result]);
  const budget = new Budget({ dataSize: before + 1000 });
  const release = held ? budget.deferReconciliation() : undefined;
  try {
    alias![0] = "x".repeat(2000);
    expect(() => reconcileCompiledValues(budget, [result])).toThrowError(
      expect.objectContaining({ code: "budgetExceeded", budget: "dataSize" })
    );
  } finally {
    release?.();
  }
});

it("preserves arrays returned by a replaced native split method", () => {
  const native = String.prototype.split;
  const foreign = ["foreign"];
  let calls = 0;
  vi.spyOn(String.prototype, "split").mockImplementation(function (this: string, separator, limit) {
    if (String(this) === "left,right") {
      calls++;
      return foreign;
    }
    return Reflect.apply(native, this, [separator, limit]);
  });
  const result = split(",");
  vi.restoreAllMocks();
  expect(calls).toBe(1);
  expect(result).toBe(foreign);
  const before = measureSandboxData([result]);
  foreign[0] = "x".repeat(1007);
  expect(measureSandboxData([result])).toBe(before + 1000);
});

it.each([
  ["String.prototype", String.prototype],
  ["Object.prototype", Object.prototype]
] as const)("preserves shared native Symbol.split results on %s", (_name, prototype) => {
  const original = Object.getOwnPropertyDescriptor(prototype, Symbol.split);
  const foreign = ["foreign"];
  let calls = 0;
  let result: SandboxArray;
  Object.defineProperty(prototype, Symbol.split, {
    configurable: true,
    value: () => {
      calls++;
      return foreign;
    }
  });
  try {
    result = split(",");
  } finally {
    if (original === undefined) Reflect.deleteProperty(prototype, Symbol.split);
    else Object.defineProperty(prototype, Symbol.split, original);
  }
  expect(calls).toBe(1);
  expect(result).toBe(foreign);
  const before = measureSandboxData([result]);
  foreign[0] = "x".repeat(1007);
  expect(measureSandboxData([result])).toBe(before + 1000);
});

it("checks native hook ownership after reading the split method getter", () => {
  const native = Object.getOwnPropertyDescriptor(String.prototype, "split")!;
  const hook = Object.getOwnPropertyDescriptor(String.prototype, Symbol.split);
  const foreign = ["foreign"];
  let reads = 0;
  let result: SandboxArray;
  Object.defineProperty(String.prototype, "split", {
    configurable: true,
    get() {
      reads++;
      Object.defineProperty(String.prototype, Symbol.split, {
        configurable: true,
        value: () => foreign
      });
      return native.value;
    }
  });
  try {
    result = split(",");
  } finally {
    Object.defineProperty(String.prototype, "split", native);
    if (hook === undefined) Reflect.deleteProperty(String.prototype, Symbol.split);
    else Object.defineProperty(String.prototype, Symbol.split, hook);
  }
  expect(reads).toBe(1);
  expect(result).toBe(foreign);
});

it("preserves native Symbol.split dispatch through an altered prototype chain", () => {
  const prototype = Object.getPrototypeOf(String.prototype);
  const foreign = ["foreign"];
  let calls = 0;
  let result: SandboxArray;
  const proxy = new Proxy(Object.create(prototype), {
    get(target, key, receiver) {
      if (key === Symbol.split) {
        calls++;
        return () => foreign;
      }
      return Reflect.get(target, key, receiver);
    }
  });
  Object.setPrototypeOf(String.prototype, proxy);
  try {
    result = split(",");
  } finally {
    Object.setPrototypeOf(String.prototype, prototype);
  }
  expect(calls).toBe(1);
  expect(result).toBe(foreign);
});

it("invalidates array captures after an unsuccessful native length shrink", () => {
  const result = split(",");
  Object.defineProperty(result, "0", { configurable: false });
  const before = measureSandboxData([result]);
  expect(Reflect.defineProperty(result, "length", { value: 0 })).toBe(false);
  expect(result.length).toBe(1);
  expect(measureSandboxData([result])).toBe(before - 6);
});
