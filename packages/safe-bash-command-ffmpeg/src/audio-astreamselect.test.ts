import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

async function select(filter: string, a: number[], b: number[], stereo = false) {
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

for (const map of [0, 1]) {
  it(`selects all samples through a named astreamselect instance with map=${map}`, async () => {
    for (const name of ["astreamselect", "astreamselect@route"]) {
      const { result, volume, error } = await select(`${name}=map=${map}`,
        Array(2048).fill(8000), Array(2048).fill(-4000));
      assert.equal(result.exitCode, 0, error);
      const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
      assert.equal(audio.sampleRate, 8000);
      assert.equal(audio.channels, 1);
      assert.deepEqual(Array.from(audio.channelData[0]!, sample => sample * 32768),
        Array(2048).fill(map === 0 ? 8000 : -4000));
    }
  });
}

const a = Array.from({ length: 8192 }, (_, i) => i % 8 < 4 ? 8192 : -8192);
const b = Array.from({ length: 4096 }, (_, i) => i < 2048 ? -16384 : 1024);
for (const map of [0, 1]) for (const length of [2048, 1300]) for (const stereo of [false, true]) {
  it(`preserves selected audio frames for map=${map}, length=${length}, stereo=${stereo}`, async () => {
    const { result, volume, error } = await select(`astreamselect=map=${map},volume=n:eval=frame`,
      Array(2048).fill(8000), Array(length).fill(-4000), stereo);
    assert.equal(result.exitCode, 0, error);
    const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
    assert.equal(audio.sampleRate, 8000);
    assert.equal(audio.channels, stereo ? 2 : 1);
    for (const [index, channel] of audio.channelData.entries()) {
      const expectedLength = map === 0 ? Math.ceil(length / 512) * 512 : length;
      assert.equal(channel.length, expectedLength);
      assert.deepEqual(Array.from(channel, sample => sample * 32768),
        Array.from({ length: expectedLength }, (_, i) => Math.floor(i / 512) * (map ? -4000 : 8000) * (index ? -1 : 1) || 0));
    }
  });
}
for (const [filter, expected] of [
  ["astreamselect=inputs=2:map=0", a.slice(0, b.length)],
  ["astreamselect=inputs=2:map=1", b],
  ["astreamselect=inputs=3:inputs=2:map=1", b],
  ["astreamselect=3:inputs=2:map=1", b],
  ["astreamselect=map=0b1", a.slice(0, b.length)],
  ["astreamselect=map=0.5", a.slice(0, b.length)],
  ["astreamselect=map=1foo", b],
  ["astreamselect=map=1.5", b],
  ["astreamselect=map=0x1", b],
  ["astreamselect=map=01", b],
  ["astreamselect=map=+1", b],
  ["astreamselect=map=-0", a.slice(0, b.length)],
  ["astreamselect=2:1", b],
  ["astreamselect=inputs=1+1:map=1", b],
  ["astreamselect=inputs=2.5:map=1", b],
  ["astreamselect=1+1:1", b],
  ["astreamselect=2.5:1", b],
  ["astreamselect=map=1,volume=0.5", b.map(value => value / 2)],
  ["map:0:a", a], ["map:1:a", b]
] as const) {
  for (const stereo of [false, true]) {
    it(`selects exact PCM and length for ${filter}, stereo=${stereo}`, async () => {
      const { result, volume, error } = await select(filter, a, b, stereo);
      assert.equal(result.exitCode, 0, error);
      const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
      assert.equal(audio.sampleRate, 8000);
      assert.equal(audio.channels, stereo ? 2 : 1);
      for (const [index, channel] of audio.channelData.entries()) {
        assert.equal(channel.length, expected.length);
        assert.deepEqual(Array.from(channel, sample => sample * 32768), expected.map(sample => index && sample ? -sample : sample));
      }
    });
  }
}
// Native FFmpeg 7.0.2 keeps whole selected packets whose start precedes peer EOF.
for (const [peerLength, expectedLongLength] of [[750, 1024], [512, 512], [513, 1024], [1, 512]] as const) {
  for (const reversed of [false, true]) {
    for (const selectLong of [false, true]) {
      for (const stereo of [false, true]) {
        it(`keeps selected packets at peer EOF=${peerLength}, reversed=${reversed}, long=${selectLong}, stereo=${stereo}`, async () => {
          const long = Array.from({ length: 2048 }, (_, i) => 8000 + i);
          const short = Array.from({ length: peerLength }, (_, i) => -4000 - i);
          const selected = selectLong === reversed ? 1 : 0;
          const expected = selectLong ? long.slice(0, expectedLongLength) : short;
          const { result, volume, error } = await select(`astreamselect=map=${selected}`,
            reversed ? short : long, reversed ? long : short, stereo);
          assert.equal(result.exitCode, 0, error);
          const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
          assert.equal(audio.sampleRate, 8000);
          assert.equal(audio.channels, stereo ? 2 : 1);
          for (const [index, channel] of audio.channelData.entries()) {
            assert.equal(channel.length, expected.length);
            assert.deepEqual(Array.from(channel, sample => sample * 32768),
              expected.map(sample => index ? -sample : sample));
          }
        });
      }
    }
  }
}

for (const filter of ["astreamselect", "astreamselect=inputs=3:map=1", "astreamselect=map=2",
  "astreamselect=map=-1", "astreamselect=map=", "astreamselect=map=no",
  "astreamselect=inputs=0b10:map=1", "astreamselect=inputs=1.5:map=1",
  "astreamselect=inputs=2.51:map=1", "astreamselect=inputs=2147483648:map=1",
  "astreamselect=inputs=1/0:map=1", "astreamselect=inputs=:map=1",
  "astreamselect=inputs=0:inputs=2:map=1", "astreamselect=inputs=bad:inputs=2:map=1",
  "astreamselect=0:inputs=2:map=1", "astreamselect=bad:inputs=2:map=1",
  "astreamselect=map=08", "astreamselect=map=0+1", "astreamselect=inputs=2foo:map=1",
  "astreamselect=map=0 1", "astreamselect=map=1:unknown=0"]) {
  it(`rejects ${filter} without replacing output`, async () => {
    const { result, volume } = await select(filter, a, b);
    assert.notEqual(result.exitCode, 0);
    assert.equal(volume.readFileSync("/out.wav", "utf8"), "keep");
  });
}
