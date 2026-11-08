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
  it(`attaches image attributes (retained=${retained})`, async () => {
    for (const from of ["markdown", "md", "gfm+link_attributes"]) {
      const blocks = JSON.parse(await render('Text ![Alt](pic.png){width=50%} more.\n', from)).blocks;
      expect(blocks).toEqual([{t: "Para", c: [
        {t: "Str", c: "Text"}, {t: "Space"},
        {t: "Image", c: [["", [], [["width", "50%"]]], [{t: "Str", c: "Alt"}], ["pic.png", ""]]},
        {t: "Space"}, {t: "Str", c: "more."}
      ]}]);
    }
  });
  it(`attaches identifiers, classes and quoted values to links and reference images (retained=${retained})`, async () => {
    for (const target of ["![Alt](pic.png)", "![Alt][ref]", "[Alt](pic.png)"]) {
      const blocks = JSON.parse(await render(`Text ${target}{#photo .wide title="a } b"}\n\n[ref]: pic.png\n`)).blocks;
      expect(blocks[0].c[2].c[0]).toEqual(["photo", ["wide"], [["title", "a } b"]]]);
      expect(blocks[0].c).toHaveLength(3);
    }
  });
  it(`preserves disabled and malformed suffixes (retained=${retained})`, async () => {
    for (const from of ["markdown-link_attributes", "commonmark", "gfm"]) {
      const nodes = JSON.parse(await render('Text ![Alt](pic.png){width=50%}', from)).blocks[0].c;
      expect(nodes[2].c[0]).toEqual(["", [], []]);
      expect(nodes[3]).toEqual({t: "Str", c: "{width=50%}"});
    }
    for (const suffix of ["{invalid}", "{width=50%", String.raw`\{width=50%}`, '{title="unclosed}']) {
      const nodes = JSON.parse(await render(`Text ![Alt](pic.png)${suffix}`)).blocks[0].c;
      expect(nodes[2].c[0]).toEqual(["", [], []]);
      expect(nodes.length).toBeGreaterThan(3);
    }
  });
}

it("attaches image width through the standalone command", async () => {
  let output = "";
  const result = await createStandalonePandocCommand().execute({
    args: ["-f", "markdown", "-t", "json"], stdin: [new TextEncoder().encode("Text ![Alt](pic.png){width=50%} more.\n")],
    signal: new AbortController().signal,
    stdout: {async write(bytes) {output += new TextDecoder().decode(bytes);}}, stderr: {async write() {}}
  });
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(output).blocks[0].c[2].c[0]).toEqual(["", [], [["width", "50%"]]]);
  expect(JSON.parse(output).blocks[0].c).toHaveLength(5);
});
