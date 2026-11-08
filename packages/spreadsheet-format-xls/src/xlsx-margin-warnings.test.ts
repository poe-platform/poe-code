import { expect, it } from "vitest";
import type { CapabilityContext } from "@poe-code/spreadsheet-engine/contracts";
import type { UnsupportedRecord } from "@poe-code/spreadsheet-ast";
import { biffNode } from "./biff-metadata.js";
import { createBiffWriter } from "./biff.js";
const context: CapabilityContext = { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 2, operations: 10000 } };
function records(name: string, value: string, points = 18): UnsupportedRecord[] {
  return [{ source: "Gnumeric_XmlIO:sax", kind: "PrintInformation", disposition: "retained", data: biffNode("PrintInformation", {}, "", [biffNode("Margins", {}, "", [biffNode(name, { Points: points })])]) },
    { source: "xl/worksheets/sheet1.xml", kind: "pageMargins", disposition: "retained", data: { name: "pageMargins", namespace: "http://schemas.openxmlformats.org/spreadsheetml/2006/main", attributes: { [name]: value }, children: [], text: "" } }];
}
for (const name of ["left", "right", "top", "bottom", "header", "footer"]) it(`does not report preserved XLSX ${name} margin as lost`, async () => {
  for (const revision of [7, 8] as const) {
    const diagnostics: string[] = [];
    await createBiffWriter(revision)({ sheets: [{ id: "s", name: "Data", cells: [], unsupportedRecords: records(name, "0.25") }] }, [],
      { ...context, diagnostic: async item => { diagnostics.push(item.message); } });
    expect(diagnostics).toEqual([]);
  }
});
it("retains loss warnings for changed, malformed and unknown margins", async () => {
  for (const [name, value] of [["left", "0.5"], ["left", "NaN"], ["left", ""], ["future", "0.25"]]) {
    const diagnostics: string[] = [];
    await createBiffWriter(8)({ sheets: [{ id: "s", name: "Data", cells: [], unsupportedRecords: records(name!, value!) }] }, [],
      { ...context, diagnostic: async item => { diagnostics.push(item.message); } });
    expect(diagnostics).toEqual(["Unsupported Excel BIFF export metadata: pageMargins"]);
  }
});
