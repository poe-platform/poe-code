import {expect, it} from "vitest";
import {createRequire} from "node:module";
import {dirname, join} from "node:path";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {PagedStorage} from "safe-bash-io-engine/storage";
import {BackedText} from "./backed-text.js";
import {RetainedSourceText} from "./retained-source-text.js";
import {foldRetainedYamlFlow, type YamlFoldOptions} from "./retained-yaml-fold.js";

const require = createRequire(import.meta.url);
const {foldFlowLines} = require(join(dirname(require.resolve("yaml")), "stringify/foldFlowLines.js")) as {
  foldFlowLines(text: string, indent: string, mode: string, options: {lineWidth?: number; minContentWidth?: number; indentAtStart?: number; onFold(): void; onOverflow(): void}): string;
};
async function compare(text: string, options: YamlFoldOptions, prefix = "") {
  const fs = new MemoryFileSystem(), owner = {fs, cwd: "/", env: {}, signal: new AbortController().signal};
  const input = new PagedStorage(owner, 1), scratch = new PagedStorage(owner, 1);
  const source = new RetainedSourceText(input, async () => {}), output = new BackedText(scratch, async () => {});
  await source.append([prefix, text, "outside"]);
  let maximum = 0;
  for (const store of [input, scratch]) {
    const read = store.read.bind(store), write = store.write.bind(store);
    store.read = async (offset, length) => {maximum = Math.max(maximum, length); return read(offset, length);};
    store.write = async (offset, bytes) => {maximum = Math.max(maximum, bytes.length); return write(offset, bytes);};
  }
  let folded = false, overflow = false;
  const expected = foldFlowLines(text, " ".repeat(options.indent), options.mode, {...options, onFold() {folded = true;}, onOverflow() {overflow = true;}});
  try {
    const actual = await foldRetainedYamlFlow(source, {start: prefix.length, end: prefix.length + text.length}, output, scratch, options, async () => {});
    let rendered = ""; for await (const chunk of output.chunks(actual.text)) rendered += chunk;
    expect(rendered).toBe(expected); expect(actual.folded).toBe(folded); expect(actual.overflow).toBe(overflow);
  } finally {await input.close(); await scratch.close(); expect(await fs.readdir("/")).toEqual([]); expect(maximum).toBeLessThanOrEqual(8208);}
}
it.each(["flow", "quoted"] as const)("matches YAML %s folding boundaries", async mode => {
  for (const text of ["", "word", "word ".repeat(40), "x".repeat(200), "one  two\tthree ".repeat(20), "one\n  two\n\nthree ".repeat(20), '"' + "x".repeat(200) + '"', '"' + "\\u1234".repeat(40) + '"', '"' + "\\U0001f600".repeat(40) + '"', '"' + "\\x00 ".repeat(40) + '"', " ".repeat(100) + "tail", "text" + "\t".repeat(100)]) {
    for (const lineWidth of [0, 1, 8, 40, 80]) await compare(text, {mode, indent: 2, lineWidth});
  }
});
it("preserves initial-column folding, indentation and nonzero spans", async () => {
  for (const indent of [0, 2, 20, 80, 100]) for (const indentAtStart of [0, 20, 70, 90]) {
    await compare('"' + "value ".repeat(30) + '"', {mode: "quoted", indent, indentAtStart}, "ignored\n");
    await compare("word ".repeat(30), {mode: "flow", indent, indentAtStart}, "ignored\n");
  }
});
it("matches generated escaped and whitespace-heavy input", async () => {
  let seed = 518;
  const next = (max: number) => {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max;};
  const parts = ["abc", " ", "  ", "\n", "\t", "\\n", "\\x1b", "\\u1234", "\\U0001f600", "😀", '"', "\\"];
  for (let i = 0; i < 160; i++) {
    let text = ""; for (let j = next(90); j >= 0; j--) text += parts[next(parts.length)];
    await compare(text, {mode: next(2) ? "quoted" : "flow", indent: next(12), indentAtStart: next(70), lineWidth: next(60), minContentWidth: next(25)});
  }
});
it("backs long quoted and flow fold lists", async () => {
  await compare("value ".repeat(12000), {mode: "flow", indent: 2});
  await compare('"' + "x".repeat(65536) + '"', {mode: "quoted", indent: 4});
});

it("preserves fold-index write failures and cancellation", async () => {
  for (const cancel of [false, true]) {
    const fs = new MemoryFileSystem(), owner = {fs, cwd: "/", env: {}, signal: new AbortController().signal};
    const input = new PagedStorage(owner, 1), scratch = new PagedStorage(owner, 1), source = new RetainedSourceText(input, async () => {}), output = new BackedText(scratch, async () => {});
    await source.append(["word ".repeat(100)]);
    const failure = new Error(cancel ? "cancelled" : "backing write failed");
    if (!cancel) scratch.write = async () => {throw failure;};
    try {
      await expect(foldRetainedYamlFlow(source, {start: 0, end: source.length}, output, scratch, {mode: "flow", indent: 2}, async () => {if (cancel) throw failure;})).rejects.toBe(failure);
    } finally {await input.close(); await scratch.close(); expect(await fs.readdir("/")).toEqual([]);}
  }
});
