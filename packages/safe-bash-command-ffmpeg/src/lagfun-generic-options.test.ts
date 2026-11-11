import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = Buffer.from("c8b4a08c0a0a0a0a0a0a0a0a0a0a0a0a", "hex");

for (const [options, valid] of [
  ["", true],
  ["threads=1", true],
  ["thread_type=slice", true],
  ["extra_hw_frames=1", true],
  ["threads=1:thread_type=slice:extra_hw_frames=1", true],
  ["threads=0:thread_type=0:extra_hw_frames=-1", true],
  ["threads=1+1:thread_type=all-slice:extra_hw_frames=2-1", true],
  ["threads=max:thread_type=4294967295:extra_hw_frames=max", true],
  ["threads=default:thread_type=none:extra_hw_frames=default", true],
  ["threads=-1", false],
  ["threads=2147483648", false],
  ["threads=bogus", false],
  ["thread_type=bogus", false],
  ["thread_type=0.5", false],
  ["thread_type=4294967296", false],
  ["extra_hw_frames=-2", false],
  ["extra_hw_frames=2147483648", false],
  ["extra_hw_frames=bogus", false],
  ["threads=1:unknown=1", false]
] as const) {
  for (const graph of [false, true]) {
    it(`lagfun scheduling ${options || "control"} (${graph ? "graph" : "simple"})`, async () => {
      const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
      const before = volume.toJSON();
      const chunks: Uint8Array[] = [];
      let stderr = "";
      const filter = options ? `lagfun=${options}` : "lagfun";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-f", "rawvideo", "-pixel_format", "gray",
          "-video_size", "2x2", "-framerate", "1", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:v]${filter}[out]`, "-map", "[out]"] : ["-vf", filter]),
          "-pix_fmt", "gray", "-f", "rawvideo", valid ? "pipe:1" : "/out.raw"],
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
        // Complete native Linux FFmpeg 7.0.2 output for all four frames.
        assert.equal(Buffer.concat(chunks).toString("hex"), "c8b4a08cbeab9885b4a2907eab9a8978");
      } else {
        assert.notEqual(result.exitCode, 0);
        assert.ok(stderr.includes("lagfun:"), stderr);
        assert.equal(Buffer.concat(chunks).length, 0);
      }
      assert.deepEqual(volume.toJSON(), before);
    });
  }
}
