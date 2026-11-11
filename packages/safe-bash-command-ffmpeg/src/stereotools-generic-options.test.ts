import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

const left = [1000, 3000, -527, 32767, 17, 94];
const right = [-2000, 1234, 909, -32000, -33, 95];
const validOptions = [
  "", "threads=1", "thread_type=slice", "extra_hw_frames=1",
  "threads=0", "threads=1.5", "threads=1+1", "threads=2147483647",
  "threads=default", "threads=min", "threads=max",
  "thread_type=none", "thread_type=all", "thread_type=slice+slice-slice",
  "thread_type=0", "thread_type=2", "thread_type=-1", "thread_type=4294967295",
  "extra_hw_frames=-1", "extra_hw_frames=1.5", "extra_hw_frames=2147483647",
  "extra_hw_frames=default", "extra_hw_frames=min", "extra_hw_frames=max",
  "threads=1:thread_type=slice:extra_hw_frames=1"
];
const invalidOptions = [
  "threads=-1", "threads=2147483648", "threads=NaN", "threads=INF", "threads=", "threads=auto",
  "thread_type=bogus", "thread_type=", "thread_type=0.5", "thread_type=4294967296",
  "thread_type=slice+bogus", "thread_type=slice+0.5",
  "extra_hw_frames=-2", "extra_hw_frames=2147483648", "extra_hw_frames=NaN", "extra_hw_frames=",
  "unknown=1"
];

for (const complex of [false, true]) {
  for (const options of [...validOptions, ...invalidOptions]) {
    it(`validates stereotools scheduling options (${complex ? "graph" : "simple"}): ${options}`, async () => {
      const input = encodeWav({ sampleRate: 8000,
        channels: [left, right].map(samples => Float64Array.from(samples, sample => sample / 32768)) });
      const volume = Volume.fromJSON({ "/in.wav": Buffer.from(input), "/out.pcm": "KEEP" });
      const filter = `stereotools=mutel=1${options ? `:${options}` : ""}`;
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-i", "/in.wav",
          ...(complex ? ["-filter_complex", `[0:a]${filter}[s]`, "-map", "[s]"] : ["-af", filter]),
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
      if (invalidOptions.includes(options)) {
        assert.notEqual(result.exitCode, 0);
        assert.equal(volume.readFileSync("/out.pcm", "utf8"), "KEEP");
        assert.ok(stderr.includes("stereotools"), stderr);
      } else {
        assert.equal(result.exitCode, 0, stderr);
        const output = volume.readFileSync("/out.pcm") as Buffer;
        assert.equal(output.length, right.length * 4);
        // Native FFmpeg 7.0.2: scheduling options preserve the actual left-channel mute.
        assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)),
          right.flatMap(sample => [0, sample]));
      }
      assert.deepEqual(volume.readFileSync("/in.wav"), Buffer.from(input));
    });
  }
}
