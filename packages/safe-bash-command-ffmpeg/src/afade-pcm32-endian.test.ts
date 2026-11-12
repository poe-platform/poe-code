import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Complete native FFmpeg 7.0.2 output at 8 kHz, including the 1/3-gain
// PCM32 sample that must truncate to 0x014dd3ff instead of rounding up.
for (const [format, input, filter, expected] of [
  ["s32be", "ff9bffff03e97bff03ea7bff03eb7bff", "afade=ns=3", "00000000014dd3ff029c52aa03eb7bff"],
  ["s32le", "ffff9bffff7be903ff7bea03ff7beb03", "afade=ns=3", "00000000ffd34d01aa529c02ff7beb03"],
  ["s32be", "ff9bffff03e97bff03ea7bff03eb7bff", "aformat=sample_fmts=s32,afade=ns=3", "00000000014dd3ff029c52aa03eb7bff"],
  ["s32be", "ff9bffff03e97bff03ea7bff03eb7bff", "anull", "ff9bffff03e97bff03ea7bff03eb7bff"]
] as const) {
  for (const graph of [false, true]) it(`${filter} matches native ${format} bytes (graph=${graph})`, async () => {
    const fs = Volume.fromJSON({ "/in.raw": Buffer.from(input, "hex") });
    const output: Uint8Array[] = [];
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-f", format, "-ar", "8000", "-ac", "1", "-i", "/in.raw",
        ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
        "-f", format, "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return fs.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
        async stat(path: string) { return fs.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
      stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
    assert.equal(Buffer.concat(errors).toString(), "");
    assert.equal(Buffer.concat(output).toString("hex"), expected);
  });
}
