import { expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import type { CapabilityContext } from "../contracts.js";
import type { ImportedValue, Workbook } from "../workbook.js";
import { resizeWorkbookReferences } from "./resize.js";

const ns = "http://www.gnumeric.org/v10.dtd";
const node = (name: string, values: Record<string, string>, children: ImportedValue[] = []): ImportedValue => ({ name, namespace: ns, text: "",
  attributes: Object.entries(values).map(([name, value]) => ({ name, namespace: "", value })), children });
const context = (): CapabilityContext => ({ limits: { sheets: 8, cells: 100, inputBytes: 100000, outputBytes: 100000, operations: 100 },
  signal: new AbortController().signal, environment: { env: {}, locale: "C", timezone: "UTC" }, own() {} });
const selections = (start: number, end: number) => node("Selections", { CursorCol: "125", CursorRow: "125" }, [
  node("Selection", { startCol: String(start), startRow: String(start), endCol: String(end), endRow: String(end) })
]);
const book = (data: ImportedValue, selection = "DT126"): Workbook => ({ sheets: [{ id: "s", name: "Small", visibility: "hidden",
  size: { rows: 256, columns: 256 }, cells: [], view: { selection }, unsupportedRecords: [
    { source: "Gnumeric_XmlIO:sax", kind: "Selections", disposition: "retained", data }
  ] }] });

it("clips crossing selections and resets the cursor to their surviving start", () => {
  const input = book(selections(120, 150));
  const result = resizeWorkbookReferences(input, "s", { rows: 128, columns: 128 }, context());
  expect(result.sheets[0]!.unsupportedRecords![0]!.data).toEqual(node("Selections", { CursorCol: "120", CursorRow: "120" }, [
    node("Selection", { startCol: "120", startRow: "120", endCol: "127", endRow: "127" })
  ]));
  expect(input.sheets[0]!.unsupportedRecords![0]!.data).toEqual(selections(120, 150));
  expect(result.sheets[0]!.visibility).toBe("hidden");
});

it("falls back to A1 when all retained selections disappear", () => {
  const result = resizeWorkbookReferences(book(selections(200, 210), "GS201"), "s", { rows: 128, columns: 128 }, context());
  expect(result.sheets[0]!.view!.selection).toBe("A1");
  expect(result.sheets[0]!.unsupportedRecords![0]!.data).toEqual(node("Selections", { CursorCol: "0", CursorRow: "0" }, [
    node("Selection", { startCol: "0", startRow: "0", endCol: "0", endRow: "0" })
  ]));
});

it("does not change selection metadata when the dimensions are unchanged", () => {
  const input = book(selections(120, 150));
  expect(resizeWorkbookReferences(input, "s", { rows: 256, columns: 256 }, context())).toEqual(input);
});

it("preserves surviving selection order and ignores foreign cursor attributes", () => {
  const data = node("Selections", { CursorCol: "125", CursorRow: "125" }, [
    node("Selection", { startCol: "120", startRow: "120", endCol: "150", endRow: "150" }),
    node("Selection", { startCol: "200", startRow: "200", endCol: "210", endRow: "210" }),
    node("Selection", { startCol: "4", startRow: "5", endCol: "6", endRow: "7" })
  ]) as { readonly [key: string]: ImportedValue };
  const foreign = { name: "CursorCol", namespace: "urn:review:foreign", value: "999" };
  const input = book({ ...data, attributes: [...data.attributes as ImportedValue[], foreign] });
  const result = resizeWorkbookReferences(input, "s", { rows: 128, columns: 128 }, context());
  expect(result.sheets[0]!.unsupportedRecords![0]!.data).toEqual({
    ...node("Selections", { CursorCol: "4", CursorRow: "5" }, [
      node("Selection", { startCol: "120", startRow: "120", endCol: "127", endRow: "127" }),
      node("Selection", { startCol: "4", startRow: "5", endCol: "6", endRow: "7" })
    ]) as { readonly [key: string]: ImportedValue },
    attributes: [{ name: "CursorCol", namespace: "", value: "4" }, { name: "CursorRow", namespace: "", value: "5" }, foreign]
  });
});

it("expands to maximum dimensions without materializing cells or axis metadata", () => {
  const input = book(selections(120, 150));
  const result = resizeWorkbookReferences(input, "s", { rows: 16777216, columns: 16384 }, context());
  expect(result.sheets[0]!.cells).toEqual([]);
  expect(result.sheets[0]!.rows).toBeUndefined();
  expect(result.sheets[0]!.columns).toBeUndefined();
  expect(result.sheets[0]!.unsupportedRecords).toHaveLength(1);
});

it("matches named mixed-axis ranges at a disappearing nonzero parse position", () => {
  const expressions = ["=A200", "=$A200", "=A$200", "=$A$200", "=A100:A200", "=A200:$A$100", "=$IV100:$IV200", "=IV200:A100", "=A100:$IV200"];
  const input: Workbook = { sheets: [{ id: "s", name: "Small", size: { rows: 256, columns: 256 }, cells: [] }],
    names: expressions.map((expression, i) => ({ name: `N${i}`, expression, sheet: "s", position: { sheet: "s", row: 200, column: 200 } })) };
  const result = resizeWorkbookReferences(input, "s", { rows: 128, columns: 128 }, context());
  expect(result.names!.map(n => n.expression)).toEqual(["=A72", "=$A72", "=#REF!", "=#REF!", "=A72:A100", "=A72:$A$100", "=#REF!", "=A72:DX100", "=A72:$DX100"]);
  expect(result.names!.map(n => n.position)).toEqual(input.names!.map(n => n.position));
});

it("rejects style work exhaustion and preserves an arbitrary cancellation reason by identity", () => {
  const input = book(selections(120, 150));
  const ctx = context();
  expect(() => resizeWorkbookReferences(input, "s", { rows: 128, columns: 128 }, { ...ctx, limits: { ...ctx.limits, workbookWork: 0 } })).toThrow(/limit/);
  const controller = new AbortController();
  const reason = { resize: "cancelled" }; controller.abort(reason);
  let caught: unknown;
  try { resizeWorkbookReferences(input, "s", { rows: 128, columns: 128 }, { ...ctx, signal: controller.signal }); } catch (error) { caught = error; }
  expect(caught).toBe(reason);
  expect(input.sheets[0]!.size).toEqual({ rows: 256, columns: 256 });
});

it("refuses unsupported foreign prototypes and accessor authority without reading accessors", () => {
  const input: Workbook = runInNewContext('({sheets:[{id:"s",name:"Small",size:{rows:256,columns:256},cells:[{row:200,column:200,value:{kind:"string",value:"lost"}}]}]})');
  expect(() => resizeWorkbookReferences(input, "s", { rows: 128, columns: 128 }, context())).toThrow("Unsupported workbook prototype");
  expect(input.sheets[0]!.cells).toHaveLength(1);
  let reads = 0;
  const hostile = Object.defineProperty({}, "selection", { enumerable: true, get() { reads++; return "A1"; } });
  expect(() => resizeWorkbookReferences({ sheets: [{ ...book(selections(120, 150)).sheets[0]!, view: hostile }] }, "s", { rows: 128, columns: 128 }, context())).toThrow(/accessor/);
  expect(reads).toBe(0);
});
