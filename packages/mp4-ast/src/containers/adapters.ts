import { amrAst } from "./amr.js";
import { latmAst } from "./latm.js";
export { latmAst } from "./latm.js";
import { ac3Ast } from "./ac3.js";
import { wavpackAst } from "./wavpack.js";
export { wavpackAst } from "./wavpack.js";
import { vocAst } from "./voc.js";
import { decodeTga, encodeTga } from "./tga.js";
import { icoAst } from "./ico.js";
export { icoAst } from "./ico.js";
import { apngAst } from "./apng.js";
export { apngAst } from "./apng.js";
import { pjsAst } from "./pjs.js";
import { realtextAst } from "./realtext.js";
import { samiAst } from "./sami.js";
import { lrcAst } from "./lrc.js";
import { vplayerAst } from "./vplayer.js";
import { mpl2Ast } from "./mpl2.js";
import { stlAst } from "./stl.js";
import { jacosubAst } from "./jacosub.js";
import { subviewer1Ast } from "./subviewer1.js";
import { aqtitleAst } from "./aqtitle.js";
import { microdvdAst } from "./microdvd.js";
import { cafAst } from "./caf.js";
import { ircamAst } from "./ircam.js";
import { nistSphereAst } from "./nistsphere.js";
import { auAst } from "./au.js";
import { aiffAst } from "./aiff.js";
import { rawAudioAsts, parseRawAudio, mulawTable, alawTable } from "./raw-audio.js";
import { encodeAudio, scaleVideoPicture } from "@poe-code/media-codecs";
import { compressedWavPackets, decodeCompressedWav } from "./wav-compressed.js";
import { decodeG726, encodeG726 } from "./au-g726.js";
import { decodeYamahaWav, encodeYamahaWav } from "./wav-yamaha.js";
import { decodeMsWav, encodeMsWav, msBlockFrames, msCoefficients } from "./wav-ms.js";
import { decodeImaWav, encodeImaWav, imaBlockFrames } from "./wav-ima.js";
import { readMp3Frames, readMp3SourceFrames, readMp3StreamFrames, writeMp3Frames, type Mp3Frame } from "./mp3-frames.js";
import { decodeMp3Track, encodeMp3 } from "../mp3.js";
import { decodeVorbisTrack } from "../vorbis.js";
import { decodeAacTrack } from "../aac.js";
import { wavInfoTags, isWave64Signature, wave64Guid, readWavHeader, readWavSourceHeader, readWavStreamHeader, type WavHeader } from "./wav-header.js";
import { parseAudio, parseId3, id3HeaderSize, mpegFrame, flacFormatTags, writeAudioMetadata, encodeId3, type AudioStream } from "@poe-code/audio-ast";
import { decodeH264Samples } from "../h264.js";
import { decodeFlac, encodeFlacPackets } from "./flac.js";
import { FlacFrameScanner, flacChapters } from "./flac-probe.js";

import { parseStreamingDocument, serializeDashDocument } from "./streaming.js";
import { serializeOgg, extractOggFlac, readOggFlacHeader, demuxOggOpus } from "./ogg.js";
import { decodeImage, encodeImage, type ImageFormat } from "@poe-code/image-ast/portable";
import {
  BinaryReader,
  BinaryWriter,
  concatBytes,
  decodeFourCC,
  decodeUtf8,
  encodeUtf8,
  gcd,
  rgbaToYuv420p,
  yuv420pToRgba
} from "../binary.js";
import {
  buildAudioSpecificConfig,
  buildEsdsBox,
  createSilentAacFrame,
  parseAdtsStream,
  wrapAdtsFrame
} from "../codecs.js";
import {
  buildProbeResultFromDoc,
  concatMp4,
  movAst,
  mp4Ast,
  sliceMp4
} from "../mp4.js";
import {
  MediaBudgetTracker,
  type MediaAstPlugin,
  type MediaAudioData,
  type MediaDocument,
  type Mp4Chapter,
  type MediaProbeResult,
  type MediaProbeRecords,
  type MediaSourceProbeOptions,
  type MediaProbeSource,
  type MediaSample,
  type MediaTrack,
  type MediaVideoFrame,
  type ParseMediaOptions,
  type SerializeMediaOptions
} from "../types.js";
import { assAst } from "./ass.js";
import { nutAst } from "./nut.js";
import { aviAst, flvAst } from "./avi.js";
import { mkvAst, webmAst } from "./mkv.js";
import { mpegtsAst } from "./mpegts.js";

function extractVideoFramesFromDoc(doc: MediaDocument, maxFrames?: number): {
  frames: MediaVideoFrame[];
  width: number;
  height: number;
  fps: number;
} {
  const vTrack = doc.tracks.find((t) => t.type === "video");
  if (!vTrack) {
    return { frames: [], width: 64, height: 64, fps: 10 };
  }
  const width = vTrack.width ?? vTrack.codecDescriptions[0]?.width ?? 64;
  const height = vTrack.height ?? vTrack.codecDescriptions[0]?.height ?? 64;
  const ts = vTrack.timescale || 90000;
  const frames: MediaVideoFrame[] = [];
  const edits = vTrack.editList?.length ? vTrack.editList : undefined;
  let presentationStart = 0;
  for (const edit of edits ?? [undefined]) {
    const duration = edit ? edit.segmentDuration / doc.timescale : Infinity;
    if (edit && edit.mediaTime < 0) {
      presentationStart += duration;
      continue;
    }
    const mediaStart = edit ? edit.mediaTime / ts : -Infinity;
    const mediaEnd = edit ? mediaStart + duration : Infinity;
    const decoded = vTrack.decodedVideoFrames?.length ? vTrack.decodedVideoFrames
      : decodeH264Samples(vTrack.samples, vTrack.codecDescriptions, width, height, ts);
    for (const frame of decoded) {
      // MP4 retains reference pictures outside its visible interval. Other
      // containers must export only the displayed portion of each picture.
      const start = edit ? Math.max(Math.round(frame.ptsSeconds * ts) / ts, mediaStart) : frame.ptsSeconds;
      const end = edit ? Math.min(Math.round((frame.ptsSeconds + frame.durationSeconds) * ts) / ts, mediaEnd)
        : frame.ptsSeconds + frame.durationSeconds;
      if (end <= start) continue;
      frames.push(edit ? { ...frame, ptsSeconds: presentationStart + start - mediaStart, durationSeconds: end - start } : frame);
      if (maxFrames !== undefined && frames.length >= maxFrames) break;
    }
    if (maxFrames !== undefined && frames.length >= maxFrames) break;
    presentationStart += duration;
  }
  const fps = frames.length > 0 ? 1 / (frames[0]!.durationSeconds || .1) : 30;
  return { frames, width, height, fps };
}

// --- 1. YUV4MPEG2 (.y4m) ---

export function isY4mSignature(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 10) return false;
  return decodeUtf8(bytes.subarray(0, 10)) === "YUV4MPEG2 ";
}

export function parseY4m(bytes: Uint8Array): MediaDocument {
  if (!isY4mSignature(bytes)) {
    throw new Error("Invalid YUV4MPEG2 stream: missing 'YUV4MPEG2 ' magic");
  }
  let newlineIdx = 0;
  while (newlineIdx < bytes.byteLength && bytes[newlineIdx] !== 0x0a) {
    if (newlineIdx === 127) throw new Error("Header too large.");
    newlineIdx++;
  }
  const headerLine = decodeUtf8(bytes.subarray(0, newlineIdx));
  let width = 0;
  let height = 0;
  let fpsNum = 25;
  let fpsDen = 1;
  let sarWidth = 1;
  let sarHeight = 1;
  let chromaLocation: string | undefined;
  let pixFmt = "yuv420p";
  let format = 0;
  let sampleBytes = 1;
  let fieldOrder: "progressive" | "tt" | "bb" | undefined;
  let colorRange: "pc" | "tv" | undefined;

  const tokens = headerLine.split(/\s+/);
  if (!tokens.some(token => token.startsWith("C"))) {
    const chroma = tokens.find(token => token.startsWith("XYSCSS="))?.slice(7);
    if (chroma === "422" || chroma === "444") {
      tokens.push(`C${chroma}`);
    }
  }
  for (const token of tokens) {
    if (token.startsWith("C") && ![
      "420", "420jpeg", "420mpeg2", "420paldv", "422", "444", "411", "444alpha", "mono",
      "420p9", "420p10", "420p12", "420p14", "420p16",
      "422p9", "422p10", "422p12", "422p14", "422p16",
      "444p9", "444p10", "444p12", "444p14", "444p16",
      "mono9", "mono10", "mono12", "mono16"
    ].includes(token.slice(1))) {
      throw new Error("YUV4MPEG stream contains an unknown pixel format");
    }
    if (token.startsWith("W")) width = parseInt(token.slice(1), 10);
    else if (token.startsWith("H")) height = parseInt(token.slice(1), 10);
    else if (token === "Ip") fieldOrder = "progressive";
    else if (token === "It") fieldOrder = "tt";
    else if (token === "Ib") fieldOrder = "bb";
    else if (token === "Im") throw new Error("YUV4MPEG stream contains mixed interlaced and non-interlaced frames");
    else if (token === "C420mpeg2") chromaLocation = "left";
    else if (token === "C420jpeg") chromaLocation = "center";
    else if (token === "Cmono") { pixFmt = "gray"; format = 8; }
    else if (token === "C422") { pixFmt = "yuv422p"; format = 4; }
    else if (token === "C444") { pixFmt = "yuv444p"; format = 5; }
    else if (["C420p10", "C420p12", "C422p10", "C444p10", "C444p12", "C444p16"].includes(token)) {
      pixFmt = `yuv${token.slice(1)}le`;
      format = ({ C420p10: 62, C420p12: 123, C422p10: 64, C444p10: 68, C444p12: 131, C444p16: 49 } as Record<string, number>)[token]!;
      sampleBytes = 2;
    }
    else if (token === "XCOLORRANGE=FULL") colorRange = "pc";
    else if (token === "XCOLORRANGE=LIMITED") colorRange = "tv";
    else if (token.startsWith("F")) {
      const [n, d] = token.slice(1).split(":");
      fpsNum = parseInt(n ?? "25", 10) || 25;
      fpsDen = parseInt(d ?? "1", 10) || 1;
    } else if (token.startsWith("A")) {
      const [n, d] = token.slice(1).split(":");
      const numerator = Number(n);
      const denominator = Number(d);
      if (Number.isInteger(numerator) && numerator >= 0 &&
          Number.isInteger(denominator) && denominator >= 0) {
        sarWidth = numerator;
        sarHeight = denominator;
      }
    }
  }

  if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0) {
    throw new Error("Invalid YUV4MPEG2 dimensions: width and height must be positive integers");
  }

  const fps = fpsNum / Math.max(1, fpsDen);
  const ySize = width * height;
  const horizontalShift = pixFmt.startsWith("yuv444p") ? 0 : 1;
  const verticalShift = pixFmt.startsWith("yuv420p") ? 1 : 0;
  const uvWidth = Math.ceil(width / (1 << horizontalShift));
  const uvHeight = Math.ceil(height / (1 << verticalShift));
  const uvSize = format === 8 ? 0 : uvWidth * uvHeight;
  const frameByteSize = (ySize + uvSize * 2) * sampleBytes;

  const frames: MediaVideoFrame[] = [];
  const samples: MediaSample[] = [];
  const timescale = fpsNum;
  const frameTicks = Math.max(1, fpsDen);
  let cursor = newlineIdx + 1;
  let frameIdx = 0;
  let demuxError: MediaTrack["demuxError"];

  while (cursor < bytes.byteLength) {
    let fEnd = cursor;
    while (fEnd < bytes.byteLength && fEnd - cursor < 80 && bytes[fEnd] !== 0x0a) fEnd++;
    if (fEnd - cursor >= 80 || decodeUtf8(bytes.subarray(cursor, cursor + 5)) !== "FRAME") {
      demuxError = {
        message: "Error during demuxing: Invalid data found when processing input",
        timestamp: frameIdx * Math.max(1, fpsDen)
      };
      break;
    }
    cursor = fEnd + 1;
    if (cursor + frameByteSize > bytes.byteLength) break;

    const yPlane = bytes.subarray(cursor, cursor + ySize);
    const uPlane = bytes.subarray(cursor + ySize, cursor + ySize + uvSize);
    const vPlane = bytes.subarray(
      cursor + ySize + uvSize,
      cursor + ySize + uvSize * 2
    );
    let rgba: Uint8Array = new Uint8Array(0);
    const native = { rgba, pixels: bytes.subarray(cursor, cursor + frameByteSize), width, height,
      format, colorspace: 5, fullRange: colorRange === "pc" ? 1 : 0 };
    rgba = sampleBytes === 2
      ? scaleVideoPicture({ data: rgba, width, height, native }, width, height)!
      : yuv420pToRgba(yPlane, uPlane, vPlane, width, height, horizontalShift, verticalShift, colorRange === "pc");
    frames.push({
      width,
      height,
      data: rgba,
      native: { ...native, rgba },
      ptsSeconds: frameIdx / fps,
      durationSeconds: 1 / fps,
      keyframe: true,
      pictureType: 1
    });
    samples.push({
      data: rgba,
      offset: cursor,
      dts: frameIdx * frameTicks,
      pts: frameIdx * frameTicks,
      cts: 0,
      duration: frameTicks,
      size: frameByteSize,
      isKeyframe: true,
      sampleDescriptionIndex: 1
    });
    cursor += frameByteSize;
    frameIdx++;
  }

  return {
    containerFormat: "yuv4mpegpipe",
    timescale: 1000,
    duration: Math.round((frames.length / fps) * 1000),
    durationSeconds: frames.length / fps,
    tracks: [
      {
        id: 1,
        type: "video",
        handlerType: "vide",
        timescale,
        duration: frames.length * frameTicks,
        language: "und",
        enabled: true,
        width,
        height,
        codecDescriptions: [
          {
            formatFourCC: pixFmt === "yuv420p" ? "I420" : "raw ",
            codecName: "rawvideo",
            width,
            height,
            pixFmt,
            chromaLocation,
            sarWidth,
            sarHeight,
            fieldOrder,
            colorRange
          }
        ],
        samples,
        decodedVideoFrames: frames,
        ...(demuxError ? { demuxError } : {})
      }
    ],
    metadata: {},
    byteLength: bytes.byteLength
  };
}

export function serializeY4m(doc: MediaDocument): Uint8Array {
  const { frames, width, height, fps } = extractVideoFramesFromDoc(doc);
  const track = doc.tracks.find(track => track.type === "video");
  const codec = track?.codecDescriptions[0];
  const sampleDuration = track?.samples[0]?.duration;
  const exactTiming = track && sampleDuration && frames[0] &&
    Math.abs(sampleDuration / track.timescale - frames[0].durationSeconds) < Number.EPSILON;
  const divisor = exactTiming ? gcd(track.timescale, sampleDuration) : 1;
  let rate = exactTiming ? `${track.timescale / divisor}:${sampleDuration / divisor}` : `${Math.round(fps)}:1`;
  if (!exactTiming) {
    // Filters keep durations in seconds. Recover their rational rate instead of
    // rounding to integer fps or reusing the source track's stale sample timing.
    let value = fps;
    let previousNumerator = 0, numerator = 1;
    let previousDenominator = 1, denominator = 0;
    while (Number.isFinite(value)) {
      const whole = Math.floor(value);
      const nextNumerator = whole * numerator + previousNumerator;
      const nextDenominator = whole * denominator + previousDenominator;
      if (nextNumerator > 2147483647 || nextDenominator > 2147483647) break;
      [previousNumerator, numerator] = [numerator, nextNumerator];
      [previousDenominator, denominator] = [denominator, nextDenominator];
      if (numerator > 0) rate = `${numerator}:${denominator}`;
      if (Math.abs(numerator / denominator - fps) <= fps * 1e-12) break;
      value = 1 / (value - whole);
    }
  }
  const interlace = codec?.fieldOrder === "tt" ? "t" : codec?.fieldOrder === "bb" ? "b" : "p";
  const sourceFormat = frames[0]?.native?.format;
  const preserveNative = sourceFormat !== undefined && [0, 4, 5, 8, 49, 68].includes(sourceFormat) &&
    frames.every(frame => frame.native?.format === sourceFormat && frame.native.rgba === frame.data &&
      frame.native.width === width && frame.native.height === height);
  const range = preserveNative && sourceFormat === 8 && frames[0]?.native?.fullRange || codec?.colorRange === "pc"
    ? " XCOLORRANGE=FULL" : codec?.colorRange === "tv" ? " XCOLORRANGE=LIMITED" : "";
  const chroma = preserveNative && sourceFormat === 49 ? "444p16"
    : preserveNative && sourceFormat === 68 ? "444p10"
    : preserveNative && sourceFormat === 8 ? "mono"
    : preserveNative && sourceFormat === 4 ? "422 XYSCSS=422"
    : preserveNative && sourceFormat === 5 ? "444 XYSCSS=444"
    : codec?.chromaLocation === "left" ? "420mpeg2 XYSCSS=420MPEG2" : "420jpeg XYSCSS=420JPEG";
  const header = encodeUtf8(`YUV4MPEG2 W${width} H${height} F${rate} I${interlace} A${codec?.sarWidth ?? 1}:${codec?.sarHeight ?? 1} C${chroma}${range}\n`);
  const frameTag = encodeUtf8("FRAME\n");
  const chunks: Uint8Array[] = [header];

  for (const frame of frames) {
    const native = frame.native;
    if (preserveNative && native) {
      chunks.push(frameTag, native.pixels);
      continue;
    }
    const { y, u, v } = rgbaToYuv420p(frame.data, width, height);
    chunks.push(frameTag, y, u, v);
  }

  return concatBytes(chunks);
}

export function y4mAst(): MediaAstPlugin {
  return {
    id: "y4m",
    formatName: "yuv4mpegpipe",
    formatLongName: "YUV4MPEG pipe",
    extensions: ["y4m"],
    mimeTypes: ["video/x-yuv4mpeg"],
    canDemux: true,
    canMux: true,
    supportedVideoCodecs: ["rawvideo"],
    supportedAudioCodecs: [],
    detect(bytes, filename) {
      if (isY4mSignature(bytes)) return true;
      if (filename && filename.toLowerCase().endsWith(".y4m")) return isY4mSignature(bytes);
      return false;
    },
    parse(bytes) {
      return parseY4m(bytes);
    },
    serialize(doc) {
      return serializeY4m(doc);
    },
    probe(bytes, options) {
      const doc = parseY4m(bytes);
      const probe = buildProbeResultFromDoc(doc, bytes.byteLength, options?.filename ?? "input.y4m", {
        ...options,
        formatName: "yuv4mpegpipe",
        formatLongName: "YUV4MPEG pipe"
      });
      const track = doc.tracks[0]!;
      const sample = track.samples[0];
      // Seekable duration assumes a bare "FRAME\n" header, even when frame
      // tags make the actual records larger. Counts still come from samples.
      const ticks = options?.seekable !== false && sample
        ? Math.floor((bytes.byteLength - bytes.indexOf(0x0a) - 1) / (sample.size + 6)) * sample.duration
        : track.duration;
      const duration = (ticks / track.timescale).toFixed(6);
      return { ...probe,
        streams: probe.streams.map(stream => ({ ...stream, nb_frames: undefined, duration_ts: ticks / (sample?.duration ?? 1), duration,
          nb_read_packets: String(track.samples.length), nb_read_frames: String(track.samples.length) })),
        format: { ...probe.format, duration,
          bit_rate: ticks > 0 ? String(Math.round(bytes.byteLength * 8 * track.timescale / ticks)) : undefined },
        packetData: probe.packets && new Map(probe.packets.map((packet, index) =>
        [`${packet.pos}:${packet.size}`, doc.tracks[0]!.decodedVideoFrames![index]!.native!.pixels])) };
    },
    concat(docs, options) {
      return concatMp4(docs, options);
    },
    slice(doc, options) {
      return sliceMp4(doc, options);
    }
  };
}

// --- 2. ADTS AAC (.aac) ---

export function isAdtsSignature(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 7 && bytes[0] === 0xff && (bytes[1]! & 0xf6) === 0xf0;
}

export function parseAacAdts(bytes: Uint8Array): MediaDocument {
  const prefix = id3HeaderSize(bytes);
  const metadata: Record<string, string> = prefix ? { ...parseId3(bytes).tags } : {};
  let end = bytes.length;
  const footer = end - 32;
  if (footer >= prefix && decodeUtf8(bytes.subarray(footer, footer + 8)) === "APETAGEX") {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const size = view.getUint32(footer + 12, true);
    const count = view.getUint32(footer + 16, true);
    if (size < 32 || size > end - prefix) throw new Error("Invalid APE tag size");
    let offset = end - size;
    end = offset;
    if (offset >= prefix + 32 && decodeUtf8(bytes.subarray(offset - 32, offset - 24)) === "APETAGEX") end -= 32;
    for (let i = 0; i < count; i++) {
      if (offset + 8 > footer) throw new Error("Truncated APE tag item");
      const length = view.getUint32(offset, true);
      const flags = view.getUint32(offset + 4, true);
      offset += 8;
      const keyEnd = bytes.indexOf(0, offset);
      if (keyEnd < offset || keyEnd >= footer || length > footer - keyEnd - 1) throw new Error("Invalid APE tag item");
      const key = decodeUtf8(bytes.subarray(offset, keyEnd)).toLowerCase();
      offset = keyEnd + 1;
      if ((flags & 6) === 0) metadata[key] = decodeUtf8(bytes.subarray(offset, offset + length));
      offset += length;
    }
  }
  const parsed = parseAdtsStream(bytes.subarray(prefix, end));
  const sampleRate = parsed.sampleRate || 44100;
  const channels = parsed.channels || 2;
  const samples: MediaSample[] = parsed.frames.map((frame, i) => ({
    data: frame,
    dts: i * 1024,
    pts: i * 1024,
    cts: 0,
    duration: 1024,
    size: frame.byteLength,
    isKeyframe: true,
    sampleDescriptionIndex: 1
  }));

  const asc = buildAudioSpecificConfig(sampleRate, channels, parsed.audioObjectType || 2);
  const durationSeconds = (samples.length * 1024) / sampleRate;

  return {
    containerFormat: "aac",
    timescale: sampleRate,
    duration: samples.length * 1024,
    durationSeconds,
    tracks: [
      {
        id: 1,
        type: "audio",
        handlerType: "soun",
        timescale: sampleRate,
        duration: samples.length * 1024,
        language: "und",
        enabled: true,
        codecDescriptions: [
          {
            formatFourCC: "mp4a",
            codecName: "aac",
            profile: "LC",
            sampleRate,
            channels,
            bitsPerSample: 16,
            esds: {
              objectTypeIndication: 0x40,
              audioObjectType: 2,
              sampleRate,
              channelCount: channels,
              maxBitrate: 128000,
              avgBitrate: 128000,
              decoderSpecificInfo: asc,
              rawEsdsBytes: buildEsdsBox(sampleRate, channels, 128000, asc).subarray(8)
            }
          }
        ],
        samples
      }
    ],
    metadata,
    byteLength: bytes.byteLength
  };
}

export function serializeAacAdts(doc: MediaDocument, options: SerializeMediaOptions = {}): Uint8Array {
  const audioTrack = doc.tracks.find((t) => t.type === "audio");
  const sampleRate = audioTrack?.codecDescriptions[0]?.sampleRate ?? 44100;
  const channels = audioTrack?.codecDescriptions[0]?.channels ?? 2;
  const samples =
    audioTrack && audioTrack.samples.length > 0
      ? audioTrack.samples
      : [
          {
            data: createSilentAacFrame(channels),
            dts: 0,
            pts: 0,
            cts: 0,
            duration: 1024,
            size: 6,
            isKeyframe: true,
            sampleDescriptionIndex: 1
          }
        ];

  const adtsFrames = samples.map((s) => {
    const bytes = s.data.byteLength >= 7 && s.data[0] === 0xff && (s.data[1]! & 0xf0) === 0xf0
      ? Uint8Array.from(s.data)
      : wrapAdtsFrame(s.data, sampleRate, channels);
    for (let offset = 0; offset < bytes.length;) {
      const length = ((bytes[offset + 3]! & 3) << 11) | (bytes[offset + 4]! << 3) | (bytes[offset + 5]! >> 5);
      if (length < 7 || offset + length > bytes.length) throw new Error("Invalid ADTS frame length");
      bytes[offset + 1] = (bytes[offset + 1]! & ~8) | (options.writeMpeg2 ? 8 : 0);
      offset += length;
    }
    return bytes;
  });
  if (options.writeApetag) {
    const metadata = options.metadata ?? doc.metadata;
    const items = new BinaryWriter();
    let count = 0;
    for (const [key, value] of Object.entries({ ...metadata.custom, ...metadata })) {
      if (typeof value !== "string" || !value) continue;
      // APE keys must be printable ASCII, 2–255 bytes, excluding '='.
      if (key.length < 2 || key.length > 255 || Array.from(key).some(char =>
        char.charCodeAt(0) < 32 || char.charCodeAt(0) > 126 || char === "=")) continue;
      const bytes = encodeUtf8(value);
      items.writeU32LE(bytes.length);
      items.writeU32LE(0); // UTF-8 text item.
      items.writeNullTerminatedString(key);
      items.writeBytes(bytes);
      count++;
    }
    if (count) {
      const payload = items.toUint8Array();
      const tag = new BinaryWriter();
      for (const flags of [0xa0000000, 0x80000000]) {
        tag.writeBytes(encodeUtf8("APETAGEX"));
        tag.writeU32LE(2000);
        tag.writeU32LE(payload.length + 32); // Includes footer, excludes header.
        tag.writeU32LE(count);
        tag.writeU32LE(flags);
        tag.writeZeros(8);
        if (flags === 0xa0000000) tag.writeBytes(payload);
      }
      adtsFrames.push(tag.toUint8Array());
    }
  }
  if (options.writeId3v2) {
    const tags = Object.fromEntries(Object.entries(options.metadata ?? doc.metadata)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1] !== ""));
    adtsFrames.unshift(encodeId3(tags));
  }
  return concatBytes(adtsFrames);
}

export function aacAst(): MediaAstPlugin {
  return {
    id: "aac",
    formatName: "aac,adts",
    formatLongName: "raw ADTS AAC (Advanced Audio Coding)",
    extensions: ["aac"],
    mimeTypes: ["audio/aac", "audio/x-hx-aac-adts"],
    canDemux: true,
    canMux: true,
    supportedVideoCodecs: [],
    supportedAudioCodecs: ["aac"],
    detect(bytes, filename) {
      if (isAdtsSignature(bytes.subarray(id3HeaderSize(bytes)))) return true;
      if (filename && filename.toLowerCase().endsWith(".aac")) return bytes.byteLength >= 7;
      return false;
    },
    parse(bytes) {
      return parseAacAdts(bytes);
    },
    serialize: serializeAacAdts,
    probe(bytes, options) {
      const doc = parseAacAdts(bytes);
      const result = buildProbeResultFromDoc(doc, bytes.byteLength, options?.filename ?? "input.aac", {
        ...options,
        formatName: "aac",
        formatLongName: "raw ADTS AAC (Advanced Audio Coding)"
      });
      // FFmpeg's ADTS demuxer clock is common to every AAC sample rate.
      // Rescale probe ticks only; seconds, decoded samples and parsed media stay intact.
      const timeBase = 28224000;
      const scale = timeBase / doc.tracks[0]!.timescale;
      const probe = {
        ...result,
        streams: result.streams.map(stream => ({
          ...stream, time_base: `1/${timeBase}`,
          start_pts: stream.start_pts! * scale, duration_ts: stream.duration_ts! * scale
        })),
        packets: result.packets?.map(packet => ({
          ...packet, pts: packet.pts * scale, dts: packet.dts * scale,
          duration: packet.duration! * scale
        })),
        frames: result.frames?.map(frame => ({
          ...frame, pts: frame.pts * scale, pkt_dts: frame.pkt_dts! * scale,
          best_effort_timestamp: frame.best_effort_timestamp! * scale,
          pkt_duration: frame.pkt_duration! * scale,
          duration: frame.pkt_duration! * scale, duration_time: frame.pkt_duration_time!
        }))
      };
      if (!probe.packets && !probe.frames) return probe;
      // Demuxed AAC samples omit ADTS headers; ffprobe records include them.
      const frames = parseAdtsStream(bytes, true).frames;
      const packets = probe.packets?.map((packet, index) => ({ ...packet,
        pos: String(frames[index]!.byteOffset - bytes.byteOffset),
        size: String(frames[index]!.byteLength)
      }));
      return { ...probe, packets,
        frames: probe.frames?.map((frame, index) => ({ ...frame,
          pkt_pos: String(frames[index]!.byteOffset - bytes.byteOffset),
          pkt_size: String(frames[index]!.byteLength)
        })),
        packetData: packets && new Map(packets.map((packet, index) =>
          [`${packet.pos}:${packet.size}`, frames[index]!])) };
    },
    concat(docs, options) {
      return concatMp4(docs, options);
    },
    slice(doc, options) {
      return sliceMp4(doc, options);
    }
  };
}

// --- 3. WAV / RIFF WAVE (.wav) ---

export function isWavSignature(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= 12 &&
    (decodeFourCC(bytes, 0) === "RIFF" || decodeFourCC(bytes, 0) === "RIFX" || decodeFourCC(bytes, 0) === "RF64") &&
    decodeFourCC(bytes, 8) === "WAVE"
  );
}

export function wavPacketFrames(sampleRate: number, block: number, maxSize?: number): number {
  if (maxSize) return Math.max(1, Math.floor(maxSize / block));
  // FFmpeg PCM demuxing targets ten packets per second, rounded down to a power of two.
  const samples = Math.max(1, Math.min(Math.floor(sampleRate / 10), Math.floor(0x7fffffff / block)));
  return 2 ** Math.floor(Math.log2(samples));
}

function wavFrames(header: WavHeader): number {
  if (header.formatTag === 0x45) {
    if (header.channels !== 1) throw new Error("G.726 WAV requires mono audio");
    if (![2, 3, 4, 5].includes(header.bitsPerSample)) throw new Error("Invalid G.726 WAV sample width");
    return Math.floor(header.dataSize * 8 / header.bitsPerSample);
  }
  if (header.formatTag === 32) {
    if (header.channels !== 1 && header.channels !== 2) throw new Error("Yamaha ADPCM WAV requires mono or stereo audio");
    if (header.bitsPerSample !== 4) throw new Error("Invalid Yamaha ADPCM WAV sample width");
    return header.dataSize * 2 / header.channels;
  }
  if (header.formatTag !== 17 && header.formatTag !== 2) return Math.floor(header.dataSize / Math.max(1, header.bitsPerSample ? header.channels * (header.bitsPerSample >>> 3) : header.blockAlign));
  if (header.bitsPerSample !== 4) throw new Error("Invalid ADPCM WAV sample width");
  const blockFrames = header.formatTag === 2 ? msBlockFrames : imaBlockFrames;
  const frames = blockFrames(header.blockAlign, header.channels);
  const tail = header.dataSize % header.blockAlign;
  const remainder = header.formatTag === 17 ? Math.floor(tail / (header.channels * 4)) * header.channels * 4 : tail;
  return Math.floor(header.dataSize / header.blockAlign) * frames + (remainder ? blockFrames(remainder, header.channels) : 0);
}

export function parseWav(bytes: Uint8Array, options: ParseMediaOptions = {}): MediaDocument {
  const header = readWavHeader(bytes, options.ignoreLength, options.seekable);
  if (options.decodeAudio !== false && header.channels === 0) throw new Error("Decoder requires channel layout to be set");
  const { formatTag, channels, sampleRate, bitsPerSample, littleEndian } = header;
  if (options.decodeAudio !== false && bitsPerSample !== 0 &&
      (formatTag === 1 && ![8, 16, 24, 32, 64].includes(bitsPerSample) ||
       formatTag === 3 && ![32, 64].includes(bitsPerSample))) {
    throw new Error(`No decoder for WAV format tag ${formatTag} with ${bitsPerSample}-bit samples`);
  }
  const chunks = header.dataChunks ?? [{ offset: header.dataOffset, size: header.dataSize }];
  const pcmData = bytes.subarray(header.dataOffset, header.dataOffset + chunks[chunks.length - 1]!.size);

  const compressed = formatTag !== 1 && formatTag !== 3 && formatTag !== 0xfffe;
  const bytesPerFrame = formatTag === 0x45 ? bitsPerSample / 8 : formatTag === 32 ? channels / 2 : Math.max(1, bitsPerSample ? channels * (bitsPerSample >>> 3) : header.blockAlign);
  const totalPcmSamples = header.dataChunks
    ? chunks.reduce((sum, chunk) => sum + wavFrames({ ...header, dataSize: chunk.size }), 0) : wavFrames(header);
  let decodedAudio: MediaAudioData | undefined;
  if (options.decodeAudio !== false && (formatTag === 85 || formatTag === 255)) {
    decodedAudio = decodeCompressedWav(bytes, header);
  } else if (options.decodeAudio !== false && formatTag === 0x45) {
    const budget = options.budget ?? new MediaBudgetTracker(options.limits);
    budget.checkInputBytes(bytes.length);
    budget.checkDuration(totalPcmSamples / sampleRate);
    decodedAudio = { sampleRate, channels, channelData: [decodeG726(pcmData, bitsPerSample as 2 | 3 | 4 | 5, budget, false)] };
  } else if (options.decodeAudio !== false && formatTag === 32) {
    decodedAudio = { sampleRate, channels, channelData: decodeYamahaWav(pcmData, channels) };
  } else if (options.decodeAudio !== false && formatTag === 2) {
    decodedAudio = { sampleRate, channels, channelData: decodeMsWav(pcmData, channels, header.blockAlign, totalPcmSamples) };
  } else if (options.decodeAudio !== false && formatTag === 17) {
    decodedAudio = { sampleRate, channels, channelData: decodeImaWav(pcmData, channels, header.blockAlign, totalPcmSamples) };
  } else if (options.decodeAudio !== false && bitsPerSample !== 0) {
    // Preserve precision for signed PCM32 and 64-bit samples.
    const SampleArray = bitsPerSample === 64 || (formatTag === 1 || formatTag === 0xfffe) && bitsPerSample === 32 ? Float64Array : Float32Array;
    const channelData = Array.from({ length: channels }, () => new SampleArray(totalPcmSamples));
    const integer64 = bitsPerSample === 64 && formatTag !== 3 ? new DataView(new ArrayBuffer(8)) : undefined;
    let frameStart = 0;
    for (const chunk of chunks) {
      const pcmData = bytes.subarray(chunk.offset, chunk.offset + chunk.size);
      const pcmView = new DataView(pcmData.buffer, pcmData.byteOffset, pcmData.byteLength);

      for (let i = 0; i < Math.floor(chunk.size / bytesPerFrame); i++) {
        for (let ch = 0; ch < channels; ch++) {
          const byteOff = (i * channels + ch) * (bitsPerSample >>> 3);
          if (bitsPerSample === 64 && byteOff + 8 <= pcmData.byteLength) {
            if (integer64) {
              const value = pcmView.getBigInt64(byteOff, littleEndian);
              let sample = Number(value);
              // Round toward negative infinity so normalization cannot move a
              // signed integer across a boundary used by PCM narrowing.
              if (BigInt(sample) > value) {
                integer64.setFloat64(0, sample);
                integer64.setBigUint64(0, integer64.getBigUint64(0) + (sample < 0 ? 1n : -1n));
                sample = integer64.getFloat64(0);
              }
              channelData[ch]![frameStart + i] = sample / 2 ** 63;
            } else {
              channelData[ch]![frameStart + i] = pcmView.getFloat64(byteOff, littleEndian);
            }
          } else if (formatTag === 1 && bitsPerSample === 32 && header.validBitsPerSample === 24 && littleEndian && byteOff + 4 <= pcmData.byteLength) {
            // FFmpeg pcm_f24le stores floats scaled to the signed 24-bit range.
            channelData[ch]![frameStart + i] = pcmView.getFloat32(byteOff, true) / 8388608;
          } else if (formatTag === 3 && bitsPerSample === 32 && byteOff + 4 <= pcmData.byteLength) {
            channelData[ch]![frameStart + i] = pcmView.getFloat32(byteOff, littleEndian);
          } else if (bitsPerSample === 24 && byteOff + 3 <= pcmData.byteLength) {
            const value = littleEndian
              ? pcmData[byteOff]! | (pcmData[byteOff + 1]! << 8) | (pcmData[byteOff + 2]! << 16)
              : (pcmData[byteOff]! << 16) | (pcmData[byteOff + 1]! << 8) | pcmData[byteOff + 2]!;
            channelData[ch]![frameStart + i] = (value << 8 >> 8) / 8388608;
          } else if (bitsPerSample === 32 && byteOff + 4 <= pcmData.byteLength) {
            channelData[ch]![frameStart + i] = pcmView.getInt32(byteOff, littleEndian) / 2147483648;
          } else if (bitsPerSample === 16 && byteOff + 2 <= pcmData.byteLength) {
            channelData[ch]![frameStart + i] = pcmView.getInt16(byteOff, littleEndian) / 32768;
          } else if (bitsPerSample === 8 && byteOff < pcmData.byteLength) {
            const byte = pcmData[byteOff]!;
            if (formatTag === 6) {
              const value = byte ^ 0x55;
              const exponent = (value >>> 4) & 7;
              const magnitude = exponent === 0 ? ((value & 15) << 4) + 8 :
                (((value & 15) << 4) + 264) << (exponent - 1);
              channelData[ch]![frameStart + i] = (value & 128 ? magnitude : -magnitude) / 32768;
            } else if (formatTag === 7) {
              const value = byte ^ 0xff;
              const magnitude = ((((value & 15) << 3) + 132) << ((value >>> 4) & 7)) - 132;
              channelData[ch]![frameStart + i] = (value & 128 ? 0 - magnitude : magnitude) / 32768;
            } else {
              channelData[ch]![frameStart + i] = (byte - 128) / 128;
            }
          }
        }
      }
      frameStart += Math.floor(chunk.size / bytesPerFrame);
    }
    decodedAudio = { sampleRate, channels, channelData, ...(header.channelMask !== undefined ? { channelMask: header.channelMask } : {}) };
  }

  const packets = compressedWavPackets(pcmData, header);
  const samples: MediaSample[] = packets ?? [];
  const chunkFrames = formatTag === 0x45 ? Math.max(8, Math.floor(wavPacketFrames(sampleRate, bytesPerFrame, options.maxSize) / 8) * 8) : formatTag === 2 ? msBlockFrames(header.blockAlign, channels) : formatTag === 17 ? imaBlockFrames(header.blockAlign, channels) : wavPacketFrames(header.sampleRate, bytesPerFrame, options.maxSize);
  let chunkStart = 0;
  for (const chunk of chunks) {
    const chunkData = bytes.subarray(chunk.offset, chunk.offset + chunk.size);
    const chunkSamples = wavFrames({ ...header, dataSize: chunk.size });
    for (let offsetSample = 0; !packets && (compressed ? offsetSample < chunkSamples : offsetSample * bytesPerFrame < chunkData.length); offsetSample += chunkFrames) {
      const count = Math.min(chunkFrames, chunkSamples - offsetSample);
      const byteStart = formatTag === 2 || formatTag === 17 ? offsetSample / chunkFrames * header.blockAlign : offsetSample * bytesPerFrame;
      const byteEnd = formatTag === 2 || formatTag === 17 ? Math.min(chunkData.length, byteStart + header.blockAlign) : compressed && offsetSample + count === chunkSamples ? chunkData.byteLength : Math.min(chunkData.length, (offsetSample + chunkFrames) * bytesPerFrame);
      samples.push({
        data: chunkData.subarray(byteStart, byteEnd),
        offset: chunk.offset + byteStart,
        dts: chunkStart + offsetSample,
        pts: chunkStart + offsetSample,
        cts: 0,
        duration: bitsPerSample ? count : 0,
        size: byteEnd - byteStart,
        isKeyframe: true,
        sampleDescriptionIndex: 1
      });
    }
    chunkStart += chunkSamples;
  }

  if (compressed && samples.length === 0 && pcmData.length > 0) {
    samples.push({ data: pcmData, offset: header.dataOffset, dts: 0, pts: 0, cts: 0, duration: 0,
      size: pcmData.length, isKeyframe: true, sampleDescriptionIndex: 1 });
  }
  let doc = wavDocument(header, samples, options.seekable, decodedAudio, bytes);
  if (!options.ignoreLength && !compressed && header.declaredDataSize !== undefined && pcmData.length < header.declaredDataSize &&
      pcmData.length % (chunkFrames * bytesPerFrame) !== 0) {
    doc = { ...doc, tracks: doc.tracks.map(track => ({ ...track,
      demuxError: { message: "corrupt input packet", timestamp: Math.floor(totalPcmSamples / chunkFrames) * chunkFrames }
    })) };
  }
  if (formatTag === 17 && decodedAudio && pcmData.length > 0 && totalPcmSamples === 0) {
    return { ...doc, tracks: doc.tracks.map(track => ({
      ...track, decodeErrors: ["Invalid IMA WAV block size"]
    })) };
  }
  const trailingBytes = (chunks.find(chunk => chunk.size % bytesPerFrame !== 0)?.size ?? 0) % bytesPerFrame;
  if (!compressed && decodedAudio && trailingBytes !== 0) {
    return { ...doc, tracks: doc.tracks.map(track => ({
      ...track,
      decodeErrors: [`Invalid PCM packet: ${trailingBytes} trailing bytes cannot form a ${bytesPerFrame}-byte sample frame`]
    })) };
  }
  return doc;
}

function wavDocument(header: WavHeader, samples: MediaSample[], seekable = true, decodedAudio?: MediaAudioData, bytes?: Uint8Array): MediaDocument {
  const { formatTag, channels, sampleRate, bitsPerSample, byteLength } = header;
  // ffprobe estimates block ADPCM stream duration from coded bits, including block headers.
  // Decoded audio and individual packet durations still use the actual block sample counts.
  // Native WAV demuxing rejects fact counts implying more than one extra coded bit per sample.
  const factSamples = formatTag === 17 && header.factSampleCount &&
    Math.floor(header.dataSize * 8 / header.factSampleCount / channels) <= bitsPerSample + 1
    ? header.factSampleCount : undefined;
  const totalPcmSamples = !decodedAudio && (formatTag === 2 || formatTag === 17)
    ? factSamples ?? Math.floor(header.dataSize * 8 / (bitsPerSample * channels))
    : decodedAudio?.channelData[0]?.length ?? ([80, 85, 0x2000].includes(formatTag) && samples.length
      ? samples.reduce((sum, sample) => sum + sample.duration, 0) : wavFrames(header));
  const durationSeconds = totalPcmSamples / Math.max(1, sampleRate);
  // Resolve distinct starts backwards while preserving the original chapter order.
  const cueEnds = new Map<number, number>();
  // Buffered stdin length does not establish a demuxer duration. A fact chunk
  // can supply one; otherwise the last cue ends at its own start.
  let nextCueStart = seekable ? totalPcmSamples : header.factSampleCount || Infinity;
  for (const start of [...new Set(header.cues?.map(cue => cue.start))].sort((a, b) => b - a)) {
    cueEnds.set(start, Math.max(start, Number.isFinite(nextCueStart) ? nextCueStart : start));
    nextCueStart = Math.min(start, nextCueStart);
  }
  return {
    containerFormat: header.containerFormat,
    timescale: sampleRate,
    duration: totalPcmSamples,
    durationSeconds,
    chapters: header.chapters ?? header.cues?.map(cue => ({
      id: cue.id,
      timescale: sampleRate,
      startTimeSeconds: cue.start / sampleRate,
      endTimeSeconds: cueEnds.get(cue.start)! / sampleRate,
      title: cue.title ?? "",
      tags: cue.title === undefined ? {} : { title: cue.title }
    })),
    tracks: [
      {
        id: 1,
        type: "audio",
        handlerType: "soun",
        timescale: sampleRate,
        duration: totalPcmSamples,
        language: "und",
        enabled: true,
        codecDescriptions: [
          {
            formatFourCC: String.fromCharCode(formatTag & 255, formatTag >>> 8, 0, 0),
            codecName: formatTag === 80 ? "mp2" : formatTag === 0x2000 ? "ac3" : formatTag === 0x45 ? "adpcm_g726" : formatTag === 1 && bitsPerSample === 32 && header.validBitsPerSample === 24 && header.littleEndian ? "pcm_f24le" : formatTag === 85 ? "mp3" : formatTag === 255 ? "aac" : formatTag === 32 ? "adpcm_yamaha" : formatTag === 2 ? "adpcm_ms" : formatTag === 17 ? "adpcm_ima_wav" : formatTag === 6 ? "pcm_alaw" : formatTag === 7 ? "pcm_mulaw" : bitsPerSample === 0 ? "" : formatTag === 3 ? `pcm_f${bitsPerSample}${header.littleEndian ? "le" : "be"}` : bitsPerSample === 8 ? "pcm_u8" : `pcm_s${bitsPerSample}${header.littleEndian ? "le" : "be"}`,
            sampleRate,
            channels,
            bitsPerSample,
            ...(bytes && header.littleEndian && header.formatOffset !== undefined ? {
              rawWavFormatBytes: bytes.subarray(header.formatOffset, header.formatOffset + header.formatSize!)
            } : {}),
            ...(bytes && header.littleEndian && header.factOffset !== undefined ? {
              rawWavFactBytes: bytes.subarray(header.factOffset, header.factOffset + header.factSize!)
            } : {})
          }
        ],
        samples,
        ...(decodedAudio ? { decodedAudio } : {})
      },
      ...(header.pictures ?? []).map((picture, index) => ({
        ...image2Ast().parse(picture.data).tracks[0]!,
        id: index + 2,
        disposition: { attached_pic: 1 },
        metadata: { title: picture.description, comment: id3PictureTypes[picture.type] ?? "Other" }
      }))
    ],
    metadata: header.metadata ?? {},
    byteLength
  };
}

export function serializeWav(doc: MediaDocument, options: SerializeMediaOptions = {}, format: "wav" | "w64" = "wav"): Uint8Array {
  if (options.audioCodec?.startsWith("pcm_") && options.audioCodec.endsWith("be")) {
    throw new Error(`Codec ${options.audioCodec} not supported in WAVE format`);
  }
  const audioTrack = doc.tracks.find((t) => t.type === "audio");
  if (options.audioCodec === "copy" && (audioTrack?.codecDescriptions[0]?.codecName.endsWith("be") ||
    audioTrack?.codecDescriptions[0]?.codecName === "pcm_f24le")) {
    throw new Error(`Codec ${audioTrack.codecDescriptions[0].codecName} not supported in WAVE format`);
  }
  if (audioTrack?.codecDescriptions[0]?.codecName === "") throw new Error("Unknown audio codec cannot be written to WAVE format");
  const sampleRate = audioTrack?.codecDescriptions[0]?.sampleRate ?? audioTrack?.timescale ?? 44100;
  const channels = audioTrack?.codecDescriptions[0]?.channels ?? 2;
  let bitsPerSample = 16;
  let formatTag = 1;

  let formatBytes = options.audioCodec === "copy" ? audioTrack?.codecDescriptions[0]?.rawWavFormatBytes : undefined;
  let factBytes = formatBytes ? audioTrack?.codecDescriptions[0]?.rawWavFactBytes : undefined;
  let pcmBytes: Uint8Array;
  const decodedAudio = options.audioCodec === "copy" ? undefined : audioTrack?.decodedAudio ?? (audioTrack?.samples.length &&
    (audioTrack.codecDescriptions[0]?.codecName === "aac" ? decodeAacTrack(doc, audioTrack) :
      audioTrack.codecDescriptions[0]?.codecName === "mp3" ? decodeMp3Track(audioTrack) :
      audioTrack.codecDescriptions[0]?.codecName === "vorbis" ? decodeVorbisTrack(audioTrack) : undefined));
  if (decodedAudio && (options.audioCodec === "aac" || options.audioCodec === "mp3")) {
    const codec = options.audioCodec;
    const encoded = encodeAudio(codec, sampleRate, decodedAudio.channelData);
    const { packets, frameSize } = encoded;
    const extra = codec === "aac" ? encoded.extra : undefined;
    const channelConfiguration = extra ? (extra[1]! >>> 3) & 15 : channels;
    if (extra && channelConfiguration === 0) throw new Error("AAC WAV encoding requires a standard AAC channel layout");
    // ADTS keeps access-unit boundaries intact when WAV readers split the data chunk.
    pcmBytes = concatBytes(extra ? packets.map(packet => wrapAdtsFrame(packet, sampleRate, channelConfiguration)) : packets);
    formatBytes = new Uint8Array(extra ? 18 + extra.length : 30);
    const format = new DataView(formatBytes.buffer);
    format.setUint16(0, codec === "aac" ? 255 : 85, true);
    format.setUint16(2, channels, true);
    format.setUint32(4, sampleRate, true);
    format.setUint32(8, Math.round(pcmBytes.length * sampleRate / (packets.length * frameSize)), true);
    format.setUint16(12, codec === "aac" ? 768 * channels : frameSize, true);
    if (extra) {
      format.setUint16(14, 16, true);
      format.setUint16(16, extra.length, true);
      formatBytes.set(extra, 18);
    } else {
      format.setUint16(16, 12, true);
      format.setUint16(18, 1, true); // MPEGLAYER3_ID_MPEG
      format.setUint32(20, 2, true); // padding is encoded in each MPEG frame
      format.setUint16(24, packets[0]?.length ?? 0, true);
      format.setUint16(26, 1, true);
      format.setUint16(28, 1393, true); // LAME decoder delay
    }
    factBytes = new Uint8Array(4);
    new DataView(factBytes.buffer).setUint32(0, codec === "aac"
      ? decodedAudio.channelData[0]!.length + encoded.delay : packets.length * frameSize, true);
  } else if (decodedAudio && options.audioCodec === "g726") {
    if (channels !== 1) throw new Error("G.726 requires mono audio");
    if (sampleRate !== 8000) throw new Error("G.726 requires an 8000 Hz sample rate");
    const width = Math.round((options.audioBitrate ?? 32000) / sampleRate);
    const bits = width <= 2 ? 2 : width === 3 ? 3 : width === 4 ? 4 : 5;
    pcmBytes = encodeG726(decodedAudio.channelData[0]!, bits, options.budget ?? new MediaBudgetTracker());
    formatBytes = new Uint8Array(18);
    const format = new DataView(formatBytes.buffer);
    format.setUint16(0, 0x45, true);
    format.setUint16(2, channels, true);
    format.setUint32(4, sampleRate, true);
    format.setUint32(8, sampleRate * bits / 8, true);
    format.setUint16(12, 1, true);
    format.setUint16(14, bits, true);
    factBytes = new Uint8Array(4);
    new DataView(factBytes.buffer).setUint32(0, decodedAudio.channelData[0]!.length, true);
  } else if (decodedAudio && options.audioCodec === "adpcm_yamaha") {
    pcmBytes = encodeYamahaWav(decodedAudio.channelData);
    formatBytes = new Uint8Array(18);
    const format = new DataView(formatBytes.buffer);
    format.setUint16(0, 32, true);
    format.setUint16(2, channels, true);
    format.setUint32(4, sampleRate, true);
    // FFmpeg advertises its default 128 kbit/s encoder rate in this header.
    format.setUint32(8, 16000, true);
    format.setUint16(12, 1024, true);
    format.setUint16(14, 4, true);
    factBytes = new Uint8Array(4);
    new DataView(factBytes.buffer).setUint32(0, decodedAudio.channelData[0]!.length, true);
  } else if (decodedAudio && (options.audioCodec === "adpcm_ima_wav" || options.audioCodec === "adpcm_ms")) {
    const blockAlign = options.blockSize ?? 1024;
    if (!Number.isInteger(blockAlign) || blockAlign < 32 || blockAlign > 8192 || (blockAlign & (blockAlign - 1)) !== 0) {
      throw new Error("Invalid block_size: expected a power of two from 32 to 8192");
    }
    const microsoft = options.audioCodec === "adpcm_ms";
    if (microsoft && options.trellis) throw new Error("MS ADPCM trellis encoding is not supported");
    const frames = microsoft ? msBlockFrames(blockAlign, channels) : imaBlockFrames(blockAlign, channels);
    pcmBytes = microsoft ? encodeMsWav(decodedAudio.channelData, blockAlign, options.budget)
      : encodeImaWav(decodedAudio.channelData, blockAlign, options.trellis, options.budget);
    formatBytes = new Uint8Array(microsoft ? 50 : 20);
    const format = new DataView(formatBytes.buffer);
    format.setUint16(0, microsoft ? 2 : 17, true);
    format.setUint16(2, channels, true);
    format.setUint32(4, sampleRate, true);
    format.setUint32(8, Math.floor(sampleRate * blockAlign / frames), true);
    format.setUint16(12, blockAlign, true);
    format.setUint16(14, 4, true);
    format.setUint16(16, formatBytes.length - 18, true);
    format.setUint16(18, frames, true);
    if (microsoft) {
      format.setUint16(20, msCoefficients.length, true);
      msCoefficients.forEach(([first, second], index) => {
        format.setInt16(22 + index * 4, first, true);
        format.setInt16(24 + index * 4, second, true);
      });
    }
    factBytes = new Uint8Array(4);
    new DataView(factBytes.buffer).setUint32(0, Math.max(1, decodedAudio.channelData[0]!.length), true);
  } else if (formatBytes) {
    pcmBytes = concatBytes(audioTrack!.samples.map(s => s.data));

    const fmt = new DataView(formatBytes.buffer, formatBytes.byteOffset, formatBytes.byteLength);
    if (formatBytes.length >= 40 && fmt.getUint16(0, true) === 0xfffe && fmt.getUint32(24, true) === 1 &&
        fmt.getUint16(18, true) <= fmt.getUint16(14, true)) {
      // The codec width comes from valid bits, but copied packets retain their storage alignment.
      const validBits = fmt.getUint16(18, true) || fmt.getUint16(14, true);
      bitsPerSample = Math.ceil(validBits / 8) * 8;
      const mask = fmt.getUint32(20, true);
      const extensible = channels > 2 || sampleRate > 48000 || bitsPerSample > 16 ||
        (mask !== 0 && mask !== (channels === 1 ? 4 : 3));
      formatBytes = new Uint8Array(formatBytes.subarray(0, extensible ? 40 : 16));
      const output = new DataView(formatBytes.buffer);
      output.setUint16(0, extensible ? 0xfffe : 1, true);
      output.setUint16(14, bitsPerSample, true);
      if (extensible) output.setUint16(18, bitsPerSample, true);
    }
    if (fmt.getUint16(0, true) === 85 && fmt.getUint32(8, true) === 0 && pcmBytes.length >= 4) {
      // WAV demuxing obtains a missing MP3 rate from the MPEG frame header.
      const header = new DataView(pcmBytes.buffer, pcmBytes.byteOffset, 4).getUint32(0);
      const { bitrate } = mpegFrame(header, 0, pcmBytes.length).fields;
      if (typeof bitrate === "number") {
        formatBytes = new Uint8Array(formatBytes);
        new DataView(formatBytes.buffer).setUint32(8, bitrate / 8, true);
      }
    }
  } else if (options.audioCodec === "copy" && audioTrack?.codecDescriptions[0]?.codecName === "aac") {
    const description = audioTrack.codecDescriptions[0];
    const extra = description.esds?.decoderSpecificInfo ?? description.extraData ?? new Uint8Array();
    pcmBytes = concatBytes(audioTrack.samples.map(sample => sample.data));
    const frames = Math.round(audioTrack.samples.reduce((sum, sample) => sum + sample.duration, 0) * sampleRate / audioTrack.timescale);
    const bitrate = description.esds?.avgBitrate ?? (frames ? pcmBytes.length * 8 * sampleRate / frames : 0);
    formatBytes = new Uint8Array(18 + extra.length + extra.length % 2);
    const format = new DataView(formatBytes.buffer);
    format.setUint16(0, 0xff, true);
    format.setUint16(2, channels, true);
    format.setUint32(4, sampleRate, true);
    format.setUint32(8, Math.floor(bitrate / 8), true);
    format.setUint16(12, 768 * channels, true);
    format.setUint16(14, 16, true);
    format.setUint16(16, extra.length, true);
    formatBytes.set(extra, 18);
    factBytes = new Uint8Array(4);
    new DataView(factBytes.buffer).setUint32(0, frames, true);
  } else if (decodedAudio) {
    switch (options.audioCodec) {
      case "pcm_u8": bitsPerSample = 8; break;
      case "pcm_mulaw": bitsPerSample = 8; formatTag = 7; break;
      case "pcm_alaw": bitsPerSample = 8; formatTag = 6; break;
      case "pcm_s24le": bitsPerSample = 24; break;
      case "pcm_s32le": bitsPerSample = 32; break;
      case "pcm_f32le": bitsPerSample = 32; formatTag = 3; break;
      case "pcm_s64le": bitsPerSample = 64; break;
      case "pcm_f64le": bitsPerSample = 64; formatTag = 3; break;
    }
    const chData = decodedAudio.channelData;
    const numSamples = chData[0]?.length ?? Math.round(doc.durationSeconds * sampleRate);
    const bytesPerSample = bitsPerSample >>> 3;
    // Integer PCM and FLAC narrowing discard low bits; floating-point sources round.
    const source = audioTrack?.codecDescriptions[0];
    // G.711 decodes to PCM16 despite its 8-bit compressed storage width.
    const truncate = formatTag === 1 && ((source?.codecName === "pcm_alaw" || source?.codecName === "pcm_mulaw") ? bitsPerSample < 16
      : (source?.codecName === "flac" || source?.codecName.startsWith("pcm_s")) &&
        (source.bitsPerSample ?? 0) > bitsPerSample);
    // PCM8 rounds directly; companded audio and PCM24 use PCM16/PCM32 precision.
    const scale = 2 ** ((bitsPerSample === 8 && formatTag !== 1 ? 16 : bitsPerSample === 24 ? 32 : bitsPerSample) - 1);
    pcmBytes = new Uint8Array(numSamples * channels * bytesPerSample);
    const pView = new DataView(pcmBytes.buffer);
    for (let i = 0; i < numSamples; i++) {
      for (let c = 0; c < channels; c++) {
        const offset = (i * channels + c) * bytesPerSample;
        if (formatTag === 3) {
          if (bitsPerSample === 64) pView.setFloat64(offset, chData[c]?.[i] ?? 0, true);
          else pView.setFloat32(offset, chData[c]?.[i] ?? 0, true);
          continue;
        }
        const value = chData[c]?.[i] ?? 0;
        const val = Math.max(-1, Math.min(1, value));
        const scaled = (bitsPerSample === 16 ? Number.isFinite(value) ? value : 0 : val) * scale;
        const lower = Math.floor(scaled);
        // FFmpeg rounds halfway PCM values to the nearest even integer.
        let rounded = scaled - lower === 0.5 ? lower + Math.abs(lower % 2) : Math.round(scaled);
        if (bitsPerSample === 16) {
          // FFmpeg x86_64 lrint returns INT64_MIN on overflow, then narrows
          // to int32 before clipping to PCM16, just like the raw PCM encoder.
          rounded = rounded >= 2 ** 63 || rounded < -(2 ** 63) ? 0 : rounded | 0;
        }
        const sample = Math.max(-scale, Math.min(scale - 1, truncate ? lower : rounded));
        if (formatTag === 6 || formatTag === 7) pcmBytes[offset] = (formatTag === 7 ? mulawTable : alawTable)[(sample & 65535) >> 2]!;
        else if (bitsPerSample === 64) pView.setBigInt64(offset, val >= 1 ? (1n << 63n) - 1n : BigInt(sample), true);
        else if (bitsPerSample === 8) pView.setUint8(offset, (sample | 0) + 128);
        else if (bitsPerSample === 16) pView.setInt16(offset, sample, true);
        else if (bitsPerSample === 24) {
          pcmBytes[offset] = (sample >> 8) & 255;
          pcmBytes[offset + 1] = (sample >> 16) & 255;
          pcmBytes[offset + 2] = (sample >> 24) & 255;
        } else pView.setInt32(offset, sample, true);
      }
    }
  } else if (
    options.audioCodec !== "aac" && options.audioCodec !== "mp3" && options.audioCodec !== "adpcm_ima_wav" && options.audioCodec !== "adpcm_ms" && options.audioCodec !== "adpcm_yamaha" && options.audioCodec !== "g726" &&
    audioTrack &&
    audioTrack.codecDescriptions[0]?.codecName.startsWith("pcm_")
  ) {
    pcmBytes = concatBytes(audioTrack.samples.map((s) => s.data));
    bitsPerSample = audioTrack.codecDescriptions[0]!.bitsPerSample ?? 16;
    const codec = audioTrack.codecDescriptions[0]!.codecName;
    formatTag = codec === "pcm_mulaw" ? 7 : codec === "pcm_alaw" ? 6 : codec.startsWith("pcm_f") ? 3 : 1;
  } else {
    throw new Error("WAV encoding requires decoded PCM audio");
  }

  if (options.writeHeader === false) return pcmBytes;

  // Count the packets actually written, including any encoded block padding.
  // Raw AAC WAV has no per-packet timing; Wave64 data sizes include alignment padding.
  if (options.audioCodec === "copy" && format === "wav" && doc.containerFormat !== "w64" &&
      audioTrack?.codecDescriptions[0]?.codecName !== "aac" && factBytes && factBytes.length >= 4 &&
      audioTrack!.samples.every(sample => sample.duration > 0)) {
    const frames = Math.round(audioTrack!.samples.reduce((sum, sample) => sum + sample.duration, 0) * sampleRate / audioTrack!.timescale);
    factBytes = new Uint8Array(factBytes);
    const fact = new DataView(factBytes.buffer);
    fact.setUint32(0, frames, true);
  }

  if (!factBytes && (formatTag === 3 || formatTag === 6 || formatTag === 7)) {
    const frames = pcmBytes.length / (channels * (bitsPerSample >>> 3));
    factBytes = new Uint8Array(format === "w64" ? 8 : 4);
    const fact = new DataView(factBytes.buffer);
    if (format === "w64") fact.setBigUint64(0, BigInt(frames), true);
    else fact.setUint32(0, frames, true);
  }

  // FFmpeg's default layouts from 2.1 through 7.1; explicit masks take precedence.
  const channelMask = audioTrack?.decodedAudio?.channelMask ?? (decodedAudio ? decodedAudio.channelMask : undefined) ??
    [0xb, 0x107, 0x37, 0x3f, 0x70f, 0x63f][channels - 3];
  const extensible = (channelMask !== undefined && channelMask !== (channels === 1 ? 4 : 3)) ||
    channels > 2 || sampleRate > 48000 ||
    (formatTag === 1 && bitsPerSample > 16);
  const fmtSize = formatBytes?.length ?? (extensible ? 40 : formatTag === 3 || formatTag === 6 || formatTag === 7 ? 18 : 16);
  const wave64 = format === "w64";
  const writePeak = !wave64 && options.writePeak !== undefined && options.writePeak !== "off";
  const peakOnly = writePeak && options.writePeak === "only";
  const pcmFormat = formatBytes ? new DataView(formatBytes.buffer, formatBytes.byteOffset, formatBytes.byteLength) : undefined;
  if (writePeak && ((pcmFormat?.getUint16(0, true) ?? formatTag) !== 1 ||
    (pcmFormat?.getUint16(14, true) ?? bitsPerSample) !== 16)) {
    throw new Error("Peak envelope requires 16-bit PCM audio");
  }
  const peakBlockSize = options.peakBlockSize ?? 256;
  const peakFormat = options.peakFormat ?? 2;
  const peakPpv = options.peakPpv ?? 2;
  for (const [name, value, min, max] of [
    ["peak_block_size", peakBlockSize, 0, 65536],
    ["peak_format", peakFormat, 1, 2],
    ["peak_ppv", peakPpv, 1, 2]
  ] as const) {
    if (!Number.isInteger(value) || value < min || value > max) {
      throw new Error(`Invalid ${name}: expected an integer from ${min} to ${max}`);
    }
  }
  const frames = pcmBytes.length / (channels * 2);
  // FFmpeg emits the envelope only after at least one complete block.
  const peakFrames = writePeak && peakBlockSize > 0 && frames >= peakBlockSize ? Math.ceil(frames / peakBlockSize) : 0;
  const peakSize = peakFrames ? 120 + peakFrames * channels * peakFormat * peakPpv : 0;
  const alignment = wave64 ? 8 : 2;
  const pad = (size: number) => (alignment - size % alignment) % alignment;
  const fmtPadding = pad(fmtSize);
  const factSize = factBytes ? (wave64 ? 24 : 8) + factBytes.length + pad(factBytes.length) : 0;
  const padding = pad(pcmBytes.byteLength);
  const tags = options.metadata ?? doc.metadata;
  const info = wave64 || peakOnly ? [] : [
    ...Object.entries(wavInfoTags).map(([id, key]) => [id, tags[key]] as const),
    ["ITCH", tags.custom?.encoded_by] as const
  ].filter((entry): entry is readonly [string, string] => !!entry[1])
    .map(([id, value]) => ({ id, bytes: new TextEncoder().encode(value + "\0") }));
  const infoSize = info.length ? 4 + info.reduce((size, entry) => size + 8 + entry.bytes.length + pad(entry.bytes.length), 0) : 0;
  const history = !wave64 && options.writeBext && tags.custom?.coding_history !== undefined
    ? new TextEncoder().encode(tags.custom.coding_history + "\0") : new Uint8Array();
  const bextSize = !wave64 && options.writeBext ? 602 + history.length : 0;
  const reserveDs64 = !wave64 && (options.rf64 === "always" || options.rf64 === "auto");
  const size = (infoSize ? 8 + infoSize : 0) + (reserveDs64 ? 36 : 0) + (bextSize ? 8 + bextSize + pad(bextSize) : 0) +
    (peakOnly ? 12 : (wave64 ? 88 : 28) + fmtSize + fmtPadding + factSize + pcmBytes.byteLength + padding) +
    (peakSize ? 8 + peakSize + pad(peakSize) : 0);
  const rf64 = reserveDs64 && (options.rf64 === "always" || size - 8 > 0xffffffff);
  options.budget?.checkOutputBytes(size);
  const writer = new BinaryWriter(size);
  const chunk = (id: string, length: number) => {
    if (wave64) {
      writer.writeBytes(wave64Guid(id));
      writer.writeU32LE((length + 24) >>> 0);
      writer.writeU32LE(Math.floor((length + 24) / 2 ** 32));
    } else {
      writer.writeFourCC(id);
      writer.writeU32LE(length);
    }
  };
  if (wave64) {
    chunk("riff", size - 24);
    writer.writeBytes(wave64Guid("wave"));
  } else {
    writer.writeFourCC(rf64 ? "RF64" : "RIFF");
    writer.writeU32LE(rf64 || options.seekable === false ? 0xffffffff : size - 8);
    writer.writeFourCC("WAVE");
    if (reserveDs64) {
      chunk(rf64 ? "ds64" : "JUNK", 28);
      const ds64 = new Uint8Array(28);
      if (rf64) {
        const view = new DataView(ds64.buffer);
        const frames = factBytes && factBytes.length >= 4
          ? new DataView(factBytes.buffer, factBytes.byteOffset, factBytes.byteLength).getUint32(0, true)
          : Math.round((audioTrack?.duration ?? 0) * sampleRate / (audioTrack?.timescale ?? sampleRate));
        view.setBigUint64(0, BigInt(size - 8), true);
        view.setBigUint64(8, BigInt(pcmBytes.byteLength), true);
        view.setBigUint64(16, BigInt(frames), true);
      }
      writer.writeBytes(ds64);
    }
  }
  if (!peakOnly) {
    chunk("fmt ", fmtSize);
    if (formatBytes) {
      writer.writeBytes(formatBytes);
    } else {
      writer.writeU16LE(extensible ? 0xfffe : formatTag);
      writer.writeU16LE(channels);
      writer.writeU32LE(sampleRate);
      writer.writeU32LE(sampleRate * channels * (bitsPerSample >>> 3));
      writer.writeU16LE(channels * (bitsPerSample >>> 3));
      writer.writeU16LE(bitsPerSample);
      if (!extensible && (formatTag === 3 || formatTag === 6 || formatTag === 7)) writer.writeU16LE(0);
      if (extensible) {
        writer.writeU16LE(22);
        writer.writeU16LE(bitsPerSample);
        writer.writeU32LE(channelMask ?? (channels === 1 ? 4 : channels === 2 ? 3 : 0));
        writer.writeU32LE(formatTag);
        writer.writeBytes(Uint8Array.of(0, 0, 0x10, 0, 0x80, 0, 0, 0xaa, 0, 0x38, 0x9b, 0x71));
      }
    }
    if (fmtPadding) writer.writeBytes(new Uint8Array(fmtPadding));
    if (factBytes) {
      chunk("fact", factBytes.length);
      writer.writeBytes(factBytes);
      if (pad(factBytes.length)) writer.writeBytes(new Uint8Array(pad(factBytes.length)));
    }
  }
  if (infoSize) {
    chunk("LIST", infoSize);
    writer.writeFourCC("INFO");
    for (const { id, bytes } of info) {
      chunk(id, bytes.length);
      writer.writeBytes(bytes);
      if (pad(bytes.length)) writer.writeBytes(new Uint8Array(pad(bytes.length)));
    }
  }
  if (bextSize) {
    chunk("bext", bextSize);
    const bext = new Uint8Array(602);
    for (const [key, offset, length] of [
      ["description", 0, 256], ["originator", 256, 32], ["originator_reference", 288, 32],
      ["origination_date", 320, 10], ["origination_time", 330, 8]
    ] as const) {
      const value = key === "description" ? tags.description : tags.custom?.[key];
      if (value !== undefined) new TextEncoder().encodeInto(value, bext.subarray(offset, offset + length));
    }
    const view = new DataView(bext.buffer);
    view.setBigUint64(338, BigInt(tags.custom?.time_reference || "0"), true);
    view.setUint16(346, 1, true);
    writer.writeBytes(bext);
    writer.writeBytes(history);
    if (pad(bextSize)) writer.writeBytes(new Uint8Array(pad(bextSize)));
  }
  if (!peakOnly) {
    // Native FFmpeg counts Wave64 alignment bytes as part of the data payload.
    chunk("data", rf64 || (!wave64 && options.seekable === false) ? 0xffffffff : pcmBytes.byteLength + (wave64 ? padding : 0));
    writer.writeBytes(pcmBytes);
    if (padding) writer.writeBytes(new Uint8Array(padding));
  }
  if (peakSize) {
    chunk("levl", peakSize);
    for (const value of [1, peakFormat, peakPpv, peakBlockSize, channels, peakFrames, 0xffffffff, 128]) writer.writeU32LE(value);
    const timestamp = new Uint8Array(28);
    const now = new Date();
    timestamp.set(new TextEncoder().encode([
      now.getFullYear(), now.getMonth() + 1, now.getDate(), now.getHours(), now.getMinutes(), now.getSeconds()
    ].map((value, index) => String(value).padStart(index === 0 ? 4 : 2, "0")).join(":") + ":" + String(now.getMilliseconds()).padStart(3, "0")));
    writer.writeBytes(timestamp);
    writer.writeBytes(new Uint8Array(60));
    const pcm = new DataView(pcmBytes.buffer, pcmBytes.byteOffset, pcmBytes.byteLength);
    for (let block = 0; block < peakFrames; block++) {
      for (let channel = 0; channel < channels; channel++) {
        let positive = 0, negative = 0;
        for (let frame = block * peakBlockSize; frame < Math.min(frames, (block + 1) * peakBlockSize); frame++) {
          const sample = pcm.getInt16((frame * channels + channel) * 2, true);
          positive = Math.max(positive, sample);
          negative = Math.min(negative, sample);
        }
        if (peakPpv === 1) positive = Math.max(positive, negative === -32768 ? -32768 : -negative);
        if (peakFormat === 1) {
          writer.writeU8(positive >>> 8);
          if (peakPpv === 2) writer.writeU8(-negative >>> 8);
        } else {
          writer.writeU16LE(positive);
          if (peakPpv === 2) writer.writeU16LE(-negative);
        }
      }
    }
    if (pad(peakSize)) writer.writeBytes(new Uint8Array(pad(peakSize)));
  }
  return writer.toUint8Array();
}

/** Metadata-only WAV probing without payload or per-packet allocation. */
function wavMetadata(header: WavHeader, filename = "input.wav", seekable = true): MediaProbeResult {
  if (header.channels === 0) throw new Error("Decoder requires channel layout to be set");
  const doc = wavDocument(header, [], seekable);
  const result = buildProbeResultFromDoc(doc, header.byteLength, filename, {
    formatName: header.containerFormat, formatLongName: header.containerFormat === "w64" ? "Sony Wave64" : "WAV / WAVE (Waveform Audio)"
  });
  return { ...result, streams: [{ ...result.streams[0]!,
    bit_rate: doc.durationSeconds > 0
      ? String(Math.round(header.dataSize * 8 / doc.durationSeconds)) : "0"
  }, ...result.streams.slice(1)] };
}

function wavRecords(header: WavHeader, options: MediaSourceProbeOptions): MediaProbeRecords {
  let metadata = wavMetadata(header, options.filename, options.seekable);
  const stream = metadata.streams[0]!;
  const bytesPerFrame = header.formatTag === 0x45 ? header.bitsPerSample / 8 : header.formatTag === 32 ? header.channels / 2 : Math.max(1, header.bitsPerSample ? header.channels * (header.bitsPerSample >>> 3) : header.blockAlign);
  const samples = header.formatTag === 17 && !options.showFrames ? 0 : wavFrames(header), rate = Math.max(1, header.sampleRate);
  const chunkFrames = header.formatTag === 0x45 ? Math.max(8, Math.floor(wavPacketFrames(header.sampleRate, bytesPerFrame, options.maxSize) / 8) * 8) : header.formatTag === 2 ? msBlockFrames(header.blockAlign, header.channels) : header.formatTag === 17 ? imaBlockFrames(header.blockAlign, header.channels) : wavPacketFrames(header.sampleRate, bytesPerFrame, options.maxSize);
  if (header.dataChunks && header.dataChunks.length > 1) {
    const count = String(header.dataChunks.reduce((sum, chunk) => sum + Math.ceil(chunk.size / (chunkFrames * bytesPerFrame)), 0));
    metadata = { ...metadata, streams: [{ ...stream, nb_read_packets: count, nb_read_frames: count }, ...metadata.streams.slice(1)] };
  }
  function* spans() {
    let chunkStart = 0;
    for (const chunk of header.dataChunks ?? [{ offset: header.dataOffset, size: header.dataSize }]) {
      const chunkSamples = header.dataChunks ? wavFrames({ ...header, dataSize: chunk.size }) : samples;
      for (let pts = 0; (header.formatTag === 2 || header.formatTag === 17 ? pts < chunkSamples : pts * bytesPerFrame < chunk.size); pts += chunkFrames) {
        options.signal?.throwIfAborted();
        const count = Math.min(chunkFrames, chunkSamples - pts);
        const pos = header.formatTag === 2 || header.formatTag === 17 ? pts / chunkFrames * header.blockAlign : pts * bytesPerFrame;
        const size = header.formatTag === 2 || header.formatTag === 17 ? Math.min(header.blockAlign, chunk.size - pos) : Math.min(chunkFrames * bytesPerFrame, chunk.size - pos);
        yield { pts: chunkStart + pts, count, pos: chunk.offset + pos, size: String(size), time: ((chunkStart + pts) / rate).toFixed(6), duration: (count / rate).toFixed(6) };
      }
      chunkStart += chunkSamples;
    }
    options.signal?.throwIfAborted();
  }
  return { ...metadata,
    packets: options.showPackets ? { *[Symbol.iterator]() {
      if (header.formatTag === 17) {
        // Demux packets retain incomplete blocks; only complete blocks contribute duration.
        const packetSize = Math.max(1, Math.floor((options.maxSize ?? 4096) / header.blockAlign)) * header.blockAlign;
        let pts = 0;
        for (let offset = 0; offset < header.dataSize; offset += packetSize) {
          options.signal?.throwIfAborted();
          const size = Math.min(packetSize, header.dataSize - offset);
          const duration = Math.floor(size / header.blockAlign) * chunkFrames;
          const time = (pts / rate).toFixed(6);
          yield { codec_type: "audio" as const, stream_index: 0, pts, pts_time: time,
            dts: pts, dts_time: time, duration: duration || undefined,
            duration_time: duration ? (duration / rate).toFixed(6) : undefined,
            size: String(size), pos: String(header.dataOffset + offset), flags: "K__" };
          pts += duration;
        }
        return;
      }
      for (const s of spans()) yield { codec_type: "audio" as const, stream_index: 0, pts: s.pts, pts_time: s.time,
        dts: s.pts, dts_time: s.time, duration: header.bitsPerSample ? s.count : undefined, duration_time: header.bitsPerSample ? s.duration : undefined, size: s.size,
        pos: String(s.pos), flags: "K__" };
    } } : undefined,
    frames: options.showFrames ? { *[Symbol.iterator]() {
      for (const s of spans()) yield { media_type: "audio" as const, stream_index: 0, key_frame: 1,
        pts: s.pts, pts_time: s.time, pkt_dts: s.pts, pkt_dts_time: s.time,
        best_effort_timestamp: s.pts, best_effort_timestamp_time: s.time, pkt_duration: s.count,
        pkt_duration_time: s.duration, duration: s.count, duration_time: s.duration, pkt_size: s.size, pkt_pos: String(s.pos), width: undefined, height: undefined,
        pix_fmt: undefined, pict_type: undefined, sample_fmt: stream.sample_fmt, nb_samples: s.count, channels: header.channels };
    } } : undefined
  };
}

type WavMetadataOnlyOptions = MediaSourceProbeOptions & { showPackets?: false; showFrames?: false };

/** Reads only RIFF headers through caller-owned ranges; never closes the source.
 * Requested packet/frame descriptors are lazy and remain valid after source closure.
 */
export function probeWavSource(source: MediaProbeSource, options?: WavMetadataOnlyOptions): Promise<MediaProbeResult>;
export function probeWavSource(source: MediaProbeSource, options: MediaSourceProbeOptions): Promise<MediaProbeRecords>;
export async function probeWavSource(source: MediaProbeSource, options: MediaSourceProbeOptions = {}): Promise<MediaProbeRecords> {
  return wavRecords(await readWavSourceHeader(source, options.signal, options.ignoreLength, options.seekable), options);
}

/** Consumes sequential borrowed chunks through EOF without retaining sample payloads. */
export function probeWavStream(source: AsyncIterable<Uint8Array>, options?: WavMetadataOnlyOptions): Promise<MediaProbeResult>;
export function probeWavStream(source: AsyncIterable<Uint8Array>, options: MediaSourceProbeOptions): Promise<MediaProbeRecords>;
export async function probeWavStream(source: AsyncIterable<Uint8Array>, options: MediaSourceProbeOptions = {}): Promise<MediaProbeRecords> {
  return wavRecords(await readWavStreamHeader(source, options.signal, options.ignoreLength, options.seekable), { ...options, seekable: options.seekable ?? false });
}

export function wavAst(format: "wav" | "w64" = "wav"): MediaAstPlugin {
  const wave64 = format === "w64";
  return {
    probeMetadata: probeWavSource,
    probeMetadataStream: probeWavStream,
    id: format,
    formatName: format,
    formatLongName: wave64 ? "Sony Wave64" : "WAV / WAVE (Waveform Audio)",
    extensions: wave64 ? ["w64"] : ["wav", "wave"],
    mimeTypes: wave64 ? ["audio/x-w64"] : ["audio/wav", "audio/x-wav"],
    canDemux: true,
    canMux: true,
    supportedVideoCodecs: [],
    supportedAudioCodecs: ["g726", "pcm_s16le", "adpcm_ima_wav", "adpcm_ms", "adpcm_yamaha", "pcm_u8", "pcm_s24le", "pcm_s32le", "pcm_f32le", "pcm_s64le", "pcm_f64le", "pcm_mulaw", "pcm_alaw"],
    detect(bytes, filename) {
      if (wave64) return isWave64Signature(bytes);
      if (isWavSignature(bytes)) return true;
      if (filename && filename.toLowerCase().endsWith(".wav")) return isWavSignature(bytes);
      return false;
    },
    parse(bytes, options) {
      return parseWav(bytes, options);
    },
    serialize(doc, options) {
      return serializeWav(doc, options, format);
    },
    probe(bytes, options) {
      const header = readWavHeader(bytes, options?.ignoreLength, options?.seekable);
      if (header.formatTag === 17 || header.dataChunks && header.dataChunks.length > 1) {
        const records = wavRecords(header, options ?? {});
        return { ...records, packets: records.packets ? Array.from(records.packets) : undefined,
          frames: records.frames ? Array.from(records.frames) : undefined };
      }
      const metadata = wavMetadata(header, options?.filename, options?.seekable);
      if (!options?.showPackets && !options?.showFrames) return metadata;
      const doc = parseWav(bytes, { ...options, decodeAudio: false });
      return buildProbeResultFromDoc(doc, bytes.byteLength, options?.filename ?? "input.wav", {
        ...options,
        formatName: format,
        formatLongName: wave64 ? "Sony Wave64" : "WAV / WAVE (Waveform Audio)"
      });
    },
    concat(docs, options) {
      return concatMp4(docs, options);
    },
    slice(doc, options) {
      return sliceMp4(doc, options);
    }
  };
}

// --- 4. MP3 (.mp3), FLAC (.flac), OGG (.ogg) ---

export function isMp3Signature(bytes: Uint8Array): boolean {
  bytes = bytes.subarray(id3HeaderSize(bytes));
  if (bytes.byteLength < 4) return false;
  return bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0 && (bytes[1]! & 0x06) !== 0x00;
}

function mp3Document(byteLength: number, frames: Mp3Frame[], samples: MediaSample[]): MediaDocument {
  const { sampleRate, channels } = frames[0]!;
  const duration = frames.reduce((sum, frame) => sum + frame.samples * 14112000 / frame.sampleRate, 0);
  return {
    containerFormat: "mp3",
    timescale: 14112000,
    duration,
    durationSeconds: duration / 14112000,
    tracks: [
      {
        id: 1,
        type: "audio",
        handlerType: "soun",
        timescale: 14112000,
        duration,
        language: "und",
        enabled: true,
        codecDescriptions: [
          {
            formatFourCC: ".mp3",
            codecName: "mp3",
            sampleRate,
            channels,
            bitsPerSample: 16
          }
        ],
        samples
      }
    ],
    metadata: {},
    byteLength
  };
}

function mp3Records(size: number, frames: Mp3Frame[], options: MediaSourceProbeOptions): MediaProbeRecords {
  options.signal?.throwIfAborted();
  const doc = mp3Document(size, frames, []);
  const metadata = buildProbeResultFromDoc(doc, size, options.filename ?? "input.mp3", {
    formatName: "mp3", formatLongName: "MP2/3 (MPEG audio layer 2/3)"
  });
  const stream = { ...metadata.streams[0]!, nb_frames: undefined,
    nb_read_packets: String(frames.length),
    nb_read_frames: String(frames.filter(f => f.samples > f.skipSamples + f.discardPadding).length),
    bit_rate: String(Math.round(frames.reduce((sum, f) => sum + f.size, 0) * 8 / doc.durationSeconds)) };
  function* spans() {
    let pts = 0;
    for (const frame of frames) {
      options.signal?.throwIfAborted();
      const duration = frame.samples * 14112000 / frame.sampleRate;
      yield { ...frame, pts, duration, time: (pts / 14112000).toFixed(6), durationTime: (duration / 14112000).toFixed(6) };
      pts += duration;
    }
    options.signal?.throwIfAborted();
  }
  return { ...metadata, streams: [stream],
    packets: options.showPackets ? { *[Symbol.iterator]() {
      for (const s of spans()) yield { codec_type: "audio" as const, stream_index: 0, pts: s.pts, pts_time: s.time,
        dts: s.pts, dts_time: s.time, duration: s.duration, duration_time: s.durationTime, size: String(s.size), pos: String(s.offset), flags: "K__" };
    } } : undefined,
    frames: options.showFrames ? { *[Symbol.iterator]() {
      for (const s of spans()) {
        const samples = s.samples - s.skipSamples - s.discardPadding;
        if (!samples) continue;
        const pts = s.pts + s.skipSamples * 14112000 / s.sampleRate, time = (pts / 14112000).toFixed(6);
        const duration = samples * 14112000 / s.sampleRate;
        yield { media_type: "audio" as const, stream_index: 0, key_frame: 1,
          pts, pts_time: time, pkt_dts: pts, pkt_dts_time: time,
          best_effort_timestamp: pts, best_effort_timestamp_time: time, duration,
          duration_time: (duration / 14112000).toFixed(6), pkt_size: String(s.size),
          sample_fmt: stream.sample_fmt, nb_samples: samples, channels: s.channels };
      }
    } } : undefined
  };
}

const id3PictureTypes = [
  "Other", "32x32 pixels 'file icon' (PNG only)", "Other file icon", "Cover (front)",
  "Cover (back)", "Leaflet page", "Media (e.g. label side of CD)", "Lead artist/lead performer/soloist",
  "Artist/performer", "Conductor", "Band/Orchestra", "Composer", "Lyricist/text writer",
  "Recording Location", "During recording", "During performance", "Movie/video screen capture",
  "A bright coloured fish", "Illustration", "Band/artist logotype", "Publisher/Studio logotype"
];

export function mp3Ast(): MediaAstPlugin {
  return {
    async probeMetadata(source, options = {}) {
      return mp3Records(source.size, await readMp3SourceFrames(source, options.signal), options);
    },
    async probeMetadataStream(source, options = {}) {
      const { frames, size } = await readMp3StreamFrames(source, options.signal);
      return mp3Records(size, frames, options);
    },
    id: "mp3",
    formatName: "mp3",
    formatLongName: "MP2/3 (MPEG audio layer 2/3)",
    extensions: ["mp3"],
    mimeTypes: ["audio/mpeg"],
    canDemux: true,
    canMux: true,
    supportedVideoCodecs: ["png", "mjpeg"],
    supportedAudioCodecs: ["mp3"],
    detect(bytes, filename) {
      if (isMp3Signature(bytes)) return true;
      if (filename && filename.toLowerCase().endsWith(".mp3") && bytes.byteLength >= 4) return true;
      return false;
    },
    parse(bytes) {
      const frames = readMp3Frames(bytes);
      let pts = 0;
      const samples = frames.map(frame => {
        const duration = frame.samples * 14112000 / frame.sampleRate;
        const sample = { data: bytes.subarray(frame.offset, frame.offset + frame.size), dts: pts, pts,
          cts: 0, duration, size: frame.size, isKeyframe: true, sampleDescriptionIndex: 1,
          skipSamples: frame.skipSamples, discardPadding: frame.discardPadding };
        pts += duration;
        return sample;
      });
      const doc = mp3Document(bytes.byteLength, frames, samples);
      const { tags, pictures } = parseAudio(bytes);
      return { ...doc, metadata: tags, tracks: [...doc.tracks, ...pictures.map((picture, index) => ({
        ...image2Ast().parse(picture.data).tracks[0]!,
        id: index + 2,
        disposition: { attached_pic: 1 },
        metadata: { title: picture.description, comment: id3PictureTypes[picture.type] ?? "Other" }
      }))] };
    },
    serialize(doc, options = {}) {
      if (options.audioCodec && !["mp3", "libmp3lame", "copy"].includes(options.audioCodec)) {
        throw new Error(`Codec ${options.audioCodec} not supported in MP3 format`);
      }
      const audioTracks = doc.tracks.filter(track => track.type === "audio");
      const track = audioTracks[0];
      if (audioTracks.length !== 1 || !track) throw new Error("MP3 requires exactly one audio track");
      const codec = track.codecDescriptions[0]?.codecName;
      const tags = Object.fromEntries(Object.entries(options.metadata ?? doc.metadata)
        .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1] !== ""));
      const pictures = doc.tracks.filter(track => track.type === "video").map(track => {
        const codec = track.codecDescriptions[0]?.codecName;
        if (!["png", "mjpeg"].includes(codec ?? "") || track.samples.length !== 1) {
          throw new Error("MP3 cover art requires one PNG or JPEG packet per video stream");
        }
        return { mime: codec === "png" ? "image/png" : "image/jpeg",
          type: Math.max(0, id3PictureTypes.indexOf(track.metadata?.comment ?? "Other")),
          description: track.metadata?.title ?? "", data: track.samples[0]!.data };
      });
      const version = options.id3v2Version ?? 4;
      if (![0, 3, 4].includes(version)) throw new Error("Invalid ID3v2 version");
      const header = version === 0 ? new Uint8Array() : encodeId3(tags, [], pictures, version);
      const trailer = new Uint8Array(options.writeId3v1 ? 128 : 0);
      if (options.writeId3v1) {
        trailer.set([84, 65, 71]);
        for (const [name, offset, length] of [
          ["title", 3, 30], ["artist", 33, 30], ["album", 63, 30],
          ["date", 93, 4], ["comment", 97, 30]
        ] as const) {
          trailer.set(new TextEncoder().encode(tags[name] ?? "").subarray(0, length), offset);
        }
        const track = Number.parseInt(tags.track ?? "0", 10);
        if (track > 0 && track <= 255) { trailer[125] = 0; trailer[126] = track; }
        const genre = Number(tags.genre ?? NaN);
        trailer[127] = Number.isInteger(genre) && genre >= 0 && genre <= 255 ? genre : 255;
      }
      if (options.audioCodec === "copy") {
        if (codec !== "mp3") throw new Error(`Cannot copy ${codec} to MP3`);
        return concatBytes([header, writeMp3Frames(track.samples, options.writeXing), trailer]);
      }
      const audio = track.decodedAudio ?? (codec === "mp3" ? decodeMp3Track(track)
        : codec === "aac" ? decodeAacTrack(doc, track)
          : codec === "vorbis" ? decodeVorbisTrack(track) : undefined);
      if (!audio) throw new Error(`Cannot decode ${codec} for MP3 encoding`);
      return concatBytes([header, encodeMp3(audio, options.writeXing), trailer]);
    },
    probe(bytes, options = {}) {
      const result = mp3Records(bytes.length, readMp3Frames(bytes), options);
      return { ...result, packets: result.packets ? Array.from(result.packets) : undefined,
        frames: result.frames ? Array.from(result.frames) : undefined };
    },
    concat(docs, options) {
      return concatMp4(docs, options);
    },
    slice(doc, options) {
      return sliceMp4(doc, options);
    }
  };
}

/** Shares the resident parser's metadata semantics without retaining encoded audio. */
function flacDocument(bytes: Uint8Array, byteLength: number, data: Uint8Array = new Uint8Array()): MediaDocument {
  let sampleRate = 44100;
  let channels = 2;
  let totalSamples = 44100;
  if (bytes.byteLength >= 42 && decodeFourCC(bytes, 0) === "fLaC") {
    // STREAMINFO block starts at byte 8 (18 bytes header)
    const b18 = bytes[18]!;
    const b19 = bytes[19]!;
    const b20 = bytes[20]!;
    sampleRate = ((b18 << 12) | (b19 << 4) | (b20 >>> 4)) || 44100;
    channels = (((b20 >>> 1) & 0x07) + 1) || 2;
    const b21 = bytes[21]!;
    const view = new DataView(bytes.buffer, bytes.byteOffset + 22, 4);
    totalSamples = ((b21 & 0x0f) * 4294967296 + view.getUint32(0, false)) || 44100;
  }
  return {
    containerFormat: "flac",
    timescale: sampleRate,
    duration: totalSamples,
    durationSeconds: totalSamples / sampleRate,
    tracks: [
      {
        id: 1,
        type: "audio",
        handlerType: "soun",
        timescale: sampleRate,
        duration: totalSamples,
        language: "und",
        enabled: true,
        codecDescriptions: [
          {
            formatFourCC: "fLaC",
            codecName: "flac",
            sampleRate,
            channels,
            bitsPerSample: 16
          }
        ],
        samples: [
          {
            data,
            dts: 0,
            pts: 0,
            cts: 0,
            duration: totalSamples,
            size: byteLength,
            isKeyframe: true,
            sampleDescriptionIndex: 1
          }
        ]
      }
    ],
    metadata: {},
    byteLength
  };
}

function flacProbe(scanner: FlacFrameScanner, options: MediaSourceProbeOptions = {}): MediaProbeResult {
  const doc = flacDocument(scanner.header.subarray(0, Math.min(42, scanner.size)), scanner.size);
  const samples = scanner.packets.map(packet => ({ ...packet, dts: packet.pts, cts: 0,
    data: new Uint8Array(), isKeyframe: true, sampleDescriptionIndex: 1 }));
  const tracks: MediaTrack[] = [{ ...doc.tracks[0]!, samples }];
  if (scanner.pictureBlocks.length) {
    const header = scanner.header.slice();
    header[4] = 0;
    const bytes = concatBytes([header, ...scanner.pictureBlocks]);
    bytes[bytes.length - scanner.pictureBlocks.at(-1)!.length]! |= 128;
    for (const picture of parseAudio(bytes).pictures) tracks.push({
      ...image2Ast().parse(picture.data).tracks[0]!,
      id: tracks.length + 1,
      disposition: { attached_pic: 1 },
      metadata: { title: picture.description, comment: id3PictureTypes[picture.type] ?? "Other" }
    });
  }
  const result = buildProbeResultFromDoc({ ...doc, tracks, chapters: scanner.chapters(doc.timescale) }, scanner.size,
    options.filename ?? "input.flac", { ...options, formatName: "flac", formatLongName: "raw FLAC" });
  return { ...result, format: { ...result.format, tags: scanner.tags },
    streams: result.streams.map(stream => stream.index === 0 ? { ...stream, nb_frames: undefined,
      ...(scanner.hasReplayGain ? { side_data_list: [{ side_data_type: "Replay Gain" }] } : {}),
      nb_read_packets: String(samples.length), nb_read_frames: String(samples.length) } : stream),
    packets: result.packets?.map((packet, index) => packet.stream_index === 0
      ? { ...packet, pos: String(scanner.packets[index]!.pos) } : packet) };
}

export function flacAst(): MediaAstPlugin {
  return {
    async probeMetadata(source, options = {}) {
      options.signal?.throwIfAborted();
      if (!Number.isSafeInteger(source.size) || source.size < 0) throw new RangeError("Invalid FLAC source size");
      const scanner = new FlacFrameScanner();
      while (scanner.size < source.size) {
        const length = Math.min(16384, source.size - scanner.size);
        const chunk = await source.read(scanner.size, length);
        options.signal?.throwIfAborted();
        if (!chunk.length) throw new Error("Unexpected end of FLAC source");
        if (chunk.length > length) throw new Error("FLAC source returned more bytes than requested");
        scanner.push(chunk);
      }
      scanner.push(new Uint8Array(), true);
      return flacProbe(scanner, options);
    },
    async probeMetadataStream(source, options = {}) {
      options.signal?.throwIfAborted();
      const scanner = new FlacFrameScanner();
      for await (const chunk of source) {
        options.signal?.throwIfAborted();
        scanner.push(chunk);
        if (!Number.isSafeInteger(scanner.size)) throw new RangeError("Invalid FLAC source size");
      }
      options.signal?.throwIfAborted();
      scanner.push(new Uint8Array(), true);
      return flacProbe(scanner, options);
    },
    id: "flac",
    formatName: "flac",
    formatLongName: "raw FLAC",
    extensions: ["flac"],
    mimeTypes: ["audio/flac"],
    canDemux: true,
    canMux: true,
    supportedVideoCodecs: ["png", "mjpeg"],
    supportedAudioCodecs: ["flac"],
    detect(bytes) {
      const offset = id3HeaderSize(bytes);
      return bytes.length >= offset + 4 && decodeFourCC(bytes, offset) === "fLaC";
    },
    parse(bytes, options = {}) {
      const budget = options.budget ?? new MediaBudgetTracker(options.limits);
      budget.checkInputBytes(bytes.length);
      const parsed = parseAudio(bytes);
      const stream = parsed.streams[0]!;
      const scanner = new FlacFrameScanner();
      scanner.push(bytes, true);
      const prefix = id3HeaderSize(bytes);
      const doc = flacDocument(bytes.subarray(prefix), bytes.byteLength);
      const blocks: Uint8Array[] = [bytes.subarray(prefix, prefix + 4)];
      let offset = prefix + 4;
      for (;;) {
        const type = bytes[offset]! & 127;
        const size = bytes[offset + 1]! * 65536 + bytes[offset + 2]! * 256 + bytes[offset + 3]!;
        const block = Uint8Array.from(bytes.subarray(offset, offset + 4 + size));
        // FFmpeg does not carry application data, seek tables or cue sheets into remuxed FLAC.
        if (type !== 2 && type !== 3 && type !== 5) { block[0] = type; blocks.push(block); }
        const last = bytes[offset]! & 128;
        offset += 4 + size;
        if (last) break;
      }
      blocks[blocks.length - 1]![0]! |= 128;
      const samples = scanner.packets.map(packet => ({
        data: bytes.subarray(packet.pos, packet.pos + packet.size),
        dts: packet.pts, pts: packet.pts, cts: 0, duration: packet.duration,
        size: packet.size, isKeyframe: true, sampleDescriptionIndex: 1
      }));
      const duration = samples.reduce((sum, sample) => sum + sample.duration, 0);
      budget.checkStreams(1 + parsed.pictures.length);
      budget.checkSamples(samples.length);
      budget.checkDuration(duration / doc.timescale);
      const track = { ...doc.tracks[0]!, duration, samples,
        codecDescriptions: [{ ...doc.tracks[0]!.codecDescriptions[0]!,
          bitsPerSample: stream.bitsPerSample, extraData: concatBytes(blocks) }] };
      const metadata: MediaDocument["metadata"] = { custom: {} };
      const tags = flacFormatTags(parsed.nodes);
      flacChapters(tags, stream.duration);
      for (const [key, value] of Object.entries(tags)) {
        if (["title", "artist", "album", "date", "comment", "genre", "encoder"].includes(key)) {
          Object.assign(metadata, { [key]: value });
        } else Object.defineProperty(metadata.custom, key, { value, enumerable: true, configurable: true });
      }
      return { ...doc, metadata, chapters: scanner.chapters(doc.timescale), duration, durationSeconds: duration / track.timescale,
        tracks: [{ ...track, ...(options.decodeAudio === false ? {} : { decodedAudio: decodeFlac(track, { ...options, budget }) }) },
          ...parsed.pictures.map((picture, index) => ({
            ...image2Ast().parse(picture.data).tracks[0]!,
            id: index + 2,
            disposition: { attached_pic: 1 },
            metadata: { title: picture.description, comment: id3PictureTypes[picture.type] ?? "Other" }
          }))] };
    },
    serialize(doc, options) {
      if (doc.tracks.filter(track => track.type === "audio").length !== 1 ||
          (options?.audioCodec !== undefined && options.audioCodec !== "flac" && options.audioCodec !== "copy")) {
        throw new Error("Exactly one FLAC audio stream is required");
      }
      const packets = encodeFlacPackets(doc, options?.audioCodec === "copy", options?.compressionLevel, options?.sampleFormat, options?.frameSize, options?.lpcType, options?.channelMode, options?.lpcPasses, options?.budget ?? new MediaBudgetTracker(options?.limits), options?.lpcCoeffPrecision, options?.multiDimQuant, options?.minPredictionOrder, options?.maxPredictionOrder, options?.predictionOrderMethod, options?.minPartitionOrder, options?.maxPartitionOrder, options?.exactRiceParameters);
      if (options?.writeHeader === false) return concatBytes(packets.slice(1));
      const bytes = concatBytes(packets);
      const metadata = options?.metadata ?? doc.metadata;
      const tags = Object.fromEntries(Object.entries({ ...metadata.custom, ...metadata })
        .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1] !== "")
        .map(([key, value]) => [key === "album_artist" ? "albumArtist" : metadata.keySpellings?.[key] ?? key, value]));
      const parsed = parseAudio(bytes);
      const pictures = doc.tracks.filter(track => track.type === "video" && track.disposition?.attached_pic === 1).map(track => {
        const codec = track.codecDescriptions[0]?.codecName;
        if (!["png", "mjpeg"].includes(codec ?? "") || track.samples.length !== 1) {
          throw new Error("FLAC cover art requires one PNG or JPEG packet per video stream");
        }
        const data = track.samples[0]!.data;
        const original = parsed.pictures.find(picture => picture.data.length === data.length &&
          picture.data.every((byte, index) => byte === data[index]));
        return { ...original, mime: codec === "png" ? "image/png" : "image/jpeg",
          type: Math.max(0, id3PictureTypes.indexOf(track.metadata?.comment ?? "Other")),
          description: track.metadata?.title ?? "", data, width: track.width ?? 0, height: track.height ?? 0 };
      });
      const output = Object.keys(tags).length === 0 && !parsed.nodes.some(node => node.type === "VORBIS_COMMENT") &&
        parsed.pictures.length === 0 && pictures.length === 0
        ? bytes : writeAudioMetadata({ ...parsed, tags: {} }, tags, { pictures });
      const padding = options?.metadataHeaderPadding;
      if (padding === undefined) return output;
      if (!Number.isInteger(padding) || padding < -1 || padding > 2147483647) {
        throw new Error("Invalid metadata_header_padding: expected an integer from -1 to 2147483647");
      }
      const size = padding < 0 ? 8192 : Math.min(padding, 0xffffff);
      const nodes = parseAudio(output).nodes;
      const blocks = nodes.filter(node => node.type !== "FRAMES" && node.type !== "PADDING")
        .map(node => output.slice(node.offset, node.offset + node.size));
      const budget = options?.budget ?? new MediaBudgetTracker(options?.limits);
      budget.allocateMemory(size + 4);
      if (size > 0) {
        const block = new Uint8Array(size + 4);
        block.set([1, size >>> 16, (size >>> 8) & 255, size & 255]);
        blocks.push(block);
      }
      for (const [index, block] of blocks.entries()) block[0] = (block[0]! & 127) | (index === blocks.length - 1 ? 128 : 0);
      const parts = [output.subarray(0, 4), ...blocks, ...nodes.filter(node => node.type === "FRAMES").map(node => node.data)];
      const length = parts.reduce((sum, part) => sum + part.length, 0);
      budget.checkOutputBytes(length);
      budget.allocateMemory(length);
      return concatBytes(parts);
    },
    probe(bytes, options) {
      const scanner = new FlacFrameScanner();
      scanner.push(bytes, true);
      return flacProbe(scanner, options);
    },
    concat(docs, options) {
      return concatMp4(docs, options);
    },
    slice(doc, options) {
      return sliceMp4(doc, options);
    }
  };
}

function oggDocument(stream: AudioStream, size: number, data: Uint8Array = new Uint8Array()): MediaDocument {
      const { sampleRate, channels, samples: totalSamples, codec } = stream;
      return {
        containerFormat: "ogg",
        timescale: sampleRate,
        duration: totalSamples,
        durationSeconds: stream.duration,
        tracks: [
          {
            id: 1,
            type: "audio",
            handlerType: "soun",
            timescale: sampleRate,
            duration: totalSamples,
            language: "und",
            enabled: true,
            codecDescriptions: [
              {
                formatFourCC: codec === "opus" ? "Opus" : "vorb",
                codecName: codec,
                sampleRate,
                channels,
                bitsPerSample: 16
              }
            ],
            samples: [
              {
                data,
                dts: 0,
                pts: 0,
                cts: 0,
                duration: totalSamples,
                size: size,
                isKeyframe: true,
                sampleDescriptionIndex: 1
              }
            ]
          }
        ],
        metadata: {},
        byteLength: size
      };
}

/** Format a validated Ogg audio stream without materializing its sample payload. */
export function probeOggStreamMetadata(stream: AudioStream, size: number, options: MediaSourceProbeOptions = {}): MediaProbeRecords {
  return buildProbeResultFromDoc(oggDocument(stream, size), size, options.filename ?? "input.ogg", { ...options, formatName: "ogg", formatLongName: "Ogg" });
}

/** Bounded FLAC-mapped Ogg probe; undefined admits the other Ogg codecs. */
export async function probeOggFlacSource(source: MediaProbeSource, options: MediaSourceProbeOptions & { checkpoint?: () => void | Promise<void> } = {}): Promise<MediaProbeRecords | undefined> {
  const metadata = await readOggFlacHeader(source, options);
  if (!metadata) return undefined;
  const doc = { ...flacDocument(metadata.header, metadata.size), containerFormat: "ogg", byteLength: source.size };
  return buildProbeResultFromDoc(doc, source.size, options.filename ?? "input.ogg", { ...options, formatName: "ogg", formatLongName: "Ogg" });
}

export function oggAst(): MediaAstPlugin {
  return {
    id: "ogg",
    formatName: "ogg",
    formatLongName: "Ogg",
    extensions: ["ogg", "oga", "ogv", "opus"],
    mimeTypes: ["audio/ogg", "video/ogg"],
    canDemux: true,
    canMux: true,
    supportedVideoCodecs: ["theora", "vp8"],
    supportedAudioCodecs: ["opus", "vorbis", "flac"],
    detect(bytes, filename) {
      if (bytes.byteLength >= 4 && decodeFourCC(bytes, 0) === "OggS") return true;
      if (filename && /\.(ogg|oga|ogv|opus)$/i.test(filename) && bytes.byteLength >= 4) {
        return decodeFourCC(bytes, 0) === "OggS";
      }
      return false;
    },
    parse(bytes, options = {}) {
      const flac = extractOggFlac(bytes);
      if (flac) return { ...flacDocument(flac, flac.byteLength, flac), containerFormat: "ogg", byteLength: bytes.length };

      const parsed = parseAudio(bytes);
      const stream = parsed.streams[0];
      if (!stream) throw new Error("Ogg input contains no audio stream");
      const doc = { ...oggDocument(stream, bytes.byteLength, bytes),
        duration: Math.round(parsed.duration * stream.sampleRate), durationSeconds: parsed.duration,
        metadata: stream.tags ?? parsed.tags };
      return stream.codec === "opus" ? demuxOggOpus(bytes, { ...doc,
        tracks: parsed.streams.map((stream, index) => ({ ...oggDocument(stream, bytes.length).tracks[0]!,
          id: index + 1, metadata: stream.tags }))
      }, options.decodeAudio !== false) : doc;
    },
    serialize: serializeOgg,
    probe(bytes, options) {
      const doc = this.parse(bytes, { ...options, decodeAudio: false });
      return buildProbeResultFromDoc(doc, bytes.byteLength, options?.filename ?? "input.ogg", {
        ...options,
        formatName: "ogg",
        formatLongName: "Ogg"
      });
    },
    concat(docs, options) {
      return concatMp4(docs, options);
    },
    slice(doc, options) {
      return sliceMp4(doc, options);
    }
  };
}

// --- 5. Image / Animated Formats (GIF, PPM, PNG, JPEG, WebP) ---

export function isGifSignature(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38
  );
}

export function isPngSignature(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  );
}

export function isJpegSignature(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

export function isWebpSignature(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= 12 &&
    decodeFourCC(bytes, 0) === "RIFF" &&
    decodeFourCC(bytes, 8) === "WEBP"
  );
}

export function isPpmSignature(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 3 && bytes[0] === 0x50 && (bytes[1] === 0x36 || bytes[1] === 0x33);
}

function makeRgbaImage(width: number, height: number, data: Uint8Array) {
  return {
    width,
    height,
    channels: 4 as const,
    data,
    format: "png" as ImageFormat,
    space: "srgb" as const,
    depth: "uchar" as const,
    density: 72,
    hasAlpha: true
  };
}

/** Split at image-data boundaries; extension blocks belong to the following frame. */
function gifPackets(bytes: Uint8Array): { packets: Uint8Array[]; loop: number | undefined } {
  let loop: number | undefined;
  let at = 13 + ((bytes[10]! & 128) ? 3 * (1 << ((bytes[10]! & 7) + 1)) : 0);
  let start = 0;
  const packets: Uint8Array[] = [];
  while (at < bytes.length) {
    const marker = bytes[at++];
    if (marker === 0x3b) break;
    if (marker === 0x21) {
      const label = bytes[at++];
      if (label === 0xff && bytes[at] === 11) {
        const name = new TextDecoder().decode(bytes.subarray(at + 1, at + 12));
        if ((name === "NETSCAPE2.0" || name === "ANIMEXTS1.0") && bytes[at + 12] === 3 && bytes[at + 13] === 1 && at + 15 < bytes.length) {
          loop = bytes[at + 14]! | (bytes[at + 15]! << 8);
        }
      }
    } else if (marker === 0x2c) {
      if (at + 9 > bytes.length) throw new Error("Truncated GIF image descriptor");
      const flags = bytes[at + 8]!;
      at += 9 + ((flags & 128) ? 3 * (1 << ((flags & 7) + 1)) : 0);
      at++; // LZW minimum code size.
    } else {
      throw new Error("Invalid GIF block");
    }
    while (true) {
      if (at >= bytes.length) throw new Error("Truncated GIF data block");
      const size = bytes[at++]!;
      if (at + size > bytes.length) throw new Error("Truncated GIF data block");
      at += size;
      if (size === 0) break;
    }
    if (marker === 0x2c) {
      packets.push(bytes.subarray(start, at));
      start = at;
    }
  }
  if (packets.length && start < bytes.length) packets[packets.length - 1] = bytes.subarray(start - packets[packets.length - 1]!.length);
  return { packets, loop };
}

function rewriteGifLoop(bytes: Uint8Array, loop: number, finalDelay?: number): Uint8Array {
  let at = 13 + ((bytes[10]! & 128) ? 3 * (1 << ((bytes[10]! & 7) + 1)) : 0);
  const parts = [bytes.subarray(0, at)];
  let controlIndex = -1, lastControlIndex = -1, lastImageIndex = -1;
  if (loop !== -1) {
    parts.push(Uint8Array.from([0x21, 0xff, 11, ...new TextEncoder().encode("NETSCAPE2.0"), 3, 1, loop & 255, loop >> 8, 0]));
  }
  while (at < bytes.length) {
    const start = at;
    const marker = bytes[at++];
    if (marker === 0x3b) { parts.push(bytes.subarray(start)); break; }
    let loopExtension = false;
    if (marker === 0x21) {
      const label = bytes[at++];
      if (label === 0xf9) controlIndex = parts.length;
      const name = new TextDecoder().decode(bytes.subarray(at + 1, at + 12));
      loopExtension = label === 0xff && bytes[at] === 11 && (name === "NETSCAPE2.0" || name === "ANIMEXTS1.0");
    } else if (marker === 0x2c) {
      lastControlIndex = controlIndex;
      lastImageIndex = parts.length;
      controlIndex = -1;
      if (at + 9 > bytes.length) throw new Error("Truncated GIF image descriptor");
      const flags = bytes[at + 8]!;
      at += 10 + ((flags & 128) ? 3 * (1 << ((flags & 7) + 1)) : 0);
    } else throw new Error("Invalid GIF block");
    while (true) {
      if (at >= bytes.length) throw new Error("Truncated GIF data block");
      const size = bytes[at++]!;
      if (at + size > bytes.length) throw new Error("Truncated GIF data block");
      at += size;
      if (size === 0) break;
    }
    if (!loopExtension) parts.push(bytes.subarray(start, at));
  }
  if (finalDelay !== undefined && finalDelay >= 0 && lastImageIndex >= 0) {
    if (lastControlIndex >= 0) {
      const control = parts[lastControlIndex]!.slice();
      control[4] = finalDelay & 255;
      control[5] = finalDelay >> 8;
      parts[lastControlIndex] = control;
    } else {
      parts.splice(lastImageIndex, 0, Uint8Array.from([0x21, 0xf9, 4, 0, finalDelay & 255, finalDelay >> 8, 0, 0]));
    }
  }
  const output = concatBytes(parts);
  if (loop !== -1 || (finalDelay !== undefined && finalDelay >= 0)) output.set(new TextEncoder().encode("GIF89a"));
  return output;
}

export function gifAst(): MediaAstPlugin {
  return {
    id: "gif",
    formatName: "gif",
    formatLongName: "CompuServe Graphics Interchange Format (GIF)",
    extensions: ["gif"],
    mimeTypes: ["image/gif"],
    canDemux: true,
    canMux: true,
    supportedVideoCodecs: ["gif"],
    supportedAudioCodecs: [],
    detect(bytes, filename) {
      if (isGifSignature(bytes)) return true;
      if (filename && filename.toLowerCase().endsWith(".gif") && bytes.byteLength >= 6) return true;
      return false;
    },
    parse(bytes) {
      const image = decodeImage(bytes, { animated: true });
      const width = image.width, height = image.pageHeight ?? image.height;
      const frameSize = width * height * 4;
      const frames: MediaVideoFrame[] = [];
      const samples: MediaSample[] = [];
      const { packets, loop } = gifPackets(bytes);
      let duration = 0;
      for (let index = 0; index < (image.pages ?? 1); index++) {
        // GIF time is in centiseconds. Keep each frame's own presentation time.
        const ticks = Math.round((image.delay?.[index] ?? 100) / 10);
        frames.push({ width, height, data: image.data.subarray(index * frameSize, (index + 1) * frameSize),
          ptsSeconds: duration / 100, durationSeconds: ticks / 100, keyframe: true });
        const packet = packets[index]!;
        samples.push({ data: packet, dts: duration, pts: duration, cts: 0,
          duration: ticks, size: packet.byteLength, isKeyframe: index === 0, sampleDescriptionIndex: 1 });
        duration += ticks;
      }
      return {
        containerFormat: "gif", timescale: 100, duration, durationSeconds: duration / 100,
        tracks: [{ id: 1, type: "video", handlerType: "vide", timescale: 100, duration,
          language: "und", enabled: true, width, height,
          codecDescriptions: [{ formatFourCC: "gif ", codecName: "gif", width, height, pixFmt: "bgra" }],
          samples, decodedVideoFrames: frames, gifLoop: loop }],
        metadata: {}, byteLength: bytes.byteLength
      };
    },
    serialize(doc, options = {}) {
      const loop = options.gifLoop ?? 0;
      const flags = options.gifFlags ?? 3;
      if (!Number.isInteger(flags) || flags < 0 || flags > 3) throw new Error("Invalid GIF encoder flags");
      if (!Number.isInteger(loop) || loop < -1 || loop > 65535) {
        throw new Error("GIF loop must be an integer from -1 to 65535");
      }
      if (options.videoCodec === "copy") {
        const track = doc.tracks.find(track => track.type === "video");
        if (!track || track.codecDescriptions.some(codec => codec.codecName !== "gif")) {
          throw new Error("GIF stream copy requires GIF packets");
        }
        const packets = track.samples.map(sample => sample.data);
        if (!packets.length || !isGifSignature(packets[0]!)) {
          throw new Error("GIF stream copy requires the initial GIF header");
        }
        if (packets.at(-1)!.at(-1) !== 0x3b) packets.push(Uint8Array.of(0x3b));
        options.budget?.checkOutputBytes(packets.reduce((size, packet) => size + packet.byteLength, 0));
        return rewriteGifLoop(concatBytes(packets), loop, options.finalDelay);
      }
      const { frames, width, height } = extractVideoFramesFromDoc(doc);
      const count = Math.max(1, frames.length), frameSize = width * height * 4;
      const data = new Uint8Array(frameSize * count);
      const delays: number[] = [];
      let elapsed = 0, previousTicks = 0;
      for (let index = 0; index < frames.length; index++) {
        const frame = frames[index]!;
        data.set(frame.data, index * frameSize);
        // Round cumulative time so rates such as 8 fps do not accumulate drift.
        elapsed += frame.durationSeconds;
        const ticks = Math.round(elapsed * 100);
        delays.push((ticks - previousTicks) * 10);
        previousTicks = ticks;
      }
      if (options?.finalDelay !== undefined && options.finalDelay >= 0 && delays.length > 0) {
        delays[delays.length - 1] = options.finalDelay * 10;
      }
      return encodeImage(makeRgbaImage(width, height * count, data), {
        // image-ast counts total plays; FFmpeg counts repeats after the first play.
        format: "gif", globalPalette: options.globalPalette, optimizeFrames: !!(flags & 1), gifTransdiff: !!(flags & 2), pageHeight: height, delay: delays, loop: loop === -1 ? 1 : loop === 0 ? 0 : loop + 1
      }).data;
    },
    probe(bytes, options) {
      const doc = this.parse(bytes, options);
      const result = buildProbeResultFromDoc(doc, bytes.byteLength, options?.filename ?? "input.gif", {
        ...options,
        formatName: "gif",
        formatLongName: "CompuServe Graphics Interchange Format (GIF)"
      });
      const track = doc.tracks[0]!;
      const stream = result.streams[0]!;
      if (track.samples.length > 1) {
        // Native GIF demuxing truncates the mean delay to whole centiseconds.
        const averageDelay = Math.floor(track.duration / track.samples.length);
        const averageDivisor = gcd(track.timescale, averageDelay);
        // The nominal rate uses timestamp intervals, excluding the final delay.
        let interval = 0;
        for (let index = 1; index < track.samples.length; index++) {
          interval = gcd(interval, track.samples[index]!.dts - track.samples[index - 1]!.dts);
        }
        const nominalDivisor = gcd(track.timescale, interval);
        return { ...result, streams: [{ ...stream,
          avg_frame_rate: `${track.timescale / averageDivisor}/${averageDelay / averageDivisor}`,
          r_frame_rate: `${track.timescale / nominalDivisor}/${interval / nominalDivisor}`
        }] };
      }
      return result;
    },
    concat(docs, options) {
      return concatMp4(docs, options);
    },
    slice(doc, options) {
      return sliceMp4(doc, options);
    }
  };
}

function isQoiSignature(bytes: Uint8Array): boolean {
  return bytes[0] === 113 && bytes[1] === 111 && bytes[2] === 105 && bytes[3] === 102;
}

export function image2Ast(): MediaAstPlugin {
  return {
    id: "image2",
    formatName: "image2",
    formatLongName: "image2 sequence",
    extensions: ["png", "jpg", "jpeg", "webp", "bmp", "ppm", "pgm", "tga", "tiff", "tif", "qoi"],
    mimeTypes: ["image/png", "image/jpeg", "image/webp", "image/bmp", "image/x-portable-pixmap"],
    canDemux: true,
    canMux: true,
    supportedVideoCodecs: ["png", "mjpeg", "webp", "bmp", "ppm", "pgm", "qoi"],
    supportedAudioCodecs: [],
    detect(bytes, filename) {
      if (apngAst().detect(bytes)) return false;
      if (isPngSignature(bytes) || isJpegSignature(bytes) || isWebpSignature(bytes) || isPpmSignature(bytes) || isQoiSignature(bytes)) {
        return true;
      }
      if (filename && /\.(png|jpe?g|webp|bmp|pp[gm]|tga|tiff?)$/i.test(filename) && bytes.byteLength >= 4) {
        return true;
      }
      return false;
    },
    parse(bytes, options) {
      let width = 64;
      let height = 64;
      let codecName = "png";
      let rgba: Uint8Array = new Uint8Array(64 * 64 * 4).fill(180);
      const tga = options?.filename?.toLowerCase().endsWith(".tga");
      let pixFmt = "rgb24";
      if (isPngSignature(bytes) && bytes.byteLength >= 29) {
        const depth = bytes[24];
        switch (bytes[25]) {
          case 0: pixFmt = depth === 16 ? "gray16be" : depth === 1 ? "monob" : "gray"; break;
          case 2: pixFmt = depth === 16 ? "rgb48be" : "rgb24"; break;
          case 3: pixFmt = "pal8"; break;
          case 4: pixFmt = depth === 16 ? "ya16be" : "ya8"; break;
          case 6: pixFmt = depth === 16 ? "rgba64be" : "rgba"; break;
        }
      }
      try {
        const img = tga ? decodeTga(bytes, options) : decodeImage(bytes);
        width = img.width;
        height = img.height;
        rgba = img.data;
        codecName = img.format === "jpeg" ? "mjpeg" : img.format;
        if (img.format === "qoi") pixFmt = bytes[12] === 4 ? "rgba" : "rgb24";
      } catch (error) {
        if (tga || isQoiSignature(bytes)) throw error;
        if (isPngSignature(bytes) && bytes.byteLength >= 24) {
          const view = new DataView(bytes.buffer, bytes.byteOffset + 16, 8);
          width = view.getUint32(0, false) || 64;
          height = view.getUint32(4, false) || 64;
          codecName = "png";
        } else if (isJpegSignature(bytes)) {
          codecName = "mjpeg";
        } else if (isWebpSignature(bytes)) {
          codecName = "webp";
        } else if (isPpmSignature(bytes)) {
          codecName = "ppm";
        }
        rgba = new Uint8Array(width * height * 4).fill(180);
      }
      return {
        containerFormat: "image2",
        timescale: 25,
        duration: 1,
        durationSeconds: 0.04,
        tracks: [
          {
            id: 1,
            type: "video",
            handlerType: "vide",
            timescale: 25,
            duration: 1,
            language: "und",
            enabled: true,
            width,
            height,
            codecDescriptions: [
              {
                formatFourCC: codecName.padEnd(4, " ").slice(0, 4),
                codecName,
                width,
                height,
                pixFmt: tga ? (bytes[16] === 32 ? "bgra" : "bgr24") : pixFmt,
                ...(codecName === "qoi" && bytes[13] === 1 ? { colorMetadata: { transfer: 8 } } : {}),
                colorTransfer: codecName === "qoi" && bytes[13] === 1 ? "linear" : undefined
              }
            ],
            samples: [
              {
                data: bytes,
                dts: 0,
                pts: 0,
                cts: 0,
                duration: 1,
                size: bytes.byteLength,
                isKeyframe: true,
                sampleDescriptionIndex: 1
              }
            ],
            decodedVideoFrames: [
              {
                width,
                height,
                data: rgba,
                ptsSeconds: 0,
                durationSeconds: 0.04,
                keyframe: true
              }
            ]
          }
        ],
        metadata: {},
        byteLength: bytes.byteLength
      };
    },
    serialize(doc, options) {
      const { frames, width, height } = extractVideoFramesFromDoc(doc, 1);
      const first = frames[0]?.data ?? new Uint8Array(width * height * 4);
      const fmt = (options?.format?.toLowerCase() ?? "png") as string;
      if (fmt === "tga" || options?.videoCodec === "targa") return encodeTga({ width, height, data: first }, options);
      const imgFmt: ImageFormat =
        fmt === "jpg" || fmt === "jpeg" || fmt === "mjpeg" ? "jpeg" :
        fmt === "qoi" || options?.videoCodec === "qoi" ? "qoi" :
        fmt === "webp" ? "webp" :
        fmt === "gif" ? "gif" :
        fmt === "bmp" ? "bmp" :
        fmt === "tiff" || fmt === "tif" ? "tiff" :
        fmt === "ppm" ? "ppm" : "png";
      const image = makeRgbaImage(width, height, first);
      const codec = doc.tracks.find(track => track.type === "video")?.codecDescriptions[0];
      if (imgFmt === "qoi") image.hasAlpha = !["rgb24", "bgr24", "rgb48be", "gray", "gray8", "gray16be", "monob"].includes(codec?.pixFmt ?? "rgba");
      return encodeImage({ ...image, ...(imgFmt === "qoi" ? {
        magickColorspace: codec?.colorMetadata?.transfer === 8 ? "RGB" : "sRGB"
      } : {}) }, { format: imgFmt }).data;
    },
    probe(bytes, options) {
      const doc = this.parse(bytes, options);
      return buildProbeResultFromDoc(doc, bytes.byteLength, options?.filename ?? "input.png", {
        ...options,
        formatName: "image2",
        formatLongName: "image2 sequence"
      });
    },
    concat(docs, options) {
      return concatMp4(docs, options);
    },
    slice(doc, options) {
      return sliceMp4(doc, options);
    }
  };
}

/**
 * Returns all built-in MediaAstPlugin instances covering the most popular video, audio, and image containers:
 * MP4, MOV, Matroska (MKV), WebM, MPEG-TS, AVI, FLV, YUV4MPEG2 (Y4M), ADTS AAC, WAV, MP3, FLAC, OGG, GIF, and Image2.
 */

// --- 9. SubRip (.srt) & WebVTT (.vtt) Subtitle ASTs ---

function parseSubtitleTimecodeMs(raw: string, format: "srt" | "webvtt"): number {
  if (format === "webvtt") {
    const parts = raw.trim().split(":");
    if (parts.length !== 2 && parts.length !== 3) return NaN;
    const [seconds, fraction] = parts.pop()!.split(".");
    parts.push(seconds ?? "");
    if (parts.some(part => part.length === 0 || !Array.from(part).every(char => char >= "0" && char <= "9"))) return NaN;
    const milliseconds = parseInt(fraction ?? "", 10);
    if (!Number.isFinite(milliseconds)) return NaN;
    return parts.reduce((total, part) => total * 60 + Number(part), 0) * 1000 + milliseconds;
  }
  const clean = raw.trim().replace(",", ".");
  const parts = clean.split(":");
  if (parts.length === 3) {
    const h = parseInt(parts[0] ?? "0", 10) || 0;
    const m = parseInt(parts[1] ?? "0", 10) || 0;
    const [seconds, milliseconds] = (parts[2] ?? "0").split(".");
    return (h * 3600 + m * 60 + (parseInt(seconds ?? "0", 10) || 0)) * 1000
      + (parseInt(milliseconds ?? "0", 10) || 0);
  }
  if (parts.length === 2) {
    const m = parseInt(parts[0] ?? "0", 10) || 0;
    const sec = parseFloat(parts[1] ?? "0") || 0;
    return Math.round((m * 60 + sec) * 1000);
  }
  return Math.round((parseFloat(clean) || 0) * 1000);
}

function formatSubtitleTimecode(ms: number, sep: "," | "."): string {
  const totalMs = Math.max(0, Math.round(ms));
  const h = Math.floor(totalMs / 3600000);
  const m = Math.floor((totalMs % 3600000) / 60000);
  const s = Math.floor((totalMs % 60000) / 1000);
  const milli = totalMs % 1000;
  return (
    (sep === "." && h === 0 ? "" : String(h).padStart(2, "0") + ":") +
    String(m).padStart(2, "0") +
    ":" +
    String(s).padStart(2, "0") +
    sep +
    String(milli).padStart(3, "0")
  );
}

function decodeSubRip(bytes: Uint8Array): string {
  const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? "utf-16le"
    : bytes[0] === 0xfe && bytes[1] === 0xff ? "utf-16be" : "utf-8";
  return new TextDecoder(encoding).decode(bytes).replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}

export function isSrtSignature(bytes: Uint8Array, _filename?: string): boolean {
  if (bytes.byteLength < 15) return false;
  const head = decodeSubRip(bytes.subarray(0, Math.min(256, bytes.byteLength))).trimStart();
  // Native probing requires ordinary spaces; forced demuxing is more permissive.
  if (!head.split("\n")[1]?.includes(" --> ")) return false;
  const [index, timing = ""] = head.split("\n");
  if (!index || ![...index].every(char => char >= "0" && char <= "9")) return false;
  const times = timing.split("-->");
  return times.length === 2 && times.every((time, side) => {
    const parts = time.trim().replace(",", ".").split(":");
    if (parts.length < 3) return false;
    const hour = parts[0]!.startsWith("-") ? parts[0]!.slice(1) : parts[0]!;
    const [second, fraction = ""] = parts[2]!.split(".");
    if (![hour, parts[1]!, second!].every(part => part.length === 2
      && [...part].every(char => char >= "0" && char <= "9"))) return false;
    let digits = 0;
    while (fraction[digits] !== undefined && fraction[digits]! >= "0" && fraction[digits]! <= "9") digits++;
    return digits > 0 && (side === 1 || (parts.length === 3 && digits === fraction.length));
  });
}

export function isWebVttSignature(bytes: Uint8Array, filename?: string): boolean {
  if (filename && /\.(vtt|webvtt)$/i.test(filename)) return true;
  if (bytes.byteLength < 6) return false;
  const head = decodeUtf8(bytes.subarray(0, Math.min(64, bytes.byteLength))).replace(/^\uFEFF/, "").trimStart();
  return head.startsWith("WEBVTT");
}

function subviewerTiming(line: string): [number, number] | undefined {
  const times = line.trim().split(",");
  if (times.length !== 2) return undefined;
  const values: number[] = [];
  for (const time of times) {
    if (time.length !== 11 || time[2] !== ":" || time[5] !== ":" || time[8] !== ".") return undefined;
    const digits = time.slice(0, 2) + time.slice(3, 5) + time.slice(6, 8) + time.slice(9);
    if (![...digits].every(char => char >= "0" && char <= "9")) return undefined;
    values.push((Number(time.slice(0, 2)) * 3600 + Number(time.slice(3, 5)) * 60
      + Number(time.slice(6, 8))) * 1000 + Number(time.slice(9)) * 10);
  }
  return [values[0]!, values[1]!];
}

function splitAdjacentSrtCues(block: string): string[] {
  const lines = block.split("\n");
  const cues: string[] = [];
  let start = 0;
  let hasTiming = false;
  for (let i = 0; i < lines.length; i++) {
    const times = lines[i]!.split("-->");
    if (times.length !== 2 || !times.every(time => {
      const timestamp = time.trim().split(" ")[0]!.split("\t")[0]!;
      const parts = timestamp.replace(",", ".").split(":");
      if (parts.length !== 3) return false;
      if (parts[0]!.startsWith("-") || parts[0]!.startsWith("+")) parts[0] = parts[0]!.slice(1);
      const seconds = parts.pop()!.split(".");
      return seconds.length === 2 && [...parts, ...seconds].every(part =>
        part.length > 0 && [...part].every(char => char >= "0" && char <= "9"));
    })) continue;
    if (hasTiming) {
      const previous = lines[i - 1]!.trim();
      // A numeric line is an index only when immediately followed by timing.
      const end = previous.length > 0 && [...previous].every(char => char >= "0" && char <= "9") ? i - 1 : i;
      cues.push(lines.slice(start, end).join("\n"));
    }
    // Forced demuxing skips preamble until a complete timestamp pair appears.
    start = i;
    hasTiming = true;
  }
  if (hasTiming) cues.push(lines.slice(start).join("\n"));
  return cues;
}

function* webVttBlocks(bytes: Uint8Array): Generator<{ text: string; offset: number }> {
  let cursor = 0;
  while (cursor < bytes.length) {
    while (bytes[cursor] === 10 || bytes[cursor] === 13) cursor++;
    const start = cursor;
    let end = start, lineBreaks = 0, buffered = 0, lastWasCr = false;
    while (cursor < bytes.length) {
      const byte = bytes[cursor++]!;
      if (byte === 0) break;
      if (byte === 10 || byte === 13) {
        if (byte === 10 || lastWasCr) lineBreaks++;
        if (lineBreaks === 2 || ++buffered === 4) break;
        lastWasCr = byte === 13;
      } else {
        end = cursor;
        lineBreaks = buffered = 0;
      }
    }
    if (end === start) break;
    // Native WebVTT records the position after consuming the cue separator,
    // or EOF. Scan source bytes so CRLF, BOM and UTF-8 retain their byte widths.
    yield { text: decodeUtf8(bytes.subarray(start, end)).replaceAll("\r\n", "\n"), offset: cursor };
  }
}

export function parseSubtitleDocument(
  bytes: Uint8Array,
  format: "srt" | "webvtt" | "subviewer",
  kind = "subtitles"
): MediaDocument {
  // Keep SubRip packet bytes intact until the subtitle decoder runs. Demuxing
  // must not turn invalid UTF-8 into valid replacement characters.
  let text: string;
  if (format === "srt") {
    const utf16 = (bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff);
    const payload = utf16 ? encodeUtf8(decodeSubRip(bytes))
      : bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? bytes.subarray(3) : bytes;
    text = Array.from(payload, byte => String.fromCharCode(byte)).join("").replaceAll("\r\n", "\n").replaceAll("\r", "\n");
    // SubRip demuxing stops before the entire line containing the first NUL.
    const nul = text.indexOf("\0");
    if (nul >= 0) text = text.slice(0, text.lastIndexOf("\n", nul) + 1);
  } else {
    text = decodeUtf8(bytes).replace(/^\uFEFF/, "").replaceAll("\r\n", "\n");
  }
  // Native WebVTT demuxing produces no cues when the header is missing.
  // SubRip dialogue continues across blank lines until the next timed cue.
  const blocks = format === "webvtt" ? text.startsWith("WEBVTT") ? webVttBlocks(bytes) : []
    : (format === "srt" ? splitAdjacentSrtCues(text) : text.split(/\n[ \t\n]*\n/))
      .map(text => ({ text, offset: undefined }));
  const samples: MediaSample[] = [];
  const seenCues = new Set<string>();
  let maxEndMs = 0;

  for (const block of blocks) {
    const lines = block.text
      .split("\n")
      .map((l) => format === "subviewer" ? l.trimEnd() : l)
      .filter((l) => l.length > 0);
    if (lines.length === 0) continue;
    if (lines[0]!.startsWith("WEBVTT") || lines[0]!.startsWith("NOTE")) continue;
    if (format === "webvtt" && (lines[0] === "STYLE" || lines[0] === "REGION")) continue;

    let arrowLineIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (format === "webvtt" && i > 1) break;
      if (format === "subviewer" ? subviewerTiming(lines[i]!) !== undefined : lines[i]!.includes("-->")) {
        arrowLineIdx = i;
        break;
      }
    }
    // WebVTT permits only one identifier; malformed cues end demuxing.
    if (format === "webvtt" && arrowLineIdx < 0) break;
    if (arrowLineIdx < 0) continue;
    const timingLine = lines[arrowLineIdx]!;
    const [leftRaw, rightWithSettings] = timingLine.split("-->");
    const rightRaw = (rightWithSettings ?? "").trim().split(/\s+/)[0] ?? "0";
    const subviewerTimes = format === "subviewer" ? subviewerTiming(timingLine) : undefined;
    const startMs = subviewerTimes ? subviewerTimes[0] : parseSubtitleTimecodeMs(leftRaw ?? "0", format === "srt" ? "srt" : "webvtt");
    const parsedEndMs = subviewerTimes ? subviewerTimes[1] : parseSubtitleTimecodeMs(rightRaw, format === "srt" ? "srt" : "webvtt");
    // FFmpeg ends WebVTT demuxing here, preserving only preceding packets.
    if (format === "webvtt" && (!Number.isFinite(startMs) || !Number.isFinite(parsedEndMs))) break;
    const endMs = format === "subviewer" ? Math.max(startMs + 1, parsedEndMs) : parsedEndMs;
    const rawCueLines = lines.slice(arrowLineIdx + 1).join("\n");
    const cueLines = format === "subviewer" ? rawCueLines.replaceAll("[br]", "\n") : rawCueLines;
    const cueText = format === "subviewer" ? cueLines.trim() : cueLines;
    if (!cueText && format !== "webvtt") continue;

    if (format === "srt" || format === "webvtt") {
      const key = JSON.stringify([startMs, endMs, cueText]);
      if (seenCues.has(key)) continue;
      // WebVTT only drops consecutive duplicate packets; side data is ignored.
      if (format === "webvtt") seenCues.clear();
      seenCues.add(key);
    }

    const payload = format === "srt" ? Uint8Array.from(cueText, char => char.charCodeAt(0)) : encodeUtf8(cueText);
    const duration = endMs - startMs;
    if (endMs > maxEndMs) maxEndMs = endMs;

    const position = { x1: -1, x2: -1, y1: -1, y2: -1 };
    if (format === "srt") {
      let settings = (rightWithSettings ?? "").trim().slice(rightRaw.length);
      for (const key of ["x1", "x2", "y1", "y2"] as const) {
        settings = settings.trimStart();
        const prefix = key.toUpperCase() + ":";
        if (!settings.startsWith(prefix)) break;
        const value = settings.slice(prefix.length).trimStart().match(/^[+-]?\d+/)?.[0];
        if (value === undefined) break;
        position[key] = Number(value);
        settings = settings.slice(prefix.length).trimStart().slice(value.length);
      }
    }

    samples.push({
      data: payload,
      ...(position.x1 >= 0 ? { subtitlePosition: position } : {}),
      ...(block.offset !== undefined ? { offset: block.offset, webvtt: {
        identifier: arrowLineIdx > 0 ? lines[arrowLineIdx - 1]! : "",
        settings: (rightWithSettings ?? "").trim().slice(rightRaw.length).trimStart()
      } } : {}),
      dts: startMs,
      pts: startMs,
      cts: 0,
      duration,
      size: payload.byteLength,
      isKeyframe: true,
      sampleDescriptionIndex: 1
    });
  }

  if (format === "srt" || format === "webvtt") {
    samples.sort((a, b) => a.pts - b.pts);
    for (let i = 0; i < samples.length; i++) {
      const sample = samples[i]!;
      const next = samples[i + 1];
      // SubRip and WebVTT infer negative durations from the next cue.
      if (sample.duration < 0 && next) samples[i] = { ...sample, duration: next.pts - sample.pts };
      maxEndMs = Math.max(maxEndMs, sample.pts + samples[i]!.duration);
    }
  }

  const codecName = format === "webvtt" ? "webvtt" : "subrip";
  const formatFourCC = format === "webvtt" ? "wvtt" : "tx3g";

  return {
    containerFormat: format,
    timescale: 1000,
    duration: maxEndMs,
    durationSeconds: maxEndMs / 1000,
    tracks: [
      {
        id: 1,
        type: "subtitle",
        handlerType: "sbtl",
        timescale: 1000,
        duration: maxEndMs,
        language: "und",
        disposition: format === "webvtt" && kind !== "subtitles" ? { [kind]: 1 } : undefined,
        enabled: true,
        codecDescriptions: [
          {
            formatFourCC,
            codecName
          }
        ],
        samples
      }
    ],
    metadata: {},
    byteLength: bytes.byteLength
  };
}

export function serializeSubtitleDocument(
  doc: MediaDocument,
  format: "srt" | "webvtt" | "ttml"
): Uint8Array {
  const subTrack = doc.tracks.find((t) => t.type === "subtitle");
  const ts = subTrack?.timescale || 1000;
  const samples = subTrack?.samples ?? [];
  const lines: (string | Uint8Array)[] = [];

  if (format === "webvtt") {
    lines.push("WEBVTT", "");
  }

  if (format === "ttml") {
    const language = (subTrack?.language ?? "")
      .replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    lines.push(
      '<?xml version="1.0" encoding="UTF-8"?>',
      `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttp="http://www.w3.org/ns/ttml#parameter" xmlns:tts="http://www.w3.org/ns/ttml#styling" xml:lang="${language}" ttp:cellResolution="384 288">`,
      '<head><layout><region xml:id="Default" tts:origin="3% 0%" tts:extent="97% 97%" tts:displayAlign="after" tts:textAlign="center" tts:fontSize="16c" tts:fontFamily="Arial" tts:overflow="visible"/></layout></head>',
      '<body><div>'
    );
  }

  let cueIndex = 1;
  for (const s of samples) {
    const codec = subTrack?.codecDescriptions[s.sampleDescriptionIndex - 1]?.codecName;
    // Text muxers preserve packet bytes, including deliberately unchecked UTF-8.
    const packet = format === "webvtt" || (format === "srt" && codec === "subrip") ? s.data : undefined;
    const text = packet ? "" : decodeUtf8(s.data);
    const cueText = format === "webvtt" || (format === "srt" && codec === "subrip") ? text
      : format === "srt" && codec === "pjs" ? text.trimStart()
      : format === "srt" && (codec === "ass" || doc.containerFormat === "sami")
        ? text.trimStart().replaceAll("\r\n", "\n").replaceAll("\n", "\r\n") : text.trim();
    if (!(packet?.byteLength ?? cueText.length) && format !== "webvtt") continue;
    const startMs = Math.round((s.pts / ts) * 1000);
    const endMs = Math.round(((s.pts + s.duration) / ts) * 1000);
    if (format === "ttml") {
      const text = cueText.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
        .split("\n").join("<br/>");
      const begin = formatSubtitleTimecode(startMs, ",").replace(",", ".");
      const end = formatSubtitleTimecode(endMs, ",").replace(",", ".");
      lines.push(`<p begin="${begin}" end="${end}"><span region="Default">${text}</span></p>`);
      continue;
    }
    const sep = format === "webvtt" ? "." : ",";
    if (format === "srt") {
      lines.push(String(cueIndex));
    }
    const cue = format === "webvtt" ? s.webvtt : undefined;
    if (cue?.identifier) lines.push(cue.identifier);
    const position = format === "srt" ? s.subtitlePosition : undefined;
    const coordinates = position ? "  " + (["x1", "x2", "y1", "y2"] as const).map(key => {
      const value = position[key];
      return `${key.toUpperCase()}:${value < 0 ? "-" + String(-value).padStart(2, "0") : String(value).padStart(3, "0")}`;
    }).join(" ") : "";
    lines.push(`${formatSubtitleTimecode(startMs, sep)} --> ${formatSubtitleTimecode(endMs, sep)}${cue?.settings ? " " + cue.settings : ""}${coordinates}`);
    lines.push(packet ?? cueText, "");
    cueIndex++;
  }

  if (format === "ttml") lines.push("</div></body></tt>");
  if (format === "srt" && lines.length > 0) lines.push("");
  const chunks: Uint8Array[] = [];
  for (const [index, line] of lines.entries()) {
    if (index > 0) chunks.push(Uint8Array.of(10));
    chunks.push(typeof line === "string" ? encodeUtf8(line) : line);
  }
  return concatBytes(chunks);
}

export function ttmlAst(): MediaAstPlugin {
  return {
    id: "ttml",
    formatName: "ttml",
    formatLongName: "TTML subtitle",
    extensions: ["ttml"],
    mimeTypes: ["application/ttml+xml"],
    canDemux: false,
    canMux: true,
    supportedVideoCodecs: [],
    supportedAudioCodecs: [],
    detect() { return false; },
    parse() { throw new Error("TTML input is not supported"); },
    probe() { throw new Error("TTML input is not supported"); },
    serialize(doc) { return serializeSubtitleDocument(doc, "ttml"); }
  };
}

export function srtAst(): MediaAstPlugin {
  return {
    id: "srt",
    formatName: "srt",
    formatLongName: "SubRip subtitle",
    extensions: ["srt"],
    mimeTypes: ["application/x-subrip", "text/srt"],
    canDemux: true,
    canMux: true,
    supportedVideoCodecs: [],
    supportedAudioCodecs: [],
    detect(bytes, filename) {
      return isSrtSignature(bytes, filename);
    },
    parse(bytes) {
      return parseSubtitleDocument(bytes, "srt");
    },
    serialize(doc) {
      return serializeSubtitleDocument(doc, "srt");
    },
    probe(bytes, options) {
      const doc = parseSubtitleDocument(bytes, "srt");
      return buildProbeResultFromDoc(doc, bytes.byteLength, options?.filename ?? "input.srt", {
        ...options,
        formatName: "srt",
        formatLongName: "SubRip subtitle"
      });
    },
    concat(docs, options) {
      return concatMp4(docs, options);
    },
    slice(doc, options) {
      return sliceMp4(doc, options);
    }
  };
}

export function subviewerAst(): MediaAstPlugin {
  return {
    id: "subviewer",
    formatName: "subviewer",
    formatLongName: "SubViewer subtitle",
    extensions: ["sub"],
    mimeTypes: [],
    canDemux: true,
    canMux: false,
    supportedVideoCodecs: [],
    supportedAudioCodecs: [],
    detect(bytes) {
      return decodeUtf8(bytes.subarray(0, 4096)).split("\n").some(line => subviewerTiming(line) !== undefined);
    },
    parse(bytes) {
      return parseSubtitleDocument(bytes, "subviewer");
    },
    serialize() {
      throw new Error("SubViewer output is not supported");
    },
    probe(bytes, options) {
      const doc = parseSubtitleDocument(bytes, "subviewer");
      return buildProbeResultFromDoc(doc, bytes.byteLength, options?.filename ?? "input.sub", {
        ...options,
        formatName: "subviewer",
        formatLongName: "SubViewer subtitle"
      });
    }
  };
}

export function webvttAst(): MediaAstPlugin {
  return {
    id: "webvtt",
    formatName: "webvtt",
    formatLongName: "WebVTT subtitle",
    extensions: ["vtt", "webvtt"],
    mimeTypes: ["text/vtt"],
    canDemux: true,
    canMux: true,
    supportedVideoCodecs: [],
    supportedAudioCodecs: [],
    detect(bytes, filename) {
      return isWebVttSignature(bytes, filename);
    },
    parse(bytes, options) {
      return parseSubtitleDocument(bytes, "webvtt", options?.webvttKind);
    },
    serialize(doc) {
      return serializeSubtitleDocument(doc, "webvtt");
    },
    probe(bytes, options) {
      const doc = parseSubtitleDocument(bytes, "webvtt", options?.webvttKind);
      const probe = buildProbeResultFromDoc(doc, bytes.byteLength, options?.filename ?? "input.vtt", {
        ...options,
        formatName: "webvtt",
        formatLongName: "WebVTT subtitle"
      });
      return { ...probe, packetData: probe.packets && new Map(probe.packets.map((packet, index) =>
        [`${packet.pos}:${packet.size}`, doc.tracks[0]!.samples[index]!.data])) };
    },
    concat(docs, options) {
      return concatMp4(docs, options);
    },
    slice(doc, options) {
      return sliceMp4(doc, options);
    }
  };
}


// --- 10. FFmetadata (;FFMETADATA1) AST ---

function setFfmetadataTag(tags: [string, string][], key: string, value: string): void {
  const index = tags.findIndex(([name]) => name.toLowerCase() === key.toLowerCase());
  if (index >= 0) {
    // AVDictionary fills the removed slot with its last entry before appending.
    tags[index] = tags[tags.length - 1]!;
    tags.pop();
  }
  tags.push([key, value]);
}

export function parseFfmetadata(bytes: Uint8Array): MediaDocument {
  const demuxErrors: string[] = [];
  const decoded = decodeUtf8(bytes);
  const text = decoded.startsWith("\uFEFF") ? decoded.slice(1) : decoded;
  const lines: string[] = [];
  let lineStart = 0;
  for (let i = 0; i < text.length; i++) {
    // FFmpeg continues a physical line after any trailing backslash, even a pair.
    if ((text[i] === "\n" || text[i] === "\r") && text[i - 1] !== "\\") {
      lines.push(text.slice(lineStart, i));
      lineStart = i + 1;
    }
  }
  lines.push(text.slice(lineStart));
  const tags: Record<string, string> = {};
  const custom = new Map<string, [string, string]>();
  const keySpellings: Record<string, string> = {};
  const globalTags: [string, string][] = [];
  const chapters: Mp4Chapter[] = [];
  const tracks: MediaTrack[] = [];

  let section: "global" | "chapter" | "other" = "global";
  let tbNum = 1;
  let tbDen = 1_000_000_000;
  let curStart = 0;
  let curEnd: number | undefined;
  let missingEndChapter: Mp4Chapter | undefined;
  let chapterTags: [string, string][] = [];
  let curTitle = "";
  let chapterHeader: "timebase" | "start" | "end" | "tags" = "timebase";

  const flushChapter = () => {
    if (section !== "chapter") return;
    if (curEnd !== undefined && curEnd < curStart) throw new Error(`Chapter end time ${curEnd} before start ${curStart}`);
    const factor = tbNum / tbDen;
    if (missingEndChapter) {
      chapters[missingEndChapter.id] = {
        ...missingEndChapter,
        endTimeSeconds: Math.max(missingEndChapter.startTimeSeconds, curStart * factor)
      };
    }
    const chapter: Mp4Chapter = {
      id: chapters.length,
      timeBase: { numerator: tbNum, denominator: tbDen },
      startTimeSeconds: curStart * factor,
      endTimeSeconds: (curEnd ?? curStart) * factor,
      title: curTitle,
      tags: Object.fromEntries(chapterTags)
    };
    chapters.push(chapter);
    missingEndChapter = curEnd === undefined ? chapter : undefined;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || rawLine.startsWith(";") || rawLine.startsWith("#")) continue;
    if (rawLine.startsWith("[CHAPTER]")) {
      flushChapter();
      section = "chapter";
      tbNum = 1;
      tbDen = 1_000_000_000;
      curStart = 0;
      curEnd = undefined;
      chapterTags = [];
      curTitle = "";
      chapterHeader = "timebase";
      continue;
    }
    if (rawLine.startsWith("[STREAM]")) {
      flushChapter();
      section = "other";
      tracks.push({
        id: tracks.length,
        type: "data",
        handlerType: "meta",
        timescale: 1_000_000,
        duration: 0,
        language: "und",
        enabled: false,
        codecDescriptions: [{ formatFourCC: "\0\0\0\0", codecName: "" }],
        samples: []
      });
      continue;
    }
    let eq = 0;
    let key = "";
    for (; eq < rawLine.length; eq++) {
      if (rawLine[eq] === "=") break;
      if (rawLine[eq] === "\\" && eq + 1 < rawLine.length) eq++;
      key += rawLine[eq];
    }
    if (eq === rawLine.length) continue;
    let val = "";
    for (let i = eq + 1; i < rawLine.length; i++) {
      if (rawLine[i] === "\\" && ++i === rawLine.length) break;
      if (rawLine[i] === "\0") break;
      val += rawLine[i];
    }
    if (section === "chapter") {
      if (chapterHeader === "timebase") {
        chapterHeader = "start";
        if (key === "TIMEBASE") {
          const [n, d] = val.split("/");
          const numerator = parseInt(n ?? "", 10);
          if (Number.isNaN(numerator)) {
            demuxErrors.push(
              `[ffmetadata] Expected chapter start timestamp, found ${rawLine}.`,
              `[ffmetadata] Expected chapter end timestamp, found ${rawLine}.`
            );
            chapterHeader = "tags";
            continue;
          }
          tbNum = numerator || 1;
          tbDen = parseInt(d ?? "", 10);
          if (tbDen <= 0) throw new Error("FFmetadata chapter TIMEBASE denominator must be positive");
          tbDen = tbDen || 1_000_000_000;
          continue;
        }
      }
      if (chapterHeader === "start") {
        chapterHeader = "end";
        if (key === "START") {
          const start = parseInt(val, 10);
          if (!Number.isNaN(start)) {
            curStart = start;
            continue;
          }
          demuxErrors.push(`[ffmetadata] Expected chapter start timestamp, found ${line}.`);
        }
      }
      if (chapterHeader === "end") {
        chapterHeader = "tags";
        const end = key === "END" ? parseInt(val, 10) : NaN;
        if (!Number.isNaN(end)) curEnd = end;
        else if (key === "START" || key === "END") {
          demuxErrors.push(`[ffmetadata] Expected chapter end timestamp, found ${line}.`);
        }
        continue;
      }
      setFfmetadataTag(chapterTags, key, val);
      if (key.toUpperCase() === "TITLE") curTitle = val;
    } else if (section === "global") {
      setFfmetadataTag(globalTags, key, val);
    }
  }
  flushChapter();
  for (const [key, val] of globalTags) {
    const normalizedKey = key.toLowerCase();
    if (["title", "artist", "album", "date", "comment", "genre", "encoder"].includes(normalizedKey)) {
      tags[normalizedKey] = val;
      if (key !== normalizedKey) keySpellings[normalizedKey] = key;
    } else {
      custom.set(normalizedKey, [key, val]);
    }
  }

  return {
    containerFormat: "ffmetadata",
    ...(demuxErrors.length ? { demuxErrors } : {}),
    timescale: 1000,
    duration: Math.round((chapters[chapters.length - 1]?.endTimeSeconds ?? 0) * 1000),
    durationSeconds: chapters[chapters.length - 1]?.endTimeSeconds ?? 0,
    tracks,
    metadata: {
      ...(globalTags.length > 0 ? { keyOrder: globalTags.map(([key]) => key) } : {}),
      ...(Object.keys(keySpellings).length > 0 ? { keySpellings } : {}),
      title: tags.title,
      artist: tags.artist,
      album: tags.album,
      date: tags.date,
      comment: tags.comment,
      genre: tags.genre,
      encoder: tags.encoder,
      ...(custom.size > 0 ? { custom: Object.fromEntries(custom.values()) } : {})
    },
    chapters: chapters.length > 0 ? chapters : undefined,
    byteLength: bytes.byteLength
  };
}

function escapeFfmetadata(value: string): string {
  let escaped = "";
  for (const char of value) {
    if ("\\\n=;#".includes(char)) escaped += "\\";
    escaped += char;
  }
  return escaped;
}

export function serializeFfmetadata(doc: MediaDocument): Uint8Array {
  const lines: string[] = [";FFMETADATA1"];
  const m = doc.metadata;
  const tags = new Map<string, string>();
  for (const field of ["title", "artist", "album", "date", "comment", "copyright", "genre", "trackNumber", "encoder"] as const) {
    const key = field === "trackNumber" ? "track" : field;
    const value = m[field];
    if (value !== undefined) tags.set(m.keySpellings?.[key] ?? key, value);
  }
  for (const [key, value] of Object.entries(m.custom ?? {})) tags.set(key, value);
  for (const key of new Set([...(m.keyOrder ?? []), ...tags.keys()])) {
    const value = tags.get(key);
    if (value !== undefined) lines.push(`${escapeFfmetadata(key)}=${escapeFfmetadata(value)}`);
  }

  if (doc.chapters && doc.chapters.length > 0) {
    for (const ch of doc.chapters) {
      const { numerator, denominator } = ch.timeBase ?? { numerator: 1, denominator: ch.timescale ?? 1000 };
      const factor = numerator / denominator;
      lines.push("[CHAPTER]", `TIMEBASE=${numerator}/${denominator}`);
      lines.push(`START=${Math.round(ch.startTimeSeconds / factor)}`);
      lines.push(`END=${Math.round(ch.endTimeSeconds / factor)}`);
      for (const [key, value] of Object.entries(ch.tags ?? { title: ch.title })) {
        lines.push(`${escapeFfmetadata(key)}=${escapeFfmetadata(value)}`);
      }
    }
  }
  lines.push("");
  return encodeUtf8(lines.join("\n"));
}

export function ffmetadataAst(): MediaAstPlugin {
  return {
    id: "ffmetadata",
    formatName: "ffmetadata",
    formatLongName: "FFmpeg metadata in text",
    extensions: ["ffmeta", "ffmetadata"],
    mimeTypes: ["text/x-ffmetadata"],
    canDemux: true,
    canMux: true,
    supportedVideoCodecs: [],
    supportedAudioCodecs: [],
    detect(bytes) {
      if (bytes.byteLength >= 12) {
        const head = decodeUtf8(bytes.subarray(0, Math.min(64, bytes.byteLength))).trimStart();
        if (head.startsWith(";FFMETADATA")) return true;
      }
      return false;
    },
    parse(bytes) {
      return parseFfmetadata(bytes);
    },
    serialize(doc) {
      return serializeFfmetadata(doc);
    },
    probe(bytes, options) {
      const doc = parseFfmetadata(bytes);
      return buildProbeResultFromDoc(doc, bytes.byteLength, options?.filename ?? "input.ffmeta", {
        ...options,
        formatName: "ffmetadata",
        formatLongName: "FFmpeg metadata in text"
      });
    },
    concat(docs, options) {
      return concatMp4(docs, options);
    },
    slice(doc, options) {
      return sliceMp4(doc, options);
    }
  };
}

// --- 11. Apple HTTP Live Streaming (.m3u8 / HLS) & MPEG-DASH (.mpd) ASTs ---

export function hlsAst(): MediaAstPlugin {
  return {
    id: "hls",
    formatName: "hls",
    formatLongName: "Apple HTTP Live Streaming",
    extensions: ["m3u8", "m3u"],
    mimeTypes: ["application/vnd.apple.mpegurl", "application/x-mpegurl"],
    canDemux: true,
    canMux: true,
    supportedVideoCodecs: ["h264", "hevc"],
    supportedAudioCodecs: ["aac", "mp3"],
    detect(bytes, filename) {
      if (filename && /\.m3u8?$/i.test(filename)) return true;
      if (bytes.byteLength >= 7) {
        const head = decodeUtf8(bytes.subarray(0, Math.min(64, bytes.byteLength))).trimStart();
        if (head.startsWith("#EXTM3U")) return true;
      }
      return false;
    },
    parse(bytes, options) {
      return parseStreamingDocument(bytes, "hls", options);
    },
    serialize(doc) {
      const dur = Math.max(1, doc.durationSeconds || 2);
      const lines = [
        "#EXTM3U",
        "#EXT-X-VERSION:3",
        `#EXT-X-TARGETDURATION:${Math.ceil(dur)}`,
        "#EXT-X-MEDIA-SEQUENCE:0",
        `#EXTINF:${dur.toFixed(6)},`,
        "seg_000.ts",
        "#EXT-X-ENDLIST",
        ""
      ];
      return encodeUtf8(lines.join("\n"));
    },
    probe(bytes, options) {
      const doc = this.parse(bytes, options);
      return buildProbeResultFromDoc(doc, bytes.byteLength, options?.filename ?? "playlist.m3u8", {
        ...options,
        formatName: "hls",
        formatLongName: "Apple HTTP Live Streaming"
      });
    },
    concat(docs, options) {
      return concatMp4(docs, options);
    },
    slice(doc, options) {
      return sliceMp4(doc, options);
    }
  };
}

export function dashAst(): MediaAstPlugin {
  return {
    id: "dash",
    formatName: "dash",
    formatLongName: "Dynamic Adaptive Streaming over HTTP",
    extensions: ["mpd"],
    mimeTypes: ["application/dash+xml"],
    canDemux: true,
    canMux: true,
    supportedVideoCodecs: ["h264", "hevc", "av1", "vp9"],
    supportedAudioCodecs: ["aac", "opus"],
    detect(bytes, filename) {
      if (filename && filename.toLowerCase().endsWith(".mpd")) return true;
      if (bytes.byteLength >= 10) {
        const head = decodeUtf8(bytes.subarray(0, Math.min(256, bytes.byteLength)));
        if (head.includes("<MPD")) return true;
      }
      return false;
    },
    parse(bytes, options) {
      return parseStreamingDocument(bytes, "dash", options);
    },
    serialize(doc, options) {
      return serializeDashDocument(doc, options).manifest;
    },
    probe(bytes, options) {
      const doc = this.parse(bytes, options);
      return buildProbeResultFromDoc(doc, bytes.byteLength, options?.filename ?? "manifest.mpd", {
        ...options,
        formatName: "dash",
        formatLongName: "Dynamic Adaptive Streaming over HTTP"
      });
    },
    concat(docs, options) {
      return concatMp4(docs, options);
    },
    slice(doc, options) {
      return sliceMp4(doc, options);
    }
  };
}

export function allMediaAsts(): MediaAstPlugin[] {
  const rawAudio = rawAudioAsts();
  return [
    mp4Ast(),
    movAst(),
    mkvAst(),
    webmAst(),
    mpegtsAst(),
    aviAst(),
    nutAst(),
    flvAst(),
    y4mAst(),
    aacAst(),
    latmAst(),
    amrAst(),
    ac3Ast(),
    wavAst(),
    wavAst("w64"),
    auAst(),
    vocAst(),
    ircamAst(),
    nistSphereAst(),
    cafAst(),
    aiffAst(),
    ...rawAudio,
    // FFmpeg's VIDC muxer defaults to pcm_mulaw, independently of its VIDC decoder.
    {
      ...rawAudio.find(plugin => plugin.id === "mulaw")!,
      id: "vidc",
      formatName: "vidc",
      formatLongName: "PCM Archimedes VIDC",
      canDemux: true,
      parse(bytes, options) { return parseRawAudio(bytes, "vidc", options); },
      probe(bytes, options = {}) {
        return buildProbeResultFromDoc(parseRawAudio(bytes, "vidc", options), bytes.length, options.filename, { ...options, formatName: "vidc" });
      }
    },
    mp3Ast(),
    flacAst(),
    wavpackAst(),
    oggAst(),
    gifAst(),
    apngAst(),
    icoAst(),
    image2Ast(),
    srtAst(),
    ttmlAst(),
    lrcAst(),
    samiAst(),
    realtextAst(),
    subviewerAst(),
    subviewer1Ast(),
    aqtitleAst(),
    microdvdAst(),
    jacosubAst(),
    mpl2Ast(),
    stlAst(),
    vplayerAst(),
    pjsAst(),
    assAst(),
    webvttAst(),
    ffmetadataAst(),
    hlsAst(),
    dashAst()
  ];
}

export interface MediaAstRegistry {
  readonly plugins: readonly MediaAstPlugin[];
  findById(id: string): MediaAstPlugin | undefined;
  findByFormatName(formatName: string): MediaAstPlugin | undefined;
  findByFilename(filename: string): MediaAstPlugin | undefined;
  detect(bytes: Uint8Array, filename?: string, explicitFormat?: string): MediaAstPlugin | undefined;
}

export function createMediaAstRegistry(plugins: readonly MediaAstPlugin[]): MediaAstRegistry {
  return {
    plugins,
    findById(id: string) {
      const lower = id.toLowerCase();
      return plugins.find((p) => p.id.toLowerCase() === lower);
    },
    findByFormatName(formatName: string) {
      const lower = formatName.toLowerCase();
      return plugins.find(
        (p) =>
          p.id.toLowerCase() === lower ||
          p.formatName.toLowerCase() === lower ||
          p.formatName
            .toLowerCase()
            .split(",")
            .includes(lower) ||
          p.extensions.includes(lower)
      );
    },
    findByFilename(filename: string) {
      const clean = filename.replace(/\?.*$/, "");
      const ext = clean.split(".").pop()?.toLowerCase() ?? "";
      if (!ext) return undefined;
      return plugins.find((p) => p.extensions.includes(ext));
    },
    detect(bytes: Uint8Array, filename?: string, explicitFormat?: string) {
      if (explicitFormat) {
        const byFormat = this.findByFormatName(explicitFormat);
        if (byFormat) return byFormat;
      }
      // Prefer plugin matching both magic signature AND extension first
      if (filename) {
        const byExt = this.findByFilename(filename);
        if (byExt && byExt.detect(bytes, filename)) {
          return byExt;
        }
      }
      // Next check magic bytes across registered plugins
      for (const p of plugins) {
        if (p.detect(bytes, filename)) {
          return p;
        }
      }
      // SubRip requires a numbered cue signature for automatic detection;
      // unnumbered cues are accepted only when the input format is explicit.
      // SubViewer shares .sub with MicroDVD, so its timecode signature is required.
      // FFmetadata also requires its header unless the format is explicit.
      if (filename) {
        const byExt = this.findByFilename(filename);
        if (byExt?.id !== "srt" && byExt?.id !== "subviewer" && byExt?.id !== "ffmetadata") return byExt;
      }
      return undefined;
    }
  };
}
