import { decodeUtf8, encodeUtf8 } from "../binary.js";
import { buildProbeResultFromDoc } from "../mp4.js";
import type { MediaAstPlugin, MediaDocument, MediaSample } from "../types.js";

function readLine(line: string): { start: number; text: string } | undefined {
  let offset = 0;
  let seconds = 0;
  for (let field = 0; field < 3; field++) {
    let end = offset;
    while (end < line.length && line[end]! >= "0" && line[end]! <= "9") end++;
    if (end === offset) return undefined;
    const separator = line[end];
    if (separator !== ":" && !(field === 2 && (separator === " " || separator === "="))) return undefined;
    seconds = seconds * 60 + Number(line.slice(offset, end));
    offset = end + 1;
  }
  const start = seconds * 1000;
  if (!Number.isSafeInteger(start)) return undefined;
  return { start, text: line.slice(offset).replaceAll("|", "\n") };
}

function parseVplayer(bytes: Uint8Array): MediaDocument {
  const samples: MediaSample[] = [];
  let pending = false;
  for (const line of decodeUtf8(bytes).split("\n")) {
    const cue = readLine(line.endsWith("\r") ? line.slice(0, -1) : line);
    if (!cue) continue;
    const previous = samples.at(-1);
    if (pending && previous) {
      samples[samples.length - 1] = { ...previous, duration: Math.max(0, cue.start - previous.pts) };
    }
    pending = cue.text.length > 0;
    if (!cue.text) continue;
    const data = encodeUtf8(cue.text);
    samples.push({ pts: cue.start, dts: cue.start, cts: 0, duration: 0,
      data, size: data.length, offset: 0, isKeyframe: true, sampleDescriptionIndex: 1 });
  }
  const duration = samples.reduce((end, sample) => Math.max(end, sample.pts + sample.duration), 0);
  return { containerFormat: "vplayer", timescale: 1000, duration, durationSeconds: duration / 1000,
    tracks: [{ id: 1, type: "subtitle", handlerType: "sbtl", timescale: 1000, duration,
      language: "und", enabled: true, codecDescriptions: [{ formatFourCC: "text", codecName: "text" }], samples }],
    metadata: {}, byteLength: bytes.length };
}

export function vplayerAst(): MediaAstPlugin {
  return {
    id: "vplayer", formatName: "vplayer", formatLongName: "VPlayer subtitle",
    extensions: [], mimeTypes: [], canDemux: true, canMux: false,
    supportedVideoCodecs: [], supportedAudioCodecs: [],
    detect(bytes) {
      const cue = readLine(decodeUtf8(bytes.subarray(0, 4096)).split("\n")[0] ?? "");
      // Native VPlayer probing excludes a digit after the third colon.
      return cue !== undefined && cue.text.length > 0 && !(cue.text[0]! >= "0" && cue.text[0]! <= "9");
    },
    parse: parseVplayer,
    serialize() {
      throw new Error("VPlayer output is not supported");
    },
    probe(bytes, options) {
      return buildProbeResultFromDoc(parseVplayer(bytes), bytes.length, options?.filename ?? "input.txt", {
        ...options, formatName: "vplayer", formatLongName: "VPlayer subtitle"
      });
    }
  };
}
