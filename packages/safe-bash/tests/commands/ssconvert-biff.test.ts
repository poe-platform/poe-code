import assert from "node:assert/strict";
import test from "node:test";
import { Volume } from "memfs";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { FsError, isErrnoCode } from "../../src/contracts/index.js";
import { ssconvertCommands } from "../../src/commands/ssconvert/index.js";
import { createEngine } from "poe-code/ssconvert";

test("BIFF import shares actual virtual command/SDK bytes, replay and memfs effects", async () => {
  const source = new Uint8Array(30), view = new DataView(source.buffer);
  source.set([9, 2, 4, 0, 0, 3, 16, 0, 3, 2, 14, 0]); view.setFloat64(18, 42, true); source.set([10, 0, 0, 0], 26);
  const volume = Volume.fromJSON({ "/keep": "original" }); volume.writeFileSync("/input.xls", source);
  const fs = new Proxy(new MemoryFileSystem(), { get(target, key) {
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
  const config = { codecs: [], environment: { env: {}, locale: "C", timezone: "UTC" },
    limits: { inputBytes: 100000, outputBytes: 100000, cells: 1000, sheets: 8, operations: 1000 } };
  const shell = new Shell({ fs }).use(ssconvertCommands(config)), engine = createEngine(config);
  const signal = new AbortController().signal, chunks: Uint8Array[] = [];
  try {
    const command = await shell.exec("ssconvert -T Gnumeric_XmlIO:sax:0 /input.xls /round.xml");
    assert.equal(command.exitCode, 0, command.stderr); assert.equal(command.stdout, ""); assert.equal(command.stderr, "");
    const sdk = await engine.convert({ input: { kind: "stream", filename: "input.xls", source: [source] },
      exportType: "Gnumeric_XmlIO:sax:0", destination: { kind: "stream", sink: { async write(bytes) { chunks.push(new Uint8Array(bytes)); } } } }, { signal });
    assert.equal(sdk.exitCode, 0); assert.deepEqual(sdk.diagnostics, []);
    assert.deepEqual(new Uint8Array(volume.readFileSync("/round.xml") as Uint8Array), chunks[0]);
    for (const profile of ["excel_biff7", "excel_biff8", "excel_dsf"]) {
      const exported: Uint8Array[] = [];
      const sdkExport = await engine.convert({ input: { kind: "stream", filename: "input.xls", source: [source] },
        exportType: `Gnumeric_Excel:${profile}`, destination: { kind: "stream", sink: {
          async write(bytes) { exported.push(new Uint8Array(bytes)); }
        } } }, { signal });
      assert.equal(sdkExport.exitCode, 0); assert.deepEqual(sdkExport.diagnostics, []);
      const commandExport = await shell.exec(`ssconvert -T Gnumeric_Excel:${profile} /input.xls /export.xls`);
      assert.equal(commandExport.exitCode, 0, commandExport.stderr); assert.equal(commandExport.stderr, "");
      assert.deepEqual(new Uint8Array(volume.readFileSync("/export.xls") as Uint8Array), exported[0]);
      const replayExport = await shell.exec("ssconvert -T Gnumeric_stf:stf_csv /export.xls fd://1");
      assert.equal(replayExport.exitCode, 0, replayExport.stderr); assert.equal(replayExport.stderr, "");
      assert.equal(replayExport.stdout, "42\n"); volume.unlinkSync("/export.xls");
    }
    const replay = await shell.exec("ssconvert -T Gnumeric_stf:stf_csv /round.xml fd://1");
    assert.equal(replay.exitCode, 0, replay.stderr); assert.equal(replay.stderr, ""); assert.equal(replay.stdout, "42\n");
    const encoded = await shell.exec("ssconvert -E windows-1252 -I Gnumeric_Excel:excel_enc -T Gnumeric_stf:stf_csv /input.xls fd://1");
    assert.equal(encoded.exitCode, 0, encoded.stderr); assert.equal(encoded.stderr, ""); assert.equal(encoded.stdout, "42\n");
    // Original wide built-in NAME bytes: Sheet_Title_A with integer expression 42.
    const named = new Uint8Array([
      9, 8, 4, 0, 0, 6, 5, 0,
      24, 0, 24, 0, 32, 0, 0, 3, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 12, 0, 95, 0, 65, 0, 30, 42, 0,
      10, 0, 0, 0, 9, 8, 4, 0, 0, 6, 16, 0, 10, 0, 0, 0
    ]);
    volume.writeFileSync("/names.xls", named);
    const names = await shell.exec("ssconvert -I Gnumeric_Excel:excel -T Gnumeric_XmlIO:sax:0 /names.xls fd://1");
    assert.equal(names.exitCode, 0, names.stderr); assert.equal(names.stderr, "");
    assert.match(names.stdout, /<gnm:name>Sheet_Title_A<\/gnm:name>/);
    assert.match(names.stdout, /<gnm:value>42<\/gnm:value>/);
    volume.writeFileSync("/names.xml", names.stdout);
    const checkpoint = await engine.readWorkbook({ kind: "stream", source: [new TextEncoder().encode(names.stdout)] }, {}, { signal });
    assert.deepEqual(JSON.parse(JSON.stringify(checkpoint.names)),
      [
        { name: "Sheet_Title_A", expression: "42", position: { sheet: "s1", row: 0, column: 0 } },
        { name: "Sheet_Title", expression: '"Worksheet"', sheet: "s1", position: { sheet: "s1", row: 0, column: 0 } },
        { name: "Print_Area", expression: "#REF!", sheet: "s1", position: { sheet: "s1", row: 0, column: 0 } }
      ]);
    assert.equal(checkpoint.names?.[0]?.position?.sheet, checkpoint.sheets[0]?.id);
    const nameReplay = await shell.exec("ssconvert -T Gnumeric_XmlIO:sax:0 /names.xml fd://1");
    assert.equal(nameReplay.exitCode, 0, nameReplay.stderr); assert.equal(nameReplay.stderr, "");
    assert.match(nameReplay.stdout, /<gnm:value>42<\/gnm:value>/);
    volume.unlinkSync("/names.xls"); volume.unlinkSync("/names.xml");
    const listing = await shell.exec("ssconvert --list-importers");
    assert.equal(listing.exitCode, 0); assert.equal(listing.stdout, "");
    assert.match(listing.stderr, /Gnumeric_Excel:excel_enc/);
    const before = volume.toJSON(); volume.writeFileSync("/input.xls", source.subarray(0, 13));
    const corrupt = volume.toJSON(), denied = await shell.exec("ssconvert -I Gnumeric_Excel:excel -T Gnumeric_XmlIO:sax:0 /input.xls /round.xml");
    assert.equal(denied.exitCode, 1); assert.equal(denied.stdout, "");
    assert.equal(denied.stderr, "E Invalid Excel BIFF: truncated binary data\n"); assert.deepEqual(volume.toJSON(), corrupt);
    assert.deepEqual(Object.keys(before).sort(), ["/input.xls", "/keep", "/round.xml"]);
    assert.equal(volume.readFileSync("/keep", "utf8"), "original");
  } finally { await engine.dispose(); await shell.dispose(); }
});
