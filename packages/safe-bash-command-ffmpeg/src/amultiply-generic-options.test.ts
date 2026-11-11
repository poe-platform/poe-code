import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

for (const filter of ["amultiply", "amultiply@mul"]) {
  for (const option of [
    "", "=", "=threads=1", "=extra_hw_frames=0", "=thread_type=slice",
    "=threads=1:thread_type=slice:extra_hw_frames=0",
    "=threads=0:thread_type=none:extra_hw_frames=-1",
    "=threads=default:extra_hw_frames=min", "=threads=1+1:extra_hw_frames=2-1",
    "=threads=2147483647:thread_type=4294967295:extra_hw_frames=2147483647",
    "=threads=0.5:extra_hw_frames=-0.5", "=thread_type=+slice",
    "=thread_type=all-slice", "=thread_type=none+slice", "=threads=1:threads=2:",
    "= threads = 1 : extra_hw_frames = 0"
  ]) {
    it(`${filter}${option} preserves native PCM with generic options`, async () => {
      const result = await run(`${filter}${option}`, "pipe:1");
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      // Native FFmpeg 7.0.2 reference for a 12-sample PCM16 ramp multiplied by itself.
      assert.equal(result.stdout.toString("hex"), "1f007a001301e801fb024b04d705a107a809ec0b6d0e2b11");
    });
  }

  for (const option of [
    "threads=-1", "threads=2147483648", "threads=", "threads=bogus", "threads=-1:threads=1",
    "thread_type=bogus", "thread_type=0.5", "thread_type=4294967296", "thread_type=slice+",
    "extra_hw_frames=-2", "extra_hw_frames=2147483648", "extra_hw_frames=", "extra_hw_frames=NaN",
    "extra_hw_frames=-2:extra_hw_frames=0", "unknown=1", "enable=1", "1", "threads=1::"
  ]) {
    it(`${filter} rejects ${option} without replacing output`, async () => {
      const result = await run(`${filter}=${option}`, "/out.pcm");
      assert.notEqual(result.exitCode, 0);
      assert.ok(result.stderr.includes("amultiply"), result.stderr);
      assert.equal(result.stdout.length, 0);
      assert.equal(result.volume.readFileSync("/out.pcm", "utf8"), "KEEP");
    });
  }
}

async function run(filter: string, output: string) {
  const input = Buffer.from(encodeWav({ sampleRate: 8000,
    channels: [Float64Array.from({ length: 12 }, (_, index) => (index + 1) * 1000 / 32768)] }));
  const volume = Volume.fromJSON({ "/in.wav": input, "/out.pcm": "KEEP" });
  const stdout: Uint8Array[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-i", "/in.wav", "-filter_complex",
      `[0:a][0:a]${filter}[o]`, "-map", "[o]", "-f", "s16le", output],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { stdout.push(bytes.slice()); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.deepEqual(volume.readFileSync("/in.wav"), input);
  return { ...result, stdout: Buffer.concat(stdout), stderr, volume };
}
