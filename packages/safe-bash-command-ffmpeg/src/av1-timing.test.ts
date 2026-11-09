import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseMkv, parseMp4, serializeMp4, parseAv1C, MediaBudgetTracker } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";
import { filterBitstream } from "./bitstream.js";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/av1-${name}.mkv`, import.meta.url));

// Reference packets generated with native FFmpeg 9.0.1's av1_metadata filter.
for (const [filter, reference] of [
  ["null", "timing-input"],
  ["av1_metadata=tick_rate=30000/1001:num_ticks_per_picture=1", "timing-native"],
  ["av1_metadata=tick_rate=50:num_ticks_per_picture=2", "two-ticks-native"],
  ["av1_metadata=tick_rate=30000/1001:num_ticks_per_picture=1,av1_metadata=tick_rate=50:num_ticks_per_picture=2", "two-ticks-native"]
] as const) {
  it(`copies AV1 timing like native FFmpeg: ${filter}`, async () => {
    const input = fixture("timing-input");
    const volume = Volume.fromJSON({ "/in.mkv": input });
    const args = ["-v", "error", "-y", "-i", "/in.mkv", "-map", "0:v", "-c", "copy", "-bsf:v", filter, "/out.mkv"];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args, cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    const output = parseMkv(volume.readFileSync("/out.mkv") as Buffer).tracks[0]!;
    const expected = parseMkv(fixture(reference)).tracks[0]!;
    assert.deepEqual(output.samples.map(sample => sample.data), expected.samples.map(sample => sample.data));
    assert.deepEqual(output.codecDescriptions[0]!.extraData, expected.codecDescriptions[0]!.extraData);
    const source = parseMkv(input).tracks[0]!;
    assert.deepEqual(output.samples.map(({ pts, dts, duration, isKeyframe }) => ({ pts, dts, duration, isKeyframe })),
      source.samples.map(({ pts, dts, duration, isKeyframe }) => ({ pts, dts, duration, isKeyframe })));
  });
}

it("rewrites MP4 configuration and in-band headers through the synchronous API", () => {
  const doc = parseMkv(fixture("timing-input"));
  const input = serializeMp4({ ...doc, tracks: doc.tracks.map(track => ({
    ...track, codecDescriptions: track.codecDescriptions.map(description => ({
      ...description, av1C: parseAv1C(description.extraData!)
    }))
  })) });
  const volume = Volume.fromJSON({ "/in.mp4": Buffer.from(input) });
  const args = ["-y", "-i", "/in.mp4", "-c", "copy", "-bsf:v", "av1_metadata=tick_rate=50:num_ticks_per_picture=2", "/out.mp4"];
  assert.equal(evalSyncFfmpeg(args, undefined,
    path => volume.readFileSync(path) as Buffer,
    (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
  const output = parseMp4(volume.readFileSync("/out.mp4") as Buffer).tracks[0]!;
  const expected = parseMkv(fixture("two-ticks-native")).tracks[0]!;
  assert.deepEqual(output.codecDescriptions[0]!.av1C!.rawBytes, expected.codecDescriptions[0]!.extraData);
  assert.deepEqual(output.samples.map(sample => sample.data), expected.samples.map(sample => sample.data));
});

for (const option of ["tick_rate=1/0", "tick_rate=-1", "tick_rate=1/2/3", "num_ticks_per_picture=2147483648", "num_ticks_per_picture=1.5", "unknown=1"]) {
  it(`rejects invalid AV1 timing option ${option}`, () => {
    assert.throws(() => filterBitstream([], `av1_metadata=${option}`, new MediaBudgetTracker()), /bitstream filter option/);
  });
}

for (const data of [new Uint8Array([10, 127]), new Uint8Array([14]), new Uint8Array([10, 1, 0])]) {
  it(`rejects truncated AV1 OBU ${Array.from(data)}`, () => {
    const track = parseMkv(fixture("timing-input")).tracks[0]!;
    assert.throws(() => filterBitstream([{ ...track, samples: [{ ...track.samples[0]!, data }] }],
      "av1_metadata=tick_rate=50", new MediaBudgetTracker()), /Truncated AV1/);
  });
}
