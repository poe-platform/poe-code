import { describe, expect, it } from "vitest";
import { MemoryByteStream } from "./memory-byte-stream.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

describe("memory byte stream storage", () => {
  it("owns constructor, write, and returned buffers independently", () => {
    const initial = new Uint8Array([1, 2, 3]);
    const stream = new MemoryByteStream(initial);
    initial.fill(9);
    const result = stream.read(2n);
    result.fill(8);
    const input = new Uint8Array([4]);
    expect(stream.write(input)).toBe(1n);
    input.fill(7);
    const snapshot = stream.getvalue();
    snapshot.fill(6);
    expect([...stream.getvalue()]).toEqual([1, 2, 4]);
  });

  it.each([null, -1n, -20n, 10n, 3n])("reads to EOF for size %s", size => {
    const stream = new MemoryByteStream(new Uint8Array([1, 2, 3]));
    expect([...stream.read(size)]).toEqual([1, 2, 3]);
    expect(stream.tell()).toBe(3n);
    expect([...stream.read()]).toEqual([]);
  });

  it("reads binary lines using LF only and respects a size limit", () => {
    const stream = new MemoryByteStream(new Uint8Array([97, 13, 98, 10, 99, 10]));
    expect([...stream.read(2n, true)]).toEqual([97, 13]);
    expect([...stream.read(null, true)]).toEqual([98, 10]);
    expect([...stream.read(0n, true)]).toEqual([]);
    expect([...stream.read(null, true)]).toEqual([99, 10]);
  });

  it("reads into only the filled prefix of caller storage", () => {
    const stream = new MemoryByteStream(new Uint8Array([1, 2]));
    const target = new Uint8Array([9, 9, 9]);
    expect(stream.readinto(target)).toBe(2n);
    expect([...target]).toEqual([1, 2, 9]);
    expect(stream.readinto(target)).toBe(0n);
  });

  it("seeks relative to start, cursor, and logical EOF", () => {
    const stream = new MemoryByteStream(new Uint8Array([1, 2, 3]));
    expect(stream.seek(2n)).toBe(2n);
    expect(stream.seek(-100n, 1)).toBe(0n);
    expect(stream.seek(-1n, 2)).toBe(2n);
    expect(stream.seek(10n, 2)).toBe(13n);
    expect([...stream.read()]).toEqual([]);
    expect(stream.tell()).toBe(13n);
  });

  it("zero-fills holes and does not extend on empty writes", () => {
    const stream = new MemoryByteStream(new Uint8Array([1, 2, 3]));
    stream.seek(5n);
    expect(stream.write(new Uint8Array())).toBe(0n);
    expect([...stream.getvalue()]).toEqual([1, 2, 3]);
    expect(stream.write(new Uint8Array([7]))).toBe(1n);
    expect([...stream.getvalue()]).toEqual([1, 2, 3, 0, 0, 7]);
  });

  it("truncates without moving the cursor or exposing discarded bytes on regrowth", () => {
    const stream = new MemoryByteStream(new Uint8Array([1, 2, 3, 4]));
    stream.seek(3n);
    expect(stream.truncate(1n)).toBe(1n);
    expect(stream.tell()).toBe(3n);
    expect(stream.truncate(20n)).toBe(20n);
    expect([...stream.getvalue()]).toEqual([1]);
    stream.write(new Uint8Array([8]));
    expect([...stream.getvalue()]).toEqual([1, 0, 0, 8]);
    expect(stream.truncate()).toBe(4n);
  });

  it("keeps huge cursor positions exact without allocating", () => {
    const stream = new MemoryByteStream();
    const maximum = (1n << 63n) - 1n;
    expect(stream.seek(maximum)).toBe(maximum);
    expect([...stream.read()]).toEqual([]);
    expect(stream.write(new Uint8Array())).toBe(0n);
    expect(() => stream.seek(1n, 1)).toThrow("new position too large");
    expect(stream.tell()).toBe(maximum);
    expect(() => stream.write(new Uint8Array([1]))).toThrow(expect.objectContaining({ name: "OverflowError" }));
  });

  it("validates negative sizes and integer conversion limits", () => {
    const stream = new MemoryByteStream();
    expect(() => stream.seek(-1n)).toThrow("negative seek value -1");
    expect(() => stream.seek(0n, 3)).toThrow("invalid whence (3, should be 0, 1 or 2)");
    expect(() => stream.seek(1n << 63n)).toThrow("Python int too large to convert to C ssize_t");
    expect(() => stream.truncate(-1n)).toThrow("negative size value -1");
    expect(() => stream.truncate(1n << 63n)).toThrow("Python int too large to convert to C long");
    expect(() => stream.read(1n << 63n)).toThrow("cannot fit 'int' into an index-sized integer");
  });

  it("closes idempotently and rejects further I/O", () => {
    const stream = new MemoryByteStream(new Uint8Array([1]));
    expect(stream.closed).toBe(false);
    stream.close();
    stream.close();
    expect(stream.closed).toBe(true);
    for (const operation of [() => stream.tell(), () => stream.seek(0n), () => stream.read(), () => stream.readinto(new Uint8Array()), () => stream.write(new Uint8Array()), () => stream.truncate(), () => stream.getvalue()]) {
      expect(operation).toThrow("I/O operation on closed file.");
    }
  });

  it("grows geometrically under repeated single-byte writes", () => {
    const stream = new MemoryByteStream();
    const budget = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 4096 });
    for (let index = 0; index < 1000; index++) stream.write(new Uint8Array([index % 256]), budget);
    expect(stream.tell()).toBe(1000n);
    expect([...stream.getvalue()]).toEqual(Array.from({ length: 1000 }, (_, index) => index % 256));
  });

  it("leaves storage and cursor intact at write budget boundaries", () => {
    for (const axis of ["maxSteps", "maxAllocatedBytes"] as const) for (let limit = 0; limit < 100; limit++) {
      const stream = new MemoryByteStream(new Uint8Array([1, 2, 3]));
      stream.seek(5n);
      const budget = new ExecutionBudget({ maxSteps: 1000, maxAllocatedBytes: 1000, [axis]: limit });
      try { stream.write(new Uint8Array([9, 8]), budget); }
      catch (error) {
        expect(error).toBeInstanceOf(ExecutionLimitError);
        expect(stream.tell()).toBe(5n);
        expect([...stream.getvalue()]).toEqual([1, 2, 3]);
        continue;
      }
      expect(stream.tell()).toBe(7n);
      expect([...stream.getvalue()]).toEqual([1, 2, 3, 0, 0, 9, 8]);
    }
  });

  it("does not advance or modify readinto output on budget failure", () => {
    const stream = new MemoryByteStream(new Uint8Array([1, 2, 3]));
    const target = new Uint8Array([9, 9, 9]);
    expect(() => stream.readinto(target, new ExecutionBudget({ maxSteps: 1, maxAllocatedBytes: 100 }))).toThrow(ExecutionLimitError);
    expect([...target]).toEqual([9, 9, 9]);
    expect(stream.tell()).toBe(0n);
    expect(() => stream.read(null, true, new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 1 }))).toThrow(ExecutionLimitError);
    expect(stream.tell()).toBe(0n);
  });
});
