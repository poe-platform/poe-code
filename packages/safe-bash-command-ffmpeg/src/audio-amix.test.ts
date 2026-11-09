import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

async function mix(filter: string, a: number[], b: number[], stereo = false) {
  const volume = Volume.fromJSON({ "/out.wav": "keep" });
  for (const [path, samples] of [["/a.wav", a], ["/b.wav", b]] as const) {
    const channel = Float64Array.from(samples, sample => sample / 32768);
    volume.writeFileSync(path, encodeWav({ sampleRate: 8000,
      channels: stereo ? [channel, channel.map(sample => -sample)] : [channel] }));
  }
  const errors: Uint8Array[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-i", "/a.wav", "-i", "/b.wav", ...(
      filter.startsWith("map:") ? ["-map", filter.slice(4)] :
        ["-filter_complex", `[0:a][1:a]${filter}[mix]`, "-map", "[mix]"]),
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
  return { result, volume, error: Buffer.concat(errors).toString() };
}

const a = Array.from({ length: 8192 }, (_, i) => i % 8 < 4 ? 8192 : -8192);
const b = Array.from({ length: 4096 }, (_, i) => i < 2048 ? -16384 : 1024);
for (const stereo of [false, true]) {
  for (const [filter, expected] of [
    ["amix=inputs=2:duration=shortest:normalize=0", b.map((v, i) => v + a[i]!)],
    ["amix=inputs=2:duration=longest:dropout_transition=0", a.map((v, i) => i < b.length ? (v + b[i]!) / 2 : v)],
    ["amix=duration=first:dropout_transition=0", a.map((v, i) => i < b.length ? (v + b[i]!) / 2 : v)],
    ["amix=duration=shortest:weights='0.5 -1':normalize=0", b.map((v, i) => a[i]! / 2 + v)],
    ["amix=dropout_transition=0:weights='1 0'", a],
    ["amix=dropout_transition=0:weights='0 0'", a.map(() => 0)],
    ["map:0:a", a], ["map:1:a", b]
  ] as const) {
    it(`matches native PCM for ${filter}, stereo=${stereo}`, async () => {
      const { result, volume, error } = await mix(filter, a, b, stereo);
      assert.equal(result.exitCode, 0, error);
      const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
      assert.equal(audio.sampleRate, 8000);
      assert.equal(audio.channels, stereo ? 2 : 1);
      for (const [index, channel] of audio.channelData.entries()) {
        assert.deepEqual(Array.from(channel, sample => sample * 32768), expected.map(sample => index && sample ? -sample : sample));
      }
    });
  }
}

for (const [filter, first, second, points] of [
  ["amix=dropout_transition=0.5", Array(16000).fill(8192), Array(4096).fill(-4096),
    [[0, 2048], [4096, 4376], [5120, 5069], [6144, 6024], [7168, 7420], [8192, 8192]]],
  ["amix=dropout_transition=0.5", Array(4096).fill(8192), Array(16000).fill(-4096),
    [[0, 2048], [4096, -2188], [5120, -2535], [6144, -3012], [8192, -4096]]],
  ["amix=dropout_transition=0:weights='1 -3'", Array(5120).fill(12000), Array(1024).fill(-4000),
    [[0, 6000], [1023, 6000], [1024, 12000], [5119, 12000]]],
  ["amix=duration=first:dropout_transition=0", Array(1024).fill(12000), Array(5120).fill(-4000),
    [[0, 4000], [1023, 4000]]]
] as const) {
  it(`matches native EOF gains for ${filter}`, async () => {
    const { result, volume, error } = await mix(filter, [...first], [...second]);
    assert.equal(result.exitCode, 0, error);
    const channel = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!.channelData[0]!;
    assert.equal(channel.length, filter.includes("duration=first") ? first.length : Math.max(first.length, second.length));
    for (const [index, expected] of points) assert.equal(channel[index]! * 32768, expected, `sample ${index}`);
  });
}

// Native FFmpeg 7.0.2 PCM16 output at 8 kHz, including every recovery frame.
for (const [filter, runs] of [
  ["amix=dropout_transition=0.256", [[1024, 4000], [512, 6857], [512, 8000], [512, 9600], [2560, 12000]]],
  ["amix=dropout_transition=0.128", [[1024, 4000], [512, 8000], [3584, 12000]]],
  ["amix=dropout_transition=0.128:weights=1 3", [[1024, 0], [512, 4000], [512, 6000], [3072, 12000]]],
  ["amix=dropout_transition=0", [[1024, 4000], [4096, 12000]]],
  ["amix=dropout_transition=0.128:normalize=0", [[1024, 8000], [4096, 12000]]],
  ["amix=duration=shortest:dropout_transition=0.128", [[1024, 4000]]],
  ["map:0:a", [[5120, 12000]]],
  ["map:1:a", [[1024, -4000]]]
] as const) {
  it(`matches native dropout recovery and output length for ${filter}`, async () => {
    const { result, volume, error } = await mix(filter, Array(5120).fill(12000), Array(1024).fill(-4000));
    assert.equal(result.exitCode, 0, error);
    const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
    assert.equal(audio.sampleRate, 8000);
    assert.equal(audio.channels, 1);
    assert.deepEqual(Array.from(audio.channelData[0]!, sample => sample * 32768),
      runs.flatMap(([length, value]) => Array(length).fill(value)));
  });
}

for (const filter of ["amix=inputs=3", "amix=duration=invalid", "amix=normalize=maybe",
  "amix=dropout_transition=-1", "amix=weights=bad", "amix=unknown=1"]) {
  it(`rejects ${filter} without replacing output`, async () => {
    const { result, volume } = await mix(filter, a, b);
    assert.notEqual(result.exitCode, 0);
    assert.equal(volume.readFileSync("/out.wav", "utf8"), "keep");
  });
}
