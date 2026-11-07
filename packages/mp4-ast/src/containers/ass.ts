import { decodeUtf8, encodeUtf8 } from "../binary.js";
import { buildProbeResultFromDoc, concatMp4, sliceMp4 } from "../mp4.js";
import type { MediaAstPlugin, MediaDocument, MediaSample } from "../types.js";

function decodeAssText(text: string): string {
  let result = "";
  for (let i = 0; i < text.length; i++) {
    if (text.startsWith("{\\", i)) {
      const end = text.indexOf("}", i + 2);
      if (end >= 0) { i = end; continue; }
    }
    if (text[i] === "\\") {
      const escape = text[i + 1];
      if (escape === "N" || escape === "n" || escape === "h") {
        result += escape === "h" ? "\u00a0" : "\n";
        i++;
        continue;
      }
    }
    result += text[i];
  }
  return result;
}

function parseAss(bytes: Uint8Array): MediaDocument {
  const samples: MediaSample[] = [];
  let fields = ["Layer", "Start", "End", "Style", "Name", "MarginL", "MarginR", "MarginV", "Effect", "Text"];
  let events = false;
  let duration = 0;
  for (const raw of decodeUtf8(bytes).split("\n")) {
    const line = raw.trim();
    if (line.startsWith("[")) { events = line === "[Events]"; continue; }
    if (!events) continue;
    if (line.startsWith("Format:")) { fields = line.slice(7).split(",").map(field => field.trim()); continue; }
    if (!line.startsWith("Dialogue:")) continue;
    // The final Text field may itself contain commas.
    const values = line.slice(9).trimStart().split(",");
    if (values.length < fields.length || fields.at(-1) !== "Text") continue;
    const time = (field: string) => {
      const parts = values[fields.indexOf(field)]?.trim().split(":");
      return parts?.length === 3 ? Math.round((Number(parts[0]) * 3600 + Number(parts[1]) * 60 + Number(parts[2])) * 1000) : NaN;
    };
    const start = time("Start");
    const end = time("End");
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) continue;
    const data = encodeUtf8(decodeAssText(values.slice(fields.length - 1).join(",")));
    samples.push({ data, dts: start, pts: start, cts: 0, duration: end - start,
      size: data.byteLength, isKeyframe: true, sampleDescriptionIndex: 1 });
    duration = Math.max(duration, end);
  }
  samples.sort((a, b) => a.pts - b.pts);
  return {
    containerFormat: "ass", timescale: 1000, duration, durationSeconds: duration / 1000,
    tracks: [{ id: 1, type: "subtitle", handlerType: "sbtl", timescale: 1000, duration,
      language: "und", enabled: true, codecDescriptions: [{ formatFourCC: "ass ", codecName: "ass" }], samples }],
    metadata: {}, byteLength: bytes.byteLength
  };
}

function serializeAss(doc: MediaDocument): Uint8Array {
  const lines = [
    "[Script Info]", "ScriptType: v4.00+", "PlayResX: 384", "PlayResY: 288", "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    "Style: Default,Arial,16,&Hffffff,&Hffffff,&H0,&H0,0,0,0,0,100,100,0,0,1,1,0,2,10,10,10,1", "",
    "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text"
  ];
  const track = doc.tracks.find(track => track.type === "subtitle");
  const time = (ticks: number) => {
    const cs = Math.max(0, Math.floor(ticks * 100 / (track?.timescale || 1000)));
    return `${Math.floor(cs / 360000)}:${String(Math.floor(cs / 6000) % 60).padStart(2, "0")}:${String(Math.floor(cs / 100) % 60).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
  };
  for (const sample of track?.samples ?? []) {
    const text = decodeUtf8(sample.data).split("\r\n").join("\n").split("\n").join("\\N");
    lines.push(`Dialogue: 0,${time(sample.pts)},${time(sample.pts + sample.duration)},Default,,0,0,0,,${text}`);
  }
  return encodeUtf8(lines.join("\n") + "\n");
}

export function assAst(): MediaAstPlugin {
  return {
    id: "ass", formatName: "ass", formatLongName: "ASS (Advanced SubStation Alpha) subtitle",
    extensions: ["ass"], mimeTypes: ["text/x-ass"], canDemux: true, canMux: true,
    supportedVideoCodecs: [], supportedAudioCodecs: [],
    detect(bytes) { return decodeUtf8(bytes.subarray(0, 4096)).trimStart().startsWith("[Script Info]"); },
    parse: parseAss, serialize: serializeAss,
    probe(bytes, options) {
      return buildProbeResultFromDoc(parseAss(bytes), bytes.byteLength, options?.filename ?? "input.ass", {
        ...options, formatName: "ass", formatLongName: "ASS (Advanced SubStation Alpha) subtitle"
      });
    },
    concat: concatMp4, slice: sliceMp4
  };
}
