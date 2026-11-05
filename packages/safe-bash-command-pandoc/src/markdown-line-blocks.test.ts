import {expect, it} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {convert, convertToOutput} from "./engine.js";

for (const retained of [false, true]) {
  async function render(text: string, from = "markdown", to = "json") {
    const input = {bytes: new TextEncoder().encode(text)};
    if (!retained) {
      const result = await convert([input], {from, to}, {});
      if (result.kind !== "text") throw new Error("Expected text");
      return result.text;
    }
    let output = "";
    await convertToOutput([input], {from, to}, {
      workingFiles: {fs: new MemoryFileSystem(), directory: "/", cacheBytes: 16384},
      output: {async write(bytes) {output += new TextDecoder().decode(bytes);}, async close() {}, async abort() {}}
    });
    return output;
  }
  it(`reads Markdown line blocks (retained=${retained})`, async () => {
    expect(JSON.parse(await render("| first\n| second\n")).blocks).toEqual([
      {t: "LineBlock", c: [[{t: "Str", c: "first"}], [{t: "Str", c: "second"}]]}
    ]);
  });
  it(`preserves empty lines, indentation, and inline markup (retained=${retained})`, async () => {
    expect(JSON.parse(await render("| *first*\n|\n|   second\n")).blocks).toEqual([
      {t: "LineBlock", c: [[{t: "Emph", c: [{t: "Str", c: "first"}]}], [], [{t: "Str", c: "\u00a0\u00a0second"}]]}
    ]);
    expect(await render("| first\n| second\n", "markdown", "html")).toContain('<div class="line-block">first<br>second</div>');
  });
  it(`handles nested blocks and wrapped lines (retained=${retained})`, async () => {
    expect(JSON.parse(await render("> | first\n>   continued\n> | second\n")).blocks).toEqual([
      {t: "BlockQuote", c: [{t: "LineBlock", c: [[{t: "Str", c: "first"}, {t: "Space"}, {t: "Str", c: "continued"}], [{t: "Str", c: "second"}]]}]}
    ]);
  });
  it(`preserves surrounding paragraphs, code, and pipe tables (retained=${retained})`, async () => {
    const text = "Before\n\n| first\n| second\n\nAfter\n\n~~~\n| literal\n~~~\n\n| a | b |\n|---|---|\n| c | d |\n";
    expect(JSON.parse(await render(text)).blocks.map((block: {t: string}) => block.t)).toEqual(["Para", "LineBlock", "Para", "CodeBlock", "Table"]);
  });
  it.each(["commonmark", "gfm", "markdown-line_blocks"])(`keeps markers literal in %s (retained=${retained})`, async from => {
    expect(JSON.parse(await render("| first\n| second\n", from)).blocks).toEqual([
      {t: "Para", c: [{t: "Str", c: "|"}, {t: "Space"}, {t: "Str", c: "first"}, {t: "SoftBreak"}, {t: "Str", c: "|"}, {t: "Space"}, {t: "Str", c: "second"}]}
    ]);
  });
  it(`ends line blocks before ordinary text and resolves references (retained=${retained})`, async () => {
    expect(JSON.parse(await render("| [first][ref]\nAfter\n\n[ref]: https://example.com\n", "md")).blocks).toEqual([
      {t: "LineBlock", c: [[{t: "Link", c: [["", [], []], [{t: "Str", c: "first"}], ["https://example.com", ""]]}]]},
      {t: "Para", c: [{t: "Str", c: "After"}]}
    ]);
    expect(JSON.parse(await render("|literal\n")).blocks[0].t).toBe("Para");
  });
  it(`allows explicitly enabled line blocks (retained=${retained})`, async () => {
    expect(JSON.parse(await render("| first\n", "gfm+line_blocks")).blocks[0].t).toBe("LineBlock");
  });
}
