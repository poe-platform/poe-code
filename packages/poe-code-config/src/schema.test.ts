import { describe, expect, it } from "vitest";
import { defineScope } from "./schema.js";

describe("defineScope", () => {
  it("returns scope metadata for later store binding", () => {
    const schema = {
      apiKey: {
        type: "string" as const,
        default: "",
        env: "POE_API_KEY",
        doc: "Poe API key"
      }
    };

    expect(defineScope("core", schema)).toEqual({
      scope: "core",
      schema
    });
  });
});
