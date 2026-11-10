import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const samples = [[50, 30, 212, 255], [120, 180, 60, 128], [120, 180, 60, 128], [80, 140, 190, 32]];
// FFmpeg 7.0.2 YUV reference: adjacent original frames, clipped independently per channel.
const added = [[170, 210, 255, 255], [240, 255, 120, 255], [200, 255, 250, 161]];

for (const [format, chromaSize, depth] of [
  ["yuv444p", 4, 8], ["yuv422p", 2, 8], ["yuv420p", 1, 8], ["rgb24", 0, 8],
  ["yuv444p10le", 4, 10], ["yuv444p16le", 4, 16]
] as const) {
  for (const y4m of depth > 8 ? [true] : format === "rgb24" ? [false] : [false, true]) {
    for (const filter of ["null", "tblend=all_mode=addition"]) {
      it(`${filter} preserves exact ${format} samples from ${y4m ? "Y4M" : "rawvideo"}`, async () => {
        const frameBytes = (frame: number[], saturated = false) => {
          const values = chromaSize
            ? frame.slice(0, 3).flatMap((sample, plane) => Array<number>(plane === 0 ? 4 : chromaSize).fill(sample))
            : Array.from({ length: 4 }, () => frame.slice(0, 3)).flat();
          if (depth === 8) return Buffer.from(values);
          const bytes = Buffer.alloc(values.length * 2);
          values.forEach((value, index) => bytes.writeUInt16LE(saturated && value === 255
            ? 2 ** depth - 1 : value * (depth === 10 ? 4 : 257), index * 2));
          return bytes;
        };
        const input = y4m
          ? Buffer.concat([Buffer.from(`YUV4MPEG2 W2 H2 F4:1 Ip A1:1 C${format.slice(3, 6)}${depth > 8 ? `p${depth}` : ""}\n`),
            ...samples.flatMap(frame => [Buffer.from("FRAME\n"), frameBytes(frame)])])
          : Buffer.concat(samples.map(frame => frameBytes(frame)));
        const volume = Volume.fromJSON({ "/in": input, "/out": "KEEP" });
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-y", ...(y4m ? [] : ["-f", "rawvideo", "-pix_fmt", format, "-s", "2x2", "-r", "4"]),
            "-i", "/in", "-vf", filter, "-fps_mode", "passthrough", "-pix_fmt", format, "-f", "rawvideo", "/out"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        assert.deepEqual(volume.readFileSync("/out"), Buffer.concat((filter === "null" ? samples : added).map(frame => frameBytes(frame, filter !== "null"))));
      });
    }
  }
}
