import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg leaves these counters as NaN, including during frame evaluation.
for (const counter of ["nb_samples", "nb_consumed_samples"]) {
  for (const [expression, gain] of [
    [counter, 0], [`${counter}/1024`, 0], [`1+${counter}`, 0],
    [`'if(isnan(${counter}),0.5,1)'`, 0.5],
    [`${counter}:eval=once`, null], ['unknown_counter', null], ['1+', null],
    ['.', null], ['1/0', 0], ['0.5', 0.5], ['sample_rate/16000', 0.5]
  ] as const) {
    it(`matches native PCM for volume=${expression}:eval=frame`, async () => {
      const samples = Float64Array.from([[0, 600], [400, 1600], [12000, 1600], [0, 800], [4000, 1600], [0, 1000]]
        .flatMap(([amplitude, count]) => Array.from({ length: count! }, (_, i) => amplitude! * (i % 2 ? -1 : 1) / 32768)));
      const fs = Volume.fromJSON({ "/out.wav": "keep" });
      fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [samples] }));
      const errors: Uint8Array[] = [];
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-i", "/in.wav", "-af", `volume=eval=frame:volume=${expression}`, "-c:a", "pcm_s16le", "/out.wav"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
        stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write(b: Uint8Array) { errors.push(b); } }
      } as never);
      if (gain === null) {
        assert.equal(result.exitCode, 234);
        assert.equal(fs.readFileSync("/out.wav", "utf8"), "keep");
        return;
      }
      assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
      const actual = parseWav(fs.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!.channelData[0]!;
      assert.deepEqual(Array.from(actual, value => Math.round(value * 32768)), Array.from(samples, value => Math.round(value * gain * 32768) || 0));
    });
  }
}
