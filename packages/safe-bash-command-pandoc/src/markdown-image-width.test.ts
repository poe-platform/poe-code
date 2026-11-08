import {expect, it} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {convert, convertToOutput} from "./engine.js";
import {createStandalonePandocCommand} from "./safe-bash.js";

const image = {t: "Image", c: [["", [], [["width", "50%"]]], [{t: "Str", c: "Alt"}], ["pic.png", ""]]};
const para = {t: "Para", c: [{t: "Str", c: "Text"}, {t: "Space"}, image, {t: "Space"}, {t: "Str", c: "more."}]};
function input(blocks: unknown[]) {
  return {bytes: new TextEncoder().encode(JSON.stringify({"pandoc-api-version": [1, 23, 1, 2], meta: {}, blocks}))};
}

for (const retained of [false, true]) {
  async function render(blocks: unknown[], to: string) {
    if (!retained) {
      const result = await convert([input(blocks)], {from: "json", to}, {});
      expect(result.diagnostics).toEqual([]);
      if (result.kind !== "text") throw new Error("Expected text");
      return result.text;
    }
    let output = "";
    const result = await convertToOutput([input(blocks)], {from: "json", to}, {
      workingFiles: {fs: new MemoryFileSystem(), directory: "/", cacheBytes: 16384},
      output: {async write(bytes) {output += new TextDecoder().decode(bytes);}, async close() {}, async abort() {}}
    });
    expect(result.diagnostics).toEqual([]);
    return output;
  }
  it(`preserves image width in Markdown output (retained=${retained})`, async () => {
    for (const to of ["markdown", "md", "gfm+link_attributes"]) {
      expect(await render([para], to)).toBe('Text ![Alt](<pic.png>){width="50%"} more.\n');
      const repeated = await render([para, para], to);
      expect(repeated.split('{width="50%"}')).toHaveLength(3);
      const figure = {t: "Figure", c: [["", [], []], [null, [{t: "Plain", c: [{t: "Str", c: "Caption"}]}]], [{t: "Plain", c: [image]}]]};
      expect(await render([figure], to)).toBe('![Caption](<pic.png>){width="50%"}\n');
    }
  });
  it(`rejects width when link attributes are disabled (retained=${retained})`, async () => {
    for (const to of ["markdown-link_attributes", "commonmark", "gfm"]) {
      await expect(render([para], to)).rejects.toMatchObject({code: "E_UNSUPPORTED_FEATURE"});
    }
  });
}

it("preserves image width through the standalone command without projection warnings", async () => {
  let output = "", errors = "";
  const result = await createStandalonePandocCommand().execute({
    args: ["-f", "json", "-t", "markdown"], stdin: [input([para]).bytes],
    signal: new AbortController().signal,
    stdout: {async write(bytes) {output += new TextDecoder().decode(bytes);}},
    stderr: {async write(bytes) {errors += new TextDecoder().decode(bytes);}}
  });
  expect(result.exitCode, errors).toBe(0);
  expect(errors).toBe("");
  expect(output).toBe('Text ![Alt](<pic.png>){width="50%"} more.\n');
});
