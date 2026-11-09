import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { MediaBudgetTracker, parseAv1C, parseMkv, parseMp4, serializeMp4 } from "@poe-code/mp4-ast";
import { filterBitstream } from "./bitstream.js";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const input = readFileSync(new URL("./fixtures/av1-timing-input.mkv", import.meta.url));
// FFmpeg 7.0.2 packet hashes; native decoding confirms signaling on all three frames.
const cases = [
  {
    "filter": "null",
    "config": "81000c000a0a00000002a5ff36be4010",
    "hashes": [
      "287a189eec3d0c2802438259d68f3387de318f173d235461ef7dffad760bcce1",
      "442f85ecefe0aa3311b60d1a2912d86b8a1dbd0d63f2e72cd3e128ad2227b9be",
      "c80f42f22a800084d29de434fd45cb98feed7b8f987041a08194f27164699eef"
    ]
  },
  {
    "filter": "av1_metadata=color_primaries=9:transfer_characteristics=16:matrix_coefficients=9:color_range=pc",
    "config": "81000c000a0d00000002a5ff36be4424402610",
    "hashes": [
      "bd6d9580aab1a574334c745a2b2b76489c6ed91d842f4c4f080ee8282c6b1a6b",
      "a23f8dda5d10974062ed93324aa38efbf1c4c7167a86666d9c338248353c3c9c",
      "da8bf3c7e52d6cd5204fc7d17b0da9177711063800c7f9597b184a91f33ce6e0"
    ]
  },
  {
    "filter": "av1_metadata=color_primaries=1:transfer_characteristics=1:matrix_coefficients=1:color_range=tv",
    "config": "81000c000a0d00000002a5ff36be4404040410",
    "hashes": [
      "317d3b0bb390cdc693509ae1e47daacfa94e9dcb1ad0a02fd9b2817efc38ca40",
      "da139583fb98c7b6bf9610d897eccc52d59a5b5c8d4045433613c82ad1acf8a5",
      "89db31fd09084aa0bd21b5fddf20abdc173622131a33d6c44a2ad3499798ac5f"
    ]
  },
  {
    "filter": "av1_metadata=chroma_sample_position=colocated",
    "config": "81000e000a0a00000002a5ff36be4110",
    "hashes": [
      "c222a154074a47b58e3c4ca2cf9ccb47d926aafaa243a2d57cfc8a3c8bba3227",
      "ed340db982a8102ec0f6af3094a649434db4f0d10ceb1a69c227cb72034cf8aa",
      "3cc415caf39542a3f44523552d5e0e18f077fc8c17cf7a15149cb509c9faf37c"
    ]
  },
  {
    "filter": "av1_metadata=chroma_sample_position=vertical",
    "config": "81000d000a0a00000002a5ff36be4090",
    "hashes": [
      "16c72c4e6e318b793785b668d9bc82996fb8e14b2d4549359e305bc7b2aa5183",
      "8165ea4427b9dc2813a4a501513a32b105c0b7f3221c61cb5589bd7e02f44438",
      "3668d8097951b7fe6fa61d869c485b6da62da208274e7a5532be2c0941de3d02"
    ]
  }
];

for (const sync of [false, true]) {
  for (const { filter, hashes, config } of cases) {
    it(`copies AV1 with native signaling: ${filter} (sync=${sync})`, async () => {
      const volume = Volume.fromJSON({ "/in.mkv": input });
      const args = ["-v", "error", "-y", "-i", "/in.mkv", ...(sync ? [] : ["-map", "0:v"]), "-c", "copy", "-bsf:v", filter, "/out.mkv"];
      if (sync) {
        assert.equal(evalSyncFfmpeg(args, undefined,
          path => volume.readFileSync(path) as Buffer,
          (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
      } else {
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
      }
      const source = parseMkv(input).tracks[0]!;
      const output = parseMkv(volume.readFileSync("/out.mkv") as Buffer).tracks[0]!;
      assert.equal(Buffer.from(output.codecDescriptions[0]!.extraData!).toString("hex"), config);
      assert.deepEqual(output.samples.map(sample => createHash("sha256").update(sample.data).digest("hex")), hashes);
      assert.deepEqual(output.samples.map(sample => [sample.pts, sample.dts, sample.duration]),
        source.samples.map(sample => [sample.pts, sample.dts, sample.duration]));
    });
  }
}

const source = parseMkv(input).tracks[0]!;
const edit = "av1_metadata=color_primaries=9:transfer_characteristics=16:matrix_coefficients=9:color_range=pc:chroma_sample_position=vertical";
// Native libaom AV1 sequence headers: reduced still picture, monochrome, 4:4:4,
// 12-bit professional profile, and timing with equal picture intervals.
const configurations = {
  "reduced": [
    "81000c000a0618152ffb4010",
    "81000d000a0918152ffb4424402690"
  ],
  "monochrome": [
    "81001c000a0a00000002a5ff36be4a80",
    "81001c000a0d00000002a5ff36be4c24402680"
  ],
  "high": [
    "812000000a0a20000002a5ff36be4080",
    "812000000a0d20000002a5ff36be4848804c80"
  ],
  "professional": [
    "81406c000a0a40000002a5ff36be58c2",
    "81406d000a0d40000002a5ff36be5a122013d2"
  ],
  "timing": [
    "81000c000a130400000fa40001d4c2800000152ff9b5f20080",
    "81000d000a160400000fa40001d4c2800000152ff9b5f22122013480"
  ]
};
for (const [name, [original, expected]] of Object.entries(configurations)) {
  it(`rewrites ${name} decoder configuration while preserving unrelated syntax`, () => {
    const track = { ...source, samples: [], codecDescriptions: [{ ...source.codecDescriptions[0]!, extraData: Buffer.from(original!, "hex") }] };
    const output = filterBitstream([track], edit, new MediaBudgetTracker())[0]!;
    assert.equal(Buffer.from(output.codecDescriptions[0]!.extraData!).toString("hex"), expected);
    assert.deepEqual(filterBitstream([output], edit, new MediaBudgetTracker()), [output]);
  });
}

it("rewrites MP4 av1C sample entries and in-band sequence headers together", () => {
  const doc = parseMkv(input);
  const description = source.codecDescriptions[0]!;
  const mp4 = parseMp4(serializeMp4({ ...doc, tracks: [{ ...source,
    codecDescriptions: [{ ...description, av1C: parseAv1C(description.extraData!) }]
  }] }));
  const tracks = filterBitstream(mp4.tracks, cases[1]!.filter, new MediaBudgetTracker());
  const output = parseMp4(serializeMp4({ ...mp4, tracks })).tracks[0]!;
  assert.equal(Buffer.from(output.codecDescriptions[0]!.av1C!.rawBytes).toString("hex"), cases[1]!.config);
  assert.deepEqual(output.samples.map(sample => createHash("sha256").update(sample.data).digest("hex")), cases[1]!.hashes);
});

it("preserves unspecified color fields and honors sequential edits", () => {
  const tracks = filterBitstream([source], cases[1]!.filter, new MediaBudgetTracker());
  const updated = filterBitstream(tracks, "av1_metadata=color_primaries=1", new MediaBudgetTracker());
  const expected = filterBitstream([source], "av1_metadata=color_primaries=1:transfer_characteristics=16:matrix_coefficients=9:color_range=pc", new MediaBudgetTracker());
  assert.deepEqual(updated, expected);
  assert.deepEqual(filterBitstream(updated, "av1_metadata=color_primaries=9:color_primaries=-1", new MediaBudgetTracker()), updated);
  assert.deepEqual(filterBitstream([source], "av1_metadata", new MediaBudgetTracker()), [source]);
});

for (const option of ["color_primaries=256", "transfer_characteristics=-2", "matrix_coefficients=1.5", "color_range=2", "chroma_sample_position=3", "chroma_sample_position=center", "bogus=1", "color_range=", "color_range=pc=tv"]) {
  it(`rejects invalid AV1 options before input is read: ${option}`, async () => {
    assert.throws(() => filterBitstream([], `av1_metadata=${option}`, new MediaBudgetTracker()), /AV1 bitstream filter option/);
    let writes = 0;
    assert.equal(evalSyncFfmpeg(["-y", "-i", "/in.mkv", "-c", "copy", "-bsf:v", `av1_metadata=${option}`, "/out.mkv"], undefined,
      () => { throw new Error("must validate before input read"); }, () => { writes++; return true; }), undefined);
    assert.equal(writes, 0);
  });
}

it("rejects non-AV1 codecs and truncated or malformed OBUs", () => {
  assert.throws(() => filterBitstream([{ ...source, codecDescriptions: [{ ...source.codecDescriptions[0]!, codecName: "vp9" }] }], edit, new MediaBudgetTracker()), /does not support codec vp9/);
  for (const hex of ["8a00", "0e", "0a80", "0affffffffffffffffff", "0a01", "0a0100"]) {
    const track = { ...source, samples: [{ ...source.samples[0]!, data: Buffer.from(hex, "hex") }] };
    assert.throws(() => filterBitstream([track], edit, new MediaBudgetTracker()), /AV1/);
  }
});

it("does not mutate caller-owned packet or configuration buffers", () => {
  const original = Buffer.from(input);
  const track = parseMkv(original).tracks[0]!;
  const before = Buffer.from(original);
  filterBitstream([track], "av1_metadata=chroma_sample_position=colocated", new MediaBudgetTracker());
  assert.deepEqual(original, before);
});

it("combines timing and color edits in one AV1 filter", () => {
  const output = filterBitstream([source], `${edit}:tick_rate=30000/1001:num_ticks_per_picture=2`, new MediaBudgetTracker())[0]!;
  assert.equal(Buffer.from(output.codecDescriptions[0]!.extraData!).toString("hex"), configurations.timing[1]);
  const chained = filterBitstream([source], `av1_metadata=tick_rate=30000/1001:num_ticks_per_picture=2,${edit}`, new MediaBudgetTracker());
  assert.deepEqual([output], chained);
});
