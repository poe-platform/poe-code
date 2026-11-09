import type { MediaDocument, MediaAstRegistry, MediaBudgetTracker, MediaProbeResult, MediaProbePacket, MediaProbeFrame } from "@poe-code/mp4-ast";
import { resolvePath } from "./media.js";

// CLI duration options require complete FFmpeg duration strings.
export function parseHlsDuration(spec: string): number {
  let value = spec.trimStart();
  let scale = 1;
  if (value.endsWith("ms")) {
    scale = 1000;
    value = value.slice(0, -2);
  } else if (value.endsWith("us")) {
    scale = 1_000_000;
    value = value.slice(0, -2);
  } else if (value.endsWith("s")) {
    value = value.slice(0, -1);
  }
  const negative = value.startsWith("-");
  if (negative || value.startsWith("+")) value = value.slice(1);
  const parts = value.split(":");
  if (parts.length > 3) return NaN;
  let microseconds = 0;
  for (const [index, part] of parts.entries()) {
    const fields = part.split(".");
    if (fields.length > 2 || (fields.length === 2 && index !== parts.length - 1)
      || !fields[0] || Array.from(fields.join("")).some(char => char < "0" || char > "9")) return NaN;
    const number = Number(part);
    if (parts.length > 1 && (index > 0 || parts.length === 2) && number >= 60) return NaN;
    // FFmpeg reads at most six fractional digits, then truncates unit scaling.
    microseconds = microseconds * 60 + Number(fields[0]) * 1_000_000
      + Number((fields[1] ?? "").slice(0, 6).padEnd(6, "0"));
  }
  const seconds = Math.trunc(microseconds / scale) / 1_000_000;
  return negative ? -seconds : seconds;
}

export function parseConcatManifest(listText: string, directory: string, safe: boolean) {
  const streamIds: number[] = [];
  const streamTags: Record<string, string>[] = [];
  const chapters: NonNullable<MediaDocument["chapters"]>[number][] = [];
  const segments: { path: string; inpoint: number | undefined; outpoint: number | undefined; duration: number | undefined; ignoreEditList?: boolean; tags?: Record<string, string> }[] = [];

  const lines = listText.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
  for (let l = 0; l < lines.length; l++) {
    let line = lines[l]!;
    let start = 0;
    while (line[start] === " " || line[start] === "\t") start++;
    line = line.slice(start);
    if (!line || line.startsWith("#")) continue;
    const keyword = line.split(/[ \t]/, 1)[0]!;
    if (keyword === "option" && safe) {
      throw new Error(`Line ${l + 1}: option not allowed if safe`);
    }
    if (keyword === "ffconcat") {
      const [, declaration, version] = line.split("\t").join(" ").split(" ").filter(Boolean);
      if (declaration !== "version" || version !== "1.0") {
        throw new Error(`Line ${l + 1}: invalid version`);
      }
      continue;
    }
    const segment = segments[segments.length - 1];
    if (["duration", "inpoint", "outpoint", "option", "file_packet_meta"].includes(keyword) && !segment) {
      throw new Error(`Line ${l + 1}: ${keyword} without file`);
    }
    let cursor = keyword.length;
    const readToken = () => {
      // Match av_get_token: only single quotes group text; a
      // backslash escapes the next character outside quotes.
      let target = "";
      let protectedEnd = 0;
      const whitespace = " \t\r\n";
      while (cursor < line.length && whitespace.includes(line[cursor]!)) cursor++;
      while (cursor < line.length && !whitespace.includes(line[cursor]!)) {
        const char = line[cursor++]!;
        if (char === "\\" && cursor < line.length) {
          target += line[cursor++]!;
          protectedEnd = target.length;
        } else if (char === "'") {
          while (cursor < line.length && line[cursor] !== "'") target += line[cursor++]!;
          if (cursor < line.length) {
            cursor++;
            protectedEnd = target.length;
          }
        } else {
          target += char;
        }
      }
      while (target.length > protectedEnd && whitespace.includes(target[target.length - 1]!)) {
        target = target.slice(0, -1);
      }
      return target;
    };
    if (keyword === "stream") {
      streamIds.push(0);
      streamTags.push({});
    } else if (keyword === "stream_meta") {
      const tags = streamTags.at(-1);
      if (!tags) throw new Error(`Line ${l + 1}: stream_meta without stream`);
      const key = readToken();
      const value = readToken();
      if (!key || !value) throw new Error(`Line ${l + 1}: string required`);
      streamTags[streamTags.length - 1] = { ...tags, [key]: value };
    } else if (keyword === "exact_stream_id") {
      if (!streamIds.length) throw new Error(`Line ${l + 1}: exact_stream_id without stream`);
      const token = readToken();
      const id = Number(token);
      const digits = token.startsWith("-") || token.startsWith("+") ? token.slice(1) : token;
      if (!digits || Array.from(digits).some(char => char < "0" || char > "9") ||
        !Number.isInteger(id) || id < -2147483648 || id > 2147483647) {
        throw new Error(`Line ${l + 1}: invalid stream id '${token}'`);
      }
      streamIds[streamIds.length - 1] = id;
    } else if (keyword === "chapter") {
      const [idToken = "", startToken = "", endToken = ""] = line.slice(cursor).split("\t").join(" ").split(" ").filter(Boolean);
      const id = Number(idToken);
      const digits = idToken.startsWith("-") || idToken.startsWith("+") ? idToken.slice(1) : idToken;
      const startTimeSeconds = parseHlsDuration(startToken);
      const endTimeSeconds = parseHlsDuration(endToken);
      if (!digits || Array.from(digits).some(char => char < "0" || char > "9") || !Number.isSafeInteger(id)
        || !Number.isFinite(startTimeSeconds) || !Number.isFinite(endTimeSeconds)
        || Math.abs(startTimeSeconds) >= 2 ** 63 / 1_000_000 || Math.abs(endTimeSeconds) >= 2 ** 63 / 1_000_000
        || startTimeSeconds < 0 || endTimeSeconds < startTimeSeconds) {
        throw new Error(`Line ${l + 1}: invalid chapter`);
      }
      const chapter = { id, startTimeSeconds, endTimeSeconds, title: "", tags: {}, timeBase: { numerator: 1, denominator: 1_000_000 } };
      const existing = chapters.findIndex(item => item.id === id);
      if (existing < 0) chapters.push(chapter);
      else chapters[existing] = chapter;
    } else if (keyword === "file_packet_meta") {
      const key = readToken();
      const value = readToken();
      if (!key || !value) throw new Error(`Line ${l + 1}: string required`);
      segment!.tags = { ...segment!.tags, [key]: value };
    } else if (keyword === "option") {
      const name = readToken();
      const value = readToken();
      if (!name || !value) throw new Error(`Line ${l + 1}: option requires key and value`);
      if (name !== "ignore_editlist") throw new Error(`Unsupported concat file option '${name}'`);
      if (!["0", "1", "false", "true"].includes(value)) {
        throw new Error(`Invalid boolean value '${value}' for option '${name}'`);
      }
      segment!.ignoreEditList = value === "1" || value === "true";
    } else if (["inpoint", "outpoint", "duration"].includes(keyword)) {
      while (cursor < line.length && " \t".includes(line[cursor]!)) cursor++;
      const start = cursor;
      while (cursor < line.length && !" \t".includes(line[cursor]!)) cursor++;
      const value = line.slice(start, cursor);
      const seconds = parseHlsDuration(value);
      if (!Number.isFinite(seconds) || Math.abs(seconds) >= 2 ** 63 / 1_000_000) {
        throw new Error(`Line ${l + 1}: invalid ${keyword} '${value}'`);
      }
      if (keyword === "inpoint") segment!.inpoint = seconds;
      else if (keyword === "outpoint") segment!.outpoint = seconds;
      else segment!.duration = seconds;
    } else if (keyword === "file") {
      const target = readToken();
      if (safe && target.split("/").some(component =>
        !component || component.startsWith(".") || Array.from(component).some(char =>
          !(char >= "a" && char <= "z") && !(char >= "A" && char <= "Z") &&
          !(char >= "0" && char <= "9") && char !== "_" && char !== "-" && char !== "."
        )
      )) {
        throw new Error(`Unsafe file name '${target}'`);
      }
      const resolvedItem = resolvePath(directory, target);
      segments.push({ path: resolvedItem, inpoint: undefined, outpoint: undefined, duration: undefined });
    } else {
      throw new Error(`Line ${l + 1}: unknown keyword '${keyword}'`);
    }
  }
  return { segments, streamIds, streamTags, chapters };
}

export async function probeConcat(
  bytes: Uint8Array, filename: string, cwd: string,
  registry: MediaAstRegistry,
  readInput: (path: string) => Promise<Uint8Array>,
  budget: MediaBudgetTracker,
  safe: boolean, segmentTimeMetadata: boolean, showPackets: boolean, showFrames: boolean
): Promise<MediaProbeResult> {
  const path = resolvePath(cwd, filename);
  const { segments, streamIds, chapters } = parseConcatManifest(new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes), path.slice(0, path.lastIndexOf("/")) || "/", safe);
  if (streamIds.length) throw new Error("Concat stream declarations are not supported by ffprobe");
  budget.checkConcatInputs(segments.length);
  let first: MediaProbeResult | undefined;
  const packets: MediaProbePacket[] = [];
  const frames: MediaProbeFrame[] = [];
  const packetCounts: number[] = [], frameCounts: number[] = [];
  let start = 0;
  for (const segment of segments) {
    budget.checkCpu();
    if (segment.ignoreEditList) throw new Error("Concat ignore_editlist is not supported by ffprobe");
    if (segment.outpoint !== undefined && segment.outpoint < (segment.inpoint ?? 0)) throw new Error("outpoint must not precede inpoint");
    const input = await readInput(segment.path);
    const plugin = registry.detect(input, segment.path);
    if (!plugin?.canDemux) throw new Error(`${segment.path}: Unsupported input format`);
    const probe = plugin.probe(input, { filename: segment.path, budget, showPackets, showFrames,
      // Preserve the 4096-byte WAV packet boundaries used by the concat reference.
      ...(plugin.id === "wav" ? { maxSize: 4096 } : {}) });
    first ??= probe;
    const inpoint = segment.inpoint ?? Number(probe.format.start_time ?? 0);
    const duration = segment.duration ?? (segment.outpoint === undefined ? Number(probe.format.duration) - inpoint : segment.outpoint - inpoint);
    const tags = { ...segment.tags, ...(segmentTimeMetadata ? {
      "lavf.concatdec.start_time": String(Math.round(start * 1_000_000)),
      ...(Number.isFinite(duration) ? { "lavf.concatdec.duration": String(Math.round(duration * 1_000_000)) } : {})
    } : {}) };
    const offset = start - inpoint;
    const ticks = (index: number) => {
      const [num, den] = probe.streams.find(stream => stream.index === index)!.time_base.split("/").map(Number);
      return Math.round(offset * den! / num!);
    };
    for (const packet of probe.packets ?? []) {
      if (Number(packet.dts_time) < inpoint || segment.outpoint !== undefined && Number(packet.dts_time) >= segment.outpoint) continue;
      budget.checkSamples(packets.length + 1);
      packetCounts[packet.stream_index] = (packetCounts[packet.stream_index] ?? 0) + 1;
      packets.push({ ...packet, pts: packet.pts + ticks(packet.stream_index), dts: packet.dts + ticks(packet.stream_index),
        pts_time: (Number(packet.pts_time) + offset).toFixed(6), dts_time: (Number(packet.dts_time) + offset).toFixed(6),
        ...(Object.keys(tags).length ? { tags, side_data_list: [...(packet.side_data_list ?? []), { side_data_type: "Strings Metadata" }] } : {}) });
    }
    for (const frame of probe.frames ?? []) {
      if (Number(frame.pts_time) < inpoint || segment.outpoint !== undefined && Number(frame.pts_time) >= segment.outpoint) continue;
      budget.checkSamples(frames.length + 1);
      frameCounts[frame.stream_index] = (frameCounts[frame.stream_index] ?? 0) + 1;
      const shift = ticks(frame.stream_index);
      frames.push({ ...frame, pts: frame.pts + shift, pts_time: (Number(frame.pts_time) + offset).toFixed(6),
        ...(frame.pkt_dts !== undefined ? { pkt_dts: frame.pkt_dts + shift, pkt_dts_time: (Number(frame.pkt_dts_time) + offset).toFixed(6) } : {}),
        ...(frame.best_effort_timestamp !== undefined ? { best_effort_timestamp: frame.best_effort_timestamp + shift, best_effort_timestamp_time: (Number(frame.best_effort_timestamp_time) + offset).toFixed(6) } : {}) });
    }
    start += Number.isFinite(duration) ? duration : Math.max(0, ...(probe.packets ?? []).map(packet => Number(packet.dts_time) + Number(packet.duration_time ?? 0) - inpoint));
  }
  if (!first) throw new Error("Concat input contains no files");
  return { ...first, packets, frames,
    streams: first.streams.map(stream => ({ ...stream,
      nb_read_packets: String(packetCounts[stream.index] ?? 0), nb_read_frames: String(frameCounts[stream.index] ?? 0)
    })),
    format: { ...first.format, filename, format_name: "concat", format_long_name: "Virtual concatenation script", duration: start.toFixed(6), size: "N/A", bit_rate: "N/A", start_time: "0.000000" },
    chapters: chapters.map(chapter => ({ id: chapter.id, time_base: "1/1000000", start: Math.round(chapter.startTimeSeconds * 1_000_000), end: Math.round(chapter.endTimeSeconds * 1_000_000), start_time: chapter.startTimeSeconds.toFixed(6), end_time: chapter.endTimeSeconds.toFixed(6), tags: chapter.tags ?? {} }))
  };
}
