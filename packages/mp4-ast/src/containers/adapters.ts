import { readMp3Frames, readMp3SourceFrames, readMp3StreamFrames, type Mp3Frame } from "./mp3-frames.js";
import { decodeMp3Track } from "../mp3.js";
import { decodeVorbisTrack } from "../vorbis.js";
import { decodeAacTrack } from "../aac.js";
import { readWavHeader, readWavSourceHeader, readWavStreamHeader, type WavHeader } from "./wav-header.js";
import { parseAudio, type AudioStream } from "@poe-code/audio-ast";
import { decodeH264Samples } from "../h264.js";
import { encodeFlacPackets } from "./flac.js";
import { FlacFrameScanner } from "./flac-probe.js";

import { parseStreamingDocument, serializeDashDocument } from "./streaming.js";
import { serializeOgg, extractOggFlac, readOggFlacHeader } from "./ogg.js";
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
  type MediaAstPlugin,
  type MediaAudioData,
  type MediaDocument,
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

  for (const token of headerLine.split(/\s+/)) {
    if (token.startsWith("W")) width = parseInt(token.slice(1), 10) || width;
    else if (token.startsWith("H")) height = parseInt(token.slice(1), 10) || height;
    else if (token.startsWith("F")) {
      const [n, d] = token.slice(1).split(":");
      fpsNum = parseInt(n ?? "30", 10) || 30;
      fpsDen = parseInt(d ?? "1", 10) || 1;
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
      ptsSeconds: frameIdx / fps,
      durationSeconds: 1 / fps,
      keyframe: true
    });
    cursor += frameByteSize;
    frameIdx++;
  }

  const timescale = 90000;
  const frameTicks = Math.max(1, Math.round(timescale / fps));
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
            pixFmt: "yuv420p"
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
  const header = encodeUtf8(`YUV4MPEG2 W${width} H${height} F${fps}:1 Ip A1:1 C420jpeg\n`);
  const frameTag = encodeUtf8("FRAME\n");
  const chunks: Uint8Array[] = [header];

  for (const frame of frames) {
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
    decodeFourCC(bytes, 0) === "RIFF" &&
    decodeFourCC(bytes, 8) === "WAVE"
  );
}

export function wavPacketFrames(sampleRate: number, block: number): number {
  // FFmpeg PCM demuxing targets ten packets per second, rounded down to a power of two.
  const samples = Math.max(1, Math.min(Math.floor(sampleRate / 10), Math.floor(0x7fffffff / block)));
  return 2 ** Math.floor(Math.log2(samples));
}

export function parseWav(bytes: Uint8Array, options: ParseMediaOptions = {}): MediaDocument {
  const header = readWavHeader(bytes);
  const { formatTag, channels, sampleRate, bitsPerSample } = header;
  const pcmData = bytes.subarray(header.dataOffset, header.dataOffset + header.dataSize);

  const bytesPerFrame = Math.max(1, channels * (bitsPerSample >>> 3));
  const totalPcmSamples = Math.floor(pcmData.byteLength / bytesPerFrame);
  let decodedAudio: MediaAudioData | undefined;
  if (options.decodeAudio !== false) {
    const channelData = Array.from({ length: channels }, () => new Float32Array(totalPcmSamples));
    const pcmView = new DataView(pcmData.buffer, pcmData.byteOffset, pcmData.byteLength);

    for (let i = 0; i < totalPcmSamples; i++) {
      for (let ch = 0; ch < channels; ch++) {
        const byteOff = (i * channels + ch) * (bitsPerSample >>> 3);
        if (formatTag === 3 && bitsPerSample === 32 && byteOff + 4 <= pcmData.byteLength) {
          channelData[ch]![i] = pcmView.getFloat32(byteOff, true);
        } else if (bitsPerSample === 24 && byteOff + 3 <= pcmData.byteLength) {
          const value = pcmData[byteOff]! | (pcmData[byteOff + 1]! << 8) | (pcmData[byteOff + 2]! << 16);
          channelData[ch]![i] = (value << 8 >> 8) / 8388608;
        } else if (bitsPerSample === 32 && byteOff + 4 <= pcmData.byteLength) {
          channelData[ch]![i] = pcmView.getInt32(byteOff, true) / 2147483648;
        } else if (bitsPerSample === 16 && byteOff + 2 <= pcmData.byteLength) {
          channelData[ch]![i] = pcmView.getInt16(byteOff, true) / 32768;
        } else if (bitsPerSample === 8 && byteOff < pcmData.byteLength) {
          channelData[ch]![i] = (pcmData[byteOff]! - 128) / 128;
        }
      }
    }
    decodedAudio = { sampleRate, channels, channelData, ...(header.channelMask !== undefined ? { channelMask: header.channelMask } : {}) };
  }

  const samples: MediaSample[] = [];
  const chunkFrames = wavPacketFrames(header.sampleRate, bytesPerFrame);
  for (let offsetSample = 0; offsetSample < totalPcmSamples; offsetSample += chunkFrames) {
    const count = Math.min(chunkFrames, totalPcmSamples - offsetSample);
    const byteStart = offsetSample * bytesPerFrame;
    const byteEnd = Math.min(pcmData.byteLength, (offsetSample + count) * bytesPerFrame);
    samples.push({
      data: pcmData.subarray(byteStart, byteEnd),
      dts: offsetSample,
      pts: offsetSample,
      cts: 0,
      duration: count,
      size: byteEnd - byteStart,
      isKeyframe: true,
      sampleDescriptionIndex: 1
    });
  }

  return wavDocument(header, samples, decodedAudio);
}

function wavDocument(header: WavHeader, samples: MediaSample[], decodedAudio?: MediaAudioData): MediaDocument {
  const { formatTag, channels, sampleRate, bitsPerSample, dataSize, byteLength } = header;
  const totalPcmSamples = Math.floor(dataSize / Math.max(1, channels * (bitsPerSample >>> 3)));
  const durationSeconds = totalPcmSamples / Math.max(1, sampleRate);
  return {
    containerFormat: "wav",
    timescale: sampleRate,
    duration: totalPcmSamples,
    durationSeconds,
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
            codecName: formatTag === 3 ? `pcm_f${bitsPerSample}le` : bitsPerSample === 8 ? "pcm_u8" : `pcm_s${bitsPerSample}le`,
            sampleRate,
            channels,
            bitsPerSample
          }
        ],
        samples,
        ...(decodedAudio ? { decodedAudio } : {})
      }
    ],
    metadata: {},
    byteLength
  };
}

export function serializeWav(doc: MediaDocument, options: SerializeMediaOptions = {}): Uint8Array {
  const audioTrack = doc.tracks.find((t) => t.type === "audio");
  const sampleRate = audioTrack?.codecDescriptions[0]?.sampleRate ?? audioTrack?.timescale ?? 44100;
  const channels = audioTrack?.codecDescriptions[0]?.channels ?? 2;
  let bitsPerSample = 16;
  let formatTag = 1;

  let pcmBytes: Uint8Array;
  const decodedAudio = options.audioCodec === "copy" ? undefined : audioTrack?.decodedAudio ?? (audioTrack?.samples.length &&
    (audioTrack.codecDescriptions[0]?.codecName === "aac" ? decodeAacTrack(doc, audioTrack) :
      audioTrack.codecDescriptions[0]?.codecName === "mp3" ? decodeMp3Track(audioTrack) :
      audioTrack.codecDescriptions[0]?.codecName === "vorbis" ? decodeVorbisTrack(audioTrack) : undefined));
  if (decodedAudio) {
    switch (options.audioCodec) {
      case "pcm_u8": bitsPerSample = 8; break;
      case "pcm_s24le": bitsPerSample = 24; break;
      case "pcm_s32le": bitsPerSample = 32; break;
      case "pcm_f32le": bitsPerSample = 32; formatTag = 3; break;
    }
    const chData = decodedAudio.channelData;
    const numSamples = chData[0]?.length ?? Math.round(doc.durationSeconds * sampleRate);
    const bytesPerSample = bitsPerSample >>> 3;
    // FFmpeg packs PCM24 from the high three bytes of signed PCM32.
    const scale = 2 ** ((bitsPerSample === 24 ? 32 : bitsPerSample) - 1);
    pcmBytes = new Uint8Array(numSamples * channels * bytesPerSample);
    const pView = new DataView(pcmBytes.buffer);
    for (let i = 0; i < numSamples; i++) {
      for (let c = 0; c < channels; c++) {
        const offset = (i * channels + c) * bytesPerSample;
        if (formatTag === 3) {
          pView.setFloat32(offset, chData[c]?.[i] ?? 0, true);
          continue;
        }
        const val = Math.max(-1, Math.min(1, chData[c]?.[i] ?? 0));
        const scaled = val * scale;
        const lower = Math.floor(scaled);
        // FFmpeg rounds halfway PCM values to the nearest even integer.
        const rounded = scaled - lower === 0.5 ? lower + Math.abs(lower % 2) : Math.round(scaled);
        const sample = Math.min(scale - 1, rounded);
        if (bitsPerSample === 8) pView.setUint8(offset, sample + 128);
        else if (bitsPerSample === 16) pView.setInt16(offset, sample, true);
        else if (bitsPerSample === 24) {
          pcmBytes[offset] = (sample >> 8) & 255;
          pcmBytes[offset + 1] = (sample >> 16) & 255;
          pcmBytes[offset + 2] = (sample >> 24) & 255;
        } else pView.setInt32(offset, sample, true);
      }
    }
  } else if (
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

  // FFmpeg's default layouts from 2.1 through 7.1; explicit masks take precedence.
  const channelMask = audioTrack?.decodedAudio?.channelMask ?? (decodedAudio ? decodedAudio.channelMask : undefined) ??
    [0xb, 0x107, 0x37, 0x3f, 0x70f, 0x63f][channels - 3];
  const extensible = channelMask !== undefined || channels > 2;
  const fmtSize = extensible ? 40 : 16;
  const padding = pcmBytes.byteLength % 2;
  const writer = new BinaryWriter(28 + fmtSize + pcmBytes.byteLength + padding);
  writer.writeFourCC("RIFF");
  writer.writeU32LE(20 + fmtSize + pcmBytes.byteLength + padding);
  writer.writeFourCC("WAVE");
  writer.writeFourCC("fmt ");
  writer.writeU32LE(fmtSize);
  writer.writeU16LE(extensible ? 0xfffe : formatTag);
  writer.writeU16LE(channels);
  writer.writeU32LE(sampleRate);
  writer.writeU32LE(sampleRate * channels * (bitsPerSample >>> 3));
  writer.writeU16LE(channels * (bitsPerSample >>> 3));
  writer.writeU16LE(bitsPerSample);
  if (extensible) {
    writer.writeU16LE(22);
    writer.writeU16LE(bitsPerSample);
    writer.writeU32LE(channelMask ?? 0);
    writer.writeU32LE(formatTag);
    writer.writeBytes(Uint8Array.of(0, 0, 0x10, 0, 0x80, 0, 0, 0xaa, 0, 0x38, 0x9b, 0x71));
  }
  writer.writeFourCC("data");
  writer.writeU32LE(pcmBytes.byteLength);
  writer.writeBytes(pcmBytes);
  if (padding) writer.writeBytes(new Uint8Array(1));
  return writer.toUint8Array();
}

/** Metadata-only WAV probing without payload or per-packet allocation. */
function wavMetadata(header: WavHeader, filename = "input.wav"): MediaProbeResult {
  const doc = wavDocument(header, []);
  const result = buildProbeResultFromDoc(doc, header.byteLength, filename, {
    formatName: "wav", formatLongName: "WAV / WAVE (Waveform Audio)"
  });
  const samples = doc.duration;
  const bytesPerFrame = Math.max(1, header.channels * (header.bitsPerSample >>> 3));
  return { ...result, streams: [{ ...result.streams[0]!,
    bit_rate: doc.durationSeconds > 0
      ? String(Math.round(samples * bytesPerFrame * 8 / doc.durationSeconds)) : "0"
  }] };
}

function wavRecords(header: WavHeader, options: MediaSourceProbeOptions): MediaProbeRecords {
  const metadata = wavMetadata(header, options.filename), stream = metadata.streams[0]!;
  const bytesPerFrame = Math.max(1, header.channels * (header.bitsPerSample >>> 3));
  const samples = Math.floor(header.dataSize / bytesPerFrame), rate = Math.max(1, header.sampleRate);
  const chunkFrames = wavPacketFrames(header.sampleRate, bytesPerFrame);
  function* spans() {
    for (let pts = 0; pts < samples; pts += chunkFrames) {
      options.signal?.throwIfAborted();
      const count = Math.min(chunkFrames, samples - pts);
      yield { pts, count, size: String(count * bytesPerFrame), time: (pts / rate).toFixed(6), duration: (count / rate).toFixed(6) };
    }
    options.signal?.throwIfAborted();
  }
  return { ...metadata,
    packets: options.showPackets ? { *[Symbol.iterator]() {
      for (const s of spans()) yield { codec_type: "audio" as const, stream_index: 0, pts: s.pts, pts_time: s.time,
        dts: s.pts, dts_time: s.time, duration: s.count, duration_time: s.duration, size: s.size,
        pos: String(s.pts * bytesPerFrame), flags: "K__" };
    } } : undefined,
    frames: options.showFrames ? { *[Symbol.iterator]() {
      for (const s of spans()) yield { media_type: "audio" as const, stream_index: 0, key_frame: 1,
        pts: s.pts, pts_time: s.time, pkt_dts: s.pts, pkt_dts_time: s.time,
        best_effort_timestamp: s.pts, best_effort_timestamp_time: s.time, pkt_duration: s.count,
        pkt_duration_time: s.duration, pkt_size: s.size, width: undefined, height: undefined,
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

export function wavAst(): MediaAstPlugin {
  return {
    probeMetadata: probeWavSource,
    probeMetadataStream: probeWavStream,
    id: "wav",
    formatName: "wav",
    formatLongName: "WAV / WAVE (Waveform Audio)",
    extensions: ["wav", "wave"],
    mimeTypes: ["audio/wav", "audio/x-wav"],
    canDemux: true,
    canMux: true,
    supportedVideoCodecs: [],
    supportedAudioCodecs: ["pcm_s16le", "pcm_u8", "pcm_s24le", "pcm_s32le", "pcm_f32le"],
    detect(bytes, filename) {
      if (isWavSignature(bytes)) return true;
      if (filename && filename.toLowerCase().endsWith(".wav")) return isWavSignature(bytes);
      return false;
    },
    parse(bytes, options) {
      return parseWav(bytes, options);
    },
    serialize(doc, options) {
      return serializeWav(doc, options);
    },
    probe(bytes, options) {
      if (!options?.showPackets && !options?.showFrames) return wavMetadata(readWavHeader(bytes), options?.filename);
      const doc = parseWav(bytes, { ...options, decodeAudio: false });
      return buildProbeResultFromDoc(doc, bytes.byteLength, options?.filename ?? "input.wav", {
        ...options,
        formatName: "wav",
        formatLongName: "WAV / WAVE (Waveform Audio)"
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
    supportedVideoCodecs: [],
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
      return mp3Document(bytes.byteLength, frames, samples);
    },
    serialize(doc) {
      const numFrames = Math.max(1, Math.ceil(((doc.durationSeconds || 1) * 44100) / 1152));
      const frame = new Uint8Array(417);
      frame[0] = 0xff;
      frame[1] = 0xfb; // MPEG1 Layer 3
      frame[2] = 0x90; // 128kbps, 44100Hz
      frame[3] = 0x00;
      return concatBytes(Array.from({ length: numFrames }, () => frame));
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
  const result = buildProbeResultFromDoc({ ...doc, tracks: [{ ...doc.tracks[0]!, samples }] }, scanner.size,
    options.filename ?? "input.flac", { ...options, formatName: "flac", formatLongName: "raw FLAC" });
  return { ...result,
    streams: result.streams.map(stream => ({ ...stream, nb_frames: undefined,
      nb_read_packets: String(samples.length), nb_read_frames: String(samples.length) })),
    packets: result.packets?.map((packet, index) => ({ ...packet, pos: String(scanner.packets[index]!.pos) })) };
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
    supportedVideoCodecs: [],
    supportedAudioCodecs: ["flac"],
    detect(bytes, filename) {
      if (bytes.byteLength >= 4 && decodeFourCC(bytes, 0) === "fLaC") return true;
      if (filename && filename.toLowerCase().endsWith(".flac") && bytes.byteLength >= 4) {
        return decodeFourCC(bytes, 0) === "fLaC";
      }
      return false;
    },
    parse(bytes) { return flacDocument(bytes, bytes.byteLength, bytes); },
    serialize(doc) { return concatBytes(encodeFlacPackets(doc)); },
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
    parse(bytes) {
      const flac = extractOggFlac(bytes);
      if (flac) return { ...flacAst().parse(flac), containerFormat: "ogg", byteLength: bytes.length };

      const parsed = parseAudio(bytes);
      const stream = parsed.streams[0];
      if (!stream) throw new Error("Ogg input contains no audio stream");
      return oggDocument(stream, bytes.byteLength, bytes);
    },
    serialize: serializeOgg,
    probe(bytes, options) {
      const doc = this.parse(bytes, options);
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
function gifPackets(bytes: Uint8Array): Uint8Array[] {
  let at = 13 + ((bytes[10]! & 128) ? 3 * (1 << ((bytes[10]! & 7) + 1)) : 0);
  let start = 0;
  const packets: Uint8Array[] = [];
  while (at < bytes.length) {
    const marker = bytes[at++];
    if (marker === 0x3b) break;
    if (marker === 0x21) {
      at++; // Extension label; all extensions use length-prefixed sub-blocks.
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
  return packets;
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
      const packets = gifPackets(bytes);
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
          samples, decodedVideoFrames: frames }],
        metadata: {}, byteLength: bytes.byteLength
      };
    },
    serialize(doc) {
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
      return encodeImage(makeRgbaImage(width, height * count, data), {
        format: "gif", pageHeight: height, delay: delays
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
      if (isPngSignature(bytes) || isJpegSignature(bytes) || isWebpSignature(bytes) || isPpmSignature(bytes)) {
        return true;
      }
      if (filename && /\.(png|jpe?g|webp|bmp|pp[gm]|tga|tiff?)$/i.test(filename) && bytes.byteLength >= 4) {
        return true;
      }
      return false;
    },
    parse(bytes) {
      let width = 64;
      let height = 64;
      let codecName = "png";
      let rgba: Uint8Array = new Uint8Array(64 * 64 * 4).fill(180);
      try {
        const img = decodeImage(bytes);
        width = img.width;
        height = img.height;
        rgba = img.data;
        codecName = img.format === "jpeg" ? "mjpeg" : img.format;
      } catch {
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
                pixFmt: "rgb24"
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
    String(h).padStart(2, "0") +
    ":" +
    String(m).padStart(2, "0") +
    ":" +
    String(s).padStart(2, "0") +
    sep +
    String(milli).padStart(3, "0")
  );
}

export function isSrtSignature(bytes: Uint8Array, _filename?: string): boolean {
  if (bytes.byteLength < 15) return false;
  const head = decodeUtf8(bytes.subarray(0, Math.min(256, bytes.byteLength))).trimStart();
  return /^\d+\r?\n\d{2}:\d{2}:\d{2}[,.]\d+\s*-->\s*\d{2}:\d{2}:\d{2}[,.]\d+/.test(head);
}

export function isWebVttSignature(bytes: Uint8Array, filename?: string): boolean {
  if (filename && /\.(vtt|webvtt)$/i.test(filename)) return true;
  if (bytes.byteLength < 6) return false;
  const head = decodeUtf8(bytes.subarray(0, Math.min(64, bytes.byteLength))).replace(/^\uFEFF/, "").trimStart();
  return head.startsWith("WEBVTT");
}

export function parseSubtitleDocument(
  bytes: Uint8Array,
  format: "srt" | "webvtt"
): MediaDocument {
  if (format === "srt" && !isSrtSignature(bytes)) {
    throw new Error("Invalid SubRip input");
  }
  const text = decodeUtf8(bytes).replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  // Native WebVTT demuxing produces no cues when the header is missing.
  const blocks = format === "webvtt" && !text.startsWith("WEBVTT") ? [] : text.split(/\n\s*\n/);
  const samples: MediaSample[] = [];
  let maxEndMs = 0;

  for (const rawBlock of blocks) {
    const lines = rawBlock
      .split("\n")
      .map((l) => l.trimEnd())
      .filter((l) => l.length > 0);
    if (lines.length === 0) continue;
    if (lines[0]!.startsWith("WEBVTT") || lines[0]!.startsWith("NOTE")) continue;

    let arrowLineIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]!.includes("-->")) {
        arrowLineIdx = i;
        break;
      }
    }
    if (arrowLineIdx < 0) continue;
    const timingLine = lines[arrowLineIdx]!;
    const [leftRaw, rightWithSettings] = timingLine.split("-->");
    const rightRaw = (rightWithSettings ?? "").trim().split(/\s+/)[0] ?? "0";
    const startMs = parseSubtitleTimecodeMs(leftRaw ?? "0", format);
    const parsedEndMs = parseSubtitleTimecodeMs(rightRaw, format);
    const endMs = format === "srt" ? parsedEndMs : Math.max(startMs + 1, parsedEndMs);
    const cueText = lines.slice(arrowLineIdx + 1).join("\n").trim();
    if (!cueText) continue;

    const payload = encodeUtf8(cueText);
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
  format: "srt" | "webvtt"
): Uint8Array {
  const subTrack = doc.tracks.find((t) => t.type === "subtitle");
  const ts = subTrack?.timescale || 1000;
  const samples = subTrack?.samples ?? [];
  const lines: string[] = [];

  if (format === "webvtt") {
    lines.push("WEBVTT", "");
  }

  let cueIndex = 1;
  for (const s of samples) {
    const cueText = decodeUtf8(s.data).trim();
    if (!cueText) continue;
    const startMs = Math.round((s.pts / ts) * 1000);
    const endMs = Math.round(((s.pts + s.duration) / ts) * 1000);
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

  return encodeUtf8(lines.join("\n"));
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
  const lines = text.split("\n");
  const tags: Record<string, string> = {};
  const chapters: { id: number; startTimeSeconds: number; endTimeSeconds: number; title: string }[] = [];

  let inChapter = false;
  let tbNum = 1;
  let tbDen = 1000;
  let curStart = 0;
  let curEnd = 0;
  let curTitle = "";

  const flushChapter = () => {
    if (!inChapter) return;
    const factor = tbNum / Math.max(1, tbDen);
    chapters.push({
      id: chapters.length,
      startTimeSeconds: curStart * factor,
      endTimeSeconds: curEnd * factor,
      title: curTitle || `Chapter ${chapters.length + 1}`
    });
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith(";") || line.startsWith("#")) continue;
    if (line.toUpperCase() === "[CHAPTER]") {
      flushChapter();
      inChapter = true;
      tbNum = 1;
      tbDen = 1000;
      curStart = 0;
      curEnd = 0;
      curTitle = "";
      continue;
    }
    if (line.startsWith("[")) {
      flushChapter();
      inChapter = false;
      continue;
    }
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const val = line.slice(eq + 1).trim();
    if (inChapter) {
      const kUp = key.toUpperCase();
      if (kUp === "TIMEBASE") {
        const [n, d] = val.split("/");
        tbNum = parseInt(n ?? "1", 10) || 1;
        tbDen = parseInt(d ?? "1000", 10) || 1000;
      } else if (kUp === "START") {
        curStart = parseInt(val, 10) || 0;
      } else if (kUp === "END") {
        curEnd = parseInt(val, 10) || 0;
      } else if (kUp === "TITLE") {
        curTitle = val;
      }
    } else {
      tags[key.toLowerCase()] = val;
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
      encoder: tags.encoder
    },
    chapters: chapters.length > 0 ? chapters : undefined,
    byteLength: bytes.byteLength
  };
}

export function serializeFfmetadata(doc: MediaDocument): Uint8Array {
  const lines: string[] = [";FFMETADATA1"];
  const m = doc.metadata;
  if (m.title) lines.push(`title=${m.title}`);
  if (m.artist) lines.push(`artist=${m.artist}`);
  if (m.album) lines.push(`album=${m.album}`);
  if (m.date) lines.push(`date=${m.date}`);
  if (m.comment) lines.push(`comment=${m.comment}`);
  if (m.genre) lines.push(`genre=${m.genre}`);
  if (m.encoder) lines.push(`encoder=${m.encoder}`);

  if (doc.chapters && doc.chapters.length > 0) {
    for (const ch of doc.chapters) {
      lines.push("", "[CHAPTER]", "TIMEBASE=1/1000");
      lines.push(`START=${Math.round(ch.startTimeSeconds * 1000)}`);
      lines.push(`END=${Math.round(ch.endTimeSeconds * 1000)}`);
      lines.push(`title=${ch.title}`);
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
    mp3Ast(),
    flacAst(),
    oggAst(),
    gifAst(),
    image2Ast(),
    srtAst(),
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
      // Finally fall back to extension match if registered
      if (filename) {
        return this.findByFilename(filename);
      }
      return undefined;
    }
  };
}
