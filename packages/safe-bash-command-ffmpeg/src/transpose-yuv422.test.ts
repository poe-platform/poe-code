import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Complete raw output from native FFmpeg, including both chroma planes.
for (const [format, size, inputHex, filter, expected] of [
  ["yuv422p", "4x2", "32333435363738391c1d1e1fc8c9cacb", "transpose=clock", "36323733383439351c1c1d1dc8c8c9c9"],
  ["yuv422p", "4x2", "32333435363738391c1d1e1fc8c9cacb", "transpose=clock,transpose=cclock", "32333435363738391c1d1e1fc8c9cacb"],
  ["yuv422p", "4x2", "32333435363738391c1d1e1fc8c9cacb", "null", "32333435363738391c1d1e1fc8c9cacb"],
  ["yuv422p", "4x2", "32333435363738391c1d1e1fc8c9cacb", "transpose=clock:landscape", "32333435363738391c1d1e1fc8c9cacb"],
  ["yuv422p", "4x2", "32333435363738391c1d1e1fc8c9cacb", "hflip", "35343332393837361d1c1f1ec9c8cbca"],
  ["yuv420p", "4x2", "32333435363738391c1dc8c9", "transpose=clock", "36323733383439351c1dc8c9"],

  ["yuv422p", "4x2", "3251708faecdec0b2a496887a6c5e403", "transpose=cclock", "8f0b70ec51cd32ae878768680303e4e4"],
  ["yuv422p", "4x2", "3251708faecdec0b2a496887a6c5e403", "transpose=clock_flip", "0b8fec70cd51ae3249492a2ac5c5a6a6"],
  ["yuv422p", "4x2", "3251708faecdec0b2a496887a6c5e403", "transpose=cclock_flip", "32ae51cd70ec8f0b68688787e4e40303"],
  ["yuv422p", "6x4", "3251708faecdec0b2a496887a6c5e4032241607f9ebddcfb1a39587796b5d4f31231506f8eadcceb0a29486786a5c4e3", "transpose=clock,transpose=cclock", "3251708faecdec0b2a496887a6c5e4032241607f9ebddcfb1d39557a96b2d7d72a34506c91adc9d926264b6783a8c4e0"],
  ["yuv422p", "8x6", "3251708faecdec0b2a496887a6c5e4032241607f9ebddcfb1a39587796b5d4f31231506f8eadcceb0a29486786a5c4e30221405f7e9dbcdbfa1938577695b4d3f211304f6e8daccbea0928476685a4c3e201203f5e7d9cbbdaf91837567594b3", "transpose=clock", "0a121a222a32293139414951485058606870676f777f878f868e969ea6aea5adb5bdc5cdc4ccd4dce4ece3ebf3fb030ba9ba4c95a34e6a6c50615e58726f69807d77918e8898958f89a8c197919aae6a54a55c40745d5168655f797670807d77"],
  ["yuv422p", "5x3", "3251708faecdec0b2a496887a6c5e4032241607f9ebddcfb1a39587796b5d4f312", "transpose=cclock", "ae49e48f2ac5700ba651ec8732cd6841fb41fb22dc03bd03bd5812581239f31ad41ad4"]
] as const) {
  for (const typedArray of [false, true]) {
    it(`${format} ${size} ${filter} matches native planes (${typedArray ? "Uint8Array" : "Buffer"})`, async () => {
      const input = Buffer.from(inputHex, "hex");
      const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-f", "rawvideo", "-pixel_format", format, "-video_size", size,
          "-framerate", "4", "-i", "/in.raw", "-vf", filter, "-fps_mode", "passthrough", "-pix_fmt", format, "-f", "rawvideo", "/out.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { const bytes = volume.readFileSync(path) as Buffer; return typedArray ? Uint8Array.from(bytes) : bytes; },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += Buffer.from(bytes).toString(); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal((volume.readFileSync("/out.raw") as Buffer).toString("hex"), expected);
      assert.deepEqual(volume.readFileSync("/in.raw"), input);
    });
  }
}
