import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

for (const complex of [false, true]) {
  for (const format of ["s24", "s32", "flt"] as const) {
    it(`earwax ${complex ? "graph" : "simple"}: ${format} converts to native PCM16 before convolution`, async () => {
      const channels = [0, 1].map(channel => Float64Array.from({ length: 300 }, (_, frame) =>
        (((frame * (channel ? 7919 : 3571)) % 65536 - 32768) + 0.75) / 32768));
      // Native signed PCM drops low bits; floating PCM rounds to the nearest integer.
      const narrowed = channels.map(channel => channel.map(sample =>
        Math.min(32767, format === "flt" ? Math.round(sample * 32768) : Math.floor(sample * 32768)) / 32768));
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/wide.wav", encodeWav({ sampleRate: 44100, channels }, {
        bitsPerSample: format === "s24" ? 24 : 32, float: format === "flt"
      }));
      volume.writeFileSync("/narrow.wav", encodeWav({ sampleRate: 44100, channels: narrowed }));
      for (const input of ["wide", "narrow"]) {
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-y", "-i", `/${input}.wav`, ...(complex
            ? ["-filter_complex", "[0:a]earwax[s]", "-map", "[s]"] : ["-af", "earwax"]),
          "-c:a", "pcm_s16le", `/${input}-out.wav`],
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
      }
      const decode = (name: string) => parseWav(volume.readFileSync(`/${name}-out.wav`) as Buffer)
        .tracks[0]!.decodedAudio!.channelData;
      assert.deepEqual(decode("wide"), decode("narrow"));
    });
  }
}
