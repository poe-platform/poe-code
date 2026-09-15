import { describe, expect, it } from "vitest";
import { suggestName } from "./name-suggestion.js";
import { ExecutionBudget } from "./execution-budget.js";

describe("Python diagnostic name suggestions", () => {
  it("scores case differences cheaply and keeps the first tied candidate", () => {
    expect(suggestName("spam", ["spem", "SPAM", "spim"])).toBe("spem");
    expect(suggestName("spam", ["spem", "Spam"])).toBe("Spam");
    expect(suggestName("spam", ["spam", "spem"])).toBe("spem");
  });

  it("uses UTF-8 byte distance, not Unicode case folding or normalization", () => {
    expect(suggestName("école", ["ecole", "École"])).toBe("École");
    expect(suggestName("K", ["K"])).toBeUndefined();
  });

  it("bounds candidate counts and the nonmatching portions of long strings", () => {
    expect(suggestName("target", Array(750).fill("targat"))).toBeUndefined();
    expect(suggestName("target", Array(749).fill("targat"))).toBe("targat");
    expect(suggestName("a".repeat(41), ["b".repeat(41)])).toBeUndefined();
    expect(suggestName("prefix".repeat(20) + "ax", ["prefix".repeat(20) + "bx"])).toBe("prefix".repeat(20) + "bx");
    expect(suggestName("a".repeat(100), ["a".repeat(99)])).toBe("a".repeat(99));
  });

  it("returns no suggestion for empty candidates or unencodable names", () => {
    expect(suggestName("x", [])).toBeUndefined();
    expect(suggestName("\ud800", ["x"])).toBeUndefined();
    expect(suggestName("spam", ["spem", "\udfff"])).toBeUndefined();
  });

  it("meters encoding, workspace allocation and distance computation", () => {
    expect(() => suggestName("target", ["targat"], new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 0 }))).toThrow("execution allocation limit exceeded");
    expect(() => suggestName("target", ["targat"], new ExecutionBudget({ maxSteps: 0, maxAllocatedBytes: 10000 }))).toThrow("execution step limit exceeded");
  });
});
