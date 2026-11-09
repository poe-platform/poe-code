import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { MediaBudgetTracker, parseWav } from "@poe-code/mp4-ast";
import { filterBitstream } from "./bitstream.js";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// FFmpeg 7.0.2 framecrc reference for mono PCM16 samples 1..8019 at 48 kHz.
const fractional = [
  [0, 1602, "0x502b1662"], [1602, 1601, "0xfe454dee"],
  [3203, 1602, "0x74148652"], [4805, 1601, "0x4027b656"],
  [6406, 1602, "0x9c5cb484"]
] as const;
const integer = [
  [0, 1600, "0xf73015d3"], [1600, 1600, "0x296b4cd3"],
  [3200, 1600, "0x106683d3"], [4800, 1600, "0xaa22b9d4"],
  [6400, 1600, "0xc06fb213"], [8000, 19, "0x951b07cb"]
] as const;
const input = encodeWav({ sampleRate: 48000,
  channels: [Float64Array.from({ length: 8019 }, (_, i) => (i + 1) / 32768)] });

for (const [filter, expected] of [
  ["null", [[0, 4096, "0xcb137088"], [4096, 3923, "0xb861e9b2"]]],
  ["pcm_rechunk=r=30:p=0", integer],
  ["pcm_rechunk=r=30:p=1", [...integer.slice(0, 5), [8000, 1600, "0xdc1907cb"]]],
  ["pcm_rechunk=r=30000/1001:p=0", [...fractional, [8008, 11, "0x360304af"]]],
  ["pcm_rechunk=frame_rate=30000/1001:pad=0", [...fractional, [8008, 11, "0x360304af"]]],
  ["pcm_rechunk=r=30000/1001:p=1", [...fractional, [8008, 1602, "0x709b04af"]]]
] as const) it(`matches native PCM rate packets and bytes: ${filter}`, async () => {
  const fs = Volume.fromJSON({});
  fs.writeFileSync("/in.wav", input);
  for (const format of ["framecrc", "s16le"]) {
    const output: Uint8Array[] = [];
    let stderr = "";
    const args = ["-v", "error", "-i", "/in.wav", "-c:a", "copy", "-bsf:a", filter, "-f", format];
    const result = await createFfmpegCommand().execute({
      args: [...args, "-"], cwd: "/", env: {}, signal: new AbortController().signal,
      fs: { async readFile(path: string) { return fs.readFileSync(path); }, async stat(path: string) { return fs.statSync(path); } },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    const bytes = Buffer.concat(output);
    if (format === "framecrc") {
      const rows = bytes.toString().split("\n").filter(line => line && !line.startsWith("#"));
      assert.deepEqual(rows.map(row => row.split(",").map(field => field.trim())),
        expected.map(([pts, duration, crc]) => ["0", String(pts), String(pts), String(duration), String(duration * 2), crc]));
    } else {
      const length = expected.reduce((sum, [, duration]) => sum + duration, 0);
      const pcm = Buffer.alloc(length * 2);
      for (let i = 0; i < 8019; i++) pcm.writeInt16LE(i + 1, i * 2);
      assert.deepEqual(bytes, pcm);
      assert.equal(evalSyncFfmpeg(["-y", ...args.slice(2, -1), "wav", "/out.wav"], undefined,
        path => fs.readFileSync(path) as Buffer,
        (path, data) => { fs.writeFileSync(path, data); return true; }), "");
      const audio = parseWav(fs.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
      assert.deepEqual(audio.channelData[0], Float32Array.from({ length }, (_, i) => i < 8019 ? (i + 1) / 32768 : 0));
    }
  }
});

it("keeps rational cadence across source packets, exact tails, and rate overrides", () => {
  const track = parseWav(input).tracks[0]!;
  const data = new Uint8Array(8008 * 2);
  const source = { ...track, samples: [{ ...track.samples[0]!, data, duration: 8008 }] };
  const result = filterBitstream([source], "pcm_rechunk=r=30000/1001:n=7", new MediaBudgetTracker(), "audio")[0]!;
  assert.deepEqual(result.samples.map(sample => sample.duration), [1602, 1601, 1602, 1601, 1602]);
  assert.equal(result.duration, 8008);
  const fixed = filterBitstream([source], "pcm_rechunk=r=30:r=0:n=2000:p=0", new MediaBudgetTracker(), "audio")[0]!;
  assert.deepEqual(fixed.samples.map(sample => sample.duration), [2000, 2000, 2000, 2000, 8]);
});

it("rejects invalid PCM frame rates and bounds variable packet allocations", () => {
  const tracks = parseWav(input).tracks;
  for (const rate of ["-1", "1/0", "NaN", "Infinity", "1/2/3", "/2", "2/", "48001"]) {
    assert.throws(() => filterBitstream(tracks, `pcm_rechunk=r=${rate}`, new MediaBudgetTracker(), "audio"), /pcm_rechunk/);
  }
  assert.throws(() => filterBitstream(tracks, "pcm_rechunk=r=1/1000", new MediaBudgetTracker({ maxOutputBytes: 20000 }), "audio"), /maxOutputBytes/);
  assert.throws(() => filterBitstream(tracks, "pcm_rechunk=r=30000/1001", new MediaBudgetTracker({ maxSamplesPerTrack: 5 }), "audio"), /maxSamplesPerTrack/);
});

it("repeats the fractional cadence without drift", () => {
  const track = parseWav(input).tracks[0]!;
  const data = new Uint8Array(8008 * 20 * 2);
  const source = { ...track, samples: [{ ...track.samples[0]!, data, duration: data.length / 2 }] };
  const result = filterBitstream([source], "pcm_rechunk=r=30000/1001:p=0", new MediaBudgetTracker(), "audio")[0]!;
  assert.equal(result.samples.length, 100);
  assert.equal(result.duration, 160160);
  for (let i = 0; i < result.samples.length; i++) {
    assert.equal(result.samples[i]!.pts, Math.floor(i / 5) * 8008 + fractional[i % 5]![0]);
    assert.equal(result.samples[i]!.duration, fractional[i % 5]![1]);
  }
});
