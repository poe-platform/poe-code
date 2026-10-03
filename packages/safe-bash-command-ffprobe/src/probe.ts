import { parseAudio } from "@poe-code/audio-ast";

export function parseArguments(args: readonly string[]) {
  let filename = "",
    writer = "default",
    selector: string | undefined,
    quiet = false;
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
          fields === undefined ? undefined : fields.split(",").filter(Boolean)
        );
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
  if (!["json", "compact", "csv", "default", "flat"].includes(format!))
    throw new Error(`Unknown output format ${format}`);
  const settings = new Map(
    options.map((option) => {
      const [k, v] = option.split("=");
      if (!k || v === undefined) throw new Error("Invalid writer option");
      return [k, v];
    })
  );
  for (const key of settings.keys())
    if (
      !["nokey", "nk", "noprint_wrappers", "nw", "print_section", "p", "item_sep", "s"].includes(
        key
      )
    )
      throw new Error(`Unsupported writer option ${key}`);
  return { filename, format: format!, sections, settings, selector, quiet };
}

type Row = Record<string, string | number | Record<string, string>>;
export function probe(data: Uint8Array, args: readonly string[]): string {
  const parsed = parseArguments(args),
    audio = parseAudio(data, { maxAtomDepth: 64 });
  const { sections, format, settings } = parsed;
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
    const fields = sections.get(name);
    return fields === undefined
      ? row
      : Object.fromEntries(Object.entries(row).filter(([key]) => fields.includes(key)));
  };
  const firstFrame = audio.nodes.find((node) => node.type === "MPEG");
  const vbr = firstFrame?.fields?.vbr as { bytes?: number } | undefined;
  const encodedSamples = Number(firstFrame?.fields?.encodedSamples);
  const mp3Bitrate =
    vbr?.bytes && encodedSamples
      ? (vbr.bytes * 8 * audio.streams[0]!.sampleRate) / encodedSamples
      : audio.streams[0]!.bitrate;
  const formatTags = audio.format === "ogg" ? {} : { ...audio.tags };
  const brands = audio.nodes.find((node) => node.type === "ftyp")?.fields;
  if (brands)
    Object.assign(formatTags, {
      major_brand: String(brands.majorBrand),
      minor_version: String(brands.minorVersion),
      compatible_brands: (brands.compatibleBrands as string[]).join("")
    });
  const tags = filter("format_tags", formatTags) as Record<string, string>;
  const rows: { section: string; row: Row }[] = [];
  if (sections.has("stream") || sections.has("stream_tags"))
    for (const [index, stream] of audio.streams.entries()) {
      if (parsed.selector && index !== 0) continue;
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
        codec_type: "audio",
        sample_rate: String(stream.sampleRate),
        channels: stream.channels,
        bits_per_sample: stream.codec.startsWith("pcm") ? (stream.bitsPerSample ?? 0) : 0,
        duration: durations[index]!.toFixed(6),
        ...(!["flac", "opus", "vorbis"].includes(stream.codec)
          ? {
              bit_rate: String(
                stream.codec === "mp3" ? Math.round(mp3Bitrate) : Math.floor(stream.bitrate)
              )
            }
          : {})
      });
      if (sections.has("stream_tags"))
        row.tags = filter("stream_tags", stream.tags ?? audio.tags) as Record<string, string>;
      rows.push({ section: "stream", row });
    }
  if (sections.has("format") || sections.has("format_tags")) {
    const row = filter("format", {
      filename: parsed.filename,
      nb_streams: audio.streams.length,
      format_name: audio.format === "m4a" ? "mov,mp4,m4a,3gp,3g2,mj2" : audio.format,
      duration: formatDuration.toFixed(6),
      size: String(data.length),
      bit_rate: String(formatDuration ? Math.floor((data.length * 8) / formatDuration) : 0),
      ...(Object.keys(formatTags).length ? { tags: formatTags } : {})
    });
    if (sections.has("format_tags")) row.tags = tags;
    rows.push({ section: "format", row });
  }
  if (format === "json") {
    const result: Record<string, unknown> = {};
    if (sections.has("stream") || sections.has("stream_tags"))
      result.streams = rows.filter((r) => r.section === "stream").map((r) => r.row);
    const row = rows.find((r) => r.section === "format");
    if (row) result.format = row.row;
    return JSON.stringify(result, null, 4) + "\n";
  }
  const enabled = (a: string, b: string, fallback: boolean) => {
    const value = settings.get(a) ?? settings.get(b);
    return value === undefined ? fallback : value === "1";
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
      const sep = settings.get("item_sep") ?? settings.get("s") ?? (format === "csv" ? "," : "|");
      const quote = (value: string) =>
        format === "csv"
          ? value.includes(sep) || value.includes('"') || value.includes("\n")
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
        quote((enabled("nokey", "nk", format === "csv") ? "" : k + "=") + v)
      );
      if (enabled("print_section", "p", true)) values.unshift(section);
      lines.push(values.join(sep));
    } else if (format === "flat") {
      const prefix = section === "stream" ? `streams.stream.${streamIndex++}` : "format";
      for (const [key, value] of fields)
        lines.push(
          `${prefix}.${key.startsWith("tag:") ? "tags." + key.slice(4) : key}=${typeof value === "number" ? value : JSON.stringify(value)}`
        );
    } else {
      if (!enabled("noprint_wrappers", "nw", false)) lines.push("[" + section.toUpperCase() + "]");
      for (const [key, value] of fields)
        lines.push(
          (enabled("nokey", "nk", false)
            ? ""
            : (key.startsWith("tag:") ? "TAG:" + key.slice(4) : key) + "=") + value
        );
      if (!enabled("noprint_wrappers", "nw", false)) lines.push("[/" + section.toUpperCase() + "]");
    }
  }
  return lines.length ? lines.join("\n") + "\n" : "";
}
