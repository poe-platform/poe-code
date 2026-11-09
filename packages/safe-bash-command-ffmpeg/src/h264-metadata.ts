import { BitReader, BitWriter, concatBytes, escapeRbsp, unescapeRbsp, type MediaBudgetTracker } from "@poe-code/mp4-ast";

/** Patch SPS syntax while preserving unrelated VUI fields and encoded picture data. */
export function rewriteH264Sps(nal: Uint8Array, level: number | undefined, primaries: number | undefined, budget: MediaBudgetTracker): Uint8Array {
  const rbsp = unescapeRbsp(nal);
  if (rbsp.length < 5 || (rbsp[0]! & 31) !== 7) throw new Error("Invalid H.264 SPS");
  if (level !== undefined) rbsp[3] = level;
  if (primaries === undefined) return escapeRbsp(rbsp);
  const bits = new BitReader(rbsp, 32);
  bits.readUE(); // seq_parameter_set_id
  if ([100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135].includes(rbsp[1]!)) {
    const chroma = bits.readUE();
    if (chroma === 3) bits.readBit();
    bits.readUE(); // bit_depth_luma_minus8
    bits.readUE(); // bit_depth_chroma_minus8
    bits.readBit();
    if (bits.readBit()) {
      for (let i = 0; i < (chroma === 3 ? 12 : 8); i++) {
        if (!bits.readBit()) continue;
        let last = 8, next = 8;
        for (let j = 0; j < (i < 6 ? 16 : 64); j++) {
          if (next !== 0) next = (last + bits.readSE() + 256) % 256;
          last = next === 0 ? last : next;
        }
      }
    }
  }
  bits.readUE(); // log2_max_frame_num_minus4
  const order = bits.readUE();
  if (order === 0) bits.readUE();
  else if (order === 1) {
    bits.readBit(); bits.readSE(); bits.readSE();
    const count = bits.readUE();
    if (count < 0 || count > 255) throw new Error("Invalid H.264 picture order cycle");
    for (let i = 0; i < count; i++) bits.readSE();
  }
  bits.readUE(); bits.readBit(); // max_num_ref_frames, gaps flag
  bits.readUE(); bits.readUE(); // dimensions
  if (!bits.readBit()) bits.readBit(); // frame_mbs_only, adaptive frame field
  bits.readBit(); // direct_8x8_inference_flag
  if (bits.readBit()) { bits.readUE(); bits.readUE(); bits.readUE(); bits.readUE(); }
  const vuiOffset = bits.bitOffset;
  const vui = bits.readBit();
  if (vui) {
    if (bits.readBit() && bits.readBits(8) === 255) bits.readBits(32);
    if (bits.readBit()) bits.readBit(); // overscan
  }
  const signalOffset = bits.bitOffset;
  let format = 5, fullRange = 0, transfer = 2, matrix = 2;
  if (vui && bits.readBit()) {
    format = bits.readBits(3);
    fullRange = bits.readBit();
    if (bits.readBit()) {
      bits.readBits(8); // previous primaries
      transfer = bits.readBits(8);
      matrix = bits.readBits(8);
    }
  }
  const tailOffset = bits.bitOffset;
  let end = rbsp.length * 8;
  while (end > 0 && ((rbsp[(end - 1) >>> 3]! >>> (7 - ((end - 1) & 7))) & 1) === 0) end--;
  if (tailOffset >= end) throw new Error("Truncated H.264 SPS");
  const writer = new BitWriter();
  bits.bitOffset = 0;
  while (bits.bitOffset < vuiOffset) writer.writeBit(bits.readBit());
  writer.writeBit(1);
  if (vui) {
    bits.bitOffset = vuiOffset + 1;
    while (bits.bitOffset < signalOffset) writer.writeBit(bits.readBit());
  } else writer.writeBits(0, 2); // absent aspect ratio and overscan
  writer.writeBit(1); // video_signal_type_present_flag
  writer.writeBits(format, 3);
  writer.writeBit(fullRange);
  writer.writeBit(1); // colour_description_present_flag
  writer.writeBits(primaries, 8);
  writer.writeBits(transfer, 8);
  writer.writeBits(matrix, 8);
  if (vui) {
    bits.bitOffset = tailOffset;
    while (bits.bitOffset < end) { budget.checkCpu(); writer.writeBit(bits.readBit()); }
  } else {
    writer.writeBits(0, 6); // chroma location, timing, NAL/VCL HRD, pic_struct, restriction
    writer.writeRbspTrailingBits();
  }
  return escapeRbsp(writer.toUint8Array());
}

/** Display-orientation SEI, with the one-picture repetition used by FFmpeg. */
export function h264DisplayOrientation(rotate: number, flip: number): Uint8Array {
  const turns = (rotate < 0 ? rotate + 360 : rotate) * 65536 / 360;
  const floor = Math.floor(turns);
  const rotation = turns - floor === 0.5 ? floor + (floor & 1) : Math.round(turns);
  const bits = new BitWriter();
  bits.writeBit(0); // display_orientation_cancel_flag
  bits.writeBit(flip & 1);
  bits.writeBit((flip >>> 1) & 1);
  bits.writeBits(rotation & 65535, 16);
  bits.writeUE(1); // display_orientation_repetition_period
  bits.writeBit(0); // display_orientation_extension_flag
  bits.writeRbspTrailingBits(); // SEI payload alignment
  return escapeRbsp(concatBytes([Uint8Array.of(6, 47, 3), bits.toUint8Array(), Uint8Array.of(128)]));
}

/** Remove only orientation payloads; retain other messages in the same NAL. */
export function removeH264DisplayOrientation(nal: Uint8Array, budget: MediaBudgetTracker): Uint8Array {
  const rbsp = unescapeRbsp(nal);
  const parts: Uint8Array[] = [rbsp.subarray(0, 1)];
  let removed = false;
  let offset = 1;
  const field = () => {
    let value = 0;
    let byte: number;
    do {
      budget.checkCpu();
      if (offset >= rbsp.length - 1) throw new Error("Truncated H.264 SEI header");
      byte = rbsp[offset++]!;
      value += byte;
    } while (byte === 255);
    return value;
  };
  while (offset < rbsp.length - 1) {
    budget.checkCpu();
    const start = offset;
    const type = field();
    const size = field();
    if (size > rbsp.length - 1 - offset) throw new Error("Truncated H.264 SEI payload");
    offset += size;
    if (type === 47) removed = true;
    else parts.push(rbsp.subarray(start, offset));
  }
  if (rbsp[offset] !== 128) throw new Error("Invalid H.264 SEI trailing bits");
  if (!removed) return nal;
  if (parts.length === 1) return new Uint8Array();
  parts.push(Uint8Array.of(128));
  return escapeRbsp(concatBytes(parts));
}
