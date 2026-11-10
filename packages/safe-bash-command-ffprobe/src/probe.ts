import { writerOptionAliases } from "./options.js";
import { parseWriterBoolean } from "./writer-boolean.js";
import { optionalFields, parseOptionalFields } from "./optional-fields.js";
import { iniSection, sexagesimalRow } from "./probe-text.js";
import { parseAudio, flacFormatTags, type AudioAst } from "@poe-code/audio-ast";

const codecLongNames: Record<string, string> = {
  flac: "FLAC (Free Lossless Audio Codec)",
  mp3: "MP3 (MPEG audio layer 3)",
  opus: "Opus (Opus Interactive Audio Codec)",
  vorbis: "Vorbis",
  aac: "AAC (Advanced Audio Coding)",
  alac: "ALAC (Apple Lossless Audio Codec)"
};

const formatLongNames = {
  wav: "WAV / WAVE (Waveform Audio)",
  mp3: "MP2/3 (MPEG audio layer 2/3)",
  flac: "raw FLAC",
  ogg: "Ogg",
  m4a: "QuickTime / MOV"
};

export function isStdin(path: string): boolean {
  return ["-", "pipe:", "pipe:0", "/dev/stdin", "/dev/fd/0"].includes(path);
}

export function parseArguments(args: readonly string[]) {
  let filename = "",
    writer = "default",
    selector: string | undefined,
    quiet = false,
    sexagesimal = false,
    streamEntries = false;
  let showOptionalFields: "auto" | "always" | "never" = "auto";
  const sections = new Map<string, string[] | undefined>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    const value = () => {
      const v = args[++i];
      if (v === undefined) throw new Error(`Missing value for ${arg}`);
      return v;
    };
    if (arg === "-v") {
      const v = value();
      if (!["quiet", "error", "warning", "info"].includes(v)) throw new Error("Invalid log level");
      quiet = v === "quiet";
    } else if (arg === "-of" || arg === "-print_format") writer = value();
    else if (arg === "-show_optional_fields") showOptionalFields = parseOptionalFields(value());
    else if (arg === "-sexagesimal") sexagesimal = true;
    else if (arg === "-show_error") continue;
    else if (arg === "-show_format") sections.set("format", undefined);
    else if (arg === "-show_streams") sections.set("stream", undefined);
    else if (arg === "-select_streams") {
      selector = value();
      if (!["a", "a:0", "0"].includes(selector))
        throw new Error("Only audio stream 0 selection is supported");
    } else if (arg === "-show_entries")
      for (const entry of value().split(":")) {
        const [section, fields] = entry.split("=");
        if (!["stream", "format", "stream_tags", "format_tags"].includes(section!))
          throw new Error(`Unknown section ${section}`);
        sections.set(
          section!,
          fields === undefined ? undefined : [...new Set([...sections.get(section!) ?? [], ...fields.split(",").filter(Boolean)])]
        );
        if (section === "stream") streamEntries = sections.get(section)?.length !== 0;
      }
    else {
      const path = arg === "-i" ? value() : arg;
      if (path.startsWith("-") && path !== "-") throw new Error(`Unknown option ${path}`);
      if (filename) throw new Error("Expected one input");
      filename = path;
    }
  }
  if (!filename) throw new Error("Input file is required");
  const [format, ...options] = writer.split(":");
  if (!["json", "compact", "csv", "default", "flat", "ini"].includes(format!))
    throw new Error(`Unknown output format ${format}`);
  const settings = new Map(
    options.map((option) => {
      const [k, v] = option.split("=");
      if (!k || v === undefined) throw new Error("Invalid writer option");
      return [k === "s" && format === "flat" ? "sep_char" : writerOptionAliases.get(k) ?? k, v];
    })
  );
  const writerOptions: Record<string, readonly string[]> = {
    json: [],
    default: ["nokey", "nk", "noprint_wrappers", "nw"],
    compact: ["nokey", "nk", "print_section", "p", "item_sep", "s", "escape", "e"],
    csv: ["nokey", "nk", "print_section", "p", "item_sep", "s", "escape", "e"],
    flat: ["s", "sep_char", "h", "hierarchical"],
    ini: ["h", "hierarchical"]
  };
  for (const [key, value] of settings) {
    if (!writerOptions[format!]!.includes(key))
      throw new Error(`Unsupported writer option ${key}`);
    if ((key === "escape" || key === "e") && !["c", "csv", "none"].includes(value))
      throw new Error(`Invalid escape mode ${value}`);
    if (key !== "s" && key !== "item_sep" && key !== "sep_char" && key !== "escape" && key !== "e") parseWriterBoolean(value);
    if ((format === "compact" || format === "csv") && (key === "item_sep" || key === "s") && new TextEncoder().encode(value).length !== 1)
      throw new Error("Item separator must be a single byte");
  }
  return { filename, format: format!, sections, settings, selector, quiet, streamEntries, sexagesimal, showOptionalFields };
}

type Row = Record<string, string | number | Record<string, string>>;
export function probe(data: Uint8Array, args: readonly string[]): string {
  const parsed = parseArguments(args);
  return formatAudioProbe(parseAudio(data, { maxAtomDepth: 64 }), data.length, parsed);
}

export function audioProbeRows(audio: Omit<AudioAst, "data" | "pictures">, size: number, parsed: ReturnType<typeof parseArguments>, retainedTags = false) {
  const { sections } = parsed;
  const unknownFlacDuration = audio.format === "flac" && audio.streams[0]!.samples === 0;
  const inlineInput = parsed.filename.startsWith("data:");
  const stdinAudio = ["wav", "mp3"].includes(audio.format) && (isStdin(parsed.filename) || inlineInput);
  const serials = [
    ...new Set(
      audio.nodes.filter((node) => node.type === "OggS").map((node) => node.fields?.serial)
    )
  ];
  const durations = audio.streams.map((stream, index) => {
    if (stream.codec !== "opus") return stream.duration;
    const final = audio.nodes
      .filter(
        (node) =>
          node.fields?.serial === serials[index] && node.fields?.granule !== 0xffffffffffffffffn
      )
      .at(-1)?.fields?.granule;
    return typeof final === "bigint" ? Number(final) / stream.sampleRate : stream.duration;
  });
  const formatDuration =
    audio.duration +
    Math.max(0, ...durations.map((duration, index) => duration - audio.streams[index]!.duration));
  const filter = (name: string, row: Row): Row => {
    if (!sections.has(name)) return {};
    row = optionalFields(row, name, parsed.showOptionalFields, parsed.format);
    const fields = sections.get(name);
    return fields === undefined
      ? row
      : Object.fromEntries(Object.entries(row).filter(([key]) => fields.some(field => name.endsWith("_tags") ? field.toLowerCase() === key.toLowerCase() : field === key)));
  };
  const firstFrame = audio.nodes.find((node) => node.type === "MPEG");
  // MP3 uses FFmpeg's common MPEG audio clock, including decoder delay when
  // an encoder delay is available from the Xing/LAME header.
  const mp3TimeBase = 14112000;
  const encoderDelay = firstFrame?.fields?.encoderDelay;
  const startPts = audio.format === "flac" ? 0 : audio.format === "mp3"
    ? typeof encoderDelay === "number"
      ? (encoderDelay + 529) * (mp3TimeBase / audio.streams[0]!.sampleRate)
      : 0
    : undefined;
  const startTime = startPts === undefined ? undefined
    : (startPts / (audio.format === "mp3" ? mp3TimeBase : audio.streams[0]!.sampleRate)).toFixed(6);
  const vbr = firstFrame?.fields?.vbr as { type?: string; bytes?: number } | undefined;
  const encodedSamples = Number(firstFrame?.fields?.encodedSamples);
  const mp3Bitrate =
    vbr?.type === "Info"
      ? Number(firstFrame?.fields?.bitrate)
      : vbr?.bytes && encodedSamples
      ? (vbr.bytes * 8 * audio.streams[0]!.sampleRate) / encodedSamples
      : audio.streams[0]!.bitrate;
  const formatTags = audio.format === "ogg" ? {} : audio.format === "flac" ? flacFormatTags(audio.nodes) : { ...audio.tags };
  const brands = audio.nodes.find((node) => node.type === "ftyp")?.fields;
  if (brands)
    Object.assign(formatTags, {
      major_brand: String(brands.majorBrand),
      minor_version: String(brands.minorVersion),
      compatible_brands: (brands.compatibleBrands as string[]).join("")
    });
  const tags = filter("format_tags", formatTags) as Record<string, string>;
  const rows: { section: string; row: Row }[] = [];
  if ((sections.has("stream") && sections.get("stream")?.length !== 0) || (sections.has("stream_tags") && sections.get("stream_tags")?.length !== 0))
    for (const [index, stream] of audio.streams.entries()) {
      if (parsed.selector && index !== 0) continue;
      const mimeCodec = ({ mp3: "mp4a.40.34", flac: "flac", vorbis: "vorbis", opus: "opus", aac: "mp4a.40.2" } as Record<string, string>)[stream.codec];
      let channelLayout: string | undefined;
      if (stream.channelMask) {
        const speakers = ["FL", "FR", "FC", "LFE", "BL", "BR", "FLC", "FRC", "BC", "SL", "SR", "TC", "TFL", "TFC", "TFR", "TBL", "TBC", "TBR"]
          .filter((_, bit) => (stream.channelMask! & (2 ** bit)) !== 0);
        if (speakers.length === stream.channels) {
          const layouts: Record<number, string> = {
            4: "mono", 3: "stereo", 11: "2.1", 7: "3.0", 259: "3.0(back)",
            15: "3.1", 263: "4.0", 51: "quad", 1539: "quad(side)",
            271: "4.1", 55: "5.0", 1543: "5.0(side)", 63: "5.1", 1551: "5.1(side)",
            1799: "6.0", 1807: "6.1", 1591: "7.0", 1599: "7.1", 255: "7.1(wide)"
          };
          channelLayout = layouts[stream.channelMask] ?? `${stream.channels} channels (${speakers.join("+")})`;
        }
      } else if (["flac", "mp3", "vorbis", "opus", "aac"].includes(stream.codec) && stream.channels <= 2) {
        channelLayout = stream.channels === 1 ? "mono" : "stereo";
      }
      const row = filter("stream", {
        index,
        ...(stream.tags && Object.keys(stream.tags).length ? { tags: stream.tags } : {}),
        codec_name:
          stream.codec === "pcm"
            ? stream.bitsPerSample === 8
              ? "pcm_u8"
              : `pcm_s${stream.bitsPerSample}le`
            : stream.codec === "pcm_float"
              ? `pcm_f${stream.bitsPerSample}le`
              : stream.codec,
        codec_long_name: stream.codec === "pcm"
          ? stream.bitsPerSample === 8
            ? "PCM unsigned 8-bit"
            : `PCM signed ${stream.bitsPerSample}-bit little-endian`
          : stream.codec === "pcm_float"
            ? `PCM ${stream.bitsPerSample}-bit floating point little-endian`
            : codecLongNames[stream.codec] ?? stream.codec,
        codec_type: "audio",
        ...(mimeCodec ? { mime_codec_string: mimeCodec } : {}),
        ...(["pcm", "pcm_float", "mp3", "flac", "vorbis"].includes(stream.codec)
          ? { sample_fmt: stream.codec === "mp3" || stream.codec === "vorbis"
              ? "fltp"
              : stream.codec === "pcm_float"
                ? stream.bitsPerSample === 64 ? "dbl" : "flt"
                : stream.codec === "pcm" && stream.bitsPerSample === 8
                  ? "u8"
                  : stream.bitsPerSample! <= 16 ? "s16" : "s32" }
          : {}),
        sample_rate: String(stream.sampleRate),
        channels: stream.channels,
        ...(channelLayout ? { channel_layout: channelLayout } : {}),
        bits_per_sample: stream.codec.startsWith("pcm") ? (stream.bitsPerSample ?? 0) : 0,
        ...(stream.codec === "flac" ? { bits_per_raw_sample: String(stream.bitsPerSample) } : {}),
        time_base: `1/${stream.codec === "mp3" ? mp3TimeBase : stream.sampleRate}`,
        ...(startPts === undefined ? {} : { start_pts: startPts, start_time: startTime! }),
        ...(!stdinAudio && !unknownFlacDuration && !(audio.format === "wav" && durations[index] === 0) ? {
          duration_ts: Math.round(durations[index]! * (stream.codec === "mp3" ? mp3TimeBase : stream.sampleRate)),
          duration: durations[index]!.toFixed(6)
        } : {}),
        ...(!["flac", "opus", "vorbis"].includes(stream.codec)
          ? {
              bit_rate: String(
                stream.codec === "mp3" ? Math.round(mp3Bitrate) : Math.floor(stream.bitrate)
              )
            }
          : {})
      });
      if (stream.tags && sections.has("stream_tags") && sections.get("stream_tags")?.length !== 0)
        row.tags = filter("stream_tags", stream.tags) as Record<string, string>;
      if (sections.get("stream_tags")?.length === 0) delete row.tags;
      rows.push({ section: "stream", row });
    }
  if ((sections.has("format") && sections.get("format")?.length !== 0) || (sections.has("format_tags") && sections.get("format_tags")?.length !== 0)) {
    const row = filter("format", {
      filename: parsed.filename,
      nb_streams: audio.streams.length,
      nb_programs: 0,
      nb_stream_groups: 0,
      format_name: audio.format === "m4a" ? "mov,mp4,m4a,3gp,3g2,mj2" : audio.format,
      format_long_name: formatLongNames[audio.format],
      ...(startTime === undefined ? {} : { start_time: startTime }),
      ...(!stdinAudio && !unknownFlacDuration ? { duration: formatDuration.toFixed(6) } : {}),
      ...(!stdinAudio && !inlineInput ? { size: String(size) } : {}),
      ...(!unknownFlacDuration ? { bit_rate: String(stdinAudio
        ? audio.streams.reduce((total, stream) => total + (stream.codec === "mp3" ? Math.round(mp3Bitrate) : Math.floor(stream.bitrate)), 0)
        : formatDuration ? Math.floor((size * 8) / formatDuration) : 0) } : {}),
      // Strict MP3 parsing validates consecutive frames after ID3 metadata.
      // Native mp3_read_probe assigns 52 to seven frames, 25 to four,
      // and 1 to shorter valid streams. Signature-based containers score higher.
      probe_score: audio.format === "wav" ? 99 : audio.format === "mp3"
        ? Number(firstFrame?.fields?.frames) >= 7 ? 52 : Number(firstFrame?.fields?.frames) >= 4 ? 25 : 1
        : 100,
      ...(retainedTags || Object.keys(formatTags).length ? { tags: formatTags } : {})
    });
    if ((retainedTags || Object.keys(formatTags).length) && sections.has("format_tags") && sections.get("format_tags")?.length !== 0) row.tags = tags;
    if (sections.get("format_tags")?.length === 0) delete row.tags;
    rows.push({ section: "format", row });
  }
  return parsed.sexagesimal ? rows.map(({ section, row }) => ({ section, row: sexagesimalRow(row, section) })) : rows;
}

export function formatAudioProbe(audio: Omit<AudioAst, "data" | "pictures">, size: number, parsed: ReturnType<typeof parseArguments>): string {
  const { sections, format, settings, streamEntries } = parsed;
  const rows = audioProbeRows(audio, size, parsed);
  if (format === "json") {
    const result: Record<string, unknown> = {};
    if ((sections.has("stream") && sections.get("stream")?.length !== 0) || (sections.has("stream_tags") && sections.get("stream_tags")?.length !== 0)) {
      if (streamEntries) {
        result.programs = [];
        result.stream_groups = [];
      }
      result.streams = rows.filter((r) => r.section === "stream").map((r) => r.row);
    }
    const row = rows.find((r) => r.section === "format");
    if (row) result.format = row.row;
    return JSON.stringify(result, null, 4) + "\n";
  }
  if (format === "ini") {
    let output = "# ffprobe output\n", index = 0;
    if (rows.some(row => row.section === "stream")) output += "\n\n";
    for (const { section, row } of rows) {
      const path = section === "stream" ? `${!parseWriterBoolean(settings.get("hierarchical") ?? "1") ? "" : "streams."}stream.${index++}` : section;
      for (const part of iniSection(row, path)) output += part;
    }
    return output;
  }
  const enabled = (key: string, fallback: boolean) => {
    const value = settings.get(key);
    return value === undefined ? fallback : parseWriterBoolean(value);
  };
  const lines: string[] = [];
  let streamIndex = 0;
  for (const { section, row } of rows) {
    const fields = Object.entries(row).flatMap(([key, value]) =>
      typeof value === "object"
        ? Object.entries(value).map(([k, v]) => ["tag:" + k, v] as const)
        : [[key, value] as const]
    );
    if (format === "compact" || format === "csv") {
      const sep = settings.get("item_sep") ?? (format === "csv" ? "," : "|");
      const escape = settings.get("escape") ?? (format === "csv" ? "csv" : "c");
      const quote = (value: string) =>
        escape === "none" ? value : escape === "csv"
          ? value.includes(sep) || value.includes('"') || value.includes("\n") || value.includes("\r")
            ? '"' + value.split('"').join('""') + '"'
            : value
          : value
              .split("\\")
              .join("\\\\")
              .split("\n")
              .join("\\n")
              .split("\r")
              .join("\\r")
              .split(sep)
              .join("\\" + sep);
      const values = fields.map(([k, v]) =>
        (enabled("nokey", format === "csv") ? "" : k + "=") + quote(String(v))
      );
      if (enabled("print_section", true)) values.unshift(section);
      lines.push(values.join(sep));
    } else if (format === "flat") {
      const sep = settings.get("sep_char") ?? ".";
      const prefix = section === "stream" ? `${!parseWriterBoolean(settings.get("hierarchical") ?? "1") ? "" : "streams" + sep}stream${sep}${streamIndex++}` : "format";
      for (const [key, value] of fields)
        lines.push(
          `${prefix}${sep}${key.startsWith("tag:") ? "tags" + sep + key.slice(4) : key}=${typeof value === "number" ? value : '"' + value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\n").replaceAll("\r", "\\r") + '"'}`
        );
    } else {
      if (!enabled("noprint_wrappers", false)) lines.push("[" + section.toUpperCase() + "]");
      for (const [key, value] of fields)
        lines.push(
          (enabled("nokey", false)
            ? ""
            : (key.startsWith("tag:") ? "TAG:" + key.slice(4) : key) + "=") + value
        );
      if (!enabled("noprint_wrappers", false)) lines.push("[/" + section.toUpperCase() + "]");
    }
  }
  return lines.length ? lines.join("\n") + "\n" : "";
}
