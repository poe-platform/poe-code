import { decodeAudio } from "@poe-code/media-codecs";
import type { MediaAudioData, MediaDocument, MediaTrack } from "./types.js";

/** Decode complete AAC frames, including preroll, in the track time base. */
export function* decodeAacFrames(track: MediaTrack) {
  const description = track.codecDescriptions[0];
  const extra = description?.esds?.decoderSpecificInfo;
  if (!extra || track.codecDescriptions.length !== 1 || track.samples.some(sample => sample.sampleDescriptionIndex !== 1)) {
    throw new Error("Unsupported AAC sample description");
  }
  for (const frame of decodeAudio("AAC", track.samples, extra)) {
    if (frame.sampleRate !== description.sampleRate || frame.channelData.length !== description.channels) {
      throw new Error("AAC decoded dimensions differ from sample description");
    }
    yield frame;
  }
}

/** Apply the presentation edits after decoding preroll, never by dropping AAC packets. */
export function decodeAacTrack(doc: MediaDocument, track: MediaTrack): MediaAudioData {
  const description = track.codecDescriptions[0];
  if (!description) throw new Error("Unsupported AAC sample description");
  const sampleRate = description.sampleRate!;
  const channels = description.channels!;
  const edits = track.editList?.length ? track.editList : [{
    mediaTime: track.samples[0]?.pts ?? 0,
    segmentDuration: track.duration / track.timescale * doc.timescale,
    mediaRateInteger: 1, mediaRateFraction: 0
  }];
  const regions = edits.map(edit => {
    if (edit.mediaRateInteger !== 1 || edit.mediaRateFraction !== 0 || edit.mediaTime < -1) {
      throw new Error("Unsupported AAC edit rate or media time");
    }
    return { start: edit.mediaTime === -1 ? -1 : Math.round(edit.mediaTime / track.timescale * sampleRate),
      count: Math.round(edit.segmentDuration / doc.timescale * sampleRate) };
  });
  const count = regions.reduce((total, region) => total + region.count, 0);
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000 ||
      !Number.isInteger(channels) || channels < 1 || channels > 8 ||
      regions.some(region => !Number.isSafeInteger(region.count) || region.count < 0) ||
      !Number.isSafeInteger(count) || count * channels * 4 > 128 * 1024 * 1024) {
    throw new Error("Unsupported AAC PCM dimensions");
  }
  const channelData = Array.from({ length: channels }, () => new Float32Array(count));
  const covered = regions.map(() => 0);
  let previousEnd = -Infinity;
  for (const frame of decodeAacFrames(track)) {
    const start = Math.round(frame.pts / track.timescale * sampleRate);
    const end = start + frame.channelData[0]!.length;
    if (!Number.isSafeInteger(start) || start < previousEnd) throw new Error("Overlapping AAC frames");
    previousEnd = end;
    let offset = 0;
    for (let index = 0; index < regions.length; index++) {
      const region = regions[index]!;
      if (region.start !== -1) {
        const left = Math.max(start, region.start);
        const right = Math.min(end, region.start + region.count);
        if (right > left) {
          for (let channel = 0; channel < channels; channel++) {
            channelData[channel]!.set(frame.channelData[channel]!.subarray(left - start, right - start), offset + left - region.start);
          }
          covered[index]! += right - left;
        }
      }
      offset += region.count;
    }
  }
  if (regions.some((region, index) => region.start !== -1 && covered[index] !== region.count)) {
    throw new Error("AAC stream did not decode the complete presentation interval");
  }
  return { sampleRate, channels, channelData };
}
