import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { MediaBudgetTracker, parseWav } from "@poe-code/mp4-ast";
import { passAudio } from "./audio-pass.js";
import { createFfmpegCommand } from "./index.js";

const input = encodeWav({ sampleRate: 8000, channels: [Float64Array.from({ length: 8000 }, (_, i) =>
  (((i * 73 % 97) - 48) * 20 + (i % 40 < 20 ? 3200 : -3200)) / 32768)] });

// FFmpeg 7.0.2 PCM16 data, excluding WAV metadata, for the deterministic 8 kHz input above.
for (const [filter, peak, digest] of [
  ["anull", 4160, "00615be1c4bbc2ec2c08836992f10c4becf3190cfa99dbf3f294d01d9e686f81"],
  ["lowpass=f=800", 3833, "1922bf502c1b1824394924e27e51c728e183f1f316223f537852cc1702c60771"],
  ["bandpass=f=1000", 5638, "a2c4d99fde2a6b6f641762a0c95ffeddc87671dc316a67b1cb4822fa5c1193c6"],
  ["bandpass=f=1000:w=1", 4014, "515ec29fb578bbef290dbb398c99a4e0993a1e73bd46a9fcf84eb6da27a098aa"],
  ["bandpass=f=1000:width_type=h:w=200", 1455, "0e5b56df0c3e3ce0d42fc13f5195bdf1439b2b980529da13d2356a2391a54dc2"],
  ["bandpass@voice=frequency=1000:width_type=q:width=1", 4014, "515ec29fb578bbef290dbb398c99a4e0993a1e73bd46a9fcf84eb6da27a098aa"],
  ["bandpass=1000:t=h:w=200", 1455, "0e5b56df0c3e3ce0d42fc13f5195bdf1439b2b980529da13d2356a2391a54dc2"]
] as const) {
  for (const graph of [false, true]) it(`matches native PCM for ${filter}, graph=${graph}`, async () => {
    const { fs, result, stderr } = await run(filter, graph);
    assert.equal(result.exitCode, 0, stderr);
    const audio = parseWav(fs.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
    assert.equal(audio.sampleRate, 8000);
    assert.equal(audio.channelData.length, 1);
    const samples = audio.channelData[0]!;
    assert.equal(samples.length, 8000);
    const pcm = Buffer.alloc(samples.length * 2);
    let actualPeak = 0;
    for (const [i, sample] of samples.entries()) {
      const value = sample * 32768;
      pcm.writeInt16LE(value, i * 2);
      actualPeak = Math.max(actualPeak, Math.abs(value));
    }
    assert.equal(actualPeak, peak);
    assert.equal(createHash("sha256").update(pcm).digest("hex"), digest);
  });
}

for (const option of ["f=-1", "w=-1", "width_type=invalid", "p=1", "poles=2", "unknown=1"]) {
  it(`rejects bandpass ${option} without replacing output`, async () => {
    const { fs, result, stderr } = await run(`bandpass=${option}`);
    assert.notEqual(result.exitCode, 0);
    assert.ok(stderr.includes("bandpass"), stderr);
    assert.equal(fs.readFileSync("/out.wav", "utf8"), "KEEP");
  });
}

it("bounds bandpass memory and honors cancellation", async () => {
  await assert.rejects(passAudio([new Float64Array(64)], 8000, "bandpass", "s16",
    new MediaBudgetTracker({ maxMemoryBytes: 64 })), /maxMemoryBytes/);
  await assert.rejects(passAudio([new Float64Array(64)], 8000, "bandpass", "s16",
    new MediaBudgetTracker(), AbortSignal.abort()));
});

async function run(filter: string, graph = false) {
  const fs = Volume.fromJSON({ "/in.wav": Buffer.from(input), "/out.wav": "KEEP" });
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
      "-c:a", "pcm_s16le", "/out.wav"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return fs.readFileSync(path); },
      async writeFile(path: string, data: Uint8Array) { fs.writeFileSync(path, data); },
      async stat(path: string) { return fs.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
  } as never);
  return { fs, result, stderr };
}
