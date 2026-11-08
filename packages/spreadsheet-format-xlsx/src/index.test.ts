import { expect, it } from "vitest";
import { createEngine, type Codec } from "@poe-code/spreadsheet-engine";
import { xlsxFormat } from "./index.js";

it("uses the shared XLSX implementation for format registration", () => {
  const reader = xlsxFormat.services.find(service => service.direction === "read");
  expect(reader?.read).toBeTypeOf("function");
  expect(reader?.probeContent).toBeTypeOf("function");
  expect(reader?.readSource).toBeTypeOf("function");
  expect(reader?.probeSource).toBeTypeOf("function");
});

it.each(["buffered", "range"])("composes xlsx read/write with %s input", async (mode) => {
  const fixture: Codec = { id: "fixture", description: "owned workbook", extensions: [],
    async read() { return { sheets: [{ id: "s", name: "Data", cells: [
      { row: 0, column: 0, value: { kind: "string", value: "Label" } },
      { row: 1, column: 0, value: { kind: "number", value: 42 } }
    ] }] }; }
  };
  const engine = createEngine({ formats: [xlsxFormat], codecs: [fixture] });
  const operation = { signal: new AbortController().signal };
  const output: Uint8Array[] = [];
  try {
    const book = await engine.readWorkbook({ kind: "stream", source: [] }, { importType: "fixture" }, operation);
    await engine.writeWorkbook(book, { kind: "stream", sink: { async write(bytes) { output.push(bytes); } } },
      { exportType: "Gnumeric_Excel:xlsx2" }, operation);
    const bytes = output[0]!;
    const roundtrip = await engine.readWorkbook(mode === "buffered" ? { kind: "stream", filename: "book.xlsx", source: output } : {
      kind: "range", filename: "book.xlsx", source: { size: bytes.length, async read(position, maximum) {
        return bytes.subarray(position, position + Math.min(maximum, 37));
      } }
    }, {}, operation);
    expect(roundtrip.sheets[0]!.cells.find(cell => cell.row === 0 && cell.column === 0)?.value).toEqual({ kind: "string", value: "Label" });
    expect(roundtrip.sheets[0]!.cells.find(cell => cell.row === 1 && cell.column === 0)?.value).toMatchObject({ kind: "number", value: 42 });
  } finally { await engine.dispose(); }
});
