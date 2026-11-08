import { readdirSync } from "node:fs";
import type {
  ReadMarkdownParams as CoreReadMarkdownParams,
  ReadMarkdownResult as CoreReadMarkdownResult,
  TocEntry as CoreTocEntry
} from "./core/read-markdown.js";
import type {
  ReadSectionParams as CoreReadSectionParams,
  ReadSectionResult as CoreReadSectionResult
} from "./core/read-section.js";
import type {
  ReadMarkdownParams,
  ReadMarkdownResult,
  ReadSectionParams,
  ReadSectionResult,
  TocEntry
} from "./index.js";
import { describe, expect, expectTypeOf, it } from "vitest";

describe("@poe-code/markdown-reader", () => {
  it("exports the markdown reader SDK and MCP entry points", async () => {
    const module = await import("./index.js");
    const readMarkdownModule = await import("./core/read-markdown.js");
    const readSectionModule = await import("./core/read-section.js");
    const groupModule = await import("./mcp/group.js");
    const runModule = await import("./mcp/run.js");

    expect(module).toEqual(
      expect.objectContaining({
        markdownGroup: expect.any(Object),
        readMarkdown: expect.any(Function),
        readSection: expect.any(Function),
        runMarkdownReaderMcp: expect.any(Function)
      })
    );
    expect(module.readMarkdown).toBe(readMarkdownModule.readMarkdown);
    expect(module.readSection).toBe(readSectionModule.readSection);
    expect(module.markdownGroup).toBe(groupModule.markdownGroup);
    expect(module.runMarkdownReaderMcp).toBe(runModule.runMarkdownReaderMcp);
  });

  it("re-exports the public SDK types from the barrel", () => {
    expectTypeOf<ReadMarkdownParams>().toEqualTypeOf<CoreReadMarkdownParams>();
    expectTypeOf<ReadMarkdownResult>().toEqualTypeOf<CoreReadMarkdownResult>();
    expectTypeOf<ReadSectionParams>().toEqualTypeOf<CoreReadSectionParams>();
    expectTypeOf<ReadSectionResult>().toEqualTypeOf<CoreReadSectionResult>();
    expectTypeOf<TocEntry>().toEqualTypeOf<CoreTocEntry>();
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
