import {expect, it, vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {convert, convertToOutput, writeDocument} from "./engine.js";
import {ExecutionContext} from "./execution.js";
import type {Attr, Block, Inline} from "./ast-types.js";
const a: Attr = ["", [], []];
const s = (c: string): Inline => ({t: "Str", c});
const p = (...c: Inline[]): Block => ({t: "Para", c});
async function parity(blocks: readonly Block[]) {
  const wire = await writeDocument({blocks, metadata: {title: {t: "MetaString", c: "A & 😀 title"}}, resources: []}, {to: "json"}, {});
  if (wire.kind !== "text") throw new Error("Expected text");
  const input = {bytes: new TextEncoder().encode(wire.text)};
  const expected = await convert([input], {from: "json", to: "odt"}, {}).catch(error => error);
  const fs = new MemoryFileSystem(), working = {fs, directory: "/", cacheBytes: 16384}, chunks: Uint8Array[] = [];
  const context = {workingFiles: working, output: {async write(bytes: Uint8Array) {chunks.push(bytes.slice()); await Promise.resolve();}, async close() {}, async abort() {}}};
  const readFile = vi.spyOn(fs, "readFile").mockRejectedValue(new Error("Whole-file reads forbidden"));
  const acquire = vi.spyOn(ExecutionContext.prototype,"acquire").mockRejectedValue(new Error("Collector forbidden"));
  let actual: unknown;
  try {await convertToOutput([input],{from:"json",to:"odt"},context);}
  catch(error) {actual=error;}
  finally {try {expect(acquire).not.toHaveBeenCalled();} finally {acquire.mockRestore();}}
  expect(readFile).not.toHaveBeenCalled(); expect(await fs.readdir("/")).toEqual([]);
  if (expected instanceof Error) expect(actual).toMatchObject({code: (expected as {code?: string}).code, message: expected.message});
  else {
    expect(actual).toBeUndefined(); const result = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0)); let offset = 0;
    for (const chunk of chunks) {result.set(chunk, offset); offset += chunk.length; expect(chunk.length).toBeLessThanOrEqual(16384);}
    expect(result).toEqual(expected.bytes);
  }
}
it("preserves ODT package bytes for text, inline styles and XML escaping", async () => {
  await parity([p(s("<&> é 😀\t\n  text"), {t: "Strong", c: [{t: "Emph", c: [s("nested")]}]}, {t: "Code", c: [a, "code"]}, {t: "Link", c: [a, [s("link")], ["https://example.test?a=1&b=2", ""]]}), {t: "Header", c: [2, a, [s("heading")]]}, {t: "CodeBlock", c: [a, "code\n  x"]}, {t: "HorizontalRule"}]);
});
it("preserves sections, nested lists and paragraph styles", async () => {
  await parity([{t: "Div", c: [["named", [], []], [{t: "BlockQuote", c: [p(s("quote")), {t: "OrderedList", c: [[3, "UpperRoman", "TwoParens"], [[p(s("item")), {t: "BulletList", c: [[p(s("nested"))]]}], []]]}]}]]}]);
});
it("preserves ODT unsupported-constructor failures", async () => {await parity([p({t: "Note", c: []})]); await parity([{t: "RawBlock", c: ["html", "raw"]}]);});

it("preserves table captions, header/body/footer cells and nested serial order", async () => {
  await parity([{t: "Table", c: [a, [null, [{t: "BulletList", c: [[p(s("caption"))]]}]], [["AlignLeft", {t: "ColWidthDefault"}]], [a, [[a, [[a, "AlignDefault", 1, 1, [p(s("head"))]]]]]], [[a, 0, [], [[a, [[a, "AlignDefault", 1, 1, [p({t: "Quoted", c: ["SingleQuote", [s("cell")]]})]]]]]]], [a, [[a, [[a, "AlignDefault", 1, 1, []]]]]]]}]);
});

it("retains long text and deep list continuations with bounded output chunks", async () => {
  let block: Block = p(s("<&😀 ".repeat(16000)));
  for (let i = 0; i < 100; i++) block = {t: "BulletList", c: [[block]]};
  await parity([block]);
});
it("preserves short-only and absent captions", async () => {
  for (const caption of [null, [s("short")]] as const) await parity([{t: "Table", c: [a, [caption, []], [["AlignDefault", {t: "ColWidthDefault"}]], [a, []], [], [a, []]]}]);
});
