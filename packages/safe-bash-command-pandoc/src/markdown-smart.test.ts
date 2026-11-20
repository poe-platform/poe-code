import {expect, it} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {convert, convertToOutput} from "./engine.js";
import {createStandalonePandocCommand} from "./safe-bash.js";

for (const retained of [false, true]) {
  async function render(text: string, from = "markdown", to = "html") {
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
  it(`reads smart punctuation before writing (retained=${retained})`, async () => {
    for (const from of ["markdown", "md", "gfm+smart", "markdown+smart-smart"]) {
      expect(JSON.parse(await render('"quotes" -- ...\n', from, "json")).blocks[0].c).toEqual([
        {t: "Quoted", c: [{t: "DoubleQuote"}, [{t: "Str", c: "quotes"}]]},
        {t: "Space"}, {t: "Str", c: "–"}, {t: "Space"}, {t: "Str", c: "…"}
      ]);
      expect(await render('"quotes" -- ...', from)).toBe("<p>“quotes” – …</p>\n");
    }
  });
  it(`honors extension controls (retained=${retained})`, async () => {
    for (const from of ["markdown-smart", "gfm", "commonmark"]) {
      expect(await render('"quotes" -- ...', from)).toBe('<p>"quotes" -- ...</p>\n');
    }
  });
  it(`keeps empty quotes and following content exactly once (retained=${retained})`, async () => {
    const source = "'' \"\" tail";
    for (const from of ["markdown", "gfm+smart"]) {
      expect(JSON.parse(await render(source, from, "json")).blocks).toEqual([
        {t: "Para", c: [{t: "Str", c: "’’"}, {t: "Space"}, {t: "Str", c: "“”"}, {t: "Space"}, {t: "Str", c: "tail"}]}
      ]);
      expect(await render(source, from)).toBe("<p>’’ “” tail</p>\n");
      expect(await render('"" **bold** [link](/url)', from)).toBe('<p>“” <strong>bold</strong> <a href="/url">link</a></p>\n');
    }
  });
  it(`preserves formatting when quotes cross delimiters (retained=${retained})`, async () => {
    for (const [marker, kind, tag] of [["*", "Emph", "em"], ["**", "Strong", "strong"], ["_", "Emph", "em"], ["__", "Strong", "strong"], ["~~", "Strikeout", "del"]]) {
      const source = `"${marker}x"${marker}`;
      expect(JSON.parse(await render(source, "markdown", "json")).blocks[0].c).toEqual([
        {t: "Str", c: "“"}, {t: kind, c: [{t: "Str", c: "x”"}]}
      ]);
      expect(await render(source)).toBe(`<p>“<${tag}>x”</${tag}></p>\n`);
      expect(JSON.parse(await render(`"${marker}x${marker}"`, "markdown", "json")).blocks[0].c).toEqual([
        {t: "Quoted", c: [{t: "DoubleQuote"}, [{t: kind, c: [{t: "Str", c: "x"}]}]]}
      ]);
      expect(await render(`"${marker}x"`)).toBe(`<p>“${marker}x”</p>\n`);
    }
  });
  it(`handles nested formatting, apostrophes and protected syntax (retained=${retained})`, async () => {
    expect(await render('"a *bold* and \'quote\'" isn\'t --- ...')).toBe("<p>“a <em>bold</em> and ‘quote’” isn’t — …</p>\n");
    expect(await render('`"code" -- ...` \\"literal\\" \\-\\- \\.\\.\\.')).toBe('<p><code>"code" -- ...</code> "literal" -- ...</p>\n');
    expect(JSON.parse(await render("'isn't'", "markdown", "json")).blocks[0].c).toEqual([
      {t: "Quoted", c: [{t: "SingleQuote"}, [{t: "Str", c: "isn’t"}]]}
    ]);
    expect(await render("'isn’t' 'isn't'")).toBe("<p>‘isn’t’ ‘isn’t’</p>\n");
    expect(await render('["label"](/a--b "title...")')).toBe('<p><a href="/a--b" title="title...">“label”</a></p>\n');
  });
}

it("reads smart punctuation through the standalone command", async () => {
  let output = "";
  const result = await createStandalonePandocCommand().execute({
    args: ["-f", "markdown", "-t", "json"], stdin: [new TextEncoder().encode('"quotes" -- ...\n')],
    signal: new AbortController().signal,
    stdout: {async write(bytes) {output += new TextDecoder().decode(bytes);}},
    stderr: {async write() {}}
  });
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(output).blocks[0].c[0]).toEqual({t: "Quoted", c: [{t: "DoubleQuote"}, [{t: "Str", c: "quotes"}]]});
});
