import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { compensateAudioDelay } from "./audio-compensationdelay.js";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: mono PCM16 WAV, 8 kHz, samples 256..383.
// Audio width is zero; the WAV packet starts at byte 44.
for (const [enable, delayed] of [
  ["h", false],
  ["eq(h,0)", true],
  ["PI", true],
  ["E", true],
  ["eq(PI,acos(-1))", true],
  ["eq(E,exp(1))", true],
  ["isnan(w)", false],
  ["eq(w,0)", true],
  ["gte(pos,0)", true],
  ["eq(pos,44)", true],
  ["gt(pos,44)", false],
  ["gte(t,0)", true]
] as const) {
  for (const graph of [false, true]) {
    it(`compensationdelay enable=${enable} emits native PCM (${graph ? "graph" : "simple"})`, async () => {
      const input = encodeWav({ sampleRate: 8000, channels: [
        Float64Array.from({ length: 128 }, (_, i) => (256 + i) / 32768)
      ] });
      const volume = Volume.fromJSON({ "/in.wav": Buffer.from(input) });
      const filter = `compensationdelay=m=1:enable='${enable}'`;
      const output: Buffer[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-i", "/in.wav", ...(graph
          ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-f", "s16le", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { output.push(Buffer.from(bytes)); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      const pcm = Buffer.concat(output);
      const expected = Buffer.alloc(256);
      for (let i = 0; i < 128; i++) {
        expected.writeInt16LE(delayed ? (i < 23 ? 0 : 256 + i - 23) : 256 + i, i * 2);
      }
      assert.deepEqual(pcm, expected);
    });
  }
}

for (const pos of [undefined, -1]) {
  it(`treats unavailable packet position ${pos} as NaN`, async () => {
    const channels = [Float64Array.from({ length: 128 }, (_, i) => (256 + i) / 32768)];
    const frames = [{ start: 0, end: 128, pts: 0, ...(pos === undefined ? {} : { pos }) }];
    const output = await compensateAudioDelay(channels, 8000,
      "compensationdelay=m=1:enable=not(isnan(pos))", frames, [], new MediaBudgetTracker());
    assert.deepEqual(output, channels);
  });
}
