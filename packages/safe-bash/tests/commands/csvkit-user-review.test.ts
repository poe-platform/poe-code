import test from "node:test";
import assert from "node:assert/strict";
import { createGzipCompressionProvider, utf8Codec } from "@poe-code/csvkit";
import { createCompressionCodec } from "@poe-code/office-package/compression";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { csvkitCommands, type CsvkitCommandsOptions } from "../../src/commands/csvkit/index.js";
import { FsError } from "../../src/contracts/index.js";

const options: CsvkitCommandsOptions = {
  codecs: [utf8Codec],
  locale: { profile: "C", timezone: "UTC", formatNumber: () => { throw new Error("unqualified locale"); } },
  clock: { now: () => 0 },
  terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 }
};

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

async function gzip(text: string): Promise<Uint8Array> {
  const codec = createCompressionCodec();
  const signal = new AbortController().signal;
  const reader = new codec.CodecReader((async function* () { yield bytes(text); })(), signal);
  const chunks: Uint8Array[] = [];
  try { for await (const chunk of codec.codec(reader, { mode: "gzip" }, signal)) chunks.push(Uint8Array.from(chunk)); }
  finally { await reader.close(); }
  return Uint8Array.from(chunks.flatMap(chunk => [...chunk]));
}

test("csvkit user review gzip cancellation reaches cooperative pending compressed input", async () => {
  const fs = new MemoryFileSystem();
  const controller = new AbortController();
  let started!: () => void;
  const admitted = new Promise<void>(resolve => { started = resolve; });
  let release!: () => void;
  const pending = new Promise<IteratorResult<Uint8Array>>(resolve => {
    release = () => resolve({ done: true, value: undefined });
  });
  let returned = 0;
  Object.assign(fs, { readStream(path: string) {
    assert.equal(path, "/pending.gz");
    return { [Symbol.asyncIterator]: () => ({
      next: () => { started(); return pending; },
      return: async () => { returned++; release(); return { done: true, value: undefined }; }
    }) };
  } });
  const shell = new Shell({ fs }).use(csvkitCommands({ ...options,
    compression: [createGzipCompressionProvider(createCompressionCodec())] }));
  const execution = shell.exec("csvcut pending.gz", { signal: controller.signal });
  const rejected = assert.rejects(execution, reason => reason === false);
  try {
    await admitted;
    controller.abort(false);
    await new Promise<void>(resolve => { setImmediate(resolve); });
    await new Promise<void>(resolve => { setImmediate(resolve); });
    assert.equal(returned, 1, "cancellation must release the compressed source without an external rescue");
    await rejected;
  } finally {
    release();
    await rejected;
    await shell.dispose();
  }
  assert.equal(returned, 1);
});

test("csvkit user review malformed gzip members stay explicit blockers and never mutate source", async () => {
  const valid = await gzip("a\nx\n");
  const damagedCrc = Uint8Array.from(valid);
  damagedCrc[damagedCrc.length - 8] = damagedCrc[damagedCrc.length - 8]! ^ 1;
  const inputs = [
    bytes("ordinary text"), valid.subarray(0, 1), valid.subarray(0, 9),
    valid.subarray(0, valid.length - 1), damagedCrc,
    Uint8Array.from([...valid, 0x1f]), Uint8Array.from([...valid, 0x78])
  ];
  const fs = new MemoryFileSystem();
  const shell = new Shell({ fs }).use(csvkitCommands({ ...options,
    compression: [createGzipCompressionProvider(createCompressionCodec())] }));
  try {
    for (const [index, input] of inputs.entries()) {
      await fs.writeFile("/input.gz", input);
      const result = await shell.exec("csvcut input.gz");
      assert.equal(result.exitCode, 78, `case ${index}`);
      assert.equal(result.stderr, "csvkit: unsupported or unqualified: gzip codec diagnostic (corrupt or truncated stream)\n", `case ${index}`);
      assert.equal(result.stdout, index < 5 ? "" : "a\nx\n", `case ${index}: exact admitted output`);
      assert.deepEqual(await fs.readFile("/input.gz"), input);
    }
  } finally { await shell.dispose(); }
});

test("csvkit user review gzip preserves upstream typed source failure rather than codec blocker", async () => {
  const fs = new MemoryFileSystem();
  let returned = 0;
  Object.assign(fs, { readStream() {
    return { [Symbol.asyncIterator]: () => ({
      next: async () => { throw new FsError("EACCES", { path: "/private.gz" }); },
      return: async () => { returned++; return { done: true, value: undefined }; }
    }) };
  } });
  const shell = new Shell({ fs }).use(csvkitCommands({ ...options,
    compression: [createGzipCompressionProvider(createCompressionCodec())] }));
  try {
    const result = await shell.exec("csvcut private.gz");
    assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, {
      status: 1, stdout: "", stderr: "PermissionError: [Errno 13] Permission denied: 'private.gz'\n"
    });
    assert.equal(returned, 1);
  } finally { await shell.dispose(); }
});

test("csvkit user review common text decoder owns reusable compressed producer chunks", async () => {
  const input = await gzip("a,b\nx,y\n");
  const fs = new MemoryFileSystem();
  let returned = 0;
  Object.assign(fs, { async *readStream() {
    const reusable = new Uint8Array(1);
    try {
      for (const byte of input) { reusable[0] = byte; yield reusable; reusable[0] = 0xff; }
    } finally { reusable[0] = 0xff; returned++; }
  } });
  const shell = new Shell({ fs }).use(csvkitCommands({ ...options,
    compression: [createGzipCompressionProvider(createCompressionCodec())] }));
  try {
    const result = await shell.exec("csvcut -c b input.gz");
    assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, {
      status: 0, stdout: "b\ny\n", stderr: ""
    });
    assert.equal(returned, 1);
  } finally { await shell.dispose(); }
});
