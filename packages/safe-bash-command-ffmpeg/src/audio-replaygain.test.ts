import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

async function run(kind: "mix" | "same" | "inverse" | "silence", filter = "replaygain", level = "info", rate = 48000, frames = 144000) {
  const channels = [0, 1].map(channel => Float64Array.from({ length: frames }, (_, i) => {
    const s = (i % 48 < 24 ? 4096 : -4096) / 32768;
    if (kind === "silence") return 0;
    if (channel === 0) return i < 96000 ? s : 0;
    return kind === "mix" ? (i < 48000 ? 0 : -2 * s) : kind === "same" ? s : -s;
  }));
  const fs = Volume.fromJSON({ "/out.wav": "keep" });
  fs.writeFileSync("/in.wav", encodeWav({ sampleRate: rate, channels }));
  const errors: Uint8Array[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-hide_banner", "-loglevel", level, "-i", "/in.wav", "-af", filter, "-ar", String(rate), "-c:a", "pcm_s16le", "/out.wav"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
    stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write(b: Uint8Array) { errors.push(b); } }
  } as never);
  return { result, fs, channels, error: Buffer.concat(errors).toString() };
}

for (const [filter, gain, peak, scale] of [
  ["replaygain", "-4.32", "0.250000", 1],
  ["volume=0.5,replaygain", "+1.70", "0.125000", 0.5]
] as const) {
  it(`measures ${filter} without changing PCM`, async () => {
    const { result, fs, channels, error } = await run("mix", filter);
    assert.equal(result.exitCode, 0, error);
    assert.ok(error.includes(`track_gain = ${gain} dB`), error);
    assert.ok(error.includes(`track_peak = ${peak}`), error);
    const actual = parseWav(fs.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
    assert.equal(actual.sampleRate, 48000);
    assert.deepEqual(actual.channelData.map(c => Array.from(c)), channels.map(c => Array.from(c, x => x * scale)));
  });
}

it("measures channel energy without cancelling opposite phases", async () => {
  const same = await run("same");
  const inverse = await run("inverse");
  assert.equal(same.result.exitCode, 0, same.error);
  assert.equal(inverse.result.exitCode, 0, inverse.error);
  assert.equal(same.error, inverse.error);
});

it("reports bounded gain for a partial silent window", async () => {
  const { result, error } = await run("silence", "replaygain", "info", 44100, 100);
  assert.equal(result.exitCode, 0, error);
  assert.ok(error.includes("track_gain = +64.00 dB"), error);
  assert.ok(error.includes("track_peak = 0.000000"), error);
});

it("respects the log level", async () => {
  const { result, error } = await run("mix", "replaygain", "error");
  assert.equal(result.exitCode, 0, error);
  assert.equal(error, "");
});

it("rejects unsupported options without replacing output", async () => {
  const { result, fs } = await run("mix", "replaygain=track_gain=3");
  assert.equal(result.exitCode, 1);
  assert.equal(fs.readFileSync("/out.wav", "utf8"), "keep");
});

// Native FFmpeg reference values include a final, partial 50 ms window.
for (const [rate, gain] of [
  [8000, "+1.18"], [11025, "-1.15"], [12000, "-1.53"], [16000, "-1.56"],
  [18900, "-2.25"], [22050, "-0.90"], [24000, "-1.93"], [32000, "-0.44"],
  [37800, "-0.62"], [44100, "-0.34"], [48000, "-0.90"], [56000, "-0.53"],
  [64000, "-1.04"], [88200, "-1.71"], [96000, "-3.24"], [112000, "-3.13"],
  [128000, "-4.89"], [144000, "-3.90"], [176400, "-5.29"], [192000, "-3.06"]
] as const) {
  it(`matches native ReplayGain at ${rate} Hz`, async () => {
    const { result, error } = await run("same", "replaygain", "info", rate, Math.floor(rate / 4) + 17);
    assert.equal(result.exitCode, 0, error);
    assert.ok(error.includes(`track_gain = ${gain} dB`), error);
    assert.ok(error.includes("track_peak = 0.125000"), error);
  });
}
