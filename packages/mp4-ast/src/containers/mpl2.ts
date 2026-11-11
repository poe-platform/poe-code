import { bytesEqual, decodeUtf8, encodeUtf8 } from "../binary.js";
import { buildProbeResultFromDoc } from "../mp4.js";
import type { MediaAstPlugin, MediaDocument, MediaSample } from "../types.js";

function readLine(line: string): { start: number; end: number; text: string } | undefined {
  if (!line.startsWith("[")) return undefined;
  const first = line.indexOf("]");
  if (first < 2 || line[first + 1] !== "[") return undefined;
  const second = line.indexOf("]", first + 2);
  if (second < first + 3) return undefined;
  const startText = line.slice(1, first);
  const endText = line.slice(first + 2, second);
  for (const text of [startText, endText]) {
    const digits = text.startsWith("+") || text.startsWith("-") ? text.slice(1) : text;
    if (!digits || ![...digits].every(c => c >= "0" && c <= "9")) return undefined;
  }
  const start = Number(startText);
  const end = Number(endText);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start) return undefined;
  return { start, end, text: line.slice(second + 1) };
}

function parseMpl2(bytes: Uint8Array): MediaDocument {
  const timescale = 10;
  let duration = 0;
  let samples: MediaSample[] = [];
  for (const line of decodeUtf8(bytes).replaceAll("\r", "\n").split("\n")) {
    const cue = readLine(line);
    if (!cue) continue;
    const data = encodeUtf8(cue.text);
    samples.push({ pts: cue.start, dts: cue.start, cts: 0,
      duration: cue.end - cue.start, data, size: data.length, offset: 0,
      isKeyframe: true, sampleDescriptionIndex: 1 });
    duration = Math.max(duration, cue.end);
  }
  samples.sort((a, b) => a.pts - b.pts);
  samples = samples.filter((sample, index) => {
    const previous = samples[index - 1];
    return !previous || sample.pts !== previous.pts || sample.duration !== previous.duration
      || !bytesEqual(sample.data, previous.data);
  });
  return { containerFormat: "mpl2", timescale, duration, durationSeconds: duration / timescale,
    tracks: [{ id: 1, type: "subtitle", handlerType: "sbtl", timescale, duration,
      language: "und", enabled: true, codecDescriptions: [{ formatFourCC: "text", codecName: "mpl2" }], samples }],
    metadata: {}, byteLength: bytes.length };
}

export function mpl2Ast(): MediaAstPlugin {
  return {
    id: "mpl2", formatName: "mpl2", formatLongName: "MPL2 subtitle",
    extensions: [], mimeTypes: [], canDemux: true, canMux: false,
    supportedVideoCodecs: [], supportedAudioCodecs: [],
    detect(bytes) {
      return readLine(decodeUtf8(bytes.subarray(0, 4096)).split("\n")[0] ?? "") !== undefined;
    },
    parse: parseMpl2,
    serialize() {
      throw new Error("MPL2 output is not supported");
    },
    probe(bytes, options) {
      return buildProbeResultFromDoc(parseMpl2(bytes), bytes.length, options?.filename ?? "input.txt", {
        ...options, formatName: "mpl2", formatLongName: "MPL2 subtitle"
      });
    }
  };
}
