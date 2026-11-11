import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

// Reference PCM16 values from native FFmpeg; indices include envelope transitions.
for (const [filter, indices, expected] of [
  ["compand", [0, 4000, 8000, 8010, 12000, 16000, 20000, 24000, 28000, 31999], [482, 726, 8703, -8709, 10793, 24945, 24945, 1559, 2290, -3277]],
  ["compand=points=-70/-70abc|-60/-20|1/0", [0, 4000, 8000, 8010, 12000, 16000, 20000, 24000, 28000, 31999], [482, 726, 8703, -8709, 10793, 24945, 24945, 1559, 2290, -3277]],
  ["compand=attacks=0.01s:decays=1e-1seconds:points=-80/-80|-40/-40|-20/-30|0/-20:volume=-20", [0, 4000, 8000, 8010, 12000, 16000, 20000, 24000, 28000, 31999], [158, 397, 3106, -2350, 1145, 4496, 2290, 143, 546, -572]],
  ["compand=attacks=0.01:decays=0.1:points=-80/-80|-40/-40|-20/-30|0/-20:volume=-20", [0, 4000, 8000, 8010, 12000, 16000, 20000, 24000, 28000, 31999], [158, 397, 3106, -2350, 1145, 4496, 2290, 143, 546, -572]],
  ["compand=attacks=0:decays=0:points=-80/-80|-40/-40|-20/-30|0/-20:soft-knee=6", [4000, 12000, 20000, 28000], [395, 1145, 2290, 572]],
  ["compand=attacks=0:decays=0:points=-80/-80|-40/-40|-20/-30|0/-20", [4000, 12000, 20000, 28000, 31999], [405, 1145, 2290, 572, -572]],
  ["compand=0:0:-80/-80|-40/-40|-20/-30|0/-20,volume=0.5", [4000, 12000, 20000, 28000], [202, 572, 1145, 286]],
  ["compand=attacks=0:decays=0:points=-80/-80|0/0:gain=-6.020599913", [4000, 12000, 20000, 28000], [250, 2000, 8000, 500]]
] as const) {
  for (const graph of [false, true]) it(`${filter} (${graph ? "graph" : "simple"})`, async () => {
    const fs = Volume.fromJSON({});
    fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: Array.from({ length: 2 }, (_, c) =>
      Float64Array.from({ length: 32000 }, (_, i) => (c ? -1 : 1) * (i % 16 < 8 ? 1 : -1) * [500, 4000, 16000, 1000][Math.floor(i / 8000)]! / 32768))
    }));
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-i", "/in.wav", ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-c:a", "pcm_s16le", "/out.wav"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
      stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write(b: Uint8Array) { errors.push(b); } }
    } as never);
    assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
    const audio = parseWav(fs.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
    assert.equal(audio.sampleRate, 8000);
    for (const [c, channel] of audio.channelData.entries()) {
      assert.equal(channel.length, 32000);
      indices.forEach((position, i) => assert.ok(Math.abs(channel[position]! * 32768 - expected[i]! * (c ? -1 : 1)) <= 1,
        `channel ${c}, sample ${position}: ${channel[position]! * 32768}`));
    }
  });
}

for (const [filter, exitCode, output] of [
  ["compand=points=bad", 234, ""], ["compand=points=0/0|-20/-30", 234, ""],
  ["compand=points=-70/|-60/-20|1/0", 234, ""], ["compand=points=/-70|-60/-20|1/0", 1, "keep"],
  ["compand=points=-70abc/-70|-60/-20|1/0", 1, "keep"],
  ["compand=attacks=-1", 234, ""], ["compand=attacks=-1s", 234, ""],
  ["compand=decays=NaN", 1, "keep"], ["compand=decays=seconds", 1, "keep"],
  ["compand=unknown=1", 8, "keep"], ["compand=soft-knee=0", 222, "keep"],
  ["compand=soft-knee=1abc", 234, "keep"], ["compand=gain=1abc", 234, "keep"],
  ["compand=volume=-20abc", 234, "keep"], ["compand=delay=0abc", 234, "keep"],
  ["compand=delay=-1", 222, "keep"], ["compand=delay=20.1", 222, "keep"], ["compand=delay=NaN", 234, "keep"],
  ["compand=points=-80/-80||0/0", 234, ""], ["compand=points=-80/-80|0/0|", 234, ""]
] as const) {
  it(`${filter} fails at the expected output stage`, async () => {
    const fs = Volume.fromJSON({ "/out.wav": "keep" });
    fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [new Float64Array([0.25])] }));
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-i", "/in.wav", "-af", filter, "/out.wav"], cwd: "/", env: {}, signal: new AbortController().signal,
      fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
      stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} }
    } as never);
    assert.equal(result.exitCode, exitCode);
    assert.equal(fs.readFileSync("/out.wav", "utf8"), output);
  });
}

for (const points of ["|-80/-80|0/0", "-80/-80||0/0", "-80/-80|0/0|", "-80/-80| |0/0"]) {
  for (const graph of [false, true]) it(`compand rejects empty points ${points} (${graph ? "graph" : "simple"}) without rendering samples`, async () => {
    const fs = Volume.fromJSON({});
    fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [new Float64Array([0.25, -0.5]), new Float64Array([-0.25, 0.5])] }));
    const filter = `compand=points=${points}`;
    const errors: Uint8Array[] = [];
    const output: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-i", "/in.wav", ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-f", "s16le", "/out.pcm"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
      stdin: (async function* () {})(), stdout: { async write(b: Uint8Array) { output.push(b); } }, stderr: { async write(b: Uint8Array) { errors.push(b); } }
    } as never);
    assert.equal(result.exitCode, 234);
    assert.ok(Buffer.concat(errors).toString().includes("compand: expected input/output points"));
    assert.equal(fs.statSync("/out.pcm").size, 0);
    assert.equal(Buffer.concat(output).length, 0);
  });
}

// Native FFmpeg 7.0.2 PCM16 references around the repeated -20 dB input level.
for (const [points, knee, expected] of [
  ["-20/0|-20/-10|0/0", 0.01, [0, 2000, 10000, 30000, 32700, 32740, 10373, 10367, 10709, 11449, 22897, 32767, -2000, -32740, -10373, -22897]],
  ["-20/0|-20/-10|0/0", 6, [0, 2000, 10000, 19992, 18468, 18432, 18425, 18394, 16496, 13999, 22897, 32767, -2000, -18432, -18425, -22897]],
  ["-20/-10|-20/0|0/0", 0.01, [0, 632, 3162, 9487, 10341, 10366, 32737, 32767, 32767, 32767, 32767, 32767, -632, -10366, -32737, -32768]],
  ["-20/-10|-20/0|0/0", 6, [0, 632, 3162, 14236, 18309, 18413, 18430, 18480, 22026, 28716, 32767, 32767, -632, -18413, -18430, -32768]],
  ["-20/-10|-20/-10|0/0", 0.01, [0, 632, 3162, 9487, 10341, 10358, 10361, 10367, 10709, 11449, 22897, 32767, -632, -10358, -10361, -22897]]
] as const) {
  for (const graph of [false, true]) it(`equal compand inputs ${points}, knee ${knee} (${graph ? "graph" : "simple"})`, async () => {
    const samples = [0, 200, 1000, 3000, 3270, 3276, 3277, 3280, 3500, 4000, 16000, 32767, -200, -3276, -3277, -16000];
    const fs = Volume.fromJSON({});
    fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [samples, [...samples].reverse()]
      .map(channel => Float64Array.from(channel, sample => sample / 32768)) }));
    const filter = `compand=attacks=0:decays=0:points=${points}:soft-knee=${knee}`;
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-i", "/in.wav", ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-c:a", "pcm_s16le", "/out.wav"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
      stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write(b: Uint8Array) { errors.push(b); } }
    } as never);
    assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
    const audio = parseWav(fs.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
    assert.equal(audio.sampleRate, 8000);
    assert.equal(audio.channelData.length, 2);
    for (const [c, channel] of audio.channelData.entries()) {
      assert.equal(channel.length, samples.length);
      const reference = c ? [...expected].reverse() : expected;
      reference.forEach((sample, i) => assert.ok(Math.abs(channel[i]! * 32768 - sample) <= 1,
        `channel ${c}, sample ${i}: ${channel[i]! * 32768}, expected ${sample}`));
    }
  });
}
