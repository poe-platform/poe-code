import type { MediaTrack } from "@poe-code/mp4-ast";

/** Author the QuickTime timecode sample description and frame-number packet. */
export function authorTimecode(tracks: readonly MediaTrack[], globalTimecode: string | undefined): readonly MediaTrack[] {
  const generated: MediaTrack[] = [];
  let nextId = Math.max(0, ...tracks.map(track => track.id)) + 1;
  const output = tracks.map(track => {
    const value = track.metadata?.timecode ?? globalTimecode;
    if (track.type !== "video" || !value) return track;
    const fields = value.replace(";", ":").split(":");
    const [hours, minutes, seconds, frames] = fields.map(Number);
    const duration = track.samples[0]?.duration ?? 0;
    const rate = track.timescale / duration;
    const fps = Math.round(rate);
    const drop = value.includes(";");
    if (fields.length !== 4 || fields.some(field => !field.length || [...field].some(c => c < "0" || c > "9")) ||
        !Number.isFinite(rate) || fps < 1 || fps > 255 || minutes! > 59 || seconds! > 59 || frames! >= fps ||
        (drop && Math.abs(rate - (fps * 1000 / 1001)) > 0.01) || (drop && fps !== 30 && fps !== 60)) {
      throw new Error(`Invalid timecode ${value}`);
    }
    const totalMinutes = hours! * 60 + minutes!;
    const frameNumber = ((hours! * 3600 + minutes! * 60 + seconds!) * fps + frames!) -
      (drop ? (fps / 15) * (totalMinutes - Math.floor(totalMinutes / 10)) : 0);
    if (!Number.isSafeInteger(frameNumber) || frameNumber > 2147483647) throw new Error(`Invalid timecode ${value}`);
    const entry = new Uint8Array(36);
    const view = new DataView(entry.buffer);
    view.setUint32(0, entry.length);
    entry.set([116, 109, 99, 100], 4); // tmcd
    view.setUint16(14, 1); // data reference index
    view.setUint32(20, drop ? 1 : 0);
    view.setUint32(24, track.timescale);
    view.setUint32(28, duration);
    view.setUint8(32, fps);
    const data = new Uint8Array(4);
    new DataView(data.buffer).setInt32(0, frameNumber);
    const id = nextId++;
    generated.push({
      id, type: "data", handlerType: "tmcd", handlerName: "TimeCodeHandler",
      timescale: track.timescale, duration: track.duration, language: track.language, enabled: true,
      codecDescriptions: [{ formatFourCC: "tmcd", codecName: "unknown", rawStsdEntryBytes: entry }],
      samples: [{ data, size: 4, dts: 0, pts: 0, cts: 0, duration: track.duration, isKeyframe: true, sampleDescriptionIndex: 1 }]
    });
    return { ...track, timecodeTrackId: id };
  });
  const referenced = new Set(output.filter(track => track.type === "video").map(track => track.timecodeTrackId));
  const replaced = new Set(tracks.filter((track, index) => track.timecodeTrackId !== output[index]!.timecodeTrackId).map(track => track.timecodeTrackId));
  return [...output.filter(track => !replaced.has(track.id) || referenced.has(track.id)), ...generated];
}
