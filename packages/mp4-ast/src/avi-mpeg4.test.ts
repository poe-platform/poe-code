import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { parseAvi, parseMp4, parseMkv, serializeMp4, serializeMkv } from "./index.js";

// Native FFmpeg 7.0.2: 48x32 XVID, eight frames at 10 fps, with PCM audio.
// Reference MP4: ffmpeg -i xvid.avi -map 0:v -c copy xvid.mp4
const input = readFileSync(new URL("./fixtures/xvid.avi", import.meta.url));
const reference = parseMp4(readFileSync(new URL("./fixtures/xvid.mp4", import.meta.url))).tracks[0]!;

for (const fourcc of ["XVID", "FMP4"]) {
  it(`imports AVI ${fourcc} as MPEG-4 without rewriting start codes`, () => {
    const bytes = Buffer.from(input);
    bytes.write(fourcc, bytes.indexOf("strh") + 12, "ascii");
    bytes.write(fourcc, bytes.indexOf("strf") + 24, "ascii");
    const track = parseAvi(bytes).tracks[0]!;
    assert.equal(track.codecDescriptions[0]!.codecName, "mpeg4");
    assert.equal(track.codecDescriptions[0]!.formatFourCC, "mp4v");
    assert.equal(track.codecDescriptions[0]!.avcC, undefined);
    assert.equal(track.width, 48);
    assert.equal(track.height, 32);
    assert.equal(track.samples.length, 8);
    assert.deepEqual(track.samples.map(sample => Buffer.from(sample.data)), reference.samples.map(sample => Buffer.from(sample.data)));
    assert.deepEqual(track.samples.map(sample => sample.dts / track.timescale),
      reference.samples.map(sample => sample.dts / reference.timescale));
  });
}

for (const format of ["mp4", "mkv"] as const) {
  it(`remuxes AVI MPEG-4 into ${format} without changing codec or packets`, () => {
    const source = parseAvi(input);
    const video = { ...source, tracks: [source.tracks[0]!] };
    const output = format === "mp4" ? parseMp4(serializeMp4(video)) : parseMkv(serializeMkv(video));
    assert.equal(output.tracks.length, 1);
    const track = output.tracks[0]!;
    assert.equal(track.codecDescriptions[0]!.codecName, "mpeg4");
    assert.equal(track.codecDescriptions[0]!.avcC, undefined);
    assert.deepEqual(track.samples.map(sample => Buffer.from(sample.data)), reference.samples.map(sample => Buffer.from(sample.data)));
  });
}
