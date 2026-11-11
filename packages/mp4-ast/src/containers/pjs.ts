import { decodeUtf8, encodeUtf8 } from "../binary.js";
import { buildProbeResultFromDoc } from "../mp4.js";
import type { MediaAstPlugin, MediaDocument, MediaSample } from "../types.js";

function readLine(line: string): { start: number; end: number; text: string } | undefined {
  const first = line.indexOf(",");
  const second = line.indexOf(",", first + 1);
  if (first < 1 || second < first + 2) return undefined;
  const startText = line.slice(0, first).trimStart();
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
  const seen = new Set<string>();
  for (const line of new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes).replaceAll("\r", "\n").split("\n")) {
    // Native PJS treats a BOM as part of the record, not as a text signature.
    if (line.startsWith("\uFEFF")) continue;
    const cue = readLine(line);
    if (!cue) continue;
    const key = `${cue.start},${cue.end},${cue.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
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
      return readLine(decodeUtf8(bytes.subarray(0, 4096)).replaceAll("\r", "\n").split("\n")[0] ?? "") !== undefined;
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
