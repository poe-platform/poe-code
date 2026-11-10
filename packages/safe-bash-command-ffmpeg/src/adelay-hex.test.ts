import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

const channels = [[1000, 2000, 3000, 4000], [-4000, -3000, -2000, -1000]];

// Native FFmpeg 7.0.2 offsets for this four-frame, 8 kHz stereo PCM16 input.
for (const [filter, offsets] of [
  ["adelay=0x1p-2|1S", [2, 1]],
  ["adelay=0.25|1S", [2, 1]],
  ["adelay=0X1", [8, 0]],
  ["adelay=0x.8", [4, 0]],
  ["adelay=0", [0, 0]],
  ["adelay=+0X.8P+1|1S", [8, 1]],
  ["adelay=0x1p-2:all=1", [2, 2]]
] as const) {
  for (const graph of [false, true]) {
    it(`${filter} preserves native channel delays (${graph ? "graph" : "simple"})`, async () => {
      const volume = new Volume();
      volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
        channels: channels.map(channel => Float64Array.from(channel, value => value / 32768)) }));
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-i", "/in.wav", ...(graph
          ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-c:a", "pcm_s16le", "/out.wav"],
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
      assert.equal(audio.sampleRate, 8000);
      assert.equal(audio.channelData.length, 2);
      for (const [channel, samples] of channels.entries()) {
        assert.deepEqual(Array.from(audio.channelData[channel]!, value => Math.round(value * 32768)), [
          ...new Array<number>(offsets[channel]!).fill(0), ...samples,
          ...new Array<number>(Math.max(...offsets) - offsets[channel]!).fill(0)
        ]);
      }
    });
  }
}
