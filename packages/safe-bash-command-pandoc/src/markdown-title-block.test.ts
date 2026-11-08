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
  it(`reads percent title metadata (retained=${retained})`, async () => {
    for (const from of ["markdown", "md", "gfm+pandoc_title_block"]) {
      const document = JSON.parse(await render("% My *Title*\n% Alice; Bob\n% 2026\n\nBody.\n", from));
      expect(document.meta).toEqual({
        title: {t: "MetaInlines", c: [{t: "Str", c: "My"}, {t: "Space"}, {t: "Emph", c: [{t: "Str", c: "Title"}]}]},
        author: {t: "MetaList", c: ["Alice", "Bob"].map(c => ({t: "MetaInlines", c: [{t: "Str", c}]}))},
        date: {t: "MetaInlines", c: [{t: "Str", c: "2026"}]}
      });
      expect(document.blocks).toEqual([{t: "Para", c: [{t: "Str", c: "Body."}]}]);
    }
  });
  it(`combines title and YAML metadata (retained=${retained})`, async () => {
    const document = JSON.parse(await render("% Title\n---\nsubject: Example\n---\nBody."));
    expect(document.meta.title.c).toEqual([{t: "Str", c: "Title"}]);
    expect(document.meta.subject).toEqual({t: "MetaInlines", c: [{t: "Str", c: "Example"}]});
  });
  it(`preserves disabled and noninitial percent lines (retained=${retained})`, async () => {
    for (const from of ["markdown-pandoc_title_block", "commonmark", "gfm"]) {
      const document = JSON.parse(await render("% Title\n\nBody.", from));
      expect(document.meta).toEqual({});
      expect(document.blocks).toHaveLength(2);
    }
    expect(JSON.parse(await render("Body.\n\n% Title")).meta).toEqual({});
  });
  it(`reads omitted fields and author continuation lines (retained=${retained})`, async () => {
    const document = JSON.parse(await render("%\n% Alice\n  Bob\n%\n\nBody."));
    expect(document.meta).toEqual({author: {t: "MetaList", c: ["Alice", "Bob"].map(c => ({t: "MetaInlines", c: [{t: "Str", c}]}))}});
    expect(JSON.parse(await render("% Title")).meta.title.c).toEqual([{t: "Str", c: "Title"}]);
  });
}

it("reads title metadata through the standalone command", async () => {
  let output = "";
  const result = await createStandalonePandocCommand().execute({
    args: ["-f", "markdown", "-t", "json"], stdin: [new TextEncoder().encode("% My Title\n% Author\n% 2026\n\nBody.\n")],
    signal: new AbortController().signal,
    stdout: {async write(bytes) {output += new TextDecoder().decode(bytes);}}, stderr: {async write() {}}
  });
  expect(result.exitCode).toBe(0);
  expect(Object.keys(JSON.parse(output).meta).sort()).toEqual(["author", "date", "title"]);
  expect(JSON.parse(output).blocks).toEqual([{t: "Para", c: [{t: "Str", c: "Body."}]}]);
});
