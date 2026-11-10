import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2-static, stereo s16le at 8 kHz; hashes include both channels.
for (const graph of [false, true]) {
  for (const [filter, count, expected] of [
    ["aloop=2:3:1", 8, [101, 102, 103, 104, 105, 102, 103, 105, 102, 103, 105, 106, 107, 108]],
    ["aloop=2:3:2", 8, [101, 102, 103, 104, 105, 106, 107, 103, 106, 107, 103, 106, 107, 108]],
    ["aloop=2:3:6", 8, [101, 102, 103, 104, 105, 106, 107, 108, 107, 108, 107, 108]],
    ["aloop=2:3:511", 1200, "ccd998cc4a6919fd90bcd1d9488e1c816f721b3f194049e10fda3b857c81bc0a"],
    ["aloop=2:3:513", 1200, "b8aa5f899892f0902aadc78506292acad510080ec2df2dde4143edb820c1a655"],
    ["aloop=2:3:3", 8, [101, 102, 103, 104, 105, 106, 104, 105, 106, 104, 105, 106, 107, 108]],
    ["aloop=loop=2:size=3:start=3", 8, [101, 102, 103, 104, 105, 106, 104, 105, 106, 104, 105, 106, 107, 108]],
    ["aloop=2:3:7", 8, [101, 102, 103, 104, 105, 106, 107, 108, 108, 108]],
    ["aloop=2:3:8", 8, [101, 102, 103, 104, 105, 106, 107, 108]],
    ["aloop=2:3:20", 8, [101, 102, 103, 104, 105, 106, 107, 108]],
    ["aloop=2:1025:510", 1200, "8f215b9993dd5b86969a1d9fa881a1b6760592b7a52ab27497ba7b1774d93959"],
    ["aloop=2:3:510", 1200, "485765854f5d66a1e942eba8618798ed24e10b5f22178370a33f3b761175b109"],
    ["aloop=2:3:512", 1200, "40ff489f6fa4c2a6f40ef30ad3d9e1d24d3dd00e2cae485204ed88df62053973"],
    ["aloop=2:3:0", 8, [101, 102, 103, 101, 102, 103, 101, 102, 103, 104, 105, 106, 107, 108]],
    ["aloop=2:3:-2", 8, null],
    ["aloop=2:3:NaN", 8, null],
    ["aloop=2:3:start=", 8, null],
    ["aloop=9007199254740991:3:3", 8, null]
  ] as const) {
    it(`${filter} matches native PCM (${graph ? "graph" : "simple"})`, async () => {
      const input = Buffer.alloc(count * 4);
      for (let i = 0; i < count; i++) {
        input.writeInt16LE(101 + i, i * 4);
        input.writeInt16LE(-901 - i, i * 4 + 2);
      }
      const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", "s16le", "/out.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      if (expected === null) {
        assert.notEqual(result.exitCode, 0);
        assert.ok(stderr.includes("aloop:"), stderr);
        assert.equal(volume.readFileSync("/out.raw", "utf8"), "KEEP");
      } else {
        assert.equal(result.exitCode, 0, stderr);
        const output = volume.readFileSync("/out.raw") as Buffer;
        if (typeof expected === "string") {
          assert.equal(createHash("sha256").update(output).digest("hex"), expected);
        } else {
          assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)),
            expected.flatMap(left => [left, -800 - left]));
        }
      }
      assert.deepEqual(volume.readFileSync("/in.raw"), input);
    });
  }
}
