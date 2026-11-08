import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg: 2 seconds of 8 kHz mono PCM16, with each sample equal to its index.
for (const [filter, limit, count] of [
  [undefined, undefined, 16000],
  [undefined, "1", 8000],
  ["asetpts=PTS-STARTPTS", undefined, 16000],
  ["asetpts=PTS+0.5/TB", undefined, 16000],
  ["asetpts=PTS+0.5/TB", "1", 4096],
  ["asetpts=PTS-0.5/TB", "1", 8000],
  ["asetpts=PTS+0.5/TB,asetpts=PTS-STARTPTS", "1", 8000],
  ["asetpts=expr=PTS+1/TB", "1", 0]
] as const) {
  for (const option of limit ? ["-t", "-to"] : ["-t"]) {
    it(`${filter ?? "unfiltered"} with ${option} ${limit} preserves ${count} ramp samples`, async () => {
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
        channels: [Float64Array.from({ length: 16000 }, (_, i) => i / 32768)] }));
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
      assert.deepEqual(Array.from(samples, sample => Math.round(sample * 32768)), Array.from({ length: count }, (_, i) => i));
    });
  }
}
