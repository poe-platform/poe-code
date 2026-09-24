import { afterEach, expect, it, vi } from "vitest";
import { Budget } from "./budget.js";
import { wrapCallerInjectedBindings } from "./host-bridge.js";
import { hostFunctionMetadata } from "./host-function-metadata.js";
import { setSandboxPrototype } from "./object-model.js";
import {
  createSandboxClosure,
  measureSandboxData,
  reconcileCompiledValues,
  type SandboxClosure
} from "./values.js";

afterEach(() => vi.restoreAllMocks());

function fixture() {
  function service(value: unknown) {
    return value;
  }
  Object.defineProperty(service, "self", { value: service });
  const wrapped = wrapCallerInjectedBindings({ service }, { budget: new Budget() })
    .service as SandboxClosure;
  return { service, wrapped, properties: wrapped.properties! };
}

it("reuses copied function descriptors during unchanged accounting walks", () => {
  const { wrapped, properties } = fixture();
  const before = measureSandboxData([wrapped]);
  const inspect = vi.spyOn(Object, "getOwnPropertyDescriptor");
  for (let index = 0; index < 5; index++) expect(measureSandboxData([wrapped])).toBe(before);
  expect(inspect.mock.calls.filter(([target]) => target === properties)).toHaveLength(0);
});

it("preserves copied method aliases, metadata, and separation from the host function", () => {
  const { service, wrapped, properties } = fixture();
  expect(properties.self).toBe(wrapped);
  expect(Object.getOwnPropertyDescriptor(properties, "name")).toEqual(
    Object.getOwnPropertyDescriptor(service, "name")
  );
  expect(Object.getOwnPropertyDescriptor(properties, "length")).toEqual(
    Object.getOwnPropertyDescriptor(service, "length")
  );
  Object.defineProperty(service, "name", { value: "hostChanged" });
  expect(properties.name).toBe("service");
  Object.defineProperty(properties, "name", { value: "guestChanged" });
  expect(service.name).toBe("hostChanged");
  expect(wrapped.properties).toBe(properties);
});

it.each([false, true])("charges native edits to copied function metadata (held=%s)", (held) => {
  const { wrapped, properties } = fixture();
  const before = measureSandboxData([wrapped]);
  const budget = new Budget({ dataSize: before + 1000 });
  const release = held ? budget.deferReconciliation() : undefined;
  try {
    Object.defineProperty(properties, "name", { value: "x".repeat(2000) });
    expect(() => reconcileCompiledValues(budget, [wrapped])).toThrowError(
      expect.objectContaining({ code: "budgetExceeded", budget: "dataSize" })
    );
  } finally {
    release?.();
  }
});

it("observes fresh metadata baselines after descriptor reuse", () => {
  const { wrapped, properties } = fixture();
  const before = measureSandboxData([wrapped]);
  Object.defineProperty(properties, "name", { value: "x".repeat(2000) });
  expect(measureSandboxData([wrapped])).toBeGreaterThan(before + 2000);
  const metadata = hostFunctionMetadata.get(properties)!;
  hostFunctionMetadata.set(
    properties,
    new Map([...metadata, ["name", Object.getOwnPropertyDescriptor(properties, "name")!]])
  );
  expect(measureSandboxData([wrapped])).toBe(before);
});

it.each([false, true])(
  "reads copied properties after a reentrant prototype provider (held=%s)",
  (held) => {
    const { wrapped, properties } = fixture();
    properties.payload = { text: "small" };
    let mutate = false;
    const prototype = createSandboxClosure({
      call: () => undefined,
      retainedValues: () => {
        if (mutate) {
          mutate = false;
          measureSandboxData([wrapped]);
          properties.payload = { text: "x".repeat(2000) };
        }
        return [];
      }
    });
    setSandboxPrototype(properties, prototype);
    const before = measureSandboxData([wrapped]);
    const budget = new Budget({ dataSize: before + 1000 });
    const release = held ? budget.deferReconciliation() : undefined;
    try {
      mutate = true;
      expect(() => reconcileCompiledValues(budget, [wrapped])).toThrowError(
        expect.objectContaining({ code: "budgetExceeded", budget: "dataSize" })
      );
      expect(mutate).toBe(false);
    } finally {
      release?.();
    }
  }
);
