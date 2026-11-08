import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

const channels = [
  Float64Array.from({ length: 2048 }, (_, i) => ((i * 67) % 14000 - 7000) / 32768),
  Float64Array.from({ length: 2048 }, (_, i) => (6000 - (i * 53) % 12000) / 32768)
];

// Native FFmpeg 9.0.1 PCM s16le output for the deterministic 8 kHz stereo input above.
const unchanged = "2d1f2da800b2a477fbc52839146c0d3fd2c94a18c404a368f734448dbdf3d8ef";
for (const [filter, rate, frames, hash] of [
  ["asetrate=16000", 16000, 2048, unchanged],
  ["asetrate=r=16000", 16000, 2048, unchanged],
  ["asetrate=sample_rate=16000", 16000, 2048, unchanged],
  ["asetrate", 44100, 2048, unchanged],
  ["asetrate=16000,adelay=1:all=1", 16000, 2064, "93f7af4e2a9ce23c7255aed76d66f993b6cdc3ab16d52d697bc93411b87c9bfc"],
  ["adelay=1:all=1,asetrate=16000", 16000, 2056, "c796aa8d650715cfbd9e69487ff16dca335ddd261f26b2b0ba5b37876708840f"]
] as const) {
  for (const graph of [false, true]) {
    it(`${filter} matches native PCM and rate (${graph ? "graph" : "simple"})`, async () => {
      const { volume, result, stderr } = await run(filter, graph);
      assert.equal(result.exitCode, 0, stderr);
      const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
      assert.equal(audio.sampleRate, rate);
      assert.equal(audio.channelData.length, 2);
      assert.equal(audio.channelData[0]!.length, frames);
      const pcm = Buffer.alloc(frames * 4);
      for (let i = 0; i < frames; i++) {
        for (let c = 0; c < 2; c++) pcm.writeInt16LE(Math.round(audio.channelData[c]![i]! * 32768), i * 4 + c * 2);
      }
      assert.equal(createHash("sha256").update(pcm).digest("hex"), hash);
    });
  }
}

for (const filter of ["asetrate=0", "asetrate=-1", "asetrate=2147483648", "asetrate=bad", "asetrate=unknown=16000", "asetrate=1"]) {
  it(`${filter} rejects invalid rates or excessive duration without replacing output`, async () => {
    const { volume, result } = await run(filter);
    assert.notEqual(result.exitCode, 0);
    assert.equal(volume.readFileSync("/out.wav", "utf8"), "keep");
  });
}

it("resamples from the reinterpreted rate when an output rate is requested", async () => {
  const { volume, result, stderr } = await run("asetrate=16000", false, ["-ar", "8000"]);
  assert.equal(result.exitCode, 0, stderr);
  const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
  assert.equal(audio.sampleRate, 8000);
  assert.equal(audio.channelData[0]!.length, 1024);
});

async function run(filter: string, graph = false, outputOptions: string[] = []) {
  const volume = Volume.fromJSON({ "/out.wav": "keep" });
  volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels }));
  let stderr = "";
  const result = await createFfmpegCommand({ limits: { maxDurationSeconds: 1 } }).execute({
    args: ["-y", "-v", "error", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), ...outputOptions, "-c:a", "pcm_s16le", "/out.wav"],
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
