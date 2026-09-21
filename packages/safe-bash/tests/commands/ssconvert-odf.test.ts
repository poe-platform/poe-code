import assert from "node:assert/strict";
import test from "node:test";
import { Volume } from "memfs";
import { createZipCodec } from "@poe-code/office-package";
import { createEngine, runCommand } from "poe-code/ssconvert";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { ssconvertCommands } from "../../src/commands/ssconvert/index.js";
import { FsError, isErrnoCode } from "../../src/contracts/index.js";

const config = { codecs: [], environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 1000, sheets: 8, operations: 1000 } };

test("ODF savers use the command/SDK engine with distinct profiles and replay bytes", async () => {
  const volume = Volume.fromJSON({ "/original.gnumeric": '<g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd"><g:Sheets><g:Sheet><g:Name>S</g:Name><g:Cells><g:Cell Row="0" Col="0" ValueType="50">#DIV/0!</g:Cell></g:Cells></g:Sheet></g:Sheets></g:Workbook>', "/keep": "untouched" });
  const shell = new Shell({ fs: filesystem(volume) }).use(ssconvertCommands(config));
  const engine = createEngine({ ...config, filesystem: {
    async read(uri, signal) { signal.throwIfAborted(); return [new Uint8Array(volume.readFileSync(uri) as Uint8Array)]; },
    async write(uri, bytes, signal) { signal.throwIfAborted(); volume.writeFileSync(uri, bytes); }
  } });
  try {
    for (const profile of ["openoffice", "odf"]) {
      const result = await shell.exec(`ssconvert -T Gnumeric_OpenCalc:${profile} /original.gnumeric /${profile}.ods`);
      assert.equal(result.exitCode, 0); assert.equal(result.stdout, ""); assert.equal(result.stderr, "");
      const sdk = await runCommand(["-T", `Gnumeric_OpenCalc:${profile}`, "/original.gnumeric", `/sdk-${profile}.ods`], engine,
        { signal: new AbortController().signal, stdout: { async write() {} }, stderr: { async write() {} } });
      assert.equal(sdk.exitCode, result.exitCode);
      assert.deepEqual(volume.readFileSync(`/${profile}.ods`), volume.readFileSync(`/sdk-${profile}.ods`));
      const replay = await shell.exec(`ssconvert -T Gnumeric_stf:stf_csv /${profile}.ods fd://1`);
      assert.equal(replay.exitCode, 0); assert.equal(replay.stdout, "#DIV/0!\n");
    }
    const automatic = await shell.exec("ssconvert /original.gnumeric /auto.ods");
    assert.equal(automatic.exitCode, 0); assert.deepEqual(volume.readFileSync("/auto.ods"), volume.readFileSync("/odf.ods"));
    assert.equal(volume.readFileSync("/keep", "utf8"), "untouched");
    assert.deepEqual(Object.keys(volume.toJSON()).sort(), ["/auto.ods", "/keep", "/odf.ods", "/openoffice.ods", "/original.gnumeric", "/sdk-odf.ods", "/sdk-openoffice.ods"]);
  } finally { await engine.dispose(); }
});
async function fixture(body: string, mime = "application/vnd.oasis.opendocument.spreadsheet", styles = "") {
  const zip = createZipCodec(), signal = new AbortController().signal;
  const bounds = { maxArchiveBytes: 100000, maxEntryBytes: 100000, maxTotalBytes: 100000,
    maxMembers: 20, maxPathBytes: 1024, maxDepth: 32, maxPaxBytes: 10000, maxTextBytes: 100000, chunkSize: 4096 };
  const urn = "urn:oasis:names:tc:opendocument:xmlns:";
  const content = `<o:document-content xmlns:o="${urn}office:1.0" xmlns:t="${urn}table:1.0" xmlns:x="${urn}text:1.0" xmlns:s="${urn}style:1.0" xmlns:n="${urn}datastyle:1.0"><o:automatic-styles>${styles}</o:automatic-styles><o:body><o:spreadsheet>${body}</o:spreadsheet></o:body></o:document-content>`;
  const entries = [];
  for (const [name, source] of Object.entries({ mimetype: mime, "content.xml": content })) entries.push(await zip.makeZipEntry(name, new TextEncoder().encode(source),
    { modified: new Date("2000-01-01Z"), mode: 0o644, directory: false, symlink: false, compression: "deflate" }, bounds, signal));
  return zip.writeZipArchive({ entries, comment: new Uint8Array() }, bounds, signal);
}
function filesystem(volume: Volume) {
  return new Proxy(new MemoryFileSystem(), { get(target, key) {
      // This memfs/mock host supplies buffered I/O, not the backing MemoryFileSystem streams.
      if (key === "readStream" || key === "writeStream") return undefined;
      if (key === "capabilities") return { ...target.capabilities, streamingRead: false, streamingWrite: false };
    if (key === "stat" || key === "lstat") return async (path: string) => {
      try { const stat = key === "lstat" ? volume.lstatSync(path) : volume.statSync(path);
        return { type: stat.isSymbolicLink() ? "symlink" : stat.isDirectory() ? "directory" : "file", size: Number(stat.size),
          mode: Number(stat.mode), mtimeMs: stat.mtimeMs, atimeMs: stat.atimeMs, ctimeMs: stat.ctimeMs };
      } catch (error) { if (error && typeof error === "object" && "code" in error && isErrnoCode(error.code)) throw new FsError(error.code, { path }); throw error; }
    };
    if (key === "readFile") return async (path: string, options?: { signal?: AbortSignal }) => {
      options?.signal?.throwIfAborted(); return new Uint8Array(volume.readFileSync(path) as Uint8Array);
    };
    if (key === "writeFile") return async (path: string, bytes: Uint8Array, options?: { signal?: AbortSignal; flag?: "w" | "wx"; mode?: number }) => {
      options?.signal?.throwIfAborted(); volume.writeFileSync(path, bytes, options);
    };
    if (key === "rename") return async (source: string, destination: string) => { volume.renameSync(source, destination); };
    if (key === "unlink") return async (path: string) => { volume.unlinkSync(path); };
    if (key === "readlink") return async (path: string) => String(volume.readlinkSync(path));
    if (key === "chmod") return async (path: string, mode: number) => { volume.chmodSync(path, mode); };
    if (key === "access") return async (path: string, mode?: number) => { volume.accessSync(path, mode); };
    const value: unknown = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
  } });
}
test("ssconvert OpenCalc uses the SDK engine and preserves memfs input, CSV bytes and replay", async () => {
  const source = await fixture('<t:table t:name="S"><t:table-row><t:table-cell o:value-type="string"><x:p>hello</x:p></t:table-cell><t:table-cell t:formula="of:=1+2" o:value-type="float" o:value="99"/></t:table-row></t:table>');
  const volume = Volume.fromJSON({ "/keep": "untouched" }); volume.writeFileSync("/book.ots", source);
  const shell = new Shell({ fs: filesystem(volume) }).use(ssconvertCommands(config)), engine = createEngine(config);
  try {
    const command = await shell.exec("ssconvert -T Gnumeric_XmlIO:sax:0 /book.ots /round.xml");
    assert.equal(command.exitCode, 0, command.stderr); assert.equal(command.stderr, ""); assert.equal(command.stdout, "");
    const chunks: Uint8Array[] = [];
    const sdk = await engine.convert({ input: { kind: "stream", filename: "book.ots", source: [source] }, exportType: "Gnumeric_XmlIO:sax:0",
      destination: { kind: "stream", sink: { async write(bytes) { chunks.push(new Uint8Array(bytes)); } } } }, { signal: new AbortController().signal });
    assert.equal(sdk.exitCode, 0); assert.deepEqual(sdk.diagnostics, []);
    assert.deepEqual(new Uint8Array(volume.readFileSync("/round.xml") as Uint8Array), chunks[0]);
    const cached = await shell.exec("ssconvert -T Gnumeric_stf:stf_csv /book.ots fd://1");
    assert.equal(cached.exitCode, 0, cached.stderr); assert.equal(cached.stderr, ""); assert.equal(cached.stdout, "hello,3\n");
    const replay = await shell.exec("ssconvert --recalc -T Gnumeric_stf:stf_csv /round.xml fd://1");
    assert.equal(replay.exitCode, 0, replay.stderr); assert.equal(replay.stderr, ""); assert.equal(replay.stdout, "hello,3\n");
    assert.deepEqual(new Uint8Array(volume.readFileSync("/book.ots") as Uint8Array), source);
    assert.equal(volume.readFileSync("/keep", "utf8"), "untouched");
    assert.deepEqual(Object.keys(volume.toJSON()).sort(), ["/book.ots", "/keep", "/round.xml"]);
  } finally { await engine.dispose(); await shell.dispose(); }
});

test("OpenCalc style families survive SDK import, command checkpoint and replay", async () => {
  const styles = '<n:number-style s:name="Fixed"><n:number n:decimal-places="2"/></n:number-style>' +
    '<s:style s:name="Shared" s:family="table-cell" s:data-style-name="Fixed"/>' +
    '<s:style s:name="Shared" s:family="table"><s:table-properties t:display="false"/></s:style>' +
    '<s:style s:name="Shared" s:family="table-row"><s:table-row-properties s:row-height="18pt"/></s:style>' +
    '<s:style s:name="Shared" s:family="table-column"><s:table-column-properties s:column-width="36pt"/></s:style>';
  const source = await fixture('<t:table t:name="S" t:style-name="Shared"><t:table-column t:style-name="Shared"/><t:table-row t:style-name="Shared"><t:table-cell t:style-name="Shared" o:value="1.25"/><t:table-cell o:boolean-value="FALSE"/></t:table-row></t:table>', undefined, styles);
  const volume = Volume.fromJSON({ "/keep": "unchanged" }); volume.writeFileSync("/book.ods", source);
  const shell = new Shell({ fs: filesystem(volume) }).use(ssconvertCommands(config)), engine = createEngine(config);
  const signal = new AbortController().signal;
  try {
    const imported = await engine.readWorkbook({ kind: "stream", filename: "book.ods", source: [source] }, {}, { signal });
    const original = imported.sheets[0]!;
    assert.equal(original.visibility, "hidden"); assert.equal(original.rows?.[0]?.sizePoints, 18);
    assert.equal(original.columns?.[0]?.sizePoints, 36); assert.equal(original.cells[0]?.format, "0.00");
    const saved = await shell.exec("ssconvert -T Gnumeric_XmlIO:sax:0 /book.ods /checkpoint.xml");
    assert.equal(saved.exitCode, 0, saved.stderr); assert.equal(saved.stderr, "");
    const checkpoint = new Uint8Array(volume.readFileSync("/checkpoint.xml") as Uint8Array);
    const loaded = await engine.readWorkbook({ kind: "stream", filename: "checkpoint.xml", source: [checkpoint] }, {}, { signal });
    const replayed = loaded.sheets[0]!;
    assert.equal(replayed.visibility, "hidden"); assert.equal(replayed.rows?.[0]?.sizePoints, 18);
    assert.equal(replayed.columns?.[0]?.sizePoints, 36); assert.equal(replayed.cells[0]?.format, "0.00");
    for (const input of ["/book.ods", "/checkpoint.xml"]) {
      const result = await shell.exec(`ssconvert -T Gnumeric_stf:stf_csv -O sheet=S ${input} fd://1`);
      assert.equal(result.exitCode, 0, result.stderr); assert.equal(result.stderr, ""); assert.equal(result.stdout, "1.25,FALSE\n");
    }
    assert.deepEqual(new Uint8Array(volume.readFileSync("/book.ods") as Uint8Array), source);
    assert.equal(volume.readFileSync("/keep", "utf8"), "unchanged");
  } finally { await engine.dispose(); await shell.dispose(); }
});

test("OpenCalc repeat budget failure preserves destination and cleans invocation outputs", async () => {
  const source = await fixture('<t:table t:name="S"><t:table-row t:number-rows-repeated="100"><t:table-cell t:number-columns-repeated="100" o:value="1"/></t:table-row></t:table>');
  const volume = Volume.fromJSON({ "/result.csv": "keep", "/keep": "untouched" }); volume.writeFileSync("/book.ods", source);
  const shell = new Shell({ fs: filesystem(volume) }).use(ssconvertCommands(config));
  try {
    const result = await shell.exec("ssconvert -T Gnumeric_stf:stf_csv /book.ods /result.csv");
    assert.equal(result.exitCode, 1); assert.equal(result.stdout, "");
    assert.equal(result.stderr, "ssconvert OpenDocument cells limit exceeded\n");
    assert.equal(volume.readFileSync("/result.csv", "utf8"), "keep");
    assert.equal(volume.readFileSync("/keep", "utf8"), "untouched");
    assert.deepEqual(Object.keys(volume.toJSON()).sort(), ["/book.ods", "/keep", "/result.csv"]);
  } finally { await shell.dispose(); }
});

test("OpenCalc passive drawing links confer no virtual filesystem or network authority", async () => {
  const source = await fixture('<t:table t:name="S"><t:table-row><t:table-cell o:value-type="string"><x:p>safe</x:p><d:frame xmlns:d="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:xl="http://www.w3.org/1999/xlink"><d:image xl:href="file:///secret"/><d:image xl:href="https://invalid.example/image.png"/></d:frame></t:table-cell></t:table-row></t:table>');
  const volume = Volume.fromJSON({ "/secret": "must not be read" }); volume.writeFileSync("/book.ods", source);
  const base = filesystem(volume), reads: string[] = [];
  const tracked = new Proxy(base, { get(target, key) {
      // This memfs/mock host supplies buffered I/O, not the backing MemoryFileSystem streams.
      if (key === "readStream" || key === "writeStream") return undefined;
      if (key === "capabilities") return { ...target.capabilities, streamingRead: false, streamingWrite: false };
    if (key === "readFile") return async (path: string, options?: Parameters<typeof base.readFile>[1]) => {
      reads.push(path); return await base.readFile(path, options);
    };
    return Reflect.get(target, key, target);
  } });
  const shell = new Shell({ fs: tracked }).use(ssconvertCommands(config));
  try {
    const result = await shell.exec("ssconvert -T Gnumeric_stf:stf_csv /book.ods fd://1");
    assert.equal(result.exitCode, 0, result.stderr); assert.equal(result.stderr, ""); assert.equal(result.stdout, "safe\n");
    assert.deepEqual(reads, ["/book.ods"]);
    assert.equal(volume.readFileSync("/secret", "utf8"), "must not be read");
    assert.deepEqual(Object.keys(volume.toJSON()).sort(), ["/book.ods", "/secret"]);
  } finally { await shell.dispose(); }
});
test("OpenCalc warnings precede output and malformed forced input has command/SDK status parity", async () => {
  const source = await fixture('<t:table t:name="S"><t:unknown/><t:table-row><t:table-cell o:value="2"/></t:table-row></t:table>');
  const volume = new Volume(); volume.writeFileSync("/book.ods", source);
  const shell = new Shell({ fs: filesystem(volume) }).use(ssconvertCommands(config)), engine = createEngine(config);
  try {
    const command = await shell.exec("ssconvert -T Gnumeric_stf:stf_csv /book.ods fd://1");
    const output: Uint8Array[] = [];
    const sdk = await engine.convert({ input: { kind: "stream", filename: "book.ods", source: [source] }, exportType: "Gnumeric_stf:stf_csv",
      destination: { kind: "stream", sink: { async write(bytes) { output.push(new Uint8Array(bytes)); } } } }, { signal: new AbortController().signal });
    assert.equal(command.exitCode, sdk.exitCode); assert.equal(command.exitCode, 0);
    assert.equal(command.stdout, new TextDecoder().decode(output[0])); assert.equal(command.stdout, "2\n");
    assert.equal(command.stderr, sdk.diagnostics.map(d => new TextDecoder().decode(d.bytes)).join(""));
    assert.equal(command.stderr, "Unexpected element 't:unknown' in state : \n\tdocument-content -> body -> spreadsheet -> table\n".repeat(2));
    volume.writeFileSync("/bad.ods", new Uint8Array([1, 2, 3]));
    const bad = await shell.exec("ssconvert -I Gnumeric_OpenCalc:openoffice -T Gnumeric_stf:stf_csv /bad.ods fd://1");
    const malformed = createEngine({ ...config, filesystem: { async read(uri) {
      return [new Uint8Array(volume.readFileSync(uri) as Uint8Array)];
    }, async write() { assert.fail("no output on failure"); } } });
    try {
      const stderr: Uint8Array[] = [];
      const failed = await runCommand(["-I", "Gnumeric_OpenCalc:openoffice", "-T", "Gnumeric_stf:stf_csv", "/bad.ods", "fd://1"], malformed,
        { signal: new AbortController().signal, stdout: { async write() { assert.fail("no output on failure"); } },
          stderr: { async write(bytes) { stderr.push(new Uint8Array(bytes)); } } });
      assert.equal(bad.exitCode, failed.exitCode); assert.equal(bad.exitCode, 1); assert.equal(bad.stdout, "");
      assert.equal(bad.stderr, stderr.map(b => new TextDecoder().decode(b)).join(""));
    } finally { await malformed.dispose(); }
  } finally { await engine.dispose(); await shell.dispose(); }
});
