import {
  BinaryWriter,
  concatBytes,
  decodeUtf8,
  encodeUtf8
} from "../binary.js";
import {
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
  type MediaTrackType,
  type MediaVideoFrame,
  type Mp4MetadataTags,
  type ParseMediaOptions,
  type SerializeMediaOptions
} from "../types.js";

export function isMkvSignature(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= 4 &&
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3
  );
}

function readVint(
  bytes: Uint8Array,
  offset: number,
  stripMarker: boolean
): { value: number; length: number } | null {
  if (offset >= bytes.byteLength) return null;
  const first = bytes[offset]!;
  if (first === 0) return null;
  let length = 1;
  let mask = 0x80;
  while (length <= 8 && (first & mask) === 0) {
    length++;
    mask >>>= 1;
  }
  if (length > 8 || offset + length > bytes.byteLength) return null;
  let value = stripMarker ? first & (mask - 1) : first;
  for (let i = 1; i < length; i++) {
    value = value * 256 + bytes[offset + i]!;
  }
  return { value, length };
}

function writeVintSize(size: number): Uint8Array {
  if (size < 0x7f) {
    return new Uint8Array([0x80 | size]);
  }
  if (size < 0x3fff) {
    return new Uint8Array([0x40 | ((size >>> 8) & 0x3f), size & 0xff]);
  }
  if (size < 0x1fffff) {
    return new Uint8Array([
      0x20 | ((size >>> 16) & 0x1f),
      (size >>> 8) & 0xff,
      size & 0xff
    ]);
  }
  return new Uint8Array([
    0x10 | ((size >>> 24) & 0x0f),
    (size >>> 16) & 0xff,
    (size >>> 8) & 0xff,
    size & 0xff
  ]);
}

function writeEbmlId(id: number): Uint8Array {
  if (id <= 0xff) return new Uint8Array([id]);
  if (id <= 0xffff) return new Uint8Array([(id >>> 8) & 0xff, id & 0xff]);
  if (id <= 0xffffff) {
    return new Uint8Array([(id >>> 16) & 0xff, (id >>> 8) & 0xff, id & 0xff]);
  }
  return new Uint8Array([
    (id >>> 24) & 0xff,
    (id >>> 16) & 0xff,
    (id >>> 8) & 0xff,
    id & 0xff
  ]);
}

function makeEbmlElement(id: number, payload: Uint8Array): Uint8Array {
  const idBytes = writeEbmlId(id);
  const sizeBytes = writeVintSize(payload.byteLength);
  return concatBytes([idBytes, sizeBytes, payload]);
}

function makeEbmlUint(id: number, val: number): Uint8Array {
  const v = Math.max(0, Math.round(val));
  if (v <= 0xff) return makeEbmlElement(id, new Uint8Array([v]));
  if (v <= 0xffff) return makeEbmlElement(id, new Uint8Array([(v >>> 8) & 0xff, v & 0xff]));
  if (v <= 0xffffff) {
    return makeEbmlElement(
      id,
      new Uint8Array([(v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff])
    );
  }
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, v >>> 0, false);
  return makeEbmlElement(id, b);
}

function makeEbmlFloat(id: number, val: number): Uint8Array {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setFloat64(0, val, false);
  return makeEbmlElement(id, b);
}

function makeEbmlString(id: number, str: string): Uint8Array {
  return makeEbmlElement(id, encodeUtf8(str));
}

function readEbmlUint(payload: Uint8Array): number {
  let v = 0;
  for (let i = 0; i < payload.byteLength; i++) {
    v = v * 256 + payload[i]!;
  }
  return v;
}

function readEbmlFloat(payload: Uint8Array): number {
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  if (payload.byteLength === 4) return view.getFloat32(0, false);
  if (payload.byteLength === 8) return view.getFloat64(0, false);
  return 0;
}

interface MkvTrackInfo {
  trackNumber: number;
  trackType: number; // 1 = video, 2 = audio, 17 = subtitle
  codecId: string;
  codecPrivate?: Uint8Array;
  width?: number;
  height?: number;
  sampleRate?: number;
  channels?: number;
  bitDepth?: number;
  language?: string;
}

export function parseMkv(bytes: Uint8Array, options: ParseMediaOptions = {}): MediaDocument {
  const budget = options.budget ?? new MediaBudgetTracker(options.limits);
  budget.checkInputBytes(bytes.byteLength);

  if (!isMkvSignature(bytes)) {
    throw new Error("Invalid Matroska/WebM file: missing EBML header signature");
  }

  let docType = "matroska";
  let timecodeScale = 1_000_000; // default 1ms in nanoseconds
  let segmentDurationTicks = 0;
  let title: string | undefined;
  let encoder: string | undefined;
  const trackMap = new Map<number, MkvTrackInfo>();
  const samplesByTrack = new Map<number, MediaSample[]>();
  const tagsRecord: Record<string, string> = {};

  function parseElements(start: number, end: number, depth: number): void {
    budget.checkBoxDepth(depth);
    let pos = start;
    while (pos < end) {
      budget.checkCpu();
      const idVint = readVint(bytes, pos, false);
      if (!idVint) break;
      pos += idVint.length;
      const sizeVint = readVint(bytes, pos, true);
      if (!sizeVint) break;
      pos += sizeVint.length;

      // Handle unknown size VINT (all 1s)
      const isUnknownSize =
        (sizeVint.length === 1 && sizeVint.value === 0x7f) ||
        (sizeVint.length === 2 && sizeVint.value === 0x3fff) ||
        (sizeVint.length === 4 && sizeVint.value === 0x0fffffff) ||
        (sizeVint.length === 8 && sizeVint.value >= 0x00ffffffffffff);
      const elemEnd = isUnknownSize ? end : Math.min(end, pos + sizeVint.value);
      const payload = bytes.subarray(pos, elemEnd);

      switch (idVint.value) {
        case 0x1a45dfa3: // EBML Header
        case 0x18538067: // Segment
        case 0x1549a966: // Info
        case 0x1654ae6b: // Tracks
        case 0x1254c367: // Tags
        case 0x7373: // Tag
          parseElements(pos, elemEnd, depth + 1);
          break;

        case 0x4282: // DocType
          docType = decodeUtf8(payload).replace(/\0+$/, "");
          break;

        case 0x2ad7b1: // TimecodeScale
          timecodeScale = readEbmlUint(payload) || 1_000_000;
          break;

        case 0x4489: // Duration
          segmentDurationTicks = readEbmlFloat(payload);
          break;

        case 0x7ba9: // Title
          title = decodeUtf8(payload).replace(/\0+$/, "");
          break;

        case 0x5741: // WritingApp
          encoder = decodeUtf8(payload).replace(/\0+$/, "");
          break;

        case 0x67c8: {
          // SimpleTag
          let tagName = "";
          let tagValue = "";
          let tPos = pos;
          while (tPos < elemEnd) {
            const tid = readVint(bytes, tPos, false);
            if (!tid) break;
            tPos += tid.length;
            const tsz = readVint(bytes, tPos, true);
            if (!tsz) break;
            tPos += tsz.length;
            const tPay = bytes.subarray(tPos, Math.min(elemEnd, tPos + tsz.value));
            if (tid.value === 0x45a3) tagName = decodeUtf8(tPay).replace(/\0+$/, "");
            else if (tid.value === 0x4487) tagValue = decodeUtf8(tPay).replace(/\0+$/, "");
            tPos += tsz.value;
          }
          if (tagName && tagValue) {
            tagsRecord[tagName.toUpperCase()] = tagValue;
          }
          break;
        }

        case 0xae: {
          // TrackEntry
          const info: MkvTrackInfo = {
            trackNumber: trackMap.size + 1,
            trackType: 1,
            codecId: "V_MPEG4/ISO/AVC"
          };
          let tPos = pos;
          while (tPos < elemEnd) {
            const tid = readVint(bytes, tPos, false);
            if (!tid) break;
            tPos += tid.length;
            const tsz = readVint(bytes, tPos, true);
            if (!tsz) break;
            tPos += tsz.length;
            const tEnd = Math.min(elemEnd, tPos + tsz.value);
            const tPay = bytes.subarray(tPos, tEnd);

            if (tid.value === 0xd7) info.trackNumber = readEbmlUint(tPay);
            else if (tid.value === 0x83) info.trackType = readEbmlUint(tPay);
            else if (tid.value === 0x86) info.codecId = decodeUtf8(tPay).replace(/\0+$/, "");
            else if (tid.value === 0x63a2) info.codecPrivate = tPay;
            else if (tid.value === 0x22b59c) info.language = decodeUtf8(tPay).replace(/\0+$/, "");
            else if (tid.value === 0xe0) {
              // Video sub-elements
              let vPos = tPos;
              while (vPos < tEnd) {
                const vid = readVint(bytes, vPos, false);
                if (!vid) break;
                vPos += vid.length;
                const vsz = readVint(bytes, vPos, true);
                if (!vsz) break;
                vPos += vsz.length;
                const vPay = bytes.subarray(vPos, Math.min(tEnd, vPos + vsz.value));
                if (vid.value === 0xb0) info.width = readEbmlUint(vPay);
                else if (vid.value === 0xba) info.height = readEbmlUint(vPay);
                vPos += vsz.value;
              }
            } else if (tid.value === 0xe1) {
              // Audio sub-elements
              let aPos = tPos;
              while (aPos < tEnd) {
                const aid = readVint(bytes, aPos, false);
                if (!aid) break;
                aPos += aid.length;
                const asz = readVint(bytes, aPos, true);
                if (!asz) break;
                aPos += asz.length;
                const aPay = bytes.subarray(aPos, Math.min(tEnd, aPos + asz.value));
                if (aid.value === 0xb5) info.sampleRate = Math.round(readEbmlFloat(aPay));
                else if (aid.value === 0x9f) info.channels = readEbmlUint(aPay);
                else if (aid.value === 0x6264) info.bitDepth = readEbmlUint(aPay);
                aPos += asz.value;
              }
            }
            tPos = tEnd;
          }
          trackMap.set(info.trackNumber, info);
          if (!samplesByTrack.has(info.trackNumber)) {
            samplesByTrack.set(info.trackNumber, []);
          }
          break;
        }

        case 0x1f43b675: {
          // Cluster
          let clusterTimecode = 0;
          let cPos = pos;
          while (cPos < elemEnd) {
            const cid = readVint(bytes, cPos, false);
            if (!cid) break;
            cPos += cid.length;
            const csz = readVint(bytes, cPos, true);
            if (!csz) break;
            cPos += csz.length;
            const cEnd = Math.min(elemEnd, cPos + csz.value);
            const cPay = bytes.subarray(cPos, cEnd);

            if (cid.value === 0xe7) {
              clusterTimecode = readEbmlUint(cPay);
            } else if (cid.value === 0xa3 || cid.value === 0xa0) {
              // SimpleBlock (0xA3) or BlockGroup (0xA0)
              let blockPay = cPay;
              if (cid.value === 0xa0) {
                let bgPos = cPos;
                while (bgPos < cEnd) {
                  const bid = readVint(bytes, bgPos, false);
                  if (!bid) break;
                  bgPos += bid.length;
                  const bsz = readVint(bytes, bgPos, true);
                  if (!bsz) break;
                  bgPos += bsz.length;
                  if (bid.value === 0xa1) {
                    blockPay = bytes.subarray(bgPos, Math.min(cEnd, bgPos + bsz.value));
                    break;
                  }
                  bgPos += bsz.value;
                }
              }

              const trkVint = readVint(blockPay, 0, true);
              if (trkVint && blockPay.byteLength >= trkVint.length + 3) {
                const trackNum = trkVint.value;
                const relTimecode = new DataView(
                  blockPay.buffer,
                  blockPay.byteOffset + trkVint.length,
                  2
                ).getInt16(0, false);
                const flags = blockPay[trkVint.length + 2]!;
                const isKeyframe = cid.value === 0xa3 ? (flags & 0x80) !== 0 : true;
                const frameData = blockPay.subarray(trkVint.length + 3);
                const ptsMs = Math.max(0, clusterTimecode + relTimecode);

                let list = samplesByTrack.get(trackNum);
                if (!list) {
                  list = [];
                  samplesByTrack.set(trackNum, list);
                }
                list.push({
                  data: frameData,
                  dts: ptsMs,
                  pts: ptsMs,
                  cts: 0,
                  duration: 33, // recalculated below
                  size: frameData.byteLength,
                  isKeyframe,
                  sampleDescriptionIndex: 1
                });
              }
            }
            cPos = cEnd;
          }
          break;
        }

        default:
          break;
      }

      pos = elemEnd;
    }
  }

  parseElements(0, bytes.byteLength, 0);

  const timescale = Math.max(1, Math.round(1_000_000_000 / timecodeScale));
  const tracks: MediaTrack[] = [];

  for (const [trkNum, info] of trackMap.entries()) {
    const rawSamples = samplesByTrack.get(trkNum) ?? [];
    for (let i = 0; i < rawSamples.length; i++) {
      const cur = rawSamples[i]!;
      const next = rawSamples[i + 1];
      const dur = next ? Math.max(1, next.dts - cur.dts) : (info.trackType === 1 ? 33 : 23);
      rawSamples[i] = { ...cur, duration: dur };
    }

    const type: MediaTrackType =
      info.trackType === 1 ? "video" : info.trackType === 2 ? "audio" : "subtitle";

    let codecName = "h264";
    let formatFourCC = "avc1";
    let avcC: ReturnType<typeof parseAvcC> | undefined;
    let profile: string | undefined;
    let width = info.width;
    let height = info.height;
    let sampleRate = info.sampleRate;
    let channels = info.channels;

    if (info.codecId.includes("V_MPEG4/ISO/AVC")) {
      codecName = "h264";
      formatFourCC = "avc1";
      if (info.codecPrivate && info.codecPrivate.byteLength >= 7) {
        avcC = parseAvcC(info.codecPrivate);
        if (avcC.sps[0]) {
          const sps = parseH264Sps(avcC.sps[0]);
          profile = sps.profileName;
          width = width ?? sps.width;
          height = height ?? sps.height;
        }
      }
    } else if (info.codecId.includes("V_MPEGH/ISO/HEVC")) {
      codecName = "hevc";
      formatFourCC = "hvc1";
    } else if (info.codecId.includes("V_VP8")) {
      codecName = "vp8";
      formatFourCC = "vp08";
    } else if (info.codecId.includes("V_VP9")) {
      codecName = "vp9";
      formatFourCC = "vp09";
    } else if (info.codecId.includes("V_AV1")) {
      codecName = "av1";
      formatFourCC = "av01";
    } else if (info.codecId.includes("A_AAC")) {
      codecName = "aac";
      formatFourCC = "mp4a";
      if (info.codecPrivate && info.codecPrivate.byteLength >= 2) {
        const asc = parseAudioSpecificConfig(info.codecPrivate);
        sampleRate = sampleRate ?? asc.sampleRate;
        channels = channels ?? asc.channelCount;
      }
    } else if (info.codecId.includes("A_OPUS")) {
      codecName = "opus";
      formatFourCC = "Opus";
      sampleRate = sampleRate ?? 48000;
    } else if (info.codecId.includes("A_VORBIS")) {
      codecName = "vorbis";
      formatFourCC = "vorb";
    } else if (info.codecId.includes("A_MPEG/L3")) {
      codecName = "mp3";
      formatFourCC = ".mp3";
    } else if (info.codecId.includes("A_FLAC")) {
      codecName = "flac";
      formatFourCC = "fLaC";
    } else if (info.codecId.includes("A_PCM")) {
      codecName = "pcm_s16le";
      formatFourCC = "sowt";
    }

    const totalTrackDur =
      rawSamples.reduce((acc, s) => acc + s.duration, 0) ||
      Math.round((segmentDurationTicks * timecodeScale) / 1_000_000);

    let decodedVideoFrames: MediaVideoFrame[] | undefined;
    if (options.decodeFrames && type === "video" && width && height) {
      const lengthSize = (avcC?.lengthSizeMinusOne ?? 3) + 1;
      decodedVideoFrames = rawSamples.map((s) => ({
        width: width!,
        height: height!,
        data: decodeH264FrameToRgba(s.data, width!, height!, lengthSize),
        ptsSeconds: s.pts / timescale,
        durationSeconds: s.duration / timescale,
        keyframe: s.isKeyframe
      }));
    }

    const desc: MediaCodecDescription = {
      formatFourCC,
      codecName,
      profile,
      width,
      height,
      pixFmt: type === "video" ? "yuv420p" : undefined,
      sampleRate,
      channels,
      bitsPerSample: info.bitDepth ?? 16,
      avcC,
      esds:
        codecName === "aac"
          ? {
              objectTypeIndication: 0x40,
              audioObjectType: 2,
              sampleRate: sampleRate ?? 44100,
              channelCount: channels ?? 2,
              maxBitrate: 128000,
              avgBitrate: 128000,
              decoderSpecificInfo:
                info.codecPrivate ?? buildAudioSpecificConfig(sampleRate ?? 44100, channels ?? 2),
              rawEsdsBytes: buildEsdsBox(
                sampleRate ?? 44100,
                channels ?? 2,
                128000,
                info.codecPrivate
              ).subarray(8)
            }
          : undefined,
      extraData: info.codecPrivate
    };

    tracks.push({
      id: trkNum,
      type,
      handlerType: type === "video" ? "vide" : type === "audio" ? "soun" : "sbtl",
      timescale,
      duration: totalTrackDur,
      language: info.language ?? "und",
      enabled: true,
      width,
      height,
      codecDescriptions: [desc],
      samples: rawSamples,
      decodedVideoFrames
    });
  }

  let maxDurationSec = (segmentDurationTicks * timecodeScale) / 1_000_000_000;
  for (const t of tracks) {
    const sec = t.duration / Math.max(1, t.timescale);
    if (sec > maxDurationSec) maxDurationSec = sec;
  }

  const metadata: Mp4MetadataTags = {
    title: title ?? tagsRecord.TITLE,
    artist: tagsRecord.ARTIST,
    album: tagsRecord.ALBUM,
    date: tagsRecord.DATE ?? tagsRecord.DATE_RELEASED,
    comment: tagsRecord.COMMENT,
    genre: tagsRecord.GENRE,
    encoder: encoder ?? tagsRecord.ENCODER
  };

  return {
    containerFormat: docType === "webm" ? "webm" : "matroska",
    timescale: 1000,
    duration: Math.round(maxDurationSec * 1000),
    durationSeconds: maxDurationSec,
    tracks,
    metadata,
    byteLength: bytes.byteLength
  };
}

export function serializeMkv(
  doc: MediaDocument,
  options: SerializeMediaOptions & { webm?: boolean } = {}
): Uint8Array {
  const isWebm = options.webm === true || options.format === "webm" || doc.containerFormat === "webm";
  const docType = isWebm ? "webm" : "matroska";

  // 1. EBML Header
  const ebmlHeader = makeEbmlElement(
    0x1a45dfa3,
    concatBytes([
      makeEbmlUint(0x4286, 1), // EBMLVersion
      makeEbmlUint(0x42f7, 1), // EBMLReadVersion
      makeEbmlUint(0x42f2, 4), // EBMLMaxIDLength
      makeEbmlUint(0x42f3, 8), // EBMLMaxSizeLength
      makeEbmlString(0x4282, docType), // DocType
      makeEbmlUint(0x4287, 4), // DocTypeVersion
      makeEbmlUint(0x4285, 2) // DocTypeReadVersion
    ])
  );

  // Prepare tracks and millisecond-normalized samples
  const trackEntries: Uint8Array[] = [];
  const allBlocks: { ptsMs: number; trackNum: number; data: Uint8Array; isKeyframe: boolean }[] = [];
  let maxDurationMs = Math.round(doc.durationSeconds * 1000);

  for (let idx = 0; idx < doc.tracks.length; idx++) {
    const trk = doc.tracks[idx]!;
    const trackNum = idx + 1;
    const ts = trk.timescale || 1000;

    let samples = trk.samples;
    let desc = trk.codecDescriptions[0];

    if (samples.length === 0 && trk.type === "video" && trk.decodedVideoFrames?.length) {
      const w = trk.width ?? trk.decodedVideoFrames[0]!.width;
      const h = trk.height ?? trk.decodedVideoFrames[0]!.height;
      const { sps, pps } = buildH264SpsPps(w, h, 30);
      const avcCBytes = buildAvcC([sps], [pps]);
      desc = {
        formatFourCC: "avc1",
        codecName: "h264",
        width: w,
        height: h,
        avcC: parseAvcC(avcCBytes)
      };
      samples = trk.decodedVideoFrames.map((vf, fIdx) => {
        const encoded = encodeH264IdrFrame(vf.data, w, h, fIdx);
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
    } else if (samples.length === 0 && trk.type === "audio" && trk.decodedAudio) {
      const sr = trk.decodedAudio.sampleRate || 44100;
      const ch = trk.decodedAudio.channels || 2;
      const rawAac = createSilentAacFrame(ch);
      desc = {
        formatFourCC: "mp4a",
        codecName: "aac",
        sampleRate: sr,
        channels: ch
      };
      samples = [
        {
          data: rawAac,
          dts: 0,
          pts: 0,
          cts: 0,
          duration: 1024,
          size: rawAac.byteLength,
          isKeyframe: true,
          sampleDescriptionIndex: 1
        }
      ];
    }

    let codecId =
      trk.type === "video"
        ? isWebm
          ? "V_VP8"
          : "V_MPEG4/ISO/AVC"
        : isWebm
          ? "A_OPUS"
          : "A_AAC";
    let codecPrivate: Uint8Array | undefined = desc?.extraData;

    if (trk.type === "video") {
      if (desc?.codecName === "vp9") codecId = "V_VP9";
      else if (desc?.codecName === "vp8") codecId = "V_VP8";
      else if (desc?.codecName === "av1") codecId = "V_AV1";
      else if (desc?.codecName === "hevc") codecId = "V_MPEGH/ISO/HEVC";
      else {
        codecId = "V_MPEG4/ISO/AVC";
        codecPrivate =
          desc?.avcC?.rawBytes ??
          (() => {
            const { sps, pps } = buildH264SpsPps(trk.width ?? 320, trk.height ?? 240, 30);
            return buildAvcC([sps], [pps]);
          })();
      }
    } else if (trk.type === "audio") {
      if (desc?.codecName === "opus") codecId = "A_OPUS";
      else if (desc?.codecName === "vorbis") codecId = "A_VORBIS";
      else if (desc?.codecName === "mp3") codecId = "A_MPEG/L3";
      else if (desc?.codecName === "flac") codecId = "A_FLAC";
      else {
        codecId = "A_AAC";
        codecPrivate =
          desc?.esds?.decoderSpecificInfo ??
          buildAudioSpecificConfig(desc?.sampleRate ?? 44100, desc?.channels ?? 2, 2);
      }
    }

    const entryParts: Uint8Array[] = [
      makeEbmlUint(0xd7, trackNum), // TrackNumber
      makeEbmlUint(0x73c5, trackNum), // TrackUID
      makeEbmlUint(0x83, trk.type === "video" ? 1 : trk.type === "audio" ? 2 : 17), // TrackType
      makeEbmlString(0x86, codecId), // CodecID
      makeEbmlString(0x22b59c, trk.language || "und") // Language
    ];

    if (codecPrivate && codecPrivate.byteLength > 0) {
      entryParts.push(makeEbmlElement(0x63a2, codecPrivate));
    }

    if (trk.type === "video") {
      entryParts.push(
        makeEbmlElement(
          0xe0,
          concatBytes([
            makeEbmlUint(0xb0, trk.width ?? desc?.width ?? 320),
            makeEbmlUint(0xba, trk.height ?? desc?.height ?? 240)
          ])
        )
      );
    } else if (trk.type === "audio") {
      entryParts.push(
        makeEbmlElement(
          0xe1,
          concatBytes([
            makeEbmlFloat(0xb5, desc?.sampleRate ?? trk.timescale ?? 44100),
            makeEbmlUint(0x9f, desc?.channels ?? 2),
            makeEbmlUint(0x6264, desc?.bitsPerSample ?? 16)
          ])
        )
      );
    }

    trackEntries.push(makeEbmlElement(0xae, concatBytes(entryParts)));

    for (const s of samples) {
      const ptsMs = Math.max(0, Math.round((s.pts / ts) * 1000));
      const endMs = Math.round(((s.pts + s.duration) / ts) * 1000);
      if (endMs > maxDurationMs) maxDurationMs = endMs;
      allBlocks.push({
        ptsMs,
        trackNum,
        data: s.data,
        isKeyframe: s.isKeyframe
      });
    }
  }

  allBlocks.sort((a, b) => a.ptsMs - b.ptsMs || a.trackNum - b.trackNum);

  // Info element
  const mergedMeta: Mp4MetadataTags = {
    ...doc.metadata,
    ...(options.metadata ?? {})
  };
  const infoParts: Uint8Array[] = [
    makeEbmlUint(0x2ad7b1, 1_000_000), // TimecodeScale = 1ms
    makeEbmlFloat(0x4489, Math.max(1, maxDurationMs)), // Duration in ms
    makeEbmlString(0x4d80, "@poe-code/mp4-ast"), // MuxingApp
    makeEbmlString(0x5741, mergedMeta.encoder ?? "@poe-code/mp4-ast") // WritingApp
  ];
  if (mergedMeta.title) {
    infoParts.push(makeEbmlString(0x7ba9, mergedMeta.title));
  }
  const infoElem = makeEbmlElement(0x1549a966, concatBytes(infoParts));
  const tracksElem = makeEbmlElement(0x1654ae6b, concatBytes(trackEntries));

  // Tags element
  const simpleTags: Uint8Array[] = [];
  const addTag = (k: string, v: string | undefined) => {
    if (!v) return;
    simpleTags.push(
      makeEbmlElement(
        0x67c8,
        concatBytes([makeEbmlString(0x45a3, k), makeEbmlString(0x4487, v)])
      )
    );
  };
  addTag("TITLE", mergedMeta.title);
  addTag("ARTIST", mergedMeta.artist);
  addTag("ALBUM", mergedMeta.album);
  addTag("DATE", mergedMeta.date);
  addTag("COMMENT", mergedMeta.comment);
  addTag("GENRE", mergedMeta.genre);
  addTag("ENCODER", mergedMeta.encoder);

  const tagsElem =
    simpleTags.length > 0
      ? makeEbmlElement(
          0x1254c367,
          makeEbmlElement(
            0x7373,
            concatBytes([makeEbmlElement(0x63c0, new Uint8Array(0)), ...simpleTags])
          )
        )
      : undefined;

  // Build Clusters (group up to 5 seconds per Cluster so Int16 relative timecodes never overflow)
  const clusters: Uint8Array[] = [];
  let clusterStartMs = allBlocks[0]?.ptsMs ?? 0;
  let currentClusterBlocks: Uint8Array[] = [];

  const flushCluster = () => {
    if (currentClusterBlocks.length === 0) return;
    clusters.push(
      makeEbmlElement(
        0x1f43b675,
        concatBytes([makeEbmlUint(0xe7, clusterStartMs), ...currentClusterBlocks])
      )
    );
    currentClusterBlocks = [];
  };

  for (const blk of allBlocks) {
    if (blk.ptsMs - clusterStartMs > 30000 && currentClusterBlocks.length > 0) {
      flushCluster();
      clusterStartMs = blk.ptsMs;
    }
    const relTime = Math.max(-32768, Math.min(32767, blk.ptsMs - clusterStartMs));
    const sbWriter = new BinaryWriter(4 + blk.data.byteLength);
    sbWriter.writeU8(0x80 | (blk.trackNum & 0x7f));
    sbWriter.writeI16BE(relTime);
    sbWriter.writeU8(blk.isKeyframe ? 0x80 : 0x00);
    sbWriter.writeBytes(blk.data);
    currentClusterBlocks.push(makeEbmlElement(0xa3, sbWriter.toUint8Array()));
  }
  flushCluster();

  const segmentChildren: Uint8Array[] = [infoElem, tracksElem];
  if (tagsElem) segmentChildren.push(tagsElem);
  segmentChildren.push(...clusters);

  const segmentElem = makeEbmlElement(0x18538067, concatBytes(segmentChildren));
  return concatBytes([ebmlHeader, segmentElem]);
}

export function probeMkv(
  bytes: Uint8Array,
  options: ParseMediaOptions & { showPackets?: boolean; showFrames?: boolean } = {}
): MediaProbeResult {
  const doc = parseMkv(bytes, options);
  return buildProbeResultFromDoc(doc, bytes.byteLength, options.filename ?? "input.mkv", {
    ...options,
    formatName: "matroska,webm",
    formatLongName: "Matroska / WebM"
  });
}

export function mkvAst(): MediaAstPlugin {
  return {
    id: "mkv",
    formatName: "matroska,webm",
    formatLongName: "Matroska / WebM",
    extensions: ["mkv", "mka", "mks"],
    mimeTypes: ["video/x-matroska", "audio/x-matroska"],
    canDemux: true,
    canMux: true,
    supportedVideoCodecs: ["h264", "hevc", "vp8", "vp9", "av1", "mpeg4"],
    supportedAudioCodecs: ["aac", "opus", "vorbis", "mp3", "flac", "pcm_s16le"],
    supportedSubtitleCodecs: ["subrip", "ass", "webvtt"],
    detect(bytes, filename) {
      if (isMkvSignature(bytes)) {
        if (filename && filename.toLowerCase().endsWith(".webm")) return false;
        return true;
      }
      return false;
    },
    parse(bytes, options) {
      return parseMkv(bytes, options);
    },
    serialize(doc, options) {
      return serializeMkv(doc, { ...options, webm: false });
    },
    probe(bytes, options) {
      return probeMkv(bytes, options);
    },
    concat(docs, options) {
      return concatMp4(docs, options);
    },
    slice(doc, options) {
      return sliceMp4(doc, options);
    }
  };
}

export function webmAst(): MediaAstPlugin {
  return {
    id: "webm",
    formatName: "matroska,webm",
    formatLongName: "WebM",
    extensions: ["webm"],
    mimeTypes: ["video/webm", "audio/webm"],
    canDemux: true,
    canMux: true,
    supportedVideoCodecs: ["vp8", "vp9", "av1", "h264"],
    supportedAudioCodecs: ["opus", "vorbis", "aac"],
    supportedSubtitleCodecs: ["webvtt"],
    detect(bytes, filename) {
      if (isMkvSignature(bytes)) {
        if (filename && filename.toLowerCase().endsWith(".webm")) return true;
        // Check EBML DocType === 'webm'
        const headerStr = decodeUtf8(bytes.subarray(0, Math.min(64, bytes.byteLength)));
        if (headerStr.includes("webm")) return true;
      }
      return false;
    },
    parse(bytes, options) {
      return parseMkv(bytes, options);
    },
    serialize(doc, options) {
      return serializeMkv(doc, { ...options, webm: true });
    },
    probe(bytes, options) {
      return probeMkv(bytes, options);
    },
    concat(docs, options) {
      return concatMp4(docs, options);
    },
    slice(doc, options) {
      return sliceMp4(doc, options);
    }
  };
}
