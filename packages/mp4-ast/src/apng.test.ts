import assert from "node:assert/strict";
import { MediaBudgetTracker } from "./types.js";
import { it } from "node:test";
import { encodeImage, decodeImage } from "@poe-code/image-ast/portable";
import { allMediaAsts, createMediaAstRegistry, gifAst } from "./containers/adapters.js";

const colors = [[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255]];
const bytes = encodeImage({ width: 16, height: 48, channels: 4, format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true,
  data: Uint8Array.from(colors.flatMap(color => Array.from({ length: 256 }, () => color).flat())) },
{ format: "apng", pageHeight: 16, delay: [200, 400, 200], loop: 2 }).data;

for (const filename of ["input.apng", "input.png", "input.bin"]) {
  it(`detects APNG animation in ${filename} and preserves GIF frames and delays`, () => {
    const plugin = createMediaAstRegistry(allMediaAsts()).detect(bytes, filename)!;
    const doc = plugin.parse(bytes);
    const frames = doc.tracks[0]!.decodedVideoFrames!;
    assert.equal(frames.length, 3);
    assert.deepEqual(frames.map(frame => Array.from(frame.data.subarray(0, 4))), colors);
    assert.deepEqual(frames.map(frame => frame.ptsSeconds), [0, .2, .6]);
    const output = decodeImage(gifAst().serialize(doc), { animated: true });
    assert.equal(output.pages, 3);
    assert.deepEqual(output.delay, [200, 400, 200]);
  });
}
it("supports the explicit apng demuxer", () => {
  const plugin = createMediaAstRegistry(allMediaAsts()).findById("apng");
  assert.ok(plugin);
  assert.equal(plugin.parse(bytes).durationSeconds, .8);
});

for (const limits of [{ maxFrames: 2 }, { maxPixelsPerFrame: 255 }, { maxMemoryBytes: 1024 }, { maxDurationSeconds: .5 }]) {
  it(`bounds APNG decoding with ${JSON.stringify(limits)}`, () => {
    const plugin = createMediaAstRegistry(allMediaAsts()).findById("apng")!;
    assert.throws(() => plugin.parse(bytes, { budget: new MediaBudgetTracker(limits) }), /Resource limit exceeded/);
  });
}
it("rejects truncated APNG instead of returning a still image", () => {
  const plugin = createMediaAstRegistry(allMediaAsts()).detect(bytes)!;
  assert.throws(() => plugin.parse(bytes.subarray(0, bytes.length - 12)), /Missing APNG end chunk/);
});
it("keeps ordinary PNG detection unchanged", () => {
  const png = encodeImage({ width: 1, height: 1, channels: 4, format: "png", space: "srgb", depth: "uchar", density: 72,
    hasAlpha: true, data: new Uint8Array([255, 0, 0, 255]) }, { format: "png" }).data;
  assert.equal(createMediaAstRegistry(allMediaAsts()).detect(png, "input.png")!.id, "image2");
});

it("composites partial frames with previous/background disposal and alpha blending", () => {
  // 2x1 RGBA APNG with green/blue/half-transparent white 1x1 patches.
  const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAACGFjVEwAAAAEAAAAAHzNZtAAAAAaZmNUTAAAAAAAAAACAAAAAQAAAAAAAAAAAAEABQAA8nXxRAAAAA5JREFUeJxj+M/A8B+EARH3A/3jxfXvAAAAGmZjVEwAAAABAAAAAQAAAAEAAAABAAAAAAABAAUCADnoIHsAAAARZmRBVAAAAAJ4nGNg+M/wHwAEAQH/YufpnAAAABpmY1RMAAAAAwAAAAEAAAABAAAAAAAAAAAAAQAFAQA+3X+RAAAAEWZkQVQAAAAEeJxjYGD4/x8AAwIB/w257mEAAAAaZmNUTAAAAAUAAAABAAAAAQAAAAAAAAAAAAEABQABvQsMPAAAABFmZEFUAAAABnicY/j//38DAAl8A35EGzo/AAAAAElFTkSuQmCC", "base64");
  const frames = createMediaAstRegistry(allMediaAsts()).detect(input)!.parse(input).tracks[0]!.decodedVideoFrames!;
  assert.deepEqual(frames.map(frame => Array.from(frame.data)), [
    [255, 0, 0, 255, 255, 0, 0, 255],
    [255, 0, 0, 255, 0, 255, 0, 255],
    [0, 0, 255, 255, 255, 0, 0, 255],
    [255, 255, 255, 128, 255, 0, 0, 255]
  ]);
});
