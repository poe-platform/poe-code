import { afterEach, expect, it, vi } from "vitest";
import { Budget, SandboxError } from "./budget.js";
import { createSandboxCollator, collatorState, isSandboxCollator } from "./intl-collator.js";
import { createSandboxDateTimeFormat, dateTimeFormatState } from "./intl-datetimeformat.js";
import { createSandboxNumberFormat, numberFormatState } from "./intl-numberformat.js";
import { createSandboxTemporalInstant, isSandboxTemporalInstant } from "./temporal-instant.js";
import { createSandboxClosure, measureSandboxData, reconcileCompiledValues } from "./values.js";

afterEach(() => vi.restoreAllMocks());

// Existing native membership hooks can observe a private state table. State
// installed through that table must remain visible to later accounting walks.
function observeTable(value: object, classify: (value: unknown) => boolean) {
  const has = WeakMap.prototype.has;
  const observed: { table?: WeakMap<object, unknown> } = {};
  const hook = vi.spyOn(WeakMap.prototype, "has").mockImplementation(function (
    this: WeakMap<object, unknown>, key: object
  ) {
    if (key === value) observed.table = this;
    return has.call(this, key);
  });
  try { expect(classify(value)).toBe(true); }
  finally { hook.mockRestore(); }
  expect(observed.table).toBeDefined();
  return observed.table!;
}

it.each([false, true])("charges state installed by a native provider, including aliases (held=%s)", held => {
  const instant = createSandboxTemporalInstant(255n);
  const formatter = createSandboxCollator("en", {});
  const epochs = observeTable(instant, isSandboxTemporalInstant);
  const collators = observeTable(formatter, isSandboxCollator);
  const state = collatorState(formatter);
  const target = Object.create(null);
  const provider = createSandboxClosure({
    call: () => undefined,
    retainedValues: () => {
      epochs.set(target, 255n);
      collators.set(target, state);
      return [target, target];
    }
  });
  const expected = 4 + measureSandboxData([state.options]);
  expect(measureSandboxData([provider, target, state.options])).toBe(expected);
  for (const limit of [expected, expected - 1]) {
    const budget = new Budget({ dataSize: limit });
    const release = held ? budget.deferReconciliation() : () => undefined;
    try {
      const reconcile = () => reconcileCompiledValues(budget, [provider, target, state.options]);
      if (limit === expected) expect(reconcile).not.toThrow();
      else expect(reconcile).toThrow(SandboxError);
    } finally { release(); }
  }
});

it("observes Temporal conversion before later Intl state, including a reentrant walk", () => {
  const instant = createSandboxTemporalInstant(255n);
  const formatter = createSandboxCollator("en", {});
  const table = observeTable(formatter, isSandboxCollator);
  const state = collatorState(formatter);
  table.set(instant, state);
  const before = measureSandboxData([instant]);
  const localeLength = state.options.locale.length;
  const stringify = BigInt.prototype.toString;
  const get = WeakMap.prototype.get;
  const events: string[] = [];
  let nested = 0;
  vi.spyOn(BigInt.prototype, "toString").mockImplementation(function (this: bigint, radix) {
    events.push("epoch");
    state.options.locale = "x".repeat(localeLength + 1000);
    nested = measureSandboxData([{ text: "nested" }]);
    return stringify.call(this, radix);
  });
  vi.spyOn(WeakMap.prototype, "get").mockImplementation(function (
    this: WeakMap<object, unknown>, key: object
  ) {
    if (this === table && key === instant) events.push("intl-state");
    return get.call(this, key);
  });
  expect(measureSandboxData([instant])).toBe(before + 1000);
  expect(nested).toBe(12);
  expect(events).toEqual(["epoch", "intl-state"]);
});

it.each(["number", "date", "collator"] as const)("keeps mutable %s bound captures fresh", kind => {
  const formatter = kind === "number" ? createSandboxNumberFormat("en", {})
    : kind === "date" ? createSandboxDateTimeFormat("en", { timeZone: "UTC" })
    : createSandboxCollator("en", {});
  const payload = { text: "small" };
  const bound = createSandboxClosure({ call: () => undefined, retainedValues: () => [payload] });
  if (kind === "number") numberFormatState(formatter).format = bound;
  else if (kind === "date") dateTimeFormatState(formatter).format = bound;
  else collatorState(formatter).compare = bound;
  const before = measureSandboxData([formatter]);
  expect(measureSandboxData([formatter, bound, payload])).toBe(before);
  payload.text = "x".repeat(1005);
  expect(measureSandboxData([formatter])).toBe(before + 1000);
  expect(() => reconcileCompiledValues(new Budget({ dataSize: before + 500 }), [formatter]))
    .toThrow(SandboxError);
});
