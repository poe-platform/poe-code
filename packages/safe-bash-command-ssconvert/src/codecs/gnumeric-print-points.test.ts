import { expect, it } from "vitest";
import type { ImportedValue, Workbook } from "../workbook.js";
import type { CapabilityContext } from "../contracts.js";
import { writeGnumeric } from "./gnumeric.js";
const namespace = "http://www.gnumeric.org/v10.dtd";
const node = (name: string, attrs: Record<string, string>, children: ImportedValue[] = [], ns = namespace): ImportedValue => ({ name, namespace: ns, text: "",
  attributes: Object.entries(attrs).map(([name, value]) => ({ name, namespace: "", value })), children });
const context: CapabilityContext = { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 1000000, outputBytes: 1000000, cells: 100, sheets: 4, operations: 10000 } };
it("formats print margin points at the XML boundary without rounding the workbook model", async () => {
  const book: Workbook = { sheets: [{ id: "s", name: "Data", cells: [], unsupportedRecords: [{ source: "Gnumeric_XmlIO:sax", kind: "PrintInformation", disposition: "retained",
    data: node("PrintInformation", {}, [node("Margins", {}, [node("top", { Points: "21.599999999999998", PrefUnit: "mm" }), node("left", { Points: "8.888832" })])]) }] }] };
  const before = structuredClone(book), output = new TextDecoder().decode(await writeGnumeric(book, [], context));
  expect(output).toContain('<gnm:top Points="21.6" PrefUnit="mm"/>');
  expect(output).toContain('<gnm:left Points="8.889"/>');expect(book).toEqual(before);
});
it("does not round foreign or unrelated retained Points attributes", async () => {
  const book: Workbook = { sheets: [{ id: "s", name: "Data", cells: [], unsupportedRecords: [{ source: "Gnumeric_XmlIO:sax", kind: "PrintInformation", disposition: "retained",
    data: node("PrintInformation", {}, [node("Margins", {}, [node("top", { Points: "8.888832" }, [], "urn:foreign"), node("extension", { Points: "8.888832" })]), node("left", { Points: "8.888832" })]) }] }] };
  const output = new TextDecoder().decode(await writeGnumeric(book, [], context));expect(output.split('Points="8.888832"')).toHaveLength(4);
});
