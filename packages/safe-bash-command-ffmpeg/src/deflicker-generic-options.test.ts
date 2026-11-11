import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native Linux FFmpeg 7.0.2 reference: eight 2x2 gray frames at 2 fps.
const input = Buffer.from("0d5eaf0051a2f34495e63788d92a7bcc1d6ebf1061b20354a5f64798e93a8bdc", "hex");

for (const [options, valid] of [
  ["", true],
  ["threads=1", true],
  ["extra_hw_frames=1", true],
  ["thread_type=slice", true],
  ["threads=1:extra_hw_frames=1:thread_type=slice", true],
  ["threads=0:extra_hw_frames=-1:thread_type=0", true],
  ["threads=1+1:extra_hw_frames=2-1:thread_type=all-slice", true],
  ["threads=-1", false],
  ["threads=2147483648", false],
  ["threads=bogus", false],
  ["extra_hw_frames=-2", false],
  ["extra_hw_frames=2147483648", false],
  ["extra_hw_frames=bogus", false],
  ["thread_type=bogus", false],
  ["thread_type=0.5", false],
  ["thread_type=4294967296", false],
  ["threads=1:unknown=1", false]
] as const) {
  for (const graph of [false, true]) {
    it(`deflicker scheduling ${options || "control"} (${graph ? "graph" : "simple"})`, async () => {
      const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
      const before = volume.toJSON();
      const chunks: Uint8Array[] = [];
      let stderr = "";
      const filter = options ? `deflicker=${options}` : "deflicker";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-f", "rawvideo", "-pixel_format", "gray",
          "-video_size", "2x2", "-framerate", "2", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:v]${filter}[out]`, "-map", "[out]"] : ["-vf", filter]),
          "-fps_mode", "passthrough", "-pix_fmt", "gray", "-f", "rawvideo", valid ? "pipe:1" : "/out.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async stat(path: string) { return volume.statSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { chunks.push(bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      if (valid) {
        assert.equal(result.exitCode, 0, stderr);
        assert.equal(stderr, "");
        assert.equal(Buffer.concat(chunks).toString("hex"), "159bff00468dd43b82c93077be246cb32ca7ff189dff0488a8fa489be93a8bdc");
      } else {
        assert.notEqual(result.exitCode, 0);
        assert.ok(stderr.includes("deflicker:"), stderr);
        assert.equal(Buffer.concat(chunks).length, 0);
      }
      assert.deepEqual(volume.toJSON(), before);
    });
  }
}
