import { expect, it } from "vitest";
import { resizeWorkbookReferences } from "../formulas/workbook.js";
import { runConversionTransforms } from "../conversion/transforms.js";
import type { CapabilityContext } from "../contracts.js";
import type { Workbook } from "../workbook.js";

const context = (): CapabilityContext => ({ limits: { sheets: 8, cells: 100, inputBytes: 100000, outputBytes: 100000, operations: 100 },
  signal: new AbortController().signal, environment: { env: {}, locale: "C", timezone: "UTC" }, own() {} });
const book: Workbook = { calculationMode: "manual", sheets: [{ id: "s", name: "Small", size: { rows: 256, columns: 256 },
  cells: [{ row: 199, column: 0, value: { kind: "blank" }, formula: "=1", formulaGroup: "gone" }],
  formulaGroups: [{ id: "gone", kind: "array", expression: "=1", range: { startRow: 199, endRow: 200, startColumn: 0, endColumn: 1 } }] }] };

it("deletes arrays entirely in disappearing rows instead of failing resize", () => {
  const resized = resizeWorkbookReferences(book, "s", { rows: 128, columns: 128 }, context());
  expect(resized.sheets[0]).toMatchObject({ size: { rows: 128, columns: 128 }, cells: [], formulaGroups: [] });
  expect(book.sheets[0]!.cells).toHaveLength(1);
});

it("keeps invalid parsed dimensions nonfatal and retains the workbook", async () => {
  const messages: string[] = [];
  const result = await runConversionTransforms(book, { input: { kind: "resource", uri: "/in" }, resizeExpression: "129x128", verbose: true }, { codecs: [], limits: context().limits, environment: context().environment },
    { ...context(), async diagnostic(d) { messages.push(d.message); } }, () => {});
  expect(result.book).toEqual(book);
  expect(messages[0]).toBe("Resizing to 129x128");
});

it("keeps split arrays unchanged but warns and continues for split merges", async () => {
  const split = { startRow: 126, endRow: 129, startColumn: 0, endColumn: 1 };
  const input: Workbook = { calculationMode: "manual", sheets: [
    { id: "m", name: "Merge", cells: [], merges: [split], size: { rows: 256, columns: 256 } },
    { id: "a", name: "Array", cells: [], formulaGroups: [{ id: "x", kind: "array", expression: "=1", range: split }], size: { rows: 256, columns: 256 } }
  ] };
  const messages: string[] = [];
  const result = await runConversionTransforms(input, { input: { kind: "resource", uri: "/in" }, resizeExpression: "128x128", verbose: true }, { codecs: [], limits: context().limits, environment: context().environment },
    { ...context(), async diagnostic(d) { messages.push(d.message); } }, () => {});
  expect(result.book).toEqual(input);
  expect(messages).toEqual(["Resizing to 128x128", "Resizing of sheet Merge failed"]);
});

const region = (end: number) => ({ name: "StyleRegion", namespace: "http://www.gnumeric.org/v10.dtd", text: "", attributes:
  [{ name: "startCol", namespace: "", value: "0" }, { name: "startRow", namespace: "", value: "0" },
    { name: "endCol", namespace: "", value: String(end) }, { name: "endRow", namespace: "", value: String(end) }],
  children: [{ name: "Style", namespace: "http://www.gnumeric.org/v10.dtd", text: "", attributes: [{ name: "Format", namespace: "", value: "0.00" }], children: [] }] });

it("clips retained style rectangles without retaining out-of-bounds formatting", () => {
  const input: Workbook = { sheets: [{ id: "s", name: "Style", cells: [], size: { rows: 256, columns: 256 },
    unsupportedRecords: [{ source: "Gnumeric_XmlIO:sax", kind: "Styles", disposition: "retained", data:
      { name: "Styles", namespace: "http://www.gnumeric.org/v10.dtd", text: "", attributes: [], children: [region(255)] } }] }] };
  const result = resizeWorkbookReferences(input, "s", { rows: 128, columns: 128 }, context());
  const data = result.sheets[0]!.unsupportedRecords![0]!.data as ReturnType<typeof region>;
  expect(data.children[0]!.attributes.filter(a => a.name.startsWith("end")).map(a => a.value)).toEqual(["127", "127"]);
});

it("does not dirty formula caches for an unchanged sheet size", () => {
  const input: Workbook = { sheets: [{ id: "s", name: "Same", size: { rows: 128, columns: 128 }, cells:
    [{ row: 0, column: 0, value: { kind: "number", value: 1 }, formula: "=1" }] }] };
  expect(resizeWorkbookReferences(input, "s", { rows: 128, columns: 128 }, context())).toEqual(input);
});
