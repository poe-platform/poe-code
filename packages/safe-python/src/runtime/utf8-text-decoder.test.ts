import { describe, expect, it } from "vitest";
import { Utf8TextDecoder } from "./utf8-text-decoder.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

describe("UTF-8 text decoding", () => {
  it.each([null, "", "\n", "\r", "\r\n"])("supports read newline mode %j", newline => {
    const decoder = new Utf8TextDecoder(newline);
    const output = [...decoder.decode(new Uint8Array([97, 13, 10, 98, 13, 99, 10]), true)];
    expect(output).toEqual(newline === null ? [97, 10, 98, 10, 99, 10] : [97, 13, 10, 98, 13, 99, 10]);
    expect(decoder.newlines).toEqual(newline === null || newline === "" ? ["\r", "\n", "\r\n"] : null);
  });

  it.each([null, ""])("buffers bytes and CR independently for %j", newline => {
    const decoder = new Utf8TextDecoder(newline);
    expect([...decoder.decode(new Uint8Array([13, 0xe2]))]).toEqual([]);
    expect([...decoder.decode(new Uint8Array([0x82]))]).toEqual([]);
    expect([...decoder.decode(new Uint8Array([0xac, 13]))]).toEqual([newline === null ? 10 : 13, 0x20ac]);
    expect([...decoder.decode(new Uint8Array([10]), true)]).toEqual(newline === null ? [10] : [13, 10]);
    expect(decoder.newlines).toEqual(["\r", "\r\n"]);
  });

  it("preserves both layers after decoding failure and uses the current error policy", () => {
    const decoder = new Utf8TextDecoder();
    decoder.decode(new Uint8Array([13, 0xe2]));
    expect(() => decoder.decode(new Uint8Array(), true)).toThrow(expect.objectContaining({ name: "UnicodeDecodeError" }));
    expect(decoder.newlines).toBeNull();
    decoder.errors = "replace";
    expect([...decoder.decode(new Uint8Array(), true)]).toEqual([10, 0xfffd]);
    expect(decoder.newlines).toBe("\r");
  });

  it("keeps the whole composition atomic at every budget boundary", () => {
    for (const axis of ["maxSteps", "maxAllocatedBytes"] as const) {
      for (let limit = 0; limit < 100; limit++) {
        const decoder = new Utf8TextDecoder();
        decoder.decode(new Uint8Array([13, 0xe2]));
        const input = new Uint8Array([0x82, 0xac, 10]);
        const budget = new ExecutionBudget({ maxSteps: 1000, maxAllocatedBytes: 1000, [axis]: limit });
        try {
          expect([...decoder.decode(input, true, budget)]).toEqual([10, 0x20ac, 10]);
        } catch (error) {
          if (!(error instanceof ExecutionLimitError)) throw error;
          expect(decoder.newlines).toBeNull();
          expect([...decoder.decode(input, true)]).toEqual([10, 0x20ac, 10]);
        }
        expect(decoder.newlines).toEqual(["\r", "\n"]);
      }
    }
  });

  it("resets pending bytes, pending CR, and observed forms together", () => {
    const decoder = new Utf8TextDecoder();
    decoder.decode(new Uint8Array([10, 13, 0xe2]));
    decoder.reset();
    expect(decoder.newlines).toBeNull();
    expect([...decoder.decode(new Uint8Array([97]), true)]).toEqual([97]);
  });

  it("does not reset either layer when cancelled", () => {
    const decoder = new Utf8TextDecoder();
    decoder.decode(new Uint8Array([13, 0xe2]));
    const controller = new AbortController();
    controller.abort();
    const budget = new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 100, signal: controller.signal });
    expect(() => decoder.reset(budget)).toThrow(expect.objectContaining({ reason: "cancelled" }));
    expect([...decoder.decode(new Uint8Array([0x82, 0xac]), true)]).toEqual([10, 0x20ac]);
  });

  it("rejects unsupported newline values", () => {
    expect(() => new Utf8TextDecoder("x")).toThrow(expect.objectContaining({ name: "ValueError" }));
  });
});
