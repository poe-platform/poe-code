import { decodeUtf8, encodeUtf8 } from "../binary.js";
import { buildProbeResultFromDoc, concatMp4, sliceMp4 } from "../mp4.js";
import type { MediaAstPlugin, MediaDocument, MediaSample } from "../types.js";

function readLyric(line: string): { pts: number; text: string } | undefined {
  if (!line.startsWith("[")) return undefined;
  const end = line.indexOf("]");
  const parts = line.slice(1, end).split(":");
  if (end < 0 || parts.length !== 2) return undefined;
  const [minutes, seconds] = parts;
  const fraction = seconds!.split(".");
  if (fraction.length > 2 || ![minutes!, ...fraction].every(part =>
    part.length > 0 && [...part].every(c => c >= "0" && c <= "9"))) return undefined;
  const pts = Math.round((Number(minutes) * 60 + Number(seconds)) * 1000);
  if (!Number.isSafeInteger(pts)) return undefined;
  return { pts, text: line.slice(end + 1) };
}

function parseLrc(bytes: Uint8Array): MediaDocument {
  const samples: MediaSample[] = [];
  let offset = 0;
  for (const raw of decodeUtf8(bytes).split("\n")) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (line.startsWith("[offset:") && line.endsWith("]")) {
      const value = line.slice(8, -1).trim();
      const digits = value.startsWith("+") || value.startsWith("-") ? value.slice(1) : value;
      if (digits.length > 0 && [...digits].every(c => c >= "0" && c <= "9") && Number.isSafeInteger(Number(value))) {
        offset = Number(value);
      }
      continue;
    }
    const cue = readLyric(line);
    if (!cue) continue;
    const data = encodeUtf8(cue.text);
    samples.push({ pts: cue.pts - offset, dts: cue.pts - offset, cts: 0, duration: 0,
      data, size: data.length, offset: 0, isKeyframe: true, sampleDescriptionIndex: 1 });
  }
  samples.sort((a, b) => a.pts - b.pts);
  const timed = samples.map((sample, i) => ({ ...sample,
    // FFmpeg uses UINT32_MAX milliseconds for a subtitle with no known end.
    duration: samples[i + 1] ? samples[i + 1]!.pts - sample.pts : 0xffffffff }));
  const duration = samples.at(-1)?.pts ?? 0;
  return { containerFormat: "lrc", timescale: 1000, duration, durationSeconds: duration / 1000,
    tracks: [{ id: 1, type: "subtitle", handlerType: "sbtl", timescale: 1000, duration,
      language: "und", enabled: true, codecDescriptions: [{ formatFourCC: "text", codecName: "text" }], samples: timed }],
    metadata: {}, byteLength: bytes.length };
}

export function lrcAst(): MediaAstPlugin {
  return {
    id: "lrc", formatName: "lrc", formatLongName: "LRC lyrics",
    extensions: ["lrc"], mimeTypes: [], canDemux: true, canMux: true,
    supportedVideoCodecs: [], supportedAudioCodecs: [],
    detect(bytes) {
      return decodeUtf8(bytes.subarray(0, 4096)).split("\n").some(line => readLyric(line) !== undefined);
    },
    parse: parseLrc,
    serialize(doc) {
      const track = doc.tracks.find(t => t.type === "subtitle");
      const lines: string[] = [];
      for (const [tag, value] of [
        ["ti", doc.metadata.title], ["ar", doc.metadata.artist],
        ["al", doc.metadata.album], ["au", doc.metadata.custom?.author],
        ["re", doc.metadata.encoder],
        ["ve", doc.metadata.encoder?.startsWith("Lavf") ? doc.metadata.encoder.slice(4) : undefined]
      ]) {
        if (value) lines.push(`[${tag}:${value}]\n`);
      }
      lines.push("\n");
      for (const sample of track?.samples ?? []) {
        // Scale the integer timestamp before division to preserve half-centisecond ties.
        const time = Math.round(sample.pts * 100 / track!.timescale);
        const minutes = String(Math.floor(time / 6000)).padStart(2, "0");
        const seconds = String(Math.floor(time / 100) % 60).padStart(2, "0");
        const fraction = String(time % 100).padStart(2, "0");
        for (const line of decodeUtf8(sample.data).split("\n")) {
          lines.push(`[${minutes}:${seconds}.${fraction}]${line}\n`);
        }
      }
      return encodeUtf8(lines.join(""));
    },
    probe(bytes, options) {
      return buildProbeResultFromDoc(parseLrc(bytes), bytes.length, options?.filename ?? "input.lrc", {
        ...options, formatName: "lrc", formatLongName: "LRC lyrics"
      });
    },
    concat: concatMp4,
    slice: sliceMp4
  };
}
