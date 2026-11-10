import { decodeUtf8, encodeUtf8 } from "../binary.js";
import { buildProbeResultFromDoc, concatMp4, sliceMp4 } from "../mp4.js";
import type { MediaAstPlugin, MediaDocument, MediaSample } from "../types.js";

function readLine(line: string): { start: number; end: number; text: string } | undefined {
  if (!line.startsWith("{")) return undefined;
  const first = line.indexOf("}");
  if (first < 2 || line[first + 1] !== "{") return undefined;
  const second = line.indexOf("}", first + 2);
  if (second < first + 3) return undefined;
  const startText = line.slice(1, first);
  const endText = line.slice(first + 2, second);
  if (![...startText, ...endText].every(c => c >= "0" && c <= "9")) return undefined;
  const start = Number(startText);
  const end = Number(endText);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start) return undefined;
  return { start, end, text: line.slice(second + 1) };
}

function parseMicrodvd(bytes: Uint8Array): MediaDocument {
  let timescale = 24000 / 1001;
  let duration = 0;
  const samples: MediaSample[] = [];
  for (const line of decodeUtf8(bytes).split("\n")) {
    const cue = readLine(line.endsWith("\r") ? line.slice(0, -1) : line);
    if (!cue) continue;
    if (samples.length === 0 && cue.start === cue.end && (cue.start === 0 || cue.start === 1)) {
      const rate = Number(cue.text);
      if (Number.isFinite(rate) && rate > 0) {
        timescale = rate;
        continue;
      }
    }
    const data = encodeUtf8(cue.text);
    samples.push({ pts: cue.start, dts: cue.start, cts: 0,
      duration: cue.end - cue.start, data, size: data.length, offset: 0,
      isKeyframe: true, sampleDescriptionIndex: 1 });
    duration = Math.max(duration, cue.end);
  }
  samples.sort((a, b) => a.pts - b.pts);
  return { containerFormat: "microdvd", timescale, duration, durationSeconds: duration / timescale,
    tracks: [{ id: 1, type: "subtitle", handlerType: "sbtl", timescale, duration,
      language: "und", enabled: true, codecDescriptions: [{ formatFourCC: "text", codecName: "microdvd" }], samples }],
    metadata: {}, byteLength: bytes.length };
}

export function microdvdAst(): MediaAstPlugin {
  return {
    id: "microdvd", formatName: "microdvd", formatLongName: "MicroDVD subtitle",
    extensions: ["sub"], mimeTypes: ["text/x-microdvd"], canDemux: true, canMux: true,
    supportedVideoCodecs: [], supportedAudioCodecs: [],
    detect(bytes) {
      return readLine(decodeUtf8(bytes.subarray(0, 4096)).split("\n")[0] ?? "") !== undefined;
    },
    parse: parseMicrodvd,
    serialize(doc) {
      const track = doc.tracks.find(t => t.type === "subtitle");
      if (track?.codecDescriptions.some(c => c.codecName !== "microdvd")) {
        throw new Error("MicroDVD output requires MicroDVD stream copy");
      }
      return encodeUtf8((track?.samples ?? []).map(s =>
        `{${Math.round(s.pts)}}{${Math.round(s.pts + s.duration)}}${decodeUtf8(s.data)}\n`).join(""));
    },
    probe(bytes, options) {
      return buildProbeResultFromDoc(parseMicrodvd(bytes), bytes.length, options?.filename ?? "input.sub", {
        ...options, formatName: "microdvd", formatLongName: "MicroDVD subtitle"
      });
    },
    concat: concatMp4,
    slice: sliceMp4
  };
}
