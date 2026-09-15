import { describe, expect, it } from "vitest";
import { MemoryByteStream } from "./memory-byte-stream.js";
import { ExecutionBudget } from "./execution-budget.js";

describe("pinned byte buffer views", () => {
  it("shares writable bytes while snapshots remain independent", () => {
    const stream = new MemoryByteStream(new Uint8Array([1, 2, 3]));
    const view = stream.getbuffer();
    expect(view.length).toBe(3);
    expect(view.get(-1n)).toBe(3);
    view.set(1n, 8n);
    expect([...stream.getvalue()]).toEqual([1, 8, 3]);
    view.snapshot().fill(9);
    expect([...view.snapshot()]).toEqual([1, 8, 3]);
    expect([...stream.read()]).toEqual([1, 8, 3]);
    view.release();
  });

  it.each(["empty write", "overwrite", "truncate", "close"])("blocks %s while exported", operation => {
    const stream = new MemoryByteStream(new Uint8Array([1, 2, 3]));
    const view = stream.getbuffer();
    const act = () => {
      if (operation === "empty write") stream.write(new Uint8Array());
      else if (operation === "overwrite") stream.write(new Uint8Array([9]));
      else if (operation === "truncate") stream.truncate(3n);
      else stream.close();
    };
    expect(act).toThrow(expect.objectContaining({ name: "BufferError", message: "Existing exports of data: object cannot be re-sized" }));
    expect(stream.tell()).toBe(0n);
    expect([...stream.getvalue()]).toEqual([1, 2, 3]);
    view.release();
    expect(act).not.toThrow();
  });

  it("keeps independently acquired views pinned until each releases", () => {
    const stream = new MemoryByteStream();
    const first = stream.getbuffer(), second = stream.getbuffer();
    first.release();
    first.release();
    expect(() => stream.close()).toThrow(expect.objectContaining({ name: "BufferError" }));
    second.release();
    stream.close();
    expect(() => stream.getbuffer()).toThrow("I/O operation on closed file.");
  });

  it("keeps reversed and nested slices live after parent release", () => {
    const stream = new MemoryByteStream(new Uint8Array([1, 2, 3, 4, 5]));
    const parent = stream.getbuffer();
    const reverse = parent.slice(null, null, -1n);
    const child = reverse.slice(1n, 5n, 2n);
    parent.release();
    reverse.release();
    expect([...child.snapshot()]).toEqual([4, 2]);
    child.set(1n, 9n);
    expect([...stream.getvalue()]).toEqual([1, 9, 3, 4, 5]);
    expect(() => stream.close()).toThrow(expect.objectContaining({ name: "BufferError" }));
    child.release();
    stream.close();
  });

  it("supports huge slice bounds and strides without numeric overflow", () => {
    const stream = new MemoryByteStream(new Uint8Array([1, 2, 3]));
    const parent = stream.getbuffer();
    const single = parent.slice(null, null, 10n ** 100n);
    expect([...single.snapshot()]).toEqual([1]);
    single.set(0n, 7n);
    const empty = parent.slice(10n ** 100n);
    expect(empty.length).toBe(0);
    parent.release();
    single.release();
    expect(() => stream.close()).toThrow(expect.objectContaining({ name: "BufferError" }));
    empty.release();
    stream.close();
  });

  it("validates byte assignment and index bounds before mutation", () => {
    const stream = new MemoryByteStream(new Uint8Array([1]));
    const view = stream.getbuffer();
    expect(() => view.get(1n)).toThrow("index out of bounds on dimension 1");
    expect(() => view.get(1n << 63n)).toThrow("cannot fit 'int' into an index-sized integer");
    expect(() => view.set(0n, 256n)).toThrow("memoryview: invalid value for format 'B'");
    expect(() => view.set(0n, -1n)).toThrow("memoryview: invalid value for format 'B'");
    expect(() => view.slice(null, null, 0n)).toThrow("slice step cannot be zero");
    expect([...stream.getvalue()]).toEqual([1]);
    view.release();
    stream.close();
  });

  it("rejects all data access after idempotent release", () => {
    const stream = new MemoryByteStream(new Uint8Array([1]));
    const view = stream.getbuffer();
    view.release();
    view.release();
    for (const action of [() => view.length, () => view.get(0n), () => view.set(0n, 2n), () => view.snapshot(), () => view.slice()]) {
      expect(action).toThrow("operation forbidden on released memoryview object");
    }
    stream.close();
  });

  it("does not leak exports on failed acquisition or slicing", () => {
    const stream = new MemoryByteStream(new Uint8Array([1]));
    const exhausted = new ExecutionBudget({ maxSteps: 0, maxAllocatedBytes: 0 });
    expect(() => stream.getbuffer(exhausted)).toThrow(expect.objectContaining({ reason: "steps" }));
    const view = stream.getbuffer();
    expect(() => view.slice(null, null, null, exhausted)).toThrow(expect.objectContaining({ reason: "steps" }));
    view.release();
    stream.close();
  });

  it("meters mutation and snapshots while allowing release after termination", () => {
    const stream = new MemoryByteStream(new Uint8Array([1, 2]));
    const view = stream.getbuffer();
    const exhausted = new ExecutionBudget({ maxSteps: 0, maxAllocatedBytes: 0 });
    expect(() => view.set(0n, 8n, exhausted)).toThrow(expect.objectContaining({ reason: "steps" }));
    expect(() => view.snapshot(new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 1 }))).toThrow(expect.objectContaining({ reason: "allocation" }));
    expect([...stream.getvalue()]).toEqual([1, 2]);
    view.release();
    stream.close();
  });
});
