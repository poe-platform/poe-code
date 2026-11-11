import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { MediaBudgetTracker, parseWav } from "@poe-code/mp4-ast";
import { listenDynamicEqualizer } from "./audio-adynamicequalizer.js";
import { createFfmpegCommand } from "./index.js";

const input = readFileSync(new URL("./fixtures/adynamicequalizer-input.wav", import.meta.url));
// FFmpeg 7.0.2: -i input.wav -af adynamicequalizer=mode=listen:dfrequency=1000 -c:a pcm_s16le output.wav
const reference = parseWav(readFileSync(new URL("./fixtures/adynamicequalizer-listen.wav", import.meta.url)))
  .tracks[0]!.decodedAudio!;

for (const graph of [false, true]) {
  for (const options of ["mode=listen:dfrequency=1000", "mode=-1", "mode=listen:dqfactor=1",
    "0:1000:1:1000:1:20:200:1:0:50:listen", "0:mode=listen",
    "10:1000:1:2000:2:10:100:3:4:60:-1"]) {
    it(`outputs the native detector band (${graph ? "graph" : "simple"}, ${options})`, async () => {
      const { fs, result, stderr } = await run(`adynamicequalizer=${options}`, graph);
      assert.equal(result.exitCode, 0, stderr);
      const audio = parseWav(fs.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
      assert.equal(audio.sampleRate, 16000);
      assert.equal(audio.channels, 1);
      assert.equal(audio.channelData[0]!.length, 8192);
      assert.deepEqual(audio.channelData, reference.channelData);
    });
  }
}

// Compare decoded PCM so WAV container metadata cannot hide detector differences.
for (const graph of [false, true]) {
  for (const [expression, literal] of [
    ["mode=listen:dfrequency=2k", "mode=listen:dfrequency=2000"],
    ["mode=listen:dfrequency=1000*2", "mode=listen:dfrequency=2000"],
    ["mode=listen:dfrequency=0x10", "mode=listen:dfrequency=16"],
    ["mode=listen:dqfactor=1/2", "mode=listen:dqfactor=0.5"],
    ["mode=-1.0", "mode=listen"],
    ["mode=0-1", "mode=listen"],
    ["mode=listen:dfrequency=1+1", "mode=listen:dfrequency=2"],
    ["mode=listen:dfrequency=1M", "mode=listen:dfrequency=1000000"],
    ["mode=listen:dqfactor=1/1000", "mode=listen:dqfactor=0.001"],
    ["mode=listen:dqfactor=1k", "mode=listen:dqfactor=1000"]
  ]) {
    it(`evaluates detector options (${graph ? "graph" : "simple"}, ${expression})`, async () => {
      const impulse = new Float64Array(32);
      impulse[0] = 32767 / 32768;
      const bytes = encodeWav({ sampleRate: 16000, channels: [impulse] });
      const actual = await run(`adynamicequalizer=${expression}`, graph, bytes);
      const expected = await run(`adynamicequalizer=${literal}`, graph, bytes);
      assert.equal(actual.result.exitCode, 0, actual.stderr);
      assert.equal(expected.result.exitCode, 0, expected.stderr);
      const audio = parseWav(actual.fs.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
      const referenceAudio = parseWav(expected.fs.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
      assert.equal(audio.channelData[0]!.length, 32);
      assert.deepEqual(audio.channelData, referenceAudio.channelData);
      if (literal === "mode=listen:dfrequency=2000") {
        // FFmpeg 7.0.2 PCM16 impulse response starts with these samples.
        assert.deepEqual(Array.from(audio.channelData[0]!.slice(0, 3), sample => sample * 32768), [8559, 8942, -3303]);
      }
    });
  }
}

it("keeps detector history independent for each channel", async () => {
  const mono = parseWav(input).tracks[0]!.decodedAudio!.channelData[0]!;
  const stereo = encodeWav({ sampleRate: 16000, channels: [Float64Array.from(mono), new Float64Array(mono.length)] });
  const { fs, result, stderr } = await run("adynamicequalizer=mode=listen", false, stereo);
  assert.equal(result.exitCode, 0, stderr);
  const audio = parseWav(fs.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
  assert.deepEqual(audio.channelData[0], reference.channelData[0]);
  assert.ok(audio.channelData[1]!.every(sample => sample === 0));
});

for (const filter of ["volume=0,adynamicequalizer=mode=listen", "adynamicequalizer=mode=listen,volume=0"]) {
  it(`preserves filter chain order: ${filter}`, async () => {
    const { fs, result, stderr } = await run(filter);
    assert.equal(result.exitCode, 0, stderr);
    assert.ok(parseWav(fs.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!.channelData[0]!.every(sample => sample === 0));
  });
}

for (const options of ["", "mode=cutbelow", "mode=0", "mode=invalid", "mode=listen:dfrequency=1",
  "mode=listen:dfrequency=1000001", "mode=listen:dfrequency=NaN", "mode=listen:dfrequency=",
  "mode=listen:dfrequency=0b1000", "mode=listen:dfrequency=0o10",
  "mode=listen:dfrequency=1/2", "mode=listen:dfrequency=1M+1", "mode=listen:dfrequency=1/0",
  "mode=listen:dqfactor=0", "mode=listen:dqfactor=1001", "mode=listen:dqfactor=0b10",
  "mode=listen:dqfactor=1/10000", "mode=listen:dqfactor=1k+1", "mode=listen:dqfactor=0/0", "mode=listen:unknown=1", "mode=listen:dftype=lowpass",
"-1:mode=listen", "101:mode=listen", "0:1:mode=listen", "0:1000:0:mode=listen",
  "0:1000:1:1000:1:0:mode=listen", "0::mode=listen",
  "0:1000:1:1000:1:20:200:1:0:50:cutbelow", "0:1000:1:1000:1:20:200:1:0:50:listen:extra"]) {
  it(`rejects unsupported or invalid options without overwriting: ${options}`, async () => {
    const { fs, result, stderr } = await run(`adynamicequalizer${options ? `=${options}` : ""}`);
    assert.equal(result.exitCode, 1);
    assert.match(stderr, /adynamicequalizer/);
    assert.equal(fs.readFileSync("/out.wav", "utf8"), "KEEP");
  });
}

for (const options of ["mode=listen", "0:1000:1:1000:1:20:200:1:0:50:listen", "0:mode=listen"]) {
  it(`matches the native 16 kHz impulse response (${options})`, async () => {
    const impulse = new Float64Array(32);
    impulse[0] = 32767 / 32768;
    const { fs, result, stderr } = await run(`adynamicequalizer=${options}`, false,
      encodeWav({ sampleRate: 16000, channels: [impulse] }));
    assert.equal(result.exitCode, 0, stderr);
    const audio = parseWav(fs.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
    assert.deepEqual(Array.from(audio.channelData[0]!, sample => sample * 32768),
      [5263, 8162, 3825, 392, -1988, -3350, -3846, -3691, -3115, -2325, -1492, -736,
        -129, 300, 553, 653, 638, 547, 414, 272, 140, 33, -44, -91, -111, -110, -96, -74, -49, -26, -8, 6]);
  });
}

async function run(filter: string, graph = false, bytes: Uint8Array = input) {
  const fs = Volume.fromJSON({ "/out.wav": "KEEP" });
  fs.writeFileSync("/in.wav", bytes);
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-c:a", "pcm_s16le", "/out.wav"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return fs.readFileSync(path); },
      async writeFile(path: string, data: Uint8Array) { fs.writeFileSync(path, data); },
      async stat(path: string) { return fs.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
  } as never);
  return { fs, result, stderr };
}

it("bounds detector memory and honors cancellation", async () => {
  const channels = [new Float32Array(32)];
  await assert.rejects(listenDynamicEqualizer(channels, 16000, "adynamicequalizer=mode=listen",
    new MediaBudgetTracker({ maxMemoryBytes: 64 })), /maxMemoryBytes/);
  await assert.rejects(listenDynamicEqualizer(channels, 16000, "adynamicequalizer=mode=listen",
    new MediaBudgetTracker(), AbortSignal.abort()));
});

// FFmpeg 7.0.2 PCM16 responses to a single 32767 sample followed by silence.
for (const [rate, options, expected] of [
  [48000, "dfrequency=2000:dqfactor=2.5", [1613, 2962, 2374, 1690, 964, 247, -416, -986, -1436, -1749, -1918, -1946, -1845, -1635, -1339, -985, -603, -219, 141, 457, 712, 896, 1003, 1035, 997, 898, 751, 569, 368, 164, -31, -205]],
  [32000, "dfrequency=80:dqfactor=0.7", [364, 719, 703, 687, 671, 655, 640, 624, 609, 594, 580, 565, 551, 537, 523, 509, 495, 482, 469, 456, 443, 430, 417, 405, 393, 381, 369, 357, 346, 334, 323, 312]],
  [16000, "dfrequency=1000000", Array<number>(32).fill(0)]
] as const) {
  it(`matches native impulse response at ${rate} Hz (${options})`, async () => {
    const impulse = new Float64Array(32);
    impulse[0] = 32767 / 32768;
    const { fs, result, stderr } = await run(`adynamicequalizer=mode=listen:${options}`, false,
      encodeWav({ sampleRate: rate, channels: [impulse] }));
    assert.equal(result.exitCode, 0, stderr);
    const audio = parseWav(fs.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
    assert.equal(audio.sampleRate, rate);
    assert.deepEqual(Array.from(audio.channelData[0]!, sample => sample * 32768), expected);
  });
}
