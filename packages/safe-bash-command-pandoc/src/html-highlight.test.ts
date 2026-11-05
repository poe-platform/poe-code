import {expect, it} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {convert, convertToOutput, writeDocument} from "./engine.js";
import {createPandocCommand} from "./command.js";

const source = '```js\nconst x = 1;\n```\n';
const expected = '<div class="sourceCode" id="cb1"><pre class="sourceCode javascript"><code class="sourceCode javascript"><span id="cb1-1"><a href="#cb1-1" aria-hidden="true" tabindex="-1"></a><span class="kw">const</span> x <span class="op">=</span> <span class="dv">1</span><span class="op">;</span></span></code></pre></div>\n';
for (const retained of [false, true]) {
  async function render(text: string, standalone = false) {
    const inputs = [{bytes: new TextEncoder().encode(text)}], options = {from: "markdown", to: "html", standalone};
    if (!retained) return (await convert(inputs, options, {}) as {text: string}).text;
    let output = "";
    await convertToOutput(inputs, options, {
      workingFiles: {fs: new MemoryFileSystem(), directory: "/", cacheBytes: 16384},
      output: {async write(bytes) {output += new TextDecoder().decode(bytes);}, async close() {}, async abort() {}}
    });
    return output;
  }
  it(`highlights the reported JavaScript fence (retained=${retained})`, async () => {
    expect(await render(source)).toBe(expected);
  });
  it(`highlights aliases and multiple languages with unique line anchors (retained=${retained})`, async () => {
    const html = await render(source + '\n```python\n# comment\nprint("<tag>&")\n```\n');
    expect(html).toContain('id="cb2-2"');
    expect(html).toContain('<span class="co"># comment</span>');
    expect(html).toContain('<span class="st">"&lt;tag&gt;&amp;"</span>');
    expect(html).not.toContain('<tag>');
  });
  it(`keeps unknown languages and unlabelled code plain (retained=${retained})`, async () => {
    expect(await render('```unknown-language\n<x>\n```\n\n```\ny\n```')).toBe('<pre><code class="unknown-language">&lt;x&gt;</code></pre>\n<pre><code>y</code></pre>\n');
  });
  it(`preserves multiline strings and blank lines (retained=${retained})`, async () => {
    const html = await render('```python\nvalue = """first\n\nlast"""\n```');
    expect(html).toContain('id="cb1-3"');
    expect(html).toContain('<span class="st">last"""</span>');
  });
  it(`avoids collisions with existing IDs (retained=${retained})`, async () => {
    const html = await render('::: {#cb1}\nReserved\n:::\n\n' + source);
    expect(html).toContain('<div class="sourceCode" id="cb1-1">');
    expect(html).toContain('id="cb1-1-1"');
  });
  it(`includes highlight styles in standalone output (retained=${retained})`, async () => {
    expect(await render(source, true)).toContain('code span.kw');
  });
}
it("highlights through the public command", async () => {
  let output = "";
  const result = await createPandocCommand().execute({command: "pandoc", args: ["-f", "markdown", "-t", "html"],
    cwd: "/", env: {}, fs: new MemoryFileSystem(), signal: new AbortController().signal,
    stdin: (async function* () {yield new TextEncoder().encode(source);})(),
    stdout: {async write(bytes) {output += new TextDecoder().decode(bytes);}}, stderr: {async write() {}}
  });
  expect(result.exitCode).toBe(0); expect(output).toBe(expected);
});

it("preserves carriage returns and Unicode in highlighted source and rejects NUL", async () => {
  const doc = (text: string) => ({metadata: {}, resources: [], blocks: [{t: "CodeBlock" as const, c: [["", ["js"], []], text] as const}]});
  const result = await writeDocument(doc('// é😀\r\nconst x = 1;'), {to: "html", ascii: true}, {});
  expect(result).toMatchObject({text: expect.stringContaining('&#233;&#128512;')});
  expect(result).toMatchObject({text: expect.stringContaining('&#13;')});
  await expect(writeDocument(doc('"\0"'), {to: "html"}, {})).rejects.toMatchObject({code: "E_CAPABILITY"});
  await expect(writeDocument(doc('const x = 1;'), {to: "html"}, {limits: {outputBytes: 30}})).rejects.toMatchObject({code: "E_LIMIT"});
});
it("leaves the Markdown code-block AST unchanged", async () => {
  const result = await convert([{bytes: new TextEncoder().encode(source)}], {from: "markdown", to: "json"}, {});
  expect(JSON.parse((result as {text: string}).text).blocks).toEqual([{t: "CodeBlock", c: [["", ["js"], []], "const x = 1;"]}]);
});
