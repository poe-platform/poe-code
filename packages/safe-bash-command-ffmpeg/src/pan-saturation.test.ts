import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const left = [1, 3, 5, 7, -1, -3, 30001, -31001];
const right = [80, 160, 240, 320, -400, -480, 555, -630];

// Native FFmpeg clips integer pan output before the following volume filter.
for (const [format, filter, expected] of [
  ["s16le", "pan=mono|c0=2*c0,volume=0.5", [1, 3, 5, 7, -1, -3, 16384, -16384]],
  ["s16le", "pan=mono|c0=2*c0", [2, 6, 10, 14, -2, -6, 32767, -32768]],
  ["s16le", "anull,pan=mono|c0=2*c0,pan=mono|c0=c0,volume=0.5", [1, 3, 5, 7, -1, -3, 16384, -16384]],
  ["s16le", "volume=1,pan=mono|c0=2*c0,volume=0.5", left],
  ["s16le", "volume=1:precision=double,pan=mono|c0=2*c0,volume=0.5", left],
  ["s16le", "volume=1:precision=fixed,pan=mono|c0=2*c0,volume=0.5", [1, 3, 5, 7, -1, -3, 16384, -16384]],
  ["f32le", "pan=mono|c0=2*c0,volume=0.5", left],
  ["f64le", "pan=mono|c0=2*c0,volume=0.5", left],
  ["f32le", "aformat=sample_fmts=s16,pan=mono|c0=2*c0,volume=0.5", [1, 3, 5, 7, -1, -3, 16384, -16384]]
] as const) {
  for (const complex of [false, true]) {
    it(`preserves pan saturation for ${format}, ${complex ? "graph" : "simple"}: ${filter}`, async () => {
      const width = format === "s16le" ? 2 : format === "f32le" ? 4 : 8;
      const input = Buffer.alloc(left.length * 2 * width);
      left.forEach((sample, index) => {
        for (const [channel, value] of [sample, right[index]!].entries()) {
          const offset = (index * 2 + channel) * width;
          if (format === "s16le") input.writeInt16LE(value, offset);
          else if (format === "f32le") input.writeFloatLE(value / 32768, offset);
          else input.writeDoubleLE(value / 32768, offset);
        }
      });
      const volume = Volume.fromJSON({ "/out.raw": "keep" });
      volume.writeFileSync("/lr.raw", input);
      const filters = complex
        ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"]
        : ["-af", filter];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-f", format, "-ar", "8000", "-ac", "2", "-i", "/lr.raw",
          ...filters, "-c:a", "pcm_s16le", "-f", "s16le", "/out.raw"],
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
      const output = volume.readFileSync("/out.raw") as Buffer;
      assert.equal(output.length, expected.length * 2);
      assert.deepEqual(expected.map((_, index) => output.readInt16LE(index * 2)), expected);
    });
  }
}
