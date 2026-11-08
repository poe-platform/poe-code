import assert from "node:assert/strict";
import { it } from "node:test";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { gifAst, image2Ast } from "./containers/adapters.js";
import { createSyntheticMp4, parseMp4, serializeMp4 } from "./index.js";

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
  assert.equal(probe.streams[0]!.pix_fmt, "bgra");
  assert.equal(probe.frames!.length, 6);
  assert.deepEqual(probe.frames!.map(frame => frame.pix_fmt), Array(6).fill("bgra"));
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

for (const encoded of [false, true]) {
  it(`omits decode preroll and trailing pictures from ${encoded ? "encoded" : "decoded"} GIF output`, () => {
    const source = parseMp4(createSyntheticMp4({ width: 16, height: 16, frameCount: 6, fps: 10, includeAudio: false }));
    const track = source.tracks[0]!;
    const decodedVideoFrames = Array.from({ length: 6 }, (_, index) => ({
      width: 16, height: 16,
      data: new Uint8Array(16 * 16 * 4).map((_, channel) => channel % 4 === 3 ? 255 : index * 40),
      ptsSeconds: index / 10, durationSeconds: .1, keyframe: true
    }));
    const doc = { ...source, duration: 300, durationSeconds: .3, tracks: [{ ...track, samples: [], decodedVideoFrames,
      editList: [{ segmentDuration: 300, mediaTime: Math.round(.2 * track.timescale), mediaRateInteger: 1, mediaRateFraction: 0 }]
    }], timescale: 1000 };
    const input = encoded ? parseMp4(serializeMp4(doc)) : doc;
    const output = decodeImage(gifAst().serialize(input), { animated: true });
    assert.equal(output.pages, 3);
    assert.equal(output.delay!.reduce((sum, delay) => sum + delay, 0), 300);
    for (let index = 0; index < 3; index++) {
      assert.ok(Math.abs(output.data[index * 16 * 16 * 4]! - (index + 2) * 40) < 8, `visible picture ${index}`);
    }
    assert.ok(Math.abs(decodeImage(image2Ast().serialize(input)).data[0]! - 80) < 8, "first displayed picture");
    const partial = { ...input, tracks: input.tracks.map(t => ({ ...t,
      editList: [{ segmentDuration: 200, mediaTime: Math.round(.25 * t.timescale), mediaRateInteger: 1, mediaRateFraction: 0 }]
    })) };
    assert.deepEqual(decodeImage(gifAst().serialize(partial), { animated: true }).delay, [50, 100, 50]);
  });
}

it("terminates copied GIF packets when trimming removes the original trailer", () => {
  const data = new Uint8Array(2 * 4).fill(255);
  const input = encodeImage({ width: 1, height: 2, channels: 4, format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true, data }, { format: "gif", pageHeight: 1, delay: [100, 200] }).data;
  const ast = gifAst(), doc = ast.parse(input), track = doc.tracks[0]!;
  const first = track.samples[0]!;
  const output = ast.serialize({ ...doc, tracks: [{ ...track, samples: [first] }] }, { videoCodec: "copy" });
  assert.deepEqual(output.subarray(0, -1), first.data);
  assert.equal(output.at(-1), 0x3b);
  assert.deepEqual(decodeImage(output, { animated: true }).delay, [100]);
  assert.throws(() => ast.serialize({ ...doc, tracks: [{ ...track, samples: track.samples.slice(1) }] }, { videoCodec: "copy" }), /initial GIF header/);
  assert.throws(() => ast.serialize({ ...doc, tracks: [{ ...track, codecDescriptions: [{ formatFourCC: "avc1", codecName: "h264" }] }] }, { videoCodec: "copy" }), /requires GIF packets/);
});
