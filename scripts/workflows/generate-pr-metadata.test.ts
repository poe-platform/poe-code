import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, test } from "vitest";

import { parseMetadata, writeMetadataOutput } from "./generate-pr-metadata.cjs";

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

describe("writeMetadataOutput", () => {
  test("refuses to append metadata through a symbolic link", () => {
    const volume = Volume.fromJSON({ "/outside-output": "sentinel" }, "/");
    volume.mkdirSync("/github", { recursive: true });
    volume.symlinkSync("/outside-output", "/github/output");
    const memoryFs = createFsFromVolume(volume);

    expect(() =>
      writeMetadataOutput("/github/output", { title: "Fix probe", body: "## Summary" }, memoryFs)
    ).toThrow("symbolic link");
    expect(memoryFs.readFileSync("/outside-output", "utf8")).toBe("sentinel");
  });
});
