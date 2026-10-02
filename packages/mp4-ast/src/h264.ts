import { decodeH264 } from "@poe-code/media-codecs";
import { avccToAnnexB, buildH264SpsPps } from "./codecs.js";
import type { MediaCodecDescription, MediaSample, MediaVideoFrame } from "./types.js";

/** Decode complete access units in display order, retaining SPS/PPS and reference pictures. */
export function* decodeH264Samples(
  samples: readonly MediaSample[],
  descriptions: readonly MediaCodecDescription[],
  width: number,
  height: number,
  timescale: number
): Generator<MediaVideoFrame> {
  if (samples.length === 0) return;
  // H.264 allocates complete macroblocks before applying SPS display cropping.
  const paddedPixels = (w: number, h: number) => Math.ceil(w / 16) * 16 * Math.ceil(h / 16) * 16;
  const maxPixels = descriptions.reduce((maximum, description) =>
    Math.max(maximum, paddedPixels(description.width ?? width, description.height ?? height)), paddedPixels(width, height));
  const byTimestamp = new Map(samples.map(sample => [sample.pts, sample]));
  function* packets() {
    let previousDescription = -1;
    for (const sample of samples) {
      const description = descriptions[sample.sampleDescriptionIndex - 1] ?? descriptions[0];
      const config = description?.avcC;
      let parameters: { sps: readonly Uint8Array[]; pps: readonly Uint8Array[] } | undefined;
      if (sample.sampleDescriptionIndex !== previousDescription) {
        if (config) parameters = config;
        else {
          const generated = buildH264SpsPps(description?.width ?? width, description?.height ?? height);
          parameters = { sps: [generated.sps], pps: [generated.pps] };
        }
        previousDescription = sample.sampleDescriptionIndex;
      }
      yield {
        ...sample,
        data: avccToAnnexB(sample.data, (config?.lengthSizeMinusOne ?? 3) + 1, parameters)
      };
    }
  }
  let decoded = 0;
  for (const picture of decodeH264(packets(), new Uint8Array(), maxPixels)) {
    const source = byTimestamp.get(picture.pts);
    if (!source) throw new Error("H.264 decoder returned an unknown presentation timestamp");
    decoded++;
    yield {
      width: picture.width,
      height: picture.height,
      data: picture.data,
      ptsSeconds: picture.pts / timescale,
      durationSeconds: source.duration / timescale,
      keyframe: source.isKeyframe
    };
  }
  if (decoded !== samples.length) throw new Error("H.264 stream did not decode every picture");
}
