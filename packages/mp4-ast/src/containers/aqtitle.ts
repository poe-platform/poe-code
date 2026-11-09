import { decodeUtf8, encodeUtf8 } from "../binary.js";
import { buildProbeResultFromDoc } from "../mp4.js";
import type { MediaAstPlugin, MediaDocument, MediaSample, ParseMediaOptions } from "../types.js";

function readFrame(line: string): number | undefined {
  if (!line.startsWith("-->>")) return undefined;
  const value = line.slice(4).trim();
  if (!value || ![...value].every(char => char >= "0" && char <= "9")) return undefined;
  const frame = Number(value);
  return Number.isSafeInteger(frame) ? frame : undefined;
}

function parseAqtitle(bytes: Uint8Array, options?: ParseMediaOptions): MediaDocument {
  const timescale = options?.subtitleFrameRate ?? 25;
  if (!Number.isFinite(timescale) || timescale <= 0) throw new Error("Invalid subtitle frame rate");
  const samples: MediaSample[] = [];
  let start: number | undefined;
  let lines: string[] = [];
  const flush = (end: number) => {
    while (lines.at(-1) === "") lines.pop();
    if (start !== undefined && lines.length) {
      const data = encodeUtf8(lines.join("\n"));
      samples.push({ pts: start, dts: start, cts: 0, duration: Math.max(0, end - start),
        data, size: data.length, offset: 0, isKeyframe: true, sampleDescriptionIndex: 1 });
    }
    lines = [];
  };
  for (const raw of decodeUtf8(bytes).split("\n")) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    const frame = readFrame(line);
    if (frame !== undefined) {
      flush(frame);
      start = frame;
    } else if (start !== undefined) lines.push(line);
  }
  flush(start ?? 0);
  const duration = samples.reduce((end, sample) => Math.max(end, sample.pts + sample.duration), 0);
  return { containerFormat: "aqtitle", timescale, duration, durationSeconds: duration / timescale,
    tracks: [{ id: 1, type: "subtitle", handlerType: "sbtl", timescale, duration,
      language: "und", enabled: true, codecDescriptions: [{ formatFourCC: "text", codecName: "text" }], samples }],
    metadata: {}, byteLength: bytes.length };
}

export function aqtitleAst(): MediaAstPlugin {
  return {
    id: "aqtitle", formatName: "aqtitle", formatLongName: "AQTitle subtitles",
    extensions: ["aqt"], mimeTypes: [], canDemux: true, canMux: false,
    supportedVideoCodecs: [], supportedAudioCodecs: [],
    detect(bytes) {
      return readFrame(decodeUtf8(bytes.subarray(0, 4096)).split("\n")[0] ?? "") !== undefined;
    },
    parse: parseAqtitle,
    serialize() { throw new Error("AQTitle output is not supported"); },
    probe(bytes, options) {
      return buildProbeResultFromDoc(parseAqtitle(bytes), bytes.length, options?.filename ?? "input.aqt", {
        ...options, formatName: "aqtitle", formatLongName: "AQTitle subtitles"
      });
    }
  };
}
