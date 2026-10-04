import { expect, it } from "vitest";
import type { CapabilityContext } from "@poe-code/spreadsheet-engine/contracts";
import { metadataNode } from "@poe-code/spreadsheet-engine/codecs/xlsx-write-support";
import { gnode, readXlsxMetadata } from "./xlsx-metadata.js";
import { createXlsxWriter, readXlsx } from "./xlsx.js";
const context: CapabilityContext = { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 1000000, outputBytes: 1000000, cells: 100, sheets: 2, operations: 100000 } };
for (const enabled of ["0", "1", "false", "true", undefined]) it(`imports first-page enable ${enabled} independently of the stored number`, () => {
  const records = readXlsxMetadata({ name: "worksheet", namespace: "http://schemas.openxmlformats.org/spreadsheetml/2006/main", attributes: {}, text: "", children: [
    { name: "pageSetup", namespace: "http://schemas.openxmlformats.org/spreadsheetml/2006/main", attributes: { firstPageNumber: "42", ...(enabled === undefined ? {} : { useFirstPageNumber: enabled }) }, text: "", children: [] }] });
  const print = metadataNode(records[0]!.data)!;
  expect(print.children.find(node => node.name === "first_page_number")?.attributes.value).toBe("42");
  expect(print.children.find(node => node.name === "use_first_page_number")?.attributes.value).toBe(enabled === "1" || enabled === "true" ? "1" : "0");
});
for (const enabled of [0, 1]) it(`writes explicit first-page enable ${enabled} in both XLSX editions`, async () => {
  for (const edition of ["2006", "2008"] as const) {
    const input = { sheets: [{ id: "s", name: "Data", cells: [], unsupportedRecords: [{ source: "Gnumeric_XmlIO:sax", kind: "PrintInformation", disposition: "retained" as const,
      data: gnode("PrintInformation", {}, [gnode("first_page_number", { value: 42 }), gnode("use_first_page_number", { value: enabled })]) }] }] };
    const output = await readXlsx(await createXlsxWriter(edition)(input, [], context), context);
    const setup = metadataNode(output.sheets[0]!.unsupportedRecords!.find(record => record.kind === "pageSetup")!.data)!;
    expect(setup.attributes.firstPageNumber).toBe("42");expect(setup.attributes.useFirstPageNumber).toBe(String(enabled));
  }
});
