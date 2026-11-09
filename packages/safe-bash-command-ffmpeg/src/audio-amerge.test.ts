import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav, serializeWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

for (const reverse of [false, true]) {
  for (const filter of ["amerge", "amerge=2", "amerge=inputs=2", "amerge=inputs=2,volume=0.5"]) {
    it(`${filter} preserves every mono input sample (reversed=${reverse})`, async () => {
      const a = Array.from({ length: 8192 }, (_, i) => i % 8 < 4 ? 8192 : -8192);
      const b = Array.from({ length: 4096 }, (_, i) => i < 2048 ? -16384 : 1024);
      const volume = Volume.fromJSON({});
      for (const [name, samples] of [["a", a], ["b", b]] as const) {
        volume.writeFileSync(`/${name}.wav`, encodeWav({ sampleRate: 8000,
          channels: [Float64Array.from(samples, sample => sample / 32768)] }));
      }
      const result = await run(volume, ["-v", "error", "-y", "-i", "/a.wav", "-i", "/b.wav",
        "-filter_complex", `${reverse ? "[1:a][0:a]" : "[0:a][1:a]"}${filter}[mix]`,
        "-map", "[mix]", "-c:a", "pcm_s16le", "/out.wav"]);
      assert.equal(result.exitCode, 0, result.stderr);
      const wav = volume.readFileSync("/out.wav") as Buffer;
      assert.equal(wav.readUInt16LE(wav.indexOf("fmt ") + 8), 1);
      const audio = parseWav(wav).tracks[0]!.decodedAudio!;
      assert.equal(audio.channels, 2);
      assert.equal(audio.sampleRate, 8000);
      assert.deepEqual(audio.channelData.map(channel => channel.length), [4096, 4096]);
      const expected = reverse ? [b, a] : [a, b];
      const gain = filter.includes("volume") ? 0.5 : 1;
      for (let i = 0; i < 4096; i++) {
        assert.deepEqual(audio.channelData.map(channel => Math.round(channel[i]! * 32768)),
          expected.map(channel => channel[i]! * gain), `frame ${i}`);
      }
    });
  }
}

// Native FFmpeg negotiates the first input's PCM format before merging.
for (const reverse of [false, true]) {
  for (const gain of [1, 0.5]) {
    it(`amerge negotiates PCM16/float samples before downstream volume (reversed=${reverse}, gain=${gain})`, async () => {
      const floats = [0.111111, -0.222222, 1, -1, 0.5 / 32768, 1.5 / 32768, -0.5 / 32768, -1.5 / 32768];
      const quantized = [3641, -7282, 32767, -32768, 0, 2, 0, -2].map(value => value / 32768);
      const integer = new Float64Array(floats.length + 1).fill(8000 / 32768);
      const doc = parseWav(encodeWav({ sampleRate: 8000, channels: [integer] }));
      const track = doc.tracks[0]!;
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/integer.wav", serializeWav(doc, { audioCodec: "pcm_s16le" }));
      volume.writeFileSync("/float.wav", serializeWav({ ...doc, tracks: [{ ...track,
        decodedAudio: { ...track.decodedAudio!, channelData: [Float64Array.from(floats)] }
      }] }, { audioCodec: "pcm_f32le" }));
      const result = await run(volume, ["-v", "error", "-y", "-i", "/integer.wav", "-i", "/float.wav",
        "-filter_complex", `${reverse ? "[1:a][0:a]" : "[0:a][1:a]"}amerge${gain === 1 ? "" : ",volume=0.5"}[out]`,
        "-map", "[out]", "-c:a", "pcm_f32le", "/out.wav"]);
      assert.equal(result.exitCode, 0, result.stderr);
      const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
      assert.equal(audio.sampleRate, 8000);
      assert.equal(audio.channels, 2);
      assert.equal(audio.channelMask ?? 3, 3);
      const expected = [Array.from(integer.subarray(0, floats.length)), reverse ? floats.map(Math.fround) : quantized];
      if (reverse) expected.reverse();
      assert.deepEqual(audio.channelData.map(channel => Array.from(channel)),
        expected.map(channel => channel.map(sample => Math.fround(sample * gain))));
    });
  }
}

const left = [100, 200, 300, 400, 500, 600];
const right = [-1100, -1200, -1300, -1400];
const center = [2100, 2200, 2300, 2400, 2500];
const stereoA = [-4000, 8000].map(sample => Array<number>(4096).fill(sample));
const stereoB = [1000, 2000].map(sample => Array<number>(2048).fill(sample));

for (const { name, masks, channels, expected, outputMask } of [
  { name: "FR and FL", masks: [2, 1], channels: [[right], [left]], expected: [left, right], outputMask: 3 },
  { name: "FC and stereo", masks: [4, 3], channels: [[center], [left.slice(0, 4), right]],
    expected: [left, right, center], outputMask: 7 },
  { name: "FL+FC and FR", masks: [5, 2], channels: [[left.slice(0, 5), center], [right]],
    expected: [left, right, center], outputMask: 7 },
  { name: "back and front stereo", masks: [0x30, 3], channels: [[right, right], [left, left]],
    expected: [left, left, right, right], outputMask: 0x33 },
  { name: "overlapping FR", masks: [2, 2], channels: [[right], [left]],
    expected: [right, left], outputMask: 3 },
  { name: "overlapping stereo", masks: [3, 3], channels: [stereoA, stereoB],
    expected: [...stereoA, ...stereoB], outputMask: 0x107 },
  { name: "stereo and overlapping FL", masks: [3, 1], channels: [[left.slice(0, 4), right], [center]],
    expected: [left, right, center], outputMask: 0xb }
]) {
  for (const reverse of [false, true]) {
    for (const gain of [1, 0.5]) {
      it(`amerge routes ${name} by speaker (reversed=${reverse}, gain=${gain})`, async () => {
        const volume = Volume.fromJSON({});
        for (const [index, input] of channels.entries()) {
          const doc = parseWav(encodeWav({ sampleRate: 8000,
            channels: input.map(samples => Float64Array.from(samples, sample => sample / 32768)) }));
          const track = doc.tracks[0]!;
          volume.writeFileSync(`/${index}.wav`, serializeWav({ ...doc, tracks: [{ ...track,
            decodedAudio: { ...track.decodedAudio!, channelMask: masks[index]! }
          }] }, { audioCodec: "pcm_s16le" }));
        }
        const result = await run(volume, ["-v", "error", "-y", "-i", reverse ? "/1.wav" : "/0.wav",
          "-i", reverse ? "/0.wav" : "/1.wav", "-filter_complex",
          `[0:a][1:a]amerge=inputs=2${gain === 1 ? "" : ",volume=0.5"}[mix]`,
          "-map", "[mix]", "-c:a", "pcm_s16le", "/out.wav"]);
        assert.equal(result.exitCode, 0, result.stderr);
        const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
        const length = Math.min(...channels.flat().map(samples => samples.length));
        const ordered = (masks[0]! & masks[1]!) !== 0 && reverse ? [...channels].reverse().flat() : expected;
        assert.equal(audio.channels, expected.length);
        assert.equal(audio.channelMask ?? 3, outputMask);
        assert.equal(audio.sampleRate, 8000);
        assert.deepEqual(audio.channelData.map(samples => Array.from(samples, sample => Math.round(sample * 32768))),
          ordered.map(samples => samples.slice(0, length).map(sample => sample * gain)));
      });
    }
  }
}

for (const [mask, samples] of [[1, left], [2, right]] as const) {
  it(`direct mapping preserves mono speaker mask ${mask}`, async () => {
    const doc = parseWav(encodeWav({ sampleRate: 8000,
      channels: [Float64Array.from(samples, sample => sample / 32768)] }));
    const track = doc.tracks[0]!;
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/in.wav", serializeWav({ ...doc, tracks: [{ ...track,
      decodedAudio: { ...track.decodedAudio!, channelMask: mask }
    }] }, { audioCodec: "pcm_s16le" }));
    const result = await run(volume, ["-i", "/in.wav", "-map", "0:a", "-c:a", "pcm_s16le", "/out.wav"]);
    assert.equal(result.exitCode, 0, result.stderr);
    const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
    assert.equal(audio.channelMask, mask);
    assert.deepEqual(Array.from(audio.channelData[0]!, sample => Math.round(sample * 32768)), samples);
  });
}

for (const graph of ["[0:a][1:a]amerge=inputs=3[out]",
  "[0:a][1:a]amerge=inputs=0[out]", "[0:a][1:a]amerge=unknown=2[out]"]) {
  it(`rejects unsupported merge without overwriting output: ${graph}`, async () => {
    const volume = Volume.fromJSON({ "/out.wav": "keep" });
    for (const name of ["a", "b"]) volume.writeFileSync(`/${name}.wav`,
      encodeWav({ sampleRate: 8000, channels: [new Float64Array([0.25, 0.5])] }));
    const result = await run(volume, ["-y", "-i", "/a.wav", "-i", "/b.wav",
      "-filter_complex", graph, "-map", "[out]", "/out.wav"]);
    assert.notEqual(result.exitCode, 0);
    assert.equal(volume.readFileSync("/out.wav", "utf8"), "keep");
  });
}

async function run(volume: Volume, args: string[]) {
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args, cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { ...result, stderr };
}
