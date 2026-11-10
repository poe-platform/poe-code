import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const frames = [16, 235, 16, 235, 235, 16, 235].map(value =>
  Buffer.concat([Buffer.alloc(4, value), Buffer.alloc(8, 128)]));
const input = Buffer.concat([Buffer.from("YUV4MPEG2 W2 H2 F5:1 Ip A1:1 C444\n"),
  ...frames.flatMap(frame => [Buffer.from("FRAME\n"), frame])]);

// Native FFmpeg 7.0.2: rawvideo pictures are I, including Y4M input.
for (const raw of [false, true]) {
  for (const [filter, expected] of [
    ["select=eq(pict_type\\,I)", Buffer.concat(frames)],
    ["select=eq(pict_type\\,P)", Buffer.alloc(0)],
    ["select=eq(pict_type\\,B)", Buffer.alloc(0)],
    ["select=eq(key\\,1)", Buffer.concat(frames)],
    ["select=lt(n\\,0)", Buffer.alloc(0)],
    ["select=expr='eq(pict_type,I)*gte(n,2)'", Buffer.concat(frames.slice(2))],
    ["trim=start_frame=2,select=eq(pict_type\\,I)", Buffer.concat(frames.slice(2))],
    ["select=0,select=eq(pict_type\\,I)", Buffer.alloc(0)],
    ["select=eq(pict_type\\,unknown)", null]
  ] as const) {
    it(`selects ${raw ? "rawvideo" : "Y4M"} picture types: ${filter}`, async () => {
      const volume = Volume.fromJSON({ "/out.raw": "KEEP" });
      volume.writeFileSync("/in.y4m", input);
      volume.writeFileSync("/in.raw", Buffer.concat(frames));
      const before = volume.toJSON();
      const errors: Uint8Array[] = [];
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", ...(raw
          ? ["-f", "rawvideo", "-pix_fmt", "yuv444p", "-s", "2x2", "-r", "5", "-i", "/in.raw"]
          : ["-i", "/in.y4m"]), "-vf", filter, "-fps_mode", "passthrough",
        "-pix_fmt", "yuv444p", "-f", "rawvideo", "/out.raw"],
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
        assert.notEqual(result.exitCode, 0, stderr);
        assert.ok(stderr.includes("select:"), stderr);
        assert.deepEqual(volume.toJSON(), before);
      } else {
        assert.equal(result.exitCode, 0, stderr);
        const output = volume.readFileSync("/out.raw") as Buffer;
        assert.deepEqual(output, expected);
        if (output.length === 84 || output.length === 0) {
          assert.equal(createHash("sha256").update(output).digest("hex"), output.length
            ? "a30dcc48f6f88e4e735fa8fcf8906d92f28bb60081a61a0a2c8a1e0b098b514d"
            : "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
        }
      }
    });
  }
}
