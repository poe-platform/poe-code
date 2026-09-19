import test from "node:test";
import assert from "node:assert/strict";
import { createGzipCompressionProvider, utf8Codec } from "@poe-code/csvkit";
import { createCompressionCodec } from "@poe-code/office-package/compression";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { csvkitCommands, type CsvkitCommandsOptions } from "../../src/commands/csvkit/index.js";
import parserContract from "../../../../docs/csvkit/parser-contract-audit-20260917.json" with { type: "json" };

const options: CsvkitCommandsOptions = {
  codecs: [utf8Codec], locale: { profile: "C", timezone: "UTC", formatNumber: () => { throw new Error("unqualified locale"); } },
  clock: { now: () => 0 },
  terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 }
};
const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

async function gzip(text: string): Promise<Uint8Array> {
  const codec = createCompressionCodec();
  const signal = new AbortController().signal;
  const reader = new codec.CodecReader((async function* () { yield bytes(text); })(), signal);
  const output: number[] = [];
  try { for await (const chunk of codec.codec(reader, { mode: "gzip" }, signal)) output.push(...chunk); }
  finally { await reader.close(); }
  return Uint8Array.from(output);
}

test("csvkit absent optional zstandard opens .zst as ordinary text", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input.zst", bytes("a,b\nx,y\n"));
  const shell = new Shell({ fs }).use(csvkitCommands(options));
  try {
    const result = await shell.exec("csvcut -c b input.zst");
    assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, { status: 0, stdout: "b\ny\n", stderr: "" });
    assert.deepEqual(await fs.readFile("/input.zst"), bytes("a,b\nx,y\n"));
  } finally { await shell.dispose(); }
});

test("csvkit common opener selects exact case-sensitive suffix and never selects from stdin bytes", async () => {
  const fs = new MemoryFileSystem();
  for (const name of ["input.gz", "input.GZ", "input.bz2", "input.BZ2", "input.xz", "input.XZ", "input.zst", "input.ZST"])
    await fs.writeFile(`/${name}`, bytes("a\nraw\n"));
  const selected: string[] = [];
  const compression = [".gz", ".bz2", ".xz", ".zst"].map(extension => ({
    extensions: [extension],
    async *decode(source: AsyncIterable<Uint8Array>, signal: AbortSignal) {
      signal.throwIfAborted();
      selected.push(extension);
      for await (const chunk of source) assert.deepEqual(chunk, bytes("a\nraw\n"));
      yield bytes("a\ndecoded\n");
    }
  }));
  const shell = new Shell({ fs }).use(csvkitCommands({ ...options, compression }));
  try {
    for (const extension of ["gz", "bz2", "xz", "zst"]) {
      for (const suffix of [extension, extension.toUpperCase()]) {
        const result = await shell.exec(`csvcut input.${suffix}`);
        assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, {
          status: 0, stdout: suffix === extension ? "a\ndecoded\n" : "a\nraw\n", stderr: ""
        });
      }
    }
    for (const command of ["csvcut", "csvcut -"]) {
      const result = await shell.exec(command, { stdin: bytes("a\nraw\n") });
      assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, { status: 0, stdout: "a\nraw\n", stderr: "" });
    }
    assert.deepEqual(selected, [".gz", ".bz2", ".xz", ".zst"]);
  } finally { await shell.dispose(); }
});

test("in2csv guesses outer compressed suffix before admitting file or decoder", async () => {
  const fs = new MemoryFileSystem();
  Object.assign(fs, { readStream() { assert.fail("unrecognized outer extension must not acquire input"); } });
  const shell = new Shell({ fs }).use(csvkitCommands({ ...options, compression: [{
    extensions: [".gz"], decode() { assert.fail("format guessing must precede decompression"); }
  }] }));
  try {
    const result = await shell.exec("in2csv input.csv.gz");
    assert.equal(result.exitCode, 2);
    assert.equal(result.stdout, "");
    const usage = parserContract.profiles.find(profile => profile.runtime.startsWith("3.14.2"))!.commands.find(command => command.name === "in2csv")!.usage;
    assert.equal(result.stderr, usage + "in2csv: error: Unable to automatically determine the format of the input file. Try specifying a format with --format.\n");
  } finally { await shell.dispose(); }
});

test("csvkit custom decoder metadata cannot widen native common compression suffixes", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input.csv", bytes("a\nraw\n"));
  const shell = new Shell({ fs }).use(csvkitCommands({ ...options, compression: [{
    extensions: [".csv"], decode() { assert.fail("ordinary CSV suffix must not invoke compression provider"); }
  }] }));
  try {
    const result = await shell.exec("csvcut input.csv");
    assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, { status: 0, stdout: "a\nraw\n", stderr: "" });
  } finally { await shell.dispose(); }
});

test("csvkit injected decoder inflation exceeds budget before output and cooperatively closes", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input.gz", Uint8Array.of(1));
  let closed = 0;
  const shell = new Shell({ fs }).use(csvkitCommands({ ...options, limits: { maxInflatedBytes: 4 }, compression: [{
    extensions: [".gz"], async *decode(source) {
      try { for await (const chunk of source) assert.deepEqual(chunk, Uint8Array.of(1)); yield bytes("a\nxxxx\n"); }
      finally { closed++; }
    }
  }] }));
  try {
    const result = await shell.exec("csvcut input.gz");
    assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, {
      status: 78, stdout: "", stderr: "csvkit: unsupported or unqualified: inflated byte budget exceeded\n"
    });
    assert.equal(closed, 1);
  } finally { await shell.dispose(); }
});

test("csvkit exported office gzip provider preserves concatenated members and split zero padding in Shell", async () => {
  const first = await gzip("a\nx\n"), second = await gzip("y\n");
  const input = Uint8Array.from([...first, 0, 0, ...second, 0]);
  for (const fragmented of [false, true]) {
    let closed = 0;
    const fs = new MemoryFileSystem();
    Object.assign(fs, { async *readStream(path: string) {
      assert.equal(path, "/input.csv.gz");
      try {
        if (fragmented) for (const byte of input) { yield Uint8Array.of(byte); yield new Uint8Array(); }
        else yield input;
      } finally { closed++; }
    } });
    const shell = new Shell({ fs }).use(csvkitCommands({ ...options,
      compression: [createGzipCompressionProvider(createCompressionCodec())] }));
    try {
      const result = await shell.exec("csvcut input.csv.gz");
      assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, {
        status: 0, stdout: "a\nx\ny\n", stderr: ""
      }, `fragmented=${fragmented}`);
      assert.equal(closed, 1);
    } finally { await shell.dispose(); }
  }
});

test("csvkit exported office gzip provider enforces aggregate inflation across members in Shell", async () => {
  const first = await gzip("a\nx\n"), second = await gzip("y\n");
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input.gz", Uint8Array.from([...first, ...second]));
  const shell = new Shell({ fs }).use(csvkitCommands({ ...options, limits: { maxInflatedBytes: 4 },
    compression: [createGzipCompressionProvider(createCompressionCodec())] }));
  try {
    const result = await shell.exec("csvcut input.gz");
    assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, {
      status: 78, stdout: "a\nx\n", stderr: "csvkit: unsupported or unqualified: inflated byte budget exceeded\n"
    });
  } finally { await shell.dispose(); }
});

test("in2csv explicit CSV format reads gzip through the exported office provider and preserves input bytes", async () => {
  const input = await gzip("a,b\nx,y\n");
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input.csv.gz", input);
  const shell = new Shell({ fs }).use(csvkitCommands({ ...options,
    compression: [createGzipCompressionProvider(createCompressionCodec())] }));
  try {
    const writes: Uint8Array[] = [];
    const result = await shell.exec("in2csv -f csv -I -y 0 input.csv.gz", {
      stdout: { async write(chunk) { writes.push(Uint8Array.from(chunk)); } }
    });
    assert.deepEqual({ status: result.exitCode, stderr: result.stderr }, { status: 0, stderr: "" });
    assert.deepEqual(Uint8Array.from(writes.flatMap(chunk => [...chunk])), bytes("a,b\nx,y\n"));
    assert.deepEqual(await fs.readFile("/input.csv.gz"), input);
  } finally { await shell.dispose(); }
});

test("csvkit exported gzip provider admits members against the Shell archive member budget", async () => {
  const first = await gzip("a\nx\n"), second = await gzip("y\n");
  for (const maxArchiveMembers of [0, 1]) {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/input.gz", Uint8Array.from([...first, 0, 0, ...second, 0]));
    const shell = new Shell({ fs }).use(csvkitCommands({ ...options, limits: { maxArchiveMembers },
      compression: [createGzipCompressionProvider(createCompressionCodec())] }));
    try {
      const result = await shell.exec("csvcut input.gz");
      assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, {
        status: 78, stdout: maxArchiveMembers === 0 ? "" : "a\nx\n",
        stderr: "csvkit: unsupported or unqualified: gzip member budget exceeded\n"
      }, `maxArchiveMembers=${maxArchiveMembers}`);
    } finally { await shell.dispose(); }
  }
});

test("csvkit common opener treats all-dot compression basenames as dotfiles while .real.gz decodes", async () => {
  const fs = new MemoryFileSystem();
  for (const name of [".gz", "..bz2", "...xz", ".zst"])
    await fs.writeFile(`/${name}`, bytes("a\nraw\n"));
  const compressed = await gzip("a\ndecoded\n");
  await fs.writeFile("/.real.gz", compressed);
  const shell = new Shell({ fs }).use(csvkitCommands({ ...options, compression: [
    createGzipCompressionProvider(createCompressionCodec()),
    { extensions: [".bz2", ".xz", ".zst"], decode() { assert.fail("all-dot basename has no compression extension"); } }
  ] }));
  try {
    for (const name of [".gz", "..bz2", "...xz", ".zst", ".real.gz"]) {
      const result = await shell.exec(`csvcut ${name}`);
      assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, {
        status: 0, stdout: name === ".real.gz" ? "a\ndecoded\n" : "a\nraw\n", stderr: ""
      }, name);
    }
    assert.deepEqual(await fs.readFile("/.real.gz"), compressed);
  } finally { await shell.dispose(); }
});
