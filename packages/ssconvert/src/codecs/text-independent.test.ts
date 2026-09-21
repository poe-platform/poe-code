import { expect, it } from "vitest";
import { Volume } from "memfs";
import { createEngine } from "../engine.js";
import type { CapabilityContext } from "../contracts.js";
import { probeText, readText } from "./text.js";

const context: CapabilityContext = {
  signal: new AbortController().signal,
  inputFilename: "/stress.csv",
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 1000, sheets: 2, operations: 1000 },
  own() {}
};

it("rejects nonprinting Unicode while admitting printable supplementary characters", async () => {
  for (const text of ["a,\u200b\n", "a,\u202e\n", "a,\ufeff\n", "a,\u0378\n"]) {
    expect(await probeText(new TextEncoder().encode(text), context), text).toBe(false);
  }
  expect(await probeText(new TextEncoder().encode("a,😀\n"), context)).toBe(true);
  expect(await probeText(new TextEncoder().encode("a,\ue000\n"), context)).toBe(true);
});

it("decodes a UTF-8 BOM without changing the first imported field", async () => {
  const volume = new Volume();
  volume.writeFileSync("/stress.csv", new Uint8Array([239, 187, 191, 97, 44, 98, 10]));
  const engine = createEngine({ codecs: [], environment: context.environment, limits: context.limits,
    filesystem: {
      async read(uri, signal) { signal.throwIfAborted(); return [new Uint8Array(volume.readFileSync(uri) as Uint8Array)]; },
      async write(uri, bytes) { volume.writeFileSync(uri, bytes); }
    } });
  const book = await engine.readWorkbook({ kind: "resource", uri: "/stress.csv" }, {}, context);
  expect(book.sheets[0]!.cells.map(cell => cell.value)).toEqual([
    { kind: "string", value: "a" }, { kind: "string", value: "b" }
  ]);
});

it("preserves sparse trailing fields and blank physical rows", async () => {
  const book = await readText(new TextEncoder().encode("a,,\r\n\r\n,b,\r\n,,"), context);
  expect(book.sheets[0]!.cells.map(cell => [cell.row, cell.column, cell.value])).toEqual([
    [0, 0, { kind: "string", value: "a" }], [2, 1, { kind: "string", value: "b" }]
  ]);
});

it("does not classify Unicode letters following a quoted field as separators", async () => {
  const book = await readText(new TextEncoder().encode('"a",é\n"b",ñ\n'), context);
  expect(book.sheets[0]!.cells.map(cell => [cell.row, cell.column, cell.value])).toEqual([
    [0, 0, { kind: "string", value: "a" }], [0, 1, { kind: "string", value: "é" }],
    [1, 0, { kind: "string", value: "b" }], [1, 1, { kind: "string", value: "ñ" }]
  ]);
});

it("consumes supplementary Unicode separators as complete characters", async () => {
  const book = await readText(new TextEncoder().encode('"a",😀\n"b",😀\n'), context);
  expect(book.sheets[0]!.cells.map(cell => [cell.row, cell.column, cell.value])).toEqual([
    [0, 0, { kind: "string", value: "a" }], [1, 0, { kind: "string", value: "b" }]
  ]);
});

it("advances a complete Unicode character while guessing the separator after a quote", async () => {
  const book = await readText(new TextEncoder().encode('"a"😀|x\n"b"😀|y\n'), context);
  expect(book.sheets[0]!.cells.map(cell => cell.value)).toEqual([
    { kind: "string", value: "a" }, { kind: "string", value: "x" },
    { kind: "string", value: "b" }, { kind: "string", value: "y" }
  ]);
});

it("detects BOM-less XML UTF-16 prefixes and truncates incomplete trailing code units", async () => {
  const cases = [
    new Uint8Array([60, 0, 63, 0, 120, 0, 44, 0, 98, 0, 10, 0]),
    new Uint8Array([0, 60, 0, 63, 0, 120, 0, 44, 0, 98, 0, 10]),
    new Uint8Array([239, 187, 191, 60, 63, 120, 44, 98, 10, 195]),
    new Uint8Array([255, 254, 60, 0, 63, 0, 120, 0, 44, 0, 98, 0, 10, 0, 90])
  ];
  for (const bytes of cases) {
    const book = await readText(bytes, context);
    expect(book.sheets[0]!.cells.map(cell => cell.value)).toEqual([
      { kind: "string", value: "<?x" }, { kind: "string", value: "b" }
    ]);
  }
});

it("admits byte budgets and cancellation before decoding", async () => {
  const bytes = new TextEncoder().encode("a,b");
  await expect(readText(bytes, { ...context, limits: { ...context.limits, inputBytes: 2 } }))
    .rejects.toThrow("input bytes limit exceeded");
  const controller = new AbortController();
  const reason = new Error("stop import");
  controller.abort(reason);
  await expect(readText(bytes, { ...context, signal: controller.signal })).rejects.toBe(reason);
});

it("grows imported sheet dimensions for a sparse long row", async () => {
  const engine = createEngine({ codecs: [], environment: context.environment, limits: context.limits });
  const book = await engine.readWorkbook({ kind: "stream", filename: "/stress.csv",
    source: [new TextEncoder().encode(",".repeat(300) + "x\n")] }, {}, context);
  expect(book.sheets[0]!.size).toEqual({ rows: 65536, columns: 512 });
  expect(book.sheets[0]!.cells[0]).toMatchObject({ row: 0, column: 300, value: { kind: "string", value: "x" } });
});

it("drops fields beyond the native maximum column with ordered warnings", async () => {
  const diagnostics: string[] = [];
  const book = await readText(new TextEncoder().encode(",".repeat(16384) + "x\n"), {
    ...context, async diagnostic(diagnostic) { diagnostics.push(diagnostic.message); }
  });
  expect(book.sheets[0]!.cells).toEqual([]);
  expect(diagnostics).toEqual([
    "There are more columns of data than there is room for in the sheet.  Extra columns will be ignored.",
    "Some data did not fit on the sheet and was dropped."
  ]);
});

it("preserves an interior BOM that GLib does not classify as whitespace", async () => {
  const book = await readText(new TextEncoder().encode("a\ufeff\tb\n"), { ...context, inputFilename: "/stress.tsv" });
  expect(book.sheets[0]!.cells[0]!.value).toEqual({ kind: "string", value: "a\ufeff" });
});

it("bounds content probing to 512 bytes and stops at the first NUL", async () => {
  expect(await probeText(new Uint8Array([97, 0, 1]), context)).toBe(true);
  expect(await probeText(new Uint8Array([97, 1]), context)).toBe(false);
  expect(await probeText(new Uint8Array([97, 128]), context)).toBe(false);
  expect(await probeText(new Uint8Array([...new Uint8Array(512).fill(97), 1]), context)).toBe(true);
});

it("falls back from invalid UTF-8 and honors Latin-1 rather than Windows-1252", async () => {
  expect((await readText(new Uint8Array([255, 44, 97]), context)).sheets[0]!.cells[0]!.value)
    .toEqual({ kind: "string", value: "ÿ" });
  expect((await readText(new Uint8Array([128]), context, "ISO-8859-1")).sheets[0]!.cells[0]!.value)
    .toEqual({ kind: "string", value: "\u0080" });
  expect((await readText(new Uint8Array([195, 169]), context, "Latin1")).sheets[0]!.cells[0]!.value)
    .toEqual({ kind: "string", value: "Ã©" });
  expect((await readText(new Uint8Array([195, 169]), context, "not-an-encoding")).sheets[0]!.cells[0]!.value)
    .toEqual({ kind: "string", value: "é" });
});

it("falls back from undefined Windows-1252 bytes as native iconv does", async () => {
  const book = await readText(new Uint8Array([128, 129, 10]), context, "WINDOWS-1252");
  expect(book.sheets[0]!.cells[0]!.value).toEqual({ kind: "string", value: "\u0080\u0081" });
});

it("honors explicit UTF-32 byte ordering and ignores incomplete final units", async () => {
  for (const [encoding, bytes] of [
    ["UTF-32LE", [97, 0, 0, 0, 44, 0, 0, 0, 98, 0, 0, 0, 10, 0, 0, 0, 90]],
    ["UTF-32BE", [0, 0, 0, 97, 0, 0, 0, 44, 0, 0, 0, 98, 0, 0, 0, 10, 90]]
  ] as const) {
    const book = await readText(new Uint8Array(bytes), context, encoding);
    expect(book.sheets[0]!.cells.map(cell => cell.value)).toEqual([
      { kind: "string", value: "a" }, { kind: "string", value: "b" }
    ]);
  }
});

it("keeps native UCS-4 big-endian ordering and iconv Latin-1 aliases", async () => {
  const bytes = new Uint8Array([97, 0, 0, 0, 44, 0, 0, 0, 98, 0, 0, 0]);
  const book = await readText(bytes, context, "UCS-4");
  expect(book.sheets[0]!.cells.map(cell => cell.value)).toEqual([
    { kind: "string", value: "a   " }, { kind: "string", value: "   b   " }
  ]);
  expect((await readText(new Uint8Array([128]), context, "ISO8859-1")).sheets[0]!.cells[0]!.value)
    .toEqual({ kind: "string", value: "\u0080" });
});

it.each([
  ["+AKM-", "£"], ["+AKM", "£"], ["+AK", "+AK"], ["+A-", "+A-"],
  ["+AKN-", "+AKN-"], ["+AKM!", "£!"], ["+-", "+"], ["+2D3eAA-", "😀"]
])("decodes native UTF-7 shifted sequence %s", async (encoded, decoded) => {
  const book = await readText(new TextEncoder().encode("h\n" + encoded + "\n"), context, "UTF-7");
  expect(book.sheets[0]!.cells[1]!.value).toEqual({ kind: "string", value: decoded });
});

it("replaces NULs and awaits the warning before observing cancellation", async () => {
  const messages: string[] = [];
  const bytes = new Uint8Array([97, 0, 44, 98, 0]);
  const book = await readText(bytes, { ...context,
    async diagnostic(diagnostic) { messages.push(diagnostic.message); }
  });
  expect(book.sheets[0]!.cells.map(cell => cell.value)).toEqual([
    { kind: "string", value: "a " }, { kind: "string", value: "b " }
  ]);
  expect(messages).toEqual(["The file contains 2 NUL characters. They have been changed to spaces."]);
  const controller = new AbortController();
  const reason = new Error("abort after warning");
  await expect(readText(bytes, { ...context, signal: controller.signal,
    async diagnostic(diagnostic) { messages.push(diagnostic.message); controller.abort(reason); }
  })).rejects.toBe(reason);
  expect(messages).toHaveLength(2);
});

it("uses source-defined locale argument separators before generic candidates", async () => {
  const book = await readText(new TextEncoder().encode("a,b;c\nx,y;z\n"), {
    ...context, inputFilename: "/stress.tsv", environment: { ...context.environment, locale: "de_DE.UTF-8" }
  });
  expect(book.sheets[0]!.cells.map(cell => cell.value)).toEqual([
    { kind: "string", value: "a,b" }, { kind: "string", value: "c" },
    { kind: "string", value: "x,y" }, { kind: "string", value: "z" }
  ]);
});
