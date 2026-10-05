import { gcd } from './binary.js';
import { probeSampleFormat, type Mp4CodecMetadata } from './mp4-codec-metadata.js';
import type { MediaTrack, MediaProbeStream, MediaProbeText } from './types.js';

export type ProbeStreamTrack<T> = Pick<MediaTrack, 'id' | 'type' | 'timescale' | 'duration' | 'width' | 'height' | 'language' | 'rotation' | 'enabled'> & { handlerName?: T | undefined };
export interface ProbeSampleStats { totalBytes: number; count: number; ticks: number; firstPts: number; hasCts: boolean }
const CODEC_LONG_NAMES: Record<string, string> = {
  h264: "H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10",
  hevc: "H.265 / HEVC (High Efficiency Video Coding)",
  av1: "Alliance for Open Media AV1",
  vp8: "On2 VP8",
  vp9: "Google VP9",
  mpeg4: "MPEG-4 part 2",
  mjpeg: "Motion JPEG",
  png: "PNG (Portable Network Graphics) image",
  gif: "GIF (Graphics Interchange Format)",
  webp: "WebP image",
  rawvideo: "raw video",
  aac: "AAC (Advanced Audio Coding)",
  mp3: "MP3 (MPEG audio layer 3)",
  opus: "Opus (Opus Interactive Audio Codec)",
  vorbis: "Vorbis",
  flac: "FLAC (Free Lossless Audio Codec)",
  alac: "ALAC (Apple Lossless Audio Codec)",
  pcm_s16le: "PCM signed 16-bit little-endian",
  pcm_s16be: "PCM signed 16-bit big-endian",
  mov_text: "3GPP Timed Text subtitle",
  webvtt: "WebVTT subtitle",
  subrip: "SubRip subtitle"
};

/** Shared stream schema for resident samples and bounded source aggregates. */
export function buildProbeStream<T extends string | MediaProbeText>(track: ProbeStreamTrack<T>, desc: Mp4CodecMetadata | undefined, stats: ProbeSampleStats, idx: number, containerFormat: string): Omit<MediaProbeStream, 'tags'> & { tags: Record<string, string | T> } {
  const codecName = desc?.codecName ?? (track.type === "video" ? "h264" : "aac");
  const codecLongName = CODEC_LONG_NAMES[codecName] ?? codecName;
  const rawTag = desc?.formatFourCC ?? (track.type === "video" ? "avc1" : "mp4a");
  const tagFourCC = Array.from(rawTag).map(c => c.charCodeAt(0) < 32 ? `[${c.charCodeAt(0)}]` : c).join("");
  const sampleFormat = probeSampleFormat(track.type, codecName);
  const tagHex = containerFormat === "wav"
    ? "0x" + (rawTag.charCodeAt(0) | (rawTag.charCodeAt(1) << 8)).toString(16).padStart(4, "0")
    : "0x" +
    Array.from(rawTag.padEnd(4, " ").slice(0, 4))
      .map((c) => c.charCodeAt(0).toString(16).padStart(2, "0"))
      .join("");

  const durationSec = track.duration / Math.max(1, track.timescale);
  const totalBytes = stats.totalBytes;
  const bitRate =
    durationSec > 0 ? String(Math.round((totalBytes * 8) / durationSec)) : "0";
  const nbFrames = stats.count;
  const sampleTicks = stats.ticks;
  const fpsNum = nbFrames * track.timescale;
  const fpsGcd = gcd(fpsNum, sampleTicks || 1);
  const avgFrameRate = track.type === "video" && sampleTicks > 0
    ? `${fpsNum / fpsGcd}/${sampleTicks / fpsGcd}` : "0/0";

  const w = track.width ?? desc?.width;
  const h = track.height ?? desc?.height;
  const darGcd = w && h ? gcd(w, h) : 1;

  const streamTags: Record<string, string | T> = {
    language: track.language || "und"
  };
  if (track.handlerName) streamTags.handler_name = track.handlerName;
  if (track.rotation) streamTags.rotate = String(track.rotation);

  return {
    index: idx,
    id: `0x${track.id.toString(16)}`,
    codec_name: codecName,
    codec_long_name: codecLongName,
    profile: desc?.profile,
    codec_type: track.type,
    codec_tag_string: tagFourCC,
    codec_tag: tagHex,
    width: w,
    height: h,
    coded_width: w ? Math.ceil(w / 16) * 16 : undefined,
    coded_height: h ? Math.ceil(h / 16) * 16 : undefined,
    has_b_frames: track.type === "video" ? (stats.hasCts ? 1 : 0) : undefined,
    sample_aspect_ratio:
      track.type === "video"
        ? `${desc?.sarWidth ?? 1}:${desc?.sarHeight ?? 1}`
        : undefined,
    display_aspect_ratio:
      track.type === "video" && w && h ? `${w / darGcd}:${h / darGcd}` : undefined,
    pix_fmt: track.type === "video" ? (desc?.pixFmt ?? "yuv420p") : undefined,
    level: desc?.level,
    color_range: track.type === "video" ? "tv" : undefined,
    color_space: track.type === "video" ? "bt709" : undefined,
    sample_fmt: sampleFormat,
    sample_rate:
      track.type === "audio" ? String(desc?.sampleRate ?? track.timescale) : undefined,
    channels: track.type === "audio" ? (desc?.channels ?? 2) : undefined,
    channel_layout:
      track.type === "audio"
        ? (desc?.channels ?? 2) === 1
          ? "mono"
          : "stereo"
        : undefined,
    bits_per_sample: track.type === "audio" ? (desc?.bitsPerSample ?? 16) : undefined,
    r_frame_rate: avgFrameRate,
    avg_frame_rate: avgFrameRate,
    time_base: `1/${track.timescale}`,
    start_pts: stats.firstPts,
    start_time: ((stats.firstPts) / Math.max(1, track.timescale)).toFixed(6),
    duration_ts: track.duration,
    duration: durationSec.toFixed(6),
    bit_rate: bitRate,
    nb_frames: String(nbFrames),
    disposition: {
      default: track.enabled ? 1 : 0,
      dub: 0,
      original: 0,
      comment: 0,
      lyrics: 0,
      karaoke: 0,
      forced: 0,
      hearing_impaired: 0,
      visual_impaired: 0,
      clean_effects: 0,
      attached_pic: 0,
      timed_thumbnails: 0
    },
    tags: streamTags,
    side_data_list: track.rotation
      ? [{ side_data_type: "Display Matrix", rotation: -track.rotation }]
      : undefined
  };
}
