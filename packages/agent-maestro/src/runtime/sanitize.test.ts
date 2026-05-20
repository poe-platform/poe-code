import { describe, expect, it } from "vitest";

import { sanitizeWorkspaceKey } from "./sanitize.js";

describe("sanitizeWorkspaceKey", () => {
  it("keeps safe workspace key characters", () => {
    expect(sanitizeWorkspaceKey("ENG-412")).toBe("ENG-412");
  });

  it("keeps every allowed workspace key character class", () => {
    expect(sanitizeWorkspaceKey("AZaz09._-")).toBe("AZaz09._-");
  });

  it("rejects path separators", () => {
    expect(() => sanitizeWorkspaceKey("octo-org/7/412")).toThrow(
      "workspace id must not be an absolute path or contain path separators"
    );
    expect(() => sanitizeWorkspaceKey("octo-org\\7\\412")).toThrow(
      "workspace id must not be an absolute path or contain path separators"
    );
  });

  it("adds a stable hash when printable unsafe characters are replaced", () => {
    expect(sanitizeWorkspaceKey("foo bar baz")).toMatch(/^foo_bar_baz-[a-f0-9]{16}$/);
  });

  it("keeps distinct outputs for ids with the same sanitized base", () => {
    expect(sanitizeWorkspaceKey("a:b")).toMatch(/^a_b-[a-f0-9]{16}$/);
    expect(sanitizeWorkspaceKey("a:b")).not.toBe(sanitizeWorkspaceKey("a?b"));
  });

  it("rejects control characters", () => {
    expect(() => sanitizeWorkspaceKey("foo\nbar\tbaz")).toThrow(
      "workspace id must not contain control characters"
    );
  });

  it("replaces unicode letters and emoji with hashed safe keys", () => {
    expect(sanitizeWorkspaceKey("mañana💥")).toMatch(/^ma_ana_-[a-f0-9]{16}$/);
  });

  it("keeps nonempty all-unsafe printable input as hashed underscores", () => {
    expect(sanitizeWorkspaceKey(" : ")).toMatch(/^___-[a-f0-9]{16}$/);
  });

  it("throws on empty input", () => {
    expect(() => sanitizeWorkspaceKey("")).toThrow("qualifiedId must not be empty");
  });

  it("throws on path escapes", () => {
    expect(() => sanitizeWorkspaceKey("..")).toThrow(
      "workspace id must not contain parent path segments"
    );
    expect(() => sanitizeWorkspaceKey("/tmp/outside")).toThrow(
      "workspace id must not be an absolute path"
    );
    expect(() => sanitizeWorkspaceKey("C:\\tmp\\outside")).toThrow(
      "workspace id must not be an absolute path"
    );
  });
});
