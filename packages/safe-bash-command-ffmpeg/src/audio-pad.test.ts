import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

for (const [filter, frames, padding] of [
  ["anull", 16000, 0],
  ["apad=pad_len=19", 16000, 19],
  ["apad=pad_len=4", 4, 4],
  ["apad=pad_len=0x04", 4, 4],
  ["apad=pad_len=2+2", 4, 4],
  ["apad=pad_len=3.5", 4, 4],
  ["apad=pad_len=2.5", 4, 2],
  ["apad=pad_len=1.5", 4, 2],
  ["apad=pad_len=0.5", 4, 0],
  ["apad=pad_len=0.6", 4, 1],
  ["apad=pad_len=3.4", 4, 3],
  ["apad=pad_len=(2+3)/2", 4, 2],
  ["apad=pad_len=ceil(3.2)", 4, 4],
  ["apad=whole_len=2+4", 4, 2],
  ["apad=whole_len=5.5", 4, 2],
  ["apad=whole_len=6.5", 4, 2],
  ["apad=whole_len=4.5", 4, 0],
  ["apad=whole_len=16100", 16000, 100],
  ["apad=whole_len=4", 8, 0],
  ["apad=pad_len=0", 8, 0],
  ["apad=pad_len=-1:whole_len=12", 4, 8],
  ["apad=whole_len=12:pad_len=-1", 4, 8],
  ["apad=whole_len=-1:pad_len=4", 4, 4],
  ["apad=pad_len=4:whole_len=-1", 4, 4],
  ["apad=pad_len=-1:whole_len=0", 4, 0],
  ["apad=whole_len=-1:pad_len=0", 4, 0],
  ["apad=pad_len=4:pad_len=-1:whole_len=12", 4, 8],
  ["apad=whole_len=12:whole_len=-1:pad_len=4", 4, 4],
  ["apad=pad_len=-1:pad_len=4", 4, 4],
  ["apad=whole_len=-1:whole_len=12", 4, 8],
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
  ["apad=whole_len=12:pad_dur=0.00025", 4, 2],
  ["apad=pad_dur=0.00025:whole_len=12", 4, 2],
  ["apad=pad_len=4:whole_dur=0.002", 4, 4],
  ["apad=whole_dur=0.002:pad_len=4", 4, 4],
  ["apad=pad_dur=0.00025:whole_dur=0.002", 4, 2],
  ["apad=whole_dur=0.002:pad_dur=0.00025", 4, 2],
  ["apad=whole_len=12:pad_dur=0", 4, 0],
  ["apad=pad_len=0:whole_dur=0.002", 4, 0],
  ["apad=pad_dur=0.001:whole_len=8", 4, 8],
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

for (const [filter, limit, expected] of [
  ["apad=packet_size=2:pad_len=4", 2, 6],
  ["apad=2:4", 2, 6],
  ["apad=packet_size=2:pad_len=4", undefined, 8],
  ["apad=pad_len=4", 2, 8],
  ["apad=packet_size=2:whole_len=9", 3, 8],
  ["apad=2:5", 4, 9],
  ["apad=pad_len=5000", 2, 4100],
  ["asetnsamples=n=2:p=0,apad=2:4", 3, 6],
  ["apad=2:2,apad=1:2", 3, 7]
] as const) {
  for (const graph of [false, true]) {
    it(`${filter} emits padding frames with frame limit ${limit} (${graph ? "graph" : "simple"})`, async () => {
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
        channels: [Float64Array.from([1000, -2000, 3000, -4000], sample => sample / 32768)] }));
      const errors: Uint8Array[] = [];
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-i", "/in.wav", ...(graph
          ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          ...(limit === undefined ? [] : ["-frames:a", String(limit)]), "-c:a", "pcm_s16le", "/out.wav"],
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
      const actual = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!.channelData[0]!;
      assert.deepEqual(Array.from(actual, sample => sample * 32768),
        [1000, -2000, 3000, -4000, ...Array(expected - 4).fill(0)]);
    });
  }
}

for (const graph of [false, true]) {
  for (const options of [["-t", "0.002"], ["-to", "0.002"], ["-ss", "0.001", "-t", "0.002"]]) {
    it(`bare apad honors ${options.join(" ")} (${graph ? "graph" : "simple"})`, async () => {
      const volume = Volume.fromJSON({});
      const samples = [1000, -2000, 3000, -4000].map(value => value / 32768);
      volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [Float64Array.from(samples)] }));
      const errors: Uint8Array[] = [];
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-i", "/in.wav", ...(graph
          ? ["-filter_complex", "[0:a]apad[out]", "-map", "[out]"] : ["-af", "apad"]),
          ...options, "-c:a", "pcm_s16le", "/out.wav"],
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
      assert.deepEqual(Array.from(actual.channelData[0]!), options[0] === "-ss"
        ? Array(16).fill(0) : [...samples, ...Array(12).fill(0)]);
    });
  }
}

for (const graph of [false, true]) {
  for (const [filter, skipped] of [
    ["atrim=start_sample=2,apad", 2],
    ["atrim=start_sample=1,apad", 1],
    ["atrim=start_sample=1,asetpts=PTS-STARTPTS,apad", 1],
    ["atrim=start_sample=2,apad=whole_len=8", 2]
  ] as const) {
    for (const limit of ["-t", "-to"]) {
      it(`${filter} pads trimmed stereo to the full ${limit} duration (${graph ? "graph" : "simple"})`, async () => {
        const input = [101, -901, 202, -802, 303, -703];
        const bytes = Buffer.alloc(input.length * 2);
        input.forEach((sample, index) => bytes.writeInt16LE(sample, index * 2));
        const volume = Volume.fromJSON({ "/out.raw": "KEEP" });
        volume.writeFileSync("/in.raw", bytes);
        const errors: Uint8Array[] = [];
        const result = await createFfmpegCommand().execute({
          args: ["-y", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.raw", ...(graph
            ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
            limit, "0.001", "-f", "s16le", "/out.raw"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(data: Uint8Array) { errors.push(data); } }
        } as never);
        assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
        const actual = volume.readFileSync("/out.raw") as Buffer;
        assert.deepEqual(Array.from({ length: actual.length / 2 }, (_, index) => actual.readInt16LE(index * 2)),
          [...input.slice(skipped * 2), ...Array((8 - (3 - skipped)) * 2).fill(0)]);
      });
    }
  }
}

for (const filter of ["apad", "apad=pad_len=-2", "apad=pad_len=1.5x", "apad=pad_dur=bad",
  "apad=whole_len=", "apad=pad_len=2:whole_len=10", "apad=unknown=1",
  "apad=pad_len=-1", "apad=whole_len=-1", "apad=pad_len=-1:whole_len=-1",
  "apad=pad_len=-2:whole_len=12", "apad=whole_len=-2:pad_len=4",
  "apad=pad_len=-1.5:whole_len=12", "apad=whole_len=-1.5:pad_len=4",
  "apad=pad_len=4:whole_len=12", "apad=whole_len=12:pad_len=4",
  "apad=pad_len=4:whole_len=12:pad_dur=0.00025",
  "apad=whole_dur=0.002:whole_len=12:pad_len=4",
  "apad=pad_len=2+", "apad=pad_len=0/0", "apad=pad_len=1/0",
  "apad=pad_len=1-3", "apad=pad_len=9007199254740991+1",
  "apad=pad_len=40000*2", "apad=whole_len=40000*2",
  "apad=pad_len=9007199254740992", "apad=pad_len=80000",
  "apad=pad_dur=0.001:pad_len=-2", "apad=whole_dur=0.002:whole_len=1.5x",
  "apad=pad_dur=2:pad_len=0", "apad=whole_dur=2:whole_len=0", "apad -t 2"]) {
  it(`${filter} fails safely without replacing the destination`, async () => {
    const volume = Volume.fromJSON({ "/out.wav": "keep" });
    volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [new Float64Array([0.25])] }));
    const result = await createFfmpegCommand({ limits: { maxDurationSeconds: 1 } }).execute({
      args: ["-y", "-i", "/in.wav", "-af", ...filter.split(" "), "/out.wav"],
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
