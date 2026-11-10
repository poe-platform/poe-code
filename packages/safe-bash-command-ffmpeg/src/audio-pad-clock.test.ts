import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

for (const [filter, frames, padding] of [
  ["apad=pad_dur='00\\:00\\:00.000250'", 3, 2],
  ["apad=pad_dur=00\\\\:00\\\\:00.000250", 3, 2],
  ["apad=pad_dur=250us", 3, 2],
  ["apad=packet_size=2:pad_dur='00\\:00\\:00.000250':whole_len=12", 3, 2],
  ["apad=whole_dur='00\\:00\\:00.000625'", 3, 2],
  ["apad=whole_dur=00\\\\:00\\\\:00.000625:packet_size=2", 3, 2],
  ["apad=4096:-1:-1:'00\\:00\\:00.000250'", 3, 2],
] as const) {
  for (const graph of [false, true]) {
    it(`${filter} preserves stereo PCM and appends silence (${graph ? "graph" : "simple"})`, async () => {
      const channels = [Float64Array.from({ length: frames }, (_, i) => i / 32768),
        Float64Array.from({ length: frames }, (_, i) => (0 - i) / 32768)];
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels }));
      const errors: Uint8Array[] = [];
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-i", "/in.wav", ...(graph
          ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-c:a", "pcm_s16le", "/out.wav"],
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
      const actual = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
      for (const [index, channel] of actual.channelData.entries()) {
        assert.equal(channel.length, frames + padding);
        assert.deepEqual(Array.from(channel.subarray(0, frames)), Array.from(channels[index]!));
        assert.deepEqual(Array.from(channel.subarray(frames)), Array(padding).fill(0));
      }
    });
  }
}
