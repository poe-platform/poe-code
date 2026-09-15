import { expect, it } from "vitest";
import { DocumentBudget } from "./budget.js";
import { ResourceLimitError } from "./archive.js";
import { decodeDocxText, docxByteLength, copyDocxBytes, DocxUsageError, parseDocxJson, validateOriginalDocumentContent, validateTemplateData } from "./argument-json.js";

it("decodes exact UTF-8 arguments without silently removing a BOM", () => {
  expect(decodeDocxText(new TextEncoder().encode("\uFEFF/文/🌷.docx"))).toBe("\uFEFF/文/🌷.docx");
  for (const input of [[0xff], [0xc0, 0xaf], [0xed, 0xa0, 0x80], [0xe2, 0x82]])
    expect(() => decodeDocxText(Uint8Array.from(input))).toThrow(DocxUsageError);
});

it("accepts exact JSON values and a single leading source BOM", () => {
  expect(parseDocxJson('\uFEFF{"text":"quoted \\"text\\" 🌷","n":1.5,"empty":"","nil":null}'))
    .toEqual({ text: 'quoted "text" 🌷', n: 1.5, empty: "", nil: null });
  expect(parseDocxJson(new TextEncoder().encode('["\\ud83c\\udf37",true,false]'))).toEqual(["🌷", true, false]);
});

it("rejects malformed and ambiguous JSON before dispatch", () => {
  for (const input of ['{"a":1,"a":2}', '{"a":1,"\\u0061":2}', '{"__proto__":{}}', '{"x":{"constructor":1}}',
    '{"prototype":0}', '1e999', '9007199254740993', '"\\ud800"', '"\ud800"', '[1,]', '{"a":1,}',
    '/*x*/{}', '\uFEFF\uFEFF{}', '01', '+1', '1.', '1e', '[undefined]', '{} trailing', '"a\n"'])
    expect(() => parseDocxJson(input), input).toThrow(DocxUsageError);
  expect(new DocxUsageError("bad input")).toMatchObject({ code: "usage", exitCode: 2 });
});
it("admits exactly represented large finite JSON numbers without rounding integral tokens", () => {
  for (const input of ["10000000000000000", "1e16", "1.000e16", "9007199254740992", "-9007199254740992", "0e999999999999999999999", "-0e-999999999999999999999"]) expect(parseDocxJson(input)).toBe(Number(input));
  for (const input of ["9007199254740993", "9007199254740993.0", "9007199254740993e0", "9.007199254740993e15", "-9007199254740993", "1e23", "1.00000000000000000000001e23"]) expect(() => parseDocxJson(input), input).toThrow(DocxUsageError);
  expect(parseDocxJson("0.1")).toBe(0.1);
  expect(parseDocxJson("1e-999999999999999999999")).toBe(0);
});
it("admits finite binding scalars while retaining shared length range guards", () => {
  for (const value of [1e16, -1e16, Number.MAX_VALUE]) expect(validateTemplateData({ values: [{ binding: "measurement", value }] })).toBe(true);
  for (const value of [NaN, Infinity, -Infinity]) expect(validateTemplateData({ values: [{ binding: "measurement", value }] })).toBe(false);
  expect(validateOriginalDocumentContent({ version: 1, blocks: [], page: { width: { value: 1e16, unit: "cm" } } })).toBe(false);
});
it("admits numeric-token resources before precision conversion or expansion", () => {
  expect(() => parseDocxJson("1e16", new DocumentBudget({ work: 1 }))).toThrow(ResourceLimitError);
  expect(() => parseDocxJson("1e16", new DocumentBudget({ retainedBytes: 1 }))).toThrow(ResourceLimitError);
});

it("bounds JSON bytes, values, nesting and retained strings", () => {
  for (const [input, limits] of [
    ['"🌷"', { xmlPartBytes: 5 }], ['[1,2]', { xmlNodes: 2 }], ['[[0]]', { xmlDepth: 2 }],
    ['{"a":"🌷"}', { retainedBytes: 4 }]
  ] as const) expect(() => parseDocxJson(input, new DocumentBudget(limits))).toThrow(ResourceLimitError);
});

it("validates closed original content recursively with exclusive paragraph fields", () => {
  expect(validateOriginalDocumentContent({ version: 1, blocks: [] })).toBe(true);
  expect(validateOriginalDocumentContent({ version: 1, blocks: [{ kind: "paragraph", text: "" },
    { kind: "table", rows: [[{ blocks: [] }]] }] })).toBe(true);
  for (const block of [{ kind: "paragraph", text: "x", runs: [] }, { kind: "paragraph", style: "A", level: 1 },
    { kind: "paragraph", extra: true }, { kind: "paragraph", runs: [{ text: "a", bold: "true" }] },
    { kind: "table", rows: [] }, { kind: "table", rows: [[{ blocks: [] }], []] }])
    expect(validateOriginalDocumentContent({ version: 1, blocks: [block] })).toBe(false);
  expect(validateOriginalDocumentContent({ version: 1, blocks: [{ kind: "paragraph", text: undefined }] })).toBe(true);
  const cycle: { kind: string; rows: unknown[][] } = { kind: "table", rows: [] };
  cycle.rows = [[{ blocks: [cycle] }]];
  expect(validateOriginalDocumentContent({ version: 1, blocks: [cycle] })).toBe(false);
});

it("validates typed template bindings and rejects duplicate IDs or null values", () => {
  expect(validateTemplateData([])).toBe(true);
  expect(validateTemplateData({ values: [{ binding: "title", value: "" }, { binding: "count", value: 1 }] })).toBe(true);
  for (const value of [null, { values: [{ binding: "a", value: null }] },
    { values: [{ binding: "a", value: 1 }, { binding: "a", value: 2 }] },
    { values: [{ binding: "", value: true }] }, { values: [], extra: true }])
    expect(validateTemplateData(value)).toBe(false);
});

it("rejects sparse, accessor and customized content arrays without invoking user code", () => {
  let calls = 0;
  const accessed = new Array(1);
  Object.defineProperty(accessed, "0", { get() { calls++; return { kind: "paragraph" }; } });
  class CustomBlocks extends Array<unknown> {}
  Object.defineProperty(CustomBlocks.prototype, "every", { value() { calls++; return true; } });
  const methods: unknown[] = [];
  Object.defineProperty(methods, "every", { value() { calls++; return true; } });
  for (const blocks of [accessed, new CustomBlocks(), methods, new Array(1)])
    expect(validateOriginalDocumentContent({ version: 1, blocks })).toBe(false);
  expect(calls).toBe(0);
});

it("rejects custom table rows, run arrays and template values before reading their items", () => {
  let calls = 0;
  const array = new Array(1);
  Object.defineProperty(array, "0", { get() { calls++; return {}; } });
  expect(validateOriginalDocumentContent({ version: 1, blocks: [{ kind: "table", rows: array }] })).toBe(false);
  expect(validateOriginalDocumentContent({ version: 1, blocks: [{ kind: "paragraph", runs: array }] })).toBe(false);
  expect(validateTemplateData(array)).toBe(false);
  expect(validateTemplateData({ values: array })).toBe(false);
  expect(calls).toBe(0);
});

it("reads byte-source sizes intrinsically without consulting user accessors", () => {
  let calls = 0;
  const bytes = new TextEncoder().encode('{"text":"safe"}');
  Object.defineProperty(bytes, "byteLength", { get() { calls++; return 0; } });
  expect(parseDocxJson(bytes)).toEqual({ text: "safe" });
  expect(() => parseDocxJson(bytes, new DocumentBudget({ xmlPartBytes: 1 }))).toThrow(ResourceLimitError);
  expect(calls).toBe(0);
});


it("copies only genuine byte views without using customized iteration or properties", () => {
  let calls = 0;
  const bytes = new Uint8Array([0, 128, 255]);
  Object.defineProperty(bytes, Symbol.iterator, { value() { calls++; throw new Error("iterator invoked"); } });
  for (const name of ["byteLength", "length", "buffer", "byteOffset"])
    Object.defineProperty(bytes, name, { get() { calls++; return 0; } });
  expect(docxByteLength(bytes)).toBe(3);
  const copy = copyDocxBytes(bytes);
  expect(Array.from(copy)).toEqual([0, 128, 255]);
  copy[0] = 1;
  expect(bytes[0]).toBe(0);
  expect(calls).toBe(0);
  for (const value of [new DataView(new ArrayBuffer(2)), new Uint16Array(2), {}, null]) {
    expect(() => docxByteLength(value as Uint8Array)).toThrow(DocxUsageError);
    expect(() => copyDocxBytes(value as Uint8Array)).toThrow(DocxUsageError);
  }
});
