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

async function run(options: string, graph: boolean) {
  const fs = new Volume();
  fs.writeFileSync("/in.raw", input);
  const chunks: Uint8Array[] = [];
  let stderr = "";
  const filter = `surround=win_size=1024${options}`;
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.raw", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
    "-f", "s16le", "pipe:1"],
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
  return { result, stderr, stdout: Buffer.concat(chunks) };
}

// Native FFmpeg 7.0.2, 1536 stereo PCM16 frames at 8 kHz, output FL/FR/FC/LFE/BL/BR.
for (const [windows, hash] of [
  [["", "hann", "1", "hanning"], "5d4836edd80e965b40d0533891615b540241d1442bf4e4a471e6adaa2ed058da"],
  [["rect", "0"], "9a6c108c068603598cf3b201105fa6eef34ec8ce3697066843ac6c2276fa0903"],
  [["hamming", "2"], "5e675a3f6a342f8422ba2e24601732b6f1fd3a1ef7844755f9f7bcbfaaa6574a"]
] as const) for (const window of windows) for (const graph of [false, true]) {
  it(`surround win_func=${window || "default"} matches native PCM (graph=${graph})`, async () => {
    const { result, stderr, stdout } = await run(window ? `:win_func=${window}` : "", graph);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(stderr, "");
    assert.equal(stdout.length, 18432);
    assert.equal(createHash("sha256").update(stdout).digest("hex"), hash);
  });
}
