import { BitReader, BitWriter, concatBytes, decodeFourCC, makeBox, parseAv1C, parseMp4Boxes, type MediaBudgetTracker, type MediaTrack } from "@poe-code/mp4-ast";

type Av1Edits = Partial<Record<"color_primaries" | "transfer_characteristics" | "matrix_coefficients" | "color_range" | "chroma_sample_position", number>> & { rate?: readonly [number, number]; ticks?: number };

/** Rewrite sequence headers in packets and decoder configuration, preserving coded frames. */
export function setAv1Metadata(tracks: readonly MediaTrack[], filter: string, budget: MediaBudgetTracker): readonly MediaTrack[] {
  const edits: Av1Edits = {};
  for (const option of filter === "av1_metadata" ? [] : filter.slice("av1_metadata=".length).split(":")) {
    const [key, value, extra] = option.split("=");
    if (!value || extra !== undefined) throw new Error(`Invalid AV1 bitstream filter option: ${option}`);
    if (key === "tick_rate" || key === "num_ticks_per_picture") {
      const fields = value.split("/");
      if (fields.some(field => !field || [...field].some(c => c < "0" || c > "9"))) {
        throw new Error(`Invalid bitstream filter option: ${option}`);
      }
      if (key === "tick_rate" && fields.length <= 2) {
        let numerator = Number(fields[0]), denominator = Number(fields[1] ?? 1);
        if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator < 1) {
          throw new Error(`Invalid bitstream filter option: ${option}`);
        }
        let a = numerator, b = denominator;
        while (b) { const remainder = a % b; a = b; b = remainder; }
        numerator /= a; denominator /= a;
        if (numerator > 0x7fffffff || denominator > 0x7fffffff) throw new Error(`Invalid bitstream filter option: ${option}`);
        if (numerator) edits.rate = [numerator, denominator];
        else delete edits.rate;
      } else if (key === "num_ticks_per_picture" && fields.length === 1 && Number(value) <= 0x7fffffff) {
        if (Number(value)) edits.ticks = Number(value);
        else delete edits.ticks;
      } else throw new Error(`Unsupported bitstream filter option: ${option}`);
      continue;
    }
    let number = Number(value);
    let max = 255;
    if (key === "color_range") {
      if (value === "tv") number = 0;
      if (value === "pc") number = 1;
      max = 1;
    } else if (key === "chroma_sample_position") {
      if (value === "unknown") number = 0;
      if (value === "vertical") number = 1;
      if (value === "colocated") number = 2;
      max = 2;
    } else if (key !== "color_primaries" && key !== "transfer_characteristics" && key !== "matrix_coefficients") {
      throw new Error(`Unsupported AV1 bitstream filter option: ${option}`);
    }
    if (!value.trim() || !Number.isInteger(number) || number < -1 || number > max) {
      throw new Error(`Invalid AV1 bitstream filter option: ${option}`);
    }
    if (number >= 0) edits[key] = number;
    else delete edits[key];
  }
  return tracks.map(track => {
    if (track.type !== "video") return track;
    const codecDescriptions = track.codecDescriptions.map(description => {
      if (description.codecName !== "av1") throw new Error(`av1_metadata bitstream filter does not support codec ${description.codecName}`);
      const config = description.av1C?.rawBytes ?? description.extraData;
      if (!config || !Object.keys(edits).length) return description;
      if (config.length < 4 || config[0] !== 0x81) throw new Error("Invalid AV1 codec configuration");
      const header = new Uint8Array(config.subarray(0, 4));
      // av1C duplicates chroma position for non-monochrome 4:2:0 streams.
      if (edits.chroma_sample_position !== undefined && (header[2]! & 0x1c) === 0x0c) {
        header[2] = (header[2]! & 0xfc) | edits.chroma_sample_position;
      }
      const rawBytes = concatBytes([header, rewriteObus(config.subarray(4), edits, budget)]);
      const entry = description.rawStsdEntryBytes;
      const rawStsdEntryBytes = entry ? makeBox(decodeFourCC(entry, 4), concatBytes([
        entry.subarray(8, 86),
        ...parseMp4Boxes(entry.subarray(86)).map(box => box.type === "av1C"
          ? makeBox("av1C", rawBytes) : entry.subarray(86 + box.offset, 86 + box.offset + box.size))
      ])) : undefined;
      return { ...description, extraData: rawBytes, extradataSize: rawBytes.length, av1C: parseAv1C(rawBytes), rawStsdEntryBytes };
    });
    if (!Object.keys(edits).length) return track;
    return { ...track, codecDescriptions, samples: track.samples.map(sample => {
      const data = rewriteObus(sample.data, edits, budget);
      return { ...sample, data, size: data.length };
    }) };
  });
}

function rewriteObus(data: Uint8Array, edits: Av1Edits, budget: MediaBudgetTracker): Uint8Array {
  const parts: Uint8Array[] = [];
  let length = 0;
  for (let offset = 0; offset < data.length;) {
    budget.checkCpu();
    const start = offset;
    const header = data[offset++]!;
    if (header & 0x81) throw new Error("Invalid AV1 OBU header");
    if (header & 4) {
      if (offset >= data.length) throw new Error("Truncated AV1 OBU extension");
      if (data[offset++]! & 7) throw new Error("Invalid AV1 OBU extension");
    }
    const headerEnd = offset;
    let size = data.length - offset;
    if (header & 2) {
      size = 0;
      for (let byte = 0; ; byte++) {
        if (offset >= data.length || byte === 8) throw new Error("Invalid AV1 OBU size");
        const value = data[offset++]!;
        size += (value & 127) * 2 ** (7 * byte);
        if (size > 0xffffffff) throw new Error("Invalid AV1 OBU size");
        if (!(value & 128)) break;
      }
    }
    if (size > data.length - offset) throw new Error("Truncated AV1 OBU");
    const end = offset + size;
    if (((header >>> 3) & 15) === 1) {
      const payload = rewriteSequenceHeader(data.subarray(offset, end), edits, budget);
      const encodedSize: number[] = [];
      if (header & 2) {
        let remaining = payload.length;
        do {
          const byte = remaining & 127;
          remaining = Math.floor(remaining / 128);
          encodedSize.push(byte | (remaining ? 128 : 0));
        } while (remaining);
      }
      length += headerEnd - start + encodedSize.length + payload.length;
      parts.push(data.subarray(start, headerEnd), new Uint8Array(encodedSize), payload);
    } else {
      length += end - start;
      parts.push(data.subarray(start, end));
    }
    budget.checkOutputBytes(length);
    offset = end;
  }
  return concatBytes(parts);
}

function rewriteSequenceHeader(data: Uint8Array, edits: Av1Edits, budget: MediaBudgetTracker): Uint8Array {
  const bits = new BitReader(data);
  const read = (count: number): number => {
    if (bits.bitsRemaining < count) throw new Error("Truncated AV1 sequence header");
    return bits.readBits(count);
  };
  const profile = read(3);
  if (profile > 2) throw new Error("Invalid AV1 sequence profile");
  read(1); // still_picture
  const reduced = read(1);
  let timing = 0, units = 0, scale = 0, equal = 0, ticks = 0, timingEnd = 0;
  if (reduced) read(5); // seq_level_idx[0]
  else {
    let delayBits = 0;
    timing = read(1);
    timingEnd = bits.bitOffset;
    if (timing) {
      units = read(32); scale = read(32);
      equal = read(1);
      if (equal) {
        let zeros = 0;
        while (zeros < 32 && read(1) === 0) zeros++;
        if (zeros === 32) throw new Error("Invalid AV1 picture interval");
        ticks = 2 ** zeros - 1 + read(zeros);
      }
      timingEnd = bits.bitOffset;
      if (read(1)) { // decoder_model_info_present_flag
        delayBits = read(5) + 1;
        read(32); read(5); read(5);
      }
    }
    const initialDelay = read(1);
    const points = read(5) + 1;
    for (let i = 0; i < points; i++) {
      read(12);
      if (read(5) > 7) read(1);
      if (delayBits && read(1)) { read(delayBits); read(delayBits); read(1); }
      if (initialDelay && read(1)) read(4);
    }
  }
  const widthBits = read(4) + 1, heightBits = read(4) + 1;
  read(widthBits); read(heightBits);
  if (!reduced && read(1)) { read(4); read(3); }
  read(3); // superblock, filter intra, intra edge
  if (!reduced) {
    read(4); // interintra, masked compound, warped motion, dual filter
    const orderHint = read(1);
    if (orderHint) read(2);
    const screenContent = read(1) ? 2 : read(1);
    if (screenContent && !read(1)) read(1);
    if (orderHint) read(3);
  }
  read(3); // superres, cdef, restoration
  const highBitdepth = read(1);
  const depth = profile === 2 && highBitdepth ? (read(1) ? 12 : 10) : highBitdepth ? 10 : 8;
  const mono = profile === 1 ? 0 : read(1);
  const colorOffset = bits.bitOffset;
  const description = read(1);
  let primaries = description ? read(8) : 2;
  let transfer = description ? read(8) : 2;
  let matrix = description ? read(8) : 2;
  const rgb = primaries === 1 && transfer === 13 && matrix === 0;
  let range = 1, subX = 0, subY = 0, position = 0;
  if (mono || !rgb) {
    range = read(1);
    if (mono || profile === 0) subX = subY = 1;
    else if (profile === 2) {
      subX = depth === 12 ? read(1) : 1;
      subY = depth === 12 && subX ? read(1) : 0;
    }
    if (!mono && subX && subY) position = read(2);
  }
  const separateUv = mono ? 0 : read(1);
  const filmGrain = read(1);
  if (read(1) !== 1 || bits.bitsRemaining > 7) throw new Error("Invalid AV1 trailing bits");
  while (bits.bitsRemaining) {
    budget.checkCpu();
    if (read(1) !== 0) throw new Error("Invalid AV1 trailing bits");
  }

  primaries = edits.color_primaries ?? primaries;
  transfer = edits.transfer_characteristics ?? transfer;
  matrix = edits.matrix_coefficients ?? matrix;
  range = edits.color_range ?? range;
  position = edits.chroma_sample_position ?? position;
  const updatedRgb = primaries === 1 && transfer === 13 && matrix === 0;
  if (!mono && updatedRgb !== rgb && (subX || subY || profile === 0 || (profile === 2 && depth !== 12))) {
    throw new Error("AV1 color metadata cannot change coded chroma subsampling");
  }
  budget.checkOutputBytes(data.length + 17);
  const writer = new BitWriter();
  bits.bitOffset = 0;
  if (!reduced && (edits.rate || (timing && edits.ticks))) {
    writer.writeBits(read(5), 5);
    writer.writeBit(1);
    writer.writeBits(edits.rate?.[1] ?? units, 32);
    writer.writeBits(edits.rate?.[0] ?? scale, 32);
    writer.writeBit(edits.ticks ? 1 : equal);
    if (edits.ticks || equal) writer.writeUE(edits.ticks ? edits.ticks - 1 : ticks);
    if (!timing) writer.writeBit(0); // decoder_model_info_present_flag
    bits.bitOffset = timingEnd;
  }
  while (bits.bitOffset < colorOffset) writer.writeBit(bits.readBit());
  const hasDescription = description || edits.color_primaries !== undefined || edits.transfer_characteristics !== undefined || edits.matrix_coefficients !== undefined;
  writer.writeBit(hasDescription ? 1 : 0);
  if (hasDescription) { writer.writeBits(primaries, 8); writer.writeBits(transfer, 8); writer.writeBits(matrix, 8); }
  if (mono || !updatedRgb) {
    writer.writeBit(range);
    if (!mono && profile === 2 && depth === 12) {
      writer.writeBit(subX);
      if (subX) writer.writeBit(subY);
    }
    if (!mono && subX && subY) writer.writeBits(position, 2);
  }
  if (!mono) writer.writeBit(separateUv);
  writer.writeBit(filmGrain);
  writer.writeRbspTrailingBits();
  return writer.toUint8Array();
}
