import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

const samples = [6000, -2000, 3000, 7000, -12000, 4000, 8000, 12000];
// Native FFmpeg mono-to-stereo negotiation applies sqrt(1/2) to each channel.
const stereo = [4243, -1414, 2121, 4950, -8485, 2828, 5657, 8485];
for (const raw of [false, true]) for (const complex of [false, true]) {
  for (const filter of ["anull", "extrastereo", "extrastereo=m=1", "extrastereo=m=0", "stereotools", "stereotools=muter=1", "extrastereo=m=1,stereotools=muter=1"]) {
    it(`negotiates mono for ${filter} (${raw ? "raw" : "wav"}, ${complex ? "graph" : "simple"})`, async () => {
      const volume = Volume.fromJSON({});
      const pcm = Buffer.alloc(samples.length * 2);
      samples.forEach((sample, index) => pcm.writeInt16LE(sample, index * 2));
      volume.writeFileSync("/input", raw ? pcm : encodeWav({ sampleRate: 8000,
        channels: [Float64Array.from(samples, sample => sample / 32768)] }));
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", ...(raw ? ["-f", "s16le", "-ar", "8000", "-ac", "1"] : []),
          "-i", "/input", ...(complex ? ["-filter_complex", `[0:a]${filter}[s]`, "-map", "[s]"] : ["-af", filter]), "/out.wav"],
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
      const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
      assert.equal(audio.channels, filter === "anull" ? 1 : 2);
      assert.equal(audio.sampleRate, 8000);
      assert.deepEqual(audio.channelData.map(channel => Array.from(channel, sample => sample * 32768)),
        filter === "anull" ? [samples] : [stereo, filter.includes("muter=1") ? samples.map(() => 0) : stereo]);
    });
  }
}
