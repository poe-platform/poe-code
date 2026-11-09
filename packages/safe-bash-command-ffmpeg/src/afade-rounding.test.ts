import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg rounds sample options to nearest, with exact halves going to even.
for (const [fractional, rounded] of [[1.4, 1], [1.5, 2], [2.5, 2], [2.6, 3], [3.5, 4]] as const) {
  for (const option of ["ns", "nb_samples", "ss", "start_sample", "positional"] as const) {
    const start = option === "ss" || option === "start_sample";
    const filter = option === "positional" ? `afade=in:${fractional}:${fractional}`
      : start ? `afade=ns=4:${option}=${fractional}` : `afade=${option}=${fractional}`;
    for (const graph of [false, true]) {
      it(`${filter} rounds sample counts (${graph ? "graph" : "simple"})`, async () => {
        const fs = Volume.fromJSON({});
        fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [new Float64Array(10).fill(12000 / 32768)] }));
        const errors: Uint8Array[] = [];
        const result = await createFfmpegCommand().execute({
          args: ["-i", "/in.wav", ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-c:a", "pcm_s16le", "/out.wav"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
          stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write(b: Uint8Array) { errors.push(b); } }
        } as never);
        assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
        const audio = parseWav(fs.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
        const offset = start || option === "positional" ? rounded : 0;
        const length = start ? 4 : rounded;
        assert.deepEqual(Array.from(audio.channelData[0]!, sample => sample * 32768),
          Array.from({ length: 10 }, (_, i) => 12000 * Math.max(0, Math.min(1, (i - offset) / length))));
      });
    }
  }
}
