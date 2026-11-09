import { decodeUtf8, encodeUtf8 } from "../binary.js";
import { buildProbeResultFromDoc } from "../mp4.js";
import type { MediaAstPlugin, MediaDocument, MediaSample } from "../types.js";

function readTimestamp(line: string): number | undefined {
  if (line.length !== 10 || line[0] !== "[" || line[9] !== "]" || line[3] !== ":" || line[6] !== ":") return undefined;
  const parts = [line.slice(1, 3), line.slice(4, 6), line.slice(7, 9)];
  if (!parts.every(part => [...part].every(char => char >= "0" && char <= "9"))) return undefined;
  return (Number(parts[0]) * 3600 + Number(parts[1]) * 60 + Number(parts[2])) * 1000;
}

function parseSubviewer1(bytes: Uint8Array): MediaDocument {
  const timescale = 1000;
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
    const timestamp = readTimestamp(line);
    if (timestamp !== undefined) {
      flush(timestamp);
      start = timestamp;
    } else if (start !== undefined) lines.push(line);
  }
  flush(start ?? 0);
  const duration = samples.reduce((end, sample) => Math.max(end, sample.pts + sample.duration), 0);
  return { containerFormat: "subviewer1", timescale, duration, durationSeconds: duration / timescale,
    tracks: [{ id: 1, type: "subtitle", handlerType: "sbtl", timescale, duration,
      language: "und", enabled: true, codecDescriptions: [{ formatFourCC: "text", codecName: "text" }], samples }],
    metadata: {}, byteLength: bytes.length };
}

export function subviewer1Ast(): MediaAstPlugin {
  return {
    id: "subviewer1", formatName: "subviewer1", formatLongName: "SubViewer v1 subtitle",
    extensions: [], mimeTypes: [], canDemux: true, canMux: false,
    supportedVideoCodecs: [], supportedAudioCodecs: [],
    detect(bytes) {
      return decodeUtf8(bytes.subarray(0, 4096)).trimStart().startsWith("******** START SCRIPT ********");
    },
    parse: parseSubviewer1,
    serialize() { throw new Error("SubViewer v1 output is not supported"); },
    probe(bytes, options) {
      return buildProbeResultFromDoc(parseSubviewer1(bytes), bytes.length, options?.filename ?? "input.sub", {
        ...options, formatName: "subviewer1", formatLongName: "SubViewer v1 subtitle"
      });
    }
  };
}
