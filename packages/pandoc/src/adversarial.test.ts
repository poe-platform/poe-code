import { expect, it, vi } from "vitest";
import { Volume } from "memfs";
import { convert, createFormatRegistry, readDocument, writeDocument } from "./index.js";
import { createExecutionContext } from "./execution.js";
import type { Document, Limits } from "./types.js";
import type { Attr, Cell, Row } from "./ast-types.js";

const encode = (text: string) => new TextEncoder().encode(text);
const immediate = async () => {};
const attr: Attr = ["", [], []];
const document = (text: string): Document => ({
  blocks: [{ t: "Para", c: [{ t: "Str", c: text }] }], metadata: {}, resources: []
});

// Fixed xorshift32, bounded chunk sizes, and a single reused producer buffer.
function* chunks(bytes: Uint8Array, seed: number): Generator<Uint8Array> {
  const buffer = new Uint8Array(17);
  for (let offset = 0; offset < bytes.length;) {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    const count = Math.min(1 + (seed >>> 0) % buffer.length, bytes.length - offset);
    buffer.fill(0);
    buffer.set(bytes.subarray(offset, offset + count));
    yield buffer.subarray(0, count);
    offset += count;
  }
  buffer.fill(255);
}

it.each([1, 0x12345678, 0x6d2b79f5])("owns randomized reused buffers at seed %s", async seed => {
  const bytes = encode("é𐀀\r\n" + "[dangling] *original* ".repeat(16));
  const expected = await convert([{ bytes }], { from: "commonmark", to: "html" }, { yield: immediate });
  expect(await convert([{ chunks: chunks(bytes, seed) }], { from: "commonmark", to: "html" }, { yield: immediate }))
    .toEqual(expected);
});

const limits: readonly [string, string, Partial<Limits>, string][] = [
  ["commonmark", "*".repeat(1024) + "x" + "*".repeat(1024), { work: 512 }, "work"],
  ["commonmark", "[".repeat(1024) + "dangling" + "]".repeat(1024), { work: 512 }, "work"],
  ["commonmark", Array.from({ length: 16 }, (_, i) => "  ".repeat(i) + "- nested").join("\n"), { depth: 4 }, "depth"],
  ["html", "<div>".repeat(16) + "x" + "</div>".repeat(16), { depth: 4 }, "depth"],
  ["html", '<p ' + Array.from({ length: 16 }, (_, i) => `data-x${i}="value"`).join(" ") + '>x</p>', { attributes: 4 }, "attributes"],
  ["html", '<p title="' + "a".repeat(1024) + '">x</p>', { text: 128 }, "text"],
  ["html", '<p>' + "&amp;".repeat(256) + '</p>', { entities: 4 }, "entities"],
  ["json", "[".repeat(16) + "0" + "]".repeat(16), { depth: 4 }, "depth"],
  ["latex", "{".repeat(16) + "x" + "}".repeat(16), { depth: 4 }, "depth"],
  ["rtf", "{\\rtf1 " + "{".repeat(16) + "x" + "}".repeat(17), { depth: 4 }, "depth"],
  ["rst", "[".repeat(256) + "x", { work: 512 }, "work"],
  ["rst", "x ".repeat(16), { nodes: 4 }, "nodes"]
];
it.each(limits)("bounds direct %s parser growth %#", async (from, text, limits, budget) => {
  const selection = createFormatRegistry().resolve(from, "read");
  const context = createExecutionContext("read", { limits, yield: immediate });
  await expect(selection.reader!.read({ bytes: encode(text), text }, context, selection))
    .rejects.toMatchObject({ code: "E_LIMIT", message: expect.stringContaining(budget) });
  await context.close();
});

it.each(["commonmark", "gfm", "html", "json", "latex", "rst", "rtf"])(
  "cancels in the direct %s parser at a cooperative checkpoint", async from => {
    const controller = new AbortController();
    const text = from === "html" ? '<p>' + "x ".repeat(1024) + '</p>'
      : from === "json" ? JSON.stringify({ "pandoc-api-version": [1,23,1,2], meta: {}, blocks: document("x ".repeat(1024)).blocks })
      : from === "rtf" ? '{\\rtf1 ' + "x ".repeat(1024) + '}' : "x ".repeat(1024);
    const yieldTurn = vi.fn(async () => { controller.abort(); });
    const context = createExecutionContext("read", { signal: controller.signal, yield: yieldTurn });
    const selection = createFormatRegistry().resolve(from, "read");
    await expect(selection.reader!.read({ bytes: encode(text), text }, context, selection))
      .rejects.toMatchObject({ code: "E_CANCELLED" });
    expect(yieldTurn).toHaveBeenCalledTimes(1);
    await context.close();
    // The injected scheduler has returned and the parser promise has rejected;
    // no Promise.race timeout is used as a claim that CPU execution stopped.
  }
);

it.each([
  ["latex", String.raw`\newcommand{\a}{\b}\newcommand{\b}{\a}\a`, "E_LIMIT"],
  ["rst", "|a|\n\n.. |a| replace:: |b|\n.. |b| replace:: |a|", "E_LIMIT"],
  ["latex", String.raw`\ref{unresolved}`, "E_CAPABILITY"],
  ["rtf", String.raw`{\rtf1 unbalanced`, "E_PARSE"],
  ["rtf", String.raw`{\rtf1\bin2147483647 x}`, "E_PARSE"]
])("rejects original %s cycles or malformed declarations %# without publication", async (from, text, code) => {
  const publish = vi.fn(immediate);
  await expect(convert([{ bytes: encode(text) }], { from, to: "plain" }, { output: { publish }, yield: immediate }))
    .rejects.toMatchObject({ code });
  expect(publish).not.toHaveBeenCalled();
});

it.each(["latex", "rst"])("rejects aliased two-file %s include cycles in memfs", async from => {
  const include = (id: string) => from === "latex" ? `\\input{${id}}` : `.. include:: ${id}`;
  const volume = Volume.fromJSON({
    [`/book/a.${from === "latex" ? "tex" : "rst"}`]: include(`./b.${from === "latex" ? "tex" : "rst"}`),
    [`/book/b.${from === "latex" ? "tex" : "rst"}`]: include(`./a.${from === "latex" ? "tex" : "rst"}`)
  });
  const resolve = vi.fn(async (id: string, base: string | undefined) => new Uint8Array(volume.readFileSync(`${base}/${id}`) as Buffer));
  const publish = vi.fn(immediate);
  await expect(convert([{ bytes: encode(include(`a.${from === "latex" ? "tex" : "rst"}`)), base: "/book" }], { from, to: "plain" },
    { resources: { resolve }, output: { publish }, yield: immediate }))
    .rejects.toMatchObject({ code: "E_LIMIT" });
  expect(resolve.mock.calls.length).toBeLessThanOrEqual(3);
  expect(publish).not.toHaveBeenCalled();
});

it("preserves RTF code-page transitions and rejects incomplete UTF-8 at a transition", async () => {
  const source = String.raw`{\rtf1\ansicpg1252 \'80{\ansicpg65001 \'f0\'9f\'98\'80}\'80}`;
  expect((await readDocument({ bytes: encode(source) }, { from: "rtf" }, { yield: immediate })).blocks)
    .toEqual(document("€😀€").blocks);
  const publish = vi.fn(immediate);
  await expect(convert([{ bytes: encode(String.raw`{\rtf1\ansicpg65001 \'c3\ansicpg1252 \'80}`) }],
    { from: "rtf", to: "plain" }, { output: { publish }, yield: immediate })).rejects.toMatchObject({ code: "E_ENCODING" });
  expect(publish).not.toHaveBeenCalled();
});

it("admits sparse occupancy and refuses overlarge span multiplication before writing", async () => {
  const cell = (rs: number, cs: number): Cell => [attr, "AlignDefault", rs, cs, []];
  const table = (rs: number, cs: number): Document => ({ blocks: [{ t: "Table", c: [attr, [null, []],
    [["AlignDefault", { t: "ColWidthDefault" }]], [attr, []],
    [[attr, 0, [], [[attr, [cell(rs, cs)]], ...Array.from({ length: 7 }, (): Row => [attr, []])]]], [attr, []]] }], metadata: {}, resources: [] });
  expect((await writeDocument(table(8, 1), { to: "json" }, { yield: immediate })).kind).toBe("text");
  const publish = vi.fn(immediate);
  await expect(writeDocument(table(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER), { to: "html" }, { output: { publish }, yield: immediate }))
    .rejects.toMatchObject({ code: "E_LIMIT" });
  expect(publish).not.toHaveBeenCalled();
});

it("refuses escaping expansion before publication", async () => {
  const publish = vi.fn(immediate);
  await expect(writeDocument(document("<&".repeat(128)), { to: "html" },
    { limits: { outputBytes: 256 }, output: { publish }, yield: immediate })).rejects.toMatchObject({ code: "E_LIMIT" });
  expect(publish).not.toHaveBeenCalled();
});

it.each([1, 0x12345678])("rejects malformed UTF-8 at randomized reused-buffer boundaries %s", async seed => {
  for (const bytes of [Uint8Array.of(0xf0,0x90,0x80), Uint8Array.of(0xed,0xa0,0x80), Uint8Array.of(0xe2,0x28,0xa1)]) {
    const publish = vi.fn(immediate);
    await expect(convert([{ chunks: chunks(bytes, seed) }], { from: "commonmark", to: "plain" },
      { output: { publish }, yield: immediate })).rejects.toMatchObject({ code: "E_ENCODING" });
    expect(publish).not.toHaveBeenCalled();
  }
});
