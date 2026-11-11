import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { softClipAudio } from "./audio-asoftclip.js";
import { MediaBudgetTracker, parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

const input = [0, 8192, 16384, 24576, 32767, 24576, 16384, 8192, 0, -8192, -16384, -24576, -32768, -24576, -16384, -8192];
// Signed PCM16 references from native FFmpeg.
for (const [filter, expected] of [
  ["anull", input],
  ["asoftclip=type=hard", [0, 8192, 16384, 24576, 32767, 24576, 16384, 8192, 0, -8192, -16384, -24576, -32768, -24576, -16384, -8192]],
  ["asoftclip=type=-1", [0, 8192, 16384, 24576, 32767, 24576, 16384, 8192, 0, -8192, -16384, -24576, -32768, -24576, -16384, -8192]],
  ["asoftclip=type=hard:threshold=0.25:output=0.5:param=2", [0, 4096, 4096, 4096, 4096, 4096, 4096, 4096, 0, -4096, -4096, -4096, -4096, -4096, -4096, -4096]],
  ["asoftclip=type=-1:threshold=0.25:output=0.5:param=2", [0, 4096, 4096, 4096, 4096, 4096, 4096, 4096, 0, -4096, -4096, -4096, -4096, -4096, -4096, -4096]],
  ["asoftclip=type=tanh", [0, 8025, 15143, 20813, 24955, 20813, 15143, 8025, 0, -8025, -15143, -20813, -24956, -20813, -15143, -8025]],
  ["asoftclip=type=0", [0, 8025, 15143, 20813, 24955, 20813, 15143, 8025, 0, -8025, -15143, -20813, -24956, -20813, -15143, -8025]],
  ["asoftclip=type=tanh:threshold=0.25:output=0.5:param=2", [0, 3949, 4093, 4096, 4096, 4096, 4093, 3949, 0, -3949, -4093, -4096, -4096, -4096, -4093, -3949]],
  ["asoftclip=type=0:threshold=0.25:output=0.5:param=2", [0, 3949, 4093, 4096, 4096, 4096, 4093, 3949, 0, -3949, -4093, -4096, -4096, -4096, -4093, -3949]],
  ["asoftclip=type=atan", [0, 5110, 9672, 13424, 16384, 13424, 9672, 5110, 0, -5110, -9672, -13424, -16384, -13424, -9672, -5110]],
  ["asoftclip=type=1", [0, 5110, 9672, 13424, 16384, 13424, 9672, 5110, 0, -5110, -9672, -13424, -16384, -13424, -9672, -5110]],
  ["asoftclip=type=atan:threshold=0.25:output=0.5:param=2", [0, 2887, 3457, 3665, 3772, 3665, 3457, 2887, 0, -2887, -3457, -3665, -3772, -3665, -3457, -2887]],
  ["asoftclip=type=1:threshold=0.25:output=0.5:param=2", [0, 2887, 3457, 3665, 3772, 3665, 3457, 2887, 0, -2887, -3457, -3665, -3772, -3665, -3457, -2887]],
  ["asoftclip=type=cubic", [0, 8116, 15777, 22529, 27915, 22529, 15777, 8116, 0, -8116, -15777, -22529, -27915, -22529, -15777, -8116]],
  ["asoftclip=type=2", [0, 8116, 15777, 22529, 27915, 22529, 15777, 8116, 0, -8116, -15777, -22529, -27915, -22529, -15777, -8116]],
  ["asoftclip=type=cubic:threshold=0.25:output=0.5:param=2", [0, 3489, 4096, 4096, 4096, 4096, 4096, 3489, 0, -3489, -4096, -4096, -4096, -4096, -4096, -3489]],
  ["asoftclip=type=2:threshold=0.25:output=0.5:param=2", [0, 3489, 4096, 4096, 4096, 4096, 4096, 3489, 0, -3489, -4096, -4096, -4096, -4096, -4096, -3489]],
  ["asoftclip=type=exp", [0, 8025, 15143, 20813, 24955, 20813, 15143, 8025, 0, -8025, -15143, -20813, -24956, -20813, -15143, -8025]],
  ["asoftclip=type=3", [0, 8025, 15143, 20813, 24955, 20813, 15143, 8025, 0, -8025, -15143, -20813, -24956, -20813, -15143, -8025]],
  ["asoftclip=type=exp:threshold=0.25:output=0.5:param=2", [0, 3119, 3949, 4076, 4093, 4076, 3949, 3119, 0, -3119, -3949, -4076, -4093, -4076, -3949, -3119]],
  ["asoftclip=type=3:threshold=0.25:output=0.5:param=2", [0, 3119, 3949, 4076, 4093, 4076, 3949, 3119, 0, -3119, -3949, -4076, -4093, -4076, -3949, -3119]],
  ["asoftclip=type=alg", [0, 7947, 14654, 19661, 23170, 19661, 14654, 7947, 0, -7947, -14654, -19661, -23170, -19661, -14654, -7947]],
  ["asoftclip=type=4", [0, 7947, 14654, 19661, 23170, 19661, 14654, 7947, 0, -7947, -14654, -19661, -23170, -19661, -14654, -7947]],
  ["asoftclip=type=alg:threshold=0.25:output=0.5:param=2", [0, 2365, 3344, 3705, 3862, 3705, 3344, 2365, 0, -2365, -3344, -3705, -3862, -3705, -3344, -2365]],
  ["asoftclip=type=4:threshold=0.25:output=0.5:param=2", [0, 2365, 3344, 3705, 3862, 3705, 3344, 2365, 0, -2365, -3344, -3705, -3862, -3705, -3344, -2365]],
  ["asoftclip=type=quintic", [0, 8189, 16300, 23939, 30083, 23939, 16300, 8189, 0, -8189, -16300, -23939, -30084, -23939, -16300, -8189]],
  ["asoftclip=type=5", [0, 8189, 16300, 23939, 30083, 23939, 16300, 8189, 0, -8189, -16300, -23939, -30084, -23939, -16300, -8189]],
  ["asoftclip=type=quintic:threshold=0.25:output=0.5:param=2", [0, 3760, 4096, 4096, 4096, 4096, 4096, 3760, 0, -3760, -4096, -4096, -4096, -4096, -4096, -3760]],
  ["asoftclip=type=5:threshold=0.25:output=0.5:param=2", [0, 3760, 4096, 4096, 4096, 4096, 4096, 3760, 0, -3760, -4096, -4096, -4096, -4096, -4096, -3760]],
  ["asoftclip=type=sin", [0, 8107, 15710, 22336, 27573, 22336, 15710, 8107, 0, -8107, -15710, -22336, -27573, -22336, -15710, -8107]],
  ["asoftclip=type=6", [0, 8107, 15710, 22336, 27573, 22336, 15710, 8107, 0, -8107, -15710, -22336, -27573, -22336, -15710, -8107]],
  ["asoftclip=type=sin:threshold=0.25:output=0.5:param=2", [0, 3447, 4096, 4096, 4096, 4096, 4096, 3447, 0, -3447, -4096, -4096, -4096, -4096, -4096, -3447]],
  ["asoftclip=type=6:threshold=0.25:output=0.5:param=2", [0, 3447, 4096, 4096, 4096, 4096, 4096, 3447, 0, -3447, -4096, -4096, -4096, -4096, -4096, -3447]],
  ["asoftclip=type=erf", [0, 9055, 17056, 23303, 27613, 23303, 17056, 9055, 0, -9055, -17056, -23303, -27614, -23303, -17056, -9055]],
  ["asoftclip=type=7", [0, 9055, 17056, 23303, 27613, 23303, 17056, 9055, 0, -9055, -17056, -23303, -27614, -23303, -17056, -9055]],
  ["asoftclip=type=erf:threshold=0.25:output=0.5:param=2", [0, 3452, 4077, 4096, 4096, 4096, 4077, 3452, 0, -3452, -4077, -4096, -4096, -4096, -4077, -3452]],
  ["asoftclip=type=7:threshold=0.25:output=0.5:param=2", [0, 3452, 4077, 4096, 4096, 4096, 4077, 3452, 0, -3452, -4077, -4096, -4096, -4096, -4077, -3452]],
  ["asoftclip", [0, 8025, 15143, 20813, 24955, 20813, 15143, 8025, 0, -8025, -15143, -20813, -24956, -20813, -15143, -8025]],
  ["asoftclip=type=tanh:threshold=0.5", [0, 7571, 12478, 14830, 15795, 14830, 12478, 7571, 0, -7571, -12478, -14830, -15795, -14830, -12478, -7571]],
  ["asoftclip=0:0.5:0.5:2:1", [0, 6239, 7897, 8151, 8187, 8151, 7897, 6239, 0, -6239, -7897, -8151, -8187, -8151, -7897, -6239]]
] as const) for (const graph of [false, true]) {
  it(`${filter} matches native signed PCM (${graph ? "graph" : "simple"})`, async () => {
    const { fs, result, stderr } = await run(filter, graph);
    assert.equal(result.exitCode, 0, stderr);
    const audio = parseWav(fs.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
    assert.equal(audio.sampleRate, 8000);
    assert.equal(audio.channelData.length, 2);
    for (const [c, channel] of audio.channelData.entries()) {
      assert.equal(channel.length, 8000);
      for (let i = 0; i < channel.length; i++) {
        assert.equal(Math.round(channel[i]! * 32768), expected[(i + c * 8) % input.length]);
      }
    }
  });
}

for (const [expression, literal] of [
  ["type=atan+1", "type=cubic"],
  ["type=2.0", "type=cubic"],
  ["type=1.5", "type=cubic"],
  ["type=2.5", "type=cubic"],
  ["type=-0.5", "type=tanh"],
  ["type=default", "type=tanh"],
  ["type=min", "type=hard"],
  ["type=max", "type=erf"],
  ["atan+1", "cubic"],
  ["type=erf-sin+atan", "type=cubic"],
  ["threshold=1/2", "threshold=0.5"],
  ["output=1/2", "output=0.5"],
  ["param=1+1", "type=tanh:param=2"],
  ["0:1/2:1/2:1+1:1", "0:0.5:0.5:2:1"],
  ["threshold=1/1000000:output=1/1000000:param=1/100", "threshold=0.000001:output=0.000001:param=0.01"],
  ["threshold=2/2:output=8*2:param=1+2", "threshold=1:output=16:param=3"]
] as const) for (const graph of [false, true]) {
  it(`asoftclip=${expression} matches its literal control (${graph ? "graph" : "simple"})`, async () => {
    const actual = await run(`asoftclip=${expression}`, graph);
    const control = await run(`asoftclip=${literal}`, graph);
    assert.equal(control.result.exitCode, 0, control.stderr);
    assert.equal(actual.result.exitCode, 0, actual.stderr);
    assert.deepEqual(actual.fs.readFileSync("/out.wav"), control.fs.readFileSync("/out.wav"));
  });
}

// Complete raw PCM16 output from FFmpeg 7.0.2 for the eight-sample regression.
for (const [oversample, hex] of [
  [1, "0000591fa7e0273bd9c44d51b3ae0000"],
  [2, "00000603a70d98f09820c4dddb3152c1"],
  [3, "00004301da10faecf9240dd9103824c1"],
  [4, "0000a900dc11feeb3726d5d7da39abc1"],
  [64, "00000000c0123feb1f270fd7463be8c2"]
] as const) for (const graph of [false, true]) {
  it(`asoftclip oversample=${oversample} matches native raw PCM (${graph ? "graph" : "simple"})`, async () => {
    const channels = [Float64Array.from([0, 8192, -8192, 16384, -16384, 24576, -24576, 0], n => n / 32768)];
    const { fs, result, stderr } = await run(`asoftclip=oversample=${oversample}`, graph, channels, true);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal((fs.readFileSync("/out.wav") as Buffer).toString("hex"), hex);
  });
}

for (const [filter, hash] of [
  ["asoftclip=oversample=2", "db013287e6e97c36655466df0159e264936ae9a74061c92fc31e69c33cf0278c"],
  ["asoftclip=oversample=4", "191008e0881afcfe6f15d2ce5213edffb416bc2acffd1880e080ded1645d028d"],
  ["aformat=sample_fmts=dblp,asoftclip=oversample=64", "1160b4cd0e5fd645fe35a4ea425ce79611f887d1417999513a5a7ee1c948c000"],
  ["asoftclip=0:0.5:0.5:2:3", "ef21994ffddf2058755218fc1fedb67add944b0d7343a7d4ab092b70025e3d27"]
] as const) {
  it(`${filter} preserves stereo state across frames`, async () => {
    const { fs, result, stderr } = await run(filter);
    assert.equal(result.exitCode, 0, stderr);
    const audio = parseWav(fs.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
    assert.equal(audio.sampleRate, 8000);
    assert.equal(audio.channelData.length, 2);
    const pcm = Buffer.alloc(8000 * 2 * 2);
    for (const [c, channel] of audio.channelData.entries()) {
      assert.equal(channel.length, 8000);
      for (let i = 0; i < channel.length; i++) pcm.writeInt16LE(Math.round(channel[i]! * 32768), (i * 2 + c) * 2);
    }
    assert.equal(createHash("sha256").update(pcm).digest("hex"), hash);
  });
}

for (const filter of ["asoftclip=threshold=0", "asoftclip=threshold=1.1", "asoftclip=threshold=NaN", "asoftclip=threshold=", "asoftclip=output=17", "asoftclip=param=0", "asoftclip=param=4", "asoftclip=type=unknown", "asoftclip=type=8", "asoftclip=type=-2", "asoftclip=type=", "asoftclip=oversample=0", "asoftclip=oversample=65", "asoftclip=oversample=1.5", "asoftclip=oversample=NaN", "asoftclip=oversample=", "asoftclip=unknown=1",
  "asoftclip=threshold=1/2000000", "asoftclip=threshold=1+1", "asoftclip=output=1/2000000", "asoftclip=output=16+1",
  "asoftclip=param=1/200", "asoftclip=param=3+1", "asoftclip=threshold=1/0", "asoftclip=output=0/0", "asoftclip=param=1+",
  "asoftclip=type=7.1", "asoftclip=type=-1.1", "asoftclip=type=erf+1", "asoftclip=type=1/0", "asoftclip=type=0/0", "asoftclip=type=atan+"]) {
  it(`${filter} fails without replacing output`, async () => {
    const { fs, result } = await run(filter);
    assert.equal(result.exitCode, 1);
    assert.equal(fs.readFileSync("/out.wav", "utf8"), "keep");
  });
}

async function run(filter: string, graph = false,
  channels = [0, 8].map(offset => Float64Array.from({ length: 8000 }, (_, i) => input[(i + offset) % input.length]! / 32768)),
  raw = false
) {
  const fs = Volume.fromJSON({ "/out.wav": "keep" });
  fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels }));
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-c:a", "pcm_s16le", ...(raw ? ["-f", "s16le"] : []), "/out.wav"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return fs.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
      async stat(path: string) { return fs.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { fs, result, stderr };
}

for (const oversample of [1, 64]) it(`bounds clipping memory and honors cancellation at oversample=${oversample}`, async () => {
  const channels = [new Float32Array(32)];
  await assert.rejects(softClipAudio(channels, 8000, `asoftclip=oversample=${oversample}`, [{ start: 0, end: 32, pts: 0 }], "fltp",
    new MediaBudgetTracker({ maxMemoryBytes: 128 })), /maxMemoryBytes/);
  await assert.rejects(softClipAudio(channels, 8000, `asoftclip=oversample=${oversample}`, [{ start: 0, end: 32, pts: 0 }], "fltp",
    new MediaBudgetTracker(), AbortSignal.abort()));
});
