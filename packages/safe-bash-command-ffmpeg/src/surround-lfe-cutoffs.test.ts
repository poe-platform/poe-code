import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

async function run(options: string, graph: boolean, output = "pipe:1") {
  const input = Buffer.alloc(1536 * 4);
  for (let i = 0; i < 1536; i++) {
    input.writeInt16LE((i % 128 < 64 ? 1 : -1) * 900, i * 4);
    input.writeInt16LE(((i + 13) % 128 < 64 ? 1 : -1) * 600
      + (i % 16 < 8 ? 1 : -1) * 200, i * 4 + 2);
  }
  const fs = Volume.fromJSON({ "/out.pcm": "keep" });
  fs.writeFileSync("/in.raw", input);
  const chunks: Uint8Array[] = [];
  let stderr = "";
  const filter = `surround=${options ? `${options}:` : ""}win_size=1024`;
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.raw",
      ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
      "-f", "s16le", output],
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
  return { result, stderr, stdout: Buffer.concat(chunks), file: fs.readFileSync("/out.pcm", "utf8") };
}

// Native FFmpeg 7.0.2 PCM16 hashes for 1536 stereo frames at 8 kHz.
for (const [options, hash] of [
  ["", "5d4836edd80e965b40d0533891615b540241d1442bf4e4a471e6adaa2ed058da"],
  ["lfe_low=128:lfe_high=256", "5d4836edd80e965b40d0533891615b540241d1442bf4e4a471e6adaa2ed058da"],
  ["lfe_low=16", "dc313ec721b15c9392fcf119b5a1f0ac9986f355e7c22233bbe4303d56410de0"],
  ["lfe_high=192", "88f8e422bfa67709c08c5a967fe5ca7625d515f92ee4c9841c7e84ceb63a0414"],
  ["lfe_low=16:lfe_high=48", "669e550f2c834a7d3f3f4196fb3144029b2b97e3609da9e02601589f4ac202e2"],
  ["lfe=0", "910c5afc1fe40d52dc39989722c5e8b82b326a0d6fd23503d8c6bc8677bdfa3f"],
  ["lfe=0:lfe_low=16:lfe_high=48", "910c5afc1fe40d52dc39989722c5e8b82b326a0d6fd23503d8c6bc8677bdfa3f"],
  ["lfe_low=default:lfe_high=max/2", "5d4836edd80e965b40d0533891615b540241d1442bf4e4a471e6adaa2ed058da"],
  ["lfe_low=15.5:lfe_high=48.5", "669e550f2c834a7d3f3f4196fb3144029b2b97e3609da9e02601589f4ac202e2"],
  ["lfe_low=16.5:lfe_high=47.5", "669e550f2c834a7d3f3f4196fb3144029b2b97e3609da9e02601589f4ac202e2"],
  ["5.1:stereo:1:1:1:16:48", "669e550f2c834a7d3f3f4196fb3144029b2b97e3609da9e02601589f4ac202e2"]
] as const) for (const graph of [false, true]) {
  it(`surround ${options || "defaults"} matches native PCM (graph=${graph})`, async () => {
    const { result, stderr, stdout } = await run(options, graph);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(stderr, "");
    assert.equal(stdout.length, 18432);
    assert.equal(createHash("sha256").update(stdout).digest("hex"), hash);
  });
}

for (const [options, exitCode, message] of [
  ["lfe_high=96", 234, "low cutoff 128 must be less than high cutoff 96"],
  ["lfe_low=128:lfe_high=128", 234, "low cutoff 128 must be less than high cutoff 128"],
  ["lfe_low=127.5:lfe_high=128.5", 234, "low cutoff 128 must be less than high cutoff 128"],
  ["lfe=0:lfe_high=96", 234, "low cutoff 128 must be less than high cutoff 96"],
  ["lfe_low=-0.1", 222, "lfe_low must be between 0 and 256"],
  ["lfe_low=256.1", 222, "lfe_low must be between 0 and 256"],
  ["lfe_high=-0.1", 222, "lfe_high must be between 0 and 512"],
  ["lfe_high=512.1", 222, "lfe_high must be between 0 and 512"],
  ["lfe_low=bad", 234, "expression"],
  ["lfe_high=bad", 234, "expression"]
] as const) for (const graph of [false, true]) for (const output of ["pipe:1", "/out.pcm"]) {
  it(`surround rejects ${options} without writing output (graph=${graph}, ${output})`, async () => {
    const { result, stderr, stdout, file } = await run(options, graph, output);
    assert.equal(result.exitCode, exitCode, stderr);
    assert.ok(stderr.includes(message), stderr);
    assert.equal(stdout.length, 0);
    assert.equal(file, "keep");
  });
}
