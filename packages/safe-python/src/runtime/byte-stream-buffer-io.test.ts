import { describe, expect, it } from "vitest";
import { MemoryByteStream } from "./memory-byte-stream.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

describe("byte stream buffer I/O", () => {
  it("reads into a view prefix without touching the remaining bytes", () => {
    const input = new MemoryByteStream(new Uint8Array([1, 2]));
    const output = new MemoryByteStream(new Uint8Array([9, 9, 9, 9]));
    const view = output.getbuffer();
    expect(input.readinto(view)).toBe(2n);
    expect([...output.getvalue()]).toEqual([1, 2, 9, 9]);
    expect(input.tell()).toBe(2n);
    expect(output.tell()).toBe(0n);
    view.release();
  });

  it("handles readinto a slice of its own exported buffer without overlap corruption", () => {
    const stream = new MemoryByteStream(new Uint8Array([1, 2, 3, 4, 5]));
    const root = stream.getbuffer(), tail = root.slice(1n);
    expect(stream.readinto(tail)).toBe(4n);
    expect([...stream.getvalue()]).toEqual([1, 1, 2, 3, 4]);
    expect(stream.tell()).toBe(4n);
    tail.release(); root.release(); stream.close();
  });

  it.each([false, true])("writes a contiguous view with readonly %s", readonly => {
    const input = new MemoryByteStream(new Uint8Array([1, 2, 3, 4]));
    const root = input.getbuffer();
    let view = root.slice(1n, 3n);
    if (readonly) { const previous = view; view = view.toreadonly(); previous.release(); }
    const output = new MemoryByteStream();
    expect(output.write(view)).toBe(2n);
    view.release(); root.release(); input.close();
    expect([...output.getvalue()]).toEqual([2, 3]);
  });

  it.each(["readonly", "strided", "released"])("rejects %s readinto buffers before closed-state validation", kind => {
    const stream = new MemoryByteStream();
    const storage = new MemoryByteStream(new Uint8Array([1, 2, 3]));
    const root = storage.getbuffer();
    const view = kind === "readonly" ? root.toreadonly() : root.slice(null, null, kind === "strided" ? 2n : 1n);
    if (kind === "released") view.release();
    for (const closed of [false, true]) {
      if (closed) stream.close();
      expect(() => stream.readinto(view)).toThrow(expect.objectContaining({ name: "TypeError", message: "readinto() argument must be read-write bytes-like object, not memoryview" }));
    }
    view.release(); root.release(); storage.close();
  });

  it("rejects noncontiguous write buffers and released views before closed-state validation", () => {
    const stream = new MemoryByteStream();
    stream.close();
    const storage = new MemoryByteStream(new Uint8Array([1, 2, 3]));
    const root = storage.getbuffer(), view = root.slice(null, null, -1n);
    expect(() => stream.write(view)).toThrow(expect.objectContaining({ name: "BufferError", message: "memoryview: underlying buffer is not C-contiguous" }));
    view.release();
    expect(() => stream.write(view)).toThrow("operation forbidden on released memoryview object");
    root.release();
  });

  it("requires unit stride for empty views but treats singleton views as contiguous", () => {
    const storage = new MemoryByteStream(new Uint8Array([1, 2, 3]));
    const root = storage.getbuffer(), empty = root.slice(1n, 1n, -1n), single = root.slice(null, null, 20n);
    expect(empty.cContiguous).toBe(false);
    expect(single.cContiguous).toBe(true);
    const stream = new MemoryByteStream(new Uint8Array([8]));
    expect(() => stream.readinto(empty)).toThrow(expect.objectContaining({ name: "TypeError" }));
    expect(stream.readinto(single)).toBe(1n);
    expect([...storage.getvalue()]).toEqual([8, 2, 3]);
    empty.release(); single.release(); root.release();
  });

  it("preserves signed stride composition through empty and singleton views", () => {
    const storage = new MemoryByteStream(new Uint8Array([1]));
    const root = storage.getbuffer(), reverse = root.slice(null, null, -1n);
    const empty = reverse.slice(0n, 0n), restored = empty.slice(null, null, -1n);
    expect(empty.cContiguous).toBe(false);
    expect(restored.cContiguous).toBe(true);
    const huge = restored.slice(null, null, 10n ** 100n), wrapped = huge.slice(null, null, 10n ** 100n);
    expect(huge.cContiguous).toBe(false);
    expect(wrapped.cContiguous).toBe(true);
    wrapped.release(); huge.release(); restored.release(); empty.release(); reverse.release(); root.release();
    storage.close();
  });

  it("still blocks writing a stream's own exported buffer", () => {
    const stream = new MemoryByteStream(new Uint8Array([1, 2]));
    const view = stream.getbuffer();
    expect(() => stream.write(view)).toThrow("Existing exports of data: object cannot be re-sized");
    view.release();
  });

  it("keeps cursor, aliased target, and leases intact at readinto budget boundaries", () => {
    for (const axis of ["maxSteps", "maxAllocatedBytes"] as const) for (let limit = 0; limit < 40; limit++) {
      const stream = new MemoryByteStream(new Uint8Array([1, 2, 3, 4]));
      const root = stream.getbuffer(), target = root.slice(1n);
      try {
        expect(stream.readinto(target, new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 100, [axis]: limit }))).toBe(3n);
        expect([...stream.getvalue()]).toEqual([1, 1, 2, 3]);
      } catch (error) {
        expect(error).toBeInstanceOf(ExecutionLimitError);
        expect(stream.tell()).toBe(0n);
        expect([...stream.getvalue()]).toEqual([1, 2, 3, 4]);
      }
      target.release(); root.release(); stream.close();
    }
  });
});
