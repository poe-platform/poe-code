import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { normalizeLoudness } from "./audio-loudnorm.js";
import { MediaBudgetTracker, parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

for (const [filter, peak, hash] of [
  ["anull", 3200, "09c0bea63d4c839df5848548a90ce0795656c66b100e44fa146bae04b8c7ce35"],
  ["aresample=192000", 3218, "648ed4129c6cba79b0640eb2d38616fcabd332a4eece6c94f9e780988135ff58"],
  // Default-target PCM rounding varies between native builds; check its peak
  // and first samples below instead of requiring a byte-identical hash.
  ["loudnorm", 26029, null],
  ["loudnorm=TP=-1", 29205, "9a950b39fda200b4a4e16c5ebed8cc70b31d2bb6ba52eb2251f78d38d933eddf"],
  ["loudnorm=TP=-6", 16423, "bf40c58ce15d09de1e638328a189c226ae9826217310d430ee2b30f8fee9219a"]
] as const) {
  it(`matches native FFmpeg 7.0.2 PCM for a 4 ms mono ramp with ${filter}`, async () => {
    const input = Float64Array.from({ length: 32 }, (_, i) => (i + 1) * 100 / 32768);
    const { volume, result, stderr } = await run([input], filter, false, 8000, false);
    assert.equal(result.exitCode, 0, stderr);
    const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
    assert.equal(audio.sampleRate, filter === "anull" ? 8000 : 192000);
    assert.equal(audio.channelData.length, 1);
    const samples = audio.channelData[0]!;
    assert.equal(samples.length, filter === "anull" ? 32 : 768);
    const pcm = Buffer.alloc(samples.length * 2);
    for (let i = 0; i < samples.length; i++) pcm.writeInt16LE(Math.round(samples[i]! * 32768), i * 2);
    assert.equal(Math.max(...samples.map(sample => Math.abs(sample * 32768))), peak);
    if (hash) assert.equal(createHash("sha256").update(pcm).digest("hex"), hash);
    else assert.deepEqual(Array.from({ length: 4 }, (_, i) => pcm.readInt16LE(i * 2)), [809, 811, 817, 826]);
  });
}

// Native FFmpeg 7.0.2 and 9.0.1 agree on these stereo square-wave fixtures.
for (const kind of ["mix", "same", "inverse"]) for (const target of [-16, -23]) {
  it(`loudnorm normalizes ${kind} stereo to ${target} and reports measured output`, async () => {
    const channels = [new Float64Array(144000), new Float64Array(144000)];
    for (let i = 0; i < 144000; i++) {
      const s = i % 48 < 24 ? 0.125 : -0.125;
      channels[0]![i] = i < 96000 ? s : 0;
      channels[1]![i] = kind === "mix" ? (i < 48000 ? 0 : -2 * s) : kind === "same" ? s : -s;
    }
    const { volume, result, stderr } = await run(channels,
      `loudnorm=I=${target}:TP=-1.5:LRA=11:print_format=json`, kind === "inverse");
    assert.equal(result.exitCode, 0, stderr);
    const report = JSON.parse(stderr.slice(stderr.indexOf("{"), stderr.lastIndexOf("}") + 1));
    assert.equal(report.input_i, kind === "mix" ? "-11.92" : "-15.04");
    assert.equal(report.output_i, (target + (kind === "mix" ? 0.1 : 0.01)).toFixed(2));
    assert.equal(report.input_lra, kind === "mix" ? "0.20" : "0.10");
    assert.equal(report.output_lra, "0.00");
    assert.equal(report.input_tp, kind === "mix" ? "-9.98" : "-16.00");
    assert.equal(report.output_tp, (target + (kind === "mix" ? 2.07 : -0.94)).toFixed(2));
    assert.equal(report.input_thresh, kind === "mix" ? "-21.92" : "-25.04");
    assert.equal(report.output_thresh, (target - (kind === "mix" ? 9.9 : 9.99)).toFixed(2));
    assert.equal(report.target_offset, kind === "mix" ? "-0.10" : "-0.01");
    assert.equal(report.normalization_type, "dynamic");
    const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
    assert.equal(audio.sampleRate, 48000);
    assert.equal(audio.channelData.length, 2);
    assert.equal(audio.channelData[0]!.length, 144000);
    let peak = 0;
    for (const channel of audio.channelData) for (const sample of channel) peak = Math.max(peak, Math.abs(sample * 32768));
    assert.equal(peak, kind === "mix" ? (target === -16 ? 5448 : 2433) : (target === -16 ? 3852 : 1721));
    assert.equal(Math.round(audio.channelData[0]![0]! * 32768),
      kind === "mix" ? (target === -16 ? 2599 : 1161) : (target === -16 ? 3675 : 1642));
    for (let i = 0; i < 95900; i++) {
      if (kind !== "mix") assert.equal(audio.channelData[0]![i], audio.channelData[1]![i]! * (kind === "same" ? 1 : -1));
    }
  });
}

for (const option of ["I=-71", "I=-4", "TP=1", "LRA=0", "I=NaN", "I=", "TP=-1=2", "unknown=1", "print_format=csv", "measured_I=-20"]) {
  it(`rejects loudnorm=${option} without replacing output`, async () => {
    const { volume, result } = await run([new Float64Array(48)], `loudnorm=${option}`);
    assert.equal(result.exitCode, 1);
    assert.equal(volume.readFileSync("/out.wav", "utf8"), "keep");
  });
}

for (const length of [1, 4800, 144000]) {
  it(`matches native silence output for ${length} input frames`, async () => {
    const { volume, result, stderr } = await run([new Float64Array(length)], "loudnorm=print_format=json");
    assert.equal(result.exitCode, 0, stderr);
    const report = JSON.parse(stderr.slice(stderr.indexOf("{"), stderr.lastIndexOf("}") + 1));
    assert.equal(report.input_i, "-inf");
    assert.equal(report.output_i, "-inf");
    assert.equal(report.output_tp, "-inf");
    const output = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
    // One input sample cannot fill SWR's startup filter, even after flushing.
    assert.deepEqual(output.channelData[0], new Float32Array(length === 1 ? 0 : length));
  });
}

it("bounds oversampling memory and honors cancellation", async () => {
  const input = [new Float64Array(4800)];
  await assert.rejects(normalizeLoudness(input, 48000, "", new MediaBudgetTracker({ maxMemoryBytes: 64 })), /maxMemoryBytes/);
  await assert.rejects(normalizeLoudness(input, 48000, "", new MediaBudgetTracker(), AbortSignal.abort()));
});

it("limits true peaks when the requested loudness would exceed the ceiling", async () => {
  const input = [Float64Array.from({ length: 48000 }, (_, i) => i % 48 < 24 ? 0.25 : -0.25)];
  const result = await normalizeLoudness(input, 48000, "I=-5:TP=-9:print_format=json", new MediaBudgetTracker());
  const report = JSON.parse(result.report);
  assert.equal(report.normalization_type, "linear");
  assert.equal(report.output_tp, "-9.00");
  for (const sample of result.channels[0]!) assert.ok(Number.isFinite(sample) && Math.abs(sample) <= 10 ** (-9 / 20) + 1e-12);
});

it("matches native dynamic loudness reports across a four-second level change", async () => {
  const samples = Float64Array.from({ length: 192000 }, (_, i) =>
    (i % 48 < 24 ? 1 : -1) * (i < 96000 ? 0.125 : 0.25));
  const { report } = await normalizeLoudness([samples], 48000,
    "i=-16:tp=-1.5:lra=11:print_format=json", new MediaBudgetTracker());
  assert.deepEqual(JSON.parse(report), {
    input_i: "-12.87", input_tp: "-9.98", input_lra: "1.90", input_thresh: "-22.87",
    output_i: "-15.01", output_tp: "-11.71", output_lra: "1.80", output_thresh: "-25.01",
    normalization_type: "dynamic", target_offset: "-0.99"
  });
});

async function run(input: Float64Array[], filter: string, graph = false, sampleRate = 48000, forceRate = true) {
  const volume = Volume.fromJSON({ "/out.wav": "keep" });
  volume.writeFileSync("/in.wav", encodeWav({ sampleRate, channels: input }));
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "info", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), ...(forceRate ? ["-ar", "48000"] : []), "-c:a", "pcm_s16le", "/out.wav"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { volume, result, stderr };
}
