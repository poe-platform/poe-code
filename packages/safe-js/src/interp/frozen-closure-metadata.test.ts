import { expect, it, vi } from "vitest";
import { Budget } from "./budget.js";
import { DeferredFunction } from "./deferred-function.js";
import { deferFunctionProperties, materializeFunctionProperties } from "./object-model.js";
import { createSandboxClosure, measureSandboxData, reconcileCompiledValues } from "./values.js";

it.each(["propertiesRoot", "chargeIdentity"] as const)(
  "does not let inherited %s replace private accounting metadata",
  (field) => {
    const alias = {};
    const closure = createSandboxClosure({
      call: () => undefined,
      properties: { payload: "x".repeat(1000) }
    });
    const roots = [alias, closure];
    const before = measureSandboxData(roots);
    const inherited = vi.fn(() => alias);
    Object.defineProperty(Object.prototype, field, { configurable: true, get: inherited });
    try {
      expect(measureSandboxData(roots)).toBe(before);
      expect(() => reconcileCompiledValues(new Budget({ dataSize: before - 1 }), roots)).toThrow(
        expect.objectContaining({ code: "budgetExceeded", budget: "dataSize" })
      );
      expect(inherited).not.toHaveBeenCalled();
    } finally {
      Reflect.deleteProperty(Object.prototype, field);
    }
  }
);

it.each([false, true])(
  "keeps deferred metadata private during creation and both updates (held=%s)",
  (held) => {
    const inherited = vi.fn(() => {
      throw new Error("Inherited private metadata");
    });
    for (const field of ["propertiesRoot", "chargeIdentity"])
      Object.defineProperty(Object.prototype, field, { configurable: true, get: inherited });
    try {
      const pending = new DeferredFunction(
        () => {
          const method = createSandboxClosure({ guest: true, name: "read", call: () => undefined });
          expect(deferFunctionProperties(method)).toBe(true);
          return method;
        },
        () => {}
      );
      const method = pending.resolve();
      materializeFunctionProperties(method).payload = "x".repeat(1000);
      const roots = [pending.root, method];
      expect(measureSandboxData(roots)).toBeGreaterThan(1000);
      expect(measureSandboxData(roots)).toBe(measureSandboxData([method]));
      const budget = new Budget({ dataSize: 500 });
      const release = held ? budget.deferReconciliation() : undefined;
      try {
        expect(() => reconcileCompiledValues(budget, roots)).toThrow(
          expect.objectContaining({ code: "budgetExceeded", budget: "dataSize" })
        );
      } finally {
        release?.();
      }
      expect(inherited).not.toHaveBeenCalled();
    } finally {
      for (const field of ["propertiesRoot", "chargeIdentity"])
        Reflect.deleteProperty(Object.prototype, field);
    }
  }
);
