import { readWavHeader, readWavSourceHeader, readWavStreamHeader, type WavHeader } from "./wav-header.js";
import { parseAudio } from "@poe-code/audio-ast";
import { decodeH264Samples } from "../h264.js";
import { encodeFlacPackets } from "./flac.js";

import { parseStreamingDocument, serializeDashDocument } from "./streaming.js";
import { serializeOgg, extractOggFlac } from "./ogg.js";
import { decodeImage, encodeImage, type ImageFormat } from "@poe-code/image-ast/portable";
import {
  BinaryReader,
  BinaryWriter,
  concatBytes,
  decodeFourCC,
  decodeUtf8,
  encodeUtf8,
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
  if (vTrack.decodedVideoFrames && vTrack.decodedVideoFrames.length > 0) {
    const dur = vTrack.decodedVideoFrames[0]!.durationSeconds || 0.1;
    return {
      frames: [...vTrack.decodedVideoFrames],
      width,
      height,
      fps: Math.max(1, Math.round(1 / dur))
    };
  }
  const ts = vTrack.timescale || 90000;
  const frames: MediaVideoFrame[] = [];
  for (const frame of decodeH264Samples(vTrack.samples, vTrack.codecDescriptions, width, height, ts)) {
    frames.push(frame);
    if (maxFrames !== undefined && frames.length >= maxFrames) break;
  }
  const fps =
    frames.length > 0 && doc.durationSeconds > 0
      ? Math.max(1, Math.round(frames.length / doc.durationSeconds))
      : 30;
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

const wavPacketFrames = 1024;

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
    decodedAudio = { sampleRate, channels, channelData };
  }

  const samples: MediaSample[] = [];
  const chunkFrames = wavPacketFrames;
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

export function serializeWav(doc: MediaDocument): Uint8Array {
  const audioTrack = doc.tracks.find((t) => t.type === "audio");
  const sampleRate = audioTrack?.codecDescriptions[0]?.sampleRate ?? audioTrack?.timescale ?? 44100;
  const channels = audioTrack?.codecDescriptions[0]?.channels ?? 2;
  const bitsPerSample = 16;

  let pcmBytes: Uint8Array;
  if (audioTrack?.decodedAudio) {
    const chData = audioTrack.decodedAudio.channelData;
    const numSamples = chData[0]?.length ?? Math.round(doc.durationSeconds * sampleRate);
    pcmBytes = new Uint8Array(numSamples * channels * 2);
    const pView = new DataView(pcmBytes.buffer);
    for (let i = 0; i < numSamples; i++) {
      for (let c = 0; c < channels; c++) {
        const val = Math.max(-1, Math.min(1, chData[c]?.[i] ?? 0));
        pView.setInt16((i * channels + c) * 2, Math.round(val * 32767), true);
      }
    }
  } else if (
    audioTrack &&
    audioTrack.samples.length > 0 &&
    audioTrack.codecDescriptions[0]?.codecName.startsWith("pcm_")
  ) {
    pcmBytes = concatBytes(audioTrack.samples.map((s) => s.data));
  } else {
    const numSamples = Math.max(1024, Math.round((doc.durationSeconds || 1) * sampleRate));
    pcmBytes = new Uint8Array(numSamples * channels * 2);
  }

  const writer = new BinaryWriter(44 + pcmBytes.byteLength);
  writer.writeFourCC("RIFF");
  writer.writeU32LE(36 + pcmBytes.byteLength);
  writer.writeFourCC("WAVE");
  writer.writeFourCC("fmt ");
  writer.writeU32LE(16);
  writer.writeU16LE(1); // PCM
  writer.writeU16LE(channels);
  writer.writeU32LE(sampleRate);
  writer.writeU32LE(sampleRate * channels * (bitsPerSample >>> 3));
  writer.writeU16LE(channels * (bitsPerSample >>> 3));
  writer.writeU16LE(bitsPerSample);
  writer.writeFourCC("data");
  writer.writeU32LE(pcmBytes.byteLength);
  writer.writeBytes(pcmBytes);
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
    nb_frames: String(Math.ceil(samples / wavPacketFrames)),
    bit_rate: doc.durationSeconds > 0
      ? String(Math.round(samples * bytesPerFrame * 8 / doc.durationSeconds)) : "0"
  }] };
}

function wavRecords(header: WavHeader, options: MediaSourceProbeOptions): MediaProbeRecords {
  const metadata = wavMetadata(header, options.filename), stream = metadata.streams[0]!;
  const bytesPerFrame = Math.max(1, header.channels * (header.bitsPerSample >>> 3));
  const samples = Math.floor(header.dataSize / bytesPerFrame), rate = Math.max(1, header.sampleRate);
  function* spans() {
    for (let pts = 0; pts < samples; pts += wavPacketFrames) {
      options.signal?.throwIfAborted();
      const count = Math.min(wavPacketFrames, samples - pts);
      yield { pts, count, size: String(count * bytesPerFrame), time: (pts / rate).toFixed(6), duration: (count / rate).toFixed(6) };
    }
    options.signal?.throwIfAborted();
  }
  return { ...metadata,
    packets: options.showPackets ? { *[Symbol.iterator]() {
      for (const s of spans()) yield { codec_type: "audio" as const, stream_index: 0, pts: s.pts, pts_time: s.time,
        dts: s.pts, dts_time: s.time, duration: s.count, duration_time: s.duration, size: s.size,
        pos: String(s.pts * bytesPerFrame), flags: "K_" };
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
    supportedAudioCodecs: ["pcm_s16le", "pcm_u8"],
    detect(bytes, filename) {
      if (isWavSignature(bytes)) return true;
      if (filename && filename.toLowerCase().endsWith(".wav")) return isWavSignature(bytes);
      return false;
    },
    parse(bytes, options) {
      return parseWav(bytes, options);
    },
    serialize(doc) {
      return serializeWav(doc);
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

export function mp3Ast(): MediaAstPlugin {
  return {
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
      const sampleRate = 44100;
      const channels = 2;
      const numFrames = Math.max(1, Math.floor(bytes.byteLength / 417));
      const samples: MediaSample[] = [];
      for (let i = 0; i < numFrames; i++) {
        const start = Math.min(bytes.byteLength, i * 417);
        const end = Math.min(bytes.byteLength, start + 417);
        samples.push({
          data: bytes.subarray(start, end),
          dts: i * 1152,
          pts: i * 1152,
          cts: 0,
          duration: 1152,
          size: end - start,
          isKeyframe: true,
          sampleDescriptionIndex: 1
        });
      }
      return {
        containerFormat: "mp3",
        timescale: sampleRate,
        duration: numFrames * 1152,
        durationSeconds: (numFrames * 1152) / sampleRate,
        tracks: [
          {
            id: 1,
            type: "audio",
            handlerType: "soun",
            timescale: sampleRate,
            duration: numFrames * 1152,
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
        byteLength: bytes.byteLength
      };
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
    probe(bytes, options) {
      const doc = this.parse(bytes, options);
      return buildProbeResultFromDoc(doc, bytes.byteLength, options?.filename ?? "input.mp3", {
        ...options,
        formatName: "mp3",
        formatLongName: "MP2/3 (MPEG audio layer 2/3)"
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

export function flacAst(): MediaAstPlugin {
  return {
    async probeMetadata(source, options = {}) {
      options.signal?.throwIfAborted();
      if (!Number.isSafeInteger(source.size) || source.size < 0) throw new RangeError("Invalid FLAC source size");
      const header = new Uint8Array(Math.min(42, source.size));
      for (let offset = 0; offset < header.length;) {
        const chunk = await source.read(offset, header.length - offset);
        options.signal?.throwIfAborted();
        if (!chunk.length) throw new Error("Unexpected end of FLAC source");
        if (chunk.length > header.length - offset) throw new Error("FLAC source returned more bytes than requested");
        header.set(chunk, offset); offset += chunk.length;
      }
      return buildProbeResultFromDoc(flacDocument(header, source.size), source.size, options.filename ?? "input.flac", {
        ...options, formatName: "flac", formatLongName: "raw FLAC"
      });
    },
    async probeMetadataStream(source, options = {}) {
      options.signal?.throwIfAborted();
      const header = new Uint8Array(42);
      let size = 0;
      for await (const chunk of source) {
        options.signal?.throwIfAborted();
        if (size < header.length) header.set(chunk.subarray(0, header.length - size), size);
        size += chunk.length;
        if (!Number.isSafeInteger(size)) throw new RangeError("Invalid FLAC source size");
      }
      options.signal?.throwIfAborted();
      return buildProbeResultFromDoc(flacDocument(header.subarray(0, Math.min(size, header.length)), size), size, options.filename ?? "input.flac", {
        ...options, formatName: "flac", formatLongName: "raw FLAC"
      });
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
      const doc = this.parse(bytes, options);
      return buildProbeResultFromDoc(doc, bytes.byteLength, options?.filename ?? "input.flac", {
        ...options,
        formatName: "flac",
        formatLongName: "raw FLAC"
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
                data: bytes,
                dts: 0,
                pts: 0,
                cts: 0,
                duration: totalSamples,
                size: bytes.byteLength,
                isKeyframe: true,
                sampleDescriptionIndex: 1
              }
            ]
          }
        ],
        metadata: {},
        byteLength: bytes.byteLength
      };
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
      let width = 64;
      let height = 64;
      let rgba: Uint8Array = new Uint8Array(64 * 64 * 4).fill(200);
      try {
        const img = decodeImage(bytes);
        width = img.width;
        height = img.height;
        rgba = img.data;
      } catch {
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        width = bytes.byteLength >= 10 ? view.getUint16(6, true) || 64 : 64;
        height = bytes.byteLength >= 10 ? view.getUint16(8, true) || 64 : 64;
        rgba = new Uint8Array(width * height * 4).fill(200);
      }
      return {
        containerFormat: "gif",
        timescale: 100,
        duration: 100,
        durationSeconds: 1.0,
        tracks: [
          {
            id: 1,
            type: "video",
            handlerType: "vide",
            timescale: 100,
            duration: 100,
            language: "und",
            enabled: true,
            width,
            height,
            codecDescriptions: [
              {
                formatFourCC: "gif ",
                codecName: "gif",
                width,
                height,
                pixFmt: "rgb8"
              }
            ],
            samples: [
              {
                data: bytes,
                dts: 0,
                pts: 0,
                cts: 0,
                duration: 100,
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
                durationSeconds: 1.0,
                keyframe: true
              }
            ]
          }
        ],
        metadata: {},
        byteLength: bytes.byteLength
      };
    },
    serialize(doc) {
      const { frames, width, height } = extractVideoFramesFromDoc(doc);
      const first = frames[0]?.data ?? new Uint8Array(width * height * 4);
      return encodeImage(makeRgbaImage(width, height, first), { format: "gif" }).data;
    },
    probe(bytes, options) {
      const doc = this.parse(bytes, options);
      return buildProbeResultFromDoc(doc, bytes.byteLength, options?.filename ?? "input.gif", {
        ...options,
        formatName: "gif",
        formatLongName: "CompuServe Graphics Interchange Format (GIF)"
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

function parseSubtitleTimecodeMs(raw: string): number {
  const clean = raw.trim().replace(",", ".");
  const parts = clean.split(":");
  if (parts.length === 3) {
    const h = parseInt(parts[0] ?? "0", 10) || 0;
    const m = parseInt(parts[1] ?? "0", 10) || 0;
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

export function isSrtSignature(bytes: Uint8Array, filename?: string): boolean {
  if (filename && filename.toLowerCase().endsWith(".srt")) return true;
  if (bytes.byteLength < 15) return false;
  const head = decodeUtf8(bytes.subarray(0, Math.min(256, bytes.byteLength))).trimStart();
  return /^\d+\r?\n\d{2}:\d{2}:\d{2}[,.]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[,.]\d{3}/.test(head);
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
  const text = decodeUtf8(bytes).replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const blocks = text.split(/\n\s*\n/);
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
    const startMs = parseSubtitleTimecodeMs(leftRaw ?? "0");
    const endMs = Math.max(startMs + 1, parseSubtitleTimecodeMs(rightRaw));
    const cueText = lines.slice(arrowLineIdx + 1).join("\n").trim();
    if (!cueText) continue;

    const payload = encodeUtf8(cueText);
    const duration = Math.max(1, endMs - startMs);
    if (endMs > maxEndMs) maxEndMs = endMs;

    samples.push({
      data: payload,
      dts: startMs,
      pts: startMs,
      cts: 0,
      duration,
      size: payload.byteLength,
      isKeyframe: true,
      sampleDescriptionIndex: 1
    });
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
    lines.push(`${formatSubtitleTimecode(startMs, sep)} --> ${formatSubtitleTimecode(endMs, sep)}`);
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
