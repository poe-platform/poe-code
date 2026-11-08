import {expect, it} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {createStandalonePandocCommand} from "./safe-bash.js";
import {convert, convertToOutput} from "./engine.js";

const table = "| A | B |\n|---|---|\n| 1 | 2 |\n";
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
  it(`attaches Markdown table captions (retained=${retained})`, async () => {
    for (const from of ["markdown", "md", "gfm+table_captions"]) {
      const blocks = JSON.parse(await render(`Table: Sample caption\n\n${table}`, from)).blocks;
      expect(blocks).toHaveLength(1);
      expect(blocks[0].t).toBe("Table");
      expect(blocks[0].c[1]).toEqual([null, [{t: "Plain", c: [{t: "Str", c: "Sample"}, {t: "Space"}, {t: "Str", c: "caption"}]}]]);
    }
    expect(await render(`Table: Sample caption\n\n${table}`, "markdown", "html")).toContain("<caption>Sample caption</caption>");
  });
  it(`preserves disabled and unrelated paragraphs (retained=${retained})`, async () => {
    for (const from of ["markdown-table_captions", "gfm"]) {
      const blocks = JSON.parse(await render(`Table: Sample caption\n\n${table}`, from)).blocks;
      expect(blocks.map((block: {t: string}) => block.t)).toEqual(["Para", "Table"]);
      expect(blocks[1].c[1]).toEqual([null, []]);
    }
    for (const text of [`Table: Caption\n\nOther paragraph\n\n${table}`, `Table:Caption\n\n${table}`]) {
      expect(JSON.parse(await render(text)).blocks[0].t).toBe("Para");
    }
  });
  it(`attaches trailing captions with or without a blank line (retained=${retained})`, async () => {
    for (const gap of ["", "\n"]) {
      const text = `${table}${gap}: *Sample*\ncaption\n\nAfter`;
      const blocks = JSON.parse(await render(text)).blocks;
      expect(blocks.map((block: {t: string}) => block.t)).toEqual(["Table", "Para"]);
      expect(blocks[0].c[1]).toEqual([null, [{t: "Plain", c: [{t: "Emph", c: [{t: "Str", c: "Sample"}]}, {t: "SoftBreak"}, {t: "Str", c: "caption"}]}]]);
      expect(blocks[1].c).toEqual([{t: "Str", c: "After"}]);
      const disabled = JSON.parse(await render(text, "markdown-table_captions")).blocks;
      expect(disabled.map((block: {t: string}) => block.t)).toEqual(["Table", "Para", "Para"]);
      expect(disabled[0].c[1]).toEqual([null, []]);
      const quoted = JSON.parse(await render(text.split("\n").map(line => `> ${line}`).join("\n"))).blocks[0].c;
      expect(quoted).toEqual(blocks);
    }
    for (const [suffix, kind] of [[":Caption", "Para"], ["Other\n\n: Caption", "DefinitionList"]]) {
      const blocks = JSON.parse(await render(`${table}\n${suffix}`)).blocks;
      expect(blocks[0].c[1]).toEqual([null, []]);
      expect(blocks[1].t).toBe(kind);
    }
    const captioned = JSON.parse(await render(`Table: First\n\n${table}\n: Second`)).blocks;
    expect(captioned.map((block: {t: string}) => block.t)).toEqual(["Table", "Para"]);
    expect(captioned[0].c[1]).toEqual([null, [{t: "Plain", c: [{t: "Str", c: "First"}]}]]);
    expect(captioned[1].c).toEqual([{t: "Str", c: ":"}, {t: "Space"}, {t: "Str", c: "Second"}]);
  });
  it(`parses formatted multiline captions in containers (retained=${retained})`, async () => {
    const text = `Table: *Sample*\ncaption\n\n${table}`;
    const blocks = JSON.parse(await render(text.split("\n").map(line => `> ${line}`).join("\n"))).blocks[0].c;
    expect(blocks).toHaveLength(1);
    expect(blocks[0].c[1][1][0].c).toEqual([{t: "Emph", c: [{t: "Str", c: "Sample"}]}, {t: "SoftBreak"}, {t: "Str", c: "caption"}]);
  });
}

it.each([`Table: Sample caption\n\n${table}`, `${table}\n: Sample caption`])("attaches the caption through the standalone command: %s", async (text) => {
  let output = "", errors = "";
  const result = await createStandalonePandocCommand().execute({
    args: ["-f", "markdown", "-t", "json"],
    stdin: [new TextEncoder().encode(text)],
    signal: new AbortController().signal,
    stdout: {async write(bytes) {output += new TextDecoder().decode(bytes);}},
    stderr: {async write(bytes) {errors += new TextDecoder().decode(bytes);}}
  });
  expect(result.exitCode).toBe(0);
  expect(errors).toBe("");
  const blocks = JSON.parse(output).blocks;
  expect(blocks).toHaveLength(1);
  expect(blocks[0].t).toBe("Table");
  expect(blocks[0].c[1][1][0].c).toEqual([{t: "Str", c: "Sample"}, {t: "Space"}, {t: "Str", c: "caption"}]);
});
