import assert from "node:assert/strict";
import test from "node:test";
import { Volume } from "memfs";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { FsError, isErrnoCode } from "../../src/contracts/index.js";
import { ssconvertCommands } from "../../src/commands/ssconvert/index.js";
import { createEngine } from "poe-code/ssconvert";
import { psionFixture } from "../../../safe-bash-command-ssconvert/src/codecs/psion-fixture.test-support.js";

test("legacy binary import shares virtual command, SDK, namespace and replay", async () => {
  const record = (id: number, data: readonly number[] = []) => [id & 255, id >> 8, data.length & 255, data.length >> 8, ...data];
  const colorSheet = new Uint8Array(1400); colorSheet.set(psionFixture());
  const dword = (n: number) => [n & 255, n >>> 8 & 255, n >>> 16 & 255, n >>> 24];
  const put = (at: number, values: number[]) => colorSheet.set(values, at);
  new DataView(colorSheet.buffer).setUint32(49, 500, true);
  // Sheet page header -> inline object -> relocated Sketch section table.
  put(500, [...dword(1), ...Array<number>(24).fill(0), 1, 0, 0, 0, 0, ...dword(0), ...dword(0),
    ...dword(0x1000005c), ...dword(0x10000066), ...dword(900), ...dword(0x10000064), 4, 72, 6,
    ...Array<number>(6).fill(0), ...dword(0x100000fd), ...dword(11906), ...dword(16838), 0]);
  put(900, [0, 0, 0, ...dword(1), ...dword(2), 0, ...dword(0), ...dword(1), ...dword(1), 1,
    ...dword(1), ...dword(0), ...dword(0x10000051), ...dword(1100), ...dword(200), ...dword(300)]);
  put(1100, [2, ...dword(0x10000144), ...dword(1200)]);
  put(1200, [...dword(4), 4, ...dword(0x10000089), ...dword(24), ...dword(0x1000007d), ...dword(48)]);
  put(1224, [...dword(0x1000007d), 38, ...Array.from("Paint.app", ch => ch.charCodeAt(0))]);
  // Raw one-pixel 47-bit color image: six bytes followed by its mandatory trailer.
  put(1266, [46, 40, 1, 1, 0, 0, 47, 1, 0, 0].flatMap(dword));
  put(1306, [255, 255, 255, 255, 255, 255]);
  const fixtures = [
    { id: "Gnumeric_psiconv:psiconv", bytes: [...psionFixture()], expected: "7\n" },
    { id: "Gnumeric_psiconv:psiconv", bytes: [...colorSheet], expected: "7\n" },
    { id: "Gnumeric_lotus:lotus", bytes: [...record(0, [4, 4]), ...record(13, [0x71, 0, 0, 0, 0, 255, 255]), ...record(1)], expected: "-1\n" },
    { id: "Gnumeric_QPro:qpro", bytes: [...record(0, [1, 16]), ...record(202), ...record(13, [0, 0, 0, 0, 0, 0, 255, 255]), ...record(203), ...record(1)], expected: "65535\n" },
    { id: "Gnumeric_QPro:qpro", bytes: [...record(0, [1, 16]), ...record(202), ...record(13, [0]),
      ...record(13, [0, 0, 0, 0, 0, 0, 7, 0]), ...record(203), ...record(1)], expected: "7\n",
      diagnostics: ["File is most likely corrupted.\n", "Invalid 'QPRO_INTEGER_CELL' record of length 1 instead of 8\n"] },
    { id: "Gnumeric_QPro:qpro", bytes: [...record(0, [1, 16]), ...record(202), ...record(15, [0]),
      ...record(13, [0, 0, 0, 0, 0, 0, 7, 0]), ...record(203), ...record(1)], expected: "7\n",
      diagnostics: ["File is most likely corrupted.\n", "Invalid 'QPRO_LABEL_CELL' record of length 1, expected at least 7\n"] },
    { id: "Gnumeric_QPro:qpro", bytes: [...record(0, [1, 16]), ...record(202), ...record(309, [100, 0, 255, 255]),
      ...record(13, [0, 0, 0, 0, 0, 0, 7, 0]), ...record(203), ...record(1)], expected: "7\n",
      diagnostics: ["Invalid zoom -1 %"], diagnosticBytes: "" },
    { id: "Gnumeric_QPro:qpro", bytes: [...record(0, [1, 16]), ...record(202),
      ...record(16, [...Array<number>(18).fill(0), 5, 0, 5, 1, 0, 42, 3]),
      ...record(13, [0, 0, 0, 0, 0, 0, 7, 0]), ...record(203), ...record(1)], expected: "7\n",
      diagnostics: ["File is probably corrupted.\n(Expression stack is short by 1 arguments)"] },
    { id: "Gnumeric_plan_perfect:pln", bytes: [255, 87, 80, 67, 16, 0, 0, 0, 9, 10, 5, 0, 0, 0, 0, 0, ...record(25),
      0, 0, 0, 0, 65, 16, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 255, 255, ...Array<number>(18).fill(0)], expected: "1\n" }
  ];
  const volume = Volume.fromJSON({ "/keep": "original" });
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
  try {
    for (const fixture of fixtures) {
      const source = Uint8Array.from(fixture.bytes); volume.writeFileSync("/input.binary", source);
      for (let replay = 0; replay < 2; replay++) {
        const command = await shell.exec(`ssconvert -I ${fixture.id} -T Gnumeric_stf:stf_csv /input.binary /output.csv`);
        assert.equal(command.exitCode, 0, command.stderr); assert.equal(command.stdout, ""); assert.equal(command.stderr, fixture.diagnosticBytes ?? fixture.diagnostics?.join("") ?? "");
        assert.equal(volume.readFileSync("/output.csv", "utf8"), fixture.expected);
        let sdkBytes = new Uint8Array();
        const sdk = await engine.convert({ input: { kind: "stream", source: [source] }, importType: fixture.id,
          exportType: "Gnumeric_stf:stf_csv", destination: { kind: "stream", sink: { async write(bytes) { sdkBytes = new Uint8Array(bytes); } } } },
        { signal: new AbortController().signal });
        assert.equal(sdk.exitCode, 0); assert.deepEqual(sdk.diagnostics.map(d => d.message), fixture.diagnostics ?? []);
        assert.deepEqual(new Uint8Array(volume.readFileSync("/output.csv") as Uint8Array), sdkBytes);
      }
    }
    const unavailable = new Uint8Array(colorSheet);
    new DataView(unavailable.buffer).setUint32(1290, 48, true);
    volume.writeFileSync("/input.binary", unavailable);
    const preserved = new Uint8Array(volume.readFileSync("/output.csv") as Uint8Array);
    for (let replay = 0; replay < 2; replay++) {
      const rejected = await shell.exec("ssconvert -I Gnumeric_psiconv:psiconv -T Gnumeric_stf:stf_csv /input.binary /output.csv");
      assert.equal(rejected.exitCode, 1);
      assert.equal(rejected.stdout, "");
      assert.equal(rejected.stderr, "ssconvert Psion Sketch bit depth is not qualified\n");
      assert.deepEqual(new Uint8Array(volume.readFileSync("/output.csv") as Uint8Array), preserved);
      let writes = 0;
      await assert.rejects(engine.convert({ input: { kind: "stream", source: [unavailable] }, importType: "Gnumeric_psiconv:psiconv",
        exportType: "Gnumeric_stf:stf_csv", destination: { kind: "stream", sink: { async write() { writes++; } } } },
      { signal: new AbortController().signal }), { code: "unsupported-feature", exitCode: 1 });
      assert.equal(writes, 0);
    }
    assert.equal(volume.readFileSync("/keep", "utf8"), "original");
    assert.deepEqual(Object.keys(volume.toJSON()).sort(), ["/input.binary", "/keep", "/output.csv"]);
  } finally { await engine.dispose(); }
});
