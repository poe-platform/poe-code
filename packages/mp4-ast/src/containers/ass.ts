import { decodeUtf8, encodeUtf8 } from "../binary.js";
import { buildProbeResultFromDoc, concatMp4, sliceMp4 } from "../mp4.js";
import type { MediaAstPlugin, MediaDocument, MediaSample, ParseMediaOptions } from "../types.js";

/** Decode ASS dialogue overrides into scoped subtitle markup. */
export function decodeAssText(text: string): string {
  const active: { key: string; tag: string; opening: string }[] = [];
  let result = "";
  let alignmentSeen = false;
  const close = (tag: string) => {
    const index = active.findIndex(entry => entry.key === tag);
    if (index < 0) return;
    for (let i = active.length - 1; i >= index; i--) result += `</${active[i]!.tag}>`;
    active.splice(index, 1);
    for (let i = index; i < active.length; i++) result += active[i]!.opening;
  };
  for (let i = 0; i < text.length; i++) {
    if (text.startsWith("{\\", i)) {
      const end = text.indexOf("}", i + 2);
      if (end >= 0) {
        for (const command of text.slice(i + 1, end).split("\\")) {
          // SubRip retains only the first alignment override in each cue.
          if (!alignmentSeen && command.length === 3 && command.startsWith("an") && "0123456789".includes(command[2]!)) {
            result += `{\\${command}}`;
            alignmentSeen = true;
          }
          const tag = command[0]!;
          if (["i", "b", "u", "s"].includes(tag) && ["0", "1", "-1"].includes(command.slice(1))) {
            if (command.slice(1) === "0") close(tag);
            else if (!active.some(entry => entry.key === tag)) {
              active.push({ key: tag, tag, opening: `<${tag}>` }); result += `<${tag}>`;
            }
          } else if (command.startsWith("fn") || command.startsWith("fs") || command.startsWith("c") || command.startsWith("1c")) {
            const key = command.startsWith("1c") ? "c" : command.startsWith("f") ? command.slice(0, 2) : "c";
            let value = command.slice(command.startsWith("1c") ? 2 : key.length);
            if (key === "fs" && value && (!Number.isFinite(Number(value)) || Number(value) <= 0)) continue;
            if (key === "c" && value) {
              if (!value.startsWith("&H")) continue;
              const hex = value.slice(2, value.endsWith("&") ? -1 : undefined);
              if (!hex.length || hex.length > 8 || [...hex.toLowerCase()].some(char => !"0123456789abcdef".includes(char))) continue;
              const bgr = hex.padStart(6, "0").slice(-6).toLowerCase();
              value = "#" + bgr.slice(4, 6) + bgr.slice(2, 4) + bgr.slice(0, 2);
            }
            close(key);
            if (value) {
              const attribute = key === "fn" ? "face" : key === "fs" ? "size" : "color";
              value = value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
              const opening = `<font ${attribute}="${value}">`;
              active.push({ key, tag: "font", opening });
              result += opening;
            }
          } else if (tag === "r") {
            while (active.length) close(active.at(-1)!.key);
          }
        }
        i = end;
        continue;
      }
    }
    // FFmpeg's text subtitle encoders retain hard-space escapes literally.
    if (text[i] === "\\" && ["N", "n"].includes(text[i + 1]!)) {
      result += "\n";
      i++;
    } else result += text[i];
  }
  while (active.length) close(active.at(-1)!.key);
  return result;
}

const eventFields = ["Layer", "Start", "End", "Style", "Name", "MarginL", "MarginR", "MarginV", "Effect", "Text"];
const packetFields = ["Layer", "Style", "Name", "MarginL", "MarginR", "MarginV", "Effect", "Text"];

function parseAss(bytes: Uint8Array, options?: ParseMediaOptions): MediaDocument {
  const copy = options?.decodeSubtitles === false;
  const header: string[] = [];
  const samples: MediaSample[] = [];
  let fields = eventFields;
  let events = false;
  let duration = 0;
  for (const raw of decodeUtf8(bytes).split("\n")) {
    const line = raw.trim();
    if (copy && !(events && line.startsWith("Dialogue:"))) header.push(raw.endsWith("\r") ? raw.slice(0, -1) : raw);
    if (line.startsWith("[")) { events = line === "[Events]"; continue; }
    if (!events) continue;
    if (line.startsWith("Format:")) { fields = line.slice(7).split(",").map(field => field.trim()); continue; }
    if (!line.startsWith("Dialogue:")) continue;
    // The final Text field may itself contain commas.
    const values = (raw.endsWith("\r") ? raw.slice(0, -1) : raw).trimStart().slice(9).trimStart().split(",");
    if (values.length < fields.length || fields.at(-1) !== "Text") continue;
    const time = (field: string) => {
      const parts = values[fields.indexOf(field)]?.trim().split(":");
      if (parts?.length !== 3) return NaN;
      const seconds = parts[2]!.split(".");
      if (seconds.length > 2) return NaN;
      // ASS stores an integer centisecond count, regardless of field width.
      return (Number(parts[0]) * 3600 + Number(parts[1]) * 60 + Number(seconds[0])) * 1000
        + Number(seconds[1] ?? 0) * 10;
    };
    const start = time("Start");
    const end = time("End");
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    const text = values.slice(fields.length - 1).join(",");
    // ASS packets carry read order and event fields; timing lives on the sample.
    const data = encodeUtf8(copy
      ? [String(samples.length), ...packetFields.map(field => field === "Text" ? text : values[fields.indexOf(field)] ?? "")].join(",")
      : decodeAssText(text));
    // FFmpeg decodes ASS durations into an unsigned 32-bit millisecond field.
    const sampleDuration = copy ? end - start : (end - start) >>> 0;
    samples.push({ data, dts: start, pts: start, cts: 0, duration: sampleDuration,
      size: data.byteLength, isKeyframe: true, sampleDescriptionIndex: 1 });
    duration = Math.max(duration, start + sampleDuration);
  }
  samples.sort((a, b) => a.pts - b.pts);
  return {
    containerFormat: "ass", timescale: 1000, duration, durationSeconds: duration / 1000,
    tracks: [{ id: 1, type: "subtitle", handlerType: "sbtl", timescale: 1000, duration,
      language: "und", enabled: true, codecDescriptions: [{ formatFourCC: "ass ", codecName: "ass",
        ...(copy ? { extraData: encodeUtf8(header.join("\n").trimEnd() + "\n") } : {}) }], samples }],
    metadata: {}, byteLength: bytes.byteLength
  };
}

function serializeAss(doc: MediaDocument): Uint8Array {
  let lines = [
    "[Script Info]", "ScriptType: v4.00+", "PlayResX: 384", "PlayResY: 288", "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    "Style: Default,Arial,16,&Hffffff,&Hffffff,&H0,&H0,0,0,0,0,100,100,0,0,1,1,0,2,10,10,10,1", "",
    "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text"
  ];
  const track = doc.tracks.find(track => track.type === "subtitle");
  const extraData = doc.containerFormat === "ass" ? track?.codecDescriptions[0]?.extraData : undefined;
  let fields = eventFields;
  if (extraData) {
    lines = decodeUtf8(extraData).trimEnd().split("\n");
    let events = false;
    for (const line of lines) {
      if (line.startsWith("[")) events = line.trim() === "[Events]";
      if (events && line.startsWith("Format:")) fields = line.slice(7).split(",").map(field => field.trim());
    }
  }
  const time = (ticks: number) => {
    const cs = Math.max(0, Math.floor(ticks * 100 / (track?.timescale || 1000)));
    return `${Math.floor(cs / 360000)}:${String(Math.floor(cs / 6000) % 60).padStart(2, "0")}:${String(Math.floor(cs / 100) % 60).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
  };
  for (const sample of track?.samples ?? []) {
    if (extraData) {
      const values = decodeUtf8(sample.data).split(",");
      const event = fields.map(field => {
        if (field === "Start") return time(sample.pts);
        if (field === "End") return time(sample.pts + sample.duration);
        if (field === "Text") return values.slice(packetFields.length).join(",");
        return values[packetFields.indexOf(field) + 1] ?? "";
      });
      lines.push(`Dialogue: ${event.join(",")}`);
      continue;
    }
    let text = decodeUtf8(sample.data).split("\r\n").join("\n").split("\n").join("\\N");
    for (const tag of ["i", "b", "u", "s"]) {
      text = text.replaceAll(`<${tag}>`, `{\\${tag}1}`).replaceAll(`</${tag}>`, `{\\${tag}0}`);
    }
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
