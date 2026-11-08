import { describe, expect, it } from "vitest";

import { geminiCliAgent } from "./gemini-cli.js";

describe("geminiCliAgent", () => {
  it("declares only the Google generations API shape", () => {
    expect(geminiCliAgent.apiShapes).toEqual(["google-generations"]);
  });
});
