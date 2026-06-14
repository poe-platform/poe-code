import { describe, expect, it } from "vitest";

import { HarnessFailure, makeFailModule } from "./fail.js";

describe("makeFailModule", () => {
  it("exports a default fail function that throws HarnessFailure with the provided message", () => {
    const fail = makeFailModule().default;

    expect(() => fail("plan failed")).toThrow(HarnessFailure);
    expect(() => fail("plan failed")).toThrow("plan failed");

    try {
      fail("plan failed");
      expect.unreachable("expected fail() to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(HarnessFailure);
      expect(error).toMatchObject({
        name: "HarnessFailure",
        message: "plan failed"
      });
    }
  });

  it("rejects blank failure messages", () => {
    const fail = makeFailModule().default;

    expect(() => fail("   ")).toThrow("Harness failure message must be a non-empty string.");
  });

  it("preserves non-blank message whitespace", () => {
    const fail = makeFailModule().default;

    try {
      fail("  plan failed  ");
      expect.unreachable("expected fail() to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(HarnessFailure);
      expect(error).toMatchObject({
        message: "  plan failed  "
      });
    }
  });
});
