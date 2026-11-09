import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";
import reference from "./dialoguenhance-cancellation-pcm.json" with { type: "json" };

// FFmpeg 7.0.2 x86-64 default CPU kernels; PCM16 right = -left + offset.
for (const offset of [0, 1]) {
  for (const complex of [false, true]) {
    it(`extracts the full dialogue center for cancelling stereo (offset=${offset}, graph=${complex})`, async () => {
      const left = Buffer.from(reference.left, "base64");
      const channels = [0, 1].map(c => Float64Array.from({ length: reference.frames }, (_, i) =>
        (c === 0 ? left.readInt16LE(i * 2) : -left.readInt16LE(i * 2) + offset) / 32768));
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.wav", encodeWav({ sampleRate: reference.sampleRate, channels }));
      let stderr = "";
      const filters = complex ? ["-filter_complex", "[0:a]dialoguenhance[s]", "-map", "[s]"] : ["-af", "dialoguenhance"];
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-i", "/in.wav", ...filters, "-c:a", "pcm_s16le", "/out.wav"],
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
      assert.equal(audio.channels, 3);
      assert.equal(audio.sampleRate, reference.sampleRate);
      const center = Buffer.from(reference.center, "base64");
      for (const channel of audio.channelData) assert.equal(channel.length, reference.frames);
      for (let i = 0; i < reference.frames; i++) {
        for (let c = 0; c < 2; c++) assert.equal(audio.channelData[c]![i]! * 32768, i < 1536 ? 0 : channels[c]![i - 1536]! * 32768);
        const expected = offset === 0 ? 0 : center.readInt16LE(i * 2);
        assert.equal(audio.channelData[2]![i]! * 32768, expected,
          `center frame ${i}: ${audio.channelData[2]![i]! * 32768} vs ${expected}`);
      }
      assert.equal(audio.channelData[2]![2801]! * 32768, offset === 0 ? 0 : 517);
    });
  }
}
