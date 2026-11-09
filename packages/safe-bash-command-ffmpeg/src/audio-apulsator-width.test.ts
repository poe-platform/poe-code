import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: ffmpeg -i in.wav -af FILTER -f s16le out.raw.
// The 2048-frame, 8 kHz stereo input has constant PCM16 samples 10000 / -6000.
for (const [filter, hash] of [
  ["apulsator", "56a18a009b11afc9c4fe79533897e22a42081c045a3cb0da49af5d87f99dedd8"],
  ["apulsator=width=0.5", "8feeb481472bcd33edef5f6eec0b55ef822e6c008cbcb480cc5f4e485a1389e3"],
  ["apulsator=width=0", "ad3fe7597fd7944caf5d2e3ebd8a8f680b9a6489604a3bd62c91a147e1d8f2c1"],
  ["apulsator=width=0.01", "ad3fe7597fd7944caf5d2e3ebd8a8f680b9a6489604a3bd62c91a147e1d8f2c1"],
  ["apulsator=width=1", "56a18a009b11afc9c4fe79533897e22a42081c045a3cb0da49af5d87f99dedd8"],
  ["apulsator=width=1.99", "2d941b8ae2db1b519c866c32b4b66f01d4190fa4bb0b70018ed70e3f0bdfbd04"],
  ["apulsator=width=2", "2d941b8ae2db1b519c866c32b4b66f01d4190fa4bb0b70018ed70e3f0bdfbd04"],
  ["apulsator=width=0.3:hz=7:amount=0.6:offset_l=0.25:offset_r=1", "4823b752a0c4dece2531505fa3036ba45912c6839a6a691103b6c604d7d301b7"],
  ["apulsator=width=0:hz=7:offset_l=1:offset_r=1", "5036a458aa99e7c6593f5ddec902bc9c59f9d9cc9e6df788dd8ee7b7410ff82c"],
  ["apulsator=width=2:hz=7:offset_l=0.25:offset_r=1", "f30ddcb5a0ae1a460b79466bb59136e5b0d3cd4ecd4202a3bdc6785e256d598e"]
] as const) {
  for (const graph of [false, true]) {
    it(`${filter} matches every native PCM byte (graph=${graph})`, async () => {
      const { volume, result, stderr } = await run(filter, graph);
      assert.equal(result.exitCode, 0, stderr);
      const pcm = volume.readFileSync("/out.raw") as Buffer;
      assert.equal(pcm.length, 8192);
      assert.equal(createHash("sha256").update(pcm).digest("hex"), hash);
      if (filter === "apulsator=width=0.5") {
        assert.deepEqual([0, 500, 1000].map(frame => pcm.readInt16LE(frame * 4)), [5000, 10000, 5000]);
      }
    });
  }
}

for (const width of ["-0.01", "2.01", "NaN", "Infinity", ""]) {
  it(`rejects width=${width} without replacing output`, async () => {
    const { volume, result, stderr } = await run(`apulsator=width=${width}`);
    assert.notEqual(result.exitCode, 0);
    assert.ok(stderr.includes("apulsator:"), stderr);
    assert.equal(volume.readFileSync("/out.raw", "utf8"), "keep");
  });
}

async function run(filter: string, graph = false) {
  const channels = [new Float64Array(2048).fill(10000 / 32768), new Float64Array(2048).fill(-6000 / 32768)];
  const volume = Volume.fromJSON({ "/out.raw": "keep" });
  volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels }));
  let stderr = "";
  const result = await createFfmpegCommand({ limits: { maxDurationSeconds: 3 } }).execute({
    args: ["-y", "-v", "error", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-f", "s16le", "/out.raw"],
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
