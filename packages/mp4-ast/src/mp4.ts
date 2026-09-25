import {
  BinaryReader,
  BinaryWriter,
  bytesEqual,
  concatBytes,
  decodeFourCC,
  decodeUtf8,
  encodeUtf8,
  gcd,
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
  decodeH264FrameToRgba,
  encodeH264IdrFrame,
  parseAv1C,
  parseAvcC,
  parseDOps,
  parseEsds,
  parseH264Sps,
  parseHvcC,
  parseVpcC
} from "./codecs.js";
import {
  MediaBudgetTracker,
  type ConcatMediaOptions,
  type MediaAstPlugin,
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

const CONTAINER_BOXES = new Set([
  "moov",
  "trak",
  "edts",
  "mdia",
  "minf",
  "dinf",
  "stbl",
  "mvex",
  "moof",
  "traf",
  "mfra",
  "udta",
  "ilst",
  "sinf",
  "schi",
  "tref",
  "gmhd"
]);

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
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, bytes.byteLength - offset);
    let size = view.getUint32(0, false);
    const type = decodeFourCC(bytes, offset + 4);
    let headerSize = 8;

    if (size === 1) {
      if (offset + 16 > bytes.byteLength) break;
      const hi = view.getUint32(8, false);
      const lo = view.getUint32(12, false);
      size = hi * 4294967296 + lo;
      headerSize = 16;
    } else if (size === 0) {
      size = bytes.byteLength - offset;
    }

    if (size < headerSize || offset + size > bytes.byteLength) {
      size = bytes.byteLength - offset;
      if (size < headerSize) break;
    }

    let uuid: Uint8Array | undefined;
    if (type === "uuid" && headerSize + 16 <= size) {
      uuid = bytes.subarray(offset + headerSize, offset + headerSize + 16);
      headerSize += 16;
    }

    const payload = bytes.subarray(offset + headerSize, offset + size);
    let children: Mp4Box[] | undefined;

    if (CONTAINER_BOXES.has(type)) {
      children = parseMp4Boxes(payload, baseOffset + offset + headerSize, depth + 1, budget);
    } else if (type === "meta") {
      // `meta` is normally a FullBox (4 byte version/flags before children),
      // or a direct container in older QuickTime files.
      if (payload.byteLength >= 12) {
        const maybeChildType = decodeFourCC(payload, 8);
        if (
          maybeChildType === "hdlr" ||
          maybeChildType === "ilst" ||
          maybeChildType === "keys" ||
          maybeChildType === "free"
        ) {
          children = parseMp4Boxes(
            payload.subarray(4),
            baseOffset + offset + headerSize + 4,
            depth + 1,
            budget
          );
        } else {
          children = parseMp4Boxes(payload, baseOffset + offset + headerSize, depth + 1, budget);
        }
      }
    }

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
  reader.skip(4); // version + flags
  const entryCount = reader.readU32BE();
  const descriptions: MediaCodecDescription[] = [];

  for (let i = 0; i < entryCount && reader.remaining >= 8; i++) {
    const entryStart = reader.offset;
    const entrySize = reader.readU32BE();
    const formatFourCC = reader.readFourCC();
    if (entrySize < 8 || entryStart + entrySize > payload.byteLength) break;
    const rawEntryBytes = payload.subarray(entryStart, entryStart + entrySize);
    const body = payload.subarray(entryStart + 8, entryStart + entrySize);

    let codecName = formatFourCC.trim().toLowerCase();
    let profile: string | undefined;
    let level: number | undefined;
    let width: number | undefined;
    let height: number | undefined;
    let pixFmt: string | undefined;
    let sarWidth = 1;
    let sarHeight = 1;
    let sampleRate: number | undefined;
    let channels: number | undefined;
    let bitsPerSample: number | undefined;
    let avcC: ReturnType<typeof parseAvcC> | undefined;
    let hvcC: ReturnType<typeof parseHvcC> | undefined;
    let av1C: ReturnType<typeof parseAv1C> | undefined;
    let vpcC: ReturnType<typeof parseVpcC> | undefined;
    let esds: ReturnType<typeof parseEsds> | undefined;
    let dOps: ReturnType<typeof parseDOps> | undefined;

    if (
      formatFourCC === "avc1" ||
      formatFourCC === "avc3" ||
      formatFourCC === "hvc1" ||
      formatFourCC === "hev1" ||
      formatFourCC === "av01" ||
      formatFourCC === "vp08" ||
      formatFourCC === "vp09" ||
      formatFourCC === "mp4v" ||
      formatFourCC === "jpeg" ||
      formatFourCC === "mjpa" ||
      formatFourCC === "png " ||
      formatFourCC === "s263"
    ) {
      // VisualSampleEntry: 6 reserved + 2 data_ref_index + 16 pre_defined/reserved + 2 width + 2 height + ... = 78 bytes before child boxes
      if (body.byteLength >= 78) {
        const vReader = new BinaryReader(body);
        vReader.skip(6 + 2 + 16);
        width = vReader.readU16BE();
        height = vReader.readU16BE();
        vReader.skip(4 + 4 + 4 + 2 + 32 + 2 + 2);
        const childBoxes = parseMp4Boxes(body.subarray(78));

        for (const child of childBoxes) {
          if (child.type === "avcC") {
            avcC = parseAvcC(child.payload);
            codecName = "h264";
            level = avcC.levelIdc;
            if (avcC.sps[0]) {
              const spsInfo = parseH264Sps(avcC.sps[0]);
              profile = spsInfo.profileName;
              width = spsInfo.width || width;
              height = spsInfo.height || height;
              pixFmt = spsInfo.pixFmt;
              sarWidth = spsInfo.sarWidth;
              sarHeight = spsInfo.sarHeight;
            }
          } else if (child.type === "hvcC") {
            hvcC = parseHvcC(child.payload);
            codecName = "hevc";
            level = hvcC.generalLevelIdc;
            profile = hvcC.generalProfileIdc === 2 ? "Main 10" : "Main";
            pixFmt = hvcC.bitDepthLumaMinus8 > 0 ? "yuv420p10le" : "yuv420p";
          } else if (child.type === "av1C") {
            av1C = parseAv1C(child.payload);
            codecName = "av1";
            profile = av1C.seqProfile === 0 ? "Main" : av1C.seqProfile === 1 ? "High" : "Professional";
            level = av1C.seqLevelIdx0;
            pixFmt = av1C.highBitdepth ? "yuv420p10le" : "yuv420p";
          } else if (child.type === "vpcC") {
            vpcC = parseVpcC(child.payload);
            codecName = formatFourCC === "vp08" ? "vp8" : "vp9";
            profile = `Profile ${vpcC.profile}`;
            level = vpcC.level;
            pixFmt = "yuv420p";
          } else if (child.type === "esds") {
            esds = parseEsds(child.payload);
          } else if (child.type === "pasp" && child.payload.byteLength >= 8) {
            const pReader = new BinaryReader(child.payload);
            sarWidth = pReader.readU32BE() || 1;
            sarHeight = pReader.readU32BE() || 1;
          }
        }
      }
      if (formatFourCC === "avc1" || formatFourCC === "avc3") codecName = "h264";
      else if (formatFourCC === "hvc1" || formatFourCC === "hev1") codecName = "hevc";
      else if (formatFourCC === "av01") codecName = "av1";
      else if (formatFourCC === "vp08") codecName = "vp8";
      else if (formatFourCC === "vp09") codecName = "vp9";
      else if (formatFourCC === "jpeg" || formatFourCC === "mjpa") codecName = "mjpeg";
      else if (formatFourCC === "mp4v") codecName = "mpeg4";
      else if (formatFourCC === "png ") codecName = "png";
      pixFmt = pixFmt ?? "yuv420p";
    } else if (
      formatFourCC === "mp4a" ||
      formatFourCC === "Opus" ||
      formatFourCC === "fLaC" ||
      formatFourCC === "alac" ||
      formatFourCC === "ac-3" ||
      formatFourCC === "ec-3" ||
      formatFourCC === "sowt" ||
      formatFourCC === "twos" ||
      formatFourCC === "lpcm" ||
      formatFourCC === ".mp3" ||
      formatFourCC === "ulaw" ||
      formatFourCC === "alaw"
    ) {
      // AudioSampleEntry: 6 reserved + 2 data_ref_index + 2 version + 6 reserved + 2 channels + 2 sampleSize + 4 pre_defined/reserved + 4 sampleRate (16.16) = 28 bytes
      if (body.byteLength >= 28) {
        const aReader = new BinaryReader(body);
        aReader.skip(6 + 2);
        const qtVersion = aReader.readU16BE();
        aReader.skip(6);
        channels = aReader.readU16BE();
        bitsPerSample = aReader.readU16BE();
        aReader.skip(4);
        sampleRate = Math.round(aReader.readU32BE() / 65536);

        let childOffset = 28;
        if (qtVersion === 1) childOffset += 16;
        else if (qtVersion === 2) childOffset += 36;

        if (childOffset < body.byteLength) {
          const childBoxes = parseMp4Boxes(body.subarray(childOffset));
          for (const child of childBoxes) {
            if (child.type === "esds") {
              esds = parseEsds(child.payload);
              if (esds.sampleRate > 0) sampleRate = esds.sampleRate;
              if (esds.channelCount > 0) channels = esds.channelCount;
              if (esds.objectTypeIndication === 0x6b || esds.objectTypeIndication === 0x69) {
                codecName = "mp3";
              } else {
                codecName = "aac";
                profile = esds.audioObjectType === 5 ? "HE-AAC" : "LC";
              }
            } else if (child.type === "dOps") {
              dOps = parseDOps(child.payload);
              codecName = "opus";
              sampleRate = dOps.inputSampleRate || 48000;
              channels = dOps.outputChannelCount || channels;
            } else if (child.type === "wave" && child.children) {
              const waveEsds = findBox(child.children, "esds");
              if (waveEsds) {
                esds = parseEsds(waveEsds.payload);
                if (esds.sampleRate > 0) sampleRate = esds.sampleRate;
                if (esds.channelCount > 0) channels = esds.channelCount;
              }
            }
          }
        }
      }
      if (formatFourCC === "mp4a" && codecName === "mp4a") {
        codecName = "aac";
        profile = profile ?? "LC";
      } else if (formatFourCC === "Opus") codecName = "opus";
      else if (formatFourCC === "fLaC") codecName = "flac";
      else if (formatFourCC === "alac") codecName = "alac";
      else if (formatFourCC === "ac-3") codecName = "ac3";
      else if (formatFourCC === "ec-3") codecName = "eac3";
      else if (formatFourCC === "sowt") codecName = "pcm_s16le";
      else if (formatFourCC === "twos") codecName = "pcm_s16be";
      else if (formatFourCC === "lpcm") codecName = "pcm_s16le";
      else if (formatFourCC === ".mp3") codecName = "mp3";
    } else if (formatFourCC === "tx3g" || formatFourCC === "text") {
      codecName = "mov_text";
    } else if (formatFourCC === "wvtt") {
      codecName = "webvtt";
    } else if (formatFourCC === "stpp") {
      codecName = "ttml";
    }

    descriptions.push({
      formatFourCC,
      codecName,
      codecTagString: formatFourCC,
      profile,
      level,
      width,
      height,
      pixFmt,
      sarWidth,
      sarHeight,
      sampleRate,
      channels,
      bitsPerSample,
      avcC,
      hvcC,
      av1C,
      vpcC,
      esds,
      dOps,
      rawStsdEntryBytes: rawEntryBytes
    });

    reader.seek(entryStart + entrySize);
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

    if (item.type === "covr") {
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

    switch (item.type) {
      case "\xa9nam":
        tags.title = text;
        break;
      case "\xa9ART":
        tags.artist = text;
        break;
      case "aART":
        tags.albumArtist = text;
        break;
      case "\xa9alb":
        tags.album = text;
        break;
      case "\xa9day":
        tags.date = text;
        break;
      case "\xa9cmt":
        tags.comment = text;
        break;
      case "\xa9gen":
        tags.genre = text;
        break;
      case "\xa9too":
        tags.encoder = text;
        break;
      case "desc":
        tags.description = text;
        break;
      case "cprt":
        tags.copyright = text;
        break;
      default:
        tags.custom[item.type] = text;
        break;
    }
  }

  return tags;
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
    const matrix: number[] = [];

    if (tkhd && tkhd.payload.byteLength >= 24) {
      const tReader = new BinaryReader(tkhd.payload);
      const version = tReader.readU8();
      const flags = tReader.readU24BE();
      enabled = (flags & 0x01) !== 0;
      if (version === 1) {
        tReader.skip(16); // creation + modification
        trackId = tReader.readU32BE() || tIdx + 1;
        tReader.skip(4); // reserved
        tkhdDuration = tReader.readU64BE();
      } else {
        tReader.skip(8);
        trackId = tReader.readU32BE() || tIdx + 1;
        tReader.skip(4);
        tkhdDuration = tReader.readU32BE();
      }
      tReader.skip(8); // reserved
      tReader.skip(2 + 2); // layer + alternateGroup
      volume = tReader.readFixed8_8();
      tReader.skip(2); // reserved
      for (let m = 0; m < 9; m++) {
        matrix.push(tReader.readI32BE());
      }
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
    if (firstCodec?.width && !width) width = firstCodec.width;
    if (firstCodec?.height && !height) height = firstCodec.height;

    const type: MediaTrackType =
      handlerType === "vide"
        ? "video"
        : handlerType === "soun"
          ? "audio"
          : handlerType === "sbtl" || handlerType === "text" || handlerType === "subp"
            ? "subtitle"
            : "data";

    // Parse stts (Time to Sample)
    const sttsBox = findBox(stbl?.children, "stts");
    const sttsEntries: { count: number; delta: number }[] = [];
    if (sttsBox && sttsBox.payload.byteLength >= 8) {
      const r = new BinaryReader(sttsBox.payload);
      r.skip(4);
      const count = r.readU32BE();
      for (let i = 0; i < count && !r.eof; i++) {
        sttsEntries.push({ count: r.readU32BE(), delta: r.readU32BE() });
      }
    }

    // Parse ctts (Composition Offset)
    const cttsBox = findBox(stbl?.children, "ctts");
    const cttsEntries: { count: number; offset: number }[] = [];
    if (cttsBox && cttsBox.payload.byteLength >= 8) {
      const r = new BinaryReader(cttsBox.payload);
      const version = r.readU8();
      r.skip(3);
      const count = r.readU32BE();
      for (let i = 0; i < count && !r.eof; i++) {
        const sampleCount = r.readU32BE();
        const sampleOffset = version === 1 ? r.readI32BE() : r.readU32BE();
        cttsEntries.push({ count: sampleCount, offset: sampleOffset });
      }
    }

    // Parse stsc (Sample to Chunk)
    const stscBox = findBox(stbl?.children, "stsc");
    const stscEntries: {
      firstChunk: number;
      samplesPerChunk: number;
      sampleDescriptionIndex: number;
    }[] = [];
    if (stscBox && stscBox.payload.byteLength >= 8) {
      const r = new BinaryReader(stscBox.payload);
      r.skip(4);
      const count = r.readU32BE();
      for (let i = 0; i < count && !r.eof; i++) {
        stscEntries.push({
          firstChunk: r.readU32BE(),
          samplesPerChunk: r.readU32BE(),
          sampleDescriptionIndex: r.readU32BE() || 1
        });
      }
    }

    // Parse stsz / stz2 (Sample Size)
    const stszBox = findBox(stbl?.children, "stsz");
    let uniformSampleSize = 0;
    let sampleCount = 0;
    const sampleSizes: number[] = [];
    if (stszBox && stszBox.payload.byteLength >= 12) {
      const r = new BinaryReader(stszBox.payload);
      r.skip(4);
      uniformSampleSize = r.readU32BE();
      sampleCount = r.readU32BE();
      budget.checkSamples(sampleCount);
      if (uniformSampleSize === 0) {
        for (let i = 0; i < sampleCount && !r.eof; i++) {
          sampleSizes.push(r.readU32BE());
        }
      }
    }

    // Parse stco / co64 (Chunk Offset)
    const stcoBox = findBox(stbl?.children, "stco");
    const co64Box = findBox(stbl?.children, "co64");
    const chunkOffsets: number[] = [];
    if (stcoBox && stcoBox.payload.byteLength >= 8) {
      const r = new BinaryReader(stcoBox.payload);
      r.skip(4);
      const count = r.readU32BE();
      for (let i = 0; i < count && !r.eof; i++) {
        chunkOffsets.push(r.readU32BE());
      }
    } else if (co64Box && co64Box.payload.byteLength >= 8) {
      const r = new BinaryReader(co64Box.payload);
      r.skip(4);
      const count = r.readU32BE();
      for (let i = 0; i < count && !r.eof; i++) {
        chunkOffsets.push(r.readU64BE());
      }
    }

    // Parse stss (Sync Sample / Keyframes)
    const stssBox = findBox(stbl?.children, "stss");
    const syncSamples = new Set<number>();
    if (stssBox && stssBox.payload.byteLength >= 8) {
      const r = new BinaryReader(stssBox.payload);
      r.skip(4);
      const count = r.readU32BE();
      for (let i = 0; i < count && !r.eof; i++) {
        syncSamples.add(r.readU32BE());
      }
    }

    // Reconstruct samples from stbl
    const samples: MediaSample[] = [];
    if (sampleCount > 0 && chunkOffsets.length > 0 && stscEntries.length > 0) {
      let sttsIdx = 0;
      let sttsRem = sttsEntries[0]?.count ?? 0;
      let cttsIdx = 0;
      let cttsRem = cttsEntries[0]?.count ?? 0;
      let currentDts = 0;
      let sampleIdx = 0;

      for (let chunkIdx = 0; chunkIdx < chunkOffsets.length && sampleIdx < sampleCount; chunkIdx++) {
        const chunkNumber = chunkIdx + 1;
        let stscEntry = stscEntries[0]!;
        for (let s = 0; s < stscEntries.length; s++) {
          if (stscEntries[s]!.firstChunk <= chunkNumber) {
            stscEntry = stscEntries[s]!;
          } else {
            break;
          }
        }

        let byteCursor = chunkOffsets[chunkIdx]!;
        for (
          let sInChunk = 0;
          sInChunk < stscEntry.samplesPerChunk && sampleIdx < sampleCount;
          sInChunk++
        ) {
          const size = uniformSampleSize > 0 ? uniformSampleSize : (sampleSizes[sampleIdx] ?? 0);
          while (sttsRem <= 0 && sttsIdx + 1 < sttsEntries.length) {
            sttsIdx++;
            sttsRem = sttsEntries[sttsIdx]!.count;
          }
          const delta = sttsEntries[sttsIdx]?.delta ?? 1024;
          if (sttsRem > 0) sttsRem--;

          let cts = 0;
          if (cttsEntries.length > 0) {
            while (cttsRem <= 0 && cttsIdx + 1 < cttsEntries.length) {
              cttsIdx++;
              cttsRem = cttsEntries[cttsIdx]!.count;
            }
            cts = cttsEntries[cttsIdx]?.offset ?? 0;
            if (cttsRem > 0) cttsRem--;
          }

          const dts = currentDts;
          const pts = dts + cts;
          currentDts += delta;

          const sampleOneBased = sampleIdx + 1;
          const isKeyframe =
            stssBox === undefined
              ? true
              : syncSamples.size === 0
                ? sampleOneBased === 1
                : syncSamples.has(sampleOneBased);

          const safeStart = Math.max(0, Math.min(bytes.byteLength, byteCursor));
          const safeEnd = Math.max(safeStart, Math.min(bytes.byteLength, safeStart + size));
          let samplePayload = bytes.subarray(safeStart, safeEnd);
          if (type === "subtitle" && samplePayload.byteLength >= 2) {
            const textLen = (samplePayload[0]! << 8) | samplePayload[1]!;
            if (textLen === 0) {
              byteCursor += size;
              sampleIdx++;
              continue;
            }
            if (2 + textLen <= samplePayload.byteLength) {
              samplePayload = samplePayload.subarray(2, 2 + textLen);
            }
          }
          samples.push({
            data: samplePayload,
            dts,
            pts,
            cts,
            duration: delta,
            size: samplePayload.byteLength,
            isKeyframe,
            sampleDescriptionIndex: stscEntry.sampleDescriptionIndex
          });

          byteCursor += size;
          sampleIdx++;
        }
      }
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
          const tfhdReader = new BinaryReader(tfhd.payload);
          tfhdReader.readU8();
          const tfhdFlags = tfhdReader.readU24BE();
          const trafTrackId = tfhdReader.readU32BE();
          if (trafTrackId !== trackId) continue;

          let baseDataOffset = moof.offset;
          let defaultSampleDescriptionIndex = trex.defaultSampleDescriptionIndex;
          let defaultSampleDuration = trex.defaultSampleDuration;
          let defaultSampleSize = trex.defaultSampleSize;
          let defaultSampleFlags = trex.defaultSampleFlags;

          if (tfhdFlags & 0x000001) baseDataOffset = tfhdReader.readU64BE();
          if (tfhdFlags & 0x000002) defaultSampleDescriptionIndex = tfhdReader.readU32BE();
          if (tfhdFlags & 0x000008) defaultSampleDuration = tfhdReader.readU32BE();
          if (tfhdFlags & 0x000010) defaultSampleSize = tfhdReader.readU32BE();
          if (tfhdFlags & 0x000020) defaultSampleFlags = tfhdReader.readU32BE();

          const tfdt = findBox(traf.children, "tfdt");
          if (tfdt && tfdt.payload.byteLength >= 8) {
            const tfdtReader = new BinaryReader(tfdt.payload);
            const tfdtVersion = tfdtReader.readU8();
            tfdtReader.skip(3);
            runningDts = tfdtVersion === 1 ? tfdtReader.readU64BE() : tfdtReader.readU32BE();
          }

          const trunBoxes = findBoxes(traf.children, "trun");
          for (const trun of trunBoxes) {
            if (trun.payload.byteLength < 8) continue;
            const trunReader = new BinaryReader(trun.payload);
            const trunVersion = trunReader.readU8();
            const trunFlags = trunReader.readU24BE();
            const trunSampleCount = trunReader.readU32BE();
            budget.checkSamples(samples.length + trunSampleCount);

            let dataOffset = baseDataOffset;
            if (trunFlags & 0x000001) {
              dataOffset = baseDataOffset + trunReader.readI32BE();
            }
            const firstSampleFlags =
              trunFlags & 0x000004 ? trunReader.readU32BE() : undefined;

            let cursor = dataOffset;
            for (let s = 0; s < trunSampleCount && !trunReader.eof; s++) {
              const duration =
                trunFlags & 0x000100 ? trunReader.readU32BE() : defaultSampleDuration;
              const size = trunFlags & 0x000200 ? trunReader.readU32BE() : defaultSampleSize;
              const flags =
                trunFlags & 0x000400
                  ? trunReader.readU32BE()
                  : s === 0 && firstSampleFlags !== undefined
                    ? firstSampleFlags
                    : defaultSampleFlags;
              const cts =
                trunFlags & 0x000800
                  ? trunVersion === 1
                    ? trunReader.readI32BE()
                    : trunReader.readU32BE()
                  : 0;

              // ISO 14496-12 sample_is_non_sync_sample bit (bit 16)
              const isNonSync = (flags & 0x00010000) !== 0;
              const sampleDependsOn = (flags >>> 24) & 0x03;
              const isKeyframe = sampleDependsOn === 2 || (!isNonSync && (s === 0 || type !== "video"));

              const safeStart = Math.max(0, Math.min(bytes.byteLength, cursor));
              const safeEnd = Math.max(safeStart, Math.min(bytes.byteLength, safeStart + size));
              samples.push({
                data: bytes.subarray(safeStart, safeEnd),
                dts: runningDts,
                pts: runningDts + cts,
                cts,
                duration,
                size: safeEnd - safeStart,
                isKeyframe,
                sampleDescriptionIndex: defaultSampleDescriptionIndex
              });

              runningDts += duration;
              cursor += size;
            }
          }
        }
      }
    }

    const computedDuration =
      samples.reduce((acc, s) => acc + s.duration, 0) ||
      trackDuration ||
      Math.round((tkhdDuration / Math.max(1, movieTimescale)) * timescale);

    let decodedVideoFrames: MediaVideoFrame[] | undefined;
    if (options.decodeFrames && type === "video" && width && height) {
      const lengthSize = (firstCodec?.avcC?.lengthSizeMinusOne ?? 3) + 1;
      decodedVideoFrames = [];
      for (const sample of samples) {
        budget.recordFrame(width, height);
        const rgba = decodeH264FrameToRgba(sample.data, width, height, lengthSize);
        decodedVideoFrames.push({
          width,
          height,
          data: rgba,
          ptsSeconds: sample.pts / Math.max(1, timescale),
          durationSeconds: sample.duration / Math.max(1, timescale),
          keyframe: sample.isKeyframe
        });
      }
    }

    tracks.push({
      id: trackId,
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
      samples,
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
    boxes: topBoxes,
    byteLength: bytes.byteLength
  };
}

function buildVisualStsdEntry(desc: MediaCodecDescription, width: number, height: number): Uint8Array {
  if (desc.rawStsdEntryBytes && desc.rawStsdEntryBytes.byteLength >= 86) {
    return desc.rawStsdEntryBytes;
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

  return makeBox(desc.formatFourCC || "avc1", writer.toUint8Array());
}

function buildSubtitleStsdEntry(desc: MediaCodecDescription): Uint8Array {
  if (desc.rawStsdEntryBytes) return desc.rawStsdEntryBytes;
  const ftabWriter = new BinaryWriter(16);
  ftabWriter.writeU16BE(1); // entry_count = 1
  ftabWriter.writeU16BE(1); // font_ID = 1
  ftabWriter.writeU8(5);    // font_name_length = 5
  ftabWriter.writeBytes(new TextEncoder().encode("Serif"));
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
  } else if (desc.dOps) {
    writer.writeBytes(makeBox("dOps", desc.dOps.rawBytes));
  }

  return makeBox(desc.formatFourCC || "mp4a", writer.toUint8Array());
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

function buildUdtaMetadataBox(tags: Mp4MetadataTags): Uint8Array | undefined {
  const ilstItems: Uint8Array[] = [];
  if (tags.title) ilstItems.push(buildIlstTagBox("\xa9nam", tags.title));
  if (tags.artist) ilstItems.push(buildIlstTagBox("\xa9ART", tags.artist));
  if (tags.albumArtist) ilstItems.push(buildIlstTagBox("aART", tags.albumArtist));
  if (tags.album) ilstItems.push(buildIlstTagBox("\xa9alb", tags.album));
  if (tags.date) ilstItems.push(buildIlstTagBox("\xa9day", tags.date));
  if (tags.comment) ilstItems.push(buildIlstTagBox("\xa9cmt", tags.comment));
  if (tags.genre) ilstItems.push(buildIlstTagBox("\xa9gen", tags.genre));
  if (tags.encoder) ilstItems.push(buildIlstTagBox("\xa9too", tags.encoder));
  if (tags.description) ilstItems.push(buildIlstTagBox("desc", tags.description));
  if (tags.copyright) ilstItems.push(buildIlstTagBox("cprt", tags.copyright));

  if (ilstItems.length === 0) return undefined;

  const hdlrWriter = new BinaryWriter(32);
  hdlrWriter.writeU32BE(0); // pre_defined
  hdlrWriter.writeFourCC("mdir");
  hdlrWriter.writeFourCC("appl");
  hdlrWriter.writeZeros(8);
  hdlrWriter.writeU8(0);
  const metaHdlr = makeFullBox("hdlr", 0, 0, hdlrWriter.toUint8Array());
  const ilstBox = makeBox("ilst", concatBytes(ilstItems));
  const metaBox = makeFullBox("meta", 0, 0, concatBytes([metaHdlr, ilstBox]));
  return makeBox("udta", metaBox);
}

function materializeTrackSamples(track: MediaTrack): {
  samples: readonly MediaSample[];
  codecDescriptions: readonly MediaCodecDescription[];
} {
  if (track.type === "subtitle" && track.samples.length > 0) {
    const alreadyPacked = track.samples.every(
      (s) => s.data.byteLength >= 2 && ((s.data[0]! << 8) | s.data[1]!) === s.data.byteLength - 2
    );
    const codecDescriptions: readonly MediaCodecDescription[] =
      track.codecDescriptions.length > 0
        ? track.codecDescriptions.map((d) => ({ ...d, formatFourCC: "tx3g", codecName: "mov_text" }))
        : [{ formatFourCC: "tx3g", codecName: "mov_text" }];
    if (alreadyPacked) {
      return { samples: track.samples, codecDescriptions };
    }
    const tx3gSamples: MediaSample[] = [];
    let cursor = 0;
    for (const s of track.samples) {
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
      const wrapped = new Uint8Array(2 + s.data.byteLength);
      wrapped[0] = (s.data.byteLength >>> 8) & 0xff;
      wrapped[1] = s.data.byteLength & 0xff;
      wrapped.set(s.data, 2);
      const dur = Math.max(1, Math.round(s.duration));
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
    const { sps, pps } = buildH264SpsPps(width, height, fps);
    const avcCBytes = buildAvcC([sps], [pps]);
    const avcC = parseAvcC(avcCBytes);
    const samples: MediaSample[] = [];
    let dts = 0;

    for (let i = 0; i < track.decodedVideoFrames.length; i++) {
      const frame = track.decodedVideoFrames[i]!;
      const duration = Math.max(1, Math.round(frame.durationSeconds * timescale));
      const encoded = encodeH264IdrFrame(frame.data, width, height, i);
      samples.push({
        data: encoded,
        dts,
        pts: dts,
        cts: 0,
        duration,
        size: encoded.byteLength,
        isKeyframe: true,
        sampleDescriptionIndex: 1
      });
      dts += duration;
    }

    return {
      samples,
      codecDescriptions: [
        {
          formatFourCC: "avc1",
          codecName: "h264",
          profile: "Constrained Baseline",
          level: 31,
          width,
          height,
          pixFmt: "yuv420p",
          avcC
        }
      ]
    };
  }

  if (track.type === "audio" && track.decodedAudio) {
    const sampleRate = track.decodedAudio.sampleRate || 44100;
    const channels = track.decodedAudio.channels || 2;
    const totalSamples = track.decodedAudio.channelData[0]?.length ?? 1024;
    const numFrames = Math.max(1, Math.ceil(totalSamples / 1024));
    const silentAac = createSilentAacFrame(channels);
    const samples: MediaSample[] = [];
    for (let i = 0; i < numFrames; i++) {
      samples.push({
        data: silentAac,
        dts: i * 1024,
        pts: i * 1024,
        cts: 0,
        duration: 1024,
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
  fragmented = false
): Uint8Array {
  const materialized = materializeTrackSamples(track);
  const samples = fragmented ? [] : materialized.samples;
  const codecDescriptions = materialized.codecDescriptions;

  const totalSampleDuration =
    samples.reduce((acc, s) => acc + s.duration, 0) || track.duration || track.timescale;
  const durationInMovieTimescale = Math.round(
    (totalSampleDuration / Math.max(1, track.timescale)) * movieTimescale
  );

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
    track.rotation !== undefined
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
      stsdEntries.push(buildVisualStsdEntry(desc, track.width ?? desc.width ?? 320, track.height ?? desc.height ?? 240));
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
  for (const s of samples) {
    const delta = Math.max(0, Math.round(s.duration));
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
  if (edtsBox) trakChildren.push(edtsBox);
  trakChildren.push(mdiaBox);
  return makeBox("trak", concatBytes(trakChildren));
}

export function serializeMp4(doc: MediaDocument, options: SerializeMediaOptions = {}): Uint8Array {
  const budget = options.budget ?? new MediaBudgetTracker(options.limits);
  const isMov = options.format === "mov" || doc.containerFormat === "mov";
  const majorBrand = options.majorBrand ?? (isMov ? "qt  " : (doc.majorBrand ?? "isom"));
  const compatibleBrands =
    options.compatibleBrands ??
    (isMov ? ["qt  "] : (doc.compatibleBrands && doc.compatibleBrands.length > 0 ? doc.compatibleBrands : ["isom", "iso2", "avc1", "mp41"]));

  // ftyp
  const ftypWriter = new BinaryWriter(16 + compatibleBrands.length * 4);
  ftypWriter.writeFourCC(majorBrand);
  ftypWriter.writeU32BE(doc.minorVersion ?? 512);
  for (const b of compatibleBrands) ftypWriter.writeFourCC(b);
  const ftypBox = makeBox("ftyp", ftypWriter.toUint8Array());

  const movieTimescale = doc.timescale || 1000;
  const materializedTracks = doc.tracks.map((t) => ({
    track: t,
    ...materializeTrackSamples(t)
  }));

  let maxDurationSeconds = 0;
  for (const mt of materializedTracks) {
    const durTicks = mt.samples.reduce((acc, s) => acc + s.duration, 0) || mt.track.duration;
    const sec = durTicks / Math.max(1, mt.track.timescale);
    if (sec > maxDurationSeconds) maxDurationSeconds = sec;
  }
  const movieDuration = Math.round(maxDurationSeconds * movieTimescale);

  // mvhd
  const mvhdWriter = new BinaryWriter(100);
  mvhdWriter.writeU32BE(0); // creation_time
  mvhdWriter.writeU32BE(0); // modification_time
  mvhdWriter.writeU32BE(movieTimescale);
  mvhdWriter.writeU32BE(options.fragmented ? 0 : movieDuration);
  mvhdWriter.writeFixed16_16(1.0); // rate
  mvhdWriter.writeFixed8_8(1.0); // volume
  mvhdWriter.writeZeros(10); // reserved
  for (const m of IDENTITY_MATRIX) mvhdWriter.writeI32BE(m);
  mvhdWriter.writeZeros(24); // pre_defined
  mvhdWriter.writeU32BE(doc.tracks.length + 1); // next_track_id
  const mvhdBox = makeFullBox("mvhd", 0, 0, mvhdWriter.toUint8Array());

  const mergedMetadata: Mp4MetadataTags = {
    ...doc.metadata,
    ...(options.metadata ?? {})
  };
  const udtaBox = buildUdtaMetadataBox(mergedMetadata);

  // Fragmented MP4 mode (`ftyp` + `moov(mvex)` + `moof` + `mdat`)
  if (options.fragmented) {
    const trakBoxes = materializedTracks.map((mt) =>
      buildTrakBox(
        { ...mt.track, samples: mt.samples, codecDescriptions: mt.codecDescriptions },
        movieTimescale,
        [],
        true
      )
    );
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
    const moovChildren = [mvhdBox, ...trakBoxes, mvexBox];
    if (udtaBox) moovChildren.push(udtaBox);
    const moovBox = makeBox("moov", concatBytes(moovChildren));

    // Build single moof + mdat fragment containing all track runs
    const mdatChunks: Uint8Array[] = [];
    const trackByteStarts: number[] = [];
    let currentMdatPayloadOffset = 0;
    for (const mt of materializedTracks) {
      trackByteStarts.push(currentMdatPayloadOffset);
      for (const s of mt.samples) {
        mdatChunks.push(s.data);
        currentMdatPayloadOffset += s.data.byteLength;
      }
    }

    // Build moof first with placeholder data_offset, then patch exact moof size + 8
    const buildMoof = (moofByteSize: number): Uint8Array => {
      const mfhdWriter = new BinaryWriter(4);
      mfhdWriter.writeU32BE(1); // sequence_number = 1
      const mfhdBox = makeFullBox("mfhd", 0, 0, mfhdWriter.toUint8Array());

      const trafBoxes = materializedTracks.map((mt, idx) => {
        const tfhdWriter = new BinaryWriter(8);
        tfhdWriter.writeU32BE(mt.track.id);
        tfhdWriter.writeU32BE(1); // sample_description_index
        // flags: 0x020002 (default-base-is-moof + sample-description-index-present)
        const tfhdBox = makeFullBox("tfhd", 0, 0x020002, tfhdWriter.toUint8Array());

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
    const result = concatBytes([ftypBox, moovBox, finalMoof, mdatBox]);
    budget.checkOutputBytes(result.byteLength);
    return result;
  }

  // Standard MP4/MOV layout: compute relative sample offsets within mdat payload
  const mdatPayloads: Uint8Array[] = [];
  const relativeSampleOffsetsPerTrack: number[][] = [];
  let mdatPayloadSize = 0;

  for (const mt of materializedTracks) {
    const offsets: number[] = [];
    for (const sample of mt.samples) {
      offsets.push(mdatPayloadSize);
      mdatPayloads.push(sample.data);
      mdatPayloadSize += sample.data.byteLength;
    }
    relativeSampleOffsetsPerTrack.push(offsets);
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
        relativeSampleOffsetsPerTrack[idx]!.map((rel) => mdatDataStart + rel)
      )
    );
    const moovChildren = [mvhdBox, ...trakBoxes];
    if (udtaBox) moovChildren.push(udtaBox);
    const moovBox = makeBox("moov", concatBytes(moovChildren));
    const mdatBox = makeBox("mdat", concatBytes(mdatPayloads));
    const out = concatBytes([ftypBox, mdatBox, moovBox]);
    budget.checkOutputBytes(out.byteLength);
    return out;
  }

  // Faststart layout: ftyp -> moov -> mdat
  // Build moov once with dummy 32-bit offsets to measure exact `moov` byte size
  const dummyTraks = materializedTracks.map((mt, idx) =>
    buildTrakBox(
      { ...mt.track, samples: mt.samples, codecDescriptions: mt.codecDescriptions },
      movieTimescale,
      relativeSampleOffsetsPerTrack[idx]!.map((rel) => rel)
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
      relativeSampleOffsetsPerTrack[idx]!.map((rel) => mdatDataStart + rel)
    )
  );
  const finalMoovChildren = [mvhdBox, ...finalTraks];
  if (udtaBox) finalMoovChildren.push(udtaBox);
  const finalMoov = makeBox("moov", concatBytes(finalMoovChildren));
  const mdatBox = makeBox("mdat", concatBytes(mdatPayloads));

  const out = concatBytes([ftypBox, finalMoov, mdatBox]);
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
      for (const s of materialized.samples) {
        const scaledDur = Math.max(1, Math.round(s.duration * scaleRatio));
        const scaledCts = Math.round(s.cts * scaleRatio);
        slotSamples.push({
          data: s.data,
          dts: currentTick,
          pts: currentTick + scaledCts,
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
            ptsSeconds: vf.ptsSeconds + timeOffsetSec
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
    return {
      ...slot.template,
      id: idx + 1,
      timescale,
      duration,
      codecDescriptions: mergedCodecDescriptions[idx]!,
      editList: undefined,
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
export function sliceMp4(doc: MediaDocument, options: SliceMediaOptions = {}): Mp4Document {
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
    const materialized = materializeTrackSamples(track);
    const ts = track.timescale || 1000;
    const startTick = Math.round(startSec * ts);
    const endTick = Math.round(endSec * ts);

    // Find first sample covering or after startTick
    let firstIdx = 0;
    for (let i = 0; i < materialized.samples.length; i++) {
      const s = materialized.samples[i]!;
      if (s.dts + s.duration > startTick) {
        firstIdx = i;
        break;
      }
    }

    // Back up to preceding keyframe if useEditList is requested on video tracks
    let keyframeIdx = firstIdx;
    if (options.useEditList && track.type === "video") {
      for (let i = firstIdx; i >= 0; i--) {
        if (materialized.samples[i]!.isKeyframe) {
          keyframeIdx = i;
          break;
        }
      }
    } else if (track.type === "video" && !materialized.samples[firstIdx]?.isKeyframe) {
      for (let i = firstIdx; i >= 0; i--) {
        if (materialized.samples[i]!.isKeyframe) {
          keyframeIdx = i;
          break;
        }
      }
      firstIdx = keyframeIdx;
    }

    const actualStartIdx = options.useEditList ? keyframeIdx : firstIdx;
    const slicedSamples: MediaSample[] = [];
    let runningDts = 0;

    for (let i = actualStartIdx; i < materialized.samples.length; i++) {
      const s = materialized.samples[i]!;
      if (s.dts >= endTick && slicedSamples.length > 0) break;
      const clippedDuration =
        s.dts + s.duration > endTick ? Math.max(1, endTick - s.dts) : s.duration;
      slicedSamples.push({
        ...s,
        dts: runningDts,
        pts: runningDts + s.cts,
        duration: clippedDuration
      });
      runningDts += clippedDuration;
    }

    let editList: Mp4EditListEntry[] | undefined;
    if (options.useEditList && actualStartIdx < firstIdx && materialized.samples[actualStartIdx]) {
      const mediaSkipTicks = Math.max(0, startTick - materialized.samples[actualStartIdx]!.dts);
      const segmentDurMovie = Math.round(Math.max(0, endSec - startSec) * movieTimescale);
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

    slicedTracks.push({
      ...track,
      duration: runningDts,
      codecDescriptions: materialized.codecDescriptions,
      editList,
      samples: slicedSamples,
      decodedVideoFrames: slicedDecodedFrames
    });
  }

  let maxSeconds = 0;
  for (const t of slicedTracks) {
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

/**
 * Mux tracks from one or more MediaDocuments into a single MediaDocument.
 */
export function muxMp4(
  sources: readonly MediaDocument[],
  options: MuxMediaOptions = {}
): Mp4Document {
  const collectedTracks: MediaTrack[] = [];
  for (const src of sources) {
    for (const trk of src.tracks) {
      if (options.stripAudio && trk.type === "audio") continue;
      if (options.stripVideo && trk.type === "video") continue;
      if (options.stripSubtitles && trk.type === "subtitle") continue;
      collectedTracks.push({
        ...trk,
        id: collectedTracks.length + 1,
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
      const sec = t.duration / Math.max(1, t.timescale);
      if (sec > targetDurationSec) targetDurationSec = sec;
    }
  }

  const finalTracks = options.shortest
    ? collectedTracks.map((t) => sliceMp4({ ...base, tracks: [t] }, { startSeconds: 0, endSeconds: targetDurationSec }).tracks[0]!)
    : collectedTracks;

  return {
    ...base,
    faststart: options.faststart ?? base.faststart ?? true,
    duration: Math.round(targetDurationSec * (base.timescale || 1000)),
    durationSeconds: targetDurationSec,
    tracks: finalTracks,
    metadata: {
      ...base.metadata,
      ...(options.metadata ?? {})
    }
  };
}

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

export function buildProbeResultFromDoc(
  doc: MediaDocument,
  byteLength: number,
  filename = "input.mp4",
  options: { showPackets?: boolean; showFrames?: boolean; formatName?: string; formatLongName?: string } = {}
): MediaProbeResult {
  const streams: MediaProbeStream[] = [];
  const packets: MediaProbePacket[] = [];
  const frames: MediaProbeFrame[] = [];

  for (let idx = 0; idx < doc.tracks.length; idx++) {
    const track = doc.tracks[idx]!;
    const materialized = materializeTrackSamples(track);
    const desc = materialized.codecDescriptions[0];
    const codecName = desc?.codecName ?? (track.type === "video" ? "h264" : "aac");
    const codecLongName = CODEC_LONG_NAMES[codecName] ?? codecName;
    const tagFourCC = desc?.formatFourCC ?? (track.type === "video" ? "avc1" : "mp4a");
    const tagHex =
      "0x" +
      Array.from(tagFourCC.padEnd(4, " ").slice(0, 4))
        .map((c) => c.charCodeAt(0).toString(16).padStart(2, "0"))
        .join("");

    const durationSec = track.duration / Math.max(1, track.timescale);
    const totalBytes = materialized.samples.reduce((acc, s) => acc + s.size, 0);
    const bitRate =
      durationSec > 0 ? String(Math.round((totalBytes * 8) / durationSec)) : "0";
    const nbFrames = materialized.samples.length;
    const fpsNum = durationSec > 0 ? Math.round((nbFrames / durationSec) * 1000) : 30000;
    const fpsGcd = gcd(fpsNum, 1000);
    const avgFrameRate =
      track.type === "video" ? `${fpsNum / fpsGcd}/${1000 / fpsGcd}` : "0/0";

    const w = track.width ?? desc?.width;
    const h = track.height ?? desc?.height;
    const darGcd = w && h ? gcd(w, h) : 1;

    const streamTags: Record<string, string> = {
      language: track.language || "und"
    };
    if (track.handlerName) streamTags.handler_name = track.handlerName;
    if (track.rotation) streamTags.rotate = String(track.rotation);

    streams.push({
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
      has_b_frames: materialized.samples.some((s) => s.cts !== 0) ? 1 : 0,
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
      sample_fmt: track.type === "audio" ? "fltp" : undefined,
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
      start_pts: materialized.samples[0]?.pts ?? 0,
      start_time: ((materialized.samples[0]?.pts ?? 0) / Math.max(1, track.timescale)).toFixed(6),
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
    });

    if (options.showPackets || options.showFrames) {
      let bytePos = 0;
      for (const s of materialized.samples) {
        const ptsTime = (s.pts / Math.max(1, track.timescale)).toFixed(6);
        const dtsTime = (s.dts / Math.max(1, track.timescale)).toFixed(6);
        const durTime = (s.duration / Math.max(1, track.timescale)).toFixed(6);
        if (options.showPackets) {
          packets.push({
            codec_type: track.type,
            stream_index: idx,
            pts: s.pts,
            pts_time: ptsTime,
            dts: s.dts,
            dts_time: dtsTime,
            duration: s.duration,
            duration_time: durTime,
            size: String(s.size),
            pos: String(bytePos),
            flags: s.isKeyframe ? "K_" : "__"
          });
        }
        if (options.showFrames) {
          frames.push({
            media_type: track.type,
            stream_index: idx,
            key_frame: s.isKeyframe ? 1 : 0,
            pts: s.pts,
            pts_time: ptsTime,
            pkt_dts: s.dts,
            pkt_dts_time: dtsTime,
            best_effort_timestamp: s.pts,
            best_effort_timestamp_time: ptsTime,
            pkt_duration: s.duration,
            pkt_duration_time: durTime,
            pkt_size: String(s.size),
            width: w,
            height: h,
            pix_fmt: track.type === "video" ? (desc?.pixFmt ?? "yuv420p") : undefined,
            pict_type: track.type === "video" ? (s.isKeyframe ? "I" : "P") : undefined,
            sample_fmt: track.type === "audio" ? "fltp" : undefined,
            nb_samples: track.type === "audio" ? s.duration : undefined,
            channels: track.type === "audio" ? (desc?.channels ?? 2) : undefined
          });
        }
        bytePos += s.size;
      }
    }
  }

  const formatTags: Record<string, string> = {};
  if (doc.majorBrand) formatTags.major_brand = doc.majorBrand;
  if (doc.minorVersion !== undefined) formatTags.minor_version = String(doc.minorVersion);
  if (doc.compatibleBrands && doc.compatibleBrands.length > 0) {
    formatTags.compatible_brands = doc.compatibleBrands.join("");
  }
  if (doc.metadata.title) formatTags.title = doc.metadata.title;
  if (doc.metadata.artist) formatTags.artist = doc.metadata.artist;
  if (doc.metadata.album) formatTags.album = doc.metadata.album;
  if (doc.metadata.date) formatTags.date = doc.metadata.date;
  if (doc.metadata.comment) formatTags.comment = doc.metadata.comment;
  if (doc.metadata.genre) formatTags.genre = doc.metadata.genre;
  if (doc.metadata.encoder) formatTags.encoder = doc.metadata.encoder;

  const overallBitRate =
    doc.durationSeconds > 0
      ? String(Math.round((byteLength * 8) / doc.durationSeconds))
      : "0";

  return {
    streams,
    format: {
      filename,
      nb_streams: streams.length,
      nb_programs: 0,
      format_name: options.formatName ?? "mov,mp4,m4a,3gp,3g2,mj2",
      format_long_name: options.formatLongName ?? "QuickTime / MOV",
      start_time: "0.000000",
      duration: doc.durationSeconds.toFixed(6),
      size: String(byteLength),
      bit_rate: overallBitRate,
      probe_score: 100,
      tags: formatTags
    },
    chapters: (doc.chapters ?? []).map((ch: Mp4Chapter) => ({
      id: ch.id,
      time_base: "1/1000",
      start: Math.round(ch.startTimeSeconds * 1000),
      start_time: ch.startTimeSeconds.toFixed(6),
      end: Math.round(ch.endTimeSeconds * 1000),
      end_time: ch.endTimeSeconds.toFixed(6),
      tags: { title: ch.title }
    })),
    packets: options.showPackets ? packets : undefined,
    frames: options.showFrames ? frames : undefined
  };
}

export function probeMp4(
  bytes: Uint8Array,
  options: ParseMediaOptions & { showPackets?: boolean; showFrames?: boolean } = {}
): MediaProbeResult {
  const doc = parseMp4(bytes, options);
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
    supportedAudioCodecs: ["aac", "mp3", "opus", "flac", "alac", "ac3", "eac3", "pcm_s16le"],
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
      return serializeMp4(doc, { ...options, format: "mp4" });
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
