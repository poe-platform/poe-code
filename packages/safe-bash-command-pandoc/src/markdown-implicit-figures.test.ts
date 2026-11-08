import {expect, it} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {createStandalonePandocCommand} from "./safe-bash.js";
import {createPandocCommand} from "./command.js";
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
  it(`recognizes standalone image captions (retained=${retained})`, async () => {
    const text = '![Alt](pic.png "Caption")\n';
    const image = {t: "Image", c: [["", [], []], [{t: "Str", c: "Alt"}], ["pic.png", "Caption"]]};
    for (const from of ["markdown", "md", "gfm+implicit_figures"]) {
      expect(JSON.parse(await render(text, from)).blocks).toEqual([
        {t: "Figure", c: [["", [], []], [null, [{t: "Plain", c: [{t: "Str", c: "Alt"}]}]], [{t: "Plain", c: [image]}]]}
      ]);
      const html = await render(text, from, "html");
      expect(html).toContain("<figure>");
      expect(html).toContain('<figcaption aria-hidden="true">Alt</figcaption>');
    }
    for (const from of ["markdown-implicit_figures", "gfm", "commonmark"]) {
      expect(JSON.parse(await render(text, from)).blocks).toEqual([{t: "Para", c: [image]}]);
    }
  });
  it(`hides only captions duplicating a single image alt (retained=${retained})`, async () => {
    const str = (c: string) => ({t: "Str", c});
    const image = {t: "Image", c: [["", [], []], [str("A red square")], ["image.png", ""]]};
    for (const [caption, body, hidden] of [
      [[{t: "Plain", c: [str("A red square")]}], [{t: "Plain", c: [image]}], true],
      [[{t: "Para", c: [{t: "Emph", c: [str("A red square")]}]}], [{t: "Plain", c: [image]}], true],
      [[{t: "Plain", c: [str("Different caption")]}], [{t: "Plain", c: [image]}], false],
      [[{t: "Plain", c: [str("A red square")]}], [{t: "Para", c: [image]}], false],
      [[{t: "Plain", c: [str("A red square")]}], [{t: "Plain", c: [image, image]}], false]
    ] as const) {
      const json = JSON.stringify({"pandoc-api-version": [1, 23, 1, 2], meta: {},
        blocks: [{t: "Figure", c: [["", [], []], [null, caption], body]}]});
      const html = await render(json, "json", "html5");
      expect(html).toContain(hidden ? '<figcaption aria-hidden="true">' : "<figcaption>");
    }
  });
  it(`keeps inline and empty-alt images as paragraphs (retained=${retained})`, async () => {
    for (const text of ["Before ![Alt](pic.png)", "![Alt](pic.png) after", "![](pic.png)", "![A](a.png) ![B](b.png)"]) {
      expect(JSON.parse(await render(text)).blocks[0].t).toBe("Para");
    }
  });
  it(`recognizes figures in quotes and lists (retained=${retained})`, async () => {
    const blocks = JSON.parse(await render("> ![*Alt*](pic.png)\n\n- ![Alt](pic.png)\n")).blocks;
    expect(blocks[0].c[0].t).toBe("Figure");
    expect(blocks[0].c[0].c[1][1][0].c).toEqual([{t: "Emph", c: [{t: "Str", c: "Alt"}]}]);
    expect(blocks[1].c[0][0].t).toBe("Figure");
  });
}

it("renders the standalone Markdown image command reproduction", async () => {
  let output = "", errors = "";
  const result = await createStandalonePandocCommand().execute({
    args: ["-f", "markdown", "-t", "html"],
    stdin: [new TextEncoder().encode('![Alt](pic.png "Caption")\n')],
    signal: new AbortController().signal,
    stdout: {async write(bytes) {output += new TextDecoder().decode(bytes);}},
    stderr: {async write(bytes) {errors += new TextDecoder().decode(bytes);}}
  });
  expect(result.exitCode).toBe(0);
  expect(errors).toBe("");
  expect(output).toContain("<figure>");
  expect(output).toContain('<figcaption aria-hidden="true">Alt</figcaption>');
});

it("preserves figure images and captions in MediaWiki", async () => {
  const input = [{bytes: new TextEncoder().encode("![Alt](pic.png)")}];
  const wiki = await convert(input, {from: "markdown", to: "mediawiki"}, {});
  expect(wiki.kind === "text" && wiki.text).toContain("[[File:pic.png|Alt]]");
  expect(wiki.kind === "text" && wiki.text).toContain("\n\nAlt");
});

it("hides duplicate captions through the public file-input command", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input.md", new TextEncoder().encode("![A red square](image.png)\n"));
  let output = "", errors = "";
  const result = await createPandocCommand().execute({
    command: "pandoc", args: ["-f", "markdown", "-t", "html5", "/input.md"],
    fs, cwd: "/", env: {}, signal: new AbortController().signal,
    stdin: (async function* () {})(),
    stdout: {async write(bytes) {output += new TextDecoder().decode(bytes);}},
    stderr: {async write(bytes) {errors += new TextDecoder().decode(bytes);}}
  });
  expect(result.exitCode).toBe(0);
  expect(errors).toBe("");
  expect(output).toContain('alt="A red square"');
  expect(output).toContain('<figcaption aria-hidden="true">A red square</figcaption>');
});
