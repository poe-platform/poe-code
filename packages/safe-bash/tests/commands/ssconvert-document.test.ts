import assert from "node:assert/strict";
import test from "node:test";
import { Volume } from "memfs";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { FsError, isErrnoCode } from "../../src/contracts/index.js";
import { ssconvertCommands } from "../../src/commands/ssconvert/index.js";
import { createEngine } from "poe-code/ssconvert";
import golden from "../../../safe-bash-command-ssconvert/src/codecs/latex-roff-golden.json" with { type: "json" };

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
for (const [format, capture] of Object.entries(golden.small.exports)) test(`ssconvert ${format} keeps CLI/SDK/native bytes and replay namespace effects`, async () => {
  const volume = Volume.fromJSON({ "/input.gnumeric": golden.small.source, "/keep": "untouched" });
  const shell = new Shell({ fs: filesystem(volume) }).use(ssconvertCommands(binding));
  const engine = createEngine(binding);
  try {
    const command = await shell.exec(`ssconvert -T Gnumeric_html:${format} /input.gnumeric /result`);
    assert.equal(command.exitCode, capture.status, command.stderr); assert.equal(command.stdout, ""); assert.equal(command.stderr, capture.stderr);
    const expected = new Uint8Array(Buffer.from(capture.base64, "base64"));
    assert.deepEqual(new Uint8Array(volume.readFileSync("/result") as Uint8Array), expected);
    const replay = await shell.exec(`ssconvert -T Gnumeric_html:${format} /input.gnumeric fd://1`);
    assert.equal(replay.exitCode, command.exitCode); assert.equal(replay.stderr, command.stderr); assert.deepEqual(replay.stdoutBytes, expected);
    const chunks: Uint8Array[] = [];
    const sdk = await engine.convert({ input: { kind: "stream", source: [new TextEncoder().encode(golden.small.source)] }, exportType: `Gnumeric_html:${format}`, destination: { kind: "stream", sink: { async write(bytes) { chunks.push(new Uint8Array(bytes)); } } } }, { signal: new AbortController().signal });
    assert.equal(sdk.exitCode, command.exitCode); assert.deepEqual(sdk.diagnostics, []); assert.deepEqual(chunks, [expected]);
    assert.equal(volume.readFileSync("/input.gnumeric", "utf8"), golden.small.source); assert.equal(volume.readFileSync("/keep", "utf8"), "untouched");
    assert.deepEqual(Object.keys(volume.toJSON()).sort(), ["/input.gnumeric", "/keep", "/result"]);
  } finally { await engine.dispose(); await shell.dispose(); }
});
test("ssconvert glossary derives language from VFS output filename with injected time", async () => {
  const source = '<Workbook xmlns="http://www.gnumeric.org/v10.dtd"><Sheets><Sheet><Name>Glossary</Name><Cells><Cell Row="0" Col="0" ValueType="60">Term</Cell><Cell Row="0" Col="2" ValueType="60">FR</Cell><Cell Row="1" Col="0" ValueType="60">café</Cell><Cell Row="1" Col="1" ValueType="60">drink</Cell><Cell Row="1" Col="2" ValueType="60">thé</Cell></Cells></Sheet></Sheets></Workbook>';
  const volume = Volume.fromJSON({ "/input.gnumeric": source });
  const clock = { now: () => Date.UTC(2026, 8, 20, 12, 34) };
  const shell = new Shell({ fs: filesystem(volume) }).use(ssconvertCommands({ ...binding, clock }));
  const chunks: Uint8Array[] = [];
  const engine = createEngine({ ...binding, clock, filesystem: { async read() { return [new TextEncoder().encode(source)]; }, async write(_uri, bytes) { chunks.push(new Uint8Array(bytes)); } } });
  try {
    const result = await shell.exec("ssconvert -T Gnumeric_GnomeGlossary:po /input.gnumeric /fr.po");
    assert.equal(result.exitCode, 0, result.stderr); assert.equal(result.stderr, ""); assert.equal(result.stdout, "");
    await engine.convert({ input: { kind: "stream", source: [new TextEncoder().encode(source)] }, destination: { kind: "resource", uri: "/fr.po" }, exportType: "Gnumeric_GnomeGlossary:po" }, { signal: new AbortController().signal });
    assert.deepEqual(new Uint8Array(volume.readFileSync("/fr.po") as Uint8Array), chunks[0]);
    assert.ok(volume.readFileSync("/fr.po", "utf8").includes('msgid "café"\nmsgstr "thé"\n'));
    assert.equal(volume.readFileSync("/input.gnumeric", "utf8"), source);
  } finally { await shell.dispose(); await engine.dispose(); }
});
