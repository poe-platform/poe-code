import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import type { Workbook } from "../workbook.js";
import { createBiffWriter, readBiff } from "./biff.js";
import { readCfb } from "./biff-binary.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 10, sheets: 2, operations: 10 } };
const summary = "\u0005SummaryInformation", document = "\u0005DocumentSummaryInformation";
const book: Workbook = { sheets: [{ id: "s", name: "S", cells: [] }], properties: {
  "dc:title": "Résumé 🧮", "meta:initial-creator": "Ada", "dc:publisher": "Example", "dc:keywords": ["alpha", "日本語"],
  "meta:creation-date": "2024-02-29T00:00:00.000Z", "meta:editing-duration": "PT1M1.2500001S",
  Count: -7, Ratio: 2.5, Approved: true, Project: "日本語" } };

it.each([7, 8, "dsf"] as const)("exports document properties with the BIFF %s workbook", async profile => {
  const bytes = await createBiffWriter(profile)(book, [], context);
  expect((await readBiff(bytes, context)).properties).toEqual(book.properties);
  const streams = readCfb(bytes, context);
  expect(streams.has(summary)).toBe(true); expect(streams.has(document)).toBe(true);
  expect(streams.has("Book")).toBe(profile !== 8); expect(streams.has("Workbook")).toBe(profile !== 7);
});

it("writes the source-defined property-set header, section-relative offsets and UTF-8 codepage", async () => {
  const streams = readCfb(await createBiffWriter(8)(book, [], context), context);
  const bytes = streams.get(summary)!;
  expect(bytes).toBeDefined();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(view.getUint16(0, true)).toBe(0xfffe); expect(view.getUint16(2, true)).toBe(0);
  expect(view.getUint32(24, true)).toBe(1);
  expect(Array.from(bytes.subarray(28, 44))).toEqual([0xe0, 0x85, 0x9f, 0xf2, 0xf9, 0x4f, 0x68, 0x10, 0xab, 0x91, 8, 0, 0x2b, 0x27, 0xb3, 0xd9]);
  const section = view.getUint32(44, true), size = view.getUint32(section, true), count = view.getUint32(section + 4, true);
  expect(section).toBe(48); expect(size).toBe(bytes.length - section);
  const values = new Map<number, number>();
  for (let i = 0; i < count; i++) {
    const offset = view.getUint32(section + 12 + i * 8, true);
    expect(offset % 4).toBe(0); expect(offset).toBeGreaterThanOrEqual(8 + count * 8); expect(offset).toBeLessThan(size);
    values.set(view.getUint32(section + 8 + i * 8, true), section + offset);
  }
  expect(view.getUint32(values.get(1)!, true)).toBe(2); expect(view.getUint16(values.get(1)! + 4, true)).toBe(65001);
  const title = values.get(2)!; expect(view.getUint32(title, true)).toBe(30);
  const length = view.getUint32(title + 4, true);
  expect(new TextDecoder().decode(bytes.subarray(title + 8, title + 8 + length))).toBe("Résumé 🧮\0");
  expect(view.getBigUint64(values.get(12)! + 4, true)).toBe(133536384000000000n);
});

it("warns when a property value cannot be represented instead of silently dropping it", async () => {
  const warnings: string[] = [];
  await createBiffWriter(8)({ ...book, properties: { nested: { value: "not a scalar" } } }, [],
    { ...context, async diagnostic(d) { warnings.push(d.message); } });
  expect(warnings).toEqual([expect.stringContaining("nested")]);
});

it("admits property text before encoding it", async () => {
  await expect(createBiffWriter(8)({ ...book, properties: { "dc:title": "x".repeat(1000) } }, [],
    { ...context, limits: { ...context.limits, workbookTextBytes: 100 } })).rejects.toMatchObject({ code: "resource-limit" });
});

it("keeps the workbook-only container when there are no properties", async () => {
  const bytes = await createBiffWriter(8)({ sheets: book.sheets }, [], context);
  expect([...readCfb(bytes, context).keys()]).toEqual(["Workbook"]);
});

it("writes editing cycles as the native revision string", async () => {
  const bytes = await createBiffWriter(8)({ ...book, properties: { "meta:editing-cycles": 7 } }, [], context);
  expect((await readBiff(bytes, context)).properties).toEqual({ "meta:editing-cycles": "7" });
});

it("uses declared types for built-in string and integer properties", async () => {
  const warnings: string[] = [];
  const bytes = await createBiffWriter(8)({ ...book, properties: { "dc:title": 42, "gsf:page-count": 3,
    "dc:subject": true, "gsf:word-count": 1.5 } }, [], { ...context, async diagnostic(d) { warnings.push(d.message); } });
  expect((await readBiff(bytes, context)).properties).toEqual({ "dc:title": "42", "gsf:page-count": 3 });
  expect(warnings).toEqual([expect.stringContaining("dc:subject"), expect.stringContaining("gsf:word-count")]);
});

it.each(["P1DT2H3M4.0000001S", "PT26H3M4.000000100S"])("exports elapsed time %s as exact FILETIME ticks", async duration => {
  const bytes = await createBiffWriter(8)({ ...book, properties: { "meta:editing-duration": duration } }, [], context);
  expect((await readBiff(bytes, context)).properties).toEqual({ "meta:editing-duration": "PT1563M4.0000001S" });
});

it("keeps timestamp precision below a millisecond in the stored property", async () => {
  const bytes = await createBiffWriter(8)({ ...book, properties: { "meta:creation-date": "2024-02-29T00:00:00.1234567Z" } }, [], context);
  const reopened = await readBiff(bytes, context);
  expect(reopened.properties).toEqual({ "meta:creation-date": "2024-02-29T00:00:00.123Z" });
  expect(reopened.unsupportedRecords?.filter(record => record.kind === "ole-properties"))
    .toEqual([expect.objectContaining({ kind: "ole-properties" })]);
});

it("retains plaintext properties beside an encrypted workbook without claiming ancillary encryption", async () => {
  const encrypted = { ...context, password: { async read() { return "password"; } },
    entropy: { async read() { return Uint8Array.from({ length: 32 }, (_, i) => i + 1); } } };
  const bytes = await createBiffWriter(8)(book, ["encryption=rc4-cryptoapi-128"], encrypted);
  expect(new TextDecoder().decode(readCfb(bytes, context).get(summary))).toContain("Résumé 🧮");
  expect((await readBiff(bytes, encrypted)).properties).toEqual(book.properties);
});
