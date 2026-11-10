import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

const samples = [-32768, -29341, -1025, -5, -3, -1, 0, 1, 3, 5, 1025, 29341, 32767];
// Native FFmpeg PCM16 output after conversion between volume stages.
for (const [filter, expected] of [
  ["volume=0.5:precision=float,volume=2:precision=fixed", [-32768, -29340, -1024, -4, -4, 0, 0, 0, 4, 4, 1024, 29340, 32767]],
  ["volume=0.5:precision=double,volume=2:precision=fixed", [-32768, -29340, -1024, -4, -4, 0, 0, 0, 4, 4, 1024, 29340, 32767]],
  ["volume=0.5:precision=fixed,volume=2:precision=fixed", [-32768, -29340, -1024, -4, -2, 0, 0, 2, 4, 6, 1026, 29342, 32767]],
  ["volume=0.5:precision=float,volume=2:precision=float", samples],
] as const) {
  for (const graph of [false, true]) {
    it(`preserves PCM16 rounding for ${filter} (${graph ? "graph" : "simple"})`, async () => {
      const fs = Volume.fromJSON({ "/out.wav": "KEEP" });
      fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [Float64Array.from(samples, value => value / 32768)] }));
      const errors: Uint8Array[] = [];
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-i", "/in.wav", ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-c:a", "pcm_s16le", "/out.wav"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
        stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write(b: Uint8Array) { errors.push(b); } }
      } as never);
      assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
      const actual = parseWav(fs.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!.channelData[0]!;
      assert.deepEqual(Array.from(actual, value => value * 32768), expected);
    });
  }
}
