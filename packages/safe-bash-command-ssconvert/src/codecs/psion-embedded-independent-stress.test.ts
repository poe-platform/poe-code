import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { readPsion } from "./psion.js";
import { psionFixture } from "./psion-fixture.test-support.js";
const context: CapabilityContext = { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 2000000, outputBytes: 10000, cells: 100, sheets: 4, operations: 500000 } };
const dword = (n: number) => [n & 255, n >>> 8 & 255, n >>> 16 & 255, n >>> 24];
const text = (s: string) => [s.length * 4 + 2, ...Array.from(s, ch => ch.charCodeAt(0))];
function plainPage(): number[] { return [...dword(1), ...Array<number>(36).fill(0), ...dword(0x100000fd), ...dword(11906), ...dword(16838), 0]; }
function body(layout: number): number[] { return [...dword(0x1000005c), ...dword(0x10000066), ...dword(layout), ...dword(0x10000064), 4, 72, 6]; }
function layout(object: number): number[] { return [0, 0, 0, ...dword(1), ...dword(2), 0, ...dword(0), ...dword(1), ...dword(1), 1, ...dword(1), ...dword(0), ...dword(0x10000051), ...dword(object), ...dword(200), ...dword(300)]; }
function chain(depth = 1): Uint8Array {
  const bytes = new Uint8Array(1200 + (depth + 1) * 600); bytes.set(psionFixture());
  new DataView(bytes.buffer).setUint32(49, 500, true);
  bytes.set([...dword(1), ...Array<number>(24).fill(0), 1, 0, 0, 0, 0, ...dword(0), ...dword(0), ...body(900), ...Array<number>(6).fill(0), ...dword(0x100000fd), ...dword(11906), ...dword(16838), 0], 500);
  bytes.set(layout(1100), 900); bytes.set([2, ...dword(0x10000144), ...dword(1200)], 1100);
  for (let i = 0; i < depth; i++) {
    const base = 1200 + i * 600;
    bytes.set([...dword(4), 6, ...dword(0x10000089), ...dword(100), ...dword(0x10000105), ...dword(200), ...dword(0x10000085), ...dword(300)], base);
    bytes.set([...dword(0x10000085), ...text("texted.app")], base + 100);
    bytes.set(plainPage(), base + 200); bytes.set(body(400), base + 300); bytes.set(layout(500), base + 400);
    bytes.set([2, ...dword(0x10000144), ...dword(600)], base + 500);
  }
  const terminal = 1200 + depth * 600;
  bytes.set([...dword(4), 2, ...dword(0x10000089), ...dword(100)], terminal);
  bytes.set([...dword(0x76543210), ...text("unknown.app")], terminal + 100);
  return bytes;
}
it("deep embedded TextEd chains preserve relative bases without host recursion or namespace changes", async () => {
  const book = await readPsion(chain(1500), context);
  expect(book.sheets.map(s => s.name)).toEqual(["Sheet0"]);
  expect(book.sheets[0]?.cells[0]?.value).toEqual({ kind: "number", value: 7 });
});
it("deep chains consume one cumulative operation budget", async () => {
  await expect(readPsion(chain(20), { ...context, limits: { ...context.limits, operations: 1000 } })).rejects.toMatchObject({ code: "resource-limit" });
});
it("nested TextEd pointers cannot escape their relocated byte input", async () => {
  const bytes = chain(); new DataView(bytes.buffer).setUint32(1225, 0xffffffff, true);
  await expect(readPsion(bytes, context)).rejects.toThrow("Error while parsing Psion file.");
});
it("nested Sheet worksheets and cells share caller admission budgets", async () => {
  const bytes = chain(0); bytes.set(psionFixture(), 1200); new DataView(bytes.buffer).setUint32(1200, 20, true);
  for (const [budget, message] of [["sheets", "sheets"], ["cells", "cells"]] as const) await expect(readPsion(bytes, { ...context, limits: { ...context.limits, [budget]: 1 } })).rejects.toThrow(`${message} limit exceeded`);
});
it("cancelled nested TextEd traversal preserves the exact injected reason", async () => {
  let reads = 0; const reason = new Error("embedded stop");
  const signal = { throwIfAborted() { if (++reads === 500) throw reason; } } as AbortSignal;
  await expect(readPsion(chain(20), { ...context, signal })).rejects.toBe(reason);
});
it("known embedded Sketch requires source mandatory application semantics", async () => {
  const bytes = chain(0); new DataView(bytes.buffer).setUint32(1300, 0x1000007d, true);
  await expect(readPsion(bytes, context)).rejects.toMatchObject({ code: "io" });
});

it("validates each nested body before advancing to the next native inline object", async () => {
  const bytes = chain(1), outer = layout(1100);
  outer.splice(16, 4, ...dword(2)); outer.splice(20, 4, ...dword(2));
  bytes.set([...outer, ...layout(1700).slice(24)], 900);
  bytes.set([2, ...dword(0x10000144), ...dword(1800)], 1700);
  new DataView(bytes.buffer).setUint32(1500, 0, true); // First TextEd body malformed.
  new DataView(bytes.buffer).setUint32(1900, 0x1000007f, true); // Later Word gap.
  await expect(readPsion(bytes, context)).rejects.toMatchObject({ code: "io", message: "Error while parsing Psion file." });
});
it("validates a nested Sheet before visiting a later Word object", async () => {
  const bytes = chain(1), outer = layout(1100);
  outer.splice(16, 4, ...dword(2)); outer.splice(20, 4, ...dword(2));
  bytes.set([...outer, ...layout(1700).slice(24)], 900);
  bytes.set(psionFixture(), 1200); new DataView(bytes.buffer).setUint32(1200, 20, true);
  bytes[1366] = 255;
  bytes.set([2, ...dword(0x10000144), ...dword(1800)], 1700);
  new DataView(bytes.buffer).setUint32(1900, 0x1000007f, true);
  await expect(readPsion(bytes, context)).rejects.toMatchObject({ code: "io", message: "Error while parsing Psion file." });
});

function writeWord(bytes: Uint8Array, base: number, excessHotkeys = false): void {
  const entries = [[0x10000243, 100], [0x10000089, 120], [0x10000105, 180], [0x10000104, 280], [0x10000106, 500]];
  bytes.set([...dword(4), entries.length * 2, ...entries.flatMap(([id, offset]) => [...dword(id!), ...dword(offset!)])], base);
  bytes.set([2, 0, 0, 1, 1, 8, ...dword(0), ...dword(100)], base + 100);
  bytes.set([...dword(0x1000007f), ...text("Word.app")], base + 120);
  bytes.set(plainPage(), base + 180);
  bytes.set([...dword(0), ...dword(0), ...dword(0), excessHotkeys ? 1 : 0, ...(excessHotkeys ? dword(0) : []), 0], base + 280);
  bytes.set([4, 65, 6], base + 500);
}
it("embedded Word uses the structural shared parser without altering imported sheets", async () => {
  const bytes = chain(0); writeWord(bytes, 1200);
  expect((await readPsion(bytes, context)).sheets.map(s => s.name)).toEqual(["Sheet0"]);
});
it("nested known Word requires its mandatory sections instead of falling back", async () => {
  const bytes = chain(0); new DataView(bytes.buffer).setUint32(1300, 0x1000007f, true);
  await expect(readPsion(bytes, context)).rejects.toMatchObject({ code: "io" });
});
it("nested TextEd errors precede a later source-unsafe Word style gap", async () => {
  const bytes = chain(1), outer = layout(1100);
  outer.splice(16, 4, ...dword(2)); outer.splice(20, 4, ...dword(2));
  bytes.set([...outer, ...layout(1700).slice(24)], 900);
  bytes.set([2, ...dword(0x10000144), ...dword(1800)], 1700);
  new DataView(bytes.buffer).setUint32(1500, 0, true);
  writeWord(bytes, 1800, true);
  await expect(readPsion(bytes, context)).rejects.toMatchObject({ code: "io" });
});

it("embedded Sketch parses original raw image bytes without adding a worksheet", async () => {
  const bytes = chain(0), base = 1200;
  bytes.set([...dword(4), 4, ...dword(0x10000089), ...dword(24), ...dword(0x1000007d), ...dword(48)], base);
  bytes.set([...dword(0x1000007d), ...text("Paint.app")], base + 24);
  const image = new Uint8Array(79), v = new DataView(image.buffer);
  [41, 40, 1, 1, 0, 0, 2, 0, 0, 0].forEach((n, i) => v.setUint32(18 + i * 4, n, true));
  image[58] = 85; bytes.set(image, base + 48);
  expect((await readPsion(bytes, context)).sheets.map(s => s.name)).toEqual(["Sheet0"]);
});
it("nested Sheet pages relocate a second Sheet and retain one root namespace", async () => {
  const bytes = chain(4);
  const page = bytes.slice(500, 600), inline = bytes.slice(900, 953), object = bytes.slice(1100, 1109);
  bytes.set(psionFixture(), 1200); new DataView(bytes.buffer).setUint32(1200, 20, true);
  new DataView(bytes.buffer).setUint32(1249, 500, true);
  bytes.set(page, 1700); bytes.set(inline, 2100); bytes.set(object, 2300);
  bytes.set(psionFixture(), 2400); new DataView(bytes.buffer).setUint32(2400, 20, true);
  expect((await readPsion(bytes, context)).sheets.map(s => s.name)).toEqual(["Sheet0"]);
  await expect(readPsion(bytes, { ...context, limits: { ...context.limits, cells: 2 } })).rejects.toThrow("cells limit exceeded");
});
