import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createCommandArguments } from "safe-bash-contracts";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 samples: each space-delimited weight uses its numeric prefix.
for (const [weights, expected] of [
  ["1/2 3", [16, 17, 18, 27, 75, 199]],
  ["2+2 1", [16, 16, 17, 22, 50, 138]],
  ["1.0suffix 3", [16, 17, 18, 27, 75, 199]],
  ["1 3", [16, 17, 18, 27, 75, 199]],
  ["2 1", [16, 16, 17, 22, 50, 138]],
  ["+1e0suffix 3", [16, 17, 18, 27, 75, 199]],
  ["0x1p0suffix 3", [16, 17, 18, 27, 75, 199]],
  ...["suffix1 3", "NaN 3", "Infinity 3", "1e100suffix 3"].map(weights => [weights, null] as const)
] as const) {
  it(`tmix reads numeric weight prefixes: ${weights}`, async () => {
    const input = Buffer.concat([
      Buffer.from("YUV4MPEG2 W2 H2 F5:1 Ip A1:1 C444\n"),
      ...[16, 17, 18, 30, 90, 235].flatMap(value => [
        Buffer.from("FRAME\n"), Buffer.alloc(4, value), Buffer.alloc(8, 128)
      ])
    ]);
    const volume = Volume.fromJSON({ "/in.y4m": input, "/out.raw": "KEEP" });
    const errors: Uint8Array[] = [];
    const argumentValues = createCommandArguments(["-v", "error", "-y", "-i", "/in.y4m",
      "-vf", `tmix=frames=2:weights=${weights}`, "-fps_mode", "passthrough",
      "-pix_fmt", "yuv444p", "-f", "rawvideo", "/out.raw"]);
    const result = await createFfmpegCommand().execute({
      command: "ffmpeg", args: argumentValues.args, argumentValues,
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
    } as never);
    const stderr = Buffer.concat(errors).toString();
    if (expected === null) {
      assert.notEqual(result.exitCode, 0);
      assert.ok(stderr.includes("tmix: weights must be finite numbers"), stderr);
      assert.equal(volume.readFileSync("/out.raw", "utf8"), "KEEP");
    } else {
      assert.equal(result.exitCode, 0, stderr);
      assert.deepEqual(volume.readFileSync("/out.raw"), Buffer.concat(expected.map(value =>
        Buffer.concat([Buffer.alloc(4, value), Buffer.alloc(8, 128)]))));
    }
    assert.deepEqual(volume.readFileSync("/in.y4m"), input);
  });
}
