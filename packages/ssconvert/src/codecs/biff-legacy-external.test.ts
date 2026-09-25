import { expect, it } from "vitest";
import { readBiff } from "./biff.js";
import { parseExpression } from "../formulas/parser.js";
import { recalculateWorkbook } from "../formulas/evaluator.js";
import type { CapabilityContext } from "../contracts.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 4, operations: 1000 } };
function join(...parts: Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let at = 0; for (const part of parts) { bytes.set(part, at); at += part.length; } return bytes;
}
function words(...values: number[]): Uint8Array {
  const bytes = new Uint8Array(values.length * 2), view = new DataView(bytes.buffer);
  values.forEach((value, i) => view.setUint16(i * 2, value, true)); return bytes;
}
function record(opcode: number, data: Uint8Array = new Uint8Array()): Uint8Array { return join(words(opcode, data.length), data); }
function link(path: string): Uint8Array { return record(0x17, new Uint8Array([path.length, ...Array.from(path, c => c.charCodeAt(0))])); }
function name(spelling: string, sheet = 0, flags = 0): Uint8Array {
  // A stored expression must never override external identity or run on import.
  return record(0x23, join(words(flags, sheet, 0), new Uint8Array([spelling.length, ...Array.from(spelling, c => c.charCodeAt(0))]), words(3), new Uint8Array([0x1e, 99, 0])));
}
function token(kind: "cell" | "range" | "name", namespace: number, index = 1, tokenClass = 0): Uint8Array {
  const prefix = new Uint8Array(kind === "name" ? 24 : 14).fill(255), view = new DataView(prefix.buffer);
  view.setUint16(0, namespace, true);
  if (kind === "name") view.setUint16(10, index, true);
  return join(new Uint8Array([(kind === "name" ? 0x39 : kind === "cell" ? 0x3a : 0x3b) + tokenClass]), prefix,
    kind === "name" ? new Uint8Array() : kind === "cell" ? new Uint8Array([0, 0, 0]) : new Uint8Array([0, 0, 1, 0, 0, 1]));
}
function formula(tokens: Uint8Array, column = 0): Uint8Array {
  const data = new Uint8Array(22 + tokens.length), view = new DataView(data.buffer);
  view.setUint16(2, column, true); view.setFloat64(6, 42, true); view.setUint16(20, tokens.length, true); data.set(tokens, 22);
  return record(6, data);
}
function sheet(links: Uint8Array[], tokens: Uint8Array[]): Uint8Array {
  return join(record(0x809, words(0x500, 16)), ...links, ...tokens.map((t, i) => formula(t, i)), record(10));
}
function fixture(links: Uint8Array[], tokens: Uint8Array[]): Uint8Array {
  return join(record(0x809, words(0x500, 5)), record(10), sheet(links, tokens));
}
// OpenOffice Excel format 1.42, sections 2.5.9, 3.9.14-16, 4.10.2 and 5.39.3.
// These original records do not use our writer. Unused token bytes are nonzero.
for (const kind of ["cell", "range", "name"] as const) for (const tokenClass of [0, 0x20, 0x40])
  it(`imports BIFF7 external ${kind} class ${tokenClass} without host access`, async () => {
    const links = kind === "name" ? [link("\x01book.xls"), name("Rate")] : [link("\x01[book.xls]Other")];
    let calls = 0;
    const book = await readBiff(fixture(links, [token(kind, 1, 1, tokenClass)]), { ...context,
      externalReferences: { resolve() { calls++; throw new Error("implicit external access"); } } });
    expect(calls).toBe(0);
    const cell = book.sheets[0]!.cells[0]!;
    expect(cell.cachedResult).toEqual({ kind: "number", value: 42 });
    expect(cell.formula).toBeDefined();
    const parsed = parseExpression(cell.formula!, { workbook: book, position: { sheet: book.sheets[0]!.id, row: 0, column: 0 } });
    expect(parsed.ok && parsed.document.root).toMatchObject(kind === "name" ? { kind: "name", workbook: "book.xls", name: "Rate" } :
      { kind: "reference", first: { workbook: "book.xls", sheet: "Other", row: { value: 0 }, column: { value: 0 } } });
    expect(recalculateWorkbook(book, context, true).sheets[0]!.cells[0]!.value).toEqual({ kind: "error", value: "#REF!" });
    const resolved = recalculateWorkbook(book, { ...context, externalReferences: { resolve() { calls++; return { kind: "number", value: 84 }; } } }, true);
    expect(calls).toBe(1); expect(resolved.sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 84 });
  });
it("partitions external names by document block and worksheet", async () => {
  const links = [link("\x01[first.xls]Other"), link("\x01first.xls"), name("Rate", 1), name("Global"),
    link("\x01second.xls"), name("Rate"), link(":"), name("SUM")];
  const input = join(record(0x809, words(0x500, 5)), record(10),
    sheet(links, [token("name", 2), token("name", 2, 2), token("name", 3), join(token("name", 4), new Uint8Array([0x1e, 7, 0, 0x42, 2, 255, 0]))]),
    sheet([link("\x01third.xls"), name("Rate")], [token("name", 1)]));
  const requests: unknown[] = [];
  const book = await readBiff(input, context);
  const result = recalculateWorkbook(book, { ...context, externalReferences: { resolve(request) { requests.push(request); return { kind: "number", value: 84 }; } } }, true);
  expect(requests).toMatchObject([{ workbook: "first.xls", sheet: "Other", name: "Rate" }, { workbook: "first.xls", name: "Global" },
    { workbook: "second.xls", name: "Rate" }, { workbook: "third.xls", name: "Rate" }]);
  expect(result.sheets[0]!.cells[3]!.value).toEqual({ kind: "number", value: 7 });
});
for (const [encoded, workbook] of [
  ["\x01sub\x03[book.xls]", "sub\\book.xls"], ["\x01\x01Csub\x03[book.xls]", "C:\\sub\\book.xls"],
  ["\x01\x04[book.xls]", "..\\book.xls"], ["[book.xls]", "book.xls"],
  ["\x01\x05\x1dhttps://example.test/[a.xls]S", "https://example.test/a.xls"]
]) it(`decodes legacy external path ${JSON.stringify(encoded)}`, async () => {
  const url = encoded!.includes("https:");
  const book = await readBiff(fixture([link(encoded! + (url ? "" : "O'Brien"))], [token("cell", 1)]), context);
  const requests: unknown[] = [];
  recalculateWorkbook(book, { ...context, externalReferences: { resolve(request) { requests.push(request); return undefined; } } }, true);
  expect(requests).toMatchObject([{ first: { workbook, sheet: url ? "S" : "O'Brien" } }]);
});
it.each(["Rate+1", "Rate!A1", "Rate)"])("keeps invalid legacy external name %s unbound", async spelling => {
  const book = await readBiff(fixture([link("\x01book.xls"), name(spelling)], [token("name", 1)]), context);
  expect(book.sheets[0]!.cells[0]!.formula).toBeUndefined();
});
it.each([0, 3])("cannot borrow name index %i from a neighboring document", async index => {
  const book = await readBiff(fixture([link("\x01first.xls"), name("Rate"), link("\x01second.xls"), name("Other")], [token("name", 1, index)]), context);
  expect(recalculateWorkbook(book, context, true).sheets[0]!.cells[0]!.value).toEqual({ kind: "error", value: "#REF!" });
});
it.each([1, 3])("does not attach a name to an unrelated or future sheet link %i", async scope => {
  const book = await readBiff(fixture([link("\x01[other.xls]Other"), link("\x01book.xls"), name("Rate", scope), link("\x01[book.xls]Future")], [token("name", 2)]), context);
  let calls = 0;
  recalculateWorkbook(book, { ...context, externalReferences: { resolve() { calls++; return { kind: "number", value: 9 }; } } }, true);
  expect(calls).toBe(0);
});
it("preserves unknown namespaces and declaration flags without executing bodies", async () => {
  const book = await readBiff(fixture([link("excel\x03topic"), name("Rate"), link("\x01book.xls"), name("Rate", 0, 16)], [token("name", 1), token("name", 2)]), context);
  expect(book.sheets[0]!.cells.every(cell => cell.formula === undefined)).toBe(true);
});
it("keeps workbook-global links separate for defined-name formulas", async () => {
  const tokens = token("cell", 1), spelling = "Local";
  const header = new Uint8Array(14), view = new DataView(header.buffer); header[3] = spelling.length; view.setUint16(4, tokens.length, true);
  const defined = record(0x18, join(header, new TextEncoder().encode(spelling), tokens));
  const book = await readBiff(join(record(0x809, words(0x500, 5)), link("\x01[global.xls]Other"), defined, record(10),
    sheet([link("\x01[local.xls]Other")], [token("cell", 1)])), context);
  expect(book.names?.[0]?.expression).toContain("global.xls");
  expect(book.sheets[0]!.cells[0]!.formula).toContain("local.xls");
});
it.each(["\x01[book.xls", "\x01[book.xls]", "\x01[[book.xls]Other", "\x01[book.xls]]Other", "\x01\x06[book.xls]Other"])("keeps ambiguous/unsupported path %j unbound", async path => {
  const book = await readBiff(fixture([link(path)], [token("cell", 1)]), context);
  expect(book.sheets[0]!.cells[0]!.formula).toBeUndefined();
});
it("rejects truncated link strings and raw URL payloads", async () => {
  for (const broken of [record(0x17, new Uint8Array([9, 1, 65])), link("\x01\x05\x09abc")])
    await expect(readBiff(fixture([broken], [token("cell", 1)]), context)).rejects.toThrow("Invalid Excel BIFF");
});
it("accounts for legacy link text and work, and honors cancellation", async () => {
  const bytes = fixture([link("\x01[book.xls]Other")], [token("cell", 1)]);
  await expect(readBiff(bytes, { ...context, limits: { ...context.limits, workbookTextBytes: 15 } })).rejects.toThrow("limit");
  await expect(readBiff(bytes, { ...context, limits: { ...context.limits, workbookWork: 20 } })).rejects.toThrow("limit");
  const controller = new AbortController(); controller.abort(new Error("cancel BIFF7"));
  await expect(readBiff(bytes, { ...context, signal: controller.signal })).rejects.toThrow("cancel BIFF7");
});
it("decodes Windows-1252 link identities without changing their spelling", async () => {
  const book = await readBiff(fixture([link("\x01[prix\x80.xls]Caf\xe9")], [token("cell", 1)]), context);
  const requests: unknown[] = [];
  recalculateWorkbook(book, { ...context, externalReferences: { resolve(request) { requests.push(request); return undefined; } } }, true);
  expect(requests).toMatchObject([{ first: { workbook: "prix€.xls", sheet: "Café" } }]);
});
