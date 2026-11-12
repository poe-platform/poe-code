import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

async function run(options: string, graph: boolean, select = false, destination = "pipe:1") {
  const input = Buffer.alloc(1536 * 4);
  for (let i = 0; i < 1536; i++) {
    input.writeInt16LE((i % 128 < 64 ? 1 : -1) * 900, i * 4);
    input.writeInt16LE(((i + 13) % 128 < 64 ? 1 : -1) * 600 + (i % 16 < 8 ? 1 : -1) * 200, i * 4 + 2);
  }
  const fs = Volume.fromJSON({ "/out.pcm": "keep" });
  fs.writeFileSync("/in.raw", input);
  const chunks: Uint8Array[] = [];
  let stderr = "";
  const filter = `surround=win_size=1024${options}${select ? ",aselect=eq(n\\,1)" : ""}`;
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.raw",
      ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
      "-f", "s16le", destination],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return fs.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
      async stat(path: string) { return fs.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { chunks.push(bytes); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { result, stderr, stdout: Buffer.concat(chunks), file: fs.readFileSync("/out.pcm") as Buffer };
}

// Native FFmpeg 7.0.2: 1536 stereo PCM16 samples at 8 kHz, six-channel output.
for (const graph of [false, true]) {
  for (const [options, hash] of [
    ["", "5d4836edd80e965b40d0533891615b540241d1442bf4e4a471e6adaa2ed058da"],
    [":overlap=0", "d0d7340f3f3ca20b383cc6b00e32364e94406bcd8ff7a9574b93a54e07ad84fc"],
    [":overlap=0.25", "70cc299dded400fbe1fc1d9864bbff001cd1494c11b0544aa61950c52f3ff192"],
    [":overlap=0.5", "5d4836edd80e965b40d0533891615b540241d1442bf4e4a471e6adaa2ed058da"],
    [":overlap=0.75", "89c03747cb9a92d78d0f4eebbaf159490298843c549ba7fdb81d01c3550668d5"],
    [":overlap=1", "5d4836edd80e965b40d0533891615b540241d1442bf4e4a471e6adaa2ed058da"]
  ] as const) {
    it(`surround${options} matches native overlap PCM (graph=${graph})`, async () => {
      const { result, stderr, stdout } = await run(options, graph);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(stderr, "");
      assert.equal(stdout.length, 18432);
      assert.equal(createHash("sha256").update(stdout).digest("hex"), hash);
    });
  }
  for (const [options, length, hash] of [
    ["", 6144, "34946c13e082dcf3f69f27d707c3af16ca63cd58dba4a975a05166e17e169e70"],
    [":overlap=0.25", 9216, "db23165dbd1273f5c066f372d670c07bdd3ec22fe16e1b5bcd3b26c4cae66d7b"],
    [":overlap=0.5", 6144, "34946c13e082dcf3f69f27d707c3af16ca63cd58dba4a975a05166e17e169e70"],
    [":overlap=0.75", 3072, "747baa5b9fbf6ab64fefd8051b3bd1106c56736c553833d0dc69b86178f89e47"]
  ] as const) {
    it(`surround${options} retains native second-frame PCM and length (graph=${graph})`, async () => {
      const { result, stderr, stdout } = await run(options, graph, true);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(stderr, "");
      assert.equal(stdout.length, length);
      assert.equal(createHash("sha256").update(stdout).digest("hex"), hash);
    });
  }
  for (const [value, exitCode] of [["-0.1", 222], ["1.1", 222], ["invalid", 234]] as const) {
    it(`surround rejects overlap=${value} without replacing output (graph=${graph})`, async () => {
      const { result, stderr, stdout, file } = await run(`:overlap=${value}`, graph, false, "/out.pcm");
      assert.equal(result.exitCode, exitCode, stderr);
      assert.ok(stderr.includes("surround:"), stderr);
      assert.equal(stdout.length, 0);
      assert.equal(file.toString(), "keep");
    });
  }
}
