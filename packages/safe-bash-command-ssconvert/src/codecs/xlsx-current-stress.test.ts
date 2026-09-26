import { expect, it } from "vitest";
import { Volume } from "memfs";
import { createZipCodec } from "@poe-code/office-package";
import { createEngine } from "../engine.js";
import type { Cleanup, Diagnostic, RuntimeLimits } from "../contracts.js";

const ss = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const pkg = "http://schemas.openxmlformats.org/package/2006/relationships";
const limits: RuntimeLimits = { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 2, operations: 100 };

async function fixture(index: string, sheet?: string) {
  const parts = {
    "_rels/.rels": `<Relationships xmlns="${pkg}"><Relationship Id="w" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<workbook xmlns="${ss}" xmlns:r="${rel}"><sheets><sheet name="S" r:id="s"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships xmlns="${pkg}"><Relationship Id="s" Type="${rel}/worksheet" Target="worksheets/s.xml"/><Relationship Id="t" Type="${rel}/sharedStrings" Target="sharedStrings.xml"/></Relationships>`,
    "xl/sharedStrings.xml": `<sst xmlns="${ss}"><si><t>owned string</t></si></sst>`,
    "xl/worksheets/s.xml": `<worksheet xmlns="${ss}">${sheet ?? `<sheetData><row><c r="A1" t="s"><v>${index}</v></c><c r="B1"><v>42</v></c></row></sheetData>`}</worksheet>`
  };
  const codec = createZipCodec(), signal = new AbortController().signal;
  const bounds = { maxArchiveBytes: 100000, maxEntryBytes: 100000, maxTotalBytes: 100000,
    maxMembers: 30, maxPathBytes: 1024, maxDepth: 32, maxPaxBytes: 10000, maxTextBytes: 100000, chunkSize: 4096 };
  const entries = [];
  for (const [name, text] of Object.entries(parts)) entries.push(await codec.makeZipEntry(name, new TextEncoder().encode(text),
    { modified: new Date("2000-01-01Z"), mode: 0o644, directory: false, symlink: false, compression: "store" }, bounds, signal));
  return codec.writeZipArchive({ entries, comment: new Uint8Array() }, bounds, signal);
}

async function setup(index: string, suppliedLimits = limits, sheet?: string) {
  const volume = new Volume(); volume.writeFileSync("/book.xlsx", await fixture(index, sheet));
  volume.writeFileSync("/output.csv", "checkpoint");
  const writes: string[] = [], reads: string[] = [];
  const engine = createEngine({ codecs: [], environment: { env: {}, locale: "C", timezone: "UTC" }, limits: suppliedLimits,
    filesystem: { async read(uri, signal) { signal.throwIfAborted(); reads.push(uri); return [new Uint8Array(volume.readFileSync(uri) as Uint8Array)]; },
      async write(uri, bytes, signal) { signal.throwIfAborted(); writes.push(uri); volume.writeFileSync(uri, bytes); } } });
  return { engine, volume, writes, reads };
}

// Source evidence: Gnumeric 1.12.61 xlsx_cell_val_end and xlsx_relaxed_strtol.
it.each(["1", "-1", "0.0", "0e0", "0x0", "junk", " ", "9007199254740992", "0\u00a0"])("recovers an invalid shared-string reference %j with ordered warning", async index => {
  const { engine } = await setup(index), diagnostics: Diagnostic[] = [];
  try {
    const book = await engine.readWorkbook({ kind: "resource", uri: "/book.xlsx" }, {}, {
      signal: new AbortController().signal, async diagnostic(d) { diagnostics.push(d); }
    });
    expect(diagnostics.map(d => d.message)).toEqual([`S!A1 : Invalid sst ref '${index}'`]);
    expect(book.sheets[0]!.cells.find(cell => cell.column === 0)?.value ?? { kind: "blank" }).toEqual({ kind: "blank" });
    expect(book.sheets[0]!.cells.find(cell => cell.column === 1)!.value).toEqual({ kind: "number", value: 42 });
  } finally { await engine.dispose(); }
});

it.each(["mystery", "c"])("warns for unregistered unknown-prefix %s below a non-scanning row and drops its subtree", async element => {
  const { engine } = await setup("0", limits,
    `<sheetData><row><u:${element} xmlns:u="urn:unscanned"><u:v>99</u:v></u:${element}><c r="B1"><v>42</v></c></row></sheetData>`);
  const diagnostics: Diagnostic[] = [];
  try {
    const book = await engine.readWorkbook({ kind: "resource", uri: "/book.xlsx" }, {}, {
      signal: new AbortController().signal, async diagnostic(d) { diagnostics.push(d); }
    });
    expect(diagnostics.map(d => new TextDecoder().decode(d.bytes))).toEqual([
      `Unexpected element 'u:${element}' in state : \n\tworksheet -> sheetData -> row\n`
    ]);
    expect(book.sheets[0]!.cells.map(cell => [cell.column, cell.value])).toEqual([[1, { kind: "number", value: 42 }]]);
  } finally { await engine.dispose(); }
});

it("retains inline text below a default DrawingML cell whose parent does not scan namespaces", async () => {
  const { engine } = await setup("0", limits,
    '<sheetData><row><c xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" r="A1" t="inlineStr"><is><t>kept</t></is></c></row></sheetData>');
  const diagnostics: Diagnostic[] = [];
  try {
    const book = await engine.readWorkbook({ kind: "resource", uri: "/book.xlsx" }, {}, {
      signal: new AbortController().signal, async diagnostic(d) { diagnostics.push(d); }
    });
    expect(book.sheets[0]!.cells[0]!.value).toEqual({ kind: "string", value: "kept" });
    expect(diagnostics).toEqual([]);
  } finally { await engine.dispose(); }
});

it.each(["0", "+0", "-0", " 0 ", "00", "0\t", "0".repeat(128)])("accepts native decimal shared-string reference %j", async index => {
  const { engine } = await setup(index), messages: string[] = [];
  try {
    const book = await engine.readWorkbook({ kind: "resource", uri: "/book.xlsx" }, {}, {
      signal: new AbortController().signal, async diagnostic(d) { messages.push(d.message); }
    });
    expect(book.sheets[0]!.cells[0]!.value).toEqual({ kind: "string", value: "owned string" });
    expect(messages).toEqual([]);
  } finally { await engine.dispose(); }
});

it("keeps original snapshots owned across changed-input and restored-input replay", async () => {
  const { engine, volume } = await setup("0"), operation = { signal: new AbortController().signal };
  try {
    const original = await engine.readWorkbook({ kind: "resource", uri: "/book.xlsx" }, {}, operation);
    const bytes = volume.readFileSync("/book.xlsx") as Uint8Array;
    const checkpoint = new Uint8Array(bytes);
    volume.writeFileSync("/book.xlsx", await fixture("1"));
    const changed = await engine.readWorkbook({ kind: "resource", uri: "/book.xlsx" }, {}, operation);
    volume.writeFileSync("/book.xlsx", checkpoint);
    const replay = await engine.readWorkbook({ kind: "resource", uri: "/book.xlsx" }, {}, operation);
    checkpoint.fill(0);
    expect(original.sheets[0]!.cells[0]!.value).toEqual({ kind: "string", value: "owned string" });
    expect(changed.sheets[0]!.cells[0]!.value).toEqual({ kind: "blank" });
    expect(replay).toEqual(original);
    expect(Object.isFrozen(original.sheets[0]!.cells[0]!)).toBe(true);
  } finally { await engine.dispose(); }
});

it("rejects pre-aborted input and disposed engine calls without filesystem authority", async () => {
  const { engine, reads, writes } = await setup("0"), controller = new AbortController();
  const reason = Object.freeze({ cancelled: "before admission" }); controller.abort(reason);
  await expect(engine.readWorkbook({ kind: "resource", uri: "/book.xlsx" }, {}, { signal: controller.signal })).rejects.toBe(reason);
  await engine.dispose();
  await expect(engine.readWorkbook({ kind: "resource", uri: "/book.xlsx" }, {}, { signal: new AbortController().signal }))
    .rejects.toMatchObject({ code: "invalid-request" });
  expect(reads).toEqual([]); expect(writes).toEqual([]);
});

it("preserves cancellation identity and checkpoint output when a recovery warning cancels conversion", async () => {
  const { engine, volume, reads, writes } = await setup("1");
  const controller = new AbortController(), reason = Object.freeze({ cancelled: "original reason" });
  const cleanups: Cleanup[] = [];
  try {
    await expect(engine.convert({ input: { kind: "resource", uri: "/book.xlsx" }, destination: { kind: "resource", uri: "/output.csv" },
      exportType: "Gnumeric_stf:stf_csv" }, { signal: controller.signal,
      registerCleanup(cleanup) { expect(reads).toEqual([]); cleanups.push(cleanup); },
      async diagnostic(d) { expect(d.message).toBe("S!A1 : Invalid sst ref '1'"); controller.abort(reason); }
    })).rejects.toBe(reason);
    expect(reads).toEqual(["/book.xlsx"]); expect(writes).toEqual([]);
    expect(volume.readFileSync("/output.csv", "utf8")).toBe("checkpoint");
    expect(cleanups).toHaveLength(1);
    await cleanups[0]!(); await cleanups[0]!();
  } finally { await engine.dispose(); }
});

it("enforces diagnostic byte admission before the warning callback or output publication", async () => {
  const { engine, volume, writes } = await setup("1", { ...limits, outputBytes: 8 });
  const diagnostics: Diagnostic[] = [];
  try {
    await expect(engine.convert({ input: { kind: "resource", uri: "/book.xlsx" }, destination: { kind: "resource", uri: "/output.csv" },
      exportType: "Gnumeric_stf:stf_csv" }, { signal: new AbortController().signal, async diagnostic(d) { diagnostics.push(d); } }
    )).rejects.toMatchObject({ code: "resource-limit" });
    expect(diagnostics).toEqual([]); expect(writes).toEqual([]);
    expect(volume.readFileSync("/output.csv", "utf8")).toBe("checkpoint");
  } finally { await engine.dispose(); }
});
