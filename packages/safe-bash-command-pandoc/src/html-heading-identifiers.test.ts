import {expect, it} from "vitest";
import {convert} from "./engine.js";
import {createPandocCommand} from "./command.js";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";

it.each([
  ["<h2>Hello World</h2>", [["hello-world", [], []]]],
  ['<h2 id="x" class="wide" title="kept">Hello World</h2>', [["x", ["wide"], [["title", "kept"]]]]],
  ["<h1>Hello</h1><h2>Hello</h2><h3>Hello</h3>", [["hello", [], []], ["hello-1", [], []], ["hello-2", [], []]]],
  ['<h1 id="hello">First</h1><h2>Hello</h2><h3 id="hello">Explicit</h3>', [["hello", [], []], ["hello-1", [], []], ["hello", [], []]]],
  ['<h2>33. <em>Hello</em>, <a href="/url">World</a> <code>A_B.C</code>!</h2><h2>123 !!!</h2><h2>École 中文</h2>',
    [["hello-world-a_b.c", [], []], ["section", [], []], ["école-中文", [], []]]]
])("generates HTML heading identifiers for %s", async (source, expected) => {
  const result = await convert([{bytes: new TextEncoder().encode(source)}], {from: "html", to: "json"}, {});
  if (result.kind !== "text") throw new Error("Expected text");
  expect(JSON.parse(result.text).blocks.map((block: {c: [number, unknown]}) => block.c[1])).toEqual(expected);
});

it("exposes HTML heading identifiers through the public command", async () => {
  let output = "", stderr = "";
  const result = await createPandocCommand().execute({
    command: "pandoc", cwd: "/", env: {}, fs: new MemoryFileSystem(),
    args: ["-f", "html", "-t", "json"], stdin: (async function* () {yield new TextEncoder().encode("<h2>Hello World</h2>");})(),
    signal: new AbortController().signal,
    stdout: {async write(bytes) {output += new TextDecoder().decode(bytes);}},
    stderr: {async write(bytes) {stderr += new TextDecoder().decode(bytes);}}
  });
  expect(result.exitCode).toBe(0);
  expect(stderr).toBe("");
  expect(JSON.parse(output).blocks[0].c[1]).toEqual(["hello-world", [], []]);
});
