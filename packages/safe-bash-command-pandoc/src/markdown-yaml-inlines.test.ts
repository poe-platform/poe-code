import {expect, it} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {convert, convertToOutput} from "./engine.js";
import {createPandocCommand} from "./command.js";

const markdown = "---\ntitle: Hello *world*\nauthor: Bob\nvalues: [ '**bold**', {label: '`code`'} ]\nnumber: 12\nflag: true\n---\n\nBody.\n";
const str = (c: string) => ({t: "Str", c});
const inlines = (...c: unknown[]) => ({t: "MetaInlines", c});
const expected = {
  title: inlines(str("Hello"), {t: "Space"}, {t: "Emph", c: [str("world")]}),
  author: inlines(str("Bob")),
  values: {t: "MetaList", c: [inlines({t: "Strong", c: [str("bold")]}), {t: "MetaMap", c: {label: inlines({t: "Code", c: [["", [], []], "code"]})}}]},
  number: {t: "MetaString", c: "12"}, flag: {t: "MetaBool", c: true}
};
for (const retained of [false, true]) it(`parses YAML strings as Markdown inlines (retained=${retained})`, async () => {
  const inputs = [{bytes: new TextEncoder().encode(markdown)}];
  let output = "";
  if (retained) await convertToOutput(inputs, {from: "markdown", to: "json"}, {
    workingFiles: {fs: new MemoryFileSystem(), directory: "/", cacheBytes: 16384},
    output: {async write(bytes) {output += new TextDecoder().decode(bytes);}, async close() {}, async abort() {}}
  });
  else {
    const result = await convert(inputs, {from: "markdown", to: "json"}, {});
    if (result.kind !== "text") throw new Error("Expected text");
    output = result.text;
  }
  expect(JSON.parse(output).meta).toEqual(expected);
});
it("parses YAML formatting through the public command", async () => {
  let output = "", stderr = "";
  const result = await createPandocCommand().execute({
    command: "pandoc", cwd: "/", env: {}, fs: new MemoryFileSystem(),
    args: ["-f", "markdown", "-t", "json"], stdin: (async function* () {yield new TextEncoder().encode(markdown);})(),
    signal: new AbortController().signal,
    stdout: {async write(bytes) {output += new TextDecoder().decode(bytes);}},
    stderr: {async write(bytes) {stderr += new TextDecoder().decode(bytes);}}
  });
  expect(result.exitCode).toBe(0); expect(stderr).toBe("");
  expect(JSON.parse(output).meta).toEqual(expected);
});
