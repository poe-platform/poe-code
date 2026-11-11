import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 routes stereo to FL/FR and leaves other speakers silent.
const left = [1000, 2000, 3000, 4000, 5000, 6000];
const right = left.map(sample => -sample);
const cases = [
  ["5.1", 6, 0x3f], ["quad", 4, 0x33],
  ["5.1|stereo", 2, 3], ["stereo|quad", 2, 3], ["mono|stereo", 2, 3],
  ["quad|stereo", 2, 3], ["stereo|5.1", 2, 3],
  ["5.1|bad", 0, 0], ["quad|", 0, 0]
] as const;

for (const graph of [false, true]) {
  for (const key of ["channel_layouts", "cl"]) {
    for (const [layout, channels, mask] of cases) {
      for (const autoConvert of [true, false]) {
        it(`negotiates stereo aformat ${key}=${layout} (graph=${graph}, autoConvert=${autoConvert})`, async () => {
          const output = graph ? "/out.wav" : "/out.pcm";
          const volume = Volume.fromJSON({ [output]: "KEEP" });
          volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
            channels: [left, right].map(samples => Float64Array.from(samples, sample => sample / 32768)) }));
          let stderr = "";
          const filter = `aformat=${key}=${layout}${graph && channels > 2 ? `,aformat=cl=stereo|${layout}` : ""}`;
          const result = await createFfmpegCommand().execute({
            args: ["-y", "-v", "error", ...(!autoConvert ? ["-noauto_conversion_filters"] : []), "-i", "/in.wav",
              ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
              "-f", graph ? "wav" : "s16le", output],
            cwd: "/", env: {}, signal: new AbortController().signal,
            fs: {
              async readFile(path: string) { return volume.readFileSync(path); },
              async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
              async stat(path: string) { return volume.statSync(path); }
            },
            stdin: (async function* () {})(), stdout: { async write() {} },
            stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
          } as never);
          if (channels === 0) {
            assert.equal(result.exitCode, 234);
            assert.match(stderr, /aformat: unsupported channel layout/);
            assert.equal(volume.readFileSync(output, "utf8"), "KEEP");
            return;
          }
          if (!autoConvert && channels !== 2) {
            assert.notEqual(result.exitCode, 0);
            assert.match(stderr, /automatic conversion is disabled/);
            assert.equal(volume.readFileSync(output, "utf8"), "KEEP");
            return;
          }
          assert.equal(result.exitCode, 0, stderr);
          const expected = Buffer.alloc(left.length * channels * 2);
          for (let frame = 0; frame < left.length; frame++) {
            expected.writeInt16LE(left[frame]!, frame * channels * 2);
            expected.writeInt16LE(right[frame]!, frame * channels * 2 + 2);
          }
          if (graph) {
            const audio = parseWav(volume.readFileSync(output) as Buffer).tracks[0]!.decodedAudio!;
            assert.equal(audio.channels, channels);
            assert.equal(audio.channelMask || 3, mask);
            assert.equal(audio.sampleRate, 8000);
            assert.deepEqual(audio.channelData.map(samples => Array.from(samples, sample => sample * 32768)),
              [left, right, ...Array.from({ length: channels - 2 }, () => left.map(() => 0))]);
          } else {
            assert.deepEqual(volume.readFileSync(output), expected);
          }
        });
      }
    }
  }
}
