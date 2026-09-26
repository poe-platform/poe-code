import { expect, it } from "vitest";
import { readDif, writeDif } from "./dif.js";
import { readSylk } from "./sylk.js";
import type { CapabilityContext, Diagnostic } from "../contracts.js";

const bytes = (text: string) => new TextEncoder().encode(text);
function context(diagnostics: Diagnostic[] = []): CapabilityContext {
  return { signal: new AbortController().signal, own() {},
    environment: { env: {}, locale: "C", timezone: "UTC" },
    async diagnostic(message) { diagnostics.push(message); },
    limits: { inputBytes: 100000, outputBytes: 100000, cells: 1000, sheets: 3, operations: 1000 } };
}
const header = 'DATA\n0,0\n""\n-1,0\nBOT\n';

it("DIF string column overflow consumes records and recovers on the next BOT", async () => {
  const diagnostics: Diagnostic[] = [];
  const wide = '1,0\n"x"\n'.repeat(259);
  const book = await readDif(bytes(header + wide + '-1,0\nBOT\n0,42\nV\n-1,0\nEOD\n'), context(diagnostics));
  expect(book.sheets[0]!.cells).toHaveLength(257);
  expect(book.sheets[0]!.cells.at(-1)).toEqual({ row: 1, column: 0, value: { kind: "number", value: 42 } });
  expect(diagnostics.map(message => message.message)).toEqual([
    "DIF file has more than the maximum number of columns 256. Ignoring remaining columns."
  ]);
});

it("DIF string overflow cannot turn missing EOD into a successful read", async () => {
  await expect(readDif(bytes(header + '1,0\n"x"\n'.repeat(259)), context())).rejects.toThrow("while reading data.");
});

it("DIF numeric overflow stops before consuming the numeric value marker", async () => {
  const diagnostics: Diagnostic[] = [];
  const book = await readDif(bytes(header + '1,0\n"x"\n'.repeat(257) + '0,42\n'), context(diagnostics));
  expect(book.sheets[0]!.cells).toHaveLength(256);
  expect(diagnostics).toHaveLength(1);
});

it("DIF unknown numeric markers consume columns and EOD ignores later malformed bytes", async () => {
  const book = await readDif(bytes(header + '0,123\nUNKNOWN\n0,42\nV\n-1,0\nEOD\nDATA'), context());
  expect(book.sheets[0]!.cells).toEqual([{ row: 0, column: 1, value: { kind: "number", value: 42 } }]);
});

it("DIF reader and writer obey already cancelled signals and byte budgets", async () => {
  const controller = new AbortController(); controller.abort();
  const cancelled = { ...context(), signal: controller.signal };
  await expect(readDif(bytes(header), cancelled)).rejects.toMatchObject({ name: "AbortError" });
  await expect(readDif(bytes(header), { ...context(), limits: { ...context().limits, inputBytes: 1 } })).rejects.toMatchObject({ code: "resource-limit" });
  const book = await readDif(bytes(header + '-1,0\nEOD\n'), context());
  await expect(writeDif(book, [], cancelled)).rejects.toMatchObject({ name: "AbortError" });
  await expect(writeDif(book, [], { ...context(), limits: { ...context().limits, outputBytes: 1 } })).rejects.toMatchObject({ code: "resource-limit" });
});

it("SYLK independent records preserve semicolons and skip unknown record types", async () => {
  const book = await readSylk(bytes('ID;POriginal\nZZ;X12;K4\nC;Y1;X1;K"a;;b"\nC;X2;K#DIV/0!\nE\nC;X3;K99\n'), context());
  expect(book.sheets[0]!.cells.map(cell => cell.value)).toEqual([
    { kind: "string", value: "a;b" }, { kind: "error", value: "#DIV/0!" }
  ]);
});
