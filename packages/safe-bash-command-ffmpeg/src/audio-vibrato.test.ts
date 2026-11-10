import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

// SHA-256 of decoded s16le PCM from native FFmpeg 9.0.1, 8 kHz stereo, 2048 frames.
// Input: ((i * 67) % 14000 - 7000, 6000 - (i * 53) % 12000).
// ffmpeg -f s16le -ar 8000 -ac 2 -i pipe:0 -af FILTER -f s16le pipe:1
// The reported FFmpeg 7.0.2 samples also match the first fixture.
for (const [filter, hash] of [
  ["vibrato=f=5:d=0.5", "0dcfe801b9b3629d54cecc2854018a813e1ce5057a62f28186d2acf2e4db6af0"],
  ["vibrato", "0dcfe801b9b3629d54cecc2854018a813e1ce5057a62f28186d2acf2e4db6af0"],
  ["vibrato=7.3:1", "2a154f6f1e24e0bca1766d6886253e57f55c20c772a72b40ac1393d9aabaadb1"],
  ["vibrato=d=0", "ae3fd4e52d3ab7397417704a51bee7e5ed07ce4cd76e679a2fc4aecd53984579"],
  ["vibrato=f=20000:d=0.5", "9a3397b4e27b8ed4962a8f9b86109ab1c4281820d4fbf9042890c0c99f18a3b1"]
] as const) {
  for (const graph of [false, true]) {
    it(`${filter} matches native PCM and rate (${graph ? "graph" : "simple"})`, async () => {
      const { volume, result, stderr } = await run(filter, graph);
      assert.equal(result.exitCode, 0, stderr);
      const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
      assert.equal(audio.sampleRate, 8000);
      assert.equal(audio.channelData.length, 2);
      assert.equal(audio.channelData[0]!.length, 2048);
      const pcm = Buffer.alloc(2048 * 4);
      for (let i = 0; i < 2048; i++) {
        for (let c = 0; c < 2; c++) pcm.writeInt16LE(Math.round(audio.channelData[c]![i]! * 32768), i * 4 + c * 2);
      }
      assert.equal(createHash("sha256").update(pcm).digest("hex"), hash);
    });
  }
}

for (const [filter, expected] of [
  ["vibrato=d=1/2", "vibrato"],
  ["vibrato=d=(1+1)/4", "vibrato"],
  ["vibrato=d=2^-1", "vibrato"],
  ["vibrato=d=sqrt(0.25)", "vibrato"],
  ["vibrato=d=PI/(2*PI)", "vibrato"],
  ["vibrato=d=500m", "vibrato"],
  ["vibrato=f=10/2:d=1/2", "vibrato"],
  ["vibrato=10/2:1/2", "vibrato"],
  ["vibrato=d=min", "vibrato=d=0"],
  ["vibrato=d=max", "vibrato=d=1"],
  ["vibrato=f=min", "vibrato=f=0.1"],
  ["vibrato=f=max", "vibrato=f=20000"],
  ["vibrato=f=default:d=default", "vibrato"],
  ["vibrato=default:max", "vibrato=f=5:d=1"],
  ["vibrato=f=2:f=default:d=1:d=default", "vibrato"],
  ["vibrato=f=default*2:d=(min+max)/2", "vibrato=f=10:d=0.5"]
] as const) {
  for (const graph of [false, true]) {
    it(`${filter} produces the same PCM as literal options (${graph ? "graph" : "simple"})`, async () => {
      const literal = await run(expected, graph);
      const expression = await run(filter, graph);
      assert.equal(literal.result.exitCode, 0, literal.stderr);
      assert.equal(expression.result.exitCode, 0, expression.stderr);
      assert.deepEqual(expression.volume.readFileSync("/out.wav"), literal.volume.readFileSync("/out.wav"));
    });
  }
}

for (const filter of ["vibrato=f=0", "vibrato=f=20001", "vibrato=d=-1", "vibrato=d=1.1", "vibrato=f=NaN", "vibrato=d=", "vibrato=unknown=1",
  "vibrato=d=0b1", "vibrato=d=0o1", "vibrato=d=1/", "vibrato=d=1/0", "vibrato=d=0/0",
  "vibrato=d=3/2", "vibrato=d=-1/2", "vibrato=f=40001/2",
  "vibrato=d=max+0.1", "vibrato=d=min-0.1", "vibrato=f=max+1", "vibrato=f=min/2"]) {
  it(`${filter} rejects invalid options without replacing output`, async () => {
    const { volume, result } = await run(filter);
    assert.notEqual(result.exitCode, 0);
    assert.equal(volume.readFileSync("/out.wav", "utf8"), "keep");
  });
}

async function run(filter: string, graph = false) {
  const channels = [
    Float64Array.from({ length: 2048 }, (_, i) => ((i * 67) % 14000 - 7000) / 32768),
    Float64Array.from({ length: 2048 }, (_, i) => (6000 - (i * 53) % 12000) / 32768)
  ];
  const volume = Volume.fromJSON({ "/out.wav": "keep" });
  volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels }));
  let stderr = "";
  const result = await createFfmpegCommand({ limits: { maxDurationSeconds: 3 } }).execute({
    args: ["-y", "-v", "error", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-c:a", "pcm_s16le", "/out.wav"],
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
