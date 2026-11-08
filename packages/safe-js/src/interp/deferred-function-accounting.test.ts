import { expect, it } from "vitest";
import { Budget } from "./budget.js";
import { Scope } from "./scope.js";
import { createSandboxClosure, measureSandboxData, reconcileCompiledValues } from "./values.js";

it("keeps one identity across aliases and older scope-root snapshots", () => {
  const scope = new Scope();
  let creations = 0;
  scope.declareDeferredFunction(
    "f",
    "let",
    () => {
      creations++;
      return createSandboxClosure({ call: () => undefined });
    },
    () => {}
  );
  scope.declareAlias("alias", "f");
  const before = scope.retainedDataRoots();
  expect(measureSandboxData(before)).toBe(1);
  expect(creations).toBe(0);
  const first = scope.lookup("alias");
  const second = scope.child().lookup("f");
  expect(first.found && second.found && first.value === second.value).toBe(true);
  expect(creations).toBe(1);
  expect(
    measureSandboxData([
      ...before,
      ...scope.retainedDataRoots(),
      first.found ? first.value : undefined
    ])
  ).toBe(1);
});

it.each([false, true])("remeasures pending captures under quotas (held=%s)", (held) => {
  const scope = new Scope();
  const payload = { text: "old" };
  let collections = 0;
  let creations = 0;
  scope.declareDeferredFunction(
    "f",
    "let",
    () => {
      creations++;
      return createSandboxClosure({ call: () => undefined, retainedValues: () => [payload] });
    },
    (append) => {
      collections++;
      append(payload);
    }
  );
  const before = measureSandboxData(scope.retainedDataRoots());
  expect(collections).toBe(1);
  payload.text = "x".repeat(1003);
  const budget = new Budget({ dataSize: before + 500 });
  const release = held ? budget.deferReconciliation() : undefined;
  try {
    expect(() => reconcileCompiledValues(budget, scope.retainedDataRoots())).toThrow(
      expect.objectContaining({ code: "budgetExceeded", budget: "dataSize" })
    );
  } finally {
    release?.();
  }
  expect(collections).toBe(2);
  expect(creations).toBe(0);
  expect(measureSandboxData(scope.retainedDataRoots())).toBe(before + 1000);
});

it("overwrites an unused function without creating it and preserves older captures", () => {
  const scope = new Scope();
  const payload = { text: "old" };
  let creations = 0;
  scope.declareDeferredFunction(
    "f",
    "let",
    () => {
      creations++;
      return createSandboxClosure({ call: () => undefined, retainedValues: () => [payload] });
    },
    (append) => append(payload)
  );
  const before = scope.retainedDataRoots();
  const units = measureSandboxData(before);
  scope.assign("f", null);
  expect(scope.lookup("f")).toMatchObject({ found: true, value: null });
  expect(measureSandboxData(scope.retainedDataRoots())).toBe(0);
  expect(measureSandboxData(before)).toBe(units);
  expect(creations).toBe(0);
});

it.each(["snapshot", "captureFrame", "retainedValues"] as const)(
  "materializes values for %s",
  (method) => {
    const scope = new Scope();
    let creations = 0;
    scope.declareDeferredFunction(
      "f",
      "let",
      () => {
        creations++;
        return createSandboxClosure({ call: () => undefined });
      },
      () => {}
    );
    scope.declareAlias("alias", "f");
    const before = scope.retainedDataRoots();
    const result = scope[method]();
    expect(result).toBeDefined();
    expect(creations).toBe(1);
    expect(measureSandboxData([...before, ...scope.retainedDataRoots()])).toBe(1);
    if (method === "captureFrame") {
      const frame = result as ReturnType<Scope["captureFrame"]>;
      expect(frame.cells).toHaveLength(1);
      const restored = new Scope();
      restored.hydrateFrame(frame);
      expect(restored.lookup("f")).toEqual(scope.lookup("f"));
    }
  }
);

it.each([false, true])(
  "charges materialization during a retained collector immediately (held=%s)",
  (held) => {
    const scope = new Scope();
    const payload = { text: "x".repeat(1000) };
    let creations = 0;
    scope.declareDeferredFunction(
      "f",
      "let",
      () => {
        creations++;
        return createSandboxClosure({ call: () => undefined, properties: { payload } });
      },
      (append) => {
        const value = scope.lookup("f");
        if (value.found) append(value.value);
      }
    );
    const before = scope.retainedDataRoots();
    const budget = new Budget({ dataSize: 500 });
    const release = held ? budget.deferReconciliation() : undefined;
    try {
      expect(() => reconcileCompiledValues(budget, before)).toThrow(
        expect.objectContaining({ code: "budgetExceeded", budget: "dataSize" })
      );
    } finally {
      release?.();
    }
    expect(creations).toBe(1);
    const value = scope.lookup("f");
    expect(measureSandboxData([...before, ...scope.retainedDataRoots()])).toBe(
      measureSandboxData([value.found ? value.value : undefined])
    );
  }
);

it("releases failed collector state and keeps captures fresh during reentrant measurements", () => {
  const scope = new Scope();
  const payload = { text: "old" };
  const failure = new Error("collector failed");
  let fails = true;
  let nested = 0;
  scope.declareDeferredFunction(
    "f",
    "let",
    () => createSandboxClosure({ call: () => undefined }),
    (append) => {
      append(payload);
      nested = measureSandboxData([payload]);
      if (fails) throw failure;
    }
  );
  const roots = scope.retainedDataRoots();
  expect(() => measureSandboxData(roots)).toThrow(failure);
  fails = false;
  const before = measureSandboxData(roots);
  expect(before).toBe(nested + 1);
  payload.text += "grown";
  expect(measureSandboxData(roots)).toBe(before + 5);
});

it("charges one function when a later callback materializes an earlier pending binding", () => {
  const scope = new Scope();
  scope.declareDeferredFunction(
    "f",
    "let",
    () => createSandboxClosure({ call: () => undefined }),
    () => {}
  );
  const roots = scope.retainedDataRoots();
  const force = createSandboxClosure({
    call: () => undefined,
    retainedValues: () => {
      const value = scope.lookup("f");
      return value.found ? [value.value, ...scope.retainedDataRoots()] : [];
    }
  });
  expect(measureSandboxData([...roots, force])).toBe(2);
});

it("allows retry after a failed initializer and rejects recursive initialization", () => {
  const scope = new Scope();
  let attempts = 0;
  scope.declareDeferredFunction(
    "f",
    "let",
    () => {
      attempts++;
      if (attempts === 1) {
        scope.lookup("f");
        throw new Error("unreachable");
      }
      return createSandboxClosure({ call: () => undefined });
    },
    () => {}
  );
  expect(() => scope.lookup("f")).toThrow("Cannot reenter deferred function initialization.");
  expect(measureSandboxData(scope.retainedDataRoots())).toBe(1);
  expect(scope.lookup("f").found).toBe(true);
  expect(scope.lookup("f").found).toBe(true);
  expect(attempts).toBe(2);
});

it("preserves an assignment made by the function initializer", () => {
  const scope = new Scope();
  const created = createSandboxClosure({ call: () => undefined });
  scope.declareDeferredFunction(
    "f",
    "let",
    () => {
      scope.assign("f", 7);
      return created;
    },
    () => {}
  );
  const before = scope.retainedDataRoots();
  expect(scope.lookup("f")).toMatchObject({ value: created });
  expect(scope.lookup("f")).toMatchObject({ value: 7 });
  expect(measureSandboxData(before)).toBe(1);
  expect(measureSandboxData(scope.retainedDataRoots())).toBe(0);
});
