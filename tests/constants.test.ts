import { describe, it, expect } from "vitest";
import { FRONTIER_MODELS } from "../src/cli/constants.js";

describe("FRONTIER_MODELS", () => {
  it("includes Gemini-3-Pro", () => {
    expect(FRONTIER_MODELS).toContain("Gemini-3-Pro");
  });
});

