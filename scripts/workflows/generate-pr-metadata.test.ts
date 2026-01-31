import { describe, expect, test } from "vitest";

import { parseMetadata } from "../../../scripts/workflows/generate-pr-metadata.cjs";

describe("parseMetadata", () => {
  test("extracts metadata when payload only contains JSON", () => {
    const payload = `{
  "title": "feat: demo",
  "body": "Some body"
}`;

    expect(parseMetadata(payload)).toEqual({
      title: "feat: demo",
      body: "Some body"
    });
  });

  test("ignores braces that appear after the JSON payload", () => {
    const payload = [
      "Sure, here's the metadata.",
      "{",
      '  "title": "feat: add Kimi CLI provider support",',
      '  "body": "## Summary\\n- Supports multiple models"',
      "}",
      "```ts",
      "function example() {",
      "  return { foo: true };",
      "}",
      "```"
    ].join("\n");

    expect(parseMetadata(payload)).toEqual({
      title: "feat: add Kimi CLI provider support",
      body: "## Summary\n- Supports multiple models"
    });
  });
});
