import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

async function render(filter: string) {
  const volume = Volume.fromJSON({ "/out.wav": "keep" });
  const source = [new Float64Array(128), new Float64Array(128)];
  source[0]![0] = source[0]![64] = source[1]![32] = source[1]![64] = 0.25;
  const left = [new Float64Array(16), new Float64Array(16)];
  left[0]![0] = 0.5;
  left[1]![2] = 0.25;
  for (const [name, channels] of [["source", source], ["left", left], ["right", [...left].reverse()]] as const) {
    volume.writeFileSync(`/${name}.wav`, encodeWav({ sampleRate: 8000, channels }));
  }
  const errors: Uint8Array[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-i", "/source.wav", "-i", "/left.wav", "-i", "/right.wav",
      "-filter_complex", `[0:a][1:a][2:a]${filter}[h]`, "-map", "[h]", "-c:a", "pcm_s16le", "/out.wav"],
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

for (const type of ["time", "freq"]) {
  it(`headphone ${type} matches native separate stereo impulse responses`, async () => {
    const { result, volume, error } = await render(`headphone=map=FL|FR:type=${type}`);
    assert.equal(result.exitCode, 0, error);
    const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
    assert.equal(audio.sampleRate, 8000);
    assert.equal(audio.channels, 2);
    const expected = [Array<number>(128).fill(0), Array<number>(128).fill(0)];
    expected[0]![0] = expected[0]![64] = expected[1]![32] = expected[1]![64] = 2053;
    expected[0]![34] = expected[0]![66] = expected[1]![2] = expected[1]![66] = 1026;
    assert.deepEqual(audio.channelData.map(channel => Array.from(channel, sample => sample * 32768)), expected);
  });
}

for (const [options, direct, delayed] of [
  ["map=FL|FR:gain=6", 4096, 2048],
  ["map=FR|FL", 2053, 1026],
  ["map=FL|FR,volume=0.5", 1026, 513]
] as const) {
  it(`headphone applies ${options}`, async () => {
    const { result, volume, error } = await render(`headphone=${options}`);
    assert.equal(result.exitCode, 0, error);
    const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
    const reversed = options.startsWith("map=FR");
    assert.equal(audio.channelData[reversed ? 1 : 0]![0]! * 32768, direct);
    assert.equal(audio.channelData[reversed ? 0 : 1]![2]! * 32768, delayed);
  });
}

for (const options of [
  "map=FL|FR:gain=0",
  "FL|FR:0",
  "map=FL|FR:gain=0:lfe=0:type=time:size=1024:hrir=stereo"
]) {
  it(`headphone ignores a final option separator after ${options}`, async () => {
    const control = await render(`headphone=${options}`);
    const trailing = await render(`headphone=${options}:`);
    assert.equal(control.result.exitCode, 0, control.error);
    assert.equal(trailing.result.exitCode, 0, trailing.error);
    assert.equal(trailing.error, control.error);
    assert.deepEqual(trailing.volume.readFileSync("/out.wav"), control.volume.readFileSync("/out.wav"));
  });
}

for (const options of ["map=FL|FR:threads=-1", "map=FL|FR:threads=2147483648",
  "map=FL|FR:thread_type=bad", "map=FL|FR:extra_hw_frames=-2",
  "map=FL|FL", "map=FL", "map=FC|FR", "map=FL|FR:type=bad",
  "map=FL|FR:gain=", "map=FL|FR:gain=:", "FL|FR::type=time",
  "map=FL|FR:gain=NaN", "map=FL|FR:gain=41", "map=FL|FR:size=1", "map=FL|FR:hrir=multich", "map=FL|FR:unknown=1"]) {
  it(`headphone rejects ${options} without replacing output`, async () => {
    const { result, volume } = await render(`headphone=${options}`);
    assert.notEqual(result.exitCode, 0);
    assert.equal(volume.readFileSync("/out.wav", "utf8"), "keep");
  });
}

for (const [invalid, valid, diagnostic] of [
  ["gain=41:gain=0", "gain=6:gain=0", "gain must be between"],
  ["lfe=-21:lfe=0", "lfe=6:lfe=0", "lfe must be between"],
  ["type=bad:type=time", "type=freq:type=time", "invalid processing type"],
  ["size=1:size=1024", "size=2048:size=1024", "invalid frame size"],
  ["hrir=bad:hrir=stereo", "hrir=0:hrir=stereo", "impulse response"],
  ["41:gain=0", "6:gain=0", "gain must be between"]
] as const) {
  it(`headphone rejects an invalid earlier assignment ${invalid}`, async () => {
    const { result, volume, error } = await render(`headphone=map=FL|FR:${invalid}`);
    assert.notEqual(result.exitCode, 0);
    assert.ok(error.includes(diagnostic), error);
    assert.equal(volume.readFileSync("/out.wav", "utf8"), "keep");
  });

  it(`headphone accepts valid repetitions ${valid} and uses the last value`, async () => {
    const actual = await render(`headphone=map=FL|FR:${valid}`);
    const expected = await render("headphone=map=FL|FR:type=time");
    assert.equal(actual.result.exitCode, 0, actual.error);
    assert.equal(expected.result.exitCode, 0, expected.error);
    assert.deepEqual(actual.volume.readFileSync("/out.wav"), expected.volume.readFileSync("/out.wav"));
  });
}
for (const [expression, literal] of [
  ["gain=3+3", "gain=6"], ["type=1-1", "type=0"],
  ["size=2*1024", "size=2048"], ["size=1024.5", "size=1024"],
  ["gain=default", "gain=0"], ["lfe=3+3", "lfe=6"],
  ["lfe=default", "lfe=0"], ["type=default", "type=freq"],
  ["size=default", "size=1024"], ["hrir=default", "hrir=stereo"],
  ["type=0.5", "type=time"], ["hrir=0.5", "hrir=stereo"],
  ["type=freq-1", "type=time"], ["gain=max-34", "gain=6"],
  ["gain=PI-PI", "gain=0"]
]) {
  it(`headphone evaluates ${expression} like ${literal}`, async () => {
    const expected = await render(`headphone=map=FL|FR:${literal}`);
    const actual = await render(`headphone=map=FL|FR:${expression}`);
    assert.equal(expected.result.exitCode, 0, expected.error);
    assert.equal(actual.result.exitCode, 0, actual.error);
    assert.deepEqual(actual.volume.readFileSync("/out.wav"), expected.volume.readFileSync("/out.wav"));
  });
}

for (const option of ["gain=20+21", "lfe=-21", "size=1023.9", "size=96000.1",
  "type=1.1", "type=-0.1", "gain=3+", "gain=1/0", "gain=0/0", "gain=", "hrir=0.6"]) {
  it(`headphone rejects ${option} without replacing output`, async () => {
    const { result, volume } = await render(`headphone=map=FL|FR:${option}`);
    assert.notEqual(result.exitCode, 0);
    assert.equal(volume.readFileSync("/out.wav", "utf8"), "keep");
  });
}
