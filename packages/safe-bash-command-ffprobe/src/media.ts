import { parseStreamOrdinal } from "./stream-ordinal.js";
import { parseWriterBoolean } from "./writer-boolean.js";
import { probeConcat } from "./concat.js";
export { parseConcatManifest, parseHlsDuration } from "./concat.js";
import { imagePathMetadata, imageSequenceFilename, probeImageSequence } from "./image-sequence.js";
import { probeRawVideo } from "./rawvideo.js";
import { optionalFields, parseOptionalFields } from "./optional-fields.js";
import { packetHashAlgorithm, packetHash, packetSourceHash } from "./packet-hash.js";
import { packetHexRows, packetSourceData } from "./packet-data.js";
import { interleaveProbeRecords } from "./interleave-records.js";
import { parseReadIntervals, readPacketIntervals } from "./read-intervals.js";
import { formatProbeText, xmlSection, iniSection, sexagesimalRow, isProbeText, probeJsonSteps, type ProbeOutputPart } from './probe-text.js';
import { PagedStorage, IntegerTable } from "@poe-code/safe-fs/storage";
import { probeStoredOgg } from "./ogg-probe.js";
import { yieldTurn } from "safe-bash-contracts/yield";
import { FlacTags } from "./flac-tags.js";
import { SourceAudioTags } from "./source-tags.js";
import { resolveFfprobeLimits, writerOptionAliases } from "./options.js";
import { formatTaggedAudio, formatTaggedRows, type TaggedAudioRow, type StoredAudioTags } from "./tag-format.js";
import { writeProbeOutput } from "./probe-output.js";
import { openProbeStream, sniffMediaStream, withStagedProbeSource } from "./stream-input.js";
import { resolveInputPath, resolvePath } from "./input-path.js";
export { resolvePath } from "./input-path.js";
import { isStdin, probe as probeAudio, parseArguments as parseAudioArguments, formatAudioProbe } from "./probe.js";
import { parseAudio, id3HeaderSize, probeId3Source, flacFormatTags, probeWavSource, probeFlacSource, probeMp3Source, type AudioAst } from "@poe-code/audio-ast";
import { commandRuntimeIdentity, getCommandArguments, type CommandContext, type CommandDefinition } from "safe-bash-contracts/command";
import { readBytes, writeBytes } from "safe-bash-contracts/io";
import { wavPacketFrames, probeMp4Source, scanMp4Frames, scanMp4Packets, allMediaAsts, probeOggFlacSource, probeOggStreamMetadata, createMediaAstRegistry, encodeUtf8, parseStreamingManifest, MediaBudgetTracker,
  type MediaAstPlugin, type MediaProbeSource, type MediaFeatureOptions, type MediaProbeResult, type MediaProbeRecords, type MediaProbeSourceRecords, type MediaProbeStream, type MediaProbeSourceStream, type MediaProbeText, type MediaResourceLimits } from "@poe-code/mp4-ast";

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

export { isStdin } from "./probe.js";

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
  const readFile = async (path: string): Promise<Uint8Array> => {
    const input = resolveInputPath(context.cwd, path);
    const stream = input.start === undefined ? undefined : await openProbeStream(context, path);
    const bytes = stream ? await readStdinAll(context, account, stream) : (await context.fs.readFile(input.path, {
      signal: context.signal,
      ...(budget.limits.maxInputBytes === undefined ? {} : { maxBytes: Math.max(0, budget.limits.maxInputBytes - total) })
    })).subarray(input.start ?? 0, input.endExclusive);
    if (!stream) account(bytes);
    return bytes;
  };
  return async (path: string, source?: AsyncIterable<Uint8Array>, admitted = false): Promise<Uint8Array> => {
    if (source || isStdin(path)) return readStdinAll(context, bytes => account(bytes, !admitted), source);
    if (path.startsWith("data:")) return readStdinAll(context, account, readDataInput(path));
    const concat = path.startsWith("concat:");
    if (!concat && !path.startsWith("concatf:")) return readFile(path);
    const list = concat ? "" : new TextDecoder("utf-8", { ignoreBOM: true }).decode(await readFile(path.slice(8))).split("\0", 1)[0]!;
    const paths = concat ? path.slice(7).split("|").filter(Boolean) : [];
    for (let cursor = 0; cursor < list.length;) {
      budget.checkCpu();
      context.signal.throwIfAborted();
      // concatf uses av_get_token with CR/LF delimiters, including quoting and escapes.
      while (cursor < list.length && " \t\r\n".includes(list[cursor]!)) cursor++;
      if (cursor === list.length) break;
      let name = "", protectedEnd = 0;
      while (cursor < list.length && !"\r\n".includes(list[cursor]!)) {
        const char = list[cursor++]!;
        if (char === "\\" && cursor < list.length) {
          name += list[cursor++]!;
          protectedEnd = name.length;
        } else if (char === "'") {
          while (cursor < list.length && list[cursor] !== "'") name += list[cursor++]!;
          if (cursor < list.length) { cursor++; protectedEnd = name.length; }
        } else name += char;
      }
      while (name.length > protectedEnd && " \t\r\n".includes(name.at(-1)!)) name = name.slice(0, -1);
      budget.checkConcatInputs(paths.length + 1);
      paths.push(name);
    }
    budget.checkConcatInputs(paths.length);
    if (!paths.length) throw new Error(concat ? "concat: no files" : "concatf: no files");
    const parts: Uint8Array[] = [];
    let size = 0;
    for (const name of paths) {
      budget.checkCpu();
      context.signal.throwIfAborted();
      // Like native concatf, relative entries use the process cwd, not the list directory.
      const bytes = await readFile(name);
      budget.allocateMemory(bytes.length);
      parts.push(bytes);
      size += bytes.length;
    }
    budget.allocateMemory(size);
    try {
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const part of parts) { bytes.set(part, offset); offset += part.length; }
      return bytes;
    } finally { budget.releaseMemory(size); }
  };
}

/** Decode inline media in bounded chunks through the ordinary input budget. */
async function* readDataInput(path: string): AsyncIterable<Uint8Array> {
  const comma = path.indexOf(",");
  if (comma < 0 || !path.slice(5, comma).endsWith(";base64")) {
    throw new Error("Inline media input requires data:TYPE;base64,DATA");
  }
  for (let offset = comma + 1; offset < path.length; offset += 16384) {
    const decoded = atob(path.slice(offset, offset + 16384));
    yield Uint8Array.from(decoded, character => character.charCodeAt(0));
  }
}

export async function loadManifestResources(
  plugin: MediaAstPlugin,
  bytes: Uint8Array,
  filename: string,
  cwd: string,
  readInput: (path: string) => Promise<Uint8Array>,
  budget: MediaBudgetTracker,
  allowedExtensions = "3gp,aac,avi,ac3,eac3,flac,mkv,m3u8,m4a,m4s,m4v,mpg,mov,mp2,mp3,mp4,mpeg,mpegts,ogg,ogv,oga,ts,vob,vtt,wav,webvtt,cmfv,cmfa,ec3,fmp4"
): Promise<((uri: string) => Uint8Array) | undefined> {
  if (plugin.id !== "hls" && plugin.id !== "dash") return undefined;
  let manifest = parseStreamingManifest(bytes, plugin.id, { budget });
  const path = resolvePath(cwd, filename);
  const directory = path.slice(0, path.lastIndexOf("/")) || "/";
  const resources = new Map<string, Uint8Array>();
  if (manifest.mediaPlaylist) {
    const uri = manifest.mediaPlaylist;
    if (uri.includes(":") && !uri.startsWith("file:")) throw new Error("Streaming media requires local playlist files");
    const child = await readInput(resolvePath(directory, uri));
    resources.set(uri, child);
    manifest = parseStreamingManifest(bytes, plugin.id, { budget, resolveResource: () => child });
  }
  for (const sequence of manifest.sequences) {
    for (const segment of sequence) {
      for (const uri of [segment.encryption?.uri, segment.initialization, segment.uri]) {
        if (uri === undefined || resources.has(uri)) continue;
        if (uri.includes(":") && !uri.startsWith("file:")) throw new Error("Streaming media requires local segment files");
        if (plugin.id === "hls" && allowedExtensions !== "ALL") {
          const name = uri.slice(uri.lastIndexOf("/") + 1);
          const dot = name.lastIndexOf(".");
          const extension = dot < 0 ? undefined : name.slice(dot + 1).toLowerCase();
          if (extension === undefined || !allowedExtensions.toLowerCase().split(",").includes(extension)) {
            if (uri === segment.initialization || uri === segment.encryption?.uri) throw new Error(`HLS resource has a disallowed extension: ${uri}`);
            resources.set(uri, new Uint8Array());
            continue;
          }
        }
        try {
          resources.set(uri, await readInput(resolvePath(directory, uri)));
        } catch (error) {
          if (!segment.initialization || uri === segment.initialization || uri === segment.encryption?.uri ||
              typeof error !== "object" || error === null || !("code" in error) || error.code !== "ENOENT") throw error;
          // An absent media fragment contributes no bytes. Keep the init
          // and surviving fragments together so their tfdt timestamps retain gaps.
          resources.set(uri, new Uint8Array());
        }
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
    return ["Supported file protocols:", "Input:", "  file", "  pipe", "  concat", "  data", "  subfile", "Output:", "  file", "  pipe", ""].join("\n");
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
    sexagesimal?: boolean;
    showOptionalFields?: "auto" | "always" | "never";
    showFormat: boolean;
    showStreams: boolean;
    showData?: boolean;
    showPrivateData?: boolean;
    unit?: boolean;
    showDataHash?: ReturnType<typeof packetHashAlgorithm> | undefined;
    showPackets: boolean;
    showFrames: boolean;
    showChapters: boolean;
    showPrograms: boolean;
    selectStreams?: string | undefined;
    showEntries?: string | undefined;
    countFrames?: boolean | undefined;
    countPackets?: boolean | undefined;
    maxSize?: number | undefined;
  };

/** Explicit buffering convenience for synchronous callers. */
export function formatFfprobeResult(probe: MediaProbeResult, opts: FfprobeFormatOptions, audioInput?: AudioProbeInput): string {
  return Array.from(formatFfprobeResultChunks(probe, opts, audioInput)).join("");
}

/** Output selection may omit format metadata entirely, as in a packet-only scan. */
type ProbeSourceRows = Omit<MediaProbeSourceRecords, "format"> & { readonly error?: { code: number; string: string }; readonly packetSource?: MediaProbeSource; readonly format?: MediaProbeSourceRecords["format"] };
type SyncProbeRows = Omit<MediaProbeRecords, "streams" | "chapters"> & {
  readonly streams: Iterable<MediaProbeStream>;
  readonly chapters: Iterable<MediaProbeResult["chapters"][number]>;
};
type FormatStep = ProbeOutputPart | {
  rows: Iterable<unknown> | AsyncIterable<unknown>;
  render: (row: unknown, index: number) => Iterable<ProbeOutputPart>;
};

function parseStreamId(value: string): number | undefined {
  const unsigned = value[0] === "+" || value[0] === "-" ? value.slice(1) : value;
  const id = parseStreamOrdinal(unsigned);
  if (id === undefined || !Number.isSafeInteger(id)) return undefined;
  return value[0] === "-" ? -id : id;
}

function createStreamSelector(selectStreams: string | undefined, programs: ProbeSourceRows["programs"]) {
  let spec = selectStreams ?? "";
  const types: string[] = [];
  let excludePictures = false;
  let programIndices: Set<number> | undefined;
  while (spec) {
    if (spec.startsWith("p:")) {
      const [, id, ...suffix] = spec.split(":");
      const members = programs?.filter(program => program.program_id === parseStreamOrdinal(id!.startsWith("+") ? id!.slice(1) : id!))
        .flatMap(program => program.streams.map(stream => stream.index)) ?? [];
      programIndices = new Set(members.filter(index => !programIndices || programIndices.has(index)));
      spec = suffix.join(":");
    } else if (["v", "V", "a", "s", "d", "t"].includes(spec.split(":")[0]!)) {
      if (spec[0] === "V") excludePictures = true;
      types.push(spec[0] === "v" || spec[0] === "V" ? "video" : spec[0] === "a" ? "audio" : spec[0] === "s" ? "subtitle" : spec[0] === "d" ? "data" : "attachment");
      spec = spec.slice(2);
    } else break;
  }
  const streamId = spec.startsWith("i:") ? parseStreamId(spec.slice(2))
    : spec.startsWith("#") ? parseStreamId(spec.slice(1)) : undefined;
  let typeOrdinal = 0;
  return (stream: MediaProbeSourceStream): boolean => {
    if (types.some(type => stream.codec_type !== type)) return false;
    if (excludePictures && (stream.disposition?.attached_pic || stream.disposition?.timed_thumbnails)) return false;
    if (programIndices && !programIndices.has(stream.index)) return false;
    if (spec) {
      if (spec === "u") {
        if (!stream.codec_name || stream.codec_name === "unknown") return false;
        if (stream.codec_type === "audio" && (!(Number(stream.sample_rate) > 0) || !stream.channels
          || !stream.sample_fmt || stream.sample_fmt === "unknown")) return false;
        if (stream.codec_type === "video" && (!stream.width || !stream.height
          || !stream.pix_fmt || stream.pix_fmt === "unknown")) return false;
      }
      // An omitted display ID still has ffprobe's default stream ID of zero.
      if (streamId !== undefined && Number(stream.id ?? 0) !== streamId) return false;
      if (spec.startsWith("m:")) {
        const [key, ...value] = spec.slice(2).split(":");
        const tag = Object.entries(stream.tags ?? {}).find(([name]) => name.toLowerCase() === key!.toLowerCase());
        if (!tag || (value.length > 0 && tag[1] !== value.join(":"))) return false;
      }
      const ordinal = parseStreamOrdinal(spec);
      if (ordinal !== undefined) {
        const index = types.length > 0 || programIndices ? typeOrdinal++ : stream.index;
        if (index !== ordinal) return false;
      }
    }
    return true;
  };
}

function formatQualifiedAudio(probe: ProbeSourceRows, opts: FfprobeFormatOptions, audioInput?: AudioProbeInput): string | undefined {
  // Stream side data belongs to the media schema.
  if (Array.isArray(probe.streams) && probe.streams.some(stream => stream.side_data_list?.length)) return undefined;
  // MP4 track tags belong to the media probe, not the audio container metadata.
  if (probe.format?.format_name.split(",").includes("mp4")) return undefined;
  // Broadcast WAV fields are supplied by the media reader, not the audio schema.
  if (probe.format?.format_name === "wav" && probe.format.tags?.time_reference !== undefined) return undefined;
  // Both execution paths retain qualified audio schemas while media-only options
  // and mixed streams use the general media formatter.
  if (audioInput && !opts.showPackets && !opts.showFrames && !opts.showChapters && !opts.showPrograms && !opts.countFrames && !opts.countPackets &&
      Array.isArray(probe.streams) && probe.streams.length > 0 && probe.streams.every(stream => stream.codec_type === "audio")) {
    let formatted: string | undefined;
    try { formatted = "bytes" in audioInput ? probeAudio(audioInput.bytes, audioInput.args) : formatAudioProbe({ ...audioInput.audio, nodes: audioInput.audio.nodes ?? [] }, audioInput.size, parseAudioArguments(audioInput.args)); } catch { /* Other containers and extended options use the media formatter. */ }
    return formatted;
  }
}

function mp3ReplayGain<T extends ProbeSourceRows>(probe: T, audioInput?: AudioProbeInput): T {
  if (probe.format?.format_name !== "mp3" || !audioInput || !("bytes" in audioInput) || !Array.isArray(probe.streams)) return probe;
  try {
    if (!id3HeaderSize(audioInput.bytes)) return probe;
    const { tags } = parseAudio(audioInput.bytes);
    if (Object.keys(tags).some(key => ["replaygain_track_gain", "replaygain_album_gain"].includes(key.toLowerCase()))) {
      return { ...probe, streams: probe.streams.map(stream => ({ ...stream,
        side_data_list: [...stream.side_data_list ?? [], { side_data_type: "Replay Gain" }] })),
        format: { ...probe.format, tags } };
    }
  } catch { /* Preserve the general-media fallback for malformed audio. */ }
  return probe;
}

export function* formatFfprobeResultChunks(probe: SyncProbeRows, opts: FfprobeFormatOptions, audioInput?: AudioProbeInput): Generator<string> {
  probe = mp3ReplayGain(probe, audioInput);
  const audio = formatQualifiedAudio(probe, opts, audioInput);
  if (audio !== undefined) { yield audio; return; }
  if (audioInput && "bytes" in audioInput && probe.format?.format_name === "flac") {
    try {
      probe = { ...probe, format: { ...probe.format, tags: flacFormatTags(parseAudio(audioInput.bytes).nodes) } };
    } catch { /* Preserve the general-media fallback for extended options or malformed audio. */ }
  }
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
  probe = mp3ReplayGain(probe, audioInput);
  const audio = formatQualifiedAudio(probe, opts, audioInput);
  if (audio !== undefined) { yield audio; return; }
  if (audioInput && "bytes" in audioInput && probe.format?.format_name === "flac") {
    try {
      probe = { ...probe, format: { ...probe.format, tags: flacFormatTags(parseAudio(audioInput.bytes).nodes) } };
    } catch { /* Preserve the general-media fallback for extended options or malformed audio. */ }
  }
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

function parseEntryFilter(showEntries: string | undefined): Map<string, Set<string> | null> {
  const entryFilter = new Map<string, Set<string> | null>();
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
        const existing = entryFilter.get(secName);
        entryFilter.set(secName, new Set([...existing ?? [], ...fields]));
      } else {
        entryFilter.set(secSpec.trim().toLowerCase(), null);
      }
    }
  }

  return entryFilter;
}

function* formatProbeSteps(probe: ProbeSourceRows, opts: FfprobeFormatOptions): Generator<FormatStep> {
  const entryFilter = parseEntryFilter(opts.showEntries);
  const inlineInput = probe.format?.filename.startsWith("data:") ?? false;
  const stdinAudio = !!probe.format && ["wav", "mp3"].includes(probe.format.format_name) && (isStdin(probe.format.filename) || inlineInput);
  let audioBitrate = 0;
  if (stdinAudio) {
    const streams: MediaProbeStream[] = [];
    yield { rows: probe.streams, render(row) {
      const stream = row as MediaProbeStream;
      streams.push(stream);
      audioBitrate += Number(stream.bit_rate ?? 0);
      return [];
    } };
    probe = { ...probe, streams };
  }

  const filterObject = (
    obj: Record<string, unknown>,
    sectionName: string,
    ...nestedSections: string[]
  ): Record<string, unknown> => {
    obj = optionalFields(obj, sectionName, opts.showOptionalFields, opts.printFormat);
    if (opts.sexagesimal) obj = sexagesimalRow(obj, sectionName);
    if (opts.unit && (sectionName === "stream" || sectionName === "format")) {
      obj = { ...obj };
      for (const [key, suffix] of Object.entries({ sample_rate: "Hz", bit_rate: "bit/s", size: "byte", start_time: "s", duration: "s" })) {
        const value = obj[key];
        if (value !== undefined && value !== "N/A" && !(suffix === "s" && opts.sexagesimal))
          obj[key] = `${value} ${suffix}`;
      }
    }
    if (entryFilter.size === 0) return obj;
    const allowed = entryFilter.get(sectionName);
    if (allowed === undefined && !entryFilter.has(`${sectionName}_side_data`) && !nestedSections.some(section => entryFilter.has(section))) return obj;

    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (k === "side_data_list" && Array.isArray(v)) {
        const fields = entryFilter.get(`${sectionName}_side_data`);
        if (fields === null || (fields === undefined && (allowed === null || allowed?.has(k)))) out[k] = v;
        else if (fields?.size || sectionName === "packet") out[k] = v.map(row => Object.fromEntries(Object.entries(row).filter(([key]) => fields?.has(key))));
        continue;
      }
      if (nestedSections.includes(`${sectionName}_${k}`) && v && typeof v === "object") {
        const allowedNested = entryFilter.get(`${sectionName}_${k}`);
        if (allowedNested !== undefined) {
          if (allowedNested === null) {
            out[k] = v;
          } else if (allowedNested.size > 0) {
            out[k] = Object.fromEntries(Object.entries(v).filter(([key]) => allowedNested.has(key)));
          }
        } else if (sectionName === "packet" || allowed === null || allowed?.has(k)) {
          out[k] = v;
        }
        continue;
      }
      if (allowed === null || allowed?.has(k)) {
        out[k] = v;
      }
    }
    return out;
  };

  const includesEntries = (section: string) => entryFilter.has(section) && entryFilter.get(section)?.size !== 0;
  const includeStreams =
    opts.showStreams || includesEntries("stream") || includesEntries("stream_tags") || includesEntries("stream_disposition") || includesEntries("stream_side_data");
  const includeFormat =
    opts.showFormat || includesEntries("format") || includesEntries("format_tags");
  const includePackets = opts.showPackets || includesEntries("packet");
  const includeFrames = opts.showFrames || includesEntries("frame");
  const includeChapters = opts.showChapters || includesEntries("chapter");
  const includePrograms = opts.showPrograms || includesEntries("program") || includesEntries("program_tags") || includesEntries("stream");

  const matchesStream = createStreamSelector(opts.selectStreams, probe.programs);
  const prepareStream = (row: unknown): Record<string, unknown> | undefined => {
    const stream = row as MediaProbeStream;
    if (!matchesStream(stream)) return;
    const recordCount = probe.format?.format_name === "wav" && stream.duration_ts !== undefined
      ? String(Math.ceil(stream.duration_ts / wavPacketFrames(Number(stream.sample_rate),
        Math.max(1, (stream.channels ?? 1) * (stream.bits_per_sample ?? 16) / 8), opts.maxSize)))
      : stream.nb_frames ?? "0";
    const { nb_read_frames, nb_read_packets, codecData, ...fields } = stream;
    const metadata: Record<string, unknown> = { ...fields };
    if (opts.showPrivateData === false) {
      delete metadata.is_avc;
      delete metadata.nal_length_size;
    }
    if (codecData) {
      const fields = entryFilter.get("stream");
      if (opts.showData && (!fields || fields.has("extradata"))) {
        if (codecData instanceof Uint8Array) metadata.extradata = "\n" + [...packetHexRows(codecData)].join("");
        else if (probe.packetSource) metadata.extradata = packetSourceData(probe.packetSource, codecData.offset, codecData.length);
      }
      if (opts.showDataHash && (!fields || fields.has("extradata_hash"))) {
        if (codecData instanceof Uint8Array) metadata.extradata_hash = packetHash(codecData, opts.showDataHash);
        else if (probe.packetSource) metadata.extradata_hash = packetSourceHash(probe.packetSource, codecData.offset, codecData.length, opts.showDataHash);
      }
    }
    if (stdinAudio) { delete metadata.duration; delete metadata.duration_ts; }
    return filterObject({ ...metadata,
      ...((opts.countFrames || includeFrames) && (nb_read_frames ?? recordCount) !== "0" ? { nb_read_frames: nb_read_frames ?? recordCount } : {}),
      ...((opts.countPackets || includePackets) && (nb_read_packets ?? recordCount) !== "0" ? { nb_read_packets: nb_read_packets ?? recordCount } : {})
    }, "stream", "stream_tags", "stream_disposition");
  };
  // Resolve stream ordinals once, including for one-shot asynchronous metadata.
  // Only retain selected metadata when it will also be printed.
  const selectedIndices = (opts.selectStreams && (includePackets || includeFrames) || includePrograms && probe.programs?.length) ? new Set<number>() : undefined;
  const selectedStreams: Record<string, unknown>[] = [];
  const programStreams = new Map<number, Record<string, unknown>>();
  if (selectedIndices) {
    yield { rows: probe.streams, render(row) {
      const stream = prepareStream(row);
      if (stream === undefined) return [];
      selectedIndices.add((row as MediaProbeStream).index);
      if (includePrograms) programStreams.set((row as MediaProbeStream).index, stream);
      if (includeStreams || includePrograms) selectedStreams.push(stream);
      return [];
    } };
  }
  const streams = selectedIndices ? selectedStreams : probe.streams;
  const programs = includePrograms ? (probe.programs ?? []).map(program => {
    const { streams: members, tags, ...fields } = program;
    const row = filterObject(fields, "program");
    if (entryFilter.has("program_tags")) Object.assign(row, filterObject({ tags }, "program", "program_tags"));
    else if (opts.showPrograms || entryFilter.get("program") === null) row.tags = tags;
    row.streams = members.flatMap(member => {
      const selected = programStreams.get(member.index);
      return selected ? [selected] : [];
    });
    return row;
  }) : [];
  const prepareRecord = (row: unknown, section: string): Record<string, unknown> | undefined => {
    let record = row as Record<string, unknown>;
    if (selectedIndices && !selectedIndices.has(record.stream_index as number)) return;
    const payload = section === "packet" ? probe.packetData?.get(`${record.pos}:${record.size}`) : undefined;
    if (section === "packet" && record.data_hash === undefined && opts.showDataHash && (!entryFilter.has("packet") || entryFilter.get("packet") === null || entryFilter.get("packet")!.has("data_hash"))) {
      if (!payload && !probe.packetSource) throw new Error("Packet data is unavailable for this input format");
      record = { ...record, data_hash: payload ? packetHash(payload, opts.showDataHash)
        : packetSourceHash(probe.packetSource!, Number(record.pos), Number(record.size), opts.showDataHash) };
    }
    if (section === "packet" && record.data === undefined && opts.showData && (!entryFilter.has("packet") || entryFilter.get("packet") === null || entryFilter.get("packet")!.has("data"))) {
      if (!payload && !probe.packetSource) throw new Error("Packet data is unavailable for this input format");
      record = { ...record, data: payload ? "\n" + [...packetHexRows(payload)].join("")
        : packetSourceData(probe.packetSource!, Number(record.pos), Number(record.size)) };
    }
    if (section === "packet" && opts.unit) {
      record = { ...record };
      for (const key of ["pts_time", "dts_time", "duration_time", "size"]) {
        const value = record[key];
        if (value !== undefined && value !== "N/A" && (key === "size" || !opts.sexagesimal))
          record[key] = `${value} ${key === "size" ? "byte" : "s"}`;
      }
    }
    if (section === "frame" && record.media_type === "subtitle" && record.format !== undefined) {
      // Keep stream identity and packet DTS internally for selection and interleaving.
      record = { ...record };
      delete record.stream_index;
      delete record.pkt_dts;
    }
    return filterObject(record, section, `${section}_tags`);
  };
  const format: Record<string, unknown> = { ...probe.format };
  if (format.format_name === "webvtt") {
    // Cue timestamps do not declare container timing or an overall bit rate.
    delete format.start_time;
    delete format.duration;
    delete format.bit_rate;
  }
  if (inlineInput) delete format.size;
  if (stdinAudio) {
    delete format.duration;
    delete format.size;
    format.bit_rate = String(audioBitrate);
  }
  if (!stdinAudio && probe.format?.format_name === "mp3" && Number(format.duration) > 0)
    format.bit_rate = String(Math.floor(Number(format.size) * 8 / Number(format.duration)));
  const finalFormat = includeFormat && probe.format
    ? filterObject(format, "format", "format_tags")
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
      const key = p.slice(0, eq).trim();
      paramMap[key === "s" && fmt === "flat" ? "sep_char" : writerOptionAliases.get(key) ?? key] = p.slice(eq + 1).trim();
    } else if (p.trim()) {
      const key = p.trim();
      paramMap[key === "s" && fmt === "flat" ? "sep_char" : writerOptionAliases.get(key) ?? key] = "1";
    }
  }

  if (fmt === "json") {
    const sections: { name: string; rows?: Iterable<unknown> | AsyncIterable<unknown>; value?: unknown }[] = [];
    if (includePrograms) sections.push({ name: "programs", rows: programs });
    if (includesEntries("stream")) sections.push({ name: "stream_groups", rows: [] });
    if (includePackets && includeFrames) {
      sections.push({ name: "packets_and_frames", rows: interleaveProbeRecords(probe.packets ?? [], probe.frames ?? []) });
    } else {
      if (includePackets && probe.packets) sections.push({ name: "packets", rows: probe.packets });
      if (includeFrames && probe.frames) sections.push({ name: "frames", rows: probe.frames });
    }
    if (includeStreams) sections.push({ name: "streams", rows: streams });
    if (includeChapters) sections.push({ name: "chapters", rows: probe.chapters });
    if (probe.error) sections.push({ name: "error", value: probe.error });
    if (finalFormat !== undefined) sections.push({ name: "format", value: finalFormat });
    const compact = parseWriterBoolean(paramMap.compact ?? "0");
    const indent = compact ? "    " : "  ";
    yield "{";
    let firstSection = true;
    for (const section of sections) {
      yield (firstSection ? "" : ",") + "\n" + indent + JSON.stringify(section.name) + ": ";
      firstSection = false;
      if (section.rows) {
        yield "[";
        let firstRow = true;
        yield { rows: section.rows, *render(row) {
          if (section.name === "streams") { row = selectedIndices ? row : prepareStream(row); if (row === undefined) return; }
          else if (section.name === "packets_and_frames") {
            const { type, record } = row as { type: string; record: unknown };
            row = prepareRecord(record, type);
            if (row === undefined) return;
            row = { type, ...row as Record<string, unknown> };
          }
          else if (section.name === "packets" || section.name === "frames") {
            row = prepareRecord(row, section.name === "packets" ? "packet" : "frame");
            if (row === undefined) return;
          }
          else if (section.name === "chapters") {
            const chapter = { ...filterObject(row as Record<string, unknown>, "chapter", "chapter_tags") };
            if (chapter.tags && Object.keys(chapter.tags).length === 0) delete chapter.tags;
            row = chapter;
          }
          yield (firstRow ? "" : ",") + "\n" + indent.repeat(2);
          firstRow = false;
          yield* probeJsonSteps(row, compact, 2);
        } };
        if (compact && firstRow) yield "\n";
        yield (compact || !firstRow ? "\n" + indent : "") + "]";
      } else {
        yield* probeJsonSteps(section.value, compact, 1);
      }
    }
    if (compact && firstSection) yield "\n";
    yield (compact || !firstSection ? "\n" : "") + "}\n";
    return;
  }
  const noWrappers =
    parseWriterBoolean(paramMap.noprint_wrappers ?? "0");
  const noKey = parseWriterBoolean(paramMap.nokey ?? (fmt === "csv" ? "1" : "0"));

  function probeEntries(section: Record<string, unknown>, tagPrefix: string, dispositionPrefix: string): [string, unknown][] {
    return Object.entries(section).flatMap(([key, value]) =>
      (key === "tags" || key === "disposition") && value && typeof value === "object"
        ? Object.entries(value).map(([tag, text]): [string, unknown] => [(key === "tags" ? tagPrefix : dispositionPrefix) + tag, text])
        : [[key, value]]
    );
  }

  function probeText(value: unknown, separator = "."): ProbeOutputPart {
    const escape = paramMap.escape ?? (fmt === "csv" ? "csv" : "c");
    const mode = fmt === "flat" ? "flat" : escape === "none" ? "plain" : escape === "csv" ? "csv" : "compact";
    if (isProbeText(value)) return { text: value, mode, separator };
    if (fmt === "flat" && typeof value === "number") return String(value);
    const text = String(value);
    if (mode === "plain") return text;
    if (mode === "csv") {
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

  const qualifiedXml = fmt === "xml" && parseWriterBoolean(paramMap.fully_qualified ?? "0");
  if (fmt === "xml") {
    yield '<?xml version="1.0" encoding="UTF-8"?>\n';
    yield qualifiedXml
      ? '<ffprobe:ffprobe xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:ffprobe="http://www.ffmpeg.org/schema/ffprobe" xsi:schemaLocation="http://www.ffmpeg.org/schema/ffprobe ffprobe.xsd">\n'
      : "<ffprobe>\n";
  }
  if (fmt === "ini") yield "# ffprobe output\n";
  let streamIndex = 0;
  function* render(section: Record<string, unknown>, name: string, index = 0, parentPath = ""): Generator<ProbeOutputPart> {
    if (fmt === "xml") {
      yield* xmlSection(section, name, name === "format" || name === "error" ? 1 : 2);
    } else if (fmt === "ini") {
      const hierarchical = parseWriterBoolean(paramMap.hierarchical ?? "1");
      const parent = includePackets && includeFrames && (name === "packet" || name === "frame") ? "packets_and_frames" : name + "s";
      const path = name === "format" || name === "error" ? name : `${hierarchical ? parent + "." : ""}${name}.${index}`;
      const { streams: members, ...fields } = section;
      yield* iniSection(fields, parentPath + path);
      if (Array.isArray(members)) for (const [i, member] of members.entries()) yield* render(member, "stream", i, path + ".");
    } else if (fmt === "csv" || fmt === "compact") {
      const sep = paramMap.item_sep ?? (fmt === "csv" ? "," : "|");
      const printSection = parseWriterBoolean(paramMap.print_section ?? "1");
      let first = true;
      if (printSection) { yield name; first = false; }
      for (const [key, value] of probeEntries(section, "tag:", "disposition:")) {
        if (value === undefined || typeof value === "object" && !isProbeText(value)) continue;
        if (!first) yield sep;
        first = false;
        if (!noKey) yield `${key}=`;
        yield probeText(value, sep);
      }
      if (Array.isArray(section.streams)) for (const [i, member] of section.streams.entries()) {
        if (i === 0 && !first) yield sep;
        yield* render(member, "stream", i);
      }
      yield "\n";
    } else if (fmt === "flat") {
      const sep = paramMap.sep_char ?? ".";
      const hierarchical = parseWriterBoolean(paramMap.hierarchical ?? "1");
      const parent = includePackets && includeFrames && (name === "packet" || name === "frame") ? "packets_and_frames" : name + "s";
      const prefix = parentPath + (["program", "stream", "packet", "frame"].includes(name)
        ? `${hierarchical ? parent + sep : ""}${name}${sep}${index}${sep}`
        : `${name}${sep}`);
      for (const [key, value] of probeEntries(section, `tags${sep}`, `disposition${sep}`)) {
        if (value === undefined || typeof value === "object" && !isProbeText(value)) continue;
        yield `${prefix}${key}=`; yield probeText(value); yield "\n";
      }
      if (Array.isArray(section.streams)) for (const [i, member] of section.streams.entries()) yield* render(member, "stream", i, prefix);
    } else {
      const wrapper = name.toUpperCase();
      if (!noWrappers) yield `[${wrapper}]\n`;
      for (const [key, value] of Object.entries(section)) {
        if (value === undefined) continue;
        if ((key === "tags" || key === "disposition") && value && typeof value === "object") {
          for (const [tag, text] of Object.entries(value)) {
            if (!noKey) yield `${key === "tags" ? "TAG" : "DISPOSITION"}:${tag}=`;
            yield isProbeText(text) ? { text, mode: "plain" } : String(text); yield "\n";
          }
        } else if (typeof value !== "object") yield (noKey ? String(value) : `${key}=${String(value)}`) + "\n";
      }
      if (Array.isArray(section.streams)) for (const [i, member] of section.streams.entries()) yield* render(member, "stream", i);
      if (!noWrappers) yield `[/${wrapper}]\n`;
    }
  }
  let packetIndex = 0, frameIndex = 0;
  if ((fmt === "xml" || fmt === "flat") && includePackets && includeFrames) {
    if (fmt === "xml") yield "    <packets_and_frames>\n";
    yield { rows: interleaveProbeRecords(probe.packets ?? [], probe.frames ?? []), *render(row) {
      const { type, record } = row as { type: string; record: unknown };
      const prepared = prepareRecord(record, type);
      if (prepared !== undefined) yield* render(prepared, type, type === "packet" ? packetIndex++ : frameIndex++);
    } };
    if (fmt === "xml") yield "    </packets_and_frames>\n";
  } else {
    if (fmt === "xml" && includePackets) yield "    <packets>\n";
    if (includePackets && probe.packets) yield { rows: probe.packets, *render(row) {
      const packet = prepareRecord(row, "packet");
      if (packet !== undefined) yield* render(packet, "packet", packetIndex++);
    } };
    if (fmt === "xml" && includePackets) yield "    </packets>\n";
    if (fmt === "xml" && includeFrames) yield "    <frames>\n";
    if (includeFrames && probe.frames) yield { rows: probe.frames, *render(row) {
      const frame = prepareRecord(row, "frame");
      if (frame !== undefined) yield* render(frame, "frame", frameIndex++);
    } };
    if (fmt === "xml" && includeFrames) yield "    </frames>\n";
  }
  if (fmt === "xml" && includePrograms) yield "    <programs>\n";
  for (const [index, program] of programs.entries()) yield* render(program, "program", index);
  if (fmt === "xml" && includePrograms) yield "    </programs>\n";
  if (fmt === "xml" && includesEntries("stream")) yield "    <stream_groups>\n    </stream_groups>\n";
  if (fmt === "ini") {
    if (includePrograms || includeStreams) yield "\n";
    if (includeStreams) yield "\n";
  }
  if (fmt === "xml" && includeStreams) yield "    <streams>\n";
  if (includeStreams) yield { rows: streams, *render(row) {
    const stream = selectedIndices ? row as Record<string, unknown> : prepareStream(row);
    if (stream !== undefined) yield* render(stream, "stream", streamIndex++);
  } };
  if (fmt === "xml" && includeStreams) yield "    </streams>\n";
  if (fmt === "xml" && includeChapters) yield "    <chapters>\n";
  let chapterIndex = 0;
  if (includeChapters && fmt !== "csv" && fmt !== "compact" && fmt !== "flat") yield { rows: probe.chapters, *render(row) {
    const chapter = row as MediaProbeResult["chapters"][number];
    yield* render({ id: chapter.id, time_base: chapter.time_base, start: chapter.start, start_time: chapter.start_time, end: chapter.end, end_time: chapter.end_time, tags: chapter.tags }, "chapter", chapterIndex++);
  } };
  if (fmt === "xml" && includeChapters) yield "    </chapters>\n";
  if (finalFormat) yield* render(finalFormat, "format");
  if (probe.error) yield* render(probe.error, "error");
  if (fmt === "xml") yield qualifiedXml ? "</ffprobe:ffprobe>\n" : "</ffprobe>\n";
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

// Section names and unique names accepted by native ffprobe -sections.
const probeSections = new Set([
  "root", "chapters", "chapter", "tags",
  "chapter_tags", "format", "format_tags", "frames",
  "frame", "frame_tags", "side_data_list", "frame_side_data_list",
  "side_data", "frame_side_data", "timecodes", "timecode",
  "components", "frame_side_data_components", "component", "frame_side_data_component",
  "pieces", "frame_side_data_pieces", "piece", "frame_side_data_piece",
  "logs", "log", "subtitle", "programs",
  "program", "program_tags", "streams", "program_streams",
  "stream", "program_stream", "disposition", "program_stream_disposition",
  "program_stream_tags", "stream_groups", "stream_group", "stream_group_tags",
  "stream_group_disposition", "stream_group_components", "stream_group_component", "stream_group_side_data_list",
  "stream_group_side_data", "subcomponents", "subcomponent", "stream_group_pieces",
  "stream_group_piece", "subpieces", "subpiece", "blocks",
  "block", "stream_group_streams", "stream_group_stream", "stream_group_stream_disposition",
  "stream_group_stream_tags", "stream_disposition", "stream_tags", "stream_side_data_list",
  "stream_side_data", "packets", "packet", "packet_tags",
  "packet_side_data_list", "packet_side_data", "error", "program_version",
  "library_versions", "library_version", "pixel_formats", "pixel_format",
  "flags", "pixel_format_flags", "pixel_format_components",
]);

function parseProbeArguments(args: readonly string[]) {
  let printFormat = "default", showError = false, showFormat = false, showStreams = false,
    showPackets = false, showFrames = false, showChapters = false, showPrograms = false,
    countFrames = false, countPackets = false, showData = false, unit = false, sexagesimal = false;
  let showPrivateData = true;
  let webvttKind: string | undefined;
  let ignoreLength = false, exportPathMetadata = false, segmentTimeMetadata = false, safe = true;
  let tsFromFile = 0;
  let maxSize: number | undefined;
  let showOptionalFields: "auto" | "always" | "never" = "auto";
  let showDataHash: ReturnType<typeof packetHashAlgorithm> | undefined;
  let selectStreams: string | undefined, showEntries: string | undefined,
    explicitFormat: string | undefined, inputTarget: string | undefined, allowedExtensions: string | undefined;
  let videoSize: string | undefined, pixelFormat: string | undefined, frameRate: string | undefined;
  let readIntervals: ReturnType<typeof parseReadIntervals> | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    const value = () => {
      const next = args[++i];
      if (next === undefined) throw new Error(`Missing value for ${arg}`);
      return next;
    };
    if (arg === "-v" || arg === "-loglevel") value();
    else if (arg === "-max_size") {
      maxSize = Number(value());
      if (!Number.isInteger(maxSize) || maxSize < 0 || maxSize > 0x7fffffff)
        throw new Error("-max_size requires an integer from 0 to 2147483647");
    }
    else if (arg === "-ignore_length") {
      const length = value();
      if (length !== "0" && length !== "1") throw new Error("-ignore_length requires 0 or 1");
      ignoreLength = length === "1";
    }
    else if (arg === "-segment_time_metadata" || arg === "-safe") {
      const enabled = value();
      if (enabled !== "0" && enabled !== "1") throw new Error(`${arg} requires 0 or 1`);
      if (arg === "-safe") safe = enabled === "1";
      else segmentTimeMetadata = enabled === "1";
    }
    else if (arg === "-kind") {
      webvttKind = value();
      if (!["subtitles", "captions", "descriptions", "metadata"].includes(webvttKind)) throw new Error("-kind requires subtitles, captions, descriptions or metadata");
    }
    else if (arg === "-export_path_metadata") {
      const enabled = value();
      if (enabled !== "0" && enabled !== "1") throw new Error("-export_path_metadata requires 0 or 1");
      exportPathMetadata = enabled === "1";
    }
    else if (arg === "-hide_banner") continue;
    else if (arg === "-of" || arg === "-print_format") printFormat = value();
    else if (arg === "-show_optional_fields") showOptionalFields = parseOptionalFields(value());
    else if (arg === "-sexagesimal") sexagesimal = true;
    else if (arg === "-show_error") showError = true;
    else if (arg === "-show_format") showFormat = true;
    else if (arg === "-show_streams") showStreams = true;
    else if (arg === "-private" || arg === "-show_private_data") showPrivateData = true;
    else if (arg === "-noprivate" || arg === "-noshow_private_data") showPrivateData = false;
    else if (arg === "-show_data_hash") showDataHash = packetHashAlgorithm(value());
    else if (arg === "-unit") unit = true;
    else if (arg === "-show_data") showData = true;
    else if (arg === "-show_packets") showPackets = true;
    else if (arg === "-show_frames") showFrames = true;
    else if (arg === "-show_chapters") showChapters = true;
    else if (arg === "-show_programs") showPrograms = true;
    else if (arg === "-count_frames") countFrames = true;
    else if (arg === "-count_packets") countPackets = true;
    else if (arg === "-select_streams") selectStreams = value();
    else if (arg === "-show_entries") {
      const entries = value();
      const sections = entries.split(":");
      if (sections.at(-1) === "") sections.pop();
      for (const entry of sections) {
        const section = entry.split("=", 1)[0]!;
        if (!probeSections.has(section))
          throw new Error(`No match for section '${section}'\nFailed to set value '${entries}' for option 'show_entries': Invalid argument`);
      }
      showEntries = showEntries === undefined ? entries : `${showEntries}:${entries}`;
    }
    else if (arg === "-read_intervals") readIntervals = parseReadIntervals(value());
    else if (arg === "-f") explicitFormat = value();
    else if (arg === "-video_size") videoSize = value();
    else if (arg === "-pixel_format") pixelFormat = value();
    else if (arg === "-framerate") frameRate = value();
    else if (arg === "-ts_from_file") {
      const mode = value();
      if (!["0", "1", "2"].includes(mode)) throw new Error("-ts_from_file requires 0, 1 or 2");
      tsFromFile = Number(mode);
    }
    else if (arg === "-allowed_extensions") allowedExtensions = value();
    else {
      const input = arg === "-i" ? value() : arg;
      if (arg !== "-i" && input.startsWith("-") && input !== "-") throw new Error(`Unknown option ${input}`);
      if (inputTarget !== undefined) throw new Error("Expected one input");
      inputTarget = input;
    }
  }
  if (!inputTarget) throw new Error("must specify an input file");
  if (selectStreams) {
    let spec = selectStreams;
    while (spec) {
      if (spec.startsWith("p:")) {
        const [, id, ...suffix] = spec.split(":");
        if (!id || parseStreamOrdinal(id.startsWith("+") ? id.slice(1) : id) === undefined) {
          throw new Error(`Invalid stream specifier: ${selectStreams}`);
        }
        spec = suffix.join(":");
      } else if (["v", "V", "a", "s", "d", "t"].includes(spec.split(":")[0]!) && spec.includes(":")) {
        spec = spec.slice(2);
      } else break;
    }
    const [kind, ...parts] = spec.split(":");
    const index = parts.length === 0 ? kind! : parts[0]!;
    const numeric = parseStreamOrdinal(index) !== undefined;
    const id = spec.startsWith("i:") ? spec.slice(2)
      : spec.startsWith("#") ? spec.slice(1) : "";
    const validId = parseStreamId(id) !== undefined;
    const valid = spec === "u" || spec === "" || kind === "m" && parts.length > 0
      || ["v", "V", "a", "s", "d", "t"].includes(kind!) && parts.length === 0
      || parts.length === 0 && numeric || validId;
    if (!valid) throw new Error(`Invalid stream specifier: ${selectStreams}`);
  }
  const [head = "default", ...parameters] = printFormat.split(":");
  const equals = head.indexOf("=");
  const writer = (equals < 0 ? head : head.slice(0, equals)).toLowerCase();
  const writerOptions: Record<string, readonly string[]> = {
    json: ["c", "compact"],
    default: ["nokey", "nk", "noprint_wrappers", "nw"],
    compact: ["nokey", "nk", "print_section", "p", "item_sep", "s", "escape", "e"],
    csv: ["nokey", "nk", "print_section", "p", "item_sep", "s", "escape", "e"],
    flat: ["s", "sep_char", "h", "hierarchical"],
    xml: ["q", "fully_qualified"],
    ini: ["h", "hierarchical"]
  };
  if (!Object.hasOwn(writerOptions, writer)) throw new Error(`Unknown output format ${writer}`);
  if (equals >= 0) parameters.unshift(head.slice(equals + 1));
  for (const parameter of parameters) {
    const key = parameter.split("=")[0]!;
    if (!writerOptions[writer]!.includes(key))
      throw new Error(`Unsupported writer option ${key}`);
    const value = parameter.slice(parameter.indexOf("=") + 1);
    if ((key === "escape" || key === "e") && !["c", "csv", "none"].includes(value))
      throw new Error(`Invalid escape mode ${value}`);
    if (key !== "s" && key !== "item_sep" && key !== "sep_char" && key !== "escape" && key !== "e") {
      const equals = parameter.indexOf("=");
      parseWriterBoolean(equals < 0 ? "1" : parameter.slice(equals + 1));
    }
    if ((writer === "compact" || writer === "csv") && (key === "item_sep" || key === "s") && encodeUtf8(parameter.slice(key.length + 1)).length !== 1)
      throw new Error("Item separator must be a single byte");
  }
  const entryFilter = parseEntryFilter(showEntries);
  showPackets ||= entryFilter.has("packet") && entryFilter.get("packet")?.size !== 0;
  showFrames ||= entryFilter.has("frame") && entryFilter.get("frame")?.size !== 0;
  return { printFormat, showError, showPrivateData, showOptionalFields, sexagesimal, unit, showFormat, showStreams, showData, showDataHash, showPackets, showFrames, showChapters, showPrograms,
    selectStreams, showEntries, countFrames, countPackets, webvttKind, ignoreLength, maxSize, explicitFormat, inputTarget, readIntervals, allowedExtensions, videoSize, pixelFormat, frameRate, tsFromFile, exportPathMetadata, segmentTimeMetadata, safe };
}

type SourceProbe = ProbeSourceRows | { oggRows: (args: readonly string[]) => AsyncIterable<TaggedAudioRow> };

async function probeSourceMetadata(context: CommandContext, plugins: readonly MediaAstPlugin[], input: MediaProbeSource, filename: string, budget: MediaBudgetTracker, records: { showPackets: boolean; showFrames: boolean; ignoreLength: boolean; maxSize?: number | undefined; mp4Records?: { packets: boolean; frames: boolean; metadata: boolean } }, onAudio: AudioProbeReady | undefined, retain: (close: () => Promise<void>) => void, detect = false): Promise<SourceProbe | undefined> {
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
    let header = await source.read(0, Math.min(12, input.size));
    const prefix = id3HeaderSize(header);
    if (prefix) header = await source.read(prefix, Math.min(12, input.size - prefix));
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
    if (records.mp4Records.metadata) return { ...await probeMp4Source(source, { ...scanOptions, filename, showPackets: records.mp4Records.packets, showFrames: records.mp4Records.frames }), packetSource: source };
    return { streams: [], chapters: [], packetSource: source,
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
  let result: MediaProbeSourceRecords = await (plugin.probeRecords ?? plugin.probeMetadata)!.call(plugin, source, { ...records, filename, seekable: !isStdin(filename), signal: context.signal, budget, limits: budget.limits });
  if (result.close) retain(result.close.bind(result));
  if ((onAudio || plugin.formatName === "flac" || plugin.formatName === "mp3") && !(plugin.formatName === "wav" && result.format?.tags?.time_reference !== undefined)) {
    const initialTags = plugin.formatName === "flac" ? new FlacTags(source, context, { flac: true }) : new SourceAudioTags(source, context);
    retain(initialTags.close);
    let checkpoints = 0, hasReplayGain = false;
    try {
      const audio = initialTags instanceof FlacTags
        ? await probeFlacSource(source, { signal: context.signal, onComment: async span => {
          try { await initialTags.add(span); } catch (error) { sourceFailed = true; throw error; }
        } })
        : plugin.formatName === "mp3" ? await probeMp3Source(source, { signal: context.signal, checkpoint: async () => { if (++checkpoints % 256 === 0) await yieldTurn(context.signal); }, onTag: async span => {
          if (["replaygain_track_gain", "replaygain_album_gain"].includes(span.key.toLowerCase())) hasReplayGain = true;
          try { await initialTags.add(span); } catch (error) { sourceFailed = true; throw error; }
        } })
        : await probeWavSource(source, { signal: context.signal, onTag: async span => {
          try { await initialTags.add(span); } catch (error) { sourceFailed = true; throw error; }
        } });
      if (hasReplayGain && Array.isArray(result.streams)) result = { ...result,
        streams: result.streams.map(stream => ({ ...stream,
          side_data_list: [...stream.side_data_list ?? [], { side_data_type: "Replay Gain" }] })) };
      let tags = initialTags;
      if (tags instanceof FlacTags && tags.count === 0 && id3HeaderSize(await source.read(0, Math.min(10, source.size)))) {
        const id3Tags = new SourceAudioTags(source, context);
        retain(id3Tags.close);
        await probeId3Source(source, { signal: context.signal, onTag: span => id3Tags.add(span) });
        tags = id3Tags;
      }
      if (!onAudio || Array.isArray(result.streams) && result.streams.some(stream => stream.codec_type !== "audio" || stream.side_data_list?.length)) {
        const formatTags: Record<string, MediaProbeText> = {};
        for await (const entry of tags.entries()) {
          let key = "";
          if (typeof entry.key === "string") key = entry.key;
          else for await (const part of entry.key()) key += part;
          Object.defineProperty(formatTags, key, { value: { kind: "text", chunks: entry.text }, enumerable: true });
        }
        return { ...result, format: { ...result.format!, tags: formatTags }, packetSource: source };
      }
      onAudio(audio, input.size, tags);
    } catch (error) {
      context.signal.throwIfAborted();
      if (sourceFailed) throw error;
      // Match the byte path: invalid strict audio structures retain the media schema.
    }
  }
  return { ...result, ...(["wav", "mp3", "flac"].includes(plugin.formatName) ? { packetSource: source } : {}) };
}

async function probeRetainedMetadata(context: CommandContext, plugins: readonly MediaAstPlugin[], path: string, filename: string, budget: MediaBudgetTracker, records: { showPackets: boolean; showFrames: boolean; ignoreLength: boolean; maxSize?: number | undefined; mp4Records?: { packets: boolean; frames: boolean; metadata: boolean } }, onAudio: AudioProbeReady | undefined, retain: (close: () => Promise<void>) => void, detect = false): Promise<SourceProbe | undefined> {
  if (!plugins.length || !context.fs.openReadFile) return undefined;
  const input = resolveInputPath(context.cwd, path);
  path = input.path;
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
  const start = input.start ?? 0;
  const size = Math.max(0, Math.min(stat.size, input.endExclusive ?? stat.size) - start);
  context.inputBudget?.check(size);
  budget.checkInputBytes(size);
  const result = await probeSourceMetadata(context, plugins, { size,
    read: (offset, length) => handle.read(start + offset, Math.max(0, Math.min(length, size - offset)), { signal: context.signal })
  }, filename, budget, records, onAudio, retain, detect);
  context.signal.throwIfAborted();
  return result;
}

async function probeStreamMetadata(context: CommandContext, plugin: MediaAstPlugin, filename: string, budget: MediaBudgetTracker, records: { showPackets: boolean; showFrames: boolean; ignoreLength: boolean; maxSize?: number | undefined; mp4Records?: { packets: boolean; frames: boolean; metadata: boolean } }): Promise<MediaProbeRecords | undefined> {
  if (!plugin.canDemux || plugin.probeRecords || !plugin.probeMetadataStream) return undefined;
  context.signal.throwIfAborted();
  const source = await openProbeStream(context, isStdin(filename) ? undefined : filename);
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
  const result = await plugin.probeMetadataStream(admitted(source), { ...records, filename, seekable: !isStdin(filename), signal: context.signal, budget, limits: budget.limits });
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
      let parsed: ReturnType<typeof parseProbeArguments> | undefined;
      let publishing = false;
      try {
        parsed = parseProbeArguments(args);
        const { printFormat, showPrivateData, showOptionalFields, sexagesimal, unit, showFormat, showStreams, showPackets: requestedPackets, showData, showDataHash, showFrames, showChapters, showPrograms,
          selectStreams, showEntries, countFrames, countPackets, webvttKind, ignoreLength, maxSize, explicitFormat, inputTarget, readIntervals, allowedExtensions, videoSize, pixelFormat, frameRate, tsFromFile, exportPathMetadata, segmentTimeMetadata, safe } = parsed;
        if (readIntervals && (showFrames || countFrames)) throw new Error("read_intervals currently supports packet scans, not decoded frames");
        const showPackets = requestedPackets || !!readIntervals && countPackets;
        const inlineInput = inputTarget.startsWith("data:");
        const entryFilter = parseEntryFilter(showEntries);
        const mp4Records = !options.asts ? { packets: showPackets, frames: showFrames,
          metadata: !!selectStreams || !(showPackets || showFrames) || showStreams || showFormat || showChapters || countFrames || countPackets || [...entryFilter.keys()].some(section => section !== "packet" && section !== "frame") } : undefined;
        const packetPlugins = mp4Records ? [registry.findByFormatName("mp4"), registry.findByFormatName("mov")] : [];
        let audioInput: AudioProbeInput | undefined;
        let intervalPcm: { sampleRate: number; blockAlign: number } | undefined;
        let automaticAudio = !options.asts && !explicitFormat && !showPackets && !showFrames && !showChapters && !showPrograms && !countFrames && !countPackets;
        if (automaticAudio) { try { parseAudioArguments(args); } catch { automaticAudio = false; } }
        const automaticPlugins = !explicitFormat
          ? astPlugins.filter(plugin => plugin.canDemux && (packetPlugins.includes(plugin) || plugin.probeRecords || plugin.probeMetadata || !options.asts && plugin === registry.findByFormatName("ogg")) && (!automaticAudio || ["wav", "flac", "mp3", "ogg"].some(format => plugin === registry.findByFormatName(format)))) : [];
        const explicitPlugin = explicitFormat ? registry.findByFormatName(explicitFormat) : undefined;
        const retainedPlugins = explicitPlugin
          ? (explicitPlugin.canDemux && (packetPlugins.includes(explicitPlugin) || explicitPlugin.probeRecords || explicitPlugin.probeMetadata || !options.asts && explicitPlugin === registry.findByFormatName("ogg")) ? [explicitPlugin] : []) : automaticPlugins;
        const imagePlugin = explicitFormat ? explicitPlugin : registry.findByFilename(inputTarget);
        const imageSequence = !inlineInput && imagePlugin?.id === "image2" && !isStdin(inputTarget) && (tsFromFile !== 0 || imageSequenceFilename(inputTarget, 0) !== undefined);
        let probeResult: SourceProbe | undefined = imageSequence
          ? await probeImageSequence(inputTarget, imagePlugin, readInput, budget, context.signal, frameRate, showPackets, showFrames, exportPathMetadata, tsFromFile,
            async filename => (await context.fs.stat(resolvePath(context.cwd, filename), { signal: context.signal })).mtimeMs)
          : undefined;
        const concatProtocol = inputTarget.startsWith("concat:") || inputTarget.startsWith("concatf:");
        if (!probeResult) probeResult = !inlineInput && !concatProtocol && retainedPlugins.length && !isStdin(inputTarget)
          ? await probeRetainedMetadata(context, retainedPlugins, inputTarget, inputTarget, budget, { showPackets, showFrames, ignoreLength, maxSize, ...(mp4Records ? { mp4Records } : {}) }, automaticAudio ? (audio, size, tags) => { audioInput = { audio, size, args }; storedTags = tags; } : undefined, retain, !explicitPlugin)
          : undefined;
        if (!probeResult && !inlineInput && !concatProtocol && explicitPlugin && explicitPlugin.formatName !== "mp3" && !showData && !showDataHash)
          probeResult = await probeStreamMetadata(context, explicitPlugin, inputTarget, budget, { showPackets, showFrames, ignoreLength, maxSize });
        let replay: AsyncIterable<Uint8Array> | undefined;
        const streamPlugins = explicitPlugin ? retainedPlugins : automaticPlugins;
        if (!probeResult && !inlineInput && !concatProtocol && streamPlugins.length) {
          const source = await openProbeStream(context, isStdin(inputTarget) ? undefined : inputTarget);
          if (source) {
            const sniffed = await sniffMediaStream(source, context.signal, total => {
              context.inputBudget?.check(total); budget.checkInputBytes(total);
            });
            const automaticPlugin = explicitPlugin ?? streamPlugins.find(plugin => plugin.detect(sniffed.prefix, inputTarget));
            if (id3HeaderSize(sniffed.prefix) && (!explicitPlugin || explicitPlugin.formatName === "mp3")) {
              probeResult = await withStagedProbeSource(context, sniffed.stream, async source => {
                const result = await probeSourceMetadata(context, streamPlugins, source, inputTarget, budget,
                  { showPackets, showFrames, ignoreLength, maxSize, ...(mp4Records ? { mp4Records } : {}) },
                  automaticAudio ? (audio, size, tags) => { audioInput = { audio, size, args }; storedTags = tags; } : undefined, retain, !explicitPlugin);
                if (!result) replay = (async function* () {
                  for (let offset = 0; offset < source.size; offset += 16384) {
                    context.signal.throwIfAborted();
                    yield await source.read(offset, Math.min(16384, source.size - offset));
                  }
                })();
                return result;
              }, retain);
            } else if (automaticPlugin) {
              if (!showData && !showDataHash && !automaticAudio && !automaticPlugin.probeRecords && automaticPlugin.probeMetadataStream) {
                // Sniff replay already admits each source chunk exactly once.
                probeResult = await automaticPlugin.probeMetadataStream(sniffed.stream, {
                  showPackets, showFrames, ignoreLength, maxSize, filename: inputTarget, seekable: !isStdin(inputTarget), signal: context.signal, budget, limits: budget.limits
                });
                context.signal.throwIfAborted();
              } else {
                probeResult = await withStagedProbeSource(context, sniffed.stream, source => probeSourceMetadata(context, [automaticPlugin], source, inputTarget, budget, { showPackets, showFrames, ignoreLength, maxSize, ...(mp4Records ? { mp4Records } : {}) }, automaticAudio ? (audio, size, tags) => { audioInput = { audio, size, args }; storedTags = tags; } : undefined, retain), retain);
              }
            } else replay = sniffed.stream;
          }
        }
        if (!probeResult && explicitFormat === "rawvideo") {
          const bytes = await readInput(inputTarget);
          probeResult = { ...probeRawVideo(bytes, inputTarget, videoSize, pixelFormat, frameRate, budget),
            packetSource: { size: bytes.length, async read(offset, length) { return bytes.subarray(offset, offset + length); } } };
        }
        if (!probeResult) {
          const bytes = await readInput(inputTarget, replay, replay !== undefined);

          const concatSignature = "ffconcat version 1.0";
          const concat = explicitFormat === "concat" || !explicitFormat && new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes.subarray(0, concatSignature.length)) === concatSignature;
          if (concat) {
            probeResult = await probeConcat(bytes, inputTarget, context.cwd, registry, readInput, budget, safe, segmentTimeMetadata, showPackets || countPackets, showFrames || countFrames);
          } else {
            const plugin = registry.detect(bytes, inputTarget, explicitFormat);
            if (!plugin || !plugin.canDemux) {
              const msg = explicitFormat
                ? `ffprobe: Unknown input format: '${explicitFormat}' (AST not registered)\n`
                : `ffprobe: ${inputTarget}: Invalid data found when processing input or format AST not registered\n`;
              await closeInputs();
              if (!quiet) await writeBytes(context.stderr, encodeUtf8(msg), context.signal);
              return { exitCode: 1 };
            }

            const resolveResource = await loadManifestResources(plugin, bytes, inputTarget, context.cwd, readInput, budget, allowedExtensions);
            let probe = plugin.probe(bytes, {
              webvttKind, ignoreLength, maxSize, seekable: !isStdin(inputTarget) && !inlineInput,
              resolveResource,
              filename: inputTarget,
              limits: options.limits,
              budget,
              showPackets: showPackets || countPackets,
              showFrames: showFrames || countFrames
            });
            const stream = probe.streams[0];
            if (!explicitFormat && plugin.id === "image2" && stream?.codec_name === "png") {
              probe = { ...probe, format: { ...probe.format, format_name: "png_pipe", format_long_name: "piped png sequence" } };
            }
            if (readIntervals && plugin.id === "aiff" && stream?.codec_name?.startsWith("pcm_") && stream.bits_per_sample && stream.channels) {
              intervalPcm = { sampleRate: Number(stream.sample_rate), blockAlign: stream.channels * stream.bits_per_sample / 8 };
            }
            probeResult = exportPathMetadata && plugin.id === "image2" && !isStdin(inputTarget)
              ? { ...probe, packets: probe.packets?.map(packet => ({ ...packet, ...imagePathMetadata(inputTarget) })) } : probe;
            if ((showData || showDataHash) && ["wav", "mp3", "flac", "mp4", "mov"].includes(plugin.id)) probeResult = { ...probeResult, packetSource: { size: bytes.length, async read(offset, length) { return bytes.subarray(offset, offset + length); } } };
            if (!options.asts && (!explicitFormat || explicitFormat === "mp3")) audioInput = { bytes, args };
          }
        }

        if (readIntervals && "packets" in probeResult && probeResult.packets) {
          let streams = probeResult.streams;
          const selected = selectStreams ? new Set<number>() : undefined;
          if (selected) {
            const matchesStream = createStreamSelector(selectStreams, probeResult.programs);
            const metadata: MediaProbeSourceStream[] = [];
            for await (const stream of streams) {
              context.signal.throwIfAborted(); budget.checkCpu(); budget.checkStreams(metadata.length + 1);
              metadata.push(stream);
              if (matchesStream(stream)) selected.add(stream.index);
            }
            // Metadata sources may be one-shot; replay them for stream output and counts.
            streams = metadata;
          }
          const selection = await readPacketIntervals(probeResult.packets, readIntervals, context, budget, retain, selected, intervalPcm);
          probeResult = { ...probeResult, packets: selection.packets, streams: { async *[Symbol.asyncIterator]() {
            for await (const stream of streams) yield { ...stream, nb_read_packets: String(selection.counts.get(stream.index) ?? 0) };
          } } };
        }

        const formatted = "oggRows" in probeResult
          ? formatTaggedRows(probeResult.oggRows(args), args)
          : storedTags && audioInput && "audio" in audioInput
          ? formatTaggedAudio(audioInput.audio, audioInput.size, audioInput.args, storedTags)
          : formatFfprobeSourceChunks(probeResult, {
          printFormat,
          showOptionalFields,
          showPrivateData,
          sexagesimal,
          unit,
          showFormat,
          showStreams,
          showPackets: requestedPackets,
          showData,
          showDataHash,
          showFrames,
          showChapters,
          showPrograms,
          selectStreams,
          showEntries,
          countFrames,
          countPackets,
          maxSize
        }, audioInput, context.signal);

        publishing = true;
        await writeProbeOutput(context, formatted, total => budget.checkOutputBytes(total), closeInputs);
        options.onMetrics?.(budget.getStats());
        return { exitCode: 0 };
      } catch (err) {
        try { await closeInputs(); } catch { /* Preserve the primary failure. */ }
        rethrowRuntimeError(context, err);
        let failure = err;
        if (parsed?.showError && !publishing && typeof err === "object" && err !== null && "code" in err && err.code === "ENOENT") {
          try {
            await writeProbeOutput(context, formatFfprobeSourceChunks({
              streams: [], chapters: [], error: { code: -2, string: "No such file or directory" }
            }, { ...parsed, showFormat: false, showStreams: false, showPackets: false, showFrames: false,
              showChapters: false, showPrograms: false, showEntries: undefined }, undefined, context.signal),
            total => budget.checkOutputBytes(total));
          } catch (outputError) {
            rethrowRuntimeError(context, outputError);
            failure = outputError;
          }
        }
        const msg = failure instanceof Error ? failure.message : String(failure);
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
  if (args.length === 0 || args.includes("-read_intervals")) return undefined;
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
    const { printFormat, showPrivateData, showOptionalFields, sexagesimal, unit, showFormat, showStreams, showPackets, showData, showDataHash, showFrames, showChapters, showPrograms,
      selectStreams, showEntries, countFrames, countPackets, webvttKind, ignoreLength, maxSize, explicitFormat, inputTarget, videoSize, pixelFormat, frameRate, tsFromFile, exportPathMetadata } = parseProbeArguments(args);
    const imagePlugin = explicitFormat ? registry.findByFormatName(explicitFormat) : registry.findByFilename(inputTarget);
    if (inputTarget.startsWith("concat:") || tsFromFile !== 0 || imagePlugin?.id === "image2" && imageSequenceFilename(inputTarget, 0) !== undefined) return undefined;
    if (inputTarget.startsWith("data:")) return undefined;
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
    if (explicitFormat !== "rawvideo" && (!plugin || !plugin.canDemux)) return undefined;
    const raw = explicitFormat === "rawvideo" ? probeRawVideo(bytes, inputTarget, videoSize, pixelFormat, frameRate, budget) : undefined;
    let probeResult = raw ? { ...raw, packets: Array.from(raw.packets ?? []), frames: Array.from(raw.frames ?? []) } : plugin!.probe(bytes, {
      webvttKind, ignoreLength, maxSize, seekable: !isStdin(inputTarget),
      filename: inputTarget,
      budget,
      showPackets: showPackets || countPackets,
      showFrames: showFrames || countFrames,
    });
    if (!explicitFormat && plugin?.id === "image2" && probeResult.streams[0]?.codec_name === "png") {
      probeResult = { ...probeResult, format: { ...probeResult.format, format_name: "png_pipe", format_long_name: "piped png sequence" } };
    }
    if ((showData || showDataHash) && !raw && !probeResult.packetData && !["wav", "mp3", "flac", "mp4", "mov"].includes(plugin!.id)) return undefined;
    const packets = showData || showDataHash ? probeResult.packets?.map(packet => {
      if (probeResult.packetData?.has(`${packet.pos}:${packet.size}`)) return packet;
      const offset = Number(packet.pos), size = Number(packet.size);
      if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(size) || size < 0 || offset + size > bytes.length)
        throw new Error("Invalid packet data span");
      return { ...packet, ...(showData ? { data: "\n" + [...packetHexRows(bytes.subarray(offset, offset + size))].join("") } : {}), ...(showDataHash ? { data_hash: packetHash(bytes.subarray(offset, offset + size), showDataHash) } : {}) };
    }) : probeResult.packets;
    const probeOut = formatFfprobeResult({ ...probeResult, packets: exportPathMetadata && plugin?.id === "image2" && !isStdin(inputTarget)
      ? packets?.map(packet => ({ ...packet, ...imagePathMetadata(inputTarget) })) : packets }, {
      showData,
      showDataHash,
      printFormat,
      showOptionalFields,
      showPrivateData,
      sexagesimal,
      unit,
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
      maxSize,
    }, !explicitFormat || explicitFormat === "mp3" ? { bytes, args } : undefined);
    return probeOut.includes("\0") ? undefined : probeOut;
  } catch {
    return undefined;
  }
}
