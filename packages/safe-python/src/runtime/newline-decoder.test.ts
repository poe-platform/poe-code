import { describe, expect, it } from "vitest";
import { UniversalNewlineDecoder } from "./newline-decoder.js";
import { CodePointString } from "./code-point-string.js";
import { ExecutionBudget } from "./execution-budget.js";

function text(value: string): CodePointString {
  return new CodePointString(new Uint32Array(Array.from(value, point => point.codePointAt(0)!)));
}

describe("incremental universal newlines", () => {
  it.each([true, false])("handles split CRLF and empty chunks with translation %s", translate => {
    const decoder = new UniversalNewlineDecoder(translate);
    expect([...decoder.decode(text("a\r"))]).toEqual([97]);
    expect(decoder.newlines).toBeNull();
    expect(decoder.getstate()).toEqual({ pendingCR: true });
    expect([...decoder.decode(text(""))]).toEqual([]);
    expect([...decoder.decode(text("\nb\r"))]).toEqual(translate ? [10, 98] : [13, 10, 98]);
    expect(decoder.newlines).toBe("\r\n");
    expect([...decoder.decode(text("c\n"))]).toEqual(translate ? [10, 99, 10] : [13, 99, 10]);
    expect(decoder.newlines).toEqual(["\r", "\n", "\r\n"]);
    expect(decoder.getstate()).toEqual({ pendingCR: false });
  });

  it.each([
    ["", null], ["abc", null], ["\r", "\r"], ["\n", "\n"], ["\r\n", "\r\n"],
    ["\rX\n", ["\r", "\n"]], ["\rX\r\n", ["\r", "\r\n"]],
    ["\nX\r\n", ["\n", "\r\n"]], ["\r\n\r\n", "\r\n"]
  ])("records newline forms in %s", (source, expected) => {
    const decoder = new UniversalNewlineDecoder();
    decoder.decode(text(source), true);
    expect(decoder.newlines).toEqual(expected);
    if (Array.isArray(decoder.newlines)) expect(Object.isFrozen(decoder.newlines)).toBe(true);
  });

  it.each([true, false])("flushes a trailing CR once with translation %s", translate => {
    const decoder = new UniversalNewlineDecoder(translate);
    expect([...decoder.decode(text("\r"))]).toEqual([]);
    expect([...decoder.decode(text(""), true)]).toEqual([translate ? 10 : 13]);
    expect(decoder.newlines).toBe("\r");
    expect([...decoder.decode(text(""), true)]).toEqual([]);
    expect([...decoder.decode(text("x"))]).toEqual([120]);
  });

  it("does not translate other Unicode line separators or merge surrogate points", () => {
    const points = new Uint32Array([11, 12, 0x85, 0x2028, 0x2029, 0xd800, 0xdc00]);
    const decoder = new UniversalNewlineDecoder();
    expect([...decoder.decode(new CodePointString(points), true)]).toEqual([...points]);
    expect(decoder.newlines).toBeNull();
  });

  it("restores pending CR without clearing observed newline forms; reset clears both", () => {
    const decoder = new UniversalNewlineDecoder();
    decoder.decode(text("\n"));
    decoder.setstate({ pendingCR: true });
    expect(decoder.newlines).toBe("\n");
    expect([...decoder.decode(text("X"))]).toEqual([10, 88]);
    expect(decoder.newlines).toEqual(["\r", "\n"]);
    const state = decoder.getstate();
    expect(Object.isFrozen(state)).toBe(true);
    decoder.reset();
    expect(decoder.newlines).toBeNull();
    expect(decoder.getstate()).toEqual({ pendingCR: false });
  });

  it("rolls back pending and observed state when output allocation fails", () => {
    const decoder = new UniversalNewlineDecoder();
    decoder.decode(text("\r"));
    const budget = new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 8 });
    expect(() => decoder.decode(text("\n"), false, budget)).toThrow(expect.objectContaining({ reason: "allocation" }));
    expect(decoder.getstate()).toEqual({ pendingCR: true });
    expect(decoder.newlines).toBeNull();
    expect([...decoder.decode(text("\n"))]).toEqual([10]);
    expect(decoder.newlines).toBe("\r\n");
  });

  it("checks cancellation even on an empty-input fast path", () => {
    const decoder = new UniversalNewlineDecoder();
    const controller = new AbortController();
    controller.abort();
    const budget = new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 100, signal: controller.signal });
    expect(() => decoder.decode(text(""), false, budget)).toThrow(expect.objectContaining({ reason: "cancelled" }));
    expect(decoder.newlines).toBeNull();
  });
});
