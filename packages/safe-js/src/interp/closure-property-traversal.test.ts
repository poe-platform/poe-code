import { expect, it } from "vitest";
import { setImmediate } from "node:timers/promises";
import { Budget } from "./budget.js";
import { registerIndexedClosureCaptures } from "./indexed-closure-captures.js";
import {
  createSandboxClosure,
  measureSandboxData,
  reconcileCompiledValues,
  type SandboxValue
} from "./values.js";

function nestedRoot(value: unknown): unknown {
  for (let index = 0; index < 64; index++) value = [value];
  return value;
}

it.each([512, 513])("measures deep closure-property chains of %s nodes", (count) => {
  let root;
  for (let index = 0; index < count; index++)
    root = createSandboxClosure({ call: () => undefined, properties: { next: root } });
  expect(measureSandboxData([root])).toBe(count * 7);
});

it.each([false, true])("observes collectors replaced by property descendants (held=%s)", (held) => {
  const events: string[] = [];
  const payload = { text: "x".repeat(1000) };
  const child = createSandboxClosure({
    call: () => undefined,
    retainedValues: () => {
      events.push("child");
      registerIndexedClosureCaptures(parent, (append) => {
        events.push("new parent");
        expect(measureSandboxData(["nested"])).toBe(6);
        append(payload);
      });
      return [];
    }
  });
  const parent = createSandboxClosure({ call: () => undefined, properties: { child } });
  registerIndexedClosureCaptures(parent, () => {
    events.push("old parent");
  });
  const budget = new Budget({ dataSize: 500 });
  const release = held ? budget.deferReconciliation() : undefined;
  try {
    expect(() => reconcileCompiledValues(budget, [nestedRoot(parent)])).toThrow(
      expect.objectContaining({
        code: "budgetExceeded",
        budget: "dataSize"
      })
    );
  } finally {
    release?.();
  }
  expect(events).toEqual(["child", "new parent"]);
});

it("discards pending property continuations after a descendant throws", () => {
  const events: string[] = [];
  let fail = true;
  const child = createSandboxClosure({
    call: () => undefined,
    retainedValues: () => {
      events.push("child");
      if (fail) throw new Error("property descendant failed");
      return [];
    }
  });
  const parent = createSandboxClosure({
    call: () => undefined,
    properties: { child },
    retainedValues: () => {
      events.push("parent");
      return ["payload"];
    }
  });
  const root = nestedRoot(parent);
  expect(() => measureSandboxData([root])).toThrow("property descendant failed");
  expect(events).toEqual(["child"]);
  fail = false;
  events.length = 0;
  expect(measureSandboxData([root])).toBe(144);
  expect(events).toEqual(["child", "parent"]);
});

function discardedClosure(fails: boolean) {
  let append!: (value: SandboxValue) => void;
  const child = createSandboxClosure({ call: () => undefined });
  registerIndexedClosureCaptures(child, (callback) => {
    append = callback;
    if (fails) throw new Error("descendant failed");
  });
  const parent = createSandboxClosure({ call: () => undefined, properties: { child } });
  const root = nestedRoot(parent);
  if (fails) expect(() => measureSandboxData([root])).toThrow("descendant failed");
  else measureSandboxData([root]);
  return { reference: new WeakRef(parent), append };
}

it("keeps properties, captures and array siblings ordered when frames are reused", () => {
  const events: string[] = [];
  const observer = (name: string) =>
    createSandboxClosure({
      call: () => undefined,
      retainedValues: () => {
        events.push(name);
        return [];
      }
    });
  const captures = [observer("first capture"), observer("second capture")];
  const parent = createSandboxClosure({
    call: () => undefined,
    properties: { first: observer("first property"), second: observer("second property") }
  });
  registerIndexedClosureCaptures(parent, (append) => {
    for (const value of captures) append(value);
  });
  const roots = [nestedRoot([parent, observer("sibling")])];
  expect(measureSandboxData(roots)).toBe(151);
  expect(events).toEqual([
    "first property",
    "second property",
    "first capture",
    "second capture",
    "sibling"
  ]);
});

it.skipIf(typeof global.gc !== "function").each([false, true])(
  "releases pending closures even when a descendant saves its append callback (fails=%s)",
  async (fails) => {
    const { reference, append } = discardedClosure(fails);
    for (let index = 0; index < 8; index++) {
      await setImmediate();
      global.gc!();
    }
    expect(reference.deref()).toBeUndefined();
    expect(() => append("late")).not.toThrow();
    expect(measureSandboxData(["fresh"])).toBe(5);
  }
);
