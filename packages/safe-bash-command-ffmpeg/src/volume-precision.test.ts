import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

const samples = [-32768, -30001, -20001, -5, -3, -1, 0, 1, 3, 5, 20001, 30001, 32767];
// Native FFmpeg PCM16 output, including values immediately above rounding ties.
for (const [filter, expected] of [
  ["volume=0.5000000001:precision=double", [-16384, -15001, -10001, -3, -2, -1, 0, 1, 2, 3, 10001, 15001, 16384]],
  ["volume=0.5000000001:precision=2", [-16384, -15001, -10001, -3, -2, -1, 0, 1, 2, 3, 10001, 15001, 16384]],
  ["volume=0.5000000001:precision=float", [-16384, -15000, -10000, -2, -2, 0, 0, 0, 2, 2, 10000, 15000, 16384]],
  ["volume=0.5:precision=double", [-16384, -15000, -10000, -2, -2, 0, 0, 0, 2, 2, 10000, 15000, 16384]],
  ["volume=1:precision=double", samples],
  ["volume=2:precision=double", [-32768, -32768, -32768, -10, -6, -2, 0, 2, 6, 10, 32767, 32767, 32767]]
] as const) {
  it(`preserves PCM16 rounding for ${filter}`, async () => {
    const fs = Volume.fromJSON({});
    fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [Float64Array.from(samples, value => value / 32768)] }));
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-i", "/in.wav", "-af", filter, "-c:a", "pcm_s16le", "/out.wav"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
      stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write(b: Uint8Array) { errors.push(b); } }
    } as never);
    assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
    const actual = parseWav(fs.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!.channelData[0]!;
    assert.deepEqual(Array.from(actual, value => value * 32768), expected);
  });
}
