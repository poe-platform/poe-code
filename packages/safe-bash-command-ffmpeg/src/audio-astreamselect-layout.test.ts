import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

const mono = [[8000, -8000, 32767, -32768, 1, -1, 3, -3]];
const stereo = [
  [-4000, 32767, -32768, 1, -1, 12345, 3, -3],
  [8000, 32767, -32768, 0, 0, -5432, 0, 0]
];
// FFmpeg 7.0.2 PCM16 results, including Q15 gain and signed half-sample rounding.
const downmixed = [[2000, 32767, -32768, 1, 0, 3457, 2, -1]];
const upmixed = Array.from({ length: 2 }, () => [5657, -5657, 23169, -23170, 1, -1, 2, -2]);

for (const [first, second, remixed] of [[mono, stereo, downmixed], [stereo, mono, upmixed]] as const) {
  for (const selected of [0, 1]) {
    it(`negotiates ${first.length} channels before selecting input ${selected}`, async () => {
      const volume = Volume.fromJSON({});
      for (const [index, channels] of [first, second].entries()) {
        volume.writeFileSync(`/${index}.wav`, encodeWav({ sampleRate: 8000,
          channels: channels.map(pattern => Float64Array.from({ length: 2048 },
            (_, frame) => pattern[frame % pattern.length]! / 32768)) }));
      }
      const errors: Uint8Array[] = [];
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-i", "/0.wav", "-i", "/1.wav", "-filter_complex",
          `[0:a][1:a]astreamselect=inputs=2:map=${selected}[o]`, "-map", "[o]", "-c:a", "pcm_s16le", "/out.wav"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
      const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
      const expected = selected === 0 ? first : remixed;
      assert.equal(audio.channels, expected.length);
      assert.equal(audio.sampleRate, 8000);
      for (const [index, channel] of audio.channelData.entries()) {
        assert.equal(channel.length, 2048);
        assert.deepEqual(Array.from(channel, sample => sample * 32768),
          Array.from({ length: 2048 }, (_, frame) => expected[index]![frame % 8]));
      }
    });
  }
}
