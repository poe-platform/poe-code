import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const axis of ["hstack", "vstack"]) {
  for (const linked of [false, true]) {
    for (const downstream of ["trim=end_frame=1", "hflip", "hflip,trim=end_frame=1", "select='eq(n,0)'"]) {
      it(`${axis} applies ${downstream} through ${linked ? "a labeled link" : "a comma chain"}`, async () => {
        const volume = Volume.fromJSON({
          "/a.raw": Buffer.from([1, 2, 3, 4, 10, 20, 30, 40, 50, 60, 70, 80]),
          "/b.raw": Buffer.from([5, 6, 7, 8, 55, 66, 77, 88])
        });
        const output: Uint8Array[] = [];
        const errors: Uint8Array[] = [];
        const result = await createFfmpegCommand().execute({
          args: ["-hide_banner", "-loglevel", "error",
            "-f", "rawvideo", "-pix_fmt", "gray", "-s", "2x2", "-r", "1", "-i", "/a.raw",
            "-f", "rawvideo", "-pix_fmt", "gray", "-s", "2x2", "-r", "1", "-i", "/b.raw",
            "-filter_complex", `[0:v][1:v]${axis}${linked ? "[stack];[stack]" : ","}${downstream}[out]`,
            "-map", "[out]", "-pix_fmt", "gray", "-f", "rawvideo", "pipe:1"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(),
          stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
          stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
        assert.equal(Buffer.concat(errors).toString(), "");
        let frames = axis === "hstack"
          ? [[1, 2, 5, 6, 3, 4, 7, 8], [10, 20, 55, 66, 30, 40, 77, 88], [50, 60, 55, 66, 70, 80, 77, 88]]
          : [[1, 2, 3, 4, 5, 6, 7, 8], [10, 20, 30, 40, 55, 66, 77, 88], [50, 60, 70, 80, 55, 66, 77, 88]];
        if (downstream.includes("trim") || downstream.startsWith("select=")) frames = frames.slice(0, 1);
        if (downstream.includes("hflip")) {
          const width = axis === "hstack" ? 4 : 2;
          frames = frames.map(frame => frame.map((_, index) =>
            frame[Math.floor(index / width) * width + width - 1 - index % width]!));
        }
        assert.deepEqual(Buffer.concat(output), Buffer.from(frames.flat()));
      });
    }
  }
}
