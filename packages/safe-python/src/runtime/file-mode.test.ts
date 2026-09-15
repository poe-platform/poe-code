import { describe, expect, it } from "vitest";
import { parseFileMode } from "./file-mode.js";
import { ExecutionBudget } from "./execution-budget.js";

describe("Python open mode parsing", () => {
  it("defaults to text reading", () => {
    expect(parseFileMode()).toEqual({ action: "r", binary: false, updating: false });
  });

  it.each(["r", "w", "a", "x"] as const)("accepts all orderings and modifiers for %s", action => {
    for (const kind of ["", "b", "t"]) {
      for (const plus of ["", "+"]) {
        const chars = action + kind + plus;
        const modes = chars.length === 3
          ? [chars, chars[0]! + chars[2]! + chars[1]!, chars[1]! + chars[0]! + chars[2]!, chars[1]! + chars[2]! + chars[0]!, chars[2]! + chars[0]! + chars[1]!, chars[2]! + chars[1]! + chars[0]!]
          : chars.length === 2 ? [chars, chars[1]! + chars[0]!] : [chars];
        for (const mode of modes) {
          const parsed = parseFileMode(mode);
          expect(parsed).toEqual({ action, binary: kind === "b", updating: plus === "+" });
          expect(Object.isFrozen(parsed)).toBe(true);
        }
      }
    }
  });

  it.each(["", "b", "t", "+", "+t", "b+"])("rejects missing base action %j", mode => {
    expect(() => parseFileMode(mode)).toThrow("Must have exactly one of create/read/write/append mode and at most one plus");
  });

  it.each(["rw", "ra", "rx", "wax", "+wr", "ab+x"])("rejects conflicting actions %j", mode => {
    expect(() => parseFileMode(mode)).toThrow("must have exactly one of create/read/write/append mode");
  });

  it.each(["rr", "r++", "rbb", "tt", "U", "rU", "R", "rb ", "r'", "r\\", "r😀"])("rejects invalid or duplicate characters %j", mode => {
    expect(() => parseFileMode(mode)).toThrow(`invalid mode: '${mode}'`);
  });

  it.each(["bt", "rbt", "rwbt", "bt+"])("rejects text and binary together %j", mode => {
    expect(() => parseFileMode(mode)).toThrow("can't have text and binary mode at once");
  });

  it("prioritizes invalid characters/duplicates over conflicting flags", () => {
    expect(() => parseFileMode("rwbtU")).toThrow("invalid mode: 'rwbtU'");
    expect(() => parseFileMode("rwbtt")).toThrow("invalid mode: 'rwbtt'");
  });

  it.each(["\0", "r\0", "Ur\0", "\0bt"])("rejects embedded NUL before interpreting mode %j", mode => {
    expect(() => parseFileMode(mode)).toThrow(expect.objectContaining({ name: "ValueError", message: "embedded null character" }));
  });

  it("meters long invalid mode scans", () => {
    const budget = new ExecutionBudget({ maxSteps: 5, maxAllocatedBytes: 100 });
    expect(() => parseFileMode("r".repeat(100), budget)).toThrow(expect.objectContaining({ reason: "steps" }));
  });

  it("checks cancellation even for the empty mode", () => {
    const controller = new AbortController();
    controller.abort();
    const budget = new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 100, signal: controller.signal });
    expect(() => parseFileMode("", budget)).toThrow(expect.objectContaining({ reason: "cancelled" }));
  });
});
