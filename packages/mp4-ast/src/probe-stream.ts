import { gcd, IDENTITY_MATRIX } from './binary.js';
import { probeSampleFormat, type Mp4CodecMetadata } from './mp4-codec-metadata.js';
import type { MediaTrack, MediaProbeStream, MediaProbeText } from './types.js';

export type ProbeStreamTrack<T> = Pick<MediaTrack, 'id' | 'type' | 'timescale' | 'duration' | 'width' | 'height' | 'language' | 'rotation' | 'matrix' | 'enabled' | 'declaredSampleCount' | 'metadata' | 'disposition'> & { handlerName?: T | undefined };
export interface ProbeSampleStats { totalBytes: number; count: number; ticks: number; firstPts: number; initialPadding?: number; hasReorderedSamples: boolean }
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
  amr_nb: "AMR-NB (Adaptive Multi-Rate NarrowBand)",
  amr_wb: "AMR-WB (Adaptive Multi-Rate WideBand)",
  mp3: "MP3 (MPEG audio layer 3)",
  opus: "Opus (Opus Interactive Audio Codec)",
  vorbis: "Vorbis",
  flac: "FLAC (Free Lossless Audio Codec)",
  alac: "ALAC (Apple Lossless Audio Codec)",
  pcm_s16le: "PCM signed 16-bit little-endian",
  pcm_s16be: "PCM signed 16-bit big-endian",
  mov_text: "3GPP Timed Text subtitle",
  webvtt: "WebVTT subtitle",
  ass: "ASS (Advanced SSA) subtitle",
  subrip: "SubRip subtitle"
};

/** Shared stream schema for resident samples and bounded source aggregates. */
export function buildProbeStream<T extends string | MediaProbeText>(track: ProbeStreamTrack<T>, desc: Mp4CodecMetadata | undefined, stats: ProbeSampleStats, idx: number, containerFormat: string): Omit<MediaProbeStream, 'tags'> & { tags: Record<string, string | T> | undefined } {
  // QuickTime timecode has a sample-entry tag, but no decoder codec name.
  const codecName = desc?.formatFourCC === "tmcd" ? "" : desc?.codecName ?? (track.type === "video" ? "h264" : "aac");
  const codecLongName = CODEC_LONG_NAMES[codecName] ?? codecName;
  const matroska = containerFormat === "matroska" || containerFormat === "webm";
  const adts = containerFormat === "aac";
  // Internal MP4/QuickTime aliases are not tags in ADTS, WebVTT or Matroska PCM.
  const noCodecTag = adts || containerFormat === "webvtt" || containerFormat === "matroska" && codecName === "pcm_s16le"
    || containerFormat === "aiff" && desc?.formatFourCC === "\0\0\0\0";
  const rawTag = desc?.formatFourCC ?? (track.type === "video" ? "avc1" : "mp4a");
  const tagFourCC = Array.from(rawTag).map(c => c.charCodeAt(0) < 32 ? `[${c.charCodeAt(0)}]` : c).join("");
  const sampleFormat = probeSampleFormat(track.type, codecName);
  const tagHex = containerFormat === "wav"
    ? "0x" + (rawTag.charCodeAt(0) | (rawTag.charCodeAt(1) << 8)).toString(16).padStart(4, "0")
    : "0x" +
    Array.from(rawTag.padEnd(4, " ").slice(0, 4))
      .reverse()
      .map((c) => c.charCodeAt(0).toString(16).padStart(2, "0"))
      .join("");

  const durationSec = track.duration / Math.max(1, track.timescale);
  const totalBytes = stats.totalBytes;
  const bitRate =
    containerFormat === "aiff" && codecName.startsWith("pcm_") && desc?.sampleRate && desc.channels && desc.bitsPerSample
      ? String(desc.sampleRate * desc.channels * desc.bitsPerSample)
      : (rawTag === 'tmcd' || rawTag === 'samr' || rawTag === 'sawb') && (containerFormat === 'mp4' || containerFormat === 'mov') && stats.ticks > 0
      // Edit lists trim presentation; timecode and AMR bitrate use original sample ticks.
      ? String(Math.trunc(totalBytes * 8 * track.timescale / stats.ticks))
      : codecName === 'aac' && (containerFormat === 'mp4' || containerFormat === 'mov') && stats.ticks > 0
      // Empty sample tables use the demuxer's rounded fragment estimate;
      // classic tables include encoder lead-in samples and truncate.
      ? String((track.declaredSampleCount === 0 ? Math.round : Math.trunc)(totalBytes * 8 * track.timescale / stats.ticks))
      : durationSec > 0 ? String(Math.round((totalBytes * 8) / durationSec)) : "0";
  const nbFrames = stats.count;
  const sampleTicks = stats.ticks;
  const fpsNum = nbFrames * track.timescale;
  const fpsGcd = gcd(fpsNum, sampleTicks || 1);
  const avgFrameRate = track.type === "video" && sampleTicks > 0
    ? `${fpsNum / fpsGcd}/${sampleTicks / fpsGcd}` : "0/0";

  let timecodeFrameRate: string | undefined;
  if (desc?.formatFourCC === "tmcd" && desc.extraData && desc.extraData.length >= 16) {
    const config = new DataView(desc.extraData.buffer, desc.extraData.byteOffset, desc.extraData.byteLength);
    const timescale = config.getUint32(8), frameDuration = config.getUint32(12);
    // Preserve the declared fraction; a timecode packet can span the entire clip.
    if (timescale && frameDuration) timecodeFrameRate = `${timescale}/${frameDuration}`;
  }

  const w = track.width ?? desc?.width;
  const h = track.height ?? desc?.height;
  const darWidth = (w ?? 0) * (desc?.sarWidth ?? 0);
  const darHeight = (h ?? 0) * (desc?.sarHeight ?? 0);
  const darGcd = darWidth && darHeight ? gcd(darWidth, darHeight) : 1;

  const streamTags: Record<string, string | T> = {
    ...track.metadata,
    ...(adts || containerFormat === "webvtt" || (matroska || containerFormat === "avi") && track.language === "und" ||
      containerFormat === "wav" && track.disposition?.attached_pic === 1
      ? {} : { language: track.language || "und" })
  };
  if (track.handlerName) streamTags.handler_name = track.handlerName;
  if (desc?.compressorName) streamTags.encoder = desc.compressorName;
  if (track.rotation) streamTags.rotate = String(track.rotation);

  const matrix = track.matrix;
  const hasDisplayMatrix = matrix?.length === 9 && matrix.some((value, index) => value !== IDENTITY_MATRIX[index]);
  const scaleX = matrix ? Math.hypot(matrix[0]!, matrix[3]!) : 0;
  const scaleY = matrix ? Math.hypot(matrix[1]!, matrix[4]!) : 0;

  return {
    index: idx,
    id: adts || matroska || containerFormat === "webvtt" ? undefined : `0x${track.id.toString(16)}`,
    codec_name: codecName || undefined,
    mime_codec_string: desc?.mimeCodecString,
    codec_long_name: codecLongName || undefined,
    profile: desc?.profile,
    codec_type: track.type,
    codec_tag_string: noCodecTag ? "[0][0][0][0]" : tagFourCC,
    codec_tag: noCodecTag ? "0x0000" : tagHex,
    extradata_size: desc?.extradataSize || undefined,
    codecData: desc?.extradataSize ? desc.extraDataRange ?? desc.extraData : undefined,
    width: w,
    height: h,
    // ffprobe exposes cropped H.264 dimensions, not padded macroblock sizes.
    coded_width: codecName === 'h264' ? (desc?.width ?? w) : w ? Math.ceil(w / 16) * 16 : undefined,
    coded_height: codecName === 'h264' ? (desc?.height ?? h) : h ? Math.ceil(h / 16) * 16 : undefined,
    has_b_frames: track.type === "video" ? (desc?.maxNumReorderFrames ?? (stats.hasReorderedSamples ? 1 : 0)) : undefined,
    sample_aspect_ratio:
      track.type === "video" && desc?.sarWidth && desc?.sarHeight
        ? `${desc.sarWidth}:${desc.sarHeight}`
        : undefined,
    display_aspect_ratio:
      track.type === "video" && desc?.sarWidth && desc?.sarHeight && w && h ? `${darWidth / darGcd}:${darHeight / darGcd}` : undefined,
    pix_fmt: track.type === "video" ? (desc?.pixFmt ?? "yuv420p") : undefined,
    level: desc?.level,
    field_order: track.type === "video" ? desc?.fieldOrder : undefined,
    color_range: track.type === "video" ? desc?.colorRange : undefined,
    color_space: track.type === "video" ? desc?.colorSpace : undefined,
    color_transfer: track.type === "video" ? desc?.colorTransfer : undefined,
    color_primaries: track.type === "video" ? desc?.colorPrimaries : undefined,
    chroma_location: desc?.chromaLocation,
    is_avc: codecName === "h264" ? String(desc?.nalLengthSize !== undefined) : undefined,
    nal_length_size: codecName === "h264" ? String(desc?.nalLengthSize ?? 0) : undefined,
    bits_per_raw_sample: desc?.bitDepthLuma === undefined ? undefined : String(desc.bitDepthLuma),
    sample_fmt: sampleFormat,
    initial_padding: track.type === 'audio' && codecName === 'aac' && (containerFormat === 'mp4' || containerFormat === 'mov')
      ? stats.initialPadding ?? 0 : undefined,
    sample_rate:
      track.type === "audio" ? String(desc?.sampleRate ?? track.timescale) : undefined,
    channels: track.type === "audio" ? (desc?.channels ?? 2) : undefined,
    channel_layout:
      containerFormat === "au" ? undefined :
      containerFormat === "caf" || containerFormat === "aiff" ? desc?.channelLayout : track.type === "audio"
        ? (desc?.channels ?? 2) === 1
          ? "mono"
          : "stereo"
        : undefined,
    bits_per_sample: track.type === "audio" ? (codecName === 'aac' ? 0 : desc?.bitsPerSample ?? 16) : undefined,
    r_frame_rate: avgFrameRate,
    avg_frame_rate: timecodeFrameRate ?? avgFrameRate,
    time_base: `1/${track.timescale}`,
    start_pts: stats.firstPts,
    start_time: ((stats.firstPts) / Math.max(1, track.timescale)).toFixed(6),
    duration_ts: matroska || containerFormat === "webvtt" || containerFormat === "wav" && track.duration === 0 ? undefined : track.duration,
    duration: matroska || containerFormat === "webvtt" || containerFormat === "wav" && track.duration === 0 ? undefined : durationSec.toFixed(6),
    bit_rate: containerFormat === "webvtt" ? undefined : bitRate,
    nb_frames: adts || matroska || containerFormat === "au" || containerFormat === "wav" || containerFormat === "webvtt" || track.declaredSampleCount === 0
      ? undefined : String(track.declaredSampleCount ?? nbFrames),
    ...(!adts && !matroska && containerFormat !== "au" && containerFormat !== "webvtt" && track.declaredSampleCount === undefined ? {} : {
      nb_read_packets: String(stats.count),
      nb_read_frames: String(track.type === "data" ? 0 : stats.count)
    }),
    disposition: {
      default: !adts && containerFormat !== "webvtt" && containerFormat !== "wav" && track.enabled ? 1 : 0,
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
      timed_thumbnails: 0,
      non_diegetic: 0,
      captions: 0,
      descriptions: 0,
      metadata: 0,
      dependent: 0,
      still_image: 0,
      multilayer: 0,
      ...track.disposition
    },
    tags: (adts || containerFormat === "webvtt") && Object.keys(streamTags).length === 0 ? undefined : streamTags,
    side_data_list: hasDisplayMatrix
      ? [{ side_data_type: "Display Matrix",
          displaymatrix: "\n" + [0, 1, 2].map(row =>
            `${String(row).padStart(8, "0")}:  ${matrix.slice(row * 3, row * 3 + 3).map(value => String(value).padStart(11, " ")).join(" ")}\n`
          ).join(""),
          rotation: scaleX && scaleY ? Math.trunc(-Math.atan2(matrix[1]! / scaleY, matrix[0]! / scaleX) * 180 / Math.PI) || 0 : -2147483648 }]
      : track.rotation && !matrix
        ? [{ side_data_type: "Display Matrix", rotation: ((180 - track.rotation) % 360 + 360) % 360 - 180 }]
        : undefined

  };
}
