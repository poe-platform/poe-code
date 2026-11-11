import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Byte-for-byte native FFmpeg reference outputs for a 2×2 planar frame.
for (const graph of [false, true]) {
  for (const [format, input, filter, expected] of [
    ["yuv444p", "101a242e38424c56606a747e", "null", "101a242e38424c56606a747e"],
    ["yuv444p", "101a242e38424c56606a747e", "shuffleplanes", "101a242e38424c56606a747e"],
    ["yuv444p", "101a242e38424c56606a747e", "shuffleplanes=0:2:1", "101a242e606a747e38424c56"],
    ["yuv444p", "101a242e38424c56606a747e", "shuffleplanes=0:0:0", "101a242e101a242e101a242e"],
    ["yuv444p", "101a242e38424c56606a747e", "shuffleplanes=map0=0:map1=2:map2=1", "101a242e606a747e38424c56"],
    ["yuv444p", "101a242e38424c56606a747e", "shuffleplanes=0:2:1,shuffleplanes=0:2:1", "101a242e38424c56606a747e"],
    ["yuv420p", "101a242e3860", "shuffleplanes=0:2:1", "101a242e6038"],
    ["yuv444p", "101a242e38424c56606a747e", "shuffleplanes=4:1:2", null],
    ["yuv444p", "101a242e38424c56606a747e", "shuffleplanes=-1:1:2", null],
    ["yuv444p", "101a242e38424c56606a747e", "shuffleplanes=unknown=0", null]
  ] as const) {
    it(`${graph ? "graph" : "simple"} ${format} ${filter}`, async () => {
      const volume = Volume.fromJSON({ "/in.raw": Buffer.from(input, "hex") });
      const stdout: Uint8Array[] = [];
      const stderr: Uint8Array[] = [];
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "rawvideo", "-pixel_format", format, "-video_size", "2x2", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:v]${filter}[out]`, "-map", "[out]"] : ["-vf", filter]),
          "-pix_fmt", format, "-f", "rawvideo", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr.push(bytes); } }
      } as never);
      if (expected === null) {
        assert.notEqual(result.exitCode, 0);
        assert.match(Buffer.concat(stderr).toString(), /shuffleplanes/);
        assert.equal(Buffer.concat(stdout).length, 0);
      } else {
        assert.equal(result.exitCode, 0, Buffer.concat(stderr).toString());
        assert.equal(Buffer.concat(stdout).toString("hex"), expected);
      }
    });
  }
}
