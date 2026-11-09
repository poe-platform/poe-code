import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { MediaBudgetTracker, parseWav } from "@poe-code/mp4-ast";
import { measureEbur128 } from "./audio-ebur128.js";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: the peak is in the final, partial 100 ms interval.
for (const mode of ["true", "sample+true", "true+sample", "sample"]) {
  it(`ebur128 peak=${mode} measures the tail independently and preserves PCM`, async () => {
    const samples = Float64Array.from({ length: 28160 }, (_, i) =>
      (i < 28000 ? Math.trunc(8192 * Math.sin(2 * Math.PI * 700 * i / 8000)) : 30000) / 32768);
    const input = encodeWav({ sampleRate: 8000, channels: [samples] });
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/in.wav", input);
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-hide_banner", "-nostats", "-y", "-v", "info", "-i", "/in.wav",
        "-af", `ebur128=peak=${mode}`, "-c:a", "pcm_s16le", "/out.wav"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    const measurements = stderr.split("\n").filter(line => line.startsWith("t:"));
    assert.equal(measurements.length, 35);
    const summary = stderr.slice(stderr.indexOf("Summary:"));
    assert.equal(summary.includes("Sample peak:"), mode.includes("sample"));
    assert.equal(summary.includes("True peak:"), mode.includes("true"));
    if (mode.includes("sample")) {
      assert.match(summary, /Sample peak:\n\s+Peak:\s+-0.8 dBFS/);
      assert.match(measurements.at(-1)!, /SPK:\s+-12.0 dBFS/);
    }
    if (mode.includes("true")) {
      assert.match(summary, /True peak:\n\s+Peak:\s+0.5 dBFS/);
      assert.match(measurements.at(-1)!, /FTPK:\s+-12.0 dBFS\s+TPK:\s+-12.0 dBFS/);
    } else assert.ok(!stderr.includes("TPK:"));
    assert.deepEqual(parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!.channelData,
      parseWav(input).tracks[0]!.decodedAudio!.channelData);
  });
}

it("bounds true-peak memory and honors cancellation", async () => {
  const samples = [new Float64Array(800)];
  const collect = async (budget: MediaBudgetTracker, signal?: AbortSignal) => {
    for await (const report of measureEbur128(samples, 8000, undefined, "peak=true", budget, 32, signal)) void report;
  };
  await assert.rejects(collect(new MediaBudgetTracker({ maxMemoryBytes: 64 })), /maxMemoryBytes/);
  await assert.rejects(collect(new MediaBudgetTracker(), AbortSignal.abort()), { name: "AbortError" });
});

// Native FFmpeg 7.0.2: interval peaks fall while cumulative peaks are retained.
for (const [rate, intervalPeaks, summaryPeak] of [
  [8000, [[-3.4, -9.4], [-3.6, -9.6], [-15.7, -21.7]], -0.1],
  [44100, [[-3.9, -9.9], [-3.9, -9.9], [-17.1, -23.2]], -0.4],
  [48000, [[-4, -10], [-4.7, -10.7], [-16.5, -22.5]], -0.4],
  [96000, [[-4, -10], [-4.7, -10.7], [-16.5, -22.5]], -0.4],
  [192000, [[-6, -12], [-18.1, -24.1], [-24.1, -30.1]], -2.5],
  [384000, [[-4.8, -10.8], [-5.4, -11.4], [-17.3, -23.3]], -1.3]
] as const) {
  it(`matches native per-channel true peaks and resampler delay at ${rate} Hz`, async () => {
    const left = Float64Array.from({ length: Math.floor(rate * 0.32) }, (_, i) => {
      const amplitude = i < rate / 10 ? 0.5 : i < rate / 5 ? 0.125 : i < rate * 0.3 ? 0.0625 : 0.75;
      return i % Math.floor(rate / 1000) < Math.floor(rate / 2000) ? amplitude : -amplitude;
    });
    const reports: string[] = [];
    for await (const report of measureEbur128([left, left.map(x => -x / 2)], rate, undefined,
      "peak=sample+true", new MediaBudgetTracker(), 32)) reports.push(report);
    assert.equal(reports.length, 4);
    intervalPeaks.forEach((peaks, i) => {
      assert.ok(reports[i]!.includes(`FTPK: ${peaks.map(x => x.toFixed(1)).join(" ")} dBFS`), reports[i]);
      assert.ok(reports[i]!.includes(`TPK: ${intervalPeaks[0].map(x => x.toFixed(1)).join(" ")} dBFS`), reports[i]);
    });
    assert.ok(reports[3]!.includes(`True peak:\n    Peak:      ${summaryPeak.toFixed(1)} dBFS`), reports[3]);
  });
}

for (const length of [1, 16, 17, 32, 33, 800]) {
  it(`matches native true peaks for ${length} constant or silent samples`, async () => {
    for (const value of [0, 16000 / 32768]) {
      const reports: string[] = [];
      for await (const report of measureEbur128([new Float64Array(length).fill(value)], 8000, undefined,
        "peak=true", new MediaBudgetTracker(), 32)) reports.push(report);
      const peak = length <= 32 || value === 0 ? "-inf" : "-6.2";
      assert.ok(reports.at(-1)!.includes(`True peak:\n    Peak:      ${peak} dBFS`), reports.at(-1));
      assert.ok(!reports.join("").includes("NaN"));
    }
  });
}

it("preserves the native numeric peak flag combinations", async () => {
  for (let mode = 0; mode <= 7; mode++) {
    const reports = [];
    for await (const report of measureEbur128([new Float64Array(800).fill(0.5)], 8000, undefined,
      `peak=${mode}`, new MediaBudgetTracker(), 32)) reports.push(report);
    assert.equal(reports.at(-1)!.includes("Sample peak:"), Boolean(mode & 2));
    assert.equal(reports.at(-1)!.includes("True peak:"), Boolean(mode & 4));
  }
});
