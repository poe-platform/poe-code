import assert from "node:assert/strict";
import { it } from "node:test";
import { concatBytes, createSyntheticMp4, MediaLimitExceededError, parseMp4, parseMp4Boxes, serializeDashDocument } from "./index.js";

for (const fragmentType of ["none", "every_frame"] as const) {
  it(`indexes actual DASH segment bytes and timing with ${fragmentType} fragments`, () => {
    const parsed = parseMp4(createSyntheticMp4({ width: 32, height: 24, fps: 4, frameCount: 10, includeAudio: true }));
    const source = { ...parsed, tracks: parsed.tracks.map(track => ({ ...track,
      samples: track.samples.map((sample, index) => ({ ...sample, isKeyframe: track.type === "audio" || index % 4 === 0 }))
    })) };
    const { resources } = serializeDashDocument(source, { segmentDuration: 1, fragmentType });
    for (const [index, track] of source.tracks.entries()) {
      const initialization = resources.get(`init-stream${index}.m4s`)!;
      assert.deepEqual(parseMp4Boxes(initialization).map(box => box.type), ["ftyp", "moov"]);
      const chunks = [...resources].filter(([name]) => name.startsWith(`chunk-stream${index}-`));
      assert.ok(chunks.length > 1);
      for (const [, bytes] of chunks) {
        const boxes = parseMp4Boxes(bytes);
        assert.deepEqual(boxes.slice(0, 4).map(box => box.type), ["styp", "sidx", "moof", "mdat"]);
        assert.equal(boxes.filter(box => box.type === "sidx").length, 1);
        assert.equal(new TextDecoder().decode(boxes[0]!.payload), "msdh\0\0\0\0msdhmsix");
        const sidx = boxes[1]!;
        const view = new DataView(sidx.payload.buffer, sidx.payload.byteOffset, sidx.payload.byteLength);
        const samples = parseMp4(concatBytes([initialization, bytes])).tracks[0]!.samples;
        assert.equal(view.getUint8(0), 1);
        assert.equal(view.getUint32(4), track.id);
        assert.equal(view.getUint32(8), track.timescale);
        assert.equal(view.getBigUint64(12), BigInt(Math.min(...samples.map(sample => Math.max(0, sample.pts)))));
        assert.equal(sidx.offset + sidx.size + Number(view.getBigUint64(20)), boxes[2]!.offset);
        assert.equal(view.getUint16(30), 1);
        assert.equal(view.getUint32(32), bytes.length - boxes[2]!.offset);
        assert.equal(view.getUint32(36), samples.at(-1)!.dts + samples.at(-1)!.duration - samples[0]!.dts);
        assert.equal(view.getUint32(40) >>> 31, Number(samples[0]!.isKeyframe));
        assert.equal(boxes.filter(box => box.type === "moof").length, fragmentType === "every_frame" ? samples.length : 1);
      }
      const output = parseMp4(concatBytes([initialization, ...chunks.map(([, bytes]) => bytes)]));
      assert.deepEqual(output.tracks[0]!.samples.map(sample => [sample.dts, sample.pts, sample.data]),
        track.samples.map(sample => [sample.dts, sample.pts, sample.data]));
    }
  });
}

for (const singleFile of [false, true]) {
  it(`omits indexes and uses per-frame fragments for streaming DASH (singleFile=${singleFile})`, () => {
    const parsed = parseMp4(createSyntheticMp4({ width: 32, height: 24, fps: 4, frameCount: 8, includeAudio: false }));
    const source = { ...parsed, tracks: parsed.tracks.map(track => ({ ...track,
      samples: track.samples.map((sample, index) => ({ ...sample, isKeyframe: index % 4 === 0 }))
    })) };
    const { resources, manifest } = serializeDashDocument(source, { streaming: true, singleFile, segmentDuration: 1 });
    const bytes = concatBytes([...resources.values()]);
    const boxes = parseMp4Boxes(bytes);
    assert.equal(boxes.filter(box => box.type === "sidx").length, 0);
    assert.equal(boxes.filter(box => box.type === "styp").length, singleFile ? 0 : 2);
    assert.equal(boxes.filter(box => box.type === "moof").length, 8);
    assert.ok(!new TextDecoder().decode(manifest).includes("indexRange="));
    assert.deepEqual(parseMp4(bytes).tracks[0]!.samples.map(sample => sample.data), source.tracks[0]!.samples.map(sample => sample.data));
  });
}

it("charges DASH segment headers to the output byte limit", () => {
  const source = parseMp4(createSyntheticMp4({ width: 32, height: 24, fps: 4, frameCount: 4, includeAudio: false }));
  const { resources, manifest } = serializeDashDocument(source);
  const size = [...resources.values()].reduce((total, bytes) => total + bytes.length, manifest.length);
  assert.throws(() => serializeDashDocument(source, { limits: { maxOutputBytes: size - 1 } }), MediaLimitExceededError);
  assert.doesNotThrow(() => serializeDashDocument(source, { limits: { maxOutputBytes: size } }));
});
