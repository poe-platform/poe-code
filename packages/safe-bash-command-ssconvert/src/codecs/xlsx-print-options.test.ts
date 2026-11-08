import { expect, it } from "vitest";
import { parseXmlSteps, type XmlElement } from "@poe-code/safe-fs/xml";
import type { CapabilityContext } from "../contracts.js";
import type { ImportedValue, Workbook } from "../workbook.js";
import { biffNode } from "./biff-metadata.js";
import { writeBiffStream } from "./biff-write.js";
import { readBiff } from "./biff.js";
import { readXlsxMetadata } from "./xlsx-metadata.js";
import { createXlsxWriter, readXlsx } from "./xlsx.js";
import { metadataNode } from "./xlsx-write-support.js";
const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 4, operations: 1000 } };
const namespace = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const fields = [["headings", "titles"], ["gridLines", "grid"], ["horizontalCentered", "hcenter"], ["verticalCentered", "vcenter"]] as const;
function xml(source: string): XmlElement {
  const parser = parseXmlSteps(source); let step = parser.next(); while (!step.done) step = parser.next(); return step.value;
}
function flags(book: Workbook): number[] {
  const print = metadataNode(book.sheets[0]!.unsupportedRecords?.find(r => r.kind === "PrintInformation")?.data);
  return fields.map(([, target]) => Number(print?.children.find(n => n.name === target)?.attributes.value ?? 0));
}
for (let bits = 0; bits < 16; bits++) {
  const values = fields.map((_, i) => bits >> i & 1);
  it(`imports standalone XLSX print options ${bits} into BIFF7/8`, async () => {
    const attrs = Object.fromEntries(fields.map(([source], i) => [source, values[i] ? "true" : "false"]));
    const sheet = xml(`<worksheet xmlns="${namespace}"><printOptions ${Object.entries(attrs).map(([key, value]) => `${key}="${value}"`).join(" ")}/></worksheet>`);
    const book: Workbook = { sheets: [{ id: "s", name: "S", cells: [], unsupportedRecords: [...readXlsxMetadata(sheet),
      { source: "xl/worksheets/sheet1.xml", kind: "printOptions", disposition: "retained", data: { name: "printOptions", namespace, attributes: attrs, text: "", children: [] } }
    ] }] };
    expect(book.sheets[0]!.unsupportedRecords?.some(r => r.kind === "PrintInformation")).toBe(true);
    expect(flags(book)).toEqual(values);
    for (const revision of [7, 8] as const) {
      const warnings: string[] = [];
      const bytes = await writeBiffStream(book, revision, false, { ...context, async diagnostic(d) { warnings.push(d.message); } });
      expect(flags(await readBiff(bytes, context))).toEqual(values);
      expect(warnings).toEqual([]);
    }
  });
  it(`exports XLSX print flags ${bits} from normalized print metadata`, async () => {
    const book: Workbook = { sheets: [{ id: "s", name: "S", cells: [], unsupportedRecords: [
      { source: "Gnumeric_XmlIO:sax", kind: "PrintInformation", disposition: "retained", data: biffNode("PrintInformation", {}, "",
        fields.map(([, target], i) => biffNode(target, { value: values[i]! }))) }
    ] }] };
    for (const edition of ["2006", "2008"] as const)
      expect(flags(await readXlsx(await createXlsxWriter(edition)(book, [], context), context))).toEqual(values);
  });
}
it.each<{ attributes: Record<string, string>; children: ImportedValue[] }>([
  { attributes: { horizontalCentered: "1" }, children: [] },
  { attributes: { unhandled: "1" }, children: [] },
  { attributes: { gridLines: "unknown" }, children: [] },
  { attributes: {}, children: [{ name: "unhandled", namespace, attributes: {}, children: [], text: "" }] }
])("retains BIFF loss warnings for unrepresented print metadata %#", async data => {
  const book: Workbook = { sheets: [{ id: "s", name: "S", cells: [], unsupportedRecords: [
    { source: "xl/worksheets/sheet1.xml", kind: "printOptions", disposition: "retained", data: { name: "printOptions", namespace, text: "", ...data } }
  ] }] };
  const warnings: string[] = [];
  await writeBiffStream(book, 8, false, { ...context, async diagnostic(d) { warnings.push(d.message); } });
  expect(warnings).toEqual(["Unsupported Excel BIFF export metadata: printOptions"]);
});
