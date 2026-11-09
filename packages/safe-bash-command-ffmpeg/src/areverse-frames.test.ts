import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg emits the final short input frame first after areverse.
for (const length of [1124, 1536]) {
  for (const reversals of [0, 1, 2]) {
    for (const expression of ["1", "n", "t"]) {
      it(`evaluates volume=${expression} after ${reversals} reversals of ${length} samples`, async () => {
        const fs = Volume.fromJSON({});
        fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
          channels: [Float64Array.from({ length }, (_, i) => (100 + i) / 32768)] }));
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-i", "/in.wav", "-af",
            [...Array<string>(reversals).fill("areverse"), `volume=${expression}:eval=frame`].join(","),
            "-c:a", "pcm_s16le", "/out.wav"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: { async readFile(p: string) { return fs.readFileSync(p); },
            async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); },
            async stat(p: string) { return fs.statSync(p); } },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(b: Uint8Array) { stderr += new TextDecoder().decode(b); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        const audio = parseWav(fs.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
        assert.equal(audio.sampleRate, 8000);
        const frames = length === 1124 ? [512, 512, 100] : [512, 512, 512];
        if (reversals % 2) frames.reverse();
        let start = 0;
        const expected = frames.flatMap((count, n) => {
          const gain = expression === "n" ? n : expression === "t" ? start / 8000 : 1;
          const values = Array.from({ length: count }, (_, i) => {
            const sample = 100 + (reversals % 2 ? length - 1 - start - i : start + i);
            const scaled = Math.fround(Math.fround(gain) * (sample / 32768)) * 32768;
            // Native float-to-PCM conversion rounds halfway values to even.
            return scaled - Math.floor(scaled) === 0.5 ? Math.round(scaled / 2) * 2 : Math.round(scaled);
          });
          start += count;
          return values;
        });
        const actual = Array.from(audio.channelData[0]!, value => value * 32768);
        assert.equal(actual.length, length);
        if (expression === "t") {
          // Native PCM conversion can differ by one LSB across platforms.
          for (const [i, value] of actual.entries()) assert.ok(Math.abs(value - expected[i]!) <= 1, `sample ${i}`);
          if (length === 1124 && reversals === 1) assert.equal(actual[100], 14);
        } else assert.deepEqual(actual, expected);
      });
    }
  }
}
