import { describe, expect, it } from "vitest";
import { Utf8IncrementalDecoder } from "./utf8-incremental.js";
import { ExecutionBudget } from "./execution-budget.js";

describe("incremental UTF-8 decoding", () => {
  it.each([
    [[0xc2, 0x80], [0x80]], [[0xe2, 0x82, 0xac], [0x20ac]],
    [[0xf0, 0x90, 0x80, 0x80], [0x10000]],
    [[65, 0xef, 0xbb, 0xbf, 66], [65, 0xfeff, 66]]
  ])("handles every chunk boundary in %s", (bytes, expected) => {
    for (let split = 0; split <= bytes.length; split++) {
      const decoder = new Utf8IncrementalDecoder();
      const first = decoder.decode(new Uint8Array(bytes.slice(0, split)));
      const last = decoder.decode(new Uint8Array(bytes.slice(split)), true);
      expect([...first, ...last]).toEqual(expected);
      expect(decoder.getstate()).toEqual([new Uint8Array(), 0n]);
    }
  });

  it("buffers one byte at a time and survives empty chunks", () => {
    const decoder = new Utf8IncrementalDecoder();
    expect([...decoder.decode(new Uint8Array([0xf0]))]).toEqual([]);
    expect([...decoder.decode(new Uint8Array())]).toEqual([]);
    expect([...decoder.decode(new Uint8Array([0x90, 0x80]))]).toEqual([]);
    expect(decoder.getstate()).toEqual([new Uint8Array([0xf0, 0x90, 0x80]), 0n]);
    expect([...decoder.decode(new Uint8Array([0x80]), true)]).toEqual([0x10000]);
  });

  it.each(["strict", "replace", "surrogatepass", "surrogateescape"] as const)("defers an unfinished surrogate prefix with %s", errors => {
    const decoder = new Utf8IncrementalDecoder(errors);
    expect([...decoder.decode(new Uint8Array([0xed, 0xa0]))]).toEqual([]);
    expect(decoder.getstate()).toEqual([new Uint8Array([0xed, 0xa0]), 0n]);
  });

  it("rejects already-invalid partial prefixes immediately", () => {
    for (const bytes of [[0xe0, 0x80], [0xf4, 0x90], [0xc0], [0xed, 65]]) {
      expect(() => new Utf8IncrementalDecoder().decode(new Uint8Array(bytes))).toThrow(expect.objectContaining({ name: "UnicodeDecodeError" }));
    }
  });

  it("flushes incomplete bytes using the current error policy", () => {
    const decoder = new Utf8IncrementalDecoder();
    decoder.decode(new Uint8Array([0xe2, 0x82]));
    expect(() => decoder.decode(new Uint8Array(), true)).toThrow(expect.objectContaining({ start: 0, end: 2, reason: "unexpected end of data" }));
    expect(decoder.getstate()[0]).toEqual(new Uint8Array([0xe2, 0x82]));
    decoder.errors = "surrogateescape";
    expect([...decoder.decode(new Uint8Array(), true)]).toEqual([0xdce2, 0xdc82]);
    expect([...decoder.decode(new Uint8Array([65]))]).toEqual([65]);
  });

  it("keeps old pending state on failure and reports the complete combined input", () => {
    const decoder = new Utf8IncrementalDecoder();
    decoder.decode(new Uint8Array([0xe2]));
    expect(() => decoder.decode(new Uint8Array([65, 0xf0]))).toThrow(expect.objectContaining({ object: new Uint8Array([0xe2, 65, 0xf0]), start: 0, end: 1 }));
    expect(decoder.getstate()[0]).toEqual(new Uint8Array([0xe2]));
    expect([...decoder.decode(new Uint8Array([0x82, 0xac]))]).toEqual([0x20ac]);
  });

  it("copies input tails and state snapshots without aliasing", () => {
    const input = new Uint8Array([0xe2]);
    const decoder = new Utf8IncrementalDecoder();
    decoder.decode(input);
    input[0] = 65;
    const snapshot = decoder.getstate();
    snapshot[0][0] = 66;
    expect(decoder.getstate()[0]).toEqual(new Uint8Array([0xe2]));
    const restored = new Utf8IncrementalDecoder();
    const state = decoder.getstate();
    restored.setstate(state);
    state[0][0] = 67;
    expect([...restored.decode(new Uint8Array([0x82, 0xac]))]).toEqual([0x20ac]);
    decoder.reset();
    expect(decoder.getstate()).toEqual([new Uint8Array(), 0n]);
  });

  it("allows decoder state containing ordinary bytes and ignores auxiliary state", () => {
    const decoder = new Utf8IncrementalDecoder();
    decoder.setstate([new Uint8Array([65]), 12n]);
    expect([...decoder.decode(new Uint8Array([66]))]).toEqual([65, 66]);
    expect(decoder.getstate()[1]).toBe(0n);
  });

  it("leaves state unchanged when buffer assembly exceeds its budget", () => {
    const decoder = new Utf8IncrementalDecoder();
    decoder.decode(new Uint8Array([0xe2]));
    const budget = new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 2 });
    expect(() => decoder.decode(new Uint8Array([0x82, 0xac]), false, budget)).toThrow(expect.objectContaining({ reason: "allocation" }));
    expect(decoder.getstate()[0]).toEqual(new Uint8Array([0xe2]));
  });

  it("does not commit pending-state replacement after a cancelled checkpoint", () => {
    const decoder = new Utf8IncrementalDecoder();
    decoder.decode(new Uint8Array([0xe2]));
    const controller = new AbortController();
    controller.abort();
    const budget = new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 100, signal: controller.signal });
    expect(() => decoder.decode(new Uint8Array([0x82, 0xac]), true, budget)).toThrow(expect.objectContaining({ reason: "cancelled" }));
    expect(decoder.getstate()[0]).toEqual(new Uint8Array([0xe2]));
  });
});
