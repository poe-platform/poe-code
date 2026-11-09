import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

function source() {
  return Volume.fromJSON({ "/ramp.wav": Buffer.from(encodeWav({ sampleRate: 8000,
    channels: [Float64Array.from({ length: 24000 }, (_, frame) => frame / 32768)] })) });
}

async function run(volume: Volume, options: string[]) {
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-i", "/ramp.wav", "-c", "copy", "-f", "segment",
      "-segment_time", "1", "-segment_list", "/list.csv", ...options, "/part%02d.wav"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { ...result, stderr };
}

// Native FFmpeg 7.0.2 reference: mono PCM16 ramp, 24000 samples at 8000 Hz.
for (const [options, lengths, cuts] of [
  [[], [8192, 8192, 7616], [0, 1.024, 2.048, 3]],
  [["-segment_time_delta", "0"], [8192, 8192, 7616], [0, 1.024, 2.048, 3]],
  [["-segment_time_delta", "0.06"], [7680, 8192, 7680, 448], [0, 0.96, 1.984, 2.944, 3]],
  [["-segment_time_delta", "60ms"], [7680, 8192, 7680, 448], [0, 0.96, 1.984, 2.944, 3]],
  [["-segment_time_delta", "00:00:00.060000"], [7680, 8192, 7680, 448], [0, 0.96, 1.984, 2.944, 3]],
  [["-segment_times", "1,2,3", "-segment_time_delta", "0.06"], [7680, 8192, 7680, 448], [0, 0.96, 1.984, 2.944, 3]],
  [["-segment_frames", "16,32", "-segment_time_delta", "0.06"], [8192, 8192, 7616], [0, 1.024, 2.048, 3]],
  [["-segment_time_delta", "0.06", "-min_seg_duration", "1"], [8192, 8192, 7616], [0, 1.024, 2.048, 3]],
  [["-segment_time_delta", "0.04"], [7680, 8192, 8128], [0, 0.96, 1.984, 3]]
] as const) {
  it(`preserves every sample and lists actual WAV cut times (${options.join(" ") || "default delta"})`, async () => {
    const volume = source();
    const result = await run(volume, [...options]);
    assert.equal(result.exitCode, 0, result.stderr);
    const parts = volume.readdirSync("/").filter(name => String(name).startsWith("part"));
    const pcm = parts.map(name => parseWav(volume.readFileSync(`/${name}`) as Buffer).tracks[0]!.decodedAudio!.channelData[0]!);
    assert.deepEqual(pcm.map(channel => channel.length), lengths);
    assert.deepEqual(pcm.flatMap(channel => Array.from(channel)),
      Array.from(parseWav(volume.readFileSync("/ramp.wav") as Buffer).tracks[0]!.decodedAudio!.channelData[0]!));
    assert.equal(volume.readFileSync("/list.csv", "utf8"), lengths.map((_, index) =>
      `part0${index}.wav,${cuts[index]!.toFixed(6)},${cuts[index + 1]!.toFixed(6)}\n`).join(""));
  });
}

for (const value of ["", "-0.01", "NaN", "Infinity", "bad", "0.06junk", "1e999", "00:60:00"]) {
  it(`rejects invalid segment_time_delta ${JSON.stringify(value)} before overwriting files`, async () => {
    const volume = source();
    volume.writeFileSync("/part00.wav", "keep segment");
    volume.writeFileSync("/list.csv", "keep list");
    const before = volume.toJSON();
    const result = await run(volume, ["-segment_time_delta", value]);
    assert.notEqual(result.exitCode, 0);
    assert.ok(result.stderr.includes("segment_time_delta"), result.stderr);
    assert.deepEqual(volume.toJSON(), before);
  });
}
