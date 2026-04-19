import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("@poe-code/markdown-reader", () => {
  it("exports the markdown reader SDK entry points", async () => {
    const module = await import("./index.js");

    expect(module).toEqual(
      expect.objectContaining({
        readMarkdown: expect.any(Function),
        readSection: expect.any(Function)
      })
    );
  });

  it("includes the planned markdown fixtures", () => {
    const fixturesPath = new URL("./testing/fixtures/", import.meta.url);

    expect(readdirSync(fixturesPath)).toEqual([
      "markdown-reader-plan.md",
      "nested.md",
      "simple.md",
      "with-fenced-code.md",
      "with-frontmatter.md"
    ]);
  });
});
