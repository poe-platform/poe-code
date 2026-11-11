import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

const samples = [-32768, -29341, -1025, -5, -3, -1, 0, 1, 3, 5, 1025, 29341, 32767];
// Native FFmpeg PCM16 output, including rounding ties in both directions.
const half = [-16384, -14670, -512, -2, -2, 0, 0, 0, 2, 2, 512, 14670, 16384];
for (const [filter, expected] of [
  ["volume=", samples],
  ["volume=0.5:", half],
  ["volume=0.5:eval=frame:", half],
  ["volume", samples],
  ["volume=0.5", half],
  ["volume=0.5:eval=frame", half],
  ["volume=volume=0.5:", half],
  ["volume=precision=float:", samples],
  ["volume=:", null],
  ["volume=0.5::", null],
  ["volume=0.5::eval=frame", null],
  ["volume=volume=", null],
  ["volume=0.5:precision=", null],
  ["volume=0.5:eval=", null]
] as const) {
  it(`handles empty options in ${filter}`, async () => {
    const fs = Volume.fromJSON({ "/out.wav": "KEEP" });
    fs.writeFileSync("/in.wav", encodeWav({
      sampleRate: 8000, channels: [Float64Array.from(samples, value => value / 32768)]
    }));
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-v", "error", "-i", "/in.wav", "-af", filter, "-c:a", "pcm_s16le", "/out.wav"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(p: string) { return fs.readFileSync(p); },
        async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); },
        async stat(p: string) { return fs.statSync(p); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(b: Uint8Array) { errors.push(b); } }
    } as never);
    assert.equal(result.exitCode, expected === null ? 234 : 0, Buffer.concat(errors).toString());
    if (expected === null) {
      assert.equal(fs.readFileSync("/out.wav", "utf8"), "KEEP");
    } else {
      const actual = parseWav(fs.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!.channelData[0]!;
      assert.deepEqual(Array.from(actual, value => value * 32768), expected);
    }
  });
}
