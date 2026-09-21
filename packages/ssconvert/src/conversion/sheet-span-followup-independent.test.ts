import { expect, it } from "vitest";
import { Volume } from "memfs";
import { runInNewContext } from "node:vm";
import { createEngine, createResourceIO, runCommand, type CellRange, type Codec, type Workbook } from "../index.js";

// Independent expectations from 1.12.61 parse-util.c rangeref_parse,
// position.c gnm_rangeref_normalize_pp, and ssconvert.c apply_updates.
const book: Workbook = { activeSheet: "view", sheets: [
  { id: "large", name: "Big", cells: [], size: { rows: 256, columns: 256 } },
  { id: "small", name: "Tiny sheet", cells: [], size: { rows: 128, columns: 128 } },
  { id: "view", name: "View", cells: [], size: { rows: 256, columns: 256 } }
] };
const endpoints = (startRow: number, endRow: number, startColumn: number, endColumn: number): CellRange =>
  ({ sheet: "large", endSheet: "small", startRow, endRow, startColumn, endColumn });
const cases: readonly [string, CellRange][] = [
  ["Big:'Tiny sheet'!DY129", endpoints(0, 128, 0, 128)],
  ["Big:\"Tiny sheet\"!$DY$129", endpoints(128, 128, 128, 128)],
  ["Big:'Tiny sheet'!$DY129", endpoints(0, 128, 128, 128)],
  ["Big:'Tiny sheet'!DY$129", endpoints(128, 128, 0, 128)],
  ["Big:'Tiny sheet'!DY:EZ", endpoints(0, 127, 27, 128)],
  ["Big:'Tiny sheet'!$DY:EZ", endpoints(0, 127, 27, 128)],
  ["Big:'Tiny sheet'!DY:$EZ", endpoints(0, 127, 128, 155)],
  ["Big:'Tiny sheet'!129:64", endpoints(63, 128, 0, 127)],
  ["Big:'Tiny sheet'!DY129:A1", endpoints(0, 128, 0, 128)],
  ["Big:'Tiny sheet'!A1:DX128", endpoints(0, 127, 0, 127)],
  ["'Tiny sheet':Big!DX128", { ...endpoints(127, 127, 127, 127), sheet: "small", endSheet: "large" }]
];

function fixture(options: { outputBytes?: number; cancelOnWrite?: boolean; workbook?: Workbook } = {}) {
  const volume = Volume.fromJSON({ "/in": "original", "/keep": "unchanged" });
  const selections: unknown[] = [], updates: { range: CellRange; text: string }[] = [], events: string[] = [];
  const controller = new AbortController();
  const cancellation = new Error("independent cancellation");
  const codec: Codec = { id: "fixture", description: "Independent span fixture", extensions: [],
    saveScope: "sheet", sheetSelection: true, honorsExportRange: true,
    probeContent: () => true, async read() { events.push("decode"); return options.workbook ?? book; },
    async write(_book, _options, context, selection) {
      events.push("encode"); selections.push(selection);
      context.own(() => { events.push("cleanup"); });
      if (options.cancelOnWrite) controller.abort(cancellation);
      return new TextEncoder().encode("saved");
    }
  };
  const engine = createEngine({ codecs: [codec],
    environment: { env: {}, locale: "C", timezone: "UTC" },
    limits: { inputBytes: 100, outputBytes: options.outputBytes ?? 1000, cells: 10, sheets: 10, operations: 100 },
    cellText: { async setText(value, range, text) { updates.push({ range, text }); return value; } },
    filesystem: createResourceIO({ cwd: "/", filesystem: {
      async read(path) { events.push("read"); return [new Uint8Array(volume.readFileSync(path) as Uint8Array)]; },
      async write(path, bytes) { events.push("publish"); volume.writeFileSync(path, bytes); }
    } })
  });
  const request = { input: { kind: "resource" as const, uri: "/in" },
    destination: { kind: "resource" as const, uri: "/keep" }, exportType: "fixture" };
  async function cli(extra: readonly string[]) {
    const stderr: string[] = [], stdout: Uint8Array[] = [];
    const result = await runCommand(["-T", "fixture", ...extra, "/in", "/keep"], engine, {
      signal: controller.signal, stdout: { async write(bytes) { stdout.push(new Uint8Array(bytes)); } },
      stderr: { async write(bytes) { stderr.push(new TextDecoder().decode(bytes)); } }
    });
    return { result, stdout, stderr };
  }
  return { volume, engine, request, selections, updates, events, controller, cancellation, cli };
}

it.each(cases)("independently resolves unequal-dimension span via SDK and CLI: %s", async (expression, range) => {
  for (const route of ["sdk", "cli"]) {
    const f = fixture();
    if (route === "sdk") await f.engine.convert({ ...f.request, exportRangeExpression: expression }, { signal: f.controller.signal });
    else expect(await f.cli([`--export-range=${expression}`])).toMatchObject({ result: { exitCode: 0 }, stdout: [], stderr: [] });
    expect(f.selections).toEqual([{ sheets: [range.sheet], range }]);
    expect(f.events).toEqual(["read", "decode", "encode", "publish", "cleanup"]);
    expect(f.volume.toJSON()).toEqual({ "/in": "original", "/keep": "saved" });
    await f.engine.dispose();
  }
});

it.each(cases)("uses the normalized span coordinates through the active view for --set: %s", async (expression, expected) => {
  const f = fixture();
  expect(await f.cli([`--set=${expression}=value=with=equals`])).toMatchObject({ result: { exitCode: 0 }, stdout: [], stderr: [] });
  const { endSheet: ignoredEndSheet, ...range } = expected;
  expect(f.updates).toEqual([{ range: { ...range, sheet: "view" }, text: "value=with=equals" }]);
  expect(f.selections).toEqual([{ sheets: ["view"] }]);
  await f.engine.dispose();
});

it.each([
  "Big:'Tiny sheet'!DY129:$DY$129", // Explicit b coordinates exceed b's size.
  "'Tiny sheet':Big!DY129", // Explicit a coordinates exceed a's size.
  "Big:'Tiny sheet'!129:129", // Row-only b reference is validated independently.
  "Big:'Tiny sheet'!DY:EZjunk", "Big:'Tiny sheet'!A1:",
  "Big:'Tiny sheet'!A1:DX128 trailing", "Big:Unknown!A1", "Big:'Tiny sheet'!A0"
])("rejects invalid span syntax via both engines without namespace effects: %s", async expression => {
  const f = fixture();
  await expect(f.engine.convert({ ...f.request, exportRangeExpression: expression }, { signal: f.controller.signal }))
    .rejects.toMatchObject({ exitCode: 1, message: "Invalid range specified." });
  expect(await f.cli([`--export-range=${expression}`])).toEqual({ result: { exitCode: 1 }, stdout: [], stderr: ["Invalid range specified.\n"] });
  expect(await f.cli([`--set=${expression}=ignored`])).toEqual({ result: { exitCode: 1 }, stdout: [],
    stderr: [`Failed to set cell ${expression}=ignored\n`] });
  expect(f.selections).toEqual([]);
  expect(f.updates).toEqual([]);
  expect(f.events).toEqual(["read", "decode", "read", "decode", "read", "decode"]);
  expect(f.volume.toJSON()).toEqual({ "/in": "original", "/keep": "unchanged" });
  await f.engine.dispose();
});

it("does not acquire input or output for a pre-cancelled qualified span", async () => {
  const f = fixture();
  f.controller.abort(f.cancellation);
  await expect(f.engine.convert({ ...f.request, exportRangeExpression: cases[0]![0] }, { signal: f.controller.signal }))
    .rejects.toBe(f.cancellation);
  expect(f.events).toEqual([]);
  expect(f.volume.toJSON()).toEqual({ "/in": "original", "/keep": "unchanged" });
  await f.engine.dispose();
});

it("cleans up a cancellation raised by the injected span exporter without publishing", async () => {
  const f = fixture({ cancelOnWrite: true });
  await expect(f.engine.convert({ ...f.request, exportRangeExpression: cases[0]![0] }, { signal: f.controller.signal }))
    .rejects.toBe(f.cancellation);
  expect(f.events).toEqual(["read", "decode", "encode", "cleanup"]);
  expect(f.volume.toJSON()).toEqual({ "/in": "original", "/keep": "unchanged" });
  await f.engine.dispose();
});

it("enforces output bytes after successful span resolution and cleans up without publication", async () => {
  const f = fixture({ outputBytes: 4 });
  await expect(f.engine.convert({ ...f.request, exportRangeExpression: cases[0]![0] }, { signal: f.controller.signal }))
    .rejects.toMatchObject({ code: "resource-limit", message: "ssconvert output bytes limit exceeded" });
  expect(f.events).toEqual(["read", "decode", "encode", "cleanup"]);
  expect(f.volume.toJSON()).toEqual({ "/in": "original", "/keep": "unchanged" });
  await f.engine.dispose();
});

it("denies unsupported cross-realm object prototypes for SDK and CLI before exporting", async () => {
  const original = JSON.stringify(book);
  const foreign = runInNewContext(`JSON.parse(${JSON.stringify(original)})`) as Workbook;
  expect(Object.getPrototypeOf(foreign)).not.toBe(Object.prototype);
  for (const route of ["sdk", "cli"]) {
    const f = fixture({ workbook: foreign });
    if (route === "sdk") await expect(f.engine.convert({ ...f.request, exportRangeExpression: cases[0]![0] }, { signal: f.controller.signal }))
      .rejects.toMatchObject({ code: "invalid-request", exitCode: 1, message: "Unsupported workbook prototype" });
    else expect(await f.cli([`--export-range=${cases[0]![0]}`])).toEqual({ result: { exitCode: 1 }, stdout: [],
      stderr: ["Unsupported workbook prototype\n"] });
    expect(f.selections).toEqual([]);
    expect(f.updates).toEqual([]);
    expect(f.events).toEqual(["read", "decode"]);
    expect(JSON.stringify(foreign)).toBe(original);
    expect(f.volume.toJSON()).toEqual({ "/in": "original", "/keep": "unchanged" });
    await f.engine.dispose();
  }
});

it("admits foreign-realm null-prototype records with ordinary foreign arrays for span execution", async () => {
  const original = JSON.stringify(book);
  const foreign = runInNewContext(`JSON.parse(${JSON.stringify(original)}, (_key, value) => {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) Object.setPrototypeOf(value, null);
    return value;
  })`) as Workbook;
  expect(Object.getPrototypeOf(foreign)).toBe(null);
  for (const route of ["sdk", "cli"]) {
    const f = fixture({ workbook: foreign });
    if (route === "sdk") await f.engine.convert({ ...f.request, exportRangeExpression: cases[0]![0] }, { signal: f.controller.signal });
    else expect(await f.cli([`--export-range=${cases[0]![0]}`])).toMatchObject({ result: { exitCode: 0 }, stdout: [], stderr: [] });
    expect(f.selections).toEqual([{ sheets: ["large"], range: cases[0]![1] }]);
    expect(JSON.stringify(foreign)).toBe(original);
    expect(f.volume.toJSON()).toEqual({ "/in": "original", "/keep": "saved" });
    await f.engine.dispose();
  }
});

it("denies own workbook accessors without invoking host authority before span execution", async () => {
  let calls = 0;
  const malicious = { ...book };
  Object.defineProperty(malicious, "sheets", { enumerable: true, get() { calls++; return book.sheets; } });
  const f = fixture({ workbook: malicious });
  await expect(f.engine.convert({ ...f.request, exportRangeExpression: cases[0]![0] }, { signal: f.controller.signal }))
    .rejects.toMatchObject({ code: "invalid-request", exitCode: 1, message: "Unsupported workbook accessor" });
  expect(calls).toBe(0);
  expect(f.events).toEqual(["read", "decode"]);
  expect(f.selections).toEqual([]);
  expect(f.volume.toJSON()).toEqual({ "/in": "original", "/keep": "unchanged" });
  await f.engine.dispose();
});
