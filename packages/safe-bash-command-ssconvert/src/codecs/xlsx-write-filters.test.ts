import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import type { ImportedValue, Sheet } from "../workbook.js";
import { createXlsxXml } from "./xlsx-write-support.js";
import { createXlsxStyles } from "./xlsx-write-styles.js";
import { writeXlsxSheetMetadata } from "./xlsx-write-metadata.js";

const namespace = "http://www.gnumeric.org/v10.dtd";
const context: CapabilityContext = { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 3, operations: 100 } };
const filter = (fields: readonly Record<string, string>[], area = "A1:C4"): ImportedValue => ({ name: "Filter", namespace,
  attributes: { Area: area }, children: fields.map(attributes => ({ name: "Field", namespace, attributes, children: [] })) });
async function write(filters: readonly ImportedValue[]) {
  const warnings: string[] = [], xml = createXlsxXml(context), main = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  const sheet: Sheet = { id: "s", name: "S", cells: [], unsupportedRecords: [{ source: "Gnumeric_XmlIO:sax", kind: "Filters", disposition: "retained",
    data: { name: "Filters", namespace, children: filters } }] };
  const result = await writeXlsxSheetMetadata(sheet, 1, xml.element, { ...context, async diagnostic(value) { warnings.push(value.message); } }, main,
    source => source, createXlsxStyles(xml.element, "2008", main, xml.charge), xml.charge);
  return { filters: result.filters, warnings };
}
it("preserves the native reversed Value/ValueType Gnumeric expression attributes", async () => {
  const result = await write([filter([{ Index: "0", Type: "expr", Op0: "eq", Value0: "40", ValueType0: "7" }])]);
  expect(result.filters).toBe('<autoFilter ref="A1:C4"><filterColumn colId="0"><customFilters><customFilter operator="equal" val="7"/></customFilters></filterColumn></autoFilter>');
  expect(result.warnings).toEqual([]);
});
it.each(["0", "1"])("matches native dual expression and=true despite IsAnd=%s", async IsAnd => {
  const result = await write([filter([{ Index: "0", Type: "expr", Op0: "gt", Value0: "40", ValueType0: "7",
    Op1: "lt", Value1: "40", ValueType1: "9", IsAnd }])]);
  expect(result.filters).toContain('<customFilters and="true"><customFilter operator="greaterThan" val="7"/><customFilter operator="lessThan" val="9"/></customFilters>');
  expect(result.warnings).toEqual([]);
});
it.each([
  ["blanks", '<filters blank="1"/>'], ["noblanks", '<customFilters><customFilter operator="notEqual" val=" "/></customFilters>']
])("writes native %s filters", async (Type, expected) => {
  const result = await write([filter([{ Index: "0", Type }])]); expect(result.filters).toContain(expected); expect(result.warnings).toEqual([]);
});
it.each([
  [{ top: "1", items: "1", rel_range: "1", count: "10" }, '<top10 val="10"/>'],
  [{ top: "0", items: "1", rel_range: "0", count: "10.9" }, '<top10 val="10" top="0"/>'],
  [{ top: "1", items: "0", rel_range: "1", count: "25.5" }, '<top10 val="25.5" percent="1"/>'],
  [{ top: "0", items: "0", rel_range: "1", count: "200" }, '<top10 val="100" top="0" percent="1"/>']
])("writes native bucket omission/clamping behavior (%j)", async (attributes, expected) => {
  const result = await write([filter([{ Index: "0", Type: "bucket", ...attributes }])]); expect(result.filters).toContain(expected); expect(result.warnings).toEqual([]);
});
it("orders fields ascending even when Gnumeric records store descending indices", async () => {
  const result = await write([filter([{ Index: "2", Type: "blanks" }, { Index: "0", Type: "blanks" }])]);
  expect(result.filters.indexOf('colId="0"')).toBeLessThan(result.filters.indexOf('colId="2"'));
});
it("writes only the first native filter and reports additional discarded filters", async () => {
  const result = await write([filter([{ Index: "0", Type: "blanks" }]), filter([{ Index: "0", Type: "blanks" }], "D1:F4")]);
  expect(result.filters).not.toContain('ref="D1:F4"'); expect(result.warnings).toHaveLength(1);
});
it.each([
  { Type: "bucket", items: "0", rel_range: "0", count: "25" },
  { Type: "average" }, { Type: "nonblanks" },
  { Type: "expr", Op0: "constructor", Value0: "40", ValueType0: "7" }
])("warns and omits unsupported filter field variants (%j)", async attributes => {
  const result = await write([filter([{ Index: "0", ...attributes }])]);
  expect(result.filters).not.toContain("filterColumn"); expect(result.warnings).toHaveLength(1);
});
it("does not export a valid second expression when the native first expression is malformed", async () => {
  const result = await write([filter([{ Index: "0", Type: "expr", Op0: "eq", Value0: "40", ValueType0: "bad",
    Op1: "eq", Value1: "40", ValueType1: "7" }])]);
  expect(result.filters).not.toContain("filterColumn"); expect(result.warnings).toHaveLength(1);
});
it("warns for an expression field with an invalid index", async () => {
  const result = await write([filter([{ Index: "-1", Type: "expr", Op0: "eq", Value0: "40", ValueType0: "7" }])]);
  expect(result.filters).not.toContain("filterColumn"); expect(result.warnings).toHaveLength(1);
});
it("warns for fields outside the filter area width", async () => {
  const result = await write([filter([{ Index: "3", Type: "blanks" }])]);
  expect(result.filters).not.toContain("filterColumn"); expect(result.warnings).toHaveLength(1);
});
it.each([
  ["40", "7.00", "7"], ["20", "true", "TRUE"], ["60", "a&b", "a&amp;b"], ["50", "#N/A", "#N/A"]
])("serializes canonical native expression type %s", async (Value0, ValueType0, expected) => {
  const result = await write([filter([{ Index: "0", Type: "expr", Op0: "eq", Value0, ValueType0 }])]);
  expect(result.filters).toContain(`val="${expected}"`); expect(result.warnings).toEqual([]);
});
