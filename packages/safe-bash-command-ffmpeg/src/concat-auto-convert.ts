import { concatBytes, type MediaTrack, type MediaBudgetTracker } from "@poe-code/mp4-ast";

/** Insert concat's H.264 parameter sets, retaining the AST's length-prefixed packets. */
export function autoConvertConcatTrack(track: MediaTrack, budget: MediaBudgetTracker): MediaTrack {
  if (!track.codecDescriptions.some(description => description.avcC)) return track;
  return { ...track, samples: track.samples.map(sample => {
    const config = track.codecDescriptions[sample.sampleDescriptionIndex - 1]?.avcC;
    if (!config) return sample;
    const lengthSize = config.lengthSizeMinusOne + 1;
    const parts: Uint8Array[] = [];
    let hasSps = false;
    let hasPps = false;
    let inserted = false;
    let bytes = sample.data.length;
    for (let offset = 0; offset < sample.data.length;) {
      budget.checkCpu();
      const start = offset;
      if (offset + lengthSize > sample.data.length) throw new Error("Truncated H.264 NAL length");
      let size = 0;
      for (let i = 0; i < lengthSize; i++) size = size * 256 + sample.data[offset++]!;
      if (!size || offset + size > sample.data.length) throw new Error("Invalid H.264 NAL length");
      const type = sample.data[offset]! & 31;
      hasSps ||= type === 7;
      hasPps ||= type === 8;
      if (type === 5 && !inserted) {
        for (const unit of [...(hasSps ? [] : config.sps), ...(hasPps ? [] : config.pps)]) {
          budget.checkCpu();
          if (unit.length >= 256 ** lengthSize) throw new Error("H.264 parameter set exceeds NAL length");
          bytes += lengthSize + unit.length;
          budget.checkOutputBytes(bytes);
          const prefix = new Uint8Array(lengthSize);
          let length = unit.length;
          for (let i = lengthSize - 1; i >= 0; i--) { prefix[i] = length & 255; length = Math.floor(length / 256); }
          parts.push(prefix, unit);
        }
        inserted = true;
      }
      offset += size;
      parts.push(sample.data.subarray(start, offset));
    }
    return bytes === sample.data.length ? sample : { ...sample, data: concatBytes(parts) };
  }) };
}
