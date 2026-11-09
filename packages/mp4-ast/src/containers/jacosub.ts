import { decodeUtf8, encodeUtf8 } from "../binary.js";
import { buildProbeResultFromDoc } from "../mp4.js";
import type { MediaAstPlugin, MediaDocument, MediaSample } from "../types.js";

function timestamp(value: string, rate: number): number | undefined {
  const parts = value.startsWith("@") ? [value.slice(1)] : value.split(":").flatMap(part => part.split("."));
  if (parts.length !== 1 && parts.length !== 4) return undefined;
  if (!parts.every(part => part.length > 0 && [...part].every(c => c >= "0" && c <= "9"))) return undefined;
  const ticks = parts.length === 1 ? Number(parts[0])
    : ((Number(parts[0]) * 60 + Number(parts[1])) * 60 + Number(parts[2])) * rate + Number(parts[3]);
  return Number.isSafeInteger(ticks) ? ticks : undefined;
}

function readCue(line: string, rate: number): { start: number; end: number; text: string } | undefined {
  const words = line.replaceAll("\t", " ").trim().split(" ").filter(Boolean);
  if (words.length < 3 || (!words[0]!.startsWith("@") && !words[0]!.includes(":"))) return undefined;
  const start = timestamp(words[0]!, rate);
  const end = timestamp(words[1]!, rate);
  if (start === undefined || end === undefined || end < start) return undefined;
  return { start, end, text: words.slice(2).join(" ") };
}

function parseJacosub(bytes: Uint8Array): MediaDocument {
  let rate = 30;
  let shift = 0;
  let duration = 0;
  const timescale = 1000;
  const samples: MediaSample[] = [];
  for (const raw of decodeUtf8(bytes).split("\n")) {
    const line = raw.trim();
    if (line.startsWith("#T")) {
      const value = Number(line.slice(line.startsWith("#TIMERES") ? 8 : 2).trim());
      if (!Number.isSafeInteger(value) || value <= 0) throw new Error("Invalid JACOsub tick rate");
      rate = value;
      continue;
    }
    if (line.startsWith("#S")) {
      const value = line.slice(line.startsWith("#SHIFT") ? 6 : 2).trim();
      const ticks = timestamp(value.startsWith("-") || value.startsWith("+") ? value.slice(1) : value, rate);
      if (ticks === undefined) throw new Error("Invalid JACOsub shift");
      shift = ticks * (value.startsWith("-") ? -1 : 1);
      continue;
    }
    const cue = readCue(line, rate);
    if (!cue) continue;
    const pts = Math.round((cue.start + shift) * timescale / rate);
    const end = Math.round((cue.end + shift) * timescale / rate);
    const data = encodeUtf8(cue.text);
    samples.push({ pts, dts: pts, cts: 0, duration: end - pts,
      data, size: data.length, offset: 0, isKeyframe: true, sampleDescriptionIndex: 1 });
    duration = Math.max(duration, end);
  }
  return { containerFormat: "jacosub", timescale, duration, durationSeconds: duration / timescale,
    tracks: [{ id: 1, type: "subtitle", handlerType: "sbtl", timescale, duration,
      language: "und", enabled: true, codecDescriptions: [{ formatFourCC: "text", codecName: "jacosub" }], samples }],
    metadata: {}, byteLength: bytes.length };
}

export function jacosubAst(): MediaAstPlugin {
  return {
    id: "jacosub", formatName: "jacosub", formatLongName: "JACOsub subtitle",
    extensions: ["jss"], mimeTypes: [], canDemux: true, canMux: false,
    supportedVideoCodecs: [], supportedAudioCodecs: [],
    detect(bytes) {
      return decodeUtf8(bytes.subarray(0, 4096)).split("\n").some(line => readCue(line, 30) !== undefined);
    },
    parse: parseJacosub,
    serialize() { throw new Error("JACOsub output is not supported"); },
    probe(bytes, options) {
      return buildProbeResultFromDoc(parseJacosub(bytes), bytes.length, options?.filename ?? "input.jss", {
        ...options, formatName: "jacosub", formatLongName: "JACOsub subtitle"
      });
    }
  };
}
