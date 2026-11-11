import { Parser } from "htmlparser2";
import { decodeUtf8, encodeUtf8 } from "../binary.js";
import { buildProbeResultFromDoc } from "../mp4.js";
import type { MediaAstPlugin, MediaDocument, MediaSample } from "../types.js";

function parseSami(bytes: Uint8Array): MediaDocument {
  const source = decodeUtf8(bytes);
  const samples: MediaSample[] = [];
  const decodeErrors: string[] = [];
  let suppressed = false;
  let start: number | undefined;
  let paragraph = false;
  let text = "";
  const flush = (end?: number) => {
    if (start !== undefined && suppressed) {
      decodeErrors.push("Error decoding subtitles: Operation not permitted");
      text = "";
    }
    const caption = text.trim();
    // A nonbreaking-space marker clears the caption; an empty paragraph is a cue.
    if (start !== undefined && !suppressed) {
      const data = encodeUtf8(caption);
      // FFmpeg's subtitle decoder uses UINT32_MAX for an unspecified end time.
      samples.push({ pts: start, dts: start, cts: 0, duration: end === undefined ? 0xffffffff : Math.max(0, end - start),
        data, size: data.length, offset: 0, isKeyframe: true, sampleDescriptionIndex: 1 });
    }
    text = "";
    suppressed = false;
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
        // The literal marker immediately after any paragraph suppresses this SYNC.
        let offset = parser.endIndex + 1;
        while (offset < source.length && " \t\r\n\f\v".includes(source[offset]!)) offset++;
        if (source.startsWith("&nbsp;", offset)) suppressed = true;
        if (text) text = text.trimEnd() + "\n";
        paragraph = true;
      } else if (name === "br" && paragraph) {
        if (text.endsWith(" ")) text = text.slice(0, -1);
        text += "\n";
      }
    },
    onclosetag(name) {
      if (name === "p" || name === "body") paragraph = false;
    },
    oncomment(value) {
      if (paragraph && start !== undefined) text += `<!--${value}-->`;
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
  }, { decodeEntities: false });
  parser.end(source);
  flush();
  const duration = samples.reduce((end, sample) => Math.max(end, sample.pts + sample.duration), 0);
  return { containerFormat: "sami", timescale: 1000, duration, durationSeconds: duration / 1000,
    tracks: [{ id: 1, type: "subtitle", handlerType: "sbtl", timescale: 1000, duration,
      language: "und", enabled: true, codecDescriptions: [{ formatFourCC: "text", codecName: "text" }], samples, decodeErrors }],
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
