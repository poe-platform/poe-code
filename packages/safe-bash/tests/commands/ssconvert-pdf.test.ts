import assert from "node:assert/strict";
import test from "node:test";
import { Volume } from "memfs";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { FsError, isErrnoCode } from "../../src/contracts/index.js";
import { ssconvertCommands } from "../../src/commands/ssconvert/index.js";
import { createEngine } from "poe-code/ssconvert";
import { PDFDocument } from "pdf-lib";

function filesystem(volume: Volume) {
  const base = new MemoryFileSystem();
  return new Proxy(base, { get(target, key) {
      // This memfs/mock host supplies buffered I/O, not the backing MemoryFileSystem streams.
      if (key === "readStream" || key === "writeStream") return undefined;
      if (key === "capabilities") return { ...target.capabilities, streamingRead: false, streamingWrite: false };
    if (key === "stat" || key === "lstat") return async (path: string) => {
      try {
        const stat = key === "lstat" ? volume.lstatSync(path) : volume.statSync(path);
        return { type: stat.isSymbolicLink() ? "symlink" : stat.isDirectory() ? "directory" : "file", size: Number(stat.size), mode: Number(stat.mode), mtimeMs: stat.mtimeMs, atimeMs: stat.atimeMs, ctimeMs: stat.ctimeMs };
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && isErrnoCode(error.code)) throw new FsError(error.code, { path });
        throw error;
      }
    };
    if (key === "readFile") return async (path: string, options?: { signal?: AbortSignal }) => { options?.signal?.throwIfAborted(); return new Uint8Array(volume.readFileSync(path) as Uint8Array); };
    if (key === "writeFile") return async (path: string, bytes: Uint8Array, options?: { signal?: AbortSignal; flag?: "w" | "wx"; mode?: number }) => { options?.signal?.throwIfAborted(); volume.writeFileSync(path, bytes, options); };
    if (key === "rename") return async (source: string, destination: string) => { volume.renameSync(source, destination); };
    if (key === "unlink") return async (path: string) => { volume.unlinkSync(path); };
    if (key === "readlink") return async (path: string) => String(volume.readlinkSync(path));
    if (key === "chmod") return async (path: string, mode: number) => { volume.chmodSync(path, mode); };
    if (key === "access") return async (path: string, mode?: number) => { volume.accessSync(path, mode); };
    const value: unknown = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
}
const binding = { codecs: [], limits: { inputBytes: 100000, outputBytes: 1000000, cells: 1000, sheets: 10, operations: 1000 }, environment: { env: {}, locale: "C", timezone: "UTC" } };

const source = '<g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd"><g:Sheets><g:Sheet><g:Name>One</g:Name><g:Objects><g:SheetObjectGraph Name="graph" AnchorMode="2" ObjectBound="A1:A1" ObjectOffset="0 0 71 35"><GogObject type="GogGraph"/></g:SheetObjectGraph></g:Objects><g:Cells/></g:Sheet></g:Sheets></g:Workbook>';
test("ssconvert PDF shares SDK bytes, first-object geometry and replay namespace effects", async () => {
  const volume = Volume.fromJSON({ "/input.gnumeric": source, "/keep": "untouched" });
  const shell = new Shell({ fs: filesystem(volume) }).use(ssconvertCommands(binding));
  const engine = createEngine(binding);
  try {
    const command = await shell.exec('ssconvert -T Gnumeric_pdf:pdf_assistant -O "object=graph paper=fit" /input.gnumeric /result.pdf');
    assert.equal(command.exitCode, 0, command.stderr); assert.equal(command.stdout, ""); assert.equal(command.stderr, "");
    const expected = new Uint8Array(volume.readFileSync("/result.pdf") as Uint8Array);
    const pdf = await PDFDocument.load(expected);
    assert.equal(pdf.getPageCount(), 1); assert.deepEqual(pdf.getPage(0).getSize(), { width: 71, height: 35 });
    const replay = await shell.exec('ssconvert -T Gnumeric_pdf:pdf_assistant -O "object=graph paper=fit" /input.gnumeric fd://1');
    assert.equal(replay.exitCode, 0); assert.equal(replay.stderr, ""); assert.deepEqual(replay.stdoutBytes, expected);
    const chunks: Uint8Array[] = [];
    const sdk = await engine.convert({ input: { kind: "stream", source: [new TextEncoder().encode(source)] }, exportType: "Gnumeric_pdf:pdf_assistant", exportOptions: ["object=graph paper=fit"], destination: { kind: "stream", sink: { async write(bytes) { chunks.push(new Uint8Array(bytes)); } } } }, { signal: new AbortController().signal });
    assert.equal(sdk.exitCode, 0); assert.deepEqual(sdk.diagnostics, []); assert.deepEqual(chunks, [expected]);
    const missing = await shell.exec('ssconvert -T Gnumeric_pdf:pdf_assistant -O object=missing /input.gnumeric /missing.pdf');
    assert.equal(missing.exitCode, 1); assert.equal(missing.stderr, "ssconvert: There is no object with name 'missing'\n");
    assert.equal(volume.readFileSync("/input.gnumeric", "utf8"), source); assert.equal(volume.readFileSync("/keep", "utf8"), "untouched");
    assert.deepEqual(Object.keys(volume.toJSON()).sort(), ["/input.gnumeric", "/keep", "/result.pdf"]);
  } finally { await engine.dispose(); await shell.dispose(); }
});

test("PDF persisted print geometry survives XML checkpoint and command/SDK replay", async () => {
  const input = '<g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd"><g:Sheets><g:Sheet><g:Name>One</g:Name><g:PrintInformation><g:paper>na_letter</g:paper><g:orientation>landscape</g:orientation><g:Scale type="percentage" percentage="50"/></g:PrintInformation><g:Cells>' + Array.from({ length: 90 }, (_, row) => `<g:Cell Row="${row}" Col="0" ValueType="60">row ${row}</g:Cell>`).join("") + '</g:Cells></g:Sheet></g:Sheets></g:Workbook>';
  const volume = Volume.fromJSON({ "/input.gnumeric": input, "/keep": "untouched" });
  const configuration = { ...binding, limits: { ...binding.limits, workbookWork: 2000000 } };
  const shell = new Shell({ fs: filesystem(volume) }).use(ssconvertCommands(configuration));
  const engine = createEngine(configuration);
  try {
    const original = await shell.exec('ssconvert -T Gnumeric_pdf:pdf_assistant /input.gnumeric fd://1');
    assert.equal(original.exitCode, 0, original.stderr);
    assert.equal(original.stderr, "");
    const pdf = await PDFDocument.load(original.stdoutBytes);
    assert.equal(pdf.getPageCount(), 2);
    assert.deepEqual(pdf.getPage(0).getSize(), { width: 792, height: 612 });
    const checkpoint = await shell.exec('ssconvert -T Gnumeric_XmlIO:sax:0 /input.gnumeric /checkpoint.xml');
    assert.equal(checkpoint.exitCode, 0, checkpoint.stderr);
    const replay = await shell.exec('ssconvert -T Gnumeric_pdf:pdf_assistant /checkpoint.xml fd://1');
    assert.equal(replay.exitCode, 0, replay.stderr);
    assert.deepEqual(replay.stdoutBytes, original.stdoutBytes);
    const chunks: Uint8Array[] = [];
    const sdk = await engine.convert({ input: { kind: "stream", source: [new TextEncoder().encode(input)] }, exportType: "Gnumeric_pdf:pdf_assistant", destination: { kind: "stream", sink: { async write(bytes) { chunks.push(new Uint8Array(bytes)); } } } }, { signal: new AbortController().signal });
    assert.equal(sdk.exitCode, 0);
    assert.deepEqual(chunks, [original.stdoutBytes]);
    volume.writeFileSync("/unsupported.gnumeric", input.replace('<g:paper>', '<g:grid value="1"/><g:paper>'));
    const failure = await shell.exec('ssconvert -T Gnumeric_pdf:pdf_assistant /unsupported.gnumeric /keep');
    assert.equal(failure.exitCode, 1);
    assert.equal(failure.stderr, "Unsupported ssconvert feature: PDF print grid\n");
    assert.equal(volume.readFileSync("/keep", "utf8"), "untouched");
    assert.equal(volume.readFileSync("/input.gnumeric", "utf8"), input);
    assert.deepEqual(Object.keys(volume.toJSON()).sort(), ["/checkpoint.xml", "/input.gnumeric", "/keep", "/unsupported.gnumeric"]);
  } finally { await engine.dispose(); await shell.dispose(); }
});
