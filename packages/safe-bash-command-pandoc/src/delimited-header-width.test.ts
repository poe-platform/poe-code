import {expect, it} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {convert, convertToOutput} from "./engine.js";

const encoder = new TextEncoder();
// Native Pandoc 3.10.1: -f csv (or tsv) -t json for a,b\n1,2,3\n.
const attr = ["", [], []];
const row = (...values: string[]) => [attr, values.map(c =>
  [attr, {t: "AlignDefault"}, 1, 1, c ? [{t: "Plain", c: [{t: "Str", c}]}] : []])];
const expected = {
  "pandoc-api-version": [1, 23, 1, 2], meta: {}, blocks: [{t: "Table", c: [
    attr, [null, []], Array.from({length: 2}, () => [{t: "AlignDefault"}, {t: "ColWidthDefault"}]),
    [attr, [row("a", "b")]], [[attr, 0, [], [row("1", "2"), row("4", "")]]], [attr, []]
  ]}]
};

it.each(["csv", "tsv"])("keeps the native header width in buffered and retained %s output", async from => {
  const delimiter = from === "csv" ? "," : "\t";
  const text = from === "csv" ? 'a,b\n1,2,"ignored,\n""quoted"""\n4\n' : "a\tb\n1\t2\tignored\n4\n";
  const inputs = [{chunks: Array.from(encoder.encode(text), byte => Uint8Array.of(byte))}];
  for (const to of ["json", "plain", "html5"]) {
    const buffered = await convert(inputs, {from, to}, {});
    expect(buffered.kind).toBe("text");
    if (buffered.kind !== "text") throw new Error("Expected text output");
    if (to === "json") expect(JSON.parse(buffered.text)).toEqual(expected);
    expect(buffered.text).not.toContain("ignored");
    let retained = "";
    const fs = new MemoryFileSystem();
    await convertToOutput(inputs, {from, to}, {
      workingFiles: {fs, directory: "/", cacheBytes: 16384},
      output: {async write(bytes) {retained += new TextDecoder().decode(bytes);}, async close() {}, async abort() {}}
    });
    if (to === "json") expect(JSON.parse(retained)).toEqual(expected);
    else expect(retained).toBe(buffered.text);
    expect(await fs.readdir("/")).toEqual([]);
  }
  const simple = await convert([{bytes: encoder.encode(`a${delimiter}b\n1${delimiter}2${delimiter}3\n4\n`)}], {from, to: "json"}, {});
  expect(simple.kind === "text" && JSON.parse(simple.text)).toEqual(expected);
});

it.each(['a,b\n1,2,"unterminated', 'a,b\n1,2,"closed"junk'])("validates discarded CSV fields: %s", async text => {
  const inputs = [{bytes: encoder.encode(text)}];
  await expect(convert(inputs, {from: "csv", to: "json"}, {})).rejects.toMatchObject({code: "E_PARSE"});
  await expect(convertToOutput(inputs, {from: "csv", to: "json"}, {
    workingFiles: {fs: new MemoryFileSystem(), directory: "/", cacheBytes: 16384},
    output: {async write() {throw new Error("Invalid input must not publish output");}, async close() {}, async abort() {}}
  })).rejects.toMatchObject({code: "E_PARSE"});
});
