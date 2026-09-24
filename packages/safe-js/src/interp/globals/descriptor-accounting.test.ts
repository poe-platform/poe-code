import { afterEach, expect, it, vi } from "vitest";
import { run } from "../../run.js";
import { accessorAdapter } from "../accessors.js";
import { Budget } from "../budget.js";
import { setSandboxPrototype } from "../object-model.js";
import { createSandboxClosure, measureSandboxData, reconcileCompiledValues } from "../values.js";
import { exposePropertyDescriptor } from "./object-array.js";

afterEach(() => vi.restoreAllMocks());

it.each([
  "Object.getOwnPropertyDescriptor({ item: 1 }, 'item')",
  "Reflect.getOwnPropertyDescriptor({ item: 1 }, 'item')",
  "Object.getOwnPropertyDescriptors({ item: 1 }).item"
])("reuses unchanged descriptor result storage: %s", async (expression) => {
  const result = (await run(`return ${expression}`)).returnValue;
  const expected = measureSandboxData([result]);
  const inspect = vi.spyOn(Object, "getOwnPropertyDescriptor");
  for (let index = 0; index < 5; index++) expect(measureSandboxData([result])).toBe(expected);
  expect(inspect.mock.calls.filter(([target]) => target === result)).toHaveLength(0);
});

it("copies descriptor storage while preserving its mutable value identity", () => {
  const child = { text: "small" };
  const descriptor = { value: child, writable: true, enumerable: true, configurable: true };
  const result = exposePropertyDescriptor(descriptor, new Budget());
  const before = measureSandboxData([result]);
  descriptor.value = { text: "foreign" };
  expect(result.value).toBe(child);
  child.text = "x".repeat(1005);
  expect(measureSandboxData([result])).toBe(before + 1000);
  result.writable = false;
  expect(descriptor.writable).toBe(true);
});

it.each([false, true])("charges native descriptor result edits (held=%s)", (held) => {
  const result = exposePropertyDescriptor({ value: "small", writable: true }, new Budget());
  const before = measureSandboxData([result]);
  const budget = new Budget({ dataSize: before + 1000 });
  const release = held ? budget.deferReconciliation() : undefined;
  try {
    Object.defineProperty(result, "value", { value: "x".repeat(2000) });
    expect(() => reconcileCompiledValues(budget, [result])).toThrowError(
      expect.objectContaining({ code: "budgetExceeded", budget: "dataSize" })
    );
  } finally {
    release?.();
  }
});

it.each([false, true])(
  "observes reentrant prototype edits before descriptor capture (held=%s)",
  (held) => {
    const result = exposePropertyDescriptor({ value: "small" }, new Budget());
    let mutate = false;
    setSandboxPrototype(
      result,
      createSandboxClosure({
        call: () => undefined,
        retainedValues: () => {
          if (mutate) {
            mutate = false;
            measureSandboxData([result]);
            result.value = "x".repeat(2000);
          }
          return [];
        }
      })
    );
    const before = measureSandboxData([result]);
    const budget = new Budget({ dataSize: before + 1000 });
    const release = held ? budget.deferReconciliation() : undefined;
    try {
      mutate = true;
      expect(() => reconcileCompiledValues(budget, [result])).toThrowError(
        expect.objectContaining({ code: "budgetExceeded", budget: "dataSize" })
      );
      expect(mutate).toBe(false);
    } finally {
      release?.();
    }
  }
);

it("preserves accessor capture order when an earlier callback replaces a later descriptor field", () => {
  const order: string[] = [];
  let mutate = false;
  const replacement = createSandboxClosure({
    call: () => undefined,
    retainedValues: () => {
      order.push("new");
      return ["x".repeat(2000)];
    }
  });
  const setter = createSandboxClosure({
    call: () => undefined,
    retainedValues: () => {
      order.push("old");
      return [];
    }
  });
  const getter = createSandboxClosure({
    call: () => undefined,
    retainedValues: () => {
      order.push("get");
      if (mutate) {
        mutate = false;
        result.set = replacement;
      }
      return [];
    }
  });
  const result = exposePropertyDescriptor(
    {
      get: accessorAdapter(getter, "get"),
      set: accessorAdapter(setter, "set"),
      enumerable: true,
      configurable: true
    },
    new Budget()
  );
  expect(result.get).toBe(getter);
  expect(result.set).toBe(setter);
  const before = measureSandboxData([result]);
  order.length = 0;
  mutate = true;
  expect(measureSandboxData([result])).toBe(before);
  expect(order).toEqual(["get", "old"]);
  order.length = 0;
  expect(measureSandboxData([result])).toBe(before + 2000);
  expect(order).toEqual(["get", "new"]);
});

it("preserves descriptor aliases, cycles, deletion and symbol data", () => {
  const child = { text: "small" };
  const result = exposePropertyDescriptor({ value: child }, new Budget());
  result.alias = child;
  result.self = result;
  const before = measureSandboxData([result]);
  child.text = "x".repeat(1005);
  expect(measureSandboxData([result])).toBe(before + 1000);
  delete result.alias;
  expect(measureSandboxData([result])).toBe(before + 994);
  const key = Symbol("payload");
  Object.defineProperty(result, key, { value: "x".repeat(2000), configurable: true });
  expect(measureSandboxData([result])).toBeGreaterThan(before + 2994);
  Reflect.deleteProperty(result, key);
  expect(measureSandboxData([result])).toBe(before + 994);
});
