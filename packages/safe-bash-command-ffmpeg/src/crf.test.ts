import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseMp4, decodeH264Samples } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const input = readFileSync(new URL("./fixtures/crf-input.mp4", import.meta.url));
function pixels(bytes: Uint8Array) {
  const track = parseMp4(bytes).tracks[0]!;
  return [...decodeH264Samples(track.samples, track.codecDescriptions, track.width!, track.height!, track.timescale)]
    .map(frame => frame.native!.pixels);
}
async function encode(crf: string, filter = "hflip", copy = false, extra: string[] = [], options: Parameters<typeof createFfmpegCommand>[0] = {}) {
  const volume = Volume.fromJSON({ "/in.mp4": input });
  let stderr = "";
  const args = ["-y", "-i", "/in.mp4", ...(filter ? ["-vf", filter] : []), "-c:v", copy ? "copy" : "libx264", "-crf", crf, ...extra, "/out.mp4"];
  const result = await createFfmpegCommand(options).execute({
    args, cwd: "/", env: {}, signal: new AbortController().signal,
    fs: { async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); } },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { result, stderr, output: volume.existsSync("/out.mp4") ? volume.readFileSync("/out.mp4") as Buffer : undefined };
}
for (const filter of ["hflip", "vflip", ""]) {
  it(`CRF 0 preserves all native YUV samples through ${filter || "re-encoding"}; CRF 40 is lossy`, async () => {
    const expected = pixels(input).map(source => {
      const result = source.slice();
      let offset = 0;
      for (const [width, height] of [[64, 48], [32, 24], [32, 24]]) {
        for (let y = 0; y < height!; y++) for (let x = 0; x < width!; x++) {
          result[offset + y * width! + x] = source[offset + (filter === "vflip" ? height! - 1 - y : y) * width! + (filter === "hflip" ? width! - 1 - x : x)]!;
        }
        offset += width! * height!;
      }
      return result;
    });
    const lossless = await encode("0", filter);
    assert.equal(lossless.result.exitCode, 0, lossless.stderr);
    const actual = pixels(lossless.output!);
    assert.equal(actual.length, expected.length);
    assert.equal(actual.reduce((sum, frame, i) => sum + frame.filter((value, j) => value !== expected[i]![j]).length, 0), 0);
    const lossy = await encode("40", filter);
    assert.equal(lossy.result.exitCode, 0, lossy.stderr);
    const decoded = pixels(lossy.output!);
    assert.equal(decoded.length, 12);
    assert.notDeepEqual(decoded, expected);
    assert.notDeepEqual(lossy.output, lossless.output);
  });
}
it("CRF does not change stream-copy packets", async () => {
  const copy = await encode("40", "", true);
  assert.equal(copy.result.exitCode, 0, copy.stderr);
  assert.deepEqual(parseMp4(copy.output!).tracks[0]!.samples.map(s => s.data), parseMp4(input).tracks[0]!.samples.map(s => s.data));
});
for (const crf of ["bogus", "NaN", "Infinity", "-1", "52", ""]) {
  it(`rejects invalid CRF ${JSON.stringify(crf)} without output`, async () => {
    const result = await encode(crf);
    assert.equal(result.result.exitCode, 1);
    assert.equal(result.output, undefined);
  });
}
it("sync CRF encoding defers to the asynchronous encoder", () => {
  let writes = 0;
  assert.equal(evalSyncFfmpeg(["-i", "/in.mp4", "-crf", "0", "/out.mp4"], undefined,
    () => input, () => { writes++; return true; }), undefined);
  assert.equal(writes, 0);
});

it("CRF encoding retains forced-keyframe requests", async () => {
  const encoded = await encode("23.5", "", false, ["-force_key_frames", "0.25,0.75"]);
  assert.equal(encoded.result.exitCode, 0, encoded.stderr);
  const track = parseMp4(encoded.output!).tracks[0]!;
  const presentation = [...track.samples].sort((a, b) => a.pts - b.pts);
  const origin = presentation[0]!.pts;
  for (const time of [0.25, 0.75]) {
    const frame = presentation.find(sample => sample.pts >= origin + Math.round(time * track.timescale))!;
    assert.ok(frame.isKeyframe);
  }
});

it("does not bypass consumers that disable video transcoding", async () => {
  const result = await encode("0", "", false, [], { features: { videoTranscode: false } });
  assert.equal(result.result.exitCode, 1);
  assert.equal(result.output, undefined);
});
