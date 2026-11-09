import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { MediaBudgetTracker, parseMp4, serializeMp4, concatBytes, createSyntheticMp4 } from "@poe-code/mp4-ast";
import { filterBitstream } from "./bitstream.js";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const input420 = readFileSync(new URL("./fixtures/hevc-crop-420.mp4", import.meta.url));
const input444 = readFileSync(new URL("./fixtures/hevc-crop-444.mp4", import.meta.url));
// FFmpeg 7.0.2 SPS output. Native decoding shows 84x54 and 93x64, respectively,
// while coded dimensions remain 96x64 and every compressed picture packet is unchanged.
const cases = [
  { input: input420, filter: "hevc_metadata=crop_right=12:crop_top=6:crop_bottom=4",
    sps: "42010101600000030090000003000003001ea0308107391e592a4932bc05a02000000300200000030061" },
  { input: input444, filter: "hevc_metadata=crop_right=3",
    sps: "4201010408000003009e0800000300001e90061020e4f2c9524995e02d010000030001000003000308" }
];

for (const sync of [false, true]) {
  for (const { input, filter, sps } of cases) {
    it(`matches native HEVC crop SPS and preserves packets (sync=${sync}, ${filter})`, async () => {
      const volume = Volume.fromJSON({ "/in.mp4": input });
      const args = ["-v", "error", "-y", "-i", "/in.mp4", ...(sync ? [] : ["-map", "0:v"]), "-c", "copy", "-bsf:v", filter, "/out.mp4"];
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
      const original = parseMp4(input).tracks[0]!;
      const output = parseMp4(volume.readFileSync("/out.mp4") as Buffer).tracks[0]!;
      const config = output.codecDescriptions[0]!.hvcC!;
      assert.equal(Buffer.from(config.naluArrays.find(array => array.nalUnitType === 33)!.nalUnits[0]!).toString("hex"), sps);
      assert.deepEqual(config.naluArrays.filter(array => array.nalUnitType !== 33),
        original.codecDescriptions[0]!.hvcC!.naluArrays.filter(array => array.nalUnitType !== 33));
      const packets = (samples: typeof output.samples) => samples.map(({ data, pts, dts, duration, size, isKeyframe }) => ({ data, pts, dts, duration, size, isKeyframe }));
      assert.deepEqual(packets(output.samples), packets(original.samples));
    });
  }
}

it("preserves null, unset and zero controls, and applies crop chains in order", () => {
  const tracks = parseMp4(new Uint8Array(input420)).tracks;
  for (const chain of ["null", "hevc_metadata", "hevc_metadata=crop_right=-1", "hevc_metadata=crop_right=0:crop_bottom=0"]) {
    assert.deepEqual(filterBitstream(tracks, chain, new MediaBudgetTracker()), tracks);
  }
  const cropped = filterBitstream(tracks, cases[0]!.filter, new MediaBudgetTracker());
  assert.deepEqual(filterBitstream(cropped, "hevc_metadata=crop_right=0:crop_top=0:crop_bottom=0", new MediaBudgetTracker()), tracks);
  assert.deepEqual(filterBitstream(tracks, `${cases[0]!.filter},null,hevc_metadata=crop_right=12`, new MediaBudgetTracker()), cropped);
});

it("rewrites in-band SPS using each sample's configuration while preserving picture NALs", () => {
  const doc = parseMp4(new Uint8Array(input420)), track = doc.tracks[0]!;
  const sps = track.codecDescriptions[0]!.hvcC!.naluArrays.find(array => array.nalUnitType === 33)!.nalUnits[0]!;
  const prefix = Buffer.alloc(4); prefix.writeUInt32BE(sps.length);
  const samples = track.samples.map(sample => ({ ...sample, data: concatBytes([prefix, sps, sample.data]) }));
  const source = parseMp4(serializeMp4({ ...doc, tracks: [{ ...track, samples }] }));
  const output = filterBitstream(source.tracks, cases[0]!.filter, new MediaBudgetTracker())[0]!;
  for (const [i, sample] of output.samples.entries()) {
    const expected = Buffer.from(cases[0]!.sps, "hex");
    assert.equal(new DataView(sample.data.buffer, sample.data.byteOffset).getUint32(0), expected.length);
    assert.deepEqual(Buffer.from(sample.data.subarray(4, 4 + expected.length)), expected);
    assert.deepEqual(sample.data.subarray(4 + expected.length), track.samples[i]!.data);
  }
});

for (const option of ["crop_right=3", "crop_top=1", "crop_left=96", "crop_bottom=64", "crop_right=-2", "crop_right=1.5", "crop_right=", "crop_right=2147483648", "bogus=0"]) {
  it(`rejects invalid 4:2:0 crops without replacing output: ${option}`, () => {
    const volume = Volume.fromJSON({ "/in.mp4": input420, "/out.mp4": "KEEP" });
    assert.equal(evalSyncFfmpeg(["-y", "-i", "/in.mp4", "-c", "copy", "-bsf:v", `hevc_metadata=${option}`, "/out.mp4"], undefined,
      path => volume.readFileSync(path) as Buffer, (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), undefined);
    assert.equal(volume.readFileSync("/out.mp4", "utf8"), "KEEP");
  });
}

it("rejects non-HEVC codecs", () => {
  assert.throws(() => filterBitstream(parseMp4(createSyntheticMp4()).tracks,
    "hevc_metadata=crop_right=2", new MediaBudgetTracker()), /HEVC/);
});

it("uses SPS chroma alignment even when the configuration summary disagrees", () => {
  for (const [input, summaryChroma, valid] of [[input420, 3, false], [input444, 1, true]] as const) {
    const track = parseMp4(input).tracks[0]!;
    const description = track.codecDescriptions[0]!;
    const config = description.hvcC!;
    const rawBytes = new Uint8Array(config.rawBytes);
    rawBytes[16] = (rawBytes[16]! & 0xfc) | summaryChroma;
    const tracks = [{ ...track, codecDescriptions: [{ ...description, hvcC: { ...config, chromaFormatIdc: summaryChroma, rawBytes } }] }];
    const run = () => filterBitstream(tracks, "hevc_metadata=crop_right=3", new MediaBudgetTracker());
    if (valid) assert.doesNotThrow(run);
    else assert.throws(run, /multiple of 2/);
  }
});

it("rejects truncated in-band SPS and NAL lengths", () => {
  const track = parseMp4(input420).tracks[0]!;
  for (const data of [new Uint8Array([0, 0, 0]), new Uint8Array([0, 0, 0, 8, 0x42, 1]), new Uint8Array([0, 0, 0, 3, 0x42, 1, 0])]) {
    assert.throws(() => filterBitstream([{ ...track, samples: [{ ...track.samples[0]!, data }] }],
      "hevc_metadata=crop_right=2", new MediaBudgetTracker()), /HEVC/);
  }
});
