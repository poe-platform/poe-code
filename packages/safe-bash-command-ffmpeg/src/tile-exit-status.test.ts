import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createCommandArguments } from "safe-bash-contracts";
import { createFfmpegCommand } from "./index.js";

// Linux FFmpeg 7.0.2 statuses and successful output for the same YUV444 input.
for (const [filter, exitCode] of [
  ["tile=3x1:margin=1025", 222],
  ["tile=3x1:margin=-1", 222],
  ["tile=3x1:padding=1025", 222],
  ["tile=3x1:padding=bad", 234],
  ["tile=3x1:padding=", 234],
  ["tile=3x1:unknown=1", 8],
  ["tile=2x1:enable=0", 176],
  ["tile=3x1", 0]
] as const) {
  it(`${filter} returns native status ${exitCode} and preserves output on error`, async () => {
    const input = Buffer.concat([
      Buffer.from("YUV4MPEG2 W2 H2 F5:1 Ip A1:1 C444\n"),
      ...[16, 235, 16, 235, 235, 16, 235].flatMap(value => [
        Buffer.from("FRAME\n"), Buffer.alloc(4, value), Buffer.alloc(8, 128)
      ])
    ]);
    const volume = Volume.fromJSON({ "/bw.y4m": input, "/out.raw": "KEEP" });
    const before = volume.toJSON();
    const errors: Uint8Array[] = [];
    const argumentValues = createCommandArguments([
      "-v", "error", "-y", "-i", "/bw.y4m", "-vf", filter,
      "-fps_mode", "passthrough", "-pix_fmt", "yuv444p", "-f", "rawvideo", "/out.raw"
    ]);
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
    if (exitCode !== 0) {
      assert.deepEqual(volume.toJSON(), before);
      assert.ok(stderr.includes("tile:"), stderr);
    } else {
      const output = volume.readFileSync("/out.raw") as Buffer;
      assert.equal(output.length, 108);
      assert.equal(createHash("sha256").update(output).digest("hex"),
        "bc857ecd5697747f39ecc3ee92bf8899a3cf7277e12737cd222534cb7663ea38");
      assert.deepEqual(volume.readFileSync("/bw.y4m"), input);
    }
    assert.equal(result.exitCode, exitCode, stderr);
  });
}
