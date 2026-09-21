import assert from "node:assert/strict";
import test from "node:test";
import { Volume } from "memfs";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { ssconvertCommands } from "../../src/commands/ssconvert/index.js";
import { FsError, isErrnoCode } from "../../src/contracts/index.js";
import { createEngine } from "poe-code/ssconvert";

test("database virtual command preserves SDK bytes, replay and namespace without companion effects", async () => {
  const source = '"Crème,A,8","Amount,N"\nété,-12.5\n';
  const volume = Volume.fromJSON({ "/input.csv": source, "/keep": "original" });
  const fs = new Proxy(new MemoryFileSystem(), { get(target, key) {
      // This memfs/mock host supplies buffered I/O, not the backing MemoryFileSystem streams.
      if (key === "readStream" || key === "writeStream") return undefined;
      if (key === "capabilities") return { ...target.capabilities, streamingRead: false, streamingWrite: false };
    if (key === "stat" || key === "lstat") return async (path: string) => {
      try { const stat = key === "lstat" ? volume.lstatSync(path) : volume.statSync(path);
        return { type: stat.isDirectory() ? "directory" : "file", size: Number(stat.size), mode: Number(stat.mode),
          mtimeMs: stat.mtimeMs, atimeMs: stat.atimeMs, ctimeMs: stat.ctimeMs };
      } catch (error) { if (error && typeof error === "object" && "code" in error && isErrnoCode(error.code)) throw new FsError(error.code, { path }); throw error; }
    };
    if (key === "readFile") return async (path: string, options?: { signal?: AbortSignal }) => {
      options?.signal?.throwIfAborted(); return new Uint8Array(volume.readFileSync(path) as Uint8Array);
    };
    if (key === "writeFile") return async (path: string, bytes: Uint8Array, options?: { signal?: AbortSignal; flag?: "w" | "wx"; mode?: number }) => {
      options?.signal?.throwIfAborted(); volume.writeFileSync(path, bytes, options);
    };
    if (key === "rename") return async (from: string, to: string) => { volume.renameSync(from, to); };
    if (key === "unlink") return async (path: string) => { volume.unlinkSync(path); };
    if (key === "chmod") return async (path: string, mode: number) => { volume.chmodSync(path, mode); };
    if (key === "access") return async (path: string, mode?: number) => { volume.accessSync(path, mode); };
    const value: unknown = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
  } });
  const binding = { codecs: [], environment: { env: {}, locale: "C", timezone: "UTC" }, clock: { now: () => 0 },
    limits: { inputBytes: 100000, outputBytes: 100000, cells: 1000, sheets: 3, operations: 10000 } };
  const shell = new Shell({ fs }).use(ssconvertCommands(binding)), engine = createEngine(binding);
  try {
    for (let replay = 0; replay < 2; replay++) {
      const result = await shell.exec("ssconvert -T Gnumeric_paradox:paradox /input.csv /table.db");
      assert.equal(result.exitCode, 0, result.stderr); assert.equal(result.stdout, ""); assert.equal(result.stderr, "");
      const chunks: Uint8Array[] = [];
      const sdk = await engine.convert({ input: { kind: "stream", filename: "/input.csv", source: [new TextEncoder().encode(source)] },
        exportType: "Gnumeric_paradox:paradox", destination: { kind: "stream", sink: { async write(bytes) { chunks.push(new Uint8Array(bytes)); } } } },
      { signal: new AbortController().signal });
      assert.equal(sdk.exitCode, 0); assert.deepEqual(sdk.diagnostics, []);
      assert.deepEqual(new Uint8Array(volume.readFileSync("/table.db") as Uint8Array), chunks[0]);
      const restored = await shell.exec("ssconvert -T Gnumeric_stf:stf_csv /table.db fd://1");
      assert.equal(restored.exitCode, 0, restored.stderr); assert.equal(restored.stderr, "");
      assert.equal(restored.stdout, '"Crème,A,8","Amount,N,8"\nété,-12.5\n');
    }
    const dbf = new Uint8Array(83), header = new DataView(dbf.buffer);
    dbf[0] = 3; dbf[29] = 3; header.setUint32(4, 1, true);
    header.setUint16(8, 66, true); header.setUint16(10, 17, true);
    dbf.set(new TextEncoder().encode("Amount"), 32); dbf[43] = 78; dbf[48] = 16;
    dbf[64] = 13; dbf[66] = 32; dbf.fill(32, 67);
    dbf.set([160, 49, 50], 67);
    volume.writeFileSync("/original.dbf", dbf);
    const numeric = await shell.exec("ssconvert -T Gnumeric_stf:stf_csv /original.dbf fd://1");
    assert.equal(numeric.exitCode, 0, numeric.stderr); assert.equal(numeric.stderr, "");
    assert.equal(numeric.stdout, "Amount\n0\n");
    volume.writeFileSync("/bad.db", new Uint8Array(2));
    const failed = await shell.exec("ssconvert -I Gnumeric_paradox:paradox -T Gnumeric_stf:stf_csv /bad.db /keep");
    assert.equal(failed.exitCode, 1); assert.equal(failed.stdout, "");
    assert.equal(failed.stderr, "Could not read header from paradox file.\nUnable to get header.\nE Error while opening Paradox file.\n");
    assert.equal(volume.readFileSync("/keep", "utf8"), "original");
    assert.deepEqual(Object.keys(volume.toJSON()).sort(), ["/bad.db", "/input.csv", "/keep", "/original.dbf", "/table.db"]);
  } finally { await engine.dispose(); await shell.dispose(); }
});
