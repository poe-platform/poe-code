import { expect, it } from "vitest";
import { Volume } from "memfs";
import { createEngine, createXlsxWriter, readXlsx, runCommand,
  type CapabilityContext, type Codec, type Workbook } from "safe-bash-command-ssconvert";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 1000000, outputBytes: 1000000, cells: 8, sheets: 2, operations: 12 } };
const book: Workbook = { sheets: [{ id: "independent", name: "Boundary", cells: [
  { row: 0, column: 0, value: { kind: "string", value: "Ω & <edge>" } }
] }] };

it.each(["2006", "2008"] as const)("public %s coordinate preflight does not execute sheet or cell array accessors", async edition => {
  let calls = 0;
  const sheets: Workbook["sheets"][number][] = [];
  Object.defineProperty(sheets, "0", { enumerable: true, get() { calls++; return book.sheets[0]; } });
  const cells: Workbook["sheets"][number]["cells"][number][] = [];
  Object.defineProperty(cells, "0", { enumerable: true, get() { calls++; return book.sheets[0]!.cells[0]; } });
  const sheet = { id: "x", name: "X", get cells() { calls++; return cells; } };
  for (const candidate of [{ sheets }, { sheets: [sheet] }, { sheets: [{ id: "x", name: "X", cells }] }]) {
    await expect(createXlsxWriter(edition)(candidate, [], context)).rejects.toMatchObject({ code: "invalid-request" });
  }
  expect(calls).toBe(0);
});

it("public coordinate preflight rejects oversized arrays and exhausted work without invoking indexed accessors", async () => {
  let calls = 0;
  const sheets = new Array<Workbook["sheets"][number]>(100000000);
  Object.defineProperty(sheets, "0", { enumerable: true, get() { calls++; return book.sheets[0]; } });
  const cells = new Array<Workbook["sheets"][number]["cells"][number]>(100000000);
  Object.defineProperty(cells, "0", { enumerable: true, get() { calls++; return book.sheets[0]!.cells[0]; } });
  for (const candidate of [{ sheets }, { sheets: [{ id: "x", name: "X", cells }] }]) {
    await expect(createXlsxWriter("2008")(candidate, [], context)).rejects.toMatchObject({ code: "resource-limit" });
  }
  const admittedSheets = [{ id: "x", name: "X", cells: [] }];
  Object.defineProperty(admittedSheets, "0", { enumerable: true, get() { calls++; return book.sheets[0]; } });
  await expect(createXlsxWriter("2008")({ sheets: admittedSheets }, [],
    { ...context, limits: { ...context.limits, workbookWork: 0 } })).rejects.toMatchObject({ code: "resource-limit" });
  expect(calls).toBe(0);
});

it.each(["2006", "2008"] as const)("public %s writer rejects nested authority and sparse data", async edition => {
  let calls = 0;
  const cell = { row: 0, column: 0, get value() { calls++; return { kind: "number" as const, value: 9 }; } };
  await expect(createXlsxWriter(edition)({ sheets: [{ id: "x", name: "X", cells: [cell] }] }, [], context))
    .rejects.toMatchObject({ code: "invalid-request" });
  expect(calls).toBe(0);
  const sparse = new Array<Workbook["sheets"][number]["cells"][number]>(2);
  sparse[1] = { row: 0, column: 0, value: { kind: "number", value: 9 } };
  await expect(createXlsxWriter(edition)({ sheets: [{ id: "x", name: "X", cells: sparse }] }, [], context))
    .rejects.toMatchObject({ code: "invalid-request" });
  const bytes = await createXlsxWriter(edition)(book, [], context);
  expect((await readXlsx(bytes, context)).sheets[0]!.cells[0]!.value)
    .toEqual({ kind: "string", value: "Ω & <edge>" });
});

it("pre-aborted public writer preserves falsey cancellation before caller inspection", async () => {
  let calls = 0;
  const hostile: Workbook = { get sheets() { calls++; return []; } };
  const controller = new AbortController(); controller.abort(false);
  await expect(createXlsxWriter("2008")(hostile, [], { ...context, signal: controller.signal })).rejects.toBe(false);
  expect(calls).toBe(0);
});

it("public workbook writer bounds text and output without mutating its source", async () => {
  const original = structuredClone(book);
  for (const limits of [{ workbookTextBytes: 0 }, { outputBytes: 0 }]) {
    await expect(createXlsxWriter("2008")(book, [], { ...context, limits: { ...context.limits, ...limits } }))
      .rejects.toMatchObject({ code: "resource-limit" });
  }
  expect(book).toEqual(original);
});

it("public CLI and SDK unknown exporter failures preserve the memfs namespace", async () => {
  const volume = Volume.fromJSON({ "/owned.fixture": "small" });
  let reads = 0, writes = 0;
  const codec: Codec = { id: "fixture", description: "Independent original fixture", extensions: ["fixture"],
    probeContent: () => true, async read() { return book; }, async write() { return new Uint8Array([1, 2]); } };
  const engine = createEngine({ codecs: [codec], limits: context.limits, environment: context.environment,
    filesystem: { async read(uri) { reads++; return [new Uint8Array(volume.readFileSync(uri) as Uint8Array)]; },
      async write(uri, bytes) { writes++; volume.writeFileSync(uri, bytes); } } });
  const errors: Uint8Array[] = [];
  try {
    const message = "Unknown exporter 'missing-independent'.\nTry --list-exporters to see a list of possibilities.";
    await expect(engine.convert({ input: { kind: "resource", uri: "/owned.fixture" },
      destination: { kind: "resource", uri: "/forbidden.fixture" }, exportType: "missing-independent" }, { signal: context.signal }))
      .rejects.toMatchObject({ code: "invalid-request", exitCode: 1, message });
    const cli = await runCommand(["-T", "missing-independent", "/owned.fixture", "/forbidden.fixture"], engine,
      { signal: context.signal, stdout: { async write() { throw new Error("unexpected stdout"); } },
        stderr: { async write(bytes) { errors.push(bytes.slice()); } } });
    expect(cli.exitCode).toBe(1);
    expect(new TextDecoder().decode(errors[0])).toContain(message);
    expect(reads).toBe(0); expect(writes).toBe(0);
    expect(volume.toJSON()).toEqual({ "/owned.fixture": "small" });
  } finally { await engine.dispose(); }
});

it("public engine blocks over-budget publication and input before codec execution", async () => {
  let readCalls = 0, sinkCalls = 0;
  const codec: Codec = { id: "bounded", description: "Independent budget control", extensions: ["fixture"],
    async read() { readCalls++; return book; }, async write() { return new Uint8Array([1, 2]); } };
  const engine = createEngine({ codecs: [codec], limits: { ...context.limits, inputBytes: 1, outputBytes: 1 },
    environment: context.environment });
  try {
    await expect(engine.writeWorkbook(book, { kind: "stream", sink: { async write() { sinkCalls++; } } },
      { exportType: "bounded" }, { signal: context.signal })).rejects.toMatchObject({ code: "invalid-request" });
    const owned = await engine.readWorkbook({ kind: "stream", source: [new Uint8Array([1])] },
      { importType: "bounded" }, { signal: context.signal });
    await expect(engine.writeWorkbook(owned, { kind: "stream", sink: { async write() { sinkCalls++; } } },
      { exportType: "bounded" }, { signal: context.signal })).rejects.toMatchObject({ code: "resource-limit" });
    expect(sinkCalls).toBe(0);
    await expect(engine.readWorkbook({ kind: "stream", source: [new Uint8Array([1]), new Uint8Array([2])] },
      { importType: "bounded" }, { signal: context.signal })).rejects.toMatchObject({ code: "resource-limit" });
    expect(readCalls).toBe(1);
  } finally { await engine.dispose(); }
  await expect(engine.readWorkbook({ kind: "stream", source: [] }, { importType: "bounded" },
    { signal: context.signal })).rejects.toMatchObject({ code: "invalid-request", message: "ssconvert engine is disposed" });
});
