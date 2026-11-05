import {expect, it} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {convert, convertToOutput} from "./engine.js";
import {createStandalonePandocCommand} from "./safe-bash.js";

const source = '<span id="note" class="x y" title="a &amp; b"><span class="inner">a</span></span>\n';
const expected = [{t: "Para", c: [{t: "Span", c: [["note", ["x", "y"], [["title", "a & b"]]], [
  {t: "Span", c: [["", ["inner"], []], [{t: "Str", c: "a"}]]}
]]}]}];

it.each(["markdown", "md", "gfm+native_spans"])("preserves native span attributes and children in both %s readers", async from => {
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

it.each(["markdown-native_spans", "gfm", "commonmark"])("keeps spans raw with %s", async from => {
  const result = await convert([{bytes: new TextEncoder().encode(source)}], {from, to: "json"}, {});
  expect(result.kind === "text" && JSON.parse(result.text).blocks).toEqual([{t: "Para", c: [{t: "RawInline", c: ["html", '<span id="note" class="x y" title="a &amp; b">']}, {t: "RawInline", c: ["html", '<span class="inner">']}, {t: "Str", c: "a"}, {t: "RawInline", c: ["html", "</span>"]}, {t: "RawInline", c: ["html", "</span>"]}]}]);
});

it("converts the byte-stream command reproduction to a native Span", async () => {
  let text = "";
  const result = await createStandalonePandocCommand().execute({
    args: ["-f", "markdown", "-t", "json"],
    stdin: (async function* () {yield new TextEncoder().encode('<span class="x">a</span>\n');})(),
    stdout: {async write(bytes) {text += new TextDecoder().decode(bytes);}},
    stderr: {async write() {}}, signal: new AbortController().signal
  });
  expect(result).toEqual({exitCode: 0});
  expect(JSON.parse(text).blocks).toEqual([{t: "Para", c: [{t: "Span", c: [["", ["x"], []], [{t: "Str", c: "a"}]]}]}]);
});

it("preserves span structure in HTML output", async () => {
  const result = await convert([{bytes: new TextEncoder().encode('<span class="x">a</span>\n')}], {from: "markdown", to: "html"}, {});
  expect(result).toMatchObject({kind: "text", text: '<p><span class="x">a</span></p>\n'});
});


it.each([
  ['<span>*hi* [there](https://example.com)</span>', [{t: "Span", c: [["", [], []], [{t: "Emph", c: [{t: "Str", c: "hi"}]}, {t: "Space"}, {t: "Link", c: [["", [], []], [{t: "Str", c: "there"}], ["https://example.com", ""]]}]]}]],
  ['<SPAN id=x class="a b" title="a &amp; b"></SPAN>', [{t: "Span", c: [["x", ["a", "b"], [["title", "a & b"]]], []]}]],
  ['`<span>hi</span>`', [{t: "Code", c: [["", [], []], "<span>hi</span>"]}]],
  ['<spanish>hi</spanish>', [{t: "RawInline", c: ["html", "<spanish>"]}, {t: "Str", c: "hi"}, {t: "RawInline", c: ["html", "</spanish>"]}]],
  ['<span>hi', [{t: "RawInline", c: ["html", "<span>"]}, {t: "Str", c: "hi"}]],
  ['hi</span>', [{t: "Str", c: "hi"}, {t: "RawInline", c: ["html", "</span>"]}]]
])("preserves inline semantics for %s in both readers", async (source, inlines) => {
  const input = {bytes: new TextEncoder().encode(source)};
  const expected = [{t: "Para", c: inlines}];
  const result = await convert([input], {from: "markdown", to: "json"}, {});
  expect(result.kind === "text" && JSON.parse(result.text).blocks).toEqual(expected);
  let text = "";
  await convertToOutput([input], {from: "markdown", to: "json"}, {
    workingFiles: {fs: new MemoryFileSystem(), directory: "/", cacheBytes: 16384},
    output: {async write(bytes) {text += new TextDecoder().decode(bytes);}, async close() {}, async abort() {}}
  });
  expect(JSON.parse(text).blocks).toEqual(expected);
});
