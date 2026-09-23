import { expect, it } from "vitest";
import { createSandboxArguments } from "./arguments.js";
import { Budget } from "./budget.js";
import { registerIndexedClosureCaptures } from "./indexed-closure-captures.js";
import { markDescriptorObject, setSandboxPrototype } from "./object-model.js";
import { createSandboxClosure, measureSandboxData, reconcileCompiledValues } from "./values.js";

it.each([64, 65])("keeps pending array siblings after %s aliases and indexed captures", (count) => {
  const payload = { text: "x".repeat(1000) };
  const wide = Array.from({ length: count }, () => payload);
  const following = createSandboxClosure({ call: () => undefined });
  registerIndexedClosureCaptures(following, (append) => {
    append("done");
    append("abc");
  });
  const parent = [wide, following, payload];
  expect(measureSandboxData([parent])).toBe(count + 1019);
  expect(measureSandboxData([parent])).toBe(count + 1019);
});

it("owns an early array snapshot while prototype captures consume other buffers", () => {
  const payload = { text: "x".repeat(1000) };
  const owner = [payload];
  const prototype = createSandboxClosure({ call: () => undefined });
  registerIndexedClosureCaptures(prototype, (append) => {
    owner.length = 0;
    append("proto-a");
    append("proto-b");
  });
  setSandboxPrototype(owner, prototype);
  expect(measureSandboxData([owner])).toBe(1023);
  expect(owner).toHaveLength(0);
  owner[0] = payload;
  expect(measureSandboxData([owner])).toBe(1023);
});

it.each([false, true])(
  "retains managed array, argument and record captures under quotas (held=%s)",
  (held) => {
    const payload = { text: "small" };
    const managed: unknown[] = [];
    markDescriptorObject(managed);
    Object.defineProperty(managed, "hidden", { value: payload, configurable: true });
    const argumentsRoot = createSandboxArguments([payload, payload]);
    const parent = [managed, argumentsRoot, { payload }, [payload, "later"]];
    const before = measureSandboxData([parent]);
    payload.text = "x".repeat(1005);
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

it("isolates nested measurements during proxy array descriptor capture", () => {
  const payload = { text: "x".repeat(1000) };
  const inner = [payload, "inside"];
  let nested = -1;
  const child = new Proxy([payload], {
    getOwnPropertyDescriptor(target, key) {
      if (key === "0") nested = measureSandboxData([inner]);
      return Reflect.getOwnPropertyDescriptor(target, key);
    }
  });
  const parent = [child, "tail", payload];
  expect(measureSandboxData([parent])).toBe(1016);
  expect(nested).toBe(1015);
});

it("recovers from partial array descriptor capture with a parent snapshot pending", () => {
  const payload = { text: "x".repeat(1000) };
  const failure = new Error("descriptor failed");
  let throws = true;
  const child = new Proxy([payload, "done"], {
    getOwnPropertyDescriptor(target, key) {
      if (key === "1" && throws) throw failure;
      return Reflect.getOwnPropertyDescriptor(target, key);
    }
  });
  const parent = [child, "tail"];
  expect(() => measureSandboxData([parent])).toThrow(failure);
  throws = false;
  expect(measureSandboxData([parent])).toBe(1020);
  expect(measureSandboxData([parent])).toBe(1020);
});

it("preserves primitive array entries when a longer released capture is reused", () => {
  const payload = { text: "x".repeat(1000) };
  const parent = [[payload, payload, payload], [7], [true, undefined], ["done", "abc"], payload];
  expect(measureSandboxData([parent])).toBe(1031);
  expect(measureSandboxData([parent])).toBe(1031);
});
