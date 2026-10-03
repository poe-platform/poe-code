import { expect, it, vi } from "vitest";
import { createEngine, type Codec } from "@poe-code/spreadsheet-engine";
import { createMemoryFileSystem } from "@poe-code/safe-fs/core";
import { odsFormat } from "./index.js";

// Keep the 64 MiB Argon2 arena out of unit tests; cipher and package processing
// remain real. Independent KDF/interoperability qualification is a separate gate.
vi.mock("@noble/hashes/argon2.js", () => ({ argon2idAsync: async () => new Uint8Array(32).fill(71) }));

it.each([
  ["buffered", undefined], ["range", undefined], ["range", "odf12-aes128-cbc"], ["range", "libreoffice-aes256-gcm"]
] as const)("composes ods read/write with %s input and %s encryption", async (mode, encryption) => {
  const fixture: Codec = { id: "fixture", description: "owned workbook", extensions: [],
    async read() { return { sheets: [{ id: "s", name: "Data", cells: [
      { row: 0, column: 0, value: { kind: "string", value: "Label" } },
      { row: 1, column: 0, value: { kind: "number", value: 42 } }
    ] }] }; }
  };
  const engine = createEngine({
    password: { async read() { return "test password"; } },
    entropy: { async read({ length }) { return new Uint8Array(length).fill(42); } },
    workingFiles: { fs: createMemoryFileSystem(), directory: "/", cacheBytes: 16384 }, formats: [odsFormat], codecs: [fixture] });
  const operation = { signal: new AbortController().signal };
  const output: Uint8Array[] = [];
  try {
    const book = await engine.readWorkbook({ kind: "stream", source: [] }, { importType: "fixture" }, operation);
    await engine.writeWorkbook(book, { kind: "stream", sink: { async write(bytes) { output.push(bytes); } } },
      { exportType: "Gnumeric_OpenCalc:odf", ...(encryption ? { exportOptions: [`encryption=${encryption}`] } : {}) }, operation);
    const bytes = output[0]!;
    const roundtrip = await engine.readWorkbook(mode === "buffered" ? { kind: "stream", filename: "book.ods", source: output } : {
      kind: "range", filename: "book.ods", source: { size: bytes.length, async read(position, maximum) {
        return bytes.subarray(position, position + Math.min(maximum, 31));
      } }
    }, {}, operation);
    expect(roundtrip.sheets[0]!.cells.find(cell => cell.row === 0 && cell.column === 0)?.value).toEqual({ kind: "string", value: "Label" });
    expect(roundtrip.sheets[0]!.cells.find(cell => cell.row === 1 && cell.column === 0)?.value).toMatchObject({ kind: "number", value: 42 });
  } finally { await engine.dispose(); }
});

it("registers retained range probing and ingestion", () => {
  const reader = odsFormat.services.find(service => service.direction === "read");
  expect(reader?.probeSource).toBeTypeOf("function");
  expect(reader?.readSource).toBeTypeOf("function");
});
