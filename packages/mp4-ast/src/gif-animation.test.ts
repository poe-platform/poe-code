import assert from "node:assert/strict";
import { it } from "node:test";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { gifAst } from "./containers/adapters.js";

it("parses and probes six GIF frames with individual durations", () => {
  const data = new Uint8Array(2 * 3 * 6 * 4);
  for (let i = 0; i < data.length; i += 4) { data[i] = Math.floor(i / 24) * 40; data[i + 3] = 255; }
  const bytes = encodeImage({ width: 2, height: 18, channels: 4, format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true, data }, { format: "gif", pageHeight: 3, delay: [1000, 200, 300, 400, 500, 600], loop: 0 }).data;
  const ast = gifAst(), doc = ast.parse(bytes), track = doc.tracks[0]!;
  assert.equal(track.samples.length, 6);
  assert.ok(track.samples.every(sample => sample.size > 0));
  assert.equal(track.samples.reduce((sum, sample) => sum + sample.size, 0), bytes.length);
  assert.deepEqual(track.samples.map(sample => sample.duration), [100, 20, 30, 40, 50, 60]);
  assert.equal(doc.durationSeconds, 3);
  assert.deepEqual(track.decodedVideoFrames!.map(frame => frame.ptsSeconds), [0, 1, 1.2, 1.5, 1.9, 2.4]);
  const probe = ast.probe(bytes, { showFrames: true });
  assert.equal(probe.streams[0]!.nb_frames, "6");
  assert.equal(probe.frames!.length, 6);
  assert.equal(probe.format.duration, "3.000000");
  const restored = decodeImage(ast.serialize(doc), { animated: true });
  assert.equal(restored.pages, 6);
  assert.deepEqual(restored.delay, [1000, 200, 300, 400, 500, 600]);
  assert.deepEqual(restored.data, decodeImage(bytes, { animated: true }).data);
});

it("serializes every decoded video frame without accumulating GIF timing drift", () => {
  const ast = gifAst();
  const bytes = encodeImage({ width: 2, height: 3, channels: 4, format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true, data: new Uint8Array(24).fill(255) }, { format: "gif" }).data;
  const doc = ast.parse(bytes), track = doc.tracks[0]!;
  const frames = Array.from({ length: 12 }, (_, index) => ({ ...track.decodedVideoFrames![0]!, ptsSeconds: index / 8, durationSeconds: 1 / 8 }));
  const output = ast.serialize({ ...doc, tracks: [{ ...track, decodedVideoFrames: frames }] });
  const image = decodeImage(output, { animated: true });
  assert.equal(image.pages, 12);
  assert.equal(image.delay!.reduce((sum, delay) => sum + delay, 0), 1500);
});
