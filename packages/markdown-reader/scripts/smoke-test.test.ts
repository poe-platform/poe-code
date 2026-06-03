import { describe, expect, it } from "vitest";
import { assertExpectedToolNames } from "./smoke-test.js";

describe("markdown-reader smoke tool surface", () => {
  it("accepts reader and approval tools advertised by the server", () => {
    expect(() =>
      assertExpectedToolNames(["approvals__show", "read_section", "read", "approvals__list"])
    ).not.toThrow();
  });
});
