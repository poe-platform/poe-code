import { BitReader, BitWriter, concatBytes, decodeFourCC, escapeRbsp, makeBox, parseHvcC, parseMp4Boxes, unescapeRbsp, type MediaBudgetTracker, type MediaTrack } from "@poe-code/mp4-ast";

export function setHevcMetadata(tracks: readonly MediaTrack[], filter: string, budget: MediaBudgetTracker): readonly MediaTrack[] {
  const crops = [-1, -1, -1, -1];
  if (filter !== "hevc_metadata") {
    for (const option of filter.slice("hevc_metadata=".length).split(":")) {
      const [key, value, extra] = option.split("=");
      const index = ["crop_left", "crop_right", "crop_top", "crop_bottom"].indexOf(key!);
      if (index < 0 || !value || extra !== undefined ||
          (value !== "-1" && [...value].some(char => char < "0" || char > "9")) || Number(value) > 2147483647) {
        throw new Error(`Invalid hevc_metadata option: ${option}`);
      }
      crops[index] = Number(value);
    }
  }
  return tracks.map(track => {
    if (track.type !== "video") return track;
    const codecDescriptions = track.codecDescriptions.map(description => {
      const config = description.hvcC;
      if (description.codecName !== "hevc" || !config) throw new Error("hevc_metadata requires HEVC packets with configuration");
      let offset = 23;
      const parts = [config.rawBytes.subarray(0, offset)];
      for (const array of config.naluArrays) {
        parts.push(config.rawBytes.subarray(offset, offset + 3));
        offset += 3;
        for (const nal of array.nalUnits) {
          budget.checkCpu();
          const updated = array.nalUnitType === 33 ? rewriteSps(nal, crops, budget) : nal;
          if (updated.length > 65535) throw new Error("HEVC SPS exceeds configuration length");
          parts.push(new Uint8Array([updated.length >>> 8, updated.length & 255]), updated);
          offset += 2 + nal.length;
        }
      }
      parts.push(config.rawBytes.subarray(offset));
      budget.checkOutputBytes(parts.reduce((sum, part) => sum + part.length, 0));
      const rawBytes = concatBytes(parts);
      const entry = description.rawStsdEntryBytes;
      const rawStsdEntryBytes = entry ? makeBox(decodeFourCC(entry, 4), concatBytes([
        entry.subarray(8, 86),
        ...parseMp4Boxes(entry.subarray(86)).map(box => box.type === "hvcC"
          ? makeBox("hvcC", rawBytes) : entry.subarray(86 + box.offset, 86 + box.offset + box.size))
      ])) : undefined;
      return { ...description, rawStsdEntryBytes, hvcC: parseHvcC(rawBytes) };
    });
    return { ...track, codecDescriptions, samples: track.samples.map(sample => {
      const config = track.codecDescriptions[sample.sampleDescriptionIndex - 1]?.hvcC;
      if (!config) throw new Error("Missing HEVC sample configuration");
      const lengthSize = config.lengthSizeMinusOne + 1;
      const units: Uint8Array[] = [];
      let changed = false;
      for (let offset = 0; offset < sample.data.length;) {
        budget.checkCpu();
        const start = offset;
        if (offset + lengthSize > sample.data.length) throw new Error("Truncated HEVC NAL length");
        let size = 0;
        for (let byte = 0; byte < lengthSize; byte++) size = size * 256 + sample.data[offset++]!;
        if (size < 2 || offset + size > sample.data.length) throw new Error("Invalid HEVC NAL length");
        const nal = sample.data.subarray(offset, offset + size);
        offset += size;
        const updated = ((nal[0]! >>> 1) & 63) === 33 ? rewriteSps(nal, crops, budget) : nal;
        if (updated === nal) units.push(sample.data.subarray(start, offset));
        else {
          changed = true;
          if (updated.length >= 256 ** lengthSize) throw new Error("HEVC SPS exceeds NAL length");
          const prefix = new Uint8Array(lengthSize);
          let length = updated.length;
          for (let i = lengthSize - 1; i >= 0; i--) { prefix[i] = length & 255; length = Math.floor(length / 256); }
          units.push(prefix, updated);
        }
      }
      if (!changed) return sample;
      budget.checkOutputBytes(units.reduce((sum, unit) => sum + unit.length, 0));
      const data = concatBytes(units);
      return { ...sample, data, size: data.length };
    }) };
  });
}

/** Replace only the conformance window; retain the coded raster and all later SPS syntax. */
function rewriteSps(nal: Uint8Array, crops: readonly number[], budget: MediaBudgetTracker): Uint8Array {
  budget.checkCpu();
  if (nal.length < 3 || ((nal[0]! >>> 1) & 63) !== 33) throw new Error("Invalid HEVC SPS");
  const rbsp = unescapeRbsp(nal);
  const bits = new BitReader(rbsp, 16);
  function read(count: number): number {
    if (bits.bitsRemaining < count) throw new Error("Truncated HEVC SPS");
    return bits.readBits(count);
  }
  function ue(): number {
    let zeros = 0;
    while (read(1) === 0) if (++zeros > 30) throw new Error("Invalid HEVC SPS integer");
    return 2 ** zeros - 1 + read(zeros);
  }
  read(4); // sps_video_parameter_set_id
  const layers = read(3);
  if (layers > 6) throw new Error("Invalid HEVC SPS sub-layer count");
  read(1); // sps_temporal_id_nesting_flag
  read(96); // general profile_tier_level
  const profiles: number[] = [], levels: number[] = [];
  for (let i = 0; i < layers; i++) { profiles.push(read(1)); levels.push(read(1)); }
  if (layers) read(2 * (8 - layers));
  for (let i = 0; i < layers; i++) { if (profiles[i]) read(88); if (levels[i]) read(8); }
  ue(); // sps_seq_parameter_set_id
  const chroma = ue();
  if (chroma > 3) throw new Error("Invalid HEVC SPS chroma format");
  if (chroma === 3) read(1); // separate_colour_plane_flag
  const width = ue(), height = ue();
  const cropOffset = bits.bitOffset;
  const present = read(1);
  const original = present ? [ue(), ue(), ue(), ue()] : [0, 0, 0, 0];
  const tailOffset = bits.bitOffset;
  const offsets = crops.map((crop, index) => {
    const unit = index < 2 ? (chroma === 1 || chroma === 2 ? 2 : 1) : (chroma === 1 ? 2 : 1);
    if (crop < 0) return original[index]!;
    if (crop % unit) throw new Error(`hevc_metadata: crop offset must be a multiple of ${unit}`);
    return crop / unit;
  });
  const unitX = chroma === 1 || chroma === 2 ? 2 : 1, unitY = chroma === 1 ? 2 : 1;
  if ((offsets[0]! + offsets[1]!) * unitX >= width || (offsets[2]! + offsets[3]!) * unitY >= height) {
    throw new Error("hevc_metadata: crop removes the entire picture");
  }
  if (offsets.every((value, index) => value === original[index])) return nal;
  let end = rbsp.length * 8;
  while (end > 0 && ((rbsp[(end - 1) >>> 3]! >>> (7 - ((end - 1) & 7))) & 1) === 0) { budget.checkCpu(); end--; }
  if (tailOffset >= end) throw new Error("Truncated HEVC SPS");
  const writer = new BitWriter();
  bits.bitOffset = 0;
  while (bits.bitOffset < cropOffset) { budget.checkCpu(); writer.writeBit(bits.readBit()); }
  const hasCrop = offsets.some(value => value !== 0);
  writer.writeBit(hasCrop ? 1 : 0);
  if (hasCrop) for (const value of offsets) writer.writeUE(value);
  bits.bitOffset = tailOffset;
  while (bits.bitOffset < end) { budget.checkCpu(); writer.writeBit(bits.readBit()); }
  return escapeRbsp(writer.toUint8Array());
}
