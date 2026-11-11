import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { encodeWav } from "@poe-code/audio-ast";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2, interleaved PCM16 at 8 kHz, including the padded last window.
const bypass = "3b580af95602a2b1d31c45cc2248683c1147cbc95ff260c92421f251b6bb1366";
const denoised = "2f2ba9f7bee86dd971296640edace24e1665063b4b55e640804c503b7b4de795";
const delayed = "083c26710a9fbef48f515b5074bceb662d7766e4b13392c99efa4ed98d4c5cd0";
for (const [count, channels, prefix, enable, bytes, hash] of [
  [1200, 1, "", "0", 3054, bypass],
  [1200, 1, "", "1", 3054, denoised],
  [1200, 1, "", "gte(t,0.064)", 3054, delayed],
  [1200, 1, "", "lt(t,0.064)", 3054, "630be1182362e25739f65be6ee21a46b9f19eb1bd9dde4b310da4ac3d6d936b9"],
  [1200, 1, "", "gte(n,1)", 3054, delayed],
  [1200, 1, "", "NaN", 3054, bypass],
  [1200, 1, "", "isnan(0/0)", 3054, denoised],
  [1200, 1, "", "Infinity", 3054, denoised],
  [1200, 1, "", "-0.5", 3054, denoised],
  [1200, 1, "", "0.49", 3054, bypass],
  [1200, 1, "", "mod(st(0,ld(0)+1),2)", 3054, "1268f4aa51a96208ee110503fb6d793b9ee7156627526f6f8047638cb871dccf"],
  [1024, 1, "", "eq(n,1)", 2048, "87f6a3c7be45e920d1f82c398d2a79c83e0133af7d4db027a5d7fe38fc6d7191"],
  [1200, 2, "", "mod(st(0,ld(0)+1),2)", 6108, "4b48a41ae74899acac40b0c730430788709eae6871a1cfebec5a929887e8580c"],
  [1200, 1, "asetpts=PTS+2/TB,", "gte(t,2.064)", 3054, delayed],
  [1200, 1, "asetnsamples=n=128:p=0,", "gte(n,1)", 3054, delayed],
] as const) for (const graph of [false, true]) {
  it(`afwtdn timeline matches native: ${prefix}${enable} (${count}, ${channels}, graph=${graph})`, async () => {
    const { result, stderr, fs } = await run(enable, graph, count, channels, prefix);
    assert.equal(result.exitCode, 0, stderr);
    const pcm = fs.readFileSync("/out.pcm") as Buffer;
    assert.equal(pcm.length, bytes);
    assert.equal(createHash("sha256").update(pcm).digest("hex"), hash);
  });
}

for (const enable of ["", "unknown", "gte(t)"]) {
  it(`afwtdn rejects invalid enable=${enable} without replacing output`, async () => {
    const { result, stderr, fs } = await run(enable);
    assert.equal(result.exitCode, 1);
    assert.ok(stderr.includes("afwtdn"), stderr);
    assert.equal(fs.readFileSync("/out.pcm", "utf8"), "KEEP");
  });
}

async function run(enable: string, graph = false, count = 1200, channels = 1, prefix = "") {
  const fs = Volume.fromJSON({ "/out.pcm": "KEEP" });
  fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
    channels: Array.from({ length: channels }, (_, c) => Float64Array.from({ length: count }, (_, i) =>
      (((c === 0 ? i : count - 1 - i) * 13129) % 30001 - 15000) / 32768)) }));
  const filter = `${prefix}afwtdn=samples=512:levels=2:wavet=sym2:sigma=0.1:enable='${enable}'`;
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-f", "s16le", "/out.pcm"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return fs.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
      async stat(path: string) { return fs.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { result, stderr, fs };
}
