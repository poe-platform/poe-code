import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

const a = Array.from({ length: 8192 }, (_, i) => i % 8 < 4 ? 8192 : -8192);
const b = Array.from({ length: 4096 }, (_, i) => i < 2048 ? -16384 : 1024);
const join = "join=inputs=2:channel_layout=stereo:map=1.0-FL|0.0-FR";

async function run(filters: string[], inputs: number[][][] = [[a], [b]], sampleRate = 8000) {
  const volume = Volume.fromJSON({ "/out.wav": "preserve" });
  for (const [index, channels] of inputs.entries()) {
    volume.writeFileSync(`/${index === 0 ? "a" : "b"}.wav`, encodeWav({ sampleRate,
      channels: channels.map(samples => Float64Array.from(samples, sample => sample / 32768)) }));
  }
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-i", "/a.wav", "-i", "/b.wav", ...filters, "-c:a", "pcm_s16le", "/out.wav"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { result, stderr, bytes: volume.readFileSync("/out.wav") as Buffer };
}

for (const [graph, expected] of [
  [`[0:a][1:a]${join}[mix]`, [b, a.slice(0, b.length)]],
  [`[1:a][0:a]${join}[mix]`, [a.slice(0, b.length), b]],
  [`[0:a][1:a]${join},areverse[mix]`, [[...b].reverse(), a.slice(0, b.length).reverse()]]
] as const) {
  it(`routes join channels and stops at the shortest input: ${graph}`, async () => {
    const { result, stderr, bytes } = await run(["-filter_complex", graph, "-map", "[mix]"]);
    assert.equal(result.exitCode, 0, stderr);
    const audio = parseWav(bytes).tracks[0]!.decodedAudio!;
    assert.equal(audio.channels, 2);
    assert.equal(audio.sampleRate, 8000);
    assert.equal(audio.channelData[0]!.length, 4096);
    assert.deepEqual(audio.channelData.map(channel => Array.from(channel, sample => sample * 32768)), expected);
  });
}

for (const [index, expected] of [a, b].entries()) {
  it(`preserves direct audio stream mapping ${index}`, async () => {
    const { result, stderr, bytes } = await run(["-map", `${index}:a`]);
    assert.equal(result.exitCode, 0, stderr);
    const audio = parseWav(bytes).tracks[0]!.decodedAudio!;
    assert.equal(audio.channels, 1);
    assert.deepEqual(Array.from(audio.channelData[0]!, sample => sample * 32768), expected);
  });
}

for (const map of ["2.0-FL|0.0-FR", "1.1-FL|0.0-FR", "1.0-FL|0.0-FL", "1.0-BOGUS|0.0-FR"]) {
  it(`rejects invalid join mapping without replacing output: ${map}`, async () => {
    const { result, stderr, bytes } = await run(["-filter_complex", `[0:a][1:a]join=inputs=2:channel_layout=stereo:map=${map}[mix]`, "-map", "[mix]"]);
    assert.notEqual(result.exitCode, 0);
    assert.match(stderr, /join/);
    assert.equal(bytes.toString(), "preserve");
  });
}

// Native FFmpeg matches speakers before falling back to unused input channels.
for (const [inputs, filter, expected] of [
  [[[8000], [12000, -2000]], "join", [12000, -2000]],
  [[[8000], [12000, -2000]], "join=map=0.0-FL", [8000, -2000]],
  [[[8000], [-4000]], "join", [8000, -4000]],
  [[[8000], [-4000]], "join=map=1.0-FL", [-4000, 8000]],
  [[[8000], [-4000]], "join=map=0.0-FR", [-4000, 8000]],
  [[[8000], [12000, -2000]], "join=map=1.0-FR", [8000, 12000]],
  [[[8000], [-4000]], "join=map=0.0-FL|0.0-FR", [8000, 8000]],
  [[[8000], [12000, -2000]], "join=map=1.1-FL|0.0-FR", [-2000, 8000]]
] as const) {
  it(`automatically assigns unused join channels: ${JSON.stringify(inputs)} ${filter}`, async () => {
    const { result, stderr, bytes } = await run([
      "-filter_complex", `[0:a][1:a]${filter}[mix]`, "-map", "[mix]"
    ], inputs.map(channels => channels.map(sample => Array<number>(32).fill(sample))));
    assert.equal(result.exitCode, 0, stderr);
    const audio = parseWav(bytes).tracks[0]!.decodedAudio!;
    assert.equal(audio.sampleRate, 8000);
    assert.equal(audio.channels, 2);
    assert.equal(audio.channelMask ?? 3, 3);
    assert.deepEqual(audio.channelData.map(channel => Array.from(channel, sample => sample * 32768)),
      expected.map(sample => Array<number>(32).fill(sample)));
  });
}

// Native FFmpeg 7.0.2 emits 512-sample frames for these 8 kHz PCM inputs.
for (const [filter, sampleRate, length, lengths, gains] of [
  ["aselect=not(n)", 8000, 2048, [512], [1]],
  ["volume=n:eval=frame", 8000, 2048, [512, 512, 512, 512], [0, 1, 2, 3]],
  ["volume=0.5", 8000, 2048, [2048], [0.5]],
  ["volume=n:eval=frame", 8000, 1300, [512, 512, 276], [0, 1, 2]],
  ["volume=n:eval=frame", 16000, 2300, [1024, 1024, 252], [0, 1, 2]]
] as const) {
  it(`preserves join frames for ${filter} at ${sampleRate} Hz (${lengths.join("+")})`, async () => {
    const { result, stderr, bytes } = await run([
      "-filter_complex", `[0:a][1:a]join=map=0.0-FL|1.0-FR,${filter}[mix]`, "-map", "[mix]"
    ], [8000, -4000].map(value => [Array<number>(length).fill(value)]), sampleRate);
    assert.equal(result.exitCode, 0, stderr);
    const audio = parseWav(bytes).tracks[0]!.decodedAudio!;
    assert.equal(audio.sampleRate, sampleRate);
    assert.equal(audio.channels, 2);
    for (const [channel, value] of [8000, -4000].entries()) {
      const expected = lengths.flatMap((count, index) => Array<number>(count).fill(value * gains[index]!));
      assert.equal(audio.channelData[channel]!.length, expected.length);
      for (const [index, sample] of expected.entries()) {
        assert.equal(audio.channelData[channel]![index]! * 32768, sample || 0, `channel ${channel}, sample ${index}`);
      }
    }
  });
}

for (const options of [
  "inputs=bad:inputs=2", "inputs=0:inputs=2", "inputs=-1:inputs=2",
  "inputs=2147483648:inputs=2", "inputs=:inputs=2", "inputs=NaN:inputs=2",
  "channel_layout=nope:channel_layout=stereo", "channel_layout=:channel_layout=stereo",
  "channel_layout=0:channel_layout=stereo", "channel_layout=08:channel_layout=stereo",
  "channel_layout=0x10000000000000000:channel_layout=stereo", "channel_layout=FL+nope:channel_layout=stereo",
  "channel_layout=3 channels (FL+FR):channel_layout=stereo", "channel_layout=9c:channel_layout=stereo",
  "channel_layout=ambisonic -1:channel_layout=stereo", "bad:inputs=2", "2:nope:channel_layout=stereo"
]) {
  it(`validates overridden join options without replacing output: ${options}`, async () => {
    const { result, stderr, bytes } = await run(["-filter_complex",
      `[0:a][1:a]join=${options}:map=1.0-FL|0.0-FR[mix]`, "-map", "[mix]"]);
    assert.notEqual(result.exitCode, 0);
    assert.match(stderr, /join/);
    assert.equal(bytes.toString(), "preserve");
  });
}

for (const options of [
  "inputs=2:inputs=2", "inputs=1:inputs=2", "inputs=3:inputs=2",
  "inputs=1+2:inputs=2", "inputs=2:inputs=1+1", "inputs=2:inputs=2.5",
  "channel_layout=stereo:channel_layout=stereo", "channel_layout=mono:channel_layout=stereo",
  "channel_layout=5.1:channel_layout=stereo", "channel_layout=FL+FR:channel_layout=stereo",
  "channel_layout=0x3:channel_layout=stereo", "channel_layout=2c:channel_layout=stereo",
  "channel_layout=0X3:channel_layout=stereo", "channel_layout=03:channel_layout=stereo",
  "channel_layout=2C:channel_layout=stereo", "channel_layout=2 channels:channel_layout=stereo",
  "channel_layout=FL@left+FR@right:channel_layout=stereo",
  "channel_layout=2 channels (FL+FR):channel_layout=stereo",
  "channel_layout=ambisonic 1:channel_layout=stereo", "channel_layout=ambisonic 1+stereo:channel_layout=stereo",
  "map=bad", "map="
]) {
  it(`uses the last valid join option value: ${options}`, async () => {
    const { result, stderr, bytes } = await run(["-filter_complex",
      `[0:a][1:a]join=${options}:map=1.0-FL|0.0-FR[mix]`, "-map", "[mix]"]);
    assert.equal(result.exitCode, 0, stderr);
    const audio = parseWav(bytes).tracks[0]!.decodedAudio!;
    assert.equal(audio.channels, 2);
    assert.equal(audio.sampleRate, 8000);
    assert.deepEqual(audio.channelData.map(channel => Array.from(channel, sample => sample * 32768)),
      [b, a.slice(0, b.length)]);
  });
}

for (const options of [
  "2:stereo:0.0-FL|1.1-FR",
  "channel_layout=stereo:inputs=2:2:stereo:0.0-FL|1.1-FR",
  "inputs=3:2:channel_layout=mono:stereo:map=bad:0.0-FL|1.1-FR",
  "2:stereo:0.0-FL|1.1-FR:",
  "inputs=2:channel_layout=stereo:map=0.0-FL|1.1-FR:",
  "channel_layout=stereo:inputs=2:2:stereo:0.0-FL|1.1-FR:"
]) {
  it(`parses join positional slots independently of named options: ${options}`, async () => {
    const { result, stderr, bytes } = await run([
      "-filter_complex", `[0:a][1:a]join=${options}[mix]`, "-map", "[mix]"
    ], [[1000, 2000], [3000, 4000]].map(channels =>
      channels.map(sample => Array<number>(512).fill(sample))));
    assert.equal(result.exitCode, 0, stderr);
    const audio = parseWav(bytes).tracks[0]!.decodedAudio!;
    assert.equal(audio.sampleRate, 8000);
    assert.equal(audio.channels, 2);
    assert.deepEqual(audio.channelData.map(channel => Array.from(channel, sample => sample * 32768)),
      [1000, 4000].map(sample => Array<number>(512).fill(sample)));
  });
}

for (const options of [":", ":2:stereo", "2::0.0-FL|1.0-FR", "2:stereo:0.0-FL|1.0-FR::",
  "2:stereo:0.0-FL|1.0-FR:extra", "inputs=bad:2:stereo:0.0-FL|1.0-FR:"]) {
  it(`rejects invalid mixed join options without replacing output: ${options}`, async () => {
    const { result, stderr, bytes } = await run([
      "-filter_complex", `[0:a][1:a]join=${options}[mix]`, "-map", "[mix]"
    ]);
    assert.notEqual(result.exitCode, 0);
    assert.match(stderr, /join/);
    assert.equal(bytes.toString(), "preserve");
  });
}
