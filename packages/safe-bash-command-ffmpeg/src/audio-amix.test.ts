import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

async function mix(filter: string, a: number[], b: number[] | undefined, stereo = false, extra: number[][] = [], codec = "pcm_s16le") {
  const volume = Volume.fromJSON({ "/out.wav": "keep" });
  const inputs = [a, ...(b ? [b] : []), ...extra];
  for (const [index, samples] of inputs.entries()) {
    const path = `/${index}.wav`;
    const channel = Float64Array.from(samples, sample => sample / 32768);
    volume.writeFileSync(path, encodeWav({ sampleRate: 8000,
      channels: stereo ? [channel, channel.map(sample => -sample)] : [channel] }));
  }
  const errors: Uint8Array[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-y", ...inputs.flatMap((_, index) => ["-i", `/${index}.wav`]), ...(
      filter.startsWith("map:") ? ["-map", filter.slice(4)] :
        ["-filter_complex", `${inputs.map((_, index) => `[${index}:a]`).join("")}${filter}[mix]`, "-map", "[mix]"]),
      "-c:a", codec, "/out.wav"],
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
for (const options of ["2", "weights=1 1", "2:longest:2:1 1", "2:shortest:0:1 1:0"]) {
  it(`accepts a trailing amix separator after ${options}`, async () => {
    const first = Array(2048).fill(12000);
    const second = Array(733).fill(-4000);
    const baseline = await mix(`amix=${options}`, first, second);
    const trailing = await mix(`amix=${options}:`, first, second);
    assert.equal(baseline.result.exitCode, 0, baseline.error);
    assert.equal(trailing.result.exitCode, 0, trailing.error);
    assert.deepEqual(trailing.volume.readFileSync("/out.wav"), baseline.volume.readFileSync("/out.wav"));
  });
}

for (const [options, exitCode] of [["2::", 234], ["2::0", 234], ["inputs=", 234], ["duration=", 234], ["unknown=1:", 8]] as const) {
  it(`rejects malformed amix ${options} without replacing output`, async () => {
    const { result, volume } = await mix(`amix=${options}`, [12000], [-4000]);
    assert.equal(result.exitCode, exitCode);
    assert.equal(volume.readFileSync("/out.wav", "utf8"), "keep");
  });
}

for (const stereo of [false, true]) {
  for (const [filter, expected] of [
    ["amix=inputs=2:duration=shortest:normalize=0", b.map((v, i) => v + a[i]!)],
    ["amix=inputs=2:duration=longest:dropout_transition=0", a.map((v, i) => i < b.length ? (v + b[i]!) / 2 : v)],
    ["amix=duration=first:dropout_transition=0", a.map((v, i) => i < b.length ? (v + b[i]!) / 2 : v)],
    ["amix=duration=shortest:weights='0.5 -1':normalize=0", b.map((v, i) => a[i]! / 2 + v)],
    ["amix=dropout_transition=0:weights='1 0'", a],
    ["amix=dropout_transition=0:weights='0 0'", a.map(() => 0)],
    ["amix=duration=shortest:weights='2\t1'", b.map((v, i) => Math.round((2 * a[i]! + v) / 3))],
    ["amix=duration=shortest:weights=' \t2\t 1\t9 7'", b.map((v, i) => Math.round((2 * a[i]! + v) / 3))],
    ["amix=duration=shortest:weights='0.5':normalize=0", b.map((v, i) => (a[i]! + v) / 2)],
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
  ["amix=weights=1 2 9", Array(2048).fill(8000), Array(750).fill(-4000),
    [[0, 0], [750, 2690], [1024, 2734], [1536, 2779]]],
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
  ["amix=dropout_transition=0.128:weights=1 3 9", [[1024, 0], [512, 4000], [512, 6000], [3072, 12000]]],
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

for (const prefix of ["normalize=", "2:longest:2:1 1:"]) {
  for (const [normalized, values] of [
    [false, ["0", "false", "no", "off", "FaLsE", "NO", "OFF", "n", "disable", "disabled", ...(prefix === "normalize=" ? [""] : []), "-0", "00"]],
    [true, ["1", "true", "yes", "on", "TrUe", "YES", "ON", "y", "enable", "enabled", "+1", "01"]]
  ] as const) {
    it(`amix ${prefix} matches native ${normalized ? "normalized" : "summed"} PCM for boolean spellings`, async () => {
      for (const value of values) {
        const { result, volume, error } = await mix(`amix=${prefix}${value}`, Array(2048).fill(8000), Array(2048).fill(-4000));
        assert.equal(result.exitCode, 0, `${value}: ${error}`);
        const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
        assert.equal(audio.sampleRate, 8000);
        assert.equal(audio.channels, 1);
        assert.deepEqual(Array.from(audio.channelData[0]!, sample => sample * 32768),
          Array(2048).fill(normalized ? 2000 : 4000), value);
      }
    });
  }
  it(`amix ${prefix} rejects invalid booleans without replacing output`, async () => {
    for (const value of ["auto", "maybe", "2", "-1", "1.0", "0x1", "truejunk"]) {
      const { result, volume, error } = await mix(`amix=${prefix}${value}`, [8000], [-4000]);
      assert.equal(result.exitCode, 234, value);
      assert.ok(error.includes("amix: invalid normalize"), error);
      assert.equal(volume.readFileSync("/out.wav", "utf8"), "keep", value);
    }
  });
}

// FFmpeg 7.0.2 results for mono PCM16 at 8 kHz.
for (const [options, secondLength, length, points] of [
  ["inputs=2", 2048, 2048, [[0, 2000], [2047, 2000]]],
  ["inputs=1+1", 2048, 2048, [[0, 2000], [2047, 2000]]],
  ["inputs=1.5", 2048, 2048, [[0, 2000], [2047, 2000]]],
  ["inputs=2.5", 2048, 2048, [[0, 2000], [2047, 2000]]],
  ["duration=shortest", 750, 750, [[0, 2000], [749, 2000]]],
  ["duration=shortest+0", 750, 750, [[0, 2000], [749, 2000]]],
  ["duration=0.6", 750, 750, [[0, 2000], [749, 2000]]],
  ["duration=0.5:dropout_transition=0", 750, 2048, [[749, 2000], [750, 8000]]],
  ["duration=1.5:dropout_transition=0", 750, 2048, [[749, 2000], [750, 8000]]],
  ["dropout_transition=0.5", 750, 2048, [[749, 2000], [750, 4142], [1024, 4436], [1536, 4775]]],
  ["dropout_transition=1/2", 750, 2048, [[749, 2000], [750, 4142], [1024, 4436], [1536, 4775]]],
  ["1+1:shortest+0:1/2", 750, 750, [[0, 2000], [749, 2000]]]
] as const) {
  it(`matches native numeric amix options ${options}`, async () => {
    const { result, volume, error } = await mix(`amix=${options}`, Array(2048).fill(8000), Array(secondLength).fill(-4000));
    assert.equal(result.exitCode, 0, error);
    const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
    assert.equal(audio.sampleRate, 8000);
    assert.equal(audio.channels, 1);
    assert.equal(audio.channelData[0]!.length, length);
    for (const [index, expected] of points) assert.equal(audio.channelData[0]![index]! * 32768, expected, `sample ${index}`);
  });
}

for (const [options, exitCode] of [
  ["inputs=0b10", 234], ["inputs=0o2", 234], ["inputs=1+", 234], ["inputs=0/0", 234], ["inputs=1/0", 234], ["inputs=2.6", 1],
  ["duration=0b1", 234], ["duration=shortest+", 234], ["duration=first+0.1", 222], ["duration=-0.1", 222],
  ["dropout_transition=0b1", 234], ["dropout_transition=1/", 234], ["dropout_transition=1/0", 234],
  ["dropout_transition=0/0", 234], ["dropout_transition=1-2", 222], ["dropout_transition=2147483648", 222]
] as const) {
  it(`rejects amix ${options} without replacing output`, async () => {
    const { result, volume, error } = await mix(`amix=${options}`, Array(2048).fill(8000), Array(2048).fill(-4000));
    assert.equal(result.exitCode, exitCode, error);
    assert.equal(volume.readFileSync("/out.wav", "utf8"), "keep");
  });
}
for (const stereo of [false, true]) {
  for (const [filter, values, expected] of [
    ["amix=inputs=1", [8000], 8000],
    ["amix=inputs=3:weights=1 1 2", [8000, -4000, 12000], 7000],
    ["amix=inputs=3", [8000, -4000, 12000], 5333],
    ["amix=3:normalize=0", [8000, -4000, 12000], 16000],
    ["amix=inputs=3:weights=1 2", [8000, -4000, 12000], 4800],
    ["amix=inputs=4", [8000, -4000, 12000, 16000], 8000]
  ] as const) {
    it(`mixes the declared inputs for ${filter}, stereo=${stereo}`, async () => {
      const inputs = values.map(value => Array(2048).fill(value));
      const { result, volume, error } = await mix(filter, inputs[0]!, inputs[1], stereo, inputs.slice(2));
      assert.equal(result.exitCode, 0, error);
      const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
      assert.equal(audio.sampleRate, 8000);
      assert.equal(audio.channels, stereo ? 2 : 1);
      for (const [index, channel] of audio.channelData.entries()) {
        assert.deepEqual(Array.from(channel, sample => sample * 32768),
          Array(2048).fill(index ? -expected : expected));
      }
    });
  }
}

for (const [filter, count] of [
  ["amix", 1], ["amix", 3], ["amix=inputs=1", 2], ["amix=inputs=3", 2],
  ["amix=inputs=2", 3], ["amix=inputs=0", 2], ["amix=inputs=0.5", 2],
  ["amix=inputs=NaN", 2], ["amix=inputs=32768", 2]
] as const) {
  it(`rejects ${filter} with ${count} connected pads without replacing output`, async () => {
    const inputs = Array.from({ length: count }, () => [8000]);
    const { result, volume } = await mix(filter, inputs[0]!, inputs[1], false, inputs.slice(2));
    assert.notEqual(result.exitCode, 0);
    assert.equal(volume.readFileSync("/out.wav", "utf8"), "keep");
  });
}

for (const [duration, runs] of [
  ["longest", [[512, 4000], [512, 8000], [512, 12000]]],
  ["shortest", [[512, 4000]]],
  ["first", [[512, 4000], [512, 8000]]]
] as const) {
  it(`handles three unequal inputs with duration=${duration}`, async () => {
    const { result, volume, error } = await mix(
      `amix=inputs=3:duration=${duration}:dropout_transition=0`,
      Array(1024).fill(4000), Array(512).fill(-4000), false, [Array(1536).fill(12000)]);
    assert.equal(result.exitCode, 0, error);
    const channel = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!.channelData[0]!;
    assert.deepEqual(Array.from(channel, sample => sample * 32768),
      runs.flatMap(([length, value]) => Array(length).fill(value)));
  });
}

it("matches native three-input dropout recovery across two EOF boundaries", async () => {
  const { result, volume, error } = await mix("amix=inputs=3:dropout_transition=0.128",
    Array(1536).fill(4000), Array(512).fill(-4000), false, [Array(2560).fill(12000)]);
  assert.equal(result.exitCode, 0, error);
  const channel = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!.channelData[0]!;
  // Native FFmpeg PCM16 output at 8 kHz.
  assert.deepEqual(Array.from(channel, sample => sample * 32768),
    [4000, 6400, 8000, 8000, 12000].flatMap(value => Array(512).fill(value)));
});

// FFmpeg 7.0.2 preserves NaN in float output when normalized weights sum to zero.
for (const stereo of [false, true]) {
  for (const [options, expected] of [
    ["weights=0 0", NaN],
    ["weights=0", NaN],
    ["weights=0 0:normalize=1", NaN],
    ["weights=0 0:dropout_transition=0", NaN],
    ["weights=0 0:normalize=0", 0],
    ["weights=0 1", -4000],
    ["weights=1 0", 8000]
  ] as const) {
    it(`preserves native float amix ${options}, stereo=${stereo}`, async () => {
      const { result, volume, error } = await mix(`amix=${options}`,
        Array(2048).fill(8000), Array(2048).fill(-4000), stereo, [], "pcm_f32le");
      assert.equal(result.exitCode, 0, error);
      const track = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!;
      assert.equal(track.codecDescriptions[0]!.codecName, "pcm_f32le");
      const audio = track.decodedAudio!;
      assert.equal(audio.sampleRate, 8000);
      assert.equal(audio.channels, stereo ? 2 : 1);
      for (const [index, channel] of audio.channelData.entries()) {
        assert.equal(channel.length, 2048);
        const sample = index && expected ? -expected : expected;
        assert.deepEqual(Array.from(channel, value => value * 32768), Array(2048).fill(sample));
      }
    });
  }
}
