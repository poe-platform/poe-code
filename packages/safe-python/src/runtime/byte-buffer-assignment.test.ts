import { describe, expect, it } from "vitest";
import { MemoryByteStream } from "./memory-byte-stream.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

describe("byte view readonly access and assignment", () => {
  it("creates a separately released readonly lease without copying data", () => {
    const stream = new MemoryByteStream(new Uint8Array([1, 2]));
    const writable = stream.getbuffer(), readonly = writable.toreadonly();
    expect(writable.readonly).toBe(false);
    expect(readonly.readonly).toBe(true);
    writable.set(0n, 9n);
    expect([...readonly.snapshot()]).toEqual([9, 2]);
    writable.release();
    expect(() => stream.close()).toThrow(expect.objectContaining({ name: "BufferError" }));
    readonly.release();
    stream.close();
  });

  it("preserves readonly access through slices and repeated conversions", () => {
    const stream = new MemoryByteStream(new Uint8Array([1, 2, 3]));
    const writable = stream.getbuffer(), readonly = writable.toreadonly();
    const reversed = readonly.slice(null, null, -1n), again = readonly.toreadonly();
    writable.release();
    readonly.release();
    expect(reversed.readonly).toBe(true);
    expect(again.readonly).toBe(true);
    expect([...reversed.snapshot()]).toEqual([3, 2, 1]);
    reversed.release();
    expect(() => stream.close()).toThrow(expect.objectContaining({ name: "BufferError" }));
    again.release();
    stream.close();
  });

  it("rejects readonly mutations before index, value, and source validation", () => {
    const stream = new MemoryByteStream(new Uint8Array([1]));
    const view = stream.getbuffer(), readonly = view.toreadonly();
    view.release();
    for (const action of [() => readonly.set(99n, 999n), () => readonly.assign(new Uint8Array()), () => readonly.assign(view)]) {
      expect(action).toThrow(expect.objectContaining({ name: "TypeError", message: "cannot modify read-only memory" }));
    }
    readonly.release();
    expect(() => readonly.readonly).toThrow("operation forbidden on released memoryview object");
    expect(() => readonly.toreadonly()).toThrow("operation forbidden on released memoryview object");
    expect(() => readonly.assign(new Uint8Array())).toThrow("operation forbidden on released memoryview object");
  });

  it.each([false, true])("assigns overlapping bytes with reverse direction %s", reverse => {
    const stream = new MemoryByteStream(new Uint8Array([1, 2, 3, 4, 5]));
    const view = stream.getbuffer();
    const left = view.slice(0n, 4n), right = view.slice(1n);
    if (reverse) left.assign(right);
    else right.assign(left);
    expect([...stream.getvalue()]).toEqual(reverse ? [2, 3, 4, 5, 5] : [1, 1, 2, 3, 4]);
    left.release(); right.release(); view.release();
    stream.close();
  });

  it("snapshots reversed self-assignment before writing any destination byte", () => {
    const stream = new MemoryByteStream(new Uint8Array([1, 2, 3, 4]));
    const view = stream.getbuffer(), reverse = view.slice(null, null, -1n);
    view.assign(reverse);
    expect([...stream.getvalue()]).toEqual([4, 3, 2, 1]);
    view.assign(view);
    expect([...stream.getvalue()]).toEqual([4, 3, 2, 1]);
    reverse.release(); view.release();
  });

  it("assigns noncontiguous views and byte arrays without resizing", () => {
    const stream = new MemoryByteStream(new Uint8Array([1, 2, 3, 4, 5, 6]));
    const view = stream.getbuffer(), evens = view.slice(null, null, 2n), odds = view.slice(1n, null, 2n);
    evens.assign(odds);
    expect([...stream.getvalue()]).toEqual([2, 2, 4, 4, 6, 6]);
    odds.assign(new Uint8Array([7, 8, 9]));
    expect([...stream.getvalue()]).toEqual([2, 7, 4, 8, 6, 9]);
    expect(() => evens.assign(new Uint8Array([0]))).toThrow("memoryview assignment: lvalue and rvalue have different structures");
    evens.release(); odds.release(); view.release();
  });

  it("accepts readonly sources and empty equal-structure assignments", () => {
    const stream = new MemoryByteStream(new Uint8Array([1, 2]));
    const view = stream.getbuffer(), readonly = view.toreadonly(), empty = view.slice(1n, 1n);
    view.assign(readonly);
    empty.assign(new Uint8Array());
    expect([...stream.getvalue()]).toEqual([1, 2]);
    readonly.release(); empty.release(); view.release();
  });

  it("rejects released sources without altering the destination", () => {
    const stream = new MemoryByteStream(new Uint8Array([1, 2]));
    const view = stream.getbuffer(), source = view.slice();
    source.release();
    expect(() => view.assign(source)).toThrow("operation forbidden on released memoryview object");
    expect([...stream.getvalue()]).toEqual([1, 2]);
    view.release();
  });

  it("keeps overlap assignment atomic across snapshot and mutation budget checks", () => {
    for (const axis of ["maxSteps", "maxAllocatedBytes"] as const) for (let limit = 0; limit < 30; limit++) {
      const stream = new MemoryByteStream(new Uint8Array([1, 2, 3, 4]));
      const view = stream.getbuffer(), source = view.slice(null, null, -1n);
      const budget = new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 100, [axis]: limit });
      try {
        view.assign(source, budget);
        expect([...stream.getvalue()]).toEqual([4, 3, 2, 1]);
      } catch (error) {
        expect(error).toBeInstanceOf(ExecutionLimitError);
        expect([...stream.getvalue()]).toEqual([1, 2, 3, 4]);
      }
      source.release(); view.release(); stream.close();
    }
  });
});
