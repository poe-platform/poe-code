import { describe, expect, it } from "bun:test";
import { extractThreadId, isNonEmptyString, truncate } from "./utils.js";

describe("truncate", () => {
  it("returns the original string when within maxLength", () => {
    expect(truncate("hello", 10)).toBe("hello");
    expect(truncate("hello", 5)).toBe("hello");
  });

  it("truncates and adds an ellipsis when maxLength allows", () => {
    expect(truncate("hello world", 5)).toBe("he...");
    expect(truncate("hello world", 6)).toBe("hel...");
  });

  it("handles edge cases", () => {
    expect(truncate("", 5)).toBe("");
    expect(truncate("hello", 0)).toBe("");
    expect(truncate("hello", 2)).toBe("he");
    expect(truncate("hello", 3)).toBe("hel");
  });
});

describe("isNonEmptyString", () => {
  it("returns true only for non-empty strings", () => {
    expect(isNonEmptyString("text")).toBe(true);
    expect(isNonEmptyString("")).toBe(false);
  });

  it("returns false for non-string inputs", () => {
    expect(isNonEmptyString(null)).toBe(false);
    expect(isNonEmptyString(undefined)).toBe(false);
    expect(isNonEmptyString(0)).toBe(false);
  });
});

describe("extractThreadId", () => {
  it.each([
    [{ thread_id: "t1" }, "t1"],
    [{ threadId: "t2" }, "t2"],
    [{ threadID: "t3" }, "t3"],
    [{ session_id: "s1" }, "s1"],
    [{ sessionId: "s2" }, "s2"],
    [{ sessionID: "s3" }, "s3"]
  ] as const)("extracts from supported fields", (value, expected) => {
    expect(extractThreadId(value)).toBe(expected);
  });

  it("returns undefined for non-objects and empty strings", () => {
    expect(extractThreadId(null)).toBeUndefined();
    expect(extractThreadId("x")).toBeUndefined();
    expect(extractThreadId({ thread_id: "" })).toBeUndefined();
  });
});
