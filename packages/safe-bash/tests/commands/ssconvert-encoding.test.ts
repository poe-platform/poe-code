import assert from "node:assert/strict";
import test from "node:test";
import { Volume } from "memfs";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { ssconvertCommands } from "../../src/commands/ssconvert/index.js";
import { createEngine } from "poe-code/ssconvert";

test("virtual ssconvert refuses uncaptured multibyte input and retains the destination", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input.csv", new Uint8Array([0xa4, 0x40, 10]));
  await fs.writeFile("/output.csv", new TextEncoder().encode("preserve"));
  const shell = new Shell({ fs }).use(ssconvertCommands({ codecs: [],
    environment: { env: {}, locale: "C", timezone: "UTC" },
    limits: { inputBytes: 1000, outputBytes: 1000, cells: 100, sheets: 1, operations: 100 } }));
  try {
    const result = await shell.exec("ssconvert -E BIG5 /input.csv /output.csv");
    assert.equal(result.exitCode, 1);
    assert.deepEqual(result.stdoutBytes, new Uint8Array());
    assert.equal(result.stderr, "Unsupported ssconvert feature: uncaptured import charset\n");
    assert.deepEqual(await fs.readFile("/input.csv"), new Uint8Array([0xa4, 0x40, 10]));
    assert.deepEqual(await fs.readFile("/output.csv"), new TextEncoder().encode("preserve"));
    const control = await shell.exec("ssconvert -E CP437 -T Gnumeric_stf:stf_assistant /input.csv fd://1");
    assert.equal(control.exitCode, 0, control.stderr);
    assert.deepEqual(control.stdoutBytes, new TextEncoder().encode("ñ@\n"));
  } finally { await shell.dispose(); }
});

for (const [locale, charset, mode, fixture, expected] of [
  ["C", "CP437", "escape", "éα😀\n", [130, 224, ...new TextEncoder().encode("\\U0001f600\n")]],
  ["C.UTF-8", "ASCII", "transliterate", "é😀\n", [...new TextEncoder().encode("e:-D\n")]],
  ["C.UTF-8", "ASCII", "escape", "é😀\n", [...new TextEncoder().encode("\\u00e9\\U0001f600\n")]]
] as const) {
  test(`virtual ssconvert and SDK share ${locale} ${charset} ${mode} bytes`, async () => {
    const volume = Volume.fromJSON({ "/input.csv": fixture });
    const fs = new Proxy(new MemoryFileSystem(), { get(target, key) {
      // This memfs/mock host supplies buffered I/O, not the backing MemoryFileSystem streams.
      if (key === "readStream" || key === "writeStream") return undefined;
      if (key === "capabilities") return { ...target.capabilities, streamingRead: false, streamingWrite: false };
      if (key === "readFile") return async (path: string, options?: { signal?: AbortSignal }) => {
        options?.signal?.throwIfAborted();
        return new Uint8Array(volume.readFileSync(path) as Uint8Array);
      };
      const value: unknown = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    } });
    const limits = { inputBytes: 1000, outputBytes: 1000, cells: 100, sheets: 1, operations: 100 };
    const environment = { env: { LC_ALL: locale }, locale: "C", timezone: "UTC" };
    const shell = new Shell({ fs }).use(ssconvertCommands({ codecs: [], environment, limits }));
    const engine = createEngine({ codecs: [], environment, limits, filesystem: {
      async read(path) { return [new Uint8Array(volume.readFileSync(path) as Uint8Array)]; },
      async write(path, data) { volume.writeFileSync(path, data); }
    } });
    try {
      const options = `charset=${charset} transliterate-mode=${mode} locale=C`;
      const result = await shell.exec(`LC_ALL=${locale} LC_CTYPE=C ssconvert -T Gnumeric_stf:stf_assistant -O '${options}' /input.csv fd://1`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.deepEqual(result.stdoutBytes, new Uint8Array(expected));
      const signal = new AbortController().signal;
      const book = await engine.readWorkbook({ kind: "resource", uri: "/input.csv" }, {}, { signal });
      const chunks: Uint8Array[] = [];
      const diagnostics: string[] = [];
      const sdk = await engine.writeWorkbook(book, { kind: "stream", sink: {
        async write(data) { chunks.push(new Uint8Array(data)); }
      } }, { exportType: "Gnumeric_stf:stf_assistant", exportOptions: [options] }, {
        signal, async diagnostic(d) { diagnostics.push(d.message); }
      });
      assert.equal(sdk.exitCode, 0);
      assert.deepEqual(chunks, [result.stdoutBytes]);
      assert.deepEqual(diagnostics, []);
      assert.deepEqual(volume.toJSON(), { "/input.csv": fixture });
    } finally { await engine.dispose(); await shell.dispose(); }
  });
}

test("virtual text export bounds final bytes when native transliteration discards combining marks", async () => {
  const volume = Volume.fromJSON({ "/input.csv": "\u0301\u0301\n" });
  const fs = new Proxy(new MemoryFileSystem(), { get(target, key) {
      // This memfs/mock host supplies buffered I/O, not the backing MemoryFileSystem streams.
      if (key === "readStream" || key === "writeStream") return undefined;
      if (key === "capabilities") return { ...target.capabilities, streamingRead: false, streamingWrite: false };
    if (key === "readFile") return async (path: string) => new Uint8Array(volume.readFileSync(path) as Uint8Array);
    const value: unknown = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const shell = new Shell({ fs }).use(ssconvertCommands({ codecs: [],
    environment: { env: { LC_ALL: "C.UTF-8" }, locale: "C", timezone: "UTC" },
    limits: { inputBytes: 1000, outputBytes: 1, cells: 100, sheets: 1, operations: 100 } }));
  try {
    const result = await shell.exec("LC_ALL=C.UTF-8 ssconvert -T Gnumeric_stf:stf_assistant -O charset=ASCII /input.csv fd://1");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.deepEqual(result.stdoutBytes, new Uint8Array([10]));
    assert.deepEqual(volume.toJSON(), { "/input.csv": "\u0301\u0301\n" });
  } finally { await shell.dispose(); }
});
