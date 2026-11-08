import { decodeTga, encodeTga } from "./tga.js";
import { icoAst } from "./ico.js";
export { icoAst } from "./ico.js";
import { apngAst } from "./apng.js";
export { apngAst } from "./apng.js";
import { pjsAst } from "./pjs.js";
import { samiAst } from "./sami.js";
import { lrcAst } from "./lrc.js";
import { mpl2Ast } from "./mpl2.js";
import { microdvdAst } from "./microdvd.js";
import { cafAst } from "./caf.js";
import { auAst } from "./au.js";
import { aiffAst } from "./aiff.js";
import { rawAudioAsts, mulawTable, alawTable } from "./raw-audio.js";
import { encodeAudio } from "@poe-code/media-codecs";
import { decodeCompressedWav } from "./wav-compressed.js";
import { decodeImaWav, encodeImaWav, imaBlockFrames } from "./wav-ima.js";
import { readMp3Frames, readMp3SourceFrames, readMp3StreamFrames, writeMp3Frames, type Mp3Frame } from "./mp3-frames.js";
import { decodeMp3Track, encodeMp3 } from "../mp3.js";
import { decodeVorbisTrack } from "../vorbis.js";
import { decodeAacTrack } from "../aac.js";
import { wavInfoTags, isWave64Signature, wave64Guid, readWavHeader, readWavSourceHeader, readWavStreamHeader, type WavHeader } from "./wav-header.js";
import { parseAudio, writeAudioMetadata, encodeId3, type AudioStream } from "@poe-code/audio-ast";
import { decodeH264Samples } from "../h264.js";
import { decodeFlac, encodeFlacPackets } from "./flac.js";
import { FlacFrameScanner } from "./flac-probe.js";

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
      const start = Math.max(Math.round(frame.ptsSeconds * ts) / ts, mediaStart);
      const end = Math.min(Math.round((frame.ptsSeconds + frame.durationSeconds) * ts) / ts, mediaEnd);
      if (end <= start) continue;
      frames.push(edit ? { ...frame, ptsSeconds: presentationStart + start - mediaStart, durationSeconds: end - start } : frame);
      if (maxFrames !== undefined && frames.length >= maxFrames) break;
    }
    if (maxFrames !== undefined && frames.length >= maxFrames) break;
    presentationStart += duration;
  }
  const fps = frames.length > 0 ? Math.max(1, Math.round(1 / (frames[0]!.durationSeconds || .1))) : 30;
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
    newlineIdx++;
  }
  const headerLine = decodeUtf8(bytes.subarray(0, newlineIdx));
  let width = 64;
  let height = 64;
  let fpsNum = 30;
  let fpsDen = 1;
  let sarWidth = 1;
  let sarHeight = 1;
  let chromaLocation: string | undefined;
  let fieldOrder: "progressive" | "tt" | "bb" | undefined;
  let colorRange: "pc" | "tv" | undefined;

  for (const token of headerLine.split(/\s+/)) {
    if (token.startsWith("W")) width = parseInt(token.slice(1), 10) || width;
    else if (token.startsWith("H")) height = parseInt(token.slice(1), 10) || height;
    else if (token === "Ip") fieldOrder = "progressive";
    else if (token === "It") fieldOrder = "tt";
    else if (token === "Ib") fieldOrder = "bb";
    else if (token === "C420mpeg2") chromaLocation = "left";
    else if (token === "C420jpeg") chromaLocation = "center";
    else if (token === "XCOLORRANGE=FULL") colorRange = "pc";
    else if (token === "XCOLORRANGE=LIMITED") colorRange = "tv";
    else if (token.startsWith("F")) {
      const [n, d] = token.slice(1).split(":");
      fpsNum = parseInt(n ?? "30", 10) || 30;
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

  const fps = fpsNum / Math.max(1, fpsDen);
  const ySize = width * height;
  const uvWidth = (width + 1) >>> 1;
  const uvHeight = (height + 1) >>> 1;
  const uvSize = uvWidth * uvHeight;
  const frameByteSize = ySize + uvSize * 2;

  const frames: MediaVideoFrame[] = [];
  let cursor = newlineIdx + 1;
  let frameIdx = 0;

  while (cursor < bytes.byteLength) {
    // Expect 'FRAME...' followed by '\n'
    let fEnd = cursor;
    while (fEnd < bytes.byteLength && bytes[fEnd] !== 0x0a) fEnd++;
    cursor = fEnd + 1;
    if (cursor + frameByteSize > bytes.byteLength) break;

    const yPlane = bytes.subarray(cursor, cursor + ySize);
    const uPlane = bytes.subarray(cursor + ySize, cursor + ySize + uvSize);
    const vPlane = bytes.subarray(
      cursor + ySize + uvSize,
      cursor + ySize + uvSize * 2
    );
    const rgba = yuv420pToRgba(yPlane, uPlane, vPlane, width, height);
    frames.push({
      width,
      height,
      data: rgba,
      native: { rgba, pixels: bytes.subarray(cursor, cursor + frameByteSize), width, height,
        format: 0, colorspace: 5, fullRange: 0 },
      ptsSeconds: frameIdx / fps,
      durationSeconds: 1 / fps,
      keyframe: true
    });
    cursor += frameByteSize;
    frameIdx++;
  }

  const timescale = fpsNum;
  const frameTicks = Math.max(1, fpsDen);
  const samples: MediaSample[] = frames.map((f, idx) => ({
    data: f.data,
    dts: idx * frameTicks,
    pts: idx * frameTicks,
    cts: 0,
    duration: frameTicks,
    size: frameByteSize,
    isKeyframe: true,
    sampleDescriptionIndex: 1
  }));

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
            formatFourCC: "raw ",
            codecName: "rawvideo",
            width,
            height,
            pixFmt: "yuv420p",
            chromaLocation,
            sarWidth,
            sarHeight,
            fieldOrder,
            colorRange
          }
        ],
        samples,
        decodedVideoFrames: frames
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
  const rate = exactTiming ? `${track.timescale / divisor}:${sampleDuration / divisor}` : `${fps}:1`;
  const interlace = codec?.fieldOrder === "tt" ? "t" : codec?.fieldOrder === "bb" ? "b" : "p";
  const range = codec?.colorRange === "pc" ? " XCOLORRANGE=FULL" : codec?.colorRange === "tv" ? " XCOLORRANGE=LIMITED" : "";
  const chroma = codec?.chromaLocation === "left" ? "420mpeg2 XYSCSS=420MPEG2" : "420jpeg";
  const header = encodeUtf8(`YUV4MPEG2 W${width} H${height} F${rate} I${interlace} A${codec?.sarWidth ?? 1}:${codec?.sarHeight ?? 1} C${chroma}${range}\n`);
  const frameTag = encodeUtf8("FRAME\n");
  const chunks: Uint8Array[] = [header];

  for (const frame of frames) {
    const native = frame.native;
    if (native?.format === 0 && native.rgba === frame.data &&
        native.width === width && native.height === height) {
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
      return buildProbeResultFromDoc(doc, bytes.byteLength, options?.filename ?? "input.y4m", {
        ...options,
        formatName: "yuv4mpegpipe",
        formatLongName: "YUV4MPEG pipe"
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

// --- 2. ADTS AAC (.aac) ---

export function isAdtsSignature(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 7 && bytes[0] === 0xff && (bytes[1]! & 0xf6) === 0xf0;
}

export function parseAacAdts(bytes: Uint8Array): MediaDocument {
  const parsed = parseAdtsStream(bytes);
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
    metadata: {},
    byteLength: bytes.byteLength
  };
}

export function serializeAacAdts(doc: MediaDocument): Uint8Array {
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

  const adtsFrames = samples.map((s) =>
    s.data.byteLength >= 7 && s.data[0] === 0xff && (s.data[1]! & 0xf0) === 0xf0
      ? s.data
      : wrapAdtsFrame(s.data, sampleRate, channels)
  );
  return concatBytes(adtsFrames);
}

export function aacAst(): MediaAstPlugin {
  return {
    id: "aac",
    formatName: "aac",
    formatLongName: "raw ADTS AAC (Advanced Audio Coding)",
    extensions: ["aac"],
    mimeTypes: ["audio/aac", "audio/x-hx-aac-adts"],
    canDemux: true,
    canMux: true,
    supportedVideoCodecs: [],
    supportedAudioCodecs: ["aac"],
    detect(bytes, filename) {
      if (isAdtsSignature(bytes)) return true;
      if (filename && filename.toLowerCase().endsWith(".aac")) return bytes.byteLength >= 7;
      return false;
    },
    parse(bytes) {
      return parseAacAdts(bytes);
    },
    serialize(doc) {
      return serializeAacAdts(doc);
    },
    probe(bytes, options) {
      const doc = parseAacAdts(bytes);
      return buildProbeResultFromDoc(doc, bytes.byteLength, options?.filename ?? "input.aac", {
        ...options,
        formatName: "aac",
        formatLongName: "raw ADTS AAC (Advanced Audio Coding)"
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

// --- 3. WAV / RIFF WAVE (.wav) ---

export function isWavSignature(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= 12 &&
    (decodeFourCC(bytes, 0) === "RIFF" || decodeFourCC(bytes, 0) === "RIFX" || decodeFourCC(bytes, 0) === "RF64") &&
    decodeFourCC(bytes, 8) === "WAVE"
  );
}

export function wavPacketFrames(sampleRate: number, block: number): number {
  // FFmpeg PCM demuxing targets ten packets per second, rounded down to a power of two.
  const samples = Math.max(1, Math.min(Math.floor(sampleRate / 10), Math.floor(0x7fffffff / block)));
  return 2 ** Math.floor(Math.log2(samples));
}

function wavFrames(header: WavHeader): number {
  if (header.formatTag !== 17) return Math.floor(header.dataSize / Math.max(1, header.channels * (header.bitsPerSample >>> 3)));
  if (header.bitsPerSample !== 4) throw new Error("Invalid IMA WAV sample width");
  const frames = imaBlockFrames(header.blockAlign, header.channels);
  const remainder = header.dataSize % header.blockAlign;
  return Math.floor(header.dataSize / header.blockAlign) * frames + (remainder ? imaBlockFrames(remainder, header.channels) : 0);
}

export function parseWav(bytes: Uint8Array, options: ParseMediaOptions = {}): MediaDocument {
  const header = readWavHeader(bytes);
  const { formatTag, channels, sampleRate, bitsPerSample, littleEndian } = header;
  const pcmData = bytes.subarray(header.dataOffset, header.dataOffset + header.dataSize);

  const compressed = formatTag !== 1 && formatTag !== 3 && formatTag !== 0xfffe;
  const bytesPerFrame = Math.max(1, channels * (bitsPerSample >>> 3));
  const totalPcmSamples = wavFrames(header);
  let decodedAudio: MediaAudioData | undefined;
  if (options.decodeAudio !== false && (formatTag === 85 || formatTag === 255)) {
    decodedAudio = decodeCompressedWav(bytes, header);
  } else if (options.decodeAudio !== false && formatTag === 17) {
    decodedAudio = { sampleRate, channels, channelData: decodeImaWav(pcmData, channels, header.blockAlign, totalPcmSamples) };
  } else if (options.decodeAudio !== false) {
    // Preserve precision for signed PCM32 and 64-bit samples.
    const SampleArray = bitsPerSample === 64 || (formatTag === 1 || formatTag === 0xfffe) && bitsPerSample === 32 ? Float64Array : Float32Array;
    const channelData = Array.from({ length: channels }, () => new SampleArray(totalPcmSamples));
    const pcmView = new DataView(pcmData.buffer, pcmData.byteOffset, pcmData.byteLength);

    for (let i = 0; i < totalPcmSamples; i++) {
      for (let ch = 0; ch < channels; ch++) {
        const byteOff = (i * channels + ch) * (bitsPerSample >>> 3);
        if (bitsPerSample === 64 && byteOff + 8 <= pcmData.byteLength) {
          channelData[ch]![i] = formatTag === 3
            ? pcmView.getFloat64(byteOff, littleEndian)
            : Number(pcmView.getBigInt64(byteOff, littleEndian)) / 2 ** 63;
        } else if (formatTag === 3 && bitsPerSample === 32 && byteOff + 4 <= pcmData.byteLength) {
          channelData[ch]![i] = pcmView.getFloat32(byteOff, littleEndian);
        } else if (bitsPerSample === 24 && byteOff + 3 <= pcmData.byteLength) {
          const value = littleEndian
            ? pcmData[byteOff]! | (pcmData[byteOff + 1]! << 8) | (pcmData[byteOff + 2]! << 16)
            : (pcmData[byteOff]! << 16) | (pcmData[byteOff + 1]! << 8) | pcmData[byteOff + 2]!;
          channelData[ch]![i] = (value << 8 >> 8) / 8388608;
        } else if (bitsPerSample === 32 && byteOff + 4 <= pcmData.byteLength) {
          channelData[ch]![i] = pcmView.getInt32(byteOff, littleEndian) / 2147483648;
        } else if (bitsPerSample === 16 && byteOff + 2 <= pcmData.byteLength) {
          channelData[ch]![i] = pcmView.getInt16(byteOff, littleEndian) / 32768;
        } else if (bitsPerSample === 8 && byteOff < pcmData.byteLength) {
          const byte = pcmData[byteOff]!;
          if (formatTag === 6) {
            const value = byte ^ 0x55;
            const exponent = (value >>> 4) & 7;
            const magnitude = exponent === 0 ? ((value & 15) << 4) + 8 :
              (((value & 15) << 4) + 264) << (exponent - 1);
            channelData[ch]![i] = (value & 128 ? magnitude : -magnitude) / 32768;
          } else if (formatTag === 7) {
            const value = byte ^ 0xff;
            const magnitude = ((((value & 15) << 3) + 132) << ((value >>> 4) & 7)) - 132;
            channelData[ch]![i] = (value & 128 ? -magnitude : magnitude) / 32768;
          } else {
            channelData[ch]![i] = (byte - 128) / 128;
          }
        }
      }
    }
    decodedAudio = { sampleRate, channels, channelData, ...(header.channelMask !== undefined ? { channelMask: header.channelMask } : {}) };
  }

  const samples: MediaSample[] = [];
  const chunkFrames = formatTag === 17 ? imaBlockFrames(header.blockAlign, channels) : wavPacketFrames(header.sampleRate, bytesPerFrame);
  for (let offsetSample = 0; offsetSample < totalPcmSamples; offsetSample += chunkFrames) {
    const count = Math.min(chunkFrames, totalPcmSamples - offsetSample);
    const byteStart = formatTag === 17 ? offsetSample / chunkFrames * header.blockAlign : offsetSample * bytesPerFrame;
    const byteEnd = formatTag === 17 ? Math.min(pcmData.length, byteStart + header.blockAlign) : compressed && offsetSample + count === totalPcmSamples ? pcmData.byteLength : (offsetSample + count) * bytesPerFrame;
    samples.push({
      data: pcmData.subarray(byteStart, byteEnd),
      offset: header.dataOffset + byteStart,
      dts: offsetSample,
      pts: offsetSample,
      cts: 0,
      duration: count,
      size: byteEnd - byteStart,
      isKeyframe: true,
      sampleDescriptionIndex: 1
    });
  }

  if (compressed && samples.length === 0 && pcmData.length > 0) {
    samples.push({ data: pcmData, offset: header.dataOffset, dts: 0, pts: 0, cts: 0, duration: 0,
      size: pcmData.length, isKeyframe: true, sampleDescriptionIndex: 1 });
  }
  let doc = wavDocument(header, samples, decodedAudio, bytes);
  if (!compressed && header.declaredDataSize !== undefined && pcmData.length < header.declaredDataSize &&
      pcmData.length % (chunkFrames * bytesPerFrame) !== 0) {
    doc = { ...doc, tracks: doc.tracks.map(track => ({ ...track,
      demuxError: { message: "corrupt input packet", timestamp: Math.floor(totalPcmSamples / chunkFrames) * chunkFrames }
    })) };
  }
  if (!compressed && decodedAudio && pcmData.length % bytesPerFrame !== 0) {
    return { ...doc, tracks: doc.tracks.map(track => ({
      ...track,
      decodeErrors: [`Invalid PCM packet: ${pcmData.length % bytesPerFrame} trailing bytes cannot form a ${bytesPerFrame}-byte sample frame`]
    })) };
  }
  return doc;
}

function wavDocument(header: WavHeader, samples: MediaSample[], decodedAudio?: MediaAudioData, bytes?: Uint8Array): MediaDocument {
  const { formatTag, channels, sampleRate, bitsPerSample, byteLength } = header;
  const totalPcmSamples = decodedAudio?.channelData[0]?.length ?? wavFrames(header);
  const durationSeconds = totalPcmSamples / Math.max(1, sampleRate);
  return {
    containerFormat: header.containerFormat,
    timescale: sampleRate,
    duration: totalPcmSamples,
    durationSeconds,
    chapters: header.cues?.map((cue, index, cues) => ({
      id: cue.id,
      timescale: sampleRate,
      startTimeSeconds: cue.start / sampleRate,
      endTimeSeconds: (cues[index + 1]?.start ?? totalPcmSamples) / sampleRate,
      title: cue.title
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
            codecName: formatTag === 85 ? "mp3" : formatTag === 255 ? "aac" : formatTag === 17 ? "adpcm_ima_wav" : formatTag === 6 ? "pcm_alaw" : formatTag === 7 ? "pcm_mulaw" : formatTag === 3 ? `pcm_f${bitsPerSample}${header.littleEndian ? "le" : "be"}` : bitsPerSample === 8 ? "pcm_u8" : `pcm_s${bitsPerSample}${header.littleEndian ? "le" : "be"}`,
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
      }
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
  if (options.audioCodec === "copy" && audioTrack?.codecDescriptions[0]?.codecName.endsWith("be")) {
    throw new Error(`Codec ${audioTrack.codecDescriptions[0].codecName} not supported in WAVE format`);
  }
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
  } else if (decodedAudio && options.audioCodec === "adpcm_ima_wav") {
    const blockAlign = 1024;
    const frames = imaBlockFrames(blockAlign, channels);
    pcmBytes = encodeImaWav(decodedAudio.channelData, blockAlign);
    formatBytes = new Uint8Array(20);
    const format = new DataView(formatBytes.buffer);
    format.setUint16(0, 17, true);
    format.setUint16(2, channels, true);
    format.setUint32(4, sampleRate, true);
    format.setUint32(8, Math.floor(sampleRate * blockAlign / frames), true);
    format.setUint16(12, blockAlign, true);
    format.setUint16(14, 4, true);
    format.setUint16(16, 2, true);
    format.setUint16(18, frames, true);
    factBytes = new Uint8Array(4);
    new DataView(factBytes.buffer).setUint32(0, pcmBytes.length / blockAlign * frames, true);
  } else if (formatBytes) {
    pcmBytes = concatBytes(audioTrack!.samples.map(s => s.data));
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
    const truncate = formatTag === 1 && (source?.codecName === "flac" || source?.codecName.startsWith("pcm_s")) &&
      (source.bitsPerSample ?? 0) > bitsPerSample;
    // FFmpeg packs PCM8/PCM24 from the high bytes of signed PCM16/PCM32.
    const scale = 2 ** ((bitsPerSample === 8 ? 16 : bitsPerSample === 24 ? 32 : bitsPerSample) - 1);
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
        const val = Math.max(-1, Math.min(1, chData[c]?.[i] ?? 0));
        const scaled = val * scale;
        const lower = Math.floor(scaled);
        // FFmpeg rounds halfway PCM values to the nearest even integer.
        const rounded = scaled - lower === 0.5 ? lower + Math.abs(lower % 2) : Math.round(scaled);
        const sample = Math.min(scale - 1, truncate ? lower : rounded);
        if (formatTag === 6 || formatTag === 7) pcmBytes[offset] = (formatTag === 7 ? mulawTable : alawTable)[(sample & 65535) >> 2]!;
        else if (bitsPerSample === 64) pView.setBigInt64(offset, val >= 1 ? (1n << 63n) - 1n : BigInt(sample), true);
        else if (bitsPerSample === 8) pView.setUint8(offset, (sample >> 8) + 128);
        else if (bitsPerSample === 16) pView.setInt16(offset, sample, true);
        else if (bitsPerSample === 24) {
          pcmBytes[offset] = (sample >> 8) & 255;
          pcmBytes[offset + 1] = (sample >> 16) & 255;
          pcmBytes[offset + 2] = (sample >> 24) & 255;
        } else pView.setInt32(offset, sample, true);
      }
    }
  } else if (
    options.audioCodec !== "aac" && options.audioCodec !== "mp3" && options.audioCodec !== "adpcm_ima_wav" &&
    audioTrack &&
    audioTrack.samples.length > 0 &&
    audioTrack.codecDescriptions[0]?.codecName.startsWith("pcm_")
  ) {
    pcmBytes = concatBytes(audioTrack.samples.map((s) => s.data));
    bitsPerSample = audioTrack.codecDescriptions[0]!.bitsPerSample ?? 16;
    formatTag = audioTrack.codecDescriptions[0]!.codecName.startsWith("pcm_f") ? 3 : 1;
  } else {
    throw new Error("WAV encoding requires decoded PCM audio");
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
  const extensible = channelMask !== undefined || channels > 2 || sampleRate > 48000 ||
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
function wavMetadata(header: WavHeader, filename = "input.wav"): MediaProbeResult {
  const doc = wavDocument(header, []);
  const result = buildProbeResultFromDoc(doc, header.byteLength, filename, {
    formatName: header.containerFormat, formatLongName: header.containerFormat === "w64" ? "Sony Wave64" : "WAV / WAVE (Waveform Audio)"
  });
  const samples = doc.duration;
  const bytesPerFrame = Math.max(1, header.channels * (header.bitsPerSample >>> 3));
  return { ...result, streams: [{ ...result.streams[0]!,
    bit_rate: doc.durationSeconds > 0
      ? String(Math.round((header.formatTag === 17 ? header.dataSize : samples * bytesPerFrame) * 8 / doc.durationSeconds)) : "0"
  }] };
}

function wavRecords(header: WavHeader, options: MediaSourceProbeOptions): MediaProbeRecords {
  const metadata = wavMetadata(header, options.filename), stream = metadata.streams[0]!;
  const bytesPerFrame = Math.max(1, header.channels * (header.bitsPerSample >>> 3));
  const samples = wavFrames(header), rate = Math.max(1, header.sampleRate);
  const chunkFrames = header.formatTag === 17 ? imaBlockFrames(header.blockAlign, header.channels) : wavPacketFrames(header.sampleRate, bytesPerFrame);
  function* spans() {
    for (let pts = 0; pts < samples; pts += chunkFrames) {
      options.signal?.throwIfAborted();
      const count = Math.min(chunkFrames, samples - pts);
      const pos = header.formatTag === 17 ? pts / chunkFrames * header.blockAlign : pts * bytesPerFrame;
      const size = header.formatTag === 17 ? Math.min(header.blockAlign, header.dataSize - pos) : count * bytesPerFrame;
      yield { pts, count, pos: header.dataOffset + pos, size: String(size), time: (pts / rate).toFixed(6), duration: (count / rate).toFixed(6) };
    }
    options.signal?.throwIfAborted();
  }
  return { ...metadata,
    packets: options.showPackets ? { *[Symbol.iterator]() {
      for (const s of spans()) yield { codec_type: "audio" as const, stream_index: 0, pts: s.pts, pts_time: s.time,
        dts: s.pts, dts_time: s.time, duration: s.count, duration_time: s.duration, size: s.size,
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
  return wavRecords(await readWavSourceHeader(source, options.signal), options);
}

/** Consumes sequential borrowed chunks through EOF without retaining sample payloads. */
export function probeWavStream(source: AsyncIterable<Uint8Array>, options?: WavMetadataOnlyOptions): Promise<MediaProbeResult>;
export function probeWavStream(source: AsyncIterable<Uint8Array>, options: MediaSourceProbeOptions): Promise<MediaProbeRecords>;
export async function probeWavStream(source: AsyncIterable<Uint8Array>, options: MediaSourceProbeOptions = {}): Promise<MediaProbeRecords> {
  return wavRecords(await readWavStreamHeader(source, options.signal), options);
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
    supportedAudioCodecs: ["pcm_s16le", "adpcm_ima_wav", "pcm_u8", "pcm_s24le", "pcm_s32le", "pcm_f32le", "pcm_s64le", "pcm_f64le", "pcm_mulaw", "pcm_alaw"],
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
      if (!options?.showPackets && !options?.showFrames) return wavMetadata(readWavHeader(bytes), options?.filename);
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
  if (bytes.byteLength < 4) return false;
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return true; // ID3
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
  const result = buildProbeResultFromDoc({ ...doc, tracks }, scanner.size,
    options.filename ?? "input.flac", { ...options, formatName: "flac", formatLongName: "raw FLAC" });
  return { ...result,
    streams: result.streams.map(stream => stream.index === 0 ? { ...stream, nb_frames: undefined,
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
    detect(bytes, filename) {
      if (bytes.byteLength >= 4 && decodeFourCC(bytes, 0) === "fLaC") return true;
      if (filename && filename.toLowerCase().endsWith(".flac") && bytes.byteLength >= 4) {
        return decodeFourCC(bytes, 0) === "fLaC";
      }
      return false;
    },
    parse(bytes, options = {}) {
      const budget = options.budget ?? new MediaBudgetTracker(options.limits);
      budget.checkInputBytes(bytes.length);
      const parsed = parseAudio(bytes);
      const stream = parsed.streams[0]!;
      const scanner = new FlacFrameScanner();
      scanner.push(bytes, true);
      const doc = flacDocument(bytes, bytes.byteLength);
      const blocks: Uint8Array[] = [bytes.subarray(0, 4)];
      let offset = 4;
      for (;;) {
        const type = bytes[offset]! & 127;
        const size = bytes[offset + 1]! * 65536 + bytes[offset + 2]! * 256 + bytes[offset + 3]!;
        const block = Uint8Array.from(bytes.subarray(offset, offset + 4 + size));
        // Seek tables and cue sheets refer to the original recording.
        if (type !== 3 && type !== 5) { block[0] = type; blocks.push(block); }
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
      return { ...doc, metadata: parsed.tags, duration, durationSeconds: duration / track.timescale,
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
      const tags = Object.fromEntries(Object.entries(options?.metadata ?? doc.metadata)
        .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1] !== ""));
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

export function image2Ast(): MediaAstPlugin {
  return {
    id: "image2",
    formatName: "image2",
    formatLongName: "image2 sequence",
    extensions: ["png", "jpg", "jpeg", "webp", "bmp", "ppm", "pgm", "tga", "tiff", "tif"],
    mimeTypes: ["image/png", "image/jpeg", "image/webp", "image/bmp", "image/x-portable-pixmap"],
    canDemux: true,
    canMux: true,
    supportedVideoCodecs: ["png", "mjpeg", "webp", "bmp", "ppm"],
    supportedAudioCodecs: [],
    detect(bytes, filename) {
      if (apngAst().detect(bytes)) return false;
      if (isPngSignature(bytes) || isJpegSignature(bytes) || isWebpSignature(bytes) || isPpmSignature(bytes)) {
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
      } catch (error) {
        if (tga) throw error;
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
                pixFmt: tga ? (bytes[16] === 32 ? "bgra" : "bgr24") : pixFmt
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
        fmt === "webp" ? "webp" :
        fmt === "gif" ? "gif" :
        fmt === "bmp" ? "bmp" :
        fmt === "tiff" || fmt === "tif" ? "tiff" :
        fmt === "ppm" ? "ppm" : "png";
      return encodeImage(makeRgbaImage(width, height, first), { format: imgFmt }).data;
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
  const clean = raw.trim().replace(",", ".");
  const parts = clean.split(":");
  if (parts.length === 3) {
    const h = parseInt(parts[0] ?? "0", 10) || 0;
    const m = parseInt(parts[1] ?? "0", 10) || 0;
    if (format === "srt") {
      const [seconds, milliseconds] = (parts[2] ?? "0").split(".");
      return (h * 3600 + m * 60 + (parseInt(seconds ?? "0", 10) || 0)) * 1000
        + (parseInt(milliseconds ?? "0", 10) || 0);
    }
    const sec = parseFloat(parts[2] ?? "0") || 0;
    return Math.round((h * 3600 + m * 60 + sec) * 1000);
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
  return /^\d+\r?\n\d{2}:\d{2}:\d{2}[,.]\d+\s*-->\s*\d{2}:\d{2}:\d{2}[,.]\d+/.test(head);
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

export function parseSubtitleDocument(
  bytes: Uint8Array,
  format: "srt" | "webvtt" | "subviewer"
): MediaDocument {
  // Keep SubRip packet bytes intact until the subtitle decoder runs. Demuxing
  // must not turn invalid UTF-8 into valid replacement characters.
  let text: string;
  if (format === "srt") {
    const utf16 = (bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff);
    const payload = utf16 ? encodeUtf8(decodeSubRip(bytes))
      : bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? bytes.subarray(3) : bytes;
    text = Array.from(payload, byte => String.fromCharCode(byte)).join("").replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  } else {
    text = decodeUtf8(bytes).replace(/^\uFEFF/, "").replaceAll("\r\n", "\n");
  }
  // Native WebVTT demuxing produces no cues when the header is missing.
  const blocks = format === "webvtt" && !text.startsWith("WEBVTT") ? [] : text.split(/\n[ \t\n]*\n/);
  const samples: MediaSample[] = [];
  const seenSubRipCues = new Set<string>();
  let maxEndMs = 0;

  for (const rawBlock of blocks) {
    const lines = rawBlock
      .split("\n")
      .map((l) => format === "srt" ? l.replace(/[ \t]+$/, "") : l.trimEnd())
      .filter((l) => l.length > 0);
    if (lines.length === 0) continue;
    if (lines[0]!.startsWith("WEBVTT") || lines[0]!.startsWith("NOTE")) continue;

    let arrowLineIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (format === "subviewer" ? subviewerTiming(lines[i]!) !== undefined : lines[i]!.includes("-->")) {
        arrowLineIdx = i;
        break;
      }
    }
    if (arrowLineIdx < 0) continue;
    const timingLine = lines[arrowLineIdx]!;
    const [leftRaw, rightWithSettings] = timingLine.split("-->");
    const rightRaw = (rightWithSettings ?? "").trim().split(/\s+/)[0] ?? "0";
    const subviewerTimes = format === "subviewer" ? subviewerTiming(timingLine) : undefined;
    const startMs = subviewerTimes ? subviewerTimes[0] : parseSubtitleTimecodeMs(leftRaw ?? "0", format === "srt" ? "srt" : "webvtt");
    const parsedEndMs = subviewerTimes ? subviewerTimes[1] : parseSubtitleTimecodeMs(rightRaw, format === "srt" ? "srt" : "webvtt");
    const endMs = format === "srt" ? parsedEndMs : Math.max(startMs + 1, parsedEndMs);
    const rawCueLines = lines.slice(arrowLineIdx + 1).join("\n");
    const cueLines = format === "subviewer" ? rawCueLines.replaceAll("[br]", "\n") : rawCueLines;
    const cueText = format === "srt" ? cueLines.replace(/^[ \t\n]+|[ \t\n]+$/g, "") : cueLines.trim();
    if (!cueText) continue;

    if (format === "srt") {
      const key = JSON.stringify([startMs, endMs, cueText]);
      if (seenSubRipCues.has(key)) continue;
      seenSubRipCues.add(key);
    }

    const payload = format === "srt" ? Uint8Array.from(cueText, char => char.charCodeAt(0)) : encodeUtf8(cueText);
    const duration = endMs - startMs;
    if (endMs > maxEndMs) maxEndMs = endMs;

    samples.push({
      data: payload,
      ...(format === "webvtt" ? { webvtt: {
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

  if (format === "srt") {
    samples.sort((a, b) => a.pts - b.pts);
    for (let i = 0; i < samples.length; i++) {
      const sample = samples[i]!;
      const next = samples[i + 1];
      // SubRip treats a negative duration as unknown, inferred from the next cue.
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
  const lines: string[] = [];

  if (format === "webvtt") {
    lines.push("WEBVTT", "");
  }

  if (format === "ttml") {
    lines.push('<?xml version="1.0" encoding="UTF-8"?>', '<tt xmlns="http://www.w3.org/ns/ttml"><body><div>');
  }

  let cueIndex = 1;
  for (const s of samples) {
    const cueText = decodeUtf8(s.data).trim();
    if (!cueText) continue;
    const startMs = Math.round((s.pts / ts) * 1000);
    const endMs = Math.round(((s.pts + s.duration) / ts) * 1000);
    if (format === "ttml") {
      const text = cueText.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
        .split("\n").join("<br/>");
      const begin = formatSubtitleTimecode(startMs, ",").replace(",", ".");
      const end = formatSubtitleTimecode(endMs, ",").replace(",", ".");
      lines.push(`<p begin="${begin}" end="${end}"><span>${text}</span></p>`);
      continue;
    }
    const sep = format === "webvtt" ? "." : ",";
    if (format === "srt") {
      lines.push(String(cueIndex));
    }
    const cue = format === "webvtt" ? s.webvtt : undefined;
    if (cue?.identifier) lines.push(cue.identifier);
    lines.push(`${formatSubtitleTimecode(startMs, sep)} --> ${formatSubtitleTimecode(endMs, sep)}${cue?.settings ? " " + cue.settings : ""}`);
    lines.push(cueText, "");
    cueIndex++;
  }

  if (format === "ttml") lines.push("</div></body></tt>");
  if (format === "srt" && lines.length > 0) lines.push("");
  return encodeUtf8(lines.join("\n"));
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
    parse(bytes) {
      return parseSubtitleDocument(bytes, "webvtt");
    },
    serialize(doc) {
      return serializeSubtitleDocument(doc, "webvtt");
    },
    probe(bytes, options) {
      const doc = parseSubtitleDocument(bytes, "webvtt");
      return buildProbeResultFromDoc(doc, bytes.byteLength, options?.filename ?? "input.vtt", {
        ...options,
        formatName: "webvtt",
        formatLongName: "WebVTT subtitle"
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


// --- 10. FFmetadata (;FFMETADATA1) AST ---

export function parseFfmetadata(bytes: Uint8Array): MediaDocument {
  const text = decodeUtf8(bytes).replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const lines: string[] = [];
  let lineStart = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\\") {
      i++;
    } else if (text[i] === "\n") {
      lines.push(text.slice(lineStart, i));
      lineStart = i + 1;
    }
  }
  lines.push(text.slice(lineStart));
  const tags: Record<string, string> = {};
  const custom = new Map<string, string>();
  const chapters: Mp4Chapter[] = [];

  let section: "global" | "chapter" | "other" = "global";
  let tbNum = 1;
  let tbDen = 1_000_000_000;
  let curStart = 0;
  let curEnd = 0;
  let chapterTags = new Map<string, string>();
  let curTitle = "";

  const flushChapter = () => {
    if (section !== "chapter") return;
    const factor = tbNum / Math.max(1, tbDen);
    chapters.push({
      id: chapters.length,
      timeBase: { numerator: tbNum, denominator: Math.max(1, tbDen) },
      startTimeSeconds: curStart * factor,
      endTimeSeconds: curEnd * factor,
      title: curTitle,
      tags: Object.fromEntries(chapterTags)
    });
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith(";") || line.startsWith("#")) continue;
    if (line.toUpperCase() === "[CHAPTER]") {
      flushChapter();
      section = "chapter";
      tbNum = 1;
      tbDen = 1_000_000_000;
      curStart = 0;
      curEnd = 0;
      chapterTags = new Map();
      curTitle = "";
      continue;
    }
    if (line.startsWith("[")) {
      flushChapter();
      section = "other";
      continue;
    }
    const eq = rawLine.indexOf("=");
    if (eq < 0) continue;
    const key = rawLine.slice(0, eq).trim();
    let val = "";
    for (let i = eq + 1; i < rawLine.length; i++) {
      if (rawLine[i] === "\\" && i + 1 < rawLine.length) i++;
      val += rawLine[i];
    }
    if (section === "chapter") {
      const kUp = key.toUpperCase();
      if (kUp === "TIMEBASE") {
        const [n, d] = val.split("/");
        tbNum = parseInt(n ?? "1", 10) || 1;
        tbDen = parseInt(d ?? "1000", 10) || 1000;
      } else if (kUp === "START") {
        curStart = parseInt(val, 10) || 0;
      } else if (kUp === "END") {
        curEnd = parseInt(val, 10) || 0;
      } else {
        chapterTags.set(key, val);
        if (kUp === "TITLE") curTitle = val;
      }
    } else if (section === "global") {
      const normalizedKey = key.toLowerCase();
      if (["title", "artist", "album", "date", "year", "comment", "genre", "encoder"].includes(normalizedKey)) {
        tags[normalizedKey] = val;
      } else {
        custom.set(key, val);
      }
    }
  }
  flushChapter();

  return {
    containerFormat: "ffmetadata",
    timescale: 1000,
    duration: Math.round((chapters[chapters.length - 1]?.endTimeSeconds ?? 0) * 1000),
    durationSeconds: chapters[chapters.length - 1]?.endTimeSeconds ?? 0,
    tracks: [],
    metadata: {
      title: tags.title,
      artist: tags.artist,
      album: tags.album,
      date: tags.date ?? tags.year,
      comment: tags.comment,
      genre: tags.genre,
      encoder: tags.encoder,
      ...(custom.size > 0 ? { custom: Object.fromEntries(custom) } : {})
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
  if (m.title) lines.push(`title=${escapeFfmetadata(m.title)}`);
  if (m.artist) lines.push(`artist=${escapeFfmetadata(m.artist)}`);
  if (m.album) lines.push(`album=${escapeFfmetadata(m.album)}`);
  if (m.date) lines.push(`date=${escapeFfmetadata(m.date)}`);
  if (m.comment) lines.push(`comment=${escapeFfmetadata(m.comment)}`);
  if (m.genre) lines.push(`genre=${escapeFfmetadata(m.genre)}`);
  if (m.encoder) lines.push(`encoder=${escapeFfmetadata(m.encoder)}`);
  for (const [key, value] of Object.entries(m.custom ?? {})) {
    lines.push(`${key}=${escapeFfmetadata(value)}`);
  }

  if (doc.chapters && doc.chapters.length > 0) {
    for (const ch of doc.chapters) {
      const { numerator, denominator } = ch.timeBase ?? { numerator: 1, denominator: 1000 };
      const factor = numerator / denominator;
      lines.push("", "[CHAPTER]", `TIMEBASE=${numerator}/${denominator}`);
      lines.push(`START=${Math.round(ch.startTimeSeconds / factor)}`);
      lines.push(`END=${Math.round(ch.endTimeSeconds / factor)}`);
      for (const [key, value] of Object.entries(ch.tags ?? { title: ch.title })) {
        lines.push(`${key}=${escapeFfmetadata(value)}`);
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
    detect(bytes, filename) {
      if (filename && /\.(ffmeta|ffmetadata)$/i.test(filename)) return true;
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
  return [
    mp4Ast(),
    movAst(),
    mkvAst(),
    webmAst(),
    mpegtsAst(),
    aviAst(),
    flvAst(),
    y4mAst(),
    aacAst(),
    wavAst(),
    wavAst("w64"),
    auAst(),
    cafAst(),
    aiffAst(),
    ...rawAudioAsts(),
    mp3Ast(),
    flacAst(),
    oggAst(),
    gifAst(),
    apngAst(),
    icoAst(),
    image2Ast(),
    srtAst(),
    ttmlAst(),
    lrcAst(),
    samiAst(),
    subviewerAst(),
    microdvdAst(),
    mpl2Ast(),
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
      if (filename) {
        const byExt = this.findByFilename(filename);
        if (byExt?.id !== "srt" && byExt?.id !== "subviewer") return byExt;
      }
      return undefined;
    }
  };
}
