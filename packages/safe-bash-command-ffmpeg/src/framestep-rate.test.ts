import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg reference: eight distinguishable YUV444 frames at 6 fps.
for (const [filter, rate, luma] of [
  ["null", "6:1", [32, 52, 72, 92, 112, 132, 152, 172]],
  ["framestep=1", "6:1", [32, 52, 72, 92, 112, 132, 152, 172]],
  ["framestep=2", "3:1", [32, 72, 112, 152]],
  ["framestep=3", "2:1", [32, 92, 152]],
  ["framestep=2,fps=6", "6:1", [32, 32, 72, 72, 112, 112, 152, 152]],
  ["null,fps=6", "6:1", [32, 52, 72, 92, 112, 132, 152, 172]],
  ["framestep=2,fps=source_fps", "3:1", [32, 72, 112, 152]]
] as const) {
  for (const format of ["rawvideo", "yuv4mpegpipe"]) {
    it(`framestep carries rate through ${filter} to ${format}`, async () => {
      const input = Buffer.concat([
        Buffer.from("YUV4MPEG2 W2 H2 F6:1 Ip A1:1 C444\n"),
        ...Array.from({ length: 8 }, (_, i) => Buffer.concat([
          Buffer.from("FRAME\n"), Buffer.alloc(4, 32 + 20 * i), Buffer.alloc(8, 128)
        ]))
      ]);
      const volume = Volume.fromJSON({ "/in.y4m": input, "/out": "KEEP" });
      const errors: Uint8Array[] = [];
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-i", "/in.y4m", "-vf", filter,
          "-fps_mode", "passthrough", "-pix_fmt", "yuv444p", "-f", format, "/out"],
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
      assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
      const output = volume.readFileSync("/out") as Buffer;
      if (format === "rawvideo") {
        assert.equal(output.length, luma.length * 12);
        assert.deepEqual(Array.from({ length: luma.length }, (_, i) => output[i * 12]), luma);
      } else {
        const header = output.subarray(0, output.indexOf(10)).toString();
        assert.ok(header.split(" ").includes(`F${rate}`), header);
      }
      assert.deepEqual(volume.readFileSync("/in.y4m"), input);
    });
  }
}
