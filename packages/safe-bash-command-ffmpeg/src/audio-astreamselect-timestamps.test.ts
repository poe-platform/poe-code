import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: four 512-sample PCM16 packets at 8 kHz.
for (const [offset, selected, packets] of [
  [0, 0, [1, 2, 3, 4]],
  [0, 1, [1, 2, 3, 4]],
  [0.064, 0, [2, 3, 4]],
  [0.064, 1, [1, 2, 3]],
  [0.032, 0, [1, 2, 3, 4]],
  [0.032, 1, [1, 2, 3]],
  [0.096, 0, [2, 3, 4]],
  [0.096, 1, [1, 2]],
  [-0.064, 0, [1, 2, 3]],
  [-0.064, 1, [2, 3, 4]],
  [0.256, 0, []],
  [0.256, 1, []]
] as const) {
  for (const channels of [1, 2]) {
    for (const commonOffset of [0, 0.128]) {
      it(`synchronizes astreamselect map=${selected} with relative offset ${offset}, common offset ${commonOffset}, channels=${channels}`, async () => {
        const volume = Volume.fromJSON({});
        const steps = Float64Array.from({ length: 2048 }, (_, i) => (Math.floor(i / 512) + 1) * 1000 / 32768);
        const other = new Float64Array(2048).fill(-1000 / 32768);
        for (const [index, channel] of (selected === 0 ? [steps, other] : [other, steps]).entries()) {
          volume.writeFileSync(`/${index}.wav`, encodeWav({ sampleRate: 8000,
            channels: Array.from({ length: channels }, (_, index) => index === 0 ? channel : channel.map(value => -value)) }));
        }
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-y", "-v", "error", "-itsoffset", String(commonOffset), "-i", "/0.wav",
            "-itsoffset", String(commonOffset + offset), "-i", "/1.wav",
            "-filter_complex", `[0:a][1:a]astreamselect=map=${selected}[out]`, "-map", "[out]",
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
        assert.equal(audio.channels, channels);
        for (const [index, channel] of audio.channelData.entries()) {
          assert.equal(channel.length, packets.length * 512);
          assert.deepEqual(Array.from(channel, sample => sample * 32768),
            packets.flatMap(packet => Array(512).fill(packet * (index === 0 ? 1000 : -1000))));
        }
      });
    }
  }
}
