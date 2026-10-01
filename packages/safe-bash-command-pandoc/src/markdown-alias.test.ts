import { expect, it } from "vitest";
import { convert, createFormatRegistry, inspectFormats } from "./index.js";

it("accepts markdown for both directions with tables and strikeout enabled", async () => {
  const source = "| Name | Value |\n| --- | ---: |\n| ~~old~~ | 7 |\n";
  const registry = createFormatRegistry();
  for (const direction of ["read", "write"] as const) {
    expect(registry.resolve("markdown", direction).descriptor.name).toBe("gfm");
    expect(registry.list(direction)).toContain("markdown");
  }
  expect(registry.infer("report.markdown", "write")).toBe("gfm");
  expect(inspectFormats(["--list-extensions=markdown"])).toContain("+pipe_tables");
  const result = await convert([{ bytes: new TextEncoder().encode(source) }], {
    from: "markdown", to: "markdown"
  }, { yield: async () => {} });
  expect(result).toMatchObject({ kind: "text", text: expect.stringContaining("~~old~~") });
  expect(result.diagnostics).toEqual([]);
});

it.each(['md', 'markdown_strict', 'markdown_github', 'markdown_mmd', 'markdown_phpextra', 'commonmark_x'])("accepts %s in both conversion directions", async alias => {
  const result = await convert([{ bytes: new TextEncoder().encode('# Title\n\nHello **world**.\n') }], {
    from: alias, to: alias
  }, { yield: async () => {} });
  expect(result).toMatchObject({ kind: 'text', text: expect.stringContaining('**world**') });
});


it("infers GFM tables from .md input and output while preserving explicit CommonMark", async () => {
  const registry = createFormatRegistry();
  for (const direction of ["read", "write"] as const) {
    expect(registry.infer("report.MD", direction)).toBe("gfm");
    expect(registry.infer("report.commonmark", direction)).toBe("commonmark");
  }
  const source = "| a | b |\n|---|---|\n| 1 | 2 |\n";
  const input = [{ bytes: new TextEncoder().encode(source) }];
  const result = await convert(input, {
    from: registry.infer("table.md", "read"), to: "html"
  }, { yield: async () => {} });
  expect(result).toMatchObject({ kind: "text", text: expect.stringContaining("<table>") });
  const strict = await convert(input, { from: "commonmark", to: "html" }, { yield: async () => {} });
  expect(strict).toMatchObject({ kind: "text", text: expect.stringContaining("<p>| a | b |") });
});
