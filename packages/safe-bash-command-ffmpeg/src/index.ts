import {
  commandRuntimeIdentity,
  getCommandArguments,
  type CommandContext,
  type CommandDefinition
} from "safe-bash-contracts/command";
import { readBytes, writeBytes } from "safe-bash-contracts/io";
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
} from "@poe-code/image-ast";
import {
  allMediaAsts,
  cloudflareWorkerLimits,
  concatMp4,
  createMediaAstRegistry,
  createSyntheticMp4,
  decodeH264FrameToRgba,
  decodeUtf8,
  encodeUtf8,
  parseSubtitleDocument,
  srtAst,
  webvttAst,
  ffmetadataAst,
  hlsAst,
  dashAst,
  MediaBudgetTracker,
  MediaLimitExceededError,
  muxMp4,
  parseMp4,
  sliceMp4,
  type MediaAstPlugin,
  type MediaAudioData,
  type MediaDocument,
  type MediaFeatureOptions,
  type MediaProbeResult,
  type MediaResourceLimits,
  type MediaTrack,
  type MediaVideoFrame,
  type Mp4MetadataTags
} from "@poe-code/mp4-ast";

export {
  allMediaAsts,
  cloudflareWorkerLimits,
  srtAst,
  webvttAst,
  ffmetadataAst,
  hlsAst,
  dashAst,
  MediaBudgetTracker,
  MediaLimitExceededError,
  type MediaAstPlugin,
  type MediaFeatureOptions,
  type MediaResourceLimits
};

export interface FfmpegCommandsOptions {
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

async function readStdinAll(context: CommandContext): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of readBytes(context.stdin, context.signal)) {
    chunks.push(chunk);
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

function resolvePath(cwd: string, p: string): string {
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

function parseColorRgba(colorStr: string): [number, number, number, number] {
  const s = colorStr.trim().toLowerCase();
  const named: Record<string, [number, number, number, number]> = {
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
  if (named[s]) return named[s]!;
  const hex = s.startsWith("#") ? s.slice(1) : s.startsWith("0x") ? s.slice(2) : "";
  if (hex.length === 6) {
    return [
      parseInt(hex.slice(0, 2), 16) || 0,
      parseInt(hex.slice(2, 4), 16) || 0,
      parseInt(hex.slice(4, 6), 16) || 0,
      255
    ];
  }
  return [40, 120, 220, 255];
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

function parseLavfiSource(
  spec: string,
  budget: MediaBudgetTracker,
  durationOverride?: number
): MediaDocument {
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
    const kIdx = part.indexOf("=");
    if (kIdx >= 0) {
      kv[part.slice(0, kIdx).trim().toLowerCase()] = part.slice(kIdx + 1).trim();
    } else if (part.trim()) {
      kv._0 = part.trim();
    }
  }

  if (filterName === "sine" || filterName === "anullsrc") {
    const sampleRate = parseInt(kv.sample_rate ?? kv.r ?? "44100", 10) || 44100;
    const freq = parseFloat(kv.frequency ?? kv.f ?? "440") || 440;
    const duration =
      durationOverride ?? (parseFloat(kv.duration ?? kv.d ?? "1") || 1);
    const channels = (kv.channel_layout ?? kv.cl) === "mono" ? 1 : 2;
    const totalSamples = Math.max(1024, Math.round(duration * sampleRate));
    budget.checkDuration(duration);

    const channelData = Array.from({ length: channels }, () => {
      const arr = new Float32Array(totalSamples);
      if (filterName === "sine") {
        for (let i = 0; i < totalSamples; i++) {
          arr[i] = Math.sin((2 * Math.PI * freq * i) / sampleRate) * 0.5;
        }
      }
      return arr;
    });

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

  const frames: MediaVideoFrame[] = [];
  for (let i = 0; i < frameCount; i++) {
    budget.recordFrame(width, height);
    const rgba = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        if (filterName.startsWith("testsrc") || filterName === "smptebars") {
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
          rgba[idx] = (r + i * 12) & 0xff;
          rgba[idx + 1] = g;
          rgba[idx + 2] = b;
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

  const mp4Bytes = createSyntheticMp4({
    width,
    height,
    fps,
    frameCount,
    color: [color[0], color[1], color[2]],
    includeAudio: false
  });
  const parsed = parseMp4(mp4Bytes);
  return {
    ...parsed,
    tracks: parsed.tracks.map((t) =>
      t.type === "video" ? { ...t, decodedVideoFrames: frames } : t
    )
  };
}

function ensureDecodedFrames(
  track: MediaTrack,
  budget: MediaBudgetTracker
): MediaVideoFrame[] {
  if (track.decodedVideoFrames && track.decodedVideoFrames.length > 0) {
    return [...track.decodedVideoFrames];
  }
  const width = track.width ?? track.codecDescriptions[0]?.width ?? 64;
  const height = track.height ?? track.codecDescriptions[0]?.height ?? 64;
  const ts = track.timescale || 90000;
  const lengthSize = (track.codecDescriptions[0]?.avcC?.lengthSizeMinusOne ?? 3) + 1;

  return track.samples.map((s) => {
    budget.recordFrame(width, height);
    return {
      width,
      height,
      data: decodeH264FrameToRgba(s.data, width, height, lengthSize),
      ptsSeconds: s.pts / ts,
      durationSeconds: s.duration / ts,
      keyframe: s.isKeyframe
    };
  });
}

function evalScaleDim(expr: string, iw: number, ih: number): number {
  const clean = expr.trim().toLowerCase();
  if (clean === "-1" || clean === "-2") return -1;
  if (clean === "iw" || clean === "in_w") return iw;
  if (clean === "ih" || clean === "in_h") return ih;
  if (clean.startsWith("iw/")) return Math.max(2, Math.round(iw / (parseFloat(clean.slice(3)) || 1)));
  if (clean.startsWith("ih/")) return Math.max(2, Math.round(ih / (parseFloat(clean.slice(3)) || 1)));
  if (clean.startsWith("iw*")) return Math.max(2, Math.round(iw * (parseFloat(clean.slice(3)) || 1)));
  if (clean.startsWith("ih*")) return Math.max(2, Math.round(ih * (parseFloat(clean.slice(3)) || 1)));
  return parseInt(clean, 10) || iw;
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

function renderBitmapTextToRgba(
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
  } = {}
): Uint8Array {
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
      for (let x = Math.max(0, startX - pad); x < Math.min(width, startX + textW + pad); x++) {
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
    const line = lines[lineIdx]!.toUpperCase();
    const lineY = startY + lineIdx * charH;
    for (let cIdx = 0; cIdx < line.length; cIdx++) {
      const ch = line[cIdx]!;
      const rows = GLYPH_5X7[ch] ?? GLYPH_5X7["?"];
      if (!rows) continue;
      const charX = startX + cIdx * charW;
      for (let r = 0; r < 7; r++) {
        const mask = rows[r]!;
        for (let col = 0; col < 5; col++) {
          if ((mask & (1 << (4 - col))) === 0) continue;
          for (let sy = 0; sy < scale; sy++) {
            for (let sx = 0; sx < scale; sx++) {
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

function applyVideoFilterChain(
  frames: MediaVideoFrame[],
  filterChainStr: string,
  budget: MediaBudgetTracker,
  subtitleCues?: readonly { startSec: number; endSec: number; text: string }[]
): MediaVideoFrame[] {
  let current = frames;
  if (current.length === 0) return current;

  const filters = filterChainStr
    .split(",")
    .map((f) => f.trim())
    .filter(Boolean);

  for (const filterSpec of filters) {
    budget.checkCpu();
    const eqIdx = filterSpec.indexOf("=");
    const name = (eqIdx >= 0 ? filterSpec.slice(0, eqIdx) : filterSpec).trim().toLowerCase();
    const argStr = eqIdx >= 0 ? filterSpec.slice(eqIdx + 1).trim() : "";
    const positional = argStr.split(":");
    const named: Record<string, string> = {};
    for (const part of positional) {
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
        targetW = Math.max(2, Math.round((iw * targetH) / Math.max(1, ih)));
        if (wSpec.trim() === "-2" && targetW % 2 !== 0) targetW++;
      } else if (targetH < 0 && targetW > 0) {
        targetH = Math.max(2, Math.round((ih * targetW) / Math.max(1, iw)));
        if (hSpec.trim() === "-2" && targetH % 2 !== 0) targetH++;
      }
      targetW = Math.max(2, targetW);
      targetH = Math.max(2, targetH);

      current = current.map((f) => {
        budget.recordFrame(targetW, targetH);
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
      });
    } else if (name === "crop") {
      const iw = current[0]!.width;
      const ih = current[0]!.height;
      const cw = Math.min(iw, Math.max(1, evalScaleDim(named.w ?? positional[0] ?? String(iw), iw, ih)));
      const ch = Math.min(ih, Math.max(1, evalScaleDim(named.h ?? positional[1] ?? String(ih), iw, ih)));
      const cx = Math.max(
        0,
        Math.min(iw - cw, parseInt(named.x ?? positional[2] ?? String(Math.floor((iw - cw) / 2)), 10) || 0)
      );
      const cy = Math.max(
        0,
        Math.min(ih - ch, parseInt(named.y ?? positional[3] ?? String(Math.floor((ih - ch) / 2)), 10) || 0)
      );
      current = current.map((f) => {
        const cropped = extractImage(makeRgbaImg(f.width, f.height, f.data), {
          left: cx,
          top: cy,
          width: cw,
          height: ch
        });
        return {
          ...f,
          width: cropped.width,
          height: cropped.height,
          data: cropped.data
        };
      });
    } else if (name === "pad") {
      const iw = current[0]!.width;
      const ih = current[0]!.height;
      const pw = Math.max(iw, evalScaleDim(named.w ?? named.width ?? positional[0] ?? String(iw), iw, ih));
      const ph = Math.max(ih, evalScaleDim(named.h ?? named.height ?? positional[1] ?? String(ih), iw, ih));
      const px = Math.max(0, Math.min(pw - iw, parseInt(named.x ?? positional[2] ?? "0", 10) || 0));
      const py = Math.max(0, Math.min(ph - ih, parseInt(named.y ?? positional[3] ?? "0", 10) || 0));
      const col = parseColorRgba(named.color ?? positional[4] ?? "black");
      current = current.map((f) => {
        const padded = extendImage(makeRgbaImg(f.width, f.height, f.data), {
          left: px,
          top: py,
          right: Math.max(0, pw - iw - px),
          bottom: Math.max(0, ph - ih - py),
          background: { r: col[0], g: col[1], b: col[2], a: 255 },
          extendWith: "background"
        });
        return {
          ...f,
          width: padded.width,
          height: padded.height,
          data: padded.data
        };
      });
    } else if (name === "hflip") {
      current = current.map((f) => {
        const out = flopImage(makeRgbaImg(f.width, f.height, f.data));
        return { ...f, data: out.data };
      });
    } else if (name === "vflip") {
      current = current.map((f) => {
        const out = flipImage(makeRgbaImg(f.width, f.height, f.data));
        return { ...f, data: out.data };
      });
    } else if (name === "transpose" || name === "rotate") {
      const dir = named.dir ?? positional[0] ?? "1";
      const angle = name === "transpose" ? (dir === "2" ? 270 : 90) : 90;
      current = current.map((f) => {
        const out = rotateImage(makeRgbaImg(f.width, f.height, f.data), angle);
        return {
          ...f,
          width: out.width,
          height: out.height,
          data: out.data
        };
      });
    } else if (name === "negate") {
      current = current.map((f) => {
        const out = negateImage(makeRgbaImg(f.width, f.height, f.data));
        return { ...f, data: out.data };
      });
    } else if (name === "format" && argStr.includes("gray")) {
      current = current.map((f) => {
        const out = grayscaleImage(makeRgbaImg(f.width, f.height, f.data));
        return { ...f, data: out.data };
      });
    } else if (name === "fps") {
      const targetFps = parseFloat(named.fps ?? positional[0] ?? "25") || 25;
      const totalDuration = current.reduce((acc, f) => acc + f.durationSeconds, 0) || 1;
      const targetCount = Math.max(1, Math.round(totalDuration * targetFps));
      const resampled: MediaVideoFrame[] = [];
      for (let i = 0; i < targetCount; i++) {
        const srcIdx = Math.min(
          current.length - 1,
          Math.floor((i / targetCount) * current.length)
        );
        const src = current[srcIdx]!;
        resampled.push({
          ...src,
          ptsSeconds: i / targetFps,
          durationSeconds: 1 / targetFps
        });
      }
      current = resampled;
    } else if (name === "trim") {
      const st = parseFfmpegTimestamp(named.start ?? positional[0] ?? "0");
      const end = named.end ? parseFfmpegTimestamp(named.end) : Infinity;
      const dur = named.duration ? parseFfmpegTimestamp(named.duration) : undefined;
      const finalEnd = dur !== undefined ? st + dur : end;
      current = current
        .filter((f) => f.ptsSeconds + f.durationSeconds > st && f.ptsSeconds < finalEnd)
        .map((f) => ({ ...f, ptsSeconds: Math.max(0, f.ptsSeconds - st) }));
    } else if (name === "drawtext") {
      const rawText = (named.text ?? positional[0] ?? "").replace(/^['"]|['"]$/g, "");
      const fontSize = parseInt(named.fontsize ?? "12", 10) || 12;
      const fontColor = parseColorRgba(named.fontcolor ?? "white");
      const drawBox = named.box === "1" || named.box === "true";
      const boxColor = parseColorRgba(named.boxcolor ?? "black");
      current = current.map((f, fIdx) => {
        const expanded = rawText
          .replace(/%\{frame_num\}/g, String(fIdx))
          .replace(/%\{n\}/g, String(fIdx))
          .replace(/%\{pts\}/g, f.ptsSeconds.toFixed(2));
        return {
          ...f,
          data: renderBitmapTextToRgba(f.data, f.width, f.height, expanded, {
            xExpr: named.x ?? "4",
            yExpr: named.y ?? "4",
            fontSize,
            fontColor,
            drawBox,
            boxColor
          })
        };
      });
    } else if (name === "subtitles") {
      const cues = subtitleCues ?? [];
      current = current.map((f) => {
        const active = cues.filter((c) => f.ptsSeconds >= c.startSec && f.ptsSeconds <= c.endSec);
        if (active.length === 0) return f;
        const cueStr = active.map((c) => c.text).join("\n");
        return {
          ...f,
          data: renderBitmapTextToRgba(f.data, f.width, f.height, cueStr, {
            xExpr: "(w-text_w)/2",
            yExpr: "h-text_h-4",
            fontSize: 10,
            fontColor: [255, 255, 255, 255],
            drawBox: true,
            boxColor: [0, 0, 0, 180]
          })
        };
      });
    } else if (name === "tile") {
      const layoutStr = (named.layout ?? positional[0] ?? "2x2").toLowerCase();
      const [colsStr, rowsStr] = layoutStr.split("x");
      const cols = Math.max(1, parseInt(colsStr ?? "2", 10) || 2);
      const rows = Math.max(1, parseInt(rowsStr ?? "2", 10) || 2);
      const padding = parseInt(named.padding ?? "0", 10) || 0;
      const margin = parseInt(named.margin ?? "0", 10) || 0;
      const perTile = cols * rows;
      const tiledFrames: MediaVideoFrame[] = [];
      for (let base = 0; base < current.length; base += perTile) {
        const batch = current.slice(base, base + perTile);
        const fw = batch[0]?.width ?? 64;
        const fh = batch[0]?.height ?? 64;
        const outW = margin * 2 + cols * fw + Math.max(0, cols - 1) * padding;
        const outH = margin * 2 + rows * fh + Math.max(0, rows - 1) * padding;
        const canvas = new Uint8Array(outW * outH * 4);
        for (let i = 3; i < canvas.byteLength; i += 4) canvas[i] = 255;
        for (let k = 0; k < batch.length; k++) {
          const tileFrame = batch[k]!;
          const c = k % cols;
          const r = Math.floor(k / cols);
          const ox = margin + c * (fw + padding);
          const oy = margin + r * (fh + padding);
          for (let y = 0; y < Math.min(fh, tileFrame.height); y++) {
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
      const expr = (named.e ?? named.expr ?? positional[0] ?? "1").replace(/^['"]|['"]$/g, "");
      current = current.filter((f, idx) => {
        if (expr.includes("not(mod(n,")) {
          const m = /not\(mod\(n,\s*(\d+)\)\)/.exec(expr);
          const step = Math.max(1, parseInt(m?.[1] ?? "1", 10) || 1);
          return idx % step === 0;
        }
        if (expr.includes("eq(n,")) {
          const matches = [...expr.matchAll(/eq\(n,\s*(\d+)\)/g)];
          return matches.some((m) => parseInt(m[1]!, 10) === idx);
        }
        if (expr.includes("gt(t,")) {
          const m = /gt\(t,\s*([0-9.]+)\)/.exec(expr);
          return f.ptsSeconds > (parseFloat(m?.[1] ?? "0") || 0);
        }
        return true;
      });
    } else if (name === "reverse") {
      const totalDur = current.reduce((acc, f) => acc + f.durationSeconds, 0);
      let cursor = 0;
      current = [...current].reverse().map((f) => {
        const out = { ...f, ptsSeconds: cursor };
        cursor += f.durationSeconds;
        return out;
      });
      void totalDur;
    } else if (name === "setpts") {
      const expr = (named.expr ?? positional[0] ?? "PTS").toUpperCase();
      const mulMatch = /([0-9.]+)\s*\*\s*PTS/.exec(expr);
      const divMatch = /PTS\s*\/\s*([0-9.]+)/.exec(expr);
      const factor = mulMatch
        ? parseFloat(mulMatch[1]!) || 1
        : divMatch
          ? 1 / (parseFloat(divMatch[1]!) || 1)
          : 1;
      let cursor = 0;
      current = current.map((f) => {
        const dur = Math.max(0.001, f.durationSeconds * factor);
        const out = { ...f, ptsSeconds: cursor, durationSeconds: dur };
        cursor += dur;
        return out;
      });
    } else if (name === "drawbox") {
      const bx = parseInt(named.x ?? positional[0] ?? "0", 10) || 0;
      const by = parseInt(named.y ?? positional[1] ?? "0", 10) || 0;
      const bw = parseInt(named.w ?? named.width ?? positional[2] ?? "16", 10) || 16;
      const bh = parseInt(named.h ?? named.height ?? positional[3] ?? "16", 10) || 16;
      const col = parseColorRgba(named.color ?? named.c ?? positional[4] ?? "red");
      current = current.map((f) => {
        const nextData = new Uint8Array(f.data);
        for (let y = Math.max(0, by); y < Math.min(f.height, by + bh); y++) {
          for (let x = Math.max(0, bx); x < Math.min(f.width, bx + bw); x++) {
            const idx = (y * f.width + x) * 4;
            nextData[idx] = col[0];
            nextData[idx + 1] = col[1];
            nextData[idx + 2] = col[2];
            nextData[idx + 3] = 255;
          }
        }
        return { ...f, data: nextData };
      });
    }
  }

  return current;
}

function formatIntrospectionOutput(
  flag: string,
  plugins: readonly MediaAstPlugin[]
): string {
  if (flag === "-version" || flag === "--version") {
    const astIds = plugins.map((p) => p.id).join(", ");
    return [
      "ffmpeg version 7.1-safe-bash Copyright (c) 2000-2025 the FFmpeg developers",
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
    "Hyper fast Audio and Video encoder (safe-bash pure-AST engine)",
    "usage: ffmpeg [options] [[infile options] -i infile]... {[outfile options] outfile}...",
    ""
  ].join("\n");
}

function formatFfprobeResult(
  probe: MediaProbeResult,
  opts: {
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
  }
): string {
  // Filter streams by `-select_streams`
  let filteredStreams = [...probe.streams];
  if (opts.selectStreams) {
    const spec = opts.selectStreams.toLowerCase();
    if (spec === "v") {
      filteredStreams = filteredStreams.filter((s) => s.codec_type === "video");
    } else if (spec === "a") {
      filteredStreams = filteredStreams.filter((s) => s.codec_type === "audio");
    } else if (spec === "s") {
      filteredStreams = filteredStreams.filter((s) => s.codec_type === "subtitle");
    } else if (spec.startsWith("v:")) {
      const ord = parseInt(spec.slice(2), 10) || 0;
      const vList = filteredStreams.filter((s) => s.codec_type === "video");
      filteredStreams = vList[ord] ? [vList[ord]!] : [];
    } else if (spec.startsWith("a:")) {
      const ord = parseInt(spec.slice(2), 10) || 0;
      const aList = filteredStreams.filter((s) => s.codec_type === "audio");
      filteredStreams = aList[ord] ? [aList[ord]!] : [];
    } else if (/^\d+$/.test(spec)) {
      const idx = parseInt(spec, 10);
      filteredStreams = filteredStreams.filter((s) => s.index === idx);
    }
  }

  // Augment with nb_read_frames / nb_read_packets if requested
  if (opts.countFrames || opts.countPackets) {
    filteredStreams = filteredStreams.map((s) => ({
      ...s,
      ...(opts.countFrames ? { nb_read_frames: s.nb_frames ?? "0" } : {}),
      ...(opts.countPackets ? { nb_read_packets: s.nb_frames ?? "0" } : {})
    }));
  }

  // Parse `-show_entries` filter if provided
  const entryFilter = new Map<string, Set<string>>();
  if (opts.showEntries) {
    for (const secSpec of opts.showEntries.split(":")) {
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

  const finalStreams = includeStreams
    ? filteredStreams.map((s) =>
        filterObject(s as unknown as Record<string, unknown>, "stream", "stream_tags")
      )
    : undefined;
  const finalFormat = includeFormat
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
    const jsonObj: Record<string, unknown> = {};
    if (includePrograms) jsonObj.programs = [];
    if (includePackets && probe.packets) jsonObj.packets = probe.packets;
    if (includeFrames && probe.frames) jsonObj.frames = probe.frames;
    if (finalStreams !== undefined) jsonObj.streams = finalStreams;
    if (includeChapters) jsonObj.chapters = probe.chapters;
    if (finalFormat !== undefined) jsonObj.format = finalFormat;

    const compact = paramMap.c === "1" || paramMap.compact === "1";
    return (compact ? JSON.stringify(jsonObj) : JSON.stringify(jsonObj, null, 2)) + "\n";
  }

  const noWrappers =
    paramMap.noprint_wrappers === "1" || paramMap.nw === "1";
  const noKey = paramMap.nokey === "1" || paramMap.nk === "1";

  if (fmt === "csv" || fmt === "compact") {
    const sep = fmt === "csv" ? (paramMap.s ?? ",") : (paramMap.s ?? "|");
    const printSection = paramMap.p !== "0" && paramMap.print_section !== "0";
    const lines: string[] = [];

    if (finalStreams) {
      for (const s of finalStreams) {
        const vals: string[] = [];
        if (printSection) vals.push("stream");
        for (const [k, v] of Object.entries(s)) {
          if (v === undefined || typeof v === "object") continue;
          vals.push(noKey || fmt === "csv" ? String(v) : `${k}=${String(v)}`);
        }
        lines.push(vals.join(sep));
      }
    }
    if (finalFormat) {
      const vals: string[] = [];
      if (printSection) vals.push("format");
      for (const [k, v] of Object.entries(finalFormat)) {
        if (v === undefined || typeof v === "object") continue;
        vals.push(noKey || fmt === "csv" ? String(v) : `${k}=${String(v)}`);
      }
      lines.push(vals.join(sep));
    }
    return lines.join("\n") + (lines.length > 0 ? "\n" : "");
  }

  if (fmt === "flat") {
    const sep = paramMap.s ?? ".";
    const lines: string[] = [];
    if (finalStreams) {
      finalStreams.forEach((s, idx) => {
        for (const [k, v] of Object.entries(s)) {
          if (v === undefined || typeof v === "object") continue;
          lines.push(`streams${sep}stream${sep}${idx}${sep}${k}=${JSON.stringify(String(v))}`);
        }
      });
    }
    if (finalFormat) {
      for (const [k, v] of Object.entries(finalFormat)) {
        if (v === undefined || typeof v === "object") continue;
        lines.push(`format${sep}${k}=${JSON.stringify(String(v))}`);
      }
    }
    return lines.join("\n") + (lines.length > 0 ? "\n" : "");
  }

  // Default format (`[STREAM] ... [/STREAM]` and `[FORMAT] ... [/FORMAT]`)
  const lines: string[] = [];
  if (finalStreams) {
    for (const s of finalStreams) {
      if (!noWrappers) lines.push("[STREAM]");
      for (const [k, v] of Object.entries(s)) {
        if (v === undefined) continue;
        if (k === "tags" && v && typeof v === "object") {
          for (const [tk, tv] of Object.entries(v as Record<string, unknown>)) {
            lines.push(noKey ? String(tv) : `TAG:${tk}=${String(tv)}`);
          }
          continue;
        }
        if (typeof v === "object") continue;
        lines.push(noKey ? String(v) : `${k}=${String(v)}`);
      }
      if (!noWrappers) lines.push("[/STREAM]");
    }
  }

  if (includeChapters && probe.chapters.length > 0) {
    for (const ch of probe.chapters) {
      if (!noWrappers) lines.push("[CHAPTER]");
      lines.push(noKey ? String(ch.id) : `id=${ch.id}`);
      lines.push(noKey ? ch.time_base : `time_base=${ch.time_base}`);
      lines.push(noKey ? String(ch.start) : `start=${ch.start}`);
      lines.push(noKey ? ch.start_time : `start_time=${ch.start_time}`);
      lines.push(noKey ? String(ch.end) : `end=${ch.end}`);
      lines.push(noKey ? ch.end_time : `end_time=${ch.end_time}`);
      for (const [tk, tv] of Object.entries(ch.tags)) {
        lines.push(noKey ? String(tv) : `TAG:${tk}=${tv}`);
      }
      if (!noWrappers) lines.push("[/CHAPTER]");
    }
  }
  if (finalFormat) {
    if (!noWrappers) lines.push("[FORMAT]");
    for (const [k, v] of Object.entries(finalFormat)) {
      if (v === undefined) continue;
      if (k === "tags" && v && typeof v === "object") {
        for (const [tk, tv] of Object.entries(v as Record<string, unknown>)) {
          lines.push(noKey ? String(tv) : `TAG:${tk}=${String(tv)}`);
        }
        continue;
      }
      if (typeof v === "object") continue;
      lines.push(noKey ? String(v) : `${k}=${String(v)}`);
    }
    if (!noWrappers) lines.push("[/FORMAT]");
  }

  return lines.join("\n") + (lines.length > 0 ? "\n" : "");
}

export function createFfprobeCommand(options: FfmpegCommandsOptions = {}): CommandDefinition {
  const astPlugins = options.asts ?? allMediaAsts();
  const registry = createMediaAstRegistry(astPlugins);

  return {
    name: "ffprobe",
    runtimeIdentity: commandRuntimeIdentity,
    description: "Multimedia stream analyzer powered by pluggable ASTs",
    async execute(context: CommandContext) {
      const budget = new MediaBudgetTracker(options.limits);
      const argsObj = getCommandArguments(context);
      const args = argsObj.args;

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
            encodeUtf8(formatIntrospectionOutput(arg, astPlugins)),
            context.signal
          );
          return { exitCode: 0 };
        }
      }

      let printFormat = "default";
      let showFormat = false;
      let showStreams = false;
      let showPackets = false;
      let showFrames = false;
      let showChapters = false;
      let showPrograms = false;
      let selectStreams: string | undefined;
      let showEntries: string | undefined;
      let countFrames = false;
      let countPackets = false;
      let explicitFormat: string | undefined;
      let inputTarget: string | undefined;

      for (let i = 0; i < args.length; i++) {
        const arg = args[i]!;
        if (arg === "-v" || arg === "-loglevel") {
          i++;
        } else if (arg === "-hide_banner") {
          // no-op
        } else if (arg === "-print_format" || arg === "-of") {
          printFormat = args[++i] ?? "default";
        } else if (arg === "-show_format") {
          showFormat = true;
        } else if (arg === "-show_streams") {
          showStreams = true;
        } else if (arg === "-show_packets") {
          showPackets = true;
        } else if (arg === "-show_frames") {
          showFrames = true;
        } else if (arg === "-show_chapters") {
          showChapters = true;
        } else if (arg === "-show_programs") {
          showPrograms = true;
        } else if (arg === "-count_frames") {
          countFrames = true;
        } else if (arg === "-count_packets") {
          countPackets = true;
        } else if (arg === "-select_streams") {
          selectStreams = args[++i];
        } else if (arg === "-show_entries") {
          showEntries = args[++i];
        } else if (arg === "-f") {
          explicitFormat = args[++i];
        } else if (arg === "-i") {
          inputTarget = args[++i];
        } else if (!arg.startsWith("-") || arg === "-") {
          inputTarget = arg;
        }
      }

      if (!showFormat && !showStreams && !showPackets && !showFrames && !showChapters && !showEntries) {
        showFormat = true;
        showStreams = true;
      }

      if (!inputTarget) {
        await writeBytes(
          context.stderr,
          encodeUtf8("ffprobe: must specify an input file\n"),
          context.signal
        );
        return { exitCode: 1 };
      }

      try {
        let bytes: Uint8Array;
        if (inputTarget === "-" || inputTarget === "pipe:" || inputTarget === "pipe:0") {
          bytes = await readStdinAll(context);
        } else {
          const fullPath = resolvePath(context.cwd, inputTarget);
          bytes = await context.fs.readFile(fullPath, { signal: context.signal });
        }

        budget.checkInputBytes(bytes.byteLength);
        const plugin = registry.detect(bytes, inputTarget, explicitFormat);
        if (!plugin || !plugin.canDemux) {
          const msg = explicitFormat
            ? `ffprobe: Unknown input format: '${explicitFormat}' (AST not registered)\n`
            : `ffprobe: ${inputTarget}: Invalid data found when processing input or format AST not registered\n`;
          await writeBytes(context.stderr, encodeUtf8(msg), context.signal);
          return { exitCode: 1 };
        }

        const probeResult = plugin.probe(bytes, {
          filename: inputTarget,
          limits: options.limits,
          budget,
          showPackets,
          showFrames
        });

        const formatted = formatFfprobeResult(probeResult, {
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
        });

        await writeBytes(context.stdout, encodeUtf8(formatted), context.signal);
        options.onMetrics?.(budget.getStats());
        return { exitCode: 0 };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await writeBytes(context.stderr, encodeUtf8(`ffprobe: ${msg}\n`), context.signal);
        return { exitCode: 1 };
      }
    }
  };
}

interface InputSpec {
  readonly path: string;
  readonly format?: string | undefined;
  readonly startSeconds?: number | undefined;
  readonly endSeconds?: number | undefined;
  readonly durationSeconds?: number | undefined;
  readonly streamLoop?: number | undefined;
  readonly fps?: number | undefined;
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
      let pendingSs: number | undefined;
      let pendingTo: number | undefined;
      let pendingDuration: number | undefined;
      let pendingLoop: number | undefined;
      let pendingFps: number | undefined;

      let outputFormat: string | undefined;
      let outputSs: number | undefined;
      let outputTo: number | undefined;
      let outputDuration: number | undefined;
      let videoCodec: string | undefined;
      let audioCodec: string | undefined;
      let audioRate: number | undefined;
      let audioChannels: number | undefined;
      let hlsTime = 2;
      let hlsSegmentFilename: string | undefined;
      let hlsSegmentType: string | undefined;
      let stripAudio = false;
      let stripVideo = false;
      let stripSubtitles = false;
      let shortest = false;
      let faststart = true;
      let fragmented = false;
      let maxVideoFrames: number | undefined;
      let outputFps: number | undefined;
      let outputSize: string | undefined;
      let rotation: number | undefined;
      let overwrite = true;
      let noOverwrite = false;
      const maps: string[] = [];
      const vfFilters: string[] = [];
      const afFilters: string[] = [];
      let filterComplex: string | undefined;
      const metadata: Record<string, string> = {};
      let outputTarget: string | undefined;

      for (let i = 0; i < args.length; i++) {
        const arg = args[i]!;
        if (arg === "-y") {
          overwrite = true;
          noOverwrite = false;
        } else if (arg === "-n") {
          noOverwrite = true;
          overwrite = false;
        } else if (arg === "-v" || arg === "-loglevel" || arg === "-safe" || arg === "-threads" || arg === "-pix_fmt" || arg === "-preset" || arg === "-crf" || arg === "-b:v" || arg === "-b:a" || arg === "-bsf:v" || arg === "-bsf:a" || arg === "-tag:v" || arg === "-tag:a" || arg === "-vsync" || arg === "-fps_mode") {
          i++;
        } else if (arg === "-hls_time" || arg === "-seg_duration") {
          hlsTime = parseFloat(args[++i] ?? "2") || 2;
        } else if (arg === "-hls_segment_filename") {
          hlsSegmentFilename = args[++i];
        } else if (arg === "-hls_segment_type") {
          hlsSegmentType = args[++i];
        } else if (arg === "-hls_list_size" || arg === "-hls_flags" || arg === "-map_metadata" || arg === "-map_chapters" || arg === "-start_number") {
          i++;
        } else if (arg === "-ar") {
          audioRate = parseInt(args[++i] ?? "0", 10) || undefined;
        } else if (arg === "-ac") {
          audioChannels = parseInt(args[++i] ?? "0", 10) || undefined;
        } else if (arg === "-hide_banner" || arg === "-nostdin" || arg === "-stats") {
          // no-op
        } else if (arg === "-f") {
          const val = args[++i];
          if (inputs.length === 0 || (i + 1 < args.length && args.slice(i + 1).includes("-i"))) {
            pendingFormat = val;
          } else {
            outputFormat = val;
          }
        } else if (arg === "-ss") {
          const val = parseFfmpegTimestamp(args[++i] ?? "0");
          if (args.slice(i + 1).includes("-i")) {
            pendingSs = val;
          } else {
            outputSs = val;
          }
        } else if (arg === "-to") {
          const val = parseFfmpegTimestamp(args[++i] ?? "0");
          if (args.slice(i + 1).includes("-i")) {
            pendingTo = val;
          } else {
            outputTo = val;
          }
        } else if (arg === "-t") {
          const val = parseFfmpegTimestamp(args[++i] ?? "0");
          if (args.slice(i + 1).includes("-i")) {
            pendingDuration = val;
          } else {
            outputDuration = val;
          }
        } else if (arg === "-stream_loop") {
          pendingLoop = parseInt(args[++i] ?? "0", 10) || 0;
        } else if (arg === "-r" || arg === "-framerate") {
          const val = parseFloat(args[++i] ?? "25") || 25;
          if (args.slice(i + 1).includes("-i")) {
            pendingFps = val;
          } else {
            outputFps = val;
          }
        } else if (arg === "-s") {
          outputSize = args[++i];
        } else if (arg === "-i") {
          const path = args[++i] ?? "";
          inputs.push({
            path,
            format: pendingFormat,
            startSeconds: pendingSs,
            endSeconds: pendingTo,
            durationSeconds: pendingDuration,
            streamLoop: pendingLoop,
            fps: pendingFps
          });
          pendingFormat = undefined;
          pendingSs = undefined;
          pendingTo = undefined;
          pendingDuration = undefined;
          pendingLoop = undefined;
          pendingFps = undefined;
        } else if (arg === "-c" || arg === "-codec") {
          const val = args[++i];
          videoCodec = val;
          audioCodec = val;
        } else if (arg === "-c:v" || arg === "-vcodec" || arg === "-codec:v") {
          videoCodec = args[++i];
        } else if (arg === "-c:a" || arg === "-acodec" || arg === "-codec:a") {
          audioCodec = args[++i];
        } else if (arg === "-c:s" || arg === "-scodec" || arg === "-codec:s") {
          i++;
        } else if (arg === "-an") {
          stripAudio = true;
        } else if (arg === "-vn") {
          stripVideo = true;
        } else if (arg === "-sn") {
          stripSubtitles = true;
        } else if (arg === "-shortest") {
          shortest = true;
        } else if (arg === "-frames:v" || arg === "-vframes") {
          maxVideoFrames = parseInt(args[++i] ?? "1", 10) || 1;
        } else if (arg === "-frames:a" || arg === "-aframes") {
          i++;
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
        } else if (arg === "-af" || arg === "-filter:a") {
          const f = args[++i];
          if (f) afFilters.push(f);
        } else if (arg === "-filter_complex" || arg === "-lavfi") {
          filterComplex = args[++i];
        } else if (arg === "-metadata" || arg.startsWith("-metadata:")) {
          const kv = args[++i] ?? "";
          const eq = kv.indexOf("=");
          if (eq >= 0) {
            const k = kv.slice(0, eq).trim().toLowerCase();
            const v = kv.slice(eq + 1).trim();
            if (k === "rotate") rotation = parseInt(v, 10) || 0;
            else metadata[k] = v;
          }
        } else if (arg === "-display_rotation") {
          rotation = Math.abs(parseInt(args[++i] ?? "0", 10) || 0);
        } else if (!arg.startsWith("-") || arg === "-") {
          outputTarget = arg;
        }
      }

      void overwrite;

      if (inputs.length === 0) {
        await writeBytes(
          context.stderr,
          encodeUtf8("ffmpeg: must specify at least one input (-i)\n"),
          context.signal
        );
        return { exitCode: 1 };
      }

      if (!outputTarget) {
        await writeBytes(
          context.stderr,
          encodeUtf8("ffmpeg: must specify an output file\n"),
          context.signal
        );
        return { exitCode: 1 };
      }

      try {
        // Check `-n` (do not overwrite)
        if (
          noOverwrite &&
          outputTarget !== "-" &&
          outputTarget !== "pipe:" &&
          outputTarget !== "pipe:1" &&
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
            return { exitCode: 0 };
          } catch {
            // File does not exist, proceed
          }
        }

        const loadSingleDocument = async (
          filePath: string,
          explicitFormat?: string,
          fpsHint?: number
        ): Promise<MediaDocument> => {
          if (explicitFormat === "lavfi") {
            if (features.lavfiSources === false) {
              throw new Error("lavfi synthetic sources are disabled by consumer feature configuration");
            }
            return parseLavfiSource(filePath, budget, outputDuration);
          }

          if (/\.m3u8?$/i.test(filePath) || explicitFormat === "hls") {
            const m3uResolved = resolvePath(context.cwd, filePath);
            const m3uBytes = await context.fs.readFile(m3uResolved, { signal: context.signal });
            const m3uText = decodeUtf8(m3uBytes).replace(/\r\n/g, "\n");
            const baseDir = m3uResolved.includes("/")
              ? m3uResolved.slice(0, m3uResolved.lastIndexOf("/")) || "/"
              : "/";
            const segDocs: MediaDocument[] = [];
            for (const rawLine of m3uText.split("\n")) {
              const line = rawLine.trim();
              if (!line || line.startsWith("#")) continue;
              const segPath = resolvePath(baseDir, line);
              try {
                const segDoc = await loadSingleDocument(segPath);
                segDocs.push(segDoc);
              } catch {
                // ignore missing optional segment
              }
            }
            if (segDocs.length > 0) {
              return concatMp4(segDocs, { limits: options.limits, budget });
            }
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

          // Check printf sequence pattern like `frame_%03d.png`
          if (/%0?\d*d/.test(filePath)) {
            const frames: MediaVideoFrame[] = [];
            const fps = fpsHint ?? 25;
            for (let idx = 0; idx < 1000; idx++) {
              const formatted = filePath.replace(/%0?(\d*)d/, (_, widthDigits: string) => {
                const padLen = parseInt(widthDigits || "0", 10) || 0;
                return String(idx).padStart(padLen, "0");
              });
              const resolved = resolvePath(context.cwd, formatted);
              try {
                const imgBytes = await context.fs.readFile(resolved, { signal: context.signal });
                const decoded = decodeImage(imgBytes);
                budget.recordFrame(decoded.width, decoded.height);
                frames.push({
                  width: decoded.width,
                  height: decoded.height,
                  data: decoded.data,
                  ptsSeconds: frames.length / fps,
                  durationSeconds: 1 / fps,
                  keyframe: true
                });
              } catch {
                if (idx === 0) continue; // try starting at 1 if 0 doesn't exist
                break;
              }
            }
            if (frames.length === 0) {
              throw new Error(`${filePath}: No matching image sequence files found`);
            }
            const first = frames[0]!;
            const synthBytes = createSyntheticMp4({
              width: first.width,
              height: first.height,
              fps,
              frameCount: frames.length,
              includeAudio: false
            });
            const base = parseMp4(synthBytes);
            return {
              ...base,
              tracks: base.tracks.map((t) =>
                t.type === "video" ? { ...t, decodedVideoFrames: frames } : t
              )
            };
          }

          let rawBytes: Uint8Array;
          if (filePath === "-" || filePath === "pipe:" || filePath === "pipe:0") {
            rawBytes = await readStdinAll(context);
          } else {
            const fullPath = resolvePath(context.cwd, filePath);
            rawBytes = await context.fs.readFile(fullPath, { signal: context.signal });
          }

          budget.checkInputBytes(rawBytes.byteLength);

          if (explicitFormat === "concat") {
            const listText = new TextDecoder().decode(rawBytes);
            const listDir = filePath === "-" ? context.cwd : dirnameOf(resolvePath(context.cwd, filePath));
            const concatDocs: MediaDocument[] = [];
            let currentInpoint: number | undefined;
            let currentOutpoint: number | undefined;
            let currentDuration: number | undefined;

            const lines = listText.split(/\r?\n/);
            for (let l = 0; l < lines.length; l++) {
              const line = lines[l]!.trim();
              if (!line || line.startsWith("#") || line.startsWith("ffconcat")) continue;
              if (line.startsWith("file ")) {
                let target = line.slice(5).trim();
                if (
                  (target.startsWith("'") && target.endsWith("'")) ||
                  (target.startsWith('"') && target.endsWith('"'))
                ) {
                  target = target.slice(1, -1);
                }
                const resolvedItem = resolvePath(listDir, target);
                // Look ahead for inpoint/outpoint/duration directives following this `file`
                currentInpoint = undefined;
                currentOutpoint = undefined;
                currentDuration = undefined;
                while (l + 1 < lines.length) {
                  const nextLine = lines[l + 1]!.trim();
                  if (nextLine.startsWith("inpoint ")) {
                    currentInpoint = parseFfmpegTimestamp(nextLine.slice(8));
                    l++;
                  } else if (nextLine.startsWith("outpoint ")) {
                    currentOutpoint = parseFfmpegTimestamp(nextLine.slice(9));
                    l++;
                  } else if (nextLine.startsWith("duration ")) {
                    currentDuration = parseFfmpegTimestamp(nextLine.slice(9));
                    l++;
                  } else {
                    break;
                  }
                }
                let itemDoc = await loadSingleDocument(resolvedItem);
                if (
                  currentInpoint !== undefined ||
                  currentOutpoint !== undefined ||
                  currentDuration !== undefined
                ) {
                  itemDoc = sliceMp4(itemDoc, {
                    startSeconds: currentInpoint,
                    endSeconds: currentOutpoint,
                    durationSeconds: currentDuration
                  });
                }
                concatDocs.push(itemDoc);
              }
            }
            budget.checkConcatInputs(concatDocs.length);
            return concatMp4(concatDocs, { limits: options.limits, budget });
          }

          const plugin = registry.detect(rawBytes, filePath, explicitFormat);
          if (!plugin || !plugin.canDemux) {
            throw new Error(
              explicitFormat
                ? `Unknown input format: '${explicitFormat}' (AST not registered)`
                : `${filePath}: Unsupported input format (AST not registered)`
            );
          }

          return plugin.parse(rawBytes, {
            filename: filePath,
            limits: options.limits,
            budget
          });
        };

        // Load all inputs and apply per-input slicing / looping
        const loadedDocs: MediaDocument[] = [];
        for (const inp of inputs) {
          let doc = await loadSingleDocument(inp.path, inp.format, inp.fps);
          if (
            inp.startSeconds !== undefined ||
            inp.endSeconds !== undefined ||
            inp.durationSeconds !== undefined
          ) {
            doc = sliceMp4(doc, {
              startSeconds: inp.startSeconds,
              endSeconds: inp.endSeconds,
              durationSeconds: inp.durationSeconds
            });
          }
          if (inp.streamLoop && inp.streamLoop > 0) {
            const copies = Array.from({ length: inp.streamLoop + 1 }, () => doc);
            doc = concatMp4(copies, { limits: options.limits, budget });
          }
          loadedDocs.push(doc);
        }

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
            const f0 = ensureDecodedFrames(
              loadedDocs[0]!.tracks.find((t) => t.type === "video")!,
              budget
            );
            const f1 = ensureDecodedFrames(
              loadedDocs[1]!.tracks.find((t) => t.type === "video")!,
              budget
            );
            const durMatch = /duration=([0-9.]+)/.exec(filterComplex);
            const offMatch = /offset=([0-9.]+)/.exec(filterComplex);
            const fadeDur = parseFloat(durMatch?.[1] ?? "0.5") || 0.5;
            const fps = f0[0]?.durationSeconds ? Math.round(1 / f0[0].durationSeconds) : 25;
            const overlapFrames = Math.max(1, Math.min(f0.length, f1.length, Math.round(fadeDur * fps)));
            const offsetSec = offMatch ? parseFloat(offMatch[1]!) : Math.max(0, (f0.length - overlapFrames) / fps);
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
              const alpha = (k + 1) / (overlapFrames + 1);
              const blended = new Uint8Array(a.data.byteLength);
              for (let pIdx = 0; pIdx < blended.byteLength; pIdx += 4) {
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
          } else if (filterComplex.includes("vstack") && loadedDocs.length >= 2) {
            const f0 = ensureDecodedFrames(
              loadedDocs[0]!.tracks.find((t) => t.type === "video")!,
              budget
            );
            const f1 = ensureDecodedFrames(
              loadedDocs[1]!.tracks.find((t) => t.type === "video")!,
              budget
            );
            const count = Math.min(f0.length, f1.length);
            const stacked: MediaVideoFrame[] = [];
            for (let i = 0; i < count; i++) {
              const a = f0[i]!;
              const b = f1[i]!;
              const w = Math.max(a.width, b.width);
              const h = a.height + b.height;
              const outData = new Uint8Array(w * h * 4);
              for (let y = 0; y < a.height; y++) {
                outData.set(a.data.subarray(y * a.width * 4, (y + 1) * a.width * 4), y * w * 4);
              }
              for (let y = 0; y < b.height; y++) {
                outData.set(b.data.subarray(y * b.width * 4, (y + 1) * b.width * 4), (a.height + y) * w * 4);
              }
              stacked.push({
                width: w,
                height: h,
                data: outData,
                ptsSeconds: a.ptsSeconds,
                durationSeconds: a.durationSeconds,
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
          } else if (filterComplex.includes("hstack") && loadedDocs.length >= 2) {
            const f0 = ensureDecodedFrames(
              loadedDocs[0]!.tracks.find((t) => t.type === "video")!,
              budget
            );
            const f1 = ensureDecodedFrames(
              loadedDocs[1]!.tracks.find((t) => t.type === "video")!,
              budget
            );
            const count = Math.min(f0.length, f1.length);
            const stacked: MediaVideoFrame[] = [];
            for (let i = 0; i < count; i++) {
              const a = f0[i]!;
              const b = f1[i]!;
              const w = a.width + b.width;
              const h = Math.max(a.height, b.height);
              const outData = new Uint8Array(w * h * 4);
              for (let y = 0; y < a.height; y++) {
                outData.set(a.data.subarray(y * a.width * 4, (y + 1) * a.width * 4), y * w * 4);
              }
              for (let y = 0; y < b.height; y++) {
                outData.set(b.data.subarray(y * b.width * 4, (y + 1) * b.width * 4), (y * w + a.width) * 4);
              }
              stacked.push({
                width: w,
                height: h,
                data: outData,
                ptsSeconds: a.ptsSeconds,
                durationSeconds: a.durationSeconds,
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
          } else if (filterComplex.includes("vstack") && loadedDocs.length >= 2) {
            const f0 = ensureDecodedFrames(
              loadedDocs[0]!.tracks.find((t) => t.type === "video")!,
              budget
            );
            const f1 = ensureDecodedFrames(
              loadedDocs[1]!.tracks.find((t) => t.type === "video")!,
              budget
            );
            const count = Math.min(f0.length, f1.length);
            const stacked: MediaVideoFrame[] = [];
            for (let i = 0; i < count; i++) {
              const a = f0[i]!;
              const b = f1[i]!;
              const w = Math.max(a.width, b.width);
              const h = a.height + b.height;
              const outData = new Uint8Array(w * h * 4);
              for (let y = 0; y < a.height; y++) {
                outData.set(a.data.subarray(y * a.width * 4, (y + 1) * a.width * 4), y * w * 4);
              }
              for (let y = 0; y < b.height; y++) {
                outData.set(b.data.subarray(y * b.width * 4, (y + 1) * b.width * 4), (a.height + y) * w * 4);
              }
              stacked.push({
                width: w,
                height: h,
                data: outData,
                ptsSeconds: a.ptsSeconds,
                durationSeconds: a.durationSeconds,
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
            const f0 = ensureDecodedFrames(
              loadedDocs[0]!.tracks.find((t) => t.type === "video")!,
              budget
            );
            const f1 = ensureDecodedFrames(
              loadedDocs[1]!.tracks.find((t) => t.type === "video")!,
              budget
            );
            const overlayMatch = /overlay(?:=(\d+):(\d+))?/.exec(filterComplex);
            const ox = parseInt(overlayMatch?.[1] ?? "0", 10) || 0;
            const oy = parseInt(overlayMatch?.[2] ?? "0", 10) || 0;
            const overlaid: MediaVideoFrame[] = f0.map((a, idx) => {
              const b = f1[Math.min(idx, f1.length - 1)];
              if (!b) return a;
              const outData = new Uint8Array(a.data);
              for (let y = 0; y < b.height && oy + y < a.height; y++) {
                if (oy + y < 0) continue;
                for (let x = 0; x < b.width && ox + x < a.width; x++) {
                  if (ox + x < 0) continue;
                  const srcOff = (y * b.width + x) * 4;
                  const dstOff = ((oy + y) * a.width + (ox + x)) * 4;
                  outData[dstOff] = b.data[srcOff]!;
                  outData[dstOff + 1] = b.data[srcOff + 1]!;
                  outData[dstOff + 2] = b.data[srcOff + 2]!;
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
            workingDoc = muxMp4(loadedDocs, { shortest });
            const cleanedComplex = filterComplex.replace(/\[[^\]]+\]/g, "").trim();
            if (cleanedComplex) vfFilters.push(cleanedComplex);
          }
        } else if (maps.length > 0) {
          const selectedTracks: MediaTrack[] = [];
          const excludedTrackKeys = new Set<string>();

          for (const m of maps) {
            if (m.startsWith("-")) {
              excludedTrackKeys.add(m.slice(1).replace(/\?$/, ""));
              continue;
            }
            const clean = m.replace(/\?$/, "");
            if (clean.startsWith("[")) continue;
            const parts = clean.split(":");
            const inputIdx = parseInt(parts[0] ?? "0", 10) || 0;
            const srcDoc = loadedDocs[inputIdx];
            if (!srcDoc) continue;

            if (parts.length === 1) {
              for (let tIdx = 0; tIdx < srcDoc.tracks.length; tIdx++) {
                selectedTracks.push(srcDoc.tracks[tIdx]!);
              }
            } else if (parts[1] === "v" || parts[1] === "a" || parts[1] === "s") {
              const wantType =
                parts[1] === "v" ? "video" : parts[1] === "a" ? "audio" : "subtitle";
              const typeMatches = srcDoc.tracks.filter((t) => t.type === wantType);
              if (parts[2] !== undefined) {
                const ord = parseInt(parts[2], 10) || 0;
                if (typeMatches[ord]) selectedTracks.push(typeMatches[ord]!);
              } else {
                selectedTracks.push(...typeMatches);
              }
            } else if (/^\d+$/.test(parts[1]!)) {
              const tIdx = parseInt(parts[1]!, 10);
              if (srcDoc.tracks[tIdx]) selectedTracks.push(srcDoc.tracks[tIdx]!);
            }
          }

          const filteredTracks = selectedTracks.filter((t) => {
            if (excludedTrackKeys.has("0:a") && t.type === "audio") return false;
            if (excludedTrackKeys.has("0:v") && t.type === "video") return false;
            return true;
          });

          workingDoc = muxMp4(
            [{ ...loadedDocs[0]!, tracks: filteredTracks }],
            { stripAudio, stripVideo, stripSubtitles, shortest, rotation }
          );
        } else {
          workingDoc = muxMp4(loadedDocs, {
            stripAudio,
            stripVideo,
            stripSubtitles,
            shortest,
            rotation
          });
        }

        // Apply output-level time slicing (`-ss`, `-to`, `-t`)
        if (
          outputSs !== undefined ||
          outputTo !== undefined ||
          outputDuration !== undefined
        ) {
          workingDoc = sliceMp4(workingDoc, {
            startSeconds: outputSs,
            endSeconds: outputTo,
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
            const subBytes = await context.fs.readFile(subPath, { signal: context.signal });
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
            tracks: workingDoc.tracks.map((t) => {
              if (t.type !== "video") return t;
              const decoded = ensureDecodedFrames(t, budget);
              const filtered = applyVideoFilterChain(decoded, combinedChain, budget, loadedSubtitleCues);
              const first = filtered[0];
              return {
                ...t,
                width: first?.width ?? t.width,
                height: first?.height ?? t.height,
                samples: [],
                decodedVideoFrames: filtered
              };
            })
          };
        }

        // Apply `-frames:v <N>` limit
        if (maxVideoFrames !== undefined) {
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

        // Apply -ar (audioRate), -ac (audioChannels), and -af audio filters when transcoding audio
        if ((audioRate !== undefined || audioChannels !== undefined || afFilters.length > 0) && audioCodec !== "copy") {
          workingDoc = {
            ...workingDoc,
            tracks: workingDoc.tracks.map((t) => {
              if (t.type !== "audio") return t;
              const origRate = t.decodedAudio?.sampleRate ?? t.codecDescriptions[0]?.sampleRate ?? t.timescale ?? 44100;
              const origCh = t.decodedAudio?.channels ?? t.codecDescriptions[0]?.channels ?? 2;
              const targetRate = audioRate ?? origRate;
              const targetCh = audioChannels ?? origCh;
              const durSec = Math.max(0.05, (t.duration || origRate) / Math.max(1, t.timescale || origRate));
              let volFactor = t.volume ?? 1.0;
              let tempoFactor = 1.0;
              let reverseAudio = false;
              for (const af of afFilters) {
                for (const item of af.split(",")) {
                  const trimmed = item.trim();
                  if (trimmed.startsWith("volume=")) {
                    const volSpec = trimmed.slice("volume=".length).trim();
                    volFactor *= volSpec.endsWith("dB")
                      ? Math.pow(10, (parseFloat(volSpec.slice(0, -2)) || 0) / 20)
                      : parseFloat(volSpec) || 1.0;
                  } else if (trimmed.startsWith("atempo=")) {
                    tempoFactor *= Math.max(0.25, Math.min(4.0, parseFloat(trimmed.slice(7)) || 1.0));
                  } else if (trimmed === "areverse") {
                    reverseAudio = true;
                  }
                }
              }

              const targetSamples = Math.max(1, Math.round((durSec / tempoFactor) * targetRate));
              const newChannelData: Float32Array[] = [];
              for (let c = 0; c < targetCh; c++) {
                const dst = new Float32Array(targetSamples);
                const srcCh = t.decodedAudio?.channelData[Math.min(c, (t.decodedAudio.channelData.length || 1) - 1)];
                if (srcCh && srcCh.length > 0) {
                  for (let i = 0; i < targetSamples; i++) {
                    const srcIdx = Math.min(srcCh.length - 1, Math.floor((i / targetSamples) * srcCh.length));
                    dst[i] = Math.max(-1, Math.min(1, srcCh[srcIdx]! * volFactor));
                  }
                } else {
                  for (let i = 0; i < targetSamples; i++) {
                    dst[i] = Math.sin((2 * Math.PI * 440 * i) / targetRate) * 0.2 * volFactor;
                  }
                }
                if (reverseAudio) dst.reverse();
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
                  channelData: newChannelData
                }
              };
            })
          };
        }

        // Apply `-metadata` tags
        const metaTags: Mp4MetadataTags = {
          ...workingDoc.metadata,
          title: metadata.title ?? workingDoc.metadata.title,
          artist: metadata.artist ?? workingDoc.metadata.artist,
          album: metadata.album ?? workingDoc.metadata.album,
          date: metadata.date ?? metadata.year ?? workingDoc.metadata.date,
          comment: metadata.comment ?? workingDoc.metadata.comment,
          genre: metadata.genre ?? workingDoc.metadata.genre,
          encoder: metadata.encoder ?? workingDoc.metadata.encoder
        };
        workingDoc = {
          ...workingDoc,
          faststart,
          metadata: metaTags
        };

        // Null muxer (`-f null -`)
        if (outputFormat === "null" || outputTarget === "/dev/null") {
          options.onMetrics?.(budget.getStats());
          return { exitCode: 0 };
        }

        // Handle HLS (.m3u8 / -f hls) multi-segment muxing
        if (outputFormat === "hls" || /\.m3u8?$/i.test(outputTarget)) {
          const outResolved = resolvePath(context.cwd, outputTarget);
          const outDir = outResolved.includes("/")
            ? outResolved.slice(0, outResolved.lastIndexOf("/")) || "/"
            : "/";
          const isFmp4 = hlsSegmentType === "fmp4";
          const segExt = isFmp4 ? "m4s" : "ts";
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
          const numSegs = Math.max(1, Math.ceil((totalSec - 1e-6) / segDur));
          const playlistLines: string[] = [
            "#EXTM3U",
            "#EXT-X-VERSION:3",
            `#EXT-X-TARGETDURATION:${Math.ceil(segDur)}`,
            "#EXT-X-MEDIA-SEQUENCE:0"
          ];

          for (let sIdx = 0; sIdx < numSegs; sIdx++) {
            const st = sIdx * segDur;
            const en = Math.min(totalSec, (sIdx + 1) * segDur);
            const actualDur = Math.max(0.04, en - st);
            const sliced = sliceMp4(workingDoc, { startSeconds: st, endSeconds: en });
            const segBytes = segPlugin.serialize(sliced, {
              fragmented: isFmp4,
              limits: options.limits,
              budget
            });

            const segPattern = hlsSegmentFilename ?? `seg_%03d.${segExt}`;
            const formattedSeg = segPattern.replace(/%0?(\d*)d/, (_, widthDigits: string) => {
              const padLen = parseInt(widthDigits || "0", 10) || 0;
              return String(sIdx).padStart(padLen, "0");
            });
            const fullSegPath = resolvePath(outDir, formattedSeg);
            const relSegName = fullSegPath.startsWith(outDir === "/" ? "/" : `${outDir}/`)
              ? fullSegPath.slice(outDir === "/" ? 1 : outDir.length + 1)
              : formattedSeg;

            budget.checkOutputBytes(segBytes.byteLength);
            await context.fs.writeFile(fullSegPath, segBytes, { signal: context.signal });
            playlistLines.push(`#EXTINF:${actualDur.toFixed(6)},`, relSegName);
          }

          playlistLines.push("#EXT-X-ENDLIST", "");
          const m3u8Bytes = encodeUtf8(playlistLines.join("\n"));
          await context.fs.writeFile(outResolved, m3u8Bytes, { signal: context.signal });
          options.onMetrics?.(budget.getStats());
          return { exitCode: 0 };
        }

        // Check if outputTarget is an image sequence pattern like `frame_%03d.png`
        if (/%0?\d*d/.test(outputTarget)) {
          const outExt = outputTarget.split(".").pop()?.toLowerCase() ?? "png";
          const imgPlugin = registry.findByFilename(`x.${outExt}`);
          if (!imgPlugin || !imgPlugin.canMux) {
            throw new Error(`Unsupported output format for '${outputTarget}' (AST not registered)`);
          }
          const vTrack = workingDoc.tracks.find((t) => t.type === "video");
          const frames = vTrack ? ensureDecodedFrames(vTrack, budget) : [];
          const limit = maxVideoFrames ? Math.min(frames.length, maxVideoFrames) : frames.length;
          const imgFmt: ImageFormat =
            outExt === "jpg" || outExt === "jpeg" ? "jpeg" :
            outExt === "webp" ? "webp" :
            outExt === "gif" ? "gif" :
            outExt === "bmp" ? "bmp" :
            outExt === "ppm" ? "ppm" : "png";

          for (let idx = 0; idx < limit; idx++) {
            const f = frames[idx]!;
            const fileName = outputTarget.replace(/%0?(\d*)d/, (_, widthDigits: string) => {
              const padLen = parseInt(widthDigits || "0", 10) || 0;
              return String(idx + 1).padStart(padLen, "0");
            });
            const fullOutPath = resolvePath(context.cwd, fileName);
            const encoded = encodeImage(makeRgbaImg(f.width, f.height, f.data), {
              format: imgFmt
            }).data;
            budget.checkOutputBytes(encoded.byteLength);
            await context.fs.writeFile(fullOutPath, encoded, { signal: context.signal });
          }
          options.onMetrics?.(budget.getStats());
          return { exitCode: 0 };
        }

        // Resolve output AST plugin from `outputFormat` or `outputTarget` filename
        const outPlugin = outputFormat
          ? registry.findByFormatName(outputFormat)
          : registry.findByFilename(outputTarget);

        if (!outPlugin || !outPlugin.canMux) {
          const fmtDesc = outputFormat ?? outputTarget;
          throw new Error(
            `Unable to find a suitable output format for '${fmtDesc}' (format AST not registered)`
          );
        }

        const outExt = outputTarget.split(".").pop()?.toLowerCase();
        const serializedBytes = outPlugin.serialize(workingDoc, {
          format: outputFormat ?? outExt,
          faststart,
          fragmented,
          metadata: metaTags,
          limits: options.limits,
          budget
        });

        budget.checkOutputBytes(serializedBytes.byteLength);

        if (outputTarget === "-" || outputTarget === "pipe:" || outputTarget === "pipe:1") {
          await writeBytes(context.stdout, serializedBytes, context.signal);
        } else {
          const fullOutPath = resolvePath(context.cwd, outputTarget);
          await context.fs.writeFile(fullOutPath, serializedBytes, { signal: context.signal });
        }

        options.onMetrics?.(budget.getStats());
        return { exitCode: 0 };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await writeBytes(context.stderr, encodeUtf8(`ffmpeg: ${msg}\n`), context.signal);
        return { exitCode: 1 };
      }
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
