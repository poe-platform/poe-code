import { concatBytes, type MediaTrack, type MediaBudgetTracker } from "@poe-code/mp4-ast";

/** Apply packet filters in command-line order, preserving packet timing. */
export function filterVideoBitstream(tracks: readonly MediaTrack[], chain: string | undefined, budget: MediaBudgetTracker): readonly MediaTrack[] {
  if (chain === undefined) return tracks;
  for (const filter of chain.split(",")) {
    if (filter === "null") continue;
    const insertAud = filter === "h264_metadata=aud=insert";
    const remove = new Set<number>();
    if (!insertAud) {
      const prefix = "filter_units=remove_types=";
      if (!filter.startsWith(prefix)) throw new Error(`Unsupported video bitstream filter: ${filter}`);
      for (const range of filter.slice(prefix.length).split("|")) {
        const fields = range.split("-");
        const first = Number(fields[0]);
        const last = Number(fields[1] ?? fields[0]);
        if (fields.length > 2 || fields.some(field => !field.length || [...field].some(c => c < "0" || c > "9")) ||
            first < 0 || last > 31 || first > last) throw new Error("filter_units: invalid H.264 NAL type range");
        for (let type = first; type <= last; type++) remove.add(type);
      }
    }
    tracks = tracks.map(track => {
      if (track.type !== "video") return track;
      const config = track.codecDescriptions[0]?.avcC;
      if (!config) throw new Error("Video bitstream filter requires H.264 packets");
      const lengthSize = config.lengthSizeMinusOne + 1;
      return { ...track, samples: track.samples.flatMap(sample => {
        const units: Uint8Array[] = [];
        let hasAud = false;
        for (let offset = 0; offset < sample.data.length;) {
          budget.checkCpu();
          const start = offset;
          if (offset + lengthSize > sample.data.length) throw new Error("Truncated H.264 NAL length");
          let size = 0;
          for (let byte = 0; byte < lengthSize; byte++) size = size * 256 + sample.data[offset++]!;
          if (!size || offset + size > sample.data.length) throw new Error("Invalid H.264 NAL length");
          const type = sample.data[offset]! & 31;
          hasAud ||= type === 9;
          offset += size;
          if (!remove.has(type)) units.push(sample.data.subarray(start, offset));
        }
        if (insertAud && !hasAud) {
          const aud = new Uint8Array(lengthSize + 2);
          aud[lengthSize - 1] = 2;
          aud[lengthSize] = 9;
          aud[lengthSize + 1] = 240;
          units.unshift(aud);
        }
        if (!units.length) return [];
        budget.checkOutputBytes(units.reduce((total, unit) => total + unit.length, 0));
        return [{ ...sample, data: concatBytes(units) }];
      }) };
    });
  }
  return tracks;
}
