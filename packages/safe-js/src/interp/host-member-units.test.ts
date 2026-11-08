import { expect, it, vi } from "vitest";
import { Budget } from "./budget.js";
import {
  createLiveHostObject,
  getHostObjectKeys,
  getHostObjectMember,
  importHostCapability,
  isGuestHostObject,
  measureHostObjectData,
  revokeHostObject,
  setHostObjectMember,
  type HostObjectController,
  type HostObjectDefinition
} from "./host-capabilities.js";
import {
  createSandboxClosure,
  measureSandboxData,
  reconcileCompiledValues,
  type SandboxValue
} from "./values.js";

function fixture(definition: HostObjectDefinition = {}) {
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
  const host = createLiveHostObject(definition, controller);
  const guest = importHostCapability(host, controller.owner);
  if (!isGuestHostObject(guest)) throw new Error("Missing guest host object");
  return { controller, host, guest };
}

it("keeps copied member charges private from later native key enumeration hooks", () => {
  const { guest } = fixture({
    properties: { value: { get: () => 1 } },
    methods: { operate: () => undefined }
  });
  const keys = vi.spyOn(Map.prototype, "keys").mockImplementation(() => [][Symbol.iterator]());
  let first: number;
  let second: number;
  try {
    first = measureHostObjectData(guest);
    second = measureHostObjectData(guest);
  } finally {
    keys.mockRestore();
  }
  expect(first).toBe(14);
  expect(second).toBe(14);
});

it.each(["map", "registry"])(
  "does not expose copied definitions to later native %s reads",
  (kind) => {
    const { guest } = fixture({ properties: { value: { get: () => 1 } } });
    const readMap = Map.prototype.get;
    const readRegistry = WeakMap.prototype.get;
    let exposed = false;
    const hook =
      kind === "map"
        ? vi.spyOn(Map.prototype, "get").mockImplementation(function (
            this: Map<unknown, unknown>,
            key
          ) {
            const result = readMap.call(this, key);
            if (key === "value") {
              exposed = true;
              this.set("injected", { get: () => 2 });
            }
            return result;
          })
        : vi.spyOn(WeakMap.prototype, "get").mockImplementation(function (
            this: WeakMap<object, unknown>,
            key
          ) {
            const result = readRegistry.call(this, key);
            if (key === guest && result?.properties instanceof Map) {
              exposed = true;
              result.properties.set("injected", { get: () => 2 });
            }
            return result;
          });
    let read: SandboxValue;
    try {
      read = getHostObjectMember(guest, "value");
    } finally {
      hook.mockRestore();
    }
    expect(read).toBe(1);
    expect(exposed).toBe(false);
    expect(getHostObjectKeys(guest)).toEqual(["value"]);
    expect(measureHostObjectData(guest)).toBe(6);
  }
);

it("does not expose private method maps through later native constructor insertion hooks", () => {
  const insert = Map.prototype.set;
  let exposed = false;
  const hook = vi.spyOn(Map.prototype, "set").mockImplementation(function (
    this: Map<unknown, unknown>,
    key,
    value
  ) {
    if (key === "operate") exposed = true;
    return insert.call(this, key, value);
  });
  let result: ReturnType<typeof fixture>;
  try {
    result = fixture({ methods: { operate: () => undefined } });
  } finally {
    hook.mockRestore();
  }
  expect(exposed).toBe(false);
  expect(getHostObjectKeys(result.guest)).toEqual(["operate"]);
  expect(measureHostObjectData(result.guest)).toBe(8);
});

it("revokes private members even when later native clear calls are replaced", () => {
  const { guest, host, controller } = fixture({
    properties: { value: { get: () => 1 } },
    methods: { operate: () => undefined }
  });
  const clear = vi.spyOn(Map.prototype, "clear").mockImplementation(() => {});
  try {
    revokeHostObject(host, controller.owner);
  } finally {
    clear.mockRestore();
  }
  expect(getHostObjectMember(guest, "value")).toBeUndefined();
  expect(getHostObjectMember(guest, "operate")).toBeUndefined();
  expect(getHostObjectKeys(guest)).toEqual([]);
  expect(measureHostObjectData(guest)).toBe(0);
});

it("copies exact charges even when native map iterator reads change during creation", () => {
  const prototype = Object.getPrototypeOf(new Map().keys());
  const next = vi.spyOn(prototype, "next").mockReturnValue({ done: true });
  let result: ReturnType<typeof fixture>;
  try {
    result = fixture({
      properties: { value: { get: () => 1 } },
      methods: { operate: () => undefined }
    });
  } finally {
    next.mockRestore();
  }
  expect(measureHostObjectData(result.guest)).toBe(14);
  expect(getHostObjectKeys(result.guest)).toEqual(["value", "operate"]);
});

it("preserves UTF-16 alias charges and fixed indexed/named headers after definition edits", () => {
  const read = vi.fn(() => 1);
  const property = { get: read };
  const definition: HostObjectDefinition = {
    properties: { "a🙂": property, alias: property },
    methods: { method: () => undefined },
    indexed: { length: read, get: read, maxLength: 2 },
    named: { keys: () => [], get: read, maxKeys: 2, maxKeyCodeUnits: 16 }
  };
  const { guest } = fixture(definition);
  definition.properties = { changed: property };
  definition.methods = {};
  definition.indexed = undefined;
  definition.named = undefined;
  expect(measureHostObjectData(guest)).toBe(57);
  expect(measureSandboxData([guest])).toBe(58);
  expect(read).not.toHaveBeenCalled();
});

it.each([false, true])(
  "clears fixed charges and optional guest descendants on owned revocation (named=%s)",
  (named) => {
    const { guest, host, controller } = fixture({
      properties: { value: { get: () => 1 } },
      methods: { operate: () => undefined },
      indexed: { length: () => 0, get: () => undefined, maxLength: 2 },
      ...(named
        ? { named: { keys: () => [], get: () => undefined, maxKeys: 2, maxKeyCodeUnits: 16 } }
        : { expandos: { maxKeys: 4, maxKeyCodeUnits: 32 } })
    });
    if (!named) setHostObjectMember(guest, "payload", { text: "retained" });
    expect(measureHostObjectData(guest)).toBe(named ? 54 : 30);
    revokeHostObject(host, controller.owner);
    expect(measureHostObjectData(guest)).toBe(0);
    expect(measureSandboxData([guest])).toBe(1);
    revokeHostObject(host, controller.owner);
    expect(measureHostObjectData(guest)).toBe(0);
  }
);

it("preserves member charges and live descendants when foreign revocation is rejected", () => {
  const { guest, host } = fixture({
    properties: { value: { get: () => 1 } },
    expandos: { maxKeys: 4, maxKeyCodeUnits: 32 }
  });
  const payload = { text: "short" };
  setHostObjectMember(guest, "payload", payload);
  const before = measureSandboxData([guest]);
  expect(() => revokeHostObject(host, {})).toThrow(TypeError);
  expect(measureHostObjectData(guest)).toBe(6);
  payload.text = "longer";
  expect(measureSandboxData([guest])).toBe(before + 1);
});

it.each([false, true])(
  "remeasures mutable descendants and rejects primary quotas (held=%s)",
  (held) => {
    const { guest } = fixture({
      properties: { value: { get: () => 1 } },
      expandos: { maxKeys: 4, maxKeyCodeUnits: 32 }
    });
    const payload = { text: "short" };
    setHostObjectMember(guest, "payload", payload);
    const captures = vi.fn(() => [guest]);
    const closure = createSandboxClosure({ call: () => undefined, retainedValues: captures });
    const budget = new Budget({ dataSize: 64 });
    const release = held ? budget.deferReconciliation() : undefined;
    try {
      reconcileCompiledValues(budget, [closure]);
      expect(budget.currentDataSize).toBe(measureSandboxData([closure]));
      payload.text = "x".repeat(200);
      captures.mockClear();
      expect(() => reconcileCompiledValues(budget, [closure])).toThrow(
        expect.objectContaining({ code: "budgetExceeded", budget: "dataSize" })
      );
      expect(captures).toHaveBeenCalled();
      expect(measureHostObjectData(guest)).toBe(6);
    } finally {
      release?.();
    }
  }
);
