import { describe, expect, it } from "vitest";
import { interpolateVariables } from "./variables.js";

describe("interpolateVariables", () => {
  it("leaves inherited placeholder names untouched", () => {
    expect(interpolateVariables("Hello {{ constructor }}", {})).toBe("Hello {{ constructor }}");
  });

  it("replaces explicitly provided placeholder names", () => {
    const variables = Object.create(null) as Record<string, string>;
    variables.constructor = "Ada";

    expect(interpolateVariables("Hello {{ constructor }}", variables)).toBe("Hello Ada");
  });
});
