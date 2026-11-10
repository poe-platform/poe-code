import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createCommandArguments } from "safe-bash-contracts";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 raw PCM16 references for 24-bit stereo input.
for (const complex of [false, true]) {
  for (const format of ["s32", "s32p"]) {
    for (const earwax of [false, true]) {
      it(`${format}${earwax ? ",earwax" : ""} matches native PCM16 (${complex ? "graph" : "simple"})`, async () => {
        const channels = [0, 1].map(channel => Float64Array.from({ length: 1024 }, (_, frame) =>
          ((frame * 135791 + channel * 42163) % 16000000 - 8000000) / 8388608));
        const volume = Volume.fromJSON({ "/out.raw": "KEEP" });
        volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 44100, channels }, { bitsPerSample: 24 }));
        const filter = `aformat=sample_fmts=${format}${earwax ? ",earwax" : ""}`;
        const argumentValues = createCommandArguments(["-hide_banner", "-loglevel", "error", "-y", "-i", "/in.wav", ...(complex
          ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
        "-f", "s16le", "/out.raw"]);
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: argumentValues.args, argumentValues,
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
        const output = volume.readFileSync("/out.raw") as Buffer;
        assert.equal(output.length, 4096);
        assert.equal(createHash("sha256").update(output).digest("hex"), earwax
          ? "b309094b559114a1096992eb59576c9a73af5d53a58321743206697997785a46"
          : "43ed37c6896c0f3353c4d1f4e359dd31118380918861e909ad0a4370f8538df0");
      });
    }
  }
}

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
