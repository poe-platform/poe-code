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
  it(`resolves footnotes to Note nodes and HTML (retained=${retained})`, async () => {
    const text = "Footnote here[^n].\n\n[^n]: Note *text*.\n\n    Second paragraph.\n";
    const blocks = JSON.parse(await render(text)).blocks;
    expect(blocks).toHaveLength(1);
    expect(blocks[0].c.find((inline: {t: string}) => inline.t === "Note").c).toEqual([
      {t: "Para", c: [{t: "Str", c: "Note"}, {t: "Space"}, {t: "Emph", c: [{t: "Str", c: "text"}]}, {t: "Str", c: "."}]},
      {t: "Para", c: [{t: "Str", c: "Second"}, {t: "Space"}, {t: "Str", c: "paragraph."}]}
    ]);
    expect(await render(text, "markdown", "html")).toContain('class="footnote-ref"');
    expect(await render(text, "markdown", "html")).toContain('class="footnotes"');
  });
  it(`preserves undefined, escaped and code references and handles cycles (retained=${retained})`, async () => {
    const result = await render("Missing[^x] `[^n]` \\[^n] real[^n].\n\n[^n]: Self[^n].\n");
    expect(result.split('"t":"Note"')).toHaveLength(2);
    expect(result).toContain("Self[^n].");
  });
  it(`resolves forward, repeated and nested references (retained=${retained})`, async () => {
    const text = "[^a]: Outer[^b].\n\n[^b]: Inner.\n\nRef[^a] again[^a].\n";
    const result = await render(text);
    expect(result.split('"t":"Note"')).toHaveLength(5);
    expect(JSON.parse(result).blocks).toHaveLength(1);
    expect(await render("Text[^n].\n\n[^n]: Note.\n", "gfm+footnotes")).toContain('"t":"Note"');
  });
  it.each(["gfm", "commonmark", "markdown-footnotes"])(`leaves footnotes literal with %s (retained=${retained})`, async from => {
    expect(await render("Text[^n].\n\n[^n]: Note.\n", from)).not.toContain('"t":"Note"');
  });
}

it("converts the standalone footnote reproduction", async () => {
  let output = "", errors = "";
  const result = await createStandalonePandocCommand().execute({
    args: ["-f", "markdown", "-t", "html"],
    stdin: [new TextEncoder().encode("Footnote here[^n].\n\n[^n]: Note text.\n")],
    signal: new AbortController().signal,
    stdout: {async write(bytes) {output += new TextDecoder().decode(bytes);}},
    stderr: {async write(bytes) {errors += new TextDecoder().decode(bytes);}}
  });
  expect(result.exitCode).toBe(0);
  expect(errors).toBe("");
  expect(output).toContain('class="footnote-ref"');
  expect(output).toContain('<p>Note text.</p>');
  expect(output).not.toContain("[^n]");
});
