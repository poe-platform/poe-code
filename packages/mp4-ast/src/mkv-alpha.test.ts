import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { parseMkv, serializeMkv } from "./containers/mkv.js";

it("preserves VP9 alpha mode and auxiliary coded packets in WebM and Matroska", () => {
  const source = parseMkv(new Uint8Array(readFileSync(new URL("./fixtures/vp9-alpha.webm", import.meta.url))));
  const video = source.tracks[0]!;
  assert.equal(video.codecDescriptions[0]!.alphaMode, 1);
  assert.equal(video.samples.length, 2);
  assert.ok(video.samples.every(sample => sample.blockAdditions?.byteLength));
  for (const format of ["webm", "matroska"]) {
    const copied = parseMkv(serializeMkv({ ...source, containerFormat: format }, { format })).tracks[0]!;
    assert.equal(copied.codecDescriptions[0]!.alphaMode, 1);
    assert.deepEqual(copied.samples.map(sample => sample.blockAdditions), video.samples.map(sample => sample.blockAdditions));
    assert.deepEqual(copied.samples.map(sample => sample.data), video.samples.map(sample => sample.data));
  }
});

it("does not add alpha signaling or auxiliary packets to opaque video", () => {
  const source = parseMkv(readFileSync(new URL("./fixtures/opus-padding-mono.webm", import.meta.url)));
  const video = parseMkv(serializeMkv(source)).tracks.find(track => track.type === "video")!;
  assert.equal(video.codecDescriptions[0]!.alphaMode, undefined);
  assert.ok(video.samples.every(sample => sample.blockAdditions === undefined));
});
