import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

const samples = Array.from({ length: 12 }, (_, i) => (i + 1) * 1000);
const input = Buffer.from(encodeWav({
  sampleRate: 8000, channels: [Float64Array.from(samples, sample => sample / 32768)]
}));

for (const options of [
  "", "threads=1", "thread_type=slice", "extra_hw_frames=0",
  "threads=1:thread_type=slice:extra_hw_frames=1",
  "threads=0:thread_type=none:extra_hw_frames=-1",
  "threads=default:extra_hw_frames=min", "threads=max:extra_hw_frames=max",
  "threads=1+1:thread_type=all-slice:extra_hw_frames=2-1",
  "threads=1.5:thread_type=4294967295", "thread_type=+slice",
  "threads=1:threads=2"
]) {
  it(`sidechaingate preserves PCM with generic options: ${options || "control"}`, async () => {
    const result = await run(options, "pipe:1");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.deepEqual(Array.from({ length: result.stdout.length / 2 }, (_, i) =>
      result.stdout.readInt16LE(i * 2)), [61, 122, 184, 245, 401, 791, 1410, 2334, 3647, 5441, 7700, 9994]);
  });
}

for (const options of [
  "threads=-1", "threads=2147483648", "threads=bogus", "threads=",
  "threads=-1:threads=1", "thread_type=bogus", "thread_type=0.5",
  "thread_type=4294967296", "thread_type=", "thread_type=slice+",
  "extra_hw_frames=-2", "extra_hw_frames=2147483648", "extra_hw_frames=bogus",
  "extra_hw_frames=", "extra_hw_frames=-2:extra_hw_frames=0", "threads=1:unknown=1"
]) {
  it(`sidechaingate rejects invalid options without replacing output: ${options}`, async () => {
    const result = await run(options, "/out.raw");
    assert.notEqual(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout.length, 0);
    assert.equal(result.volume.readFileSync("/out.raw", "utf8"), "KEEP");
  });
}

async function run(options: string, output: string) {
  const volume = Volume.fromJSON({ "/in.wav": input, "/out.raw": "KEEP" });
  const stdout: Buffer[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-i", "/in.wav", "-filter_complex",
      `[0:a][0:a]sidechaingate${options ? `=${options}` : ""}[o]`,
      "-map", "[o]", "-f", "s16le", output],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { stdout.push(Buffer.from(bytes)); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.deepEqual(volume.readFileSync("/in.wav"), input);
  return { ...result, stdout: Buffer.concat(stdout), stderr, volume };
}
