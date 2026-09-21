import { expect, it } from "vitest";
import { createEngine } from "../engine.js";

const limits = { inputBytes: 10000, outputBytes: 10000, cells: 10, sheets: 4, operations: 1000 };
const environment = { env: {}, locale: "C", timezone: "UTC" };

async function read(text: string, id = "Gnumeric_sc:sc", signal = new AbortController().signal) {
  const engine = createEngine({ codecs: [], limits, environment });
  try {
    return await engine.readWorkbook({ kind: "stream", source: [new TextEncoder().encode(text)] },
      { importType: id }, { signal });
  } finally { await engine.dispose(); }
}

it.each(["label", "leftstring", "rightstring"])("SC invalid %s does not resize the sheet", async command => {
  const book = await read(`${command} ZZ65536 = unquoted\n${command} ZZ65536 = "unfinished\nlet A0 = 7\n`);
  expect(book.sheets[0]!.size).toEqual({ rows: 65536, columns: 256 });
  expect(book.sheets[0]!.cells).toEqual([{ row: 0, column: 0, value: { kind: "number", value: 7 } }]);
});

it("SC invalid labels do not add a sheet-boundary warning before a later fatal error", async () => {
  await expect(read('label A16777216 = unquoted\nlet ??? = 1\n'))
    .rejects.toThrow("W On worksheet SC:\n  W Cannot parse let ??? = 1\n");
});

it("SC valid empty labels still fetch and resize the sheet", async () => {
  const book = await read('label A65536 = missing-quotes\nlabel B65536 = ""\n');
  expect(book.sheets[0]!.size).toEqual({ rows: 131072, columns: 256 });
  expect(book.sheets[0]!.cells).toEqual([{ row: 65536, column: 1, value: { kind: "string", value: "" } }]);
});

it.each(["Gnumeric_oleo:oleo", "Gnumeric_sc:sc"])("%s bounds distinct cell insertion while accepting replacement", async id => {
  const engine = createEngine({ codecs: [], limits: { ...limits, cells: 1 }, environment });
  const source = id === "Gnumeric_sc:sc" ? 'let A0 = 1\nlet A0 = 2\nlet B0 = 3\n' : 'C;r1;c1;K1\nC;K2\nC;c2;K3\n';
  try {
    await expect(engine.readWorkbook({ kind: "stream", source: [new TextEncoder().encode(source)] },
      { importType: id }, { signal: new AbortController().signal })).rejects.toThrow("cells limit exceeded");
  } finally { await engine.dispose(); }
});

it.each([false, true])("Applix unknown shared expressions preserve prior cell assignment (prior=%s)", async prior => {
  const source = '*BEGIN SPREADSHEETS VERSION=430/0 ENCODING=7BIT\nSpreadsheet Dump Rev 4.42 Line Length 200\nPercent Zoom Factor: 100\nOpen Cell: A:A1\nView Start, Name: ~A:~\nView End, Name: ~A:~\nHeaders And Footers\nHeaders And Footers End\n(G0||) A!A1: 7\n(G0||) A!A1. 3  shared missing\n*END SPREADSHEETS\n';
  const book = await read(prior ? source : source.replace('(G0||) A!A1: 7\n', ''), "Gnumeric_applix:applix");
  expect(book.sheets[0]!.cells[0]!.value).toEqual(prior ? { kind: "number", value: 7 } : { kind: "blank" });
});

it("SC comments and shell-shaped directives cannot execute an expression", async () => {
  const book = await read('# let A0 = 99\nsystem "$(touch /denied)"\nexec "node -e process.exit()"\nlet A0 = 3\nlet B0 = @pow(A0,2)+@fabs(-1)\n');
  expect(book.sheets[0]!.cells).toMatchObject([
    { row: 0, column: 0, value: { kind: "number", value: 3 } },
    { row: 0, column: 1, formula: "=power(A1,2)+abs(-1)", formulaDirty: true }
  ]);
});

it("Oleo quoted semicolons remain cell data while an unsupported field stops later coordinates", async () => {
  const book = await read('C;r1;c1;K"a;b";Zignored;c2;K9\nC;c2;K#REF!\n', "Gnumeric_oleo:oleo");
  expect(book.sheets[0]!.cells).toEqual([
    { row: 0, column: 0, value: { kind: "string", value: "a;b" } },
    { row: 0, column: 1, value: { kind: "error", value: "#REF!" } }
  ]);
});

it("SC cooperative cancellation interrupts the record-reader yield", async () => {
  const controller = new AbortController();
  const reason = new Error("independent cancellation");
  const pending = read('# original bounded comments\n'.repeat(129) + 'let A0 = 7\n', "Gnumeric_sc:sc", controller.signal);
  queueMicrotask(() => controller.abort(reason));
  await expect(pending).rejects.toBe(reason);
});
