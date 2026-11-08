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
  it(`reads definition lists as JSON and HTML (retained=${retained})`, async () => {
    const text = "Term\n:   Definition\n\nOther\n:   More\n";
    expect(JSON.parse(await render(text)).blocks).toEqual([{t: "DefinitionList", c: [
      [[{t: "Str", c: "Term"}], [[{t: "Plain", c: [{t: "Str", c: "Definition"}]}]]],
      [[{t: "Str", c: "Other"}], [[{t: "Plain", c: [{t: "Str", c: "More"}]}]]]
    ]}]);
    const html = await render(text, "markdown", "html");
    expect(html).toContain("<dl>");
    expect(html).toContain("<dt>Term</dt>");
    expect(html).toContain("<dd>Definition</dd>");
  });
  it(`reads repeated definitions, inline terms, and continuation blocks (retained=${retained})`, async () => {
    const text = "*Term*\n:   First\n    continued\n:   Second\n\n    Another paragraph.\n\nAfter\n";
    const blocks = JSON.parse(await render(text)).blocks;
    expect(blocks[0]).toEqual({t: "DefinitionList", c: [
      [[{t: "Emph", c: [{t: "Str", c: "Term"}]}], [
        [{t: "Plain", c: [{t: "Str", c: "First"}, {t: "SoftBreak"}, {t: "Str", c: "continued"}]}],
        [{t: "Para", c: [{t: "Str", c: "Second"}]}, {t: "Para", c: [{t: "Str", c: "Another"}, {t: "Space"}, {t: "Str", c: "paragraph."}]}]
      ]]
    ]});
    expect(blocks[1]).toEqual({t: "Para", c: [{t: "Str", c: "After"}]});
  });
  it(`reads loose definitions and nested blocks (retained=${retained})`, async () => {
    const blocks = JSON.parse(await render("Term\n\n~   Description\n\n    - item\n")).blocks;
    expect(blocks[0].t).toBe("DefinitionList");
    expect(blocks[0].c[0][1][0]).toEqual([
      {t: "Para", c: [{t: "Str", c: "Description"}]},
      {t: "BulletList", c: [[{t: "Plain", c: [{t: "Str", c: "item"}]}]]}
    ]);
  });
  it(`honors explicit enabling and code blocks (retained=${retained})`, async () => {
    expect(JSON.parse(await render("Term\n:\tDefinition\n", "gfm+definition_lists")).blocks[0].t).toBe("DefinitionList");
    const blocks = JSON.parse(await render("~~~\nTerm\n:   Definition\n~~~\n\n:   Orphan\n")).blocks;
    expect(blocks.map((block: {t: string}) => block.t)).toEqual(["CodeBlock", "Para"]);
  });
  it.each([2, 3, 4, 6])(`keeps a nested list indented %i spaces inside a tight definition (retained=${retained})`, async indent => {
    const text = `Term\n: First\n\n${" ".repeat(indent)}- child\n${" ".repeat(indent + 2)}continued\n${" ".repeat(indent)}- sibling\n\nOther\n: Second\n`;
    expect(JSON.parse(await render(text)).blocks).toEqual([{t: "DefinitionList", c: [
      [[{t: "Str", c: "Term"}], [[
        {t: "Plain", c: [{t: "Str", c: "First"}]},
        {t: "BulletList", c: [
          [{t: "Plain", c: [{t: "Str", c: "child"}, {t: "SoftBreak"}, {t: "Str", c: "continued"}]}],
          [{t: "Plain", c: [{t: "Str", c: "sibling"}]}]
        ]}
      ]]],
      [[{t: "Str", c: "Other"}], [[{t: "Plain", c: [{t: "Str", c: "Second"}]}]]]
    ]}]);
  });
  it(`keeps adjacent multiline definitions tight (retained=${retained})`, async () => {
    const blocks = JSON.parse(await render("Term\n:   First\n    continued\n:   Second\n")).blocks;
    expect(blocks[0].c[0][1].map((definition: {t: string}[]) => definition[0]!.t)).toEqual(["Plain", "Plain"]);
  });
  it.each(["", "\n"])(`uses the term gap for separated definitions: %j (retained=${retained})`, async gap => {
    const text = `Term\n${gap}: First *definition*.\n\n: Second paragraph.\n`;
    const definitions = JSON.parse(await render(text)).blocks[0].c[0][1];
    expect(definitions.map((definition: {t: string}[]) => definition[0]!.t)).toEqual(gap ? ["Para", "Para"] : ["Plain", "Plain"]);
    const html = await render(text, "markdown", "html");
    expect(html).toContain(gap ? "<p>Second paragraph.</p>" : "<dd>Second paragraph.</dd>");
  });
  it(`keeps sibling tightness independent of continuation paragraphs (retained=${retained})`, async () => {
    const text = "Term\n: First\n\n    Continued\n\n: Second\n\nOther\n\n: Third\n: Fourth\n";
    const items = JSON.parse(await render(text)).blocks[0].c;
    expect(items.map((item: [unknown, {t: string}[][]]) => item[1].map(definition => definition.map(block => block.t)))).toEqual([
      [["Para", "Para"], ["Plain"]],
      [["Para"], ["Para"]]
    ]);
  });
  it.each(["commonmark", "gfm", "markdown-definition_lists"])(`keeps definition syntax literal in %s (retained=${retained})`, async from => {
    expect(JSON.parse(await render("Term\n:   Definition\n", from)).blocks[0].t).toBe("Para");
  });
}
