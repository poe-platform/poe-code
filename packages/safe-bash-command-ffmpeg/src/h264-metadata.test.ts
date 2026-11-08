import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { BitWriter, MediaBudgetTracker, parseH264Sps, buildAvcC, concatBytes, createSyntheticMp4, parseAvcC, parseMp4, serializeMp4 } from "@poe-code/mp4-ast";
import { rewriteH264Sps } from "./h264-metadata.js";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// libx264 High-profile SPS, and native h264_metadata=level=4.1:colour_primaries=1 output.
const original = Buffer.from("6764000aacb208f6022000000300200000030101e244c9", "hex");
const expected = Buffer.from("67640029acb208f602d4040809000003000100000300080f122648", "hex");
for (const sync of [false, true]) {
  it(`rewrites configuration and in-band SPS without changing frames (sync=${sync})`, async () => {
    const doc = parseMp4(createSyntheticMp4({ width: 64, height: 48, frameCount: 4 }));
    const track = doc.tracks[0]!;
    const description = track.codecDescriptions[0]!;
    const avcC = parseAvcC(buildAvcC([original], description.avcC!.pps));
    const prefix = Buffer.alloc(4);
    prefix.writeUInt32BE(original.length);
    const frames = track.samples.map(sample => {
      const units: Uint8Array[] = [];
      for (let offset = 0; offset < sample.data.length;) {
        const size = new DataView(sample.data.buffer, sample.data.byteOffset + offset).getUint32(0);
        if ((sample.data[offset + 4]! & 31) !== 7) units.push(sample.data.subarray(offset, offset + 4 + size));
        offset += 4 + size;
      }
      return concatBytes(units);
    });
    const samples = track.samples.map((sample, i) => ({ ...sample, data: concatBytes([prefix, original, frames[i]!]) }));
    const input = serializeMp4({ ...doc, tracks: [{ ...track, codecDescriptions: [{ ...description, rawStsdEntryBytes: undefined, avcC }], samples }] });
    const volume = Volume.fromJSON({ "/in.mp4": Buffer.from(input) });
    const args = ["-y", "-i", "/in.mp4", "-c:v", "copy", "-bsf:v", "h264_metadata=level=4.1:colour_primaries=1", "/out.mp4"];
    if (sync) {
      assert.equal(evalSyncFfmpeg(args, undefined, path => volume.readFileSync(path) as Buffer,
        (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
    } else {
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args, cwd: "/", env: {}, signal: new AbortController().signal,
        fs: { async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); } },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
    }
    const output = parseMp4(volume.readFileSync("/out.mp4") as Buffer).tracks[0]!;
    assert.equal(output.codecDescriptions[0]!.avcC!.levelIdc, 41);
    assert.deepEqual(Buffer.from(output.codecDescriptions[0]!.avcC!.sps[0]!), expected);
    assert.equal(output.samples.length, samples.length);
    for (const [i, sample] of output.samples.entries()) {
      assert.equal(new DataView(sample.data.buffer, sample.data.byteOffset).getUint32(0), expected.length);
      assert.deepEqual(Buffer.from(sample.data.subarray(4, 4 + expected.length)), expected);
      assert.deepEqual(Buffer.from(sample.data.subarray(4 + expected.length)), Buffer.from(frames[i]!));
      assert.equal(sample.duration, samples[i]!.duration);
    }
  });
}


it("preserves existing colour description, timing and SPS bytes on repeat edits", () => {
  const budget = new MediaBudgetTracker();
  assert.deepEqual(Buffer.from(rewriteH264Sps(expected, 41, 1, budget)), expected);
  const levelOnly = Buffer.from(original);
  levelOnly[3] = 41;
  assert.deepEqual(Buffer.from(rewriteH264Sps(original, 41, undefined, budget)), levelOnly);
  const changed = rewriteH264Sps(expected, undefined, 9, budget);
  assert.notDeepEqual(Buffer.from(changed), expected);
  assert.deepEqual(Buffer.from(rewriteH264Sps(changed, undefined, 1, budget)), expected);
  assert.equal(parseH264Sps(changed).fps, parseH264Sps(original).fps);
});

it("adds VUI to an SPS with no VUI while preserving dimensions", () => {
  const bits = new BitWriter();
  bits.writeBits(0x6742001e, 32);
  bits.writeUE(0); bits.writeUE(0); bits.writeUE(0); bits.writeUE(0);
  bits.writeUE(1); bits.writeBit(0); // references, gaps
  bits.writeUE(3); bits.writeUE(2); // 64x48
  bits.writeBit(1); bits.writeBit(1); // progressive, direct inference
  bits.writeBit(0); bits.writeBit(0); // crop, VUI
  bits.writeRbspTrailingBits();
  const sps = bits.toUint8Array();
  const updated = rewriteH264Sps(sps, 41, 1, new MediaBudgetTracker());
  const parsed = parseH264Sps(updated);
  assert.equal(parsed.width, 64);
  assert.equal(parsed.height, 48);
  assert.equal(parsed.levelIdc, 41);
  assert.equal(parsed.colorRange, "tv");
  assert.deepEqual(rewriteH264Sps(updated, 41, 1, new MediaBudgetTracker()), updated);
});

for (const option of ["level=bogus", "level=4.15", "colour_primaries=256", "colour_primaries=-1", "colour_primaries=1.5", "colour_primaries=", "level=4.1:bogus=1"]) {
  it(`rejects invalid metadata before reading input: ${option}`, () => {
    let writes = 0;
    assert.equal(evalSyncFfmpeg(["-y", "-i", "/in.mp4", "-c:v", "copy", "-bsf:v", `h264_metadata=${option}`, "/out.mp4"], undefined,
      () => { throw new Error("must validate before input read"); }, () => { writes++; return true; }), undefined);
    assert.equal(writes, 0);
  });
}
