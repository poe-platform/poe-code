import { encodeH264Preset } from "@poe-code/media-codecs";
import { rgbaToYuv420p } from "./binary.js";
import { annexBToAvcc, buildAvcC, parseAvcC, parseH264Sps } from "./codecs.js";
import { MediaBudgetTracker, type MediaTrack, type MediaSample } from "./types.js";

/** Encode decoded video with an x264 preset before passing it to any H.264 muxer. */
export function encodeH264PresetTrack(
  track: MediaTrack, preset: string, budget = new MediaBudgetTracker(),
  forceKeyFrames?: readonly number[], maxBFrames?: number, qp?: number, bitrate?: number, zeroLatency?: boolean, crf?: number
): MediaTrack {
  const frames = track.decodedVideoFrames;
  if (track.type !== "video" || !frames?.length) return track;
  const { width, height } = frames[0]!;
  const timescale = track.timescale || 90000;
  const frameDuration = Math.max(1, Math.round(frames[0]!.durationSeconds * timescale));
  const forcedTicks = forceKeyFrames?.map(time => Math.round(time * timescale / frameDuration)).sort((a, b) => a - b) ?? [];
  const durations = new Map<number, number>();
  function* pictures() {
    let nextForced = 0;
    for (const frame of frames!) {
      budget.checkCpu();
      if (frame.width !== width || frame.height !== height) throw new Error("H.264 frame dimensions changed");
      const pts = Math.round(frame.ptsSeconds * timescale);
      const keyframe = nextForced < forcedTicks.length && Math.round(pts / frameDuration) >= forcedTicks[nextForced]!;
      if (keyframe) nextForced++;
      durations.set(pts, Math.max(1, Math.round(frame.durationSeconds * timescale)));
      const native = frame.native;
      const size = width * height;
      // Avoid a lossy YUV -> RGB -> YUV round trip, especially for QP 0.
      const planes = native?.format === 0 && native.rgba === frame.data && native.width === width && native.height === height
        ? { y: native.pixels.subarray(0, size), u: native.pixels.subarray(size, size * 5 / 4), v: native.pixels.subarray(size * 5 / 4) }
        : rgbaToYuv420p(frame.data, width, height);
      yield { ...planes, pts, keyframe };
    }
  }
  const samples: MediaSample[] = [];
  const workingBytes = width * height * (Math.min(frames.length, 250) * 3 + 64) + 65536;
  budget.allocateMemory(workingBytes);
  let avcC;
  let bytes = 0;
  try {
    for (const packet of encodeH264Preset(pictures(), width, height, timescale, frameDuration, preset, maxBFrames, qp, bitrate, zeroLatency, crf)) {
      budget.checkCpu();
      const converted = annexBToAvcc(packet.data);
      if (converted.sps.length && converted.pps.length) avcC ??= parseAvcC(buildAvcC(converted.sps, converted.pps));
      budget.checkSamples(samples.length + 1);
      budget.allocateMemory(converted.avccData.length + 64);
      bytes += converted.avccData.length;
      budget.checkOutputBytes(bytes);
      samples.push({ data: converted.avccData, size: converted.avccData.length,
        pts: packet.pts, dts: packet.dts, cts: packet.pts - packet.dts,
        duration: durations.get(packet.pts)!, isKeyframe: packet.keyframe, sampleDescriptionIndex: 1 });
    }
  } finally { budget.releaseMemory(workingBytes); }
  if (!avcC) throw new Error("H.264 encoder omitted its configuration");
  const sps = parseH264Sps(avcC.sps[0]!);
  return { ...track, width, height, timescale, samples, decodedVideoFrames: undefined,
    editList: undefined, codecDescriptions: [{ formatFourCC: "avc1", codecName: "h264", width, height,
      profile: sps.profileName, level: sps.levelIdc, pixFmt: "yuv420p", avcC }] };
}
