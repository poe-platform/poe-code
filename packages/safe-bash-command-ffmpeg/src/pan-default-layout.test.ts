import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav, serializeWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

// FFmpeg defaults to 4.0 (FC + BC), not quad, for classic four-channel PCM WAV.
const layouts = [
  ["FC"],
  ["FL", "FR"],
  ["FL", "FR", "LFE"],
  ["FL", "FR", "FC", "BC"],
  ["FL", "FR", "FC", "BL", "BR"],
  ["FL", "FR", "FC", "LFE", "BL", "BR"],
  ["FL", "FR", "FC", "LFE", "BC", "SL", "SR"],
  ["FL", "FR", "FC", "LFE", "BL", "BR", "SL", "SR"]
];

for (const { names, mask } of [
  ...layouts.map(names => ({ names, mask: undefined })),
  { names: ["FL", "FR", "BL", "BR"], mask: 0x33 },
  { names: ["FL", "FR", "FC", "LFE", "SL", "SR"], mask: 0x60f }
]) {
  for (const complex of [false, true]) {
    it(`resolves ${names.length}-channel pan speakers with ${mask === undefined ? "no mask" : `mask ${mask}`} (${complex ? "graph" : "simple"})`, async () => {
      const samples = names.map((_, channel) => Array.from({ length: 8 }, (_, frame) => channel * 1000 + 100 + frame));
      let wav = encodeWav({ sampleRate: 8000,
        channels: samples.map(channel => Float64Array.from(channel, sample => sample / 32768)) });
      if (mask !== undefined) {
        const doc = parseWav(wav);
        wav = serializeWav({ ...doc, tracks: doc.tracks.map(track => ({ ...track,
          decodedAudio: { ...track.decodedAudio!, channelMask: mask }
        })) }, { audioCodec: "pcm_s16le" });
      }
      assert.equal(parseWav(wav).tracks[0]!.decodedAudio!.channelMask, mask);
      const volume = Volume.fromJSON({ "/in.wav": Buffer.from(wav), "/out.wav": "KEEP" });
      for (const speaker of [...names, ...names.map((_, index) => `c${index}`), "TBR"]) {
        const expression = `pan=mono|c0=${speaker}`;
        const filters = complex
          ? ["-filter_complex", `[0:a]${expression}[s]`, "-map", "[s]"]
          : ["-af", expression];
        let stderr = "";
        volume.writeFileSync("/out.wav", "KEEP");
        const result = await createFfmpegCommand().execute({
          args: ["-y", "-v", "error", "-i", "/in.wav", ...filters, "-c:a", "pcm_s16le", "/out.wav"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, `${speaker}: ${stderr}`);
        const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
        const index = speaker.startsWith("c") ? Number(speaker.slice(1)) : names.indexOf(speaker);
        assert.equal(audio.channels, 1);
        assert.equal(audio.sampleRate, 8000);
        assert.deepEqual(Array.from(audio.channelData[0]!, sample => sample * 32768),
          samples[index] ?? Array(8).fill(0), speaker);
      }
      assert.deepEqual(volume.readFileSync("/in.wav"), Buffer.from(wav));
    });
  }
}
