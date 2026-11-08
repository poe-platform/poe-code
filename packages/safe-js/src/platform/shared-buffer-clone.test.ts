import { afterEach, expect, it, vi } from "vitest";

const nativeClone = structuredClone;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

it.each([0, 4, 65_536])("preserves shared storage when native clone loses the shared brand (%s bytes)", async length => {
  vi.resetModules();
  const clone = vi.fn((value: unknown) => value instanceof SharedArrayBuffer
    ? new Uint8Array(value).slice().buffer : nativeClone(value));
  vi.stubGlobal("structuredClone", clone);
  const { Budget } = await import("../interp/budget.js");
  const { createSharedArrayBufferStorage, cloneSharedArrayBufferStorage, sharedArrayBufferStorage } =
    await import("../interp/shared-array-buffer.js");
  const source = createSharedArrayBufferStorage(length, undefined, new Budget());
  const getter = vi.fn(() => { throw new Error("Getter must not run"); });
  Object.defineProperty(source, "constructor", { get: getter });
  const copy = cloneSharedArrayBufferStorage(source);
  expect(copy).toBeInstanceOf(SharedArrayBuffer);
  expect(copy === source).toBe(false);
  expect(sharedArrayBufferStorage(copy).block).toBe(sharedArrayBufferStorage(source).block);
  expect(copy.byteLength).toBe(length);
  if (length > 0) {
    new Uint8Array(copy)[0] = 7;
    expect(new Uint8Array(source)[0]).toBe(7);
    new Uint8Array(source)[length - 1] = 9;
    expect(new Uint8Array(copy)[length - 1]).toBe(9);
  }
  expect(getter).not.toHaveBeenCalled();
  // The defective clone sees only the bounded capability probe, never guest storage.
  expect(clone).toHaveBeenCalledOnce();
  expect((clone.mock.calls[0][0] as SharedArrayBuffer).byteLength).toBe(1);
});

it("retains the native fast path when it preserves sharing", async () => {
  vi.resetModules();
  const clone = vi.fn(nativeClone);
  vi.stubGlobal("structuredClone", clone);
  const { Budget } = await import("../interp/budget.js");
  const { createSharedArrayBufferStorage, cloneSharedArrayBufferStorage } =
    await import("../interp/shared-array-buffer.js");
  const source = createSharedArrayBufferStorage(4, undefined, new Budget());
  const copy = cloneSharedArrayBufferStorage(source);
  expect(clone).toHaveBeenCalledWith(source);
  expect(copy === source).toBe(false);
  new Uint8Array(copy)[0] = 7;
  expect(new Uint8Array(source)[0]).toBe(7);
});

it.each(["detached storage", "same wrapper", "throws"])("rejects a native clone with %s", async failure => {
  vi.resetModules();
  const clone = vi.fn((value: SharedArrayBuffer) => {
    if (failure === "throws") throw new TypeError("Unsupported clone");
    return failure === "same wrapper" ? value : new SharedArrayBuffer(value.byteLength);
  });
  vi.stubGlobal("structuredClone", clone);
  const { cloneSharedBufferWrapper } = await import("./node.js");
  const source = new SharedArrayBuffer(4);
  const copy = cloneSharedBufferWrapper(source);
  expect(copy === source).toBe(false);
  new Uint8Array(copy)[0] = 7;
  expect(new Uint8Array(source)[0]).toBe(7);
  expect(clone).toHaveBeenCalledOnce();
});

it.skipIf(Object.getOwnPropertyDescriptor(SharedArrayBuffer.prototype, "growable") === undefined)(
  "preserves growth through the fallback wrapper", async () => {
    vi.resetModules();
    vi.stubGlobal("structuredClone", () => new ArrayBuffer(1));
    const { cloneSharedBufferWrapper } = await import("./node.js");
    const source = Reflect.construct(SharedArrayBuffer, [4, { maxByteLength: 8 }]) as SharedArrayBuffer;
    const copy = cloneSharedBufferWrapper(source);
    const grow = Object.getOwnPropertyDescriptor(SharedArrayBuffer.prototype, "grow")!.value;
    const growable = Object.getOwnPropertyDescriptor(SharedArrayBuffer.prototype, "growable")!.get!;
    const maxByteLength = Object.getOwnPropertyDescriptor(SharedArrayBuffer.prototype, "maxByteLength")!.get!;
    expect(Reflect.apply(growable, copy, [])).toBe(true);
    expect(Reflect.apply(maxByteLength, copy, [])).toBe(8);
    Reflect.apply(grow, source, [8]);
    expect(copy.byteLength).toBe(8);
    new Uint8Array(copy)[7] = 9;
    expect(new Uint8Array(source)[7]).toBe(9);
  }
);
