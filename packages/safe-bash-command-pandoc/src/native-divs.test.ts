import {expect, it} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {convert, convertToOutput} from "./engine.js";
import {createStandalonePandocCommand} from "./safe-bash.js";

const source = '<div id="note" class="x y" title="a &amp; b"><div class="inner">a</div></div>\n';
const expected = [{t: "Div", c: [["note", ["x", "y"], [["title", "a & b"]]], [
  {t: "Div", c: [["", ["inner"], []], [{t: "Plain", c: [{t: "Str", c: "a"}]}]]}
]]}];

it.each(["markdown", "md", "gfm+native_divs"])("preserves native div attributes and children in both %s readers", async from => {
  const input = {bytes: new TextEncoder().encode(source)};
  const result = await convert([input], {from, to: "json"}, {});
  expect(result.kind === "text" && JSON.parse(result.text).blocks).toEqual(expected);
  const fs = new MemoryFileSystem(); let text = "";
  await convertToOutput([input], {from, to: "json"}, {
    workingFiles: {fs, directory: "/", cacheBytes: 16384},
    output: {async write(bytes) {text += new TextDecoder().decode(bytes);}, async close() {}, async abort() {}}
  });
  expect(JSON.parse(text).blocks).toEqual(expected);
  expect(await fs.readdir("/")).toEqual([]);
});

it.each(["markdown-native_divs", "gfm", "commonmark"])("keeps divs raw with %s", async from => {
  const result = await convert([{bytes: new TextEncoder().encode(source)}], {from, to: "json"}, {});
  expect(result.kind === "text" && JSON.parse(result.text).blocks).toEqual([{t: "RawBlock", c: ["html", source]}]);
});

it("converts the byte-stream command reproduction to a native Div", async () => {
  let text = "";
  const result = await createStandalonePandocCommand().execute({
    args: ["-f", "markdown", "-t", "json"],
    stdin: (async function* () {yield new TextEncoder().encode('<div class="x">a</div>\n');})(),
    stdout: {async write(bytes) {text += new TextDecoder().decode(bytes);}},
    stderr: {async write() {}}, signal: new AbortController().signal
  });
  expect(result).toEqual({exitCode: 0});
  expect(JSON.parse(text).blocks).toEqual([{t: "Div", c: [["", ["x"], []], [{t: "Plain", c: [{t: "Str", c: "a"}]}]]}]);
});

it("preserves div structure in HTML output", async () => {
  const result = await convert([{bytes: new TextEncoder().encode('<div class="x">a</div>\n')}], {from: "markdown", to: "html"}, {});
  expect(result).toMatchObject({kind: "text", text: '<div class="x">a</div>\n'});
});

it("leaves other HTML blocks raw and div-looking code literal", async () => {
  const input = '<section>a</section>\n\n```html\n<div class="x">a</div>\n```\n';
  const result = await convert([{bytes: new TextEncoder().encode(input)}], {from: "markdown", to: "json"}, {});
  expect(result.kind === "text" && JSON.parse(result.text).blocks).toEqual([
    {t: "RawBlock", c: ["html", "<section>a</section>\n"]},
    {t: "CodeBlock", c: [["", ["html"], []], '<div class="x">a</div>']}
  ]);
});
