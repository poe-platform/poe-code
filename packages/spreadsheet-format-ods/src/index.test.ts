import { expect, it } from "vitest";
import { createEngine, type Codec } from "@poe-code/spreadsheet-engine";
import { odsFormat } from "./index.js";

it("composes ods read/write independently around an owned spreadsheet model", async () => {
  const fixture: Codec = { id: "fixture", description: "owned workbook", extensions: [],
    async read() { return { sheets: [{ id: "s", name: "Data", cells: [
      { row: 0, column: 0, value: { kind: "string", value: "Label" } },
      { row: 1, column: 0, value: { kind: "number", value: 42 } }
    ] }] }; }
  };
  const engine = createEngine({ formats: [odsFormat], codecs: [fixture] });
  const operation = { signal: new AbortController().signal };
  const output: Uint8Array[] = [];
  try {
    const book = await engine.readWorkbook({ kind: "stream", source: [] }, { importType: "fixture" }, operation);
    await engine.writeWorkbook(book, { kind: "stream", sink: { async write(bytes) { output.push(bytes); } } },
      { exportType: "Gnumeric_OpenCalc:odf" }, operation);
    const roundtrip = await engine.readWorkbook({ kind: "stream", filename: "book.ods", source: output }, {}, operation);
    expect(roundtrip.sheets[0]!.cells.find(cell => cell.row === 0 && cell.column === 0)?.value).toEqual({ kind: "string", value: "Label" });
    expect(roundtrip.sheets[0]!.cells.find(cell => cell.row === 1 && cell.column === 0)?.value).toMatchObject({ kind: "number", value: 42 });
  } finally { await engine.dispose(); }
});
