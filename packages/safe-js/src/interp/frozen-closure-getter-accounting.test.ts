import { afterEach, expect, it, vi } from "vitest";
import { Budget } from "./budget.js";
import { createSandboxClosure, measureSandboxData, reconcileCompiledValues } from "./values.js";

afterEach(() => vi.restoreAllMocks());

function fixture() {
  const retained = { text: "x".repeat(1000) };
  const define = Object.defineProperty;
  const receivers: unknown[] = [];
  let reads = 0;
  const spy = vi.spyOn(Object, "defineProperty").mockImplementation((owner, key, descriptor) =>
    define(
      owner,
      key,
      key === "properties"
        ? {
            ...descriptor,
            get: function () {
              receivers.push(this);
              expect(arguments.length).toBe(0);
              return ++reads % 2 === 1 ? {} : retained;
            }
          }
        : descriptor
    )
  );
  const closure = createSandboxClosure({ call: () => undefined });
  spy.mockRestore();
  return { closure, retained, receivers };
}

it("reads the actual immutable getter twice with the closure receiver on every measurement", () => {
  const { closure, retained, receivers } = fixture();
  expect(measureSandboxData([closure])).toBe(1007);
  retained.text += "x".repeat(1000);
  expect(measureSandboxData([closure, closure])).toBe(2007);
  expect(receivers).toEqual([closure, closure, closure, closure]);
});

it.each([false, true])("preserves getter-driven growth under quotas (held=%s)", (held) => {
  const { closure } = fixture();
  const budget = new Budget({ dataSize: 500 });
  const release = held ? budget.deferReconciliation() : undefined;
  try {
    expect(() => reconcileCompiledValues(budget, [closure])).toThrow(
      expect.objectContaining({ code: "budgetExceeded", budget: "dataSize" })
    );
  } finally {
    release?.();
  }
});

it("does not give later invocation hooks authority to suppress property data", () => {
  const { closure } = fixture();
  const invoke = Reflect.apply;
  const spy = vi
    .spyOn(Reflect, "apply")
    .mockImplementation((target, receiver, args) =>
      receiver === closure ? {} : invoke(target, receiver, args)
    );
  try {
    expect(measureSandboxData([closure])).toBe(1007);
  } finally {
    spy.mockRestore();
  }
});

it("preserves frozen data descriptors supplied by native construction hooks", () => {
  const define = Object.defineProperty;
  const payload = { text: "x".repeat(1000) };
  const spy = vi
    .spyOn(Object, "defineProperty")
    .mockImplementation((owner, key, descriptor) =>
      define(owner, key, key === "properties" ? { value: payload } : descriptor)
    );
  const closure = createSandboxClosure({ call: () => undefined });
  spy.mockRestore();
  expect(measureSandboxData([closure])).toBe(1007);
});

it("keeps inherited and native proxy getters bound to their original owner", () => {
  const closure = createSandboxClosure({ call: () => undefined, properties: { text: "abc" } });
  const inherited = Object.freeze(Object.create(closure));
  const proxy = new Proxy(closure, {});
  expect(measureSandboxData([inherited])).toBe(measureSandboxData([closure]));
  expect(measureSandboxData([proxy])).toBe(measureSandboxData([closure]));
});

it("recovers after getter failures and supports nested measurements", () => {
  const define = Object.defineProperty;
  const leaf = { text: "abc" };
  const payload = { text: "x".repeat(1000) };
  let fail = true;
  const spy = vi.spyOn(Object, "defineProperty").mockImplementation((owner, key, descriptor) =>
    define(
      owner,
      key,
      key === "properties"
        ? {
            ...descriptor,
            get() {
              if (fail) throw new Error("getter failed");
              expect(measureSandboxData([leaf])).toBe(9);
              return payload;
            }
          }
        : descriptor
    )
  );
  const closure = createSandboxClosure({ call: () => undefined });
  spy.mockRestore();
  expect(() => measureSandboxData([closure])).toThrow("getter failed");
  fail = false;
  expect(measureSandboxData([closure])).toBe(1007);
});

it("keeps suppression modes and missing own descriptors on the correct read path", () => {
  const { closure, receivers } = fixture();
  expect(measureSandboxData([closure], { ignoreClosures: true })).toBe(1);
  expect(receivers).toHaveLength(0);
  expect(measureSandboxData([closure], { ignoreClosureCaptures: true })).toBe(1007);
  expect(receivers).toHaveLength(2);
  const define = Object.defineProperty;
  const spy = vi
    .spyOn(Object, "defineProperty")
    .mockImplementation((owner, key, descriptor) =>
      key === "properties" ? owner : define(owner, key, descriptor)
    );
  const inherited = createSandboxClosure({ call: () => undefined });
  spy.mockRestore();
  const previous = Object.getOwnPropertyDescriptor(Object.prototype, "properties");
  let reads = 0;
  const payload = { text: "x".repeat(1000) };
  define(Object.prototype, "properties", {
    configurable: true,
    get() {
      if (this !== inherited) return undefined;
      reads++;
      return payload;
    }
  });
  try {
    expect(measureSandboxData([inherited])).toBe(1007);
    expect(reads).toBe(2);
  } finally {
    if (previous === undefined) Reflect.deleteProperty(Object.prototype, "properties");
    else define(Object.prototype, "properties", previous);
  }
});

it("does not mistake inherited descriptor get fields for an own closure accessor", () => {
  const define = Object.defineProperty;
  const payload = { text: "x".repeat(1000) };
  const previous = Object.getOwnPropertyDescriptor(Object.prototype, "get");
  const spy = vi.spyOn(Object, "defineProperty").mockImplementation((owner, key, descriptor) => {
    if (key !== "properties") return define(owner, key, descriptor);
    define(owner, key, { value: payload });
    define(Object.prototype, "get", { configurable: true, value: () => undefined });
    return owner;
  });
  let closure: ReturnType<typeof createSandboxClosure>;
  try {
    closure = createSandboxClosure({ call: () => undefined });
  } finally {
    if (previous === undefined) Reflect.deleteProperty(Object.prototype, "get");
    else define(Object.prototype, "get", previous);
    spy.mockRestore();
  }
  expect(measureSandboxData([closure!])).toBe(1007);
});
