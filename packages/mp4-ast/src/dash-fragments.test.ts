import assert from "node:assert/strict";
import { it } from "node:test";
import { concatBytes, createSyntheticMp4, parseMp4, parseMp4Boxes, serializeDashDocument, MediaLimitExceededError } from "./index.js";

it("indexes every fragment in a single-file DASH segment", () => {
  const source = parseMp4(createSyntheticMp4({ width: 32, height: 24, fps: 4, frameCount: 20 }));
  const { resources, manifest } = serializeDashDocument(source, { fragmentType: "every_frame", singleFile: true });
  const bytes = resources.get("stream0.mp4")!;
  const boxes = parseMp4Boxes(bytes);
  const sidx = boxes.find(box => box.type === "sidx")!;
  assert.equal(boxes.filter(box => box.type === "sidx").length, 1);
  assert.equal(boxes.filter(box => box.type === "moof").length, 20);
  const view = new DataView(bytes.buffer, bytes.byteOffset + sidx.offset);
  assert.equal(view.getUint32(40), bytes.length - sidx.offset - sidx.size);
  assert.equal(view.getUint32(44), source.tracks[0]!.duration);
  assert.ok(new TextDecoder().decode(manifest).includes(`mediaRange="${sidx.offset}-${bytes.length - 1}"`));
  const output = parseMp4(bytes);
  assert.deepEqual(output.tracks[0]!.samples.map(s => [s.dts, s.data]), source.tracks[0]!.samples.map(s => [s.dts, s.data]));
});

it("keeps the DASH timeline and initialization stable when subdividing fragments", () => {
  const source = parseMp4(createSyntheticMp4({ width: 32, height: 24, fps: 4, frameCount: 20 }));
  const control = serializeDashDocument(source);
  const fragmented = serializeDashDocument(source, { fragmentType: "every_frame" });
  assert.deepEqual(fragmented.manifest, control.manifest);
  assert.deepEqual([...fragmented.resources.keys()], [...control.resources.keys()]);
  const output = parseMp4(concatBytes([...fragmented.resources.values()]));
  assert.equal(output.tracks[0]!.samples.length, 20);
  assert.throws(() => serializeDashDocument(source, { fragmentType: "every_frame", limits: { maxOutputBytes: 2000 } }), MediaLimitExceededError);
});
