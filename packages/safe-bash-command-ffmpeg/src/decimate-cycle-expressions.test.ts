import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const duplicates = [20, 50, 50, 100, 140, 170, 170, 205, 221];
const unique = [20, 50, 65, 100, 140, 170, 180, 205, 221];
// Byte-for-byte reference outputs from native FFmpeg 7.0.2.
const duplicateFour = "a54694732c7bf725a01acc3b2be367b1cad13baecfe0abaa5293c23e2e488c23";
const duplicateDefault = "6139a79fbd14edb42a8b59c81a869cad66ca0aa023115e94ecfcbdd5606abd00";
const uniqueFour = "a1ab13a22cc753d5421dea0e35a946885b80eca54c6c8ce78de952696b2224c9";
for (const [levels, filter, count, hash] of [
  [duplicates, "decimate=cycle=4", 7, duplicateFour],
  [duplicates, "decimate=cycle=2*2", 7, duplicateFour],
  [duplicates, "decimate=2*2", 7, duplicateFour],
  [duplicates, "decimate", 8, duplicateDefault],
  [duplicates, "decimate=cycle=default", 8, duplicateDefault],
  [duplicates, "decimate=default", 8, duplicateDefault],
  [unique, "decimate=cycle=4", 7, uniqueFour],
  [unique, "decimate=cycle=3.5", 7, uniqueFour],
  [unique, "decimate=cycle=4.5", 7, uniqueFour],
  [unique, "decimate=cycle=7/2", 7, uniqueFour],
  [unique, "decimate=cycle=default-1", 7, uniqueFour],
  ...["1.9", "25.1", "1+", "1/0", "0/0", "oops", ""].map(value =>
    [unique, `decimate=cycle=${value}`, 0, null] as const)
] as const) {
  it(`${filter} on ${levels} matches native bytes and preserves output on failure`, async () => {
    const volume = Volume.fromJSON({
      "/in.y4m": Buffer.concat([
        Buffer.from("YUV4MPEG2 W32 H32 F10:1 Ip A1:1 C444\n"),
        ...levels.flatMap(value => [Buffer.from("FRAME\n"),
          Buffer.alloc(32 * 32, value), Buffer.alloc(32 * 32 * 2, 128)])
      ]),
      "/out.raw": "KEEP"
    });
    const before = volume.toJSON();
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-i", "/in.y4m", "-vf", filter,
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
    if (hash === null) {
      assert.notEqual(result.exitCode, 0, stderr);
      assert.ok(stderr.includes("decimate:"), stderr);
      assert.deepEqual(volume.toJSON(), before);
    } else {
      assert.equal(result.exitCode, 0, stderr);
      const output = volume.readFileSync("/out.raw") as Buffer;
      assert.equal(output.length, count * 32 * 32 * 3);
      assert.equal(createHash("sha256").update(output).digest("hex"), hash);
    }
  });
}
