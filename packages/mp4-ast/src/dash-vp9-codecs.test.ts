import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { parseXml } from "@poe-code/xml-ast";
import { concatBytes, parseMkv, parseMp4, parseStreamingManifest, parseVpcC, serializeDashDocument, serializeMp4 } from "./index.js";

// Native FFmpeg 7.0.2: -i input.webm -map 0 -c copy -f dash out.mpd.
// High-depth inputs: color=s=32x24:r=5:d=0.2, libvpx-vp9 -threads 1,
// with yuv420p10le and yuv444p12le respectively.
const cases = [
  ["dash-vp9-codec.webm", "vp09.00.10.08"],
  ["dash-vp9-profile2-10.webm", "vp09.02.10.10"],
  ["dash-vp9-profile3-12.webm", "vp09.03.10.12"]
] as const;
const source = parseMkv(new Uint8Array(readFileSync(new URL(`./fixtures/${cases[0][0]}`, import.meta.url))));

function codec(manifest: Uint8Array): string | undefined {
  const root = parseXml(new TextDecoder().decode(manifest));
  const representation = root.children.find(node => node.localName === "Period")!
    .children.find(node => node.localName === "AdaptationSet")!
    .children.find(node => node.localName === "Representation")!;
  return representation.attributes.find(attribute => attribute.localName === "codecs")?.value;
}

for (const [fixture, expected] of cases) {
  it(`declares VP9 profile, level and bit depth for ${fixture} without changing packets`, () => {
    const input = parseMkv(new Uint8Array(readFileSync(new URL(`./fixtures/${fixture}`, import.meta.url))));
    const { manifest, resources } = serializeDashDocument(input, { segmentDuration: 1 });
    assert.equal(codec(manifest), expected);
    const sequence = parseStreamingManifest(manifest, "dash").sequences[0]!;
    const bytes = concatBytes([resources.get(sequence[0]!.initialization!)!, ...sequence.map(segment => resources.get(segment.uri)!)]);
    const output = bytes[0] === 0x1a ? parseMkv(bytes) : parseMp4(bytes);
    assert.deepEqual(output.tracks[0]!.samples.map(sample => sample.data), input.tracks[0]!.samples.map(sample => sample.data));
  });
}

for (const [width, height, fps, level] of [
  [192, 192, 22.5, 10], [192, 192, 23, 11],
  [1280, 720, 30, 31], [1920, 1080, 30, 40], [1920, 1080, 60, 41],
  [3840, 2160, 60, 51], [7680, 4320, 120, 62], [16384, 16384, 30, 0]
] as const) {
  it(`derives VP9 level ${level} for ${width}x${height} at ${fps} fps`, () => {
    const track = source.tracks[0]!;
    const input = { ...source, tracks: [{ ...track, width, height, timescale: fps * 1000,
      samples: track.samples.map((sample, index) => ({ ...sample, dts: index * 1000, pts: index * 1000, duration: 1000 }))
    }] };
    assert.equal(codec(serializeDashDocument(input).manifest), `vp09.00.${String(level).padStart(2, "0")}.08`);
  });
}

it("uses the VP9 configuration from MP4 instead of guessing its declared level", () => {
  const track = source.tracks[0]!;
  const vpcC = parseVpcC(new Uint8Array([1, 0, 0, 0, 2, 41, 0xa2, 2, 2, 2, 0, 0]));
  const input = parseMp4(serializeMp4({ ...source, tracks: [{ ...track,
    codecDescriptions: [{ ...track.codecDescriptions[0]!, vpcC }]
  }] }));
  assert.equal(codec(serializeDashDocument(input).manifest), "vp09.02.41.10");
});

it("keeps the bare codec when no VP9 configuration or readable keyframe is available", () => {
  const track = source.tracks[0]!;
  for (const data of [new Uint8Array(), new Uint8Array([0x82, 0x49]), new Uint8Array([0x82, 0, 0, 0, 0])]) {
    assert.equal(codec(serializeDashDocument({ ...source, tracks: [{ ...track,
      samples: track.samples.map(sample => ({ ...sample, data, size: data.length }))
    }] }).manifest), "vp09");
  }
});
