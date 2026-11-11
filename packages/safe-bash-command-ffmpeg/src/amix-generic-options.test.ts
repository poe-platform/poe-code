import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

for (const [valid, options] of [
  [true, ["inputs=2", "threads=1", "thread_type=slice", "extra_hw_frames=1",
    "threads=1:thread_type=slice:extra_hw_frames=1",
    "inputs=2:threads=1:duration=longest:thread_type=slice:extra_hw_frames=1",
    "2:longest:2:1 1:1:threads=1",
    "threads=0:thread_type=none:extra_hw_frames=-1",
    "threads=default:extra_hw_frames=min", "threads=1+1:extra_hw_frames=2-1",
    "threads=2147483647:thread_type=4294967295:extra_hw_frames=2147483647",
    "threads=0.5:extra_hw_frames=-0.5", "thread_type=+slice", "thread_type=all-slice",
    "threads=1:threads=2:"]],
  [false, ["threads=-1", "threads=2147483648", "threads=", "threads=bogus",
    "thread_type=bogus", "thread_type=0.5", "thread_type=4294967296", "thread_type=slice+",
    "extra_hw_frames=-2", "extra_hw_frames=2147483648", "extra_hw_frames=", "extra_hw_frames=NaN",
    "unknown=1", "threads=1:unknown=1", "enable=1"]]
] as const) {
  for (const option of options) {
    it(`amix generic options: ${option}`, async () => {
      const inputs = [[29, 12000], [13, -4000]].map(([length, value]) =>
        Buffer.from(encodeWav({ sampleRate: 8000,
          channels: [new Float64Array(length!).fill(value! / 32768)] })));
      const volume = Volume.fromJSON({ "/a.wav": inputs[0]!, "/b.wav": inputs[1]!, "/out.pcm": "KEEP" });
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-i", "/a.wav", "-i", "/b.wav", "-filter_complex",
          `[0:a][1:a]amix=${option}`, "-f", "s16le", "/out.pcm"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      if (valid) {
        assert.equal(result.exitCode, 0, stderr);
        // FFmpeg 7.0.2: 13 mixed samples, then 16 samples recovering after the second input ends.
        const expected = Buffer.alloc(29 * 2);
        for (let sample = 0; sample < 29; sample++) expected.writeInt16LE(sample < 13 ? 4000 : 6003, sample * 2);
        assert.deepEqual(volume.readFileSync("/out.pcm"), expected);
      } else {
        assert.notEqual(result.exitCode, 0, option);
        assert.ok(stderr.includes("amix"), stderr);
        assert.equal(volume.readFileSync("/out.pcm", "utf8"), "KEEP");
      }
      assert.deepEqual(volume.readFileSync("/a.wav"), inputs[0]);
      assert.deepEqual(volume.readFileSync("/b.wav"), inputs[1]);
    });
  }
}
