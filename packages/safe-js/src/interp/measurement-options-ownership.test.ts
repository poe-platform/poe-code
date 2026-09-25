import { expect, it } from "vitest";
import { Budget } from "./budget.js";
import { CompileScope } from "./regex/compile-guard.js";
import {
  createGuestReference, createLiveHostObject, importHostCapability,
  revokeGuestReference, revokeHostObject, setHostObjectPrototype,
  type HostObjectController
} from "./host-capabilities.js";
import {
  createSandboxClosure, createSandboxRegex, measureSandboxData, reconcileCompiledValues,
  type SandboxValue
} from "./values.js";

function withInheritedOption<T>(key: string, value: unknown, operation: () => T): T {
  const previous = Object.getOwnPropertyDescriptor(Object.prototype, key);
  try {
    Object.defineProperty(Object.prototype, key, { configurable: true, value });
    return operation();
  } finally {
    if (previous === undefined) Reflect.deleteProperty(Object.prototype, key);
    else Object.defineProperty(Object.prototype, key, previous);
  }
}

function fixture(hostPrototype: boolean) {
  if (!hostPrototype) return {
    value: createSandboxClosure({ call: () => undefined, retainedValues: () => ["x".repeat(1000)] }),
    close: () => {}
  };
  const controller: HostObjectController = {
    owner: {}, assertActive: () => {}, chargeWork: () => {}, chargeGuestData: () => {},
    checkLength: () => {}, checkString: () => {}, checkTemporaryDataSize: () => {},
    read: operation => operation() as SandboxValue,
    write: (operation, value) => operation(value),
    method: operation => createSandboxClosure({ call: args => operation(...args) as SandboxValue })
  };
  const host = createLiveHostObject({}, controller);
  const reference = createGuestReference([{ payload: "x".repeat(1000) }], controller.owner, () => {});
  setHostObjectPrototype(host, reference, controller.owner);
  revokeGuestReference(reference, controller.owner);
  return {
    value: importHostCapability(host, controller.owner),
    close: () => revokeHostObject(host, controller.owner)
  };
}

const flags = ["ignoreClosures", "ignoreClosureCaptures", "ignoreHostObjectPrototypes"];
it.each(flags.flatMap(flag => ["default", "reconcile", "held"].map(mode => ({ flag, mode }))))(
  "does not inherit $flag into SDK-owned $mode measurements",
  ({ flag, mode }) => {
    const { value, close } = fixture(flag === "ignoreHostObjectPrototypes");
    try {
      const expected = measureSandboxData([value]);
      expect(expected).toBeGreaterThan(1000);
      withInheritedOption(flag, true, () => {
        if (mode === "default") expect(measureSandboxData([value])).toBe(expected);
        else {
          const budget = new Budget({ dataSize: 500 });
          const release = mode === "held" ? budget.deferReconciliation() : () => {};
          try {
            expect(() => reconcileCompiledValues(budget, [value]))
              .toThrow(expect.objectContaining({ code: "budgetExceeded", budget: "dataSize" }));
          } finally { release(); }
        }
      });
    } finally { close(); }
  }
);

it("does not send compile tickets to an inherited default collector", () => {
  const budget = new Budget();
  const operation = budget.acquireCompileOwner();
  const compilation = new CompileScope(operation.owner);
  const captured: unknown[] = [];
  try {
    const regex = createSandboxRegex("a+", "g", 0, compilation);
    withInheritedOption("compileTickets", { add: (ticket: unknown) => captured.push(ticket) }, () => {
      measureSandboxData([regex]);
    });
    expect(captured).toHaveLength(0);
  } finally {
    compilation.dispose();
    operation.release();
  }
});

it("preserves inherited exemptions explicitly supplied by a caller", () => {
  const { value, close } = fixture(false);
  const options: { ignoreClosureCaptures?: boolean } = Object.create({ ignoreClosureCaptures: true });
  try { expect(measureSandboxData([value], options)).toBe(1); }
  finally { close(); }
});

it("keeps caller option getters fresh between closure visits", () => {
  const order: string[] = [];
  const first = createSandboxClosure({ call: () => undefined, retainedValues: () => {
    order.push("capture"); return ["first"];
  } });
  const second = createSandboxClosure({ call: () => undefined, retainedValues: () => ["second"] });
  let reads = 0;
  const options = { get ignoreClosureCaptures() { order.push("option"); return ++reads > 1; } };
  expect(measureSandboxData([first, second], options)).toBe(7);
  expect(order).toEqual(["option", "capture", "option"]);
});

it("keeps caller compile-ticket collectors fresh between regex visits", () => {
  const budget = new Budget();
  const operation = budget.acquireCompileOwner();
  const compilation = new CompileScope(operation.owner);
  try {
    const first = createSandboxRegex("a+", "g", 0, compilation);
    const second = createSandboxRegex("b+", "g", 0, compilation);
    const tickets = [...compilation.tickets];
    const left = new Set<typeof tickets[number]>(), right = new Set<typeof tickets[number]>();
    let reads = 0;
    measureSandboxData([first, second], { get compileTickets() { return ++reads === 1 ? left : right; } });
    expect(reads).toBe(2);
    expect([...left]).toEqual([tickets[0]]);
    expect([...right]).toEqual([tickets[1]]);
  } finally {
    compilation.dispose();
    operation.release();
  }
});
