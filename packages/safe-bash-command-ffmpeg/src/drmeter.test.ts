import assert from "node:assert/strict";
import { it } from "node:test";
import { encodeWav } from "@poe-code/audio-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createFfmpegCommand } from "./index.js";

const samples = [1001, -1999, 3, 21, 5003, 0, 19, -7];

async function run(filter: string, level = "error", count = 8, channels = 1, graph = false) {
  const fs = createMemoryFileSystem();
  const pcm = Buffer.alloc(count * channels * 2);
  for (let i = 0; i < count * channels; i++) pcm.writeInt16LE(samples[i % samples.length]!, i * 2);
  await fs.writeFile("/in.wav", encodeWav({ sampleRate: 8000,
    channels: Array.from({ length: channels }, (_, channel) =>
      Float64Array.from({ length: count }, (_, i) => pcm.readInt16LE((i * channels + channel) * 2) / 32768))
  }, { bitsPerSample: 16 }));
  const chunks: Uint8Array[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    command: "ffmpeg", cwd: "/", env: {}, fs, signal: new AbortController().signal,
    args: ["-hide_banner", "-nostats", "-loglevel", level, "-i", "/in.wav",
      ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
      "-c:a", "pcm_s16le", "-f", "s16le", "pipe:1"],
    stdin: (async function* () {})(),
    stdout: { async write(chunk) { chunks.push(chunk.slice()); } },
    stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
  });
  return { code: result.exitCode, stdout: Buffer.concat(chunks), stderr, pcm };
}

// FFmpeg 7.0.2 passes the complete 1 ms WAV through even without a full window.
for (const filter of ["anull", "drmeter", "drmeter=length=0.01", "drmeter=0.01", "drmeter@meter=length=0.01"]) {
  for (const level of ["error", "info"]) {
    it(`preserves short PCM with ${filter} at ${level} level`, async () => {
      const result = await run(filter, level);
      assert.equal(result.code, 0, result.stderr);
      assert.deepEqual(result.stdout, result.pcm);
      if (level === "error") assert.equal(result.stderr, "");
      else if (filter !== "anull") {
        assert.ok(result.stderr.includes("Channel 1: DR: -nan\n"), result.stderr);
        assert.ok(result.stderr.includes("Overall DR: -nan\n"), result.stderr);
      }
    });
  }
}

it("reports each stereo channel through a complex graph without changing samples", async () => {
  const result = await run("drmeter=length=0.01", "info", 8, 2, true);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(result.stdout, result.pcm);
  for (const label of ["Channel 1", "Channel 2", "Overall DR"]) {
    assert.ok(result.stderr.includes(`${label}${label === "Overall DR" ? "" : ": DR"}: -nan\n`), result.stderr);
  }
});

// Native reports no measurement on an exact window boundary, and uses the
// completed-window histogram when a longer input ends with a partial window.
for (const [count, report] of [
  [80, "No data, dynamic range not meassurable\n"],
  [401, "Channel 1: DR: -1.7601\nOverall DR: -1.7601\n"]
] as const) {
  it(`matches native measurement after ${count} samples`, async () => {
    const result = await run("drmeter=length=0.01", "info", count);
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(result.stdout, result.pcm);
    assert.ok(result.stderr.includes(report), result.stderr);
  });
}

for (const [option, code] of [["length=0", 222], ["length=11", 222], ["length=nope", 234], ["unknown=1", 8], ["enable=0", 176]] as const) {
  it(`rejects drmeter ${option} before writing audio`, async () => {
    const result = await run(`drmeter=${option}`);
    assert.equal(result.code, code, result.stderr);
    assert.equal(result.stdout.length, 0);
  });
}
