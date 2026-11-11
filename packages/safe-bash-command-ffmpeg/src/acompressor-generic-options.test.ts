import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

for (const mode of ["simple", "graph", "sidechain"] as const) {
  it(`${mode} compressor accepts generic options without changing PCM`, async () => {
    // Native FFmpeg reference: eight mono PCM16 samples of 8000 at 8000 Hz.
    const expected = [8000, 8000, 8000, 7999, 7970, 7916, 7850, 7779];
    for (const options of [
      "", "threads=1", "thread_type=slice", "extra_hw_frames=0",
      "threads=1:thread_type=slice:extra_hw_frames=0",
      "threads=0:thread_type=none:extra_hw_frames=-1",
      "threads=max:thread_type=4294967295:extra_hw_frames=max",
      "threads=default:extra_hw_frames=min", "threads=1+1:extra_hw_frames=2-1",
      "threads=1.5:extra_hw_frames=0.5", "thread_type=+slice", "thread_type=all-slice",
      "threads=1:threads=2", "ratio=2:threads=1:mix=1",
      "1:downward:0.125:2:20:250:1:2.82843:average:rms:1:1:threads=1"
    ]) {
      const actual = await run(options, mode);
      assert.equal(actual.result.exitCode, 0, `${options}: ${actual.stderr}`);
      assert.equal(actual.output.length, expected.length * 2, options);
      assert.deepEqual(expected.map((_, i) => actual.output.readInt16LE(i * 2)), expected, options);
    }
  });

  it(`${mode} compressor rejects invalid generic options without replacing output`, async () => {
    for (const options of [
      "threads=-1", "threads=2147483648", "threads=", "threads=bogus", "threads=NaN",
      "thread_type=bogus", "thread_type=", "thread_type=0.5", "thread_type=4294967296",
      "extra_hw_frames=-2", "extra_hw_frames=2147483648", "extra_hw_frames=",
      "threads=-1:threads=1", "thread_type=bogus:thread_type=slice",
      "extra_hw_frames=-2:extra_hw_frames=0", "unknown=1", "threads=1:unknown=1"
    ]) {
      const actual = await run(options, mode);
      assert.notEqual(actual.result.exitCode, 0, options);
      assert.ok(actual.stderr.includes(mode === "sidechain" ? "sidechaincompress:" : "acompressor:"), actual.stderr);
      assert.equal(actual.output.toString(), "keep", options);
    }
  });
}

async function run(options: string, mode: "simple" | "graph" | "sidechain") {
  const input = encodeWav({ sampleRate: 8000, channels: [new Float64Array(8).fill(8000 / 32768)] });
  const volume = Volume.fromJSON({ "/in.wav": Buffer.from(input), "/out.pcm": "keep" });
  const filter = `${mode === "sidechain" ? "sidechaincompress" : "acompressor"}${options ? `=${options}` : ""}`;
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-i", "/in.wav", ...(mode === "sidechain" ? ["-i", "/in.wav"] : []),
      ...(mode === "simple" ? ["-af", filter] : ["-filter_complex",
        `${mode === "sidechain" ? "[0:a][1:a]" : "[0:a]"}${filter}[out]`, "-map", "[out]"]),
      "-f", "s16le", "/out.pcm"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.deepEqual(volume.readFileSync("/in.wav"), Buffer.from(input));
  return { result, stderr, output: volume.readFileSync("/out.pcm") as Buffer };
}
