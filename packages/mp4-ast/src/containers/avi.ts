import {
  BinaryReader,
  BinaryWriter,
  concatBytes,
  decodeFourCC,
  decodeUtf8,
  encodeUtf8
} from "../binary.js";
import {
  annexBToAvcc,
  avccToAnnexB,
  buildAudioSpecificConfig,
  buildAvcC,
  buildEsdsBox,
  buildH264SpsPps,
  createSilentAacFrame,
  decodeH264FrameToRgba,
  encodeH264IdrFrame,
  parseAudioSpecificConfig,
  parseAvcC,
  parseH264Sps
} from "../codecs.js";
import {
  buildProbeResultFromDoc,
  concatMp4,
  sliceMp4
} from "../mp4.js";
import {
  MediaBudgetTracker,
  type MediaAstPlugin,
  type MediaCodecDescription,
  type MediaDocument,
  type MediaProbeResult,
  type MediaSample,
  type MediaTrack,
  type MediaVideoFrame,
  type ParseMediaOptions,
  type SerializeMediaOptions
} from "../types.js";

export function isAviSignature(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= 12 &&
    decodeFourCC(bytes, 0) === "RIFF" &&
    decodeFourCC(bytes, 8) === "AVI "
  );
}

export function isFlvSignature(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= 9 &&
    bytes[0] === 0x46 && // 'F'
    bytes[1] === 0x4c && // 'L'
    bytes[2] === 0x56 && // 'V'
    bytes[3] === 0x01
  );
}

export function parseAvi(bytes: Uint8Array, options: ParseMediaOptions = {}): MediaDocument {
  const budget = options.budget ?? new MediaBudgetTracker(options.limits);
  budget.checkInputBytes(bytes.byteLength);

  if (!isAviSignature(bytes)) {
    throw new Error("Invalid AVI file: missing RIFF AVI header");
  }

  let microSecPerFrame = 33333;
  let width = 320;
  let height = 240;

  interface AviStreamInfo {
    fccType: string;
    fccHandler: string;
    scale: number;
    rate: number;
    width?: number;
    height?: number;
    sampleRate?: number;
    channels?: number;
    bitsPerSample?: number;
    formatTag?: number;
    extradata?: Uint8Array;
  }

  const streamInfos: AviStreamInfo[] = [];
  const samplesByStream = new Map<number, MediaSample[]>();

  function walkChunks(start: number, end: number): void {
    let pos = start;
    while (pos + 8 <= end) {
      const view = new DataView(bytes.buffer, bytes.byteOffset + pos, end - pos);
      const fourcc = decodeFourCC(bytes, pos);
      const chunkSize = view.getUint32(4, true);
      const payloadStart = pos + 8;
      const payloadEnd = Math.min(end, payloadStart + chunkSize);

      if (fourcc === "LIST" && payloadStart + 4 <= payloadEnd) {
        const listType = decodeFourCC(bytes, payloadStart);
        if (listType === "hdrl" || listType === "strl" || listType === "movi") {
          walkChunks(payloadStart + 4, payloadEnd);
        }
      } else if (fourcc === "avih" && chunkSize >= 40) {
        microSecPerFrame = view.getUint32(8, true) || 33333;
        width = view.getUint32(8 + 32, true) || width;
        height = view.getUint32(8 + 36, true) || height;
      } else if (fourcc === "strh" && chunkSize >= 48) {
        const fccType = decodeFourCC(bytes, payloadStart);
        const fccHandler = decodeFourCC(bytes, payloadStart + 4);
        const scale = view.getUint32(payloadStart - pos + 20, true) || 1;
        const rate = view.getUint32(payloadStart - pos + 24, true) || 30;
        streamInfos.push({ fccType, fccHandler, scale, rate });
      } else if (fourcc === "strf" && streamInfos.length > 0) {
        const cur = streamInfos[streamInfos.length - 1]!;
        if (cur.fccType === "vids" && chunkSize >= 40) {
          cur.width = view.getInt32(payloadStart - pos + 4, true) || width;
          cur.height = Math.abs(view.getInt32(payloadStart - pos + 8, true)) || height;
          const compFourcc = decodeFourCC(bytes, payloadStart + 16);
          if (compFourcc.trim()) cur.fccHandler = compFourcc;
          if (chunkSize > 40) {
            cur.extradata = bytes.subarray(payloadStart + 40, payloadEnd);
          }
        } else if (cur.fccType === "auds" && chunkSize >= 14) {
          cur.formatTag = view.getUint16(payloadStart - pos + 0, true);
          cur.channels = view.getUint16(payloadStart - pos + 2, true) || 2;
          cur.sampleRate = view.getUint32(payloadStart - pos + 4, true) || 44100;
          cur.bitsPerSample = view.getUint16(payloadStart - pos + 14, true) || 16;
          if (chunkSize > 18) {
            cur.extradata = bytes.subarray(payloadStart + 18, payloadEnd);
          }
        }
      } else if (/^\d\d(dc|db|wb)$/.test(fourcc)) {
        const streamIdx = parseInt(fourcc.slice(0, 2), 10);
        let list = samplesByStream.get(streamIdx);
        if (!list) {
          list = [];
          samplesByStream.set(streamIdx, list);
        }
        const chunkData = bytes.subarray(payloadStart, payloadEnd);
        const idx = list.length;
        list.push({
          data: chunkData,
          dts: idx,
          pts: idx,
          cts: 0,
          duration: 1,
          size: chunkData.byteLength,
          isKeyframe: fourcc.endsWith("db") || idx === 0 || fourcc.endsWith("wb"),
          sampleDescriptionIndex: 1
        });
      }

      pos = payloadEnd + (chunkSize & 1);
    }
  }

  walkChunks(12, bytes.byteLength);

  const tracks: MediaTrack[] = [];
  for (let i = 0; i < streamInfos.length; i++) {
    const info = streamInfos[i]!;
    const rawSamples = samplesByStream.get(i) ?? [];
    if (info.fccType === "vids") {
      const fps = info.rate / Math.max(1, info.scale) || Math.round(1_000_000 / microSecPerFrame);
      const timescale = 90000;
      const frameDur = Math.max(1, Math.round(timescale / Math.max(1, fps)));
      const w = info.width ?? width;
      const h = info.height ?? height;

      let allSps: Uint8Array[] = [];
      let allPps: Uint8Array[] = [];
      const directAvcC = info.extradata && info.extradata.byteLength >= 7 && info.extradata[0] === 1
        ? parseAvcC(info.extradata)
        : undefined;
      if (!directAvcC && info.extradata && info.extradata.byteLength >= 4) {
        const extConv = annexBToAvcc(info.extradata);
        if (extConv.sps.length > 0) allSps = extConv.sps;
        if (extConv.pps.length > 0) allPps = extConv.pps;
      }

      const isAnnexB = (buf: Uint8Array): boolean =>
        buf.byteLength >= 4 &&
        ((buf[0] === 0 && buf[1] === 0 && buf[2] === 0 && buf[3] === 1) ||
          (buf[0] === 0 && buf[1] === 0 && buf[2] === 1));

      const hasIdrInAvcc = (buf: Uint8Array): boolean => {
        let off = 0;
        while (off + 4 <= buf.byteLength) {
          const len = ((buf[off]! << 24) | (buf[off + 1]! << 16) | (buf[off + 2]! << 8) | buf[off + 3]!) >>> 0;
          if (len === 0 || off + 4 + len > buf.byteLength) break;
          const nalType = buf[off + 4]! & 0x1f;
          if (nalType === 5) return true;
          off += 4 + len;
        }
        return false;
      };

      const convertedSamples: MediaSample[] = [];
      let curDts = 0;
      for (let sIdx = 0; sIdx < rawSamples.length; sIdx++) {
        const s = rawSamples[sIdx]!;
        if (s.data.byteLength === 0) {
          if (convertedSamples.length > 0) {
            const prev = convertedSamples[convertedSamples.length - 1]!;
            convertedSamples[convertedSamples.length - 1] = { ...prev, duration: prev.duration + frameDur };
            curDts += frameDur;
          }
          continue;
        }
        let data = s.data;
        let isKey = s.isKeyframe || convertedSamples.length === 0;
        if (isAnnexB(s.data)) {
          const conv = annexBToAvcc(s.data);
          if (conv.sps.length > 0) allSps = conv.sps;
          if (conv.pps.length > 0) allPps = conv.pps;
          if (conv.avccData.byteLength > 0) data = conv.avccData;
          if (conv.isKeyframe) isKey = true;
        } else {
          if (hasIdrInAvcc(data)) isKey = true;
        }
        if (data.byteLength === 0) continue;
        convertedSamples.push({
          data,
          dts: curDts,
          pts: curDts,
          cts: 0,
          duration: frameDur,
          size: data.byteLength,
          isKeyframe: isKey,
          sampleDescriptionIndex: 1
        });
        curDts += frameDur;
      }

      if (!directAvcC && allSps.length === 0) {
        const gen = buildH264SpsPps(w, h, fps);
        allSps = [gen.sps];
        allPps = [gen.pps];
      }

      const avcC = directAvcC ?? parseAvcC(buildAvcC(allSps, allPps));
      const fccUpper = info.fccHandler.toUpperCase();
      const codecName =
        fccUpper.includes("MJPG") || fccUpper.includes("JPEG")
          ? "mjpeg"
          : fccUpper.includes("FMP4") || fccUpper.includes("XVID")
            ? "mpeg4"
            : "h264";

      tracks.push({
        id: i + 1,
        type: "video",
        handlerType: "vide",
        timescale,
        duration: convertedSamples.length * frameDur,
        language: "und",
        enabled: true,
        width: w,
        height: h,
        codecDescriptions: [
          {
            formatFourCC: codecName === "mjpeg" ? "jpeg" : "avc1",
            codecName,
            width: w,
            height: h,
            pixFmt: "yuv420p",
            avcC
          }
        ],
        samples: convertedSamples,
        decodedVideoFrames: options.decodeFrames
          ? convertedSamples.map((s) => ({
              width: w,
              height: h,
              data: decodeH264FrameToRgba(s.data, w, h, 4),
              ptsSeconds: s.pts / timescale,
              durationSeconds: s.duration / timescale,
              keyframe: s.isKeyframe
            }))
          : undefined
      });
    } else if (info.fccType === "auds") {
      const sampleRate = info.sampleRate ?? 44100;
      const channels = info.channels ?? 2;
      const codecName =
        info.formatTag === 0x0055
          ? "mp3"
          : info.formatTag === 0x00ff
            ? "aac"
            : "pcm_s16le";
      const nonEmptyAudio = rawSamples.filter((s) => s.data.byteLength > 0);
      const samples = nonEmptyAudio.map((s, idx) => {
        let payload = s.data;
        if (
          codecName === "aac" &&
          payload.byteLength > 7 &&
          payload[0] === 0xff &&
          (payload[1]! & 0xf0) === 0xf0
        ) {
          const hdrLen = (payload[1]! & 0x01) === 0 ? 9 : 7;
          if (payload.byteLength > hdrLen) payload = payload.subarray(hdrLen);
        }
        return {
          ...s,
          data: payload,
          size: payload.byteLength,
          dts: idx * 1024,
          pts: idx * 1024,
          duration: 1024
        };
      });
      tracks.push({
        id: i + 1,
        type: "audio",
        handlerType: "soun",
        timescale: sampleRate,
        duration: samples.length * 1024,
        language: "und",
        enabled: true,
        codecDescriptions: [
          {
            formatFourCC: codecName === "aac" ? "mp4a" : codecName === "mp3" ? ".mp3" : "sowt",
            codecName,
            sampleRate,
            channels,
            bitsPerSample: info.bitsPerSample ?? 16
          }
        ],
        samples
      });
    }
  }

  let maxSec = 0;
  for (const t of tracks) {
    const sec = t.duration / Math.max(1, t.timescale);
    if (sec > maxSec) maxSec = sec;
  }

  return {
    containerFormat: "avi",
    timescale: 1000,
    duration: Math.round(maxSec * 1000),
    durationSeconds: maxSec,
    tracks,
    metadata: {},
    byteLength: bytes.byteLength
  };
}

function makeRiffChunk(fourcc: string, payload: Uint8Array): Uint8Array {
  const pad = payload.byteLength & 1;
  const out = new Uint8Array(8 + payload.byteLength + pad);
  const view = new DataView(out.buffer);
  for (let i = 0; i < 4; i++) out[i] = fourcc.charCodeAt(i) & 0xff;
  view.setUint32(4, payload.byteLength, true);
  out.set(payload, 8);
  return out;
}

function makeRiffList(listType: string, children: readonly Uint8Array[]): Uint8Array {
  const typeBytes = new Uint8Array(4);
  for (let i = 0; i < 4; i++) typeBytes[i] = listType.charCodeAt(i) & 0xff;
  const body = concatBytes([typeBytes, ...children]);
  return makeRiffChunk("LIST", body);
}

export function serializeAvi(doc: MediaDocument, options: SerializeMediaOptions = {}): Uint8Array {
  void options;
  const videoTrack = doc.tracks.find((t) => t.type === "video");
  const audioTrack = doc.tracks.find((t) => t.type === "audio");

  const width = videoTrack?.width ?? 320;
  const height = videoTrack?.height ?? 240;
  let vSamples = videoTrack?.samples ?? [];
  if (vSamples.length === 0 && videoTrack?.decodedVideoFrames?.length) {
    vSamples = videoTrack.decodedVideoFrames.map((vf, idx) => {
      const encoded = encodeH264IdrFrame(vf.data, width, height, idx);
      return {
        data: encoded,
        dts: idx * 3000,
        pts: idx * 3000,
        cts: 0,
        duration: 3000,
        size: encoded.byteLength,
        isKeyframe: true,
        sampleDescriptionIndex: 1
      };
    });
  }

  const fps =
    vSamples.length > 0 && doc.durationSeconds > 0
      ? Math.max(1, Math.round(vSamples.length / doc.durationSeconds))
      : 30;
  const microSecPerFrame = Math.round(1_000_000 / fps);

  const avih = new BinaryWriter(56);
  avih.writeU32LE(microSecPerFrame);
  avih.writeU32LE(100000);
  avih.writeU32LE(0);
  avih.writeU32LE(0x10); // AVIF_HASINDEX
  avih.writeU32LE(vSamples.length);
  avih.writeU32LE(0);
  avih.writeU32LE((videoTrack ? 1 : 0) + (audioTrack ? 1 : 0));
  avih.writeU32LE(width * height * 3);
  avih.writeU32LE(width);
  avih.writeU32LE(height);
  avih.writeZeros(16);

  const strlLists: Uint8Array[] = [];
  if (videoTrack) {
    const strh = new BinaryWriter(56);
    strh.writeFourCC("vids");
    strh.writeFourCC("H264");
    strh.writeU32LE(0);
    strh.writeU16LE(0);
    strh.writeU16LE(0);
    strh.writeU32LE(0);
    strh.writeU32LE(1); // scale
    strh.writeU32LE(fps); // rate
    strh.writeU32LE(0);
    strh.writeU32LE(vSamples.length);
    strh.writeU32LE(width * height * 3);
    strh.writeU32LE(0xffffffff);
    strh.writeU32LE(0);
    strh.writeU16LE(0);
    strh.writeU16LE(0);
    strh.writeU16LE(width);
    strh.writeU16LE(height);

    const strf = new BinaryWriter(40);
    strf.writeU32LE(40);
    strf.writeI32LE(width);
    strf.writeI32LE(height);
    strf.writeU16LE(1);
    strf.writeU16LE(24);
    strf.writeFourCC("H264");
    strf.writeU32LE(width * height * 3);
    strf.writeZeros(16);

    strlLists.push(
      makeRiffList("strl", [
        makeRiffChunk("strh", strh.toUint8Array()),
        makeRiffChunk("strf", strf.toUint8Array())
      ])
    );
  }

  if (audioTrack) {
    const sr = audioTrack.codecDescriptions[0]?.sampleRate ?? 44100;
    const ch = audioTrack.codecDescriptions[0]?.channels ?? 2;
    const strh = new BinaryWriter(56);
    strh.writeFourCC("auds");
    strh.writeU32LE(0);
    strh.writeU32LE(0);
    strh.writeU16LE(0);
    strh.writeU16LE(0);
    strh.writeU32LE(0);
    strh.writeU32LE(1024);
    strh.writeU32LE(sr);
    strh.writeU32LE(0);
    strh.writeU32LE(Math.max(1, audioTrack.samples.length));
    strh.writeU32LE(4096);
    strh.writeU32LE(0xffffffff);
    strh.writeU32LE(0);
    strh.writeZeros(8);

    const strf = new BinaryWriter(18);
    strf.writeU16LE(0x00ff); // AAC
    strf.writeU16LE(ch);
    strf.writeU32LE(sr);
    strf.writeU32LE(16000);
    strf.writeU16LE(4);
    strf.writeU16LE(16);
    strf.writeU16LE(0);

    strlLists.push(
      makeRiffList("strl", [
        makeRiffChunk("strh", strh.toUint8Array()),
        makeRiffChunk("strf", strf.toUint8Array())
      ])
    );
  }

  const hdrlList = makeRiffList("hdrl", [
    makeRiffChunk("avih", avih.toUint8Array()),
    ...strlLists
  ]);

  const moviChunks: Uint8Array[] = [];
  const idx1Writer = new BinaryWriter(vSamples.length * 16 + 64);
  let moviOffset = 4;

  const desc = videoTrack?.codecDescriptions[0];
  const { sps: defSps, pps: defPps } = buildH264SpsPps(width, height, fps);
  const spsList = desc?.avcC?.sps.length ? desc.avcC.sps : [defSps];
  const ppsList = desc?.avcC?.pps.length ? desc.avcC.pps : [defPps];
  const lengthSize = (desc?.avcC?.lengthSizeMinusOne ?? 3) + 1;

  for (let i = 0; i < vSamples.length; i++) {
    const s = vSamples[i]!;
    const annexB = avccToAnnexB(
      s.data,
      lengthSize,
      s.isKeyframe || i === 0 ? { sps: spsList, pps: ppsList } : undefined
    );
    const chunk = makeRiffChunk("00dc", annexB);
    moviChunks.push(chunk);
    idx1Writer.writeFourCC("00dc");
    idx1Writer.writeU32LE(s.isKeyframe ? 0x10 : 0x00);
    idx1Writer.writeU32LE(moviOffset);
    idx1Writer.writeU32LE(annexB.byteLength);
    moviOffset += chunk.byteLength;
  }

  if (audioTrack) {
    const aSamples =
      audioTrack.samples.length > 0
        ? audioTrack.samples
        : [
            {
              data: createSilentAacFrame(2),
              dts: 0,
              pts: 0,
              cts: 0,
              duration: 1024,
              size: 6,
              isKeyframe: true,
              sampleDescriptionIndex: 1
            }
          ];
    for (const s of aSamples) {
      const chunk = makeRiffChunk("01wb", s.data);
      moviChunks.push(chunk);
      idx1Writer.writeFourCC("01wb");
      idx1Writer.writeU32LE(0x10);
      idx1Writer.writeU32LE(moviOffset);
      idx1Writer.writeU32LE(s.data.byteLength);
      moviOffset += chunk.byteLength;
    }
  }

  const moviList = makeRiffList("movi", moviChunks);
  const idx1Chunk = makeRiffChunk("idx1", idx1Writer.toUint8Array());

  const riffBody = concatBytes([
    encodeUtf8("AVI "),
    hdrlList,
    moviList,
    idx1Chunk
  ]);
  return makeRiffChunk("RIFF", riffBody);
}

export function probeAvi(
  bytes: Uint8Array,
  options: ParseMediaOptions & { showPackets?: boolean; showFrames?: boolean } = {}
): MediaProbeResult {
  const doc = parseAvi(bytes, options);
  return buildProbeResultFromDoc(doc, bytes.byteLength, options.filename ?? "input.avi", {
    ...options,
    formatName: "avi",
    formatLongName: "AVI (Audio Video Interleaved)"
  });
}

export function aviAst(): MediaAstPlugin {
  return {
    id: "avi",
    formatName: "avi",
    formatLongName: "AVI (Audio Video Interleaved)",
    extensions: ["avi"],
    mimeTypes: ["video/x-msvideo"],
    canDemux: true,
    canMux: true,
    supportedVideoCodecs: ["h264", "mpeg4", "mjpeg", "rawvideo"],
    supportedAudioCodecs: ["mp3", "aac", "pcm_s16le"],
    detect(bytes, filename) {
      if (isAviSignature(bytes)) return true;
      if (filename && filename.toLowerCase().endsWith(".avi") && bytes.byteLength >= 12) {
        return isAviSignature(bytes);
      }
      return false;
    },
    parse(bytes, options) {
      return parseAvi(bytes, options);
    },
    serialize(doc, options) {
      return serializeAvi(doc, options);
    },
    probe(bytes, options) {
      return probeAvi(bytes, options);
    },
    concat(docs, options) {
      return concatMp4(docs, options);
    },
    slice(doc, options) {
      return sliceMp4(doc, options);
    }
  };
}

// --- FLV (Flash Video) Container ---

export function parseFlv(bytes: Uint8Array, options: ParseMediaOptions = {}): MediaDocument {
  const budget = options.budget ?? new MediaBudgetTracker(options.limits);
  budget.checkInputBytes(bytes.byteLength);

  if (!isFlvSignature(bytes)) {
    throw new Error("Invalid FLV file: missing FLV header signature");
  }

  const reader = new BinaryReader(bytes);
  reader.skip(4); // 'FLV\x01'
  reader.readU8(); // flags
  const dataOffset = reader.readU32BE();
  reader.seek(dataOffset + 4); // skip PreviousTagSize0

  let avcC: ReturnType<typeof parseAvcC> | undefined;
  let asc = { audioObjectType: 2, sampleRate: 44100, channelCount: 2 };
  const videoSamples: MediaSample[] = [];
  const audioSamples: MediaSample[] = [];
  let width = 320;
  let height = 240;

  while (reader.remaining >= 11) {
    const tagType = reader.readU8();
    const dataSize = reader.readU24BE();
    const tsLow = reader.readU24BE();
    const tsHigh = reader.readU8();
    const timestampMs = ((tsHigh << 24) | tsLow) >>> 0;
    reader.skip(3); // StreamID

    const tagData = reader.readSlice(dataSize);
    reader.skip(4); // PreviousTagSizeN

    if (tagType === 9 && tagData.byteLength >= 5) {
      // Video tag
      const frameAndCodec = tagData[0]!;
      const frameType = (frameAndCodec >>> 4) & 0x0f;
      const codecId = frameAndCodec & 0x0f;
      if (codecId === 7) {
        // AVC
        const avcPacketType = tagData[1]!;
        const ctsMs =
          ((tagData[2]! << 24) >> 8) | (tagData[3]! << 8) | tagData[4]!;
        const payload = tagData.subarray(5);
        if (avcPacketType === 0 && payload.byteLength >= 7) {
          avcC = parseAvcC(payload);
          if (avcC.sps[0]) {
            const sps = parseH264Sps(avcC.sps[0]);
            width = sps.width || width;
            height = sps.height || height;
          }
        } else if (avcPacketType === 1 && payload.byteLength > 0) {
          videoSamples.push({
            data: payload,
            dts: timestampMs,
            pts: timestampMs + ctsMs,
            cts: ctsMs,
            duration: 33,
            size: payload.byteLength,
            isKeyframe: frameType === 1,
            sampleDescriptionIndex: 1
          });
        }
      }
    } else if (tagType === 8 && tagData.byteLength >= 2) {
      // Audio tag
      const soundFormat = (tagData[0]! >>> 4) & 0x0f;
      if (soundFormat === 10) {
        // AAC
        const aacPacketType = tagData[1]!;
        const payload = tagData.subarray(2);
        if (aacPacketType === 0 && payload.byteLength >= 2) {
          asc = parseAudioSpecificConfig(payload);
        } else if (aacPacketType === 1 && payload.byteLength > 0) {
          audioSamples.push({
            data: payload,
            dts: timestampMs,
            pts: timestampMs,
            cts: 0,
            duration: 23,
            size: payload.byteLength,
            isKeyframe: true,
            sampleDescriptionIndex: 1
          });
        }
      }
    }
  }

  for (let i = 0; i < videoSamples.length; i++) {
    const next = videoSamples[i + 1];
    const dur = next ? Math.max(1, next.dts - videoSamples[i]!.dts) : 33;
    videoSamples[i] = { ...videoSamples[i]!, duration: dur };
  }

  const tracks: MediaTrack[] = [];
  if (videoSamples.length > 0 || avcC) {
    const totalDur = videoSamples.reduce((acc, s) => acc + s.duration, 0);
    tracks.push({
      id: 1,
      type: "video",
      handlerType: "vide",
      timescale: 1000,
      duration: totalDur,
      language: "und",
      enabled: true,
      width,
      height,
      codecDescriptions: [
        {
          formatFourCC: "avc1",
          codecName: "h264",
          width,
          height,
          pixFmt: "yuv420p",
          avcC
        }
      ],
      samples: videoSamples,
      decodedVideoFrames: options.decodeFrames
        ? videoSamples.map((s) => ({
            width,
            height,
            data: decodeH264FrameToRgba(s.data, width, height, 4),
            ptsSeconds: s.pts / 1000,
            durationSeconds: s.duration / 1000,
            keyframe: s.isKeyframe
          }))
        : undefined
    });
  }

  if (audioSamples.length > 0) {
    const totalDur = audioSamples.reduce((acc, s) => acc + s.duration, 0);
    tracks.push({
      id: tracks.length + 1,
      type: "audio",
      handlerType: "soun",
      timescale: 1000,
      duration: totalDur,
      language: "und",
      enabled: true,
      codecDescriptions: [
        {
          formatFourCC: "mp4a",
          codecName: "aac",
          sampleRate: asc.sampleRate,
          channels: asc.channelCount,
          bitsPerSample: 16
        }
      ],
      samples: audioSamples
    });
  }

  let maxSec = 0;
  for (const t of tracks) {
    const sec = t.duration / Math.max(1, t.timescale);
    if (sec > maxSec) maxSec = sec;
  }

  return {
    containerFormat: "flv",
    timescale: 1000,
    duration: Math.round(maxSec * 1000),
    durationSeconds: maxSec,
    tracks,
    metadata: {},
    byteLength: bytes.byteLength
  };
}

export function serializeFlv(doc: MediaDocument, options: SerializeMediaOptions = {}): Uint8Array {
  void options;
  const videoTrack = doc.tracks.find((t) => t.type === "video");
  const audioTrack = doc.tracks.find((t) => t.type === "audio");

  const writer = new BinaryWriter(4096);
  // FLV Header
  writer.writeU8(0x46); // 'F'
  writer.writeU8(0x4c); // 'L'
  writer.writeU8(0x56); // 'V'
  writer.writeU8(0x01); // version 1
  writer.writeU8((videoTrack ? 0x01 : 0x00) | (audioTrack ? 0x04 : 0x00));
  writer.writeU32BE(9); // DataOffset = 9
  writer.writeU32BE(0); // PreviousTagSize0 = 0

  const writeFlvTag = (tagType: number, timestampMs: number, payload: Uint8Array) => {
    const ts = Math.max(0, Math.round(timestampMs));
    writer.writeU8(tagType);
    writer.writeU24BE(payload.byteLength);
    writer.writeU24BE(ts & 0xffffff);
    writer.writeU8((ts >>> 24) & 0xff);
    writer.writeU24BE(0); // StreamID = 0
    writer.writeBytes(payload);
    writer.writeU32BE(11 + payload.byteLength);
  };

  if (videoTrack) {
    const w = videoTrack.width ?? 320;
    const h = videoTrack.height ?? 240;
    const desc = videoTrack.codecDescriptions[0];
    const avcCBytes =
      desc?.avcC?.rawBytes ??
      (() => {
        const { sps, pps } = buildH264SpsPps(w, h, 30);
        return buildAvcC([sps], [pps]);
      })();

    // AVC sequence header tag (avcPacketType = 0)
    const seqHeader = new Uint8Array(5 + avcCBytes.byteLength);
    seqHeader[0] = 0x17; // keyframe (1) + AVC (7)
    seqHeader[1] = 0x00; // AVC sequence header
    seqHeader.set(avcCBytes, 5);
    writeFlvTag(9, 0, seqHeader);

    const ts = videoTrack.timescale || 1000;
    let samples = videoTrack.samples;
    if (samples.length === 0 && videoTrack.decodedVideoFrames?.length) {
      samples = videoTrack.decodedVideoFrames.map((vf, idx) => {
        const encoded = encodeH264IdrFrame(vf.data, w, h, idx);
        return {
          data: encoded,
          dts: Math.round(vf.ptsSeconds * ts),
          pts: Math.round(vf.ptsSeconds * ts),
          cts: 0,
          duration: Math.round(vf.durationSeconds * ts),
          size: encoded.byteLength,
          isKeyframe: true,
          sampleDescriptionIndex: 1
        };
      });
    }

    for (const s of samples) {
      const dtsMs = Math.round((s.dts / ts) * 1000);
      const ctsMs = Math.round((s.cts / ts) * 1000);
      const pkt = new Uint8Array(5 + s.data.byteLength);
      pkt[0] = (s.isKeyframe ? 0x10 : 0x20) | 0x07;
      pkt[1] = 0x01; // AVC NALU
      pkt[2] = (ctsMs >>> 16) & 0xff;
      pkt[3] = (ctsMs >>> 8) & 0xff;
      pkt[4] = ctsMs & 0xff;
      pkt.set(s.data, 5);
      writeFlvTag(9, dtsMs, pkt);
    }

    // End of sequence tag
    writeFlvTag(9, Math.round(doc.durationSeconds * 1000), new Uint8Array([0x17, 0x02, 0, 0, 0]));
  }

  if (audioTrack) {
    const desc = audioTrack.codecDescriptions[0];
    const sr = desc?.sampleRate ?? 44100;
    const ch = desc?.channels ?? 2;
    const asc = desc?.esds?.decoderSpecificInfo ?? buildAudioSpecificConfig(sr, ch, 2);

    // AAC sequence header (aacPacketType = 0)
    const aacSeq = new Uint8Array(2 + asc.byteLength);
    aacSeq[0] = 0xaf; // SoundFormat=10 (AAC), 44kHz, 16-bit, stereo
    aacSeq[1] = 0x00;
    aacSeq.set(asc, 2);
    writeFlvTag(8, 0, aacSeq);

    const ts = audioTrack.timescale || sr;
    const samples =
      audioTrack.samples.length > 0
        ? audioTrack.samples
        : [
            {
              data: createSilentAacFrame(ch),
              dts: 0,
              pts: 0,
              cts: 0,
              duration: 1024,
              size: 6,
              isKeyframe: true,
              sampleDescriptionIndex: 1
            }
          ];

    for (const s of samples) {
      const dtsMs = Math.round((s.dts / ts) * 1000);
      const pkt = new Uint8Array(2 + s.data.byteLength);
      pkt[0] = 0xaf;
      pkt[1] = 0x01; // AAC raw
      pkt.set(s.data, 2);
      writeFlvTag(8, dtsMs, pkt);
    }
  }

  return writer.toUint8Array();
}

export function probeFlv(
  bytes: Uint8Array,
  options: ParseMediaOptions & { showPackets?: boolean; showFrames?: boolean } = {}
): MediaProbeResult {
  const doc = parseFlv(bytes, options);
  return buildProbeResultFromDoc(doc, bytes.byteLength, options.filename ?? "input.flv", {
    ...options,
    formatName: "flv",
    formatLongName: "FLV (Flash Video)"
  });
}

export function flvAst(): MediaAstPlugin {
  return {
    id: "flv",
    formatName: "flv",
    formatLongName: "FLV (Flash Video)",
    extensions: ["flv"],
    mimeTypes: ["video/x-flv"],
    canDemux: true,
    canMux: true,
    supportedVideoCodecs: ["h264", "flv1"],
    supportedAudioCodecs: ["aac", "mp3"],
    detect(bytes, filename) {
      if (isFlvSignature(bytes)) return true;
      if (filename && filename.toLowerCase().endsWith(".flv") && bytes.byteLength >= 9) {
        return isFlvSignature(bytes);
      }
      return false;
    },
    parse(bytes, options) {
      return parseFlv(bytes, options);
    },
    serialize(doc, options) {
      return serializeFlv(doc, options);
    },
    probe(bytes, options) {
      return probeFlv(bytes, options);
    },
    concat(docs, options) {
      return concatMp4(docs, options);
    },
    slice(doc, options) {
      return sliceMp4(doc, options);
    }
  };
}
