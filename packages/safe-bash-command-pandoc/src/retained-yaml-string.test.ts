import {expect, it} from "vitest";
import {createRequire} from "node:module";
import {dirname, join} from "node:path";
import {Document} from "yaml";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {PagedStorage} from "safe-bash-io-engine/storage";
import {BackedText} from "./backed-text.js";
import {RetainedSourceText} from "./retained-source-text.js";
import {renderRetainedYamlFlowString, type YamlFlowStringOptions} from "./retained-yaml-string.js";

const require = createRequire(import.meta.url), directory = dirname(require.resolve("yaml"));
const {createStringifyContext} = require(join(directory, "stringify/stringify.js")) as {createStringifyContext(doc: Document, options: Record<string, unknown>): Record<string, unknown>};
const {stringifyString} = require(join(directory, "stringify/stringifyString.js")) as {stringifyString(value: {value: string; type: string}, ctx: Record<string, unknown>): string};
const types = {plain: "PLAIN", single: "QUOTE_SINGLE", double: "QUOTE_DOUBLE", block: "BLOCK_LITERAL"};
async function compare(value: string, options: YamlFlowStringOptions) {
  const ctx = Object.assign(createStringifyContext(new Document(), {}), {inFlow: true, actualString: true, indent: " ".repeat(options.indent), implicitKey: !!options.implicitKey, indentAtStart: options.indentAtStart});
  const expected = stringifyString({value, type: types[options.style]}, ctx);
  const fs = new MemoryFileSystem(), owner = {fs, cwd: "/", env: {}, signal: new AbortController().signal};
  const input = new PagedStorage(owner, 1), scratch = new PagedStorage(owner, 1), source = new RetainedSourceText(input, async () => {}), output = new BackedText(scratch, async () => {});
  await source.append(["ignored\n", value, "outside"]);
  let maximum = 0;
  for (const store of [input, scratch]) {
    const read = store.read.bind(store), write = store.write.bind(store);
    store.read = async (offset, length) => {maximum = Math.max(maximum, length); return read(offset, length);};
    store.write = async (offset, bytes) => {maximum = Math.max(maximum, bytes.length); return write(offset, bytes);};
  }
  try {
    const result = await renderRetainedYamlFlowString(source, {start: 8, end: 8 + value.length}, output, scratch, options, async () => {});
    let actual = ""; for await (const chunk of output.chunks(result)) actual += chunk;
    expect(actual).toBe(expected);
  } finally {await input.close(); await scratch.close(); expect(await fs.readdir("/")).toEqual([]); expect(maximum).toBeLessThanOrEqual(8208);}
}
const values = ["", "word", "null", "true", "12", "-.Inf", "0xFF", "1.2e5", "~", "a:b", "a: b", "x,y", "?", "-", "?word", "-word", "@text", "word:", "#comment", "---marker", "line\n%marker", "line\n...marker", " leading", "trailing ", "one\ntwo", "one\n\ntwo\n", "one \ntwo", "one\n two", "'single'", '"double"', `both'"`, "\\n", "\ttext\t", "\0\x07\x0b\x1b\x1f", "\r\b\f", "\x7f\x85\xa0\u2028\u2029", "\ud800", "\udfff", "😀", "word ".repeat(40), "x".repeat(200), "long ".repeat(10) + "\n\nlast\n", "long ".repeat(10) + "\n ", " ".repeat(100)];
it.each(["plain", "single", "double", "block"] as const)("preserves %s flow string presentation", async style => {
  for (const value of values) for (const implicitKey of [false, true]) await compare(value, {style, implicitKey, indent: 4});
});
it("preserves indent and current column when folding quoted scalars", async () => {
  for (const indent of [2, 20, 80, 100]) for (const indentAtStart of [0, 40, 79, 120]) {
    await compare("one ".repeat(40) + "\n next\n", {style: "double", indent, indentAtStart});
    await compare("a 'quote' ".repeat(30), {style: "single", indent, indentAtStart});
  }
});
it("renders large values and indentation without full-payload strings", async () => {
  for (const style of ["plain", "single", "double", "block"] as const) await compare("value \n".repeat(8192), {style, indent: 2});
});

it("recognizes document markers after Unicode line separators", async () => {
  for (const line of ["\u2028", "\u2029"]) for (const marker of ["%directive", "---marker", "...marker"]) await compare("text" + line + marker, {style: "plain", indent: 2, implicitKey: true});
});
it("matches generated quoting and control-character combinations", async () => {
  let seed = 1843;
  const next = (max: number) => {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max;};
  const styles = ["plain", "single", "double", "block"] as const;
  const parts = ["text", " ", "\t", "\n", "\n\n", "'", '"', "\\", "\0", "\u2028", "\ud800", "😀", "null", ":", "[", "%", "---"];
  for (let index = 0; index < 160; index++) {
    let value = ""; for (let left = next(60); left >= 0; left--) value += parts[next(parts.length)];
    await compare(value, {style: styles[next(4)]!, indent: [2, 4, 80][next(3)]!, implicitKey: !!next(2), indentAtStart: next(90)});
  }
});

it("preserves cancellation and backing-error identity during formatting", async () => {
  for (const phase of ["read", "append", "output", "cooperate"] as const) {
    const fs = new MemoryFileSystem(), owner = {fs, cwd: "/", env: {}, signal: new AbortController().signal};
    const input = new PagedStorage(owner, 1), scratch = new PagedStorage(owner, 1), source = new RetainedSourceText(input, async () => {}), output = new BackedText(scratch, async () => {});
    await source.append(["word ".repeat(100)]);
    const failure = new Error(phase), selected = {start: 0, end: source.length};
    if (phase === "read") source.unit = async () => {throw failure;};
    if (phase === "append") source.append = async () => {throw failure;};
    if (phase === "output") output.from = async () => {throw failure;};
    try {
      await expect(renderRetainedYamlFlowString(source, selected, output, scratch, {style: "double", indent: 2}, async () => {if (phase === "cooperate") throw failure;})).rejects.toBe(failure);
    } finally {await input.close(); await scratch.close(); expect(await fs.readdir("/")).toEqual([]);}
  }
});
