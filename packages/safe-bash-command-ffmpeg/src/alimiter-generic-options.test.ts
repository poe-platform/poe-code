import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

const samples = [1000, -2000, 3000, -4000, 5000, -6000, 7000, -8000,
  9000, -10000, 11000, -12000, 13000, -14000, 15000, -16000];
const input = encodeWav({ sampleRate: 8000,
  channels: [Float64Array.from(samples, sample => sample / 32768)] });
// Native FFmpeg 7.0.2: these scheduling options preserve the three-sample delay.
const expected = [0, 0, 0, ...samples.slice(0, -3)];

for (const graph of [false, true]) {
  for (const [valid, options] of [
    [true, ["", "threads=1", "thread_type=slice", "extra_hw_frames=1",
      "threads=1:thread_type=slice:extra_hw_frames=1",
      "threads=0:thread_type=none:extra_hw_frames=-1",
      "threads=default:extra_hw_frames=min",
      "threads=1+1:thread_type=all-slice:extra_hw_frames=2-1",
      "threads=2147483647:thread_type=4294967295:extra_hw_frames=2147483647",
      "threads=1:threads=2", " threads = 1 : thread_type = slice : extra_hw_frames = 1"]],
    [false, ["threads=-1", "threads=2147483648", "threads=", "threads=bogus",
      "thread_type=", "thread_type=bogus", "thread_type=0.5", "thread_type=4294967296",
      "extra_hw_frames=-2", "extra_hw_frames=2147483648", "extra_hw_frames=",
      "extra_hw_frames=bogus", "threads=-1:threads=1", "unknown=1", "threads=1:unknown=1"]]
  ] as const) {
    for (const option of options) {
      it(`alimiter ${option || "defaults"} ${valid ? "preserves PCM" : "rejects without replacing output"} (${graph ? "graph" : "simple"})`, async () => {
        const volume = Volume.fromJSON({ "/in.wav": Buffer.from(input), "/out.pcm": "keep" });
        const filter = `alimiter=attack=0.5:level=0${option ? `:${option}` : ""}`;
        const output: Buffer[] = [];
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-y", "-v", "error", "-i", "/in.wav",
            ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
            "-f", "s16le", valid ? "pipe:1" : "/out.pcm"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(),
          stdout: { async write(bytes: Uint8Array) { output.push(Buffer.from(bytes)); } },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        if (valid) assert.equal(result.exitCode, 0, stderr);
        else assert.notEqual(result.exitCode, 0, stderr);
        const pcm = Buffer.concat(output);
        assert.deepEqual(Array.from({ length: pcm.length / 2 }, (_, i) => pcm.readInt16LE(i * 2)), valid ? expected : []);
        if (valid) assert.equal(stderr, "");
        else assert.ok(stderr.includes("alimiter"), stderr);
        assert.equal(volume.readFileSync("/out.pcm", "utf8"), "keep");
        assert.deepEqual(volume.readFileSync("/in.wav"), Buffer.from(input));
      });
    }
  }
}
