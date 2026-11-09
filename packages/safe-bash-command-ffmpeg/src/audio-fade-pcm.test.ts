import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

// Exact signed PCM samples from native FFmpeg; rounding at WAV output is too late.
for (const [float, filter, expected] of [
  [false, "afade=ns=4", [0, -250, 500, -750, 1001, -1001]],
  [false, "afade=ns=4:silence=0.5", [500, -625, 750, -875, 1001, -1001]],
  [false, "afade=ns=4:silence=0.5,volume=4", [2000, -2500, 3000, -3500, 4004, -4004]],
  [false, "volume=1,afade=ns=4:silence=0.5,volume=4", [2002, -2502, 3003, -3504, 4004, -4004]],
  [true, "afade=ns=4:silence=0.5,volume=4", [2002, -2502, 3003, -3504, 4004, -4004]]
] as const) {
  for (const graph of [false, true]) it(`preserves ${float ? "float" : "PCM16"} precision: ${filter} (${graph ? "graph" : "simple"})`, async () => {
    const fs = Volume.fromJSON({});
    fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
      channels: [Float64Array.from([1001, -1001, 1001, -1001, 1001, -1001], value => value / 32768)]
    }, float ? { bitsPerSample: 32, float: true } : {}));
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-i", "/in.wav", ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-c:a", "pcm_s16le", "/out.wav"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
      stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write(b: Uint8Array) { errors.push(b); } }
    } as never);
    assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
    const audio = parseWav(fs.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
    assert.deepEqual(Array.from(audio.channelData[0]!, value => value * 32768), expected);
  });
}
