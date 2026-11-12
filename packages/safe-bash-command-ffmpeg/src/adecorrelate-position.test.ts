import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { encodeWav } from "@poe-code/audio-ast";
import { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { decorrelateAudio } from "./audio-adecorrelate.js";
import { createFfmpegCommand } from "./index.js";

async function run(enable: string, graph: boolean, length = 64) {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/in.wav", encodeWav({ sampleRate: 8000,
    channels: [0, 1].map(c => Float64Array.from({ length }, (_, i) =>
      (((2 * i + c) * 1751) % 45001 - 22000) / 32768)) }));
  const chunks: Uint8Array[] = [];
  let stderr = "";
  const filter = `adecorrelate@d=stages=2:seed=42:enable=${enable}`;
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
    "-f", "s16le", "pipe:1"],
    command: "ffmpeg", cwd: "/", env: {}, fs, signal: new AbortController().signal,
    stdin: (async function* () {})(), stdout: { async write(chunk) { chunks.push(chunk); } },
    stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
  });
  assert.equal(result.exitCode, 0, stderr);
  return Buffer.concat(chunks);
}

// Full PCM references from native FFmpeg 7.0.2, stereo 8 kHz PCM16 WAV.
for (const graph of [false, true]) {
  for (const [enable, hash] of [
    ["eq(pos\\,44)", "bcf229bcfeb80f7449696a09184a62055134214758a983dbb3c06fd019e7a926"],
    ["eq(pos\\,45)", "18eef4bb3a89e8aa91746c32263e4f89b88fa9c1d40cd24f69ff2a2e47ea518b"],
    ["not(w+h)", "bcf229bcfeb80f7449696a09184a62055134214758a983dbb3c06fd019e7a926"],
    ["w+h", "18eef4bb3a89e8aa91746c32263e4f89b88fa9c1d40cd24f69ff2a2e47ea518b"],
    ["1", "bcf229bcfeb80f7449696a09184a62055134214758a983dbb3c06fd019e7a926"],
    ["0", "18eef4bb3a89e8aa91746c32263e4f89b88fa9c1d40cd24f69ff2a2e47ea518b"]
  ] as const) {
    it(`adecorrelate enable=${enable} matches native PCM (graph=${graph})`, async () => {
      for (let repeat = 0; repeat < 3; repeat++) {
        const bytes = await run(enable, graph);
        assert.equal(bytes.length, 256);
        assert.equal(createHash("sha256").update(bytes).digest("hex"), hash);
      }
    });
  }

  it(`adecorrelate updates the packet position for later frames (graph=${graph})`, async () => {
    const actual = await run("gt(pos\\,44)", graph, 1600);
    assert.deepEqual(actual, await run("gte(n\\,1)", graph, 1600));
    assert.notDeepEqual(actual, await run("0", graph, 1600));
  });
}

for (const pos of [undefined, -1]) {
  it(`adecorrelate exposes unavailable position ${pos} as NaN`, async () => {
    const channels = [Float64Array.from({ length: 64 }, (_, i) => (i + 1) / 128)];
    const frames = [{ start: 0, end: 64, pts: 0, pos }];
    const actual = await decorrelateAudio(channels, 8000,
      "adecorrelate=stages=2:seed=42:enable=isnan(pos)", frames, new MediaBudgetTracker());
    const expected = await decorrelateAudio(channels, 8000,
      "adecorrelate=stages=2:seed=42:enable=1", frames, new MediaBudgetTracker());
    assert.deepEqual(actual, expected);
    assert.notDeepEqual(actual, channels);
  });
  it(`adecorrelate bypasses frames when position ${pos} evaluates to NaN`, async () => {
    const channels = [new Float64Array([0.25, 0.5, 0.75])];
    const actual = await decorrelateAudio(channels, 8000,
      "adecorrelate=stages=2:seed=42:enable=pos", [{ start: 0, end: 3, pts: 0, pos }], new MediaBudgetTracker());
    assert.deepEqual(actual, channels);
  });
}
