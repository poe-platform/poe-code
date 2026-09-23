import { afterEach, expect, it, vi } from "vitest";
import { accessorAdapter, accessorClosure, retainedAccessorClosures } from "./accessors.js";
import { Budget } from "./budget.js";
import { createSandboxClosure, measureSandboxData, reconcileCompiledValues } from "./values.js";

afterEach(() => vi.restoreAllMocks());

it.each(["get", "set"] as const)("keeps %s adapter insertion private", (kind) => {
  const closure = createSandboxClosure({ call: () => undefined });
  const get = vi.spyOn(WeakMap.prototype, "get");
  const set = vi.spyOn(WeakMap.prototype, "set");
  const first = accessorAdapter(closure, kind);
  const second = accessorAdapter(closure, kind);
  const reads = get.mock.calls.filter(([key]) => key === closure || key === first);
  const writes = set.mock.calls.filter(([key]) => key === closure || key === first);
  get.mockRestore();
  set.mockRestore();
  expect(second).toBe(first);
  expect(accessorClosure(first)).toBe(closure);
  expect(reads).toHaveLength(0);
  expect(writes).toHaveLength(0);
});

it.each([
  { kind: "get" as const, held: false },
  { kind: "get" as const, held: true },
  { kind: "set" as const, held: false },
  { kind: "set" as const, held: true }
])("retains $kind captures despite later native read hooks (held=$held)", ({ kind, held }) => {
  const payload = { text: "small" };
  const closure = createSandboxClosure({ call: () => undefined, retainedValues: () => [payload] });
  const adapter = accessorAdapter(closure, kind);
  const descriptor = { [kind]: adapter, enumerable: true };
  const root = Object.defineProperty({}, "field", descriptor);
  const before = measureSandboxData([root]);
  const budget = new Budget({ dataSize: before + 100 });
  const release = held ? budget.deferReconciliation() : undefined;
  const nativeGet = WeakMap.prototype.get;
  vi.spyOn(WeakMap.prototype, "get").mockImplementation(function (
    this: WeakMap<object, unknown>,
    key: object
  ) {
    return key === adapter ? undefined : nativeGet.call(this, key);
  });
  try {
    payload.text = "x".repeat(1005);
    expect(() => reconcileCompiledValues(budget, [root])).toThrow(
      expect.objectContaining({ code: "budgetExceeded", budget: "dataSize" })
    );
    expect(retainedAccessorClosures(descriptor)).toEqual([closure]);
    expect(measureSandboxData([root])).toBe(before + 1000);
  } finally {
    vi.restoreAllMocks();
    release?.();
  }
});
