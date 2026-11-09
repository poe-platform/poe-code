import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 raw PCM hashes: 8 kHz stereo, 2048 frames.
for (const [filter, pcm16Hash, float64Hash] of [
  ["volume=0.75,aphaser", "237762c9bd44d128e80178fc1413bea3c62f31653342b86949fbe9a2b4f42dac", "7fef1a2922410dbc2392a008b4ba1c23745ca77887025b4ae2fa3229366a45ea"],
  ["volume=0.75:precision=double,aphaser", "a11baa308215d196ae5fb2b5f4b6198be3cf90b89e4fe9d89f3153370e7b0aa8", "a3396853751e98c0c616e020f7005d0d3a80fd61ba725f4287a79d06e7d678a8"],
  ["volume=0.75:precision=fixed,aphaser", "a7fcfec2bbded56e340844510309539b0d729035d2abee585e271b8983174f54", "bd3cce551173b9af3d4e04087ca6f5829377f9b779882d759351263bb379f9fe"],
  ["aphaser,volume=0.75", "800c0f4d8368aa25e3ce7de3c5f073003776bd71fbc024bb6bdb78f6298cc9a0", "8494a95cffac17e0c093aab13098b28ad54c9ed1427e1f0ba384dbd0178f70ca"],
  ["aphaser", "cf8795015d15a6eb2e8c5e33f74c04c2dd387d15777112aa3dcf314118782866", "fbedaa171e26eb39dd247516341e187fa78079b3518d554622cdd9ea5aa829c7"]
] as const) {
  for (const graph of [false, true]) {
    for (const [format, hash, bytesPerSample] of [["s16le", pcm16Hash, 2], ["f64le", float64Hash, 8]] as const) {
      it(`${filter} preserves working precision in ${format} (${graph ? "graph" : "simple"})`, async () => {
        const { volume, result, stderr } = await run(filter, graph, format);
        assert.equal(result.exitCode, 0, stderr);
        const pcm = volume.readFileSync("/out.raw") as Buffer;
        assert.equal(pcm.length, 2048 * 2 * bytesPerSample);
        assert.equal(createHash("sha256").update(pcm).digest("hex"), hash);
      });
    }
  }
}

async function run(filter: string, graph: boolean, format: string) {
  const channels = [
    Float64Array.from({ length: 2048 }, (_, i) => ((i * 67) % 14000 - 7000) / 32768),
    Float64Array.from({ length: 2048 }, (_, i) => (6000 - (i * 53) % 12000) / 32768)
  ];
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels }));
  let stderr = "";
  const result = await createFfmpegCommand({ limits: { maxDurationSeconds: 3 } }).execute({
    args: ["-y", "-v", "error", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-f", format, "/out.raw"],
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
