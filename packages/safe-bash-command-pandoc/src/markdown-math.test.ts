import {expect, it} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {convert, convertToOutput} from "./engine.js";
import {createStandalonePandocCommand} from "./safe-bash.js";

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
  it(`reads dollar math as Math nodes (retained=${retained})`, async () => {
    for (const from of ["markdown", "md", "gfm+tex_math_dollars"]) {
      expect(JSON.parse(await render("$x^2$ and $$y^2$$\n", from)).blocks[0].c).toEqual([
        {t: "Math", c: [{t: "InlineMath"}, "x^2"]}, {t: "Space"}, {t: "Str", c: "and"}, {t: "Space"},
        {t: "Math", c: [{t: "DisplayMath"}, "y^2"]}
      ]);
    }
    expect(await render("$x$ and $$y$$", "markdown", "html")).toBe('<p><span class="math inline">\\(x\\)</span> and <span class="math display">\\[y\\]</span></p>\n');
  });
  it(`preserves literal dollars and extension controls (retained=${retained})`, async () => {
    for (const from of ["markdown-tex_math_dollars", "gfm", "commonmark"]) {
      expect(await render("$x$ and $$y$$", from, "html")).toBe("<p>$x$ and $$y$$</p>\n");
    }
    for (const text of ["$20 and $30", "$a $ b$", "$ x$", "$x $", "$x$2", "$unclosed", "$$unclosed"]) {
      expect(await render(text, "markdown", "html")).toBe(`<p>${text}</p>\n`);
    }
    expect(await render("\\$x\\$ `$x$`", "markdown", "html")).toBe("<p>$x$ <code>$x$</code></p>\n");
  });
  it(`keeps TeX opaque and supports multiline math (retained=${retained})`, async () => {
    for (const [text, mode, value] of [
      ["$a\\$b$", "InlineMath", "a\\$b"],
      ["$x_1 + *y* &amp;$", "InlineMath", "x_1 + *y* &amp;"],
      ["$a\nb$", "InlineMath", "a\nb"],
      ["$$\na + b\n$$", "DisplayMath", "\na + b\n"]
    ]) {
      expect(JSON.parse(await render(text!)).blocks[0].c).toEqual([{t: "Math", c: [{t: mode}, value]}]);
    }
  });
}

it("converts dollar math through the standalone command", async () => {
  let output = "", errors = "";
  const result = await createStandalonePandocCommand().execute({
    args: ["-f", "markdown", "-t", "json"], stdin: [new TextEncoder().encode("$x^2$ and $$y^2$$\n")],
    signal: new AbortController().signal,
    stdout: {async write(bytes) {output += new TextDecoder().decode(bytes);}},
    stderr: {async write(bytes) {errors += new TextDecoder().decode(bytes);}}
  });
  expect(result.exitCode).toBe(0);
  expect(errors).toBe("");
  expect(JSON.parse(output).blocks[0].c[0]).toEqual({t: "Math", c: [{t: "InlineMath"}, "x^2"]});
  expect(JSON.parse(output).blocks[0].c[4]).toEqual({t: "Math", c: [{t: "DisplayMath"}, "y^2"]});
});
