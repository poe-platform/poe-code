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
  it(`parses Markdown superscripts and subscripts (retained=${retained})`, async () => {
    expect(JSON.parse(await render("x^2^ and H~2~O\n")).blocks[0].c).toEqual([
      {t: "Str", c: "x"}, {t: "Superscript", c: [{t: "Str", c: "2"}]},
      {t: "Space"}, {t: "Str", c: "and"}, {t: "Space"},
      {t: "Str", c: "H"}, {t: "Subscript", c: [{t: "Str", c: "2"}]}, {t: "Str", c: "O"}
    ]);
    expect(await render("x^2^ and H~2~O\n", "markdown", "html")).toBe("<p>x<sup>2</sup> and H<sub>2</sub>O</p>\n");
    expect(await render("^*bold*^ ~a\\ b~ ~~gone~~", "markdown", "html")).toBe("<p><sup><em>bold</em></sup> <sub>a b</sub> <del>gone</del></p>\n");
  });
  it(`preserves literal and disabled syntax (retained=${retained})`, async () => {
    for (const from of ["gfm", "commonmark", "markdown-superscript-subscript"]) {
      expect(await render("x^2^ H~2~O", from, "html")).toBe("<p>x^2^ H~2~O</p>\n");
    }
    expect(await render("x\\^2\\^ H\\~2\\~O `x^2^` ^a b^ ~a b~ ^open ~open", "markdown", "html"))
      .toBe("<p>x^2^ H~2~O <code>x^2^</code> ^a b^ ~a b~ ^open ~open</p>\n");
    expect(await render("x^2^ H~2~O", "gfm+superscript+subscript", "html")).toBe("<p>x<sup>2</sup> H<sub>2</sub>O</p>\n");
    expect(await render("x^2^ H~2~O", "markdown-superscript", "html")).toBe("<p>x^2^ H<sub>2</sub>O</p>\n");
    expect(await render("x^2^ H~2~O", "md-subscript", "html")).toBe("<p>x<sup>2</sup> H~2~O</p>\n");
  });
}

it("converts script syntax through the standalone command", async () => {
  let output = "", errors = "";
  const result = await createStandalonePandocCommand().execute({
    args: ["-f", "markdown", "-t", "html"],
    stdin: [new TextEncoder().encode("x^2^ and H~2~O\n")],
    signal: new AbortController().signal,
    stdout: {async write(bytes) {output += new TextDecoder().decode(bytes);}},
    stderr: {async write(bytes) {errors += new TextDecoder().decode(bytes);}}
  });
  expect(result.exitCode).toBe(0);
  expect(errors).toBe("");
  expect(output).toBe("<p>x<sup>2</sup> and H<sub>2</sub>O</p>\n");
});
