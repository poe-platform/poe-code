import {expect, it} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {createPandocCommand} from "./command.js";
import {convert, convertToOutput} from "./engine.js";

it.each([
  ['<pre><code class="language-js">const x=1;</code></pre>', ["js"]],
  ['<pre class="language-js outer"><code class="js language-python inner">const x=1;</code></pre>', ["js", "outer", "python", "inner"]],
  ['<pre><code class="language-language-js other-language-js Language-js">const x=1;</code></pre>', ["language-js", "other-language-js", "Language-js"]]
])("normalizes HTML code block language classes through the public command: %s", async (source, classes) => {
  let output = "", stderr = "";
  const result = await createPandocCommand().execute({
    command: "pandoc", cwd: "/", env: {}, fs: new MemoryFileSystem(),
    args: ["-f", "html", "-t", "json"], stdin: (async function* () {yield new TextEncoder().encode(source);})(),
    signal: new AbortController().signal,
    stdout: {async write(bytes) {output += new TextDecoder().decode(bytes);}},
    stderr: {async write(bytes) {stderr += new TextDecoder().decode(bytes);}}
  });
  expect(result.exitCode).toBe(0);
  expect(stderr).toBe("");
  expect(JSON.parse(output).blocks).toEqual([{t: "CodeBlock", c: [["", classes, []], "const x=1;"]}]);
});

it("highlights JavaScript after an HTML round trip", async () => {
  const result = await convert([{bytes: new TextEncoder().encode('<pre><code class="language-js">const x=1;</code></pre>')}], {from: "html", to: "html"}, {});
  expect(result.kind).toBe("text");
  if (result.kind === "text") {
    expect(result.text).toContain('class="sourceCode javascript"');
    expect(result.text).toContain('<span class="kw">const</span>');
  }
});

it("normalizes language classes in the retained HTML reader", async () => {
  let output = "";
  await convertToOutput([{bytes: new TextEncoder().encode('<pre class="outer language-js"><code class="js language-python">const x=1;</code></pre>')}], {from: "html", to: "json"}, {
    workingFiles: {fs: new MemoryFileSystem(), directory: "/", cacheBytes: 16384},
    output: {async write(bytes) {output += new TextDecoder().decode(bytes);}, async close() {}, async abort() {}}
  });
  expect(JSON.parse(output).blocks).toEqual([{t: "CodeBlock", c: [["", ["outer", "js", "python"], []], "const x=1;"]}]);
});
