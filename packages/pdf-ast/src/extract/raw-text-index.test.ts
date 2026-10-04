import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import type { PdfDisplayList, PdfPlacedGlyph } from "../ast.js";
import { extractPageFromDisplayList } from "./text.js";
import { PdfRawTextIndex } from "./raw-text-index.js";
function glyph(unicode: string, x: number, y: number, extra: Partial<PdfPlacedGlyph> = {}): PdfPlacedGlyph {
  return { unicode, charCode: 65, bbox: [x, y, x + 5, y + 10], baselineY: y, advanceWidth: 5, matrix: [1, 0, 0, 1, x, y], fontSize: 10, fontName: "Helvetica", color: { r: 0, g: 0, b: 0 }, ...extra };
}
const cases = [[], [glyph("a", 0, 80), glyph("b", 5, 80), glyph("next", 25, 80), glyph("line", 0, 65)],
  [glyph("Heading", 0, 100, { fontSize: 18 }), glyph("body", 0, 80), glyph("•", 0, 60), glyph("item", 20, 60)],
  [glyph(" ", 0, 80), glyph("right", 100, 80), glyph("left", -10, 80), glyph("next", -10, 65)],
  [glyph("x", 0, 80, { actualText: "replacement", mcid: 1 }), glyph("y", 5, 80, { actualText: "replacement", mcid: 1 }), glyph("z", 10, 80)],
  [glyph("\ud83d", 0, 80), glyph("\ude00", 5, 80), glyph("日本語", 10, 80), glyph("-", 0, 65), glyph("item", 25, 65)]];
for (const [index, glyphs] of cases.entries()) it(`retains raw word/line/block geometry and text (${index})`, async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch");
  const display: PdfDisplayList = { pageIndex: 0, width: 200, height: 200, rotation: 0, glyphs, paths: [], images: [], operations: [], annotations: [] };
  const expected = extractPageFromDisplayList(display, { mode: "raw" });
  const table = await PdfRawTextIndex.create(glyphs, { fs, directory: "/scratch" });
  try {
    const blocks = [];
    for await (const block of table.blocks()) {
      const lines = [];
      for await (const line of block.lines()) {
        const words = [];
        for await (const word of line.words()) { let text = ""; for await (const chunk of word.text()) text += chunk; words.push({ text, bbox: word.bbox, fontSize: word.fontSize }); }
        lines.push({ bbox: line.bbox, baselineY: line.baselineY, words });
      }
      blocks.push({ kind: block.kind, bbox: block.bbox, lines });
    }
    expect(blocks).toEqual(expected.blocks.map(block => ({ kind: block.kind, bbox: block.bbox, lines: block.lines.map(line => ({ bbox: line.bbox, baselineY: line.baselineY, words: line.words.map(word => ({ text: word.text, bbox: word.bbox, fontSize: word.fontSize })) })) })));
  } finally { await table.close(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});

it.each([32768, 131072].flatMap(length => [false, true].map(stored => ({ length, stored }))))("stores a $length-character word with scalar external payload backing (stored=$stored)", async ({ length, stored }) => {
  const header = new Uint8Array(192), textStart = 72, textEnd = textStart + length * 2;
  let size = 0, opens = 0, closes = 0, pending = 0, peak = 0;
  const meta = (position: number) => position >= 8 && position < 72 ? position - 8 : position >= textEnd && position < textEnd + 128 ? 64 + position - textEnd : -1;
  const value = (position: number) => { const index = meta(position); return index >= 0 ? header[index]! : position >= textStart && position < textEnd ? (position % 2 ? 97 : 0) : 0; };
  const fs = {
    stat: async () => ({ type: "directory", size: 0 }), removeFileConditional: async () => {},
    async open() {
      opens++; return { capabilities: { positionedRead: true, positionedWrite: true }, stat: async () => ({ type: "file", size }), close: async () => { closes++; },
        async write(bytes: Uint8Array, position: number) {
          expect(pending).toBe(0); pending += bytes.length; peak = Math.max(peak, pending); expect(bytes.buffer.byteLength).toBeLessThanOrEqual(16384);
          for (let i = 0; i < bytes.length; i++) { const offset = position + i, index = meta(offset); if (index >= 0) header[index] = bytes[i]!; else if (bytes[i] !== value(offset)) throw new Error("unexpected payload byte"); }
          await Promise.resolve(); size = Math.max(size, position + bytes.length); pending -= bytes.length; return bytes.length;
        },
        async read(bytes: Uint8Array, position: number) { expect(bytes.length).toBeLessThanOrEqual(16384); for (let i = 0; i < bytes.length; i++) bytes[i] = value(position + i); return bytes.length; },
      };
    },
    readFile() { throw new Error("whole read forbidden"); }, writeFile() { throw new Error("whole write forbidden"); },
  } as unknown as import("@poe-code/safe-fs/contracts").FileSystem;
  async function* glyphs() {
    if (stored) yield { ...glyph("x", 0, 80), storedActualText: { position: 0, byteLength: length, storage: {
      allocate() { throw new Error("read-only"); }, async write() { throw new Error("read-only"); },
      async read(_at: number, count: number) { expect(count).toBeLessThanOrEqual(4096); return new Uint8Array(count).fill(97); }
    } } };
    else for (let at = 0; at < length; at += 32) yield glyph("a".repeat(32), at * 5, 80, { advanceWidth: 160 });
  }
  const table = await PdfRawTextIndex.create(glyphs(), { fs, directory: "/external" });
  try {
    let chars = 0, words = 0;
    for await (const block of table.blocks()) for await (const line of block.lines()) for await (const word of line.words()) {
      words++; for await (const text of word.text()) { expect(text.length).toBeLessThanOrEqual(2049); expect([...text].every(char => char === "a")).toBe(true); chars += text.length; await Promise.resolve(); }
    }
    expect(words).toBe(1); expect(chars).toBe(length); expect(peak).toBeLessThanOrEqual(16384); expect(opens).toBe(1);
  } finally { await table.close(); }
  expect(closes).toBe(1);
});

it("admits storage and counters before allocation, and closes a failing producer", async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); let pulled = false, closed = false;
  async function* input() { try { pulled = true; yield glyph("first", 0, 80); yield glyph("second", 30, 80); } finally { closed = true; } }
  await expect(PdfRawTextIndex.create(input(), { fs, directory: "/scratch" }, { maxWorkingBytes: 1 })).rejects.toThrow("limit"); expect(pulled).toBe(false);
  for (const limits of [{ maxStorageBytes: 1 }, { maxWords: 1 }, { maxLines: 0 }, { maxBlocks: 0 }]) {
    closed = false; await expect(PdfRawTextIndex.create(input(), { fs, directory: "/scratch" }, limits)).rejects.toThrow("limit"); expect(closed).toBe(true);
  }
  expect(await fs.readdir("/scratch")).toEqual([]);
});
it.each([false, true])("yields to cancellation and retires its producer (ActualText=%s)", async actualText => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); const controller = new AbortController(), reason = new Error("cancel text index"); let closed = false, produced = 0;
  async function* input() { try { for (let i = 0; i < 10000; i++) { produced++; yield glyph("a", i * 5, 80, actualText ? { actualText: "merged", mcid: 1 } : {}); } } finally { closed = true; } }
  const timer = setTimeout(() => controller.abort(reason), 0);
  try { await expect(PdfRawTextIndex.create(input(), { fs, directory: "/scratch" }, { signal: controller.signal })).rejects.toBe(reason); }
  finally { clearTimeout(timer); }
  expect(produced).toBeLessThan(10000); expect(closed).toBe(true); expect(await fs.readdir("/scratch")).toEqual([]);
});
it("owns reused glyph geometry and preserves string boundaries", async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch");
  const box: [number, number, number, number] = [0, 80, 5, 90];
  const reused = glyph("a".repeat(2047) + "\ud83d", 0, 80, { bbox: box });
  async function* input() { yield reused; box[0] = 500; yield glyph("\ude00\ud800", 5, 80); }
  const table = await PdfRawTextIndex.create(input(), { fs, directory: "/scratch" });
  let saved: import("./raw-text-index.js").PdfStoredTextWord | undefined;
  for await (const block of table.blocks()) for await (const line of block.lines()) for await (const word of line.words()) saved = word;
  let text = ""; for await (const part of saved!.text()) text += part;
  expect(text).toBe("a".repeat(2047) + "😀\ud800"); expect(saved!.bbox[0]).toBe(0);
  await table.close(); await expect(saved!.text().next()).rejects.toThrow("closed"); expect(await fs.readdir("/scratch")).toEqual([]);
});

it("replays many linked records after spilling and cancels an active traversal", async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); const controller = new AbortController(), reason = new Error("cancel traversal");
  async function* input() { for (let i = 0; i < 1500; i++) yield glyph(String(i), 0, 30000 - i * 20, { fontSize: 18 }); }
  const table = await PdfRawTextIndex.create(input(), { fs, directory: "/scratch" }, { signal: controller.signal });
  try {
    let index = 0;
    for await (const block of table.blocks()) for await (const line of block.lines()) for await (const word of line.words()) {
      let text = ""; for await (const part of word.text()) text += part; expect(text).toBe(String(index++)); expect(block.kind).toBe("heading");
    }
    expect(index).toBe(1500);
    const timer = setTimeout(() => controller.abort(reason), 0); let visited = 0;
    try { await expect((async () => { for await (const ignored of table.blocks()) { void ignored; visited++; } })()).rejects.toBe(reason); }
    finally { clearTimeout(timer); }
    expect(visited).toBeLessThan(1500);
  } finally { await table.close(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});
it("preserves backing failures and closes a suspended glyph producer", async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); const reason = new Error("backing write failed"); let closed = false, closes = 0;
  const guarded = new Proxy(fs, { get(target, key) {
    if (key === "open") return async (...args: Parameters<NonNullable<typeof fs.open>>) => {
      const descriptor = await fs.open!(...args);
      return new Proxy(descriptor, { get(owner, property) {
        if (property === "write") return async () => { throw reason; };
        if (property === "close") return async (...args: Parameters<typeof descriptor.close>) => { closes++; return descriptor.close(...args); };
        const value = Reflect.get(owner, property); return typeof value === "function" ? value.bind(owner) : value;
      } });
    };
    const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
  } });
  async function* input() { try { for (let i = 0; i < 10000; i++) yield glyph("a".repeat(32), i * 160, 80, { advanceWidth: 160 }); } finally { closed = true; } }
  await expect(PdfRawTextIndex.create(input(), { fs: guarded, directory: "/scratch" })).rejects.toBe(reason);
  expect(closed).toBe(true); expect(closes).toBe(1); expect(await fs.readdir("/scratch")).toEqual([]);
});

it.each(["build", "read"])("cancels a large single word during %s", async phase => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch");
  const controller = new AbortController(), reason = new Error("cancel large word");
  const input = [glyph("a".repeat(1024 * 1024), 0, 80)];
  let table: PdfRawTextIndex | undefined;
  if (phase === "read") table = await PdfRawTextIndex.create(input, { fs, directory: "/scratch" }, { signal: controller.signal });
  const timer = setTimeout(() => controller.abort(reason), 0);
  try {
    await expect((async () => {
      if (phase === "build") table = await PdfRawTextIndex.create(input, { fs, directory: "/scratch" }, { signal: controller.signal });
      else for await (const block of table!.blocks()) for await (const line of block.lines()) for await (const word of line.words()) for await (const chunk of word.text()) void chunk;
    })()).rejects.toBe(reason);
  } finally { clearTimeout(timer); await table?.close(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});


it.each(["replacement", " ", "\t", "", "• item", "a".repeat(8192)])("streams caller-backed ActualText with normal run grouping (%#. test)", async replacement => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch");
  const bytes = new TextEncoder().encode("\ufeff" + replacement);
  const storage = {
    allocate() { throw new Error("source is read-only"); },
    async write() { throw new Error("source is read-only"); },
    async read(at: number, length: number) { expect(length).toBeLessThanOrEqual(4096); return bytes.slice(at, at + length); }
  };
  const input = [
    { ...glyph("x", 0, 80, { mcid: 1 }), storedActualText: { storage, position: 0, byteLength: bytes.length } },
    glyph("y", 5, 80, { actualText: replacement, mcid: 1 }),
    glyph("z", 10, 80)
  ];
  const expected = await PdfRawTextIndex.create(input.map(g => ({ ...g, actualText: "storedActualText" in g ? replacement : g.actualText })), { fs, directory: "/scratch" });
  const actual = await PdfRawTextIndex.create(input, { fs, directory: "/scratch" });
  async function collect(table: PdfRawTextIndex) {
    const result = [];
    for await (const block of table.blocks()) for await (const line of block.lines()) for await (const word of line.words()) {
      let text = ""; for await (const part of word.text()) text += part;
      result.push({ text, bbox: word.bbox, kind: block.kind, baseline: line.baselineY });
    }
    return result;
  }
  try { expect(await collect(actual)).toEqual(await collect(expected)); }
  finally { await actual.close(); await expected.close(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});


it.each(["failure", "cancel", "budget"])("cleans up stored ActualText on %s", async mode => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch");
  const controller = new AbortController(), reason = new Error("source unavailable"); let closed = false, reads = 0;
  const storage = { allocate() { throw reason; }, async write() { throw reason; }, async read() {
    reads++; if (mode === "cancel") controller.abort(reason); throw reason;
  } };
  async function* input() { try { yield { ...glyph("x", 0, 80), storedActualText: { storage, position: 0, byteLength: 100000 } }; yield glyph("z", 5, 80); } finally { closed = true; } }
  const work = PdfRawTextIndex.create(input(), { fs, directory: "/scratch" }, { signal: controller.signal, ...(mode === "budget" ? { maxWorkingBytes: 81920 } : {}) });
  if (mode === "budget") { await expect(work).rejects.toThrow("working byte limit"); expect(reads).toBe(0); }
  else { await expect(work).rejects.toBe(reason); expect(reads).toBe(1); }
  expect(closed).toBe(true); expect(await fs.readdir("/scratch")).toEqual([]);
});

it("compares different stored encodings by decoded content with borrowed byte buffers", async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch");
  const replacement = "😀abc".repeat(1000);
  const utf8 = new TextEncoder().encode("\ufeff" + replacement), utf16 = new Uint8Array(2 + replacement.length * 2);
  utf16.set([254, 255]); const view = new DataView(utf16.buffer);
  for (let i = 0; i < replacement.length; i++) view.setUint16(2 + i * 2, replacement.charCodeAt(i));
  const borrowed = new Uint8Array(4096);
  const storage = { allocate() { throw new Error("read-only"); }, async write() { throw new Error("read-only"); }, async read(at: number, length: number) {
    const bytes = at >= 100000 ? utf16 : utf8, offset = at >= 100000 ? at - 100000 : at;
    borrowed.fill(0); borrowed.set(bytes.subarray(offset, offset + length)); return borrowed.subarray(0, length);
  } };
  const table = await PdfRawTextIndex.create([
    { ...glyph("x", 0, 80), storedActualText: { storage, position: 0, byteLength: utf8.length } },
    { ...glyph("y", 5, 80), storedActualText: { storage, position: 100000, byteLength: utf16.length } }
  ], { fs, directory: "/scratch" });
  try {
    let text = "", words = 0;
    for await (const block of table.blocks()) for await (const line of block.lines()) for await (const word of line.words()) {
      words++; expect(word.bbox).toEqual([0, 80, 10, 90]); for await (const part of word.text()) text += part;
    }
    expect(words).toBe(1); expect(text).toBe(replacement);
  } finally { await table.close(); }
});


it.each([["a", "ab", 1, "aab"], ["ab", "a", 1, "aba"], ["same", "same", 2, "samesame"]] as const)("keeps distinct replacement runs (%#)", async (left, right, mcid, expected) => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch");
  const stored = (text: string) => {
    const bytes = new TextEncoder().encode(text);
    return { position: 0, byteLength: bytes.length, storage: {
      allocate() { throw new Error("read-only"); }, async write() { throw new Error("read-only"); },
      async read(at: number, length: number) { return bytes.slice(at, at + length); }
    } };
  };
  const table = await PdfRawTextIndex.create([
    { ...glyph("x", 0, 80, { mcid: 1 }), storedActualText: stored(left) },
    { ...glyph("y", 5, 80, { mcid }), storedActualText: stored(right) }
  ], { fs, directory: "/scratch" });
  try {
    let text = "";
    for await (const block of table.blocks()) for await (const line of block.lines()) for await (const word of line.words()) for await (const part of word.text()) text += part;
    expect(text).toBe(expected);
  } finally { await table.close(); }
});


it("reads a shared stored replacement once for a long glyph run", async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); let reads = 0;
  const storedActualText = { position: 0, byteLength: 100000, storage: {
    allocate() { throw new Error("read-only"); }, async write() { throw new Error("read-only"); },
    async read(_at: number, length: number) { reads++; return new Uint8Array(length).fill(65); }
  } };
  const table = await PdfRawTextIndex.create(Array.from({ length: 100 }, (_, x) => ({ ...glyph("x", x * 5, 80), storedActualText: { ...storedActualText } })), { fs, directory: "/scratch" });
  try {
    let length = 0;
    for await (const block of table.blocks()) for await (const line of block.lines()) for await (const word of line.words()) for await (const part of word.text()) length += part.length;
    expect(length).toBe(100000); expect(reads).toBe(Math.ceil(100000 / 4096));
  } finally { await table.close(); }
});
