import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { createSyntheticMp4, muxMp4, parseMp4, probeMp4, probeMp4Source, serializeMp4 } from "./index.js";
import { parseMp4Boxes } from "./mp4.js";
import { concatBytes, IDENTITY_MATRIX, makeBox } from "./binary.js";

const syncSamples = () => {
  const samples = new Set<number>();
  return { add(sample: number) { samples.add(sample); }, has(sample: number) { return samples.has(sample); } };
};
const turn = [0, -65536, 0, 65536, 0, 0, 0, 0, 1073741824];
const inverse = [0, 65536, 0, -65536, 0, 0, 0, 0, 1073741824];

for (const [file, expected, rotation] of [
  ["movie-rotation.mp4", turn, 90],
  ["movie-rotation-cancel.mp4", IDENTITY_MATRIX, 0]
] as const) {
  it(`preserves the effective transform of ${file} on remux and both probes`, async () => {
    const bytes = new Uint8Array(readFileSync(new URL(`./fixtures/${file}`, import.meta.url)));
    const doc = parseMp4(bytes);
    assert.deepEqual(doc.tracks[0]!.matrix, expected);
    for (const fragmented of [false, true]) {
      const output = parseMp4(serializeMp4(muxMp4([doc]), { fragmented }));
      assert.deepEqual(output.tracks[0]!.matrix, expected);
      assert.deepEqual(output.tracks[0]!.samples.map(sample => sample.data), doc.tracks[0]!.samples.map(sample => sample.data));
    }
    const source = await probeMp4Source({ size: bytes.length, async read(offset, length) {
      return bytes.subarray(offset, offset + Math.min(length, 17));
    } }, { syncSamples });
    for (const streams of [probeMp4(bytes).streams, source.streams]) {
      for await (const stream of streams) {
        if (rotation) {
          assert.equal(stream.side_data_list?.[0]?.rotation, rotation);
          assert.equal(stream.side_data_list?.[0]?.displaymatrix,
            "\n00000000:            0      -65536           0\n00000001:        65536           0           0\n00000002:            0           0  1073741824\n");
        } else assert.equal(stream.side_data_list, undefined);
      }
    }
  });
}

for (const version of [0, 1]) {
  for (const [name, movie, track, expected] of [
    ["identity", IDENTITY_MATRIX, IDENTITY_MATRIX, IDENTITY_MATRIX],
    ["movie rotation", turn, IDENTITY_MATRIX, turn],
    ["cancellation", turn, inverse, IDENTITY_MATRIX],
    ["track rotation", IDENTITY_MATRIX, inverse, inverse],
    ["scale and translation before movie rotation", turn,
      [131072, 0, 0, 0, 196608, 0, 327680, 458752, 1073741824],
      [0, -131072, 0, 196608, 0, 0, 458752, -327680, 1073741824]],
    ["fixed-point rounding", [46340, -46340, 0, 46340, 46340, 0, 0, 0, 1073741824],
      [46340, -46340, 0, 46340, 46340, 0, 0, 0, 1073741824],
      [-1, -65534, 0, 65532, -1, 0, 0, 0, 1073741824]],
    ["projective entries", [65536, 0, 536870912, 0, 65536, 0, 65536, 0, 1073741824],
      [65536, 0, 0, 0, 65536, 0, 131072, 196608, 1073741824],
      [65536, 0, 536870912, 0, 65536, 0, 196608, 196608, -2147483648]]
  ] as const) {
    it(`composes ${name} with version ${version} headers`, async () => {
      const base = parseMp4(createSyntheticMp4({ width: 32, height: 16, frameCount: 1 }));
      const bytes = serializeMp4({ ...base, tracks: base.tracks.map(t => ({ ...t, rotation: undefined, matrix: track })) }, { faststart: false });
      // mdat precedes moov, so expanding header timestamps cannot move sample offsets.
      const changed = concatBytes(parseMp4Boxes(bytes).map(box => {
        if (box.type !== "moov") return bytes.subarray(box.offset, box.offset + box.size);
        const children = box.children!.map(child => {
          const update = (type: string, original: Uint8Array) => {
            let payload: Uint8Array = original.slice();
            if (version === 1) {
              payload = concatBytes([original.subarray(0, 4), new Uint8Array(4), original.subarray(4, 8),
                new Uint8Array(4), original.subarray(8, type === "mvhd" ? 16 : 20),
                new Uint8Array(4), original.subarray(type === "mvhd" ? 16 : 20)]);
              payload[0] = 1;
            }
            if (type === "mvhd") {
              const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
              movie.forEach((value, index) => view.setInt32(36 + version * 12 + index * 4, value));
            }
            return makeBox(type, payload);
          };
          if (child.type === "mvhd") return update(child.type, child.payload);
          if (child.type === "trak") return makeBox("trak", concatBytes(child.children!.map(header =>
            header.type === "tkhd" ? update(header.type, header.payload) : bytes.subarray(header.offset, header.offset + header.size))));
          return bytes.subarray(child.offset, child.offset + child.size);
        });
        return makeBox("moov", concatBytes(children));
      }));
      const parsed = parseMp4(changed);
      assert.deepEqual(parsed.tracks[0]!.matrix, expected);
      assert.deepEqual(parseMp4(serializeMp4(parsed)).tracks[0]!.matrix, expected);
      const source = await probeMp4Source({ size: changed.length, async read(offset, length) {
        return changed.subarray(offset, offset + Math.min(13, length));
      } }, { syncSamples });
      const streams = [];
      for await (const stream of source.streams) streams.push(stream.side_data_list);
      assert.deepEqual(streams, probeMp4(changed).streams.map(stream => stream.side_data_list));
    });
  }
}
