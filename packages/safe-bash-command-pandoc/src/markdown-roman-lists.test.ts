import {expect, it} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {createStandalonePandocCommand} from "./safe-bash.js";
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
  it.each([
    ["iv. First\nv. Second\n", 4, "LowerRoman", "Period"],
    ["IV.  First\nV.   Second\n", 4, "UpperRoman", "Period"],
    ["ix) First\nx) Second\n", 9, "LowerRoman", "OneParen"]
  ])(`reads Roman list attributes and items (retained=${retained}): %s`, async (text, start, style, delimiter) => {
    expect(JSON.parse(await render(String(text))).blocks).toEqual([
      {t: "OrderedList", c: [[start, {t: style}, {t: delimiter}], [
        [{t: "Plain", c: [{t: "Str", c: "First"}]}],
        [{t: "Plain", c: [{t: "Str", c: "Second"}]}]
      ]]}
    ]);
  });
  it.each([
    ["a", "b", 1, "LowerAlpha", "a"],
    ["d", "e", 4, "LowerAlpha", "a"],
    ["h", "i", 8, "LowerAlpha", "a"],
    ["i", "ii", 1, "LowerRoman", "i"],
    ["iv", "v", 4, "LowerRoman", "i"],
    ["ix", "x", 9, "LowerRoman", "i"],
    ...["c", "l", "m", "v", "x", "z"].map(label => [label, label, label.charCodeAt(0) - 96, "LowerAlpha", "a"])
  ])(`disambiguates alphabetic and Roman markers (retained=${retained}): %s`, async (first, second, start, style, type) => {
    for (const delimiter of [".", ")"]) {
      const text = `${first}${delimiter} First\n${second}${delimiter} Second\n`;
      expect(JSON.parse(await render(text)).blocks).toEqual([
        {t: "OrderedList", c: [[start, {t: style}, {t: delimiter === "." ? "Period" : "OneParen"}], [
          [{t: "Plain", c: [{t: "Str", c: "First"}]}],
          [{t: "Plain", c: [{t: "Str", c: "Second"}]}]
        ]]}
      ]);
      expect(await render(text, "markdown", "html5")).toBe(
        `<ol${start === 1 ? "" : ` start="${start}"`} type="${type}">\n<li>First</li>\n<li>Second</li>\n</ol>\n`
      );
    }
  });
  it.each(["commonmark", "gfm", "markdown-fancy_lists"])(`keeps alphabetic markers literal in %s (retained=${retained})`, async from => {
    for (const delimiter of [".", ")"]) {
      const text = `a${delimiter} Alpha\nb${delimiter} Beta\n`;
      expect(JSON.parse(await render(text, from)).blocks[0].t).toBe("Para");
      expect(await render(text, from, "html5")).toBe(`<p>${text.trimEnd()}</p>\n`);
    }
  });
  it(`starts a new style when the delimiter changes (retained=${retained})`, async () => {
    const blocks = JSON.parse(await render("h. First\ni) Second\n")).blocks;
    expect(blocks.map((block: {c: unknown[]}) => block.c[0])).toEqual([
      [8, {t: "LowerAlpha"}, {t: "Period"}], [1, {t: "LowerRoman"}, {t: "OneParen"}]
    ]);
  });
  it(`renders the reported Roman list as HTML (retained=${retained})`, async () => {
    const html = await render("iv. First\nv. Second\n", "markdown", "html");
    expect(html).toContain('<ol start="4" type="i">');
    expect(html).toContain("<li>First</li>");
    expect(html).toContain("<li>Second</li>");
  });
  it(`retains nested lists, continuations, and distinct numbering styles (retained=${retained})`, async () => {
    const blocks = JSON.parse(await render("iv. First\n    continued\n\n    - nested\nv. Second\n\n1. decimal\n")).blocks;
    expect(blocks.map((block: {c: unknown[]}) => block.c[0])).toEqual([
      [4, {t: "LowerRoman"}, {t: "Period"}], [1, {t: "Decimal"}, {t: "Period"}]
    ]);
    expect(blocks[0].c[1]).toHaveLength(2);
    expect(blocks[0].c[1][0][1].t).toBe("BulletList");
    expect(blocks[0].c[1][0][0].c).toContainEqual({t: "Str", c: "continued"});
  });
  it.each(["iiii", "iiv", "iviv", "mmmm", "iV", "mixing"])(`rejects invalid Roman marker %s (retained=${retained})`, async label => {
    expect(JSON.parse(await render(`${label}. text\n`)).blocks[0].t).toBe("Para");
  });
  it(`keeps Roman markers literal inside code (retained=${retained})`, async () => {
    expect(JSON.parse(await render("```\niv. First\n```\n")).blocks[0]).toEqual({t: "CodeBlock", c: [["", [], []], "iv. First"]});
  });
  it.each(["commonmark", "gfm", "markdown-fancy_lists"])(`keeps Roman text as paragraphs in %s (retained=${retained})`, async from => {
    expect(JSON.parse(await render("iv. First\nv. Second\n", from)).blocks[0].t).toBe("Para");
  });
}

it.each([["iv", "v", 4, "i"], ["a", "b", 1, "a"], ["d", "e", 4, "a"]])("reads %s lists through the standalone command", async (first, second, start, type) => {
  let output = "";
  const errors: Uint8Array[] = [];
  const result = await createStandalonePandocCommand().execute({
    args: ["-f", "markdown", "-t", "html"],
    stdin: [new TextEncoder().encode(`${first}. First\n${second}. Second\n`)],
    signal: new AbortController().signal,
    stdout: {async write(bytes) {output += new TextDecoder().decode(bytes);}},
    stderr: {async write(bytes) {errors.push(bytes);}}
  });
  expect(result.exitCode).toBe(0);
  expect(errors).toEqual([]);
  expect(output).toContain(`<ol${start === 1 ? "" : ` start="${start}"`} type="${type}">`);
  expect(output).toContain("<li>Second</li>");
});
