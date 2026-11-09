import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav, serializeWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: the first connected input selects join's format unless
// downstream volume requires floating point; channel mapping does not select it.
for (const reverse of [false, true]) {
  for (const swap of [false, true]) {
    for (const following of ["", ",areverse", ",volume=0.5", ",volume=0.5:precision=double",
      ",areverse,volume=0.5", ",volume=0.5:precision=fixed", ",volume=0.5:precision=0"]) {
      const gain = following.includes("volume") ? 0.5 : 1;
      const fixed = following.endsWith("fixed") || following.endsWith("precision=0");
      it(`join negotiates PCM16/float samples (reversed=${reverse}, swapped=${swap}, following=${following})`, async () => {
        const values = [0.111111, -0.222222, 1, -1, 0.5 / 32768, 1.5 / 32768, -0.5 / 32768, -1.5 / 32768];
        const rounded = [3641, -7282, 32767, -32768, 0, 2, 0, -2].map(value => value / 32768);
        const floats = Float64Array.from({ length: 4097 }, (_, i) => values[i % values.length]!);
        const integer = new Float64Array(floats.length + 1).fill(8000 / 32768);
        const doc = parseWav(encodeWav({ sampleRate: 8000, channels: [integer] }));
        const track = doc.tracks[0]!;
        const volume = Volume.fromJSON({});
        volume.writeFileSync("/integer.wav", serializeWav(doc, { audioCodec: "pcm_s16le" }));
        volume.writeFileSync("/float.wav", serializeWav({ ...doc, tracks: [{ ...track,
          decodedAudio: { ...track.decodedAudio!, channelData: [floats] }
        }] }, { audioCodec: "pcm_f32le" }));
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-y", "-v", "error", "-i", "/integer.wav", "-i", "/float.wav", "-filter_complex",
            `${reverse ? "[1:a][0:a]" : "[0:a][1:a]"}join=map=${swap ? "1.0-FL|0.0-FR" : "0.0-FL|1.0-FR"}${following}[out]`,
            "-map", "[out]", "-c:a", "pcm_f32le", "/out.wav"],
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
        assert.equal(audio.channels, 2);
        assert.equal(audio.channelMask ?? 3, 3);
        const expected = [Array.from(integer.subarray(0, floats.length)),
          Array.from(floats, (sample, i) => reverse || gain !== 1 && !fixed ? Math.fround(sample) : rounded[i % rounded.length]!)];
        if (reverse !== swap) expected.reverse();
        if (following.includes("areverse")) expected.forEach(channel => channel.reverse());
        assert.deepEqual(audio.channelData.map(channel => Array.from(channel)),
          expected.map(channel => channel.map(sample => Math.fround(fixed && !reverse
            ? Math.floor(sample * gain * 32768 + 0.5) / 32768 : sample * gain))));
      });
    }
  }
}
