import { expect, it, vi } from "vitest";
import { Budget } from "./budget.js";
import { registerIndexedClosureCaptures } from "./indexed-closure-captures.js";
import { createSandboxClosure, measureSandboxData, reconcileCompiledValues } from "./values.js";

const { reads } = vi.hoisted(() => ({ reads: new Map<object, number>() }));

// Count lookups at the existing private visited-state boundary, without changing
// its membership, generations or reentrant behavior.
vi.mock("./measurement-seen.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./measurement-seen.js")>();
  return {
    ...original,
    withMeasurementSeen<T>(
      measure: (seen: import("./measurement-seen.js").MeasurementSeen) => T
    ): T {
      return original.withMeasurementSeen((seen) =>
        measure({
          has(value) {
            reads.set(value, (reads.get(value) ?? 0) + 1);
            return seen.has(value);
          },
          add(value) {
            seen.add(value);
          }
        })
      );
    }
  };
});

it.each([4, 16])("bounds repeated lookups for %s scope roots while calling every collector afresh", count => {
  const roots = Array.from({ length: count }, () => ({ text: "old" }));
  let collections = 0;
  const closures = Array.from({ length: 100 }, () => {
    const closure = createSandboxClosure({ call: () => undefined });
    registerIndexedClosureCaptures(closure, (append) => {
      collections++;
      for (const root of roots) append(root);
      append("abc");
    });
    return closure;
  });
  reads.clear();
  const before = measureSandboxData([...roots, ...closures]);
  expect(collections).toBe(100);
  // One initial visit and one confirmed positive capture lookup per identity.
  for (const root of roots) expect(reads.get(root)).toBe(2);
  roots[0]!.text = "x".repeat(1003);
  reads.clear();
  expect(measureSandboxData([...roots, ...closures])).toBe(before + 1000);
  expect(collections).toBe(200);
  for (const root of roots) expect(reads.get(root)).toBe(2);
});

it("keeps unvisited aliases and later captures even when earlier identities are pending", () => {
  const payload = { text: "x".repeat(1000) };
  const child = createSandboxClosure({ call: () => undefined });
  registerIndexedClosureCaptures(child, (append) => {
    append(payload);
    append("abc");
  });
  const parent = createSandboxClosure({ call: () => undefined });
  registerIndexedClosureCaptures(parent, (append) => {
    append(child);
    append(payload);
    append("tail");
  });
  expect(measureSandboxData([parent])).toBe(1015);
});

it.each([false, true])("still enforces changed roots under quotas (held=%s)", (held) => {
  const payload = { text: "old" };
  const closure = createSandboxClosure({ call: () => undefined });
  registerIndexedClosureCaptures(closure, (append) => {
    append(payload);
    append(payload);
  });
  const before = measureSandboxData([payload, closure]);
  payload.text = "x".repeat(1003);
  const budget = new Budget({ dataSize: before + 500 });
  const release = held ? budget.deferReconciliation() : undefined;
  try {
    expect(() => reconcileCompiledValues(budget, [payload, closure])).toThrow(
      expect.objectContaining({ code: "budgetExceeded", budget: "dataSize" })
    );
  } finally {
    release?.();
  }
});

it("isolates positive capture observations across reentrant measurements and failures", () => {
  const payload = { text: "x".repeat(1000) };
  const failure = new Error("collector failed");
  let fails = true;
  let nested = -1;
  const closure = createSandboxClosure({ call: () => undefined });
  registerIndexedClosureCaptures(closure, (append) => {
    append(payload);
    nested = measureSandboxData([payload]);
    append(payload);
    if (fails) throw failure;
    append("abc");
  });
  expect(() => measureSandboxData([payload, closure])).toThrow(failure);
  fails = false;
  expect(measureSandboxData([payload, closure])).toBe(1010);
  expect(nested).toBe(1006);
  payload.text += "grown";
  expect(measureSandboxData([payload, closure])).toBe(1015);
});
