import { expect, it } from "vitest";
import { createEngine } from "../engine.js";
import { psionFixture } from "./psion-fixture.test-support.js";

function record(id: number, data: readonly number[] = []): number[] {
  return [id & 255, id >> 8, data.length & 255, data.length >> 8, ...data];
}
const limits = { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 4, operations: 1000 };
async function loadBinary(bytes: readonly number[], importType?: string) {
  const engine = createEngine({ codecs: [], limits, environment: { env: {}, locale: "C", timezone: "UTC" } });
  const diagnostics: string[] = [];
  try {
    const book = await engine.readWorkbook({ kind: "stream", source: [Uint8Array.from(bytes)] },
      importType === undefined ? {} : { importType }, { signal: new AbortController().signal,
        async diagnostic(d) { diagnostics.push(d.message); } });
    return { book, diagnostics };
  } finally { await engine.dispose(); }
}

it.each([0x1001, 0x1002, 0x1006, 0x1007])("Quattro signature %x imports unsigned integer and Latin-1 label", async version => {
  const { book } = await loadBinary([
    ...record(0, [version & 255, version >> 8]), ...record(202),
    ...record(13, [0, 0, 0, 0, 0, 0, 255, 255]),
    ...record(15, [1, 0, 0, 0, 0, 0, 94, 233, 0]), ...record(203), ...record(1)
  ]);
  expect(book.sheets[0]?.name).toBe("A");
  expect(book.sheets[0]?.size).toEqual({ rows: 65536, columns: 256 });
  expect(book.sheets[0]?.cells.map(c => c.value)).toEqual([{ kind: "number", value: 65535 }, { kind: "string", value: "é" }]);
  expect(book.sheets[0]?.cells[1]?.style?.HAlign).toBe(8);
});

it("Quattro invalid cell length warns and retains subsequent records", async () => {
  const { book, diagnostics } = await loadBinary([
    ...record(0, [1, 16]), ...record(202), ...record(13, [0]),
    ...record(13, [0, 0, 0, 0, 0, 0, 7, 0]), ...record(203), ...record(1)
  ], "Gnumeric_QPro:qpro");
  expect(book.sheets[0]?.cells[0]?.value).toEqual({ kind: "number", value: 7 });
  expect(diagnostics).toEqual(["File is most likely corrupted.\n", "Invalid 'QPRO_INTEGER_CELL' record of length 1 instead of 8\n"]);
});

it("PlanPerfect imports custom base-16 float, short text and native error cells", async () => {
  const header = [255, 87, 80, 67, 16, 0, 0, 0, 9, 10, 5, 0, 0, 0, 0, 0];
  const cell = (column: number, type: number, value: number[]) => [0, 0, column, 0, ...value, type, 0, 0, 0, 0, 0, 0, 0];
  const { book } = await loadBinary([...header, ...record(25),
    ...cell(0, 1, [65, 16, 0, 0, 0, 0, 0, 0]),
    ...cell(1, 2, [3, 97, 98, 99, 0, 0, 0, 0]),
    ...cell(2, 5, Array<number>(8).fill(0)), ...[255, 255, ...Array<number>(18).fill(0)]
  ], "Gnumeric_plan_perfect:pln");
  expect(book.sheets[0]?.name).toBe("PlanPerfect");
  expect(book.sheets[0]?.cells.map(c => c.value)).toEqual([{ kind: "number", value: 1 }, { kind: "string", value: "abc" }, { kind: "error", value: "#N/A" }]);
});

it.each([0x404, 0x405, 0x406])("Lotus old version %x uses signed integers and record formats", async version => {
  const { book } = await loadBinary([...record(0, [version & 255, version >> 8]),
    ...record(13, [0x71, 0, 0, 0, 0, 255, 255]), ...record(15, [0x71, 1, 0, 0, 0, 39, 104, 105, 0]), ...record(1)
  ], "Gnumeric_lotus:lotus");
  expect(book.sheets[0]?.name).toBe("A");
  expect(book.sheets[0]?.cells.map(c => c.value)).toEqual([{ kind: "number", value: -1 }, { kind: "string", value: "hi" }]);
  expect(book.sheets[0]?.cells[0]?.format).toBe("General");
});

it("Psion imports actual section pointers and packed cell positions in JavaScript", async () => {
  const { book } = await loadBinary([...psionFixture()], "Gnumeric_psiconv:psiconv");
  expect(book.sheets[0]?.name).toBe("Sheet0");
  expect(book.sheets[0]?.cells[0]?.value).toEqual({ kind: "number", value: 7 });
});

it("Lotus named functions preserve HARMEAN despite the source's repeated ordinal", async () => {
  const cache = new Uint8Array(8); new DataView(cache.buffer).setFloat64(0, 99, true);
  const tokens = [5, 64, 0, 0, 0, 5, 128, 0, 0, 0, 0x7a, 2, 8, 0, ...Array.from("HARMEAN(", c => c.charCodeAt(0)), 3];
  const { book, diagnostics } = await loadBinary([...record(0, [5, 16, ...Array<number>(14).fill(0), 1, 0, 0]),
    ...record(40, [0, 0, 0, 0, ...cache, ...tokens]), ...record(1)], "Gnumeric_lotus:lotus");
  expect(diagnostics).toEqual([]);
  expect(book.sheets[0]!.cells[0]!.formula).toBe("=HARMEAN(1,2)");
});

it.each(["Gnumeric_QPro:qpro", "Gnumeric_lotus:lotus"])("%s translates arithmetic tokens while preserving the stored cache", async id => {
  const cache = new Uint8Array(8); new DataView(cache.buffer).setFloat64(0, 99, true);
  const tokens = [5, 7, 0, 5, 2, 0, 9, 3];
  const bytes = id === "Gnumeric_QPro:qpro" ? [
    ...record(0, [1, 16]), ...record(202),
    ...record(16, [0, 0, 0, 0, 0, 0, ...cache, 0, 0, tokens.length, 0, tokens.length, 0, ...tokens]), ...record(203), ...record(1)
  ] : [...record(0, [4, 4]), ...record(16, [0x71, 0, 0, 0, 0, ...cache, tokens.length, 0, ...tokens]), ...record(1)];
  const { book, diagnostics } = await loadBinary(bytes, id);
  expect(diagnostics).toEqual([]);
  const cell = book.sheets[0]!.cells[0]!;
  expect(cell.formula).toBe("=(7+2)");
  expect(cell.value).toEqual({ kind: "number", value: 99 });
  expect(cell.cachedResult).toEqual(cell.value);
  const engine = createEngine({ codecs: [], limits, environment: { env: {}, locale: "C", timezone: "UTC" } });
  try {
    for (const [recalc, expected] of [[false, "99\n"], [true, "9\n"]] as const) {
      let output = "";
      const result = await engine.convert({ input: { kind: "stream", source: [Uint8Array.from(bytes)] }, importType: id,
        exportType: "Gnumeric_stf:stf_csv", recalc, destination: { kind: "stream", sink: { async write(bytes) { output += new TextDecoder().decode(bytes); } } } },
      { signal: new AbortController().signal });
      expect(result.exitCode).toBe(0); expect(result.diagnostics).toEqual([]); expect(output).toBe(expected);
    }
  } finally { await engine.dispose(); }
});
