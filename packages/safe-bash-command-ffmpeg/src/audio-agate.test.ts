import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createCommandArguments } from "safe-bash-contracts";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg PCM16 references for the reported 7200-sample fixture.
for (const [filter, expected] of [
  ["agate=threshold=0.05:ratio=4:attack=0.1:release=1", [0, 24, -24, -24, 12000, -12000, -12000, 0, 4000, -4000, -4000, 0]],
  ["agate", [0, 24, -24, -24, 2687, -5194, -12000, 0, 4000, -4000, -3486, 0]],
  ["agate=range=0:threshold=0.05:ratio=2:attack=10:release=20", [0, 1, -2, -24, 12000, -12000, -12000, 0, 1192, -2325, -4000, 0]],
  ["agate=threshold=0.05:ratio=1", [0, 400, -400, -400, 12000, -12000, -12000, 0, 4000, -4000, -4000, 0]],
  ["agate=threshold=0", [0, 400, -400, -400, 12000, -12000, -12000, 0, 4000, -4000, -4000, 0]],
  ["agate=mode=upward:threshold=0.2:ratio=2:attack=1:release=20:knee=1", [0, 400, -400, -400, 20139, -30186, -32768, 0, 4000, -4000, -4000, 0]]
] as const) for (const graph of [false, true]) it(`${filter}, follows changing levels (${graph ? "graph" : "simple"})`, async () => {
  const fs = Volume.fromJSON({});
  const indices = [0, 600, 601, 2199, 2200, 2201, 3799, 3800, 4600, 4601, 6199, 7199];
  const samples = Float64Array.from([[0, 600], [400, 1600], [12000, 1600], [0, 800], [4000, 1600], [0, 1000]]
    .flatMap(([amplitude, count]) => Array.from({ length: count! }, (_, i) => (i % 2 ? -1 : 1) * amplitude! / 32768)));
  fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [samples] }));
  const errors: Uint8Array[] = [];
  const argumentValues = createCommandArguments(["-i", "/in.wav", ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-c:a", "pcm_s16le", "/out.wav"]);
  const result = await createFfmpegCommand().execute({
    args: argumentValues.args, argumentValues,
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
    stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write(b: Uint8Array) { errors.push(b); } }
  } as never);
  assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
  const audio = parseWav(fs.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
  assert.equal(audio.sampleRate, 8000);
  assert.equal(audio.channelData.length, 1);
  for (const [c, channel] of audio.channelData.entries()) {
    assert.equal(channel.length, 7200);
    indices.forEach((position, i) => assert.ok(Math.abs(channel[position]! * 32768 - expected[i]!) <= 1,
      `channel ${c}, sample ${position}: ${channel[position]! * 32768}, expected ${expected[i]}`));
  }
});

for (const [filter, status] of [
  ["agate=level_in=0", 222], ["agate=threshold=-1", 222], ["agate=ratio=0", 222],
  ["agate=attack=0", 222], ["agate=release=9001", 222], ["agate=knee=0", 222],
  ["agate=range=2", 222], ["agate=detection=bad", 234], ["agate=link=2", 222],
  ["agate=mode=bad", 234], ["agate=threshold=oops", 234], ["agate=threshold=NaN", 234],
  ["agate=attack=", 234], ["agate=foo=1", 8], ["agate=unknown=1", 8]
] as const) for (const graph of [false, true]) {
  it(`${filter} fails without replacing output (${graph ? "graph" : "simple"})`, async () => {
    const fs = Volume.fromJSON({ "/out.wav": "keep" });
    fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [new Float64Array([0.25])] }));
    const argumentValues = createCommandArguments(["-y", "-i", "/in.wav", ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "/out.wav"]);
    const result = await createFfmpegCommand().execute({
      args: argumentValues.args, argumentValues, cwd: "/", env: {}, signal: new AbortController().signal,
      fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
      stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} }
    } as never);
    assert.equal(result.exitCode, status);
    assert.equal(fs.readFileSync("/out.wav", "utf8"), "keep");
  });
}

for (const [filter, hash] of [
  ["agate=level_in=1", "080a910cf94a6c0fb40d244fbad9515d2ac1d1d14176886ba64b35076e9c06dc"],
  ["agate=link=1", "4f0a0862ea395c385ed321db215f4d4fbd51763bd0bd3847ae77fdff66760373"]
] as const) it(`${filter} preserves native stereo PCM output`, async () => {
  const fs = Volume.fromJSON({});
  const channels = [
    Float64Array.from({ length: 6400 }, (_, i) => ((i * 131) % 4001 - 2000) * [1, 6, 2, 0][Math.floor(i / 512) % 4]! / 32768),
    Float64Array.from({ length: 6400 }, (_, i) => ((i * 47) % 1801 - 900) * [2, 1, 16, 0][Math.floor(i / 512) % 4]! / 32768)
  ];
  fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels }));
  const argumentValues = createCommandArguments(["-i", "/in.wav", "-af", filter, "-f", "s16le", "/out.raw"]);
  const result = await createFfmpegCommand().execute({
    args: argumentValues.args, argumentValues, cwd: "/", env: {}, signal: new AbortController().signal,
    fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
    stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} }
  } as never);
  assert.equal(result.exitCode, 0);
  const output = fs.readFileSync("/out.raw") as Buffer;
  assert.equal(output.length, 25600);
  assert.equal(createHash("sha256").update(output).digest("hex"), hash);
});
