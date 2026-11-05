import { expect, it } from "vitest";
import { createEngine, type Codec } from "@poe-code/spreadsheet-engine";
import { csvFormat } from "./index.js";

it("composes csv read/write independently around an owned spreadsheet model", async () => {
  const fixture: Codec = { id: "fixture", description: "owned workbook", extensions: [],
    async read() { return { sheets: [{ id: "s", name: "Data", cells: [
      { row: 0, column: 0, value: { kind: "string", value: "Label" } },
      { row: 1, column: 0, value: { kind: "number", value: 42 } }
    ] }] }; }
  };
  const engine = createEngine({ formats: [csvFormat], codecs: [fixture] });
  const operation = { signal: new AbortController().signal };
  const output: Uint8Array[] = [];
  try {
    const book = await engine.readWorkbook({ kind: "stream", source: [] }, { importType: "fixture" }, operation);
    await engine.writeWorkbook(book, { kind: "stream", sink: { async write(bytes) { output.push(bytes); } } },
      { exportType: "Gnumeric_stf:stf_csv" }, operation);
    const roundtrip = await engine.readWorkbook({ kind: "stream", filename: "book.csv", source: output }, {}, operation);
    expect(roundtrip.sheets[0]!.cells.find(cell => cell.row === 0 && cell.column === 0)?.value).toEqual({ kind: "string", value: "Label" });
    expect(roundtrip.sheets[0]!.cells.find(cell => cell.row === 1 && cell.column === 0)?.value).toMatchObject({ kind: "number", value: 42 });
  } finally { await engine.dispose(); }
});

it.each([
  ["LF", "a,b\n1,2\n", undefined, "a,b\n1,2\n"],
  ["CRLF", "a,b\r\n1,2\r\n", undefined, "a,b\r\n1,2\r\n"],
  ["CR", "a,b\r1,2\r", undefined, "a,b\r1,2\r"],
  ["no terminator", "a,b", undefined, "a,b\n"],
  ["explicit LF", "a,b\r\n1,2\r\n", "eol=unix", "a,b\n1,2\n"]
])("preserves imported %s endings across plain CSV writer paths", async (_name, input, option, expected) => {
  for (const path of ["write", "writeStream", "writeWorkbookSource"] as const) {
    const engine = createEngine({ formats: [{ ...csvFormat, services: csvFormat.services.map(service => {
      const codec = { ...service };
      if (path === "write") delete codec.writeStream;
      if (path !== "writeWorkbookSource") delete codec.writeWorkbookSource;
      return codec;
    }) }] });
    const chunks: number[] = [];
    try {
      await engine.convert({
        input: { kind: "stream", filename: "input.csv", source: [new TextEncoder().encode(input)] },
        importType: "Gnumeric_stf:stf_csvtab", exportType: "Gnumeric_stf:stf_csv",
        exportOptions: option === undefined ? [] : [option],
        destination: { kind: "stream", sink: { async write(bytes) { chunks.push(...bytes); } } }
      }, { signal: new AbortController().signal });
      expect(Uint8Array.from(chunks)).toEqual(new TextEncoder().encode(expected));
    } finally { await engine.dispose(); }
  }
});

it.each([
  ["separator=;", 'Name;Value\n"A,B";12\n"Q""R";34\n'],
  ["quoting-mode=always", '"Name","Value"\n"A,B","12"\n"Q""R","34"\n'],
  ["eol=windows", 'Name,Value\r\n"A,B",12\r\n"Q""R",34\r\n'],
  ["charset=UTF-16", 'Name,Value\n"A,B",12\n"Q""R",34\n']
])("applies CSV export option %s across writer paths", async (option, expected) => {
  for (const path of ["write", "writeStream", "writeWorkbookSource"] as const) {
    const engine = createEngine({ formats: [{ ...csvFormat, services: csvFormat.services.map(service => {
      const codec = { ...service };
      if (path === "write") delete codec.writeStream;
      if (path !== "writeWorkbookSource") delete codec.writeWorkbookSource;
      return codec;
    }) }] });
    const chunks: number[] = [];
    try {
      await engine.convert({
        input: { kind: "stream", filename: "input.csv", source: [new TextEncoder().encode('Name,Value\n"A,B",12\n"Q""R",34\n')] },
        exportType: "Gnumeric_stf:stf_csv", exportOptions: [option],
        destination: { kind: "stream", sink: { async write(bytes) { chunks.push(...bytes); } } }
      }, { signal: new AbortController().signal });
      if (option === "charset=UTF-16") {
        expect(chunks.slice(0, 2)).toEqual([254, 255]);
        expect(new TextDecoder("utf-16be").decode(Uint8Array.from(chunks))).toBe(expected);
      } else expect(new TextDecoder().decode(Uint8Array.from(chunks))).toBe(expected);
    } finally { await engine.dispose(); }
  }
});
