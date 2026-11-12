import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { psychoacousticClip } from "./audio-apsyclip.js";
import { MediaBudgetTracker, parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg PCM16 references for quiet/loud/quiet transitions.
for (const [filter, length, scales, indices, expected, sampleRate, sine] of [
  ["apsyclip=clip=0.2", 7200, [1, -0.25], [0, 6, 191, 192, 599, 600, 791, 792, 997, 1024, 2199, 2200, 2392, 3000, 3799, 3992, 4792, 6392, 7199], [[0, 0, 0, 0, 0, 0, 0, 400, -400, 400, -394, 393, 6605, 6354, -6425, 1515, 4000, 0, 0], [0, 0, 0, 0, 0, 0, 0, -100, 100, -100, 100, -100, -3000, -3000, 3000, 0, -1000, 0, 0]], 8000, false],
  ["apsyclip=1:0.5:0.2:1:0:3:1", 7200, [1], [0, 6, 191, 192, 599, 600, 791, 792, 997, 1024, 2199, 2200, 2392, 3000, 3799, 3992, 4792, 6392, 7199], [[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, -3, -2710, -2257, 2279, 505, 0, 0, 0]], 8000, false],
  ["apsyclip=clip=0.2:adaptive=1:iterations=20", 7200, [1], [0, 6, 191, 192, 599, 600, 791, 792, 997, 1024, 2199, 2200, 2392, 3000, 3799, 3992, 4792, 6392, 7199], [[0, 0, 0, 0, 0, 0, 0, 400, -400, 400, -400, 400, 6554, 6554, -6554, -2037, 4000, 0, 0]], 48000, false],
  ["apsyclip=clip=0.2", 7200, [1], [0, 6, 191, 192, 599, 600, 791, 792, 997, 1024, 2199, 2200, 2392, 3000, 3799, 3992, 4792, 6392, 7199], [[0, 0, 0, 0, 0, 0, 0, 0, -400, 400, -400, 400, 400, 6554, -6554, 6553, 0, 4000, 0]], 96000, false],
  ["apsyclip=clip=0.2", 7200, [1], [0, 6, 191, 192, 599, 600, 791, 792, 997, 1024, 2199, 2200, 2392, 3000, 3799, 3992, 4792, 6392, 7199], [[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, -400, 400, 400, 6530, -6554, 6554, 0, 4000, 0]], 192000, false],
  ["apsyclip", 7, [1], [0, 6], [[0, 0]], 8000, false],
  ["apsyclip=level_in=2:clip=0.2:level=true", 997, [1], [0, 6, 191, 192, 599, 600, 791, 792], [[0, 0, 0, 0, 0, 0, 0, 4000]], 8000, false],
  ["apsyclip=clip=0.2", 7200, [1], [2000, 2037, 2074, 2111, 2148, 2185, 2222, 2259, 2296, 2333, 2370, 2407, 2444, 2481, 2518, 2555, 2592, 2629, 2666, 2703, 2740, 2777, 2814, 2851, 2888, 2925, 2962, 2999, 3036, 3073, 3110, 3147, 3184, 3221, 3258, 3295, 3332, 3369, 3406, 3443, 3480, 3517, 3554, 3591, 3628, 3665, 3702, 3739, 3776, 3813, 3850, 3887, 3924, 3961, 3998], [[383, 72, -317, -362, -13, 350, 343, -26, -325, -239, 106, 6583, 4413, -2655, -6631, -3417, 3524, 6641, 2538, -4316, -6490, -1612, 5015, 6194, 641, -5608, -5760, 339, 6071, 5212, -1317, -6415, -4538, 2261, 6600, 3779, -3156, -6664, -2926, 3989, 6562, 2017, -4722, -6345, -1058, 5371, 5959, 84, -5879, -5477, 891, 6420, 4915, -2156, -1037]], 48000, true]
] as const) for (const graph of [false, true]) it(`${filter}, ${length} samples follows changing levels (${graph ? "graph" : "simple"})`, async () => {
  const fs = Volume.fromJSON({});
  const samples = Float64Array.from({ length }, (_, i) => {
    const amplitude = i < 600 ? 0 : i < 2200 ? 400 : i < 3800 ? 12000 : i < 4600 ? 0 : i < 6200 ? 4000 : 0;
    return (sine ? Math.round(amplitude * Math.sin(i * 0.31)) : i % 2 ? -amplitude : amplitude) / 32768;
  });
  fs.writeFileSync("/in.wav", encodeWav({ sampleRate, channels: scales.map(scale => samples.map(value => value * scale)) }));
  const errors: Uint8Array[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-i", "/in.wav", ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-c:a", "pcm_s16le", "/out.wav"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
    stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write(b: Uint8Array) { errors.push(b); } }
  } as never);
  assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
  const audio = parseWav(fs.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
  assert.equal(audio.sampleRate, sampleRate);
  assert.equal(audio.channelData.length, scales.length);
  for (const [c, channel] of audio.channelData.entries()) {
    assert.equal(channel.length, length);
    indices.forEach((position, i) => assert.ok(Math.abs(channel[position]! * 32768 - expected[c]![i]!) <= 1,
      `channel ${c}, sample ${position}: ${channel[position]! * 32768}, expected ${expected[c]![i]}`));
  }
});

for (const filter of ["apsyclip=clip=0", "apsyclip=clip=1.1", "apsyclip=adaptive=-1", "apsyclip=adaptive=2", "apsyclip=iterations=0", "apsyclip=iterations=21", "apsyclip=iterations=1.5", "apsyclip=level_in=0", "apsyclip=level_out=65", "apsyclip=clip=NaN", "apsyclip=clip=", "apsyclip=diff=2", "apsyclip=level=bad", "apsyclip=unknown=1"]) {
  it(`${filter} fails without replacing output`, async () => {
    const fs = Volume.fromJSON({ "/out.wav": "keep" });
    fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [new Float64Array([0.25])] }));
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-i", "/in.wav", "-af", filter, "/out.wav"], cwd: "/", env: {}, signal: new AbortController().signal,
      fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
      stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} }
    } as never);
    assert.equal(result.exitCode, 1);
    assert.equal(fs.readFileSync("/out.wav", "utf8"), "keep");
  });
}

it("bounds clipping workspace and honors cancellation", async () => {
  const channels = [new Float32Array(32)];
  await assert.rejects(psychoacousticClip(channels, 44100, "apsyclip",
    new MediaBudgetTracker({ maxMemoryBytes: 65536 })), /maxMemoryBytes/);
  await assert.rejects(psychoacousticClip(channels, 44100, "apsyclip",
    new MediaBudgetTracker(), AbortSignal.abort()));
});

for (const inputSize of [7, 64, 128]) for (const [selection, bytes, hash] of [
  [",aselect=eq(n\\,0)", 128, "38723a2e5e8a17aa7950dc008209944e898f69a7bd10a23c839d341e935fd5ca"],
  [",aselect=eq(n\\,8)", 6, "dc1ab5ae8a9f3186c99e16cfe9f85ea8f4ddcd817c180dca984d1f2b09ea03fb"],
  ["", 1030, "cf2ed9698023fde697a5b4708e01463f4fe3e2ba837402eb4a400da1d696cf3f"]
] as const) it(`apsyclip exposes native output blocks after ${inputSize}-sample input frames ${selection}`, async () => {
  // FFmpeg 7.0.2 references include the short final output frame and unselected PCM.
  for (let repeat = 0; repeat < 3; repeat++) {
    const input = Buffer.alloc(515 * 2);
    for (let i = 0; i < 515; i++) input.writeInt16LE((i * 557) % 14001 - 7000, i * 2);
    const fs = Volume.fromJSON({ "/in.raw": input });
    const output: Uint8Array[] = [], errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
        "-af", `asetnsamples=n=${inputSize}:p=0,apsyclip@c=iterations=1${selection}`, "-f", "s16le", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
      stdin: (async function* () {})(), stdout: { async write(b: Uint8Array) { output.push(b); } }, stderr: { async write(b: Uint8Array) { errors.push(b); } }
    } as never);
    assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
    const pcm = Buffer.concat(output);
    assert.equal(pcm.length, bytes);
    assert.equal(createHash("sha256").update(pcm).digest("hex"), hash);
  }
});
