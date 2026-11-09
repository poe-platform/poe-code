import { decodeUtf8, encodeUtf8 } from "../binary.js";
import { buildProbeResultFromDoc } from "../mp4.js";
import type { MediaAstPlugin, MediaDocument, MediaSample } from "../types.js";

function readClock(clock: string): number | undefined {
  const fields = clock.trim().split(":");
  if (fields.length !== 4 || fields.some(field => !field || ![...field].every(char => char >= "0" && char <= "9"))) return undefined;
  const [hours, minutes, seconds, hundredths] = fields.map(Number);
  const time = ((hours! * 60 + minutes!) * 60 + seconds!) * 100 + hundredths!;
  return Number.isSafeInteger(time) ? time : undefined;
}

function readLine(line: string): { start: number; end: number; text: string } | undefined {
  const first = line.indexOf(",");
  const second = line.indexOf(",", first + 1);
  if (first < 0 || second < 0) return undefined;
  const start = readClock(line.slice(0, first));
  const end = readClock(line.slice(first + 1, second));
  if (start === undefined || end === undefined || end < start) return undefined;
  return { start, end, text: line.slice(second + 1).replaceAll("|", "\n") };
}

function parseStl(bytes: Uint8Array): MediaDocument {
  const timescale = 100;
  let duration = 0;
  const samples: MediaSample[] = [];
  for (const line of decodeUtf8(bytes).split("\n")) {
    const cue = readLine(line.endsWith("\r") ? line.slice(0, -1) : line);
    if (!cue) continue;
    const data = encodeUtf8(cue.text);
    samples.push({ pts: cue.start, dts: cue.start, cts: 0,
      duration: cue.end - cue.start, data, size: data.length, offset: 0,
      isKeyframe: true, sampleDescriptionIndex: 1 });
    duration = Math.max(duration, cue.end);
  }
  return { containerFormat: "stl", timescale, duration, durationSeconds: duration / timescale,
    tracks: [{ id: 1, type: "subtitle", handlerType: "sbtl", timescale, duration,
      language: "und", enabled: true, codecDescriptions: [{ formatFourCC: "text", codecName: "text" }], samples }],
    metadata: {}, byteLength: bytes.length };
}

export function stlAst(): MediaAstPlugin {
  return {
    id: "stl", formatName: "stl", formatLongName: "Spruce STL subtitle",
    extensions: [], mimeTypes: [], canDemux: true, canMux: false,
    supportedVideoCodecs: [], supportedAudioCodecs: [],
    detect() {
      return false;
    },
    parse: parseStl,
    serialize() {
      throw new Error("Spruce STL output is not supported");
    },
    probe(bytes, options) {
      return buildProbeResultFromDoc(parseStl(bytes), bytes.length, options?.filename ?? "input.txt", {
        ...options, formatName: "stl", formatLongName: "Spruce STL subtitle"
      });
    }
  };
}
