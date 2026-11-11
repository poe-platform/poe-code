import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

for (const [valid, options] of [
  [true, ["", "threads=1", "thread_type=slice", "extra_hw_frames=1",
    "threads=1:thread_type=slice:extra_hw_frames=1",
    "threads=0:thread_type=none:extra_hw_frames=-1",
    "threads=default:extra_hw_frames=min", "threads=1+1:extra_hw_frames=2-1",
    "threads=2147483647:thread_type=4294967295:extra_hw_frames=2147483647",
    "threads=0.5:extra_hw_frames=-0.5", "thread_type=+slice", "thread_type=all-slice",
    "thread_type=none+slice", "threads=1:threads=2:"]],
  [false, ["threads=-1", "threads=2147483648", "threads=", "threads=bogus",
    "thread_type=bogus", "thread_type=0.5", "thread_type=4294967296", "thread_type=slice+",
    "extra_hw_frames=-2", "extra_hw_frames=2147483648", "extra_hw_frames=", "extra_hw_frames=NaN",
    "unknown=1", "enable=1"]]
] as const) {
  for (const option of options) {
    it(`acrossfade generic options: ${option || "control"}`, async () => {
      const inputs = [12000, -3000].map(value => encodeWav({ sampleRate: 44100,
        channels: [new Float64Array(8000).fill(value / 32768)] }));
      const volume = Volume.fromJSON({ "/a.wav": Buffer.from(inputs[0]!),
        "/b.wav": Buffer.from(inputs[1]!), "/out.pcm": "KEEP" });
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-i", "/a.wav", "-i", "/b.wav", "-filter_complex",
          `[0:a][1:a]acrossfade=ns=4${option ? `:${option}` : ""}`, "-f", "s16le", "/out.pcm"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      if (!valid) {
        assert.notEqual(result.exitCode, 0, option);
        assert.ok(stderr.includes("acrossfade"), stderr);
        assert.equal(volume.readFileSync("/out.pcm", "utf8"), "KEEP");
      } else {
        assert.equal(result.exitCode, 0, stderr);
        const output = volume.readFileSync("/out.pcm") as Buffer;
        // FFmpeg 7.0.2 reference: two 8,000-sample PCM16 clips, four-sample crossfade.
        assert.equal(output.length, 31992);
        assert.equal(createHash("sha256").update(output).digest("hex"),
          "71f03788485ee7fcfd98e1d9822b97e0df2d126538f0fef49c1e48db7ac1ddc2");
      }
      assert.deepEqual(volume.readFileSync("/a.wav"), Buffer.from(inputs[0]!));
      assert.deepEqual(volume.readFileSync("/b.wav"), Buffer.from(inputs[1]!));
    });
  }
}
