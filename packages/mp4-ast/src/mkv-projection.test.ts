import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { parseMkv, probeMkv, serializeMkv } from "./containers/mkv.js";

for (const name of ["flat", "sphere", "tilted", "cube"]) {
  const bytes = new Uint8Array(readFileSync(new URL(`./fixtures/projection-${name}.mkv`, import.meta.url)));
  const expected = name === "flat" ? undefined : [{
    side_data_type: "Spherical Mapping", projection: name === "cube" ? "cubemap" : "equirectangular",
    ...(name === "cube" ? { padding: 0 } : {}),
    yaw: name === "tilted" ? 35 : 0, pitch: name === "tilted" ? -15 : 0, roll: name === "tilted" ? 10 : 0
  }];
  it(`probes original ${name} projection`, () => {
    assert.deepEqual(probeMkv(bytes).streams[0]!.side_data_list, expected);
  });
  for (const webm of [false, true]) {
    it(`retains ${name} projection and packets in ${webm ? "WebM" : "Matroska"}`, () => {
      const source = parseMkv(bytes);
      const output = serializeMkv(source, { webm });
      const copied = parseMkv(output);
      assert.deepEqual(probeMkv(output).streams[0]!.side_data_list, expected);
      assert.deepEqual(copied.tracks[0]!.codecDescriptions[0]!.rawMkvProjectionBytes,
        source.tracks[0]!.codecDescriptions[0]!.rawMkvProjectionBytes);
      assert.deepEqual(copied.tracks[0]!.samples.map(sample => sample.data),
        source.tracks[0]!.samples.map(sample => sample.data));
    });
  }
}

const cube = parseMkv(readFileSync(new URL("./fixtures/projection-cube.mkv", import.meta.url)));
const track = cube.tracks[0]!;
function probeProjection(rawMkvProjectionBytes: Uint8Array) {
  return probeMkv(serializeMkv({ ...cube, tracks: [{ ...track,
    codecDescriptions: [{ ...track.codecDescriptions[0]!, rawMkvProjectionBytes }]
  }] })).streams[0]!.side_data_list;
}

it("reports nonzero cubemap padding and truncates signed fractional poses like ffprobe", () => {
  const raw = new Uint8Array([
    0x76, 0x71, 0x81, 2,
    0x76, 0x72, 0x8c, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 7,
    0x76, 0x73, 0x84, 0xc2, 0x0e, 0, 0, // -35.5
    0x76, 0x74, 0x84, 0x41, 0x7c, 0, 0, // 15.75
    0x76, 0x75, 0x84, 0xbf, 0x40, 0, 0  // -0.75
  ]);
  assert.deepEqual(probeProjection(raw), [{ side_data_type: "Spherical Mapping", projection: "cubemap",
    padding: 7, yaw: -35, pitch: 15, roll: 0 }]);
});

for (const type of [0, 3, 255]) {
  it(`does not label projection type ${type} as spherical`, () => {
    assert.equal(probeProjection(new Uint8Array([0x76, 0x71, 0x81, type])), undefined);
  });
}

it("rejects missing cubemap private metadata", () => {
  assert.throws(() => probeProjection(new Uint8Array([0x76, 0x71, 0x81, 2])), /cubemap projection metadata/);
});

it("ignores a truncated projection element", () => {
  assert.equal(probeProjection(new Uint8Array([0x76, 0x71, 0x82, 1])), undefined);
});

it("reports tiled equirectangular pixel bounds", () => {
  const raw = new Uint8Array([0x76, 0x71, 0x81, 1, 0x76, 0x72, 0x94, ...new Uint8Array(20)]);
  const view = new DataView(raw.buffer);
  for (const offset of [11, 15, 19, 23]) view.setUint32(offset, 0x40000000);
  assert.deepEqual(probeProjection(raw), [{ side_data_type: "Spherical Mapping", projection: "tiled equirectangular",
    bound_left: 33, bound_top: 17, bound_right: 31, bound_bottom: 15, yaw: 0, pitch: 0, roll: 0 }]);
});

it("retains stereo side data alongside spherical mapping", () => {
  const bytes = serializeMkv({ ...cube, tracks: [{ ...track,
    codecDescriptions: [{ ...track.codecDescriptions[0]!, stereoMode: 1 }]
  }] });
  assert.deepEqual(probeMkv(bytes).streams[0]!.side_data_list, [
    { side_data_type: "Stereo 3D", type: "side by side", inverted: 0 },
    { side_data_type: "Spherical Mapping", projection: "cubemap", padding: 0, yaw: 0, pitch: 0, roll: 0 }
  ]);
});
