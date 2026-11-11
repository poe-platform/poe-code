import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

for (const [valid, options] of [
  [true, ["", "threads=1", "extra_hw_frames=1", "thread_type=all-slice",
    "threads=1:thread_type=slice:extra_hw_frames=1",
    "threads=0:thread_type=none:extra_hw_frames=-1",
    "threads=default:extra_hw_frames=min", "threads=1+1:extra_hw_frames=2-1",
    "threads=2147483647:thread_type=4294967295:extra_hw_frames=2147483647",
    "threads=0.5:extra_hw_frames=-0.5", "thread_type=+slice", "thread_type=-slice",
    "threads=1:threads=2:", "2:stereo:0.0-FL|1.0-FR:threads=1",
    "threads=1:inputs=2:channel_layout=stereo:map=0.0-FL|1.0-FR"]],
  [false, ["threads=-1", "threads=2147483648", "threads=", "threads=bogus",
    "thread_type=bogus", "thread_type=0.5", "thread_type=4294967296", "thread_type=slice+",
    "extra_hw_frames=-2", "extra_hw_frames=2147483648", "extra_hw_frames=", "extra_hw_frames=NaN",
    "threads=-1:threads=1", "thread_type=bogus:thread_type=slice",
    "extra_hw_frames=-2:extra_hw_frames=1", "threads=1:unknown=1", "enable=1"]]
] as const) {
  for (const option of options) {
    for (const output of ["pipe:1", "/out.pcm"]) {
      it(`join generic options ${option || "control"} to ${output}`, async () => {
        const inputs = [[10, 20, 30, 40, 50], [100, 200, 300]].map(samples =>
          Buffer.from(encodeWav({ sampleRate: 8000,
            channels: [Float64Array.from(samples, sample => sample / 32768)] })));
        const volume = Volume.fromJSON({ "/a.wav": inputs[0]!, "/b.wav": inputs[1]!, "/out.pcm": "KEEP" });
        const stdout: Buffer[] = [];
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-y", "-v", "error", "-i", "/a.wav", "-i", "/b.wav", "-filter_complex",
            `[0:a][1:a]join${option ? `=${option}` : ""}[out]`, "-map", "[out]",
            "-bitexact", "-f", "s16le", output],
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
        if (valid) {
          assert.equal(result.exitCode, 0, stderr);
          // FFmpeg 7.0.2: interleave channels and stop at the shorter input.
          const expected = Buffer.alloc(12);
          [10, 100, 20, 200, 30, 300].forEach((sample, index) => expected.writeInt16LE(sample, index * 2));
          assert.deepEqual(output === "pipe:1" ? Buffer.concat(stdout) : volume.readFileSync(output), expected);
        } else {
          assert.notEqual(result.exitCode, 0, option);
          assert.ok(stderr.includes("join"), stderr);
          assert.equal(Buffer.concat(stdout).length, 0);
          assert.equal(volume.readFileSync("/out.pcm", "utf8"), "KEEP");
        }
        assert.deepEqual(volume.readFileSync("/a.wav"), inputs[0]);
        assert.deepEqual(volume.readFileSync("/b.wav"), inputs[1]);
      });
    }
  }
}
