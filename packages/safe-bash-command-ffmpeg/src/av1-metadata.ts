import { BitReader, BitWriter, concatBytes, parseAv1C, parseMp4Boxes, makeBox, decodeFourCC, type MediaTrack, type MediaBudgetTracker } from "@poe-code/mp4-ast";

/** Edit sequence-header timing without changing packet timestamps or coded frames. */
export function setAv1Timing(tracks: readonly MediaTrack[], filter: string, budget: MediaBudgetTracker): readonly MediaTrack[] {
  let rate: number[] | undefined;
  let ticks = 0;
  for (const option of filter.slice("av1_metadata".length + 1).split(":")) {
    if (!option && filter === "av1_metadata") continue;
    const [key, value, extra] = option.split("=");
    if (!value || extra !== undefined) throw new Error(`Invalid bitstream filter option: ${option}`);
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
      rate = numerator ? [numerator, denominator] : undefined;
    } else if (key === "num_ticks_per_picture" && fields.length === 1 && Number(value) <= 0x7fffffff) {
      ticks = Number(value);
    } else throw new Error(`Unsupported bitstream filter option: ${option}`);
  }

  function rewriteSequence(payload: Uint8Array): Uint8Array {
    if (payload.length < 2) throw new Error("Truncated AV1 sequence header");
    if (payload[0]! & 8) return payload; // reduced_still_picture_header has no timing info
    const bits = new BitReader(payload, 5);
    const present = bits.readBit();
    let units = 0, scale = 0, equal = 0, previousTicks = 0;
    if (present) {
      if (bits.bitsRemaining < 65) throw new Error("Truncated AV1 timing info");
      units = bits.readBits(32);
      scale = bits.readBits(32);
      equal = bits.readBit();
      if (equal) {
        let zeros = 0;
        while (bits.bitsRemaining && bits.readBit() === 0) {
          if (++zeros > 31) throw new Error("Invalid AV1 picture interval");
        }
        if (bits.bitsRemaining < zeros) throw new Error("Truncated AV1 picture interval");
        previousTicks = 2 ** zeros - 1 + bits.readBits(zeros);
      }
    }
    if (!present && !rate) return payload;
    const tailOffset = bits.bitOffset;
    let end = payload.length * 8;
    while (end > 0 && ((payload[(end - 1) >>> 3]! >>> (7 - ((end - 1) & 7))) & 1) === 0) end--;
    if (tailOffset >= end) throw new Error("Truncated AV1 sequence header");
    const writer = new BitWriter();
    writer.writeBits(payload[0]! >>> 3, 5);
    writer.writeBit(1);
    writer.writeBits(rate?.[1] ?? units, 32);
    writer.writeBits(rate?.[0] ?? scale, 32);
    writer.writeBit(ticks ? 1 : equal);
    if (ticks || equal) writer.writeUE(ticks ? ticks - 1 : previousTicks);
    if (!present) writer.writeBit(0); // decoder_model_info_present_flag
    // Copy through trailing_one_bit, then let the writer rebuild byte padding.
    while (bits.bitOffset < end) { budget.checkCpu(); writer.writeBit(bits.readBit()); }
    return writer.toUint8Array();
  }

  function rewriteObus(data: Uint8Array): Uint8Array {
    const parts: Uint8Array[] = [];
    for (let offset = 0; offset < data.length;) {
      budget.checkCpu();
      const start = offset;
      const header = data[offset++]!;
      if (header & 0x81) throw new Error("Invalid AV1 OBU header");
      if (header & 4) offset++;
      if (offset > data.length) throw new Error("Truncated AV1 OBU extension");
      const headerEnd = offset;
      let size = data.length - offset;
      if (header & 2) {
        size = 0;
        for (let i = 0; ; i++) {
          if (i === 8 || offset >= data.length) throw new Error("Invalid AV1 OBU size");
          const byte = data[offset++]!;
          size += (byte & 127) * 2 ** (7 * i);
          if (!(byte & 128)) break;
        }
      }
      if (!Number.isSafeInteger(size) || size > data.length - offset) throw new Error("Truncated AV1 OBU");
      const end = offset + size;
      if (((header >>> 3) & 15) === 1) {
        const payload = rewriteSequence(data.subarray(offset, end));
        parts.push(data.subarray(start, headerEnd));
        if (header & 2) {
          const length: number[] = [];
          let remaining = payload.length;
          do { length.push((remaining % 128) | (remaining >= 128 ? 128 : 0)); remaining = Math.floor(remaining / 128); } while (remaining);
          parts.push(new Uint8Array(length));
        }
        parts.push(payload);
      } else parts.push(data.subarray(start, end));
      offset = end;
    }
    budget.checkOutputBytes(parts.reduce((total, part) => total + part.length, 0));
    return concatBytes(parts);
  }

  return tracks.map(track => {
    if (track.type !== "video") return track;
    const codecDescriptions = track.codecDescriptions.map(description => {
      if (description.codecName !== "av1") throw new Error(`av1_metadata bitstream filter does not support codec ${description.codecName}`);
      const config = description.av1C?.rawBytes ?? description.extraData;
      if (!config?.length) return description;
      if (config.length < 4) throw new Error("Truncated AV1 configuration");
      const rawBytes = concatBytes([config.subarray(0, 4), rewriteObus(config.subarray(4))]);
      const entry = description.rawStsdEntryBytes;
      const rawStsdEntryBytes = entry ? makeBox(decodeFourCC(entry, 4), concatBytes([
        entry.subarray(8, 86),
        ...parseMp4Boxes(entry.subarray(86)).map(box => box.type === "av1C"
          ? makeBox("av1C", rawBytes) : entry.subarray(86 + box.offset, 86 + box.offset + box.size))
      ])) : undefined;
      return { ...description, rawStsdEntryBytes, extraData: rawBytes, av1C: parseAv1C(rawBytes) };
    });
    return { ...track, codecDescriptions, samples: track.samples.map(sample => {
      const data = rewriteObus(sample.data);
      return { ...sample, data, size: data.length };
    }) };
  });
}
