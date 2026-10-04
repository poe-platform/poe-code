import assert from "node:assert/strict";
import { it } from "node:test";
import { createEngine } from "@poe-code/spreadsheet-engine";
import { xlsxFormat } from "@poe-code/spreadsheet-format-xlsx";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createSofficeCommand, createStoredZipArchive, runSofficeCli, runSofficeCliSync, runSofficeFileCli } from "./index.js";

const encode = (text: string) => new TextEncoder().encode(text);
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

function odsFixture(): Uint8Array {
  return createStoredZipArchive({
    mimetype: encode("application/vnd.oasis.opendocument.spreadsheet"),
    "META-INF/manifest.xml": encode('<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2"><manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.spreadsheet"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/></manifest:manifest>'),
    "content.xml": encode(`<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.2"><office:body><office:spreadsheet>
      <table:table table:name="Data"><table:table-row>
        <table:table-cell office:value-type="string"><text:p>Name</text:p></table:table-cell>
        <table:table-cell office:value-type="string"><text:p>Amount</text:p></table:table-cell>
        <table:table-cell office:value-type="string"><text:p>Enabled</text:p></table:table-cell>
      </table:table-row><table:table-row>
        <table:table-cell office:value-type="string"><text:p>Łódź, "office"<text:line-break/>second</text:p></table:table-cell>
        <table:table-cell office:value-type="float" office:value="42.5"><text:p>42.5</text:p></table:table-cell>
        <table:table-cell office:value-type="boolean" office:boolean-value="true"><text:p>TRUE</text:p></table:table-cell>
      </table:table-row></table:table>
      <table:table table:name="Extras"><table:table-row><table:table-cell table:number-columns-repeated="27"/><table:table-cell office:value-type="string"><text:p>Column AB</text:p></table:table-cell></table:table-row></table:table>
    </office:spreadsheet></office:body></office:document-content>`)
  });
}

it("exports ODS as actual CSV with embedded line breaks, quoting and typed values", async () => {
  const source = odsFixture();
  const files = new Map([["/source.ods", source]]);
  const result = await runSofficeCli(["--convert-to", "csv", "--outdir", "/out", "/source.ods"], files);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(decode(files.get("/out/source.csv")!), 'Name,Amount,Enabled\n"Łódź, ""office""\nsecond",42.5,TRUE\n');
  assert.equal(files.get("/source.ods"), source);
});

it("applies StarCalc CSV separator and quote-all options to ODS", async () => {
  const files = new Map([["/source.ods", odsFixture()]]);
  const result = await runSofficeCli(["--convert-to", "csv:Text - txt - csv (StarCalc):59,34,0,1,,0,true", "/source.ods"], files);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(decode(files.get("/source.csv")!), '"Name";"Amount";"Enabled"\n"Łódź, ""office""\nsecond";"42.5";"TRUE"\n');
});

it("exports ODS as a readable XLSX workbook preserving types, sheets and column positions", async () => {
  const files = new Map([["/source.ods", odsFixture()]]);
  const result = await runSofficeCli(["--convert-to", "xlsx", "/source.ods"], files);
  assert.equal(result.exitCode, 0, result.stderr);
  const output = files.get("/source.xlsx")!;
  assert.deepEqual([...output.slice(0, 4)], [0x50, 0x4b, 3, 4]);
  const engine = createEngine({ formats: [xlsxFormat] });
  try {
    const book = await engine.readWorkbook({ kind: "stream", filename: "source.xlsx", source: [output] }, {}, { signal: new AbortController().signal });
    assert.deepEqual(book.sheets.map(sheet => sheet.name), ["Data", "Extras"]);
    assert.deepEqual(book.sheets[0]!.cells.filter(cell => cell.row === 1).map(cell => ({ ...cell.value })), [
      { kind: "string", value: 'Łódź, "office"\nsecond' }, { kind: "number", value: 42.5 }, { kind: "boolean", value: true }
    ]);
    assert.deepEqual(book.sheets[1]!.cells.filter(cell => cell.value.kind !== "blank").map(cell => [cell.column, { ...cell.value }]), [[27, { kind: "string", value: "Column AB" }]]);
  } finally { await engine.dispose(); }
});

it("uses the same ODS conversion in the shell command", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/source.ods", odsFixture());
  const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
  const result = await createSofficeCommand().execute({
    command: "soffice", cwd: "/", env: {}, fs,
    ...createCommandArguments(["--headless", "--convert-to", "csv", "/source.ods"]),
    signal: new AbortController().signal, stdin: toByteSource(""),
    stdout: { async write(bytes) { stdout.push(bytes.slice()); } }, stderr: { async write(bytes) { stderr.push(bytes.slice()); } }
  });
  assert.equal(result.exitCode, 0, stderr.map(decode).join(""));
  assert.equal(decode(await fs.readFile("/source.csv")), 'Name,Amount,Enabled\n"Łódź, ""office""\nsecond",42.5,TRUE\n');
  assert.ok(stdout.map(decode).join("").includes("using filter : Text - txt - csv (StarCalc)"));
});

it("preserves an existing destination when ODS conversion fails", async () => {
  const saved = encode("existing workbook");
  const files = new Map([["/broken.ods", createStoredZipArchive({ "content.xml": encode("<broken>") })], ["/broken.xlsx", saved]]);
  const result = await runSofficeCli(["--convert-to", "xlsx", "/broken.ods"], files);
  assert.notEqual(result.exitCode, 0);
  assert.equal(files.get("/broken.xlsx"), saved);
});

it("does not claim a synchronous ODS export succeeded with plain text in an XLSX file", () => {
  const saved = encode("existing workbook");
  const files = new Map([["/source.ods", odsFixture()], ["/source.xlsx", saved]]);
  const result = runSofficeCliSync(["--convert-to", "xlsx", "/source.ods"], files);
  assert.notEqual(result.exitCode, 0);
  assert.equal(files.get("/source.xlsx"), saved);
});

for (const timing of ["before", "during"] as const)
it(`honors cancellation ${timing} an async ODS conversion without publishing`, async () => {
  const saved = encode("existing workbook");
  const files = new Map([["/source.ods", odsFixture()], ["/source.xlsx", saved]]);
  const controller = new AbortController();
  const reason = new Error("conversion cancelled");
  if (timing === "before") controller.abort(reason);
  const conversion = runSofficeCli(["--convert-to", "xlsx", "/source.ods"], files, "/", { signal: controller.signal });
  if (timing === "during") controller.abort(reason);
  await assert.rejects(conversion, error => error === reason);
  assert.equal(files.get("/source.xlsx"), saved);
});

for (const format of ["csv", "xlsx"]) it(`uses caller storage and streaming publication for ODS to ${format}`, async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/source.ods", odsFixture());
  const filesystem = new Proxy(fs, { get(target, key) {
    if (key === "readFile" || key === "writeFile") return () => { throw new Error("whole-file I/O forbidden"); };
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
  const result = await createSofficeCommand().execute({
    command: "soffice", cwd: "/", env: {}, fs: filesystem,
    ...createCommandArguments(["--convert-to", format, "/source.ods"]),
    signal: new AbortController().signal, stdin: toByteSource(""),
    stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
    stderr: { async write(bytes) { stderr.push(bytes.slice()); } }
  });
  assert.equal(result.exitCode, 0, stderr.map(decode).join(""));
  const output = await fs.readFile(`/source.${format}`);
  if (format === "csv") assert.equal(decode(output), 'Name,Amount,Enabled\n"Łódź, ""office""\nsecond",42.5,TRUE\n');
  else {
    const engine = createEngine({ formats: [xlsxFormat] });
    try {
      const book = await engine.readWorkbook({ kind: "stream", filename: "result.xlsx", source: [output] }, {}, { signal: new AbortController().signal });
      assert.deepEqual(book.sheets.map(sheet => sheet.name), ["Data", "Extras"]);
      assert.equal(book.sheets[1]!.cells.find(cell => cell.value.kind === "string")?.column, 27);
    } finally { await engine.dispose(); }
  }
  assert.deepEqual((await fs.readdir("/")).map(entry => entry.name).sort(), ["source.ods", `source.${format}`].sort());
});

for (const mode of ["malformed", "limit", "cancel", "publish"] as const) it(`retains ODS destination and cleans backing files on ${mode}`, async () => {
  const fs = new MemoryFileSystem(), controller = new AbortController(), failure = new Error(mode);
  await fs.writeFile("/source.ods", mode === "malformed" ? createStoredZipArchive({ "content.xml": encode("<broken>") }) : odsFixture());
  await fs.writeFile("/source.csv", encode("saved"));
  let stages = 0, removed = 0, closed = 0, diagnostic = "";
  const filesystem = new Proxy(fs, { get(target, key) {
    if (key === "readFile" || key === "writeFile") return () => { throw new Error("whole-file I/O forbidden"); };
    if (key === "publishStagedFile" && mode === "publish") return async () => { throw failure; };
    if (key === "createStagedFile") return async (...args: Parameters<typeof fs.createStagedFile>) => {
      const stage = await fs.createStagedFile(...args); stages++;
      return { ...stage, writer: {
        async write(bytes: Uint8Array, options?: { signal?: AbortSignal }) {
          await stage.writer!.write(bytes, options);
          if (mode === "cancel") controller.abort(failure);
        }, finish: stage.writer!.finish.bind(stage.writer)
      }, cleanup: {
        async remove() { removed++; await stage.cleanup!.remove(); },
        async close() { closed++; await stage.cleanup!.close(); }
      } };
    };
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const execution = runSofficeFileCli(["--convert-to", "csv", "/source.ods"], { filesystem,
    signal: controller.signal, limits: mode === "limit" ? { maxOutputBytes: 100 } : {},
    stdout: { async write() {} }, stderr: { async write(bytes) { diagnostic += decode(bytes); } } });
  if (mode === "malformed") {
    assert.equal((await execution).exitCode, 1);
    assert.match(diagnostic, /conversion failed/);
  } else await assert.rejects(execution, error => mode === "limit" ? error instanceof RangeError : error === failure);
  assert.equal(decode(await fs.readFile("/source.csv")), "saved");
  assert.equal(removed, stages); assert.equal(closed, stages);
  assert.deepEqual((await fs.readdir("/")).map(entry => entry.name).sort(), ["source.csv", "source.ods"]);
});

it("retains ODS input and CSV output larger than the adapter cache", async () => {
  const fs = new MemoryFileSystem(), text = "abcdef".repeat(180000);
  const source = createStoredZipArchive({ "content.xml": encode(`<office:document-content
    xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
    xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"
    xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:spreadsheet>
    <table:table table:name="Data"><table:table-row><table:table-cell office:value-type="string"><text:p>${text}</text:p>
    </table:table-cell></table:table-row></table:table></office:spreadsheet></office:body></office:document-content>`) });
  await fs.writeFile("/source.ods", source);
  let reads = 0, writes = 0, opened = 0, closed = 0;
  const filesystem = new Proxy(fs, { get(target, key) {
    if (key === "readFile" || key === "writeFile") return () => { throw new Error("whole-file I/O forbidden"); };
    if (key === "open") return async (...args: Parameters<typeof fs.open>) => {
      const handle = await fs.open(...args); opened++;
      return new Proxy(handle, { get(target, key) {
        if (key === "read") return async (...args: Parameters<typeof handle.read>) => { reads = Math.max(reads, args[0].length); return handle.read(...args); };
        if (key === "write") return async (...args: Parameters<typeof handle.write>) => { writes = Math.max(writes, args[0].length); return handle.write(...args); };
        if (key === "close") return async () => { closed++; await handle.close(); };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      } });
    };
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const result = await runSofficeFileCli(["--convert-to", "csv", "/source.ods"], { filesystem,
    stdout: { async write() {} }, stderr: { async write(bytes) { assert.fail(decode(bytes)); } } });
  assert.equal(result.exitCode, 0);
  assert.equal(decode(await fs.readFile("/source.csv")), text + "\n");
  assert.ok(opened > 0); assert.equal(closed, opened);
  assert.ok(reads > 0 && reads <= 16384); assert.ok(writes > 0 && writes <= 16384);
  assert.deepEqual((await fs.readdir("/")).map(entry => entry.name).sort(), ["source.csv", "source.ods"]);
});

for (const format of ['csv', 'xlsx'] as const) it(`does not retain all scalar ODS cells while exporting ${format}`, async () => {
  const source = createStoredZipArchive({'content.xml': encode(`<office:document-content
    xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"
    xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:spreadsheet><table:table table:name="Data">
    <table:table-row table:number-rows-repeated="200"><table:table-cell office:value-type="string"><text:p>record</text:p></table:table-cell></table:table-row>
    </table:table></office:spreadsheet></office:body></office:document-content>`) });
  const filesystem = new MemoryFileSystem(); await filesystem.writeFile('/records.ods', source);
  const push = Array.prototype.push;
  Array.prototype.push = function (...items) {
    if (this.length >= 64 && items.some(item => item && typeof item === 'object' && 'row' in item && 'column' in item && 'value' in item))
      throw new Error('whole worksheet cell array forbidden');
    return push.apply(this, items);
  };
  try {
    const result = await runSofficeFileCli(['--convert-to', format, '/records.ods'], {filesystem,
      stdout: {async write() {}}, stderr: {async write(bytes) {assert.fail(decode(bytes));}}});
    assert.equal(result.exitCode, 0);
  } finally {Array.prototype.push = push;}
  const bytes = await filesystem.readFile(`/records.${format}`);
  if (format === 'csv') assert.equal(decode(bytes), 'record\n'.repeat(200));
  else {
    const engine = createEngine({formats: [xlsxFormat]});
    try {
      const book = await engine.readWorkbook({kind: 'stream', filename: 'records.xlsx', source: [bytes]}, {}, {signal: new AbortController().signal});
      assert.equal(book.sheets[0]!.cells.length, 200);
      assert.deepEqual({...book.sheets[0]!.cells.at(-1)?.value}, {kind: 'string', value: 'record'});
    } finally {await engine.dispose();}
  }
});

for (const format of ['csv', 'xlsx'] as const) it(`preserves ODS cached formula results when transcoding to ${format}`, async () => {
  const source = createStoredZipArchive({'content.xml': encode(`<office:document-content
    xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"
    xmlns:of="urn:oasis:names:tc:opendocument:xmlns:of:1.2"><office:body><office:spreadsheet><table:table table:name="Data">
    <table:table-row><table:table-cell table:formula="of:=1+1" office:value-type="float" office:value="7"/></table:table-row>
    </table:table></office:spreadsheet></office:body></office:document-content>`) });
  const filesystem = new MemoryFileSystem(); await filesystem.writeFile('/cached.ods', source);
  const result = await runSofficeFileCli(['--convert-to', format, '/cached.ods'], {filesystem,
    stdout: {async write() {}}, stderr: {async write(bytes) {assert.fail(decode(bytes));}}});
  assert.equal(result.exitCode, 0);
  const bytes = await filesystem.readFile(`/cached.${format}`);
  if (format === 'csv') assert.equal(decode(bytes), '7\n');
  else {
    const engine = createEngine({formats: [xlsxFormat]});
    try {
      const book = await engine.readWorkbook({kind: 'stream', filename: 'cached.xlsx', source: [bytes]}, {}, {signal: new AbortController().signal});
      const cell = book.sheets[0]!.cells[0]!;
      assert.equal(cell.formula, '=1+1'); assert.deepEqual({...cell.value}, {kind: 'number', value: 7});
    } finally {await engine.dispose();}
  }
});
