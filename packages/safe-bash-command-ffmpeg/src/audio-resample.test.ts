import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg startup/flush counts for constant mono PCM16 at 8 kHz.
for (const [rate, cases] of [
  [16000, [[1, 0], [8, 0], [5, 0], [20, 0], [21, 0], [22, 34], [23, 38], [25, 44], [32, 64], [40, 80]]],
  [4000, [[32, 0], [44, 0], [45, 18], [48, 20], [64, 32], [160, 80]]],
  [44100, [[20, 0], [22, 94], [25, 122], [32, 177]]],
  [8000, [[5, 5], [20, 20], [32, 32]]]
] as const) {
  for (const [length, expected] of cases) for (const format of ["pcm", "wav"]) {
    it(`flushes ${length} ${format} samples from 8000 to ${rate} Hz as ${expected} samples`, async () => {
      const pcm = Buffer.alloc(length * 2);
      for (let i = 0; i < length; i++) pcm.writeInt16LE(1000, i * 2);
      const volume = Volume.fromJSON({});
      volume.writeFileSync(`/in.${format}`, format === "pcm" ? pcm
        : encodeWav({ sampleRate: 8000, channels: [new Float64Array(length).fill(1000 / 32768)] }));
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: [...(format === "pcm" ? ["-f", "s16le", "-ar", "8000", "-ac", "1"] : []),
          "-i", `/in.${format}`, "-ar", String(rate), "-c:a", "pcm_s16le",
          "-f", format === "pcm" ? "s16le" : "wav", `/out.${format}`],
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
      const output = volume.readFileSync(`/out.${format}`) as Buffer;
      if (format === "wav") {
        const audio = parseWav(output).tracks[0]!.decodedAudio!;
        assert.equal(audio.sampleRate, rate);
        assert.equal(audio.channelData[0]!.length, expected);
        for (const sample of audio.channelData[0]!) assert.equal(sample, 1000 / 32768);
      } else {
        assert.equal(output.length / 2, expected);
        for (let i = 0; i < expected; i++) assert.equal(output.readInt16LE(i * 2), 1000);
      }
    });
  }
}
