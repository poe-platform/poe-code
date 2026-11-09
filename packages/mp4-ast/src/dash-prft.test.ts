import assert from "node:assert/strict";
import { it } from "node:test";
import { createSyntheticMp4, parseMp4, parseMp4Boxes, serializeDashDocument } from "./index.js";

it("writes version 1 producer times before each fragment with the reference track and PTS", () => {
  const doc = parseMp4(createSyntheticMp4({ frameCount: 8, fps: 8, includeAudio: false }));
  const track = doc.tracks[0]!;
  const before = Date.now();
  const { resources, manifest } = serializeDashDocument(doc, {
    streaming: true, writePrft: true, utcTimingUrl: 'https://example.invalid/time?a=1&b="2"', segmentDuration: 1
  });
  const after = Date.now();
  const bytes = resources.get("chunk-stream0-00001.m4s")!;
  const boxes = parseMp4Boxes(bytes);
  const prfts = boxes.filter(box => box.type === "prft");
  assert.equal(prfts.length, 8);
  for (const [index, box] of prfts.entries()) {
    assert.equal(box.size, 32);
    assert.equal(boxes[boxes.indexOf(box) + 1]!.type, "moof");
    const view = new DataView(bytes.buffer, bytes.byteOffset + box.offset, box.size);
    assert.equal(view.getUint32(8), 0x01000018);
    assert.equal(view.getUint32(12), track.id);
    assert.equal(view.getBigUint64(24), BigInt(track.samples[index]!.pts));
    const wallTime = (view.getUint32(16) - 2_208_988_800) * 1000 + view.getUint32(20) * 1000 / 2 ** 32;
    assert.ok(wallTime >= before - 1 && wallTime <= after);
  }
  const xml = new TextDecoder().decode(manifest);
  assert.ok(xml.includes('value="https://example.invalid/time?a=1&amp;b=&quot;2&quot;"'));
  assert.ok(xml.includes('type="static"'));
  assert.ok(!xml.includes("ProducerReferenceTime"));
});
