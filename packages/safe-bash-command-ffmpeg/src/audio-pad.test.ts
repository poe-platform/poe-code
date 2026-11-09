import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

for (const [filter, frames, padding] of [
  ["anull", 16000, 0],
  ["apad=pad_len=19", 16000, 19],
  ["apad=whole_len=16100", 16000, 100],
  ["apad=whole_len=4", 8, 0],
  ["apad=pad_len=0", 8, 0],
  ["apad=pad_dur=0.001", 8, 8],
  ["apad=pad_dur=0.001:pad_len=4", 4, 8],
  ["apad=pad_len=4:pad_dur=0.001", 4, 8],
  ["apad=whole_dur=0.002:whole_len=8", 4, 12],
  ["apad=whole_len=8:whole_dur=0.002", 4, 12],
  ["apad=pad_dur=0:pad_len=4", 4, 0],
  ["apad=pad_len=4:pad_dur=0", 4, 0],
  ["apad=whole_dur=0:whole_len=8", 4, 0],
  ["apad=whole_len=8:whole_dur=0", 4, 0],
  ["apad=pad_dur=0.002:pad_len=4:pad_dur=0.001", 4, 8],
  ["apad=whole_dur=0.001:whole_len=8:whole_dur=0.002", 4, 12],
  ["apad=whole_dur=0.0015", 8, 4],
  ["apad=whole_dur=0.0005", 8, 0],
  ["apad=pad_len=4,apad=whole_len=16", 8, 8]
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

for (const filter of ["apad", "apad=pad_len=-2", "apad=pad_len=1.5", "apad=pad_dur=bad",
  "apad=whole_len=", "apad=pad_len=2:whole_len=10", "apad=unknown=1",
  "apad=pad_len=9007199254740992", "apad=pad_len=80000",
  "apad=pad_dur=0.001:pad_len=-2", "apad=whole_dur=0.002:whole_len=1.5",
  "apad=pad_dur=2:pad_len=0", "apad=whole_dur=2:whole_len=0"]) {
  it(`${filter} fails safely without replacing the destination`, async () => {
    const volume = Volume.fromJSON({ "/out.wav": "keep" });
    volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [new Float64Array([0.25])] }));
    const result = await createFfmpegCommand({ limits: { maxDurationSeconds: 1 } }).execute({
      args: ["-y", "-i", "/in.wav", "-af", filter, "/out.wav"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} }
    } as never);
    assert.notEqual(result.exitCode, 0);
    assert.equal(volume.readFileSync("/out.wav", "utf8"), "keep");
  });
}
