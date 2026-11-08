import { expect, it } from "vitest";
import { Budget } from "./budget.js";
import {
  createSandboxPromise,
  getPromiseProperties,
  measureSandboxData,
  reconcileCompiledValues
} from "./values.js";

it("charges a Promise property symbol once across aliased roots", () => {
  const promise = createSandboxPromise(new Promise(() => {}), { trackReplay: false });
  const baseline = measureSandboxData([promise]);
  const key = Symbol("retained-key");
  Object.defineProperty(getPromiseProperties(promise), key, { value: 0 });
  const expected = baseline + 1 + 1 + "retained-key".length;
  expect(measureSandboxData([promise])).toBe(expected);
  expect(measureSandboxData([promise, promise, key])).toBe(expected);
});

it("rolls back a failed Promise symbol charge and admits the exact boundary", () => {
  const promise = createSandboxPromise(new Promise(() => {}), { trackReplay: false });
  const baseline = measureSandboxData([promise]);
  const budget = new Budget({ dataSize: baseline + 4 });
  reconcileCompiledValues(budget, [promise]);
  const key = Symbol("abc");
  Object.defineProperty(getPromiseProperties(promise), key, { value: 0, configurable: true });
  expect(() => reconcileCompiledValues(budget, [promise])).toThrow(
    expect.objectContaining({
      code: "budgetExceeded",
      budget: "dataSize"
    })
  );
  expect(budget.currentDataSize).toBe(baseline);
  expect(budget.peakDataSize).toBe(baseline);
  Reflect.deleteProperty(getPromiseProperties(promise), key);
  Object.defineProperty(getPromiseProperties(promise), Symbol("ab"), { value: 0 });
  reconcileCompiledValues(budget, [promise]);
  expect(budget.currentDataSize).toBe(baseline + 4);
  expect(budget.peakDataSize).toBe(baseline + 4);
});
