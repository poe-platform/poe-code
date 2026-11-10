import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Byte-for-byte references from FFmpeg 7.0.2, including the incomplete final cycle.
for (const [clip, levels, chroma, defaultHash, zeroHash] of [
  ["dup", [20, 50, 50, 100, 140, 170, 170, 205, 221], Array(9).fill(128),
    "a54694732c7bf725a01acc3b2be367b1cad13baecfe0abaa5293c23e2e488c23",
    "15f035d7d53e5f42475ef99087352e9990e1e0746d990816171ecb7b3a420048"],
  ["uv", [50, 52, 54, 56, 58, 60, 62, 64, 66], [64, 180, 180, 30, 180, 61, 61, 40, 180],
    "277d62d3e4ed93ed70df8fc1473346919cd22530e8110a83d427f5bffd1ccd7d",
    "32769e483e4a22028b6b8daa7f2fcaef75fdb133ef81928ce48147758100ce81"]
] as const) {
  for (const [options, expectedHash] of [
    ["cycle=4", defaultHash],
    ["cycle=4:dupthresh=1.1", defaultHash],
    ["cycle=4:dupthresh=0", zeroHash],
    ["dupthresh=0:cycle=4", zeroHash],
    ["4:dupthresh=0", zeroHash],
    ["cycle=4:dupthresh=100", defaultHash],
    // Native truncates the percentage-scaled threshold, then compares strictly.
    ["cycle=4:dupthresh=0.0001", zeroHash],
    ...["-1", "100.1", "NaN", "Infinity", "oops", ""].map(value =>
      [`cycle=4:dupthresh=${value}`, null] as const)
  ] as const) {
    it(`decimate ${clip}: ${options}`, async () => {
      const frames = levels.map((value, index) => Buffer.concat([
        Buffer.alloc(1024, value), Buffer.alloc(1024, chroma[index]!), Buffer.alloc(1024, 128)
      ]));
      const volume = Volume.fromJSON({
        "/in.y4m": Buffer.concat([Buffer.from("YUV4MPEG2 W32 H32 F10:1 Ip A1:1 C444\n"),
          ...frames.flatMap(frame => [Buffer.from("FRAME\n"), frame])]),
        "/out.raw": "KEEP"
      });
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-i", "/in.y4m", "-vf", `decimate=${options}`,
          "-fps_mode", "passthrough", "-pix_fmt", "yuv444p", "-f", "rawvideo", "/out.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      const output = volume.readFileSync("/out.raw") as Buffer;
      if (expectedHash === null) {
        assert.notEqual(result.exitCode, 0);
        assert.ok(stderr.includes("decimate:"), stderr);
        assert.equal(output.toString(), "KEEP");
      } else {
        assert.equal(result.exitCode, 0, stderr);
        assert.equal(output.length, 21504);
        assert.equal(createHash("sha256").update(output).digest("hex"), expectedHash);
      }
    });
  }
}
