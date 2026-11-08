import { expect, it } from "vitest";
import type { UnsupportedRecord, Workbook } from "@poe-code/spreadsheet-ast";
import type { CapabilityContext } from "@poe-code/spreadsheet-engine/contracts";
import { metadataNode } from "@poe-code/spreadsheet-engine/codecs/xlsx-write-support";
import { createXlsxWriter, readXlsx } from "./xlsx.js";
import { gnode } from "./xlsx-metadata.js";
const margins = [["LEFT_MARGIN", 0x26, "left"], ["RIGHT_MARGIN", 0x27, "right"],
  ["TOP_MARGIN", 0x28, "top"], ["BOTTOM_MARGIN", 0x29, "bottom"]] as const;
function encoded(value: number): string {
  const bytes = new Uint8Array(8); new DataView(bytes.buffer).setFloat64(0, value, true);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}
async function roundtrip(record: UnsupportedRecord, side: string, points: number | null) {
  const diagnostics: string[] = [];
  const context: CapabilityContext = { signal: new AbortController().signal, own() {},
    environment: { env: {}, locale: "C", timezone: "UTC" },
    limits: { inputBytes: 1000000, outputBytes: 1000000, cells: 100, sheets: 2, operations: 10000 },
    diagnostic: async diagnostic => { diagnostics.push(diagnostic.message); } };
  const book: Workbook = { sheets: [{ id: "s", name: "Data", cells: [], unsupportedRecords: [record,
    { source: "Gnumeric_XmlIO:sax", kind: "PrintInformation", disposition: "retained",
      data: gnode("PrintInformation", {}, [gnode("Margins", {}, points === null ? [] : [gnode(side, { Points: points })])]) }] }] };
  const result = await readXlsx(await createXlsxWriter("2006")(book, [], context), context);
  const print = metadataNode(result.sheets[0]!.unsupportedRecords!.find(record => record.kind === "PrintInformation")!.data)!;
  const margin = print.children.find(node => node.name === "Margins")!.children.find(node => node.name === side)!;
  return { diagnostics, points: Number(margin.attributes.Points) };
}
for (const [kind, opcode, side] of margins) {
  for (const inches of [0, 0.75]) it(`exports represented ${kind}=${inches} and canonical edits without a false loss warning`, async () => {
    const record: UnsupportedRecord = { source: "biff", kind, disposition: "retained", data: { opcode, bytes: encoded(inches) } };
    for (const points of [inches * 72, 90]) expect(await roundtrip(record, side, points)).toEqual({ diagnostics: [], points });
  });
  it(`retains warnings for malformed or unrepresented ${kind}`, async () => {
    for (const bytes of ["0000", "g".repeat(16), encoded(1) + "00", encoded(Number.NaN), encoded(Infinity), encoded(-1)]) {
      expect((await roundtrip({ source: "biff", kind, disposition: "retained", data: { opcode, bytes } }, side, 72)).diagnostics).toHaveLength(1);
    }
    for (const [source, code, points] of [["other", opcode, 72], ["biff", 0, 72], ["biff", opcode, null]] as const) {
      expect((await roundtrip({ source, kind, disposition: "retained", data: { opcode: code, bytes: encoded(1) } }, side, points)).diagnostics).toHaveLength(1);
    }
  });
}
