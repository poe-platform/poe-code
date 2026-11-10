import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createCommandArguments } from "safe-bash-contracts";
import { createFfmpegCommand } from "./index.js";

const lumaOnly = [0, 2, 3, 5, 6, 7, 8];
const withChroma = [0, 1, 3, 4, 5, 7, 8];
// Native FFmpeg 7.0.2 reference frame selections for 32x32 YUV444 input.
for (const [filter, varyingChroma, expected, sha256] of [
  ["null", true, [0, 1, 2, 3, 4, 5, 6, 7, 8], "a59ea5089210333c5816f1c07f79239a8aa1f316a6ecea133b27224c50f06868"],
  ["decimate=cycle=4", true, withChroma, "277d62d3e4ed93ed70df8fc1473346919cd22530e8110a83d427f5bffd1ccd7d"],
  ["decimate=cycle=4:chroma=0", true, lumaOnly, "f4a90a7046000801d18d0e2f9e51e760661146910da2a4617137bf6e67f68efc"],
  ["decimate=cycle=4:chroma=1", false, [1, 2, 3, 5, 6, 7, 8], "a1ab13a22cc753d5421dea0e35a946885b80eca54c6c8ce78de952696b2224c9"],
  ["decimate=cycle=4:chroma=1", true, withChroma],
  ["decimate=4:chroma=0", true, lumaOnly],
  ["decimate=chroma=0:cycle=4", true, lumaOnly],
  ["decimate=cycle=4:chroma=false", true, lumaOnly],
  ["decimate=cycle=4:chroma=off", true, lumaOnly],
  ["decimate=cycle=4:chroma=true", true, withChroma],
  ["decimate=cycle=4:chroma=on", true, withChroma],
  ["decimate=chroma=0", true, [0, 2, 3, 4, 5, 6, 7, 8]],
  ["decimate=chroma=1", true, [0, 1, 3, 4, 5, 6, 7, 8]],
  ["decimate=cycle=4:chroma=2", true, null],
  ["decimate=cycle=4:chroma=-1", true, null],
  ["decimate=cycle=4:chroma=0.5", true, null],
  ["decimate=cycle=4:chroma=oops", true, null],
  ["decimate=4:1", true, null],
  ["decimate=cycle=4:chroma=0:unknown=1", true, null]
] as const) {
  it(`${filter} preserves native frame bytes (${varyingChroma ? "varying" : "flat"} chroma)`, async () => {
    const levels = varyingChroma ? [50, 52, 54, 56, 58, 60, 62, 64, 66] : [20, 50, 65, 100, 140, 170, 180, 205, 221];
    const chroma = [64, 180, 180, 30, 180, 61, 61, 40, 180];
    const frames = levels.map((level, i) => Buffer.concat([
      Buffer.alloc(32 * 32, level),
      Buffer.alloc(32 * 32, varyingChroma ? chroma[i]! : 128),
      Buffer.alloc(32 * 32, 128)
    ]));
    const input = Buffer.concat([
      Buffer.from("YUV4MPEG2 W32 H32 F10:1 Ip A1:1 C444\n"),
      ...frames.flatMap(frame => [Buffer.from("FRAME\n"), frame])
    ]);
    const volume = Volume.fromJSON({ "/in.y4m": input, "/out.raw": "KEEP" });
    const errors: Uint8Array[] = [];
    const argumentValues = createCommandArguments(["-v", "error", "-y", "-i", "/in.y4m", "-vf", filter,
      "-fps_mode", "passthrough", "-pix_fmt", "yuv444p", "-f", "rawvideo", "/out.raw"]);
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
    const output = volume.readFileSync("/out.raw") as Buffer;
    assert.deepEqual(volume.readFileSync("/in.y4m"), input);
    if (expected === null) {
      assert.notEqual(result.exitCode, 0, stderr);
      assert.ok(stderr.includes("decimate:"), stderr);
      assert.equal(output.toString(), "KEEP");
    } else {
      assert.equal(result.exitCode, 0, stderr);
      assert.deepEqual(output, Buffer.concat(expected.map(i => frames[i]!)));
      if (sha256) assert.equal(createHash("sha256").update(output).digest("hex"), sha256);
    }
  });
}
