import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const [argument, status] of [["tinterlace=8", 222], ["tinterlace=mode=-1", 222], ["tinterlace=bad", 234], ["tinterlace=foo=4", 8], ["null", 0]] as const) {
  it(`${argument} exits ${status} and preserves expected bytes`, async () => {
    const input = Buffer.concat([
      Buffer.from("YUV4MPEG2 W4 H4 F6:1 Ip A1:1 C444\n"),
      ...Array.from({ length: 6 }, (_, i) => [Buffer.from("FRAME\n"),
        Buffer.from(Array.from({ length: 48 }, (_, n) => n < 16 ? 32 + 24 * i + 3 * Math.floor(n / 4) : 128))]).flat()
    ]);
    const volume = Volume.fromJSON({ "/in.y4m": input, "/out.y4m": "KEEP" });
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-i", "/in.y4m", "-vf", argument,
        "-fps_mode", "passthrough", "-pix_fmt", "yuv444p", "-f", "yuv4mpegpipe", "/out.y4m"],
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
    assert.equal(result.exitCode, status, Buffer.concat(errors).toString());
    if (status === 0) {
      const output = volume.readFileSync("/out.y4m") as Buffer;
      const payload = output.subarray(output.indexOf(10) + 1);
      assert.equal(payload.length, 6 * 54);
      const planes = [];
      for (let offset = 0; offset < payload.length; offset += 54) {
        assert.equal(payload.subarray(offset, offset + 6).toString(), "FRAME\n");
        planes.push(payload.subarray(offset + 6, offset + 54));
      }
      assert.equal(createHash("sha256").update(Buffer.concat(planes)).digest("hex"),
        "9fee2551026c4a095069b733852e41fd575169a053540e53e6cdf1cde85fcdf0");
    } else {
      assert.equal(volume.readFileSync("/out.y4m", "utf8"), "KEEP");
    }
    assert.deepEqual(volume.readFileSync("/in.y4m"), input);
  });
}
