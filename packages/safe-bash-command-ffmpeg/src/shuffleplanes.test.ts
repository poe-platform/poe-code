import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Byte-for-byte native FFmpeg 7.0.2 reference outputs.
for (const graph of [false, true]) {
  for (const [format, input, filter, expected, size = "2x2"] of [
    ["rgb24", "111c27323d48535e69747f8a95a0abb6c1ccd7e2edf8030e", "shuffleplanes=0:2:1:3", "271c11483d32695e538a7f74aba095ccc1b6ede2d70e03f8", "4x2"],
    ["rgba", "111c27323d48535e69747f8a95a0abb6c1ccd7e2edf8030e19242f3a45505b66", "shuffleplanes=0:2:1:3", "271c113253483d5e7f74698baba095b7d7ccc1e303f8ed0e2f24193a5b504566", "4x2"],
    ["gbrp", "111c27323d48535e69747f8a95a0abb6c1ccd7e2edf8030e", "shuffleplanes=0:2:1:3", "111c27323d48535ec1ccd7e2edf8030e69747f8a95a0abb6", "4x2"],
    ["yuva420p", "111c27323d48535e69747f8a95a0abb6c1ccd7e2", "shuffleplanes=0:2:1:3", "111c27323d48535e7f8a697495a0abb6c1ccd7e2", "4x2"],
    ["yuv420p", "111c27323d48535e69747f8a", "shuffleplanes=0:2:1:3", "111c27323d48535e7f8a6974", "4x2"],
    ["rgba", "111c27323d48535e69747f8a95a0abb6c1ccd7e2edf8030e19242f3a45505b66", "shuffleplanes=0:2:1:3,shuffleplanes=0:2:1:3", "111c27323d48535e69747f8b95a0abb7c1ccd7e3edf8030e19242f3a45505b66", "4x2"],
    ["rgba", "117f80ff22334480", "shuffleplanes", "117f80ff22334481", "2x1"],
    ["rgb24", "112233445566", "shuffleplanes=0:0:0", "222222555555", "2x1"],
    ["yuva420p", "000102030405060708090a0b0c0d0e0f10007f80feff11223344", "shuffleplanes=0:2:1:3", "0001020304050607080d0e0f10090a0b0c007f80feff11223344", "3x3"],
    ["gbrap", "101a242e38424c56606a747e007f80ff", "shuffleplanes=map0=3:map1=2:map2=1:map3=0", "007f80ff606a747e38424c56101a242e"],
    ["rgb24", "112233445566", "shuffleplanes=3:1:2", null, "2x1"],
    ["yuva420p", "111c27323d48535e69747f8a95a0abb6c1ccd7e2", "shuffleplanes=1:0:2:3", null, "4x2"],
    ["gbrap", "101a242e38424c56606a747e007f80ff", "shuffleplanes=3:2:1:0", "007f80ff606a747e38424c56101a242e"],
    ["yuva444p", "101a242e38424c56606a747e007f80ff", "shuffleplanes=3:2:1:0", "007f80ff606a747e38424c56101a242e"],
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
        args: ["-v", "error", "-f", "rawvideo", "-pixel_format", format, "-video_size", size, "-i", "/in.raw",
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
      assert.deepEqual(volume.readFileSync("/in.raw"), Buffer.from(input, "hex"));
      if (expected === null) {
        assert.notEqual(result.exitCode, 0);
        assert.match(Buffer.concat(stderr).toString(), /shuffleplanes/);
        assert.equal(Buffer.concat(stdout).length, 0);
      } else {
        assert.equal(result.exitCode, 0, Buffer.concat(stderr).toString());
        assert.equal(Buffer.concat(stderr).length, 0);
        assert.equal(Buffer.concat(stdout).toString("hex"), expected);
      }
    });
  }
}
