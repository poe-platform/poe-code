import { encodeAmrTrack } from "./amr.js";
import { composeDisplayMatrices } from "./display-matrix.js";
import { decodeMp4Timecode } from "./mp4-timecode-sample.js";
import { decodeAmrWb } from "./amr-wb.js";
import { encodeAlacTrack } from "./alac.js";
import { decodeAmrNb } from "./amr-nb.js";
import { decodeAlac } from "./alac-decoder.js";
import { decodeMovText, encodeMovText } from "./mov-text.js";
import { parseImaQt } from "./containers/aiff-ima.js";
import { rawAudioAsts } from "./containers/raw-audio.js";
import { readImageMetadata } from "@poe-code/image-ast/portable";
import { h264FieldOrderSteps } from './h264-field-order.js';
import { buildProbeStream } from './probe-stream.js';
import { mp4TextMetadataKeys, mp4ProbeMetadataKeys } from './mp4-metadata.js';
import { sampleEntryHeader, applyCodecMetadata, finishCodecMetadata } from './mp4-codec-metadata.js';
import { mp4FragmentHeader, mp4FragmentTime, mp4FragmentRunSteps } from "./mp4-fragment-source.js";
import { mp4SampleTableSteps, type Mp4SampleTables } from "./mp4-sample-source.js";
import { mp4BoxLayout, mp4BoxChildrenOffset } from "./mp4-box-layout.js";
import { decodeH264Samples } from "./h264.js";
import { drainWork } from "./work.js";
import {
  BinaryReader,
  BinaryWriter,
  BitWriter,
  bytesEqual,
  concatBytes,
  detachBytesBuffer,
  decodeFourCC,
  decodeUtf8,
  encodeUtf8,
  escapeRbsp,
  IDENTITY_MATRIX,
  makeBox,
  makeFullBox,
  matrixForRotation,
  packIsoLanguage,
  rotationFromMatrix,
  unpackIsoLanguage
} from "./binary.js";
import {
  buildAudioSpecificConfig,
  buildAvcC,
  buildEsdsBox,
  buildH264SpsPps,
  createSilentAacFrame,
  encodeH264IdrFrame,
  parseAv1C,
  parseAvcC,
  parseDOps,
  parseEsds,
  parseHvcC,
  parseVpcC
} from "./codecs.js";
import {
  MediaBudgetTracker,
  type ConcatMediaOptions,
  type MediaAstPlugin,
  type MediaAudioData,
  type MediaCodecDescription,
  type MediaDocument,
  type MediaProbeFrame,
  type MediaProbePacket,
  type MediaProbeResult,
  type MediaProbeStream,
  type MediaSample,
  type MediaTrack,
  type MediaTrackType,
  type MediaVideoFrame,
  type Mp4Box,
  type Mp4Chapter,
  type Mp4Document,
  type Mp4EditListEntry,
  type Mp4MetadataTags,
  type MuxMediaOptions,
  type ParseMediaOptions,
  type SerializeMediaOptions,
  type SliceMediaOptions
} from "./types.js";

export function isMp4Signature(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 8) return false;
  const type = decodeFourCC(bytes, 4);
  return (
    type === "ftyp" ||
    type === "styp" ||
    type === "moov" ||
    type === "mdat" ||
    type === "wide" ||
    type === "free" ||
    type === "skip" ||
    type === "pnot"
  );
}

export function parseMp4Boxes(
  bytes: Uint8Array,
  baseOffset = 0,
  depth = 0,
  budget?: MediaBudgetTracker
): Mp4Box[] {
  budget?.checkBoxDepth(depth);
  const boxes: Mp4Box[] = [];
  let offset = 0;

  while (offset + 8 <= bytes.byteLength) {
    budget?.checkCpu();
    const layout = mp4BoxLayout(bytes.subarray(offset, offset + 16), bytes.byteLength - offset);
    if (!layout) break;
    const { type, size, headerSize, uuidOffset } = layout;
    const uuid = uuidOffset === undefined ? undefined : bytes.subarray(offset + uuidOffset, offset + uuidOffset + 16);
    const payload = bytes.subarray(offset + headerSize, offset + size);
    const childOffset = mp4BoxChildrenOffset(type, payload.length, type === "meta" && payload.length >= 12 ? decodeFourCC(payload, 8) : undefined);
    const children = childOffset === undefined ? undefined : parseMp4Boxes(payload.subarray(childOffset), baseOffset + offset + headerSize + childOffset, depth + 1, budget);

    boxes.push({
      type,
      offset: baseOffset + offset,
      size,
      headerSize,
      uuid,
      payload,
      children
    });

    offset += size;
  }

  return boxes;
}

function findBox(boxes: readonly Mp4Box[] | undefined, type: string): Mp4Box | undefined {
  if (!boxes) return undefined;
  return boxes.find((b) => b.type === type);
}

function findBoxes(boxes: readonly Mp4Box[] | undefined, type: string): Mp4Box[] {
  if (!boxes) return [];
  return boxes.filter((b) => b.type === type);
}

function parseStsdBox(payload: Uint8Array): MediaCodecDescription[] {
  const reader = new BinaryReader(payload);
  if (reader.remaining < 8) return [];
  reader.skip(4); const entryCount = reader.readU32BE(), descriptions: MediaCodecDescription[] = [];
  for (let i = 0; i < entryCount && reader.remaining >= 8; i++) {
    const start = reader.offset, size = reader.readU32BE(), format = reader.readFourCC();
    if (size < 8 || start + size > payload.length) break;
    const body = payload.subarray(start + 8, start + size), state = sampleEntryHeader(format, body);
    let alacData: Uint8Array | undefined;
    let avcC: ReturnType<typeof parseAvcC> | undefined, hvcC: ReturnType<typeof parseHvcC> | undefined,
      av1C: ReturnType<typeof parseAv1C> | undefined, vpcC: ReturnType<typeof parseVpcC> | undefined,
      esds: ReturnType<typeof parseEsds> | undefined, dOps: ReturnType<typeof parseDOps> | undefined;
    if (state.childOffset !== undefined && state.childOffset < body.length) {
      for (const child of parseMp4Boxes(body.subarray(state.childOffset))) {
        if (state.kind === 'video') {
          if (child.type === 'avcC') { avcC = parseAvcC(child.payload); applyCodecMetadata(state, { type: 'avcC', extradataSize: child.payload.length, profileIdc: avcC.profileIdc, profileCompatibility: avcC.profileCompatibility, levelIdc: avcC.levelIdc, nalLengthSize: avcC.lengthSizeMinusOne + 1, sps: avcC.sps[0] }); }
          else if (child.type === 'hvcC') { hvcC = parseHvcC(child.payload); applyCodecMetadata(state, { ...hvcC, type: 'hvcC' }); }
          else if (child.type === 'av1C') { av1C = parseAv1C(child.payload); applyCodecMetadata(state, { ...av1C, type: 'av1C' }); }
          else if (child.type === 'vpcC') { vpcC = parseVpcC(child.payload); applyCodecMetadata(state, { ...vpcC, type: 'vpcC' }); }
          else if (child.type === 'colr') applyCodecMetadata(state, { type: 'colr', payload: child.payload });
          else if (child.type === 'esds') esds = parseEsds(child.payload);
          else if (child.type === 'pasp' && child.payload.length >= 8) {
            const aspect = new BinaryReader(child.payload);
            applyCodecMetadata(state, { type: 'pasp', sarWidth: aspect.readU32BE(), sarHeight: aspect.readU32BE() });
          }
        } else if (state.kind === 'audio') {
          const alac = child.type === 'alac' ? child : format === 'alac' && child.type === 'wave'
            ? findBox(parseMp4Boxes(child.payload, child.offset + child.headerSize), 'alac') : undefined;
          if (format === 'alac' && alac) alacData = body.subarray(state.childOffset + alac.offset, state.childOffset + alac.offset + alac.size);
          if (child.type === 'esds') { esds = parseEsds(child.payload); applyCodecMetadata(state, { type: 'esds', config: esds }); }
          else if (child.type === 'dOps') { dOps = parseDOps(child.payload); applyCodecMetadata(state, { ...dOps, type: 'dOps' }); }
          else if (child.type === 'wave' && child.children) {
            const nested = findBox(child.children, 'esds');
            if (nested) { esds = parseEsds(nested.payload); applyCodecMetadata(state, { type: 'wave-esds', config: esds }); }
          }
        }
      }
    }
    descriptions.push({ ...finishCodecMetadata(state), extraData: alacData ?? avcC?.rawBytes ?? (esds?.decoderSpecificInfoSize ? esds.decoderSpecificInfo : undefined) ?? state.metadata.extraData, avcC, hvcC, av1C, vpcC, esds, dOps, rawStsdEntryBytes: payload.subarray(start, start + size) });
    reader.seek(start + size);
  }
  return descriptions;
}

function parseMetadataTags(moov: Mp4Box): Mp4MetadataTags {
  const udta = findBox(moov.children, "udta");
  const meta = findBox(udta?.children, "meta") ?? findBox(moov.children, "meta");
  const ilst = findBox(meta?.children, "ilst");
  if (!ilst || !ilst.children) return {};

  const tags: {
    title?: string;
    artist?: string;
    albumArtist?: string;
    composer?: string;
    compilation?: string;
    album?: string;
    date?: string;
    comment?: string;
    genre?: string;
    encoder?: string;
    trackNumber?: string;
    discNumber?: string;
    description?: string;
    copyright?: string;
    coverArt?: { mimeType: "image/jpeg" | "image/png"; data: Uint8Array };
    custom: Record<string, string>;
  } = { custom: {} };

  const keys = findBox(meta?.children, "keys")?.payload;
  const names = new Map<number, string>();
  if (keys && keys.length >= 8) {
    const reader = new BinaryReader(keys);
    reader.skip(4);
    const count = reader.readU32BE();
    for (let index = 1; index <= count && reader.remaining >= 8; index++) {
      const size = reader.readU32BE(), namespace = reader.readFourCC();
      if (size < 8 || size - 8 > reader.remaining) break;
      const offset = reader.offset;
      if (namespace === "mdta") names.set(index, decodeUtf8(keys.subarray(offset, offset + size - 8)));
      reader.skip(size - 8);
    }
  }

  for (const item of ilst.children) {
    const itemChildren = item.children ?? parseMp4Boxes(item.payload);
    const dataBox = findBox(itemChildren, "data");
    const payload = dataBox ? dataBox.payload : item.payload;
    if (!dataBox && payload.byteLength < 8) continue;

    // `data` box payload has 4-byte type_indicator + 4-byte locale before value
    const typeIndicator = dataBox && payload.byteLength >= 8
      ? new DataView(payload.buffer, payload.byteOffset, 4).getUint32(0, false)
      : 1;
    const valueBytes = dataBox && payload.byteLength >= 8 ? payload.subarray(8) : payload;

    const name = names.get([...item.type].reduce((index, char) => index * 256 + char.charCodeAt(0), 0));
    if (name !== undefined) {
      if (typeIndicator !== 1) continue;
      const text = decodeUtf8(valueBytes).replace(/\0+$/, "");
      const key = (Object.keys(mp4ProbeMetadataKeys) as (keyof typeof mp4ProbeMetadataKeys)[])
        .find(key => mp4ProbeMetadataKeys[key] === name);
      if (key) tags[key] = text;
      else Object.defineProperty(tags.custom, name, { value: text, enumerable: true, configurable: true });
      continue;
    }
    if (keys) continue;

    if (item.type === "cpil") {
      if (dataBox && payload.byteLength >= 9) tags.compilation = String(valueBytes[0]);
      continue;
    }

    if (item.type === "covr") {
      if (typeIndicator !== 13 && typeIndicator !== 14) continue;
      const mimeType = typeIndicator === 14 ? "image/png" : "image/jpeg";
      tags.coverArt = { mimeType, data: valueBytes };
      continue;
    }

    if (item.type === "trkn" || item.type === "disk") {
      if (valueBytes.byteLength >= 6) {
        const view = new DataView(valueBytes.buffer, valueBytes.byteOffset, valueBytes.byteLength);
        const num = view.getUint16(2, false);
        const total = view.getUint16(4, false);
        const str = total > 0 ? `${num}/${total}` : `${num}`;
        if (item.type === "trkn") tags.trackNumber = str;
        else tags.discNumber = str;
      }
      continue;
    }

    const text = decodeUtf8(valueBytes).replace(/\0+$/, "");
    if (!text) continue;

    const key = mp4TextMetadataKeys[item.type];
    if (key) tags[key] = text;
    else tags.custom[item.type] = text;
  }

  return tags;
}


function parseMp4Chapters(moovBox: Mp4Box, durationSeconds: number, tracks: readonly MediaTrack[], chapterSamples: ReadonlyMap<number, readonly MediaSample[]>): Mp4Chapter[] {
  for (const track of tracks) {
    const chapters: Mp4Chapter[] = [];
    for (const sample of chapterSamples.get(track.id) ?? []) {
      // Chapter titles are length-prefixed text, followed by optional styling boxes.
      const packet = sample.data;
      if (packet.length < 2) continue;
      const length = new BinaryReader(packet).readU16BE();
      if (length > packet.length - 2) continue;
      chapters.push({ id: chapters.length, startTimeSeconds: sample.dts / track.timescale,
        endTimeSeconds: (sample.dts + sample.duration) / track.timescale,
        title: decodeUtf8(packet.subarray(2, 2 + length)) });
    }
    if (chapters.length) return chapters;
  }
  const udta = findBox(moovBox.children, "udta");
  const chpl = findBox(udta?.children, "chpl");
  if (!chpl || chpl.payload.byteLength < 9) return [];
  const r = new BinaryReader(chpl.payload);
  r.skip(4); // version + flags
  r.skip(4); // reserved
  let count = r.readU8();
  if (count === 0 && r.remaining >= 4) {
    count = r.readU32BE();
  }
  const rawList: { id: number; startTimeSeconds: number; title: string }[] = [];
  for (let i = 0; i < count && r.remaining >= 9; i++) {
    const start100ns = r.readU64BE();
    const titleLen = r.readU8();
    const title = decodeUtf8(r.readSlice(Math.min(titleLen, r.remaining)));
    rawList.push({
      id: i,
      startTimeSeconds: start100ns / 10_000_000,
      title
    });
  }
  return rawList.map((item, idx) => ({
    id: item.id,
    startTimeSeconds: item.startTimeSeconds,
    endTimeSeconds: rawList[idx + 1]?.startTimeSeconds ?? Math.max(item.startTimeSeconds, durationSeconds),
    title: item.title
  }));
}

export function parseMp4(bytes: Uint8Array, options: ParseMediaOptions = {}): Mp4Document {
  const budget = options.budget ?? new MediaBudgetTracker(options.limits);
  budget.checkInputBytes(bytes.byteLength);
  budget.allocateMemory(Math.min(bytes.byteLength, 65536));

  const topBoxes = parseMp4Boxes(bytes, 0, 0, budget);
  const ftypBox = findBox(topBoxes, "ftyp") ?? findBox(topBoxes, "styp");
  let majorBrand = "isom";
  let minorVersion = 512;
  const compatibleBrands: string[] = [];

  if (ftypBox && ftypBox.payload.byteLength >= 8) {
    const fReader = new BinaryReader(ftypBox.payload);
    majorBrand = fReader.readFourCC();
    minorVersion = fReader.readU32BE();
    while (fReader.remaining >= 4) {
      compatibleBrands.push(fReader.readFourCC());
    }
  }

  const moovBox = findBox(topBoxes, "moov");
  const mdatBox = findBox(topBoxes, "mdat");
  const moofBoxes = findBoxes(topBoxes, "moof");
  const faststart =
    moovBox !== undefined && (mdatBox === undefined || moovBox.offset < mdatBox.offset);

  if (!moovBox) {
    throw new Error("Invalid MP4/ISOBMFF file: missing 'moov' atom");
  }

  const mvhdBox = findBox(moovBox.children, "mvhd");
  let movieTimescale = 1000;
  let movieDuration = 0;
  let creationTime = 0;
  let modificationTime = 0;
  let movieMatrix = IDENTITY_MATRIX;

  if (mvhdBox && mvhdBox.payload.byteLength >= 20) {
    const mReader = new BinaryReader(mvhdBox.payload);
    const version = mReader.readU8();
    mReader.skip(3); // flags
    if (version === 1) {
      creationTime = mReader.readU64BE();
      modificationTime = mReader.readU64BE();
      movieTimescale = mReader.readU32BE() || 1000;
      movieDuration = mReader.readU64BE();
    } else {
      creationTime = mReader.readU32BE();
      modificationTime = mReader.readU32BE();
      movieTimescale = mReader.readU32BE() || 1000;
      movieDuration = mReader.readU32BE();
    }
    if (mReader.remaining >= 52) {
      mReader.skip(16); // rate, volume and reserved
      movieMatrix = Array.from({ length: 9 }, () => mReader.readI32BE());
    }
  }

  // Parse trex default fragment values if mvex exists
  const mvexBox = findBox(moovBox.children, "mvex");
  const trexDefaults = new Map<
    number,
    {
      defaultSampleDescriptionIndex: number;
      defaultSampleDuration: number;
      defaultSampleSize: number;
      defaultSampleFlags: number;
    }
  >();
  if (mvexBox && mvexBox.children) {
    for (const trex of findBoxes(mvexBox.children, "trex")) {
      if (trex.payload.byteLength >= 24) {
        const r = new BinaryReader(trex.payload);
        r.skip(4); // version + flags
        const trackId = r.readU32BE();
        trexDefaults.set(trackId, {
          defaultSampleDescriptionIndex: r.readU32BE() || 1,
          defaultSampleDuration: r.readU32BE() || 1024,
          defaultSampleSize: r.readU32BE() || 0,
          defaultSampleFlags: r.readU32BE()
        });
      }
    }
  }

  const trakBoxes = findBoxes(moovBox.children, "trak");
  budget.checkStreams(trakBoxes.length);
  const chapterSamples = new Map<number, MediaSample[]>();
  const chapterTrackIds = new Set<number>();
  for (const trak of trakBoxes) {
    const reference = findBox(findBox(trak.children, "tref")?.children, "chap");
    if (!reference) continue;
    const reader = new BinaryReader(reference.payload);
    while (reader.remaining >= 4) chapterTrackIds.add(reader.readU32BE());
  }
  const tracks: MediaTrack[] = [];

  for (let tIdx = 0; tIdx < trakBoxes.length; tIdx++) {
    const trak = trakBoxes[tIdx]!;
    const tkhd = findBox(trak.children, "tkhd");
    let trackId = tIdx + 1;
    let enabled = true;
    let tkhdDuration = 0;
    let volume = 1.0;
    let width: number | undefined;
    let height: number | undefined;
    let matrix = movieMatrix;

    if (tkhd && tkhd.payload.byteLength >= 24) {
      const tReader = new BinaryReader(tkhd.payload);
      const version = tReader.readU8();
      const flags = tReader.readU24BE();
      enabled = (flags & 0x01) !== 0;
      if (version === 1) {
        tReader.skip(16); // creation + modification
        trackId = tReader.readU32BE();
        tReader.skip(4); // reserved
        tkhdDuration = tReader.readU64BE();
      } else {
        tReader.skip(8);
        trackId = tReader.readU32BE();
        tReader.skip(4);
        tkhdDuration = tReader.readU32BE();
      }
      tReader.skip(8); // reserved
      tReader.skip(2 + 2); // layer + alternateGroup
      volume = tReader.readFixed8_8();
      tReader.skip(2); // reserved
      const trackMatrix = Array.from({ length: 9 }, () => tReader.readI32BE());
      matrix = composeDisplayMatrices(trackMatrix, movieMatrix);
      const w = Math.round(tReader.readFixed16_16());
      const h = Math.round(tReader.readFixed16_16());
      if (w > 0) width = w;
      if (h > 0) height = h;
    }

    const edts = findBox(trak.children, "edts");
    const elst = findBox(edts?.children, "elst");
    const editList: Mp4EditListEntry[] = [];
    if (elst && elst.payload.byteLength >= 8) {
      const eReader = new BinaryReader(elst.payload);
      const version = eReader.readU8();
      eReader.skip(3);
      const entryCount = eReader.readU32BE();
      for (let i = 0; i < entryCount && !eReader.eof; i++) {
        const segmentDuration = version === 1 ? eReader.readU64BE() : eReader.readU32BE();
        const mediaTime = version === 1 ? eReader.readI64BE() : eReader.readI32BE();
        const mediaRateInteger = eReader.readI16BE();
        const mediaRateFraction = eReader.readI16BE();
        editList.push({ segmentDuration, mediaTime, mediaRateInteger, mediaRateFraction });
      }
    }

    const mdia = findBox(trak.children, "mdia");
    const mdhd = findBox(mdia?.children, "mdhd");
    let timescale = movieTimescale;
    let trackDuration = 0;
    let language = "und";

    if (mdhd && mdhd.payload.byteLength >= 20) {
      const mReader = new BinaryReader(mdhd.payload);
      const version = mReader.readU8();
      mReader.skip(3);
      if (version === 1) {
        mReader.skip(16);
        timescale = mReader.readU32BE() || 1000;
        trackDuration = mReader.readU64BE();
      } else {
        mReader.skip(8);
        timescale = mReader.readU32BE() || 1000;
        trackDuration = mReader.readU32BE();
      }
      language = unpackIsoLanguage(mReader.readU16BE());
    }

    const hdlr = findBox(mdia?.children, "hdlr");
    let handlerType = "vide";
    let handlerName = "";
    if (hdlr && hdlr.payload.byteLength >= 12) {
      const hReader = new BinaryReader(hdlr.payload);
      hReader.skip(8); // version + flags + pre_defined
      handlerType = hReader.readFourCC();
      hReader.skip(12); // reserved
      handlerName = hReader.readNullTerminatedString();
    }

    const minf = findBox(mdia?.children, "minf");
    const stbl = findBox(minf?.children, "stbl");

    const stsd = findBox(stbl?.children, "stsd");
    const codecDescriptions = stsd ? parseStsdBox(stsd.payload) : [];
    const firstCodec = codecDescriptions[0];
    // Sample descriptions contain pixel dimensions; tkhd contains display dimensions.
    if (firstCodec?.width) width = firstCodec.width;
    if (firstCodec?.height) height = firstCodec.height;

    const type: MediaTrackType =
      handlerType === "vide"
        ? "video"
        : handlerType === "soun"
          ? "audio"
          : handlerType === "sbtl" || handlerType === "text" || handlerType === "subp"
            ? "subtitle"
            : "data";

    // Traverse classic tables directly; only the explicit document's samples are collected.
    const tables: Mp4SampleTables = {};
    for (const name of ['stts', 'ctts', 'stsc', 'stsz', 'stco', 'co64', 'stss'] as const) {
      const box = findBox(stbl?.children, name);
      if (box) tables[name] = { payloadOffset: box.offset + box.headerSize, payloadSize: box.payload.length };
    }
    const sizeTable = findBox(stbl?.children, "stsz");
    const sizeReader = new BinaryReader(sizeTable?.payload ?? new Uint8Array());
    sizeReader.skip(8);
    const declaredSampleCount = (sizeTable?.payload.length ?? 0) >= 12 ? sizeReader.readU32BE() : 0;
    const samples: MediaSample[] = [], syncSamples = new Set<number>();
    const steps = mp4SampleTableSteps(bytes.length, tables, { type: type === "subtitle" ? "data" : type, budget });
    let answer: Uint8Array | boolean | undefined;
    for (;;) {
      const next = steps.next(answer); if (next.done) break;
      const step = next.value; answer = undefined;
      if (step.kind === 'read') answer = bytes.subarray(step.offset, step.offset + step.length);
      else if (step.kind === 'sync-add') syncSamples.add(step.sample);
      else if (step.kind === 'sync-has') answer = syncSamples.has(step.sample);
      else { const { offset, ...sample } = step.sample; samples.push({ ...sample, offset, data: bytes.subarray(offset, offset + sample.size) }); }
    }

    const rawChapterSamples = chapterTrackIds.has(trackId) ? samples.slice() : undefined;
    if (rawChapterSamples) chapterSamples.set(trackId, rawChapterSamples);

    // Keep tx3g extension boxes until text decoding; packet scans remain byte ranges.
    if (type === "subtitle" && options.decodeSubtitles !== false) {
      let kept = 0;
      for (const sample of samples) {
        if (codecDescriptions[sample.sampleDescriptionIndex - 1]?.codecName !== "mov_text") {
          samples[kept++] = sample;
          continue;
        }
        const data = decodeMovText(sample.data);
        if (!data.length) continue;
        samples[kept++] = { ...sample, data, size: data.length,
          ...(sample.offset !== undefined ? { offset: sample.offset + 2 } : {}) };
      }
      samples.length = kept;
    }

    // Reconstruct samples from fragmented MP4 (`moof` -> `traf` -> `tfhd`/`tfdt`/`trun`)
    if (moofBoxes.length > 0) {
      const trex = trexDefaults.get(trackId) ?? {
        defaultSampleDescriptionIndex: 1,
        defaultSampleDuration: type === "video" ? 3000 : 1024,
        defaultSampleSize: 0,
        defaultSampleFlags: 0
      };
      let runningDts = samples.length > 0
        ? samples[samples.length - 1]!.dts + samples[samples.length - 1]!.duration
        : 0;

      for (const moof of moofBoxes) {
        const trafBoxes = findBoxes(moof.children, "traf");
        for (const traf of trafBoxes) {
          const tfhd = findBox(traf.children, "tfhd");
          if (!tfhd || tfhd.payload.byteLength < 8) continue;
          const fragmentOptions = { trackId, moofOffset: moof.offset, defaults: trex, type, budget };
          const header = mp4FragmentHeader(tfhd.payload, fragmentOptions);
          if (!header) continue;
          const tfdt = findBox(traf.children, "tfdt");
          if (tfdt) runningDts = mp4FragmentTime(tfdt.payload, runningDts);
          for (const trun of findBoxes(traf.children, "trun")) {
            const steps = mp4FragmentRunSteps(bytes.byteLength,
              { payloadOffset: trun.offset + trun.headerSize, payloadSize: trun.payload.byteLength },
              header, { dts: runningDts, sampleCount: samples.length }, fragmentOptions);
            let answer: Uint8Array | undefined;
            for (;;) {
              const next = steps.next(answer);
              if (next.done) { runningDts = next.value.dts; break; }
              const step = next.value;
              if (step.kind === 'read') answer = bytes.subarray(step.offset, step.offset + step.length);
              else if (step.kind === 'sample') {
                const { offset, ...sample } = step.sample;
                samples.push({ ...sample, offset, data: bytes.subarray(offset, offset + sample.size) });
                rawChapterSamples?.push(samples[samples.length - 1]!);
              }
            }
          }
        }
      }
    }

    // Fragmented initialization files can leave the final media edit open-ended.
    // Its duration becomes known only after the following fragments are parsed.
    if (moofBoxes.length > 0) {
      for (let i = 0; i < editList.length; i++) {
        const edit = editList[i]!;
        if (edit.segmentDuration === 0 && edit.mediaTime >= 0) {
          const mediaEnd = samples.reduce((end, sample) => Math.max(end, sample.pts + sample.duration), 0);
          editList[i] = { ...edit, segmentDuration: Math.round(Math.max(0, mediaEnd - edit.mediaTime) * movieTimescale / timescale) };
        }
      }
    }

    const computedDuration = editList.length > 0
      ? Math.round(editList.reduce((total, edit) => total + edit.segmentDuration, 0) * timescale / movieTimescale)
      : samples.reduce((acc, s) => type === "subtitle" ? Math.max(acc, s.pts + s.duration) : acc + s.duration, 0) ||
      trackDuration ||
      Math.round((tkhdDuration / Math.max(1, movieTimescale)) * timescale);

    let decodedVideoFrames: MediaVideoFrame[] | undefined;
    if (options.decodeFrames && type === "video" && width && height) {
      decodedVideoFrames = [];
      for (const frame of decodeH264Samples(samples, codecDescriptions, width, height, Math.max(1, timescale))) {
        budget.recordFrame(frame.width, frame.height);
        decodedVideoFrames.push(frame);
      }
    }

    const timecodeReference = findBox(findBox(trak.children, "tref")?.children, "tmcd");
    const audioDescription = codecDescriptions[0];
    const pcmDecoder = type === "audio" && options.decodeAudio !== false
      ? rawAudioAsts().find(plugin => plugin.supportedAudioCodecs.includes(audioDescription?.codecName ?? ""))
      : undefined;
    let alacAudio: MediaAudioData | undefined;
    if (type === "audio" && options.decodeAudio !== false && audioDescription?.codecName === "alac") {
      const entry = audioDescription.rawStsdEntryBytes;
      const childOffset = entry && sampleEntryHeader("alac", entry.subarray(8)).childOffset;
      const boxes = entry && childOffset !== undefined
        ? parseMp4Boxes(entry.subarray(8 + childOffset), 0, 0, budget) : [];
      const wave = boxes.find(box => box.type === "wave");
      const config = boxes.find(box => box.type === "alac") ??
        (wave && parseMp4Boxes(wave.payload, 0, 0, budget).find(box => box.type === "alac"));
      if (!config || config.payload.length !== 28) throw new Error("Missing MOV ALAC decoder configuration");
      alacAudio = decodeAlac(samples, config.payload.subarray(4), budget);
    }
    let imaAudio: MediaAudioData | undefined;
    if (type === "audio" && options.decodeAudio !== false && audioDescription?.codecName === "adpcm_ima_qt") {
      const { channels, sampleRate } = audioDescription;
      if (!channels || !sampleRate) throw new Error("Invalid MOV IMA audio description");
      const data = concatBytes(samples.map(sample => sample.data));
      imaAudio = parseImaQt(data, channels, sampleRate, data.length / (34 * channels), options, budget)
        .tracks[0]!.decodedAudio;
    }
    tracks.push({
      id: trackId,
      timecodeTrackId: timecodeReference && timecodeReference.payload.length >= 4
        ? new BinaryReader(timecodeReference.payload).readU32BE() : undefined,
      type,
      handlerType,
      handlerName: handlerName || undefined,
      timescale,
      duration: computedDuration,
      language,
      enabled,
      width,
      height,
      rotation: rotationFromMatrix(matrix),
      matrix: matrix.length === 9 ? matrix : IDENTITY_MATRIX,
      volume,
      codecDescriptions,
      editList: editList.length > 0 ? editList : undefined,
      declaredSampleCount,
      samples,
      ...(pcmDecoder && audioDescription ? {
        decodedAudio: pcmDecoder
          .parse(concatBytes(samples.map(sample => sample.data)), {
            ...options, budget, sampleRate: audioDescription.sampleRate, channels: audioDescription.channels
          }).tracks[0]!.decodedAudio
      } : {}),
      ...(alacAudio ? { decodedAudio: alacAudio } : {}),
      ...(imaAudio ? { decodedAudio: imaAudio } : {}),
      ...(type === "audio" && options.decodeAudio !== false && audioDescription?.codecName === "amr_wb"
        ? { decodedAudio: decodeAmrWb(samples, budget) } : {}),
      ...(type === "audio" && options.decodeAudio !== false && audioDescription?.codecName === "amr_nb"
        ? { decodedAudio: decodeAmrNb(samples, budget) } : {}),
      decodedVideoFrames
    });
  }

  let maxTrackSeconds = movieDuration / Math.max(1, movieTimescale);
  for (const track of tracks) {
    const sec = track.duration / Math.max(1, track.timescale);
    if (sec > maxTrackSeconds) maxTrackSeconds = sec;
  }
  budget.checkDuration(maxTrackSeconds);

  const isMov = majorBrand === "qt  " || compatibleBrands.includes("qt  ");
  const metadata = parseMetadataTags(moovBox);
  if (metadata.coverArt) {
    budget.checkStreams(tracks.length + 1);
    const { data, mimeType } = metadata.coverArt;
    const { width, height } = readImageMetadata(data);
    const codecName = mimeType === "image/png" ? "png" : "mjpeg";
    tracks.push({
      id: Math.max(0, ...tracks.map(track => track.id)) + 1,
      type: "video", handlerType: "vide", timescale: 90000,
      duration: Math.round(maxTrackSeconds * 90000), language: "und", enabled: true,
      width, height, disposition: { attached_pic: 1 },
      codecDescriptions: [{ formatFourCC: "\0\0\0\0", codecName, width, height }],
      samples: [{ data, size: data.length, offset: data.byteOffset - bytes.byteOffset, dts: 0, pts: 0, cts: 0, duration: 0,
        isKeyframe: true, sampleDescriptionIndex: 1 }]
    });
  }
  const chapters = parseMp4Chapters(moovBox, maxTrackSeconds, tracks, chapterSamples);

  return {
    containerFormat: isMov ? "mov" : "mp4",
    majorBrand,
    minorVersion,
    compatibleBrands,
    timescale: movieTimescale,
    duration: Math.round(maxTrackSeconds * movieTimescale),
    durationSeconds: maxTrackSeconds,
    creationTime,
    modificationTime,
    isFragmented: moofBoxes.length > 0,
    faststart,
    tracks,
    metadata,
    chapters: chapters.length > 0 ? chapters : undefined,
    boxes: topBoxes,
    byteLength: bytes.byteLength
  };
}

function buildVisualStsdEntry(desc: MediaCodecDescription, width: number, height: number, writeColr: boolean): Uint8Array {
  const entry = desc.rawStsdEntryBytes;
  const children = entry && entry.byteLength >= 86 ? parseMp4Boxes(entry.subarray(86)) : [];
  const existingColor = children.find(box => box.type === "colr");
  const payload = existingColor?.payload;
  const colorType = payload && payload.length >= 10 ? decodeFourCC(payload, 0) : undefined;
  const colorView = payload && (colorType === "nclx" || colorType === "nclc")
    ? new DataView(payload.buffer, payload.byteOffset, payload.byteLength) : undefined;
  const primaries = desc.colorMetadata?.primaries ?? colorView?.getUint16(4) ?? 2;
  const transfer = desc.colorMetadata?.transfer ?? colorView?.getUint16(6) ?? 2;
  const matrix = desc.colorMetadata?.matrix ?? colorView?.getUint16(8) ?? 2;
  const fullRange = desc.colorMetadata?.range !== undefined ? desc.colorMetadata.range === 2
    : colorType === "nclx" ? Boolean((payload?.[10] ?? 0) & 128) : desc.colorRange === "pc";
  const emitColor = writeColr || (primaries !== 2 && transfer !== 2 && matrix !== 2);
  const color = new BinaryWriter(11);
  color.writeBytes(encodeUtf8("nclx"));
  color.writeU16BE(primaries);
  color.writeU16BE(transfer);
  color.writeU16BE(matrix);
  color.writeU8(fullRange ? 128 : 0);
  const colr = emitColor ? makeBox("colr", color.toUint8Array()) : new Uint8Array();
  const aspect = new BinaryWriter(8);
  if (desc.sarWidth && desc.sarHeight) {
    aspect.writeU32BE(desc.sarWidth);
    aspect.writeU32BE(desc.sarHeight);
  }
  const pasp = aspect.toUint8Array().length ? makeBox("pasp", aspect.toUint8Array()) : new Uint8Array();
  if (desc.rawStsdEntryBytes && desc.rawStsdEntryBytes.byteLength >= 86) {
    if (!pasp.length && !writeColr && !desc.colorMetadata) return desc.rawStsdEntryBytes;
    const entry = desc.rawStsdEntryBytes;
    return makeBox(decodeFourCC(entry, 4), concatBytes([
      entry.subarray(8, 86),
      ...children.filter(box => box.type !== "pasp" && !(desc.colorMetadata && box.type === "colr"))
        .map(box => entry.subarray(86 + box.offset, 86 + box.offset + box.size)),
      pasp,
      ...(existingColor && !desc.colorMetadata ? [] : [colr])
    ]));
  }
  const writer = new BinaryWriter(256);
  writer.writeZeros(6); // reserved
  writer.writeU16BE(1); // data_reference_index = 1
  writer.writeU16BE(0); // pre_defined
  writer.writeU16BE(0); // reserved
  writer.writeZeros(12); // pre_defined
  writer.writeU16BE(width);
  writer.writeU16BE(height);
  writer.writeU32BE(0x00480000); // horizresolution = 72 dpi
  writer.writeU32BE(0x00480000); // vertresolution = 72 dpi
  writer.writeU32BE(0); // reserved
  writer.writeU16BE(1); // frame_count = 1
  writer.writeZeros(32); // compressorname
  writer.writeU16BE(0x0018); // depth = 24
  writer.writeI16BE(-1); // pre_defined = -1

  if (desc.formatFourCC === "avc1" || desc.codecName === "h264") {
    const avcCBytes =
      desc.avcC?.rawBytes ??
      (() => {
        const { sps, pps } = buildH264SpsPps(width, height, 30);
        return buildAvcC([sps], [pps]);
      })();
    writer.writeBytes(makeBox("avcC", avcCBytes));
  } else if (desc.hvcC) {
    writer.writeBytes(makeBox("hvcC", desc.hvcC.rawBytes));
  } else if (desc.av1C) {
    writer.writeBytes(makeBox("av1C", desc.av1C.rawBytes));
  } else if (desc.vpcC) {
    writer.writeBytes(makeBox("vpcC", desc.vpcC.rawBytes));
  }

  writer.writeBytes(pasp);
  writer.writeBytes(colr);
  return makeBox(desc.formatFourCC || "avc1", writer.toUint8Array());
}

function buildSubtitleStsdEntry(desc: MediaCodecDescription): Uint8Array {
  if (desc.rawStsdEntryBytes) return desc.rawStsdEntryBytes;
  const ftabWriter = new BinaryWriter(16);
  ftabWriter.writeU16BE(1); // entry_count = 1
  ftabWriter.writeU16BE(1); // font_ID = 1
  ftabWriter.writeU8(5);    // font_name_length = 5
  ftabWriter.writeBytes(new TextEncoder().encode("Arial"));
  const ftabBox = makeBox("ftab", ftabWriter.toUint8Array());

  const w = new BinaryWriter(38 + ftabBox.byteLength);
  w.writeZeros(6);          // reserved
  w.writeU16BE(1);          // data_reference_index
  w.writeU32BE(0);          // displayFlags
  w.writeU8(1);             // horizontal-justification (center)
  w.writeU8(0xff);          // vertical-justification (bottom)
  w.writeU32BE(0x000000ff); // background-color-rgba
  // BoxRecord (top, left, bottom, right)
  w.writeU16BE(0);
  w.writeU16BE(0);
  w.writeU16BE(0);
  w.writeU16BE(0);
  // StyleRecord (startChar, endChar, fontID, faceStyleFlags, fontSize, textColorRGBA)
  w.writeU16BE(0);
  w.writeU16BE(0);
  w.writeU16BE(1);
  w.writeU8(0);
  w.writeU8(16);
  w.writeU32BE(0xffffffff);
  w.writeBytes(ftabBox);
  return makeBox("tx3g", w.toUint8Array());
}

function buildAudioStsdEntry(desc: MediaCodecDescription): Uint8Array {
  if (desc.rawStsdEntryBytes && desc.rawStsdEntryBytes.byteLength >= 36) {
    return desc.rawStsdEntryBytes;
  }
  const sampleRate = desc.sampleRate ?? 44100;
  const channels = desc.channels ?? 2;
  const bitsPerSample = desc.bitsPerSample ?? 16;

  const writer = new BinaryWriter(128);
  writer.writeZeros(6); // reserved
  writer.writeU16BE(1); // data_reference_index = 1
  writer.writeU16BE(0); // version = 0
  writer.writeZeros(6); // reserved
  writer.writeU16BE(channels);
  writer.writeU16BE(bitsPerSample);
  writer.writeU16BE(0); // pre_defined
  writer.writeU16BE(0); // reserved
  writer.writeU32BE((Math.min(65535, sampleRate) << 16) >>> 0);

  if (desc.formatFourCC === "mp4a" || desc.codecName === "aac") {
    const esdsBox = desc.esds?.rawEsdsBytes
      ? makeBox("esds", desc.esds.rawEsdsBytes)
      : buildEsdsBox(sampleRate, channels, 128000, desc.esds?.decoderSpecificInfo);
    writer.writeBytes(esdsBox);
  } else if (desc.codecName === "amr_nb" || desc.codecName === "amr_wb") {
    writer.writeBytes(makeBox("damr", Uint8Array.of(70, 70, 77, 80, 0, desc.codecName === "amr_wb" ? 1 : 0x81, 0xff, 0, 1)));
  } else if (desc.dOps) {
    writer.writeBytes(makeBox("dOps", desc.dOps.rawBytes));
  } else if (desc.codecName === "opus") {
    const head = desc.extraData;
    if (!head || head.length < 19 || decodeUtf8(head.subarray(0, 8)) !== "OpusHead" ||
        !head[9] || (head[18] === 0 ? head[9] > 2 : head.length < 21 + head[9]!)) {
      throw new Error("Invalid OpusHead configuration for MP4");
    }
    // dOps uses version zero and big-endian fields; the mapping table is unchanged.
    const input = new DataView(head.buffer, head.byteOffset, head.byteLength);
    const config = new BinaryWriter(head.length - 8);
    config.writeU8(0);
    config.writeU8(head[9]!);
    config.writeU16BE(input.getUint16(10, true));
    config.writeU32BE(input.getUint32(12, true));
    config.writeI16BE(input.getInt16(16, true));
    config.writeBytes(head.subarray(18));
    writer.writeBytes(makeBox("dOps", config.toUint8Array()));
  }

  const format = desc.codecName === "pcm_s16le" ? "sowt"
    : desc.codecName === "pcm_s16be" ? "twos"
    : desc.codecName === "pcm_mulaw" ? "ulaw"
    : desc.codecName === "pcm_alaw" ? "alaw"
    : desc.formatFourCC || "mp4a";
  return makeBox(format, writer.toUint8Array());
}

function buildIlstTagBox(fourcc: string, value: string): Uint8Array {
  const utf8 = encodeUtf8(value);
  const dataPayload = new BinaryWriter(8 + utf8.byteLength);
  dataPayload.writeU32BE(1); // type = 1 (UTF-8)
  dataPayload.writeU32BE(0); // locale = 0
  dataPayload.writeBytes(utf8);
  const dataBox = makeBox("data", dataPayload.toUint8Array());
  return makeBox(fourcc, dataBox);
}

function buildUdtaMetadataBox(
  tags: Mp4MetadataTags,
  chapters?: readonly Mp4Chapter[],
  useMetadataTags = false
): Uint8Array | undefined {
  const udtaChildren: Uint8Array[] = [];

  if (chapters && chapters.length > 0) {
    const chplWriter = new BinaryWriter(16 + chapters.length * 64);
    chplWriter.writeU32BE(0); // 4 bytes reserved
    const count = Math.min(255, chapters.length);
    chplWriter.writeU8(count);
    for (let i = 0; i < count; i++) {
      const ch = chapters[i]!;
      const start100ns = Math.max(0, Math.round(ch.startTimeSeconds * 10_000_000));
      chplWriter.writeU64BE(start100ns);
      const titleBytes = encodeUtf8(ch.title).subarray(0, 255);
      chplWriter.writeU8(titleBytes.byteLength);
      chplWriter.writeBytes(titleBytes);
    }
    udtaChildren.push(makeFullBox("chpl", 1, 0, chplWriter.toUint8Array()));
  }

  const ilstItems: Uint8Array[] = [];
  let keysBox: Uint8Array | undefined;
  if (useMetadataTags) {
    const entries = { ...tags.custom };
    for (const key of Object.keys(mp4ProbeMetadataKeys) as (keyof typeof mp4ProbeMetadataKeys)[]) {
      const value = tags[key];
      if (value !== undefined) entries[mp4ProbeMetadataKeys[key]] = value;
    }
    const keys = Object.entries(entries).filter(([, value]) => value !== "");
    const writer = new BinaryWriter(4);
    writer.writeU32BE(keys.length);
    for (const [index, [name, value]] of keys.entries()) {
      const bytes = encodeUtf8(name);
      writer.writeU32BE(8 + bytes.length);
      writer.writeFourCC("mdta");
      writer.writeBytes(bytes);
      const id = index + 1;
      ilstItems.push(buildIlstTagBox(String.fromCharCode(id >>> 24, (id >>> 16) & 255, (id >>> 8) & 255, id & 255), value));
    }
    keysBox = makeFullBox("keys", 0, 0, writer.toUint8Array());
  } else {
    if (tags.title) ilstItems.push(buildIlstTagBox("\xa9nam", tags.title));
    if (tags.artist) ilstItems.push(buildIlstTagBox("\xa9ART", tags.artist));
    if (tags.albumArtist) ilstItems.push(buildIlstTagBox("aART", tags.albumArtist));
    if (tags.composer) ilstItems.push(buildIlstTagBox("\xa9wrt", tags.composer));
    if (tags.album) ilstItems.push(buildIlstTagBox("\xa9alb", tags.album));
    if (tags.date) ilstItems.push(buildIlstTagBox("\xa9day", tags.date));
    if (tags.comment) ilstItems.push(buildIlstTagBox("\xa9cmt", tags.comment));
    if (tags.genre) ilstItems.push(buildIlstTagBox("\xa9gen", tags.genre));
    if (tags.encoder) ilstItems.push(buildIlstTagBox("\xa9too", tags.encoder));
    if (tags.description) ilstItems.push(buildIlstTagBox("desc", tags.description));
    if (tags.copyright) ilstItems.push(buildIlstTagBox("cprt", tags.copyright));
    if (tags.compilation !== undefined && tags.compilation !== "") {
      ilstItems.push(makeBox("cpil", makeBox("data", Uint8Array.of(0, 0, 0, 21, 0, 0, 0, 0, Number(tags.compilation) ? 1 : 0))));
    }
    for (const [type, value] of [["trkn", tags.trackNumber], ["disk", tags.discNumber]] as const) {
      if (!value) continue;
      const [number, total] = value.split("/").map(part => Number.parseInt(part, 10));
      if (!number) continue;
      const payload = new BinaryWriter(16);
      payload.writeU32BE(0); // implicit data type
      payload.writeU32BE(0); // locale
      payload.writeU16BE(0); // reserved
      payload.writeU16BE(number);
      payload.writeU16BE(total || 0);
      if (type === "trkn") payload.writeU16BE(0);
      ilstItems.push(makeBox(type, makeBox("data", payload.toUint8Array())));
    }
    if (tags.coverArt) {
      const payload = new BinaryWriter(8 + tags.coverArt.data.length);
      payload.writeU32BE(tags.coverArt.mimeType === "image/png" ? 14 : 13);
      payload.writeU32BE(0);
      payload.writeBytes(tags.coverArt.data);
      ilstItems.push(makeBox("covr", makeBox("data", payload.toUint8Array())));
    }
  }

  if (ilstItems.length > 0) {
    const hdlrWriter = new BinaryWriter(32);
    hdlrWriter.writeU32BE(0);
    hdlrWriter.writeFourCC(useMetadataTags ? "mdta" : "mdir");
    hdlrWriter.writeFourCC(useMetadataTags ? "\0\0\0\0" : "appl");
    hdlrWriter.writeZeros(8);
    hdlrWriter.writeU8(0);
    const metaHdlr = makeFullBox("hdlr", 0, 0, hdlrWriter.toUint8Array());
    const ilstBox = makeBox("ilst", concatBytes(ilstItems));
    const metaBox = makeFullBox("meta", 0, 0, concatBytes(keysBox ? [metaHdlr, keysBox, ilstBox] : [metaHdlr, ilstBox]));
    udtaChildren.push(metaBox);
  }

  if (udtaChildren.length === 0) return undefined;
  return makeBox("udta", concatBytes(udtaChildren));
}

function materializeTrackSamples(track: MediaTrack, forceKeyFrames?: readonly number[], maxBFrames = 0): {
  samples: readonly MediaSample[];
  codecDescriptions: readonly MediaCodecDescription[];
} {
  if (track.type === "subtitle" && track.samples.length > 0) {
    const alreadyPacked = track.samples.every(
      (s) => s.data.byteLength >= 2 && ((s.data[0]! << 8) | s.data[1]!) <= s.data.byteLength - 2
    );
    const codecDescriptions: readonly MediaCodecDescription[] =
      track.codecDescriptions.length > 0
        ? track.codecDescriptions.map((d) => ({ ...d, formatFourCC: d.formatFourCC === "text" ? "text" : "tx3g", codecName: "mov_text" }))
        : [{ formatFourCC: "tx3g", codecName: "mov_text" }];
    if (alreadyPacked) {
      return { samples: track.samples, codecDescriptions };
    }
    const tx3gSamples: MediaSample[] = [];
    let cursor = 0;
    for (const [index, s] of track.samples.entries()) {
      const start = Math.max(cursor, Math.round(s.pts));
      if (start > cursor) {
        const emptyPayload = new Uint8Array([0, 0]);
        tx3gSamples.push({
          data: emptyPayload,
          dts: cursor,
          pts: cursor,
          cts: 0,
          duration: start - cursor,
          size: 2,
          isKeyframe: true,
          sampleDescriptionIndex: 1
        });
        cursor = start;
      }
      const wrapped = encodeMovText(s.data);
      const next = track.samples[index + 1];
      // Timed text is sequential: the next cue replaces an overlapping cue.
      const dur = Math.min(Math.max(0, Math.round(s.duration)),
        next ? Math.max(1, Math.round(next.pts) - start) : Infinity);
      tx3gSamples.push({
        ...s,
        data: wrapped,
        dts: cursor,
        pts: cursor,
        cts: 0,
        duration: dur,
        size: wrapped.byteLength,
        isKeyframe: true
      });
      cursor += dur;
    }
    return { samples: tx3gSamples, codecDescriptions };
  }
  if (track.samples.length > 0) {
    return {
      samples: track.samples,
      codecDescriptions:
        track.codecDescriptions.length > 0
          ? track.codecDescriptions
          : [
              track.type === "video"
                ? {
                    formatFourCC: "avc1",
                    codecName: "h264",
                    width: track.width ?? 320,
                    height: track.height ?? 240
                  }
                : {
                    formatFourCC: "mp4a",
                    codecName: "aac",
                    sampleRate: track.timescale || 44100,
                    channels: 2
                  }
            ]
    };
  }

  if (track.type === "video" && track.decodedVideoFrames && track.decodedVideoFrames.length > 0) {
    const width = track.width ?? track.decodedVideoFrames[0]!.width;
    const height = track.height ?? track.decodedVideoFrames[0]!.height;
    const timescale = track.timescale || 90000;
    const firstFrameDur = track.decodedVideoFrames[0]!.durationSeconds || 1 / 30;
    const fps = Math.max(1, Math.round(1 / firstFrameDur));
    const { sps, pps } = buildH264SpsPps(width, height, fps, maxBFrames);
    const avcCBytes = buildAvcC([sps], [pps]);
    const avcC = parseAvcC(avcCBytes);
    const samples: MediaSample[] = [];
    const refBuffer: { y?: Uint8Array; u?: Uint8Array; v?: Uint8Array } = {};
    // FFmpeg rounds forced timestamps to the encoder time base before comparing PTS.
    const forcedTicks = forceKeyFrames?.map(time => Math.round(time / firstFrameDur)).sort((a, b) => a - b) ?? [];
    let nextForced = 0;
    let gopStart = 0;
    const stereoMode = track.codecDescriptions[0]?.stereoMode;
    let stereoSei: Uint8Array | undefined;
    if (stereoMode === 1 || stereoMode === 3) {
      // H.264 D.1.25 frame_packing_arrangement, left view first.
      const bits = new BitWriter();
      bits.writeUE(0); // arrangement_id
      bits.writeBit(0); // cancel_flag
      bits.writeBits(stereoMode === 1 ? 3 : 4, 7); // arrangement_type
      bits.writeBit(0); // quincunx_sampling_flag
      bits.writeBits(1, 6); // content_interpretation_type
      bits.writeBits(0, 4); // spatial/frame flips, field views, current frame
      bits.writeBits(3, 2); // both views self contained
      bits.writeBits(0, 16); // frame grid positions
      bits.writeBits(0, 8); // reserved byte
      bits.writeUE(16384); // repetition_period: persists across following frames
      bits.writeBit(0); // extension_flag
      bits.writeRbspTrailingBits();
      const payload = bits.toUint8Array();
      const rbsp = escapeRbsp(concatBytes([new Uint8Array([45, payload.length]), payload, new Uint8Array([0x80])]));
      stereoSei = new Uint8Array(5 + rbsp.length);
      new DataView(stereoSei.buffer).setUint32(0, 1 + rbsp.length);
      stereoSei[4] = 6;
      stereoSei.set(rbsp, 5);
    }

    for (let i = 0; i < track.decodedVideoFrames.length; i++) {
      const frame = track.decodedVideoFrames[i]!;
      const duration = Math.max(1, Math.round(frame.durationSeconds * timescale));
      const pts = Math.round(frame.ptsSeconds * timescale);
      if (nextForced < forcedTicks.length && Math.round(frame.ptsSeconds / firstFrameDur) >= forcedTicks[nextForced]!) {
        gopStart = i;
        nextForced++;
      }
      const picture = encodeH264IdrFrame(frame.data, width, height, i - gopStart, refBuffer, maxBFrames);
      const encoded = stereoSei && (picture[4]! & 0x1f) === 5 ? concatBytes([stereoSei, picture]) : picture;
      detachBytesBuffer(frame.data);
      samples.push({
        data: encoded,
        // Frames are encoded in display order, so input decode preroll no longer applies.
        dts: pts,
        pts,
        cts: 0,
        duration,
        size: encoded.byteLength,
        // The encoder emits one length-prefixed NAL unit, including predicted pictures.
        isKeyframe: (picture[4]! & 0x1f) === 5,
        sampleDescriptionIndex: 1
      });
    }
    detachBytesBuffer(refBuffer.y);
    detachBytesBuffer(refBuffer.u);
    detachBytesBuffer(refBuffer.v);

    const codecDescriptions = [
      {
        formatFourCC: "avc1",
        codecName: "h264" as const,
        profile: maxBFrames > 0 ? "Main" : "Constrained Baseline",
        level: 31,
        width,
        height,
        pixFmt: "yuv420p" as const,
        avcC
      }
    ];
    const mutableTrack = track as unknown as {
      samples?: MediaSample[];
      codecDescriptions?: typeof codecDescriptions;
      dirtyVideoEncode?: boolean;
      decodedVideoFrames?: unknown;
    };
    mutableTrack.samples = samples;
    mutableTrack.codecDescriptions = codecDescriptions;
    mutableTrack.dirtyVideoEncode = false;
    mutableTrack.decodedVideoFrames = undefined;

    return {
      samples,
      codecDescriptions
    };
  }

  if (track.type === "audio" && track.decodedAudio) {
    const sampleRate = track.decodedAudio.sampleRate || 44100;
    const channels = track.decodedAudio.channels || 2;
    const totalSamples = track.decodedAudio.channelData[0]?.length ?? 0;
    const numFrames = Math.ceil(totalSamples / 1024);
    const silentAac = createSilentAacFrame(channels);
    const samples: MediaSample[] = [];
    for (let i = 0; i < numFrames; i++) {
      samples.push({
        data: silentAac,
        dts: Math.round(i * 1024 * track.timescale / sampleRate),
        pts: Math.round(i * 1024 * track.timescale / sampleRate),
        cts: 0,
        duration: Math.round(Math.min(totalSamples, (i + 1) * 1024) * track.timescale / sampleRate) - Math.round(i * 1024 * track.timescale / sampleRate),
        size: silentAac.byteLength,
        isKeyframe: true,
        sampleDescriptionIndex: 1
      });
    }
    const asc = buildAudioSpecificConfig(sampleRate, channels, 2);
    return {
      samples,
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
      ]
    };
  }

  return { samples: track.samples, codecDescriptions: track.codecDescriptions };
}

function buildTrakBox(
  track: MediaTrack,
  movieTimescale: number,
  sampleOffsets: readonly number[],
  fragmented = false,
  writeColr = false,
  chapterTrackId?: number
): Uint8Array {
  const materialized = materializeTrackSamples(track);
  const samples = fragmented ? [] : materialized.samples;
  const codecDescriptions = materialized.codecDescriptions;

  const totalSampleDuration = samples.length
    ? samples[samples.length - 1]!.dts + samples[samples.length - 1]!.duration - samples[0]!.dts
    : track.duration;
  const durationInMovieTimescale = track.editList?.length
    ? track.editList.reduce((total, edit) => total + edit.segmentDuration, 0)
    : Math.round((totalSampleDuration / Math.max(1, track.timescale)) * movieTimescale);

  // tkhd
  const tkhdWriter = new BinaryWriter(92);
  tkhdWriter.writeU32BE(0); // creation_time
  tkhdWriter.writeU32BE(0); // modification_time
  tkhdWriter.writeU32BE(track.id);
  tkhdWriter.writeU32BE(0); // reserved
  tkhdWriter.writeU32BE(durationInMovieTimescale);
  tkhdWriter.writeZeros(8); // reserved
  tkhdWriter.writeI16BE(0); // layer
  tkhdWriter.writeI16BE(0); // alternate_group
  tkhdWriter.writeFixed8_8(track.type === "audio" ? (track.volume ?? 1.0) : 0);
  tkhdWriter.writeU16BE(0); // reserved
  const matrix =
    track.rotation !== undefined && (!track.matrix || track.rotation !== rotationFromMatrix(track.matrix))
      ? matrixForRotation(track.rotation)
      : (track.matrix ?? IDENTITY_MATRIX);
  for (let i = 0; i < 9; i++) {
    tkhdWriter.writeI32BE(matrix[i] ?? IDENTITY_MATRIX[i]!);
  }
  tkhdWriter.writeFixed16_16(track.type === "video" ? (track.width ?? 320) : 0);
  tkhdWriter.writeFixed16_16(track.type === "video" ? (track.height ?? 240) : 0);
  const tkhdBox = makeFullBox("tkhd", 0, track.enabled ? 0x03 : 0x00, tkhdWriter.toUint8Array());

  // edts / elst
  let edtsBox: Uint8Array | undefined;
  if (track.editList && track.editList.length > 0) {
    const elstWriter = new BinaryWriter(8 + track.editList.length * 12);
    elstWriter.writeU32BE(track.editList.length);
    for (const entry of track.editList) {
      elstWriter.writeU32BE(entry.segmentDuration);
      elstWriter.writeI32BE(entry.mediaTime);
      elstWriter.writeI16BE(entry.mediaRateInteger);
      elstWriter.writeI16BE(entry.mediaRateFraction);
    }
    edtsBox = makeBox("edts", makeFullBox("elst", 0, 0, elstWriter.toUint8Array()));
  }

  // mdhd
  const mdhdWriter = new BinaryWriter(24);
  mdhdWriter.writeU32BE(0); // creation_time
  mdhdWriter.writeU32BE(0); // modification_time
  mdhdWriter.writeU32BE(track.timescale || 1000);
  mdhdWriter.writeU32BE(fragmented ? 0 : totalSampleDuration);
  mdhdWriter.writeU16BE(packIsoLanguage(track.language || "und"));
  mdhdWriter.writeU16BE(0);
  const mdhdBox = makeFullBox("mdhd", 0, 0, mdhdWriter.toUint8Array());

  // hdlr
  const hdlrWriter = new BinaryWriter(48);
  hdlrWriter.writeU32BE(0); // pre_defined
  hdlrWriter.writeFourCC(
    track.handlerType ||
      (track.type === "video" ? "vide" : track.type === "audio" ? "soun" : "sbtl")
  );
  hdlrWriter.writeZeros(12);
  hdlrWriter.writeNullTerminatedString(
    track.handlerName ||
      (track.type === "video" ? "VideoHandler" : track.type === "audio" ? "SoundHandler" : "SubtitleHandler")
  );
  const hdlrBox = makeFullBox("hdlr", 0, 0, hdlrWriter.toUint8Array());

  // vmhd / smhd / nmhd
  let mediaHeaderBox: Uint8Array;
  if (track.type === "video") {
    const vmhdWriter = new BinaryWriter(8);
    vmhdWriter.writeU16BE(0);
    vmhdWriter.writeZeros(6);
    mediaHeaderBox = makeFullBox("vmhd", 0, 1, vmhdWriter.toUint8Array());
  } else if (track.type === "audio") {
    const smhdWriter = new BinaryWriter(4);
    smhdWriter.writeZeros(4);
    mediaHeaderBox = makeFullBox("smhd", 0, 0, smhdWriter.toUint8Array());
  } else {
    mediaHeaderBox = makeFullBox("nmhd", 0, 0, new Uint8Array(0));
  }

  // dinf / dref
  const urlBox = makeFullBox("url ", 0, 1, new Uint8Array(0));
  const drefWriter = new BinaryWriter(4 + urlBox.byteLength);
  drefWriter.writeU32BE(1);
  drefWriter.writeBytes(urlBox);
  const dinfBox = makeBox("dinf", makeFullBox("dref", 0, 0, drefWriter.toUint8Array()));

  // stsd
  const stsdEntries: Uint8Array[] = [];
  for (const desc of codecDescriptions) {
    if (track.type === "video") {
      stsdEntries.push(buildVisualStsdEntry(desc, track.width ?? desc.width ?? 320, track.height ?? desc.height ?? 240, writeColr));
    } else if (track.type === "audio") {
      stsdEntries.push(buildAudioStsdEntry(desc));
    } else if (track.type === "subtitle") {
      stsdEntries.push(buildSubtitleStsdEntry(desc));
    } else if (desc.rawStsdEntryBytes) {
      stsdEntries.push(desc.rawStsdEntryBytes);
    }
  }
  const stsdWriter = new BinaryWriter(64);
  stsdWriter.writeU32BE(stsdEntries.length);
  for (const e of stsdEntries) stsdWriter.writeBytes(e);
  const stsdBox = makeFullBox("stsd", 0, 0, stsdWriter.toUint8Array());

  // stts (run-length encode sample durations)
  const sttsRuns: { count: number; delta: number }[] = [];
  for (const [index, s] of samples.entries()) {
    const delta = Math.max(0, Math.round(samples[index + 1] ? samples[index + 1]!.dts - s.dts : s.duration));
    const prev = sttsRuns[sttsRuns.length - 1];
    if (prev && prev.delta === delta) {
      prev.count++;
    } else {
      sttsRuns.push({ count: 1, delta });
    }
  }
  const sttsWriter = new BinaryWriter(4 + sttsRuns.length * 8);
  sttsWriter.writeU32BE(sttsRuns.length);
  for (const r of sttsRuns) {
    sttsWriter.writeU32BE(r.count);
    sttsWriter.writeU32BE(r.delta);
  }
  const sttsBox = makeFullBox("stts", 0, 0, sttsWriter.toUint8Array());

  // ctts (if any sample has non-zero cts)
  const hasCtts = samples.some((s) => s.cts !== 0);
  const hasNegativeCtts = samples.some((s) => s.cts < 0);
  let cttsBox: Uint8Array | undefined;
  if (hasCtts) {
    const cttsRuns: { count: number; offset: number }[] = [];
    for (const s of samples) {
      const offset = Math.round(s.cts);
      const prev = cttsRuns[cttsRuns.length - 1];
      if (prev && prev.offset === offset) {
        prev.count++;
      } else {
        cttsRuns.push({ count: 1, offset });
      }
    }
    const cttsWriter = new BinaryWriter(4 + cttsRuns.length * 8);
    cttsWriter.writeU32BE(cttsRuns.length);
    for (const r of cttsRuns) {
      cttsWriter.writeU32BE(r.count);
      if (hasNegativeCtts) cttsWriter.writeI32BE(r.offset);
      else cttsWriter.writeU32BE(r.offset);
    }
    cttsBox = makeFullBox("ctts", hasNegativeCtts ? 1 : 0, 0, cttsWriter.toUint8Array());
  }

  // stsc (1 sample per chunk so every sample can have its own offset and sampleDescriptionIndex)
  const stscRuns: { firstChunk: number; samplesPerChunk: number; sdi: number }[] = [];
  for (let i = 0; i < samples.length; i++) {
    const sdi = samples[i]!.sampleDescriptionIndex || 1;
    const prev = stscRuns[stscRuns.length - 1];
    if (!prev || prev.sdi !== sdi) {
      stscRuns.push({ firstChunk: i + 1, samplesPerChunk: 1, sdi });
    }
  }
  const stscWriter = new BinaryWriter(4 + stscRuns.length * 12);
  stscWriter.writeU32BE(stscRuns.length);
  for (const r of stscRuns) {
    stscWriter.writeU32BE(r.firstChunk);
    stscWriter.writeU32BE(r.samplesPerChunk);
    stscWriter.writeU32BE(r.sdi);
  }
  const stscBox = makeFullBox("stsc", 0, 0, stscWriter.toUint8Array());

  // stsz
  const stszWriter = new BinaryWriter(8 + samples.length * 4);
  stszWriter.writeU32BE(0); // sample_size = 0 (variable)
  stszWriter.writeU32BE(samples.length);
  for (const s of samples) {
    stszWriter.writeU32BE(s.data.byteLength);
  }
  const stszBox = makeFullBox("stsz", 0, 0, stszWriter.toUint8Array());

  // stco / co64
  const needs64BitOffsets = sampleOffsets.some((off) => off > 0xffffffff);
  let chunkOffsetBox: Uint8Array;
  if (needs64BitOffsets) {
    const co64Writer = new BinaryWriter(4 + sampleOffsets.length * 8);
    co64Writer.writeU32BE(sampleOffsets.length);
    for (const off of sampleOffsets) co64Writer.writeU64BE(off);
    chunkOffsetBox = makeFullBox("co64", 0, 0, co64Writer.toUint8Array());
  } else {
    const stcoWriter = new BinaryWriter(4 + sampleOffsets.length * 4);
    stcoWriter.writeU32BE(sampleOffsets.length);
    for (const off of sampleOffsets) stcoWriter.writeU32BE(off);
    chunkOffsetBox = makeFullBox("stco", 0, 0, stcoWriter.toUint8Array());
  }

  // stss (for video tracks)
  let stssBox: Uint8Array | undefined;
  if (track.type === "video" && samples.length > 0) {
    const keyframeNumbers: number[] = [];
    for (let i = 0; i < samples.length; i++) {
      if (samples[i]!.isKeyframe) {
        keyframeNumbers.push(i + 1);
      }
    }
    const stssWriter = new BinaryWriter(4 + keyframeNumbers.length * 4);
    stssWriter.writeU32BE(keyframeNumbers.length);
    for (const k of keyframeNumbers) stssWriter.writeU32BE(k);
    stssBox = makeFullBox("stss", 0, 0, stssWriter.toUint8Array());
  }

  const stblChildren: Uint8Array[] = [stsdBox, sttsBox];
  if (cttsBox) stblChildren.push(cttsBox);
  stblChildren.push(stscBox, stszBox, chunkOffsetBox);
  if (stssBox) stblChildren.push(stssBox);
  const stblBox = makeBox("stbl", concatBytes(stblChildren));

  const minfBox = makeBox("minf", concatBytes([mediaHeaderBox, dinfBox, stblBox]));
  const mdiaBox = makeBox("mdia", concatBytes([mdhdBox, hdlrBox, minfBox]));

  const trakChildren: Uint8Array[] = [tkhdBox];
  const references: Uint8Array[] = [];
  if (chapterTrackId !== undefined && track.id !== chapterTrackId) {
    const reference = new BinaryWriter(4);
    reference.writeU32BE(chapterTrackId);
    references.push(makeBox("chap", reference.toUint8Array()));
  }
  if (track.timecodeTrackId !== undefined) {
    const reference = new BinaryWriter(4);
    reference.writeU32BE(track.timecodeTrackId);
    references.push(makeBox("tmcd", reference.toUint8Array()));
  }
  if (references.length) trakChildren.push(makeBox("tref", concatBytes(references)));
  if (edtsBox) trakChildren.push(edtsBox);
  trakChildren.push(mdiaBox);
  if (track.disposition?.comment) {
    trakChildren.push(makeBox("udta", makeFullBox("kind", 0, 0,
      new TextEncoder().encode("urn:mpeg:dash:role:2011\0commentary\0"))));
  }
  return makeBox("trak", concatBytes(trakChildren));
}

export function serializeMp4(doc: MediaDocument, options: SerializeMediaOptions = {}): Uint8Array {
  if (options.maxBFrames !== undefined && (!Number.isInteger(options.maxBFrames) || options.maxBFrames < -1 || options.maxBFrames > 2147483647)) {
    throw new Error("Invalid B-frame count");
  }
  const budget = options.budget ?? new MediaBudgetTracker(options.limits);
  const isMov = (options.format ?? doc.containerFormat) === "mov";
  const is3gp = options.format === "3gp";
  const majorBrand = options.majorBrand ?? (is3gp ? "3gp4" : isMov ? "qt  " : (doc.majorBrand ?? "isom"));
  const compatibleBrands =
    options.compatibleBrands ??
    (is3gp ? ["3gp4", "isom", "iso2"] : isMov ? ["qt  "] : (doc.compatibleBrands && doc.compatibleBrands.length > 0 ? doc.compatibleBrands : ["isom", "iso2", "avc1", "mp41"]));

  // ftyp
  const ftypWriter = new BinaryWriter(16 + compatibleBrands.length * 4);
  ftypWriter.writeFourCC(majorBrand);
  ftypWriter.writeU32BE(doc.minorVersion ?? 512);
  for (const b of compatibleBrands) ftypWriter.writeFourCC(b);
  const ftypBox = makeBox("ftyp", ftypWriter.toUint8Array());

  const movieTimescale = doc.timescale || 1000;
  // Only fragmented MP4 needs track descriptions before any packets are written.
  const materializedTracks = doc.tracks.filter(t => t.disposition?.attached_pic !== 1).map((t) => {
    if (t.type === "audio" && (options.audioCodec === "libopencore_amrnb" || options.audioCodec === "amr_nb")) {
      t = encodeAmrTrack(t, budget, options.audioBitrate);
    }
    if (t.type === "audio" && (options.audioCodec === "libvo_amrwbenc" || options.audioCodec === "amr_wb")) {
      t = encodeAmrTrack(t, budget, options.audioBitrate, "amr_wb");
    }
    if (t.type === "audio" && options.audioCodec === "alac") t = encodeAlacTrack(t, budget);
    const sampleRate = t.codecDescriptions[0]?.sampleRate;
    const isOpus = t.codecDescriptions[0]?.codecName === "opus";
    const targetTimescale = t.type === "subtitle" && t.codecDescriptions[0]?.codecName !== "mov_text"
      ? 1_000_000 : isOpus ? 48000 : t.codecDescriptions[0]?.codecName === "mp3" ? sampleRate : undefined;
    if (targetTimescale && targetTimescale !== t.timescale) {
      const scale = targetTimescale / t.timescale;
      t = { ...t, timescale: targetTimescale, duration: Math.round(t.duration * scale),
        samples: t.samples.map(sample => ({ ...sample,
          dts: Math.round(sample.dts * scale), pts: Math.round(sample.pts * scale),
          cts: Math.round(sample.cts * scale), duration: Math.round(sample.duration * scale)
        })),
        ...(t.editList ? { editList: t.editList.map(edit => ({ ...edit,
          mediaTime: edit.mediaTime < 0 ? edit.mediaTime : Math.round(edit.mediaTime * scale)
        })) } : {})
      };
    }
    const materialized = materializeTrackSamples(t, options.forceKeyFrames, options.maxBFrames);
    if (!isMov && t.type === "audio") {
      for (const description of materialized.codecDescriptions) {
        if (description.codecName === "pcm_mulaw" || description.codecName === "pcm_alaw") {
          throw new Error(`Could not find tag for codec ${description.codecName}, codec not currently supported in container mp4`);
        }
      }
    }
    if (t.type === "video") {
      // MP4 decode timestamps must increase. Repair overlapping packets without
      // shifting the later timeline, as FFmpeg does when stream-copying concat.
      let previousDts = -Infinity;
      materialized.samples = materialized.samples.map(sample => {
        const dts = Math.max(sample.dts, previousDts + 1);
        previousDts = dts;
        if (dts === sample.dts) return sample;
        const pts = Math.max(sample.pts, dts);
        return { ...sample, dts, pts, cts: pts - dts };
      });
    }
    const last = materialized.samples.at(-1);
    // Clear the final cue at its end, including when remuxing packed text.
    if (t.type === "subtitle" && last &&
        (last.data.byteLength !== 2 || last.data[0] !== 0 || last.data[1] !== 0)) {
      materialized.samples = [...materialized.samples, {
        data: new Uint8Array([0, 0]),
        dts: last.dts + last.duration,
        pts: last.pts + last.duration,
        cts: 0,
        duration: 0,
        size: 2,
        isKeyframe: true,
        sampleDescriptionIndex: last.sampleDescriptionIndex
      }];
    }

    // Packet skip metadata has no MP4 sample-table field; represent priming as an edit.
    const skip = materialized.samples.reduce((total, sample) => total + (sample.skipSamples ?? 0), 0);
    if (skip > 0 && !t.editList?.length) {
      const sampleRate = materialized.codecDescriptions[0]?.sampleRate ?? t.timescale;
      const mediaTime = Math.round(skip * t.timescale / sampleRate);
      const padding = materialized.samples.reduce((total, sample) => total + (sample.discardPadding ?? 0), 0) * t.timescale / sampleRate;
      const first = materialized.samples[0]!;
      const last = materialized.samples[materialized.samples.length - 1]!;
      t = { ...t, editList: [{
        segmentDuration: Math.round((last.dts + last.duration - first.dts - mediaTime - padding) * movieTimescale / t.timescale),
        mediaTime: first.dts + mediaTime, mediaRateInteger: 1, mediaRateFraction: 0
      }] };
    }
    const origin = materialized.samples[0]?.dts ?? 0;
    const edits = t.editList?.length ? t.editList : [{
      // Video decode delay does not shorten presentation; Opus duration excludes pre-skip.
      segmentDuration: Math.round((t.duration + (isOpus || t.type === "video" ? 0 : Math.min(0, origin))) * movieTimescale / t.timescale),
      mediaTime: 0, mediaRateInteger: 1, mediaRateFraction: 0
    }];
    const track = origin !== 0 && !options.fragmented ? { ...t, editList: edits.flatMap(edit => {
      if (edit.mediaTime < 0) return [edit];
      const mediaTime = edit.mediaTime - origin;
      if (mediaTime >= 0) return [{ ...edit, mediaTime }];
      const delay = Math.min(edit.segmentDuration, Math.round(-mediaTime * movieTimescale / t.timescale));
      return [
        { ...edit, segmentDuration: delay, mediaTime: -1 },
        { ...edit, segmentDuration: edit.segmentDuration - delay, mediaTime: 0 }
      ];
    }) } : t;
    return { track, ...materialized };
  }).filter(track => options.fragmented || track.samples.length > 0);

  const writtenIds = new Set(materializedTracks.map(mt => mt.track.id));
  for (const mt of materializedTracks) {
    if (mt.track.timecodeTrackId !== undefined && !writtenIds.has(mt.track.timecodeTrackId)) {
      mt.track = { ...mt.track, timecodeTrackId: undefined };
    }
  }

  let chapterTrackId: number | undefined;
  if (doc.chapters?.length) {
    chapterTrackId = Math.max(0, ...materializedTracks.map(mt => mt.track.id)) + 1;
    const timescale = 1000;
    const samples = doc.chapters.map((chapter, index): MediaSample => {
      const title = encodeUtf8(chapter.title).subarray(0, 65535);
      const writer = new BinaryWriter(title.length + 2);
      writer.writeU16BE(title.length);
      writer.writeBytes(title);
      // QuickTime chapters start at zero and extend to the next chapter start.
      const dts = index === 0 ? 0 : Math.round(chapter.startTimeSeconds * timescale);
      const end = Math.round((doc.chapters![index + 1]?.startTimeSeconds ?? chapter.endTimeSeconds) * timescale);
      const data = writer.toUint8Array();
      return { data, size: data.length, dts, pts: dts, cts: 0,
        duration: Math.max(0, end - dts), isKeyframe: true, sampleDescriptionIndex: 1 };
    });
    const entry = new BinaryWriter(51);
    entry.writeZeros(6);
    entry.writeU16BE(1); // data reference index
    entry.writeZeros(43); // QuickTime text display, color, rectangle and font fields
    const codecDescriptions = [{ formatFourCC: "text", codecName: "bin_data",
      rawStsdEntryBytes: makeBox("text", entry.toUint8Array()) }];
    const last = samples[samples.length - 1]!;
    const track: MediaTrack = { id: chapterTrackId, type: "data", handlerType: "text",
      handlerName: "SubtitleHandler", timescale, duration: last.dts + last.duration,
      language: "und", enabled: false, samples, codecDescriptions };
    materializedTracks.push({ track, samples, codecDescriptions });
  }

  const boundaries: number[] = [];
  if (options.fragmented && (options.fragmentKeyframes || options.fragmentEveryFrame || options.fragmentDuration)) {
    const packets = materializedTracks.flatMap((mt, trackIndex) => mt.samples.map((sample, index) => ({
      time: sample.dts / mt.track.timescale, trackIndex,
      cut: index > 0 && (options.fragmentEveryFrame || (options.fragmentKeyframes && mt.track.type === "video" && sample.isKeyframe))
    }))).sort((a, b) => a.time - b.time);
    const starts = new Map<number, number>();
    for (const packet of packets) {
      const start = starts.get(packet.trackIndex) ?? packet.time;
      if (packet.cut || (options.fragmentDuration && options.fragmentDuration > 0 &&
        Math.round((packet.time - start) * 1_000_000) >= options.fragmentDuration)) {
        if (boundaries[boundaries.length - 1] !== packet.time) {
          boundaries.push(packet.time);
          starts.clear();
        }
      }
      if (!starts.has(packet.trackIndex)) starts.set(packet.trackIndex, packet.time);
    }
  }
  const positions = materializedTracks.map(() => 0);
  const initialTracks = materializedTracks.map((mt, index) => {
    if (!options.fragmented) return mt;
    let stop = 0;
    if (options.emptyMoov === false) {
      const end = boundaries[0] ?? Infinity;
      while (stop < mt.samples.length && mt.samples[stop]!.dts / mt.track.timescale < end) stop++;
    }
    positions[index] = stop;
    return { ...mt, samples: mt.samples.slice(0, stop) };
  });

  let maxDurationSeconds = 0;
  for (const mt of initialTracks) {
    const last = mt.samples[mt.samples.length - 1];
    const durTicks = last ? last.dts + last.duration - mt.samples[0]!.dts : mt.track.duration;
    const sec = mt.track.editList?.length
      ? mt.track.editList.reduce((total, edit) => total + edit.segmentDuration, 0) / movieTimescale
      : durTicks / Math.max(1, mt.track.timescale);
    if (sec > maxDurationSeconds) maxDurationSeconds = sec;
  }
  const movieDuration = Math.round(maxDurationSeconds * movieTimescale);

  // mvhd
  const mvhdWriter = new BinaryWriter(100);
  mvhdWriter.writeU32BE(0); // creation_time
  mvhdWriter.writeU32BE(0); // modification_time
  mvhdWriter.writeU32BE(movieTimescale);
  mvhdWriter.writeU32BE(options.fragmented && options.emptyMoov !== false ? 0 : movieDuration);
  mvhdWriter.writeFixed16_16(1.0); // rate
  mvhdWriter.writeFixed8_8(1.0); // volume
  mvhdWriter.writeZeros(10); // reserved
  for (const m of IDENTITY_MATRIX) mvhdWriter.writeI32BE(m);
  mvhdWriter.writeZeros(24); // pre_defined
  mvhdWriter.writeU32BE(Math.max(0, ...materializedTracks.map(mt => mt.track.id)) + 1); // next_track_id
  const mvhdBox = makeFullBox("mvhd", 0, 0, mvhdWriter.toUint8Array());

  const picture = doc.tracks.find(track => track.type === "video" && track.disposition?.attached_pic === 1);
  const pictureData = picture?.samples[0]?.data;
  const mergedMetadata: Mp4MetadataTags = {
    ...doc.metadata,
    ...(options.metadata ?? {}),
    // Artwork follows stream selection, not inherited container metadata.
    coverArt: pictureData ? {
      mimeType: picture!.codecDescriptions[0]?.codecName === "png" ? "image/png" : "image/jpeg",
      data: pictureData
    } : undefined
  };
  const udtaBox = buildUdtaMetadataBox(mergedMetadata, options.disableChpl ? undefined : doc.chapters, options.useMetadataTags);

  // Fragmented MP4 mode (`ftyp` + `moov(mvex)` + `moof` + `mdat`)
  if (options.fragmented) {
    const initialPayloads: Uint8Array[] = [];
    let initialSize = 0;
    const initialOffsets = initialTracks.map(mt => mt.samples.map(sample => {
      const offset = initialSize;
      initialPayloads.push(sample.data);
      initialSize += sample.data.byteLength;
      return offset;
    }));
    const trexBoxes = materializedTracks.map((mt) => {
      const w = new BinaryWriter(20);
      w.writeU32BE(mt.track.id);
      w.writeU32BE(1); // default_sample_description_index
      w.writeU32BE(mt.samples[0]?.duration ?? 1024);
      w.writeU32BE(mt.samples[0]?.size ?? 0);
      w.writeU32BE(0);
      return makeFullBox("trex", 0, 0, w.toUint8Array());
    });
    const mvexBox = makeBox("mvex", concatBytes(trexBoxes));
    const buildMoov = (dataStart: number) => {
      const trakBoxes = initialTracks.map((mt, index) => buildTrakBox(
        { ...mt.track, samples: mt.samples, codecDescriptions: mt.codecDescriptions },
        movieTimescale, initialOffsets[index]!.map(offset => dataStart + offset),
        options.emptyMoov !== false, options.writeColr, chapterTrackId
      ));
      return makeBox("moov", concatBytes([mvhdBox, ...trakBoxes, mvexBox, ...(udtaBox ? [udtaBox] : [])]));
    };
    let moovBox = buildMoov(0);
    if (options.emptyMoov === false) moovBox = buildMoov(ftypBox.byteLength + moovBox.byteLength + 8);

    const fragments: Uint8Array[] = [];
    const randomAccess = new Map<number, { time: number; offset: number; traf: number; sample: number }[]>();
    let moofOffset = ftypBox.byteLength + moovBox.byteLength + (options.emptyMoov === false ? initialSize + 8 : 0);
    const groups = [...boundaries, Infinity].map(end => materializedTracks.flatMap((mt, index) => {
      const start = positions[index]!;
      let stop = start;
      while (stop < mt.samples.length && mt.samples[stop]!.dts / mt.track.timescale < end) stop++;
      positions[index] = stop;
      return stop > start ? [{ ...mt, samples: mt.samples.slice(start, stop) }] : [];
    })).filter(tracks => tracks.length > 0);
    const segmentEntries = new Map<number, { time: number; duration: number; offset: number; size: number; sap: number }[]>();
    const globalIndexSize = options.segmentIndex === "global" ? materializedTracks.reduce((size, mt) => {
      const count = groups.filter(group => group.some(item => item.track.id === mt.track.id)).length;
      if (count > 65535) throw new Error("MP4 segment index exceeds 65535 references");
      return size + (count ? 40 + count * 12 : 0);
    }, 0) : 0;
    const globalIndexOffset = moofOffset;
    moofOffset += globalIndexSize;
    const buildSegmentIndex = (track: MediaTrack, entries: NonNullable<ReturnType<typeof segmentEntries.get>>, offset: number) => {
      const writer = new BinaryWriter(28 + entries.length * 12);
      writer.writeU32BE(track.id);
      writer.writeU32BE(track.timescale);
      writer.writeU64BE(Math.max(0, entries[0]!.time));
      writer.writeU64BE(entries[0]!.offset - offset - (40 + entries.length * 12));
      writer.writeU16BE(0);
      writer.writeU16BE(entries.length);
      for (const [index, entry] of entries.entries()) {
        const size = entries[index + 1] ? entries[index + 1]!.offset - entry.offset : entry.size;
        if (size > 0x7fffffff) throw new Error("MP4 segment index reference exceeds 31-bit size");
        writer.writeU32BE(size);
        writer.writeU32BE(entry.duration);
        writer.writeU32BE(entry.sap);
      }
      return makeFullBox("sidx", 1, 0, writer.toUint8Array());
    };
    let sequence = options.fragmentIndex ?? 1;
    for (const fragmentTracks of groups) {
      const indexOffset = moofOffset;
      if (options.segmentIndex === "fragment") moofOffset += fragmentTracks.length * 52;
      const mdatChunks: Uint8Array[] = [];
      const trackByteStarts: number[] = [];
      let currentMdatPayloadOffset = 0;
      for (const mt of fragmentTracks) {
        trackByteStarts.push(currentMdatPayloadOffset);
        for (const s of mt.samples) {
          mdatChunks.push(s.data);
          currentMdatPayloadOffset += s.data.byteLength;
        }
      }

      // Build moof first with placeholder data_offset, then patch exact moof size + 8
      const buildMoof = (moofByteSize: number): Uint8Array => {
        const mfhdWriter = new BinaryWriter(4);
        mfhdWriter.writeU32BE(sequence); // sequence_number
        const mfhdBox = makeFullBox("mfhd", 0, 0, mfhdWriter.toUint8Array());

        const trafBoxes = fragmentTracks.map((mt, idx) => {
          const tfhdWriter = new BinaryWriter(options.defaultBaseMoof !== false ? 8 : 16);
          tfhdWriter.writeU32BE(mt.track.id);
          if (options.defaultBaseMoof === false) tfhdWriter.writeU64BE(moofOffset);
          tfhdWriter.writeU32BE(1); // sample_description_index
          // Both address modes use the moof start as the base for trun offsets.
          const tfhdBox = makeFullBox("tfhd", 0, options.defaultBaseMoof !== false ? 0x020002 : 0x000003, tfhdWriter.toUint8Array());

          const tfdtWriter = new BinaryWriter(8);
          tfdtWriter.writeU64BE(mt.samples[0]?.dts ?? 0);
          const tfdtBox = makeFullBox("tfdt", 1, 0, tfdtWriter.toUint8Array());

          // trun flags: 0x000f01 (data-offset + duration + size + flags + cts)
          const trunWriter = new BinaryWriter(8 + mt.samples.length * 16);
          trunWriter.writeU32BE(mt.samples.length);
          trunWriter.writeI32BE(moofByteSize + 8 + trackByteStarts[idx]!);
          for (const s of mt.samples) {
            trunWriter.writeU32BE(s.duration);
            trunWriter.writeU32BE(s.data.byteLength);
            trunWriter.writeU32BE(s.isKeyframe ? 0x02000000 : 0x01010000);
            trunWriter.writeI32BE(s.cts);
          }
          const trunBox = makeFullBox("trun", 1, 0x000f01, trunWriter.toUint8Array());
          return makeBox("traf", concatBytes([tfhdBox, tfdtBox, trunBox]));
        });

        return makeBox("moof", concatBytes([mfhdBox, ...trafBoxes]));
      };

      const dummyMoof = buildMoof(0);
      const finalMoof = buildMoof(dummyMoof.byteLength);
      const mdatBox = makeBox("mdat", concatBytes(mdatChunks));
      if (!options.skipTrailer) {
        for (const [index, mt] of fragmentTracks.entries()) {
          const sample = mt.samples.findIndex(sample => sample.isKeyframe);
          if (sample < 0) continue;
          const entries = randomAccess.get(mt.track.id) ?? [];
          entries.push({ time: mt.samples[sample]!.pts, offset: moofOffset, traf: index + 1, sample: sample + 1 });
          randomAccess.set(mt.track.id, entries);
        }
      }
      if (options.segmentIndex) {
        let offset = indexOffset;
        for (const mt of fragmentTracks) {
          const first = mt.samples[0]!;
          const last = mt.samples[mt.samples.length - 1]!;
          const entry = { time: first.pts, duration: last.dts + last.duration - first.dts,
            offset: moofOffset, size: finalMoof.byteLength + mdatBox.byteLength,
            sap: first.isKeyframe ? 0x90000000 : 0 };
          if (options.segmentIndex === "fragment") {
            const box = buildSegmentIndex(mt.track, [entry], offset);
            fragments.push(box);
            offset += box.byteLength;
          } else {
            const entries = segmentEntries.get(mt.track.id) ?? [];
            entries.push(entry);
            segmentEntries.set(mt.track.id, entries);
          }
        }
      }
      moofOffset += finalMoof.byteLength + mdatBox.byteLength;
      fragments.push(finalMoof, mdatBox);
      sequence++;
    }
    if (!options.skipTrailer) {
      const indexes = materializedTracks.map(mt => {
        const entries = randomAccess.get(mt.track.id) ?? [];
        const trafBytes = entries.some(entry => entry.traf > 255) ? 4 : 1;
        const sampleBytes = entries.some(entry => entry.sample > 255) ? 4 : 1;
        const writer = new BinaryWriter(12 + entries.length * (17 + trafBytes + sampleBytes));
        writer.writeU32BE(mt.track.id);
        writer.writeU32BE(((trafBytes - 1) << 4) | (sampleBytes - 1));
        writer.writeU32BE(entries.length);
        for (const entry of entries) {
          writer.writeU64BE(entry.time);
          writer.writeU64BE(entry.offset);
          if (trafBytes === 1) writer.writeU8(entry.traf); else writer.writeU32BE(entry.traf);
          writer.writeU8(1); // One trun per traf.
          if (sampleBytes === 1) writer.writeU8(entry.sample); else writer.writeU32BE(entry.sample);
        }
        return makeFullBox("tfra", 1, 0, writer.toUint8Array());
      });
      const footer = new BinaryWriter(4);
      footer.writeU32BE(24 + indexes.reduce((size, box) => size + box.byteLength, 0));
      fragments.push(makeBox("mfra", concatBytes([...indexes, makeFullBox("mfro", 0, 0, footer.toUint8Array())])));
    }
    const globalIndexes: Uint8Array[] = [];
    let indexOffset = globalIndexOffset;
    for (const mt of materializedTracks) {
      const entries = segmentEntries.get(mt.track.id);
      if (!entries?.length) continue;
      const box = buildSegmentIndex(mt.track, entries, indexOffset);
      globalIndexes.push(box);
      indexOffset += box.byteLength;
    }
    const result = concatBytes([ftypBox, moovBox,
      ...(options.emptyMoov === false ? [makeBox("mdat", concatBytes(initialPayloads))] : []), ...globalIndexes, ...fragments]);
    budget.checkOutputBytes(result.byteLength);
    return result;
  }

  // Standard MP4/MOV layout: compute relative sample offsets within mdat payload
  const mdatPayloads: Uint8Array[] = [];
  const relativeSampleOffsetsPerTrack: number[][] = materializedTracks.map(() => []);
  let mdatPayloadSize = 0;

  // Merge decode-ordered tracks, keeping track order for equal timestamps.
  while (true) {
    let nextTrack = -1;
    let nextTime = Infinity;
    for (let i = 0; i < materializedTracks.length; i++) {
      const mt = materializedTracks[i]!;
      const sample = mt.samples[relativeSampleOffsetsPerTrack[i]!.length];
      if (sample && sample.dts / mt.track.timescale < nextTime) {
        nextTrack = i;
        nextTime = sample.dts / mt.track.timescale;
      }
    }
    if (nextTrack < 0) break;
    const offsets = relativeSampleOffsetsPerTrack[nextTrack]!;
    const sample = materializedTracks[nextTrack]!.samples[offsets.length]!;
    offsets.push(mdatPayloadSize);
    mdatPayloads.push(sample.data);
    mdatPayloadSize += sample.data.byteLength;
  }

  const mdatHeaderSize = 8;
  const faststart = options.faststart ?? doc.faststart ?? true;

  if (!faststart) {
    // Layout: ftyp -> mdat -> moov
    const mdatDataStart = ftypBox.byteLength + mdatHeaderSize;
    const trakBoxes = materializedTracks.map((mt, idx) =>
      buildTrakBox(
        { ...mt.track, samples: mt.samples, codecDescriptions: mt.codecDescriptions },
        movieTimescale,
        relativeSampleOffsetsPerTrack[idx]!.map((rel) => mdatDataStart + rel),
        false, options.writeColr, chapterTrackId
      )
    );
    const moovChildren = [mvhdBox, ...trakBoxes];
    if (udtaBox) moovChildren.push(udtaBox);
    const moovPayload = concatBytes(moovChildren);
    const moovBox = makeBox("moov", moovPayload);
    detachBytesBuffer(moovPayload);
    const mdatPayload = concatBytes(mdatPayloads);
    const mdatBox = makeBox("mdat", mdatPayload);
    detachBytesBuffer(mdatPayload);
    const out = concatBytes([ftypBox, mdatBox, moovBox]);
    detachBytesBuffer(mdatBox);
    detachBytesBuffer(moovBox);
    budget.checkOutputBytes(out.byteLength);
    return out;
  }

  // Faststart layout: ftyp -> moov -> mdat
  // Build moov once with dummy 32-bit offsets to measure exact `moov` byte size
  const dummyTraks = materializedTracks.map((mt, idx) =>
    buildTrakBox(
      { ...mt.track, samples: mt.samples, codecDescriptions: mt.codecDescriptions },
      movieTimescale,
      relativeSampleOffsetsPerTrack[idx]!.map((rel) => rel),
      false, options.writeColr, chapterTrackId
    )
  );
  const dummyMoovChildren = [mvhdBox, ...dummyTraks];
  if (udtaBox) dummyMoovChildren.push(udtaBox);
  const dummyMoov = makeBox("moov", concatBytes(dummyMoovChildren));

  const mdatDataStart = ftypBox.byteLength + dummyMoov.byteLength + mdatHeaderSize;
  const finalTraks = materializedTracks.map((mt, idx) =>
    buildTrakBox(
      { ...mt.track, samples: mt.samples, codecDescriptions: mt.codecDescriptions },
      movieTimescale,
      relativeSampleOffsetsPerTrack[idx]!.map((rel) => mdatDataStart + rel),
      false, options.writeColr, chapterTrackId
    )
  );
  const finalMoovChildren = [mvhdBox, ...finalTraks];
  if (udtaBox) finalMoovChildren.push(udtaBox);
  detachBytesBuffer(dummyMoov);
  const finalMoovPayload = concatBytes(finalMoovChildren);
  const finalMoov = makeBox("moov", finalMoovPayload);
  detachBytesBuffer(finalMoovPayload);
  const mdatPayload = concatBytes(mdatPayloads);
  const mdatBox = makeBox("mdat", mdatPayload);
  detachBytesBuffer(mdatPayload);

  const out = concatBytes([ftypBox, finalMoov, mdatBox]);
  detachBytesBuffer(finalMoov);
  detachBytesBuffer(mdatBox);
  budget.checkOutputBytes(out.byteLength);
  return out;
}

/**
 * Concatenate 2 or more MP4/MediaDocuments losslessly at the packet/sample table level.
 * Preserves distinct `stsd` codec descriptions (`sampleDescriptionIndex = 1, 2, ...`)
 * and aligns audio/video durations across segment boundaries to prevent drift.
 */
export function concatMp4(
  docs: readonly MediaDocument[],
  options: ConcatMediaOptions = {}
): Mp4Document {
  const budget = options.budget ?? new MediaBudgetTracker(options.limits);
  budget.checkConcatInputs(docs.length);
  if (docs.length === 0) {
    throw new Error("concatMp4 requires at least one input MediaDocument");
  }
  if (docs.length === 1) {
    return {
      ...docs[0]!,
      faststart: options.faststart ?? docs[0]!.faststart ?? true,
      metadata: { ...docs[0]!.metadata, ...(options.metadata ?? {}) }
    };
  }

  const baseDoc = docs[0]!;
  const movieTimescale = baseDoc.timescale || 1000;
  const alignTrackDurations = options.alignTrackDurations ?? true;

  // Determine canonical track slots from the union of track types across inputs
  const trackSlots: { type: MediaTrackType; typeOrdinal: number; template: MediaTrack }[] = [];
  for (const doc of docs) {
    const countsByType: Record<string, number> = {};
    for (const trk of doc.tracks) {
      const ord = countsByType[trk.type] ?? 0;
      countsByType[trk.type] = ord + 1;
      if (!trackSlots.some((s) => s.type === trk.type && s.typeOrdinal === ord)) {
        trackSlots.push({ type: trk.type, typeOrdinal: ord, template: trk });
      }
    }
  }

  // Target timescale per slot
  const slotTimescales = trackSlots.map((slot) => {
    if (options.normalizeTimescale === false) return slot.template.timescale || 90000;
    return slot.type === "video" ? 90000 : (slot.template.timescale || 48000);
  });

  const mergedCodecDescriptions: MediaCodecDescription[][] = trackSlots.map(() => []);
  const mergedSamples: MediaSample[][] = trackSlots.map(() => []);
  const mergedDecodedFrames: MediaVideoFrame[][] = trackSlots.map(() => []);
  const runningTicksPerSlot: number[] = trackSlots.map(() => 0);
  const audioSegments: { audio: MediaAudioData; offsetSeconds: number }[][] = trackSlots.map(() => []);
  const encodedAudioSlots = new Set<number>();

  for (let docIdx = 0; docIdx < docs.length; docIdx++) {
    budget.checkCpu();
    const doc = docs[docIdx]!;
    const countsByType: Record<string, number> = {};
    const matchedTracks = new Map<number, MediaTrack>();

    for (const trk of doc.tracks) {
      const ord = countsByType[trk.type] ?? 0;
      countsByType[trk.type] = ord + 1;
      const slotIdx = trackSlots.findIndex((s) => s.type === trk.type && s.typeOrdinal === ord);
      if (slotIdx >= 0) {
        matchedTracks.set(slotIdx, trk);
      }
    }

    for (let slotIdx = 0; slotIdx < trackSlots.length; slotIdx++) {
      const trk = matchedTracks.get(slotIdx);
      if (!trk) continue;
      const targetTimescale = slotTimescales[slotIdx]!;
      const srcTimescale = trk.timescale || targetTimescale;
      const scaleRatio = targetTimescale / srcTimescale;
      const slotDescs = mergedCodecDescriptions[slotIdx]!;
      const slotSamples = mergedSamples[slotIdx]!;
      const materialized = materializeTrackSamples(trk);

      // Map each source codecDescription to a 1-based index in `slotDescs`
      const sdiMap = new Map<number, number>();
      for (let dIdx = 0; dIdx < materialized.codecDescriptions.length; dIdx++) {
        const srcDesc = materialized.codecDescriptions[dIdx]!;
        let existingIdx = -1;
        for (let eIdx = 0; eIdx < slotDescs.length; eIdx++) {
          const existing = slotDescs[eIdx]!;
          if (
            existing.formatFourCC === srcDesc.formatFourCC &&
            existing.width === srcDesc.width &&
            existing.height === srcDesc.height &&
            existing.sampleRate === srcDesc.sampleRate &&
            existing.channels === srcDesc.channels &&
            ((!existing.avcC && !srcDesc.avcC) ||
              (existing.avcC &&
                srcDesc.avcC &&
                bytesEqual(existing.avcC.rawBytes, srcDesc.avcC.rawBytes)))
          ) {
            existingIdx = eIdx;
            break;
          }
        }
        if (existingIdx >= 0) {
          sdiMap.set(dIdx + 1, existingIdx + 1);
        } else {
          slotDescs.push(srcDesc);
          sdiMap.set(dIdx + 1, slotDescs.length);
        }
      }

      let currentTick = runningTicksPerSlot[slotIdx]!;
      const startSeconds = options.startTimesSeconds?.[docIdx];
      // Explicit concat positions refer to presentation start, after video preroll.
      const prerollTicks = trk.type === "video" ? Math.max(0, trk.editList?.[0]?.mediaTime ?? 0) : 0;
      const timestampShift = startSeconds === undefined ? 0 :
        Math.round(startSeconds * targetTimescale - prerollTicks * scaleRatio) - currentTick;
      if (trk.type === "audio") {
        if (trk.decodedAudio) {
          audioSegments[slotIdx]!.push({ audio: trk.decodedAudio, offsetSeconds: currentTick / targetTimescale });
        } else if (materialized.samples.length > 0) {
          encodedAudioSlots.add(slotIdx);
        }
      }
      for (const s of materialized.samples) {
        const scaledDur = Math.max(1, Math.round(s.duration * scaleRatio));
        const scaledCts = Math.round(s.cts * scaleRatio);
        slotSamples.push({
          ...(s.tags ? { tags: s.tags } : {}),
          data: s.data,
          dts: currentTick + timestampShift,
          pts: currentTick + timestampShift + scaledCts,
          cts: scaledCts,
          duration: scaledDur,
          size: s.size,
          isKeyframe: s.isKeyframe,
          sampleDescriptionIndex: sdiMap.get(s.sampleDescriptionIndex) ?? 1
        });
        currentTick += scaledDur;
      }
      runningTicksPerSlot[slotIdx] = currentTick;

      if (trk.decodedVideoFrames) {
        const timeOffsetSec =
          (runningTicksPerSlot[slotIdx]! -
            materialized.samples.reduce((a, b) => a + Math.round(b.duration * scaleRatio), 0)) /
          targetTimescale;
        for (const vf of trk.decodedVideoFrames) {
          mergedDecodedFrames[slotIdx]!.push({
            ...vf,
            ptsSeconds: vf.ptsSeconds + timeOffsetSec + timestampShift / targetTimescale
          });
        }
      }
    }

    // Align track durations at clip boundary so subsequent clips start in sync
    if (alignTrackDurations && docIdx + 1 < docs.length) {
      let maxBoundarySeconds = 0;
      for (let sIdx = 0; sIdx < trackSlots.length; sIdx++) {
        const sec = runningTicksPerSlot[sIdx]! / slotTimescales[sIdx]!;
        if (sec > maxBoundarySeconds) maxBoundarySeconds = sec;
      }
      for (let sIdx = 0; sIdx < trackSlots.length; sIdx++) {
        const targetTicks = Math.round(maxBoundarySeconds * slotTimescales[sIdx]!);
        const deficit = targetTicks - runningTicksPerSlot[sIdx]!;
        if (deficit > 0 && mergedSamples[sIdx]!.length > 0) {
          const lastSample = mergedSamples[sIdx]![mergedSamples[sIdx]!.length - 1]!;
          mergedSamples[sIdx]![mergedSamples[sIdx]!.length - 1] = {
            ...lastSample,
            duration: lastSample.duration + deficit
          };
          runningTicksPerSlot[sIdx] = targetTicks;
        }
      }
    }
  }

  const finalTracks: MediaTrack[] = trackSlots.map((slot, idx) => {
    const timescale = slotTimescales[idx]!;
    const samples = mergedSamples[idx]!;
    const duration = samples.reduce((acc, s) => acc + s.duration, 0);
    const segments = audioSegments[idx]!;
    let decodedAudio: MediaAudioData | undefined;
    if (segments.length > 0) {
      if (encodedAudioSlots.has(idx)) {
        throw new Error("concatMp4 requires all segments in a decoded audio track to be decoded");
      }
      const { sampleRate, channels } = segments[0]!.audio;
      const length = Math.round(duration / timescale * sampleRate);
      budget.allocateMemory(length * channels * Float32Array.BYTES_PER_ELEMENT);
      const channelData = Array.from({ length: channels }, () => new Float32Array(length));
      for (const { audio, offsetSeconds } of segments) {
        const offset = Math.round(offsetSeconds * sampleRate);
        const sourceLength = audio.channelData[0]?.length ?? 0;
        const count = Math.min(length - offset, Math.round(sourceLength * sampleRate / audio.sampleRate));
        for (let channel = 0; channel < channels; channel++) {
          const sources = channels === 1 ? audio.channelData : [audio.channelData[channel % audio.channels]!];
          const output = channelData[channel]!;
          if (audio.sampleRate === sampleRate && sources.length === 1) {
            budget.checkCpu();
            output.set(sources[0]!.subarray(0, count), offset);
            continue;
          }
          for (let i = 0; i < count; i++) {
            if (i % 4096 === 0) budget.checkCpu();
            const position = i * audio.sampleRate / sampleRate;
            const left = Math.floor(position);
            const fraction = position - left;
            let value = 0;
            for (const source of sources) {
              const a = source[left] ?? 0;
              const b = source[Math.min(left + 1, source.length - 1)] ?? 0;
              value += a + (b - a) * fraction;
            }
            output[offset + i] = value / sources.length;
          }
        }
      }
      decodedAudio = { sampleRate, channels, channelData };
    }
    return {
      ...slot.template,
      id: idx + 1,
      decodedAudio,
      timescale,
      duration,
      codecDescriptions: mergedCodecDescriptions[idx]!,
      editList: undefined,
      declaredSampleCount: undefined,
      samples,
      decodedVideoFrames:
        mergedDecodedFrames[idx]!.length > 0 ? mergedDecodedFrames[idx]! : undefined
    };
  });

  let maxSeconds = 0;
  for (const t of finalTracks) {
    const sec = t.duration / Math.max(1, t.timescale);
    if (sec > maxSeconds) maxSeconds = sec;
  }

  return {
    ...baseDoc,
    timescale: movieTimescale,
    duration: Math.round(maxSeconds * movieTimescale),
    durationSeconds: maxSeconds,
    faststart: options.faststart ?? baseDoc.faststart ?? true,
    tracks: finalTracks,
    metadata: {
      ...baseDoc.metadata,
      ...(options.metadata ?? {})
    }
  };
}

/**
 * Slice/trim an MP4/MediaDocument between `startSeconds` and `endSeconds` (or `durationSeconds`).
 */
export function* sliceMp4Steps(doc: MediaDocument, options: SliceMediaOptions = {}): Generator<void, Mp4Document, void> {
  yield;

  let work = 0;

  const startSec = Math.max(0, options.startSeconds ?? 0);
  const endSec =
    options.endSeconds !== undefined
      ? options.endSeconds
      : options.durationSeconds !== undefined
        ? startSec + options.durationSeconds
        : doc.durationSeconds;

  const movieTimescale = doc.timescale || 1000;
  const slicedTracks: MediaTrack[] = [];

  for (const track of doc.tracks) {
    if (++work % 256 === 0) yield;

    if (track.type === "video" && track.decodedVideoFrames) {
      // Video trim boundaries use the nearest stream timebase tick, including half ticks.
      const start = Math.round(startSec * track.timescale) / track.timescale;
      const end = Math.round(endSec * track.timescale) / track.timescale;
      const frames = track.decodedVideoFrames
        .filter((frame) => frame.ptsSeconds >= start && frame.ptsSeconds < end)
        .map((frame) => ({ ...frame, ptsSeconds: frame.ptsSeconds - start }));
      slicedTracks.push({
        ...track,
        duration: Math.round(Math.max(0, Math.min(endSec, track.duration / track.timescale) - start) * track.timescale),
        editList: undefined,
        declaredSampleCount: undefined,
        samples: [],
        decodedVideoFrames: frames
      });
      continue;
    }

    if (track.type === "subtitle") {
      // FFmpeg 7 selects whole subtitle packets by their start timestamp and
      // preserves their timestamps, including cues extending past the end.
      const samples: MediaSample[] = [];
      let duration = 0;
      for (const sample of track.samples) {
        if (++work % 256 === 0) yield;
        const seconds = sample.pts / track.timescale;
        if (seconds < startSec || seconds >= endSec) continue;
        samples.push(sample);
        duration = Math.max(duration, sample.pts + sample.duration);
      }
      slicedTracks.push({ ...track, samples, duration, declaredSampleCount: undefined });
      continue;
    }

    const useEditList = (options.useEditList ?? true) && !track.decodedAudio;
    const materialized = materializeTrackSamples(track);
    const ts = track.timescale || 1000;
    // Packet timestamps include encoder delay; requested times start at audible audio.
    const encoderDelay = (track.samples[0]?.skipSamples ?? 0) * ts /
      (track.codecDescriptions[0]?.sampleRate ?? ts);
    const sourceOrigin = Math.max(0, track.editList?.[0]?.mediaTime ?? encoderDelay);
    const startTick = sourceOrigin + Math.round(startSec * ts);
    const endTick = sourceOrigin + Math.round(Math.min(endSec, track.duration / ts) * ts);

    // Find first sample covering or after startTick
    let firstIdx = materialized.samples.length;
    for (let i = 0; i < materialized.samples.length; i++) {
      if (++work % 256 === 0) yield;

      const s = materialized.samples[i]!;
      if (endTick > startTick && s.dts < endTick && s.dts + s.duration > startTick) {
        firstIdx = i;
        break;
      }
    }

    let actualStartIdx = firstIdx;
    // A zero-start trim must retain compressed audio preroll hidden by the edit list.
    if (useEditList && track.type === "audio" && startSec === 0 && endTick > startTick) {
      actualStartIdx = 0;
    }
    if (useEditList && track.type === "video" && firstIdx < materialized.samples.length) {
      for (let i = firstIdx; i >= 0; i--) {
        if (++work % 256 === 0) yield;
        if (materialized.samples[i]!.isKeyframe) {
          actualStartIdx = i;
          break;
        }
      }
    }

    // Codec delay is already represented in packet timestamps. A duration-only
    // copy must retain that timeline instead of replacing it with an edit list.
    const preserveTimeline = options.copyAudio && track.type === "audio" &&
      !track.decodedAudio && track.codecDelayNs !== undefined && !track.editList && startSec === 0;
    if (options.inputSeek && options.copyAudio && doc.containerFormat === "ogg" &&
        track.codecDescriptions[0]?.codecName === "opus" && !track.decodedAudio) {
      // Ogg seeks return the whole page at or before the requested timestamp.
      // The final EOS page cannot establish an Opus seek timestamp, so native
      // FFmpeg falls back to the preceding page (or the beginning of the stream).
      actualStartIdx = 0;
      const finalPage = materialized.samples.at(-1)?.offset;
      for (let i = 1; i < materialized.samples.length; i++) {
        if (++work % 256 === 0) yield;
        const sample = materialized.samples[i]!;
        if (sample.dts > startTick) break;
        if (sample.offset !== undefined && sample.offset !== finalPage &&
            sample.offset !== materialized.samples[i - 1]!.offset) actualStartIdx = i;
      }
    }

    const slicedSamples: MediaSample[] = [];
    let runningDts = 0;

    let promotedFirstSampleData: Uint8Array | undefined;
    if (
      track.type === "video" &&
      actualStartIdx < materialized.samples.length &&
      materialized.samples[actualStartIdx]!.data.byteLength > 5 &&
      (materialized.samples[actualStartIdx]!.data[4]! & 0x1f) === 1
    ) {
      let keyIdx = actualStartIdx;
      while (keyIdx > 0 && (materialized.samples[keyIdx]!.data[4]! & 0x1f) !== 5) {
        keyIdx--;
      }
      const w = track.width ?? materialized.codecDescriptions[0]?.width ?? 64;
      const h = track.height ?? materialized.codecDescriptions[0]?.height ?? 64;
      let rgba: Uint8Array | undefined;
      const target = materialized.samples[actualStartIdx]!;
      for (const frame of decodeH264Samples(materialized.samples.slice(keyIdx), materialized.codecDescriptions, w, h, track.timescale)) {
        if (Math.abs(frame.ptsSeconds - target.pts / track.timescale) < 1 / track.timescale) {
          rgba = frame.data;
          break;
        }
      }
      if (rgba) {
        promotedFirstSampleData = encodeH264IdrFrame(rgba, w, h, 0);
      }
    }

    for (let i = actualStartIdx; i < materialized.samples.length; i++) {
      if (++work % 256 === 0) yield;

      const s = materialized.samples[i]!;
      if (s.dts >= endTick) break;
      const sampleStart = useEditList ? s.dts : Math.max(startTick, s.dts);
      const clippedDuration = options.copyAudio && track.type === "audio" && !track.decodedAudio
        ? s.duration : Math.max(0, Math.min(s.dts + s.duration, endTick) - sampleStart);
      const isPromotedFirst = i === actualStartIdx && promotedFirstSampleData !== undefined;
      const sampleData = isPromotedFirst ? promotedFirstSampleData! : s.data;
      slicedSamples.push({
        ...s,
        data: sampleData,
        size: sampleData.byteLength,
        isKeyframe: isPromotedFirst ? true : s.isKeyframe,
        dts: preserveTimeline ? s.dts : runningDts,
        pts: preserveTimeline ? s.pts : runningDts + s.cts,
        duration: clippedDuration
      });
      runningDts = (preserveTimeline ? s.dts : runningDts) + clippedDuration;
    }

    let editList: Mp4EditListEntry[] | undefined;
    if (useEditList && !preserveTimeline && slicedSamples.length > 0 && materialized.samples[actualStartIdx]!.dts < startTick) {
      const mediaSkipTicks = Math.max(0, startTick - materialized.samples[actualStartIdx]!.dts);
      const segmentDurMovie = Math.round(Math.max(0, Math.min(options.copyAudio && track.type === "audio" ? Infinity : endTick, materialized.samples[actualStartIdx]!.dts + runningDts) - startTick) / ts * movieTimescale);
      editList = [
        {
          segmentDuration: segmentDurMovie,
          mediaTime: mediaSkipTicks,
          mediaRateInteger: 1,
          mediaRateFraction: 0
        }
      ];
    }

    let slicedDecodedFrames: MediaVideoFrame[] | undefined;
    if (track.decodedVideoFrames) {
      slicedDecodedFrames = track.decodedVideoFrames
        .filter((f) => f.ptsSeconds + f.durationSeconds > startSec && f.ptsSeconds < endSec)
        .map((f) => ({
          ...f,
          ptsSeconds: Math.max(0, f.ptsSeconds - startSec)
        }));
    }

    const decodedAudio = track.decodedAudio && {
      ...track.decodedAudio,
      channelData: track.decodedAudio.channelData.map((channel) =>
        channel.slice(Math.round(startSec * track.decodedAudio!.sampleRate), Math.max(0, Math.round(endSec * track.decodedAudio!.sampleRate)))
      )
    };
    if (decodedAudio) {
      runningDts = Math.round((decodedAudio.channelData[0]?.length ?? 0) * ts / decodedAudio.sampleRate);
    }
    slicedTracks.push({
      ...track,
      decodedAudio,
      duration: editList ? Math.round(editList[0]!.segmentDuration * ts / movieTimescale) : runningDts,
      codecDescriptions: materialized.codecDescriptions,
      editList,
      declaredSampleCount: undefined,
      samples: slicedSamples,
      decodedVideoFrames: slicedDecodedFrames
    });
  }

  let maxSeconds = 0;
  for (const t of slicedTracks) {
    if (++work % 256 === 0) yield;

    const sec = t.duration / Math.max(1, t.timescale);
    if (sec > maxSeconds) maxSeconds = sec;
  }

  return {
    ...doc,
    duration: Math.round(maxSeconds * movieTimescale),
    durationSeconds: maxSeconds,
    tracks: slicedTracks
  };
}

export function sliceMp4(doc: MediaDocument, options: SliceMediaOptions = {}): Mp4Document {
  return drainWork(sliceMp4Steps(doc, options));
}

/**
 * Mux tracks from one or more MediaDocuments into a single MediaDocument.
 */
export function* muxMp4Steps(
  sources: readonly MediaDocument[],
  options: MuxMediaOptions = {}
): Generator<void, Mp4Document, void> {
  yield;

  let work = 0;

  const collectedTracks: MediaTrack[] = [];
  for (const src of sources) {
    if (++work % 256 === 0) yield;

    const selectedTracks = src.tracks.filter(trk =>
      !(options.stripAudio && trk.type === "audio") &&
      !(options.stripVideo && trk.type === "video") &&
      !(options.stripSubtitles && trk.type === "subtitle"));
    const trackIds = new Map(selectedTracks.map((trk, index) => [trk.id, collectedTracks.length + index + 1]));
    for (const trk of selectedTracks) {
      if (++work % 256 === 0) yield;
      collectedTracks.push({
        ...trk,
        id: collectedTracks.length + 1,
        timecodeTrackId: trk.timecodeTrackId === undefined ? undefined : trackIds.get(trk.timecodeTrackId),
        matrix: options.rotation !== undefined && trk.type === "video" ? undefined : trk.matrix,
        rotation:
          options.rotation !== undefined && trk.type === "video" ? options.rotation : trk.rotation
      });
    }
  }

  const base = sources[0] ?? {
    containerFormat: "mp4",
    majorBrand: "isom",
    minorVersion: 512,
    compatibleBrands: ["isom", "iso2", "avc1", "mp41"],
    timescale: 1000,
    duration: 0,
    durationSeconds: 0,
    tracks: [],
    metadata: {}
  };

  let targetDurationSec = 0;
  if (options.shortest && collectedTracks.length > 0) {
    targetDurationSec = Math.min(
      ...collectedTracks.map((t) => t.duration / Math.max(1, t.timescale))
    );
  } else {
    for (const t of collectedTracks) {
      if (++work % 256 === 0) yield;

      const sec = t.duration / Math.max(1, t.timescale);
      if (sec > targetDurationSec) targetDurationSec = sec;
    }
  }

  const finalTracks: MediaTrack[] = [];
  for (const track of collectedTracks) {
    yield;
    finalTracks.push(options.shortest
      ? (yield* sliceMp4Steps({ ...base, tracks: [track] }, { startSeconds: 0, endSeconds: targetDurationSec })).tracks[0]!
      : track);
  }

  return {
    ...base,
    faststart: options.faststart ?? base.faststart ?? true,
    duration: Math.round(targetDurationSec * (base.timescale || 1000)),
    durationSeconds: targetDurationSec,
    tracks: finalTracks,
    chapters: sources.flatMap((src) => src.chapters ?? []),
    metadata: Object.assign({}, ...sources.map((src) => src.metadata), options.metadata ?? {})
  };
}

export function muxMp4(sources: readonly MediaDocument[], options: MuxMediaOptions = {}): Mp4Document {
  return drainWork(muxMp4Steps(sources, options));
}


export function buildProbeResultFromDoc(
  doc: MediaDocument,
  byteLength: number,
  filename = "input.mp4",
  options: { showPackets?: boolean; showFrames?: boolean; formatName?: string; formatLongName?: string } = {}
): MediaProbeResult {
  const streams: MediaProbeStream[] = [];
  const packets: MediaProbePacket[] = [];
  const frames: MediaProbeFrame[] = [];
  let formatStart = Infinity, formatEnd = -Infinity;

  for (let idx = 0; idx < doc.tracks.length; idx++) {
    const track = doc.tracks[idx]!;
    const materialized = doc.containerFormat === "mp4" || doc.containerFormat === "mov"
      ? materializeTrackSamples(track) : track;
    let desc = materialized.codecDescriptions[0];
    const firstSample = materialized.samples[0];
    // Y4M exposes one tick per frame; retain the internal clock for seconds and muxing.
    const probeTickDuration = doc.containerFormat === "yuv4mpegpipe" ? firstSample?.duration ?? 1 : 1;
    if (firstSample && desc?.h264PictureTiming && desc.fieldOrder !== 'progressive') {
      const steps = h264FieldOrderSteps({ payloadOffset: 0, payloadSize: firstSample.data.length }, desc.h264PictureTiming);
      let next = steps.next();
      while (!next.done) {
        if (next.value.kind !== 'read') throw new Error('Unexpected H.264 timing step');
        next = steps.next(firstSample.data.subarray(next.value.offset, next.value.offset + next.value.length));
      }
      if (next.value) desc = { ...desc, fieldOrder: next.value };
    }
    let firstPts = materialized.samples[0]?.pts ?? 0;
    if (track.editList?.length) {
      // Edits place media on the movie timeline; only leading empty edits delay it.
      let delay = 0;
      for (const edit of track.editList) {
        if (edit.mediaTime >= 0) break;
        delay += edit.segmentDuration;
      }
      firstPts = Math.round(delay * track.timescale / Math.max(1, doc.timescale));
    }
    const duration = Math.max(0, track.duration - (track.editList?.length ? firstPts : 0));
    if (doc.containerFormat === "mp4" || doc.containerFormat === "mov") {
      const start = firstPts / Math.max(1, track.timescale);
      formatStart = Math.min(formatStart, start);
      formatEnd = Math.max(formatEnd, start + duration / Math.max(1, track.timescale));
    }
    const audioMediaStart = (doc.containerFormat === "mp4" || doc.containerFormat === "mov") &&
      track.type === "audio" && ["aac", "amr_nb", "amr_wb"].includes(desc?.codecName ?? "")
      ? track.editList?.find(edit => edit.mediaTime >= 0)?.mediaTime : undefined;
    let stream = buildProbeStream({ ...track, duration }, desc, {
      totalBytes: materialized.samples.reduce((total, sample) => total + sample.size, 0),
      count: materialized.samples.length,
      ticks: materialized.samples.reduce((total, sample) => total + sample.duration, 0),
      firstPts,
      initialPadding: audioMediaStart === undefined || !firstSample ? 0
        : Math.max(0, Math.round((audioMediaStart - firstSample.pts) * (desc?.sampleRate ?? track.timescale) / track.timescale)),
      hasReorderedSamples: materialized.samples.some((sample, i, samples) => i > 0 && sample.pts < samples[i - 1]!.pts)
    }, idx, doc.containerFormat);
    if (doc.containerFormat === "yuv4mpegpipe" && firstSample) {
      stream = { ...stream, time_base: stream.r_frame_rate.split("/").reverse().join("/"),
        start_pts: firstPts / probeTickDuration, duration_ts: duration / probeTickDuration };
    }
    if (track.timecodeTrackId !== undefined && (doc.containerFormat === "mp4" || doc.containerFormat === "mov")) {
      const target = doc.tracks.find(candidate => candidate.id === track.timecodeTrackId);
      if (target?.codecDescriptions[0]?.formatFourCC === "tmcd") {
        const sample = materializeTrackSamples(target).samples[0];
        const timecode = sample && decodeMp4Timecode(target.codecDescriptions[0]?.extraData, sample.data);
        if (timecode !== undefined) stream = { ...stream, tags: { ...stream.tags, timecode } };
      }
    }
    // Standalone WebVTT learns its start timestamp only when cues are read.
    if (doc.containerFormat === "webvtt" && (!firstSample || !(options.showPackets || options.showFrames))) {
      stream = { ...stream, start_pts: undefined, start_time: undefined };
    }
    if (desc?.formatFourCC === "tmcd" && firstSample) {
      const timecode = decodeMp4Timecode(desc.extraData, firstSample.data);
      if (timecode !== undefined) stream = { ...stream, tags: { ...stream.tags, timecode } };
    }
    const timestampOffset = audioMediaStart === undefined ? 0 : firstPts - audioMediaStart;
    const primingPackets = audioMediaStart === undefined ? 0 : materialized.samples.reduce(
      (count, sample) => count + (sample.pts + sample.duration <= audioMediaStart ? 1 : 0), 0);
    streams.push(primingPackets ? { ...stream, nb_read_frames: String(materialized.samples.length - primingPackets) } : stream);
    const w = stream.width, h = stream.height, sampleFormat = stream.sample_fmt;

    if (options.showPackets || options.showFrames) {
      let bytePos = 0, firstPacket = true;
      for (const rawSample of materialized.samples) {
        const s = timestampOffset ? { ...rawSample, pts: rawSample.pts + timestampOffset, dts: rawSample.dts + timestampOffset } : rawSample;
        const ptsTime = (s.pts / Math.max(1, track.timescale)).toFixed(6);
        const dtsTime = (s.dts / Math.max(1, track.timescale)).toFixed(6);
        const durTime = (s.duration / Math.max(1, track.timescale)).toFixed(6);
        if (options.showPackets) {
          packets.push({
            codec_type: track.type,
            stream_index: idx,
            pts: s.pts / probeTickDuration,
            pts_time: ptsTime,
            dts: s.dts / probeTickDuration,
            dts_time: dtsTime,
            duration: desc?.codecName === "" ? undefined : s.duration / probeTickDuration,
            duration_time: desc?.codecName === "" ? undefined : durTime,
            size: String(s.size),
            pos: String(s.offset ?? (doc.containerFormat === "mp4" || doc.containerFormat === "mov" ? -1 : bytePos)),
            flags: `${s.isKeyframe ? "K" : "_"}${audioMediaStart !== undefined && rawSample.pts + rawSample.duration <= audioMediaStart ? "D" : "_"}_`,
            ...(s.webvtt?.identifier || s.webvtt?.settings ? {
              side_data_list: [
                ...(s.webvtt.identifier ? [{ side_data_type: "WebVTT ID" }] : []),
                ...(s.webvtt.settings ? [{ side_data_type: "WebVTT Settings" }] : [])
              ]
            } : {}),
            ...(firstPacket && audioMediaStart !== undefined && audioMediaStart > rawSample.pts ? {
              side_data_list: [{ side_data_type: "Skip Samples",
                skip_samples: Math.round((audioMediaStart - rawSample.pts) * (desc?.sampleRate ?? track.timescale) / track.timescale),
                discard_padding: 0, skip_reason: 0, discard_reason: 0 }]
            } : {})
          });
        }
        firstPacket = false;
        if (options.showFrames && track.type !== "data" && !(audioMediaStart !== undefined && s.pts + s.duration <= firstPts)) {
          const skipTicks = audioMediaStart === undefined ? 0 : Math.max(0, firstPts - s.pts);
          const frame = skipTicks ? { ...s, pts: s.pts + skipTicks, dts: s.dts + skipTicks, duration: s.duration - skipTicks } : s;
          const ptsTime = (frame.pts / Math.max(1, track.timescale)).toFixed(6);
          const dtsTime = (frame.dts / Math.max(1, track.timescale)).toFixed(6);
          const durTime = (frame.duration / Math.max(1, track.timescale)).toFixed(6);
          // AVSubtitle uses microsecond PTS and millisecond display bounds.
          if (track.type === "subtitle" && (doc.containerFormat === "matroska" || doc.containerFormat === "webm" || doc.containerFormat === "webvtt")) {
            frames.push({
              media_type: "subtitle",
              stream_index: idx,
              pkt_dts: frame.dts,
              pts: Math.round(frame.pts * 1_000_000 / Math.max(1, track.timescale)),
              pts_time: ptsTime,
              format: 1,
              start_display_time: 0,
              end_display_time: Math.floor(frame.duration * 1000 / Math.max(1, track.timescale)),
              num_rects: frame.size > 0 ? 1 : 0
            });
          } else frames.push({
            media_type: track.type,
            stream_index: idx,
            key_frame: frame.isKeyframe ? 1 : 0,
            pts: frame.pts / probeTickDuration,
            pts_time: ptsTime,
            pkt_dts: frame.dts / probeTickDuration,
            pkt_dts_time: dtsTime,
            best_effort_timestamp: frame.pts / probeTickDuration,
            best_effort_timestamp_time: ptsTime,
            ...(["gif", "mp4", "mov", "yuv4mpegpipe"].includes(doc.containerFormat)
              ? { duration: frame.duration / probeTickDuration, duration_time: durTime }
              : { pkt_duration: frame.duration, pkt_duration_time: durTime }),
            ...(["wav", "w64", "matroska", "aiff", "au"].includes(doc.containerFormat) ? { duration: frame.duration, duration_time: durTime } : {}),
            pkt_size: String(frame.size),
            ...(["mp4", "mov", "wav", "w64", "matroska", "webm", "aiff", "au", "yuv4mpegpipe"].includes(doc.containerFormat) ? { pkt_pos: String(frame.offset ?? -1) } : {}),
            width: w,
            height: h,
            ...(stream.sample_aspect_ratio ? { sample_aspect_ratio: stream.sample_aspect_ratio } : {}),
            pix_fmt: track.type === "video" ? (desc?.pixFmt ?? "yuv420p") : undefined,
            pict_type: undefined,
            sample_fmt: sampleFormat,
            nb_samples: track.type === "audio"
              ? doc.containerFormat === "matroska" && desc?.codecName?.startsWith("pcm_") && (desc.channels ?? 0) > 0 && (desc.bitsPerSample ?? 0) > 0
                ? Math.floor(frame.size / (desc.channels! * Math.ceil(desc.bitsPerSample! / 8)))
                : desc?.codecName === "amr_nb" || desc?.codecName === "amr_wb"
                  ? (desc.codecName === "amr_nb" ? 160 : 320) - Math.round(skipTicks * (desc.sampleRate ?? track.timescale) / track.timescale)
                  : frame.duration
              : undefined,
            channels: track.type === "audio" ? (desc?.channels ?? 2) : undefined,
            ...(["mp4", "mov"].includes(doc.containerFormat) ? { channel_layout: stream.channel_layout } : {})
          });
        }
        bytePos += s.size;
      }
    }
  }

  if (doc.containerFormat === "matroska" || doc.containerFormat === "webm") {
    // Tracks store samples separately; block positions recover demux order, even with reordered timestamps.
    packets.sort((a, b) => Number(a.pos) - Number(b.pos));
  }

  const formatTags: Record<string, string> = { ...doc.metadata.custom };
  if (doc.majorBrand) formatTags.major_brand = doc.majorBrand;
  if (doc.minorVersion !== undefined) formatTags.minor_version = String(doc.minorVersion);
  if (doc.compatibleBrands && doc.compatibleBrands.length > 0) {
    formatTags.compatible_brands = doc.compatibleBrands.join("");
  }
  for (const key of Object.keys(mp4ProbeMetadataKeys) as (keyof typeof mp4ProbeMetadataKeys)[]) {
    const value = doc.metadata[key];
    if (value) formatTags[doc.containerFormat === "ffmetadata"
      ? doc.metadata.keySpellings?.[key] ?? mp4ProbeMetadataKeys[key]
      : mp4ProbeMetadataKeys[key]] = value;
  }

  const startTime = Number.isFinite(formatStart) ? formatStart : 0;
  const duration = Number.isFinite(formatEnd) ? Math.max(0, formatEnd - startTime) : doc.durationSeconds;
  const unknownDuration = (doc.containerFormat === "ffmetadata" && !doc.chapters?.length) ||
    (doc.containerFormat === "aiff" && duration === 0);
  const overallBitRate =
    duration > 0
      ? String((doc.containerFormat === 'mp4' || doc.containerFormat === 'mov' || doc.containerFormat === 'aiff' ? Math.trunc : Math.round)((byteLength * 8) / duration))
      : "0";

  return {
    streams,
    format: {
      filename,
      nb_streams: streams.length,
      nb_programs: 0,
      nb_stream_groups: 0,
      format_name: options.formatName ?? "mov,mp4,m4a,3gp,3g2,mj2",
      format_long_name: options.formatLongName ?? "QuickTime / MOV",
      start_time: startTime.toFixed(6),
      ...(unknownDuration ? {} : { duration: duration.toFixed(6) }),
      size: String(byteLength),
      ...(unknownDuration ? {} : { bit_rate: overallBitRate }),
      probe_score: 100,
      tags: formatTags
    },
    chapters: (doc.chapters ?? []).map((ch: Mp4Chapter) => {
      const { numerator, denominator } = ch.timeBase ?? { numerator: 1, denominator: ch.timescale ?? 1000 };
      const factor = numerator / denominator;
      return {
        id: ch.id,
        time_base: `${numerator}/${denominator}`,
        start: Math.round(ch.startTimeSeconds / factor),
        start_time: ch.startTimeSeconds.toFixed(6),
        end: Math.round(ch.endTimeSeconds / factor),
        end_time: ch.endTimeSeconds.toFixed(6),
        tags: ch.tags ?? { title: ch.title }
      };
    }),
    packets: options.showPackets ? packets : undefined,
    frames: options.showFrames ? frames : undefined
  };
}

export function probeMp4(
  bytes: Uint8Array,
  options: ParseMediaOptions & { showPackets?: boolean; showFrames?: boolean } = {}
): MediaProbeResult {
  const doc = parseMp4(bytes, { ...options, decodeAudio: false });
  return buildProbeResultFromDoc(doc, bytes.byteLength, options.filename ?? "input.mp4", options);
}

export interface CreateSyntheticMp4Options {
  readonly width?: number | undefined;
  readonly height?: number | undefined;
  readonly fps?: number | undefined;
  readonly durationSeconds?: number | undefined;
  readonly frameCount?: number | undefined;
  readonly color?: readonly [number, number, number] | undefined;
  readonly includeAudio?: boolean | undefined;
  readonly sampleRate?: number | undefined;
  readonly channels?: number | undefined;
  readonly faststart?: boolean | undefined;
  readonly fragmented?: boolean | undefined;
  readonly metadata?: Mp4MetadataTags | undefined;
}

/**
 * Create a valid, standard-compliant H.264 (`avc1`) + AAC (`mp4a`) MP4 binary buffer.
 */
export function createSyntheticMp4(options: CreateSyntheticMp4Options = {}): Uint8Array {
  const width = options.width ?? 64;
  const height = options.height ?? 64;
  const fps = options.fps ?? 10;
  const durationSeconds = options.durationSeconds ?? 1;
  const frameCount = options.frameCount ?? Math.max(1, Math.round(durationSeconds * fps));
  const [baseR, baseG, baseB] = options.color ?? [40, 120, 220];

  const videoFrames: MediaVideoFrame[] = [];
  for (let i = 0; i < frameCount; i++) {
    const rgba = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        rgba[idx] = (baseR + i * 17 + x * 2) & 0xff;
        rgba[idx + 1] = (baseG + y * 2) & 0xff;
        rgba[idx + 2] = (baseB + i * 9) & 0xff;
        rgba[idx + 3] = 255;
      }
    }
    videoFrames.push({
      width,
      height,
      data: rgba,
      ptsSeconds: i / fps,
      durationSeconds: 1 / fps,
      keyframe: true
    });
  }

  const tracks: MediaTrack[] = [
    {
      id: 1,
      type: "video",
      handlerType: "vide",
      handlerName: "VideoHandler",
      timescale: 90000,
      duration: Math.round((frameCount / fps) * 90000),
      language: "und",
      enabled: true,
      width,
      height,
      codecDescriptions: [],
      samples: [],
      decodedVideoFrames: videoFrames
    }
  ];

  if (options.includeAudio !== false) {
    const sampleRate = options.sampleRate ?? 44100;
    const channels = options.channels ?? 2;
    const totalSamples = Math.max(1024, Math.round((frameCount / fps) * sampleRate));
    tracks.push({
      id: 2,
      type: "audio",
      handlerType: "soun",
      handlerName: "SoundHandler",
      timescale: sampleRate,
      duration: totalSamples,
      language: "und",
      enabled: true,
      codecDescriptions: [],
      samples: [],
      decodedAudio: {
        sampleRate,
        channels,
        channelData: Array.from({ length: channels }, () => new Float32Array(totalSamples))
      }
    });
  }

  const doc: MediaDocument = {
    containerFormat: "mp4",
    majorBrand: "isom",
    minorVersion: 512,
    compatibleBrands: ["isom", "iso2", "avc1", "mp41"],
    timescale: 1000,
    duration: Math.round((frameCount / fps) * 1000),
    durationSeconds: frameCount / fps,
    faststart: options.faststart ?? true,
    tracks,
    metadata: options.metadata ?? { encoder: "@poe-code/mp4-ast" }
  };

  return serializeMp4(doc, {
    faststart: options.faststart ?? true,
    fragmented: options.fragmented ?? false
  });
}

export function mp4Ast(): MediaAstPlugin {
  return {
    id: "mp4",
    formatName: "mov,mp4,m4a,3gp,3g2,mj2",
    formatLongName: "MP4 / ISOBMFF (MPEG-4 Part 14)",
    extensions: ["mp4", "m4a", "m4v", "3gp", "3g2", "f4v"],
    mimeTypes: ["video/mp4", "audio/mp4", "video/3gpp"],
    canDemux: true,
    canMux: true,
    supportedVideoCodecs: ["h264", "hevc", "av1", "vp8", "vp9", "mpeg4", "mjpeg", "png"],
    supportedAudioCodecs: ["aac", "mp3", "amr_nb", "amr_wb", "opus", "flac", "alac", "ac3", "eac3", "pcm_s16le"],
    supportedSubtitleCodecs: ["mov_text", "webvtt", "ttml"],
    detect(bytes, filename) {
      if (isMp4Signature(bytes)) return true;
      if (filename) {
        const ext = filename.split(".").pop()?.toLowerCase() ?? "";
        if (["mp4", "m4a", "m4v", "3gp", "3g2", "f4v"].includes(ext) && bytes.byteLength >= 8) {
          return true;
        }
      }
      return false;
    },
    parse(bytes, options) {
      return parseMp4(bytes, options);
    },
    serialize(doc, options) {
      return serializeMp4(doc, { ...options, format: options?.format === "3gp" ? "3gp" : "mp4" });
    },
    probe(bytes, options) {
      return probeMp4(bytes, options);
    },
    concat(docs, options) {
      return concatMp4(docs, options);
    },
    slice(doc, options) {
      return sliceMp4(doc, options);
    }
  };
}

export function movAst(): MediaAstPlugin {
  return {
    id: "mov",
    formatName: "mov,mp4,m4a,3gp,3g2,mj2",
    formatLongName: "QuickTime / MOV",
    extensions: ["mov", "qt"],
    mimeTypes: ["video/quicktime"],
    canDemux: true,
    canMux: true,
    supportedVideoCodecs: ["h264", "hevc", "mpeg4", "mjpeg", "png", "prores"],
    supportedAudioCodecs: ["aac", "mp3", "alac", "pcm_s16le", "pcm_s16be"],
    supportedSubtitleCodecs: ["mov_text"],
    detect(bytes, filename) {
      if (bytes.byteLength >= 12 && decodeFourCC(bytes, 4) === "ftyp") {
        const brand = decodeFourCC(bytes, 8);
        if (brand === "qt  ") return true;
      }
      if (filename) {
        const ext = filename.split(".").pop()?.toLowerCase() ?? "";
        if ((ext === "mov" || ext === "qt") && isMp4Signature(bytes)) return true;
      }
      return false;
    },
    parse(bytes, options) {
      return parseMp4(bytes, options);
    },
    serialize(doc, options) {
      return serializeMp4(doc, { ...options, format: "mov", majorBrand: "qt  ", compatibleBrands: ["qt  "] });
    },
    probe(bytes, options) {
      return probeMp4(bytes, options);
    },
    concat(docs, options) {
      return concatMp4(docs, options);
    },
    slice(doc, options) {
      return sliceMp4(doc, options);
    }
  };
}
