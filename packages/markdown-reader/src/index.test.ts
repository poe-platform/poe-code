import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("@poe-code/markdown-reader scaffolding", () => {
  it("exports an empty placeholder module", async () => {
    const module = await import("./index.js");

    expect(Object.keys(module)).toEqual([]);
  });

  it("includes the planned markdown fixtures", () => {
    const fixturesPath = new URL("./testing/fixtures/", import.meta.url);

    expect(readdirSync(fixturesPath)).toEqual([
      "nested.md",
      "simple.md",
      "with-fenced-code.md",
      "with-frontmatter.md"
    ]);
  });
});
