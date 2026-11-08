import { expect, it } from "vitest";
import { createSandboxArguments } from "./arguments.js";
import { Budget } from "./budget.js";
import { registerIndexedClosureCaptures } from "./indexed-closure-captures.js";
import { createSandboxClosure, measureSandboxData, reconcileCompiledValues } from "./values.js";

it.each([64, 65])(
  "keeps pending record siblings after %s aliases and indexed captures",
  (count) => {
    const payload = { data: "x".repeat(1000) };
    const wide = Object.fromEntries(
      Array.from({ length: count }, (_, index) => [`field${index}`, payload])
    );
    const following = createSandboxClosure({ call: () => undefined });
    registerIndexedClosureCaptures(following, (append) => {
      append("done");
      append("abc");
    });
    const parent = { wide, following, payload };
    const expected = count === 64 ? 1541 : 1549;
    expect(measureSandboxData([parent])).toBe(expected);
    expect(measureSandboxData([parent])).toBe(expected);
  }
);

it.each([false, true])(
  "keeps mixed record/argument aliases and mutable descendants under quotas (held=%s)",
  (held) => {
    const payload = { data: "small" };
    const argumentsRoot = createSandboxArguments([payload, payload]);
    const parent = { first: { argumentsRoot }, second: { payload } };
    const before = measureSandboxData([parent]);
    payload.data = "x".repeat(1005);
    expect(measureSandboxData([parent])).toBe(before + 1000);
    const budget = new Budget({ dataSize: before + 500 });
    const release = held ? budget.deferReconciliation() : undefined;
    try {
      expect(() => reconcileCompiledValues(budget, [parent])).toThrowError(
        expect.objectContaining({ code: "budgetExceeded", budget: "dataSize" })
      );
    } finally {
      release?.();
    }
  }
);

it("isolates nested measurements during record capture while a parent is pending", () => {
  const payload = { data: "x".repeat(1000) };
  const inner = { payload, text: "inside" };
  let nested = -1;
  const child = new Proxy(
    { payload },
    {
      getOwnPropertyDescriptor(target, key) {
        if (key === "payload") nested = measureSandboxData([inner]);
        return Reflect.getOwnPropertyDescriptor(target, key);
      }
    }
  );
  const parent = { child, text: "tail", payload };
  expect(measureSandboxData([parent])).toBe(1039);
  expect(nested).toBe(1026);
});

it("clears failed descriptor captures without losing later parent or child roots", () => {
  const payload = { data: "x".repeat(1000) };
  const failure = new Error("descriptor failed");
  let throws = true;
  const child = new Proxy(
    { first: payload, last: "done" },
    {
      getOwnPropertyDescriptor(target, key) {
        if (key === "last" && throws) throw failure;
        return Reflect.getOwnPropertyDescriptor(target, key);
      }
    }
  );
  const parent = { child, payload };
  expect(() => measureSandboxData([parent])).toThrow(failure);
  throws = false;
  expect(measureSandboxData([parent])).toBe(1037);
  expect(measureSandboxData([parent])).toBe(1037);
});

it("recovers from a native descriptor failure after collecting an earlier record root", () => {
  const payload = { data: "x".repeat(1000) };
  const child = { first: payload, last: "done" };
  const parent = { child, payload };
  const failure = new Error("native descriptor failed");
  const descriptor = Object.getOwnPropertyDescriptor;
  Object.getOwnPropertyDescriptor = (value, key) => {
    if (value === child && key === "last") throw failure;
    return descriptor(value, key);
  };
  let caught: unknown;
  try {
    measureSandboxData([parent]);
  } catch (error) {
    caught = error;
  } finally {
    Object.getOwnPropertyDescriptor = descriptor;
  }
  expect(caught).toBe(failure);
  expect(measureSandboxData([parent])).toBe(1037);
  expect(measureSandboxData([parent])).toBe(1037);
});
