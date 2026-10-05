import { formatProbeText, isProbeText, probeJsonSteps, type ProbeOutputPart } from './probe-text.js';
import { PagedStorage, IntegerTable } from "@poe-code/safe-fs/storage";
import { probeStoredOgg } from "./ogg-probe.js";
import { yieldTurn } from "safe-bash-contracts/yield";
import { FlacTags } from "./flac-tags.js";
import { SourceAudioTags } from "./source-tags.js";
import { resolveFfprobeLimits } from "./options.js";
import { formatTaggedAudio, formatTaggedRows, type TaggedAudioRow, type StoredAudioTags } from "./tag-format.js";
import { writeProbeOutput } from "./probe-output.js";
import { openProbeStream, sniffMediaStream, withStagedProbeSource } from "./stream-input.js";
import { probe as probeAudio, parseArguments as parseAudioArguments, formatAudioProbe } from "./probe.js";
import { probeWavSource, probeFlacSource, probeMp3Source, type AudioAst } from "@poe-code/audio-ast";
import { commandRuntimeIdentity, getCommandArguments, type CommandContext, type CommandDefinition } from "safe-bash-contracts/command";
import { readBytes, writeBytes } from "safe-bash-contracts/io";
import { probeMp4Source, scanMp4Frames, scanMp4Packets, allMediaAsts, probeOggFlacSource, probeOggStreamMetadata, createMediaAstRegistry, encodeUtf8, parseStreamingManifest, MediaBudgetTracker,
  type MediaAstPlugin, type MediaProbeSource, type MediaFeatureOptions, type MediaProbeResult, type MediaProbeRecords, type MediaProbeSourceRecords, type MediaProbeStream, type MediaResourceLimits } from "@poe-code/mp4-ast";

export interface MediaCommandsOptions {
  /**
   * Pluggable AST engines that determine which container formats, extensions,
   * demuxers, muxers, and codecs are supported by `ffmpeg` and `ffprobe`.
   * Defaults to `allMediaAsts()` when omitted.
   */
  readonly asts?: readonly MediaAstPlugin[] | undefined;
  /**
   * Consumer-defined resource limits.
   * No limits are imposed by default (`undefined`).
   * Pass `cloudflareWorkerLimits()` for Cloudflare Worker environments.
   */
  readonly limits?: MediaResourceLimits | undefined;
  /**
   * Opt-in / opt-out toggles for heavy capabilities.
   */
  readonly features?: MediaFeatureOptions | undefined;
  /**
   * Optional callback invoked after each command execution with memory & frame telemetry.
   */
  readonly onMetrics?: (stats: {
    currentMemoryBytes: number;
    peakMemoryBytes: number;
    decodedFrames: number;
    elapsedMs: number;
  }) => void | undefined;
  readonly replace?: boolean | undefined;
}

export function isStdin(path: string): boolean {
  return ["-", "pipe:", "pipe:0", "/dev/stdin", "/dev/fd/0"].includes(path);
}

export function rethrowRuntimeError(context: CommandContext, error: unknown): void {
  context.signal.throwIfAborted();
  if (error instanceof Error && (error.name === "BudgetExceededError" || error.name === "AbortError")) throw error;
  if (typeof error === "object" && error !== null && "code" in error && error.code === "EPIPE") throw error;
}

export function createInputReader(context: CommandContext, budget: MediaBudgetTracker) {
  let total = 0;
  const account = (bytes: Uint8Array, validate = true) => {
    context.signal.throwIfAborted();
    total += bytes.byteLength;
    if (validate) { context.inputBudget?.check(total); budget.checkInputBytes(total); }
  };
  return async (path: string, source?: AsyncIterable<Uint8Array>, admitted = false): Promise<Uint8Array> => {
    if (source || isStdin(path)) return readStdinAll(context, bytes => account(bytes, !admitted), source);
    const bytes = await context.fs.readFile(resolvePath(context.cwd, path), {
      signal: context.signal,
      ...(budget.limits.maxInputBytes === undefined ? {} : { maxBytes: Math.max(0, budget.limits.maxInputBytes - total) })
    });
    account(bytes);
    return bytes;
  };
}

export async function loadManifestResources(
  plugin: MediaAstPlugin,
  bytes: Uint8Array,
  filename: string,
  cwd: string,
  readInput: (path: string) => Promise<Uint8Array>,
  budget: MediaBudgetTracker
): Promise<((uri: string) => Uint8Array) | undefined> {
  if (plugin.id !== "hls" && plugin.id !== "dash") return undefined;
  const manifest = parseStreamingManifest(bytes, plugin.id, { budget });
  const path = resolvePath(cwd, filename);
  const directory = path.slice(0, path.lastIndexOf("/")) || "/";
  const resources = new Map<string, Uint8Array>();
  for (const sequence of manifest.sequences) {
    for (const segment of sequence) {
      for (const uri of [segment.initialization, segment.uri]) {
        if (uri === undefined || resources.has(uri)) continue;
        if (uri.includes(":") && !uri.startsWith("file:")) throw new Error("Streaming media requires local segment files");
        resources.set(uri, await readInput(resolvePath(directory, uri)));
      }
    }
  }
  return uri => {
    const data = resources.get(uri);
    if (!data) throw new Error(`Missing streaming resource: ${uri}`);
    return data;
  };
}

async function readStdinAll(context: CommandContext, account: (bytes: Uint8Array) => void, source = context.stdin): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of readBytes(source, context.signal)) {
    account(chunk);
    chunks.push(new Uint8Array(chunk));
    total += chunk.byteLength;
  }
  const out = new Uint8Array(total);
  let pos = 0;
  for (const ch of chunks) {
    out.set(ch, pos);
    pos += ch.byteLength;
  }
  return out;
}

export function resolvePath(cwd: string, p: string): string {
  if (p.startsWith("file:")) {
    p = p.slice(5);
  }
  if (p.startsWith("/")) return normalizePath(p);
  return normalizePath(`${cwd.endsWith("/") ? cwd : `${cwd}/`}${p}`);
}

function normalizePath(p: string): string {
  const parts = p.split("/");
  const stack: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      stack.pop();
    } else {
      stack.push(part);
    }
  }
  return "/" + stack.join("/");
}

export function formatIntrospectionOutput(
  flag: string,
  plugins: readonly MediaAstPlugin[],
  command: "ffmpeg" | "ffprobe" = "ffmpeg"
): string {
  if (flag === "-version" || flag === "--version") {
    const astIds = plugins.map((p) => p.id).join(", ");
    return [
      `${command} version 7.1-safe-bash Copyright (c) 2000-2025 the FFmpeg developers`,
      `  built with @poe-code/mp4-ast (registered ASTs: ${astIds || "none"})`,
      "  libavutil      59. 39.100 / 59. 39.100",
      "  libavcodec     61. 19.100 / 61. 19.100",
      "  libavformat    61.  7.100 / 61.  7.100",
      "  libavfilter    10.  4.100 / 10.  4.100",
      ""
    ].join("\n");
  }

  if (flag === "-formats" || flag === "-demuxers" || flag === "-muxers") {
    const lines = [
      "File formats:",
      " D. = Demuxing supported",
      " .E = Muxing supported",
      " --"
    ];
    for (const p of plugins) {
      if (flag === "-demuxers" && !p.canDemux) continue;
      if (flag === "-muxers" && !p.canMux) continue;
      const d = p.canDemux ? "D" : " ";
      const e = p.canMux ? "E" : " ";
      lines.push(` ${d}${e} ${p.formatName.padEnd(20, " ")} ${p.formatLongName}`);
    }
    lines.push("");
    return lines.join("\n");
  }

  if (flag === "-codecs" || flag === "-decoders" || flag === "-encoders") {
    const videoCodecs = new Set<string>();
    const audioCodecs = new Set<string>();
    for (const p of plugins) {
      for (const c of p.supportedVideoCodecs) videoCodecs.add(c);
      for (const c of p.supportedAudioCodecs) audioCodecs.add(c);
    }
    const lines = [
      "Codecs:",
      " D..... = Decoding supported",
      " .E.... = Encoding supported",
      " ..V... = Video codec",
      " ..A... = Audio codec",
      " ------"
    ];
    for (const vc of videoCodecs) {
      lines.push(` DEV.LS ${vc.padEnd(18, " ")} ${vc} video`);
    }
    for (const ac of audioCodecs) {
      lines.push(` DEA.L. ${ac.padEnd(18, " ")} ${ac} audio`);
    }
    lines.push("");
    return lines.join("\n");
  }

  if (flag === "-protocols") {
    return ["Supported file protocols:", "Input:", "  file", "  pipe", "  concat", "Output:", "  file", "  pipe", ""].join("\n");
  }

  if (flag === "-filters") {
    return [
      "Filters:",
      "  scale            V->V       Scale the input video size.",
      "  crop             V->V       Crop the input video.",
      "  pad              V->V       Pad the input video.",
      "  fps              V->V       Force constant framerate.",
      "  hflip            V->V       Horizontally flip the input video.",
      "  vflip            V->V       Vertically flip the input video.",
      "  transpose        V->V       Transpose rows with columns.",
      "  negate           V->V       Negate input video.",
      "  drawbox          V->V       Draw a colored box on the input video.",
      "  overlay          VV->V      Overlay a video source on top of the input.",
      "  hstack           N->V       Stack video inputs horizontally.",
      "  vstack           N->V       Stack video inputs vertically.",
      "  concat           N->N       Concatenate audio and video streams.",
      "  volume           A->A       Change input volume.",
      ""
    ].join("\n");
  }

  return [
    command === "ffprobe" ? "Multimedia stream analyzer (safe-bash pure-AST engine)" : "Hyper fast Audio and Video encoder (safe-bash pure-AST engine)",
    command === "ffprobe" ? "usage: ffprobe [options] input_file" : "usage: ffmpeg [options] [[infile options] -i infile]... {[outfile options] outfile}...",
    ""
  ].join("\n");
}

type AudioProbeReady = (audio: Awaited<ReturnType<typeof probeWavSource>> & { nodes?: AudioAst["nodes"] }, size: number, tags: StoredAudioTags) => void;

type AudioProbeInput = { bytes: Uint8Array; args: readonly string[] } | { audio: Omit<AudioAst, "data" | "nodes" | "pictures"> & { nodes?: AudioAst["nodes"] }; size: number; args: readonly string[] };

export type FfprobeFormatOptions = {
    printFormat: string;
    showFormat: boolean;
    showStreams: boolean;
    showPackets: boolean;
    showFrames: boolean;
    showChapters: boolean;
    showPrograms: boolean;
    selectStreams?: string | undefined;
    showEntries?: string | undefined;
    countFrames?: boolean | undefined;
    countPackets?: boolean | undefined;
  };

/** Explicit buffering convenience for synchronous callers. */
export function formatFfprobeResult(probe: MediaProbeResult, opts: FfprobeFormatOptions, audioInput?: AudioProbeInput): string {
  return Array.from(formatFfprobeResultChunks(probe, opts, audioInput)).join("");
}

/** Output selection may omit format metadata entirely, as in a packet-only scan. */
type ProbeSourceRows = Omit<MediaProbeSourceRecords, "format"> & { readonly format?: MediaProbeSourceRecords["format"] };
type SyncProbeRows = Omit<MediaProbeRecords, "streams" | "chapters"> & {
  readonly streams: Iterable<MediaProbeStream>;
  readonly chapters: Iterable<MediaProbeResult["chapters"][number]>;
};
type FormatStep = ProbeOutputPart | {
  rows: Iterable<unknown> | AsyncIterable<unknown>;
  render: (row: unknown, index: number) => Iterable<ProbeOutputPart>;
};

function formatQualifiedAudio(probe: ProbeSourceRows, opts: FfprobeFormatOptions, audioInput?: AudioProbeInput): string | undefined {
  // Both execution paths retain qualified audio schemas while media-only options
  // and mixed streams use the general media formatter.
  if (audioInput && !opts.showPackets && !opts.showFrames && !opts.showChapters && !opts.showPrograms && !opts.countFrames && !opts.countPackets &&
      Array.isArray(probe.streams) && probe.streams.length > 0 && probe.streams.every(stream => stream.codec_type === "audio")) {
    let formatted: string | undefined;
    try { formatted = "bytes" in audioInput ? probeAudio(audioInput.bytes, audioInput.args) : formatAudioProbe({ ...audioInput.audio, nodes: audioInput.audio.nodes ?? [] }, audioInput.size, parseAudioArguments(audioInput.args)); } catch { /* Other containers and extended options use the media formatter. */ }
    return formatted;
  }
}

export function* formatFfprobeResultChunks(probe: SyncProbeRows, opts: FfprobeFormatOptions, audioInput?: AudioProbeInput): Generator<string> {
  const audio = formatQualifiedAudio(probe, opts, audioInput);
  if (audio !== undefined) { yield audio; return; }
  for (const step of formatProbeSteps(probe, opts)) {
    if (typeof step === "string") { yield step; continue; }
    if ("text" in step) throw new TypeError("Source text requires asynchronous formatting");
    let index = 0;
    for (const row of step.rows as Iterable<unknown>) for (const part of step.render(row, index++)) {
      if (typeof part !== "string") throw new TypeError("Source text requires asynchronous formatting");
      yield part;
    }
  }
}

/** Consume one-shot caller-backed records with backpressure and iterator cleanup. */
export async function* formatFfprobeSourceChunks(probe: ProbeSourceRows, opts: FfprobeFormatOptions, audioInput?: AudioProbeInput, signal?: AbortSignal): AsyncGenerator<string> {
  signal?.throwIfAborted();
  const audio = formatQualifiedAudio(probe, opts, audioInput);
  if (audio !== undefined) { yield audio; return; }
  for (const step of formatProbeSteps(probe, opts)) {
    signal?.throwIfAborted();
    if (typeof step === "string") { yield step; continue; }
    if ("text" in step) { yield* formatProbeText(step, signal); continue; }
    const iterator = Symbol.asyncIterator in step.rows ? step.rows[Symbol.asyncIterator]() : step.rows[Symbol.iterator]();
    let index = 0, ended = false, failed = false;
    try {
      for (;;) {
        signal?.throwIfAborted();
        const next = await iterator.next();
        signal?.throwIfAborted();
        if (next.done) { ended = true; break; }
        for (const part of step.render(next.value, index++)) {
          if (typeof part === "string") yield part; else yield* formatProbeText(part, signal);
        }
        if (index % 256 === 0) await yieldTurn(signal);
      }
    } catch (error) { failed = true; throw error; }
    finally {
      if (!ended) {
        if (failed) { try { await iterator.return?.(); } catch { /* Preserve the primary failure. */ } }
        else await iterator.return?.();
      }
    }
  }
}

function parseEntryFilter(showEntries: string | undefined): Map<string, Set<string>> {
  const entryFilter = new Map<string, Set<string>>();
  if (showEntries) {
    for (const secSpec of showEntries.split(":")) {
      if (!secSpec.trim()) continue;
      const eqIdx = secSpec.indexOf("=");
      if (eqIdx >= 0) {
        const secName = secSpec.slice(0, eqIdx).trim().toLowerCase();
        const fields = secSpec
          .slice(eqIdx + 1)
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean);
        entryFilter.set(secName, new Set(fields));
      } else {
        entryFilter.set(secSpec.trim().toLowerCase(), new Set());
      }
    }
  }

  return entryFilter;
}

function* formatProbeSteps(probe: ProbeSourceRows, opts: FfprobeFormatOptions): Generator<FormatStep> {
  const entryFilter = parseEntryFilter(opts.showEntries);

  const filterObject = (
    obj: Record<string, unknown>,
    sectionName: string,
    tagsSectionName?: string
  ): Record<string, unknown> => {
    if (entryFilter.size === 0) return obj;
    const allowed = entryFilter.get(sectionName);
    const allowedTags = tagsSectionName ? entryFilter.get(tagsSectionName) : undefined;
    if (!allowed && !allowedTags) return obj;

    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (k === "tags" && v && typeof v === "object") {
        if (allowedTags) {
          if (allowedTags.size === 0) {
            out.tags = v;
          } else {
            const filteredTags: Record<string, unknown> = {};
            for (const [tk, tv] of Object.entries(v as Record<string, unknown>)) {
              if (allowedTags.has(tk)) filteredTags[tk] = tv;
            }
            out.tags = filteredTags;
          }
        } else if (allowed && (allowed.size === 0 || allowed.has("tags"))) {
          out.tags = v;
        }
        continue;
      }
      if (allowed && (allowed.size === 0 || allowed.has(k))) {
        out[k] = v;
      }
    }
    return out;
  };

  const includeStreams =
    opts.showStreams || entryFilter.has("stream") || entryFilter.has("stream_tags");
  const includeFormat =
    opts.showFormat || entryFilter.has("format") || entryFilter.has("format_tags");
  const includePackets = opts.showPackets || entryFilter.has("packet");
  const includeFrames = opts.showFrames || entryFilter.has("frame");
  const includeChapters = opts.showChapters || entryFilter.has("chapter");
  const includePrograms = opts.showPrograms || entryFilter.has("program");

  let typeOrdinal = 0;
  const prepareStream = (row: unknown): Record<string, unknown> | undefined => {
    const stream = row as MediaProbeStream, spec = opts.selectStreams?.toLowerCase();
    if (spec) {
      const type = spec[0] === "v" ? "video" : spec[0] === "a" ? "audio" : spec[0] === "s" ? "subtitle" : undefined;
      if ((spec === "v" || spec === "a" || spec === "s") && stream.codec_type !== type) return;
      if (spec.startsWith("v:") || spec.startsWith("a:")) {
        if (stream.codec_type !== type) return;
        if (typeOrdinal++ !== (parseInt(spec.slice(2), 10) || 0)) return;
      } else if ([...spec].every(c => c >= "0" && c <= "9") && stream.index !== parseInt(spec, 10)) return;
    }
    return filterObject({ ...stream,
      ...(opts.countFrames ? { nb_read_frames: stream.nb_frames ?? "0" } : {}),
      ...(opts.countPackets ? { nb_read_packets: stream.nb_frames ?? "0" } : {})
    }, "stream", "stream_tags");
  };
  const finalFormat = includeFormat && probe.format
    ? filterObject(probe.format as unknown as Record<string, unknown>, "format", "format_tags")
    : undefined;
  const [fmtNameRaw, ...fmtParams] = opts.printFormat.split(":");
  const rawHead = fmtNameRaw ?? "default";
  const headEq = rawHead.indexOf("=");
  const fmt = (headEq >= 0 ? rawHead.slice(0, headEq) : rawHead).toLowerCase();
  const allParams = headEq >= 0 ? [rawHead.slice(headEq + 1), ...fmtParams] : fmtParams;
  const paramMap: Record<string, string> = {};
  for (const p of allParams) {
    const eq = p.indexOf("=");
    if (eq >= 0) {
      paramMap[p.slice(0, eq).trim()] = p.slice(eq + 1).trim();
    } else if (p.trim()) {
      paramMap[p.trim()] = "1";
    }
  }

  if (fmt === "json") {
    const sections: { name: string; rows?: Iterable<unknown> | AsyncIterable<unknown>; value?: unknown }[] = [];
    if (includePrograms) sections.push({ name: "programs", rows: [] });
    if (includePackets && probe.packets) sections.push({ name: "packets", rows: probe.packets });
    if (includeFrames && probe.frames) sections.push({ name: "frames", rows: probe.frames });
    if (includeStreams) sections.push({ name: "streams", rows: probe.streams });
    if (includeChapters) sections.push({ name: "chapters", rows: probe.chapters });
    if (finalFormat !== undefined) sections.push({ name: "format", value: finalFormat });
    const compact = paramMap.c === "1" || paramMap.compact === "1";
    yield "{";
    let firstSection = true;
    for (const section of sections) {
      yield (firstSection ? "" : ",") + (compact ? "" : "\n  ") + JSON.stringify(section.name) + (compact ? ":" : ": ");
      firstSection = false;
      if (section.rows) {
        yield "[";
        let firstRow = true;
        yield { rows: section.rows, *render(row) {
          if (section.name === "streams") { row = prepareStream(row); if (row === undefined) return; }
          else if (section.name === "packets" || section.name === "frames") row = filterObject(row as Record<string, unknown>, section.name === "packets" ? "packet" : "frame");
          yield (firstRow ? "" : ",") + (compact ? "" : "\n    ");
          firstRow = false;
          yield* probeJsonSteps(row, compact, 2);
        } };
        yield (compact || firstRow ? "" : "\n  ") + "]";
      } else {
        yield* probeJsonSteps(section.value, compact, 1);
      }
    }
    yield (compact || firstSection ? "" : "\n") + "}\n";
    return;
  }
  const noWrappers =
    paramMap.noprint_wrappers === "1" || paramMap.nw === "1";
  const noKey = paramMap.nokey === "1" || paramMap.nk === "1";

  function probeEntries(section: Record<string, unknown>, tagPrefix: string): [string, unknown][] {
    return Object.entries(section).flatMap(([key, value]) =>
      key === "tags" && value && typeof value === "object"
        ? Object.entries(value).map(([tag, text]): [string, unknown] => [tagPrefix + tag, text])
        : [[key, value]]
    );
  }

  function probeText(value: unknown, separator = "."): ProbeOutputPart {
    if (isProbeText(value)) return { text: value, mode: fmt === "csv" || fmt === "flat" ? fmt : "compact", separator };
    if (fmt === "flat" && typeof value === "number") return String(value);
    const text = String(value);
    if (fmt === "csv") {
      return [separator, '"', "\n", "\r"].some(character => text.includes(character))
        ? '"' + text.replaceAll('"', '""') + '"'
        : text;
    }
    let escaped = "";
    for (const character of text) {
      if (character === "\n") escaped += "\\n";
      else if (character === "\r") escaped += "\\r";
      else if (character === "\\" || (fmt === "flat" ? character === '"' : character === separator)) escaped += "\\" + character;
      else escaped += character;
    }
    return fmt === "flat" ? '"' + escaped + '"' : escaped;
  }

  let streamIndex = 0;
  function* render(section: Record<string, unknown>, name: string, index = 0): Generator<ProbeOutputPart> {
    if (fmt === "csv" || fmt === "compact") {
      const sep = fmt === "csv" ? (paramMap.s ?? ",") : (paramMap.s ?? "|");
      const printSection = paramMap.p !== "0" && paramMap.print_section !== "0";
      let first = true;
      if (printSection) { yield name; first = false; }
      for (const [key, value] of probeEntries(section, "tag:")) {
        if (value === undefined || typeof value === "object" && !isProbeText(value)) continue;
        if (!first) yield sep;
        first = false;
        if (!noKey && fmt !== "csv") yield `${key}=`;
        yield probeText(value, sep);
      }
      yield "\n";
    } else if (fmt === "flat") {
      const sep = paramMap.s ?? ".", prefix = name === "stream" ? `streams${sep}stream${sep}${index}${sep}` : name === "packet" || name === "frame" ? `${name}s${sep}${name}${sep}${index}${sep}` : `format${sep}`;
      for (const [key, value] of probeEntries(section, `tags${sep}`)) {
        if (value === undefined || typeof value === "object" && !isProbeText(value)) continue;
        yield `${prefix}${key}=`; yield probeText(value); yield "\n";
      }
    } else {
      const wrapper = name.toUpperCase();
      if (!noWrappers) yield `[${wrapper}]\n`;
      for (const [key, value] of Object.entries(section)) {
        if (value === undefined) continue;
        if (key === "tags" && value && typeof value === "object") {
          for (const [tag, text] of Object.entries(value)) {
            if (!noKey) yield `TAG:${tag}=`;
            yield isProbeText(text) ? { text, mode: "plain" } : String(text); yield "\n";
          }
        } else if (typeof value !== "object") yield (noKey ? String(value) : `${key}=${String(value)}`) + "\n";
      }
      if (!noWrappers) yield `[/${wrapper}]\n`;
    }
  }
  if (includePackets && probe.packets) yield { rows: probe.packets, *render(row, index) {
    yield* render(filterObject(row as Record<string, unknown>, "packet"), "packet", index);
  } };
  if (includeFrames && probe.frames) yield { rows: probe.frames, *render(row, index) {
    yield* render(filterObject(row as Record<string, unknown>, "frame"), "frame", index);
  } };
  if (includeStreams) yield { rows: probe.streams, *render(row) {
    const stream = prepareStream(row);
    if (stream !== undefined) yield* render(stream, "stream", streamIndex++);
  } };
  if (includeChapters && fmt !== "csv" && fmt !== "compact" && fmt !== "flat") yield { rows: probe.chapters, *render(row) {
    const chapter = row as MediaProbeResult["chapters"][number];
    yield* render({ id: chapter.id, time_base: chapter.time_base, start: chapter.start, start_time: chapter.start_time, end: chapter.end, end_time: chapter.end_time, tags: chapter.tags }, "chapter");
  } };
  if (finalFormat) yield* render(finalFormat, "format");
}

let defaultAstPluginsCache: readonly MediaAstPlugin[] | undefined;
let defaultRegistryCache: ReturnType<typeof createMediaAstRegistry> | undefined;

export function getDefaultMediaRegistry(): { astPlugins: readonly MediaAstPlugin[]; registry: ReturnType<typeof createMediaAstRegistry> } {
  if (!defaultAstPluginsCache || !defaultRegistryCache) {
    defaultAstPluginsCache = allMediaAsts();
    defaultRegistryCache = createMediaAstRegistry(defaultAstPluginsCache);
  }
  return { astPlugins: defaultAstPluginsCache, registry: defaultRegistryCache };
}

function parseProbeArguments(args: readonly string[]) {
  let printFormat = "default", showFormat = false, showStreams = false,
    showPackets = false, showFrames = false, showChapters = false, showPrograms = false,
    countFrames = false, countPackets = false;
  let selectStreams: string | undefined, showEntries: string | undefined,
    explicitFormat: string | undefined, inputTarget: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    const value = () => {
      const next = args[++i];
      if (next === undefined) throw new Error(`Missing value for ${arg}`);
      return next;
    };
    if (arg === "-v" || arg === "-loglevel") value();
    else if (arg === "-hide_banner") continue;
    else if (arg === "-of" || arg === "-print_format") printFormat = value();
    else if (arg === "-show_format") showFormat = true;
    else if (arg === "-show_streams") showStreams = true;
    else if (arg === "-show_packets") showPackets = true;
    else if (arg === "-show_frames") showFrames = true;
    else if (arg === "-show_chapters") showChapters = true;
    else if (arg === "-show_programs") showPrograms = true;
    else if (arg === "-count_frames") countFrames = true;
    else if (arg === "-count_packets") countPackets = true;
    else if (arg === "-select_streams") selectStreams = value();
    else if (arg === "-show_entries") showEntries = value();
    else if (arg === "-f") explicitFormat = value();
    else {
      const input = arg === "-i" ? value() : arg;
      if (arg !== "-i" && input.startsWith("-") && input !== "-") throw new Error(`Unknown option ${input}`);
      if (inputTarget !== undefined) throw new Error("Expected one input");
      inputTarget = input;
    }
  }
  if (!inputTarget) throw new Error("must specify an input file");
  const [head = "default", ...parameters] = printFormat.split(":");
  const equals = head.indexOf("=");
  const writer = (equals < 0 ? head : head.slice(0, equals)).toLowerCase();
  if (!["json", "compact", "csv", "default", "flat"].includes(writer)) throw new Error(`Unknown output format ${writer}`);
  if (equals >= 0) parameters.unshift(head.slice(equals + 1));
  for (const parameter of parameters) {
    const key = parameter.split("=")[0]!;
    if (!["c", "compact", "nokey", "nk", "noprint_wrappers", "nw", "print_section", "p", "item_sep", "s"].includes(key))
      throw new Error(`Unsupported writer option ${key}`);
  }
  if (!showFormat && !showStreams && !showPackets && !showFrames && !showChapters && !showPrograms && showEntries === undefined) {
    showFormat = true;
    showStreams = true;
  }
  return { printFormat, showFormat, showStreams, showPackets, showFrames, showChapters, showPrograms,
    selectStreams, showEntries, countFrames, countPackets, explicitFormat, inputTarget };
}

type SourceProbe = ProbeSourceRows | { oggRows: (args: readonly string[]) => AsyncIterable<TaggedAudioRow> };

async function probeSourceMetadata(context: CommandContext, plugins: readonly MediaAstPlugin[], input: MediaProbeSource, filename: string, budget: MediaBudgetTracker, records: { showPackets: boolean; showFrames: boolean; mp4Records?: { packets: boolean; frames: boolean; metadata: boolean } }, onAudio: AudioProbeReady | undefined, retain: (close: () => Promise<void>) => void, detect = false): Promise<SourceProbe | undefined> {
  let sourceFailed = false;
  const source: MediaProbeSource = { size: input.size, async read(offset, length) {
    try {
      const bytes = await input.read(offset, length);
      if (bytes.length !== length) throw new Error("Truncated or invalid audio structure");
      return bytes;
    }
    catch (error) { sourceFailed = true; throw error; }
  } };
  let plugin = plugins[0];
  if (detect) {
    const header = await source.read(0, Math.min(12, input.size));
    context.signal.throwIfAborted();
    plugin = plugins.find(candidate => candidate.detect(header, filename));
  }
  if (!plugin) return undefined;
  if (records.mp4Records && (plugin.id === "mp4" || plugin.id === "mov")) {
    const storage = new PagedStorage(context, 4);
    retain(storage.close.bind(storage));
    const scanOptions = {
      budget, signal: context.signal, checkpoint: () => yieldTurn(context.signal),
      syncSamples() {
        const keys = new IntegerTable(storage, 128);
        return { async add(sample: number) { await keys.set(BigInt(sample), 1n); }, async has(sample: number) { return await keys.get(BigInt(sample)) === 1n; } };
      }
    };
    if (records.mp4Records.metadata) return probeMp4Source(source, { ...scanOptions, filename, showPackets: records.mp4Records.packets, showFrames: records.mp4Records.frames });
    return { streams: [], chapters: [],
      ...(records.mp4Records.packets ? { packets: scanMp4Packets(source, scanOptions) } : {}),
      ...(records.mp4Records.frames ? { frames: scanMp4Frames(source, scanOptions) } : {}) };
  }

  if (plugin.formatName === "ogg" && !plugin.probeRecords && !plugin.probeMetadata) {
    const probeOptions = { ...records, filename, signal: context.signal, budget, limits: budget.limits, checkpoint: () => yieldTurn(context.signal) };
    const flac = await probeOggFlacSource(source, probeOptions);
    if (flac) return flac;
    const ogg = await probeStoredOgg(source, context, retain);
    return onAudio ? { oggRows: ogg.rows } : probeOggStreamMetadata(ogg.first, source.size, probeOptions);
  }
  const result: MediaProbeSourceRecords = await (plugin.probeRecords ?? plugin.probeMetadata)!.call(plugin, source, { ...records, filename, signal: context.signal, budget, limits: budget.limits });
  if (result.close) retain(result.close.bind(result));
  if (onAudio) {
    const tags = plugin.formatName === "flac" ? new FlacTags(source, context) : new SourceAudioTags(source, context);
    retain(tags.close);
    let checkpoints = 0;
    try {
      const audio = tags instanceof FlacTags
        ? await probeFlacSource(source, { signal: context.signal, onComment: async span => {
          try { await tags.add(span); } catch (error) { sourceFailed = true; throw error; }
        } })
        : plugin.formatName === "mp3" ? await probeMp3Source(source, { signal: context.signal, checkpoint: async () => { if (++checkpoints % 256 === 0) await yieldTurn(context.signal); }, onTag: async span => {
          try { await tags.add(span); } catch (error) { sourceFailed = true; throw error; }
        } })
        : await probeWavSource(source, { signal: context.signal, onTag: async span => {
          try { await tags.add(span); } catch (error) { sourceFailed = true; throw error; }
        } });
      onAudio(audio, input.size, tags);
    } catch (error) {
      context.signal.throwIfAborted();
      if (sourceFailed) throw error;
      // Match the byte path: invalid strict audio structures retain the media schema.
    }
  }
  return result;
}

async function probeRetainedMetadata(context: CommandContext, plugins: readonly MediaAstPlugin[], path: string, filename: string, budget: MediaBudgetTracker, records: { showPackets: boolean; showFrames: boolean; mp4Records?: { packets: boolean; frames: boolean; metadata: boolean } }, onAudio: AudioProbeReady | undefined, retain: (close: () => Promise<void>) => void, detect = false): Promise<SourceProbe | undefined> {
  if (!plugins.length || !context.fs.openReadFile) return undefined;
  context.signal.throwIfAborted();
  const capabilities = await context.fs.capabilitiesFor?.(path, { signal: context.signal }) ?? context.fs.capabilities;
  context.signal.throwIfAborted();
  if (capabilities.retainedRead !== true) return undefined;
  const handle = await context.fs.openReadFile(path, { signal: context.signal });
  retain(handle.close.bind(handle));
  context.signal.throwIfAborted();
  const stat = await handle.stat({ signal: context.signal });
  context.signal.throwIfAborted();
  if (!Number.isSafeInteger(stat.size) || stat.size < 0) throw new Error("Invalid media source size");
  context.inputBudget?.check(stat.size);
  budget.checkInputBytes(stat.size);
  const result = await probeSourceMetadata(context, plugins, { size: stat.size,
    read: (offset, length) => handle.read(offset, length, { signal: context.signal })
  }, filename, budget, records, onAudio, retain, detect);
  context.signal.throwIfAborted();
  return result;
}

async function probeStreamMetadata(context: CommandContext, plugin: MediaAstPlugin, filename: string, budget: MediaBudgetTracker, records: { showPackets: boolean; showFrames: boolean; mp4Records?: { packets: boolean; frames: boolean; metadata: boolean } }): Promise<MediaProbeRecords | undefined> {
  if (!plugin.canDemux || plugin.probeRecords || !plugin.probeMetadataStream) return undefined;
  context.signal.throwIfAborted();
  const source = await openProbeStream(context, isStdin(filename) ? undefined : resolvePath(context.cwd, filename));
  if (!source) return undefined;
  async function* admitted(source: AsyncIterable<Uint8Array>) {
    let total = 0;
    for await (const chunk of source) {
      context.signal.throwIfAborted();
      total += chunk.byteLength;
      context.inputBudget?.check(total);
      budget.checkInputBytes(total);
      yield chunk;
    }
    context.signal.throwIfAborted();
  }
  const result = await plugin.probeMetadataStream(admitted(source), { ...records, filename, signal: context.signal, budget, limits: budget.limits });
  context.signal.throwIfAborted();
  return result;
}

export function createFfprobeCommand(options: MediaCommandsOptions = {}): CommandDefinition {
  const limits = resolveFfprobeLimits(options.limits);
  const astPlugins = options.asts ?? getDefaultMediaRegistry().astPlugins;
  const registry = options.asts ? createMediaAstRegistry(astPlugins) : getDefaultMediaRegistry().registry;

  return {
    name: "ffprobe",
    runtimeIdentity: commandRuntimeIdentity,
    description: "Multimedia stream analyzer powered by pluggable ASTs",
    async execute(context: CommandContext) {
      { const gc = (globalThis as { gc?: () => void }).gc; if (typeof gc === "function") { gc(); gc(); } }
      const budget = new MediaBudgetTracker(limits);
      const readInput = createInputReader(context, budget);
      const argsObj = getCommandArguments(context);
      const args = argsObj.args;
      const quiet = args.some((arg, index) => (arg === "-v" || arg === "-loglevel") && args[index + 1] === "quiet");

      if (args.length === 0) {
        await writeBytes(
          context.stderr,
          encodeUtf8("Simple multimedia streams analyzer\nusage: ffprobe [OPTIONS] INPUT_FILE\n"),
          context.signal
        );
        return { exitCode: 1 };
      }

      for (const arg of args) {
        if (
          arg === "-version" ||
          arg === "--version" ||
          arg === "-h" ||
          arg === "-help" ||
          arg === "--help" ||
          arg === "-formats" ||
          arg === "-demuxers" ||
          arg === "-muxers" ||
          arg === "-codecs" ||
          arg === "-decoders" ||
          arg === "-encoders" ||
          arg === "-protocols" ||
          arg === "-filters"
        ) {
          await writeBytes(
            context.stdout,
            encodeUtf8(formatIntrospectionOutput(arg, astPlugins, "ffprobe")),
            context.signal
          );
          return { exitCode: 0 };
        }
      }

      const retained: (() => Promise<void>)[] = [];
      const retain = (close: () => Promise<void>) => { retained.push(close); };
      const closeInputs = async () => {
        let failure: unknown, failed = false;
        while (retained.length) { try { await retained.pop()!(); } catch (error) { if (!failed) { failed = true; failure = error; } } }
        if (failed) throw failure;
      };
      let storedTags: StoredAudioTags | undefined;
      try {
        const { printFormat, showFormat, showStreams, showPackets, showFrames, showChapters, showPrograms,
          selectStreams, showEntries, countFrames, countPackets, explicitFormat, inputTarget } = parseProbeArguments(args);
        const entryFilter = parseEntryFilter(showEntries);
        const packetRecords = showPackets || entryFilter.has("packet"), frameRecords = showFrames || entryFilter.has("frame");
        const mp4Records = !options.asts ? { packets: packetRecords, frames: frameRecords,
          metadata: !(packetRecords || frameRecords) || showStreams || showFormat || showChapters || countFrames || countPackets || [...entryFilter.keys()].some(section => section !== "packet" && section !== "frame") } : undefined;
        const packetPlugins = mp4Records ? [registry.findByFormatName("mp4"), registry.findByFormatName("mov")] : [];
        let audioInput: AudioProbeInput | undefined;
        let automaticAudio = !options.asts && !explicitFormat && !showPackets && !showFrames && !showChapters && !showPrograms && !countFrames && !countPackets;
        if (automaticAudio) { try { parseAudioArguments(args); } catch { automaticAudio = false; } }
        const automaticPlugins = !explicitFormat
          ? astPlugins.filter(plugin => plugin.canDemux && (packetPlugins.includes(plugin) || plugin.probeRecords || plugin.probeMetadata || !options.asts && plugin === registry.findByFormatName("ogg")) && (!automaticAudio || ["wav", "flac", "mp3", "ogg"].some(format => plugin === registry.findByFormatName(format)))) : [];
        const explicitPlugin = explicitFormat ? registry.findByFormatName(explicitFormat) : undefined;
        const retainedPlugins = explicitPlugin
          ? (explicitPlugin.canDemux && (packetPlugins.includes(explicitPlugin) || explicitPlugin.probeRecords || explicitPlugin.probeMetadata || !options.asts && explicitPlugin === registry.findByFormatName("ogg")) ? [explicitPlugin] : []) : automaticPlugins;
        let probeResult = retainedPlugins.length && !isStdin(inputTarget)
          ? await probeRetainedMetadata(context, retainedPlugins, resolvePath(context.cwd, inputTarget), inputTarget, budget, { showPackets, showFrames, ...(mp4Records ? { mp4Records } : {}) }, automaticAudio ? (audio, size, tags) => { audioInput = { audio, size, args }; storedTags = tags; } : undefined, retain, !explicitPlugin)
          : undefined;
        if (!probeResult && explicitPlugin)
          probeResult = await probeStreamMetadata(context, explicitPlugin, inputTarget, budget, { showPackets, showFrames });
        let replay: AsyncIterable<Uint8Array> | undefined;
        const streamPlugins = explicitPlugin ? retainedPlugins : automaticPlugins;
        if (!probeResult && streamPlugins.length) {
          const source = await openProbeStream(context, isStdin(inputTarget) ? undefined : resolvePath(context.cwd, inputTarget));
          if (source) {
            const sniffed = await sniffMediaStream(source, context.signal, total => {
              context.inputBudget?.check(total); budget.checkInputBytes(total);
            });
            const automaticPlugin = explicitPlugin ?? streamPlugins.find(plugin => plugin.detect(sniffed.prefix, inputTarget));
            if (automaticPlugin) {
              if (!automaticAudio && !automaticPlugin.probeRecords && automaticPlugin.probeMetadataStream) {
                // Sniff replay already admits each source chunk exactly once.
                probeResult = await automaticPlugin.probeMetadataStream(sniffed.stream, {
                  showPackets, showFrames, filename: inputTarget, signal: context.signal, budget, limits: budget.limits
                });
                context.signal.throwIfAborted();
              } else {
                probeResult = await withStagedProbeSource(context, sniffed.stream, source => probeSourceMetadata(context, [automaticPlugin], source, inputTarget, budget, { showPackets, showFrames, ...(mp4Records ? { mp4Records } : {}) }, automaticAudio ? (audio, size, tags) => { audioInput = { audio, size, args }; storedTags = tags; } : undefined, retain), retain);
              }
            } else replay = sniffed.stream;
          }
        }
        if (!probeResult) {
          const bytes = await readInput(inputTarget, replay, replay !== undefined);

          const plugin = registry.detect(bytes, inputTarget, explicitFormat);
          if (!plugin || !plugin.canDemux) {
            const msg = explicitFormat
              ? `ffprobe: Unknown input format: '${explicitFormat}' (AST not registered)\n`
              : `ffprobe: ${inputTarget}: Invalid data found when processing input or format AST not registered\n`;
            await closeInputs();
            if (!quiet) await writeBytes(context.stderr, encodeUtf8(msg), context.signal);
            return { exitCode: 1 };
          }

          const resolveResource = await loadManifestResources(plugin, bytes, inputTarget, context.cwd, readInput, budget);
          probeResult = plugin.probe(bytes, {
            resolveResource,
            filename: inputTarget,
            limits: options.limits,
            budget,
            showPackets,
            showFrames
          });
          if (!options.asts && !explicitFormat) audioInput = { bytes, args };
        }

        const formatted = "oggRows" in probeResult
          ? formatTaggedRows(probeResult.oggRows(args), args)
          : storedTags && audioInput && "audio" in audioInput
          ? formatTaggedAudio(audioInput.audio, audioInput.size, audioInput.args, storedTags)
          : formatFfprobeSourceChunks(probeResult, {
          printFormat,
          showFormat,
          showStreams,
          showPackets,
          showFrames,
          showChapters,
          showPrograms,
          selectStreams,
          showEntries,
          countFrames,
          countPackets
        }, audioInput, context.signal);

        await writeProbeOutput(context, formatted, total => budget.checkOutputBytes(total), closeInputs);
        options.onMetrics?.(budget.getStats());
        return { exitCode: 0 };
      } catch (err) {
        try { await closeInputs(); } catch { /* Preserve the primary failure. */ }
        rethrowRuntimeError(context, err);
        const msg = err instanceof Error ? err.message : String(err);
        if (!quiet)
          await writeBytes(context.stderr, encodeUtf8(`ffprobe: ${msg}\n`), context.signal);
        return { exitCode: 1 };
      }
    }
  };
}


export function evalSyncFfprobe(
  inBytes: Uint8Array | undefined,
  args: readonly string[],
  readFileSync?: (filePath: string) => Uint8Array | undefined,
): string | undefined {
  if (args.length === 0) return undefined;
  const { astPlugins, registry } = getDefaultMediaRegistry();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (
      arg === "-version" ||
      arg === "--version" ||
      arg === "-h" ||
      arg === "-help" ||
      arg === "--help" ||
      arg === "-formats" ||
      arg === "-demuxers" ||
      arg === "-muxers" ||
      arg === "-codecs" ||
      arg === "-decoders" ||
      arg === "-encoders" ||
      arg === "-protocols" ||
      arg === "-filters"
    ) {
      return formatIntrospectionOutput(arg, astPlugins, "ffprobe");
    }
  }

  try {
    const { printFormat, showFormat, showStreams, showPackets, showFrames, showChapters, showPrograms,
      selectStreams, showEntries, countFrames, countPackets, explicitFormat, inputTarget } = parseProbeArguments(args);
    let bytes: Uint8Array | undefined;
    if (isStdin(inputTarget)) {
      bytes = inBytes;
    } else {
      bytes = readFileSync?.(inputTarget);
    }
    if (!bytes || bytes.byteLength > 262144) return undefined;
    const budget = new MediaBudgetTracker();
    budget.checkInputBytes(bytes.byteLength);
    const plugin = registry.detect(bytes, inputTarget, explicitFormat);
    if (!plugin || !plugin.canDemux) return undefined;
    const probeResult = plugin.probe(bytes, {
      filename: inputTarget,
      budget,
      showPackets,
      showFrames,
    });
    const probeOut = formatFfprobeResult(probeResult, {
      printFormat,
      showFormat,
      showStreams,
      showPackets,
      showFrames,
      showChapters,
      showPrograms,
      selectStreams,
      showEntries,
      countFrames,
      countPackets,
    }, !explicitFormat ? { bytes, args } : undefined);
    return probeOut.includes("\0") ? undefined : probeOut;
  } catch {
    return undefined;
  }
}
