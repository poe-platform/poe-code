import { rawAudioAsts } from "./raw-audio.js";
import { demuxVorbisTrack } from "../vorbis.js";
import { decodeH264Samples } from "../h264.js";
import { readVint, writeVintSize } from "./ebml.js";
import {
  BinaryWriter,
  concatBytes,
  gcd,
  decodeUtf8,
  encodeUtf8
} from "../binary.js";
import {
  buildAudioSpecificConfig,
  buildAvcC,
  buildEsdsBox,
  buildH264SpsPps,
  createSilentAacFrame,
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

function makeEbmlElement(id: number, payload: Uint8Array, sizeLength = 1): Uint8Array {
  const idBytes = writeEbmlId(id);
  const sizeBytes = writeVintSize(payload.byteLength, sizeLength);
  return concatBytes([idBytes, sizeBytes, payload]);
}

function makeEbmlUint(id: number, val: number): Uint8Array {
  let remaining = Math.max(0, Math.round(val));
  if (!Number.isSafeInteger(remaining)) throw new Error("Invalid EBML integer");
  const bytes: number[] = [];
  do {
    bytes.unshift(remaining % 256);
    remaining = Math.floor(remaining / 256);
  } while (remaining > 0);
  return makeEbmlElement(id, new Uint8Array(bytes));
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

const FIELD_ORDERS: Readonly<Record<number, MediaCodecDescription["fieldOrder"]>> = {
  0: "progressive", 1: "tt", 6: "bb", 9: "tb", 14: "bt"
};

const WEBVTT_KINDS: Readonly<Record<string, string>> = {
  "D_WEBVTT/SUBTITLES": "subtitles",
  "D_WEBVTT/CAPTIONS": "captions",
  "D_WEBVTT/DESCRIPTIONS": "descriptions",
  "D_WEBVTT/METADATA": "metadata"
};

const TRACK_DISPOSITIONS: Readonly<Record<number, string>> = {
  0x88: "default",
  0x55aa: "forced",
  0x55ab: "hearing_impaired",
  0x55ac: "visual_impaired",
  0x55ad: "descriptions",
  0x55ae: "original",
  0x55af: "comment"
};

interface MkvTrackInfo {
  disposition: Record<string, number>;
  trackNumber: number;
  uid?: bigint;
  name?: string;
  trackType: number; // 1 = video, 2 = audio, 17 = subtitle
  codecId: string;
  codecPrivate?: Uint8Array;
  defaultDurationNs?: number;
  alphaMode?: number;
  stereoMode?: number;
  flagInterlaced?: number;
  fieldOrder?: number;
  rawColourBytes?: Uint8Array;
  rawProjectionBytes?: Uint8Array;
  width?: number;
  height?: number;
  displayWidth?: number;
  displayHeight?: number;
  displayUnit?: number;
  sampleRate?: number;
  channels?: number;
  bitDepth?: number;
  language?: string;
  codecDelayNs?: number;
  seekPreRollNs?: number;
}

interface MkvTag {
  tracks: bigint[];
  otherTarget: boolean;
  values: Record<string, string>;
}

function readEbmlUid(payload: Uint8Array): bigint {
  let value = 0n;
  for (const byte of payload) value = (value << 8n) | BigInt(byte);
  return value;
}

interface MkvChapter {
  id: number;
  start: number;
  end: number;
  title?: string;
}

interface MkvAttachment {
  tags: Record<string, string>;
  size: number;
  data: Uint8Array;
}

export function parseMkv(bytes: Uint8Array, options: ParseMediaOptions = {}): MediaDocument & { attachments: readonly MkvAttachment[] } {
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
  const chapters: MkvChapter[] = [];
  const tags: MkvTag[] = [];
  const attachments: MkvAttachment[] = [];

  function parseElements(start: number, end: number, depth: number, chapter?: MkvChapter, tag?: MkvTag, attachment?: MkvAttachment): void {
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

      const elemEnd = sizeVint.unknownSize ? end : Math.min(end, pos + sizeVint.value);
      const payload = bytes.subarray(pos, elemEnd);

      switch (idVint.value) {
        case 0x1941a469: // Attachments
          parseElements(pos, elemEnd, depth + 1);
          break;

        case 0x61a7: { // AttachedFile
          const entry: MkvAttachment = { tags: {}, size: 0, data: new Uint8Array() };
          parseElements(pos, elemEnd, depth + 1, undefined, undefined, entry);
          if (entry.size > 0 && entry.tags.filename && entry.tags.mimetype) attachments.push(entry);
          break;
        }

        case 0x466e: // FileName
        case 0x4660: // FileMimeType
        case 0x467e: // FileDescription
          if (attachment) {
            const key = idVint.value === 0x466e ? "filename" : idVint.value === 0x4660 ? "mimetype" : "title";
            attachment.tags[key] = decodeUtf8(payload).split("\0", 1)[0]!;
          }
          break;

        case 0x465c: // FileData: attachments are extradata, never playable samples.
          if (attachment) {
            attachment.size = payload.byteLength;
            attachment.data = payload;
          }
          break;

        case 0x1043a770: // Chapters
        case 0x45b9: // EditionEntry
          parseElements(pos, elemEnd, depth + 1);
          break;

        case 0xb6: { // ffprobe exposes only top-level ChapterAtoms from each edition.
          if (chapter) break;
          const entry: MkvChapter = { id: 0, start: 0, end: 0 };
          chapters.push(entry);
          parseElements(pos, elemEnd, depth + 1, entry);
          break;
        }

        case 0x73c4: // ChapterUID
          if (chapter) chapter.id = readEbmlUint(payload);
          break;

        case 0x91: // ChapterTimeStart (always nanoseconds, independent of TimecodeScale)
          if (chapter) chapter.start = readEbmlUint(payload);
          break;

        case 0x92: // ChapterTimeEnd
          if (chapter) chapter.end = readEbmlUint(payload);
          break;

        case 0x80: // ChapterDisplay
          if (chapter) parseElements(pos, elemEnd, depth + 1, chapter);
          break;

        case 0x85: // ChapString
          if (chapter && chapter.title === undefined) chapter.title = decodeUtf8(payload).split("\0", 1)[0]!;
          break;

        case 0x1a45dfa3: // EBML Header
        case 0x18538067: // Segment
        case 0x1549a966: // Info
        case 0x1654ae6b: // Tracks
        case 0x1254c367: // Tags
          parseElements(pos, elemEnd, depth + 1);
          break;

        case 0x7373: { // Tag: targets can appear before or after SimpleTag elements.
          const entry: MkvTag = { tracks: [], otherTarget: false, values: {} };
          tags.push(entry);
          parseElements(pos, elemEnd, depth + 1, undefined, entry);
          break;
        }

        case 0x63c0: // Targets
          if (tag) parseElements(pos, elemEnd, depth + 1, undefined, tag);
          break;

        case 0x63c5: // TagTrackUID (64-bit, independent of TrackNumber)
          if (tag) tag.tracks.push(readEbmlUid(payload));
          break;

        case 0x63c4: // TagChapterUID
        case 0x63c6: // TagAttachmentUID
        case 0x63c9: // TagEditionUID
          if (tag) tag.otherTarget = true;
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
          if (tag && tagName && tagValue) {
            tag.values[tagName] = tagValue;
          }
          break;
        }

        case 0xae: {
          // TrackEntry
          const info: MkvTrackInfo = {
            disposition: { default: 1 },
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

            if (TRACK_DISPOSITIONS[tid.value]) info.disposition[TRACK_DISPOSITIONS[tid.value]!] = readEbmlUint(tPay) ? 1 : 0;
            else if (tid.value === 0xd7) info.trackNumber = readEbmlUint(tPay);
            else if (tid.value === 0x73c5) info.uid = readEbmlUid(tPay);
            else if (tid.value === 0x536e) info.name = decodeUtf8(tPay).split("\0", 1)[0]!;
            else if (tid.value === 0x23e383) info.defaultDurationNs = readEbmlUint(tPay);
            else if (tid.value === 0x56aa) info.codecDelayNs = readEbmlUint(tPay);
            else if (tid.value === 0x56bb) info.seekPreRollNs = readEbmlUint(tPay);
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
                else if (vid.value === 0x54b0) info.displayWidth = readEbmlUint(vPay);
                else if (vid.value === 0x54ba) info.displayHeight = readEbmlUint(vPay);
                else if (vid.value === 0x54b2) info.displayUnit = readEbmlUint(vPay);
                else if (vid.value === 0x9a) info.flagInterlaced = readEbmlUint(vPay);
                else if (vid.value === 0x9d) info.fieldOrder = readEbmlUint(vPay);
                else if (vid.value === 0x53b8) info.stereoMode = readEbmlUint(vPay);
                else if (vid.value === 0x53c0) info.alphaMode = readEbmlUint(vPay);
                else if (vid.value === 0x55b0) info.rawColourBytes = vPay;
                else if (vid.value === 0x7670) info.rawProjectionBytes = vPay;
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
              let blockOffset = cPos;
              let blockDuration = 0;
              let discardPaddingNs: number | undefined;
              let blockAdditions: Uint8Array | undefined;
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
                    blockOffset = bgPos;
                    blockPay = bytes.subarray(bgPos, Math.min(cEnd, bgPos + bsz.value));
                  } else if (bid.value === 0x75a1) {
                    blockAdditions = bytes.subarray(bgPos, Math.min(cEnd, bgPos + bsz.value));
                  } else if (bid.value === 0x75a2) {
                    const payload = bytes.subarray(bgPos, Math.min(cEnd, bgPos + bsz.value));
                    let value = (payload[0]! & 0x80) ? -1 : 0;
                    for (const byte of payload) value = value * 256 + byte;
                    discardPaddingNs = value;
                  } else if (bid.value === 0x9b) {
                    blockDuration = readEbmlUint(bytes.subarray(bgPos, Math.min(cEnd, bgPos + bsz.value)));
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
                const ptsMs = clusterTimecode + relTimecode;

                let list = samplesByTrack.get(trackNum);
                if (!list) {
                  list = [];
                  samplesByTrack.set(trackNum, list);
                }
                list.push({
                  data: frameData,
                  offset: blockOffset,
                  dts: ptsMs,
                  pts: ptsMs,
                  cts: 0,
                  duration: blockDuration,
                  ...(blockAdditions === undefined ? {} : { blockAdditions }),
                  ...(discardPaddingNs === undefined ? {} : { discardPaddingNs }),
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

  for (const tag of tags) {
    if (!tag.otherTarget && tag.tracks.length === 0) {
      for (const [name, value] of Object.entries(tag.values)) tagsRecord[name.toUpperCase()] = value;
    }
  }

  const timescale = Math.max(1, Math.round(1_000_000_000 / timecodeScale));
  const tracks: MediaTrack[] = [];

  for (const [trkNum, info] of trackMap.entries()) {
    const webvttKind = WEBVTT_KINDS[info.codecId];
    if (webvttKind && webvttKind !== "subtitles") info.disposition[webvttKind] = 1;
    let waveTag: number | undefined;
    if (info.codecId === "A_MS/ACM" && info.codecPrivate && info.codecPrivate.byteLength >= 18) {
      const wave = new DataView(info.codecPrivate.buffer, info.codecPrivate.byteOffset, info.codecPrivate.byteLength);
      let tag = wave.getUint16(0, true);
      // WAVEFORMATEXTENSIBLE stores the PCM format tag in its subtype GUID.
      if (tag === 0xfffe && wave.byteLength >= 40 && wave.getUint16(16, true) >= 22 &&
          info.codecPrivate.subarray(26, 40).every((value, index) =>
            value === [0, 0, 0, 0, 16, 0, 128, 0, 0, 170, 0, 56, 155, 113][index])) {
        tag = wave.getUint16(24, true);
      }
      if (tag === 1 || tag === 6 || tag === 7) {
        waveTag = tag;
        info.channels = wave.getUint16(2, true);
        info.sampleRate = wave.getUint32(4, true);
        info.bitDepth = tag === 1 ? wave.getUint16(14, true) : 8;
      }
    }
    const rawSamples = samplesByTrack.get(trkNum) ?? [];
    const codecDelayTicks = Math.round((info.codecDelayNs ?? 0) / timecodeScale);
    for (let i = 0; i < rawSamples.length; i++) {
      const cur = rawSamples[i]!;
      const next = rawSamples[i + 1];
      const defaultTicks = (info.defaultDurationNs ?? 0) / timecodeScale;
      const previous = rawSamples[i - 1];
      const inferred = next && next.dts > cur.dts ? next.dts - cur.dts
        : defaultTicks || previous?.duration || Math.max(1, timescale / (info.trackType === 1 ? 30 : 44100 / 1024));
      const pcmTicks = (info.codecId.startsWith("A_PCM/") || waveTag !== undefined) &&
        (info.sampleRate ?? 0) > 0 && (info.channels ?? 0) > 0 && (info.bitDepth ?? 0) > 0
        ? Math.floor(Math.floor(cur.size / (info.channels! * Math.ceil(info.bitDepth! / 8))) * timescale / info.sampleRate!)
        : undefined;
      const dur = cur.duration > 0 ? cur.duration : pcmTicks ?? (defaultTicks || inferred);
      rawSamples[i] = { ...cur, dts: cur.dts - codecDelayTicks, pts: cur.pts - codecDelayTicks, duration: dur };
      if (webvttKind) {
        const identifierEnd = cur.data.indexOf(10);
        const settingsEnd = cur.data.indexOf(10, identifierEnd + 1);
        if (identifierEnd < 0 || settingsEnd < 0) throw new Error("Invalid Matroska WebVTT packet");
        const data = cur.data.subarray(settingsEnd + 1);
        rawSamples[i] = {
          ...rawSamples[i]!, data, size: data.byteLength,
          webvtt: {
            identifier: decodeUtf8(cur.data.subarray(0, identifierEnd)),
            settings: decodeUtf8(cur.data.subarray(identifierEnd + 1, settingsEnd))
          }
        };
      }
    }

    const type: MediaTrackType =
      webvttKind ? "subtitle" : info.trackType === 1 ? "video" : info.trackType === 2 ? "audio" : "subtitle";

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
    } else if (["V_MPEG4/ISO/SP", "V_MPEG4/ISO/ASP", "V_MPEG4/ISO/AP"].includes(info.codecId)) {
      codecName = "mpeg4";
      formatFourCC = "mp4v";
    } else if (info.codecId === "V_MS/VFW/FOURCC" &&
      info.codecPrivate && info.codecPrivate.byteLength >= 40 &&
      decodeUtf8(info.codecPrivate.subarray(16, 20)) === "FLV1") {
      codecName = "flv1";
      formatFourCC = "FLV1";
    } else if (info.codecId === "V_FFV1") {
      codecName = "ffv1";
      formatFourCC = "FFV1";
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
    } else if (waveTag === 6 || waveTag === 7) {
      codecName = waveTag === 6 ? "pcm_alaw" : "pcm_mulaw";
      formatFourCC = waveTag === 6 ? "alaw" : "ulaw";
    } else if (info.codecId.includes("A_PCM") || waveTag === 1) {
      const floating = info.codecId === "A_PCM/FLOAT/IEEE";
      const bigEndian = info.codecId === "A_PCM/INT/BIG";
      const bits = info.bitDepth ?? 16;
      codecName = `pcm_${floating ? "f" : waveTag === 1 && bits === 8 ? "u" : "s"}${bits}${bits === 8 ? "" : bigEndian ? "be" : "le"}`;
      formatFourCC = floating ? (bits === 64 ? "fl64" : "fl32") : bigEndian ? "twos" : "sowt";
    } else if (webvttKind || info.trackType === 17 || info.codecId.startsWith("S_TEXT")) {
      codecName = info.codecId === "S_TEXT/ASS" ? "ass" : info.codecId.includes("WEBVTT") ? "webvtt" : "subrip";
      formatFourCC = codecName === "ass" ? "ass " : codecName === "webvtt" ? "wvtt" : "tx3g";
    }

    const totalTrackDur =
      rawSamples.reduce((end, s) => Math.max(end, s.dts + s.duration), 0) ||
      segmentDurationTicks;

    let decodedVideoFrames: MediaVideoFrame[] | undefined;
    if (options.decodeFrames && codecName === "h264" && type === "video" && width && height) {
      decodedVideoFrames = [...decodeH264Samples(rawSamples, [{ formatFourCC: "avc1", codecName: "h264", avcC }], width, height, timescale)];
    }

    let sarWidth: number | undefined;
    let sarHeight: number | undefined;
    if ((info.displayUnit === undefined || info.displayUnit === 0 || info.displayUnit === 3) &&
      width && height && info.displayWidth && info.displayHeight) {
      const numerator = info.displayWidth * height;
      const denominator = info.displayHeight * width;
      if (Number.isSafeInteger(numerator) && Number.isSafeInteger(denominator)) {
        const divisor = gcd(numerator, denominator);
        sarWidth = numerator / divisor;
        sarHeight = denominator / divisor;
      }
    }

    const desc: MediaCodecDescription = {
      formatFourCC,
      codecName,
      profile,
      width,
      height,
      sarWidth,
      sarHeight,
      alphaMode: info.alphaMode,
      stereoMode: info.stereoMode,
      fieldOrder: info.flagInterlaced === 2 ? "progressive"
        : info.flagInterlaced === 1 ? FIELD_ORDERS[info.fieldOrder ?? 2] ?? "unknown"
        : undefined,
      rawMkvColourBytes: info.rawColourBytes,
      rawMkvProjectionBytes: info.rawProjectionBytes,
      pixFmt: type === "video" ? "yuv420p" : undefined,
      sampleRate,
      channels,
      bitsPerSample: info.bitDepth ?? 16,
      avcC,
      h264Framing: avcC ? "avcc" : undefined,
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

    const pcmDecoder = type === "audio" && rawSamples.length > 0 && options.decodeAudio !== false
      ? rawAudioAsts().find(plugin => plugin.supportedAudioCodecs.includes(codecName))
      : undefined;

    tracks.push({
      id: trkNum,
      type,
      handlerType: type === "video" ? "vide" : type === "audio" ? "soun" : "sbtl",
      timescale,
      duration: totalTrackDur,
      defaultDurationNs: info.defaultDurationNs,
      codecDelayNs: info.codecDelayNs,
      seekPreRollNs: info.seekPreRollNs,
      language: info.language ?? "eng",
      metadata: Object.assign(
        info.name ? { title: info.name } : {},
        ...tags.filter(tag => !tag.otherTarget && tag.tracks.some(uid => uid === 0n || uid === info.uid)).map(tag => tag.values)
      ),
      enabled: true,
      disposition: info.disposition,
      width,
      height,
      codecDescriptions: [desc],
      samples: rawSamples,
      decodedVideoFrames,
      ...(pcmDecoder ? {
        decodedAudio: pcmDecoder
          .parse(concatBytes(rawSamples.map(sample => sample.data)), { ...options, budget, sampleRate, channels })
          .tracks[0]!.decodedAudio
      } : {})
    });
  }

  let maxDurationSec = (segmentDurationTicks * timecodeScale) / 1_000_000_000;
  for (const t of tracks) {
    const sec = t.duration / Math.max(1, t.timescale);
    if (segmentDurationTicks <= 0 && sec > maxDurationSec) maxDurationSec = sec;
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
    attachments,
    metadata,
    chapters: chapters.map(chapter => ({
      id: chapter.id,
      timescale: 1_000_000_000,
      startTimeSeconds: chapter.start / 1_000_000_000,
      endTimeSeconds: chapter.end / 1_000_000_000,
      title: chapter.title ?? ""
    })),
    byteLength: bytes.byteLength
  };
}

const crc32Table = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  return value >>> 0;
});

export function serializeMkv(
  doc: MediaDocument,
  options: SerializeMediaOptions & { webm?: boolean } = {}
): Uint8Array {
  const clusterTimeLimit = options.clusterTimeLimit ?? -1;
  if (!Number.isSafeInteger(clusterTimeLimit) || clusterTimeLimit < -1) {
    throw new Error("Invalid cluster_time_limit: expected integer milliseconds from -1 to 9007199254740991");
  }
  const clusterDurationMs = clusterTimeLimit === -1 ? 5000 : clusterTimeLimit;
  const isWebm = options.webm ?? (options.format !== undefined ? options.format === "webm" : doc.containerFormat === "webm");
  const docType = isWebm ? "webm" : "matroska";
  const writeCrc32 = !isWebm && options.writeCrc32 !== false;
  const makeLevelOneElement = (id: number, payload: Uint8Array, sizeLength = 1): Uint8Array => {
    if (writeCrc32) {
      let crc = 0xffffffff;
      for (const byte of payload) crc = (crc >>> 8) ^ crc32Table[(crc ^ byte) & 255]!;
      const checksum = new Uint8Array(4);
      new DataView(checksum.buffer).setUint32(0, (crc ^ 0xffffffff) >>> 0, true);
      payload = concatBytes([makeEbmlElement(0xbf, checksum), payload]);
    }
    return makeEbmlElement(id, payload, sizeLength);
  };

  const budget = options.budget ?? new MediaBudgetTracker(options.limits);
  const reserveIndexSpace = options.reserveIndexSpace ?? 0;
  if (!Number.isInteger(reserveIndexSpace) || reserveIndexSpace < 0 || reserveIndexSpace > 2147483647) {
    throw new Error("Invalid reserve_index_space: expected an integer from 0 to 2147483647");
  }
  budget.checkOutputBytes(reserveIndexSpace);
  budget.allocateMemory(reserveIndexSpace);

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
  const allBlocks: { orderMs: number; ptsMs: number; durationMs: number; discardPaddingNs: number | undefined; blockAdditions: Uint8Array | undefined; isSubtitle: boolean; trackNum: number; data: Uint8Array; isKeyframe: boolean }[] = [];
  let maxDurationMs = Math.round(doc.durationSeconds * 1000);

  for (let idx = 0; idx < doc.tracks.length; idx++) {
    const sourceTrack = doc.tracks[idx]!;
    const trk = sourceTrack.codecDescriptions[0]?.codecName === "vorbis" && !sourceTrack.codecDescriptions[0].extraData
      ? demuxVorbisTrack(sourceTrack) : sourceTrack;
    const trackNum = idx + 1;
    const ts = trk.timescale || 1000;

    let samples = trk.samples;
    let desc = trk.codecDescriptions[0];

    const pcmEncoder = trk.type === "audio" && trk.decodedAudio && options.audioCodec?.startsWith("pcm_")
      ? rawAudioAsts().find(plugin => plugin.supportedAudioCodecs.includes(options.audioCodec!)) : undefined;
    if (pcmEncoder && trk.decodedAudio) {
      const { sampleRate, channels } = trk.decodedAudio;
      const encoded = pcmEncoder.serialize({ ...doc, tracks: [trk] }, { ...options, budget });
      const pcm = pcmEncoder.parse(encoded, { sampleRate, channels, decodeAudio: false, budget }).tracks[0]!;
      const start = samples[0]?.pts ?? 0;
      desc = pcm.codecDescriptions[0];
      samples = pcm.samples.map(sample => ({
        ...sample,
        dts: start + sample.dts * ts / sampleRate,
        pts: start + sample.pts * ts / sampleRate,
        duration: sample.duration * ts / sampleRate
      }));
    } else if (samples.length === 0 && trk.type === "video" && trk.decodedVideoFrames?.length) {
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
    let codecDelayNs = trk.codecDelayNs;
    let seekPreRollNs = trk.seekPreRollNs;
    let timestampOffset = 0;

    if (trk.type === "video") {
      if (desc?.codecName === "mpeg4") codecId = "V_MPEG4/ISO/ASP";
      else if (desc?.codecName === "ffv1") codecId = "V_FFV1";
      else if (desc?.codecName === "vp9") codecId = "V_VP9";
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
      if (desc?.codecName === "opus") {
        codecId = "A_OPUS";
        if (desc.dOps) {
          const opus = desc.dOps;
          // dOps uses version 0 and big endian fields; OpusHead uses version 1
          // and little endian fields. The channel mapping bytes are identical.
          codecPrivate = concatBytes([encodeUtf8("OpusHead"), opus.rawBytes]);
          const header = new DataView(codecPrivate.buffer, codecPrivate.byteOffset, codecPrivate.byteLength);
          header.setUint8(8, 1);
          header.setUint16(10, opus.preSkip, true);
          header.setUint32(12, opus.inputSampleRate, true);
          header.setInt16(16, opus.outputGain, true);
          codecDelayNs = opus.preSkip * 1e9 / 48000;
          seekPreRollNs = 80_000_000;
          // MP4 samples retain their media timeline; apply the presentation edit
          // before adding Matroska's decoder delay to block timestamps.
          for (const edit of trk.editList ?? []) {
            if (edit.mediaTime < 0) timestampOffset += edit.segmentDuration * ts / doc.timescale;
            else { timestampOffset -= edit.mediaTime; break; }
          }
        }
      }
      else if (desc?.codecName === "vorbis") codecId = "A_VORBIS";
      else if (desc?.codecName === "mp3") codecId = "A_MPEG/L3";
      else if (desc?.codecName === "flac") codecId = "A_FLAC";
      else if (desc?.codecName === "pcm_mulaw" || desc?.codecName === "pcm_alaw") {
        codecId = "A_MS/ACM";
        codecPrivate = new Uint8Array(18);
        const wave = new DataView(codecPrivate.buffer);
        const channels = desc.channels ?? 2;
        const sampleRate = desc.sampleRate ?? trk.timescale ?? 44100;
        wave.setUint16(0, desc.codecName === "pcm_mulaw" ? 7 : 6, true);
        wave.setUint16(2, channels, true);
        wave.setUint32(4, sampleRate, true);
        wave.setUint32(8, sampleRate * channels, true);
        wave.setUint16(12, channels, true);
        wave.setUint16(14, 8, true);
      }
      else if (desc?.codecName.startsWith("pcm_")) {
        codecId = desc.codecName.startsWith("pcm_f") ? "A_PCM/FLOAT/IEEE"
          : desc.codecName.endsWith("be") ? "A_PCM/INT/BIG" : "A_PCM/INT/LIT";
      } else {
        codecId = "A_AAC";
        codecPrivate =
          desc?.esds?.decoderSpecificInfo ??
          buildAudioSpecificConfig(desc?.sampleRate ?? 44100, desc?.channels ?? 2, 2);
      }
    } else if (trk.type === "subtitle") {
      codecId = desc?.codecName === "webvtt"
        ? Object.entries(WEBVTT_KINDS).find(([, kind]) => trk.disposition?.[kind])?.[0] ?? "D_WEBVTT/SUBTITLES"
        : desc?.codecName === "ass" ? "S_TEXT/ASS" : "S_TEXT/UTF8";
      if (desc?.codecName !== "ass") codecPrivate = undefined;
    }

    const entryParts: Uint8Array[] = [
      makeEbmlUint(0xd7, trackNum), // TrackNumber
      makeEbmlUint(0x73c5, trackNum), // TrackUID
      makeEbmlUint(0x83, trk.type === "video" ? 1 : trk.type === "audio" ? 2
        : WEBVTT_KINDS[codecId] === "descriptions" || WEBVTT_KINDS[codecId] === "metadata" ? 33 : 17), // TrackType
      makeEbmlString(0x86, codecId), // CodecID
      makeEbmlString(0x22b59c, trk.language || "und") // Language
    ];
    if (trk.metadata?.title) entryParts.push(makeEbmlString(0x536e, trk.metadata.title)); // Name
    if (trk.defaultDurationNs !== undefined) entryParts.push(makeEbmlUint(0x23e383, trk.defaultDurationNs));
    if (codecDelayNs !== undefined) entryParts.push(makeEbmlUint(0x56aa, codecDelayNs));
    if (seekPreRollNs !== undefined) entryParts.push(makeEbmlUint(0x56bb, seekPreRollNs));

    for (const [id, name] of Object.entries(TRACK_DISPOSITIONS)) {
      const value = trk.disposition?.[name];
      if (value !== undefined) entryParts.push(makeEbmlUint(Number(id), value));
    }

    if (codecPrivate && codecPrivate.byteLength > 0) {
      entryParts.push(makeEbmlElement(0x63a2, codecPrivate));
    }

    if (trk.type === "video") {
      const width = trk.width ?? desc?.width ?? 320;
      const height = trk.height ?? desc?.height ?? 240;
      const videoParts = [makeEbmlUint(0xb0, width), makeEbmlUint(0xba, height)];
      if (desc?.fieldOrder !== undefined && desc.fieldOrder !== "unknown") {
        videoParts.push(makeEbmlUint(0x9a, desc.fieldOrder === "progressive" ? 2 : 1));
        if (desc.fieldOrder !== "progressive") {
          videoParts.push(makeEbmlUint(0x9d, { tt: 1, bb: 6, tb: 9, bt: 14 }[desc.fieldOrder]));
        }
      }
      if (desc?.stereoMode !== undefined) videoParts.push(makeEbmlUint(0x53b8, desc.stereoMode));
      if (desc?.alphaMode !== undefined) videoParts.push(makeEbmlUint(0x53c0, desc.alphaMode));
      if (desc?.rawMkvColourBytes !== undefined) videoParts.push(makeEbmlElement(0x55b0, desc.rawMkvColourBytes));
      if (desc?.rawMkvProjectionBytes !== undefined) videoParts.push(makeEbmlElement(0x7670, desc.rawMkvProjectionBytes));
      if (desc?.sarWidth && desc.sarHeight && desc.sarWidth !== desc.sarHeight) {
        const divisor = gcd(desc.sarWidth, desc.sarHeight);
        // Pixel display units also work in WebM; scale both axes to retain exact ratios.
        videoParts.push(
          makeEbmlUint(0x54b0, width * (desc.sarWidth / divisor)),
          makeEbmlUint(0x54ba, height * (desc.sarHeight / divisor))
        );
      }
      entryParts.push(makeEbmlElement(0xe0, concatBytes(videoParts)));
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

    let orderMs = -Infinity;
    const codecDelayMs = Math.round((codecDelayNs ?? 0) / 1_000_000);
    for (const s of samples) {
      // Samples are in decode order. Matroska has no DTS, so parsed DTS can
      // follow non-monotonic PTS; never let interleaving reorder a track.
      orderMs = Math.max(orderMs, ((s.dts + timestampOffset) / ts) * 1000);
      const pts = s.pts + timestampOffset;
      // FFmpeg rescales timestamps with ties away from zero, including Opus pre-skip.
      const ptsMs = Math.max(0, Math.sign(pts) * Math.round((Math.abs(pts) / ts) * 1000) + codecDelayMs);
      const endMs = Math.round(((pts + s.duration) / ts) * 1000) + codecDelayMs;
      if (endMs > maxDurationMs) maxDurationMs = endMs;
      const durationMs = Math.max(1, Math.round((s.duration / ts) * 1000));
      allBlocks.push({
        orderMs,
        ptsMs,
        durationMs,
        discardPaddingNs: s.discardPaddingNs,
        blockAdditions: s.blockAdditions,
        isSubtitle: trk.type === "subtitle",
        trackNum,
        data: WEBVTT_KINDS[codecId]
          ? concatBytes([encodeUtf8(`${s.webvtt?.identifier ?? ""}\n${s.webvtt?.settings ?? ""}\n`), s.data])
          : s.data,
        isKeyframe: s.isKeyframe
      });
    }
  }

  allBlocks.sort((a, b) => a.orderMs - b.orderMs || a.trackNum - b.trackNum);

  // Info element
  const mergedMeta: Mp4MetadataTags = {
    ...doc.metadata,
    ...(options.metadata ?? {})
  };
  const infoParts: Uint8Array[] = [
    makeEbmlUint(0x2ad7b1, 1_000_000), // TimecodeScale = 1ms
    ...(options.live ? [] : [makeEbmlFloat(0x4489, Math.max(1, maxDurationMs))]), // Duration in ms
    makeEbmlString(0x4d80, "@poe-code/mp4-ast"), // MuxingApp
    makeEbmlString(0x5741, mergedMeta.encoder ?? "@poe-code/mp4-ast") // WritingApp
  ];
  if (mergedMeta.title) {
    infoParts.push(makeEbmlString(0x7ba9, mergedMeta.title));
  }
  const infoElem = makeLevelOneElement(0x1549a966, concatBytes(infoParts));
  const tracksElem = makeLevelOneElement(0x1654ae6b, concatBytes(trackEntries));

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
  addTag("ARTIST", mergedMeta.artist);
  addTag("ALBUM", mergedMeta.album);
  addTag("DATE", mergedMeta.date);
  addTag("COMMENT", mergedMeta.comment);
  addTag("GENRE", mergedMeta.genre);
  addTag("ENCODER", mergedMeta.encoder);

  const tagsElem =
    simpleTags.length > 0
      ? makeLevelOneElement(
          0x1254c367,
          makeEbmlElement(
            0x7373,
            concatBytes([makeEbmlElement(0x63c0, new Uint8Array(0)), ...simpleTags])
          )
        )
      : undefined;

  // Keep relative presentation timestamps within the signed 16-bit block range.
  const clusters: Uint8Array[] = [];
  const cues: { time: number; track: number; cluster: number; relativePosition: number }[] = [];
  let clusterStartMs = allBlocks[0]?.ptsMs ?? 0;
  let currentClusterBlocks: Uint8Array[] = [];
  let clusterPayloadSize = (writeCrc32 ? 6 : 0) + makeEbmlUint(0xe7, clusterStartMs).byteLength;

  const flushCluster = () => {
    if (currentClusterBlocks.length === 0) return;
    clusters.push(
      makeLevelOneElement(
        0x1f43b675,
        concatBytes([makeEbmlUint(0xe7, clusterStartMs), ...currentClusterBlocks])
      )
    );
    currentClusterBlocks = [];
  };

  for (const blk of allBlocks) {
    const elapsedMs = blk.ptsMs - clusterStartMs;
    if ((elapsedMs > clusterDurationMs || elapsedMs > 32767 || elapsedMs < -32768) && currentClusterBlocks.length > 0) {
      flushCluster();
      clusterStartMs = blk.ptsMs;
      clusterPayloadSize = (writeCrc32 ? 6 : 0) + makeEbmlUint(0xe7, clusterStartMs).byteLength;
    }
    if (!options.live && blk.isKeyframe && doc.tracks[blk.trackNum - 1]!.type === "video") {
      cues.push({ time: blk.ptsMs, track: blk.trackNum, cluster: clusters.length, relativePosition: clusterPayloadSize });
    }
    const relTime = blk.ptsMs - clusterStartMs;
    const sbWriter = new BinaryWriter(4 + blk.data.byteLength);
    sbWriter.writeU8(0x80 | (blk.trackNum & 0x7f));
    sbWriter.writeI16BE(relTime);
    if (blk.isSubtitle || blk.discardPaddingNs !== undefined || blk.blockAdditions !== undefined) {
      sbWriter.writeU8(0x00);
      sbWriter.writeBytes(blk.data);
      const blockElem = makeEbmlElement(0xa1, sbWriter.toUint8Array());
      const elements = [blockElem];
      if (blk.blockAdditions !== undefined) elements.push(makeEbmlElement(0x75a1, blk.blockAdditions));
      if (blk.isSubtitle) elements.push(makeEbmlUint(0x9b, blk.durationMs));
      if (blk.discardPaddingNs !== undefined) {
        const padding = new Uint8Array(8);
        new DataView(padding.buffer).setBigInt64(0, BigInt(blk.discardPaddingNs), false);
        elements.push(makeEbmlElement(0x75a2, padding));
      }
      currentClusterBlocks.push(makeEbmlElement(0xa0, concatBytes(elements)));
    } else {
      sbWriter.writeU8(blk.isKeyframe ? 0x80 : 0x00);
      sbWriter.writeBytes(blk.data);
      currentClusterBlocks.push(makeEbmlElement(0xa3, sbWriter.toUint8Array()));
    }
    clusterPayloadSize += currentClusterBlocks[currentClusterBlocks.length - 1]!.byteLength;
  }
  flushCluster();

  const segmentChildren: Uint8Array[] = [infoElem, tracksElem];
  if (doc.attachments?.length) {
    segmentChildren.push(makeLevelOneElement(0x1941a469, concatBytes(doc.attachments.map((file, index) =>
      makeEbmlElement(0x61a7, concatBytes([
        makeEbmlUint(0x46ae, index + 1), // FileUID
        makeEbmlString(0x466e, file.tags.filename ?? ""),
        makeEbmlString(0x4660, file.tags.mimetype ?? ""),
        ...(file.tags.title === undefined ? [] : [makeEbmlString(0x467e, file.tags.title)]),
        makeEbmlElement(0x465c, file.data)
      ]))
    ))));
  }
  if (doc.chapters?.length) {
    segmentChildren.push(makeLevelOneElement(0x1043a770, // Chapters
      makeEbmlElement(0x45b9, concatBytes(doc.chapters.map(chapter => // EditionEntry
        makeEbmlElement(0xb6, concatBytes([ // ChapterAtom
          makeEbmlUint(0x73c4, chapter.id),
          makeEbmlUint(0x91, chapter.startTimeSeconds * 1_000_000_000),
          makeEbmlUint(0x92, chapter.endTimeSeconds * 1_000_000_000),
          makeEbmlElement(0x80, makeEbmlString(0x85, chapter.title)) // ChapterDisplay / ChapString
        ]))
      )))
    ));
  }
  if (tagsElem) segmentChildren.push(tagsElem);
  if (cues.length > 0) {
    // A fixed-width SeekPosition keeps the header size stable as offsets grow.
    const seekPayload = makeEbmlElement(0x4dbb, concatBytes([
      makeEbmlElement(0x53ab, writeEbmlId(0x1c53bb6b)), // SeekID: Cues
      makeEbmlElement(0x53ac, new Uint8Array(8)) // SeekPosition, patched below
    ]));
    const seekHead = makeLevelOneElement(0x114d9b74, seekPayload);
    segmentChildren.unshift(seekHead);
    let position = segmentChildren.reduce((size, element) => size + element.byteLength, 0);
    const clusterPositions = clusters.map(cluster => {
      const start = position;
      position += cluster.byteLength;
      return start;
    });
    const headerSize = clusterPositions[0]!;
    const front = options.cuesToFront || reserveIndexSpace > 0;
    let frontSpace = reserveIndexSpace;
    cues.sort((a, b) => a.time - b.time || a.track - b.track);
    let cuesElement: Uint8Array;
    // Growing offsets can grow the integer fields inside Cues. Recompute until
    // the index fits, before copying any cluster data into the final output.
    for (;;) {
      const payload = concatBytes(cues.map(cue =>
        makeEbmlElement(0xbb, concatBytes([
          makeEbmlUint(0xb3, cue.time), // CueTime in the segment's millisecond ticks
          makeEbmlElement(0xb7, concatBytes([
            makeEbmlUint(0xf7, cue.track),
            makeEbmlUint(0xf1, clusterPositions[cue.cluster]! + frontSpace),
            makeEbmlUint(0xf0, cue.relativePosition) // Relative to Cluster data
          ]))
        ]))
      ));
      cuesElement = makeLevelOneElement(0x1c53bb6b, payload);
      if (!front || cuesElement.byteLength <= frontSpace) {
        // A one-byte gap cannot hold a Void, so widen the Cues size field.
        if (front && frontSpace - cuesElement.byteLength === 1) {
          cuesElement = makeLevelOneElement(0x1c53bb6b, payload, writeVintSize(payload.byteLength + (writeCrc32 ? 6 : 0)).length + 1);
        }
        break;
      }
      if (!options.cuesToFront) throw new Error("Insufficient reserved index space: increase reserve_index_space or enable cues_to_front");
      frontSpace = cuesElement.byteLength;
    }
    budget.allocateMemory(Math.max(0, frontSpace - reserveIndexSpace) + (front ? 0 : cuesElement.byteLength));
    new DataView(seekPayload.buffer, seekPayload.byteOffset, seekPayload.byteLength)
      .setBigUint64(seekPayload.byteLength - 8, BigInt(front ? headerSize : position), false);
    segmentChildren[0] = makeLevelOneElement(0x114d9b74, seekPayload);
    if (front) {
      segmentChildren.push(cuesElement);
      const padding = frontSpace - cuesElement.byteLength;
      if (padding > 0) {
        let sizeLength = 1;
        while (padding - 1 - sizeLength >= 2 ** (7 * sizeLength) - 1) sizeLength++;
        segmentChildren.push(makeEbmlElement(0xec, new Uint8Array(padding - 1 - sizeLength), sizeLength));
      }
      segmentChildren.push(...clusters);
    } else {
      segmentChildren.push(...clusters, cuesElement);
    }
  } else {
    if (reserveIndexSpace > 0) {
      const padding = Math.max(2, reserveIndexSpace);
      let sizeLength = 1;
      while (padding - 1 - sizeLength >= 2 ** (7 * sizeLength) - 1) sizeLength++;
      segmentChildren.push(makeEbmlElement(0xec, new Uint8Array(padding - 1 - sizeLength), sizeLength));
    }
    segmentChildren.push(...clusters);
  }

  const segmentSize = segmentChildren.reduce((size, element) => size + element.byteLength, 0);
  budget.checkOutputBytes(ebmlHeader.byteLength + 4 + (options.live ? 8 : writeVintSize(segmentSize).length) + segmentSize);
  const segmentElem = options.live
    ? concatBytes([writeEbmlId(0x18538067), new Uint8Array([0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]), ...segmentChildren])
    : makeEbmlElement(0x18538067, concatBytes(segmentChildren));
  return concatBytes([ebmlHeader, segmentElem]);
}

// Matroska StereoMode order; anaglyph modes have tags but no Stereo 3D side data.
const STEREO_MODES: readonly (readonly [string | undefined, string | undefined, number])[] = [
  [undefined, "2D", 0],
  ["left_right", "side by side", 0],
  ["bottom_top", "top and bottom", 1],
  ["top_bottom", "top and bottom", 0],
  ["checkerboard_rl", "checkerboard", 1],
  ["checkerboard_lr", "checkerboard", 0],
  ["row_interleaved_rl", "interleaved lines", 1],
  ["row_interleaved_lr", "interleaved lines", 0],
  ["col_interleaved_rl", "interleaved columns", 1],
  ["col_interleaved_lr", "interleaved columns", 0],
  ["anaglyph_cyan_red", undefined, 0],
  ["right_left", "side by side", 1],
  ["anaglyph_green_magenta", undefined, 0],
  ["block_lr", "frame alternate", 0],
  ["block_rl", "frame alternate", 1]
];

function probeMkvProjection(bytes: Uint8Array, width: number, height: number): Record<string, string | number> | undefined {
  let type = 0, yaw = 0, pitch = 0, roll = 0;
  let privateData: Uint8Array = new Uint8Array();
  for (let pos = 0; pos < bytes.length;) {
    const id = readVint(bytes, pos, false);
    if (!id) return;
    pos += id.length;
    const size = readVint(bytes, pos, true);
    if (!size || size.unknownSize) return;
    pos += size.length;
    if (size.value > bytes.length - pos) return;
    const payload = bytes.subarray(pos, pos + size.value);
    if (id.value === 0x7671) type = readEbmlUint(payload);
    else if (id.value === 0x7672) privateData = payload;
    else if (id.value === 0x7673) yaw = readEbmlFloat(payload);
    else if (id.value === 0x7674) pitch = readEbmlFloat(payload);
    else if (id.value === 0x7675) roll = readEbmlFloat(payload);
    pos += size.value;
  }
  if (type !== 1 && type !== 2 || privateData.length && privateData[0] !== 0) return;
  const data = new DataView(privateData.buffer, privateData.byteOffset, privateData.byteLength);
  const mapping: Record<string, string | number> = {
    side_data_type: "Spherical Mapping",
    projection: type === 1 ? "equirectangular" : "cubemap"
  };
  if (type === 2) {
    if (privateData.length !== 12) throw new Error("Invalid Matroska cubemap projection metadata");
    if (data.getUint32(4) !== 0) return; // Unknown cubemap layout.
    mapping.padding = data.getUint32(8);
  } else if (privateData.length) {
    if (privateData.length !== 20) throw new Error("Invalid Matroska equirectangular projection metadata");
    const top = data.getUint32(4), bottom = data.getUint32(8), left = data.getUint32(12), right = data.getUint32(16);
    const max = 0xffffffff;
    if (top + bottom >= max || left + right >= max) throw new Error("Invalid Matroska projection bounds");
    if (top || bottom || left || right) {
      const fullWidth = Math.floor(width * max / (max - left - right));
      const fullHeight = Math.floor(height * max / (max - top - bottom));
      mapping.projection = "tiled equirectangular";
      mapping.bound_left = Math.ceil(fullWidth * left / max);
      mapping.bound_top = Math.ceil(fullHeight * top / max);
      mapping.bound_right = fullWidth - width - mapping.bound_left;
      mapping.bound_bottom = fullHeight - height - mapping.bound_top;
    }
  }
  // ffprobe prints integral degrees after the demuxer's signed 16.16 conversion.
  mapping.yaw = Math.trunc((yaw * 65536 | 0) / 65536) || 0;
  mapping.pitch = Math.trunc((pitch * 65536 | 0) / 65536) || 0;
  mapping.roll = Math.trunc((roll * 65536 | 0) / 65536) || 0;
  return mapping;
}

export function probeMkv(
  bytes: Uint8Array,
  options: ParseMediaOptions & { showPackets?: boolean; showFrames?: boolean } = {}
): MediaProbeResult {
  const doc = parseMkv(bytes, options);
  const probe = buildProbeResultFromDoc(doc, bytes.byteLength, options.filename ?? "input.mkv", {
    ...options,
    formatName: "matroska,webm",
    formatLongName: "Matroska / WebM"
  });
  // Matroska exposes WritingApp as ENCODER; keep normalized metadata for muxing.
  let formatTags = probe.format.tags;
  if (probe.format.tags?.encoder !== undefined) {
    const { encoder, ...tags } = probe.format.tags;
    formatTags = { ...tags, ENCODER: encoder };
  }
  const streams = [...probe.streams.map((stream, index) => {
    const desc = doc.tracks[index]?.codecDescriptions[0];
    const mode = desc?.stereoMode;
    const stereo = mode === undefined ? undefined : STEREO_MODES[mode];
    if (stream.codec_type !== "video") return stream;
    const spherical = desc?.rawMkvProjectionBytes && probeMkvProjection(desc.rawMkvProjectionBytes, stream.width ?? 0, stream.height ?? 0);
    const [tag, type, inverted] = stereo ?? [];
    const sideData = [...stream.side_data_list ?? [],
      ...(type ? [{ side_data_type: "Stereo 3D", type, inverted }] : []),
      ...(spherical ? [spherical] : [])];
    return {
      ...stream,
      ...(tag ? { tags: { ...stream.tags, stereo_mode: tag } } : {}),
      ...(sideData.length ? { side_data_list: sideData } : {})
    };
  }), ...doc.attachments.map((attachment, index) => ({
    index: probe.streams.length + index,
    codec_type: "attachment" as const,
    codec_tag_string: "[0][0][0][0]",
    codec_tag: "0x0000",
    r_frame_rate: "0/0",
    avg_frame_rate: "0/0",
    time_base: "1/90000",
    start_pts: 0,
    start_time: "0.000000",
    duration_ts: Math.round(doc.durationSeconds * 90000),
    duration: doc.durationSeconds.toFixed(6),
    extradata_size: attachment.size,
    disposition: Object.fromEntries([
      "default", "dub", "original", "comment", "lyrics", "karaoke", "forced",
      "hearing_impaired", "visual_impaired", "clean_effects", "attached_pic",
      "timed_thumbnails", "non_diegetic", "captions", "descriptions", "metadata",
      "dependent", "still_image", "multilayer"
    ].map(name => [name, 0])),
    tags: attachment.tags
  }))];
  return { ...probe, streams, format: { ...probe.format, tags: formatTags, nb_streams: streams.length } };
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
