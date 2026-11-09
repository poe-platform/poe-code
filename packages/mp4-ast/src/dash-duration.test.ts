import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { concatBytes, parseMp4, parseMp4Boxes, serializeDashDocument, MediaLimitExceededError } from "./index.js";

const source = parseMp4(new Uint8Array(readFileSync(new URL("./fixtures/dash-duration.mp4", import.meta.url))));

for (const [fragmentDuration, counts] of [[500000, [4, 4]], [300000, [3, 3, 2]], [1000000, [8]], [0, [8]]] as const) {
  for (const singleFile of [false, true]) {
    it(`subdivides DASH segments at ${fragmentDuration}us packet boundaries (singleFile=${singleFile})`, () => {
      const control = serializeDashDocument(source, { segmentDuration: 1, singleFile });
      const output = serializeDashDocument(source, { segmentDuration: 1, fragmentType: "duration", fragmentDuration, singleFile });
      const bytes = singleFile ? output.resources.get("stream0.mp4")! : concatBytes([...output.resources.values()]);
      const boxes = parseMp4Boxes(bytes);
      const moofs = boxes.filter(box => box.type === "moof");
      assert.equal(boxes.filter(box => box.type === "sidx").length, 4 * counts.length);
      assert.deepEqual(moofs.map(box => {
        const trun = box.children!.find(child => child.type === "traf")!.children!.find(child => child.type === "trun")!;
        return new DataView(trun.payload.buffer, trun.payload.byteOffset).getUint32(4);
      }), Array.from({ length: 4 }, () => [...counts]).flat());
      for (const [index, moof] of moofs.entries()) {
        const mfhd = moof.children!.find(box => box.type === "mfhd")!;
        assert.equal(new DataView(mfhd.payload.buffer, mfhd.payload.byteOffset).getUint32(4), index + 1);
      }
      for (const sidx of boxes.filter(box => box.type === "sidx")) {
        const next = boxes.find(box => box.offset > sidx.offset && (box.type === "sidx" || box.type === "styp"));
        const view = new DataView(sidx.payload.buffer, sidx.payload.byteOffset);
        assert.equal(view.getUint32(32), (next?.offset ?? bytes.length) - sidx.offset - sidx.size);
        const fragment = parseMp4(concatBytes([bytes.subarray(0, boxes.find(box => box.type === "sidx")!.offset), bytes.subarray(sidx.offset, next?.offset)])).tracks[0]!;
        assert.equal(view.getUint32(36), fragment.samples.at(-1)!.dts + fragment.samples.at(-1)!.duration - fragment.samples[0]!.dts);
      }
      assert.deepEqual(parseMp4(bytes).tracks[0]!.samples.map(({ data, dts, pts, duration, isKeyframe }) => ({ data, dts, pts, duration, isKeyframe })),
        source.tracks[0]!.samples.map(({ data, dts, pts, duration, isKeyframe }) => ({ data, dts, pts, duration, isKeyframe })));
      if (!singleFile) assert.deepEqual(output.manifest, control.manifest);
    });
  }
}

it("keeps duration cuts opt-in and enforces the DASH segment duration and output budget", () => {
  const control = serializeDashDocument(source, { segmentDuration: 1 });
  assert.deepEqual(serializeDashDocument(source, { segmentDuration: 1, fragmentDuration: 500000 }).resources, control.resources);
  assert.throws(() => serializeDashDocument(source, { segmentDuration: 1, fragmentType: "duration", fragmentDuration: 1000001 }), /Fragment duration/);
  assert.throws(() => serializeDashDocument(source, { fragmentType: "duration", fragmentDuration: 500000, limits: { maxOutputBytes: 2000 } }), MediaLimitExceededError);
});
