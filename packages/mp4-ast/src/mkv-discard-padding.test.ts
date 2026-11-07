import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { parseMkv, serializeMkv } from "./containers/mkv.js";

// Native FFmpeg: testsrc2=s=32x24:r=5:d=1 + sine=f=440:r=48000:d=1,
// -c:v libvpx-vp9 -threads 1 -c:a libopus (surround adds -ac 6).
for (const layout of ["mono", "surround"]) {
  it(`preserves final ${layout} Opus discard padding and packet bytes`, () => {
    const input = readFileSync(new URL(`./fixtures/opus-padding-${layout}.webm`, import.meta.url));
    const source = parseMkv(input);
    const audio = source.tracks.find(track => track.type === "audio")!;
    // Native ffprobe reports 648 discarded samples at 48 kHz.
    assert.equal(audio.samples.at(-1)!.discardPaddingNs, 13_500_000);
    assert.equal(audio.samples[0]!.discardPaddingNs, undefined);
    const copied = parseMkv(serializeMkv(source));
    const packets = (doc: typeof source) => doc.tracks.map(track => track.samples.map(sample => ({
      data: Buffer.from(sample.data), padding: sample.discardPaddingNs
    })));
    assert.deepEqual(packets(copied), packets(source));
  });
}

it("preserves signed nanosecond padding without sample-rate rounding", () => {
  const source = parseMkv(readFileSync(new URL("./fixtures/opus-padding-mono.webm", import.meta.url)));
  for (const padding of [-13_500_001, 0, 13_500_001]) {
    const tracks = source.tracks.filter(track => track.type === "audio").map(track => ({
      ...track, samples: [{ ...track.samples[0]!, discardPaddingNs: padding }]
    }));
    assert.equal(parseMkv(serializeMkv({ ...source, tracks })).tracks[0]!.samples[0]!.discardPaddingNs, padding);
  }
});
