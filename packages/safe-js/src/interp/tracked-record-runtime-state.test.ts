import { afterEach, expect, it, vi } from "vitest";
import { Budget } from "./budget.js";
import { restoreSandboxArrayIterator } from "./array-iterator.js";
import { hostFunctionMetadata } from "./host-function-metadata.js";
import { addPrivateElement } from "./private-state.js";
import { createIntrinsicObject, setSandboxPrototype } from "./object-model.js";
import { createSandboxClosure, measureSandboxData, reconcileCompiledValues } from "./values.js";

afterEach(() => vi.restoreAllMocks());

it("preserves one metadata observation when accessors require descriptor capture", () => {
  const record = createIntrinsicObject();
  Object.defineProperty(record, "text", { get: () => "small", enumerable: true });
  const before = measureSandboxData([record]);
  const inspect = vi.spyOn(hostFunctionMetadata, "get");
  expect(measureSandboxData([record])).toBe(before);
  expect(inspect.mock.calls.filter(([value]) => value === record)).toHaveLength(1);
});

it.each([false, true])(
  "captures record fields after prototype providers mutate them (held=%s)",
  (held) => {
    const record = createIntrinsicObject({ text: "small" });
    let grow = false;
    const prototype = createSandboxClosure({
      call: () => undefined,
      retainedValues: () => {
        if (grow) {
          grow = false;
          record.text = "x".repeat(1005);
        }
        return [];
      }
    });
    setSandboxPrototype(record, prototype);
    const before = measureSandboxData([record]);
    grow = true;
    expect(measureSandboxData([record])).toBe(before + 1000);
    record.text = "small";
    const budget = new Budget({ dataSize: before + 500 });
    const release = held ? budget.deferReconciliation() : undefined;
    try {
      grow = true;
      expect(() => reconcileCompiledValues(budget, [record])).toThrowError(
        expect.objectContaining({ code: "budgetExceeded", budget: "dataSize" })
      );
    } finally {
      release?.();
    }
  }
);

it.each([false, true])("keeps private record payloads live under quotas (held=%s)", (held) => {
  const payload = { text: "small" };
  const record = createIntrinsicObject({ payload });
  addPrivateElement(record, { description: "payload" }, { kind: "field", value: payload });
  const before = measureSandboxData([record]);
  expect(measureSandboxData([record, payload])).toBe(before);
  payload.text = "x".repeat(1005);
  expect(measureSandboxData([record])).toBe(before + 1000);
  const budget = new Budget({ dataSize: before + 500 });
  const release = held ? budget.deferReconciliation() : undefined;
  try {
    expect(() => reconcileCompiledValues(budget, [record])).toThrowError(
      expect.objectContaining({ code: "budgetExceeded", budget: "dataSize" })
    );
  } finally {
    release?.();
  }
});

it.each([
  { held: false, late: false },
  { held: true, late: false },
  { held: false, late: true },
  { held: true, late: true }
])("retains native inherited closure captures (held=$held, late=$late)", ({ held, late }) => {
  const prototype = createSandboxClosure({
    call: () => undefined,
    retainedValues: () => ["x".repeat(1000)]
  });
  const record = late ? createIntrinsicObject() : createIntrinsicObject(Object.create(prototype));
  if (late) Object.setPrototypeOf(record, prototype);
  expect(measureSandboxData([record])).toBe(1001);
  const budget = new Budget({ dataSize: 500 });
  const release = held ? budget.deferReconciliation() : undefined;
  try {
    expect(() => reconcileCompiledValues(budget, [record])).toThrowError(
      expect.objectContaining({ code: "budgetExceeded", budget: "dataSize" })
    );
  } finally {
    release?.();
  }
});

it.each([false, true])("retains restored iterator payloads on owned targets (held=%s)", (held) => {
  const record = restoreSandboxArrayIterator(
    { source: { payload: "x".repeat(1000) }, index: 0, method: "values" },
    createIntrinsicObject()
  );
  expect(measureSandboxData([record])).toBe(1010);
  const budget = new Budget({ dataSize: 500 });
  const release = held ? budget.deferReconciliation() : undefined;
  try {
    expect(() => reconcileCompiledValues(budget, [record])).toThrowError(
      expect.objectContaining({ code: "budgetExceeded", budget: "dataSize" })
    );
  } finally {
    release?.();
  }
});
