import { expect, it, vi } from "vitest";
import { MAX_DATA_DEPTH } from "../graph-depth.js";
import { Budget } from "./budget.js";
import { intrinsicDataRoots } from "./intrinsic-data-roots.js";
import { Scope } from "./scope.js";
import { createSandboxClosure, measureSandboxData, reconcileCompiledValues } from "./values.js";
import { createWeakCollection, setWeakEntry } from "./weak-collection.js";

function fixture(nested: boolean) {
  const scope = new Scope();
  let creations = 0;
  let callbacks = 0;
  const trigger = createSandboxClosure({
    call: () => undefined,
    retainedValues: () => {
      callbacks++;
      scope.lookup("f");
      // Materialization changes the pending binding itself. The callback need
      // not return the resulting function for its new payload to remain live.
      return [];
    }
  });
  scope.declareDeferredFunction("f", "let", () => {
    creations++;
    return createSandboxClosure({ call: () => undefined, properties: { payload: "x".repeat(1000) } });
  }, append => { if (nested) append(trigger); });
  const roots = scope.retainedDataRoots();
  return {
    roots: nested ? roots : [...roots, trigger],
    counts: () => ({ creations, callbacks })
  };
}

it.each([false, true])("charges a function materialized by a later callback (descendant=%s)", nested => {
  const { roots, counts } = fixture(nested);
  const during = measureSandboxData(roots);
  expect(counts()).toEqual({ creations: 1, callbacks: 1 });
  expect(during).toBeGreaterThan(1000);
  // The descendant trigger belongs to the pending initializer, which is
  // released after creation. Its earlier snapshot contributes one extra unit.
  expect(during).toBe(measureSandboxData(roots) + (nested ? 1 : 0));
});

it.each([false, true])("enforces the newly materialized payload quota in the same walk (held=%s)", held => {
  const { roots, counts } = fixture(false);
  const budget = new Budget({ dataSize: 500 });
  const release = held ? budget.deferReconciliation() : undefined;
  try {
    expect(() => reconcileCompiledValues(budget, roots)).toThrow(
      expect.objectContaining({ code: "budgetExceeded", budget: "dataSize" })
    );
  } finally {
    release?.();
  }
  expect(counts()).toEqual({ creations: 1, callbacks: 1 });
});

it("drains materialization that exposes an earlier pending function", () => {
  const scope = new Scope();
  const events: string[] = [];
  scope.declareDeferredFunction("first", "let", () => {
    events.push("first");
    return createSandboxClosure({ call: () => undefined, properties: { payload: "x".repeat(1000) } });
  }, () => {});
  scope.declareDeferredFunction("second", "let", () => {
    events.push("second");
    return createSandboxClosure({
      call: () => undefined,
      retainedValues: () => { scope.lookup("first"); return []; }
    });
  }, () => {});
  const trigger = createSandboxClosure({
    call: () => undefined,
    retainedValues: () => { scope.lookup("second"); return []; }
  });
  const roots = [...scope.retainedDataRoots(), trigger];
  const during = measureSandboxData(roots);
  expect(events).toEqual(["second", "first"]);
  expect(during).toBeGreaterThan(1000);
  expect(during).toBe(measureSandboxData(roots));
});

it("charges weak entries unlocked by the materialized function", () => {
  const scope = new Scope();
  const key = {};
  const map = createWeakCollection("map");
  setWeakEntry(map, key, "x".repeat(1000));
  scope.declareDeferredFunction("f", "let", () => createSandboxClosure({
    call: () => undefined, properties: { key }
  }), () => {});
  const trigger = createSandboxClosure({
    call: () => undefined,
    retainedValues: () => { scope.lookup("f"); return []; }
  });
  const roots = [map, ...scope.retainedDataRoots(), trigger];
  const during = measureSandboxData(roots);
  expect(during).toBeGreaterThan(1000);
  expect(during).toBe(measureSandboxData(roots));
});

it("rechecks functions after final primitive conversion hooks", () => {
  const scope = new Scope();
  scope.declareDeferredFunction("f", "let", () => createSandboxClosure({
    call: () => undefined, properties: { payload: "x".repeat(1000) }
  }), () => {});
  const primitive = {};
  intrinsicDataRoots.set(primitive, { target: {}, values: [1n] });
  const roots = [...scope.retainedDataRoots(), primitive];
  const toString = BigInt.prototype.toString;
  const hook = vi.spyOn(BigInt.prototype, "toString").mockImplementation(function (radix) {
    scope.lookup("f");
    return toString.call(this, radix);
  });
  let during: number;
  try { during = measureSandboxData(roots); }
  finally { hook.mockRestore(); }
  expect(during).toBeGreaterThan(1000);
  expect(during).toBe(measureSandboxData(roots));
});

it.each([false, true])("preserves each late function's original depth (deep first=%s)", deepFirst => {
  const shallow = new Scope();
  const deep = new Scope();
  for (const scope of [shallow, deep])
    scope.declareDeferredFunction("f", "let", () => createSandboxClosure({
      call: () => undefined, properties: { payload: "retained" }
    }), () => {});
  let nested: unknown = deep.retainedDataRoots()[0];
  for (let depth = 0; depth < MAX_DATA_DEPTH; depth++) nested = [nested];
  const trigger = createSandboxClosure({
    call: () => undefined,
    retainedValues: () => { shallow.lookup("f"); deep.lookup("f"); return []; }
  });
  const roots = deepFirst
    ? [nested, ...shallow.retainedDataRoots(), trigger]
    : [...shallow.retainedDataRoots(), nested, trigger];
  expect(() => measureSandboxData(roots)).toThrow(expect.objectContaining({
    code: "budgetExceeded", budget: "dataDepth",
    current: MAX_DATA_DEPTH + 1, limit: MAX_DATA_DEPTH
  }));
});

it("reconciles pending functions discovered while visiting a materialized function", () => {
  const first = new Scope();
  const later = new Scope();
  later.declareDeferredFunction("f", "let", () => createSandboxClosure({
    call: () => undefined, properties: { payload: "x".repeat(1000) }
  }), () => {});
  const materializeLater = createSandboxClosure({
    call: () => undefined,
    retainedValues: () => { later.lookup("f"); return []; }
  });
  first.declareDeferredFunction("f", "let", () => createSandboxClosure({
    call: () => undefined,
    retainedValues: () => [...later.retainedDataRoots(), materializeLater]
  }), () => {});
  const trigger = createSandboxClosure({
    call: () => undefined,
    retainedValues: () => { first.lookup("f"); return []; }
  });
  const roots = [...first.retainedDataRoots(), trigger];
  const during = measureSandboxData(roots);
  expect(during).toBeGreaterThan(1000);
  expect(during).toBe(measureSandboxData(roots));
});
