import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { MediaBudgetTracker, parseWav } from "@poe-code/mp4-ast";
import { boostSubAudio } from "./audio-asubboost.js";
import { createFfmpegCommand } from "./index.js";

const mono = Float64Array.from({ length: 8192 }, (_, i) =>
  Math.round(3500 * Math.sin(2 * Math.PI * 80 * i / 16000) + 1500 * Math.sin(2 * Math.PI * 1000 * i / 16000)) / 32768);

// SHA-256 of decoded PCM16 from the native FFmpeg 7.0.2 reference WAVs.
for (const [filter, hash] of [
  ["anull", "c6cc6173c50dd7a50924614fc455094a0878ca4a0e5dca4597e9af7ffd49b0a0"],
  ["asubboost=boost=4:cutoff=100:feedback=0.4", "cc61dcee06e8443f991f92eae9fe0c8c85704c30958194de1a5a1e497a6821cf"]
]) for (const graph of [false, true]) it(`${filter} matches every native sample (graph=${graph})`, async () => {
  const { volume, result, stderr } = await run(filter!, graph);
  assert.equal(result.exitCode, 0, stderr);
  const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
  assert.equal(audio.sampleRate, 16000);
  assert.equal(audio.channelData.length, 1);
  assert.equal(audio.channelData[0]!.length, 8192);
  const pcm = Buffer.alloc(8192 * 2);
  audio.channelData[0]!.forEach((sample, i) => pcm.writeInt16LE(Math.round(sample * 32768), i * 2));
  assert.equal(createHash("sha256").update(pcm).digest("hex"), hash);
});

for (const [option, exitCode] of [
  ["boost=0", 222], ["cutoff=901", 222], ["feedback=-1", 222], ["dry=2", 222],
  ["wet=NaN", 234], ["decay=2", 222], ["slope=0", 222], ["delay=101", 222],
  ["boost=", 234], ["unknown=1", 8], ["channels=", 234], ["channels=invalid", 234]
] as const) {
  it(`rejects ${option} without replacing output`, async () => {
    const { volume, result } = await run(`asubboost=${option}`);
    assert.equal(result.exitCode, exitCode);
    assert.equal(volume.readFileSync("/out.wav", "utf8"), "KEEP");
  });
}

async function run(filter: string, graph = false, channels = [mono], raw = false) {
  const volume = Volume.fromJSON({ "/out.wav": "KEEP" });
  volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 16000, channels }));
  let stderr = "";
  const result = await createFfmpegCommand({ limits: { maxDurationSeconds: 3 } }).execute({
    args: ["-y", "-v", "error", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-c:a", "pcm_s16le", ...(raw ? ["-f", "s16le"] : []), "/out.wav"],
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

// Entire raw PCM outputs from native FFmpeg 7.0.2, including untouched channels.
for (const [selection, expected] of [
  ["FL", "0000803e0000e02e0000401f0000a00f000060f00000c0e0000020d1000080c1"],
  ["FR", "00800000c0e00000a00f0000e02e0000803e0000e02e0000401f0000a00f0000"],
  ["all", "00".repeat(32)],
  ["LFE", "0080803ec0e0e02ea00f401fe02ea00f803e60f0e02ec0e0401f20d1a00f80c1"]
] as const) for (const graph of [false, true]) it(`selects ${selection} without changing other channels (graph=${graph})`, async () => {
  const channels = [
    [-32768, -8000, 4000, 12000, 16000, 12000, 8000, 4000],
    [16000, 12000, 8000, 4000, -4000, -8000, -12000, -16000]
  ].map(samples => Float64Array.from(samples, sample => sample / 32768));
  const { volume, result, stderr } = await run(`asubboost=wet=0:channels=${selection}`, graph, channels, true);
  assert.equal(result.exitCode, 0, stderr);
  assert.equal((volume.readFileSync("/out.wav") as Buffer).toString("hex"), expected);
});

// Native FFmpeg references also exercise independent channel state and delay wraparound.
for (const [filter, hash] of [
  ["asubboost", "681f3a7371d6c3deda44fd49830c6ef9e9be73d6561b3c9b86b7c82dabd619be"],
  ["asubboost=0.8:0.7:6:0.6:0.4:150:0.8:3.5", "10fd68227ccd56228c5a4729d68c8871d59d2ad0539e9ce31329b029501efbc1"],
  ["asubboost=feedback=0", "4efd0d1372b59ecd509f2597cbbabc4e1324cf3d98d9d7d121bdae4ad1d3fc38"],
  ["volume=0.5,asubboost=decay=0.8:delay=100,areverse", "b42264ea126679ce523e961d24dc86890aa93852300042a51d6878645a5eeb1d"]
] as const) it(`${filter} matches native stereo PCM`, async () => {
  const right = Float64Array.from({ length: mono.length }, (_, i) => ((i * 53) % 12000 - 6000) / 32768);
  const { volume, result, stderr } = await run(filter, false, [mono, right]);
  assert.equal(result.exitCode, 0, stderr);
  const channels = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!.channelData;
  assert.equal(channels.length, 2);
  assert.equal(channels[0]!.length, mono.length);
  const pcm = Buffer.alloc(mono.length * 4);
  for (let i = 0; i < mono.length; i++) {
    for (let c = 0; c < 2; c++) pcm.writeInt16LE(Math.round(channels[c]![i]! * 32768), i * 4 + c * 2);
  }
  assert.equal(createHash("sha256").update(pcm).digest("hex"), hash);
});

it("bounds memory and honors cancellation", async () => {
  await assert.rejects(boostSubAudio([mono], 16000, "asubboost", [{ start: 0, end: mono.length, pts: 0 }], new MediaBudgetTracker({ maxMemoryBytes: 64 })), /maxMemoryBytes/);
  await assert.rejects(boostSubAudio([mono], 16000, "asubboost", [{ start: 0, end: mono.length, pts: 0 }], new MediaBudgetTracker(), AbortSignal.abort()));
});

it("selects speakers from the current channel layout", async () => {
  const right = Float64Array.from(mono, sample => -sample);
  const { volume, result, stderr } = await run("channelmap=map=0|1:channel_layout=FC+LFE,asubboost=wet=0:channels=LFE", false, [mono, right]);
  assert.equal(result.exitCode, 0, stderr);
  const channels = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!.channelData;
  assert.ok(channels[1]!.every(sample => sample === 0));
  assert.ok(channels[0]!.every((sample, i) => sample === mono[i]));
});

it("supports positional selection and explicit speaker names", async () => {
  const output = await boostSubAudio([mono, mono], 16000,
    "asubboost=1:0:2:0:0.9:100:0.5:20:LFE", [{ start: 0, end: mono.length, pts: 0 }], new MediaBudgetTracker(), undefined, ["FC", "LFE"]);
  assert.deepEqual(output[0], mono);
  assert.ok(output[1]!.every(sample => sample === 0));
});

// Native FFmpeg 7.0.2 statuses and complete raw output for eight stereo PCM16 frames.
for (const [option, exitCode] of [
  ["wet=2", 222], ["nope=1", 8], ["delay=bad", 234], ["wet=0.5", 0]
] as const) for (const graph of [false, true]) {
  it(`asubboost=${option} returns native status and preserves output on error (graph=${graph})`, async () => {
    const volume = Volume.fromJSON({ "/out": "KEEP" });
    volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [
      Float64Array.from([-32768, -8000, 4000, 12000, 16000, 12000, 8000, 4000], value => value / 32768),
      Float64Array.from([16000, 12000, 8000, 4000, -4000, -8000, -12000, -16000], value => value / 32768)
    ] }, { bitsPerSample: 16 }));
    const filter = `asubboost=${option}`;
    let stderr = "";
    let writes = 0;
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-v", "error", "-i", "in.wav", ...(graph
        ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-f", "s16le", "out"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { writes++; volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, exitCode, stderr);
    assert.equal((volume.readFileSync("/out") as Buffer).toString("hex"), exitCode === 0
      ? "00c0401f60f07017d007a00f7017d007401f30f8701760f0a00f90e8d007c0e0" : "4b454550");
    if (exitCode !== 0) assert.equal(writes, 0);
  });
}
