import { BitReader } from "./binary.js";
import type { MediaTrack } from "./types.js";

// VP9 levels by maximum luma sample rate and picture size, as used by FFmpeg.
const levels = [
  [10, 829440, 36864], [11, 2764800, 73728],
  [20, 4608000, 122880], [21, 9216000, 245760],
  [30, 20736000, 552960], [31, 36864000, 983040],
  [40, 83558400, 2228224], [41, 160432128, 2228224],
  [50, 311951360, 8912896], [51, 588251136, 8912896],
  [52, 1176502272, 8912896], [60, 1176502272, 35651584],
  [61, 2353004544, 35651584], [62, 4706009088, 35651584]
] as const;

export function vp9CodecString(track: MediaTrack): string {
  const description = track.codecDescriptions[0];
  let profile = description?.vpcC?.profile;
  let bitDepth = description?.vpcC?.bitDepth;
  if (profile === undefined || bitDepth === undefined) {
    // WebM has no vpcC; the keyframe's uncompressed header carries these fields.
    for (const sample of track.samples) {
      if (!sample.isKeyframe || sample.data.length < 5) continue;
      const bits = new BitReader(sample.data);
      if (bits.readBits(2) !== 2) continue;
      const frameProfile = bits.readBit() | (bits.readBit() << 1);
      if (frameProfile === 3 && bits.readBit() !== 0) continue;
      if (bits.readBit() !== 0 || bits.readBit() !== 0) continue; // show_existing_frame, frame_type
      bits.readBits(2); // show_frame, error_resilient_mode
      if (bits.readBits(24) !== 0x498342) continue;
      profile = frameProfile;
      bitDepth = profile < 2 ? 8 : 10 + bits.readBit() * 2;
      break;
    }
  }
  if (profile === undefined || bitDepth === undefined) return "vp09";

  const pictureSize = (track.width ?? 0) * (track.height ?? 0);
  const ticks = track.samples.reduce((sum, sample) => sum + sample.duration, 0);
  const sampleRate = ticks > 0 ? Math.floor(pictureSize * track.samples.length * track.timescale / ticks) : 0;
  const level = description?.vpcC?.level ?? description?.level ??
    (pictureSize > 0 ? levels.find(([, rate, size]) => sampleRate <= rate && pictureSize <= size)?.[0] ?? 0 : 0);
  return `vp09.${[profile, level, bitDepth].map(value => String(value).padStart(2, "0")).join(".")}`;
}
