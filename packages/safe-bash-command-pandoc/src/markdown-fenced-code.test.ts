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
  it(`preserves fenced code attributes (retained=${retained})`, async () => {
    const text = '```{.python #demo .numberLines startFrom="3" title="A sample"}\nprint(1)\n```\n';
    for (const from of ["markdown", "md", "gfm+fenced_code_attributes"]) {
      expect(JSON.parse(await render(text, from)).blocks).toEqual([{t: "CodeBlock", c: [
        ["demo", ["python", "numberLines"], [["startFrom", "3"], ["title", "A sample"]]], "print(1)"
      ]}]);
    }
    const html = await render('```{.python #demo .numberLines title="A sample"}\nprint(1)\n```\n', "markdown", "html");
    expect(html).toContain('id="demo"');
    expect(html).toContain('class="sourceCode python numberSource"');
    expect(html).toContain('<span class="bu">print</span>(<span class="dv">1</span>)');
  });
  it.each(["commonmark", "gfm", "markdown-fenced_code_attributes"])(`keeps default info semantics for %s (retained=${retained})`, async from => {
    expect(JSON.parse(await render('```{.python #demo}\nprint(1)\n```\n', from)).blocks[0].c[0]).toEqual(["", ["{.python"], []]);
  });
  it(`preserves bare languages and empty attributes (retained=${retained})`, async () => {
    expect(JSON.parse(await render('```python\nprint(1)\n```\n')).blocks[0].c[0]).toEqual(["", ["python"], []]);
    expect(JSON.parse(await render('~~~{}\ncode\n~~~\n')).blocks[0].c[0]).toEqual(["", [], []]);
  });
}

it("converts standalone fenced code attributes", async () => {
  let output = "";
  const result = await createStandalonePandocCommand().execute({
    args: ["-f", "markdown", "-t", "json"],
    stdin: [new TextEncoder().encode('```{.python #demo}\nprint(1)\n```\n')],
    signal: new AbortController().signal,
    stdout: {async write(bytes) {output += new TextDecoder().decode(bytes);}},
    stderr: {async write() {}}
  });
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(output).blocks).toEqual([{t: "CodeBlock", c: [["demo", ["python"], []], "print(1)"]}]);
});
