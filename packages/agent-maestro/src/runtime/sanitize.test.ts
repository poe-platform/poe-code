import { describe, expect, it } from "vitest";

import { sanitizeWorkspaceKey } from "./sanitize.js";

describe("sanitizeWorkspaceKey", () => {
  it("keeps safe workspace key characters", () => {
    expect(sanitizeWorkspaceKey("ENG-412")).toBe("ENG-412");
  });

  it("keeps every allowed workspace key character class", () => {
    expect(sanitizeWorkspaceKey("AZaz09._-")).toBe("AZaz09._-");
  });

  it("replaces path separators with underscores", () => {
    expect(sanitizeWorkspaceKey("octo-org/7/412")).toBe("octo-org_7_412");
  });

  it("replaces spaces and other unsafe characters with underscores", () => {
    expect(sanitizeWorkspaceKey("foo/bar baz")).toBe("foo_bar_baz");
  });

  it("replaces unsafe characters one-for-one", () => {
    expect(sanitizeWorkspaceKey("a:b?c#d@e")).toBe("a_b_c_d_e");
  });

  it("replaces control characters with underscores", () => {
    expect(sanitizeWorkspaceKey("foo\nbar\tbaz")).toBe("foo_bar_baz");
  });

  it("replaces unicode letters and emoji with underscores", () => {
    expect(sanitizeWorkspaceKey("mañana/💥")).toBe("ma_ana__");
  });

  it("keeps nonempty all-unsafe input as underscores", () => {
    expect(sanitizeWorkspaceKey(" / ")).toBe("___");
  });

  it("throws on empty input", () => {
    expect(() => sanitizeWorkspaceKey("")).toThrow("qualifiedId must not be empty");
  });
});
