import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { recalculateWorkbook } from "../formulas/evaluator.js";
import { readLotus } from "./lotus.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 10000, outputBytes: 10000, cells: 10, sheets: 4, operations: 100 } };
const record = (id: number, data: number[] = []) => [id, 0, data.length & 255, data.length >>> 8, ...data];

// ICU 049e0d6a mapping files independently confirmed with native ICU 76.1.
// These national characters were omitted by the legacy Gnumeric tables;
// lmb-excp maps the two ligatures to their assigned Unicode code points.
const vectors = [
  {"group": 1, "encoded": [98, 99], "text": "\ufb01\ufb02"},
  {"group": 3, "encoded": [128, 129, 136, 138, 140, 141, 142, 143, 144, 154, 156, 157, 158, 159, 161, 170, 184, 186, 191, 215, 216], "text": "\u20ac\u0081\u02c6\u008a\u008c\u008d\u008e\u008f\u0090\u009a\u009c\u009d\u009e\u009f\u00a1\u00d7\u00b8\u00f7\u00bf\u05f3\u05f4"},
  {"group": 4, "encoded": [128, 138, 143, 152, 154, 159, 170, 192, 255], "text": "\u20ac\u0679\u0688\u06a9\u0691\u06ba\u06be\u06c1\u06d2"},
  {"group": 5, "encoded": [136, 152], "text": "\u20ac\u0098"},
  {"group": 8, "encoded": [128, 129, 141, 142, 143, 144, 157, 158], "text": "\u20ac\u0081\u008d\u008e\u008f\u0090\u009d\u009e"},
  {"group": 11, "encoded": [128, 129, 130, 131, 132, 134, 135, 136, 137, 138, 139, 140, 141, 142, 143, 144, 152, 153, 154, 155, 156, 157, 158, 159, 219, 220, 221, 222, 252, 253, 254, 255], "text": "\u20ac\u0081\u0082\u0083\u0084\u0086\u0087\u0088\u0089\u008a\u008b\u008c\u008d\u008e\u008f\u0090\u0098\u0099\u009a\u009b\u009c\u009d\u009e\u009f\uf8c1\uf8c2\uf8c3\uf8c4\uf8c5\uf8c6\uf8c7\uf8c8"}
];

it.each(vectors)("preserves national group $group characters in labels and recalculated strings", async ({ group, encoded, text }) => {
  const explicit = encoded.flatMap(byte => [group, byte]);
  // Exception characters require a group prefix; ordinary low bytes are ASCII.
  const raw = group === 1 ? [65, ...explicit, 90, 0] : [65, ...encoded, 90, ...explicit, 81, 0];
  const expected = group === 1 ? `A${text}Z` : `A${text}Z${text}Q`;
  const bytes = Uint8Array.from([
    ...record(0, [2, 16, 4, 0, ...Array<number>(12).fill(0), group, ...Array<number>(9).fill(0)]),
    ...record(22, [0, 0, 0, 0, 39, ...raw]),
    ...record(25, [0, 0, 0, 1, ...Array<number>(10).fill(0), 6, ...raw, 3]), ...record(1)
  ]);
  const warnings: string[] = [];
  const book = await readLotus(bytes, { ...context, async diagnostic(d) { warnings.push(d.message); } });
  expect(recalculateWorkbook(book, context, true).sheets[0]!.cells.map(cell => cell.value)).toEqual([
    { kind: "string", value: expected }, { kind: "string", value: expected }
  ]);
  expect(warnings).toEqual([]);
});

it.each(vectors)("binds national group $group names without dropping their distinguishing character", async ({ group, encoded, text }) => {
  const name = [78, group, encoded[0]!];
  const bytes = Uint8Array.from([
    ...record(0, [2, 16, ...Array<number>(14).fill(0), 1, 0, 0]),
    ...record(9, [0, 0, ...name, ...Array<number>(16 - name.length).fill(0), ...Array<number>(8).fill(0)]),
    ...record(24, [0, 0, 0, 0, 14, 0]),
    ...record(25, [0, 0, 0, 1, ...Array<number>(10).fill(0), 7, ...name, 0, 3]), ...record(1)
  ]);
  const book = await readLotus(bytes, context);
  expect(book.names?.map(name => name.name)).toEqual([`N${text[0]}`]);
  expect(recalculateWorkbook(book, context, true).sheets[0]!.cells[1]!.value).toEqual({ kind: "number", value: 7 });
});
