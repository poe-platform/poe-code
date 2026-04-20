import { describe, expect, it } from "vitest";
import {
  assertValidToolName,
  InvalidToolNameError,
  TOOL_NAME_PATTERN,
} from "./tool-names.js";

describe("TOOL_NAME_PATTERN", () => {
  it("matches valid tool names", () => {
    expect(TOOL_NAME_PATTERN.test("foo")).toBe(true);
    expect(TOOL_NAME_PATTERN.test("foo_bar")).toBe(true);
    expect(TOOL_NAME_PATTERN.test("foo-bar")).toBe(true);
    expect(TOOL_NAME_PATTERN.test("Foo123")).toBe(true);
  });
});

describe("assertValidToolName", () => {
  it.each(["foo", "foo_bar", "foo-bar", "Foo123"])(
    "accepts %s",
    (name) => {
      expect(() => assertValidToolName(name)).not.toThrow();
    },
  );

  it.each(["foo.bar", "foo bar", "foo/bar", "", "   ", " foo", "foo "])(
    "rejects %s",
    (name) => {
      expect(() => assertValidToolName(name)).toThrowError(InvalidToolNameError);
    },
  );

  it("includes the contributor in the error message when provided", () => {
    expect(() => assertValidToolName("foo.bar", "plugin: files-plugin")).toThrow(
      "plugin: files-plugin",
    );
  });
});
