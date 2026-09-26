import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { createBiffWriter, readBiff } from "./biff.js";
import { readCfb } from "./biff-binary.js";
import { writeCfb } from "./biff-write-binary.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 10, sheets: 2, operations: 10 } };
const summary = "\u0005SummaryInformation", document = "\u0005DocumentSummaryInformation";
const guids = ["e0859ff2f94f6810ab9108002b27b3d9", "02d5cdd59c2e1b10939708002b2cf9ae", "05d5cdd59c2e1b10939708002b2cf9ae", "1234567890abcdef1234567890abcdef"];
const u32 = (...values: number[]) => {
  const bytes = new Uint8Array(values.length * 4), view = new DataView(bytes.buffer);
  values.forEach((value, i) => view.setUint32(i * 4, value, true)); return bytes;
};
const concat = (...parts: Uint8Array[]) => {
  const bytes = new Uint8Array(parts.reduce((size, part) => size + part.length, 0)); let at = 0;
  for (const part of parts) { bytes.set(part, at); at += part.length; } return bytes;
};
function string(text: string, wide = false): Uint8Array {
  const bytes = wide ? new Uint8Array((text.length + 1) * 2) : new TextEncoder().encode(text + "\0");
  if (wide) for (let i = 0; i < text.length; i++) new DataView(bytes.buffer).setUint16(i * 2, text.charCodeAt(i), true);
  return concat(u32(bytes.length / (wide ? 2 : 1)), bytes, new Uint8Array(wide ? (4 - bytes.length % 4) % 4 : 0));
}
/** Original property-set fixture, independent of the product's property codec. */
function propertySet(sections: { kind: number; values: [number, Uint8Array][] }[]): Uint8Array {
  const header = new Uint8Array(28 + sections.length * 20), view = new DataView(header.buffer);
  view.setUint16(0, 0xfffe, true); view.setUint32(4, 0x20001, true); view.setUint32(24, sections.length, true);
  let offset = header.length;
  const bodies = sections.map(({ kind, values }, i) => {
    header.set(Uint8Array.from({ length: 16 }, (_, i) => parseInt(guids[kind]!.slice(i * 2, i * 2 + 2), 16)), 28 + i * 20);
    view.setUint32(44 + i * 20, offset, true);
    const padded = values.map(([, bytes]) => concat(bytes, new Uint8Array((4 - bytes.length % 4) % 4)));
    const size = 8 + values.length * 8 + padded.reduce((n, bytes) => n + bytes.length, 0);
    const table = u32(size, values.length, ...values.flatMap(([id]) => [id, 0]));
    let at = table.length;
    padded.forEach((bytes, i) => { new DataView(table.buffer).setUint32(12 + i * 8, at, true); at += bytes.length; });
    offset += size; return concat(table, ...padded);
  });
  return concat(header, ...bodies);
}
function workbook(streams: [string, Uint8Array][]): Uint8Array {
  return writeCfb(new Map([["Workbook", new Uint8Array([9, 8, 4, 0, 0, 6, 16, 0, 10, 0, 0, 0])], ...streams]), context);
}

function storedValues(bytes: Uint8Array, sectionIndex = 0): Map<number, Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), start = view.getUint32(44 + sectionIndex * 20, true);
  const size = view.getUint32(start, true), count = view.getUint32(start + 4, true);
  const pointers = Array.from({ length: count }, (_, i) => ({ id: view.getUint32(start + 8 + i * 8, true), at: view.getUint32(start + 12 + i * 8, true) }));
  pointers.sort((a, b) => a.at - b.at);
  return new Map(pointers.map(({ id, at }, i) => [id, bytes.slice(start + at, start + (pointers[i + 1]?.at ?? size))]));
}

it.each(["edit", "delete"])("preserves opaque property bytes while applying a modeled %s", async operation => {
  const blob = u32(65, 4, 0x78563412);
  const bytes = propertySet([{ kind: 0, values: [[1, u32(2, 1252)], [2, concat(u32(31), string("Title", true))], [200, blob]] }]);
  const imported = await readBiff(workbook([[summary, bytes]]), context), warnings: string[] = [];
  const output = await createBiffWriter(8)({ ...imported, sheets: [{ id: "S", name: "S", cells: [] }],
    properties: operation === "edit" ? { "dc:title": "日本語" } : {} }, [],
  { ...context, async diagnostic(d) { warnings.push(d.message); } });
  const properties = readCfb(output, context).get(summary);
  expect(properties).toBeDefined();
  expect(storedValues(properties!).get(200)).toEqual(blob);
  expect(storedValues(properties!).get(1)).toEqual(u32(2, 1252));
  expect(storedValues(properties!).has(2)).toBe(operation === "edit");
  expect((await readBiff(output, context)).properties ?? {}).toEqual(operation === "edit" ? { "dc:title": "日本語" } : {});
  expect(warnings).toEqual([]);
});

it("retains an unknown section and original sub-millisecond timestamp during another field edit", async () => {
  const time = u32(64, 0, 0); new DataView(time.buffer).setBigUint64(4, 133536384000000001n, true);
  const bytes = propertySet([{ kind: 0, values: [[2, concat(u32(31), string("Title", true))], [12, time]] },
    { kind: 3, values: [[99, u32(65, 4, 0x78563412)]] }]);
  const imported = await readBiff(workbook([[summary, bytes]]), context);
  const output = await createBiffWriter(8)({ ...imported, sheets: [{ id: "S", name: "S", cells: [] }],
    properties: { ...imported.properties, "dc:title": "Edited" } }, [], context);
  const result = readCfb(output, context).get(summary)!;
  expect(storedValues(result).get(12)).toEqual(time);
  const originalStart = new DataView(bytes.buffer).getUint32(64, true), outputStart = new DataView(result.buffer, result.byteOffset).getUint32(64, true);
  expect(result.slice(outputStart)).toEqual(bytes.slice(originalStart));
});

it("edits custom values without changing the dictionary codepage or unknown named bytes", async () => {
  const blob = u32(65, 4, 0x78563412);
  const bytes = propertySet([{ kind: 2, values: [[1, u32(2, 1252)],
    [0, concat(u32(2, 2), string("Count"), u32(3), string("Opaque"))], [2, u32(3, 7)], [3, blob]] }]);
  const imported = await readBiff(workbook([[document, bytes]]), context);
  const output = await createBiffWriter(8)({ ...imported, sheets: [{ id: "S", name: "S", cells: [] }],
    properties: { Count: 9, Added: "日本語" } }, [], context);
  const result = readCfb(output, context).get(document)!;
  expect(storedValues(result).get(3)).toEqual(blob);
  expect(storedValues(result).get(1)).toEqual(u32(2, 1252));
  expect((await readBiff(output, context)).properties).toEqual({ Count: 9, Added: "日本語" });
});

it.each([65001, 1200, 932])("adds exact dictionary names in original codepage %i", async codepage => {
  const bytes = propertySet([{ kind: 2, values: [[1, u32(2, codepage)],
    [0, concat(u32(1, 2), string("Opaque", codepage === 1200))], [2, u32(65, 4, 0x78563412)]] }]);
  const imported = await readBiff(workbook([[document, bytes]]), context);
  const output = await createBiffWriter(8)({ ...imported, sheets: [{ id: "S", name: "S", cells: [] }],
    properties: { "日本語": 9, Other: true } }, [], context);
  const result = readCfb(output, context).get(document)!;
  expect(storedValues(result).get(1)).toEqual(u32(2, codepage));
  expect(storedValues(result).get(2)).toEqual(u32(65, 4, 0x78563412));
  expect((await readBiff(output, context)).properties).toEqual({ "日本語": 9, Other: true });
});

it("warns instead of escaping a new dictionary name that the original codepage cannot represent", async () => {
  const blob = u32(65, 4, 0x78563412);
  const bytes = propertySet([{ kind: 2, values: [[1, u32(2, 1252)], [0, concat(u32(1, 2), string("Opaque"))], [2, blob]] }]);
  const imported = await readBiff(workbook([[document, bytes]]), context), warnings: string[] = [];
  const output = await createBiffWriter(8)({ ...imported, sheets: [{ id: "S", name: "S", cells: [] }], properties: { "日本語": 9 } }, [],
    { ...context, async diagnostic(d) { warnings.push(d.message); } });
  expect(storedValues(readCfb(output, context).get(document)!).get(2)).toEqual(blob);
  expect((await readBiff(output, context)).properties).toBeUndefined();
  expect(warnings).toEqual([expect.stringContaining("name cannot be encoded in the original codepage")]);
});

it("removes a deleted custom value and its dictionary name while retaining opaque entries", async () => {
  const bytes = propertySet([{ kind: 2, values: [[1, u32(2, 65001)],
    [0, concat(u32(2, 2), string("Count"), u32(3), string("Opaque"))], [2, u32(3, 7)], [3, u32(65, 4, 0x78563412)]] }]);
  const imported = await readBiff(workbook([[document, bytes]]), context);
  const output = await createBiffWriter(8)({ ...imported, sheets: [{ id: "S", name: "S", cells: [] }], properties: {} }, [], context);
  const result = storedValues(readCfb(output, context).get(document)!);
  expect(result.has(2)).toBe(false);
  const dict = concat(u32(1, 3), string("Opaque"));
  expect(result.get(0)).toEqual(concat(dict, new Uint8Array((4 - dict.length % 4) % 4)));
  expect(result.get(3)).toEqual(u32(65, 4, 0x78563412));
});

it("does not warn about an unchanged source value that remains representable in its original bytes", async () => {
  const bytes = propertySet([{ kind: 0, values: [[14, concat(u32(31), string("unusual page count", true))], [200, u32(65, 4, 0x78563412)]] }]);
  const imported = await readBiff(workbook([[summary, bytes]]), context), warnings: string[] = [];
  const output = await createBiffWriter(8)({ ...imported, sheets: [{ id: "S", name: "S", cells: [] }] }, [],
    { ...context, async diagnostic(d) { warnings.push(d.message); } });
  expect(storedValues(readCfb(output, context).get(summary)!).get(14)).toEqual(storedValues(bytes).get(14));
  expect(warnings).toEqual([]);
});

it("warns if preserving an opaque duplicate would expose a deleted field", async () => {
  const first = propertySet([{ kind: 0, values: [[2, concat(u32(31), string("Title", true))]] }]);
  const second = propertySet([{ kind: 2, values: [[1, u32(2, 65001)],
    [0, concat(u32(1, 2), string("dc:title"))], [2, concat(u32(30), string("Opaque duplicate"))]] }]);
  const imported = await readBiff(workbook([[summary, first], [document, second]]), context), warnings: string[] = [];
  const output = await createBiffWriter(8)({ ...imported, sheets: [{ id: "S", name: "S", cells: [] }], properties: {} }, [],
    { ...context, async diagnostic(d) { warnings.push(d.message); } });
  expect(storedValues(readCfb(output, context).get(document)!).get(2)).toEqual(storedValues(second).get(2));
  expect(warnings).toEqual([expect.stringContaining("opaque property exposes a field absent from the model")]);
});

it("keeps the required built-in section when adding a new custom property stream", async () => {
  const bytes = propertySet([{ kind: 0, values: [[200, u32(65, 4, 0x78563412)]] }]);
  const imported = await readBiff(workbook([[summary, bytes]]), context);
  const output = await createBiffWriter(8)({ ...imported, sheets: [{ id: "S", name: "S", cells: [] }], properties: { Added: 7 } }, [], context);
  const result = readCfb(output, context).get(document)!;
  expect(new DataView(result.buffer, result.byteOffset).getUint32(24, true)).toBe(2);
  expect([...result.subarray(28, 44)].map(byte => byte.toString(16).padStart(2, "0")).join("")).toBe(guids[1]);
});

it("bounds retained-property reconstruction before publishing output", async () => {
  const bytes = propertySet([{ kind: 0, values: [[200, u32(65, 4, 0x78563412)]] }]);
  const imported = await readBiff(workbook([[summary, bytes]]), context);
  await expect(createBiffWriter(8)({ ...imported, sheets: [{ id: "S", name: "S", cells: [] }] }, [],
    { ...context, limits: { ...context.limits, workbookWork: 10 } })).rejects.toMatchObject({ code: "resource-limit" });
});

it("imports root SummaryInformation strings instead of discarding the stream", async () => {
  const bytes = propertySet([{ kind: 0, values: [[2, concat(u32(30), string("Résumé 🧮"))],
    [4, concat(u32(31), string("Ada", true))], [1, u32(2, 65001)]] }]);
  const book = await readBiff(workbook([[summary, bytes]]), context);
  expect(book.properties).toEqual({ "dc:title": "Résumé 🧮", "meta:initial-creator": "Ada" });
  expect(book.unsupportedRecords).toBeUndefined();
});

it("resolves property stream names with CFB's case-insensitive identity", async () => {
  const bytes = propertySet([{ kind: 0, values: [[2, concat(u32(31), string("Title", true))]] }]);
  const book = await readBiff(workbook([[summary.toUpperCase(), bytes]]), context);
  expect(book.properties).toEqual({ "dc:title": "Title" });
});

it("splits keywords using LibreOffice's comma and whitespace rules", async () => {
  const bytes = propertySet([{ kind: 0, values: [[1, u32(2, 65001)],
    [5, concat(u32(30), string("\u200b one\u2028, ,\u00a0two\u00a0,\0three\0"))]] }]);
  const result = await readBiff(workbook([[summary, bytes]]), context);
  expect(result.properties).toEqual({ "dc:keywords": ["one", "\u00a0two\u00a0", "\0three\0"] });
});

it("uses each section's codepage and dictionary for custom scalar values", async () => {
  const double = concat(u32(5), new Uint8Array(8)); new DataView(double.buffer).setFloat64(4, 2.5, true);
  const bytes = propertySet([{ kind: 1, values: [[1, u32(2, 1252)], [15, concat(u32(30, 5), new Uint8Array([67, 97, 102, 233, 0]))]] },
    { kind: 2, values: [[1, u32(2, 1200)], [0, concat(u32(3, 2), string("Count", true), u32(3), string("Rate", true), u32(4), string("Approved", true))],
      [2, u32(3, -7)], [3, double], [4, u32(11, 0xffff)]] }]);
  const book = await readBiff(workbook([[document, bytes]]), context);
  expect(book.properties).toEqual({ "dc:publisher": "Café", Count: -7, Rate: 2.5, Approved: true });
});

it("imports FILETIME timestamps and elapsed editing time without using the host timezone", async () => {
  const timestamp = concat(u32(64), new Uint8Array(8));
  new DataView(timestamp.buffer).setBigUint64(4, 133536384000000000n, true); // 2024-02-29 UTC
  const elapsed = concat(u32(64), new Uint8Array(8));
  new DataView(elapsed.buffer).setBigUint64(4, 612500001n, true); // 61.2500001 seconds
  const bytes = propertySet([{ kind: 0, values: [[12, timestamp], [10, elapsed]] }]);
  expect((await readBiff(workbook([[summary, bytes]]), context)).properties).toEqual({
    "meta:creation-date": "2024-02-29T00:00:00.000Z", "meta:editing-duration": "PT1M1.2500001S" });
});

it("interprets negative OLE DATE fractions as time of day", async () => {
  const value = concat(u32(7), new Uint8Array(8)); new DataView(value.buffer).setFloat64(4, -1.25, true);
  const bytes = propertySet([{ kind: 2, values: [[1, u32(2, 65001)], [0, concat(u32(1, 2), string("Date"))], [2, value]] }]);
  const book = await readBiff(workbook([[document, bytes]]), context);
  expect(book.properties).toEqual({ Date: "1899-12-29T06:00:00.000Z" });
  expect(book.unsupportedRecords).toBeUndefined();
});

it.each(["__proto__", "constructor"])("preserves a custom dictionary key named %s safely", async name => {
  const bytes = propertySet([{ kind: 2, values: [[1, u32(2, 65001)], [0, concat(u32(1, 2), string(name))], [2, u32(3, 42)]] }]);
  const properties = (await readBiff(workbook([[document, bytes]]), context)).properties!;
  expect(Object.hasOwn(properties, name)).toBe(true); expect(properties[name]).toBe(42);
  expect(Object.getPrototypeOf(properties)).toBeNull();
});

it("retains unsupported property bytes with a warning alongside interpreted values", async () => {
  const bytes = propertySet([{ kind: 0, values: [[1, u32(2, 65001)], [2, concat(u32(30), string("Title"))], [17, u32(71, 123)]] }]);
  const warnings: string[] = [];
  const book = await readBiff(workbook([[summary, bytes]]), { ...context, async diagnostic(d) { warnings.push(d.message); } });
  expect(book.properties).toEqual({ "dc:title": "Title" });
  expect(book.unsupportedRecords).toEqual([{ source: "biff", kind: "ole-properties", disposition: "retained",
    data: { stream: summary, bytes: Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join(""), modeled: [[48, 2, "dc:title"]] } }]);
  expect(warnings).toEqual([expect.stringContaining("property")]);
});

it("records the source property identity without treating opaque values as deleted model fields", async () => {
  const bytes = propertySet([{ kind: 0, values: [[1, u32(2, 65001)],
    [2, concat(u32(30), string("Title"))], [200, u32(65, 4, 0x78563412)]] }]);
  const result = await readBiff(workbook([[summary, bytes]]), context);
  expect(result.unsupportedRecords?.[0]?.data).toMatchObject({ modeled: [[48, 2, "dc:title"]] });
});

it("does not assign model ownership to a custom property shadowed by another stream", async () => {
  const first = propertySet([{ kind: 0, values: [[2, concat(u32(31), string("Title", true))]] }]);
  const second = propertySet([{ kind: 2, values: [[1, u32(2, 65001)],
    [0, concat(u32(1, 2), string("dc:title"))], [2, concat(u32(30), string("Opaque duplicate"))]] }]);
  const result = await readBiff(workbook([[summary, first], [document, second]]), context);
  expect(result.properties).toEqual({ "dc:title": "Title" });
  expect(result.unsupportedRecords?.[0]?.data).toMatchObject({ stream: document, modeled: [] });
});

it("rejects property pointers into the section table", async () => {
  const bytes = propertySet([{ kind: 0, values: [[2, concat(u32(31), string("Title", true))]] }]);
  new DataView(bytes.buffer).setUint32(48 + 12, 8, true);
  await expect(readBiff(workbook([[summary, bytes]]), context)).rejects.toThrow("property offset");
});

it("admits metadata text before decoding a property", async () => {
  const bytes = propertySet([{ kind: 0, values: [[2, concat(u32(31), string("x".repeat(100), true))]] }]);
  await expect(readBiff(workbook([[summary, bytes]]), { ...context,
    limits: { ...context.limits, workbookTextBytes: 50 } })).rejects.toMatchObject({ code: "resource-limit" });
});

it.each(["duplicate ID", "same offset", "nonfinite number", "unterminated string", "truncated boolean", "codepage type"])(
  "rejects malformed property data: %s", async kind => {
    let values: [number, Uint8Array][] = [[1, u32(2, 1252)], [2, concat(u32(30), string("Title"))]];
    if (kind === "duplicate ID") values = [[2, u32(3, 1)], [2, u32(3, 2)]];
    if (kind === "nonfinite number") values[1] = [2, u32(5, 0, 0x7ff00000)];
    if (kind === "unterminated string") values[1] = [2, u32(30, 4, 0x61616161)];
    if (kind === "truncated boolean") values[1] = [2, u32(11)];
    if (kind === "codepage type") values[0] = [1, u32(3, 1252)];
    const bytes = propertySet([{ kind: 0, values }]);
    if (kind === "same offset") new DataView(bytes.buffer).setUint32(48 + 20, 24, true);
    await expect(readBiff(workbook([[summary, bytes]]), context)).rejects.toMatchObject({ code: "io" });
  });

it.each([1, 2, 0xffff])("reads native nonzero BOOL value %i as true", async value => {
  const bytes = propertySet([{ kind: 2, values: [[1, u32(2, 65001)],
    [0, concat(u32(1, 2), string("Approved"))], [2, u32(11, value)]] }]);
  expect((await readBiff(workbook([[document, bytes]]), context)).properties).toEqual({ Approved: true });
});

it("retains an unknown codepage and type without inventing a decoded value", async () => {
  const bytes = propertySet([{ kind: 0, values: [[1, u32(2, 65535)], [2, concat(u32(30), string("Title"))]] }]);
  const book = await readBiff(workbook([[summary, bytes]]), context);
  expect(book.properties).toBeUndefined();
  expect(book.unsupportedRecords).toEqual([expect.objectContaining({ kind: "ole-properties", disposition: "retained" })]);
});

it("does not let custom properties overwrite interpreted summary properties", async () => {
  const primary = propertySet([{ kind: 0, values: [[2, concat(u32(30), string("Original"))]] }]);
  const secondary = propertySet([{ kind: 2, values: [[1, u32(2, 65001)],
    [0, concat(u32(1, 2), string("dc:title"))], [2, concat(u32(30), string("Replacement"))]] }]);
  const book = await readBiff(workbook([[summary, primary], [document, secondary]]), context);
  expect(book.properties).toEqual({ "dc:title": "Original" });
  expect(book.unsupportedRecords).toEqual([expect.objectContaining({ kind: "ole-properties" })]);
});

it("admits property tables before creating entries", async () => {
  const bytes = propertySet([{ kind: 0, values: Array.from({ length: 20 }, (_, i) => [i + 2, u32(3, i)]) }]);
  await expect(readBiff(workbook([[summary, bytes]]), { ...context,
    limits: { ...context.limits, workbookNodes: 10 } })).rejects.toThrow("property node limit");
});
