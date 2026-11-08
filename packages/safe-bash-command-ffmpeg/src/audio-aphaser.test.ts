import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

// SHA-256 of decoded PCM from native FFmpeg 9.0.1, 8 kHz stereo, 2048 frames.
// The reported FFmpeg 7.0.2 samples also match the first fixture.
for (const [filter, hash, frames = 2048] of [
  ["aphaser=in_gain=0.5:out_gain=0.8:delay=3:decay=0.4:speed=1", "c51d4f0fbc3d6f80a3308d2bc5ee6b53bb319242a848bdd77c1e0d7e4a1fd8e6"],
  ["aphaser", "cf8795015d15a6eb2e8c5e33f74c04c2dd387d15777112aa3dcf314118782866"],
  ["aphaser=0.5:0.8:3:0.4:1:sinusoidal", "386614d6eaef211b7b5808c30b1cf443fdbd13199b9474362f47839ac3e3fccc"],
  ["aphaser=delay=0.125:decay=0", "8c5a347db2f7ea9a1e7069ec1a5dfbc7395e57f0e5185e2e98e4a73087a877bb"],
  ["aphaser=speed=2:type=t", "8b13bd6dbf5d08ef50c78cc22a747b94f08e21641410bd1a2bcb0866ec237cc0"],
  ["aphaser=speed=2:type=s", "5f7b1062ed774bdd9f5fad2dc5c2d0b8738551cd85261ed467ca58deaf2a1482", 18000]
] as const) {
  for (const graph of [false, true]) {
    it(`${filter} matches native PCM and rate (${graph ? "graph" : "simple"})`, async () => {
      const { volume, result, stderr } = await run(filter, graph, frames);
      assert.equal(result.exitCode, 0, stderr);
      const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
      assert.equal(audio.sampleRate, 8000);
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

for (const filter of ["aphaser=delay=0", "aphaser=delay=6", "aphaser=speed=0", "aphaser=decay=1", "aphaser=in_gain=NaN", "aphaser=type=bad", "aphaser=unknown=1"]) {
  it(`${filter} rejects invalid options without replacing output`, async () => {
    const { volume, result } = await run(filter);
    assert.notEqual(result.exitCode, 0);
    assert.equal(volume.readFileSync("/out.wav", "utf8"), "keep");
  });
}

async function run(filter: string, graph = false, frames = 2048) {
  const channels = [
    Float64Array.from({ length: frames }, (_, i) => ((i * 67) % 14000 - 7000) / 32768),
    Float64Array.from({ length: frames }, (_, i) => (6000 - (i * 53) % 12000) / 32768)
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
