import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const format of ["yuv444p", "rgba"]) {
  for (const filter of ["tblend", "tblend=all_mode=normal", "trim=start_frame=1", "tblend=all_mode=difference:enable=0"]) {
    it(`${filter} preserves exact ${format} samples after the first frame`, async () => {
      const samples = [[50, 30, 212, 255], [120, 180, 60, 128], [120, 180, 60, 128], [80, 140, 190, 32]];
      const frames = samples.map(sample => Buffer.from(format === "rgba"
        ? Array.from({ length: 4 }, () => sample).flat()
        : sample.slice(0, 3).flatMap(value => Array(4).fill(value))));
      const input = format === "rgba" ? Buffer.concat(frames) : Buffer.concat([
        Buffer.from("YUV4MPEG2 W2 H2 F4:1 Ip A1:1 C444\n"),
        ...frames.flatMap(frame => [Buffer.from("FRAME\n"), frame])
      ]);
      const volume = Volume.fromJSON({ "/in": input, "/out.raw": "KEEP" });
      const errors: Uint8Array[] = [];
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", ...(format === "rgba"
          ? ["-f", "rawvideo", "-pixel_format", "rgba", "-video_size", "2x2", "-framerate", "4"] : []),
        "-i", "/in", "-vf", filter, "-fps_mode", "passthrough", "-pix_fmt", format, "-f", "rawvideo", "/out.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
      assert.deepEqual(volume.readFileSync("/out.raw"), Buffer.concat(frames.slice(1)));
    });
  }
}
