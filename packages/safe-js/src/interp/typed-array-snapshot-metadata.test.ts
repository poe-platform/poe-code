import { expect, it, vi } from "vitest";
import { Budget, SandboxError } from "./budget.js";
import { copyHostValueToSandbox } from "./host-bridge.js";
import {
  createOwnedTypedArray,
  isNumericTypedArray,
  numericTypedArrayConstructors,
  typedArrayStorage,
  typedArrayViewLayouts
} from "./typed-array.js";
import {
  cloneSandboxValue,
  deepCopyFromSandbox,
  deepCopyToSandbox,
  measureSandboxData,
  reconcileCompiledValues,
  type SandboxValue
} from "./values.js";

const routes = {
  data: (value: SandboxValue) => deepCopyToSandbox(value),
  clone: (value: SandboxValue) => cloneSandboxValue(value, { structuredClone: true }),
  host: (value: SandboxValue) =>
    copyHostValueToSandbox(value, [], { budget: new Budget() }, { seen: new WeakMap() }, "<root>")
};

it.each(Object.entries(routes))(
  "keeps %s snapshot accounting independent of typed-array element enumeration",
  (_name, copyValue) => {
    for (const Native of Object.values(numericTypedArrayConstructors)) {
      const original = new Native(4);
      const expected = measureSandboxData([original]);
      const copy = copyValue(original);
      expect(isNumericTypedArray(copy)).toBe(true);
      const ownKeys = Reflect.ownKeys;
      const spy = vi.spyOn(Reflect, "ownKeys").mockImplementation((value) => {
        if (value === copy) throw new Error("Snapshot accounting enumerated element keys");
        return ownKeys(value);
      });
      try {
        expect(measureSandboxData([copy])).toBe(expected);
      } finally {
        spy.mockRestore();
      }
    }
  }
);

it("keeps cloned buffer aliases, copied metadata and subsequent mutation charges", () => {
  const source = new Uint8Array([1, 2]);
  const key = Symbol("metadata");
  Object.defineProperty(source, "payload", { value: "small", writable: true, configurable: true });
  const copied = deepCopyToSandbox({ source, buffer: source.buffer }) as {
    source: Uint8Array<ArrayBuffer> & { payload: string };
    buffer: ArrayBuffer;
  };
  Object.defineProperty(copied.source, key, { value: copied.source, configurable: true });
  expect(copied.source.buffer).toBe(copied.buffer);
  expect(copied.buffer).not.toBe(source.buffer);
  expect(Reflect.get(copied.source, key)).toBe(copied.source);
  const before = measureSandboxData([copied]);
  copied.source.payload = "x".repeat(205);
  expect(measureSandboxData([copied]) - before).toBe(200);
  const budget = new Budget({ dataSize: before + 100 });
  expect(() => reconcileCompiledValues(budget, [copied])).toThrow(SandboxError);
  Reflect.deleteProperty(copied.source, "payload");
  expect(Object.getOwnPropertyDescriptor(source, "payload")?.value).toBe("small");
  Reflect.deleteProperty(copied.source, key);
  const exported = deepCopyFromSandbox(copied.source);
  expect(ArrayBuffer.isView(exported)).toBe(true);
  expect(Array.from(exported as Uint8Array)).toEqual([1, 2]);
});

it("keeps ordinary native views conservative after creating an isolated snapshot", () => {
  const source = new Uint8Array(4);
  deepCopyToSandbox(source);
  const before = measureSandboxData([source]);
  Object.defineProperty(source, "payload", { value: "x".repeat(200) });
  expect(measureSandboxData([source]) - before).toBe(208);
});

it("tracks resizable copied view metadata through shrink and regrowth without enumerating indices", () => {
  const buffer = Reflect.construct(ArrayBuffer, [8, { maxByteLength: 16 }]) as ArrayBuffer;
  const source = createOwnedTypedArray(Uint8Array, [buffer, 4]);
  typedArrayViewLayouts.set(source, { byteOffset: 4 });
  const copy = deepCopyToSandbox(source);
  if (!isNumericTypedArray(copy)) throw new Error("Missing copied view");
  const copiedBuffer = typedArrayStorage(copy).buffer as ArrayBuffer;
  const resize = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "resize")!.value;
  Reflect.apply(resize, copiedBuffer, [2]);
  expect(copy.length).toBe(0);
  Reflect.apply(resize, copiedBuffer, [16]);
  expect(copy.length).toBe(12);
  const ownKeys = Reflect.ownKeys;
  const spy = vi.spyOn(Reflect, "ownKeys").mockImplementation((value) => {
    if (value === copy) throw new Error("Resizable snapshot accounting enumerated indices");
    return ownKeys(value);
  });
  try {
    measureSandboxData([copy]);
  } finally {
    spy.mockRestore();
  }
});
