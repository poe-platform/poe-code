import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2: scheduling options do not change software red-channel inversion.
for (const [options, exitCode] of [
  ["", 0],
  [":threads=1", 0],
  [":thread_type=slice", 0],
  [":extra_hw_frames=1", 0],
  [":threads=1:thread_type=slice:extra_hw_frames=1", 0],
  [":threads=0:thread_type=0:extra_hw_frames=-1", 0],
  [":threads=1+1", 0],
  [":thread_type=-1", 0],
  [":threads=-1", 222],
  [":threads=2147483648", 222],
  [":threads=", 234],
  [":threads=nan", 234],
  [":threads=bogus:threads=1", 234],
  [":thread_type=bogus", 234],
  [":thread_type=0.5", 222],
  [":extra_hw_frames=-2", 222],
  [":extra_hw_frames=2147483648", 222]
] as const) {
  for (const complex of [false, true]) {
    for (const existing of [false, true]) {
      it(`negate generic options ${options || "(defaults)"} (${complex ? "graph" : "simple"}, output ${existing ? "exists" : "absent"})`, async () => {
        const input = Buffer.from("102030405060708090a0b0c0", "hex");
        const volume = Volume.fromJSON({ "/in.raw": input, ...(existing ? { "/out.raw": "KEEP" } : {}) });
        const before = volume.toJSON();
        let stderr = "";
        const filter = `negate=components=r${options}`;
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-y", "-f", "rawvideo", "-pixel_format", "rgb24",
            "-video_size", "2x1", "-framerate", "2", "-i", "/in.raw",
            ...(complex ? ["-filter_complex", `[0:v]${filter}[v]`, "-map", "[v]"] : ["-vf", filter]),
            "-pix_fmt", "rgb24", "-f", "rawvideo", "/out.raw"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, exitCode, stderr);
        if (exitCode === 0) {
          assert.equal(stderr, "");
          assert.equal((volume.readFileSync("/out.raw") as Buffer).toString("hex"), "ef2030bf50608f80905fb0c0");
          assert.deepEqual(volume.readFileSync("/in.raw"), input);
        } else {
          assert.deepEqual(volume.toJSON(), before);
          assert.ok(stderr.includes("negate:"), stderr);
        }
      });
    }
  }
}
