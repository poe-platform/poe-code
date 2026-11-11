import { Parser } from "htmlparser2";
import { decodeUtf8, encodeUtf8 } from "../binary.js";
import { buildProbeResultFromDoc } from "../mp4.js";
import type { MediaAstPlugin, MediaDocument, MediaSample } from "../types.js";

function parseSami(bytes: Uint8Array): MediaDocument {
  const samples: MediaSample[] = [];
  let start: number | undefined;
  let paragraph = false;
  let text = "";
  const flush = (end?: number) => {
    const caption = text.trim();
    if (start !== undefined && caption) {
      const data = encodeUtf8(caption);
      // FFmpeg's subtitle decoder uses UINT32_MAX for an unspecified end time.
      samples.push({ pts: start, dts: start, cts: 0, duration: end === undefined ? 0xffffffff : Math.max(0, end - start),
        data, size: data.length, offset: 0, isKeyframe: true, sampleDescriptionIndex: 1 });
    }
    text = "";
  };
  const parser = new Parser({
    onopentag(name, attributes) {
      if (name === "sync") {
        const value = attributes.start;
        if (!value || ![...value].every(c => c >= "0" && c <= "9")) return;
        const next = Number(value);
        if (!Number.isSafeInteger(next)) return;
        flush(next);
        start = next;
        paragraph = false;
      } else if (name === "p") {
        if (text) text = text.trimEnd() + "\n";
        paragraph = true;
      } else if (name === "br" && paragraph) {
        text = text.trimEnd() + "\n";
      }
    },
    onclosetag(name) {
      if (name === "p" || name === "body") paragraph = false;
    },
    ontext(value) {
      if (!paragraph || start === undefined) return;
      for (const char of value) {
        if (char.trim() === "") {
          if (text && !text.endsWith(" ") && !text.endsWith("\n")) text += " ";
        } else {
          text += char;
        }
      }
    }
  });
  parser.end(decodeUtf8(bytes));
  flush();
  const duration = samples.reduce((end, sample) => Math.max(end, sample.pts + sample.duration), 0);
  return { containerFormat: "sami", timescale: 1000, duration, durationSeconds: duration / 1000,
    tracks: [{ id: 1, type: "subtitle", handlerType: "sbtl", timescale: 1000, duration,
      language: "und", enabled: true, codecDescriptions: [{ formatFourCC: "text", codecName: "text" }], samples }],
    metadata: {}, byteLength: bytes.length };
}

export function samiAst(): MediaAstPlugin {
  return {
    id: "sami", formatName: "sami", formatLongName: "SAMI subtitle",
    extensions: ["smi", "sami"], mimeTypes: ["application/x-sami"], canDemux: true, canMux: false,
    supportedVideoCodecs: [], supportedAudioCodecs: [],
    detect(bytes) {
      return decodeUtf8(bytes.subarray(0, 4096)).toLowerCase().includes("<sami>");
    },
    parse: parseSami,
    serialize() {
      throw new Error("SAMI output is not supported");
    },
    probe(bytes, options) {
      return buildProbeResultFromDoc(parseSami(bytes), bytes.length, options?.filename ?? "input.smi", {
        ...options, formatName: "sami", formatLongName: "SAMI subtitle"
      });
    }
  };
}
