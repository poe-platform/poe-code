import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { MediaBudgetTracker, parseMkv } from "@poe-code/mp4-ast";
import { filterBitstream } from "./bitstream.js";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const input = readFileSync(new URL("./fixtures/vp9-color.webm", import.meta.url));
// FFmpeg 7.0.2 packet SHA-256 values; native ffprobe reports pc/bt709 and tv/bt2020nc.
const cases = [
  { filter: undefined, hashes: [
    "a8a62122bce393d706bd7230bb1a7256f215de76d2c652e63cbc7fca5f7af189",
    "80639061251c4a3cf0c6be7ee5bfc9e0f26b550393fccdffe54c97c45f9f188a",
    "55e950fc56679b5d8144188dc90858fc552cb30041551d7298c2d27e463af64b"
  ] },
  { filter: "vp9_metadata=color_space=bt709:color_range=pc", hashes: [
    "74783fa33d008a7bb0ddeee9a09b90e64d1d2e52b321bd9d314589d43ff0caff",
    "f51bc140835740fa295508d054ea584e8d776dc660ce8c7bfeec5ee158095525",
    "84e5482a529877cde80421a38a5667bdcbf21f2f528fe3972084daab572f4cd0"
  ] },
  { filter: "vp9_metadata=color_space=bt2020:color_range=tv", hashes: [
    "903a0b7715ee278d0250128318771fa82cb26eb4c23a304d442dcafafeada0ec",
    "3daab1ea6f8fd9ca0ac95cc2492b8279c8480fa5bf596a7347b9bb5a0b6a3cce",
    "6395f774ffe1be5a0c9378f0c6bf90b188f155b5dc154037d566c27b55435993"
  ] }
];

for (const sync of [false, true]) {
  for (const { filter, hashes } of cases) {
    it(`${sync ? "sync" : "async"} VP9 copy matches native packets for ${filter ?? "unfiltered control"}`, async () => {
      const volume = Volume.fromJSON({ "/in.webm": input });
      const args = ["-v", "error", "-y", "-i", "/in.webm", ...(sync ? [] : ["-map", "0:v"]), "-c", "copy",
        ...(filter ? ["-bsf:v", filter] : []), "/out.mkv"];
      if (sync) {
        assert.equal(evalSyncFfmpeg(args, undefined,
          path => volume.readFileSync(path) as Buffer,
          (path, data) => { volume.writeFileSync(path, data); return true; }), "");
      } else {
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args, cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
      }
      const samples = parseMkv(volume.readFileSync("/out.mkv") as Buffer).tracks[0]!.samples;
      const source = parseMkv(input).tracks[0]!.samples;
      assert.deepEqual(samples.map(sample => createHash("sha256").update(sample.data).digest("hex")), hashes);
      assert.deepEqual(samples.map(({ pts, dts, duration, isKeyframe, size }) => ({ pts, dts, duration, isKeyframe, size })),
        source.map(({ pts, dts, duration, isKeyframe, size }) => ({ pts, dts, duration, isKeyframe, size })));
    });
  }
}

// One-frame native libvpx-vp9 encodes (profiles 0–3), with native metadata output.
const profileFrames = [
  ["824983420000f000f60038241c184a00003060000010bffff71dafffffff5fdffffffff22ac000", "824983425000f000f60038241c184a00003060000010bffff71dafffffff5fdffffffff22ac000"],
  ["a249834200001e001ec0070483830940000660000010bffff71daffffffff30d5ffffffffa8ec000", "a249834250001e001ec0070483830940000660000010bffff71daffffffff30d5ffffffffa8ec000"],
  ["92498342000078007b001c120e0c2c00001860000010bffff6a0afffffff285ffffffff1680000", "92498342280078007b001c120e0c2c00001860000010bffff6a0afffffff285ffffffff1680000"],
  ["b124c1a10000078007b001c120e0c2c0000180600000187ffffb5057fffffff9542ffffffffcdfb000", "b124c1a11400078007b001c120e0c2c0000180600000187ffffb5057fffffff9542ffffffffcdfb000"]
];

for (const [profile, [source, expected]] of profileFrames.entries()) {
  it(`edits profile ${profile} headers without changing compressed data`, () => {
    assert.deepEqual(edit(Buffer.from(source!, "hex")), Buffer.from(expected!, "hex"));
  });
}

it("edits every coded header in a superframe while preserving its index and input", () => {
  const frames = profileFrames.slice(0, 2).map(([source]) => Buffer.from(source!, "hex"));
  const index = Buffer.from([0xc1, frames[0]!.length, frames[1]!.length, 0xc1]);
  const packet = Buffer.concat([...frames, index]);
  const before = Buffer.from(packet);
  assert.deepEqual(edit(packet), Buffer.concat([...profileFrames.slice(0, 2).map(([, expected]) => Buffer.from(expected!, "hex")), index]));
  assert.deepEqual(packet, before);
});

it("keeps show-existing and inter-frame packets untouched", () => {
  for (const packet of [Buffer.from([0x88]), Buffer.from([0x86])]) assert.deepEqual(edit(packet), packet);
});

it("honors numeric options, unset values, and filter ordering", () => {
  const packet = Buffer.from(profileFrames[0]![0]!, "hex");
  assert.deepEqual(edit(packet, "vp9_metadata=color_space=2:color_range=1"), edit(packet));
  for (const filter of ["vp9_metadata", "vp9_metadata=color_space=-1:color_range=-1",
    "vp9_metadata=color_space=bt709:color_range=pc,vp9_metadata=color_space=unknown:color_range=tv"]) {
    assert.deepEqual(edit(packet, filter), packet);
  }
});

for (const option of ["color_space=bad", "color_space=8", "color_range=2", "color_space=1.5", "color_range=", "unknown=1", "color_space=2=3"]) {
  it(`rejects ${option} before reading input or replacing output`, () => {
    let reads = 0;
    let writes = 0;
    assert.equal(evalSyncFfmpeg(["-y", "-i", "/in.webm", "-c", "copy", "-bsf:v", `vp9_metadata=${option}`, "/out.mkv"], undefined,
      () => { reads++; return input; },
      () => { writes++; return true; }), undefined);
    assert.equal(reads, 0);
    assert.equal(writes, 0);
    assert.throws(() => filterBitstream([], `vp9_metadata=${option}`, new MediaBudgetTracker()), /bitstream filter option/);
  });
}

it("rejects truncated headers and corrupt superframe sizes", () => {
  for (const bytes of [[], [0x00], [0x82], [0x82, 0x49, 0x83, 0x42], [0x82, 0xc0, 3, 0xc0]]) {
    assert.throws(() => edit(Buffer.from(bytes)), /vp9_metadata/);
  }
});

it("rejects other video codecs", () => {
  const track = parseMkv(input).tracks[0]!;
  assert.throws(() => filterBitstream([{ ...track, codecDescriptions: track.codecDescriptions.map(codec => ({ ...codec, codecName: "vp8" })) }],
    "vp9_metadata=color_range=pc", new MediaBudgetTracker()), /vp9/);
});

function edit(data: Uint8Array, filter = "vp9_metadata=color_space=bt709:color_range=pc"): Buffer {
  const track = parseMkv(input).tracks[0]!;
  const result = filterBitstream([{ ...track, samples: [{ ...track.samples[0]!, data, size: data.length }] }], filter, new MediaBudgetTracker());
  return Buffer.from(result[0]!.samples[0]!.data);
}
