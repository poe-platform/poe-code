import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { MediaBudgetTracker, parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";
import { multibandCompandAudio } from "./audio-mcompand.js";

const samples = [[0, 600], [400, 1600], [12000, 1600], [0, 800], [4000, 1600], [0, 1000]]
  .flatMap(([amplitude, length]) => Array.from({ length: length! }, (_, i) => (i % 2 ? -1 : 1) * amplitude! / 32768 || 0));

for (const seventh of ["6", "-6", "0", ""]) {
  for (const graph of [false, true]) {
    it(`mcompand seventh field ${seventh || "omitted"} preserves native PCM (${graph ? "graph" : "simple"})`, async () => {
      const input = Buffer.alloc(4096);
      for (let i = 0; i < 2048; i++) input.writeInt16LE(i * 131 % 8191 - 4095, i * 2);
      const fs = Volume.fromJSON({ "/in.raw": input });
      const output: Uint8Array[] = [], errors: Uint8Array[] = [];
      const filter = `mcompand=args='0.01,0.08 6 -60/-30,-20/-18,0/-16 0 0 -90${seventh ? ` ${seventh}` : ""}'`;
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-f", "s16le", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
        stdin: (async function* () {})(), stdout: { async write(b: Uint8Array) { output.push(b); } }, stderr: { async write(b: Uint8Array) { errors.push(b); } }
      } as never);
      const error = Buffer.concat(errors).toString();
      assert.equal(result.exitCode, 0, error);
      assert.equal(error, "");
      const pcm = Buffer.concat(output);
      assert.equal(pcm.length, 4096);
      // Native FFmpeg 7.0.2: the seventh field is parsed after the transfer curve is built.
      assert.equal(createHash("sha256").update(pcm).digest("hex"), "c36f3c4f827dcf3ae385f02f3e77975aafcdfd31fa7271317dbae58769e63170");
    });
  }
}

async function run(filter: string, graph = false, sampleRate = 48000) {
  const fs = Volume.fromJSON({ "/out.wav": "keep" });
  fs.writeFileSync("/in.wav", encodeWav({ sampleRate, channels: [1, -1].map(sign => Float64Array.from([...samples, ...samples, ...samples, ...samples], value => sign * value)) }));
  const errors: Uint8Array[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-i", "/in.wav", ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-c:a", "pcm_s16le", "/out.wav"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
    stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write(b: Uint8Array) { errors.push(b); } }
  } as never);
  return { result, fs, error: Buffer.concat(errors).toString() };
}

for (const graph of [false, true]) it(`mcompand matches native FFmpeg at 48 kHz (${graph ? "graph" : "simple"})`, async () => {
  const { result, fs, error } = await run("mcompand", graph);
  assert.equal(result.exitCode, 0, error);
  const audio = parseWav(fs.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
  assert.equal(audio.sampleRate, 48000);
  assert.equal(audio.channelData[0]!.length, 28800);
  // Native FFmpeg 7.0.2 PCM16 reference, including band/envelope transitions.
  for (const [c, channel] of audio.channelData.entries()) {
    for (const [index, expected] of [[600, 133], [2200, 1523], [4600, 326], [601, -383], [2199, 0], [3800, -1514], [6200, -891], [7800, 109], [9400, 1523], [26200, 326], [28799, 0]]) {
      const actual = channel[index!]! * 32768;
      assert.ok(Math.abs(actual - expected! * (c ? -1 : 1)) <= 1, `channel ${c}, sample ${index}: ${actual}, expected ${expected}`);
    }
  }
});

for (const [filter, rate] of [["mcompand", 8000], ["mcompand='0,0 6 -40/-40,0/0 24000'", 48000], ["mcompand='0 6 -40/-40,0/0 0'", 48000], ["mcompand='0,0 6 -40/-40,0/0 0 1'", 48000]] as const) {
  it(`rejects invalid/unsupported bands: ${filter} at ${rate}`, async () => {
    const { result, fs } = await run(filter, false, rate);
    assert.equal(result.exitCode, 1);
    assert.equal(fs.readFileSync("/out.wav", "utf8"), "keep");
  });
}

it("custom bands accept quoted commas and a final unfiltered band", async () => {
  const { result, fs, error } = await run("mcompand=args='0.005,0.1 6 -47/-40,-34/-34,-17/-33 100 | 0,0.025 6 -38/-31,-28/-28,0/-25 0'", true);
  assert.equal(result.exitCode, 0, error);
  const audio = parseWav(fs.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
  for (const [index, expected] of [[600, 772], [2200, 1651], [4600, 978], [601, -791], [2199, -781], [3799, -1648], [3800, 30], [6200, 24], [7800, 403], [26200, 978]]) {
    assert.ok(Math.abs(audio.channelData[0]![index!]! * 32768 - expected!) <= 1, `sample ${index}`);
  }
});

it("anull preserves the 8 kHz control samples", async () => {
  const { result, fs, error } = await run("anull", false, 8000);
  assert.equal(result.exitCode, 0, error);
  const audio = parseWav(fs.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
  assert.equal(audio.sampleRate, 8000);
  assert.deepEqual(Array.from(audio.channelData[0]!), [...samples, ...samples, ...samples, ...samples]);
});

it("mcompand respects memory limits and cancellation", async () => {
  const input = [new Float64Array(4096)];
  await assert.rejects(multibandCompandAudio(input, 48000, "mcompand",
    new MediaBudgetTracker({ maxMemoryBytes: 65536 })), /maxMemoryBytes/);
  await assert.rejects(multibandCompandAudio(input, 48000, "mcompand",
    new MediaBudgetTracker(), AbortSignal.abort()));
});
