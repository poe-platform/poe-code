import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

// 8 kHz mono PCM16 ramp, matching the native FFmpeg reproduction.
for (const [expression, prefix, limit, count, frames] of [
  ["N", "", "0.1", 800, undefined],
  ["NB_CONSUMED_SAMPLES", "", "0.1", 800, undefined],
  ["PTS", "", "0.1", 800, undefined],
  ["T/TB", "", "0.1", 800, undefined],
  ["NB_SAMPLES", "asetnsamples=n=1024:p=0,", undefined, 4800, [[1024, 1024], [1024, 1024], [1024, 1024], [1024, 1024], [704, 704]]],
  ["S", "asetnsamples=n=1024:p=0,", undefined, 4800, [[1024, 1024], [1024, 1024], [1024, 1024], [1024, 1024], [704, 704]]],
  ["T/TB", "asetnsamples=n=1024:p=0,asetpts=PTS+4000,", undefined, 4800, [[4000, 1024], [5024, 1024], [6048, 1024], [7072, 1024], [8096, 704]]],
  ["NB_CONSUMED_SAMPLES", "asetnsamples=n=1024:p=0,asetpts=PTS+4000,", undefined, 4800, [[0, 1024], [1024, 1024], [2048, 1024], [3072, 1024], [4096, 704]]],
  ...["T/TB", "NB_CONSUMED_SAMPLES", "S"].map(expression =>
    [expression, "atrim=start_sample=4800,", undefined, 0, []] as const)
] as const) {
  it(`asetpts=${expression} after ${prefix || "input"} with limit ${limit} resolves native audio variables`, async () => {
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
      channels: [Float64Array.from({ length: 4800 }, (_, i) => (i + 1) / 32768)] }));
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "info", "-i", "/in.wav", "-af", `${prefix}asetpts=${expression},ashowinfo`,
        ...(limit ? ["-t", limit] : []), "-c:a", "pcm_s16le", "/out.wav"],
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
    assert.deepEqual(Array.from(samples, sample => Math.round(sample * 32768)),
      Array.from({ length: count }, (_, i) => i + 1));
    if (frames) {
      const actualFrames = stderr.split("\n").filter(line => line.includes("nb_samples:")).map(line => {
        const fields = line.split(" ");
        return [Number(fields.find(field => field.startsWith("pts:"))!.slice(4)),
          Number(fields.find(field => field.startsWith("nb_samples:"))!.slice(11))];
      });
      assert.deepEqual(actualFrames, frames);
    }
  });
}
