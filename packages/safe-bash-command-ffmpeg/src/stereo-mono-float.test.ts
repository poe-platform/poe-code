import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Complete FFmpeg 7.0.2 reference outputs, including peaks above unity and rounding ties.
const floating = [0.25897181034088135, -0.5179651975631714, 0, 1.2947511672973633, -1.2947511672973633, 0.00023737104493193328];
const normalized = [0.1831207275390625, -0.3662567138671875, 0, 0.91552734375, -0.91552734375, 0.0001678466796875];
for (const [options, format, expected] of [
  [["-ac", "1"], "f32le", floating],
  [["-af", "aformat=sample_fmts=flt:channel_layouts=mono"], "f32le", floating],
  [["-af", "aformat=channel_layouts=mono:sample_fmts=flt"], "f32le", floating],
  [["-af", "aformat=sample_fmts=flt:channel_layouts=mono"], "s16le", [8486, -16973, 0, 32767, -32768, 8]],
  [["-ac", "1", "-rematrix_maxval", "1"], "f32le", normalized],
  [["-ac", "1"], "s16le", [6001, -12001, 0, 30000, -30000, 6]]
] as const) {
  it(`matches native stereo-to-mono gain: ${options.join(" ")} -f ${format}`, async () => {
    const pairs = [[12001, 0], [0, -24003], [10000, -10000], [30000, 30000], [-30000, -30000], [5, 6]];
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
      channels: [0, 1].map(channel => Float64Array.from(pairs, pair => pair[channel]! / 32768)) }));
    const output: Uint8Array[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-i", "/in.wav", ...options, "-f", format, "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write(data: Uint8Array) { output.push(data); } },
      stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    const bytes = Buffer.concat(output);
    const size = format === "f32le" ? 4 : 2;
    assert.equal(bytes.length, expected.length * size);
    assert.deepEqual(Array.from({ length: expected.length }, (_, i) =>
      format === "f32le" ? bytes.readFloatLE(i * size) : bytes.readInt16LE(i * size)), expected);
  });
}
