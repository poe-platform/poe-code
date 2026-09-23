import { expect, it, vi } from "vitest";
import { Budget } from "./budget.js";
import { MAX_DATA_DEPTH } from "../graph-depth.js";
import {
  createLiveHostObject,
  deleteHostObjectMember,
  getHostObjectMember,
  hostObjectGuestRoots,
  importHostCapability,
  isGuestHostObject,
  revokeHostObject,
  setHostObjectMember,
  type HostObjectController
} from "./host-capabilities.js";
import {
  createSandboxClosure,
  measureSandboxData,
  reconcileCompiledValues,
  type SandboxValue
} from "./values.js";

function fixture() {
  const controller: HostObjectController = {
    owner: {},
    assertActive: vi.fn(),
    chargeWork: vi.fn(),
    chargeGuestData: vi.fn(),
    checkLength: vi.fn(),
    checkString: vi.fn(),
    checkTemporaryDataSize: vi.fn(),
    read: (operation) => operation() as SandboxValue,
    write: (operation, value) => operation(value),
    method: (operation) =>
      createSandboxClosure({ call: (args) => operation(...args) as SandboxValue })
  };
  const host = createLiveHostObject(
    { expandos: { maxKeys: 64, maxKeyCodeUnits: 1024 } },
    controller
  );
  const guest = importHostCapability(host, controller.owner);
  if (!isGuestHostObject(guest)) throw new Error("Missing guest host object");
  const root = hostObjectGuestRoots(guest)[0]!;
  if (typeof root !== "object" || root === null) throw new Error("Missing expando table");
  return { controller, host, guest, root };
}

it("does not recapture unchanged expando descriptors during repeated accounting", () => {
  const { guest, root } = fixture();
  setHostObjectMember(guest, "payload", { text: "fresh" });
  const before = measureSandboxData([guest]);
  const descriptors = vi.spyOn(Object, "getOwnPropertyDescriptor");
  let after: number;
  let captures: number;
  try {
    after = measureSandboxData([guest]);
    captures = descriptors.mock.calls.filter(([owner]) => owner === root).length;
  } finally {
    descriptors.mockRestore();
  }
  expect(after).toBe(before);
  expect(captures).toBe(0);
});

it.each([false, true])(
  "keeps host descendants subject to quotas when native array iteration changes (held=%s)",
  (held) => {
    const { guest, root } = fixture();
    setHostObjectMember(guest, "payload", "small");
    const budget = new Budget({ dataSize: measureSandboxData([guest]) + 100 });
    reconcileCompiledValues(budget, [guest]);
    setHostObjectMember(guest, "payload", "x".repeat(205));
    const iterate = Array.prototype[Symbol.iterator];
    let exposed = false;
    Array.prototype[Symbol.iterator] = function (this: unknown[]) {
      if (this.length === 1 && this[0] === root) {
        exposed = true;
        return iterate.call([]);
      }
      return iterate.call(this);
    };
    const release = held ? budget.deferReconciliation() : undefined;
    let error: unknown;
    try {
      reconcileCompiledValues(budget, [guest]);
    } catch (failure) {
      error = failure;
    } finally {
      Array.prototype[Symbol.iterator] = iterate;
      release?.();
    }
    expect({ exposed, error }).toEqual({
      exposed: false,
      error: expect.objectContaining({ code: "budgetExceeded", budget: "dataSize" })
    });
  }
);

it("preserves exact charges across writes, aliasing, replacement and deletion", () => {
  const { guest } = fixture();
  const plain = Object.create(null);
  const check = () => expect(measureSandboxData([guest])).toBe(1 + measureSandboxData([plain]));
  check();
  const payload = { text: "short" };
  const symbol = Symbol("payload");
  for (const [key, value] of [
    ["scalar", "a🙂"],
    ["payload", payload],
    [symbol, payload]
  ] as const) {
    setHostObjectMember(guest, key, value);
    plain[key] = value;
    check();
  }
  payload.text = "much longer";
  check();
  setHostObjectMember(guest, "payload", "replacement");
  plain.payload = "replacement";
  check();
  for (const key of ["scalar", "payload", symbol]) {
    expect(deleteHostObjectMember(guest, key)).toBe(true);
    delete plain[key];
    check();
  }
});

it("measures host expando chains through the depth boundary without native stack overflow", () => {
  let root: SandboxValue = {};
  for (let index = 0; index < MAX_DATA_DEPTH / 2; index++) {
    const { guest } = fixture();
    setHostObjectMember(guest, "next", root);
    root = guest;
  }
  expect(measureSandboxData([root])).toBe(1 + (MAX_DATA_DEPTH / 2) * 7);
  const { guest } = fixture();
  setHostObjectMember(guest, "next", root);
  expect(() => measureSandboxData([guest])).toThrow(
    expect.objectContaining({ code: "budgetExceeded", budget: "dataDepth" })
  );
});

it.each([false, true])(
  "rejects warmed scalar and descendant growth during reconciliation (held=%s)",
  (held) => {
    const { guest } = fixture();
    const payload = { text: "small" };
    setHostObjectMember(guest, "payload", payload);
    setHostObjectMember(guest, "scalar", "small");
    const provider = vi.fn(() => [guest]);
    const closure = createSandboxClosure({ call: () => undefined, retainedValues: provider });
    const budget = new Budget({ dataSize: measureSandboxData([closure]) + 100 });
    const release = held ? budget.deferReconciliation() : undefined;
    try {
      reconcileCompiledValues(budget, [closure]);
      for (const kind of ["scalar", "descendant"] as const) {
        if (kind === "scalar") setHostObjectMember(guest, "scalar", "x".repeat(205));
        else payload.text = "x".repeat(205);
        provider.mockClear();
        expect(() => reconcileCompiledValues(budget, [closure])).toThrow(
          expect.objectContaining({ code: "budgetExceeded", budget: "dataSize" })
        );
        expect(provider).toHaveBeenCalled();
        setHostObjectMember(guest, "scalar", "small");
        payload.text = "small";
        reconcileCompiledValues(budget, [closure]);
      }
    } finally {
      release?.();
    }
  }
);

it("drops owned roots on revocation and preserves roots when foreign revocation fails", () => {
  const { host, guest, root, controller } = fixture();
  setHostObjectMember(guest, "payload", "retained");
  const before = measureSandboxData([guest]);
  expect(() => revokeHostObject(host, {})).toThrow(TypeError);
  expect(hostObjectGuestRoots(guest)[0]).toBe(root);
  expect(measureSandboxData([guest])).toBe(before);
  revokeHostObject(host, controller.owner);
  expect(hostObjectGuestRoots(host)).toEqual([]);
  expect(hostObjectGuestRoots(guest)).toEqual([]);
  expect(measureSandboxData([guest])).toBe(1);
  expect(getHostObjectMember(guest, "payload")).toBeUndefined();
});
