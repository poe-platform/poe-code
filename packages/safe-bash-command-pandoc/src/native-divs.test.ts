import type {Block} from "./ast-types.js";
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

const paragraph: Block = {t: "Para", c: [{t: "Str", c: "Inner"}, {t: "Space"}, {t: "Emph", c: [{t: "Str", c: "em"}]}, {t: "Str", c: "."}]};
const multiline = '<div id="box">\n\nInner *em*.\n\n</div>\n';
it.each<[string, Block[]]>([
  [multiline, [{t: "Div", c: [["box", [], []], [paragraph]]}]],
  ['<div class="outer">\n\n' + multiline + '\n</div>\n\nAfter.\n', [
    {t: "Div", c: [["", ["outer"], []], [{t: "Div", c: [["box", [], []], [paragraph]]}]]},
    {t: "Para", c: [{t: "Str", c: "After."}]}
  ]]
])("keeps multiline native div Markdown nested: %s", async (source, expected) => {
  const input = {bytes: new TextEncoder().encode(source)};
  const result = await convert([input], {from: "markdown", to: "json"}, {});
  expect(result.kind === "text" && JSON.parse(result.text).blocks).toEqual(expected);
  let text = "";
  const resultCode = await createStandalonePandocCommand().execute({
    args: ["-f", "markdown", "-t", "json"], stdin: [input.bytes],
    stdout: {async write(bytes) {text += new TextDecoder().decode(bytes);}},
    stderr: {async write() {}}, signal: new AbortController().signal
  });
  expect(resultCode).toEqual({exitCode: 0});
  expect(JSON.parse(text).blocks).toEqual(expected);
});

it("renders multiline native div Markdown inside the HTML container", async () => {
  const result = await convert([{bytes: new TextEncoder().encode(multiline)}], {from: "markdown", to: "html"}, {});
  expect(result).toMatchObject({kind: "text", text: '<div id="box"><p>Inner <em>em</em>.</p>\n</div>\n'});
});

it.each(["markdown", "gfm+native_divs"])("preserves native containers around code and lists with %s", async from => {
  const source = '<DIV id="box" title="a > b">\n\n```html\n</div>\n```\n\n- *item*\n\n</DIV>\n\nTail\n';
  const expected = [
    {t: "Div", c: [["box", [], [["title", "a > b"]]], [
      {t: "CodeBlock", c: [["", ["html"], []], "</div>"]},
      {t: "BulletList", c: [[{t: "Plain", c: [{t: "Emph", c: [{t: "Str", c: "item"}]}]}]]}
    ]]}, {t: "Para", c: [{t: "Str", c: "Tail"}]}
  ];
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

it.each(["markdown-native_divs", "gfm", "commonmark"])("leaves multiline divs raw with %s", async from => {
  const input = {bytes: new TextEncoder().encode(multiline)};
  const result = await convert([input], {from, to: "json"}, {});
  expect(result.kind === "text" && JSON.parse(result.text).blocks).toEqual([
    {t: "RawBlock", c: ["html", '<div id="box">\n']}, paragraph, {t: "RawBlock", c: ["html", "</div>\n"]}
  ]);
});

it("streams multiline native div HTML through the public command", async () => {
  let text = "";
  const result = await createStandalonePandocCommand().execute({
    args: ["-f", "markdown", "-t", "html"], stdin: [new TextEncoder().encode(multiline)],
    stdout: {async write(bytes) {text += new TextDecoder().decode(bytes);}},
    stderr: {async write() {}}, signal: new AbortController().signal
  });
  expect(result).toEqual({exitCode: 0});
  expect(text).toBe('<div id="box"><p>Inner <em>em</em>.</p>\n</div>\n');
});
