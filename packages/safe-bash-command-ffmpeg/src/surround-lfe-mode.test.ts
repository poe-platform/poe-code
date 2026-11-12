import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = Buffer.alloc(1536 * 4);
for (let i = 0; i < 1536; i++) {
  input.writeInt16LE((i % 128 < 64 ? 1 : -1) * 900, i * 4);
  input.writeInt16LE(((i + 13) % 128 < 64 ? 1 : -1) * 600 + (i % 16 < 8 ? 1 : -1) * 200, i * 4 + 2);
}

async function run(options: string, graph: boolean, destination = "pipe:1") {
  const fs = Volume.fromJSON({ "/out.pcm": "keep" });
  fs.writeFileSync("/in.raw", input);
  const chunks: Uint8Array[] = [];
  let stderr = "";
  const filter = `surround=win_size=1024${options}`;
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.raw", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
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

// Native FFmpeg 7.0.2, 1536 stereo PCM16 frames at 8 kHz, output FL/FR/FC/LFE/BL/BR.
for (const [options, hash] of [
  ["", "5d4836edd80e965b40d0533891615b540241d1442bf4e4a471e6adaa2ed058da"],
  [":lfe_mode=add", "5d4836edd80e965b40d0533891615b540241d1442bf4e4a471e6adaa2ed058da"],
  [":lfe_mode=0", "5d4836edd80e965b40d0533891615b540241d1442bf4e4a471e6adaa2ed058da"],
  [":lfe_mode=sub", "29acfe63d9c30f126290aef9eb700cc5bff8cb1b4cc2d2d10ec3615b1295284f"],
  [":lfe_mode=1", "29acfe63d9c30f126290aef9eb700cc5bff8cb1b4cc2d2d10ec3615b1295284f"],
  [":lfe=0", "910c5afc1fe40d52dc39989722c5e8b82b326a0d6fd23503d8c6bc8677bdfa3f"]
] as const) for (const graph of [false, true]) {
  it(`surround${options} matches native bass routing PCM (graph=${graph})`, async () => {
    const { result, stderr, stdout } = await run(options, graph);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(stderr, "");
    assert.equal(stdout.length, 18432);
    assert.equal(createHash("sha256").update(stdout).digest("hex"), hash);
  });
}

for (const graph of [false, true]) {
  for (const options of [":lfe=0", ":chl_out=stereo"]) {
    it(`surround sub preserves speakers when no LFE is generated (${options}, graph=${graph})`, async () => {
      const baseline = await run(options, graph);
      const subtractive = await run(`${options}:lfe_mode=sub`, graph);
      assert.equal(baseline.result.exitCode, 0, baseline.stderr);
      assert.equal(subtractive.result.exitCode, 0, subtractive.stderr);
      assert.equal(subtractive.stderr, "");
      assert.deepEqual(subtractive.stdout, baseline.stdout);
    });
  }

  for (const [mode, exitCode] of [["-1", 222], ["2", 222], ["invalid", 234]] as const) {
    it(`surround rejects lfe_mode=${mode} without replacing output (graph=${graph})`, async () => {
      const { result, stderr, stdout, file } = await run(`:lfe_mode=${mode}`, graph, "/out.pcm");
      assert.equal(result.exitCode, exitCode, stderr);
      assert.ok(stderr.includes("surround:"), stderr);
      assert.equal(stdout.length, 0);
      assert.equal(file.toString(), "keep");
    });
  }
}
