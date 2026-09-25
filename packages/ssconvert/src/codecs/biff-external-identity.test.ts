import { expect, it } from "vitest";
import { recalculateWorkbook } from "../formulas/evaluator.js";
import { biffExternalPath } from "./biff-external-path.js";
import { readBiff } from "./biff.js";
import { parseExpression } from "../formulas/parser.js";
import type { CapabilityContext } from "../contracts.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 4, operations: 1000 } };
function join(...parts: Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let at = 0; for (const part of parts) { bytes.set(part, at); at += part.length; } return bytes;
}
function words(...values: number[]): Uint8Array {
  const bytes = new Uint8Array(values.length * 2), view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setUint16(index * 2, value, true)); return bytes;
}
function record(opcode: number, payload: Uint8Array = new Uint8Array()): Uint8Array {
  return join(words(opcode, payload.length), payload);
}
function text(value: string, revision: number, wideLength = true): Uint8Array {
  const wide = revision === 8 && Array.from(value).some(c => c.charCodeAt(0) > 255);
  const data = new Uint8Array(value.length * (wide ? 2 : 1));
  for (let i = 0; i < value.length; i++) {
    data[i * (wide ? 2 : 1)] = value.charCodeAt(i) & 255;
    if (wide) data[i * 2 + 1] = value.charCodeAt(i) >>> 8;
  }
  return join(wideLength ? words(value.length) : new Uint8Array([value.length]),
    revision === 8 ? new Uint8Array([Number(wide)]) : new Uint8Array(), data);
}
// Independent record fixtures: the production writer is deliberately not used.
function fixture(revision: 7 | 8, kind: "cell" | "range" | "global-name" | "sheet-name", rawClass: number, path = "\u0001book.xls", sheet = "Other", spelling = "Rate"): Uint8Array {
  const modern = revision === 8, name = kind.endsWith("name"), range = kind === "range";
  const prefix = new Uint8Array(modern ? name ? 6 : 2 : name ? 24 : 14);
  const view = new DataView(prefix.buffer);
  view.setUint16(0, modern ? 0 : 1, true);
  if (name) view.setUint16(modern ? 2 : 10, 1, true);
  const reference = name ? new Uint8Array() : modern ? range ? words(0, 1, 0, 1) : words(0, 0) :
    range ? new Uint8Array([0, 0, 1, 0, 0, 1]) : new Uint8Array([0, 0, 0]);
  const tokens = join(new Uint8Array([(name ? 0x39 : range ? 0x3b : 0x3a) + rawClass]), prefix, reference);
  const cell = new Uint8Array(22 + tokens.length), cellView = new DataView(cell.buffer);
  cellView.setFloat64(6, 42, true); cellView.setUint16(20, tokens.length, true); cell.set(tokens, 22);
  const book = modern ? record(0x1ae, join(words(1), text(path, 8), text(sheet, 8))) :
    record(0x17, text("\u0001[book.xls]Other", 7, false));
  const externalName = name ? record(0x23, join(words(0, kind === "sheet-name" ? 1 : 0, 0),
    text(spelling, revision, false), words(2), new Uint8Array([0x1c, 23]))) : new Uint8Array();
  return join(record(0x809, words(modern ? 0x600 : 0x500, 5)), book, externalName,
    modern ? record(0x17, words(1, 0, 0, 0)) : new Uint8Array(), record(10),
    record(0x809, words(modern ? 0x600 : 0x500, 16)), record(6, cell), record(10));
}
for (const revision of [8] as const) for (const kind of ["cell", "range", "global-name", "sheet-name"] as const)
  for (const tokenClass of [0, 0x20, 0x40]) it(`imports original BIFF${revision} ${kind} class ${tokenClass}`, async () => {
    let accesses = 0;
    const book = await readBiff(fixture(revision, kind, tokenClass), { ...context,
      externalReferences: { resolve() { accesses++; throw new Error("unexpected external fetch"); } } });
    expect(accesses).toBe(0);
    const cell = book.sheets[0]!.cells[0]!;
    expect(cell.cachedResult).toEqual({ kind: "number", value: 42 });
    expect(cell.formula).toBeDefined();
    const parsed = parseExpression(cell.formula!, { workbook: book, position: { sheet: book.sheets[0]!.id, row: 0, column: 0 } });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("unparseable imported formula");
    expect(parsed.document.root).toMatchObject(kind.endsWith("name") ? {
      kind: "name", workbook: "book.xls", name: "Rate", ...(kind === "sheet-name" ? { sheet: "Other" } : {})
    } : { kind: "reference", first: { workbook: "book.xls", sheet: "Other" } });
  });

for (const [path, expected] of [
  ["\u0001book.xls", "book.xls"],
  ["\u0001\u0001Cdir\u0003book.xls", "C:\\dir\\book.xls"],
  ["\u0001\u0001@server\u0003book.xls", "\\\\server\\book.xls"],
  ["\u0001\u0002dir\u0003book.xls", "\\dir\\book.xls"],
  ["\u0001\u0004book.xls", "..\\book.xls"],
  ["plain.xls", "plain.xls"],
  ["\u0001'book] name.xls", "'book] name.xls"],
  ["\u0001表.xls", "表.xls"]
] as const) it(`preserves encoded external path ${JSON.stringify(path)} and quoted sheet identity`, async () => {
  expect(biffExternalPath(path)).toBe(expected);
  const imported = await readBiff(fixture(8, "cell", 0, path, "O'Brien\\表"), context);
  const requests: unknown[] = [];
  const calculated = recalculateWorkbook(imported, { ...context, externalReferences: {
    resolve(request) { requests.push(request); return { kind: "number", value: 84 }; }
  } }, true);
  expect(requests).toMatchObject([{ kind: "reference", first: { workbook: expected, sheet: "O'Brien\\表" } }]);
  expect(calculated.sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 84 });
});
it("decodes length-prefixed raw URLs without interpreting their punctuation", async () => {
  const url = "https://example.test/a[b] c.xls";
  const book = await readBiff(fixture(8, "cell", 0, "\u0001\u0005" + String.fromCharCode(url.length) + url), context);
  const requests: unknown[] = [];
  recalculateWorkbook(book, { ...context, externalReferences: { resolve(request) { requests.push(request); return undefined; } } }, true);
  expect(requests).toMatchObject([{ first: { workbook: url } }]);
});
it.each(["cell", "range", "global-name", "sheet-name"] as const)("resolves %s only through the explicitly supplied host", async kind => {
  const book = await readBiff(fixture(8, kind, 0), context);
  expect(recalculateWorkbook(book, context, true).sheets[0]!.cells[0]!.value).toEqual({ kind: "error", value: "#REF!" });
  const requests: unknown[] = [];
  const calculated = recalculateWorkbook(book, { ...context, externalReferences: { resolve(request, signal) {
    expect(signal).toBe(context.signal); requests.push(request); return { kind: "number", value: 123 };
  } } }, true);
  expect(calculated.sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 123 });
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject(kind.endsWith("name") ? { kind: "name", workbook: "book.xls", name: "Rate",
    ...(kind === "sheet-name" ? { sheet: "Other" } : {}) } : { kind: "reference", first: { workbook: "book.xls", sheet: "Other" } });
});
it.each(["Rate+1", "Rate!A1", "Rate)"])("refuses an external name that cannot retain its identity: %s", async spelling => {
  const book = await readBiff(fixture(8, "global-name", 0, "\u0001book.xls", "Other", spelling), context);
  expect(book.sheets[0]!.cells[0]!.formula).toBeUndefined();
});
it("keeps an unsupported external namespace unbound", async () => {
  const book = await readBiff(fixture(8, "global-name", 0, "app\u0003topic"), context);
  expect(book.sheets[0]!.cells[0]!.formula).toBeUndefined();
});
it.each(["\u0001\u0001", "\u0001\u0005", "\u0001\u0005\u0004ab", "x".repeat(256)])("rejects malformed VirtualPath %j", async path => {
  await expect(readBiff(fixture(8, "cell", 0, path), context)).rejects.toThrow("Invalid Excel BIFF");
});
it("enforces cumulative text/work admission and pre-aborted signals", async () => {
  const input = fixture(8, "cell", 0);
  await expect(readBiff(input, { ...context, limits: { ...context.limits, workbookTextBytes: 25 } })).rejects.toThrow("limit");
  await expect(readBiff(input, { ...context, limits: { ...context.limits, workbookWork: 20 } })).rejects.toThrow("limit");
  const controller = new AbortController(); controller.abort(new Error("stopped external import"));
  await expect(readBiff(input, { ...context, signal: controller.signal })).rejects.toThrow("stopped external import");
});
