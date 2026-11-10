import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

const samples = [-32768, -29341, -1025, -5, -3, -1, 0, 1, 3, 5, 1025, 29341, 32767];
// Pinned FFmpeg 7.0.2-static Linux x86-64 results, including signed overflow.
for (const [filter, expected] of [
  ["volume=65537:precision=fixed", [32767, -32768, -32768, -32768, -32768, -32768, 0, 32767, 32767, 32767, 32767, 32767, 32767]],
  ["volume=100000:precision=fixed", [32767, 32767, -32768, -32768, -32768, -32768, 0, 32767, 32767, 32767, 32767, -32768, -32768]],
  ["volume=65536:precision=fixed", [-32768, -32768, -32768, -32768, -32768, -32768, 0, 32767, 32767, 32767, 32767, 32767, 32767]],
  ["volume=100000:precision=float", [32767, 32767, -32768, -32768, -32768, -32768, 0, 32767, 32767, 32767, 32767, -32768, -32768]]
] as const) {
  it(`preserves PCM16 rounding for ${filter}`, async () => {
    const fs = Volume.fromJSON({ "/out.wav": "KEEP" });
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
