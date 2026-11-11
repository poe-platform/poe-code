import { decodeUtf8, encodeUtf8 } from "../binary.js";
import { buildProbeResultFromDoc } from "../mp4.js";
import type { MediaAstPlugin, MediaDocument, MediaSample } from "../types.js";

function readLine(line: string): { start: number; end: number; text: string } | undefined {
  const first = line.indexOf(",");
  const second = line.indexOf(",", first + 1);
  if (first < 1 || second < first + 2) return undefined;
  const startText = line.slice(0, first).trim();
  const endText = line.slice(first + 1, second).trim();
  const quoted = line.slice(second + 1).trim();
  if (!startText || !endText || quoted.length < 2 || !quoted.startsWith('"') || !quoted.endsWith('"')) return undefined;
  if (![...startText, ...endText].every(c => c >= "0" && c <= "9")) return undefined;
  const start = Number(startText);
  const end = Number(endText);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start) return undefined;
  return { start, end, text: quoted.slice(1, -1) };
}

function parsePjs(bytes: Uint8Array): MediaDocument {
  const timescale = 10;
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
  samples.sort((a, b) => a.pts - b.pts);
  return { containerFormat: "pjs", timescale, duration, durationSeconds: duration / timescale,
    tracks: [{ id: 1, type: "subtitle", handlerType: "sbtl", timescale, duration,
      language: "und", enabled: true, codecDescriptions: [{ formatFourCC: "text", codecName: "pjs" }], samples }],
    metadata: {}, byteLength: bytes.length };
}

export function pjsAst(): MediaAstPlugin {
  return {
    id: "pjs", formatName: "pjs", formatLongName: "PJS subtitle",
    extensions: ["pjs"], mimeTypes: [], canDemux: true, canMux: false,
    supportedVideoCodecs: [], supportedAudioCodecs: [],
    detect(bytes) {
      return readLine(decodeUtf8(bytes.subarray(0, 4096)).split("\n")[0] ?? "") !== undefined;
    },
    parse: parsePjs,
    serialize() {
      throw new Error("PJS output is not supported");
    },
    probe(bytes, options) {
      return buildProbeResultFromDoc(parsePjs(bytes), bytes.length, options?.filename ?? "input.txt", {
        ...options, formatName: "pjs", formatLongName: "PJS subtitle"
      });
    }
  };
}
