import { BitReader, type MediaBudgetTracker, type MediaTrack } from "@poe-code/mp4-ast";

export function setVp9Metadata(tracks: readonly MediaTrack[], filter: string, budget: MediaBudgetTracker): readonly MediaTrack[] {
  let colorSpace = -1;
  let colorRange = -1;
  if (filter !== "vp9_metadata") {
    for (const option of filter.slice("vp9_metadata=".length).split(":")) {
      const [key, value, extra] = option.split("=");
      const names = key === "color_space" ? ["unknown", "bt601", "bt709", "smpte170", "smpte240", "bt2020", undefined, "rgb"]
        : key === "color_range" ? ["tv", "pc"] : [];
      if (!value || extra !== undefined || !names.length) throw new Error(`Invalid bitstream filter option: ${option}`);
      const named = names.indexOf(value);
      const number = named >= 0 ? named : value === "-1" ? -1
        : value.length === 1 && value >= "0" && value <= "9" ? Number(value) : NaN;
      if (!Number.isInteger(number) || number >= names.length) throw new Error(`Invalid bitstream filter option: ${option}`);
      if (key === "color_space") colorSpace = number;
      else colorRange = number;
    }
  }
  return tracks.map(track => {
    if (track.type !== "video") return track;
    if (track.codecDescriptions.some(codec => codec.codecName !== "vp9")) throw new Error("vp9_metadata bitstream filter requires VP9 packets");
    return { ...track, samples: track.samples.map(sample => {
      budget.checkCpu();
      return { ...sample, data: rewritePacket(sample.data, colorSpace, colorRange, budget) };
    }) };
  });
}

function rewritePacket(data: Uint8Array, colorSpace: number, colorRange: number, budget: MediaBudgetTracker): Uint8Array {
  let output = data;
  const marker = data[data.length - 1] ?? 0;
  if ((marker & 0xe0) === 0xc0) {
    const count = (marker & 7) + 1;
    const magnitude = ((marker >> 3) & 3) + 1;
    const indexStart = data.length - 2 - count * magnitude;
    if (indexStart < 0 || data[indexStart] !== marker) throw new Error("vp9_metadata: invalid superframe index");
    let index = indexStart + 1;
    let offset = 0;
    for (let frame = 0; frame < count; frame++) {
      let size = 0;
      for (let byte = 0; byte < magnitude; byte++) size += data[index++]! * 256 ** byte;
      if (!size || offset + size > indexStart) throw new Error("vp9_metadata: invalid superframe size");
      editFrame(offset, size);
      offset += size;
    }
    if (offset !== indexStart) throw new Error("vp9_metadata: invalid superframe payload length");
  } else editFrame(0, data.length);
  return output;

  function editFrame(start: number, size: number): void {
    budget.checkCpu();
    const bits = new BitReader(data.subarray(start, start + size));
    function read(width: number): number {
      if (bits.bitsRemaining < width) throw new Error("vp9_metadata: truncated frame header");
      return bits.readBits(width);
    }
    if (read(2) !== 2) throw new Error("vp9_metadata: invalid frame marker");
    const profile = read(1) | (read(1) << 1);
    if (profile === 3 && read(1) !== 0) throw new Error("vp9_metadata: invalid reserved profile bit");
    if (read(1)) { read(3); return; } // show_existing_frame has no color configuration.
    const inter = read(1);
    const show = read(1);
    const errorResilient = read(1);
    if (inter) {
      if (show) return;
      const intraOnly = read(1);
      if (!errorResilient) read(2); // reset_frame_context
      if (!intraOnly) return;
    }
    if (read(24) !== 0x498342) throw new Error("vp9_metadata: invalid frame sync code");
    if (inter && profile === 0) return; // Profile 0 intra-only frames imply BT.601 limited range.
    if (profile >= 2) read(1); // ten_or_twelve_bit
    const colorOffset = bits.bitOffset;
    const originalSpace = read(3);
    const originalRange = originalSpace === 7 ? 1 : read(1);
    if (profile & 1) {
      if (originalSpace !== 7) read(2); // chroma subsampling
      if (read(1) !== 0) throw new Error("vp9_metadata: invalid reserved color bit");
    }
    // Like native FFmpeg, ignore RGB requests for the 4:2:0-only profiles.
    const space = colorSpace < 0 || (colorSpace === 7 && !(profile & 1)) ? originalSpace : colorSpace;
    const range = space === 7 ? 1 : colorRange < 0 ? originalRange : colorRange;
    // Switching RGB syntax adds/removes fields and needs a full uncompressed-header rewrite.
    if ((space === 7) !== (originalSpace === 7)) throw new Error("vp9_metadata: RGB color-space transitions are unsupported");
    if (space === originalSpace && range === originalRange) return;
    if (output === data) {
      budget.checkOutputBytes(data.length);
      budget.allocateMemory(data.length);
      output = new Uint8Array(data);
    }
    const value = (space << 1) | range;
    for (let bit = 0; bit < 4; bit++) {
      const offset = start * 8 + colorOffset + bit;
      const mask = 1 << (7 - (offset & 7));
      output[offset >>> 3] = (output[offset >>> 3]! & ~mask) | (((value >> (3 - bit)) & 1) ? mask : 0);
    }
  }
}
