import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

const input = [-32768, -29341, -1025, -5, -3, -1, 0, 1, 3, 5, 1025, 29341, 32767];
// Native FFmpeg PCM16 output, including ties rounded to even at half gain.
const half = [-16384, -14670, -512, -2, -2, 0, 0, 0, 2, 2, 512, 14670, 16384];

for (const [options, expected] of [
  ["enable=eq(w\\,0)", half],
  ["enable=eq(h\\,0)", half],
  ["enable=isnan(w)", input],
  ["enable=isnan(h)", input],
  ["eval=frame:enable=1", half],
  ["enable=0", input]
] as const) {
  for (const graph of [false, true]) it(`volume ${options} matches native audio dimensions (${graph ? "graph" : "simple"})`, async () => {
    const fs = Volume.fromJSON({ "/out.wav": "KEEP" });
    fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [Float64Array.from(input, sample => sample / 32768)] }));
    const errors: Uint8Array[] = [];
    const filter = `volume=0.5:${options}`;
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-v", "error", "-i", "/in.wav", ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-c:a", "pcm_s16le", "/out.wav"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
      stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write(b: Uint8Array) { errors.push(b); } }
    } as never);
    assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
    const samples = parseWav(fs.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!.channelData[0]!;
    assert.deepEqual(Array.from(samples, sample => sample * 32768), expected);
  });
}
