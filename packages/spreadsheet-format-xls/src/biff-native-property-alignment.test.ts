import { expect, it } from "vitest";
import type { CapabilityContext } from "@poe-code/spreadsheet-engine/contracts";
import { readBiffProperties } from "./biff-properties.js";
// Gnumeric 1.12.61/libgsf output from an independently generated OpenPyXL workbook.
// Its byte-string dictionary ends at offset 73; the section ends at byte 90.
const hex = "feff0000040a0200000000000000000000000000000000000200000002d5cdd59c2e1b10939708002b2cf9ae4400000005d5cdd59c2e1b10939708002b2cf9ae5c0000001800000001000000010000001000000002000000e40400005a0000000300000001000000200000000000000028000000020000004900000002000000e40400000100000002000000150000006d6574613a696e697469616c2d63726561746f72001e000000090000006f70656e7079786c00";
const bytes = () => Uint8Array.from({ length: hex.length / 2 }, (_, i) => Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16));
const context: CapabilityContext = { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 2, operations: 10000 } };
it("reads native property sections and values without trailing alignment padding", async () => {
  const properties = await readBiffProperties(new Map([["\u0005DocumentSummaryInformation", bytes()]]), context, value => value, () => {}, []);
  expect(properties).toEqual({ "meta:initial-creator": "openpyxl" });
});
it("still rejects a truncated unpadded native property value", async () => {
  await expect(readBiffProperties(new Map([["\u0005DocumentSummaryInformation", bytes().slice(0, -1)]]), context, value => value, () => {}, [])).rejects.toMatchObject({ code: "io" });
});
