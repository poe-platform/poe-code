import { expect, it } from "vitest";
import { createEngine } from "@poe-code/spreadsheet-engine";
import { dbfFormat } from "./index.js";

it("imports DBF text, numbers and logical fields with only its reader selected", async () => {
  const engine = createEngine({ formats: [dbfFormat] });
  const bytes = new Uint8Array(130 + 2 * 12), view = new DataView(bytes.buffer);
  bytes[0] = 3; bytes[29] = 3;
  view.setUint32(4, 2, true); view.setUint16(8, 130, true); view.setUint16(10, 12, true);
  for (const [index, name, type, length] of [[0, "Name", "C", 5], [1, "Amount", "N", 5], [2, "Active", "L", 1]] as const) {
    const at = 32 + index * 32;
    bytes.set(new TextEncoder().encode(name), at); bytes[at + 11] = type.charCodeAt(0); bytes[at + 16] = length;
  }
  bytes[128] = 13;
  bytes.set([32, 67, 97, 102, 233, 32, 32, 49, 50, 46, 53, 84], 130);
  bytes.copyWithin(142, 130, 142); bytes[142] = 42;
  try {
    expect(engine.listServices("read").map(service => service.id)).toEqual(["Gnumeric_xbase:xbase"]);
    expect(engine.listServices("write")).toEqual([]);
    const workbook = await engine.readWorkbook({ kind: "stream", filename: "sales.dbf", source: [bytes] }, {},
      { signal: new AbortController().signal });
    expect(workbook.sheets).toHaveLength(1);
    expect(workbook.sheets[0]!.cells.filter(cell => cell.row === 1).map(cell => cell.value)).toEqual([
      { kind: "string", value: "Café" }, { kind: "number", value: 12.5 }, { kind: "boolean", value: true }
    ]);
    expect(workbook.sheets[0]!.cells.every(cell => cell.row <= 1)).toBe(true);
  } finally { await engine.dispose(); }
});
