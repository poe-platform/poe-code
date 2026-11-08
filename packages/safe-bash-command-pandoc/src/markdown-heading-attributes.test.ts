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
  it(`reads heading attributes (retained=${retained})`, async () => {
    for (const from of ["markdown", "md", "gfm+header_attributes"]) {
      for (const text of ['# Heading {#custom .loud .extra title="a { b"}\n', '# Heading {#custom .loud .extra title="a { b"}   \n', 'Heading {#custom .loud .extra title="a { b"}\n=======\n']) {
        expect(JSON.parse(await render(text, from)).blocks).toEqual([{t: "Header", c: [1,
          ["custom", ["loud", "extra"], [["title", "a { b"]]], [{t: "Str", c: "Heading"}]
        ]}]);
      }
    }
    expect(await render('# Heading {#custom .loud}\n', "markdown", "html")).toBe('<h1 id="custom" class="loud">Heading</h1>\n');
  });
  it.each(["commonmark", "gfm", "markdown-header_attributes"])(`keeps disabled attributes literal in %s (retained=${retained})`, async from => {
    const header = JSON.parse(await render('# Heading {#custom .loud}\n', from)).blocks[0];
    expect(header.c[1]).toEqual([from === "markdown-header_attributes" ? "heading-custom-.loud" : "", [], []]);
    expect(header.c[2]).toContainEqual({t: "Str", c: "{#custom"});
  });
  it(`preserves malformed and escaped attributes (retained=${retained})`, async () => {
    for (const text of ['# Heading {invalid}', '# Heading {#custom', String.raw`# Heading \{#custom}`, '# Heading `{#custom}`']) {
      const header = JSON.parse(await render(text, "markdown-auto_identifiers")).blocks[0];
      expect(header.c[1]).toEqual(["", [], []]);
      expect(header.c[2].length).toBeGreaterThan(1);
    }
  });
}

it("reads heading attributes through the standalone command", async () => {
  let output = "";
  const result = await createStandalonePandocCommand().execute({
    args: ["-f", "markdown", "-t", "json"], stdin: [new TextEncoder().encode("# Heading {#custom .loud}\n")],
    signal: new AbortController().signal,
    stdout: {async write(bytes) {output += new TextDecoder().decode(bytes);}}, stderr: {async write() {}}
  });
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(output).blocks[0].c).toEqual([1, ["custom", ["loud"], []], [{t: "Str", c: "Heading"}]]);
});
