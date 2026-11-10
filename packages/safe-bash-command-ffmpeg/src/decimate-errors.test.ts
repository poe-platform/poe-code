import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const [filter, exitCode] of [
  ["decimate=cycle=26", 222],
  ["decimate=cycle=1", 222],
  ["decimate=cycle=bad", 234],
  ["decimate=cycle=", 234],
  ["decimate=unknown=1", 8],
  ["decimate=cycle=4:enable=0", 176],
  ["decimate=cycle=4", 0]
] as const) {
  it(`${filter} preserves native Linux exit status ${exitCode}`, async () => {
    const frames = [20, 50, 50, 100, 140, 170, 170, 205, 221].map(value => Buffer.concat([
      Buffer.alloc(32 * 32, value), Buffer.alloc(32 * 32 * 2, 128)
    ]));
    const volume = Volume.fromJSON({
      "/dup.y4m": Buffer.concat([
        Buffer.from("YUV4MPEG2 W32 H32 F10:1 Ip A1:1 C444\n"),
        ...frames.flatMap(frame => [Buffer.from("FRAME\n"), frame])
      ]),
      "/out.raw": "KEEP"
    });
    const before = volume.toJSON();
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-i", "/dup.y4m", "-vf", filter,
        "-fps_mode", "passthrough", "-pix_fmt", "yuv444p", "-f", "rawvideo", "/out.raw"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
    } as never);
    const stderr = Buffer.concat(errors).toString();
    assert.equal(result.exitCode, exitCode, stderr);
    if (exitCode !== 0) {
      assert.ok(stderr.includes("decimate:"), stderr);
      assert.deepEqual(volume.toJSON(), before);
    } else {
      const output = volume.readFileSync("/out.raw") as Buffer;
      assert.deepEqual(output, Buffer.concat([0, 1, 3, 4, 5, 7, 8].map(i => frames[i]!)));
      assert.equal(output.length, 21504);
      assert.equal(createHash("sha256").update(output).digest("hex"),
        "a54694732c7bf725a01acc3b2be367b1cad13baecfe0abaa5293c23e2e488c23");
    }
  });
}
