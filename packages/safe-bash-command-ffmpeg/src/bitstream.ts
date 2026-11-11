import { encodeH264UserData, appendH264UserData } from "./h264-sei.js";
import { setHevcMetadata } from "./hevc-metadata.js";
import { setVp9Metadata } from "./vp9-metadata.js";
import { setPacketTimestamps } from "./setts.js";
import { rechunkPcm } from "./pcm-rechunk.js";
import { parseFilterExpression } from "./filter-expression.js";
import { h264DisplayOrientation, removeH264DisplayOrientation, rewriteH264Sps } from "./h264-metadata.js";
import { setAv1Metadata } from "./av1-metadata.js";
import { parseAdtsStream, parseMp4Boxes, makeBox, decodeFourCC, parseAvcC, concatBytes, type MediaTrack, type MediaBudgetTracker } from "@poe-code/mp4-ast";

/** Apply packet filters in command-line order, preserving packet payloads unless explicitly changed. */
export function filterBitstream(tracks: readonly MediaTrack[], chain: string | undefined, budget: MediaBudgetTracker, type: "video" | "audio" | "subtitle" = "video", movieTimescale = 1000): readonly MediaTrack[] {
  if (chain === undefined) return tracks;
  const filters: string[] = [];
  let value = "";
  let quoted = false;
  for (let i = 0; i < chain.length; i++) {
    const char = chain[i]!;
    if (char === "'") quoted = !quoted;
    else if (!quoted && char === "\\" && i + 1 < chain.length) value += chain[++i]!;
    else if (!quoted && char === ",") { filters.push(value.trim()); value = ""; }
    else value += char;
  }
  if (quoted) throw new Error("Unterminated bitstream filter quote");
  filters.push(value.trim());
  for (const filter of filters) {
    if (filter === "null") continue;
    if (filter === "setts" || filter.startsWith("setts=")) {
      tracks = setPacketTimestamps(tracks, filter, type, budget, movieTimescale);
      continue;
    }
    if (filter.startsWith("noise=drop=")) {
      const expression = filter.slice("noise=drop=".length);
      parseFilterExpression(expression, "noise bitstream filter", { n: 0 });
      tracks = tracks.map(track => track.type !== type ? track : {
        ...track,
        samples: track.samples.filter((_, n) => {
          budget.checkCpu();
          const drop = parseFilterExpression(expression, "noise bitstream filter", { n });
          if (drop < 0) throw new Error("noise bitstream filter: probabilistic dropping is unsupported");
          return drop === 0;
        })
      });
      continue;
    }
    if (type === "subtitle") {
      if (filter !== "mov2textsub" && filter !== "text2movsub") {
        throw new Error(`Unsupported subtitle bitstream filter: ${filter}`);
      }
      tracks = tracks.map(track => track.type !== type ? track : {
        ...track,
        samples: track.samples.map(sample => {
          budget.checkCpu();
          if (filter === "mov2textsub") {
            if (sample.data.length < 2) throw new Error("mov2textsub: truncated text length");
            const length = sample.data[0]! * 256 + sample.data[1]!;
            return { ...sample, data: sample.data.subarray(2, 2 + length) };
          }
          if (sample.data.length > 65535) throw new Error("text2movsub: text exceeds 16-bit length");
          budget.checkOutputBytes(sample.data.length + 2);
          const data = new Uint8Array(sample.data.length + 2);
          data[0] = sample.data.length >>> 8;
          data[1] = sample.data.length & 255;
          data.set(sample.data, 2);
          return { ...sample, data };
        })
      });
      continue;
    }
    if (filter === "opus_metadata" || filter.startsWith("opus_metadata=")) {
      let gain = 0;
      if (filter !== "opus_metadata") {
        for (const option of filter.slice("opus_metadata=".length).split(":")) {
          const [key, value, extra] = option.split("=");
          const digits = value?.startsWith("-") || value?.startsWith("+") ? value.slice(1) : value;
          if (key !== "gain" || !digits || extra !== undefined || ![...digits].every(char => char >= "0" && char <= "9")) {
            throw new Error(`Invalid opus_metadata bitstream filter option: ${option}`);
          }
          gain = Number(value);
          if (!Number.isInteger(gain) || gain < -32768 || gain > 32767) throw new Error("opus_metadata gain must be between -32768 and 32767");
        }
      }
      tracks = tracks.map(track => track.type !== type ? track : {
        ...track,
        codecDescriptions: track.codecDescriptions.map(codec => {
          budget.checkCpu();
          if (codec.codecName !== "opus") throw new Error(`opus_metadata bitstream filter does not support codec ${codec.codecName}`);
          const head = codec.extraData;
          if (!head || head.length < 19 || new TextDecoder().decode(head.subarray(0, 8)) !== "OpusHead") throw new Error("opus_metadata: invalid OpusHead");
          budget.checkOutputBytes(head.length);
          const extraData = new Uint8Array(head);
          new DataView(extraData.buffer).setInt16(16, gain, true);
          return { ...codec, extraData };
        })
      });
      continue;
    }
    if (filter === "aac_adtstoasc") {
      for (const track of tracks) {
        if (track.type !== type) continue;
        for (const codec of track.codecDescriptions) {
          if (codec.codecName !== "aac") throw new Error(`aac_adtstoasc bitstream filter does not support codec ${codec.codecName}`);
        }
      }
      tracks = tracks.map(track => track.type !== type ? track : {
        ...track,
        samples: track.samples.map(sample => {
          budget.checkCpu();
          const data = sample.data;
          if (data.length < 7 || data[0] !== 0xff || (data[1]! & 0xf6) !== 0xf0) return sample;
          const frame = parseAdtsStream(data).frames[0];
          if (!frame) throw new Error("aac_adtstoasc: invalid ADTS packet");
          return { ...sample, data: frame, size: frame.length };
        })
      });
      continue;
    }
    if (filter === "chomp") {
      tracks = tracks.map(track => track.type !== type ? track : {
        ...track,
        samples: track.samples.map(sample => {
          budget.checkCpu();
          let end = sample.data.length;
          while (end > 0 && sample.data[end - 1] === 0) {
            budget.checkCpu();
            end--;
          }
          return end === sample.data.length ? sample : { ...sample, data: sample.data.subarray(0, end) };
        })
      });
      continue;
    }
    if (type === "audio" && (filter === "pcm_rechunk" || filter.startsWith("pcm_rechunk="))) {
      tracks = rechunkPcm(tracks, filter, budget);
      continue;
    }
    if (type !== "video") throw new Error(`Unsupported audio bitstream filter: ${filter}`);
    if (filter === "vp9_metadata" || filter.startsWith("vp9_metadata=")) {
      tracks = setVp9Metadata(tracks, filter, budget);
      continue;
    }
    if (filter === "av1_metadata" || filter.startsWith("av1_metadata=")) {
      tracks = setAv1Metadata(tracks, filter, budget);
      continue;
    }
    if (filter === "hevc_metadata" || filter.startsWith("hevc_metadata=")) {
      tracks = setHevcMetadata(tracks, filter, budget);
      continue;
    }
    if (filter === "h264_mp4toannexb") {
      tracks = tracks.map(track => {
        if (track.type !== "video") return track;
        return { ...track, codecDescriptions: track.codecDescriptions.map(description => {
          if (description.codecName !== "h264") throw new Error(`h264_mp4toannexb bitstream filter does not support codec ${description.codecName}`);
          // Container serializers convert the normalized length-prefixed samples.
          return { ...description, h264Framing: "annexb" as const };
        }) };
      });
      continue;
    }
    let insertAud = false;
    let userData: Uint8Array | undefined;
    let level: number | undefined;
    let primaries: number | undefined;
    let orientation = "pass";
    let rotate: number | undefined;
    let flip = 0;
    const metadata = filter.startsWith("h264_metadata=");
    if (metadata) {
      for (const option of filter.slice("h264_metadata=".length).split(":")) {
        const separator = option.indexOf("=");
        const key = option.slice(0, separator);
        const value = option.slice(separator + 1);
        if (separator < 0 || !value) throw new Error(`Invalid bitstream filter option: ${option}`);
        if (key === "sei_user_data") userData = encodeH264UserData(value, budget);
        else if (key === "aud" && value === "insert") insertAud = true;
        else if (key === "level" && ["1", "1.0", "1.1", "1.2", "1.3", "2", "2.0", "2.1", "2.2", "3", "3.0", "3.1", "3.2", "4", "4.0", "4.1", "4.2", "5", "5.0", "5.1", "5.2", "6", "6.0", "6.1", "6.2"].includes(value)) level = Math.round(Number(value) * 10);
        else if (key === "colour_primaries" && [...value].every(c => c >= "0" && c <= "9") && Number(value) <= 255) primaries = Number(value);
        else if (key === "display_orientation" && ["pass", "insert", "remove", "0", "1", "2"].includes(value)) {
          orientation = ["pass", "insert", "remove"][Number(value)] ?? value;
        } else if (key === "rotate" && value.trim() && Number.isFinite(Number(value)) && Math.abs(Number(value)) <= 360) rotate = Number(value);
        else if (key === "flip" && ["0", "1", "2", "3", "horizontal", "vertical", "horizontal+vertical", "vertical+horizontal"].includes(value)) {
          flip = value === "horizontal" ? 1 : value === "vertical" ? 2 : value.includes("+") ? 3 : Number(value);
        } else throw new Error(`Unsupported bitstream filter option: ${option}`);
      }
    }
    const remove = new Set<number>();
    if (!metadata) {
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
      const codecDescriptions = track.codecDescriptions.map(description => {
        const avcC = description.avcC;
        if (!avcC || (level === undefined && primaries === undefined)) return description;
        let offset = 6;
        const header = avcC.rawBytes.slice(0, 6);
        if (level !== undefined) header[3] = level;
        const parts: Uint8Array[] = [header];
        for (const sps of avcC.sps) {
          budget.checkCpu();
          offset += 2 + sps.length;
          const updated = rewriteH264Sps(sps, level, primaries, budget);
          if (updated.length > 65535) throw new Error("H.264 SPS exceeds configuration length");
          parts.push(new Uint8Array([updated.length >>> 8, updated.length & 255]), updated);
        }
        parts.push(avcC.rawBytes.subarray(offset));
        const rawBytes = concatBytes(parts);
        const entry = description.rawStsdEntryBytes;
        const rawStsdEntryBytes = entry ? makeBox(decodeFourCC(entry, 4), concatBytes([
          entry.subarray(8, 86),
          ...parseMp4Boxes(entry.subarray(86)).map(box => box.type === "avcC"
            ? makeBox("avcC", rawBytes) : entry.subarray(86 + box.offset, 86 + box.offset + box.size))
        ])) : undefined;
        return { ...description, rawStsdEntryBytes, ...(level === undefined ? {} : { level }), avcC: parseAvcC(rawBytes) };
      });
      const orientationNal = orientation === "insert" && (rotate !== undefined || flip !== 0)
        ? h264DisplayOrientation(rotate ?? 0, flip) : undefined;
      return { ...track, codecDescriptions, samples: track.samples.flatMap((sample, sampleIndex) => {
        const units: Uint8Array[] = [];
        let hasAud = false;
        let seekPoint = sampleIndex === 0 || sample.isKeyframe;
        for (let offset = 0; offset < sample.data.length;) {
          budget.checkCpu();
          const start = offset;
          if (offset + lengthSize > sample.data.length) throw new Error("Truncated H.264 NAL length");
          let size = 0;
          for (let byte = 0; byte < lengthSize; byte++) size = size * 256 + sample.data[offset++]!;
          if (!size || offset + size > sample.data.length) throw new Error("Invalid H.264 NAL length");
          const type = sample.data[offset]! & 31;
          hasAud ||= type === 9;
          seekPoint ||= type === 7;
          offset += size;
          if ((type === 7 && (level !== undefined || primaries !== undefined)) || (type === 6 && orientation !== "pass")) {
            const nal = sample.data.subarray(offset - size, offset);
            const updated = type === 7 ? rewriteH264Sps(nal, level, primaries, budget) : removeH264DisplayOrientation(nal, budget);
            if (!updated.length) continue;
            if (updated.length >= 256 ** lengthSize) throw new Error("H.264 NAL exceeds length field");
            const prefix = new Uint8Array(lengthSize);
            let length = updated.length;
            for (let i = lengthSize - 1; i >= 0; i--) { prefix[i] = length & 255; length = Math.floor(length / 256); }
            units.push(concatBytes([prefix, updated]));
          } else if (!remove.has(type)) units.push(sample.data.subarray(start, offset));
        }
        if (userData && seekPoint) {
          const seiIndex = units.findIndex(unit => (unit[lengthSize]! & 31) === 6);
          // Native inserts before non-IDR slices, or at the end for IDR access units.
          const sliceIndex = units.findIndex(unit => (unit[lengthSize]! & 31) < 5);
          const existing = seiIndex < 0 ? undefined : units[seiIndex]!.subarray(lengthSize);
          const sei = appendH264UserData(existing, userData, lengthSize, budget);
          if (seiIndex >= 0) units[seiIndex] = sei;
          else units.splice(sliceIndex < 0 ? units.length : sliceIndex, 0, sei);
        }
        if (orientationNal && seekPoint) {
          const prefix = new Uint8Array(lengthSize);
          prefix[lengthSize - 1] = orientationNal.length;
          const sliceIndex = units.findIndex(unit => (unit[lengthSize]! & 31) < 5);
          units.splice(sliceIndex < 0 ? units.length : sliceIndex, 0, concatBytes([prefix, orientationNal]));
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
