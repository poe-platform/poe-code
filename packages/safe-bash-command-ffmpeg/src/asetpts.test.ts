import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg: 8 kHz mono PCM16, with each sample equal to its index.
const cases: [string | undefined, string | undefined, number, (number[] | undefined)?, number?][] = [
  [undefined, undefined, 16000],
  [undefined, "1", 8000],
  ["asetpts=PTS-STARTPTS", undefined, 16000],
  ["asetpts=PTS+0.5/TB", undefined, 16000],
  ["asetpts=PTS+0.5/TB", "1", 4096],
  ["asetpts=PTS-0.5/TB", "1", 8000],
  ["asetpts=PTS+0.5/TB,asetpts=PTS-STARTPTS", "1", 8000],
  ["asetpts=expr=PTS+1/TB", "1", 0],
  ["asetpts=PTS/2", undefined, 4800, undefined, 4800],
  ["asetpts=NB_SAMPLES", undefined, 4800, undefined, 4800],
  ["asetpts=PTS", "0.1", 800, undefined, 4800],
  ["asetpts=PTS/2", "0.1", 1344, [
    ...Array.from({ length: 1312 }, (_, i) => i),
    ...Array.from({ length: 32 }, (_, i) => 1536 + i)
  ], 4800],
  ["asetpts=NB_SAMPLES", "0.1", 4800, undefined, 4800]
];
for (const [filter, limit, count, expected, inputLength = 16000] of cases) {
  for (const option of limit ? ["-t", "-to"] : ["-t"]) {
    it(`${filter ?? "unfiltered"} with ${option} ${limit} preserves ${count} ramp samples`, async () => {
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
        channels: [Float64Array.from({ length: inputLength }, (_, i) => i / 32768)] }));
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-i", "/in.wav", ...(filter ? ["-af", filter] : []),
          ...(limit ? [option, limit] : []), "-c:a", "pcm_s16le", "/out.wav"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      const samples = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!.channelData[0]!;
      assert.equal(samples.length, count);
      assert.deepEqual(Array.from(samples, sample => Math.round(sample * 32768)), expected ?? Array.from({ length: count }, (_, i) => i));
    });
  }
}
