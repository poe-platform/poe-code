import { Parser } from "htmlparser2";
import { decodeUtf8, encodeUtf8 } from "../binary.js";
import { buildProbeResultFromDoc } from "../mp4.js";
import type { MediaAstPlugin, MediaDocument, MediaSample } from "../types.js";

function timeMs(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parts = (value.endsWith("s") ? value.slice(0, -1) : value).split(":");
  if (parts.length > 3) return undefined;
  let ms = 0;
  for (const [index, part] of parts.entries()) {
    const digits = index === parts.length - 1 ? part.split(".") : [part];
    if (digits.length > 2 || !digits.every(digit => digit.length > 0 &&
      [...digit].every(char => char >= "0" && char <= "9"))) return undefined;
    // RealText stores the field after the dot as a centisecond count.
    ms = ms * 60 + Number(digits[0]) * 1000 + Number(digits[1] ?? "0") * 10;
  }
  return Number.isSafeInteger(ms) ? ms : undefined;
}

function parseRealtext(bytes: Uint8Array): MediaDocument {
  const source = decodeUtf8(bytes);
  const samples: MediaSample[] = [];
  let start: number | undefined;
  let end: number | undefined;
  let windowDuration = 60000;
  let text = "";
  const flush = (trailingSeparator = false) => {
    const caption = text.trim();
    if (start !== undefined && caption) {
      const data = encodeUtf8(caption + (trailingSeparator ? " " : ""));
      const duration = end !== undefined && end > start ? end - start : windowDuration;
      samples.push({ pts: start, dts: start, cts: 0, duration,
        data, size: data.length, offset: 0, isKeyframe: true, sampleDescriptionIndex: 1 });
    }
    text = "";
  };
  const parser = new Parser({
    onopentag(name, attributes) {
      if (name === "window") {
        windowDuration = timeMs(attributes.duration) ?? 60000;
      } else if (name === "time") {
        flush();
        start = timeMs(attributes.begin ?? "0");
        end = timeMs(attributes.end);
      } else if (name === "br") {
        // FFmpeg recognizes only the compact spellings as dialogue breaks.
        const tag = source.slice(parser.startIndex, parser.endIndex + 1).toLowerCase();
        if (tag === "<br>" || tag === "<br/>") text += "\n";
      }
    },
    ontext(value) {
      if (start === undefined) return;
      for (const char of value) {
        if (" \t\r\n\f\v".includes(char)) {
          if (text && !text.endsWith(" ") && !text.endsWith("\n")) text += " ";
        } else {
          text += char;
        }
      }
    },
    onclosetag(name, isImplied) {
      if (name === "window") {
        // FFmpeg retains one separator from whitespace after the closing window.
        flush(!isImplied && source[parser.endIndex + 1]?.trim() === "");
        start = undefined;
      }
    }
  }, { recognizeSelfClosing: true, decodeEntities: false });
  parser.end(source);
  flush();
  samples.sort((a, b) => a.pts - b.pts);
  const duration = samples.reduce((last, sample) => Math.max(last, sample.pts + sample.duration), 0);
  return { containerFormat: "realtext", timescale: 1000, duration, durationSeconds: duration / 1000,
    tracks: [{ id: 1, type: "subtitle", handlerType: "sbtl", timescale: 1000, duration,
      language: "und", enabled: true, codecDescriptions: [{ formatFourCC: "text", codecName: "text" }], samples }],
    metadata: {}, byteLength: bytes.length };
}

export function realtextAst(): MediaAstPlugin {
  return {
    id: "realtext", formatName: "realtext", formatLongName: "RealText subtitle",
    extensions: ["rt"], mimeTypes: ["text/vnd.rn-realtext"], canDemux: true, canMux: false,
    supportedVideoCodecs: [], supportedAudioCodecs: [],
    detect(bytes) {
      const text = decodeUtf8(bytes.subarray(0, 4096)).trimStart().toLowerCase();
      return text.startsWith("<window>") || text.startsWith("<window ");
    },
    parse: parseRealtext,
    serialize() {
      throw new Error("RealText output is not supported");
    },
    probe(bytes, options) {
      return buildProbeResultFromDoc(parseRealtext(bytes), bytes.length, options?.filename ?? "input.rt", {
        ...options, formatName: "realtext", formatLongName: "RealText subtitle"
      });
    }
  };
}
