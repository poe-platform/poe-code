import { correlateAudio } from "./audio-axcorrelate.js";
import { gateAudio } from "./audio-sidechaingate.js";
import { limitAudio } from "./audio-alimiter.js";
import { compressAudio } from "./audio-acompressor.js";
import { normalizeSpeech } from "./audio-speechnorm.js";
import { normalizeAudio } from "./audio-dynaudnorm.js";
import { compandAudio } from "./audio-compand.js";
import { fadeAudio } from "./audio-fade.js";
import { acrossfadeAudio } from "./audio-acrossfade.js";
import { mixAudio } from "./audio-amix.js";
import { joinAudio } from "./audio-join.js";
import { enhanceDialogue } from "./audio-dialogue.js";
import { measureEbur128 } from "./audio-ebur128.js";
import { serializeFrameChecksum } from "./frame-checksum.js";
import { md5, sha1 } from "@noble/hashes/legacy.js";
import { sha224, sha256, sha384, sha512 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { createFfprobeCommand } from "safe-bash-command-ffprobe";
export { createFfprobeCommand } from "safe-bash-command-ffprobe";
export { evalSyncFfprobe } from "safe-bash-command-ffprobe/media";
import { isStdin, rethrowRuntimeError, createInputReader, loadManifestResources, resolvePath,
  formatIntrospectionOutput, getDefaultMediaRegistry,
  type MediaCommandsOptions as FfmpegCommandsOptions } from "safe-bash-command-ffprobe/media";
export type { MediaCommandsOptions as FfmpegCommandsOptions } from "safe-bash-command-ffprobe/media";
import { yieldTurn } from "safe-bash-contracts/yield";
import { resampleAudio } from "./audio-resample.js";
import { filterUnityTempo, stretchAudio } from "./audio-tempo.js";
import { scaleFrame } from "./scale.js";
import { rotateYuvFrame } from "./rotate.js";
import { writeFileOutput } from "safe-bash-contracts/filesystem-output-budget";
import {
  commandRuntimeIdentity,
  getCommandArguments,
  type CommandContext,
  type CommandDefinition
} from "safe-bash-contracts/command";
import { writeBytes } from "safe-bash-contracts/io";
import type { VirtualShellPlugin } from "safe-bash-contracts/plugin";
import {
  compositeImage,
  decodeImage,
  encodeImage,
  extendImage,
  extractImage,
  flipImage,
  flopImage,
  grayscaleImage,
  negateImage,
  resizeImage,
  rotateImage,
  type ImageFormat,
  type RgbaImage
} from "@poe-code/image-ast/portable";
import {
  allMediaAsts,
  cloudflareWorkerLimits,
  concatBytes,
  concatMp4,
  createMediaAstRegistry,
  createSyntheticMp4,
  decodeH264Samples,
  decodeAacTrack,
  scaleVideoPicture,
  decodeUtf8,
  encodeUtf8,
  parseSubtitleDocument,
  serializeDashDocument,
  srtAst,
  assAst,
  webvttAst,
  ffmetadataAst,
  hlsAst,
  dashAst,
  MediaBudgetTracker,
  MediaLimitExceededError,
  muxMp4,
  muxMp4Steps,
  type MuxMediaOptions,
  parseMp4,
  parseMp4Boxes,
  sliceMp4,
  type MediaAstPlugin,
  type MediaAudioData,
  type MediaDocument,
  type MediaAttachment,
  type MediaFeatureOptions,
  type MediaResourceLimits,
  type MediaTrack,
  type MediaVideoFrame,
  type Mp4MetadataTags
} from "@poe-code/mp4-ast";

export {
  allMediaAsts,
  cloudflareWorkerLimits,
  srtAst,
  assAst,
  webvttAst,
  ffmetadataAst,
  hlsAst,
  dashAst,
  MediaBudgetTracker,
  MediaLimitExceededError,
  type MediaAstPlugin,
  type MediaFeatureOptions,
  type MediaResourceLimits,
  type MediaResourceLimits as FfmpegLimits
};

function serializeAudioChecksum(
  doc: MediaDocument,
  format: string,
  algorithm: string,
  audioCodec: string | undefined,
  rawAudio: MediaAstPlugin | undefined,
  budget: MediaBudgetTracker
): Uint8Array {
  if (format === "streamhash") {
    return concatBytes(doc.tracks.map((track, index) => concatBytes([
      encodeUtf8(`${index},a,`),
      serializeAudioChecksum({ ...doc, tracks: [track] }, "hash", algorithm, audioCodec, rawAudio, budget)
    ])));
  }
  if (doc.tracks.length !== 1 || doc.tracks[0]!.type !== "audio") {
    throw new Error("Checksum output requires a single audio stream");
  }
  if (!rawAudio?.canMux) throw new Error("Raw audio AST is not registered");
  const payload = rawAudio.serialize(doc, { audioCodec, budget });
  if (format === "crc") {
    // FFmpeg's crc muxer uses Adler-32 rather than a CRC polynomial.
    let a = 1;
    let b = 0;
    for (let i = 0; i < payload.length; i++) {
      if (i % 4096 === 0) budget.checkCpu();
      a = (a + payload[i]!) % 65521;
      b = (b + a) % 65521;
    }
    return encodeUtf8(`CRC=0x${((b * 65536 + a) >>> 0).toString(16).padStart(8, "0")}\n`);
  }
  const name = format === "md5" ? "md5" : algorithm.toLowerCase();
  const hashes = { md5, sha160: sha1, sha224, sha256, sha384, sha512 };
  if (!Object.hasOwn(hashes, name)) throw new Error(`Unknown hash algorithm '${algorithm}'`);
  const hash = hashes[name as keyof typeof hashes].create();
  for (let offset = 0; offset < payload.length; offset += 65536) {
    budget.checkCpu();
    hash.update(payload.subarray(offset, offset + 65536));
  }
  return encodeUtf8(`${name.toUpperCase()}=${bytesToHex(hash.digest())}\n`);
}

function parseAudioBitrate(value: string | undefined): number | undefined {
  const suffix = value?.slice(-1);
  const scale = suffix === "k" || suffix === "K" ? 1000 : suffix === "M" ? 1000000 : 1;
  const number = scale === 1 ? value : value?.slice(0, -1);
  const bitrate = number?.trim() ? Number(number) * scale : NaN;
  if (!Number.isSafeInteger(bitrate) || bitrate < 0 || bitrate > 2147483647) {
    return undefined;
  }
  return bitrate;
}

function parseFrameRate(value: string): number | undefined {
  switch (value) {
    case "ntsc": case "qntsc": case "sntsc": return 30000 / 1001;
    case "pal": case "qpal": case "spal": return 25;
    case "film": return 24;
    case "ntsc-film": return 24000 / 1001;
  }
  const [numerator, denominator = "1", extra] = value.split("/");
  if (extra !== undefined || !numerator?.trim() || !denominator.trim()) return undefined;
  const rate = Number(numerator) / Number(denominator);
  return Number.isFinite(rate) && rate > 0 ? rate : undefined;
}

function loopToOutputEnd(
  doc: MediaDocument,
  endSeconds: number | undefined,
  budget: MediaBudgetTracker
): MediaDocument {
  if (endSeconds === undefined || !Number.isFinite(endSeconds)) {
    throw new Error("-stream_loop -1 requires a finite output -t or -to");
  }
  budget.checkDuration(endSeconds);
  if (doc.durationSeconds <= 0 || endSeconds <= doc.durationSeconds) return doc;
  const copies = Math.ceil(endSeconds / doc.durationSeconds);
  budget.checkConcatInputs(copies);
  budget.allocateMemory(copies * 8);
  try {
    return concatMp4(Array.from({ length: copies }, () => doc), { budget });
  } finally {
    budget.releaseMemory(copies * 8);
  }
}

function isStdout(path: string): boolean {
  return ["-", "pipe:", "pipe:1", "/dev/stdout", "/dev/fd/1"].includes(path);
}

function dirnameOf(p: string): string {
  const idx = p.lastIndexOf("/");
  if (idx <= 0) return "/";
  return p.slice(0, idx);
}

export function parseFfmpegTimestamp(spec: string): number {
  const trimmed = spec.trim();
  if (!trimmed) return 0;
  if (trimmed.endsWith("ms")) {
    return (parseFloat(trimmed.slice(0, -2)) || 0) / 1000;
  }
  if (trimmed.endsWith("us")) {
    return (parseFloat(trimmed.slice(0, -2)) || 0) / 1_000_000;
  }
  if (trimmed.endsWith("s") && !trimmed.includes(":")) {
    return parseFloat(trimmed.slice(0, -1)) || 0;
  }
  if (trimmed.includes(":")) {
    const parts = trimmed.split(":").map((x) => parseFloat(x) || 0);
    if (parts.length === 3) {
      return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!;
    }
    if (parts.length === 2) {
      return parts[0]! * 60 + parts[1]!;
    }
  }
  return parseFloat(trimmed) || 0;
}

// CLI duration options require complete FFmpeg duration strings.
function parseHlsDuration(spec: string): number {
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

function parseColorRgba(colorStr: string): [number, number, number, number] {
  const value = colorStr.trim().toLowerCase();
  const separator = value.indexOf("@");
  const s = separator < 0 ? value : value.slice(0, separator);
  let alpha: number | undefined;
  if (separator >= 0) {
    const suffix = value.slice(separator + 1);
    const opacity = Number(suffix);
    const maximum = suffix.startsWith("0x") ? 255 : 1;
    if (!suffix || !Number.isFinite(opacity) || opacity < 0 || opacity > maximum) {
      throw new Error(`Invalid color alpha: ${colorStr}`);
    }
    alpha = Math.floor(opacity * 255 / maximum);
  }
  const named: Record<string, [number, number, number, number]> = {
    aliceblue: [240, 248, 255, 255],
    black: [0, 0, 0, 255],
    white: [255, 255, 255, 255],
    red: [255, 0, 0, 255],
    green: [0, 128, 0, 255],
    lime: [0, 255, 0, 255],
    blue: [0, 0, 255, 255],
    yellow: [255, 255, 0, 255],
    cyan: [0, 255, 255, 255],
    magenta: [255, 0, 255, 255],
    gray: [128, 128, 128, 255],
    grey: [128, 128, 128, 255],
    orange: [255, 165, 0, 255],
    purple: [128, 0, 128, 255]
  };
  if (named[s]) {
    const color = named[s]!;
    color[3] = alpha ?? color[3];
    return color;
  }
  const hex = s.startsWith("#") ? s.slice(1) : s.startsWith("0x") ? s.slice(2) : s;
  if ((hex.length === 6 || hex.length === 8) && [...hex].every((digit) => "0123456789abcdef".includes(digit))) {
    return [
      parseInt(hex.slice(0, 2), 16) || 0,
      parseInt(hex.slice(2, 4), 16) || 0,
      parseInt(hex.slice(4, 6), 16) || 0,
      alpha ?? (hex.length === 8 ? parseInt(hex.slice(6, 8), 16) : 255)
    ];
  }
  throw new Error(`Invalid color: ${colorStr}`);
}

function detachBytesBuffer(bytes: Uint8Array | undefined): void {
  if (!bytes) return;
  const buf = bytes.buffer as ArrayBuffer & { transfer?: (newByteLength?: number) => ArrayBuffer };
  if (typeof buf.transfer === "function" && bytes.byteOffset === 0 && bytes.byteLength === buf.byteLength) {
    try {
      buf.transfer(0);
    } catch {
      // Buffer may be non-detachable.
    }
  }
}

function makeRgbaImg(width: number, height: number, data: Uint8Array): RgbaImage {
  return {
    width,
    height,
    channels: 4,
    data,
    format: "png",
    space: "srgb",
    depth: "uchar",
    density: 72,
    hasAlpha: true
  };
}

function* lavfiSteps(
  spec: string,
  budget: MediaBudgetTracker,
  durationOverride?: number
): Generator<void, MediaDocument> {
  let work = 0;
  // Examples:
  // color=c=red:s=320x240:r=25:d=2
  // testsrc=size=160x120:rate=10:duration=1
  // sine=frequency=440:sample_rate=44100:duration=1
  // anullsrc=r=44100:cl=stereo
  const eqIdx = spec.indexOf("=");
  const filterName = (eqIdx >= 0 ? spec.slice(0, eqIdx) : spec).trim().toLowerCase();
  const argsPart = eqIdx >= 0 ? spec.slice(eqIdx + 1) : "";
  const kv: Record<string, string> = {};
  for (const part of argsPart.split(":")) {
    if (++work % 1024 === 0) yield;

    const kIdx = part.indexOf("=");
    if (kIdx >= 0) {
      kv[part.slice(0, kIdx).trim().toLowerCase()] = part.slice(kIdx + 1).trim();
    } else if (part.trim()) {
      kv._0 = part.trim();
    }
  }

  if (filterName === "sine" || filterName === "anullsrc") {
    const sampleRate = parseInt(kv.sample_rate ?? kv.r ?? "44100", 10) || 44100;
    const parsedFrequency = parseFloat(kv.frequency ?? kv.f ?? "440");
    const freq = Number.isNaN(parsedFrequency) ? 440 : parsedFrequency;
    const duration =
      durationOverride ?? (parseFloat(kv.duration ?? kv.d ?? "1") || 1);
    const layout = kv.channel_layout ?? kv.cl;
    const channels = layout === "mono" || layout === undefined && filterName === "sine" ? 1 : 2;
    const totalSamples = Math.max(0, Math.round(duration * sampleRate));
    budget.checkDuration(duration);

    const channelData: Float32Array[] = [];
    for (let channel = 0; channel < channels; channel++) {
      const arr = new Float32Array(totalSamples);
      if (filterName === "sine") {
        for (let i = 0; i < totalSamples; i++) {
          if (i % 4096 === 0) yield;
          arr[i] = Math.sin((2 * Math.PI * freq * i) / sampleRate) * 0.125;
        }
      }
      channelData.push(arr);
    }

    yield;
    const mp4Bytes = createSyntheticMp4({
      width: 16,
      height: 16,
      fps: 10,
      durationSeconds: duration,
      includeAudio: true,
      sampleRate,
      channels
    });
    const base = parseMp4(mp4Bytes);
    const audioTrack = base.tracks.find((t) => t.type === "audio")!;
    return {
      ...base,
      tracks: [
        {
          ...audioTrack,
          id: 1,
          decodedAudio: { sampleRate, channels, channelData }
        }
      ]
    };
  }

  const sizeStr = kv.size ?? kv.s ?? "320x240";
  const [wStr, hStr] = sizeStr.toLowerCase().split("x");
  const width = parseInt(wStr ?? "320", 10) || 320;
  const height = parseInt(hStr ?? "240", 10) || 240;
  const fps = parseFloat(kv.rate ?? kv.r ?? "25") || 25;
  const duration =
    durationOverride ?? (parseFloat(kv.duration ?? kv.d ?? "1") || 1);
  const frameCount = Math.max(1, Math.round(duration * fps));
  const color = parseColorRgba(kv.color ?? kv.c ?? kv._0 ?? "blue");

  const top = [[191, 191, 191], [191, 191, 0], [0, 191, 191], [0, 191, 0], [191, 0, 191], [191, 0, 0], [0, 0, 191]];
  const middle = [[0, 0, 191], [19, 19, 19], [191, 0, 191], [19, 19, 19], [0, 191, 191], [19, 19, 19], [191, 191, 191]];
  const lower = [[0, 33, 76], [255, 255, 255], [50, 0, 106], [19, 19, 19], [9, 9, 9], [19, 19, 19], [29, 29, 29], [19, 19, 19]];
  const frames: MediaVideoFrame[] = [];
  for (let i = 0; i < frameCount; i++) {
    yield;
    budget.recordFrame(width, height);
    const rgba = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
      if (y % 16 === 0) yield;
      for (let x = 0; x < width; x++) {
        if (++work % 1024 === 0) yield;

        const idx = (y * width + x) * 4;
        if (filterName === "smptebars") {
          const column = Math.min(6, Math.floor(x * 7 / width));
          const bottomColumn = x < width * 5 / 7 ? Math.min(3, Math.floor(x * 28 / (width * 5)))
            : x < width * 6 / 7 ? 4 + Math.min(2, Math.floor((x * 7 / width - 5) * 3)) : 7;
          const pixel = y < height * 2 / 3 ? top[column]! : y < height * 3 / 4 ? middle[column]! : lower[bottomColumn]!;
          rgba[idx] = pixel[0]!;
          rgba[idx + 1] = pixel[1]!;
          rgba[idx + 2] = pixel[2]!;
          rgba[idx + 3] = 255;
        } else if (filterName.startsWith("testsrc")) {
          const bar = Math.floor((x / Math.max(1, width)) * 7);
          const palette: [number, number, number][] = [
            [255, 255, 255],
            [255, 255, 0],
            [0, 255, 255],
            [0, 255, 0],
            [255, 0, 255],
            [255, 0, 0],
            [0, 0, 255]
          ];
          const [r, g, b] = palette[bar % 7]!;
          const scanY = (i * 16) % Math.max(16, height);
          const inScanBar = y >= scanY && y < scanY + 16;
          rgba[idx] = inScanBar ? (r ^ 0x80) : r;
          rgba[idx + 1] = inScanBar ? (g ^ 0x80) : g;
          rgba[idx + 2] = inScanBar ? (b ^ 0x80) : b;
          rgba[idx + 3] = 255;
        } else {
          rgba[idx] = color[0];
          rgba[idx + 1] = color[1];
          rgba[idx + 2] = color[2];
          rgba[idx + 3] = color[3];
        }
      }
    }
    frames.push({
      width,
      height,
      data: rgba,
      ptsSeconds: i / fps,
      durationSeconds: 1 / fps,
      keyframe: true
    });
  }

  yield;
  const mp4Bytes = createSyntheticMp4({
    width,
    height,
    fps,
    frameCount: 1,
    color: [color[0], color[1], color[2]],
    includeAudio: false
  });
  const parsed = parseMp4(mp4Bytes);
  return {
    ...parsed,
    duration: Math.round(frameCount / fps * parsed.timescale),
    durationSeconds: frameCount / fps,
    tracks: parsed.tracks.map((t) =>
      t.type === "video"
        ? { ...t, duration: Math.round(frameCount / fps * t.timescale), samples: [], decodedVideoFrames: frames }
        : t
    )
  };
}

async function ensureDecodedFrames(
  track: MediaTrack,
  movieTimescale: number,
  budget: MediaBudgetTracker,
  signal?: AbortSignal,
  maxFrames?: number
): Promise<MediaVideoFrame[]> {
  if (maxFrames === 0) return [];
  const width = track.width ?? track.codecDescriptions[0]?.width ?? 64;
  const height = track.height ?? track.codecDescriptions[0]?.height ?? 64;
  const ts = track.timescale || 90000;
  const frames: MediaVideoFrame[] = [];
  const decoded = track.decodedVideoFrames ?? decodeH264Samples(track.samples, track.codecDescriptions, width, height, ts);
  for (const frame of decoded) {
    await yieldTurn(signal);
    signal?.throwIfAborted();
    if (!track.decodedVideoFrames) budget.recordFrame(frame.width, frame.height);
    // Retained keyframes and B-frame references can precede the visible interval.
    // Keep media timestamps: filters and serializers still apply the edit list.
    const pts = Math.round(frame.ptsSeconds * ts);
    if (track.editList?.length && !track.editList.some(edit =>
      edit.mediaTime >= 0 && pts >= edit.mediaTime &&
      pts < edit.mediaTime + edit.segmentDuration * ts / movieTimescale
    )) continue;
    frames.push(frame);
    if (maxFrames !== undefined && frames.length >= maxFrames) break;
  }
  return frames;
}

function evalScaleDim(expr: string, iw: number, ih: number): number {
  const clean = expr.trim().toLowerCase();
  if (clean === "-1" || clean === "-2") return -1;
  if (clean === "iw" || clean === "in_w") return iw;
  if (clean === "ih" || clean === "in_h") return ih;
  if (clean.startsWith("iw/")) return Math.max(1, Math.round(iw / (parseFloat(clean.slice(3)) || 1)));
  if (clean.startsWith("ih/")) return Math.max(1, Math.round(ih / (parseFloat(clean.slice(3)) || 1)));
  if (clean.startsWith("iw*")) return Math.max(1, Math.round(iw * (parseFloat(clean.slice(3)) || 1)));
  if (clean.startsWith("ih*")) return Math.max(1, Math.round(ih * (parseFloat(clean.slice(3)) || 1)));
  return parseInt(clean, 10) || iw;
}


function roundToEven(value: number): number {
  const lower = Math.floor(value);
  // FFmpeg uses lrint: exact halves round to the nearest even integer.
  return value - lower === 0.5 ? lower + Math.abs(lower % 2) : Math.round(value);
}

function parseFilterExpression(expression: string, filter: string, variables: Record<string, number>, sampleValue?: (channel: number) => number): number {
  let offset = 0;
  const source = expression.trim();
  function parse(minPrecedence = 0, depth = 0): number {
    if (depth > 64) throw new Error(`${filter}: expression is too deeply nested`);
    while (source[offset] === " ") offset++;
    let value: number;
    const first = source[offset];
    if (first === "+" || first === "-") {
      offset++;
      value = parse(3, depth + 1) * (first === "-" ? -1 : 1);
    } else if (first === "(") {
      offset++;
      value = parse(0, depth + 1);
      if (source[offset++] !== ")") throw new Error(`${filter}: invalid expression`);
    } else if (first && ((first >= "a" && first <= "z") || (first >= "A" && first <= "Z") || first === "_")) {
      const start = offset++;
      while (offset < source.length) {
        const c = source[offset]!;
        if ((c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9") || c === "_") offset++;
        else break;
      }
      const name = source.slice(start, offset);
      while (source[offset] === " ") offset++;
      if (source[offset] === "(") {
        offset++;
        const args = [parse(0, depth + 1)];
        while (source[offset] === ",") {
          offset++;
          args.push(parse(0, depth + 1));
        }
        if (source[offset++] !== ")" || args.some(arg => !Number.isFinite(arg))) {
          throw new Error(`${filter}: invalid expression`);
        }
        if (name === "val" && args.length === 1 && sampleValue) value = sampleValue(args[0]!);
        else if (name === "not" && args.length === 1) value = Number(args[0] === 0);
        else if (name === "eq" && args.length === 2) value = Number(args[0] === args[1]);
        else if (name === "gte" && args.length === 2) value = Number(args[0]! >= args[1]!);
        else if (name === "lt" && args.length === 2) value = Number(args[0]! < args[1]!);
        else if (name === "if" && args.length === 3) value = args[0] !== 0 ? args[1]! : args[2]!;
        else if (name === "gt" && args.length === 2) value = Number(args[0]! > args[1]!);
        else if (name === "mod" && args.length === 2) value = args[0]! - Math.floor(args[0]! / args[1]!) * args[1]!;
        else if (name === "between" && args.length === 3) value = Number(args[0]! >= args[1]! && args[0]! <= args[2]!);
        else throw new Error(`${filter}: invalid or unsupported expression`);
      } else {
        value = Object.hasOwn(variables, name) ? variables[name]! : NaN;
      }
    } else {
      const start = offset;
      while (offset < source.length) {
        const c = source[offset]!;
        if ((c >= "0" && c <= "9") || c === "." || c === "e" || c === "E"
          || ((c === "+" || c === "-") && (source[offset - 1] === "e" || source[offset - 1] === "E"))) offset++;
        else break;
      }
      value = start === offset ? NaN : Number(source.slice(start, offset));
    }
    for (;;) {
      while (source[offset] === " ") offset++;
      const operator = source[offset];
      const precedence = operator === "+" || operator === "-" ? 1 : operator === "*" || operator === "/" ? 2 : 0;
      if (precedence === 0 || precedence < minPrecedence) break;
      offset++;
      const right = parse(precedence + 1, depth + 1);
      if (operator === "+") value += right;
      else if (operator === "-") value -= right;
      else if (operator === "*") value *= right;
      else value /= right;
    }
    return value;
  }
  const angle = parse();
  if (offset !== source.length || !Number.isFinite(angle)) throw new Error(`${filter}: invalid or unsupported expression`);
  return angle;
}


const GLYPH_5X7: Record<string, readonly number[]> = {
  " ": [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
  "0": [0x0e, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0e],
  "1": [0x04, 0x0c, 0x04, 0x04, 0x04, 0x04, 0x0e],
  "2": [0x0e, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1f],
  "3": [0x1f, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0e],
  "4": [0x02, 0x06, 0x0a, 0x12, 0x1f, 0x02, 0x02],
  "5": [0x1f, 0x10, 0x1e, 0x01, 0x01, 0x11, 0x0e],
  "6": [0x06, 0x08, 0x10, 0x1e, 0x11, 0x11, 0x0e],
  "7": [0x1f, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
  "8": [0x0e, 0x11, 0x11, 0x0e, 0x11, 0x11, 0x0e],
  "9": [0x0e, 0x11, 0x11, 0x0f, 0x01, 0x02, 0x0c],
  "A": [0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  "B": [0x1e, 0x11, 0x11, 0x1e, 0x11, 0x11, 0x1e],
  "C": [0x0e, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0e],
  "D": [0x1c, 0x12, 0x11, 0x11, 0x11, 0x12, 0x1c],
  "E": [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x1f],
  "F": [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x10],
  "G": [0x0e, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0f],
  "H": [0x11, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  "I": [0x0e, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0e],
  "J": [0x07, 0x02, 0x02, 0x02, 0x02, 0x12, 0x0c],
  "K": [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11],
  "L": [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1f],
  "M": [0x11, 0x1b, 0x15, 0x15, 0x11, 0x11, 0x11],
  "N": [0x11, 0x19, 0x15, 0x13, 0x11, 0x11, 0x11],
  "O": [0x0e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  "P": [0x1e, 0x11, 0x11, 0x1e, 0x10, 0x10, 0x10],
  "Q": [0x0e, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0d],
  "R": [0x1e, 0x11, 0x11, 0x1e, 0x14, 0x12, 0x11],
  "S": [0x0f, 0x10, 0x10, 0x0e, 0x01, 0x01, 0x1e],
  "T": [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
  "U": [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  "V": [0x11, 0x11, 0x11, 0x11, 0x11, 0x0a, 0x04],
  "W": [0x11, 0x11, 0x11, 0x15, 0x15, 0x15, 0x0a],
  "X": [0x11, 0x11, 0x0a, 0x04, 0x0a, 0x11, 0x11],
  "Y": [0x11, 0x11, 0x11, 0x0a, 0x04, 0x04, 0x04],
  "Z": [0x1f, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1f],
  ".": [0x00, 0x00, 0x00, 0x00, 0x00, 0x0c, 0x0c],
  ",": [0x00, 0x00, 0x00, 0x00, 0x0c, 0x04, 0x08],
  ":": [0x00, 0x0c, 0x0c, 0x00, 0x0c, 0x0c, 0x00],
  "-": [0x00, 0x00, 0x00, 0x1f, 0x00, 0x00, 0x00],
  "_": [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x1f],
  "!": [0x04, 0x04, 0x04, 0x04, 0x04, 0x00, 0x04],
  "?": [0x0e, 0x11, 0x01, 0x02, 0x04, 0x00, 0x04]
};

async function renderBitmapTextToRgba(
  rgba: Uint8Array,
  width: number,
  height: number,
  text: string,
  opts: {
    xExpr?: string;
    yExpr?: string;
    fontSize?: number;
    fontColor?: [number, number, number, number];
    drawBox?: boolean;
    boxColor?: [number, number, number, number];
  } = {},
  signal?: AbortSignal
): Promise<Uint8Array> {
  let work = 0;

  const out = new Uint8Array(rgba);
  const scale = Math.max(1, Math.round((opts.fontSize ?? 12) / 8));
  const charW = 6 * scale;
  const charH = 8 * scale;
  const lines = text.split("\n");
  const maxCols = Math.max(1, ...lines.map((l) => l.length));
  const textW = maxCols * charW;
  const textH = lines.length * charH;

  const evalPos = (expr: string | undefined, defVal: number): number => {
    if (!expr) return defVal;
    const clean = expr.trim().toLowerCase();
    if (clean.includes("(w-text_w)/2") || clean.includes("(w-tw)/2")) {
      return Math.floor((width - textW) / 2);
    }
    if (clean.includes("(h-text_h)/2") || clean.includes("(h-th)/2")) {
      return Math.floor((height - textH) / 2);
    }
    if (clean.startsWith("h-text_h-") || clean.startsWith("h-th-")) {
      const off = parseInt(clean.split("-").pop() ?? "8", 10) || 8;
      return Math.max(0, height - textH - off);
    }
    const num = parseInt(clean, 10);
    return Number.isFinite(num) ? num : defVal;
  };

  const startX = evalPos(opts.xExpr, Math.max(2, Math.floor((width - textW) / 2)));
  const startY = evalPos(opts.yExpr, Math.max(2, height - textH - 6));
  const fg = opts.fontColor ?? [255, 255, 255, 255];

  if (opts.drawBox) {
    const bg = opts.boxColor ?? [0, 0, 0, 180];
    const pad = 2 * scale;
    for (let y = Math.max(0, startY - pad); y < Math.min(height, startY + textH + pad); y++) {
      if (++work % 1024 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); }

      for (let x = Math.max(0, startX - pad); x < Math.min(width, startX + textW + pad); x++) {
        if (++work % 1024 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); }

        const idx = (y * width + x) * 4;
        const alpha = bg[3] / 255;
        out[idx] = Math.round(bg[0] * alpha + out[idx]! * (1 - alpha));
        out[idx + 1] = Math.round(bg[1] * alpha + out[idx + 1]! * (1 - alpha));
        out[idx + 2] = Math.round(bg[2] * alpha + out[idx + 2]! * (1 - alpha));
        out[idx + 3] = 255;
      }
    }
  }

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    if (++work % 1024 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); }

    const line = lines[lineIdx]!.toUpperCase();
    const lineY = startY + lineIdx * charH;
    for (let cIdx = 0; cIdx < line.length; cIdx++) {
      if (++work % 1024 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); }

      const ch = line[cIdx]!;
      const rows = GLYPH_5X7[ch] ?? GLYPH_5X7["?"];
      if (!rows) continue;
      const charX = startX + cIdx * charW;
      for (let r = 0; r < 7; r++) {
        if (++work % 1024 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); }

        const mask = rows[r]!;
        for (let col = 0; col < 5; col++) {
          if (++work % 1024 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); }

          if ((mask & (1 << (4 - col))) === 0) continue;
          for (let sy = 0; sy < scale; sy++) {
            if (++work % 1024 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); }

            for (let sx = 0; sx < scale; sx++) {
              if (++work % 1024 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); }

              const px = charX + col * scale + sx;
              const py = lineY + r * scale + sy;
              if (px >= 0 && px < width && py >= 0 && py < height) {
                const idx = (py * width + px) * 4;
                out[idx] = fg[0];
                out[idx + 1] = fg[1];
                out[idx + 2] = fg[2];
                out[idx + 3] = 255;
              }
            }
          }
        }
      }
    }
  }

  return out;
}

function parseFilterChain(filterChainStr: string): string[] {
  const filters: string[] = [];
  let filter = "";
  let quoted = false;
  for (let i = 0; i < filterChainStr.length; i++) {
    const char = filterChainStr[i]!;
    // FFmpeg quotes protect all characters; backslashes escape only outside quotes.
    if (char === "'") {
      quoted = !quoted;
    } else if (!quoted && char === "\\" && i + 1 < filterChainStr.length) {
      filter += filterChainStr[++i]!;
    } else if (!quoted && char === ",") {
      if (filter.trim()) filters.push(filter.trim());
      filter = "";
    } else {
      filter += char;
    }
  }
  if (filter.trim()) filters.push(filter.trim());

  return filters;
}

function parseChannelSplit(spec: string): string[] {
  const equals = spec.indexOf("=");
  let layout = "stereo";
  let channels = "all";
  const options = equals < 0 ? [] : spec.slice(equals + 1).split(":");
  for (const [index, option] of options.entries()) {
    const separator = option.indexOf("=");
    const key = separator < 0 ? ["channel_layout", "channels"][index] : option.slice(0, separator);
    const value = separator < 0 ? option : option.slice(separator + 1);
    if (key === "channel_layout") layout = value;
    else if (key === "channels") channels = value;
    else throw new Error(`channelsplit: unsupported option ${key}`);
  }
  if (layout !== "stereo") throw new Error(`channelsplit: unsupported channel layout ${layout}`);
  const selected = channels === "all" ? ["FL", "FR"] : channels.split("+");
  if (selected.some(channel => channel !== "FL" && channel !== "FR") || new Set(selected).size !== selected.length) {
    throw new Error(`channelsplit: invalid channels ${channels}`);
  }
  return ["FL", "FR"].filter(channel => selected.includes(channel));
}

async function panAudio(
  spec: string, channels: MediaAudioData["channelData"], channelMask: number | undefined,
  budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<{ channels: Float32Array[]; channelMask: number }> {
  const [layout, ...assignments] = spec.split("|").map(value => value.trim());
  const names = layout === "mono" || layout === "1c" ? ["FC"]
    : layout === "stereo" || layout === "2c" ? ["FL", "FR"] : undefined;
  if (!names) throw new Error(`pan: unsupported output layout ${layout}`);
  const inputNames = channelMask
    ? ["FL", "FR", "FC", "LFE", "BL", "BR", "FLC", "FRC", "BC", "SL", "SR"]
      .filter((_, index) => (channelMask & (1 << index)) !== 0)
    : channels.length === 1 ? ["FC"] : channels.length === 2 ? ["FL", "FR"] : [];
  const channelIndex = (name: string, labels: string[], count: number) => {
    const index = name.startsWith("c") && name.length > 1 &&
      [...name.slice(1)].every(char => char >= "0" && char <= "9")
      ? Number(name.slice(1)) : labels.indexOf(name);
    if (!Number.isInteger(index) || index < 0 || index >= count) throw new Error(`pan: invalid channel ${name}`);
    return index;
  };
  const gains = names.map(() => new Float64Array(channels.length));
  const assigned = new Set<number>();
  for (const assignment of assignments) {
    const normalize = assignment.includes("<");
    const parts = assignment.split(normalize ? "<" : "=");
    if (parts.length !== 2 || !parts[1]?.trim()) throw new Error("pan: invalid channel assignment");
    const output = channelIndex(parts[0]!.trim(), names, names.length);
    if (assigned.has(output)) throw new Error("pan: duplicate output channel");
    assigned.add(output);
    for (const term of parts[1].split("+")) {
      const factors = term.split("*").map(value => value.trim());
      if (factors.length > 2) throw new Error("pan: invalid gain");
      const gain = factors.length === 1 ? 1 : factors[0] ? Number(factors[0]) : NaN;
      if (!Number.isFinite(gain)) throw new Error("pan: invalid gain");
      const input = channelIndex(factors.at(-1)!, inputNames, channels.length);
      gains[output]![input] = gains[output]![input]! + gain;
    }
    if (normalize) {
      const total = gains[output]!.reduce((sum, gain) => sum + gain, 0);
      if (Math.abs(total) > 1e-5) {
        for (let input = 0; input < channels.length; input++) gains[output]![input] = gains[output]![input]! / total;
      }
    }
  }
  const output = gains.map(() => new Float32Array(channels[0]?.length ?? 0));
  for (let sample = 0; sample < (channels[0]?.length ?? 0); sample++) {
    if (sample % 4096 === 0) {
      await yieldTurn(signal);
      signal?.throwIfAborted();
      budget.checkCpu();
    }
    for (let out = 0; out < output.length; out++) {
      let value = 0;
      for (let input = 0; input < channels.length; input++) value += channels[input]![sample]! * gains[out]![input]!;
      output[out]![sample] = value;
    }
  }
  return { channels: output, channelMask: names.length === 1 ? 4 : 3 };
}

// Resolve audio graph inputs and transitions before the PCM filter evaluator runs.
async function resolveAudioGraph(graph: string, docs: MediaDocument[], maps: string[], mappedLabels: Set<string>, budget: MediaBudgetTracker, signal?: AbortSignal) {
  const nodes = new Map<string, { inputs: string[]; expression: string }>();
  const consumed = new Set<string>();
  let start = 0;
  let quoted = false;
  const chains: string[] = [];
  for (let i = 0; i <= graph.length; i++) {
    const char = graph[i];
    if (char === "'") quoted = !quoted;
    else if (!quoted && char === "\\") i++;
    else if (i === graph.length || (!quoted && char === ";")) {
      chains.push(graph.slice(start, i).trim());
      start = i + 1;
    }
  }
  for (const chain of chains) {
    const inputs: string[] = [];
    let inputEnd = -1;
    while (chain[inputEnd + 1] === "[") {
      const end = chain.indexOf("]", inputEnd + 1);
      if (end < 0) throw new Error("Invalid audio filter input label");
      inputs.push(chain.slice(inputEnd + 2, end));
      inputEnd = end;
    }
    const outputs: string[] = [];
    let outputStart = chain.length;
    while (chain[outputStart - 1] === "]") {
      const labelStart = chain.lastIndexOf("[", outputStart - 1);
      if (labelStart <= inputEnd) break;
      outputs.unshift(chain.slice(labelStart + 1, outputStart - 1));
      outputStart = labelStart;
    }
    if (!chain.startsWith("[") || inputEnd < 0 || outputStart <= inputEnd || !chain.endsWith("]")) {
      throw new Error("Unsupported audio filter graph: expected labeled chains");
    }
    const expression = chain.slice(inputEnd + 1, outputStart).trim();
    if (!expression || expression.startsWith("[") || !outputs.length) {
      throw new Error("Unsupported audio filter graph");
    }
    const filters = parseFilterChain(expression);
    const last = filters.at(-1)!;
    const split = last === "channelsplit" || last.startsWith("channelsplit=") ? parseChannelSplit(last) : undefined;
    if (outputs.length !== (split?.length ?? 1)) throw new Error("Audio filter output label count does not match filter outputs");
    for (const [index, output] of outputs.entries()) {
      if (!output || nodes.has(output)) throw new Error("Duplicate or empty audio filter output");
      // Each graph edge evaluates the preceding chain, then selects its own PCM channel.
      const selected = split ? expression + (last.includes("=") ? ":" : "=") + `channels=${split[index]}` : expression;
      nodes.set(output, { inputs, expression: selected });
    }
    for (const input of inputs) consumed.add(input);
  }
  const resolve = async (label: string, visiting = new Set<string>()): Promise<{ track: MediaTrack; expression: string }> => {
    if (visiting.has(label)) throw new Error("Audio filter graph contains a cycle");
    const node = nodes.get(label);
    if (node) {
      visiting.add(label);
      const sources = [];
      for (const input of node.inputs) sources.push(await resolve(input, new Set(visiting)));
      const filters = parseFilterChain(node.expression);
      if (filters[0] === "amultiply" || filters[0]?.startsWith("amultiply=")) {
        if (filters[0] !== "amultiply") throw new Error("amultiply does not accept options");
        if (sources.length !== 2) throw new Error("amultiply requires two inputs");
        if (sources.some(source => source.expression && source.expression !== "anull")) {
          throw new Error("amultiply does not support preceding single-input filters");
        }
        const first = sources[0]!.track;
        const a = first.decodedAudio;
        const b = sources[1]!.track.decodedAudio;
        if (!a || !b) throw new Error("amultiply requires decoded PCM audio");
        if (a.sampleRate !== b.sampleRate || a.channels !== b.channels || a.channelMask !== b.channelMask) {
          throw new Error("amultiply requires matching sample rates and channel layouts");
        }
        const length = Math.min(a.channelData[0]!.length, b.channelData[0]!.length);
        budget.checkSamples(length);
        budget.checkDuration(length / a.sampleRate);
        budget.allocateMemory(length * a.channels * 8);
        const channelData = a.channelData.map(() => new Float64Array(length));
        for (let channel = 0; channel < a.channels; channel++) {
          for (let sample = 0; sample < length; sample++) {
            if (sample % 4096 === 0) {
              await yieldTurn(signal);
              signal?.throwIfAborted();
              budget.checkCpu();
            }
            channelData[channel]![sample] = a.channelData[channel]![sample]! * b.channelData[channel]![sample]!;
          }
        }
        return { track: { ...first, timescale: a.sampleRate, duration: length, samples: [], editList: undefined,
          decodedAudio: { ...a, channelData } }, expression: filters.slice(1).join(",") || "anull" };
      }
      if (filters[0] === "sidechaingate" || filters[0]?.startsWith("sidechaingate=")) {
        if (sources.length !== 2) throw new Error("sidechaingate requires two inputs");
        if (sources.some(source => source.expression && source.expression !== "anull")) {
          throw new Error("sidechaingate does not support preceding single-input filters");
        }
        const first = sources[0]!.track;
        const a = first.decodedAudio;
        const b = sources[1]!.track.decodedAudio;
        if (!a || !b) throw new Error("sidechaingate requires decoded PCM audio");
        if (a.sampleRate !== b.sampleRate) throw new Error("sidechaingate requires matching sample rates");
        const channelData = await gateAudio(a.channelData, a.sampleRate, filters[0]!, budget, b.channelData, signal);
        return { track: { ...first, timescale: a.sampleRate, duration: channelData[0]!.length, samples: [], editList: undefined,
          decodedAudio: { ...a, channelData } }, expression: filters.slice(1).join(",") || "anull" };
      }
      if (filters[0] === "sidechaincompress" || filters[0]?.startsWith("sidechaincompress=")) {
        if (sources.length !== 2) throw new Error("sidechaincompress requires two inputs");
        if (sources.some(source => source.expression && source.expression !== "anull")) {
          throw new Error("sidechaincompress does not support preceding single-input filters");
        }
        const first = sources[0]!.track;
        const a = first.decodedAudio;
        const b = sources[1]!.track.decodedAudio;
        if (!a || !b) throw new Error("sidechaincompress requires decoded PCM audio");
        if (a.sampleRate !== b.sampleRate) throw new Error("sidechaincompress requires matching sample rates");
        const channelData = await compressAudio(a.channelData, a.sampleRate, filters[0]!, budget, signal, b.channelData);
        return { track: { ...first, timescale: a.sampleRate, duration: channelData[0]!.length, samples: [], editList: undefined,
          decodedAudio: { ...a, channelData } }, expression: filters.slice(1).join(",") || "anull" };
      }
      if (filters[0] === "astreamselect" || filters[0]?.startsWith("astreamselect=")) {
        let count = 2;
        let selected = NaN;
        const argument = filters[0].slice("astreamselect=".length);
        for (const [index, option] of (argument ? argument.split(":") : []).entries()) {
          const separator = option.indexOf("=");
          const key = separator < 0 ? ["inputs", "map"][index] : option.slice(0, separator);
          const raw = (separator < 0 ? option : option.slice(separator + 1)).trim();
          const value = raw ? Number(raw) : NaN;
          if (key === "inputs") count = value;
          else if (key === "map") selected = value;
          else throw new Error(`astreamselect: unsupported option ${key}`);
        }
        if (!Number.isInteger(count) || count < 2 || count !== sources.length) {
          throw new Error("astreamselect: inputs must match the number of connected inputs (at least two)");
        }
        if (!Number.isInteger(selected) || selected < 0 || selected >= count) {
          throw new Error("astreamselect: map must select one connected input");
        }
        if (sources.some(source => source.expression && source.expression !== "anull")) {
          throw new Error("astreamselect does not support preceding single-input filters");
        }
        const track = sources[selected]!.track;
        const audio = track.decodedAudio;
        if (!audio || sources.some(source => !source.track.decodedAudio ||
          source.track.decodedAudio.sampleRate !== audio.sampleRate)) {
          throw new Error("astreamselect requires decoded PCM inputs with matching sample rates");
        }
        const length = Math.min(...sources.map(source => source.track.decodedAudio!.channelData[0]!.length));
        budget.checkSamples(length);
        budget.checkDuration(length / audio.sampleRate);
        return { track: { ...track, timescale: audio.sampleRate, duration: length, samples: [], editList: undefined,
          decodedAudio: { ...audio, channelData: audio.channelData.map(channel => channel.subarray(0, length)) } },
          expression: filters.slice(1).join(",") || "anull" };
      }
      if (filters[0] === "axcorrelate" || filters[0]?.startsWith("axcorrelate=")) {
        if (sources.length !== 2) throw new Error("axcorrelate requires two inputs");
        if (sources.some(source => source.expression && source.expression !== "anull")) {
          throw new Error("axcorrelate does not support preceding single-input filters");
        }
        const track = await correlateAudio(sources[0]!.track, sources[1]!.track, filters[0]!, budget, signal);
        return { track, expression: filters.slice(1).join(",") || "anull" };
      }
      if (filters[0] === "amix" || filters[0]?.startsWith("amix=")) {
        if (sources.length !== 2) throw new Error("amix requires two inputs");
        if (sources.some(source => source.expression && source.expression !== "anull")) {
          throw new Error("amix does not support preceding single-input filters");
        }
        const track = await mixAudio(sources[0]!.track, sources[1]!.track, filters[0]!, budget, signal);
        return { track, expression: filters.slice(1).join(",") || "anull" };
      }
      if (filters[0] === "acrossfade" || filters[0]?.startsWith("acrossfade=")) {
        if (sources.length !== 2) throw new Error("acrossfade requires two inputs");
        if (sources.some(source => source.expression && source.expression !== "anull")) {
          throw new Error("acrossfade does not support preceding single-input filters");
        }
        const track = await acrossfadeAudio(sources[0]!.track, sources[1]!.track, filters[0]!, budget, signal);
        return { track, expression: filters.slice(1).join(",") || "anull" };
      }
      if (filters[0] === "amerge" || filters[0]?.startsWith("amerge=")) {
        const argument = filters[0].slice("amerge=".length);
        const count = argument.startsWith("inputs=") ? argument.slice("inputs=".length) : argument;
        if ((argument && Number(count) !== 2) || sources.length !== 2) {
          throw new Error("amerge requires two inputs (inputs=2)");
        }
        if (sources.some(source => source.expression && source.expression !== "anull")) {
          throw new Error("amerge does not support preceding single-input filters");
        }
        const first = sources[0]!.track;
        const a = first.decodedAudio;
        const b = sources[1]!.track.decodedAudio;
        if (!a || !b) throw new Error("amerge requires decoded PCM audio");
        if (a.channels !== 1 || b.channels !== 1 ||
          (a.channelMask !== undefined && a.channelMask !== 0 && a.channelMask !== 4) ||
          (b.channelMask !== undefined && b.channelMask !== 0 && b.channelMask !== 4) ||
          a.sampleRate !== b.sampleRate) {
          throw new Error("amerge requires mono inputs with matching sample rates");
        }
        const length = Math.min(a.channelData[0]!.length, b.channelData[0]!.length);
        budget.checkSamples(length);
        budget.checkDuration(length / a.sampleRate);
        budget.allocateMemory(length * 2 * 8);
        const channelData = [new Float64Array(length), new Float64Array(length)];
        for (let offset = 0; offset < length; offset += 4096) {
          await yieldTurn(signal);
          signal?.throwIfAborted();
          budget.checkCpu();
          channelData[0]!.set(a.channelData[0]!.subarray(offset, Math.min(offset + 4096, length)), offset);
          channelData[1]!.set(b.channelData[0]!.subarray(offset, Math.min(offset + 4096, length)), offset);
        }
        return { track: { ...first, timescale: a.sampleRate, duration: length, samples: [], editList: undefined,
          decodedAudio: { ...a, channels: 2, channelMask: 3, channelData } },
          expression: filters.slice(1).join(",") || "anull" };
      }
      if (filters[0] === "join" || filters[0]?.startsWith("join=")) {
        if (sources.some(source => source.expression && source.expression !== "anull")) {
          throw new Error("join does not support preceding single-input filters");
        }
        const track = await joinAudio(sources.map(source => source.track), filters[0]!, budget, signal);
        return { track, expression: filters.slice(1).join(",") || "anull" };
      }
      if (sources.length !== 1) throw new Error("Audio filter requires one input");
      const source = sources[0]!;
      return { track: source.track, expression: [source.expression, node.expression].filter(Boolean).join(",") };
    }
    const [input, type, ordinal = "0", ...extra] = label.split(":");
    const index = Number(input);
    const stream = Number(ordinal);
    const track = type === "a" && input !== "" && Number.isInteger(index) && index >= 0 &&
      Number.isInteger(stream) && stream >= 0 && extra.length === 0
      ? docs[index]?.tracks.filter(track => track.type === "audio")[stream] : undefined;
    if (!track) throw new Error(`Invalid audio filter input: ${label}`);
    return { track, expression: "" };
  };
  const outputs = maps.length ? maps.map(map => {
    if (!map.startsWith("[") || !map.endsWith("]")) throw new Error("Unsupported audio filter output map");
    return map.slice(1, -1);
  }) : [...nodes.keys()].filter(label => !consumed.has(label));
  if (!outputs.length) throw new Error("Audio filter graph has no output");
  return Promise.all(outputs.map(label => {
    if (!nodes.has(label)) throw new Error(`Unknown audio filter output: ${label}`);
    if (consumed.has(label) || mappedLabels.has(label)) {
      throw new Error(`Audio filter output already consumed: ${label}`);
    }
    mappedLabels.add(label);
    return resolve(label);
  }));
}

async function applyVideoFilterChain(
  frames: MediaVideoFrame[],
  filterChainStr: string,
  budget: MediaBudgetTracker,
  subtitleCues?: readonly { startSec: number; endSec: number; text: string }[],
  signal?: AbortSignal
): Promise<MediaVideoFrame[]> {
  let work = 0;

  let current = frames;
  if (current.length === 0) return current;

  for (const filterSpec of parseFilterChain(filterChainStr)) {
    if (++work % 1024 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); }

    budget.checkCpu();
    const eqIdx = filterSpec.indexOf("=");
    const name = (eqIdx >= 0 ? filterSpec.slice(0, eqIdx) : filterSpec).trim().toLowerCase();
    const argStr = eqIdx >= 0 ? filterSpec.slice(eqIdx + 1).trim() : "";
    const positional = argStr.split(":");
    const named: Record<string, string> = {};
    for (const part of positional) {
      if (++work % 1024 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); }

      const kIdx = part.indexOf("=");
      if (kIdx >= 0) {
        named[part.slice(0, kIdx).trim().toLowerCase()] = part.slice(kIdx + 1).trim();
      }
    }

    if (name === "scale") {
      const iw = current[0]!.width;
      const ih = current[0]!.height;
      const wSpec = named.w ?? named.width ?? positional[0] ?? String(iw);
      const hSpec = named.h ?? named.height ?? positional[1] ?? String(ih);
      let targetW = evalScaleDim(wSpec, iw, ih);
      let targetH = evalScaleDim(hSpec, iw, ih);
      if (targetW < 0 && targetH > 0) {
        const multiple = wSpec.trim() === "-2" ? 2 : 1;
        targetW = Math.max(1, Math.round((iw * targetH) / (Math.max(1, ih) * multiple))) * multiple;
      } else if (targetH < 0 && targetW > 0) {
        const multiple = hSpec.trim() === "-2" ? 2 : 1;
        targetH = Math.max(1, Math.round((ih * targetW) / (Math.max(1, iw) * multiple))) * multiple;
      }
      targetW = Math.max(1, targetW);
      targetH = Math.max(1, targetH);

      current = await mapWork(current, async (f) => {


        budget.recordFrame(targetW, targetH);
        if (!named.flags) {
          return {
            ...f,
            width: targetW,
            height: targetH,
            data: scaleVideoPicture(f, targetW, targetH) ?? await scaleFrame(f.data, f.width, f.height, targetW, targetH, signal)
          };
        }
        const resized = resizeImage(makeRgbaImg(f.width, f.height, f.data), {
          width: targetW,
          height: targetH,
          fit: "fill",
          position: "center",
          kernel: "lanczos3",
          background: { r: 0, g: 0, b: 0, a: 255 },
          withoutEnlargement: false,
          withoutReduction: false
        });
        return {
          ...f,
          width: resized.width,
          height: resized.height,
          data: resized.data
        };
      }, signal);
    } else if (name === "crop") {
      const iw = current[0]!.width;
      const ih = current[0]!.height;
      const dimensions = { iw, ih, in_w: iw, in_h: ih };
      // Preserve the decoded chroma grid even after earlier RGBA filter operations.
      // AVPixelFormat: YUV420P/YUVJ420P and YUV422P/YUVJ422P.
      const format = current[0]!.native?.format;
      const exact = ["1", "true", "yes", "on"].includes(named.exact ?? positional[5] ?? "0");
      const hsub = !exact && (format === 0 || format === 12 || format === 4 || format === 13) ? 2 : 1;
      const vsub = !exact && (format === 0 || format === 12) ? 2 : 1;
      const cw = Math.floor(roundToEven(parseFilterExpression(named.w ?? positional[0] ?? String(iw), "crop", dimensions)) / hsub) * hsub;
      const ch = Math.floor(roundToEven(parseFilterExpression(named.h ?? positional[1] ?? String(ih), "crop", dimensions)) / vsub) * vsub;
      if (!Number.isFinite(cw) || !Number.isFinite(ch) || cw <= 0 || ch <= 0 || cw > iw || ch > ih) {
        throw new Error(`Invalid too big or non positive size for width '${cw}' or height '${ch}'`);
      }
      current = await mapWork(current, async (f, n) => {
        const variables = { iw, ih, ow: cw, oh: ch, in_w: iw, in_h: ih, out_w: cw, out_h: ch, n };
        const cx = Math.max(
          0,
          Math.min(iw - cw, roundToEven(parseFilterExpression(named.x ?? positional[2] ?? String(Math.floor((iw - cw) / 2)), "crop", variables)))
        );
        const cy = Math.max(
          0,
          Math.min(ih - ch, roundToEven(parseFilterExpression(named.y ?? positional[3] ?? String(Math.floor((ih - ch) / 2)), "crop", variables)))
        );
        const cropped = extractImage(makeRgbaImg(f.width, f.height, f.data), {
          left: Math.floor(cx / hsub) * hsub,
          top: Math.floor(cy / vsub) * vsub,
          width: cw,
          height: ch
        });
        return {
          ...f,
          width: cropped.width,
          height: cropped.height,
          data: cropped.data
        };
      }, signal);
    } else if (name === "pad") {
      const iw = current[0]!.width;
      const ih = current[0]!.height;
      const width = named.w ?? named.width ?? positional[0] ?? String(iw);
      const height = named.h ?? named.height ?? positional[1] ?? String(ih);
      const inputDimensions = { iw, ih, in_w: iw, in_h: ih };
      const pw = Math.trunc(parseFilterExpression(width, "pad", inputDimensions)) || iw;
      const ph = Math.trunc(parseFilterExpression(height, "pad", inputDimensions)) || ih;
      if (pw < iw || ph < ih) {
        throw new Error("Padded dimensions cannot be smaller than input dimensions");
      }
      const variables = { iw, ih, ow: pw, oh: ph, in_w: iw, in_h: ih, out_w: pw, out_h: ph };
      const x = Math.trunc(parseFilterExpression(named.x ?? positional[2] ?? "0", "pad", variables));
      const y = Math.trunc(parseFilterExpression(named.y ?? positional[3] ?? "0", "pad", variables));
      // Align placement to the source chroma grid, as with crop.
      const format = current[0]!.native?.format;
      const hsub = format === 0 || format === 12 || format === 4 || format === 13 ? 2 : 1;
      const vsub = format === 0 || format === 12 ? 2 : 1;
      const px = Math.floor((x < 0 ? Math.trunc((pw - iw) / 2) : Math.min(pw - iw, x)) / hsub) * hsub;
      const py = Math.floor((y < 0 ? Math.trunc((ph - ih) / 2) : Math.min(ph - ih, y)) / vsub) * vsub;
      const col = parseColorRgba(named.color ?? positional[4] ?? "black");
      current = await mapWork(current, async (f) => {


        const padded = extendImage(makeRgbaImg(f.width, f.height, f.data), {
          left: px,
          top: py,
          right: Math.max(0, pw - iw - px),
          bottom: Math.max(0, ph - ih - py),
          background: { r: col[0], g: col[1], b: col[2], a: col[3] },
          extendWith: "background"
        });
        return {
          ...f,
          width: padded.width,
          height: padded.height,
          data: padded.data
        };
      }, signal);
    } else if (name === "hflip") {
      current = await mapWork(current, async (f) => {


        const out = flopImage(makeRgbaImg(f.width, f.height, f.data));
        return { ...f, data: out.data };
      }, signal);
    } else if (name === "vflip") {
      current = await mapWork(current, async (f) => {


        const out = flipImage(makeRgbaImg(f.width, f.height, f.data));
        return { ...f, data: out.data };
      }, signal);
    } else if (name === "transpose") {
      const dir = named.dir ?? positional[0] ?? "1";
      const angle = dir === "0" || dir === "2" ? 270 : 90;
      current = await mapWork(current, async (f) => {
        const rotated = rotateImage(makeRgbaImg(f.width, f.height, f.data), angle);
        const out = dir === "0" || dir === "3" ? flipImage(rotated) : rotated;
        return {
          ...f,
          width: out.width,
          height: out.height,
          data: out.data
        };
      }, signal);
    } else if (name === "rotate") {
      const angle = parseFilterExpression(named.angle ?? named.a ?? (positional[0] || "0"), "rotate", { PI: Math.PI });
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      current = await mapWork(current, async (f) => {
        budget.recordFrame(f.width, f.height);
        const yuv = await rotateYuvFrame(f, angle, budget, signal);
        if (yuv) return yuv;
        const data = new Uint8Array(f.data.length);
        const cx = (f.width - 1) / 2;
        const cy = (f.height - 1) / 2;
        for (let y = 0; y < f.height; y++) {
          await yieldTurn(signal);
          budget.checkCpu();
          for (let x = 0; x < f.width; x++) {
            const sx = cos * (x - cx) + sin * (y - cy) + cx;
            const sy = -sin * (x - cx) + cos * (y - cy) + cy;
            const dest = (y * f.width + x) * 4;
            data[dest + 3] = 255;
            const ix = Math.floor(sx);
            const iy = Math.floor(sy);
            if (ix < -1 || ix > f.width || iy < -1 || iy > f.height) continue;
            // FFmpeg clips the integer index but retains the original fractional
            // weight, including in the one-pixel interpolation border.
            const x0 = Math.max(0, Math.min(f.width - 1, ix));
            const y0 = Math.max(0, Math.min(f.height - 1, iy));
            const x1 = Math.min(x0 + 1, f.width - 1);
            const y1 = Math.min(y0 + 1, f.height - 1);
            const dx = sx - ix;
            const dy = sy - iy;
            for (let c = 0; c < 4; c++) {
              const top = f.data[(y0 * f.width + x0) * 4 + c]! * (1 - dx) + f.data[(y0 * f.width + x1) * 4 + c]! * dx;
              const bottom = f.data[(y1 * f.width + x0) * 4 + c]! * (1 - dx) + f.data[(y1 * f.width + x1) * 4 + c]! * dx;
              data[dest + c] = Math.floor(top * (1 - dy) + bottom * dy + 1e-8);
            }
          }
        }
        return { ...f, data };
      }, signal);
    } else if (name === "negate") {
      current = await mapWork(current, async (f) => {
        const source = f.native;
        // Negate planar 8-bit YUV before RGB conversion, including full-range YUV.
        if (source && source.rgba === f.data && source.width === f.width && source.height === f.height &&
            [0, 4, 5, 12, 13, 14].includes(source.format)) {
          const pixels = new Uint8Array(source.pixels.length);
          for (let i = 0; i < pixels.length; i++) {
            if (i % 65536 === 0) {
              await yieldTurn(signal);
              signal?.throwIfAborted();
              budget.checkCpu();
            }
            pixels[i] = 255 - source.pixels[i]!;
          }
          const native = { ...source, pixels };
          const data = scaleVideoPicture({ ...f, native }, f.width, f.height)!;
          return { ...f, data, native: { ...native, rgba: data } };
        }
        const out = negateImage(makeRgbaImg(f.width, f.height, f.data));
        return { ...f, data: out.data };
      }, signal);
    } else if (name === "format" && argStr.includes("gray")) {
      current = await mapWork(current, async (f) => {


        const out = grayscaleImage(makeRgbaImg(f.width, f.height, f.data));
        return { ...f, data: out.data };
      }, signal);
    } else if (name === "format") {
      if (argStr.includes("rgb") || argStr.includes("bgr")) {
        current = current.map(({ native: _native, ...frame }) => frame);
      }
    } else if (name === "fps") {
      const targetFps = parseFloat(named.fps ?? positional[0] ?? "25") || 25;
      const totalDuration = current.reduce((acc, f) => acc + f.durationSeconds, 0) || 1;
      const targetCount = Math.max(1, Math.round(totalDuration * targetFps));
      const resampled: MediaVideoFrame[] = [];
      let srcIdx = 0;
      for (let i = 0; i < targetCount; i++) {
        if (++work % 1024 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); }

        // Round presentation timestamps to the output time base, as FFmpeg does.
        while (srcIdx + 1 < current.length && Math.round(current[srcIdx + 1]!.ptsSeconds * targetFps) <= i) {
          srcIdx++;
        }
        const src = current[srcIdx]!;
        resampled.push({
          ...src,
          ptsSeconds: i / targetFps,
          durationSeconds: 1 / targetFps
        });
      }
      current = resampled;
    } else if (name === "trim") {
      for (const option of Object.keys(named)) {
        if (!["start", "end", "duration", "start_frame", "end_frame"].includes(option)) {
          throw new Error(`trim: unsupported option ${option}`);
        }
      }
      for (const option of ["start_frame", "end_frame"]) {
        const value = named[option];
        if (value !== undefined && (!value || !Number.isSafeInteger(Number(value)) || Number(value) < 0)) {
          throw new Error(`trim: ${option} must be a nonnegative integer`);
        }
      }
      if (positional.some((part, index) => part && !part.includes("=") && index > 0)) {
        throw new Error("trim: unsupported positional option");
      }
      const start = named.start ?? (positional[0]?.includes("=") ? undefined : positional[0]);
      const st = parseFfmpegTimestamp(start ?? "0");
      const startFrame = named.start_frame === undefined ? undefined : Number(named.start_frame);
      const endFrame = named.end_frame === undefined ? undefined : Number(named.end_frame);
      const end = named.end ? parseFfmpegTimestamp(named.end) : Infinity;
      const dur = named.duration ? parseFfmpegTimestamp(named.duration) : undefined;
      const finalEnd = dur !== undefined ? st + dur : end;
      current = current
        .filter((f, index) => {
          const afterStart = startFrame === undefined
            ? f.ptsSeconds + f.durationSeconds > st
            : index >= startFrame || (start !== undefined && f.ptsSeconds + f.durationSeconds > st);
          const beforeEnd = endFrame === undefined
            ? f.ptsSeconds < finalEnd
            : index < endFrame || (Number.isFinite(finalEnd) && f.ptsSeconds < finalEnd);
          return afterStart && beforeEnd;
        })
        .map((f) => ({ ...f, ptsSeconds: Math.max(0, f.ptsSeconds - st) }));
    } else if (name === "drawtext") {
      const rawText = (named.text ?? positional[0] ?? "").replace(/^['"]|['"]$/g, "");
      const fontSize = parseInt(named.fontsize ?? "12", 10) || 12;
      const fontColor = parseColorRgba(named.fontcolor ?? "white");
      const drawBox = named.box === "1" || named.box === "true";
      const boxColor = parseColorRgba(named.boxcolor ?? "black");
      current = await mapWork(current, async (f, fIdx) => {


        const expanded = rawText
          .replace(/%\{frame_num\}/g, String(fIdx))
          .replace(/%\{n\}/g, String(fIdx))
          .replace(/%\{pts\}/g, f.ptsSeconds.toFixed(2));
        return {
          ...f,
          data: await renderBitmapTextToRgba(f.data, f.width, f.height, expanded, {
            xExpr: named.x ?? "4",
            yExpr: named.y ?? "4",
            fontSize,
            fontColor,
            drawBox,
            boxColor
          }, signal)
        };
      }, signal);
    } else if (name === "subtitles") {
      const cues = subtitleCues ?? [];
      current = await mapWork(current, async (f) => {


        const active = cues.filter((c) => f.ptsSeconds >= c.startSec && f.ptsSeconds < c.endSec);
        if (active.length === 0) return f;
        const cueStr = active.map((c) => c.text).join("\n");
        return {
          ...f,
          data: await renderBitmapTextToRgba(f.data, f.width, f.height, cueStr, {
            xExpr: "(w-text_w)/2",
            // FFmpeg's default SRT style uses a 16-point font and 10-point
            // vertical margin on a 288-pixel reference canvas.
            yExpr: `h-text_h-${Math.max(4, Math.round(10 * f.height / 288))}`,
            fontSize: 16 * f.height / 288,
            fontColor: [255, 255, 255, 255],
            drawBox: true,
            boxColor: [0, 0, 0, 180]
          }, signal)
        };
      }, signal);
    } else if (name === "tile") {
      const layoutStr = (named.layout ?? positional[0] ?? "2x2").toLowerCase();
      const [colsStr, rowsStr] = layoutStr.split("x");
      const cols = Math.max(1, parseInt(colsStr ?? "2", 10) || 2);
      const rows = Math.max(1, parseInt(rowsStr ?? "2", 10) || 2);
      const padding = parseInt(named.padding ?? "0", 10) || 0;
      const margin = parseInt(named.margin ?? "0", 10) || 0;
      const color = parseColorRgba(named.color ?? "black");
      const nbFrames = Number(named.nb_frames ?? 0);
      const perTile = Number.isInteger(nbFrames) && nbFrames > 0 && nbFrames <= cols * rows
        ? nbFrames
        : cols * rows;
      const tiledFrames: MediaVideoFrame[] = [];
      for (let base = 0; base < current.length; base += perTile) {
        if (++work % 1024 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); }

        const batch = current.slice(base, base + perTile);
        const fw = batch[0]?.width ?? 64;
        const fh = batch[0]?.height ?? 64;
        const outW = margin * 2 + cols * fw + Math.max(0, cols - 1) * padding;
        const outH = margin * 2 + rows * fh + Math.max(0, rows - 1) * padding;
        const canvas = new Uint8Array(outW * outH * 4);
        for (let i = 0; i < canvas.byteLength; i += 4) canvas.set(color, i);
        for (let k = 0; k < batch.length; k++) {
          if (++work % 1024 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); }

          const tileFrame = batch[k]!;
          const c = k % cols;
          const r = Math.floor(k / cols);
          const ox = margin + c * (fw + padding);
          const oy = margin + r * (fh + padding);
          for (let y = 0; y < Math.min(fh, tileFrame.height); y++) {
            if (++work % 1024 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); }

            const srcRow = tileFrame.data.subarray(y * tileFrame.width * 4, (y + 1) * tileFrame.width * 4);
            canvas.set(srcRow.subarray(0, fw * 4), ((oy + y) * outW + ox) * 4);
          }
        }
        tiledFrames.push({
          width: outW,
          height: outH,
          data: canvas,
          ptsSeconds: batch[0]?.ptsSeconds ?? 0,
          durationSeconds: batch.reduce((s, x) => s + x.durationSeconds, 0),
          keyframe: true
        });
      }
      current = tiledFrames;
    } else if (name === "select") {
      const expr = named.e ?? named.expr ?? positional[0] ?? "1";
      if (current.length === 0) parseFilterExpression(expr, "select", { n: 0, t: 0 });
      current = current.filter((f, n) =>
        parseFilterExpression(expr, "select", { n, t: f.ptsSeconds }) !== 0
      );
    } else if (name === "reverse") {
      const totalDur = current.reduce((acc, f) => acc + f.durationSeconds, 0);
      let cursor = 0;
      current = await mapWork([...current].reverse(), async (f) => {


        const out = { ...f, ptsSeconds: cursor };
        cursor += f.durationSeconds;
        return out;
      }, signal);
      void totalDur;
    } else if (name === "setpts") {
      const expr = (named.expr ?? positional[0] ?? "PTS").toUpperCase();
      const startPts = current[0]?.ptsSeconds ?? 0;
      current = await mapWork(current, async (f) => ({
        ...f,
        ptsSeconds: parseFilterExpression(expr, "setpts", { PTS: f.ptsSeconds, STARTPTS: startPts })
      }), signal);
    } else if (name === "drawbox") {
      const col = parseColorRgba(named.color ?? named.c ?? positional[4] ?? "red");
      // FFmpeg uses limited-range BT.601 integer coefficients for drawbox colors.
      const [r, g, b] = col;
      const yuvColor = [
        (263 * r + 516 * g + 100 * b + 512 + (16 << 10)) >> 10,
        ((-152 * r - 298 * g + 450 * b + 511) >> 10) + 128,
        ((450 * r - 377 * g - 73 * b + 511) >> 10) + 128
      ];
      const yuvAlpha = col[3] / 255;
      // Native packed-RGB drawbox blends with single-precision arithmetic.
      const alpha = Math.fround(col[3] / 255);
      const inverseAlpha = Math.fround(1 - alpha);
      const thicknessOption = named.t ?? named.thickness ?? positional[5] ?? "3";
      const thickness = thicknessOption === "fill" ? Infinity : parseInt(thicknessOption, 10);
      const replace = named.replace === "1";
      current = await mapWork(current, async (f) => {
        let work = 0;

        const variables = { iw: f.width, ih: f.height, in_w: f.width, in_h: f.height };
        const width = Math.trunc(parseFilterExpression(named.w ?? named.width ?? positional[2] ?? "0", "drawbox", variables));
        const height = Math.trunc(parseFilterExpression(named.h ?? named.height ?? positional[3] ?? "0", "drawbox", variables));
        const bw = width <= 0 ? f.width : width;
        const bh = height <= 0 ? f.height : height;
        const positionVariables = { ...variables, w: bw, h: bh };
        const bx = Math.trunc(parseFilterExpression(named.x ?? positional[0] ?? "0", "drawbox", positionVariables));
        const by = Math.trunc(parseFilterExpression(named.y ?? positional[1] ?? "0", "drawbox", positionVariables));
        const source = f.native;
        const planar = source && source.rgba === f.data && source.width === f.width && source.height === f.height &&
          [0, 4, 5, 12, 13, 14].includes(source.format) ? source : undefined;
        const hsub = planar && [0, 4, 12, 13].includes(planar.format) ? 1 : 0;
        const vsub = planar && [0, 12].includes(planar.format) ? 1 : 0;
        const chromaWidth = Math.ceil(f.width / (1 << hsub));
        const chromaSize = chromaWidth * Math.ceil(f.height / (1 << vsub));
        const lumaSize = f.width * f.height;
        const nextData = new Uint8Array(planar ? planar.pixels : f.data);
        for (let y = Math.max(0, by); y < Math.min(f.height, by + bh); y++) {
          if (++work % 1024 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); }

          for (let x = Math.max(0, bx); x < Math.min(f.width, bx + bw); x++) {
            if (++work % 1024 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); }

            if (Math.min(x - bx, y - by, bx + bw - 1 - x, by + bh - 1 - y) >= thickness) continue;
            if (planar) {
              // Native drawbox updates shared chroma once per covered luma pixel,
              // including repeated alpha blends and pixels just outside box edges.
              const chromaIndex = (y >> vsub) * chromaWidth + (x >> hsub);
              const indices = [y * f.width + x, lumaSize + chromaIndex, lumaSize + chromaSize + chromaIndex];
              for (let plane = 0; plane < 3; plane++) {
                const index = indices[plane]!;
                nextData[index] = (1 - yuvAlpha) * nextData[index]! + yuvAlpha * yuvColor[plane]!;
              }
              continue;
            }
            const idx = (y * f.width + x) * 4;
            if (replace) {
              nextData.set(col, idx);
              continue;
            }
            for (let channel = 0; channel < 3; channel++) {
              nextData[idx + channel] = Math.fround(
                Math.fround(nextData[idx + channel]! * inverseAlpha) + Math.fround(col[channel]! * alpha)
              );
            }
          }
        }
        if (planar) {
          const native = { ...planar, pixels: nextData };
          const data = scaleVideoPicture({ ...f, native }, f.width, f.height)!;
          return { ...f, data, native: { ...native, rgba: data } };
        }
        return { ...f, data: nextData };
      }, signal);
    } else if (name !== "format" && name !== "null") {
      throw new Error(`Unsupported video filter: ${name}`);
    }
  }

  return current;
}

function applyStreamLanguages(tracks: readonly MediaTrack[], languages: readonly [string, string][], metadataSource: number | undefined): readonly MediaTrack[] {
  if (metadataSource !== undefined && metadataSource < 0) {
    tracks = tracks.map(track => ({ ...track, language: "und" }));
  }
  for (const [specifier, language] of languages) {
    const [selector, ordinal] = specifier.split(":");
    const type = selector === "a" ? "audio" : selector === "v" ? "video" : selector === "s" ? "subtitle" : undefined;
    const index = type ? ordinal : selector;
    let matched = 0;
    tracks = tracks.map(track => {
      if (type && track.type !== type) return track;
      const current = matched++;
      if (index && current !== Number(index)) return track;
      return { ...track, language };
    });
  }
  return tracks;
}

function applyStreamDispositions(tracks: readonly MediaTrack[], dispositions: readonly [string, string][]): readonly MediaTrack[] {
  for (const [specifier, value] of dispositions) {
    const [selector, ordinal] = specifier.split(":");
    const type = selector === "a" ? "audio" : selector === "v" ? "video" : selector === "s" ? "subtitle" : undefined;
    const index = type ? ordinal : selector;
    let enabled: boolean;
    if (value === "0" || value === "-default" || value === "attached_pic") enabled = false;
    else if (value === "1" || value === "default" || value === "+default") enabled = true;
    else throw new Error(`Unsupported disposition: ${value}`);
    let matched = 0;
    tracks = tracks.map(track => {
      if (type && track.type !== type) return track;
      const current = matched++;
      if (index && current !== Number(index)) return track;
      return { ...track, enabled,
        ...(value === "attached_pic" ? { disposition: { attached_pic: 1 } }
          : value === "0" ? { disposition: {} } : {}) };
    });
  }
  return tracks;
}

function selectAutomaticAudio(documents: readonly MediaDocument[]): MediaDocument[] {
  let selected: MediaTrack | undefined;
  let bestScore = -1;
  for (const document of documents) {
    for (const track of document.tracks) {
      if (track.type !== "audio") continue;
      // FFmpeg prefers default audio, then channel count, then input order.
      const score = ((track.disposition?.default ?? track.enabled) ? 1 << 22 : 0)
        + (track.decodedAudio?.channels ?? track.codecDescriptions[0]?.channels ?? 0);
      if (score > bestScore) {
        selected = track;
        bestScore = score;
      }
    }
  }
  return documents.map(document => ({
    ...document,
    attachments: [],
    tracks: document.tracks.filter(track => track.type !== "audio" || track === selected)
  }));
}

function limitAudioCopyPackets(document: MediaDocument, limit: number): MediaDocument {
  return {
    ...document,
    tracks: document.tracks.map(track => {
      if (track.type !== "audio" || track.samples.length <= limit) return track;
      const samples = track.samples.slice(0, limit);
      return { ...track, samples, duration: samples.reduce((total, sample) => total + sample.duration, 0) };
    })
  };
}

function validateStreamCopy(
  doc: MediaDocument,
  outputFormat: string,
  codecs: Partial<Record<MediaTrack["type"], string | undefined>>
): void {
  const requiredSubtitleCodec = outputFormat === "srt" ? "subrip" : outputFormat === "webvtt" ? "webvtt" : outputFormat === "ass" ? "ass" : undefined;
  for (const track of doc.tracks) {
    if (codecs[track.type] !== "copy") continue;
    const allowed = outputFormat === "webm"
      ? track.type === "video" ? ["vp8", "vp9", "av1"]
        : track.type === "audio" ? ["vorbis", "opus"]
          : track.type === "subtitle" ? ["webvtt"] : []
      : outputFormat === "flv" && track.type === "video" ? ["h264", "flv1"]
      : track.type === "subtitle" && requiredSubtitleCodec ? [requiredSubtitleCodec] : undefined;
    if (allowed === undefined) continue;
    for (const description of track.codecDescriptions) {
      if (!allowed.includes(description.codecName)) {
        throw new Error(`Cannot copy ${track.type} codec '${description.codecName}' to ${outputFormat}; use ${track.type} transcoding.`);
      }
    }
  }
}

function validateSubtitleEncoder(codec: string | undefined, doc: MediaDocument, outputFormat: string): void {
  if (codec === undefined || codec === "copy" || !doc.tracks.some(track => track.type === "subtitle")) return;
  const name = codec === "srt" ? "subrip" : codec;
  if (!["subrip", "webvtt", "mov_text", "ass"].includes(name)) {
    throw new Error(`Unknown encoder '${codec}'`);
  }
  // These serializers encode subtitles in a fixed format. Never silently
  // substitute that format for an explicitly requested encoder.
  const encodedCodec = outputFormat === "srt" || outputFormat === "mkv" ? "subrip"
    : outputFormat === "webvtt" || outputFormat === "webm" ? "webvtt"
    : outputFormat === "mp4" || outputFormat === "mov" ? "mov_text"
    : outputFormat === "ass" ? "ass" : undefined;
  if (name !== encodedCodec) {
    throw new Error(`Subtitle encoder '${codec}' is not supported for ${outputFormat}`);
  }
}

function fixSubtitleDurations(doc: MediaDocument): MediaDocument {
  const tracks = doc.tracks.map(track => {
    if (track.type !== "subtitle") return track;
    // Decoding buffers one event until the next arrives; EOF does not flush it.
    const samples = track.samples.slice(0, -1).flatMap((sample, index) => {
      const duration = Math.min(sample.duration, track.samples[index + 1]!.pts - sample.pts);
      return duration > 0 ? [{ ...sample, duration }] : [];
    });
    const duration = samples.reduce((end, sample) => Math.max(end, sample.pts + sample.duration), 0);
    return { ...track, samples, duration };
  });
  const durationSeconds = Math.max(0, ...tracks.map(track => track.duration / track.timescale));
  return { ...doc, tracks, durationSeconds, duration: Math.round(durationSeconds * doc.timescale) };
}

function transcodeSubtitles(doc: MediaDocument, outputFormat: string | undefined): MediaDocument {
  return {
    ...doc,
    tracks: doc.tracks.map(track => {
      if (track.type !== "subtitle") return track;
      const decodeErrors = [...(track.decodeErrors ?? [])];
      const samples = track.samples.filter(sample => {
        const codec = track.codecDescriptions[sample.sampleDescriptionIndex - 1]?.codecName;
        if (codec !== "subrip" && codec !== "webvtt") return true;
        try { new TextDecoder("utf-8", { fatal: true }).decode(sample.data); return true; }
        catch {
          decodeErrors.push("Invalid UTF-8 in decoded subtitles text");
          return false;
        }
      }).map(sample => {
        const codec = track.codecDescriptions[sample.sampleDescriptionIndex - 1]?.codecName;
        if (codec !== "webvtt" && (codec !== "subrip" || outputFormat !== "webvtt")) return { ...sample, webvtt: undefined };
        const text = decodeUtf8(sample.data);
        const parts: string[] = [];
        let position = 0;
        while (position < text.length) {
          // SubRip's ASS overrides are control text, not visible WebVTT text.
          if (codec === "subrip" && text.startsWith("{\\", position)) {
            const end = text.indexOf("}", position + 2);
            position = end < 0 ? text.length : end + 1;
          } else if (codec === "subrip" && text[position] === "\\"
            && (text[position + 1] === "N" || text[position + 1] === "n")) {
            parts.push("\n");
            position += 2;
          } else if (text[position] === "<") {
            const end = text.indexOf(">", position + 1);
            if (end < 0) break;
            const tag = text.slice(position + 1, end);
            if (["b", "/b", "i", "/i", "u", "/u"].includes(tag)) parts.push(`<${tag}>`);
            position = end + 1;
          } else {
            parts.push(text[position]!);
            position++;
          }
        }
        parts.push(text.slice(position));
        const data = encodeUtf8(parts.join(""));
        return { ...sample, data, size: data.byteLength, webvtt: undefined };
      });
      return { ...track, samples, decodeErrors };
    })
  };
}

function validateAudioEncoder(codec: string | undefined, doc: MediaDocument, plugins: readonly MediaAstPlugin[]): void {
  if (codec === undefined || codec === "copy" || !doc.tracks.some(track => track.type === "audio")) return;
  const name = codec === "libopus" ? "opus" : codec === "libvorbis" ? "vorbis" : codec === "libmp3lame" ? "mp3" : codec;
  if (!plugins.some(plugin => plugin.canMux && plugin.supportedAudioCodecs.includes(name))) {
    throw new Error(`Unknown encoder '${codec}'`);
  }
}

export function evalSyncFfmpeg(
  inBytesOrArgs: Uint8Array | readonly string[] | undefined,
  maybeArgs?: readonly string[],
  readFileSync?: (filePath: string) => Uint8Array | undefined,
  writeFileSync?: (filePath: string, bytes: Uint8Array) => boolean,
): string | undefined {
  const inBytes = Array.isArray(inBytesOrArgs) ? undefined : (inBytesOrArgs as Uint8Array | undefined);
  const args = (Array.isArray(inBytesOrArgs) ? inBytesOrArgs : (maybeArgs ?? [])) as readonly string[];
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
      return formatIntrospectionOutput(arg, astPlugins);
    }
  }
  try {
    const budget = new MediaBudgetTracker();
    const inputs: InputSpec[] = [];
    let pendingFormat: string | undefined;
    let pendingAudioDecoder: string | undefined;
    let pendingFixSubDuration = false;
    let pendingSs: number | undefined;
    let pendingSseof: number | undefined;
    let pendingTo: number | undefined;
    let pendingDuration: number | undefined;
    let pendingLoop: number | undefined;
    let pendingFps: number | undefined;
    let pendingStartNumber: number | undefined;
    let outputStartNumber: number | undefined;
    let outputFormat: string | undefined;
    let outputSs: number | undefined;
    let outputTo: number | undefined;
    let outputDuration: number | undefined;
    let videoCodec: string | undefined;
    let audioCodec: string | undefined;
    let audioBitrate: number | undefined;
    let subtitleCodec: string | undefined;
    let audioRate: number | undefined;
    let audioChannels: number | undefined;
    let stripAudio = false;
    let stripVideo = false;
    let stripSubtitles = false;
    let shortest = false;
    let writeXing = true;
    let writeBext = false;
    let sampleFormat: string | undefined;
    let compressionLevel: number | undefined;
    let writePeak: "off" | "on" | "only" | undefined;
    let rf64: "always" | "auto" | "never" | undefined;
    let faststart = true;
    let fragmented = false;
    let id3v2Version: 0 | 3 | 4 | undefined;
    let writeId3v1: boolean | undefined;
    let metadataHeaderPadding: number | undefined;
    let pageDuration: number | undefined;
    let serialOffset: number | undefined;
    let bitexact = false;
    let maxVideoFrames: number | undefined;
    let maxAudioFrames: number | undefined;
    let outputFps: number | undefined;
    let outputSize: string | undefined;
    let rotation: number | undefined;
    let noOverwrite: boolean | undefined;
    const vfFilters: string[] = [];
    let chapterSource: number | undefined;
    let metadataSource: number | undefined;
    const metadata: Record<string, string> = {};
    const streamLanguages: [string, string][] = [];
    const streamDispositions: [string, string][] = [];
    let outputTarget: string | undefined;

    for (let i = 0; i < args.length; i++) {
      const arg = args[i]!;
      if (arg === "-y" || arg === "-n") {
        if (noOverwrite !== undefined && noOverwrite !== (arg === "-n")) return undefined;
        noOverwrite = arg === "-n";
      }
      else if (arg === "-v" || arg === "-loglevel" || arg === "-safe" || arg === "-threads" || arg === "-pix_fmt" || arg === "-preset" || arg === "-crf" || arg === "-bf" || arg === "-b:v" || arg === "-bsf:v" || arg === "-bsf:a" || arg === "-tag:v" || arg === "-tag:a" || arg === "-vsync" || arg === "-fps_mode") i++;
      else if (arg === "-b:a") {
        audioBitrate = parseAudioBitrate(args[++i]);
        if (audioBitrate === undefined) return undefined;
      }
      else if (arg === "-map_chapters") {
        const value = args[++i];
        chapterSource = value?.trim() ? Number(value) : NaN;
        if (!Number.isSafeInteger(chapterSource)) return undefined;
      } else if (arg === "-map_metadata") {
        const value = args[++i];
        metadataSource = value?.trim() ? Number(value) : NaN;
        if (!Number.isSafeInteger(metadataSource)) return undefined;
      } else if (arg === "-start_number") {
        const val = Number(args[++i]);
        if (!Number.isSafeInteger(val) || val < 0) return undefined;
        if (args.slice(i + 1).includes("-i")) pendingStartNumber = val;
        else outputStartNumber = val;
      } else if (arg === "-ar") {
        audioRate = parseInt(args[++i] ?? "0", 10) || undefined;
        if (audioRate !== undefined && audioRate < 0) return undefined;
      }
      else if (arg === "-ac") audioChannels = parseInt(args[++i] ?? "0", 10) || undefined;
      else if (arg === "-hide_banner" || arg === "-nostdin" || arg === "-stats" || arg === "-nostats") continue;
      else if (arg === "-f") {
        const val = args[++i];
        if (inputs.length === 0 || (i + 1 < args.length && args.slice(i + 1).includes("-i"))) pendingFormat = val;
        else outputFormat = val;
      } else if (arg === "-sseof") {
        const val = parseHlsDuration(args[++i] ?? "");
        if (!Number.isFinite(val) || val >= 0 || !args.slice(i + 1).includes("-i")) return undefined;
        pendingSseof = val;
      } else if (arg === "-ss") {
        const val = parseHlsDuration(args[++i] ?? "");
        if (!Number.isFinite(val)) return undefined;
        if (args.slice(i + 1).includes("-i")) pendingSs = val;
        else outputSs = val;
      } else if (arg === "-to") {
        const val = parseHlsDuration(args[++i] ?? "");
        if (!Number.isFinite(val)) return undefined;
        if (args.slice(i + 1).includes("-i")) pendingTo = val;
        else outputTo = val;
      } else if (arg === "-t") {
        const val = parseHlsDuration(args[++i] ?? "");
        if (!Number.isFinite(val) || val < 0) return undefined;
        if (args.slice(i + 1).includes("-i")) pendingDuration = val;
        else outputDuration = val;
      } else if (arg === "-stream_loop") pendingLoop = parseInt(args[++i] ?? "0", 10) || 0;
      else if (arg === "-r" || arg === "-framerate") {
        const val = parseFrameRate(args[++i] ?? "");
        if (val === undefined) return undefined;
        if (args.slice(i + 1).includes("-i")) pendingFps = val;
        else outputFps = val;
      } else if (arg === "-s") outputSize = args[++i];
      else if (arg === "-fix_sub_duration") {
        if (!args.slice(i + 1).includes("-i")) return undefined;
        pendingFixSubDuration = true;
      } else if (arg === "-i") {
        if (pendingAudioDecoder !== undefined && !astPlugins.some(plugin => plugin.canDemux && plugin.supportedAudioCodecs.includes(pendingAudioDecoder!))) return undefined;
        pendingAudioDecoder = undefined;
        inputs.push({
          path: args[++i] ?? "",
          format: pendingFormat,
          sampleRate: audioRate,
          channels: audioChannels,
          fixSubDuration: pendingFixSubDuration,
          startSeconds: pendingSs,
          endRelativeSeconds: pendingSseof,
          endSeconds: pendingTo,
          durationSeconds: pendingDuration,
          streamLoop: pendingLoop,
          fps: pendingFps,
          startNumber: pendingStartNumber,
        });
        audioRate = undefined; audioChannels = undefined;
        pendingFixSubDuration = false;
        pendingFormat = undefined; pendingSs = undefined; pendingSseof = undefined; pendingTo = undefined; pendingDuration = undefined; pendingLoop = undefined; pendingFps = undefined; pendingStartNumber = undefined;
      } else if (arg === "-c" || arg === "-codec") {
        const val = args[++i]; videoCodec = val; audioCodec = val; subtitleCodec = val;
      } else if (arg === "-c:v" || arg === "-vcodec" || arg === "-codec:v") videoCodec = args[++i];
      else if (arg === "-c:a" || arg === "-acodec" || arg === "-codec:a") {
        const value = args[++i];
        if (args.slice(i + 1).includes("-i")) pendingAudioDecoder = value;
        else audioCodec = value;
      }
      else if (arg === "-c:s" || arg === "-scodec" || arg === "-codec:s") subtitleCodec = args[++i];
      else if (arg === "-an") stripAudio = true;
      else if (arg === "-vn") stripVideo = true;
      else if (arg === "-sn") stripSubtitles = true;
      else if (arg === "-shortest") shortest = true;
      else if (arg === "-frames:v" || arg === "-vframes") maxVideoFrames = parseInt(args[++i] ?? "1", 10);
      else if (arg === "-frames:a" || arg === "-aframes") {
        const value = args[++i];
        maxAudioFrames = value?.trim() ? Number(value) : NaN;
        if (!Number.isSafeInteger(maxAudioFrames) || maxAudioFrames < 0) return undefined;
      }
      else if (arg === "-id3v2_version") {
        const value = args[++i];
        if (value !== "0" && value !== "3" && value !== "4") throw new Error("Invalid ID3v2 version: expected 0, 3 or 4");
        id3v2Version = Number(value) as 0 | 3 | 4;
      } else if (arg === "-write_id3v1") {
        const value = args[++i];
        if (value !== "0" && value !== "1") throw new Error("Invalid write_id3v1: expected 0 or 1");
        writeId3v1 = value === "1";
      } else if (arg === "-sample_fmt") {
        sampleFormat = args[++i];
        if (!sampleFormat) throw new Error("Missing sample_fmt value");
      } else if (arg === "-compression_level") {
        const value = args[++i];
        compressionLevel = value?.trim() ? Number(value) : NaN;
        if (!Number.isInteger(compressionLevel)) throw new Error("invalid compression_level value");
      } else if (arg === "-serial_offset") {
        const value = args[++i];
        serialOffset = value?.trim() ? Number(value) : NaN;
        if (!Number.isInteger(serialOffset) || serialOffset < 0 || serialOffset > 2147483647) throw new Error("Invalid serial_offset: expected an integer from 0 to 2147483647");
      } else if (arg === "-bitexact") {
        bitexact = true;
      } else if (arg === "-fflags") {
        const value = args[++i];
        if (value !== "bitexact" && value !== "+bitexact") throw new Error("Unsupported fflags: expected bitexact");
        bitexact = true;
        serialOffset ??= 0;
      } else if (arg === "-page_duration") {
        const value = args[++i];
        pageDuration = value?.trim() ? Number(value) : NaN;
        if (!Number.isSafeInteger(pageDuration) || pageDuration < 0) throw new Error("Invalid page_duration: expected nonnegative integer microseconds");
      } else if (arg === "-metadata_header_padding") {
        const value = args[++i];
        metadataHeaderPadding = value?.trim() ? Number(value) : NaN;
        if (!Number.isInteger(metadataHeaderPadding) || metadataHeaderPadding < -1 || metadataHeaderPadding > 2147483647) {
          throw new Error("Invalid metadata_header_padding: expected an integer from -1 to 2147483647");
        }
      } else if (arg === "-write_bext") {
        const value = args[++i];
        if (value !== "0" && value !== "1") throw new Error("invalid write_bext value");
        writeBext = value === "1";
      } else if (arg === "-write_xing") {
        const value = args[++i];
        if (value !== "0" && value !== "1") throw new Error("invalid write_xing value");
        writeXing = value === "1";
      } else if (arg === "-write_peak") {
        const value = args[++i];
        const mode = value === "0" ? "off" : value === "1" ? "on" : value === "2" ? "only" : value;
        if (mode !== "off" && mode !== "on" && mode !== "only") {
          throw new Error("Invalid write_peak value: expected off, on or only");
        }
        writePeak = mode;
      } else if (arg === "-rf64") {
        const value = args[++i];
        if (value !== "always" && value !== "auto" && value !== "never") {
          throw new Error("Invalid rf64 value: expected always, auto or never");
        }
        rf64 = value;
      } else if (arg === "-movflags") {
        const flags = args[++i] ?? "";
        if (flags.includes("faststart")) faststart = true;
        if (flags.includes("frag_keyframe") || flags.includes("empty_moov")) fragmented = true;
      } else if (arg === "-vf" || arg === "-filter:v") {
        const f = args[++i]; if (f) vfFilters.push(f);
      } else if (arg === "-af" || arg === "-filter:a" || arg.startsWith("-af:") || arg.startsWith("-filter:a:")) {
        // Audio filtering and validation require the async command.
        return undefined;
      } else if (arg === "-disposition" || arg.startsWith("-disposition:")) {
        streamDispositions.push([arg.slice("-disposition:".length), args[++i] ?? ""]);
      } else if (arg === "-metadata" || arg.startsWith("-metadata:")) {
        const kv = args[++i] ?? "";
        const eq = kv.indexOf("=");
        if (eq >= 0) {
          const k = kv.slice(0, eq).trim().toLowerCase();
          const v = kv.slice(eq + 1).trim();
          if (k === "language" && (arg === "-metadata:s" || arg.startsWith("-metadata:s:"))) {
            streamLanguages.push([arg.slice("-metadata:s:".length), v]);
          } else if (k === "rotate") rotation = parseInt(v, 10) || 0;
          else metadata[k] = v;
        }
      } else if (arg === "-display_rotation") rotation = Math.abs(parseInt(args[++i] ?? "0", 10) || 0);
      else if (arg.startsWith("-") && arg !== "-") return undefined;
      else {
        // Multi-output and trailing groups use the async path before any writes.
        if (i + 1 < args.length) return undefined;
        outputTarget = arg;
      }
    }

    if (inputs.length === 0 || !outputTarget) return undefined;
    // Output resampling and channel mixing require the async audio filter path.
    if (audioRate !== undefined || audioChannels !== undefined) return undefined;
    if (outputDuration === undefined && outputTo !== undefined && outputTo <= (outputSs ?? 0)) return undefined;
    if (outputFormat === "segment") return undefined;
    const isNullMux = outputFormat === "null";
    if (!isNullMux && !isStdout(outputTarget) && inputs.some(input =>
      input.format !== "lavfi" && !isStdin(input.path) && input.path === outputTarget)) return undefined;
    if (!isNullMux && !writeFileSync) return undefined;
    if (noOverwrite !== false && !isNullMux && (!readFileSync || readFileSync(outputTarget))) return undefined;

    const loadedDocs: MediaDocument[] = [];
    for (const inp of inputs) {
      let doc: MediaDocument;
      if (inp.format === "lavfi") {
        // Undefined declines the shell's synchronous optimization; the async
        // command runs lavfiSteps and yields between sample/pixel batches.
        return undefined;
      } else {
        const rawBytes = isStdin(inp.path) ? inBytes : readFileSync?.(inp.path);
        if (!rawBytes || rawBytes.byteLength > 262144) return undefined;
        budget.checkInputBytes(rawBytes.byteLength);
        const plugin = inp.format !== undefined
          ? registry.findByFormatName(inp.format)
          : registry.detect(rawBytes, inp.path);
        if (!plugin || !plugin.canDemux) return undefined;
        doc = plugin.parse(rawBytes, { decodeAudio: (plugin.id !== "flac" && plugin.id !== "ogg") || audioCodec !== "copy", filename: inp.path, budget, sampleRate: inp.sampleRate, channels: inp.channels });
        if (doc.tracks.some(track => track.decodeErrors?.length)) return undefined;
        const imageOutput = (outputFormat ? (registry.findById(outputFormat) ?? registry.findByFormatName(outputFormat)) : registry.findByFilename(outputTarget))?.id === "image2";
        if (imageOutput && videoCodec === "copy") return undefined;
        if ((imageOutput || maxVideoFrames !== undefined) && doc.tracks.some(track => track.type === "video" && !track.decodedVideoFrames)) return undefined;
      }
      if (inp.fixSubDuration && subtitleCodec !== "copy") doc = fixSubtitleDurations(doc);
      const startSeconds = inp.startSeconds ?? (inp.endRelativeSeconds === undefined
        ? undefined : Math.max(0, doc.durationSeconds + inp.endRelativeSeconds));
      if (startSeconds !== undefined || inp.endSeconds !== undefined || inp.durationSeconds !== undefined) {
        doc = sliceMp4(doc, { startSeconds, endSeconds: inp.endSeconds, durationSeconds: inp.durationSeconds });
      }
      if (inp.streamLoop === -1) {
        doc = loopToOutputEnd(doc, outputDuration === undefined ? outputTo : (outputSs ?? 0) + outputDuration, budget);
      } else if (inp.streamLoop && inp.streamLoop > 0) {
        doc = concatMp4(Array.from({ length: inp.streamLoop + 1 }, () => doc), { budget });
      }
      loadedDocs.push(doc);
    }

    const outPlugin = outputFormat ? (registry.findById(outputFormat) ?? registry.findByFormatName(outputFormat)) : registry.findByFilename(outputTarget);
    // MP4/MOV have no default subtitle encoder for automatic stream selection.
    if (subtitleCodec === undefined && (outPlugin?.id === "mp4" || outPlugin?.id === "mov")) stripSubtitles = true;
    let workingDoc = muxMp4(selectAutomaticAudio(loadedDocs), { stripAudio, stripVideo, stripSubtitles, shortest, rotation });
    if (workingDoc.tracks.length === 0 && outPlugin?.id !== "ffmetadata") return undefined;
    validateAudioEncoder(audioCodec, workingDoc, astPlugins);
    if (subtitleCodec !== "copy") workingDoc = transcodeSubtitles(workingDoc,
      outPlugin?.id);
    if (outputSs !== undefined || outputTo !== undefined || outputDuration !== undefined) {
      workingDoc = sliceMp4(workingDoc, { startSeconds: outputSs, endSeconds: outputDuration === undefined ? outputTo : undefined, durationSeconds: outputDuration });
    }
    if (outputSize && videoCodec !== "copy") {
      const [w, h] = outputSize.toLowerCase().split("x");
      if (w && h) vfFilters.push(`scale=${w}:${h}`);
    }
    if (outputFps && videoCodec !== "copy") vfFilters.push(`fps=${outputFps}`);
    if (vfFilters.length > 0) {
      // Filtering needs the cooperative async command, not a sync shortcut.
      return undefined;
    }
    if (maxVideoFrames !== undefined) {
      workingDoc = {
        ...workingDoc,
        tracks: workingDoc.tracks.map((t) => {
          if (t.type !== "video") return t;
          if (t.decodedVideoFrames && t.decodedVideoFrames.length > maxVideoFrames!) {
            return { ...t, samples: [], decodedVideoFrames: t.decodedVideoFrames.slice(0, maxVideoFrames) };
          }
          if (t.samples.length > maxVideoFrames!) {
            const slicedSamples = t.samples.slice(0, maxVideoFrames);
            return { ...t, duration: slicedSamples.reduce((acc, s) => acc + s.duration, 0), samples: slicedSamples };
          }
          return t;
        }),
      };
    }
    if (audioCodec === "copy" && maxAudioFrames !== undefined) {
      workingDoc = limitAudioCopyPackets(workingDoc, maxAudioFrames);
    }
    if (chapterSource !== undefined) {
      if (chapterSource >= loadedDocs.length) return undefined;
      workingDoc = { ...workingDoc, chapters: chapterSource < 0 ? undefined : loadedDocs[chapterSource]!.chapters };
    }
    if (metadataSource !== undefined && metadataSource >= loadedDocs.length) return undefined;
    const sourceMetadata = metadataSource === undefined ? loadedDocs[0]!.metadata
      : metadataSource < 0 ? {} : loadedDocs[metadataSource]!.metadata;
    const metaTags: Mp4MetadataTags = {
      ...sourceMetadata,
      description: metadata.description ?? sourceMetadata.description,
      custom: writeBext ? { ...sourceMetadata.custom, ...metadata } : sourceMetadata.custom,
      title: metadata.title ?? sourceMetadata.title,
      artist: metadata.artist ?? sourceMetadata.artist,
      album: metadata.album ?? sourceMetadata.album,
      date: metadata.date ?? metadata.year ?? sourceMetadata.date,
      comment: metadata.comment ?? sourceMetadata.comment,
      genre: metadata.genre ?? sourceMetadata.genre,
      encoder: outPlugin?.id === "ffmetadata" ? (bitexact ? undefined : "Lavf61.7.100") : metadata.encoder ?? sourceMetadata.encoder,
    };
    workingDoc = { ...workingDoc, faststart, metadata: metaTags, tracks: applyStreamDispositions(applyStreamLanguages(workingDoc.tracks, streamLanguages, metadataSource), streamDispositions) };
    if (isNullMux) return "";
    if (inputs.some(inp => isStdin(inp.path)) && !inBytes) return undefined;
    if (!writeFileSync || !outputTarget || outputTarget.endsWith("/") || outputTarget.endsWith("/.") || outputTarget.includes("/./") || /(?:^|\/)\.\.(?:\/|$)/u.test(outputTarget)) return undefined;
    if (formatImageSequence(outputTarget, outputStartNumber ?? 1) !== undefined) {
      const outExt = outputTarget.split(".").pop()?.toLowerCase() ?? "png";
      const vTrack = workingDoc.tracks.find((t) => t.type === "video");
      if (vTrack && !vTrack.decodedVideoFrames) return undefined;
      const frames = vTrack?.decodedVideoFrames ?? [];
      const limit = Math.min(frames.length, maxVideoFrames ?? Infinity);
      const imgFmt: ImageFormat = outExt === "jpg" || outExt === "jpeg" ? "jpeg" : outExt === "webp" ? "webp" : outExt === "gif" ? "gif" : outExt === "bmp" ? "bmp" : outExt === "ppm" ? "ppm" : "png";
      for (let idx = 0; idx < limit; idx++) {
        const f = frames[idx]!;
        const fileName = formatImageSequence(outputTarget, idx + (outputStartNumber ?? 1))!;
        const encoded = encodeImage(makeRgbaImg(f.width, f.height, f.data), { format: imgFmt }).data;
        if (!writeFileSync!(fileName, encoded)) return undefined;
      }
      return "";
    }
    if (!outPlugin || !outPlugin.canMux || outPlugin.id === "dash" || outPlugin.id === "hls") return undefined;
    if (outPlugin.id === "image2" && maxVideoFrames === 0) return "";
    const outExt = outputTarget.split(".").pop()?.toLowerCase();
    if (workingDoc.tracks.some(track => track.decodeErrors?.length)) return undefined;
    validateStreamCopy(workingDoc, outPlugin.id, { video: videoCodec, audio: audioCodec, subtitle: subtitleCodec });
    validateSubtitleEncoder(subtitleCodec, workingDoc, outPlugin.id);
    const serializedBytes = outPlugin.serialize(workingDoc, { writeBext, rf64, writePeak, audioCodec, audioBitrate, format: outputFormat ?? outExt, compressionLevel, sampleFormat, pageDuration, serialOffset, writeXing, faststart, fragmented, id3v2Version, writeId3v1, metadataHeaderPadding, metadata: metaTags, budget });
    if (outputTarget === "/dev/null") return "";
    if (isStdout(outputTarget)) return undefined;
    if (!writeFileSync!(outputTarget, serializedBytes)) return undefined;
    return "";
  } catch {
    return undefined;
  }
}

function formatImageSequence(pattern: string, number: number): string | undefined {
  let filename = "";
  let numbered = false;
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] !== "%") {
      filename += pattern[i];
      continue;
    }
    i++;
    if (pattern[i] === "%") {
      filename += "%";
      continue;
    }
    let width = 0;
    while (i < pattern.length && pattern[i]! >= "0" && pattern[i]! <= "9") {
      width = width * 10 + Number(pattern[i]);
      i++;
    }
    if (pattern[i] !== "d") return undefined;
    filename += String(number).padStart(width, "0");
    numbered = true;
  }
  return numbered ? filename : undefined;
}

function matchesImageGlob(pattern: string, name: string, budget: MediaBudgetTracker): boolean {
  const characters = Array.from(name);
  let positions = new Set([0]);
  for (let i = 0; i < pattern.length; i++) {
    budget.checkCpu();
    const token = pattern[i]!;
    const next = new Set<number>();
    if (token === "*") {
      let start = characters.length;
      for (const p of positions) start = Math.min(start, p);
      for (let p = start; p <= characters.length; p++) next.add(p);
    } else {
      let literal = token;
      let contents: string | undefined;
      if (token === "\\") literal = pattern[++i] ?? "\\";
      if (token === "[") {
        let end = i + 1;
        if (pattern[end] === "!" || pattern[end] === "^") end++;
        if (pattern[end] === "]") end++;
        while (end < pattern.length && pattern[end] !== "]") end++;
        if (end < pattern.length) { contents = pattern.slice(i + 1, end); i = end; }
      }
      for (const p of positions) {
        budget.checkCpu();
        const character = characters[p];
        if (character === undefined) continue;
        let matches = token === "?" || character === literal;
        if (contents !== undefined) {
          const negated = contents[0] === "!" || contents[0] === "^";
          let included = false;
          for (let c = negated ? 1 : 0; c < contents.length; c++) {
            let start = contents[c]!;
            if (start === "\\" && c + 1 < contents.length) start = contents[++c]!;
            if (contents[c + 1] === "-" && c + 2 < contents.length) {
              included ||= character >= start && character <= contents[c + 2]!;
              c += 2;
            } else included ||= character === start;
          }
          matches = negated ? !included : included;
        }
        if (matches) next.add(p + 1);
      }
    }
    positions = next;
    if (positions.size === 0) return false;
  }
  return positions.has(characters.length);
}

interface InputSpec {
  readonly sampleRate?: number | undefined;
  readonly channels?: number | undefined;
  readonly path: string;
  readonly format?: string | undefined;
  readonly safe?: boolean | undefined;
  readonly allowedExtensions?: string | undefined;
  readonly fixSubDuration?: boolean | undefined;
  readonly startSeconds?: number | undefined;
  readonly endRelativeSeconds?: number | undefined;
  readonly endSeconds?: number | undefined;
  readonly durationSeconds?: number | undefined;
  readonly streamLoop?: number | undefined;
  readonly imageLoop?: boolean | undefined;
  readonly fps?: number | undefined;
  readonly startNumber?: number | undefined;
  readonly startNumberRange?: number | undefined;
  readonly patternType?: "glob" | "none" | "sequence" | undefined;
}

export function createFfmpegCommand(options: FfmpegCommandsOptions = {}): CommandDefinition {
  const astPlugins = options.asts ?? allMediaAsts();
  const registry = createMediaAstRegistry(astPlugins);
  const features = options.features ?? {};

  return {
    name: "ffmpeg",
    runtimeIdentity: commandRuntimeIdentity,
    description: "Multimedia converter, merger, and stream processor powered by pluggable ASTs",
    async execute(context: CommandContext) {
      const budget = new MediaBudgetTracker(options.limits);
      const readSource = createInputReader(context, budget);
      const argsObj = getCommandArguments(context);
      const args = argsObj.args;

      if (args.length === 0) {
        await writeBytes(
          context.stderr,
          encodeUtf8(formatIntrospectionOutput("-h", astPlugins)),
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
            encodeUtf8(formatIntrospectionOutput(arg, astPlugins)),
            context.signal
          );
          return { exitCode: 0 };
        }
      }

      const inputs: InputSpec[] = [];
      let pendingFormat: string | undefined;
      let pendingAllowedExtensions: string | undefined;
      let pendingSafe: boolean | undefined;
      let pendingAudioDecoder: string | undefined;
      let pendingFixSubDuration = false;
      let pendingSs: number | undefined;
      let pendingSseof: number | undefined;
      let pendingTo: number | undefined;
      let pendingDuration: number | undefined;
      let pendingLoop: number | undefined;
      let pendingImageLoop: boolean | undefined;
      let pendingFps: number | undefined;
      let pendingStartNumber: number | undefined;
      let pendingStartNumberRange: number | undefined;
      let pendingPatternType: InputSpec["patternType"];
      let overwrite: boolean | undefined;
      let exitOnError = false;
      let maxErrorRate = Math.fround(2 / 3);
      let abortOnEmptyOutput = false;
      let hasOutputFrames = false;
      let progressTarget: string | undefined;
      let progressSeconds = 0;
      let inputReadFailed = false;
      let filterComplex: string | undefined;
      const mappedAudioLabels = new Set<string>();
      const outputs: (() => Promise<{ exitCode: number }>)[] = [];
      const inputBytes = new Map<string, Uint8Array>();
      const readInput = async (path: string): Promise<Uint8Array> => {
        if (outputs.length === 1) return readSource(path);
        let bytes = inputBytes.get(path);
        if (!bytes) {
          bytes = await readSource(path);
          inputBytes.set(path, bytes);
        }
        // Each output may detach parsed buffers; retain the source for later outputs.
        return bytes.slice();
      };
      let i = 0;
      while (i < args.length) {
        let outputStartNumber: number | undefined;
        let updateImage = false;
        let framePts = false;

        let outputFormat: string | undefined;
        let hashAlgorithm = "sha256";
        let outputSs: number | undefined;
        let outputTo: number | undefined;
        let outputDuration: number | undefined;
        let videoCodec: string | undefined;
        let audioCodec: string | undefined;
        let audioBitrate: number | undefined;
        let subtitleCodec: string | undefined;
        let audioRate: number | undefined;
        let audioChannels: number | undefined;
        let segmentTime = 2;
        let segmentList: string | undefined;
        let hlsTime = 2;
        let dashAdaptationSets: string | undefined;
        let dashSegmentDuration = 5;
        let dashFragmentType: "none" | "every_frame" = "none";
        let dashWindowSize = 0;
        let dashUseTemplate = true;
        let dashSingleFile = false;
        let dashHlsPlaylist = false;
        let dashRemoveAtExit = false;
        let dashUseTimeline = true;
        let dashInitSegmentName: string | undefined;
        let dashMediaSegmentName: string | undefined;
        let hlsListSize = 5;
        let hlsPlaylistType: string | undefined;
        let hlsDeleteSegments = false;
        let hlsOmitEndlist = false;
        let hlsDiscontStart = false;
        let hlsRoundDurations = false;
        let hlsIndependentSegments = false;
        let hlsSplitByTime = false;
        let hlsDeleteThreshold = 1;
        let hlsBaseUrl = "";
        let hlsSegmentFilename: string | undefined;
        let hlsFmp4InitFilename = "init.mp4";
        let hlsSingleFile = false;
        let hlsSegmentType: string | undefined;
        let stripAudio = false;
        let stripVideo = false;
        let stripSubtitles = false;
        let shortest = false;
        let writeXing = true;
        let writeBext = false;
        let sampleFormat: string | undefined;
        let compressionLevel: number | undefined;
        let writePeak: "off" | "on" | "only" | undefined;
        let rf64: "always" | "auto" | "never" | undefined;
        let faststart = true;
        let fragmented = false;
        let id3v2Version: 0 | 3 | 4 | undefined;
        let writeId3v1: boolean | undefined;
        let metadataHeaderPadding: number | undefined;
        let pageDuration: number | undefined;
        let serialOffset: number | undefined;
        let bitexact = false;
        let maxVideoFrames: number | undefined;
        let maxAudioFrames: number | undefined;
        let outputFps: number | undefined;
        let videoSync = "auto";
        let outputSize: string | undefined;
        let rotation: number | undefined;
        const maps: string[] = [];
        const vfFilters: string[] = [];
        const afFilters: { ordinal: number | undefined; expression: string }[] = [];
        let chapterSource: number | undefined;
        let metadataSource: number | undefined;
        const metadata: Record<string, string> = {};
        const streamLanguages: [string, string][] = [];
        const streamDispositions: [string, string][] = [];
        let outputTarget: string | undefined;

        for (; i < args.length; i++) {
          const arg = args[i]!;
          if (arg === "-y" || arg === "-n") {
            if (overwrite !== undefined && overwrite !== (arg === "-y")) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: both -y and -n supplied\n"), context.signal);
              return { exitCode: 234 };
            }
            overwrite = arg === "-y";
          } else if (arg === "-progress") {
            progressTarget = args[++i];
            if (progressTarget !== undefined && !isStdout(progressTarget)) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: progress output supports stdout only (pipe:1)\n"), context.signal);
              return { exitCode: 1 };
            }
          } else if (arg === "-abort_on") {
            const value = args[++i];
            if (value !== "empty_output") {
              await writeBytes(context.stderr, encodeUtf8(`ffmpeg: Unsupported -abort_on value '${value ?? ""}'\n`), context.signal);
              return { exitCode: 234 };
            }
            abortOnEmptyOutput = true;
          } else if (arg === "-max_error_rate") {
            const value = args[++i]?.trim().toLowerCase() ?? "";
            const rate = ["inf", "+inf", "infinity", "+infinity"].includes(value) ? Infinity
              : value === "-inf" || value === "-infinity" ? -Infinity : Number(value);
            if (!value || (Number.isNaN(rate) && value !== "nan")) {
              await writeBytes(context.stderr, encodeUtf8(`ffmpeg: Expected number for max_error_rate but found: ${value}\n`), context.signal);
              return { exitCode: 234 };
            }
            maxErrorRate = Math.fround(rate);
          } else if (arg === "-xerror") {
            exitOnError = true;
          } else if (arg === "-allowed_extensions") {
            pendingAllowedExtensions = args[++i];
            if (pendingAllowedExtensions === undefined) throw new Error("Missing value for -allowed_extensions");
          } else if (arg === "-safe") {
            const value = args[++i];
            if (value !== "0" && value !== "1") {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: -safe must be 0 or 1\n"), context.signal);
              return { exitCode: 1 };
            }
            pendingSafe = value === "1";
          } else if (arg === "-v" || arg === "-loglevel" || arg === "-threads" || arg === "-pix_fmt" || arg === "-preset" || arg === "-crf" || arg === "-bf" || arg === "-b:v" || arg === "-bsf:v" || arg === "-bsf:a" || arg === "-tag:v" || arg === "-tag:a") {
            i++;
          } else if (arg === "-b:a") {
            audioBitrate = parseAudioBitrate(args[++i]);
            if (audioBitrate === undefined) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: Invalid audio bitrate\n"), context.signal);
              return { exitCode: 1 };
            }
          } else if (arg === "-hash") {
            hashAlgorithm = args[++i] ?? "";
          } else if (arg === "-update") {
            updateImage = args[++i] === "1";
          } else if (arg === "-vsync" || arg === "-fps_mode") {
            videoSync = args[++i] ?? "";
          } else if (arg === "-segment_time") {
            const value = args[++i];
            segmentTime = parseFfmpegTimestamp(value ?? "");
            if (!Number.isFinite(segmentTime) || segmentTime <= 0) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: invalid segment_time\n"), context.signal);
              return { exitCode: 1 };
            }
          } else if (arg === "-segment_list") {
            segmentList = args[++i];
            if (!segmentList) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: missing segment_list filename\n"), context.signal);
              return { exitCode: 1 };
            }
          } else if (arg === "-hls_time") {
            hlsTime = parseHlsDuration(args[++i] ?? "");
            if (!Number.isFinite(hlsTime) || hlsTime < 0 || hlsTime > 9_223_372_036_854.775) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: invalid hls_time\n"), context.signal);
              return { exitCode: 1 };
            }
          } else if (arg === "-adaptation_sets") {
            dashAdaptationSets = args[++i];
            if (!dashAdaptationSets || dashAdaptationSets.startsWith("-")) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: missing adaptation_sets mapping\n"), context.signal);
              return { exitCode: 1 };
            }
          } else if (arg === "-init_seg_name" || arg === "-media_seg_name") {
            const value = args[++i];
            if (!value) {
              await writeBytes(context.stderr, encodeUtf8(`ffmpeg: missing ${arg.slice(1)} filename\n`), context.signal);
              return { exitCode: 1 };
            }
            if (arg === "-init_seg_name") dashInitSegmentName = value;
            else dashMediaSegmentName = value;
          } else if (arg === "-use_template" || arg === "-use_timeline" || arg === "-single_file" || arg === "-remove_at_exit" || arg === "-hls_playlist") {
            const value = args[++i];
            if (value !== "0" && value !== "1") {
              await writeBytes(context.stderr, encodeUtf8(`ffmpeg: invalid ${arg.slice(1)}\n`), context.signal);
              return { exitCode: 1 };
            }
            if (arg === "-use_template") dashUseTemplate = value === "1";
            else if (arg === "-use_timeline") dashUseTimeline = value === "1";
            else if (arg === "-single_file") dashSingleFile = value === "1";
            else if (arg === "-hls_playlist") dashHlsPlaylist = value === "1";
            else dashRemoveAtExit = value === "1";
          } else if (arg === "-window_size") {
            const value = args[++i] ?? "";
            dashWindowSize = Number(value);
            if (!value.trim() || !Number.isInteger(dashWindowSize) || dashWindowSize < 0 || dashWindowSize > 2_147_483_647) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: invalid window_size\n"), context.signal);
              return { exitCode: 234 };
            }
          } else if (arg === "-frag_type") {
            const value = args[++i];
            if (value !== "none" && value !== "every_frame") {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: unsupported frag_type (expected none or every_frame)\n"), context.signal);
              return { exitCode: 234 };
            }
            dashFragmentType = value;
          } else if (arg === "-seg_duration") {
            dashSegmentDuration = parseHlsDuration(args[++i] ?? "");
            if (!Number.isFinite(dashSegmentDuration) || dashSegmentDuration < 0 || dashSegmentDuration > 9_223_372_036_854.775) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: invalid seg_duration\n"), context.signal);
              return { exitCode: 234 };
            }
          } else if (arg === "-hls_base_url") {
            const value = args[++i];
            if (value === undefined) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: missing hls_base_url\n"), context.signal);
              return { exitCode: 1 };
            }
            hlsBaseUrl = value;
          } else if (arg === "-hls_fmp4_init_filename") {
            const value = args[++i];
            if (!value) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: missing hls_fmp4_init_filename\n"), context.signal);
              return { exitCode: 1 };
            }
            hlsFmp4InitFilename = value;
          } else if (arg === "-hls_segment_filename") {
            hlsSegmentFilename = args[++i];
          } else if (arg === "-hls_segment_type") {
            hlsSegmentType = args[++i];
            if (hlsSegmentType !== "mpegts" && hlsSegmentType !== "fmp4") {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: invalid hls_segment_type\n"), context.signal);
              return { exitCode: 1 };
            }
          } else if (arg === "-hls_playlist_type") {
            hlsPlaylistType = args[++i];
            if (hlsPlaylistType !== "vod" && hlsPlaylistType !== "event") {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: invalid hls_playlist_type\n"), context.signal);
              return { exitCode: 1 };
            }
          } else if (arg === "-hls_list_size") {
            const value = args[++i];
            hlsListSize = value?.trim() ? Number(value) : NaN;
            if (!Number.isSafeInteger(hlsListSize) || hlsListSize < 0) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: invalid hls_list_size\n"), context.signal);
              return { exitCode: 1 };
            }
          } else if (arg === "-hls_flags") {
            const value = args[++i] ?? "";
            if (!value.startsWith("+") && !value.startsWith("-")) {
              hlsDeleteSegments = false;
              hlsSingleFile = false;
              hlsOmitEndlist = false;
              hlsDiscontStart = false;
              hlsRoundDurations = false;
              hlsIndependentSegments = false;
              hlsSplitByTime = false;
            }
            for (const flag of value.replaceAll("-", "+-").split("+")) {
              if (!flag) continue;
              const enabled = !flag.startsWith("-");
              const name = enabled ? flag : flag.slice(1);
              if (name === "single_file") hlsSingleFile = enabled;
              else if (name === "delete_segments") hlsDeleteSegments = enabled;
              else if (name === "independent_segments") hlsIndependentSegments = enabled;
              else if (name === "split_by_time") hlsSplitByTime = enabled;
              else if (name === "omit_endlist") hlsOmitEndlist = enabled;
              else if (name === "discont_start") hlsDiscontStart = enabled;
              else if (name === "round_durations") hlsRoundDurations = enabled;
              else {
                await writeBytes(context.stderr, encodeUtf8(`ffmpeg: unrecognized HLS flag '${name}'\n`), context.signal);
                return { exitCode: 1 };
              }
            }
          } else if (arg === "-hls_delete_threshold") {
            const value = args[++i];
            hlsDeleteThreshold = value?.trim() ? Number(value) : NaN;
            if (!Number.isSafeInteger(hlsDeleteThreshold) || hlsDeleteThreshold < 1) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: invalid hls_delete_threshold\n"), context.signal);
              return { exitCode: 1 };
            }
          } else if (arg === "-map_chapters") {
            const value = args[++i];
            chapterSource = value?.trim() ? Number(value) : NaN;
            if (!Number.isSafeInteger(chapterSource)) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: invalid chapter input index\n"), context.signal);
              return { exitCode: 1 };
            }
          } else if (arg === "-map_metadata") {
            const value = args[++i];
            metadataSource = value?.trim() ? Number(value) : NaN;
            if (!Number.isSafeInteger(metadataSource)) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: invalid metadata input index\n"), context.signal);
              return { exitCode: 1 };
            }
          } else if (arg === "-frame_pts") {
            const value = args[++i];
            if (value !== "0" && value !== "1") {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: invalid frame_pts\n"), context.signal);
              return { exitCode: 1 };
            }
            framePts = value === "1";
          } else if (arg === "-start_number_range") {
            const value = Number(args[++i]);
            if (!Number.isInteger(value) || value < 1 || value > 2147483647) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: invalid start_number_range\n"), context.signal);
              return { exitCode: 1 };
            }
            pendingStartNumberRange = value;
          } else if (arg === "-start_number") {
            const val = Number(args[++i]);
            if (!Number.isSafeInteger(val) || val < 0) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: invalid start_number\n"), context.signal);
              return { exitCode: 1 };
            }
            if (args.slice(i + 1).includes("-i")) pendingStartNumber = val;
            else outputStartNumber = val;
          } else if (arg === "-ar") {
            audioRate = parseInt(args[++i] ?? "0", 10) || undefined;
            if (audioRate !== undefined && audioRate < 0) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: sample rate must be nonnegative\n"), context.signal);
              return { exitCode: 1 };
            }
          } else if (arg === "-ac") {
            audioChannels = parseInt(args[++i] ?? "0", 10) || undefined;
          } else if (arg === "-ch_layout" || arg === "-channel_layout") {
            if (args[++i] !== "mono") {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: only mono output channel layout is supported\n"), context.signal);
              return { exitCode: 1 };
            }
            audioChannels = 1;
          } else if (arg === "-hide_banner" || arg === "-nostdin" || arg === "-stats" || arg === "-nostats") {
            // no-op
          } else if (arg === "-f") {
            const val = args[++i];
            if (inputs.length === 0 || (i + 1 < args.length && args.slice(i + 1).includes("-i"))) {
              pendingFormat = val;
            } else {
              outputFormat = val;
            }
          } else if (arg === "-sseof") {
            const val = parseHlsDuration(args[++i] ?? "");
            if (!Number.isFinite(val) || val >= 0 || !args.slice(i + 1).includes("-i")) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: -sseof requires a negative duration before an input\n"), context.signal);
              return { exitCode: 1 };
            }
            pendingSseof = val;
          } else if (arg === "-ss") {
            const val = parseHlsDuration(args[++i] ?? "");
            if (i < args.length && !Number.isFinite(val)) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: invalid -ss duration\n"), context.signal);
              return { exitCode: 1 };
            }
            if (args.slice(i + 1).includes("-i")) {
              pendingSs = val;
            } else {
              outputSs = val;
            }
          } else if (arg === "-to") {
            const val = parseHlsDuration(args[++i] ?? "");
            if (i < args.length && !Number.isFinite(val)) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: invalid -to duration\n"), context.signal);
              return { exitCode: 1 };
            }
            if (args.slice(i + 1).includes("-i")) {
              pendingTo = val;
            } else {
              outputTo = val;
            }
          } else if (arg === "-t") {
            const val = parseHlsDuration(args[++i] ?? "");
            if (i < args.length && (!Number.isFinite(val) || val < 0)) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: -t duration must be nonnegative\n"), context.signal);
              return { exitCode: 1 };
            }
            if (args.slice(i + 1).includes("-i")) {
              pendingDuration = val;
            } else {
              outputDuration = val;
            }
          } else if (arg === "-pattern_type") {
            const value = args[++i];
            if (value !== "glob" && value !== "none" && value !== "sequence") {
              await writeBytes(context.stderr, encodeUtf8(`ffmpeg: Invalid image2 pattern type: ${value ?? ""}\n`), context.signal);
              return { exitCode: 1 };
            }
            pendingPatternType = value;
          } else if (arg === "-loop") {
            const value = args[++i];
            if (value !== "0" && value !== "1") {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: -loop must be 0 or 1\n"), context.signal);
              return { exitCode: 1 };
            }
            pendingImageLoop = value === "1";
          } else if (arg === "-stream_loop") {
            pendingLoop = parseInt(args[++i] ?? "0", 10) || 0;
          } else if (arg === "-r" || arg === "-framerate") {
            const val = parseFrameRate(args[++i] ?? "");
            if (val === undefined) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: Invalid framerate\n"), context.signal);
              return { exitCode: 1 };
            }
            if (args.slice(i + 1).includes("-i")) {
              pendingFps = val;
            } else {
              outputFps = val;
            }
          } else if (arg === "-s") {
            outputSize = args[++i];
          } else if (arg === "-fix_sub_duration") {
            if (!args.slice(i + 1).includes("-i")) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: -fix_sub_duration must precede an input\n"), context.signal);
              return { exitCode: 1 };
            }
            pendingFixSubDuration = true;
          } else if (arg === "-i") {
            if (pendingAudioDecoder !== undefined && !astPlugins.some(plugin => plugin.canDemux && plugin.supportedAudioCodecs.includes(pendingAudioDecoder!))) {
              await writeBytes(context.stderr, encodeUtf8(`ffmpeg: Unknown decoder '${pendingAudioDecoder}'\n`), context.signal);
              return { exitCode: 1 };
            }
            pendingAudioDecoder = undefined;
            const path = args[++i] ?? "";
            inputs.push({
              path,
              format: pendingFormat,
              sampleRate: audioRate,
              channels: audioChannels,
              fixSubDuration: pendingFixSubDuration,
              safe: pendingSafe,
              allowedExtensions: pendingAllowedExtensions,
              startSeconds: pendingSs,
              endRelativeSeconds: pendingSseof,
              endSeconds: pendingTo,
              durationSeconds: pendingDuration,
              streamLoop: pendingLoop,
              imageLoop: pendingImageLoop,
              fps: pendingFps,
              startNumber: pendingStartNumber,
              patternType: pendingPatternType,
              startNumberRange: pendingStartNumberRange
            });
            audioRate = undefined;
            audioChannels = undefined;
            pendingFormat = undefined;
            pendingSafe = undefined;
            pendingAllowedExtensions = undefined;
            pendingFixSubDuration = false;
            pendingSs = undefined;
            pendingSseof = undefined;
            pendingTo = undefined;
            pendingDuration = undefined;
            pendingLoop = undefined;
            pendingImageLoop = undefined;
            pendingFps = undefined;
            pendingStartNumber = undefined;
            pendingStartNumberRange = undefined;
            pendingPatternType = undefined;
          } else if (arg === "-c" || arg === "-codec") {
            const val = args[++i];
            videoCodec = val;
            audioCodec = val;
            subtitleCodec = val;
          } else if (arg === "-c:v" || arg === "-vcodec" || arg === "-codec:v") {
            videoCodec = args[++i];
          } else if (arg === "-c:a" || arg === "-acodec" || arg === "-codec:a") {
            const value = args[++i];
            if (args.slice(i + 1).includes("-i")) pendingAudioDecoder = value;
            else audioCodec = value;
          } else if (arg === "-c:s" || arg === "-scodec" || arg === "-codec:s") {
            subtitleCodec = args[++i];
          } else if (arg === "-an") {
            stripAudio = true;
          } else if (arg === "-vn") {
            stripVideo = true;
          } else if (arg === "-sn") {
            stripSubtitles = true;
          } else if (arg === "-shortest") {
            shortest = true;
          } else if (arg === "-frames:v" || arg === "-vframes") {
            maxVideoFrames = parseInt(args[++i] ?? "1", 10);
          } else if (arg === "-frames:a" || arg === "-aframes") {
            const value = args[++i];
            maxAudioFrames = value?.trim() ? Number(value) : NaN;
            if (!Number.isSafeInteger(maxAudioFrames) || maxAudioFrames < 0) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: invalid audio frame limit\n"), context.signal);
              return { exitCode: 1 };
            }
          } else if (arg === "-id3v2_version") {
            const value = args[++i];
            if (value !== "0" && value !== "3" && value !== "4") {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: invalid ID3v2 version: expected 0, 3 or 4\n"), context.signal);
              return { exitCode: 1 };
            }
            id3v2Version = Number(value) as 0 | 3 | 4;
          } else if (arg === "-write_id3v1") {
            const value = args[++i];
            if (value !== "0" && value !== "1") {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: invalid write_id3v1: expected 0 or 1\n"), context.signal);
              return { exitCode: 1 };
            }
            writeId3v1 = value === "1";
          } else if (arg === "-sample_fmt") {
            sampleFormat = args[++i];
            if (!sampleFormat) throw new Error("Missing sample_fmt value");
          } else if (arg === "-compression_level") {
            const value = args[++i];
            compressionLevel = value?.trim() ? Number(value) : NaN;
            if (!Number.isInteger(compressionLevel)) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: invalid compression_level value\n"), context.signal);
              return { exitCode: 1 };
            }
          } else if (arg === "-serial_offset") {
            const value = args[++i];
            serialOffset = value?.trim() ? Number(value) : NaN;
            if (!Number.isInteger(serialOffset) || serialOffset < 0 || serialOffset > 2147483647) throw new Error("Invalid serial_offset: expected an integer from 0 to 2147483647");
          } else if (arg === "-bitexact") {
            bitexact = true;
          } else if (arg === "-fflags") {
            const value = args[++i];
            if (value !== "bitexact" && value !== "+bitexact") throw new Error("Unsupported fflags: expected bitexact");
            bitexact = true;
            serialOffset ??= 0;
          } else if (arg === "-page_duration") {
            const value = args[++i];
            pageDuration = value?.trim() ? Number(value) : NaN;
            if (!Number.isSafeInteger(pageDuration) || pageDuration < 0) throw new Error("Invalid page_duration: expected nonnegative integer microseconds");
          } else if (arg === "-metadata_header_padding") {
            const value = args[++i];
            metadataHeaderPadding = value?.trim() ? Number(value) : NaN;
            if (!Number.isInteger(metadataHeaderPadding) || metadataHeaderPadding < -1 || metadataHeaderPadding > 2147483647) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: invalid metadata_header_padding: expected an integer from -1 to 2147483647\n"), context.signal);
              return { exitCode: 1 };
            }
          } else if (arg === "-write_bext") {
            const value = args[++i];
            if (value !== "0" && value !== "1") {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: invalid write_bext value\n"), context.signal);
              return { exitCode: 1 };
            }
            writeBext = value === "1";
          } else if (arg === "-write_xing") {
            const value = args[++i];
            if (value !== "0" && value !== "1") {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: invalid write_xing value\n"), context.signal);
              return { exitCode: 1 };
            }
            writeXing = value === "1";
          } else if (arg === "-write_peak") {
            const value = args[++i];
            const mode = value === "0" ? "off" : value === "1" ? "on" : value === "2" ? "only" : value;
            if (mode !== "off" && mode !== "on" && mode !== "only") {
              throw new Error("Invalid write_peak value: expected off, on or only");
            }
            writePeak = mode;
          } else if (arg === "-rf64") {
            const value = args[++i];
            if (value !== "always" && value !== "auto" && value !== "never") {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: Invalid rf64 value: expected always, auto or never\n"), context.signal);
              return { exitCode: 1 };
            }
            rf64 = value;
          } else if (arg === "-movflags") {
            const flags = args[++i] ?? "";
            if (flags.includes("faststart")) faststart = true;
            if (flags.includes("frag_keyframe") || flags.includes("empty_moov")) {
              fragmented = true;
            }
          } else if (arg === "-map") {
            const m = args[++i];
            if (m) maps.push(m);
          } else if (arg === "-vf" || arg === "-filter:v") {
            const f = args[++i];
            if (f) vfFilters.push(f);
          } else if (arg === "-af" || arg === "-filter:a" || arg.startsWith("-af:") || arg.startsWith("-filter:a:")) {
            const f = args[++i];
            const selector = arg.startsWith("-af:") ? arg.slice(4)
              : arg.startsWith("-filter:a:") ? arg.slice(10) : undefined;
            const ordinal = selector === undefined ? undefined : Number(selector);
            if (selector !== undefined && (!selector || !Array.from(selector).every(char => char >= "0" && char <= "9") || !Number.isSafeInteger(ordinal))) {
              throw new Error(`Unsupported audio stream specifier: ${selector}`);
            }
            if (f) afFilters.push({ ordinal, expression: f });
          } else if (arg === "-filter_complex" || arg === "-lavfi") {
            filterComplex = args[++i];
          } else if (arg === "-disposition" || arg.startsWith("-disposition:")) {
            streamDispositions.push([arg.slice("-disposition:".length), args[++i] ?? ""]);
          } else if (arg === "-metadata" || arg.startsWith("-metadata:")) {
            const kv = args[++i] ?? "";
            const eq = kv.indexOf("=");
            if (eq >= 0) {
              const k = kv.slice(0, eq).trim().toLowerCase();
              const v = kv.slice(eq + 1).trim();
              if (k === "language" && (arg === "-metadata:s" || arg.startsWith("-metadata:s:"))) {
                streamLanguages.push([arg.slice("-metadata:s:".length), v]);
              } else if (k === "rotate") rotation = parseInt(v, 10) || 0;
              else metadata[k] = v;
            }
          } else if (arg === "-display_rotation") {
            rotation = Math.abs(parseInt(args[++i] ?? "0", 10) || 0);
          } else if (!arg.startsWith("-") || arg === "-") {
            outputTarget = arg;
            i++;
            break;
          } else {
            await writeBytes(context.stderr, encodeUtf8(`ffmpeg: Unrecognized option '${arg.slice(1)}'\n`), context.signal);
            return { exitCode: 8 };
          }
          if (i >= args.length) {
            await writeBytes(context.stderr, encodeUtf8(`ffmpeg: Missing argument for option '${arg.slice(1)}'\n`), context.signal);
            return { exitCode: 234 };
          }
        }


        if (inputs.length === 0) {
          await writeBytes(
            context.stderr,
            encodeUtf8("ffmpeg: must specify at least one input (-i)\n"),
            context.signal
          );
          return { exitCode: 1 };
        }

        // A filename closes its option group; trailing options have no output.
        if (!outputTarget) break;
        const target = outputTarget;
        outputs.push(async () => {
          const outputTarget = target;
          if (outputDuration === undefined && outputTo !== undefined && outputTo <= (outputSs ?? 0)) {
            await writeBytes(context.stderr, encodeUtf8("ffmpeg: -to value smaller than -ss; aborting.\n"), context.signal);
            return { exitCode: 1 };
          }

          try {
            if (outputFormat !== "null" && outputTarget !== "/dev/null" && !isStdout(outputTarget)) {
              const inputIndex = inputs.findIndex(input =>
                input.format !== "lavfi" && !isStdin(input.path) && input.path === outputTarget);
              if (inputIndex >= 0) throw new Error(`Output ${outputTarget} same as Input #${inputIndex} - exiting. FFmpeg cannot edit existing files in-place.`);
            }
            // Virtual streams are non-interactive: replacing a file requires -y.
            if (
              !overwrite &&
              !isStdout(outputTarget) &&
              outputFormat !== "null"
            ) {
              const outFull = resolvePath(context.cwd, outputTarget);
              try {
                await context.fs.stat(outFull, { signal: context.signal });
                await writeBytes(
                  context.stderr,
                  encodeUtf8(`File '${outputTarget}' already exists. Exiting.\n`),
                  context.signal
                );
                return { exitCode: 1 };
              } catch (error) {
                rethrowRuntimeError(context, error);
                if ((error as { code?: string }).code !== "ENOENT") throw error;
                // File does not exist, proceed
              }
            }

            const loadSingleDocument = async (
              filePath: string,
              explicitFormat?: string,
              fpsHint?: number,
              input?: InputSpec
            ): Promise<MediaDocument> => {
              if (explicitFormat === "lavfi") {
                if (features.lavfiSources === false) {
                  throw new Error("lavfi synthetic sources are disabled by consumer feature configuration");
                }
                const steps = lavfiSteps(filePath, budget, input?.durationSeconds !== undefined
                  ? (input.startSeconds ?? 0) + input.durationSeconds
                  : input?.endSeconds ?? (outputDuration !== undefined
                    ? (input?.startSeconds ?? 0) + (outputSs ?? 0) + outputDuration
                    : outputTo !== undefined ? (input?.startSeconds ?? 0) + outputTo : undefined));
                let step = steps.next();
                while (!step.done) {
                  await yieldTurn(context.signal);
                  context.signal.throwIfAborted();
                  step = steps.next();
                }
                return step.value;
              }

              if (filePath.startsWith("concat:")) {
                const parts = filePath
                  .slice("concat:".length)
                  .split("|")
                  .map((x) => x.trim())
                  .filter(Boolean);
                budget.checkConcatInputs(parts.length);
                const docs: MediaDocument[] = [];
                for (const p of parts) {
                  docs.push(await loadSingleDocument(p));
                }
                return concatMp4(docs, { limits: options.limits, budget });
              }

              let globPaths: string[] | undefined;
              if (input?.patternType === "glob") {
                globPaths = ["/"];
                for (const component of resolvePath(context.cwd, filePath).split("/").filter(Boolean)) {
                  const matches: string[] = [];
                  for (const directory of globPaths) {
                    budget.checkCpu();
                    context.signal.throwIfAborted();
                    let entries;
                    try {
                      entries = await context.fs.readdir(directory, { signal: context.signal });
                    } catch (error) {
                      rethrowRuntimeError(context, error);
                      if (["ENOENT", "ENOTDIR"].includes((error as { code?: string }).code ?? "")) continue;
                      throw error;
                    }
                    for (const entry of entries) {
                      budget.checkCpu();
                      if (entry.name.startsWith(".") && !component.startsWith(".") && !component.startsWith("\\.")) continue;
                      if (matchesImageGlob(component, entry.name, budget)) matches.push(resolvePath(directory, entry.name));
                    }
                  }
                  globPaths = matches;
                }
                globPaths.sort();
              }

              // Literal image inputs bypass numbered-pattern expansion.
              if (globPaths || (input?.patternType !== "none" && formatImageSequence(filePath, input?.startNumber ?? 0) !== undefined)) {
                const frames: MediaVideoFrame[] = [];
                const fps = fpsHint ?? 25;
                const startNumber = input?.startNumber ?? 0;
                const startNumberRange = input?.startNumberRange ?? 5;
                for (let idx = globPaths ? 0 : startNumber; !globPaths || idx < globPaths.length; idx++) {
                  budget.checkCpu();
                  context.signal.throwIfAborted();
                  const formatted = globPaths ? globPaths[idx]! : formatImageSequence(filePath, idx)!;
                  const resolved = resolvePath(context.cwd, formatted);
                  let imgBytes: Uint8Array;
                  try {
                    imgBytes = await readInput(resolved);
                  } catch (error) {
                    rethrowRuntimeError(context, error);
                    if ((error as { code?: string }).code !== "ENOENT") throw error;
                    if (globPaths) throw error;
                    if (frames.length === 0 && idx - startNumber < startNumberRange - 1) continue;
                    break;
                  }
                  {
                    const decoded = decodeImage(imgBytes);
                    detachBytesBuffer(imgBytes);
                    if (decoded.width * decoded.height >= 16384) {
                      const gc = (globalThis as { gc?: () => void }).gc;
                      if (typeof gc === "function") { gc(); gc(); }
                    }
                    budget.recordFrame(decoded.width, decoded.height);
                    frames.push({
                      width: decoded.width,
                      height: decoded.height,
                      data: decoded.data,
                      ptsSeconds: frames.length / fps,
                      durationSeconds: 1 / fps,
                      keyframe: true
                    });
                  }
                }
                if (frames.length === 0) {
                  throw new Error(`${filePath}: No matching image sequence files found`);
                }
                const first = frames[0]!;
                const synthBytes = (await yieldTurn(context.signal), context.signal?.throwIfAborted(), createSyntheticMp4({
                  width: 16,
                  height: 16,
                  fps,
                  frameCount: 1,
                  includeAudio: false
                }));
                const base = parseMp4(synthBytes);
                detachBytesBuffer(synthBytes);
                return {
                  ...base,
                  duration: Math.round(frames.length / fps * base.timescale),
                  durationSeconds: frames.length / fps,
                  tracks: base.tracks.map((t) =>
                    t.type === "video" ? { ...t, width: first.width, height: first.height, duration: Math.round(frames.length / fps * t.timescale), samples: [], decodedVideoFrames: frames } : t
                  )
                };
              }

              const rawBytes = await readInput(filePath);

              const concatSignature = "ffconcat version 1.0";
              if (explicitFormat === "concat" || (explicitFormat === undefined &&
                new TextDecoder("utf-8", { ignoreBOM: true }).decode(rawBytes.subarray(0, concatSignature.length)) === concatSignature)) {
                const listText = new TextDecoder().decode(rawBytes);
                const listDir = filePath === "-" ? context.cwd : dirnameOf(resolvePath(context.cwd, filePath));
                const concatDocs: MediaDocument[] = [];
                const startTimesSeconds: number[] = [];
                let nextStartSeconds = 0;
                const segments: { path: string; inpoint: number | undefined; outpoint: number | undefined; duration: number | undefined }[] = [];
                let currentInpoint: number | undefined;
                let currentOutpoint: number | undefined;
                let currentDuration: number | undefined;

                const lines = listText.split(/\r?\n/);
                for (let l = 0; l < lines.length; l++) {
                  const line = lines[l]!.trimStart();
                  if (!line || line.startsWith("#")) continue;
                  const keyword = line.split(/[ \t]/, 1)[0]!;
                  if (keyword === "option" && input?.safe !== false) {
                    throw new Error(`Line ${l + 1}: option not allowed if safe`);
                  }
                  if (keyword === "ffconcat") {
                    const [, declaration, version] = line.split("\t").join(" ").split(" ").filter(Boolean);
                    if (declaration !== "version" || version !== "1.0") {
                      throw new Error(`Line ${l + 1}: invalid version`);
                    }
                    continue;
                  }
                  if (segments.length === 0) {
                    const directive = ["duration", "inpoint", "outpoint"].find(name =>
                      line === name || line.startsWith(`${name} `) || line.startsWith(`${name}\t`)
                    );
                    if (directive) throw new Error(`Line ${l + 1}: ${directive} without file`);
                  }
                  if (keyword === "file") {
                    // Match av_get_token: only single quotes group text; a
                    // backslash escapes the next character outside quotes.
                    let target = "";
                    let protectedEnd = 0;
                    let cursor = keyword.length;
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
                    if (input?.safe !== false && target.split("/").some(component =>
                      !component || component.startsWith(".") || Array.from(component).some(char =>
                        !(char >= "a" && char <= "z") && !(char >= "A" && char <= "Z") &&
                        !(char >= "0" && char <= "9") && char !== "_" && char !== "-" && char !== "."
                      )
                    )) {
                      throw new Error(`Unsafe file name '${target}'`);
                    }
                    const resolvedItem = resolvePath(listDir, target);
                    // Look ahead for inpoint/outpoint/duration directives following this `file`
                    currentInpoint = undefined;
                    currentOutpoint = undefined;
                    currentDuration = undefined;
                    while (l + 1 < lines.length) {
                      const nextLine = lines[l + 1]!.trim();
                      if (!nextLine || nextLine.startsWith("#")) {
                        l++;
                      } else if (["inpoint", "outpoint", "duration"].includes(nextLine.split(/[ \t]/, 1)[0]!)) {
                        const directive = nextLine.split(/[ \t]/, 1)[0]!;
                        const value = nextLine.slice(directive.length).trim();
                        // FFmpeg durations are decimal seconds (optionally s/ms/us)
                        // or signed [hours:]minutes:seconds, with no trailing text.
                        if (!/^-?(?:(?:\d+(?:\.\d*)?|\.\d+)(?:s|ms|us)?|(?:\d+:)?[0-5]?\d:[0-5]?\d(?:\.\d*)?)$/.test(value)) {
                          throw new Error(`Line ${l + 2}: invalid ${directive} '${value}'`);
                        }
                        const seconds = value.startsWith("-")
                          ? -parseFfmpegTimestamp(value.slice(1))
                          : parseFfmpegTimestamp(value);
                        if (!Number.isFinite(seconds) || Math.abs(seconds) >= 2 ** 63 / 1_000_000) {
                          throw new Error(`Line ${l + 2}: invalid ${directive} '${value}'`);
                        }
                        if (directive === "inpoint") currentInpoint = seconds;
                        else if (directive === "outpoint") currentOutpoint = seconds;
                        else currentDuration = seconds;
                        l++;
                      } else {
                        break;
                      }
                    }
                    if (currentInpoint !== undefined && currentOutpoint !== undefined && currentOutpoint < currentInpoint) {
                      throw new Error(`${resolvedItem}: outpoint must not precede inpoint`);
                    }
                    segments.push({ path: resolvedItem, inpoint: currentInpoint, outpoint: currentOutpoint, duration: currentDuration });
                  } else {
                    throw new Error(`Line ${l + 1}: unknown keyword '${keyword}'`);
                  }
                }
                budget.checkConcatInputs(segments.length);
                for (const segment of segments) {
                  let itemDoc: MediaDocument;
                  try {
                    itemDoc = await loadSingleDocument(segment.path);
                  } catch (error) {
                    rethrowRuntimeError(context, error);
                    if ((error as { code?: string }).code !== "ENOENT" ||
                      !concatDocs.some(doc => doc.tracks.some(track => track.samples.length > 0))) throw error;
                    await writeBytes(context.stderr, encodeUtf8(`ffmpeg: Impossible to open '${segment.path}': No such file or directory\n`), context.signal);
                    inputReadFailed = true;
                    break;
                  }
                  let sliceEnd = segment.outpoint;
                  const wavTrack = itemDoc.containerFormat === "wav" ? itemDoc.tracks[0] : undefined;
                  const packetFrames = wavTrack?.samples[0]?.duration;
                  if (sliceEnd !== undefined && wavTrack && packetFrames) {
                    // WAV seeking starts a new packet at the inpoint. Concat keeps
                    // the whole packet whose DTS precedes the outpoint.
                    const start = Math.max(0, segment.inpoint ?? 0);
                    const packets = Math.ceil(Math.max(0, sliceEnd - start) * wavTrack.timescale / packetFrames);
                    sliceEnd = start + packets * packetFrames / wavTrack.timescale;
                  }
                  if (
                    segment.inpoint !== undefined ||
                    segment.outpoint !== undefined
                  ) {
                    itemDoc = sliceMp4(itemDoc, {
                      startSeconds: segment.inpoint,
                      endSeconds: sliceEnd
                    });
                  }
                  startTimesSeconds.push(nextStartSeconds);
                  nextStartSeconds += segment.duration ?? itemDoc.durationSeconds;
                  concatDocs.push(itemDoc);
                }
                return concatMp4(concatDocs, { startTimesSeconds, limits: options.limits, budget });
              }

              const plugin = explicitFormat !== undefined
                ? registry.findByFormatName(explicitFormat)
                : registry.detect(rawBytes, filePath);
              if (!plugin || !plugin.canDemux) {
                throw new Error(
                  explicitFormat
                    ? `Unknown input format: '${explicitFormat}' (AST not registered)`
                    : `${filePath}: Unsupported input format (AST not registered)`
                );
              }

              const resolveResource = await loadManifestResources(plugin, rawBytes, filePath, context.cwd, readInput, budget, input?.allowedExtensions);
              return plugin.parse(rawBytes, {
                decodeAudio: (plugin.id !== "flac" && plugin.id !== "ogg") || audioCodec !== "copy",
                resolveResource,
                sampleRate: input?.sampleRate,
                channels: input?.channels,
                filename: filePath,
                limits: options.limits,
                budget
              });
            };

            // Load all inputs and apply per-input slicing / looping
            const loadedDocs: MediaDocument[] = [];
            let demuxExitCode = 0;
            for (const inp of inputs) {
              await yieldTurn(context.signal);
              context.signal.throwIfAborted();
              let doc = await loadSingleDocument(inp.path, inp.format, inp.fps, inp);
              if (doc.containerFormat === "dash") {
                // FFmpeg subtracts one input start time, including AAC priming,
                // from every representation before copying its packets.
                const offsets = doc.tracks.map(track => {
                  let offset = 0;
                  for (const edit of track.editList ?? []) {
                    if (edit.mediaTime < 0) offset += edit.segmentDuration / doc.timescale;
                    else { offset -= edit.mediaTime / track.timescale; break; }
                  }
                  return offset;
                });
                // The native DASH demuxer schedules by the previous packet PTS
                // and returns EOF when the next scheduled representation ends.
                const positions = doc.tracks.map(() => 0);
                const timestamps = doc.tracks.map(() => 0);
                for (;;) {
                  budget.checkCpu();
                  let index = 0;
                  for (let i = 1; i < timestamps.length; i++) {
                    if (timestamps[i]! < timestamps[index]!) index = i;
                  }
                  const track = doc.tracks[index]!;
                  const sample = track.samples[positions[index]!];
                  if (!sample) break;
                  positions[index]!++;
                  timestamps[index] = Math.round((sample.pts / track.timescale + offsets[index]!) * 90000);
                }
                const start = Math.min(...doc.tracks.map((track, index) =>
                  (track.samples[0]?.pts ?? 0) / track.timescale + offsets[index]!));
                const tracks = doc.tracks.map((track, index) => {
                  const firstDts = track.samples[0]?.dts ?? 0;
                  const delay = Math.round(firstDts + (offsets[index]! - start) * track.timescale);
                  const samples = track.samples.slice(0, positions[index]);
                  const lastSample = samples[samples.length - 1];
                  const mediaDuration = lastSample ? lastSample.dts + lastSample.duration - firstDts : 0;
                  // MP4's default movie clock is milliseconds; empty edits round
                  // down after timestamps have been rounded to the track clock.
                  const emptyDuration = Math.max(0, Math.floor(delay * 1000 / track.timescale));
                  return { ...track,
                    samples: samples.map(sample => ({ ...sample, dts: sample.dts - firstDts, pts: sample.pts - firstDts })),
                    duration: mediaDuration + Math.round(emptyDuration * track.timescale / 1000),
                    editList: [
                      ...(emptyDuration ? [{ segmentDuration: emptyDuration, mediaTime: -1, mediaRateInteger: 1, mediaRateFraction: 0 }] : []),
                      { segmentDuration: Math.round(mediaDuration * 1000 / track.timescale), mediaTime: Math.max(0, -delay), mediaRateInteger: 1, mediaRateFraction: 0 }
                    ]
                  };
                });
                doc = { ...doc, timescale: 1000, duration: Math.round(doc.durationSeconds * 1000), tracks };
              }
              if (exitOnError) {
                for (const track of doc.tracks) {
                  if (!track.demuxError) continue;
                  await writeBytes(context.stderr, encodeUtf8(`ffmpeg: ${track.demuxError.message}\n`), context.signal);
                  demuxExitCode = 183;
                  const end = track.demuxError.timestamp;
                  doc = { ...doc, tracks: doc.tracks.map(candidate => candidate !== track ? candidate : {
                    ...track, duration: end, decodeErrors: undefined,
                    samples: track.samples.filter(sample => sample.dts < end),
                    ...(track.decodedAudio ? { decodedAudio: { ...track.decodedAudio,
                      channelData: track.decodedAudio.channelData.map(channel => channel.slice(0, end))
                    } } : {})
                  }) };
                }
              }
              if (inp.imageLoop) {
                const fps = inp.fps ?? 25;
                const endSeconds = Math.min(
                  inp.durationSeconds !== undefined ? (inp.startSeconds ?? 0) + inp.durationSeconds : inp.endSeconds ?? Infinity,
                  (inp.startSeconds ?? 0) + (outputDuration !== undefined ? (outputSs ?? 0) + outputDuration : outputTo ?? Infinity),
                  maxVideoFrames !== undefined ? (inp.startSeconds ?? 0) + (outputSs ?? 0) + maxVideoFrames / (outputFps ?? fps) : Infinity
                );
                if (!Number.isFinite(endSeconds)) {
                  throw new Error("-loop 1 requires a finite frame count or duration");
                }
                budget.checkDuration(endSeconds);
                const frameCount = Math.max(0, Math.ceil(endSeconds * fps));
                doc = {
                  ...doc,
                  duration: Math.round(frameCount / fps * doc.timescale),
                  durationSeconds: frameCount / fps,
                  tracks: await mapWork(doc.tracks, async track => {
                    if (track.type !== "video") return track;
                    const source = track.decodedVideoFrames;
                    if (!source?.length) throw new Error("-loop requires decoded image input");
                    const frames: MediaVideoFrame[] = [];
                    for (let index = 0; index < frameCount; index++) {
                      if (index % 64 === 0) await yieldTurn(context.signal);
                      context.signal.throwIfAborted();
                      const frame = source[index % source.length]!;
                      budget.recordFrame(frame.width, frame.height);
                      frames.push({ ...frame, ptsSeconds: index / fps, durationSeconds: 1 / fps });
                    }
                    return { ...track, duration: Math.round(frameCount / fps * track.timescale), samples: [], decodedVideoFrames: frames };
                  }, context.signal)
                };
              }
              if (inp.fixSubDuration && subtitleCodec !== "copy") doc = fixSubtitleDurations(doc);
              const startSeconds = inp.startSeconds ?? (inp.endRelativeSeconds === undefined
                ? undefined : Math.max(0, doc.durationSeconds + inp.endRelativeSeconds));
              if (
                startSeconds !== undefined ||
                inp.endSeconds !== undefined ||
                inp.durationSeconds !== undefined
              ) {
                doc = sliceMp4(doc, {
                  startSeconds,
                  endSeconds: inp.endSeconds,
                  durationSeconds: inp.durationSeconds
                });
              }
              if (inp.streamLoop === -1) {
                doc = loopToOutputEnd(doc, outputDuration === undefined ? outputTo : (outputSs ?? 0) + outputDuration, budget);
              } else if (inp.streamLoop && inp.streamLoop > 0) {
                const copies = Array.from({ length: inp.streamLoop + 1 }, () => doc);
                doc = concatMp4(copies, { limits: options.limits, budget });
              }
              loadedDocs.push(doc);
            }

            // Resolve output AST plugin from `outputFormat` or `outputTarget` filename
            const outPlugin = outputFormat
              ? (registry.findById(outputFormat) ?? registry.findByFormatName(outputFormat))
              : registry.findByFilename(outputTarget);
            // Combine inputs according to `-filter_complex`, `-map`, or default mux
            let workingDoc: MediaDocument;
            if (filterComplex) {
              if (features.filterGraph === false) {
                throw new Error("Filtergraph processing is disabled by consumer feature configuration");
              }
              if (filterComplex.includes("concat=")) {
                workingDoc = concatMp4(loadedDocs, { limits: options.limits, budget });
                if (/concat=[^;[]*\ba=0\b/.test(filterComplex)) {
                  workingDoc = {
                    ...workingDoc,
                    tracks: workingDoc.tracks.filter((t) => t.type !== "audio")
                  };
                }
                if (/concat=[^;[]*\bv=0\b/.test(filterComplex)) {
                  workingDoc = {
                    ...workingDoc,
                    tracks: workingDoc.tracks.filter((t) => t.type !== "video")
                  };
                }
              } else if (filterComplex.includes("xfade") && loadedDocs.length >= 2) {
                const track0 = loadedDocs[0]!.tracks.find((t) => t.type === "video")!;
                const track1 = loadedDocs[1]!.tracks.find((t) => t.type === "video")!;
                const f0 = await ensureDecodedFrames(
                  track0,
                  loadedDocs[0]!.timescale, budget
                , context.signal);
                const f1 = await ensureDecodedFrames(
                  track1,
                  loadedDocs[1]!.timescale, budget
                , context.signal);
                if (f0[0] && f1[0]) {
                  if (f0[0].width !== f1[0].width || f0[0].height !== f1[0].height) {
                    throw new Error(`xfade input size ${f0[0].width}x${f0[0].height} does not match ${f1[0].width}x${f1[0].height}`);
                  }
                  // Lavfi's timebase is its frame interval, not the synthetic MP4 timescale.
                  const timebase0 = inputs[0]!.format === "lavfi" ? f0[0].durationSeconds : 1 / track0.timescale;
                  const timebase1 = inputs[1]!.format === "lavfi" ? f1[0].durationSeconds : 1 / track1.timescale;
                  if (timebase0 !== timebase1) {
                    throw new Error(`xfade input timebase ${timebase0} does not match ${timebase1}`);
                  }
                }
                const xfadeSpec = filterComplex.slice(filterComplex.indexOf("xfade") + "xfade".length)
                  .split("[")[0]!.split(",")[0]!.split(";")[0]!.trim();
                const positional = (xfadeSpec.startsWith("=") ? xfadeSpec.slice(1) : "").split(":");
                const named: Record<string, string> = {};
                for (const part of positional) {
                  const eqIdx = part.indexOf("=");
                  if (eqIdx >= 0) named[part.slice(0, eqIdx).trim()] = part.slice(eqIdx + 1).trim();
                }
                const transition = named.transition ?? (positional[0]!.includes("=") ? "fade" : positional[0] || "fade");
                if (transition !== "fade" && transition !== "wipeleft") {
                  throw new Error(`Unsupported xfade transition: ${transition}`);
                }
                const fadeDur = parseFloat(named.duration ?? "0.5") || 0.5;
                const fps = f0[0]?.durationSeconds ? Math.round(1 / f0[0].durationSeconds) : 25;
                const overlapFrames = Math.max(1, Math.min(f0.length, f1.length, Math.round(fadeDur * fps)));
                const offsetSec = named.offset !== undefined ? parseFloat(named.offset) : Math.max(0, (f0.length - overlapFrames) / fps);
                const preCount = Math.max(0, Math.min(f0.length - overlapFrames, Math.round(offsetSec * fps)));
                const outFrames: MediaVideoFrame[] = [];
                let cursor = 0;
                for (let i = 0; i < preCount; i++) {
                  const f = f0[i]!;
                  outFrames.push({ ...f, ptsSeconds: cursor });
                  cursor += f.durationSeconds;
                }
                for (let k = 0; k < overlapFrames; k++) {
                  const a = f0[Math.min(f0.length - 1, preCount + k)]!;
                  const b = f1[Math.min(f1.length - 1, k)]!;
                  const progress = k / (fadeDur * fps);
                  const blended = new Uint8Array(a.data.byteLength);
                  for (let pIdx = 0; pIdx < blended.byteLength; pIdx += 4) {
                    const alpha = transition === "wipeleft"
                      ? ((pIdx / 4) % a.width > Math.floor(a.width * (1 - progress)) ? 1 : 0)
                      : progress;
                    blended[pIdx] = Math.round(a.data[pIdx]! * (1 - alpha) + b.data[pIdx]! * alpha);
                    blended[pIdx + 1] = Math.round(a.data[pIdx + 1]! * (1 - alpha) + b.data[pIdx + 1]! * alpha);
                    blended[pIdx + 2] = Math.round(a.data[pIdx + 2]! * (1 - alpha) + b.data[pIdx + 2]! * alpha);
                    blended[pIdx + 3] = 255;
                  }
                  outFrames.push({
                    width: a.width,
                    height: a.height,
                    data: blended,
                    ptsSeconds: cursor,
                    durationSeconds: a.durationSeconds,
                    keyframe: true
                  });
                  cursor += a.durationSeconds;
                }
                for (let j = overlapFrames; j < f1.length; j++) {
                  const b = f1[j]!;
                  outFrames.push({ ...b, ptsSeconds: cursor });
                  cursor += b.durationSeconds;
                }
                workingDoc = {
                  ...loadedDocs[0]!,
                  durationSeconds: cursor,
                  tracks: loadedDocs[0]!.tracks.map((t) =>
                    t.type === "video" ? { ...t, samples: [], decodedVideoFrames: outFrames } : t
                  )
                };
              } else if ((filterComplex.includes("vstack") || filterComplex.includes("hstack")) && loadedDocs.length >= 2) {
                const f0 = await ensureDecodedFrames(
                  loadedDocs[0]!.tracks.find((t) => t.type === "video")!,
                  loadedDocs[0]!.timescale, budget
                , context.signal);
                const f1 = await ensureDecodedFrames(
                  loadedDocs[1]!.tracks.find((t) => t.type === "video")!,
                  loadedDocs[1]!.timescale, budget
                , context.signal);
                const vertical = filterComplex.includes("vstack");
                const filter = vertical ? "vstack" : "hstack";
                const spec = filterComplex.slice(filterComplex.indexOf(filter) + filter.length)
                  .split("[")[0]!.split(",")[0]!.split(";")[0]!.trim();
                const options = (spec.startsWith("=") ? spec.slice(1) : "").split(":");
                const shortestOption = options.find((option) => option.trim().startsWith("shortest="))
                  ?.split("=")[1]?.trim() ?? options[1]?.trim();
                const stopAtShortest = ["1", "true", "yes", "on"].includes(shortestOption ?? "0");
                const count = stopAtShortest || !f0.length || !f1.length
                  ? Math.min(f0.length, f1.length) : Math.max(f0.length, f1.length);
                const stacked: MediaVideoFrame[] = [];
                for (let i = 0; i < count; i++) {
                  const a = f0[Math.min(i, f0.length - 1)]!;
                  const b = f1[Math.min(i, f1.length - 1)]!;
                  const timing = f0[i] ?? f1[i]!;
                  const axis = vertical ? "width" : "height";
                  if (a[axis] !== b[axis]) {
                    throw new Error(`Input 1 ${axis} ${b[axis]} does not match input 0 ${axis} ${a[axis]}`);
                  }
                  const w = vertical ? a.width : a.width + b.width;
                  const h = vertical ? a.height + b.height : a.height;
                  const outData = new Uint8Array(w * h * 4);
                  for (let y = 0; y < a.height; y++) {
                    outData.set(a.data.subarray(y * a.width * 4, (y + 1) * a.width * 4), y * w * 4);
                  }
                  for (let y = 0; y < b.height; y++) {
                    outData.set(b.data.subarray(y * b.width * 4, (y + 1) * b.width * 4), (vertical ? (a.height + y) * w : y * w + a.width) * 4);
                  }
                  stacked.push({
                    width: w,
                    height: h,
                    data: outData,
                    ptsSeconds: timing.ptsSeconds,
                    durationSeconds: timing.durationSeconds,
                    keyframe: true
                  });
                }
                workingDoc = {
                  ...loadedDocs[0]!,
                  tracks: loadedDocs[0]!.tracks.map((t) =>
                    t.type === "video"
                      ? {
                          ...t,
                          width: stacked[0]?.width ?? t.width,
                          height: stacked[0]?.height ?? t.height,
                          samples: [],
                          decodedVideoFrames: stacked
                        }
                      : t
                  )
                };
              } else if (filterComplex.includes("overlay") && loadedDocs.length >= 2) {
                const f0 = await ensureDecodedFrames(
                  loadedDocs[0]!.tracks.find((t) => t.type === "video")!,
                  loadedDocs[0]!.timescale, budget
                , context.signal);
                const f1 = await ensureDecodedFrames(
                  loadedDocs[1]!.tracks.find((t) => t.type === "video")!,
                  loadedDocs[1]!.timescale, budget
                , context.signal);
                const overlaySpec = filterComplex.slice(filterComplex.indexOf("overlay") + "overlay".length)
                  .split("[")[0]!.split(",")[0]!.split(";")[0]!.trim();
                const positional = (overlaySpec.startsWith("=") ? overlaySpec.slice(1) : "").split(":");
                const named: Record<string, string> = {};
                for (const part of positional) {
                  const eqIdx = part.indexOf("=");
                  if (eqIdx >= 0) named[part.slice(0, eqIdx).trim()] = part.slice(eqIdx + 1).trim();
                }
                const xExpression = named.x ?? (positional[0] && !positional[0].includes("=") ? positional[0] : "0");
                const yExpression = named.y ?? (positional[1] && !positional[1].includes("=") ? positional[1] : "0");
                const format = named.format ?? "yuv420";
                const horizontalGrid = format.startsWith("yuv420") || format.startsWith("yuv422") ? 2 : 1;
                const verticalGrid = format.startsWith("yuv420") ? 2 : 1;
                const overlaid: MediaVideoFrame[] = f0.map((a, idx) => {
                  const b = f1[Math.min(idx, f1.length - 1)];
                  if (!b) return a;
                  const variables = {
                    main_w: a.width, main_h: a.height, overlay_w: b.width, overlay_h: b.height,
                    W: a.width, H: a.height, w: b.width, h: b.height
                  };
                  // FFmpeg rounds integer positions down to the output chroma grid, including negatives.
                  const ox = Math.floor(Math.trunc(parseFilterExpression(xExpression, "overlay", variables)) / horizontalGrid) * horizontalGrid;
                  const oy = Math.floor(Math.trunc(parseFilterExpression(yExpression, "overlay", variables)) / verticalGrid) * verticalGrid;
                  const outData = new Uint8Array(a.data);
                  for (let y = 0; y < b.height && oy + y < a.height; y++) {
                    if (oy + y < 0) continue;
                    for (let x = 0; x < b.width && ox + x < a.width; x++) {
                      if (ox + x < 0) continue;
                      const srcOff = (y * b.width + x) * 4;
                      const dstOff = ((oy + y) * a.width + (ox + x)) * 4;
                      const alpha = b.data[srcOff + 3]!;
                      if (alpha === 0) continue;
                      for (let channel = 0; channel < 3; channel++) {
                        outData[dstOff + channel] = Math.round(
                          (b.data[srcOff + channel]! * alpha + outData[dstOff + channel]! * (255 - alpha)) / 255
                        );
                      }
                      outData[dstOff + 3] = 255;
                    }
                  }
                  return { ...a, data: outData };
                });
                workingDoc = {
                  ...loadedDocs[0]!,
                  tracks: loadedDocs[0]!.tracks.map((t) =>
                    t.type === "video" ? { ...t, samples: [], decodedVideoFrames: overlaid } : t
                  )
                };
              } else {
                const audioGraph = loadedDocs.every(doc => doc.tracks.every(track => track.type === "audio")) ||
                  loadedDocs.some((_, index) => filterComplex?.includes(`[${index}:a`));
                if (audioGraph) {
                  if (afFilters.length) throw new Error("Cannot combine simple and complex audio filters");
                  const outputs = await resolveAudioGraph(filterComplex, loadedDocs, maps, mappedAudioLabels, budget, context.signal);
                  workingDoc = await muxMp4Cooperatively(
                    [{ ...loadedDocs[0]!, tracks: outputs.map(output => output.track) }],
                    { stripAudio, stripVideo, stripSubtitles, shortest, rotation }, context.signal);
                  afFilters.push(...outputs.map((output, ordinal) => ({ ordinal, expression: output.expression })));
                } else {
                  workingDoc = await muxMp4Cooperatively(loadedDocs, { shortest }, context.signal);
                  const cleanedComplex = filterComplex.replace(/\[[^\]]+\]/g, "").trim();
                  if (cleanedComplex) vfFilters.push(cleanedComplex);
                }
              }
            } else if (maps.length > 0) {
              let selectedTracks: { input: number; track: MediaTrack | MediaAttachment }[] = [];
              let mapped = false;
              for (const map of maps) {
                const exclude = map.startsWith("-");
                let clean = exclude ? map.slice(1) : map;
                const optional = clean.endsWith("?");
                if (optional) clean = clean.slice(0, -1);
                if (clean.startsWith("[")) continue;
                const [input, ...specifier] = clean.split(":");
                const selector = specifier[0];
                const inputIdx = Number(input);
                const srcDoc = loadedDocs[inputIdx];
                if (!srcDoc) {
                  await writeBytes(context.stderr, encodeUtf8(`ffmpeg: Invalid input file index: ${inputIdx}.\n`), context.signal);
                  return { exitCode: 234 };
                }
                const type = selector === "v" ? "video" : selector === "a" ? "audio" : selector === "s" ? "subtitle" : undefined;
                let matches: readonly (MediaTrack | MediaAttachment)[] = type ? srcDoc.tracks.filter(t => t.type === type)
                  : selector === "t" ? srcDoc.attachments ?? [] : [...srcDoc.tracks, ...srcDoc.attachments ?? []];
                const streamSpecifier = type || selector === "t" ? specifier.slice(1) : specifier;
                const [index, key, ...valueParts] = streamSpecifier;
                if (index?.startsWith("#")) {
                  matches = matches.filter(track => "id" in track && track.id === Number(index.slice(1)));
                } else if (index === "m") {
                  const value = valueParts.length ? valueParts.join(":") : undefined;
                  matches = matches.filter(track => "samples" in track && key === "language" &&
                    (value === undefined || track.language === value));
                } else if (index !== undefined) {
                  matches = matches.filter((_, i) => i === Number(index));
                }
                if ((matches.length === 0 || (exclude && !mapped)) && !optional) {
                  await writeBytes(context.stderr, encodeUtf8(`ffmpeg: Stream map '${clean}' matches no streams.\nTo ignore this, add a trailing '?' to the map.\n`), context.signal);
                  return { exitCode: 234 };
                }
                if (exclude) {
                  selectedTracks = selectedTracks.filter(entry => entry.input !== inputIdx || !matches.includes(entry.track));
                } else {
                  mapped ||= matches.length > 0;
                  selectedTracks.push(...matches.map(track => ({ input: inputIdx, track })));
                }
              }
              const streams = selectedTracks.map(entry => entry.track);
              const filteredTracks = streams.filter((stream): stream is MediaTrack => "samples" in stream);
              const attachments = streams.filter((stream): stream is MediaAttachment => !("samples" in stream));
              if (!mapped) {
                // Ignored optional maps leave automatic video/audio selection enabled.
                const tracks = selectAutomaticAudio(loadedDocs).flatMap(doc => doc.tracks);
                for (const type of ["video", "audio"] as const) {
                  const track = tracks.find(track => track.type === type);
                  if (track) filteredTracks.push(track);
                }
              }

              workingDoc = await muxMp4Cooperatively(
                [{ ...loadedDocs[0]!, tracks: filteredTracks, attachments }],
                { stripAudio, stripVideo, stripSubtitles, shortest, rotation }
              , context.signal);
            } else {
              // Explicit maps retain their requested streams.
              if (subtitleCodec === undefined && (outPlugin?.id === "mp4" || outPlugin?.id === "mov")) stripSubtitles = true;
              workingDoc = await muxMp4Cooperatively(selectAutomaticAudio(loadedDocs), {
                stripAudio,
                stripVideo,
                stripSubtitles,
                shortest,
                rotation
              }, context.signal);
            }

            if (workingDoc.tracks.length === 0 && !workingDoc.attachments?.length && outPlugin?.id !== "ffmetadata") {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: Output file does not contain any stream.\n"), context.signal);
              return { exitCode: 234 };
            }
            validateAudioEncoder(audioCodec, workingDoc, astPlugins);
            if (subtitleCodec !== "copy") workingDoc = transcodeSubtitles(workingDoc,
              outPlugin?.id);

            const audioTrackCount = workingDoc.tracks.filter(track => track.type === "audio").length;
            if (audioCodec === "copy" && audioTrackCount > 0 && afFilters.some(filter => filter.ordinal === undefined || filter.ordinal < audioTrackCount)) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: Filtering and streamcopy cannot be used together for audio.\n"), context.signal);
              return { exitCode: 218 };
            }

            // Apply output-level time slicing (`-ss`, `-to`, `-t`)
            if (
              outputSs !== undefined ||
              outputTo !== undefined ||
              outputDuration !== undefined
            ) {
              workingDoc = sliceMp4(workingDoc, {
                startSeconds: outputSs,
                endSeconds: outputDuration === undefined ? outputTo : undefined,
                durationSeconds: outputDuration
              });
            }

            // Apply `-s <WxH>` or `-r <fps>` as video filter operations when transcoding
            if (outputSize && videoCodec !== "copy") {
              const [w, h] = outputSize.toLowerCase().split("x");
              if (w && h) vfFilters.push(`scale=${w}:${h}`);
            }
            if (outputFps && videoCodec !== "copy") {
              vfFilters.push(`fps=${outputFps}`);
            }

            const imageOutput = (outputFormat ? (registry.findById(outputFormat) ?? registry.findByFormatName(outputFormat)) : registry.findByFilename(outputTarget))?.id === "image2";
            // Output frame counts refer to displayed pictures, never encoded packets.
            if ((imageOutput || maxVideoFrames !== undefined) && videoCodec !== "copy") {
              workingDoc = {
                ...workingDoc,
                tracks: await mapWork(workingDoc.tracks, async track => {
                  if (track.type !== "video") return track;
                  const limit = vfFilters.length === 0 ? maxVideoFrames : undefined;
                  const frames = await ensureDecodedFrames(track, workingDoc.timescale, budget, context.signal, limit);
                  return { ...track, samples: [], decodedVideoFrames: frames };
                }, context.signal)
              };
            }

            // Apply video filters (`-vf`)
            if (vfFilters.length > 0) {
              if (features.videoTranscode === false || features.filterGraph === false) {
                throw new Error("Video transcoding / filtergraph is disabled by consumer feature configuration");
              }
              const combinedChain = vfFilters.join(",");
              let loadedSubtitleCues: { startSec: number; endSec: number; text: string }[] | undefined;
              const subMatch = /subtitles=(?:filename=)?['"]?([^:'",]+)['"]?/.exec(combinedChain);
              if (subMatch?.[1]) {
                const subPath = resolvePath(context.cwd, subMatch[1]);
                const subBytes = await readInput(subPath);
                const subFmt = subPath.toLowerCase().endsWith(".vtt") ? "webvtt" : "srt";
                const subDoc = parseSubtitleDocument(subBytes, subFmt);
                const st = subDoc.tracks.find((t) => t.type === "subtitle");
                if (st) {
                  const sts = st.timescale || 1000;
                  loadedSubtitleCues = st.samples.map((s) => ({
                    startSec: s.pts / sts,
                    endSec: (s.pts + s.duration) / sts,
                    text: decodeUtf8(s.data).trim()
                  }));
                }
              }
              workingDoc = {
                ...workingDoc,
                tracks: await mapWork(workingDoc.tracks, async (t) => {


                  if (t.type !== "video") return t;
                  let presentationOffset = 0;
                  for (const edit of t.editList ?? []) {
                    if (edit.mediaTime < 0) presentationOffset -= edit.segmentDuration / workingDoc.timescale;
                    else { presentationOffset += edit.mediaTime / t.timescale; break; }
                  }
                  const offsetTicks = Math.round(presentationOffset * t.timescale);
                  const decoded = await ensureDecodedFrames(t, workingDoc.timescale, budget, context.signal);
                  // Filters use the displayed timeline; retain media coordinates for the existing edit list.
                  const displayed = decoded.map(frame => ({ ...frame, ptsSeconds: (Math.round(frame.ptsSeconds * t.timescale) - offsetTicks) / t.timescale }));
                  const filtered = await applyVideoFilterChain(displayed, combinedChain, budget, loadedSubtitleCues, context.signal);
                  const first = filtered[0];
                  return {
                    ...t,
                    width: first?.width ?? t.width,
                    height: first?.height ?? t.height,
                    samples: [],
                    decodedVideoFrames: filtered.map(frame => ({ ...frame, ptsSeconds: (Math.round(frame.ptsSeconds * t.timescale) + offsetTicks) / t.timescale }))
                  };
                }, context.signal)
              };
            }

            // Apply `-frames:v <N>` limit
            if (maxVideoFrames !== undefined && !outputTarget.includes("%")) {
              workingDoc = {
                ...workingDoc,
                tracks: workingDoc.tracks.map((t) => {
                  if (t.type !== "video") return t;
                  if (t.decodedVideoFrames && t.decodedVideoFrames.length > maxVideoFrames!) {
                    return {
                      ...t,
                      samples: [],
                      decodedVideoFrames: t.decodedVideoFrames.slice(0, maxVideoFrames)
                    };
                  }
                  if (t.samples.length > maxVideoFrames!) {
                    const slicedSamples = t.samples.slice(0, maxVideoFrames);
                    const dur = slicedSamples.reduce((acc, s) => acc + s.duration, 0);
                    return {
                      ...t,
                      duration: dur,
                      samples: slicedSamples
                    };
                  }
                  return t;
                })
              };
            }

            if (audioCodec === "copy" && maxAudioFrames !== undefined) {
              workingDoc = limitAudioCopyPackets(workingDoc, maxAudioFrames);
            }

            // Apply -ar (audioRate), -ac (audioChannels), and -af audio filters when transcoding audio
            if ((audioRate !== undefined || audioChannels !== undefined || afFilters.length > 0) && audioCodec !== "copy") {
              let audioOrdinal = 0;
              workingDoc = {
                ...workingDoc,
                tracks: await mapWork(workingDoc.tracks, async (t) => {
      let work = 0;

                  if (t.type !== "audio") return t;
                  const ordinal = audioOrdinal++;
                  const filter = afFilters.filter(filter => filter.ordinal === undefined || filter.ordinal === ordinal).at(-1);
                  if (audioRate === undefined && audioChannels === undefined && !filter) return t;
                  const audio = t.decodedAudio ?? (t.codecDescriptions[0]?.codecName === "aac"
                    ? decodeAacTrack(workingDoc, t) : undefined);
                  if (!audio) throw new Error("Audio filtering requires decoded PCM audio");
                  const origRate = audio.sampleRate;
                  let filteredChannelMask = audio.channelMask;
                  const volFactor = t.volume ?? 1.0;
                  let stretched: typeof audio.channelData = audio.channelData;
                  let audioStartSample = 0;
                  let audioTimestamps: { start: number; end: number; pts: number }[] | undefined;
                  // astats normalizes integer PCM against its maximum positive value.
                  let statsScale = t.codecDescriptions[0]?.codecName === "pcm_s16le" ? 32768 / 32767
                    : t.codecDescriptions[0]?.codecName === "pcm_s32le" ? 2147483648 / 2147483647 : 1;
                  if (filter) {
                    for (const item of parseFilterChain(filter.expression)) {
                      if (++work % 1024 === 0) { await yieldTurn(context.signal); context.signal?.throwIfAborted(); }

                      let trimmed = item.trim();
                      const equals = trimmed.indexOf("=");
                      const instance = trimmed.indexOf("@");
                      if (instance >= 0 && (equals < 0 || instance < equals)) {
                        trimmed = trimmed.slice(0, instance) + (equals < 0 ? "" : trimmed.slice(equals));
                      }
                      if (trimmed === "anull") continue;
                      if (trimmed === "alimiter" || trimmed.startsWith("alimiter=")) {
                        stretched = await limitAudio(stretched, origRate, trimmed, budget, context.signal);
                        statsScale = 1;
                      } else if (trimmed === "speechnorm" || trimmed.startsWith("speechnorm=")) {
                        stretched = await normalizeSpeech(stretched, trimmed, budget, context.signal);
                        statsScale = 1;
                      } else if (trimmed === "acompressor" || trimmed.startsWith("acompressor=")) {
                        stretched = await compressAudio(stretched, origRate, trimmed, budget, context.signal);
                        statsScale = 1;
                      } else if (trimmed === "compand" || trimmed.startsWith("compand=")) {
                        stretched = await compandAudio(stretched, origRate, trimmed, budget, context.signal);
                      } else if (trimmed === "afade" || trimmed.startsWith("afade=")) {
                        stretched = await fadeAudio(stretched, origRate, trimmed, budget, context.signal);
                      } else if (trimmed === "dynaudnorm" || trimmed.startsWith("dynaudnorm=")) {
                        stretched = await normalizeAudio(stretched, origRate, trimmed, budget, context.signal);
                        statsScale = 1;
                      } else if (trimmed === "silencedetect" || trimmed.startsWith("silencedetect=")) {
                        let noise = 0.001;
                        let duration = 2;
                        let mono = false;
                        const argument = trimmed.slice("silencedetect=".length);
                        for (const [index, option] of (argument ? argument.split(":") : []).entries()) {
                          const separator = option.indexOf("=");
                          const key = separator < 0 ? ["noise", "duration", "mono"][index] : option.slice(0, separator);
                          const value = separator < 0 ? option : option.slice(separator + 1);
                          if (key === "noise" || key === "n") {
                            noise = value.endsWith("dB") ? 10 ** (Number(value.slice(0, -2)) / 20) : Number(value);
                            if (!value || !Number.isFinite(noise) || noise < 0) throw new Error("silencedetect: invalid noise");
                          } else if (key === "duration" || key === "d") {
                            duration = Number(value);
                            if (!value || !Number.isFinite(duration) || duration < 0 || duration > 86400) throw new Error("silencedetect: invalid duration");
                          } else if (key === "mono" || key === "m") {
                            if (!["0", "1", "true", "false", "yes", "no", "on", "off"].includes(value)) throw new Error("silencedetect: invalid mono");
                            mono = ["1", "true", "yes", "on"].includes(value);
                          } else throw new Error(`silencedetect: unsupported option ${key}`);
                        }
                        const channels = stretched.length;
                        const counts = new Array<number>(mono ? channels : 1).fill(0);
                        const starts = new Array<number | undefined>(counts.length).fill(undefined);
                        const minimum = Math.max(1, Math.trunc(duration * origRate) * (mono ? 1 : channels));
                        const length = stretched[0]?.length ?? 0;
                        for (let frame = 0; frame < length; frame++) {
                          for (let channel = 0; channel < channels; channel++) {
                            if (++work % 1024 === 0) { budget.checkCpu(); await yieldTurn(context.signal); context.signal?.throwIfAborted(); }
                            const slot = mono ? channel : 0;
                            const prefix = mono ? `channel: ${channel} | ` : "";
                            if (Math.abs(stretched[channel]![frame]!) < noise) {
                              counts[slot]!++;
                              if (counts[slot] === minimum) {
                                const start = frame / origRate - (minimum / (mono ? 1 : channels) - 1) / origRate;
                                starts[slot] = start;
                                await writeBytes(context.stderr, encodeUtf8(`${prefix}silence_start: ${Number(start.toPrecision(6))}\n`), context.signal);
                              }
                            } else {
                              const start = starts[slot];
                              if (start !== undefined) {
                                const end = frame / origRate;
                                await writeBytes(context.stderr, encodeUtf8(`${prefix}silence_end: ${Number(end.toPrecision(6))} | silence_duration: ${Number((end - start).toPrecision(6))}\n`), context.signal);
                              }
                              counts[slot] = 0;
                              starts[slot] = undefined;
                            }
                          }
                        }
                        for (const [slot, start] of starts.entries()) {
                          if (start === undefined) continue;
                          const end = length / origRate;
                          const prefix = mono ? `channel: ${slot} | ` : "";
                          await writeBytes(context.stderr, encodeUtf8(`${prefix}silence_end: ${Number(end.toPrecision(6))} | silence_duration: ${Number((end - start).toPrecision(6))}\n`), context.signal);
                        }
                      } else if (trimmed === "astats" || trimmed.startsWith("astats=")) {
                        if (trimmed.startsWith("astats=")) {
                          for (const option of trimmed.slice("astats=".length).split(":")) {
                            const [key, value, extra] = option.split("=");
                            if ((key !== "metadata" && key !== "reset") || value !== "0" || extra !== undefined) {
                              throw new Error(`astats: unsupported option ${option}`);
                            }
                          }
                        }
                        let totalSquares = 0;
                        let totalCount = 0;
                        let overallPeak = 0;
                        let report = "";
                        const db = (power: number) => power === 0 ? "-inf" : (10 * Math.log10(power)).toFixed(6);
                        for (const [index, channel] of stretched.entries()) {
                          let squares = 0;
                          let peak = 0;
                          for (const value of channel) {
                            if (++work % 1024 === 0) { await yieldTurn(context.signal); context.signal?.throwIfAborted(); }
                            const sample = value * statsScale;
                            squares += sample * sample;
                            peak = Math.max(peak, Math.abs(sample));
                          }
                          report += `Channel: ${index + 1}\nPeak level dB: ${db(peak * peak)}\nRMS level dB: ${db(squares / channel.length)}\n`;
                          totalSquares += squares;
                          totalCount += channel.length;
                          overallPeak = Math.max(overallPeak, peak);
                        }
                        report += `Overall\nPeak level dB: ${db(overallPeak * overallPeak)}\nRMS level dB: ${db(totalSquares / totalCount)}\nNumber of samples: ${totalCount / stretched.length}\n`;
                        await writeBytes(context.stderr, encodeUtf8(report), context.signal);
                      } else if (trimmed === "ebur128" || trimmed.startsWith("ebur128=")) {
                        for await (const report of measureEbur128(stretched, origRate, filteredChannelMask,
                          trimmed === "ebur128" ? "" : trimmed.slice("ebur128=".length), budget, context.signal)) {
                          await writeBytes(context.stderr, encodeUtf8(report), context.signal);
                        }
                      } else if (trimmed === "volumedetect") {
                        let count = 0;
                        let sumSquares = 0;
                        let peak = 0;
                        // FFmpeg measures signed 16-bit samples, including every channel.
                        for (const channel of stretched) {
                          for (const value of channel) {
                            if (++work % 1024 === 0) { await yieldTurn(context.signal); context.signal?.throwIfAborted(); }
                            const sample = Math.max(-32768, Math.min(32767, Math.round(value * 32768)));
                            count++;
                            sumSquares += sample * sample;
                            peak = Math.max(peak, Math.abs(sample));
                          }
                        }
                        let report = `n_samples: ${count}\n`;
                        if (count > 0) {
                          const meanSquare = Math.round(sumSquares / count);
                          const meanDb = meanSquare === 0 ? -91 : 10 * Math.log10(meanSquare / (32768 * 32768));
                          const peakDb = peak === 0 ? -91 : 10 * Math.log10(peak * peak / (32768 * 32768));
                          report += `mean_volume: ${meanDb.toFixed(1)} dB\nmax_volume: ${peakDb.toFixed(1)} dB\n`;
                        }
                        await writeBytes(context.stderr, encodeUtf8(report), context.signal);
                      } else if (trimmed === "volume" || trimmed.startsWith("volume=")) {
                        const argument = trimmed === "volume" ? "1" : trimmed.slice("volume=".length).trim();
                        let volSpec = "1";
                        let precision = "float";
                        let evaluation = "once";
                        let enable: string | undefined;
                        for (const [index, option] of argument.split(":").entries()) {
                          const separator = option.indexOf("=");
                          const key = separator < 0 ? (["volume", "precision", "eval"][index] ?? "") : option.slice(0, separator).trim();
                          const value = separator < 0 ? option.trim() : option.slice(separator + 1).trim();
                          if (key === "volume") volSpec = value;
                          else if (key === "precision") precision = value;
                          else if (key === "eval") evaluation = value;
                          else if (key === "enable") enable = value;
                          else throw new Error(`volume: unsupported option ${key}`);
                        }
                        if (!["fixed", "float", "double"].includes(precision)) throw new Error("volume: invalid precision");
                        if (precision !== "fixed") statsScale = 1;
                        if (evaluation !== "once" && evaluation !== "frame") throw new Error("volume: invalid eval");
                        const decibels = volSpec.endsWith("dB");
                        const output = stretched.map(channel => new Float32Array(channel.length));
                        const length = stretched[0]?.length ?? 0;
                        const sampleScale = t.codecDescriptions[0]?.codecName === "pcm_s16le" ? 32768 : 2147483648;
                        for (let start = 0, n = 0; start < length; n++) {
                          // PCM packets and encoded audio samples retain the decoder's frame boundaries.
                          const packet = t.samples[n];
                          const count = packet ? Math.max(1, Math.round(packet.duration * origRate / t.timescale)) : 1024;
                          const end = evaluation === "once" && enable === undefined ? length : Math.min(length, start + count);
                          const variables: Record<string, number> = { sample_rate: origRate, nb_channels: stretched.length, tb: 1 / origRate };
                          if (evaluation === "frame") Object.assign(variables, {
                            n, t: packet ? packet.pts / t.timescale : start / origRate,
                            pts: packet ? packet.pts * origRate / t.timescale : start,
                            nb_samples: end - start, nb_consumed_samples: start
                          });
                          const gain = parseFilterExpression(decibels ? volSpec.slice(0, -2) : volSpec, "volume", variables);
                          const factor = decibels ? Math.pow(10, gain / 20) : gain;
                          if (!Number.isFinite(factor)) throw new Error("volume: invalid gain");
                          // Native fixed precision uses a Q8 gain and rounds integer samples half upward.
                          const fixedGain = Math.floor(factor * 256 + 0.5);
                          const enabled = enable === undefined || parseFilterExpression(enable, "volume enable", {
                            n, t: packet ? packet.pts / t.timescale : start / origRate
                          }) !== 0;
                          for (let c = 0; c < stretched.length; c++) {
                            const channel = stretched[c]!;
                            for (let i = start; i < end; i++) {
                              if (++work % 1024 === 0) { await yieldTurn(context.signal); context.signal?.throwIfAborted(); }
                              output[c]![i] = !enabled ? channel[i]! : precision === "fixed"
                                ? Math.max(-sampleScale, Math.min(sampleScale - 1,
                                    Math.floor((channel[i]! * sampleScale * fixedGain + 128) / 256))) / sampleScale
                                : channel[i]! * (precision === "float" ? Math.fround(factor) : factor);
                            }
                          }
                          start = end;
                        }
                        stretched = output;
                      } else if (trimmed === "apad" || trimmed.startsWith("apad=")) {
                        let padding: number | undefined;
                        let minimum: number | undefined;
                        const argument = trimmed.slice("apad=".length);
                        for (const option of argument ? argument.split(":") : []) {
                          const [key, value, extra] = option.split("=");
                          if (!["pad_len", "whole_len", "pad_dur", "whole_dur"].includes(key!)) {
                            throw new Error(`apad: unsupported option ${key}`);
                          }
                          const duration = key!.endsWith("_dur");
                          const number = duration ? parseHlsDuration(value ?? "") : Number(value);
                          const samples = duration ? Math.round(number * origRate) : number;
                          if (!value?.trim() || extra !== undefined || number < 0 || !Number.isSafeInteger(samples)) {
                            throw new Error(`apad: invalid ${key}`);
                          }
                          if (key!.startsWith("pad_")) padding = samples;
                          else minimum = samples;
                        }
                        if (padding !== undefined && minimum !== undefined) {
                          throw new Error("apad: padding and minimum length are mutually exclusive");
                        }
                        if (padding === undefined && minimum === undefined) {
                          throw new Error("apad: a finite padding or minimum length is required");
                        }
                        const inputLength = stretched[0]?.length ?? 0;
                        const length = padding !== undefined ? inputLength + padding : Math.max(inputLength, minimum!);
                        budget.checkDuration(length / origRate);
                        budget.allocateMemory(length * stretched.length * Float32Array.BYTES_PER_ELEMENT);
                        stretched = await mapWork(stretched, async channel => {
                          const output = new Float32Array(length);
                          for (let start = 0; start < channel.length; start += 16384) {
                            await yieldTurn(context.signal);
                            context.signal?.throwIfAborted();
                            budget.checkCpu();
                            output.set(channel.subarray(start, start + 16384), start);
                          }
                          return output;
                        }, context.signal);
                      } else if (trimmed === "adelay" || trimmed.startsWith("adelay=")) {
                        let delays = "";
                        let all = false;
                        for (const [index, option] of trimmed.slice("adelay=".length).split(":").entries()) {
                          const separator = option.indexOf("=");
                          const key = separator < 0 ? ["delays", "all"][index] : option.slice(0, separator).trim();
                          const value = (separator < 0 ? option : option.slice(separator + 1)).trim();
                          if (key === "delays") delays = value;
                          else if (key === "all") {
                            if (!["0", "1", "true", "false", "yes", "no", "on", "off"].includes(value)) {
                              throw new Error("adelay: invalid all option");
                            }
                            all = ["1", "true", "yes", "on"].includes(value);
                          } else throw new Error(`adelay: unsupported option ${key}`);
                        }
                        const values = delays.split("|");
                        const offsets = stretched.map((_, channel) => {
                          const value = values[channel] ?? (all ? values.at(-1)! : "0");
                          const samples = value.endsWith("S");
                          const seconds = value.endsWith("s");
                          const number = samples || seconds ? value.slice(0, -1) : value;
                          const delay = Number(number);
                          // Native recognizes unit suffixes after an integer; fractional
                          // time values take the millisecond path with float arithmetic.
                          const integer = [...number].every(char => char >= "0" && char <= "9");
                          const offset = samples && integer ? delay
                            : Math.trunc(Math.fround(Math.fround(Math.fround(delay) * origRate) / (seconds && integer ? 1 : 1000)));
                          if (!number.trim() || !Number.isFinite(delay) || delay < 0 || !Number.isSafeInteger(offset)) {
                            throw new Error(`adelay: invalid delay ${value}`);
                          }
                          return offset;
                        });
                        const length = (stretched[0]?.length ?? 0) + Math.max(0, ...offsets);
                        budget.checkDuration(length / origRate);
                        budget.allocateMemory(length * stretched.length * Float32Array.BYTES_PER_ELEMENT);
                        stretched = await mapWork(stretched, async (channel, c) => {
                          const output = new Float32Array(length);
                          for (let start = 0; start < channel.length; start += 16384) {
                            await yieldTurn(context.signal);
                            context.signal?.throwIfAborted();
                            budget.checkCpu();
                            output.set(channel.subarray(start, start + 16384), offsets[c]! + start);
                          }
                          return output;
                        }, context.signal);
                      } else if (trimmed === "atempo" || trimmed.startsWith("atempo=")) {
                        const argument = trimmed === "atempo" ? "1" : trimmed.slice("atempo=".length).trim();
                        const tempo = parseFilterExpression(argument.startsWith("tempo=") ? argument.slice("tempo=".length) : argument, "atempo", {});
                        if (tempo < 0.5 || tempo > 100) {
                          throw new Error("atempo must be in the range [0.5, 100]");
                        }
                        stretched = tempo === 1
                          ? await filterUnityTempo(stretched, origRate, t.codecDescriptions[0]?.codecName === "pcm_s16le", budget, context.signal)
                          : await stretchAudio(stretched, origRate, tempo, budget, context.signal);
                      } else if (trimmed === "dialoguenhance" || trimmed.startsWith("dialoguenhance=")) {
                        const values = [1, 1, 2];
                        const names = ["original", "enhance", "voice"];
                        const argument = trimmed.slice("dialoguenhance=".length);
                        for (const [index, option] of (argument ? argument.split(":") : []).entries()) {
                          const separator = option.indexOf("=");
                          const key = separator < 0 ? index : names.indexOf(option.slice(0, separator).trim());
                          const value = Number(separator < 0 ? option : option.slice(separator + 1));
                          if (key < 0 || key > 2 || !Number.isFinite(value) || value < (key === 2 ? 2 : 0) || value > [1, 3, 32][key]!) {
                            throw new Error("dialoguenhance: invalid option");
                          }
                          values[key] = value;
                        }
                        stretched = await enhanceDialogue(stretched, origRate, values[0]!, values[1]!, values[2]!, budget, context.signal);
                        filteredChannelMask = 7;
                      } else if (trimmed === "extrastereo" || trimmed.startsWith("extrastereo=")) {
                        let multiplier = 2.5;
                        let clip = true;
                        const argument = trimmed.slice("extrastereo".length + 1);
                        for (const [index, option] of (argument ? argument.split(":") : []).entries()) {
                          const separator = option.indexOf("=");
                          const key = separator < 0 ? ["m", "c"][index] : option.slice(0, separator).trim();
                          const value = (separator < 0 ? option : option.slice(separator + 1)).trim();
                          if (key === "m") {
                            multiplier = Math.fround(parseFilterExpression(value, "extrastereo", {}));
                            if (!Number.isFinite(multiplier) || multiplier < -10 || multiplier > 10) {
                              throw new Error("extrastereo: m must be in the range [-10, 10]");
                            }
                          } else if (key === "c") {
                            if (!["0", "1", "true", "false", "yes", "no", "on", "off"].includes(value)) {
                              throw new Error("extrastereo: invalid clipping option");
                            }
                            clip = ["1", "true", "yes", "on"].includes(value);
                          } else throw new Error(`extrastereo: unsupported option ${key}`);
                        }
                        if (stretched.length !== 2) throw new Error("extrastereo: stereo input required");
                        const output = stretched.map(channel => new Float32Array(channel.length));
                        for (let i = 0; i < stretched[0]!.length; i++) {
                          if (i % 4096 === 0) {
                            await yieldTurn(context.signal);
                            context.signal?.throwIfAborted();
                            budget.checkCpu();
                          }
                          const average = Math.fround(Math.fround(stretched[0]![i]! + stretched[1]![i]!) / 2);
                          for (let c = 0; c < 2; c++) {
                            const value = Math.fround(average + Math.fround(multiplier * Math.fround(stretched[c]![i]! - average)));
                            output[c]![i] = clip ? Math.max(-1, Math.min(1, value)) : value;
                          }
                        }
                        stretched = output;
                      } else if (trimmed === "aeval" || trimmed.startsWith("aeval=")) {
                        let expressions = "";
                        let layout = "";
                        for (const [index, option] of trimmed.slice("aeval=".length).split(":").entries()) {
                          const separator = option.indexOf("=");
                          const key = separator < 0 ? ["exprs", "channel_layout"][index] : option.slice(0, separator);
                          const value = separator < 0 ? option : option.slice(separator + 1);
                          if (key === "exprs") expressions = value;
                          else if (key === "channel_layout" || key === "c") layout = value;
                          else throw new Error(`aeval: unsupported option ${key}`);
                        }
                        const exprs = expressions.split("|");
                        const count = layout === "same" ? stretched.length : layout === "mono" ? 1
                          : layout === "stereo" ? 2 : layout === "" ? exprs.length : 0;
                        if (!count || count > 2 || exprs.length > count || exprs.some(expr => !expr.trim())) {
                          throw new Error("aeval: unsupported channel layout or invalid expressions");
                        }
                        const output = Array.from({ length: count }, () => new Float64Array(stretched[0]!.length));
                        const variables = { ch: 0, n: 0, t: 0, s: origRate, nb_in_channels: stretched.length, nb_out_channels: count };
                        const sampleValue = (channel: number) => stretched[Math.max(0, Math.min(stretched.length - 1, Math.trunc(channel)))]![variables.n]!;
                        for (let i = 0; i < stretched[0]!.length; i++) {
                          if (i % 4096 === 0) {
                            await yieldTurn(context.signal);
                            context.signal?.throwIfAborted();
                            budget.checkCpu();
                          }
                          variables.n = i;
                          variables.t = i / origRate;
                          for (let c = 0; c < count; c++) {
                            variables.ch = c;
                            output[c]![i] = parseFilterExpression(exprs[Math.min(c, exprs.length - 1)]!, "aeval", variables, sampleValue);
                          }
                        }
                        stretched = output;
                        if (layout !== "same") filteredChannelMask = count === 1 ? 4 : 3;
                      } else if (trimmed === "aformat" || trimmed.startsWith("aformat=")) {
                        const argument = trimmed.slice("aformat=".length);
                        for (const option of argument ? argument.split(":") : []) {
                          const separator = option.indexOf("=");
                          const key = option.slice(0, separator).trim();
                          const value = option.slice(separator + 1).trim();
                          if (key !== "channel_layouts" && key !== "cl") throw new Error(`aformat: unsupported option ${key}`);
                          if (value !== "mono") throw new Error(`aformat: unsupported channel layout ${value}`);
                          if (stretched.length === 1 && (!filteredChannelMask || filteredChannelMask === 4)) continue;
                          if (stretched.length !== 2 || (filteredChannelMask && filteredChannelMask !== 3)) {
                            throw new Error("aformat: mono conversion requires mono or stereo input");
                          }
                          const mixed = await panAudio("mono|c0=0.5*c0+0.5*c1", stretched, filteredChannelMask, budget, context.signal);
                          stretched = mixed.channels;
                          filteredChannelMask = mixed.channelMask;
                        }
                      } else if (trimmed === "pan" || trimmed.startsWith("pan=")) {
                        const panned = await panAudio(trimmed.slice(4), stretched, filteredChannelMask, budget, context.signal);
                        stretched = panned.channels;
                        filteredChannelMask = panned.channelMask;
                      } else if (trimmed === "crossfeed" || trimmed.startsWith("crossfeed=")) {
                        if (stretched.length !== 2) throw new Error("crossfeed: stereo input required");
                        const options = { strength: 0.2, range: 0.5, slope: 0.5, level_in: 0.9, level_out: 1 };
                        const argument = trimmed.slice("crossfeed=".length);
                        for (const [index, option] of (argument ? argument.split(":") : []).entries()) {
                          const separator = option.indexOf("=");
                          const key = separator < 0 ? ["strength", "range", "slope", "level_in", "level_out"][index] : option.slice(0, separator).trim();
                          if (key !== "strength" && key !== "range" && key !== "slope" && key !== "level_in" && key !== "level_out") {
                            throw new Error(`crossfeed: unsupported option ${key}`);
                          }
                          const value = parseFilterExpression((separator < 0 ? option : option.slice(separator + 1)).trim(), "crossfeed", {});
                          const min = key === "slope" ? 0.01 : 0;
                          if (!Number.isFinite(value) || value < min || value > 1) {
                            throw new Error(`crossfeed: ${key} must be in the range [${min}, 1]`);
                          }
                          options[key] = value;
                        }
                        // Low-shelf the stereo difference signal, preserving the mid signal.
                        const gain = 10 ** (-30 * options.strength / 40);
                        const omega = 2 * Math.PI * (1 - options.range) * 2100 / origRate;
                        const cosine = Math.cos(omega);
                        const alpha = Math.sin(omega) / 2 * Math.sqrt((gain + 1 / gain) * (1 / options.slope - 1) + 2);
                        const beta = 2 * Math.sqrt(gain) * alpha;
                        const a0 = (gain + 1) + (gain - 1) * cosine + beta;
                        const a1 = -2 * ((gain - 1) + (gain + 1) * cosine) / a0;
                        const a2 = ((gain + 1) + (gain - 1) * cosine - beta) / a0;
                        const b0 = gain * ((gain + 1) - (gain - 1) * cosine + beta) / a0;
                        const b1 = 2 * gain * ((gain - 1) - (gain + 1) * cosine) / a0;
                        const b2 = gain * ((gain + 1) - (gain - 1) * cosine - beta) / a0;
                        let w1 = 0;
                        let w2 = 0;
                        const output = stretched.map(channel => new Float64Array(channel.length));
                        for (let i = 0; i < stretched[0]!.length; i++) {
                          if (i % 4096 === 0) {
                            await yieldTurn(context.signal);
                            context.signal?.throwIfAborted();
                            budget.checkCpu();
                          }
                          const mid = (stretched[0]![i]! + stretched[1]![i]!) * options.level_in * 0.5;
                          const side = (stretched[0]![i]! - stretched[1]![i]!) * options.level_in * 0.5;
                          const filtered = side * b0 + w1;
                          w1 = b1 * side + w2 - a1 * filtered;
                          w2 = b2 * side - a2 * filtered;
                          output[0]![i] = (mid + filtered) * options.level_out;
                          output[1]![i] = (mid - filtered) * options.level_out;
                        }
                        stretched = output;
                      } else if (trimmed === "earwax") {
                        if (origRate !== 44100 || stretched.length !== 2) {
                          throw new Error("earwax: 44100 Hz stereo input required");
                        }
                        // Earwax FIR coefficients, in oldest-to-newest sample order.
                        // Copyright (c) 2000 Edward Beingessner And Sundry Contributors.
                        // Freely redistributable for any purpose; this notice must be maintained.
                        // The contributors are not responsible for consequences of using this software.
                        const taps = [
                          [4, 4, -1, 3, -2, -5, 9, 6, -4, -5, -2, -7, 6, 30, 12, -11,
                            -3, -20, 2, 1, -14, 15, 6, 15, -14, -7, -4, 6, 6, 0, 0, 4],
                          [-6, -11, -5, 3, 5, 0, 1, 3, -1, -3, -5, 1, -7, -29, -3, 4,
                            7, 23, 0, -6, -5, -18, 7, -10, 22, -2, 9, -12, -6, -11, -5, 0]
                        ];
                        const history = [new Int16Array(32), new Int16Array(32)];
                        const output = stretched.map(channel => new Float64Array(channel.length));
                        for (let i = 0; i < stretched[0]!.length; i++) {
                          if (i % 4096 === 0) {
                            await yieldTurn(context.signal);
                            context.signal?.throwIfAborted();
                            budget.checkCpu();
                          }
                          for (let c = 0; c < 2; c++) {
                            let same = 0;
                            let opposite = 0;
                            for (let j = 0; j < 32; j++) {
                              same += history[c]![(i + j) % 32]! * taps[1]![j]!;
                              opposite += history[1 - c]![(i + j) % 32]! * taps[0]![j]!;
                            }
                            // FFmpeg clips each convolution before mixing and clips the sum again.
                            const mixed = Math.max(-32768, Math.min(32767, Math.floor(same / 128)))
                              + Math.max(-32768, Math.min(32767, Math.floor(opposite / 128)));
                            output[c]![i] = Math.max(-32768, Math.min(32767, mixed)) / 32768;
                          }
                          for (let c = 0; c < 2; c++) {
                            history[c]![i % 32] = Math.max(-32768, Math.min(32767, roundToEven(stretched[c]![i]! * 32768)));
                          }
                        }
                        stretched = output;
                      } else if (trimmed === "haas") {
                        if (stretched.length !== 2) throw new Error("haas: stereo input required");
                        const leftDelay = Math.floor(2.05 * 0.001 * origRate);
                        const rightDelay = Math.floor(2.12 * 0.001 * origRate);
                        const output = stretched.map(channel => new Float64Array(channel.length));
                        for (let i = 0; i < stretched[0]!.length; i++) {
                          if (i % 4096 === 0) {
                            await yieldTurn(context.signal);
                            context.signal?.throwIfAborted();
                            budget.checkCpu();
                          }
                          const mid = (stretched[0]![i]! + stretched[1]![i]!) * 0.5;
                          // Native Haas defaults add the earlier tap on the right
                          // and subtract the later tap on the left.
                          output[0]![i] = mid - (i >= rightDelay
                            ? (stretched[0]![i - rightDelay]! + stretched[1]![i - rightDelay]!) * 0.5 : 0);
                          output[1]![i] = mid + (i >= leftDelay
                            ? (stretched[0]![i - leftDelay]! + stretched[1]![i - leftDelay]!) * 0.5 : 0);
                        }
                        stretched = output;
                      } else if (trimmed === "stereowiden" || trimmed.startsWith("stereowiden=")) {
                        if (stretched.length !== 2) throw new Error("stereowiden: stereo input required");
                        const options = { delay: 20, feedback: 0.3, crossfeed: 0.3, drymix: 0.8 };
                        const argument = trimmed.slice("stereowiden=".length);
                        for (const [index, option] of (argument ? argument.split(":") : []).entries()) {
                          const separator = option.indexOf("=");
                          const key = separator < 0 ? ["delay", "feedback", "crossfeed", "drymix"][index] : option.slice(0, separator).trim();
                          if (key !== "delay" && key !== "feedback" && key !== "crossfeed" && key !== "drymix") {
                            throw new Error(`stereowiden: unsupported option ${key}`);
                          }
                          const value = parseFilterExpression((separator < 0 ? option : option.slice(separator + 1)).trim(), "stereowiden", {});
                          const min = key === "delay" ? 1 : 0;
                          const max = key === "delay" ? 100 : key === "feedback" ? 0.9 : key === "crossfeed" ? 0.8 : 1;
                          if (!Number.isFinite(value) || value < min || value > max) {
                            throw new Error(`stereowiden: ${key} must be in the range [${min}, ${max}]`);
                          }
                          options[key] = value;
                        }
                        const delay = Math.floor(origRate * Math.fround(options.delay) / 1000);
                        const feedback = Math.fround(options.feedback);
                        const crossfeed = Math.fround(options.crossfeed);
                        const drymix = Math.fround(options.drymix);
                        const output = stretched.map(channel => new Float32Array(channel.length));
                        for (let i = 0; i < stretched[0]!.length; i++) {
                          if (i % 4096 === 0) {
                            await yieldTurn(context.signal);
                            context.signal?.throwIfAborted();
                            budget.checkCpu();
                          }
                          for (let c = 0; c < 2; c++) {
                            const opposite = stretched[1 - c]!;
                            output[c]![i] = Math.fround(Math.fround(drymix * Math.fround(stretched[c]![i]!))
                              - Math.fround(crossfeed * Math.fround(opposite[i]!)))
                              - Math.fround(feedback * Math.fround(i >= delay ? opposite[i - delay]! : 0));
                          }
                        }
                        stretched = output;
                      } else if (trimmed === "stereotools" || trimmed.startsWith("stereotools=")) {
                        if (stretched.length !== 2) throw new Error("stereotools: stereo input required");
                        const modes = ["lr>lr", "lr>ms", "ms>lr", "lr>ll", "lr>rr", "lr>l+r", "lr>rl", "ms>ll", "ms>rr", "ms>rl", "lr>l-r"];
                        let mode = 0;
                        const flags = { mutel: false, muter: false, phasel: false, phaser: false };
                        const argument = trimmed.slice("stereotools=".length);
                        for (const option of argument ? argument.split(":") : []) {
                          const separator = option.indexOf("=");
                          const key = option.slice(0, separator).trim();
                          const value = option.slice(separator + 1).trim();
                          if (key === "mode") {
                            mode = modes.indexOf(value);
                            if (mode < 0 && value !== "") mode = Number(value);
                            if (!Number.isInteger(mode) || mode < 0 || mode >= modes.length) {
                              throw new Error("stereotools: invalid mode");
                            }
                          } else if (key === "mutel" || key === "muter" || key === "phasel" || key === "phaser") {
                            if (!["0", "1", "true", "false", "yes", "no", "on", "off"].includes(value)) {
                              throw new Error(`stereotools: invalid ${key}`);
                            }
                            flags[key] = ["1", "true", "yes", "on"].includes(value);
                          } else {
                            throw new Error(`stereotools: unsupported option ${key}`);
                          }
                        }
                        const left = new Float32Array(stretched[0]!.length);
                        const right = new Float32Array(left.length);
                        for (let i = 0; i < left.length; i++) {
                          if (++work % 1024 === 0) { await yieldTurn(context.signal); context.signal?.throwIfAborted(); }
                          const l = stretched[0]![i]!;
                          const r = stretched[1]![i]!;
                          let outputLeft = l;
                          let outputRight = r;
                          switch (mode) {
                            case 1: outputLeft = (l + r) / 2; outputRight = (l - r) / 2; break;
                            case 2: outputLeft = l + r; outputRight = l - r; break;
                            case 3: outputRight = l; break;
                            case 4: outputLeft = r; break;
                            case 5: outputLeft = outputRight = (l + r) / 2; break;
                            case 6: outputLeft = r; outputRight = l; break;
                            case 7: outputLeft = outputRight = l + r; break;
                            case 8: outputLeft = outputRight = l - r; break;
                            case 9: outputLeft = l - r; outputRight = l + r; break;
                            case 10: outputLeft = outputRight = (l - r) / 2; break;
                          }
                          left[i] = flags.mutel ? 0 : outputLeft * (flags.phasel ? -1 : 1);
                          right[i] = flags.muter ? 0 : outputRight * (flags.phaser ? -1 : 1);
                        }
                        stretched = [left, right];
                      } else if (trimmed.startsWith("channelmap=")) {
                        let map = "";
                        let layout = "";
                        for (const [index, option] of trimmed.slice("channelmap=".length).split(":").entries()) {
                          const separator = option.indexOf("=");
                          const key = separator < 0 ? ["map", "channel_layout"][index] : option.slice(0, separator);
                          const value = separator < 0 ? option : option.slice(separator + 1);
                          if (key === "map") map = value;
                          else if (key === "channel_layout") layout = value;
                          else throw new Error(`channelmap: unsupported option ${key}`);
                        }
                        const selected = map.split("|").map(value => {
                          if (!value || [...value].some(char => char < "0" || char > "9")) {
                            throw new Error(`channelmap: invalid input channel ${value}`);
                          }
                          const channel = Number(value);
                          if (!Number.isSafeInteger(channel) || channel >= stretched.length) {
                            throw new Error(`channelmap: unavailable input channel ${value}`);
                          }
                          return stretched[channel]!;
                        });
                        if (!layout) layout = selected.length === 1 ? "mono" : selected.length === 2 ? "stereo" : "";
                        const count = layout === "mono" ? 1 : layout === "stereo" ? 2 : 0;
                        if (!count || selected.length !== count) throw new Error("channelmap: unsupported or mismatched channel layout");
                        stretched = selected;
                        filteredChannelMask = count === 1 ? 4 : 3;
                      } else if (trimmed === "channelsplit" || trimmed.startsWith("channelsplit=")) {
                        const selected = parseChannelSplit(trimmed);
                        if (selected.length !== 1) throw new Error("channelsplit: simple audio filters require exactly one output");
                        if (stretched.length !== 2) throw new Error("channelsplit: stereo input required");
                        const channel = selected[0] === "FL" ? 0 : 1;
                        stretched = [stretched[channel]!];
                        filteredChannelMask = 1 << channel;
                      } else if (trimmed === "asetpts" || trimmed.startsWith("asetpts=")) {
                        const argument = trimmed === "asetpts" ? "PTS" : trimmed.slice("asetpts=".length);
                        const expression = argument.startsWith("expr=") ? argument.slice(5) : argument;
                        if (!audioTimestamps) {
                          audioTimestamps = [];
                          const length = stretched[0]?.length ?? 0;
                          for (let start = 0, n = 0; start < length; n++) {
                            const packet = t.samples[n];
                            const count = packet ? Math.max(1, Math.round(packet.duration * origRate / t.timescale)) : 1024;
                            const end = Math.min(length, start + count);
                            audioTimestamps.push({ start, end, pts: audioStartSample + start });
                            start = end;
                          }
                        }
                        const startPts = audioTimestamps[0]?.pts ?? 0;
                        // Validate even an empty stream; expressions use the audio sample time base.
                        if (audioTimestamps.length === 0) parseFilterExpression(expression, "asetpts", {
                          PTS: 0, STARTPTS: 0, TB: 1 / origRate, SR: origRate, N: 0, NB_SAMPLES: 0
                        });
                        for (const frame of audioTimestamps) {
                          if (++work % 1024 === 0) { await yieldTurn(context.signal); context.signal?.throwIfAborted(); }
                          frame.pts = Math.trunc(parseFilterExpression(expression, "asetpts", {
                            PTS: frame.pts, STARTPTS: startPts, TB: 1 / origRate, SR: origRate,
                            N: frame.start, NB_SAMPLES: frame.end - frame.start
                          }));
                        }
                      } else if (trimmed === "atrim" || trimmed.startsWith("atrim=")) {
                        let start = Infinity;
                        let end = -Infinity;
                        const argument = trimmed.slice("atrim=".length);
                        for (const [index, option] of (argument ? argument.split(":") : []).entries()) {
                          const separator = option.indexOf("=");
                          const key = separator < 0 ? ["start", "end"][index] : option.slice(0, separator).trim();
                          const value = (separator < 0 ? option : option.slice(separator + 1)).trim();
                          const samples = key === "start_sample" || key === "end_sample";
                          if (!samples && key !== "start" && key !== "end") {
                            throw new Error(`atrim: unsupported option ${key}`);
                          }
                          const number = samples ? Number(value) : parseHlsDuration(value);
                          const frame = samples ? number : Math.round(number * origRate) - audioStartSample;
                          if (!value || !Number.isFinite(number) || !Number.isSafeInteger(frame) || (samples && number < 0)) {
                            throw new Error(`atrim: invalid ${key}`);
                          }
                          if (key === "start" || key === "start_sample") start = Math.min(start, frame);
                          else end = Math.max(end, frame);
                        }
                        const length = stretched[0]?.length ?? 0;
                        start = start === Infinity ? 0 : Math.max(0, Math.min(length, start));
                        end = end === -Infinity ? length : Math.max(start, Math.min(length, end));
                        stretched = stretched.map(channel => channel.subarray(start, end));
                        audioStartSample += start;
                      } else if (trimmed === "areverse") {
                        stretched = await mapWork(stretched, async channel => channel.slice().reverse(), context.signal);
                      } else {
                        throw new Error(`Unsupported audio filter: ${trimmed}`);
                      }
                    }
                  }

                  const audioEnd = outputDuration ?? (outputTo === undefined ? undefined : outputTo - (outputSs ?? 0));
                  if (audioTimestamps && audioEnd !== undefined) {
                    // FFmpeg stops on a frame's shifted PTS, retaining the entire preceding frame.
                    const cutoff = audioTimestamps.find(frame => frame.pts >= audioEnd * origRate);
                    if (cutoff) stretched = stretched.map(channel => channel.subarray(0, cutoff.start));
                  }

                  const origCh = stretched.length;
                  const targetRate = audioRate ?? origRate;
                  const targetCh = audioChannels === -1 ? origCh : audioChannels ?? origCh;
                  const channelMask = filteredChannelMask;
                  const surroundMono = origCh === 6 && targetCh === 1;
                  const monoStereo = origCh === 1 && (targetCh === 2 || targetCh === 3);
                  const pcm16MonoStereo = monoStereo && !filter && targetRate === origRate &&
                    t.codecDescriptions[0]?.codecName === "pcm_s16le" &&
                    (audioCodec === "pcm_s16le" || audioCodec === undefined &&
                      (outputFormat ?? outputTarget.split(".").pop()?.toLowerCase()) === "wav");
                  const monoSurround = origCh === 1 && targetCh >= 4 && targetCh <= 8;
                  if (targetCh !== origCh && origCh > 2 &&
                      (!surroundMono || (channelMask && channelMask !== 0x3f && channelMask !== 0x60f))) {
                    throw new Error(`Unsupported audio channel layout conversion: ${origCh} channels (mask ${channelMask ?? 0}) to ${targetCh}`);
                  }

                  const targetSamples = Math.max(0, Math.round((stretched[0]?.length ?? 0) * targetRate / origRate));
                  if (targetRate !== origRate) stretched = await resampleAudio(stretched, targetSamples, origRate / targetRate, budget, context.signal);
                  const newChannelData: Float32Array[] = [];
                  for (let c = 0; c < targetCh; c++) {
                    if (++work % 1024 === 0) { await yieldTurn(context.signal); context.signal?.throwIfAborted(); }

                    const dst = new Float32Array(targetSamples);
                    // Default 4.0 through 7.1 layouts route mono to front center only.
                    const srcCh = (monoStereo && c >= 2) || (monoSurround && c !== 2)
                      ? undefined : stretched[origCh === 1 ? 0 : c];
                    const rightCh = origCh === 2 && targetCh === 1 ? stretched[1] : undefined;
                    if (srcCh && srcCh.length > 0) {
                      for (let i = 0; i < targetSamples; i++) {
                        if (++work % 1024 === 0) { await yieldTurn(context.signal); context.signal?.throwIfAborted(); }

                        const srcIdx = Math.min(srcCh.length - 1, i);
                        // FFmpeg's normalized 5.1 mono matrix: FL/FR at sqrt(1/2),
                        // center at 1, surrounds at 1/2, and no LFE contribution.
                        const sample = surroundMono
                          ? ((stretched[0]![srcIdx]! + stretched[1]![srcIdx]!) * Math.SQRT1_2 +
                              stretched[2]![srcIdx]! + (stretched[4]![srcIdx]! + stretched[5]![srcIdx]!) / 2) / (2 + Math.SQRT2)
                          : rightCh ? (srcCh[srcIdx]! + rightCh[srcIdx]!) / 2 : srcCh[srcIdx]!;
                        // Mono to stereo (or 2.1) uses equal-power FL/FR gains.
                        // The s16 mixer uses a Q15 coefficient and rounds half upward.
                        const mixed = pcm16MonoStereo
                          ? Math.floor((sample * 32768 * 23170 + 16384) / 32768) / 32768
                          : sample * (monoStereo ? Math.SQRT1_2 : 1);
                        dst[i] = Math.max(-1, Math.min(1, mixed * volFactor));
                      }
                    }
                    newChannelData.push(dst);
                  }

                  const nextDescs = t.codecDescriptions.map((d) => ({
                    ...d,
                    sampleRate: targetRate,
                    channels: targetCh
                  }));

                  return {
                    ...t,
                    timescale: targetRate,
                    duration: targetSamples,
                    volume: volFactor,
                    codecDescriptions: nextDescs,
                    samples: [],
                    decodedAudio: {
                      sampleRate: targetRate,
                      channels: targetCh,
                      channelData: newChannelData,
                      ...(targetCh === origCh ? { channelMask } : {})
                    }
                  };
                }, context.signal)
              };
            }

            if (chapterSource !== undefined) {
              if (chapterSource >= loadedDocs.length) {
                throw new Error(`Invalid chapter input index: ${chapterSource}`);
              }
              workingDoc = { ...workingDoc, chapters: chapterSource < 0 ? undefined : loadedDocs[chapterSource]!.chapters };
            }
            if (metadataSource !== undefined && metadataSource >= loadedDocs.length) {
              throw new Error(`Invalid metadata input index: ${metadataSource}`);
            }
            const sourceMetadata = metadataSource === undefined ? loadedDocs[0]!.metadata
              : metadataSource < 0 ? {} : loadedDocs[metadataSource]!.metadata;

            // Apply `-metadata` tags
            const metaTags: Mp4MetadataTags = {
              ...sourceMetadata,
              description: metadata.description ?? sourceMetadata.description,
              custom: writeBext ? { ...sourceMetadata.custom, ...metadata } : sourceMetadata.custom,
              title: metadata.title ?? sourceMetadata.title,
              artist: metadata.artist ?? sourceMetadata.artist,
              album: metadata.album ?? sourceMetadata.album,
              date: metadata.date ?? metadata.year ?? sourceMetadata.date,
              comment: metadata.comment ?? sourceMetadata.comment,
              genre: metadata.genre ?? sourceMetadata.genre,
              encoder: outPlugin?.id === "ffmetadata" ? (bitexact ? undefined : "Lavf61.7.100") : metadata.encoder ?? sourceMetadata.encoder
            };
            workingDoc = {
              ...workingDoc,
              faststart,
              metadata: metaTags,
              tracks: applyStreamDispositions(applyStreamLanguages(workingDoc.tracks, streamLanguages, metadataSource), streamDispositions)
            };

            let decodeExitCode = demuxExitCode;
            for (const track of workingDoc.tracks) {
              if ((track.type === "subtitle" ? subtitleCodec : audioCodec) === "copy") continue;
              for (const error of track.decodeErrors ?? []) {
                await writeBytes(context.stderr, encodeUtf8(`ffmpeg: ${error}\n`), context.signal);
              }
              const errors = track.decodeErrors?.length ?? 0;
              const frames = track.samples.filter(sample => sample.duration > 0).length;
              // FFmpeg 7.0.2 divides integer counters per decoder, truncating partial rates.
              const rate = errors || frames ? Math.floor(errors / (errors + frames)) : 0;
              if (exitOnError && errors) {
                decodeExitCode = 183;
              } else if (rate > maxErrorRate && decodeExitCode !== 183) {
                await writeBytes(context.stderr, encodeUtf8(`ffmpeg: Decode error rate ${rate} exceeds maximum ${maxErrorRate}\n`), context.signal);
                decodeExitCode = 69;
              }
            }

            // Count processed media, not container headers or checksum text.
            hasOutputFrames ||= workingDoc.tracks.some(track =>
              track.decodedAudio ? track.decodedAudio.channelData.some(channel => channel.length > 0)
                : track.decodedVideoFrames ? track.decodedVideoFrames.length > 0
                  : track.samples.length > 0);

            if (progressTarget !== undefined) {
              for (const track of workingDoc.tracks) {
                if (track.decodedAudio) {
                  progressSeconds = Math.max(progressSeconds,
                    (track.decodedAudio.channelData[0]?.length ?? 0) / track.decodedAudio.sampleRate);
                } else if (track.decodedVideoFrames) {
                  for (const frame of track.decodedVideoFrames) {
                    progressSeconds = Math.max(progressSeconds, frame.ptsSeconds + frame.durationSeconds);
                  }
                } else {
                  for (const sample of track.samples) {
                    progressSeconds = Math.max(progressSeconds, (sample.dts + sample.cts + sample.duration) / track.timescale);
                  }
                }
              }
            }

            // Null muxer (`-f null -`)
            if (outputFormat === "null") {
              options.onMetrics?.(budget.getStats());
              return { exitCode: decodeExitCode };
            }

            if (outputFormat === "segment") {
              const segmentPlugin = registry.findByFilename(outputTarget);
              const track = workingDoc.tracks[0];
              if (segmentPlugin?.id !== "wav" || workingDoc.tracks.length !== 1 || track?.type !== "audio") {
                throw new Error("segment output requires a single audio track and WAV filenames");
              }
              if (formatImageSequence(outputTarget, 0) === undefined) {
                throw new Error("segment output requires a numbered filename pattern");
              }
              validateStreamCopy(workingDoc, "wav", { audio: audioCodec });
              const boundaries = [0];
              for (const packet of track.samples) {
                budget.checkCpu();
                const seconds = packet.pts / track.timescale;
                if (seconds > boundaries[boundaries.length - 1]! && seconds >= boundaries.length * segmentTime) {
                  boundaries.push(seconds);
                }
              }
              boundaries.push(track.duration / track.timescale);
              const paths = boundaries.slice(1).map((_, index) =>
                resolvePath(context.cwd, formatImageSequence(outputTarget, index)!));
              const listPath = segmentList === undefined ? undefined : resolvePath(context.cwd, segmentList);
              const destinations = listPath === undefined ? paths : [...paths, listPath];
              if (new Set(destinations).size !== destinations.length) throw new Error("Segment output filenames collide");
              for (const path of destinations) {
                if (inputs.some(input => input.format !== "lavfi" && resolvePath(context.cwd, input.path) === path)) {
                  throw new Error(`Output ${path} is also an input; cannot edit existing files in-place`);
                }
                if (!overwrite) {
                  let exists = false;
                  try {
                    await context.fs.stat(path, { signal: context.signal });
                    exists = true;
                  } catch (error) {
                    rethrowRuntimeError(context, error);
                    if ((error as { code?: string }).code !== "ENOENT") throw error;
                  }
                  if (exists) throw new Error(`File '${path}' already exists. Exiting.`);
                }
              }
              const list: string[] = [];
              for (let index = 0; index < paths.length; index++) {
                await yieldTurn(context.signal);
                context.signal.throwIfAborted();
                const start = boundaries[index]!;
                const end = boundaries[index + 1]!;
                const segment = sliceMp4(workingDoc, { startSeconds: start, endSeconds: end, budget });
                const bytes = segmentPlugin.serialize(segment, { writeBext, rf64, writePeak, audioCodec, audioBitrate, compressionLevel, sampleFormat, pageDuration, serialOffset, metadataHeaderPadding, budget, limits: options.limits });
                budget.checkOutputBytes(bytes.byteLength);
                const path = paths[index]!;
                await writeFileOutput(context, bytes, data => context.fs.writeFile(path, data, { signal: context.signal }));
                const name = path.slice(path.lastIndexOf("/") + 1);
                const csvName = [",", '"', "\n", "\r"].some(char => name.includes(char))
                  ? '"' + name.replaceAll('"', '""') + '"' : name;
                list.push(`${csvName},${start.toFixed(6)},${end.toFixed(6)}\n`);
              }
              if (listPath !== undefined) {
                const bytes = encodeUtf8(list.join(""));
                budget.checkOutputBytes(bytes.byteLength);
                await writeFileOutput(context, bytes, data => context.fs.writeFile(listPath, data, { signal: context.signal }));
              }
              options.onMetrics?.(budget.getStats());
              return { exitCode: decodeExitCode };
            }

            if (outputFormat === "dash" || outputTarget.toLowerCase().endsWith(".mpd")) {
              if (!registry.findByFormatName("dash")?.canMux) throw new Error("DASH AST is not registered");
              const outResolved = resolvePath(context.cwd, outputTarget);
              const outDir = outResolved.slice(0, outResolved.lastIndexOf("/")) || "/";
              const { manifest, resources } = serializeDashDocument(workingDoc, { hlsPlaylist: dashHlsPlaylist, adaptationSets: dashAdaptationSets, singleFile: dashSingleFile, singleFileName: outResolved.slice(outResolved.lastIndexOf("/") + 1, outResolved.lastIndexOf(".") > outResolved.lastIndexOf("/") ? outResolved.lastIndexOf(".") : undefined) + "-stream$RepresentationID$.mp4", segmentDuration: dashSegmentDuration, fragmentType: dashFragmentType, windowSize: dashWindowSize, useTemplate: dashUseTemplate, useTimeline: dashUseTimeline, initSegmentName: dashInitSegmentName, mediaSegmentName: dashMediaSegmentName, limits: options.limits, budget });
              await context.fs.mkdir(outDir, { recursive: true, signal: context.signal });
              for (const [uri, bytes] of resources) {
                await writeFileOutput(context, bytes, data => context.fs.writeFile(resolvePath(outDir, uri), data, { signal: context.signal }));
              }
              await writeFileOutput(context, manifest, data => context.fs.writeFile(outResolved, data, { signal: context.signal }));
              if (dashRemoveAtExit) {
                for (const uri of resources.keys()) {
                  await context.fs.rm(resolvePath(outDir, uri), { signal: context.signal });
                }
                await context.fs.rm(outResolved, { signal: context.signal });
              }
              options.onMetrics?.(budget.getStats());
              return { exitCode: decodeExitCode };
            }

            // Handle HLS (.m3u8 / -f hls) multi-segment muxing
            if (outputFormat === "hls" || /\.m3u8?$/i.test(outputTarget)) {
              const outResolved = resolvePath(context.cwd, outputTarget);
              const outDir = outResolved.includes("/")
                ? outResolved.slice(0, outResolved.lastIndexOf("/")) || "/"
                : "/";
              const isFmp4 = hlsSegmentType === "fmp4";
              const segExt = isFmp4 ? "m4s" : "ts";
              const outName = outResolved.slice(outResolved.lastIndexOf("/") + 1);
              const segPattern = hlsSegmentFilename ?? `${outName.includes(".") ? outName.slice(0, outName.lastIndexOf(".")) : outName}${hlsSingleFile ? "" : "%d"}.${segExt}`;
              if (!hlsSingleFile && formatImageSequence(segPattern, outputStartNumber ?? 0) === undefined) {
                throw new Error(`Invalid segment filename template '${segPattern}'`);
              }
              const segPlugin = registry.findByFormatName(isFmp4 ? "mp4" : "mpegts");
              if (!segPlugin) {
                throw new Error(`HLS segment format AST (${isFmp4 ? "mp4" : "mpegts"}) is not registered`);
              }
              const vTrk = workingDoc.tracks.find((t) => t.type === "video");
              const totalSec = Math.max(
                0.1,
                vTrk ? vTrk.duration / Math.max(1, vTrk.timescale) : (workingDoc.durationSeconds || 1)
              );
              const segDur = Math.max(0.2, hlsTime);
              const boundaries = [0];
              if (vTrk?.samples.length) {
                for (const sample of vTrk.samples) {
                  const seconds = sample.dts / vTrk.timescale;
                  if ((hlsSplitByTime || sample.isKeyframe) && seconds >= boundaries.length * segDur - 1e-6 && seconds < totalSec) {
                    boundaries.push(seconds);
                  }
                }
              } else {
                for (let seconds = segDur; seconds < totalSec - 1e-6; seconds += segDur) boundaries.push(seconds);
              }
              boundaries.push(totalSec);
              let targetDuration = 0;
              for (let i = 1; i < boundaries.length; i++) targetDuration = Math.max(targetDuration, boundaries[i]! - boundaries[i - 1]!);
              if (hlsPlaylistType) hlsListSize = 0;
              const firstSegment = hlsListSize === 0 ? 0 : Math.max(0, boundaries.length - 1 - hlsListSize);
              const independentSegments = hlsIndependentSegments && !hlsSplitByTime && !!vTrk && workingDoc.tracks
                .filter(track => track.type === "video")
                .every(track => boundaries.slice(firstSegment, -1).every((start, index) => {
                  const first = track.samples.find(sample => sample.dts >= start * track.timescale);
                  return first?.isKeyframe && first.dts < boundaries[firstSegment + index + 1]! * track.timescale;
                }));
              const playlistLines: string[] = [
                "#EXTM3U",
                isFmp4 ? "#EXT-X-VERSION:7" : independentSegments ? "#EXT-X-VERSION:6" : hlsSingleFile ? "#EXT-X-VERSION:4" : hlsRoundDurations ? "#EXT-X-VERSION:2" : "#EXT-X-VERSION:3",
                `#EXT-X-TARGETDURATION:${Math.ceil(targetDuration)}`,
                `#EXT-X-MEDIA-SEQUENCE:${(outputStartNumber ?? 0) + firstSegment}`
              ];

              if (hlsPlaylistType) playlistLines.push(`#EXT-X-PLAYLIST-TYPE:${hlsPlaylistType.toUpperCase()}`);
              if (independentSegments) playlistLines.push("#EXT-X-INDEPENDENT-SEGMENTS");
              if (isFmp4 && !hlsSingleFile) playlistLines.push(`#EXT-X-MAP:URI="${hlsFmp4InitFilename}"`);

              const singleFileChunks: Uint8Array[] = [];
              let singleFileSize = 0;
              let singleFilePath = "";
              const retainedSegments: { path: string; duration: number }[] = [];
              const mediaOffsets = workingDoc.tracks.map(track => {
                let offset = 0;
                for (const edit of track.editList ?? []) {
                  if (edit.mediaTime < 0) offset -= edit.segmentDuration / workingDoc.timescale;
                  else { offset += edit.mediaTime / track.timescale; break; }
                }
                return offset;
              });
              const referenceOffset = mediaOffsets[vTrk ? workingDoc.tracks.indexOf(vTrk) : 0] ?? 0;
              const timestampShift = Math.max(0, ...workingDoc.tracks.map((track, index) =>
                mediaOffsets[index]! - (track.samples[0]?.dts ?? 0) / track.timescale));
              for (let sIdx = 0; sIdx < boundaries.length - 1; sIdx++) {
                const st = boundaries[sIdx]!;
                const en = boundaries[sIdx + 1]!;
                const actualDur = Math.max(0.04, en - st);
                // Compare decode times on the reference track's timeline, retaining priming and tail packets.
                const segmentDoc = {
                  ...workingDoc,
                  tracks: workingDoc.tracks.map((track, index) => {
                    const offset = mediaOffsets[index]! - referenceOffset;
                    // fMP4 carries priming as media; shift every stream together to avoid negative decode times.
                    const shift = isFmp4 ? Math.round((timestampShift - mediaOffsets[index]!) * track.timescale) : 0;
                    return {
                      ...track,
                      editList: isFmp4 ? undefined : track.editList,
                      samples: track.samples.filter(sample =>
                        (sIdx === 0 || sample.dts >= (st + offset) * track.timescale) &&
                        (sIdx === boundaries.length - 2 || sample.dts < (en + offset) * track.timescale))
                        .map(sample => shift ? { ...sample, dts: sample.dts + shift, pts: sample.pts + shift } : sample)
                    };
                  })
                };
                let segBytes = segPlugin.serialize(segmentDoc, {
                  fragmented: isFmp4,
                  limits: options.limits,
                  budget
                });

                const formattedSeg = hlsSingleFile ? segPattern : formatImageSequence(segPattern, sIdx + (outputStartNumber ?? 0))!;
                const fullSegPath = resolvePath(hlsSegmentFilename === undefined ? outDir : context.cwd, formattedSeg);
                const relSegName = fullSegPath.startsWith(outDir === "/" ? "/" : `${outDir}/`)
                  ? fullSegPath.slice(outDir === "/" ? 1 : outDir.length + 1)
                  : formattedSeg;

                if (isFmp4) {
                  const moof = parseMp4Boxes(segBytes, 0, 0, budget).find(box => box.type === "moof");
                  if (!moof) throw new Error("HLS fMP4 output requires fragmented MP4 samples");
                  if (sIdx === 0) {
                    const init = segBytes.subarray(0, moof.offset);
                    if (hlsSingleFile) {
                      singleFileChunks.push(init);
                      singleFileSize = init.byteLength;
                      playlistLines.push(`#EXT-X-MAP:URI="${relSegName}",BYTERANGE="${singleFileSize}@0"`);
                    } else {
                      await context.fs.mkdir(outDir, { recursive: true, signal: context.signal });
                      await writeFileOutput(context, init, data =>
                        context.fs.writeFile(resolvePath(outDir, hlsFmp4InitFilename), data, { signal: context.signal }));
                    }
                  }
                  segBytes = segBytes.subarray(moof.offset);
                }

                if (hlsSingleFile) {
                  budget.checkOutputBytes(singleFileSize + segBytes.byteLength);
                  singleFilePath = fullSegPath;
                  singleFileChunks.push(segBytes);
                } else {
                  budget.checkOutputBytes(segBytes.byteLength);
                  await context.fs.mkdir(fullSegPath.slice(0, fullSegPath.lastIndexOf("/")) || "/", { recursive: true, signal: context.signal });
                  await writeFileOutput(context, segBytes, data => context.fs.writeFile(fullSegPath, data, { signal: context.signal }));
                }
                if (sIdx >= firstSegment) {
                  if (hlsDiscontStart && sIdx === 0) playlistLines.push("#EXT-X-DISCONTINUITY");
                  playlistLines.push(`#EXTINF:${hlsRoundDurations ? Math.round(actualDur) : actualDur.toFixed(6)},`);
                  if (hlsSingleFile) playlistLines.push(`#EXT-X-BYTERANGE:${segBytes.byteLength}@${singleFileSize}`);
                  playlistLines.push(hlsBaseUrl + relSegName);
                }
                if (hlsSingleFile) singleFileSize += segBytes.byteLength;
                if (!hlsSingleFile && hlsDeleteSegments && hlsListSize > 0) {
                  retainedSegments.push({ path: fullSegPath, duration: actualDur });
                  const expiredCount = retainedSegments.length - hlsListSize;
                  if (expiredCount > 0) {
                    // FFmpeg retains expired segments until either the count threshold or
                    // one playlist duration plus the newest expired segment is reached.
                    const playlistDuration = boundaries[sIdx + 1]! - boundaries[sIdx + 1 - hlsListSize]!;
                    const retentionDuration = playlistDuration + retainedSegments[expiredCount - 1]!.duration;
                    let duration = 0;
                    let count = 0;
                    for (let i = expiredCount - 1; i >= 0; i--) {
                      duration += retainedSegments[i]!.duration;
                      count++;
                      if (count >= hlsDeleteThreshold || duration >= retentionDuration) break;
                    }
                    for (const segment of retainedSegments.splice(0, expiredCount - count)) {
                      await context.fs.rm(segment.path, { signal: context.signal });
                    }
                  }
                }
              }

              if (hlsSingleFile) {
                if (!overwrite) {
                  try {
                    await context.fs.stat(singleFilePath, { signal: context.signal });
                    throw new Error(`File '${singleFilePath}' already exists. Exiting.`);
                  } catch (error) {
                    rethrowRuntimeError(context, error);
                    if ((error as { code?: string }).code !== "ENOENT") throw error;
                  }
                }
                const bytes = concatBytes(singleFileChunks);
                await context.fs.mkdir(singleFilePath.slice(0, singleFilePath.lastIndexOf("/")) || "/", { recursive: true, signal: context.signal });
                await writeFileOutput(context, bytes, data => context.fs.writeFile(singleFilePath, data, { signal: context.signal }));
              }

              if (!hlsOmitEndlist) playlistLines.push("#EXT-X-ENDLIST");
              playlistLines.push("");
              const m3u8Bytes = encodeUtf8(playlistLines.join("\n"));
              await context.fs.mkdir(outDir, { recursive: true, signal: context.signal });
              await writeFileOutput(context, m3u8Bytes, data => context.fs.writeFile(outResolved, data, { signal: context.signal }));
              options.onMetrics?.(budget.getStats());
              return { exitCode: decodeExitCode };
            }

            if (imageOutput && maxVideoFrames === 0) {
              options.onMetrics?.(budget.getStats());
              return { exitCode: decodeExitCode };
            }

            if (imageOutput && videoCodec === "copy") {
              const track = workingDoc.tracks.find(track => track.type === "video");
              const samples = track?.samples ?? [];
              if (!samples.length) throw new Error("No video packet in the requested presentation interval");
              const limit = Math.min(samples.length, maxVideoFrames ?? Infinity);
              for (let index = 0; index < limit; index++) {
                const number = framePts ? samples[index]!.pts : index + (outputStartNumber ?? 1);
                const fileName = updateImage ? outputTarget : (formatImageSequence(outputTarget, number) ?? outputTarget);
                if (index > 0 && fileName === outputTarget && !updateImage && !isStdout(outputTarget)) {
                  throw new Error("Cannot write more than one file with the same name. Use a numbered pattern or -update 1.");
                }
                const bytes = samples[index]!.data;
                budget.checkSamples(index + 1);
                budget.checkOutputBytes(bytes.byteLength);
                if (isStdout(outputTarget)) await writeBytes(context.stdout, bytes, context.signal);
                else await writeFileOutput(context, bytes, data => context.fs.writeFile(resolvePath(context.cwd, fileName), data, { signal: context.signal }));
              }
              options.onMetrics?.(budget.getStats());
              return { exitCode: decodeExitCode };
            }

            if (imageOutput && !workingDoc.tracks.some(track => track.type === "video" && track.decodedVideoFrames?.length)) {
              throw new Error("No video frame in the requested presentation interval");
            }

            // Image files share frame processing and encoding.
            const numberedImageOutput = formatImageSequence(outputTarget, outputStartNumber ?? 1) !== undefined;
            if ((imageOutput && !isStdout(outputTarget)) || numberedImageOutput) {
              const outExt = outputTarget.split(".").pop()?.toLowerCase() ?? "png";
              const imgPlugin = registry.findByFilename(`x.${outExt}`);
              if (!imgPlugin || !imgPlugin.canMux) {
                throw new Error(`Unsupported output format for '${outputTarget}' (AST not registered)`);
              }
              const vTrack = workingDoc.tracks.find((t) => t.type === "video");
              const frames = vTrack ? await ensureDecodedFrames(vTrack, workingDoc.timescale, budget, context.signal) : [];
              const limit = maxVideoFrames ?? Infinity;
              const duration = frames[0]?.durationSeconds ?? 1;
              const constantRate = ["auto", "-1", "cfr", "1"].includes(videoSync);
              let nextPts = (frames[0]?.ptsSeconds ?? 0) / duration;
              let idx = 0;
              const imgFmt: ImageFormat =
                outExt === "jpg" || outExt === "jpeg" ? "jpeg" :
                outExt === "webp" ? "webp" :
                outExt === "gif" ? "gif" :
                outExt === "bmp" ? "bmp" :
                outExt === "ppm" ? "ppm" : "png";

              for (let sourceIndex = 0; sourceIndex < frames.length && idx < limit; sourceIndex++) {
                const source = frames[sourceIndex]!;
                const delta0 = source.ptsSeconds / duration - nextPts;
                const delta = delta0 + source.durationSeconds / duration;
                // Match FFmpeg's CFR thresholds, including its tolerance for close timestamps.
                const copies = constantRate ? (delta < -1.1 ? 0 : delta > 1.1 ? Math.round(delta) : 1) : 1;
                const previousCopies = constantRate && delta0 > 1.1 ? Math.max(0, Math.round(delta0 - 0.6)) : 0;
                if (!Number.isSafeInteger(copies)) throw new Error("Invalid output frame timestamp");
                for (let copy = 0; copy < copies && idx < limit; copy++, idx++, nextPts++) {
                  if (idx > 0 && !numberedImageOutput && !updateImage) {
                    throw new Error("Cannot write more than one file with the same name. Use a numbered pattern or -update 1.");
                  }
                  budget.checkCpu();
                  budget.checkSamples(idx + 1);
                  budget.checkDuration((idx + 1) * duration);
                  const f = copy < previousCopies && sourceIndex > 0 ? frames[sourceIndex - 1]! : source;
                  if (copy > 0) budget.recordFrame(f.width, f.height);
                  const number = framePts
                    ? Math.round(constantRate ? nextPts : source.ptsSeconds / duration)
                    : idx + (outputStartNumber ?? 1);
                  const fileName = updateImage ? outputTarget : (formatImageSequence(outputTarget, number) ?? outputTarget);
                  const fullOutPath = resolvePath(context.cwd, fileName);
                  const encoded = (await yieldTurn(context.signal), context.signal?.throwIfAborted(), encodeImage(makeRgbaImg(f.width, f.height, f.data), {
                    format: imgFmt
                  })).data;
                  budget.checkOutputBytes(encoded.byteLength);
                  await writeFileOutput(context, encoded, data => context.fs.writeFile(fullOutPath, data, { signal: context.signal }));
                }
              }
              options.onMetrics?.(budget.getStats());
              return { exitCode: decodeExitCode };
            }

            const frameChecksumOutput = outputFormat === "framemd5" || outputFormat === "framehash" || outputFormat === "framecrc";
            const checksumOutput = frameChecksumOutput || outputFormat === "streamhash" || outputFormat === "hash" || outputFormat === "md5" || outputFormat === "crc";
            if (!checksumOutput && (!outPlugin || !outPlugin.canMux)) {
              const fmtDesc = outputFormat ?? outputTarget;
              throw new Error(
                `Unable to find a suitable output format for '${fmtDesc}' (format AST not registered)`
              );
            }

            { const gc = (globalThis as { gc?: () => void }).gc; if (typeof gc === "function") { gc(); gc(); } }
            const outExt = outputTarget.split(".").pop()?.toLowerCase();
            validateStreamCopy(workingDoc, outPlugin?.id ?? outputFormat!, { video: videoCodec, audio: audioCodec, subtitle: subtitleCodec });
            validateSubtitleEncoder(subtitleCodec, workingDoc, outPlugin?.id ?? outputFormat!);
            const serializedBytes = checksumOutput
              ? (frameChecksumOutput ? serializeFrameChecksum : serializeAudioChecksum)(workingDoc, outputFormat!, hashAlgorithm, audioCodec, registry.findByFormatName("s16le"), budget)
              : outPlugin!.serialize(workingDoc, {
              format: outputFormat ?? outExt,
              writeBext,
              rf64,
              writePeak,
              audioCodec,
              audioBitrate,
              compressionLevel,
              sampleFormat,
              writeXing,
              faststart,
              fragmented,
              id3v2Version,
              writeId3v1,
              metadataHeaderPadding,
              pageDuration,
              serialOffset,
              metadata: metaTags,
              limits: options.limits,
              budget
            });
            for (const trk of workingDoc.tracks) {
              if (trk.decodedVideoFrames) {
                for (const f of trk.decodedVideoFrames) detachBytesBuffer(f.data);
              }
              if (trk.samples) {
                for (const s of trk.samples) detachBytesBuffer(s.data);
              }
            }

            budget.checkOutputBytes(serializedBytes.byteLength);

            if (isStdout(outputTarget)) {
              await writeBytes(context.stdout, serializedBytes, context.signal);
            } else if (outputTarget !== "/dev/null") {
              const fullOutPath = resolvePath(context.cwd, outputTarget);
              await writeFileOutput(context, serializedBytes, data => context.fs.writeFile(fullOutPath, data, { signal: context.signal }));
            }

            options.onMetrics?.(budget.getStats());
            return { exitCode: decodeExitCode };
          } catch (err) {
            rethrowRuntimeError(context, err);
            const msg = err instanceof Error ? err.message : String(err);
            await writeBytes(context.stderr, encodeUtf8(`ffmpeg: ${msg}\n`), context.signal);
            return { exitCode: 1 };
          } finally {
            const gc = (globalThis as { gc?: () => void }).gc;
            if (typeof gc === "function") { gc(); gc(); }
          }
        });
      }
      if (outputs.length === 0) {
        await writeBytes(context.stderr, encodeUtf8("ffmpeg: must specify an output file\n"), context.signal);
        return { exitCode: 1 };
      }
      for (const output of outputs) {
        const result = await output();
        if (result.exitCode !== 0) return result;
      }
      if (abortOnEmptyOutput && !hasOutputFrames) {
        await writeBytes(context.stderr, encodeUtf8("ffmpeg: Nothing was written into output file, because at least one of its streams received no packets.\n"), context.signal);
        return { exitCode: 234 };
      }
      if (progressTarget !== undefined && !(exitOnError && inputReadFailed)) {
        const microseconds = Math.round(progressSeconds * 1_000_000);
        const seconds = Math.floor(microseconds / 1_000_000);
        const time = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
          .map(value => String(value).padStart(2, "0")).join(":") +
          "." + String(microseconds % 1_000_000).padStart(6, "0");
        await writeBytes(context.stdout, encodeUtf8([
          "bitrate=N/A", "total_size=N/A", `out_time_us=${microseconds}`,
          `out_time_ms=${microseconds}`, `out_time=${time}`, "dup_frames=0",
          "drop_frames=0", "speed=N/A", "progress=end", ""
        ].join("\n")), context.signal);
      }
      return { exitCode: exitOnError && inputReadFailed ? 1 : 0 };
    }
  };
}

export type FfmpegCommandPair = readonly [CommandDefinition, CommandDefinition] & {
  readonly ffmpeg: CommandDefinition;
  readonly ffprobe: CommandDefinition;
};

export function createFfmpegCommands(
  options: FfmpegCommandsOptions = {}
): FfmpegCommandPair {
  const ffmpeg = createFfmpegCommand(options);
  const ffprobe = createFfprobeCommand(options);
  return Object.assign([ffmpeg, ffprobe] as const, { ffmpeg, ffprobe });
}

export function ffmpegCommands(options: FfmpegCommandsOptions = {}): VirtualShellPlugin {
  const definitions = createFfmpegCommands(options);
  return {
    name: "ffmpeg-commands",
    setup(host) {
      if (!options.replace) {
        for (const definition of definitions) {
          if (host.commands.has(definition.name)) {
            throw new Error(`Command already registered: ${definition.name}`);
          }
        }
      }
      for (const definition of definitions) {
        host.commands.register(definition, { replace: options.replace ?? false });
      }
    }
  };
}

async function mapWork<T, R>(items: readonly T[], transform: (item: T, index: number) => R | Promise<R>, signal?: AbortSignal): Promise<R[]> {
  const result: R[] = [];
  for (let index = 0; index < items.length; index++) {
    await yieldTurn(signal);
    signal?.throwIfAborted();
    result.push(await transform(items[index]!, index));
  }
  return result;
}

async function muxMp4Cooperatively(sources: readonly MediaDocument[], options: MuxMediaOptions, signal?: AbortSignal): Promise<MediaDocument> {
  const work = muxMp4Steps(sources, options);
  try {
    let step = work.next();
    while (!step.done) {
      await yieldTurn(signal);
      signal?.throwIfAborted();
      step = work.next();
    }
    return step.value;
  } finally { work.return(undefined as unknown as MediaDocument); }
}
