import { StoredImageStack, magickInput, type MagickFormatContext } from "./stored-stack.js";
import { remapStoredImage } from "./remap.js";
import { floodfillStoredImage } from "./floodfill.js";
import { shadowPixelSteps, vignettePixelSteps } from "./effects-kernel.js";
import { warpPixelSteps, type WarpPlan } from "./warp-kernel.js";
import { morphologyPixelSteps } from "./morphology-kernel.js";
import { convolvePixelSteps, type ConvolveRequest } from "./convolve-kernel.js";
import {withCompareFiles,CompareInputFailure,type CompareFileInput,type CompareFileSession} from "./compare-file.js";
export type {CompareFileInput} from "./compare-file.js";
export interface ConvertFileInput extends CompareFileInput { readonly stderr?: ByteSink; }
import {compareImageSteps,formatMetricNum} from "./compare-kernel.js";
import {withIdentifyFiles,type IdentifyFileInput,type IdentifyFileReader,type IdentifyInspection,type IdentifyRaster} from "./identify-file.js";
export type {IdentifyFileInput} from "./identify-file.js";
import { FsError } from "safe-bash-contracts/errors";
import { resolvePath } from "safe-bash-contracts/path";
import { yieldTurn, drainCooperativeSteps as drainSteps } from "safe-bash-contracts/yield";
import { InputByteBudget } from "safe-bash-contracts/io";
import { writeFileOutput } from "safe-bash-contracts/filesystem-output-budget";
import {
  commandRuntimeIdentity,
  getCommandArguments,
  type CommandContext,
  type CommandDefinition
} from "safe-bash-contracts/command";
import { readBytes, writeBytes, type ByteSink } from "safe-bash-contracts/io";
import { createOutputOperation } from "safe-bash-contracts/output";
import type { VirtualShellPlugin } from "safe-bash-contracts/plugin";
import { decodeImageToStorage, transformStoredImage,type StoredRgbaImage, UnsupportedStoredResource, decodeImage, decodePngToCanvas, FONT_5X7, encodeImage, readImageMetadata, parseColor as baseParseColor, type BlendMode, type CompositeLayer, type GravityPosition, type ImageFormat, type ImageMetadata, type ResizeKernel, type RgbaColor, type RgbaImage, applyExifOrientationSteps, blurImageSteps, compositeImageSteps, computeImageStatsSteps, ensureAlphaImageSteps, extendImageSteps, extractChannelImageSteps, extractImageSteps, flattenImageSteps, flipImageSteps, flopImageSteps, gammaImageSteps, grayscaleImageSteps, linearImageSteps, medianImageSteps, modulateImageSteps, negateImageSteps, removeAlphaImageSteps, resizeImageSteps, rotateImageSteps, sharpenImageSteps, thresholdImageSteps, tintImageSteps, trimImageSteps } from "@poe-code/image-ast/portable";

const X11_NAMED_COLORS: Record<string, [number, number, number, number]> = {
  aliceblue: [240, 248, 255, 255],
  antiquewhite: [250, 235, 215, 255],
  aqua: [0, 255, 255, 255],
  aquamarine: [127, 255, 212, 255],
  azure: [240, 255, 255, 255],
  beige: [245, 245, 220, 255],
  bisque: [255, 228, 196, 255],
  black: [0, 0, 0, 255],
  blanchedalmond: [255, 235, 205, 255],
  blue: [0, 0, 255, 255],
  blueviolet: [138, 43, 226, 255],
  brown: [165, 42, 42, 255],
  burlywood: [222, 184, 135, 255],
  cadetblue: [95, 158, 160, 255],
  chartreuse: [127, 255, 0, 255],
  chocolate: [210, 105, 30, 255],
  coral: [255, 127, 80, 255],
  cornflowerblue: [100, 149, 237, 255],
  cornsilk: [255, 248, 220, 255],
  crimson: [220, 20, 60, 255],
  cyan: [0, 255, 255, 255],
  darkblue: [0, 0, 139, 255],
  darkcyan: [0, 139, 139, 255],
  darkgoldenrod: [184, 134, 11, 255],
  darkgray: [169, 169, 169, 255],
  darkgreen: [0, 100, 0, 255],
  darkgrey: [169, 169, 169, 255],
  darkkhaki: [189, 183, 107, 255],
  darkmagenta: [139, 0, 139, 255],
  darkolivegreen: [85, 107, 47, 255],
  darkorange: [255, 140, 0, 255],
  darkorchid: [153, 50, 204, 255],
  darkred: [139, 0, 0, 255],
  darksalmon: [233, 150, 122, 255],
  darkseagreen: [143, 188, 143, 255],
  darkslateblue: [72, 61, 139, 255],
  darkslategray: [47, 79, 79, 255],
  darkslategrey: [47, 79, 79, 255],
  darkturquoise: [0, 206, 209, 255],
  darkviolet: [148, 0, 211, 255],
  deeppink: [255, 20, 147, 255],
  deepskyblue: [0, 191, 255, 255],
  dimgray: [105, 105, 105, 255],
  dimgrey: [105, 105, 105, 255],
  dodgerblue: [30, 144, 255, 255],
  firebrick: [178, 34, 34, 255],
  floralwhite: [255, 250, 240, 255],
  forestgreen: [34, 139, 34, 255],
  fractal: [128, 128, 128, 255],
  fuchsia: [255, 0, 255, 255],
  gainsboro: [220, 220, 220, 255],
  ghostwhite: [248, 248, 255, 255],
  gold: [255, 215, 0, 255],
  goldenrod: [218, 165, 32, 255],
  gray: [126, 126, 126, 255],
  grey: [126, 126, 126, 255],
  green: [0, 128, 0, 255],
  greenyellow: [173, 255, 47, 255],
  honeydew: [240, 255, 240, 255],
  hotpink: [255, 105, 180, 255],
  indianred: [205, 92, 92, 255],
  indigo: [75, 0, 130, 255],
  ivory: [255, 255, 240, 255],
  khaki: [240, 230, 140, 255],
  lavender: [230, 230, 250, 255],
  lavenderblush: [255, 240, 245, 255],
  lawngreen: [124, 252, 0, 255],
  lemonchiffon: [255, 250, 205, 255],
  lightblue: [173, 216, 230, 255],
  lightcoral: [240, 128, 128, 255],
  lightcyan: [224, 255, 255, 255],
  lightgoldenrodyellow: [250, 250, 210, 255],
  lightgray: [211, 211, 211, 255],
  lightgreen: [144, 238, 144, 255],
  lightgrey: [211, 211, 211, 255],
  lightpink: [255, 182, 193, 255],
  lightsalmon: [255, 160, 122, 255],
  lightseagreen: [32, 178, 170, 255],
  lightskyblue: [135, 206, 250, 255],
  lightslategray: [119, 136, 153, 255],
  lightslategrey: [119, 136, 153, 255],
  lightsteelblue: [176, 196, 222, 255],
  lightyellow: [255, 255, 224, 255],
  lime: [0, 255, 0, 255],
  limegreen: [50, 205, 50, 255],
  linen: [250, 240, 230, 255],
  magenta: [255, 0, 255, 255],
  maroon: [128, 0, 0, 255],
  mediumaquamarine: [102, 205, 170, 255],
  mediumblue: [0, 0, 205, 255],
  mediumorchid: [186, 85, 211, 255],
  mediumpurple: [147, 112, 219, 255],
  mediumseagreen: [60, 179, 113, 255],
  mediumslateblue: [123, 104, 238, 255],
  mediumspringgreen: [0, 250, 154, 255],
  mediumturquoise: [72, 209, 204, 255],
  mediumvioletred: [199, 21, 133, 255],
  midnightblue: [25, 25, 112, 255],
  mintcream: [245, 255, 250, 255],
  mistyrose: [255, 228, 225, 255],
  moccasin: [255, 228, 181, 255],
  navajowhite: [255, 222, 173, 255],
  navy: [0, 0, 128, 255],
  none: [0, 0, 0, 0],
  oldlace: [253, 245, 230, 255],
  olive: [128, 128, 0, 255],
  olivedrab: [107, 142, 35, 255],
  orange: [255, 165, 0, 255],
  orangered: [255, 69, 0, 255],
  orchid: [218, 112, 214, 255],
  palegoldenrod: [238, 232, 170, 255],
  palegreen: [152, 251, 152, 255],
  paleturquoise: [175, 238, 238, 255],
  palevioletred: [219, 112, 147, 255],
  papayawhip: [255, 239, 213, 255],
  peachpuff: [255, 218, 185, 255],
  peru: [205, 133, 63, 255],
  pink: [255, 192, 203, 255],
  plum: [221, 160, 221, 255],
  powderblue: [176, 224, 230, 255],
  purple: [128, 0, 128, 255],
  rebeccapurple: [102, 51, 153, 255],
  red: [255, 0, 0, 255],
  rosybrown: [188, 143, 143, 255],
  royalblue: [65, 105, 225, 255],
  saddlebrown: [139, 69, 19, 255],
  salmon: [250, 128, 114, 255],
  sandybrown: [244, 164, 96, 255],
  seagreen: [46, 139, 87, 255],
  seashell: [255, 245, 238, 255],
  sienna: [160, 82, 45, 255],
  silver: [192, 192, 192, 255],
  skyblue: [135, 206, 235, 255],
  slateblue: [106, 90, 205, 255],
  slategray: [112, 128, 144, 255],
  slategrey: [112, 128, 144, 255],
  snow: [255, 250, 250, 255],
  springgreen: [0, 255, 127, 255],
  steelblue: [70, 130, 180, 255],
  tan: [210, 180, 140, 255],
  teal: [0, 128, 128, 255],
  thistle: [216, 191, 216, 255],
  tomato: [255, 99, 71, 255],
  transparent: [0, 0, 0, 0],
  turquoise: [64, 224, 208, 255],
  violet: [238, 130, 238, 255],
  wheat: [245, 222, 179, 255],
  white: [255, 255, 255, 255],
  whitesmoke: [245, 245, 245, 255],
  yellow: [255, 255, 0, 255],
  yellowgreen: [154, 205, 50, 255]
};

function parseColor(raw: string): RgbaColor {
  const s = raw.trim();
  const low = s.toLowerCase();
  if (X11_NAMED_COLORS[low]) {
    const [r, g, b, a] = X11_NAMED_COLORS[low]!;
    return { r, g, b, a };
  }
  const grayMatch = /^gr[ae]y(\d{1,3})$/.exec(low);
  if (grayMatch) {
    const v = Math.max(0, Math.min(255, Math.round((Number(grayMatch[1]) / 100) * 255)));
    return { r: v, g: v, b: v, a: 255 };
  }
  if (/^#[0-9a-f]{12}$/i.test(s)) {
    const r = Math.round((parseInt(s.slice(1, 5), 16) / 65535) * 255);
    const g = Math.round((parseInt(s.slice(5, 9), 16) / 65535) * 255);
    const b = Math.round((parseInt(s.slice(9, 13), 16) / 65535) * 255);
    return { r, g, b, a: 255 };
  }
  if (/^#[0-9a-f]{16}$/i.test(s)) {
    const r = Math.round((parseInt(s.slice(1, 5), 16) / 65535) * 255);
    const g = Math.round((parseInt(s.slice(5, 9), 16) / 65535) * 255);
    const b = Math.round((parseInt(s.slice(9, 13), 16) / 65535) * 255);
    const a = Math.round((parseInt(s.slice(13, 17), 16) / 65535) * 255);
    return { r, g, b, a };
  }
  const fnMatch = /^(s?rgba?|gr[ae]ya?|cmyka?)\(\s*([^)]+)\s*\)$/i.exec(s);
  if (fnMatch) {
    const kind = fnMatch[1]!.toLowerCase();
    const parts = fnMatch[2]!.split(/[\s,]+/).filter(Boolean);
    const parseChanByte = (p: string | undefined, def = 0) => {
      if (!p) return def;
      if (p.endsWith("%")) {
        return Math.max(0, Math.min(255, Math.round((parseFloat(p) / 100) * 255)));
      }
      return Math.max(0, Math.min(255, Math.round(parseFloat(p))));
    };
    const parseAlphaByte = (p: string | undefined) => {
      if (!p) return 255;
      if (p.endsWith("%")) {
        return Math.max(0, Math.min(255, Math.round((parseFloat(p) / 100) * 255)));
      }
      const num = parseFloat(p);
      return num <= 1 ? Math.max(0, Math.min(255, Math.round(num * 255))) : Math.max(0, Math.min(255, Math.round(num)));
    };
    if (kind.startsWith("gray") || kind.startsWith("grey")) {
      const v = parseChanByte(parts[0], 0);
      const a = parseAlphaByte(parts[1]);
      return { r: v, g: v, b: v, a };
    }
    if (kind.startsWith("cmyk")) {
      const parseUnit = (p: string | undefined) => {
        if (!p) return 0;
        if (p.endsWith("%")) return Math.max(0, Math.min(1, parseFloat(p) / 100));
        const num = parseFloat(p);
        return num <= 1 ? Math.max(0, Math.min(1, num)) : Math.max(0, Math.min(1, num / 255));
      };
      const c = parseUnit(parts[0]);
      const m = parseUnit(parts[1]);
      const y = parseUnit(parts[2]);
      const k = parseUnit(parts[3]);
      const a = parseAlphaByte(parts[4]);
      return {
        r: Math.round(255 * (1 - c) * (1 - k)),
        g: Math.round(255 * (1 - m) * (1 - k)),
        b: Math.round(255 * (1 - y) * (1 - k)),
        a
      };
    }
    const r = parseChanByte(parts[0], 0);
    const g = parseChanByte(parts[1], 0);
    const b = parseChanByte(parts[2], 0);
    const a = parseAlphaByte(parts[3]);
    return { r, g, b, a };
  }
  return baseParseColor(s);
}

export interface ImagemagickLimits {
  readonly maxInputBytes: number;
}

export interface ImageMagickCommandOptions {
  readonly limits?: Partial<ImagemagickLimits>;
  readonly replace?: boolean;
}

export interface ImageMagickCliResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly stdoutBytes?: Uint8Array;
}

export interface MagickGeometry {
  readonly width?: number;
  readonly height?: number;
  readonly x: number;
  readonly y: number;
  readonly hasOffset: boolean;
  readonly forceExact: boolean;
  readonly shrinkOnly: boolean;
  readonly enlargeOnly: boolean;
  readonly fillArea: boolean;
  readonly isPercent: boolean;
  readonly percentX?: number;
  readonly percentY?: number;
  readonly areaLimit?: number;
  readonly isSubdivide?: boolean;
}

export function parseMagickGeometry(raw: string): MagickGeometry {
  let s = raw.trim();
  let forceExact = false;
  let shrinkOnly = false;
  let enlargeOnly = false;
  let fillArea = false;
  let isPercent = false;
  let isArea = false;

  while (s.length > 0) {
    const last = s[s.length - 1]!;
    if (last === "!") {
      forceExact = true;
      s = s.slice(0, -1);
    } else if (last === ">") {
      shrinkOnly = true;
      s = s.slice(0, -1);
    } else if (last === "<") {
      enlargeOnly = true;
      s = s.slice(0, -1);
    } else if (last === "^") {
      fillArea = true;
      s = s.slice(0, -1);
    } else if (last === "%") {
      isPercent = true;
      s = s.slice(0, -1);
    } else if (last === "@") {
      isArea = true;
      s = s.slice(0, -1);
    } else {
      break;
    }
  }

  let x = 0;
  let y = 0;
  let hasOffset = false;
  const offsetMatch = /^([^+-]*)([+-]\d+(?:\.\d+)?)(?:([+-]\d+(?:\.\d+)?))?$/.exec(s);
  if (offsetMatch) {
    s = offsetMatch[1]!;
    x = Number(offsetMatch[2]!);
    y = offsetMatch[3] !== undefined ? Number(offsetMatch[3]!) : 0;
    hasOffset = true;
  }

  while (s.length > 0) {
    const last = s[s.length - 1]!;
    if (last === "!") {
      forceExact = true;
      s = s.slice(0, -1);
    } else if (last === ">") {
      shrinkOnly = true;
      s = s.slice(0, -1);
    } else if (last === "<") {
      enlargeOnly = true;
      s = s.slice(0, -1);
    } else if (last === "^") {
      fillArea = true;
      s = s.slice(0, -1);
    } else if (last === "%") {
      isPercent = true;
      s = s.slice(0, -1);
    } else if (last === "@") {
      isArea = true;
      s = s.slice(0, -1);
    } else {
      break;
    }
  }

  if (isArea) {
    if (s.includes("x") || s.includes("X")) {
      const [wStr, hStr] = s.split(/[xX]/);
      return {
        width: Math.max(1, Number(wStr) || 1),
        height: Math.max(1, Number(hStr) || 1),
        x,
        y,
        hasOffset,
        forceExact,
        shrinkOnly,
        enlargeOnly,
        fillArea,
        isPercent: false,
        isSubdivide: true
      };
    }
    const areaLimit = Math.max(1, Number(s) || 1);
    return {
      areaLimit,
      x,
      y,
      hasOffset,
      forceExact,
      shrinkOnly,
      enlargeOnly,
      fillArea,
      isPercent
    };
  }

  let width: number | undefined;
  let height: number | undefined;
  if (s.includes("x") || s.includes("X")) {
    let [wStr, hStr] = s.split(/[xX]/);
    if (wStr?.endsWith("%")) {
      isPercent = true;
      wStr = wStr.slice(0, -1);
    }
    if (hStr?.endsWith("%")) {
      isPercent = true;
      hStr = hStr.slice(0, -1);
    }
    if (wStr && wStr.length > 0) width = Number(wStr);
    if (hStr && hStr.length > 0) height = Number(hStr);
  } else if (s.length > 0) {
    width = Number(s);
  }

  if (isPercent) {
    const px = width ?? height ?? 100;
    const py = height ?? width ?? 100;
    return {
      ...(width !== undefined && !Number.isNaN(width) ? { width } : {}),
      ...(height !== undefined && !Number.isNaN(height) ? { height } : {}),
      percentX: px,
      percentY: py,
      x,
      y,
      hasOffset,
      forceExact,
      shrinkOnly,
      enlargeOnly,
      fillArea,
      isPercent: true
    };
  }

  return {
    ...(width !== undefined && !Number.isNaN(width) ? { width } : {}),
    ...(height !== undefined && !Number.isNaN(height) ? { height } : {}),
    x,
    y,
    hasOffset,
    forceExact,
    shrinkOnly,
    enlargeOnly,
    fillArea,
    isPercent: false
  };
}

interface MagickState {
  sizeWidth: number;
  sizeHeight: number;
  hasSize: boolean;
  background: RgbaColor;
  fill: RgbaColor;
  stroke: RgbaColor;
  strokeWidth: number;
  borderColor: RgbaColor;
  pointsize: number;
  gravity: GravityPosition;
  quality: number;
  density: number;
  fuzz: number;
  kernel: ResizeKernel;
  compose: BlendMode;
  composeRaw: string;
  composeArgs: string | undefined;
  geometry: string | undefined;
  tile: string | undefined;
  strip: boolean;
  adjoin: boolean;
  dither: boolean;
  formatStr: string | undefined;
  channels: { r: boolean; g: boolean; b: boolean; a: boolean };
  channelExplicit: boolean;
}

function createDefaultState(): MagickState {
  return {
    sizeWidth: 1,
    sizeHeight: 1,
    hasSize: false,
    background: { r: 255, g: 255, b: 255, a: 255 },
    fill: { r: 0, g: 0, b: 0, a: 255 },
    stroke: { r: 0, g: 0, b: 0, a: 0 },
    strokeWidth: 1,
    borderColor: { r: 223, g: 223, b: 223, a: 255 },
    pointsize: 12,
    gravity: "northwest",
    quality: 92,
    density: 72,
    fuzz: 10,
    kernel: "lanczos3",
    compose: "over",
    composeRaw: "Over",
    composeArgs: undefined,
    geometry: undefined,
    tile: undefined,
    strip: false,
    adjoin: true,
    dither: true,
    formatStr: undefined,
    channels: { r: true, g: true, b: true, a: false },
    channelExplicit: false
  };
}

type MorphologyStep = { mode: "min" | "max" | "median"; source: number } | { mode: "diff"; a: number; b: number };
function magickMorphologyPlan(methodRaw: string, kernelSpec: string): { rx: number; ry: number; steps: MorphologyStep[] } {
  let rx = 1;
  let ry = 1;
  const colonIdx = kernelSpec.indexOf(":");
  const sizePart = colonIdx >= 0 ? kernelSpec.slice(colonIdx + 1) : kernelSpec;
  if (sizePart.includes("x")) {
    const [wS, hS] = sizePart.split("x");
    rx = Math.max(1, Math.floor((Number(wS) || 3) / 2));
    ry = Math.max(1, Math.floor((Number(hS) || 3) / 2));
  } else if (sizePart.length > 0 && !Number.isNaN(Number(sizePart))) {
    rx = Math.max(1, Math.round(Number(sizePart)));
    ry = rx;
  }

  const filter = (source: number, mode: "min" | "max" | "median"): MorphologyStep => ({ source, mode });
  const diff = (a: number, b: number): MorphologyStep => ({ mode: "diff", a, b });
  let steps: MorphologyStep[];
  switch (methodRaw.toLowerCase()) {
    case "erode": case "minimum": steps = [filter(0, "min")]; break;
    case "median": steps = [filter(0, "median")]; break;
    case "open": steps = [filter(0, "min"), filter(1, "max")]; break;
    case "close": steps = [filter(0, "max"), filter(1, "min")]; break;
    case "edgein": steps = [filter(0, "min"), diff(0, 1)]; break;
    case "edgeout": steps = [filter(0, "max"), diff(1, 0)]; break;
    case "edge": case "gradient": steps = [filter(0, "max"), filter(0, "min"), diff(1, 2)]; break;
    case "tophat": steps = [filter(0, "min"), filter(1, "max"), diff(0, 2)]; break;
    case "bottomhat": steps = [filter(0, "max"), filter(1, "min"), diff(2, 0)]; break;
    default: steps = [filter(0, "max")];
  }
  return { rx, ry, steps };
}
function* subtractMagickPixelSteps(a: Uint8Array, b: Uint8Array): Generator<void, Uint8Array, void> {
    const result = new Uint8Array(a.length);
    for (let i = 0; i < a.length; i++) {
        if (i % 16384 === 0) yield;
        result[i] = clampByteVal(a[i]! - b[i]!);
    }
    return result;
}
function* applyMagickMorphology4ChSteps(img: RgbaImage, methodRaw: string, kernelSpec: string, signal?: AbortSignal): Generator<void, RgbaImage, void> {
    const plan = magickMorphologyPlan(methodRaw, kernelSpec), images = [img];
    for (const step of plan.steps) {
        if (step.mode === "diff") {
            const a = images[step.a]!, b = images[step.b]!;
            images.push({ ...a, data: yield* subtractMagickPixelSteps(a.data, b.data) });
        } else {
            const source = images[step.source]!;
            images.push(yield* applyMagickRasterSteps(source, morphologyPixelSteps(source, plan.rx, plan.ry, step.mode), signal));
        }
    }
    return images.at(-1)!;
}

function* createRoseImageSteps(): Generator<void, RgbaImage, void> {
    let work = 0;
    const w = 70;
    const h = 46;
    const data = new Uint8Array(new ArrayBuffer(w * h * 4 + h), 0, w * h * 4);
    for (let y = 0; y < h; y++) {
        if (++work % 16384 === 0)
            yield;
        for (let x = 0; x < w; x++) {
            if (++work % 16384 === 0)
                yield;
            const idx = (y * w + x) * 4;
            const dx = (x - 35) / 35;
            const dy = (y - 23) / 23;
            const rDist = Math.hypot(dx, dy);
            data[idx] = clampByteVal(rDist < 0.65 ? 220 - rDist * 80 : 40 + x * 1.5);
            data[idx + 1] = clampByteVal(rDist < 0.65 ? 30 + rDist * 60 : 120 + y * 2);
            data[idx + 2] = clampByteVal(rDist < 0.65 ? 50 + rDist * 40 : 45);
            data[idx + 3] = 255;
        }
    }
    return {
        width: w,
        height: h,
        format: "png",
        channels: 4,
        depth: "uchar",
        density: 72,
        space: "srgb",
        hasAlpha: true,
        data
    };
}

function* applyMagickFloodfillSteps(
  img: RgbaImage,
  geomStr: string,
  targetColor: RgbaColor | undefined,
  replacement: RgbaColor,
  fuzz: number, signal?: AbortSignal): Generator<void, RgbaImage, void> {
    let cooperativeWork = 0;
    const g = parseMagickGeometry(geomStr);
  const w = img.width;
  const h = img.height;
  const sx = Math.max(0, Math.min(w - 1, Math.round(g.x || g.width || 0)));
  const sy = Math.max(0, Math.min(h - 1, Math.round(g.y || g.height || 0)));
  const out = new Uint8Array(img.data);
  const seedOff = (sy * w + sx) * 4;
  const refR = targetColor ? targetColor.r : out[seedOff]!;
  const refG = targetColor ? targetColor.g : out[seedOff + 1]!;
  const refB = targetColor ? targetColor.b : out[seedOff + 2]!;

  const matchesRef = (pIdx: number): boolean => {
    const off = pIdx * 4;
    return (
      Math.max(
        Math.abs(out[off]! - refR),
        Math.abs(out[off + 1]! - refG),
        Math.abs(out[off + 2]! - refB)
      ) <= fuzz
    );
  };

  const startIdx = sy * w + sx;
  if (!matchesRef(startIdx)) return img;

  const visited = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let head = 0;
  let tail = 0;
  queue[tail++] = startIdx;
  visited[startIdx] = 1;

  while (head < tail) {
        if (++cooperativeWork % 65536 === 0)
            yield;
        const cur = queue[head++]!;
    const off = cur * 4;
    out[off] = replacement.r;
    out[off + 1] = replacement.g;
    out[off + 2] = replacement.b;
    out[off + 3] = replacement.a;

    const cx = cur % w;
    const cy = Math.floor(cur / w);
    const neighbors = [
      cx > 0 ? cur - 1 : -1,
      cx + 1 < w ? cur + 1 : -1,
      cy > 0 ? cur - w : -1,
      cy + 1 < h ? cur + w : -1
    ];
    for (const nb of neighbors) {
      if (++cooperativeWork % 65536 === 0)
                yield;
            if (nb >= 0 && visited[nb] === 0 && matchesRef(nb)) {
        visited[nb] = 1;
        queue[tail++] = nb;
      }
    }
  }
  return { ...img, data: out, hasAlpha: true };
}

function* applyMagickEvaluateSequenceSteps(stack: readonly RgbaImage[], opRaw: string, signal?: AbortSignal): Generator<void, RgbaImage, void> {
    let cooperativeWork = 0;
    if (stack.length === 0) {
        throw new Error("evaluate-sequence requires at least one image");
    }
    if (stack.length === 1)
        return stack[0]!;
    const base = stack[0]!;
    const w = base.width;
    const h = base.height;
    const normalized = (yield* mapSteps(stack, function* (im) {
        return im.width === w && im.height === h ? im : (yield* applyMagickResizeSteps(im, `${w}x${h}!`, "bilinear"));
    }));
    const n = normalized.length;
    const out = new Uint8Array(new ArrayBuffer(w * h * 4 + h), 0, w * h * 4);
    const op = opRaw.toLowerCase().replace(/[-_]/g, "");
    const vals = new Float64Array(n);
    for (let i = 0; i < out.length; i++) {
        if (++cooperativeWork % 65536 === 0)
            yield;
        if ((i & 3) === 3) {
            out[i] = base.data[i]!;
            continue;
        }
        for (let k = 0; k < n; k++) {
            if (++cooperativeWork % 65536 === 0)
                yield;
            vals[k] = normalized[k]!.data[i]!;
        }
        let res = vals[0]!;
        if (op === "mean" || op === "average") {
            let s = 0;
            for (let k = 0; k < n; k++)
                s += vals[k]!;
            res = s / n;
        }
        else if (op === "median") {
            const baseOff = i & ~3;
            const order = Array.from({ length: n }, (_, k) => k).sort((a, b) => {
                const da = normalized[a]!.data;
                const db = normalized[b]!.data;
                const sumA = da[baseOff]! + da[baseOff + 1]! + da[baseOff + 2]! + da[baseOff + 3]!;
                const sumB = db[baseOff]! + db[baseOff + 1]! + db[baseOff + 2]! + db[baseOff + 3]!;
                return sumA - sumB;
            });
            res = vals[order[Math.floor(n / 2)]!]!;
        }
        else if (op === "min") {
            res = Math.min(...vals);
        }
        else if (op === "max") {
            res = Math.max(...vals);
        }
        else if (op === "add") {
            let s = 0;
            for (let k = 0; k < n; k++)
                s += vals[k]!;
            res = s;
        }
        else if (op === "multiply") {
            let p = 1;
            for (let k = 0; k < n; k++)
                p *= vals[k]! / 255;
            res = p * 255;
        }
        out[i] = clampByteVal(res);
    }
    return { ...base, data: out };
}

function parseMagickConvolveKernel(spec: string): number[] {
    const afterColon = spec.includes(":") ? spec.slice(spec.indexOf(":") + 1) : spec;
    return afterColon.trim().split(/[\s,]+/).filter(s => s.length > 0).map(Number).filter(Number.isFinite);
}
function* applyMagickCustomConvolveSteps(img: RgbaImage, spec: string, signal?: AbortSignal): Generator<void, RgbaImage, void> {
    const kernel = parseMagickConvolveKernel(spec);
    return kernel.length ? yield* applyMagickRasterSteps(img, convolvePixelSteps(img, kernel, 0), signal) : img;
}

function* applyMagickColorMatrixSteps(img: RgbaImage, spec: string, signal?: AbortSignal): Generator<void, RgbaImage, void> {
    let cooperativeWork = 0;
    const afterColon = spec.includes(":") ? spec.slice(spec.indexOf(":") + 1) : spec;
    const m = afterColon
        .trim()
        .split(/[\s,]+/)
        .filter((s) => s.length > 0)
        .map(Number);
    if (m.length < 9)
        return img;
    const out = new Uint8Array(img.data);
    const cols = m.length >= 16 ? Math.round(Math.sqrt(m.length)) : 3;
    for (let i = 0; i < out.length; i += 4) {
        if (++cooperativeWork % 65536 === 0)
            yield;
        const r = out[i]!;
        const g = out[i + 1]!;
        const b = out[i + 2]!;
        out[i] = clampByteVal((m[0] ?? 1) * r + (m[1] ?? 0) * g + (m[2] ?? 0) * b);
        out[i + 1] = clampByteVal((m[cols] ?? 0) * r + (m[cols + 1] ?? 1) * g + (m[cols + 2] ?? 0) * b);
        out[i + 2] = clampByteVal((m[cols * 2] ?? 0) * r + (m[cols * 2 + 1] ?? 0) * g + (m[cols * 2 + 2] ?? 1) * b);
    }
    return { ...img, data: out };
}

function* applyMagickRemapSteps(img: RgbaImage, palImg: RgbaImage, dither: boolean, signal?: AbortSignal): Generator<void, RgbaImage, void> {
    let cooperativeWork = 0;
    const palette: Array<{
        r: number;
        g: number;
        b: number;
    }> = [];
    const seen = new Set<number>();
    for (let i = 0; i < palImg.data.length; i += 4) {
        if (++cooperativeWork % 65536 === 0)
            yield;
        const r = palImg.data[i]!;
        const g = palImg.data[i + 1]!;
        const b = palImg.data[i + 2]!;
        const key = (r << 16) | (g << 8) | b;
        if (!seen.has(key)) {
            seen.add(key);
            palette.push({ r, g, b });
            if (palette.length >= 256)
                break;
        }
    }
    if (palette.length === 0)
        return img;
    const w = img.width;
    const h = img.height;
    const buf = new Float32Array(img.data);
    const out = new Uint8Array(img.data);
    for (let y = 0; y < h; y++) {
        if (++cooperativeWork % 65536 === 0)
            yield;
        for (let x = 0; x < w; x++) {
            if (++cooperativeWork % 65536 === 0)
                yield;
            const idx = (y * w + x) * 4;
            const oldR = Math.max(0, Math.min(255, buf[idx]!));
            const oldG = Math.max(0, Math.min(255, buf[idx + 1]!));
            const oldB = Math.max(0, Math.min(255, buf[idx + 2]!));
            let best = palette[0]!;
            let bestDist = Infinity;
            for (const p of palette) {
                if (++cooperativeWork % 65536 === 0)
                    yield;
                const d = (oldR - p.r) ** 2 + (oldG - p.g) ** 2 + (oldB - p.b) ** 2;
                if (d < bestDist) {
                    bestDist = d;
                    best = p;
                }
            }
            out[idx] = best.r;
            out[idx + 1] = best.g;
            out[idx + 2] = best.b;
            if (dither) {
                const errR = oldR - best.r;
                const errG = oldG - best.g;
                const errB = oldB - best.b;
                const spread = (nx: number, ny: number, wgt: number) => {
                    if (nx < 0 || nx >= w || ny < 0 || ny >= h)
                        return;
                    const nIdx = (ny * w + nx) * 4;
                    buf[nIdx] = buf[nIdx]! + errR * wgt;
                    buf[nIdx + 1] = buf[nIdx + 1]! + errG * wgt;
                    buf[nIdx + 2] = buf[nIdx + 2]! + errB * wgt;
                };
                spread(x + 1, y, 7 / 16);
                spread(x - 1, y + 1, 3 / 16);
                spread(x, y + 1, 5 / 16);
                spread(x + 1, y + 1, 1 / 16);
            }
        }
    }
    return { ...img, data: out };
}

type MagickImage = RgbaImage & { [magickInput]?: MagickFormatContext };

function* magickPixelPropertiesSteps<Step=never>(
  img: Omit<RgbaImage,"data"|"data16"> & Partial<Pick<RgbaImage,"data"|"data16">>,
  load?: (position:number,length:number)=>Generator<Step,{data:Uint8Array;data16?:Uint16Array},void>
): Generator<void|Step, Record<string, string>, void> {
  const sums = [0, 0, 0];
  const squares = [0, 0, 0];
  let min = 255;
  let max = 0;
  let opaque = true;
  let gray = true;
  let bilevel = true;
  let bitDepth = 1;
  const colors = new Set<number>();
  const count = Math.max(1, img.width * img.height);
  for(let offset=0;offset<img.width*img.height*4;offset+=8192){
  const length=Math.min(8192,img.width*img.height*4-offset);
  const chunk=load?yield*load(offset,length):{data:img.data!.subarray(offset,offset+length),data16:img.data16?.subarray(offset,offset+length)};
  const samples = chunk.data16 ?? chunk.data;
  const range = chunk.data16 ? 65535 : 255;
  for (let i = 0; i < chunk.data.length; i += 4) {
    if (i % 65536 === 0) yield;
    const r = samples[i]!;
    const g = samples[i + 1]!;
    const b = samples[i + 2]!;
    const a = img.hasAlpha ? samples[i + 3]! : range;
    opaque &&= a === range;
    gray &&= r === g && g === b;
    bilevel &&= (r === 0 || r === range) && (g === 0 || g === range) && (b === 0 || b === range);
    // Only palette classification needs distinct colors; stop growing at 257.
    if (colors.size <= 256) {
      colors.add(((chunk.data[i]! * 256 + chunk.data[i + 1]!) * 256 + chunk.data[i + 2]!) * 256 + (img.hasAlpha ? chunk.data[i + 3]! : 255));
    }
    for (let c = 0; c < (img.hasAlpha ? 4 : 3); c++) {
      const value = samples[i + c]!;
      while (bitDepth < (chunk.data16 ? 16 : 8)) {
        const levels = 2 ** bitDepth - 1;
        if (Math.round(Math.round(value * levels / range) * range / levels) === value) break;
        bitDepth++;
      }
      if (c < 3) {
        const v = chunk.data[i + c]!;
        sums[c]! += v;
        squares[c]! += v * v;
        min = Math.min(min, v);
        max = Math.max(max, v);
      }
    }
  }
  }
  const suffix = img.hasAlpha ? "Alpha" : "";
  const type = img.space === "cmyk" ? `ColorSeparation${suffix}`
    : gray ? (bilevel ? "Bilevel" : `Grayscale${suffix}`)
    : `${colors.size <= 256 ? "Palette" : "TrueColor"}${suffix}`;
  const deviation = sums.reduce((sum, value, c) => sum + Math.sqrt(Math.max(0,
    (squares[c]! - value * value / count) / Math.max(1, count - 1))), 0) / 3;
  return {
    mean: formatMetricNum(sums.reduce((sum, value) => sum + value, 0) / (count * 3)),
    min: String(min),
    max: String(max),
    "standard-deviation": formatMetricNum(deviation),
    opaque: String(opaque),
    type,
    "bit-depth": String(bitDepth)
  };
}

function* formatMagickPropertyStringSteps<Step=never>(
  fmt: string,
  meta: ImageMetadata,
  getImage: () => RgbaImage,
  context: MagickFormatContext = {},
  resolvePixels?: (property:string)=>Generator<Step,string,void>
): Generator<void|Step, string, void> {
  const filePath = context.filePath ?? "";
  const baseName = filePath.slice(filePath.lastIndexOf("/") + 1);
  const dot = baseName.lastIndexOf(".");
  const bitDepth = String(meta.bitsPerSample ?? (meta.depth === "ushort" ? 16 : meta.depth === "bit" ? 1 : 8));
  const space = meta.space === "b-w" || meta.space === "grey16" ? "Gray" : meta.space === "cmyk" ? "CMYK" : "sRGB";
  const compression = ({ png: "Zip", jpeg: "JPEG", gif: "LZW", heic: "HEVC", heif: "HEVC", avif: "AV1" } as Partial<Record<ImageFormat, string>>)[meta.format] ?? "None";
  const short: Record<string, string> = {
    w: String(meta.width), h: String(meta.height), m: meta.format.toUpperCase(),
    z: bitDepth, q: bitDepth, r: `DirectClass ${space}`,
    f: baseName, t: dot < 0 ? baseName : baseName.slice(0, dot), e: dot < 0 ? "" : baseName.slice(dot + 1), i: filePath,
    b: `${context.byteLen ?? 0}B`, B: String(context.byteLen ?? 0),
    x: String(meta.density ?? 72), y: String(meta.density ?? 72),
    s: String(context.sceneIdx ?? 0), n: String(context.sceneCount ?? meta.pages ?? 1),
    g: `${meta.width}x${meta.height}+0+0`, P: `${meta.width}x${meta.height}`,
    C: compression, Q: String(context.quality ?? 92)
  };
  const properties: Record<string, string> = {
    colorspace: space, channels: `${space.toLowerCase()}${meta.hasAlpha ? "a" : ""}`,
    width: String(context.originalWidth ?? meta.width), height: String(context.originalHeight ?? meta.height),
    depth: bitDepth, size: short.b!, compression, quality: short.Q!
  };
  let img: RgbaImage | undefined;
  let pixels: Record<string, string> | undefined;
  const parts: string[] = [];
  // Only tokenize the original template. Expanded filenames and literal percent
  // escapes must never become new input, including for computed properties.
  const tokens = /\\[ntr\\%]|%%|%\[|%[a-z]/gi;
  let previous = 0;
  let match: RegExpExecArray | null;
  while ((match = tokens.exec(fmt)) !== null) {
    parts.push(fmt.slice(previous, match.index));
    let token = match[0];
    if (token === "%[") {
      let depth = 1;
      let end = tokens.lastIndex;
      for (; end < fmt.length && depth > 0; end++) {
        if (end % 16384 === 0) yield;
        if (fmt[end] === "[") depth++;
        else if (fmt[end] === "]") depth--;
      }
      if (depth !== 0) {
        parts.push(fmt.slice(match.index));
        previous = fmt.length;
        break;
      }
      token = fmt.slice(match.index, end);
      tokens.lastIndex = end;
    }
    previous = tokens.lastIndex;
    if (token[0] === "\\") {
      parts.push(({ n: "\n", t: "\t", r: "\r" } as Record<string, string>)[token[1]!] ?? token[1]!);
    } else if (token === "%%") {
      parts.push("%");
    } else if (token[1] !== "[") {
      parts.push(short[token[1]!] ?? token);
    } else {
      const property = token.slice(2, -1);
      const key = property.toLowerCase();
      if (Object.hasOwn(properties, key)) {
        parts.push(properties[key]!);
      } else if (["mean", "min", "max", "standard-deviation", "opaque", "type", "bit-depth"].includes(key)) {
        if(resolvePixels){parts.push(yield*resolvePixels(property));continue;}
        img ??= getImage();
        pixels ??= yield* magickPixelPropertiesSteps(img);
        parts.push(pixels[key]!);
      } else if (key.startsWith("fx:") || key.startsWith("pixel:") || key.startsWith("hex:")) {
        if(resolvePixels){parts.push(yield*resolvePixels(property));continue;}
        img ??= getImage();
        const fn = compileFxExpression(property.slice(property.indexOf(":") + 1));
        const ctx: FxEvalContext = { stack: [img], x: 0, y: 0, w: img.width, h: img.height, ch: 0, vars: new Map() };
        if (key.startsWith("fx:")) {
          parts.push(formatMetricNum(fn(ctx)));
        } else {
          const channels: number[] = [];
          for (let ch = 0; ch < (img.hasAlpha ? 4 : 3); ch++) {
            ctx.vars.clear();
            channels.push(clampByteVal(fn({ ...ctx, ch }) * 255));
          }
          if (key.startsWith("hex:")) {
            parts.push(channels.map(value => value.toString(16).toUpperCase().padStart(2, "0")).join(""));
          } else {
            // Preserve the existing RGB pixel spelling for opaque samples.
            parts.push(channels[3] !== undefined && channels[3] !== 255
              ? `srgba(${channels.slice(0, 3).join(",")},${formatMetricNum(channels[3] / 255)})`
              : `srgb(${channels.slice(0, 3).join(",")})`);
          }
        }
      } else {
        parts.push(token);
      }
    }
  }
  parts.push(fmt.slice(previous));
  return parts.join("");
}

class FxPixelDemand { constructor(readonly position:number, readonly image = 0){} }
function* formatStoredFxSteps(property:string,{image,storage}:IdentifyRaster,signal?:AbortSignal):Generator<IdentifyStep,string,void>{
 const fn=compileFxExpression(property.slice(property.indexOf(":")+1)),key=property.toLowerCase(),samples=new Map<number,Uint8Array>();
 const context:FxEvalContext={stack:[image],x:0,y:0,w:image.width,h:image.height,ch:0,vars:new Map(),sample(target,x,y,ch){
  if(!target)return 0;
  const px=Math.max(0,Math.min(target.width-1,Math.round(x))),py=Math.max(0,Math.min(target.height-1,Math.round(y))),position=(py*target.width+px)*4;
  if(!Number.isFinite(position))return NaN;
  const data=samples.get(position);if(!data)throw new FxPixelDemand(position);
  return sampleFxImage({...target,width:1,height:1,data},0,0,ch);
 }};
 // The expression language has no loops or external effects. Replay after a
 // missing sample, resetting local assignments. Samples are bounded by the
 // expression's references, independent of image dimensions, and retired here.
 const channels:number[]=[];
 for(let ch=0;ch<(key.startsWith("fx:")?1:image.hasAlpha?4:3);ch++){
  let value:number;
  while(true){
   signal?.throwIfAborted();context.vars.clear();
   try{value=fn({...context,ch});break;}
   catch(error){if(!(error instanceof FxPixelDemand))throw error;
    yield {async run(){const data=await storage.read(image.position+error.position,4,signal?{signal}:undefined);samples.set(error.position,new Uint8Array(data));}};
   }
  }
  if(key.startsWith("fx:"))return formatMetricNum(value);
  channels.push(clampByteVal(value*255));
 }
 if(key.startsWith("hex:"))return channels.map(value=>value.toString(16).toUpperCase().padStart(2,"0")).join("");
 return channels[3]!==undefined&&channels[3]!==255?`srgba(${channels.slice(0,3).join(",")},${formatMetricNum(channels[3]/255)})`:`srgb(${channels.slice(0,3).join(",")})`;
}

async function formatRetainedIdentify(format:string,metadata:ImageMetadata,context:MagickFormatContext,getRaster:()=>Promise<IdentifyRaster>,signal?:AbortSignal):Promise<string>{
 let raster:IdentifyRaster|undefined,properties:Record<string,string>|undefined;
 function* resolve(property:string):Generator<IdentifyStep,string,void>{
  if(!raster)yield {async run(){raster=await getRaster();}};
  if(property.includes(":"))return yield*formatStoredFxSteps(property,raster!,signal);
  if(!properties)properties=yield*magickPixelPropertiesSteps(raster!.image,function*(position,length):Generator<IdentifyStep,{data:Uint8Array;data16?:Uint16Array},void>{
   let chunk!: {data:Uint8Array;data16?:Uint16Array};
   yield {async run(){const {image,storage}=raster!,data=await storage.read(image.position+position,length,signal?{signal}:undefined);
    const original=image.storedData16;
    const bytes=original?await storage.read(original.position+position*2,Math.max(0,Math.min(length,original.length-position))*2,signal?{signal}:undefined):undefined;
    chunk={data,...(bytes?{data16:new Uint16Array(bytes.buffer,bytes.byteOffset,bytes.byteLength/2)}:{})};
   }};
   return chunk;
  });
  return properties[property.toLowerCase()]!;
 }
 return drainIdentifySteps(formatMagickPropertyStringSteps(format,metadata,()=>{throw new UnsupportedStoredResource("Pixel formatting requires decoded input");},context,resolve),signal);
}

function* formatTxtEnumerationSteps(img: RgbaImage): Generator<void, string, void> {
    let work = 0;
    const lines: string[] = [
        `# ImageMagick pixel enumeration: ${img.width},${img.height},255,srgba`
    ];
    const hex = (n: number) => n.toString(16).toUpperCase().padStart(2, "0");
    for (let y = 0; y < img.height; y++) {
        if (++work % 16384 === 0)
            yield;
        for (let x = 0; x < img.width; x++) {
            if (++work % 16384 === 0)
                yield;
            const idx = (y * img.width + x) * 4;
            const r = img.data[idx]!;
            const g = img.data[idx + 1]!;
            const b = img.data[idx + 2]!;
            const a = img.data[idx + 3]!;
            lines.push(`${x},${y}: (${r},${g},${b},${a})  #${hex(r)}${hex(g)}${hex(b)}${a < 255 ? hex(a) : ""}  srgba(${r},${g},${b},${(a / 255).toFixed(3)})`);
        }
    }
    return lines.join("\n") + "\n";
}

function* formatHistogramOutputSteps(img: RgbaImage): Generator<void, string, void> {
    let work = 0;
    const counts = new Map<number, number>();
    for (let i = 0; i < img.data.length; i += 4) {
        if (++work % 16384 === 0)
            yield;
        const key = ((img.data[i]! << 24) | (img.data[i + 1]! << 16) | (img.data[i + 2]! << 8) | img.data[i + 3]!) >>> 0;
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const hex = (n: number) => n.toString(16).toUpperCase().padStart(2, "0");
    const lines: string[] = [];
    for (const [key, cnt] of counts.entries()) {
        if (++work % 16384 === 0)
            yield;
        const r = (key >>> 24) & 0xff;
        const g = (key >>> 16) & 0xff;
        const b = (key >>> 8) & 0xff;
        lines.push(`  ${cnt}: (${r},${g},${b}) #${hex(r)}${hex(g)}${hex(b)} srgb(${r},${g},${b})`);
    }
    return lines.join("\n") + "\n";
}

function* createGradientImageSteps(width: number, height: number, c1: RgbaColor, c2: RgbaColor, radial: boolean): Generator<void, RgbaImage, void> {
    let work = 0;
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    const data = new Uint8Array(new ArrayBuffer(w * h * 4 + h), 0, w * h * 4);
    if (!radial) {
        const u32 = new Uint32Array(data.buffer, 0, w * h);
        const tmp = new Uint8Array(4);
        const tmp32 = new Uint32Array(tmp.buffer);
        for (let y = 0; y < h; y++) {
            const t = h <= 1 ? 0 : y / (h - 1);
            tmp[0] = clampByteVal(c1.r * (1 - t) + c2.r * t);
            tmp[1] = clampByteVal(c1.g * (1 - t) + c2.g * t);
            tmp[2] = clampByteVal(c1.b * (1 - t) + c2.b * t);
            tmp[3] = clampByteVal(c1.a * (1 - t) + c2.a * t);
            u32.fill(tmp32[0]!, y * w, (y + 1) * w);
        }
    } else {
        const cx = (w - 1) / 2;
        const cy = (h - 1) / 2;
        const maxR = Math.max(1, Math.hypot(cx, cy));
        for (let y = 0; y < h; y++) {
            if (++work % 16384 === 0)
                yield;
            for (let x = 0; x < w; x++) {
                if (++work % 16384 === 0)
                    yield;
                const t = Math.min(1, Math.hypot(x - cx, y - cy) / maxR);
                const idx = (y * w + x) * 4;
                data[idx] = clampByteVal(c1.r * (1 - t) + c2.r * t);
                data[idx + 1] = clampByteVal(c1.g * (1 - t) + c2.g * t);
                data[idx + 2] = clampByteVal(c1.b * (1 - t) + c2.b * t);
                data[idx + 3] = clampByteVal(c1.a * (1 - t) + c2.a * t);
            }
        }
    }
    return {
        width: w,
        height: h,
        format: "png",
        channels: 4,
        depth: "uchar",
        density: 72,
        space: "srgb",
        hasAlpha: true,
        data
    };
}

function* createCheckerboardImageSteps(width: number, height: number): Generator<void, RgbaImage, void> {
    let work = 0;
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    const data = new Uint8Array(new ArrayBuffer(w * h * 4 + h), 0, w * h * 4);
    for (let y = 0; y < h; y++) {
        if (++work % 16384 === 0)
            yield;
        for (let x = 0; x < w; x++) {
            if (++work % 16384 === 0)
                yield;
            const cell = ((Math.floor(x / 8) + Math.floor(y / 8)) & 1) === 0 ? 102 : 153;
            const idx = (y * w + x) * 4;
            data[idx] = cell;
            data[idx + 1] = cell;
            data[idx + 2] = cell;
            data[idx + 3] = 255;
        }
    }
    return {
        width: w,
        height: h,
        format: "png",
        channels: 4,
        depth: "uchar",
        density: 72,
        space: "srgb",
        hasAlpha: true,
        data
    };
}

function* applyMagickSpliceSteps(img: RgbaImage, geomStr: string, bg: RgbaColor, gravity: GravityPosition = "northwest", signal?: AbortSignal): Generator<void, RgbaImage, void> {
    let cooperativeWork = 0;
    const g = parseMagickGeometry(geomStr);
    const sw = Math.max(0, Math.round(g.width ?? 0));
    const sh = Math.max(0, Math.round(g.height ?? 0));
    const base = resolveGravityOffset(img.width, img.height, gravity);
    const isEast = gravity === "east" || gravity === "northeast" || gravity === "southeast";
    const isSouth = gravity === "south" || gravity === "southwest" || gravity === "southeast";
    const sx = Math.max(0, Math.min(img.width, Math.round(base.left + (isEast ? -g.x : g.x))));
    const sy = Math.max(0, Math.min(img.height, Math.round(base.top + (isSouth ? -g.y : g.y))));
    const outW = img.width + sw;
    const outH = img.height + sh;
    const out = new Uint8Array(new ArrayBuffer(outW * outH * 4 + outH), 0, outW * outH * 4);
    for (let y = 0; y < outH; y++) {
        if (++cooperativeWork % 65536 === 0)
            yield;
        for (let x = 0; x < outW; x++) {
            if (++cooperativeWork % 65536 === 0)
                yield;
            const dstIdx = (y * outW + x) * 4;
            if ((x >= sx && x < sx + sw) || (y >= sy && y < sy + sh)) {
                out[dstIdx] = bg.r;
                out[dstIdx + 1] = bg.g;
                out[dstIdx + 2] = bg.b;
                out[dstIdx + 3] = bg.a;
            }
            else {
                const origX = x < sx ? x : x - sw;
                const origY = y < sy ? y : y - sh;
                const srcIdx = (origY * img.width + origX) * 4;
                out[dstIdx] = img.data[srcIdx]!;
                out[dstIdx + 1] = img.data[srcIdx + 1]!;
                out[dstIdx + 2] = img.data[srcIdx + 2]!;
                out[dstIdx + 3] = img.data[srcIdx + 3]!;
            }
        }
    }
    return { ...img, width: outW, height: outH, data: out, hasAlpha: true };
}

function* applyMagickChopSteps(img: RgbaImage, geomStr: string, gravity: GravityPosition = "northwest", signal?: AbortSignal): Generator<void, RgbaImage, void> {
    let cooperativeWork = 0;
    const g = parseMagickGeometry(geomStr);
    const cw = Math.max(0, Math.round(g.width ?? 0));
    const ch = Math.max(0, Math.round(g.height ?? 0));
    const { x: x0, y: y0 } = gravityAdjustBox(img.width, img.height, cw, ch, g.x, g.y, gravity);
    if (x0 + cw < 0 || y0 + ch < 0 || x0 > img.width || y0 > img.height) {
        return img;
    }
    const cx0 = Math.max(0, Math.min(img.width, x0));
    const cx1 = Math.max(cx0, Math.min(img.width, x0 + cw));
    const cy0 = Math.max(0, Math.min(img.height, y0));
    const cy1 = Math.max(cy0, Math.min(img.height, y0 + ch));
    const choppedW = cx1 - cx0;
    const choppedH = cy1 - cy0;
    if (choppedW >= img.width || choppedH >= img.height) {
        return img;
    }
    const outW = img.width - choppedW;
    const outH = img.height - choppedH;
    const out = new Uint8Array(new ArrayBuffer(outW * outH * 4 + outH), 0, outW * outH * 4);
    for (let y = 0; y < outH; y++) {
        if (++cooperativeWork % 65536 === 0)
            yield;
        const srcY = y < cy0 ? y : Math.min(img.height - 1, y + choppedH);
        for (let x = 0; x < outW; x++) {
            if (++cooperativeWork % 65536 === 0)
                yield;
            const srcX = x < cx0 ? x : Math.min(img.width - 1, x + choppedW);
            const dstIdx = (y * outW + x) * 4;
            const srcIdx = (srcY * img.width + srcX) * 4;
            out[dstIdx] = img.data[srcIdx]!;
            out[dstIdx + 1] = img.data[srcIdx + 1]!;
            out[dstIdx + 2] = img.data[srcIdx + 2]!;
            out[dstIdx + 3] = img.data[srcIdx + 3]!;
        }
    }
    return { ...img, width: outW, height: outH, data: out };
}

function* applyMagickRollSteps(img: RgbaImage, geomStr: string, signal?: AbortSignal): Generator<void, RgbaImage, void> {
    let cooperativeWork = 0;
    const g = parseMagickGeometry(geomStr);
    const rx = Math.round(g.x || g.width || 0);
    const ry = Math.round(g.y || g.height || 0);
    const w = img.width;
    const h = img.height;
    const out = new Uint8Array(img.data.length);
    for (let y = 0; y < h; y++) {
        if (++cooperativeWork % 65536 === 0)
            yield;
        const sy = (((y - ry) % h) + h) % h;
        for (let x = 0; x < w; x++) {
            if (++cooperativeWork % 65536 === 0)
                yield;
            const sx = (((x - rx) % w) + w) % w;
            const dstIdx = (y * w + x) * 4;
            const srcIdx = (sy * w + sx) * 4;
            out[dstIdx] = img.data[srcIdx]!;
            out[dstIdx + 1] = img.data[srcIdx + 1]!;
            out[dstIdx + 2] = img.data[srcIdx + 2]!;
            out[dstIdx + 3] = img.data[srcIdx + 3]!;
        }
    }
    return { ...img, data: out };
}

function* applyMagickMorphSteps(stack: readonly RgbaImage[], countRaw: number, signal?: AbortSignal): Generator<void, RgbaImage[], void> {
    let cooperativeWork = 0;
    const count = Math.max(0, Math.round(countRaw));
    if (stack.length < 2 || count === 0)
        return [...stack];
    const out: RgbaImage[] = [];
    for (let idx = 0; idx < stack.length - 1; idx++) {
        if (++cooperativeWork % 65536 === 0)
            yield;
        const a = stack[idx]!;
        const b = stack[idx + 1]!;
        out.push(a);
        for (let step = 1; step <= count; step++) {
            if (++cooperativeWork % 65536 === 0)
                yield;
            const t = step / (count + 1);
            const w = Math.max(1, Math.round(a.width * (1 - t) + b.width * t));
            const h = Math.max(1, Math.round(a.height * (1 - t) + b.height * t));
            const ra = a.width === w && a.height === h ? a : (yield* applyMagickResizeSteps(a, `${w}x${h}!`, "bilinear"));
            const rb = b.width === w && b.height === h ? b : (yield* applyMagickResizeSteps(b, `${w}x${h}!`, "bilinear"));
            const data = new Uint8Array(new ArrayBuffer(w * h * 4 + h), 0, w * h * 4);
            for (let p = 0; p < data.length; p++) {
                if (++cooperativeWork % 65536 === 0)
                    yield;
                data[p] = clampByteVal(ra.data[p]! * (1 - t) + rb.data[p]! * t);
            }
            out.push({ ...ra, width: w, height: h, data });
        }
    }
    out.push(stack[stack.length - 1]!);
    return out;
}

function hasSceneOutputPattern(path: string): boolean {
    for (let index = 0; index < path.length; index++) if (path[index] === "%") {
        let end = index + 1;
        while (path[end] !== undefined && path[end]! >= "0" && path[end]! <= "9") end++;
        if (path[end] === "d") return true;
    }
    return false;
}

function formatSceneOutputPath(pattern: string, index: number): string {
  const padMatch = /%0(\d+)d/.exec(pattern);
  if (padMatch) {
    const width = parseInt(padMatch[1]!, 10);
    return pattern.replace(/%0\d+d/, String(index).padStart(width, "0"));
  }
  if (pattern.includes("%d")) {
    return pattern.replace(/%d/, String(index));
  }
  const dot = pattern.lastIndexOf(".");
  if (dot > 0) {
    return `${pattern.slice(0, dot)}-${index}${pattern.slice(dot)}`;
  }
  return `${pattern}-${index}`;
}

function parseChannelMask(spec: string): { r: boolean; g: boolean; b: boolean; a: boolean } {
  const s = spec.toLowerCase().trim();
  if (s === "all" || s === "rgba" || s === "sync,rgba") {
    return { r: true, g: true, b: true, a: true };
  }
  if (s === "rgb" || s === "default") {
    return { r: true, g: true, b: true, a: false };
  }
  if (s === "alpha" || s === "opacity" || s === "a") {
    return { r: false, g: false, b: false, a: true };
  }
  const r = s.includes("r") || s.includes("red");
  const g = s.includes("g") || s.includes("green");
  const b = s.includes("b") || s.includes("blue");
  const a = s.includes("a") || s.includes("alpha") || s.includes("opacity");
  if (!r && !g && !b && !a) {
    return { r: true, g: true, b: true, a: false };
  }
  return { r, g, b, a };
}

function clampByteVal(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(255, Math.round(n)));
}

function* applyMagickOpaqueSteps(img: RgbaImage, target: RgbaColor, replacement: RgbaColor, fuzz: number, invert: boolean, signal?: AbortSignal): Generator<void, RgbaImage, void> {
    let cooperativeWork = 0;
    const out = new Uint8Array(img.data);
    for (let i = 0; i < out.length; i += 4) {
        if (++cooperativeWork % 65536 === 0)
            yield;
        const dr = Math.abs(out[i]! - target.r);
        const dg = Math.abs(out[i + 1]! - target.g);
        const db = Math.abs(out[i + 2]! - target.b);
        const matched = Math.max(dr, dg, db) <= fuzz;
        if (invert ? !matched : matched) {
            out[i] = replacement.r;
            out[i + 1] = replacement.g;
            out[i + 2] = replacement.b;
            out[i + 3] = replacement.a;
        }
    }
    return { ...img, data: out, hasAlpha: true };
}

function* applyMagickTransparentSteps(img: RgbaImage, target: RgbaColor, fuzz: number, invert: boolean, signal?: AbortSignal): Generator<void, RgbaImage, void> {
    let cooperativeWork = 0;
    const out = new Uint8Array(img.data);
    for (let i = 0; i < out.length; i += 4) {
        if (++cooperativeWork % 65536 === 0)
            yield;
        const dr = Math.abs(out[i]! - target.r);
        const dg = Math.abs(out[i + 1]! - target.g);
        const db = Math.abs(out[i + 2]! - target.b);
        const matched = Math.max(dr, dg, db) <= fuzz;
        if (invert ? !matched : matched) {
            out[i + 3] = 0;
        }
    }
    return { ...img, data: out, hasAlpha: true };
}

function* applyMagickEvaluateSteps(img: RgbaImage, opRaw: string, valStr: string, channels: {
    r: boolean;
    g: boolean;
    b: boolean;
    a: boolean;
}, signal?: AbortSignal): Generator<void, RgbaImage, void> {
    let cooperativeWork = 0;
    const op = opRaw.toLowerCase().replace(/[-_]/g, "");
    const isPct = valStr.trim().endsWith("%");
    const rawNum = parseFloat(valStr);
    const vByte = isPct
        ? (rawNum / 100) * 255
        : rawNum <= 1 && valStr.includes(".")
            ? rawNum * 255
            : rawNum > 255
                ? rawNum / 257
                : rawNum;
    const vFactor = isPct ? rawNum / 100 : rawNum;
    const out = new Uint8Array(img.data);
    const mask = [channels.r, channels.g, channels.b, channels.a];
    for (let i = 0; i < out.length; i += 4) {
        if (++cooperativeWork % 65536 === 0)
            yield;
        for (let c = 0; c < 4; c++) {
            if (++cooperativeWork % 65536 === 0)
                yield;
            if (!mask[c])
                continue;
            const cur = out[i + c]!;
            let next = cur;
            switch (op) {
                case "add":
                    next = cur + vByte;
                    break;
                case "addmodulus":
                    next = (((cur + Math.round(vByte)) % 256) + 256) % 256;
                    break;
                case "mean":
                    next = (cur + vByte) / 2;
                    break;
                case "subtract":
                    next = cur - vByte;
                    break;
                case "multiply":
                    next = cur * vFactor;
                    break;
                case "divide":
                    next = cur / (vFactor || 1);
                    break;
                case "pow":
                    next = 255 * Math.pow(cur / 255, vFactor);
                    break;
                case "log":
                    next = 255 * (Math.log(1 + Math.max(1e-6, vFactor) * (cur / 255)) / Math.log(1 + Math.max(1e-6, vFactor)));
                    break;
                case "set":
                    next = vByte;
                    break;
                case "min":
                    next = Math.min(cur, vByte);
                    break;
                case "max":
                    next = Math.max(cur, vByte);
                    break;
                case "and":
                    next = cur & Math.round(vByte);
                    break;
                case "or":
                    next = cur | Math.round(vByte);
                    break;
                case "xor":
                    next = cur ^ Math.round(vByte);
                    break;
                case "leftshift":
                    next = (cur << Math.round(vFactor)) & 0xff;
                    break;
                case "rightshift":
                    next = cur >> Math.round(vFactor);
                    break;
                case "abs":
                    next = Math.abs(cur + vByte);
                    break;
                case "sine":
                    next = 255 * (0.5 + 0.5 * Math.sin(2 * Math.PI * vFactor * (cur / 255)));
                    break;
                case "cosine":
                    next = 255 * (0.5 + 0.5 * Math.cos(2 * Math.PI * vFactor * (cur / 255)));
                    break;
                case "threshold":
                    next = cur >= vByte ? 255 : 0;
                    break;
                case "thresholdblack":
                    next = cur < vByte ? 0 : cur;
                    break;
                case "thresholdwhite":
                    next = cur > vByte ? 255 : cur;
                    break;
                default:
                    break;
            }
            out[i + c] = clampByteVal(next);
        }
    }
    return { ...img, data: out };
}

function* applyMagickFunctionSteps(img: RgbaImage, funcRaw: string, paramsRaw: string, channels: {
    r: boolean;
    g: boolean;
    b: boolean;
    a: boolean;
}, signal?: AbortSignal): Generator<void, RgbaImage, void> {
    let cooperativeWork = 0;
    const fn = funcRaw.toLowerCase();
    const params = paramsRaw.split(",").map((s) => Number(s.trim()));
    const out = new Uint8Array(img.data);
    const mask = [channels.r, channels.g, channels.b, channels.a];
    for (let i = 0; i < out.length; i += 4) {
        if (++cooperativeWork % 65536 === 0)
            yield;
        for (let c = 0; c < 4; c++) {
            if (++cooperativeWork % 65536 === 0)
                yield;
            if (!mask[c])
                continue;
            const x = out[i + c]! / 255;
            let y = x;
            if (fn === "polynomial") {
                y = params.reduce((acc, coeff) => acc * x + coeff, 0);
            }
            else if (fn === "sinusoid") {
                const freq = params[0] ?? 1;
                const phase = params[1] ?? 0;
                const amp = params[2] ?? 0.5;
                const bias = params[3] ?? 0.5;
                y = amp * Math.sin(2 * Math.PI * (freq * x + phase / 360)) + bias;
            }
            else if (fn === "arcsin") {
                const w = params[0] ?? 1;
                const center = params[1] ?? 0.5;
                const range = params[2] ?? 1;
                const bias = params[3] ?? 0.5;
                const arg = Math.max(-1, Math.min(1, (2 / w) * (x - center)));
                y = (range / Math.PI) * Math.asin(arg) + bias;
            }
            else if (fn === "arctan") {
                const slope = params[0] ?? 1;
                const center = params[1] ?? 0.5;
                const range = params[2] ?? 1;
                const bias = params[3] ?? 0.5;
                y = (range / Math.PI) * Math.atan(slope * Math.PI * (x - center)) + bias;
            }
            out[i + c] = clampByteVal(y * 255);
        }
    }
    return { ...img, data: out };
}

function* applyMagickClutSteps(baseImg: RgbaImage, lutImg: RgbaImage, channels: {
    r: boolean;
    g: boolean;
    b: boolean;
    a: boolean;
}, signal?: AbortSignal): Generator<void, RgbaImage, void> {
    let cooperativeWork = 0;
    const out = new Uint8Array(baseImg.data);
    const horiz = lutImg.width >= lutImg.height;
    const len = Math.max(1, horiz ? lutImg.width : lutImg.height);
    const mask = [channels.r, channels.g, channels.b, channels.a];
    for (let i = 0; i < out.length; i += 4) {
        if (++cooperativeWork % 65536 === 0)
            yield;
        for (let c = 0; c < 4; c++) {
            if (++cooperativeWork % 65536 === 0)
                yield;
            if (!mask[c])
                continue;
            const t = out[i + c]! / 255;
            const pos = Math.max(0, Math.min(len - 1, Math.round(t * (len - 1))));
            const lx = horiz ? pos : 0;
            const ly = horiz ? 0 : pos;
            const lutIdx = (ly * lutImg.width + lx) * 4;
            out[i + c] = lutImg.data[lutIdx + c]!;
        }
    }
    return { ...baseImg, data: out };
}

type FxImage = Omit<RgbaImage,"data"|"data16"> & Partial<Pick<RgbaImage,"data"|"data16">>;
interface FxStack { readonly length: number; get(index: number): FxImage | undefined; indexOf(image: FxImage): number; reset?(): void }
class FxFrameDemand {}
interface FxEvalContext {
  readonly stack: FxStack | readonly FxImage[];
  readonly sample?: typeof sampleFxImage;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly ch: number;
  readonly vars: Map<string, number>;
}

function sampleFxImage(
  img: FxImage | undefined,
  px: number,
  py: number,
  ch: number
): number {
  if (!img) return 0;
  const cx = Math.max(0, Math.min(img.width - 1, Math.round(px)));
  const cy = Math.max(0, Math.min(img.height - 1, Math.round(py)));
  const idx = (cy * img.width + cx) * 4;
  return sampleFxPixel(img.data!, idx, ch);
}
function sampleFxPixel(data: ArrayLike<number>, offset: number, ch: number): number {
  const r = data[offset]! / 255;
  const g = data[offset + 1]! / 255;
  const b = data[offset + 2]! / 255;
  if (ch === 4) {
    // Rec.709 intensity / luma
    return 0.212656 * r + 0.715158 * g + 0.072186 * b;
  }
  if (ch === 5 || ch === 6 || ch === 7) {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (ch === 7) return l;
    const d = max - min;
    if (d < 1e-7) return 0;
    if (ch === 6) {
      return l > 0.5 ? d / Math.max(1e-7, 2 - max - min) : d / Math.max(1e-7, max + min);
    }
    let h = 0;
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return h / 6;
  }
  return data[offset + (ch & 3)]! / 255;
}

function propToChannel(prop: string, defaultCh: number): number {
  const p = prop.toLowerCase();
  if (p === "r" || p === "red") return 0;
  if (p === "g" || p === "green") return 1;
  if (p === "b" || p === "blue") return 2;
  if (p === "a" || p === "alpha" || p === "opacity") return 3;
  if (p === "intensity" || p === "luma" || p === "luminance") return 4;
  if (p === "hue") return 5;
  if (p === "saturation") return 6;
  if (p === "lightness") return 7;
  return defaultCh;
}

function compileFxExpression(exprStr: string): (ctx: FxEvalContext) => number {
  const statements = exprStr
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const compiledStmts = statements.map((stmt) => {
    const assignMatch = /^([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*([^=].*)$/.exec(stmt);
    if (assignMatch) {
      const varName = assignMatch[1]!.toLowerCase();
      const rhsFn = compileSingleFxExpr(assignMatch[2]!);
      return (ctx: FxEvalContext) => {
        const val = rhsFn(ctx);
        ctx.vars.set(varName, val);
        return val;
      };
    }
    return compileSingleFxExpr(stmt);
  });

  return (ctx: FxEvalContext) => {
    let last = 0;
    for (const fn of compiledStmts) {
      last = fn(ctx);
    }
    return last;
  };
}

function compileSingleFxExpr(src: string): (ctx: FxEvalContext) => number {
  type Tok = { type: "num" | "id" | "op" | "punc"; val: string };
  const tokens: Tok[] = [];
  let k = 0;
  while (k < src.length) {
    const ch = src[k]!;
    if (/\s/.test(ch)) {
      k++;
      continue;
    }
    if (/\d/.test(ch) || (ch === "." && /\d/.test(src[k + 1] ?? ""))) {
      let numStr = "";
      while (k < src.length && /[\d.eE+-]/.test(src[k]!)) {
        if ((src[k] === "+" || src[k] === "-") && !/[eE]/.test(src[k - 1] ?? "")) break;
        numStr += src[k++]!;
      }
      tokens.push({ type: "num", val: numStr });
      continue;
    }
    if (/[a-zA-Z_]/.test(ch)) {
      let idStr = "";
      while (k < src.length && /[a-zA-Z0-9_]/.test(src[k]!)) {
        idStr += src[k++]!;
      }
      tokens.push({ type: "id", val: idStr });
      continue;
    }
    const two = src.slice(k, k + 2);
    if (two === "==" || two === "!=" || two === "<=" || two === ">=" || two === "&&" || two === "||" || two === "**") {
      tokens.push({ type: "op", val: two });
      k += 2;
      continue;
    }
    if ("+-*/%^<>!?".includes(ch)) {
      tokens.push({ type: "op", val: ch });
      k++;
      continue;
    }
    if ("(),.{}:[]".includes(ch)) {
      tokens.push({ type: "punc", val: ch });
      k++;
      continue;
    }
    k++;
  }

  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  function parseTernary(): (ctx: FxEvalContext) => number {
    const cond = parseOr();
    if (peek()?.val === "?") {
      next();
      const tBranch = parseTernary();
      if (peek()?.val === ":") next();
      const fBranch = parseTernary();
      return (ctx) => (cond(ctx) !== 0 ? tBranch(ctx) : fBranch(ctx));
    }
    return cond;
  }

  function parseOr(): (ctx: FxEvalContext) => number {
    let left = parseAnd();
    while (peek()?.val === "||") {
      next();
      const right = parseAnd();
      const prev = left;
      left = (ctx) => (prev(ctx) !== 0 || right(ctx) !== 0 ? 1 : 0);
    }
    return left;
  }

  function parseAnd(): (ctx: FxEvalContext) => number {
    let left = parseEquality();
    while (peek()?.val === "&&") {
      next();
      const right = parseEquality();
      const prev = left;
      left = (ctx) => (prev(ctx) !== 0 && right(ctx) !== 0 ? 1 : 0);
    }
    return left;
  }

  function parseEquality(): (ctx: FxEvalContext) => number {
    let left = parseRelational();
    while (peek()?.val === "==" || peek()?.val === "!=") {
      const op = next()!.val;
      const right = parseRelational();
      const prev = left;
      left =
        op === "=="
          ? (ctx) => (Math.abs(prev(ctx) - right(ctx)) < 1e-6 ? 1 : 0)
          : (ctx) => (Math.abs(prev(ctx) - right(ctx)) >= 1e-6 ? 1 : 0);
    }
    return left;
  }

  function parseRelational(): (ctx: FxEvalContext) => number {
    let left = parseAdditive();
    while (
      peek()?.val === "<" ||
      peek()?.val === "<=" ||
      peek()?.val === ">" ||
      peek()?.val === ">="
    ) {
      const op = next()!.val;
      const right = parseAdditive();
      const prev = left;
      if (op === "<") left = (ctx) => (prev(ctx) < right(ctx) ? 1 : 0);
      else if (op === "<=") left = (ctx) => (prev(ctx) <= right(ctx) ? 1 : 0);
      else if (op === ">") left = (ctx) => (prev(ctx) > right(ctx) ? 1 : 0);
      else left = (ctx) => (prev(ctx) >= right(ctx) ? 1 : 0);
    }
    return left;
  }

  function parseAdditive(): (ctx: FxEvalContext) => number {
    let left = parseMultiplicative();
    while (peek()?.val === "+" || peek()?.val === "-") {
      const op = next()!.val;
      const right = parseMultiplicative();
      const prev = left;
      left = op === "+" ? (ctx) => prev(ctx) + right(ctx) : (ctx) => prev(ctx) - right(ctx);
    }
    return left;
  }

  function parseMultiplicative(): (ctx: FxEvalContext) => number {
    let left = parsePower();
    while (peek()?.val === "*" || peek()?.val === "/" || peek()?.val === "%") {
      const op = next()!.val;
      const right = parsePower();
      const prev = left;
      if (op === "*") left = (ctx) => prev(ctx) * right(ctx);
      else if (op === "/") left = (ctx) => {
        const d = right(ctx);
        return d === 0 ? 0 : prev(ctx) / d;
      };
      else left = (ctx) => {
        const d = right(ctx);
        return d === 0 ? 0 : prev(ctx) % d;
      };
    }
    return left;
  }

  function parsePower(): (ctx: FxEvalContext) => number {
    const base = parseUnary();
    if (peek()?.val === "^" || peek()?.val === "**") {
      next();
      const exp = parsePower();
      return (ctx) => Math.pow(base(ctx), exp(ctx));
    }
    return base;
  }

  function parseUnary(): (ctx: FxEvalContext) => number {
    if (peek()?.val === "-") {
      next();
      const u = parseUnary();
      return (ctx) => -u(ctx);
    }
    if (peek()?.val === "+") {
      next();
      return parseUnary();
    }
    if (peek()?.val === "!") {
      next();
      const u = parseUnary();
      return (ctx) => (u(ctx) === 0 ? 1 : 0);
    }
    return parsePrimary();
  }

  function parsePrimary(): (ctx: FxEvalContext) => number {
    const tok = peek();
    if (!tok) return () => 0;
    if (tok.type === "num") {
      next();
      const val = Number(tok.val);
      return () => val;
    }
    if (tok.val === "(") {
      next();
      const inner = parseTernary();
      if (peek()?.val === ")") next();
      return inner;
    }
    if (tok.type === "id") {
      next();
      const name = tok.val.toLowerCase();
      if (peek()?.val === "(") {
        next();
        const args: Array<(ctx: FxEvalContext) => number> = [];
        if (peek()?.val !== ")") {
          args.push(parseTernary());
          while (peek()?.val === ",") {
            next();
            args.push(parseTernary());
          }
        }
        if (peek()?.val === ")") next();
        return (ctx) => {
          const vals = args.map((a) => a(ctx));
          const a0 = vals[0] ?? 0;
          const a1 = vals[1] ?? 0;
          const a2 = vals[2] ?? 1;
          switch (name) {
            case "sin":
              return Math.sin(a0);
            case "cos":
              return Math.cos(a0);
            case "tan":
              return Math.tan(a0);
            case "asin":
              return Math.asin(a0);
            case "acos":
              return Math.acos(a0);
            case "atan":
              return Math.atan(a0);
            case "atan2":
              return Math.atan2(a0, a1);
            case "sinh":
              return Math.sinh(a0);
            case "cosh":
              return Math.cosh(a0);
            case "tanh":
              return Math.tanh(a0);
            case "sqrt":
              return Math.sqrt(Math.max(0, a0));
            case "pow":
              return Math.pow(a0, a1);
            case "exp":
              return Math.exp(a0);
            case "log":
            case "log10":
              return Math.log10(Math.max(1e-12, a0));
            case "ln":
              return Math.log(Math.max(1e-12, a0));
            case "abs":
              return Math.abs(a0);
            case "min":
              return Math.min(...vals);
            case "max":
              return Math.max(...vals);
            case "floor":
              return Math.floor(a0);
            case "ceil":
              return Math.ceil(a0);
            case "round":
              return Math.round(a0);
            case "int":
            case "trunc":
              return Math.trunc(a0);
            case "sign":
              return Math.sign(a0);
            case "hypot":
              return Math.hypot(a0, a1);
            case "mod":
              return a1 === 0 ? 0 : a0 % a1;
            case "clamp":
              return Math.max(a1, Math.min(a2, a0));
            case "if":
              return a0 !== 0 ? a1 : a2;
            case "rand":
              return 0.5;
            default:
              return a0;
          }
        };
      }

      // Check for array index e.g. u[1]
      let imgIndex: ((ctx: FxEvalContext) => number) | undefined;
      if (name === "u" && peek()?.val === "[") {
        next();
        imgIndex = parseTernary();
        if (peek()?.val === "]") next();
      }

      // Check for p{x,y} or .p{x,y} or .r/.g/.b/.a/.w/.h/.intensity
      let coordX: ((ctx: FxEvalContext) => number) | undefined;
      let coordY: ((ctx: FxEvalContext) => number) | undefined;
      let propName: string | undefined;

      if (name === "p" && peek()?.val === "{") {
        next();
        coordX = parseTernary();
        if (peek()?.val === ",") next();
        coordY = parseTernary();
        if (peek()?.val === "}") next();
      }
      while (peek()?.val === ".") {
        next();
        const sub = next()?.val.toLowerCase() ?? "";
        if (sub === "p" && peek()?.val === "{") {
          next();
          coordX = parseTernary();
          if (peek()?.val === ",") next();
          coordY = parseTernary();
          if (peek()?.val === "}") next();
        } else {
          propName = sub;
        }
      }

      return (ctx) => {
        if (ctx.vars.has(name) && !propName && !coordX) {
          return ctx.vars.get(name)!;
        }
        if (name === "i") return ctx.x;
        if (name === "j") return ctx.y;
        if (name === "w") return ctx.w;
        if (name === "h") return ctx.h;
        if (name === "pi") return Math.PI;
        if (name === "e") return Math.E;

        const rawIdx = imgIndex ? Math.round(imgIndex(ctx)) : name === "v" ? 1 : 0;
        const len = Math.max(1, ctx.stack.length);
        const targetIdx = rawIdx < 0 ? ((rawIdx % len) + len) % len : rawIdx;
        const targetImg = "get" in ctx.stack ? ctx.stack.get(targetIdx) ?? ctx.stack.get(0) : ctx.stack[targetIdx] ?? ctx.stack[0];
        if (propName === "w") return targetImg?.width ?? ctx.w;
        if (propName === "h") return targetImg?.height ?? ctx.h;

        const px = coordX ? coordX(ctx) : ctx.x;
        const py = coordY ? coordY(ctx) : ctx.y;

        if (name === "r" || name === "red") return (ctx.sample ?? sampleFxImage)(targetImg, px, py, 0);
        if (name === "g" || name === "green") return (ctx.sample ?? sampleFxImage)(targetImg, px, py, 1);
        if (name === "b" || name === "blue") return (ctx.sample ?? sampleFxImage)(targetImg, px, py, 2);
        if (name === "a" || name === "alpha" || name === "opacity") return (ctx.sample ?? sampleFxImage)(targetImg, px, py, 3);
        if (name === "intensity" || name === "luma" || name === "luminance") {
          return (ctx.sample ?? sampleFxImage)(targetImg, px, py, 4);
        }
        if (name === "hue") return (ctx.sample ?? sampleFxImage)(targetImg, px, py, 5);
        if (name === "saturation") return (ctx.sample ?? sampleFxImage)(targetImg, px, py, 6);
        if (name === "lightness") return (ctx.sample ?? sampleFxImage)(targetImg, px, py, 7);

        const ch = propName ? propToChannel(propName, ctx.ch) : ctx.ch;
        return (ctx.sample ?? sampleFxImage)(targetImg, px, py, ch);
      };
    }
    next();
    return () => 0;
  }

  return parseTernary();
}

function* magickFxPixelSteps(input: readonly FxImage[] | FxStack, expression: string, channels: MagickState["channels"]): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const stack: FxStack = "get" in input ? input : { length: input.length, get: index => input[index], indexOf: image => input.indexOf(image) };
    const base = stack.get(0)!, evaluate = compileFxExpression(expression), mask = [channels.r, channels.g, channels.b, channels.a];
    const samples = new Map<string, number>(), sample = new Uint8Array(4), vars = new Map<string, number>();
    const samplePixel: typeof sampleFxImage = (target, x, y, channel) => {
        if (!target) return 0;
        const px = Math.max(0, Math.min(target.width - 1, Math.round(x))), py = Math.max(0, Math.min(target.height - 1, Math.round(y))), position = (py * target.width + px) * 4;
        if (!Number.isFinite(position)) return NaN;
        const image = stack.indexOf(target), packed = samples.get(image + ":" + position);
        if (packed === undefined) throw new FxPixelDemand(position, image);
        for (let c = 0; c < 4; c++) sample[c] = packed >>> (c * 8) & 255;
        return sampleFxPixel(sample, 0, channel);
    };
    for (let start = 0; start < base.width * base.height; start += 1024) {
        yield;
        const count = Math.min(1024, base.width * base.height - start), bytes = yield { kind: "read", position: start * 4, length: count * 4 };
        if (!bytes || bytes.length !== count * 4) throw new Error("Truncated expression pixels");
        const data = new Uint8Array(bytes);
        for (let i = 0; i < count; i++) {
            const position = (start + i) * 4, offset = i * 4;
            stack.reset?.();
            samples.clear();
            samples.set("0:" + position, data[offset]! | data[offset + 1]! << 8 | data[offset + 2]! << 16 | data[offset + 3]! << 24);
            for (let ch = 0; ch < 4; ch++) {
                if (!mask[ch]) continue;
                const context: FxEvalContext = { stack, x: (start + i) % base.width, y: Math.floor((start + i) / base.width), w: base.width, h: base.height, ch, vars, sample: samplePixel };
                // Replaying local assignments is deterministic; retain only this pixel's demanded samples.
                while (true) {
                    vars.clear();
                    try { data[offset + ch] = clampByteVal(evaluate(context) * 255); break; }
                    catch (error) {
                        if (error instanceof FxFrameDemand) { yield; continue; }
                        if (!(error instanceof FxPixelDemand)) throw error;
                        const value = yield { kind: "read", image: error.image, position: error.position, length: 4 };
                        if (!value || value.length !== 4) throw new Error("Truncated expression pixels");
                        samples.set(error.image + ":" + error.position, value[0]! | value[1]! << 8 | value[2]! << 16 | value[3]! << 24);
                    }
                }
            }
        }
        yield { kind: "write", position: start * 4, data };
    }
}

function solveLinearSystem(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, idx) => [...row, b[idx]!]);
  for (let col = 0; col < n; col++) {
    let maxRow = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(M[row]![col]!) > Math.abs(M[maxRow]![col]!)) maxRow = row;
    }
    const tmp = M[col]!;
    M[col] = M[maxRow]!;
    M[maxRow] = tmp;
    const pivot = M[col]![col]!;
    if (Math.abs(pivot) < 1e-12) continue;
    for (let j = col; j <= n; j++) M[col]![j]! /= pivot;
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = M[row]![col]!;
      for (let j = col; j <= n; j++) {
        M[row]![j]! -= factor * M[col]![j]!;
      }
    }
  }
  return M.map((row) => row[n]!);
}

function magickWarpPlan(img: Pick<RgbaImage, "width" | "height" | "hasAlpha">, token: string, spec: string, args = "0"): WarpPlan | undefined {
    const w = img.width, h = img.height, cx = (w - 1) / 2, cy = (h - 1) / 2;
    const result = (map: WarpPlan["map"], width = w, height = h, hasAlpha = true): WarpPlan => ({ width, height, hasAlpha, map });
    if (token === "-shear") {
        const g = parseMagickGeometry(spec), tx = Math.tan(((g.width ?? 0) * Math.PI) / 180), ty = Math.tan(((g.height ?? 0) * Math.PI) / 180);
        const width = Math.max(1, Math.round(w + Math.abs(tx) * h)), height = Math.max(1, Math.round(h + Math.abs(ty) * w)), det = 1 - tx * ty || 1;
        return result((x, y) => { const dx = x - (width - 1) / 2, dy = y - (height - 1) / 2; return [cx + (dx - tx * dy) / det, cy + (dy - ty * dx) / det]; }, width, height);
    }
    if (token === "-swirl") {
        const maxR = Math.max(cx, cy, 1), radians = (Number(spec) * Math.PI) / 180;
        return result((x, y) => {
            const dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy);
            if (r >= maxR) return [x, y];
            const factor = 1 - r / maxR, angle = factor * factor * radians, cos = Math.cos(angle), sin = Math.sin(angle);
            return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
        }, w, h, img.hasAlpha);
    }
    if (token === "-implode") {
        const maxR = Math.min(cx, cy, 1), exponent = 1 / (1 - Math.max(-0.95, Math.min(0.95, Number(spec))));
        return result((x, y) => {
            const dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy);
            if (!(r < maxR && r > 0)) return [x, y];
            const scale = maxR * Math.pow(r / maxR, exponent) / r;
            return [cx + dx * scale, cy + dy * scale];
        }, w, h, img.hasAlpha);
    }
    if (token === "-wave") {
        const g = parseMagickGeometry(spec), amplitude = g.width ?? 5, length = Math.max(1, g.height ?? 50), padding = Math.abs(amplitude);
        return result((x, y) => [x, y - padding - amplitude * Math.sin((2 * Math.PI * x) / length)], w, h + Math.round(padding * 2));
    }
    const method = spec.toLowerCase().replace(/[-_]/g, ""), nums = args.trim().split(/[\s,]+/).filter(s => s.length > 0).map(Number);
    if (method === "srt" || method === "scalerotatetranslate") {
        let ox = cx, oy = cy, scaleX = 1, scaleY = 1, angle = 0, nx = cx, ny = cy;
        if (nums.length === 1) angle = nums[0]!;
        else if (nums.length === 2) { scaleX = scaleY = nums[0] || 1; angle = nums[1]!; }
        else if (nums.length >= 3) {
            ox = nx = nums[0]!; oy = ny = nums[1]!;
            if (nums.length === 3) angle = nums[2]!;
            else if (nums.length === 4 || nums.length === 6) { scaleX = scaleY = nums[2] || 1; angle = nums[3]!; }
            else { scaleX = nums[2] || 1; scaleY = nums[3] || 1; angle = nums[4]!; }
            if (nums.length === 6) { nx = nums[4]!; ny = nums[5]!; }
            else if (nums.length >= 7) { nx = nums[5]!; ny = nums[6]!; }
        }
        const radians = (angle * Math.PI) / 180, cos = Math.cos(radians), sin = Math.sin(radians);
        return result((x, y) => { const dx = x - nx, dy = y - ny; return [ox + (dx * cos + dy * sin) / scaleX, oy + (-dx * sin + dy * cos) / scaleY]; });
    }
    if ((method === "perspective" && nums.length >= 16) || (method === "perspectiveprojection" && nums.length >= 8)) {
        let coefficients: number[];
        if (method === "perspectiveprojection") coefficients = nums.slice(0, 8);
        else {
            const matrix: number[][] = [], values: number[] = [];
            for (let p = 0; p < 4; p++) {
                const sx = nums[p * 4]!, sy = nums[p * 4 + 1]!, dx = nums[p * 4 + 2]!, dy = nums[p * 4 + 3]!;
                matrix.push([dx, dy, 1, 0, 0, 0, -dx * sx, -dy * sx], [0, 0, 0, dx, dy, 1, -dx * sy, -dy * sy]); values.push(sx, sy);
            }
            coefficients = solveLinearSystem(matrix, values);
        }
        if (coefficients.every(c => Math.abs(c) < 1e-12)) return;
        const [a, b, c, d, e, f, g, i] = coefficients as [number, number, number, number, number, number, number, number];
        return result((x, y) => { const denominator = g * x + i * y + 1 || 1e-9; return [(a * x + b * y + c) / denominator, (d * x + e * y + f) / denominator]; });
    }
    if (method === "affine" && nums.length >= 12) {
        const matrix: number[][] = [], xs: number[] = [], ys: number[] = [];
        for (let p = 0; p < 3; p++) { matrix.push([nums[p * 4 + 2]!, nums[p * 4 + 3]!, 1]); xs.push(nums[p * 4]!); ys.push(nums[p * 4 + 1]!); }
        const rx = solveLinearSystem(matrix, xs), ry = solveLinearSystem(matrix, ys);
        return result((x, y) => [rx[0]! * x + rx[1]! * y + rx[2]!, ry[0]! * x + ry[1]! * y + ry[2]!]);
    }
    if (method === "barrel" && nums.length >= 3) {
        const a = nums[0] ?? 0, b = nums[1] ?? 0, c = nums[2] ?? 0, d = nums[3] ?? 1 - a - b - c, ox = nums[4] ?? cx, oy = nums[5] ?? cy, radius = Math.min(w, h) / 2;
        return result((x, y) => { const dx = (x - ox) / radius, dy = (y - oy) / radius, r = Math.hypot(dx, dy), factor = a * r * r * r + b * r * r + c * r + d; return [ox + dx * factor * radius, oy + dy * factor * radius]; });
    }
    return;
}
function parseMagickWarpOperation(tokens: readonly string[], state: MagickState, start: number) {
    const token = tokens[start]!;
    if (!["-shear", "-swirl", "-implode", "-wave", "-distort", "+distort"].includes(token)) return;
    let i = start;
    const distort = token === "-distort" || token === "+distort";
    const spec = tokens[++i] ?? (distort ? "SRT" : token === "-wave" ? "5x50" : token === "-shear" ? "0x0" : "0"), args = distort ? tokens[++i] ?? "0" : "0";
    return { end: i, background: state.background, plan: (image: Pick<RgbaImage, "width" | "height" | "hasAlpha">) => magickWarpPlan(image, token, spec, args) };
}

function magickShadowLayout(image: Pick<RgbaImage, "width" | "height">, geometry: string) {
    const g = parseMagickGeometry(geometry), opacity = Math.max(0, Math.min(100, g.width ?? 80)) / 100, sigma = Math.max(0.5, g.height ?? 3);
    const pad = Math.max(2, Math.ceil(sigma * 2) + Math.max(Math.abs(g.x), Math.abs(g.y)));
    return { width: image.width + pad * 2, height: image.height + pad * 2, hasAlpha: true, offsetX: pad + Math.round(g.x), offsetY: pad + Math.round(g.y), opacity, sigma };
}
function* applyMagickShadowSteps(image: RgbaImage, geometry: string, color: RgbaColor, signal?: AbortSignal): Generator<void, RgbaImage, void> {
    const layout = magickShadowLayout(image, geometry);
    const base = yield* applyMagickRasterSteps(image, shadowPixelSteps(image, layout, color), signal, layout);
    return yield* blurImageSteps(base, layout.sigma);
}

function* applyMagickSepiaToneSteps(img: RgbaImage, threshStr: string, signal?: AbortSignal): Generator<void, RgbaImage, void> {
    let cooperativeWork = 0;
    const raw = parseFloat(threshStr);
    const strength = Math.max(0, Math.min(1, (threshStr.endsWith("%") ? raw : raw / 255) / 100 || 0.8));
    const out = new Uint8Array(img.data);
    for (let i = 0; i < out.length; i += 4) {
        if (++cooperativeWork % 65536 === 0)
            yield;
        const r = out[i]!;
        const g = out[i + 1]!;
        const b = out[i + 2]!;
        const sr = Math.min(255, 0.393 * r + 0.769 * g + 0.189 * b);
        const sg = Math.min(255, 0.349 * r + 0.686 * g + 0.168 * b);
        const sb = Math.min(255, 0.272 * r + 0.534 * g + 0.131 * b);
        out[i] = clampByteVal(r * (1 - strength) + sr * strength);
        out[i + 1] = clampByteVal(g * (1 - strength) + sg * strength);
        out[i + 2] = clampByteVal(b * (1 - strength) + sb * strength);
    }
    return { ...img, data: out };
}

function* applyMagickSolarizeSteps(img: RgbaImage, threshStr: string, signal?: AbortSignal): Generator<void, RgbaImage, void> {
    let cooperativeWork = 0;
    const raw = parseFloat(threshStr);
    const thresh = threshStr.endsWith("%") ? (raw / 100) * 255 : raw;
    const out = new Uint8Array(img.data);
    for (let i = 0; i < out.length; i += 4) {
        if (++cooperativeWork % 65536 === 0)
            yield;
        if (out[i]! > thresh)
            out[i] = 255 - out[i]!;
        if (out[i + 1]! > thresh)
            out[i + 1] = 255 - out[i + 1]!;
        if (out[i + 2]! > thresh)
            out[i + 2] = 255 - out[i + 2]!;
    }
    return { ...img, data: out };
}

function* applyMagickPosterizeSteps(img: RgbaImage, levelsRaw: number, signal?: AbortSignal): Generator<void, RgbaImage, void> {
    let cooperativeWork = 0;
    const levels = Math.max(2, Math.min(256, Math.round(levelsRaw)));
    const step = 255 / (levels - 1);
    const out = new Uint8Array(img.data);
    for (let i = 0; i < out.length; i += 4) {
        if (++cooperativeWork % 65536 === 0)
            yield;
        out[i] = clampByteVal(Math.round((out[i]! / 255) * (levels - 1)) * step);
        out[i + 1] = clampByteVal(Math.round((out[i + 1]! / 255) * (levels - 1)) * step);
        out[i + 2] = clampByteVal(Math.round((out[i + 2]! / 255) * (levels - 1)) * step);
    }
    return { ...img, data: out };
}

function* applyMagickRasterSteps(img: RgbaImage, steps: Generator<ConvolveRequest | undefined, void, Uint8Array | undefined>, signal?: AbortSignal, dimensions: Pick<RgbaImage, "width" | "height" | "hasAlpha"> = img, sources: readonly RgbaImage[] = [img]): Generator<void, RgbaImage, void> {
    const data = new Uint8Array(dimensions.width * dimensions.height * 4);
    let next = steps.next();
    while (!next.done) {
        signal?.throwIfAborted();
        const request = next.value;
        if (!request) { yield; next = steps.next(); }
        else if (request.kind === "read") next = steps.next(sources[request.image ?? 0]!.data.subarray(request.position, request.position + request.length));
        else { data.set(request.data, request.position); next = steps.next(); }
    }
    return { ...img, width: dimensions.width, height: dimensions.height, hasAlpha: dimensions.hasAlpha, data };
}

function resolveGravityOffset(
  spaceW: number,
  spaceH: number,
  gravity: GravityPosition
): { readonly left: number; readonly top: number } {
  let left = 0;
  let top = 0;
  if (gravity === "north" || gravity === "center" || gravity === "south") {
    left = Math.trunc(spaceW / 2);
  } else if (gravity === "northeast" || gravity === "east" || gravity === "southeast") {
    left = Math.trunc(spaceW);
  }
  if (gravity === "west" || gravity === "center" || gravity === "east") {
    top = Math.trunc(spaceH / 2);
  } else if (gravity === "southwest" || gravity === "south" || gravity === "southeast") {
    top = Math.trunc(spaceH);
  }
  return { left, top };
}

function gravityAdjustBox(
  imgW: number,
  imgH: number,
  boxW: number,
  boxH: number,
  offX: number,
  offY: number,
  gravity: GravityPosition
): { readonly x: number; readonly y: number } {
  let x = Math.trunc(offX);
  let y = Math.trunc(offY);
  if (gravity === "north" || gravity === "center" || gravity === "south") {
    x = Math.trunc((imgW - boxW) / 2 + offX);
  } else if (gravity === "northeast" || gravity === "east" || gravity === "southeast") {
    x = Math.trunc(imgW - boxW - offX);
  }
  if (gravity === "west" || gravity === "center" || gravity === "east") {
    y = Math.trunc((imgH - boxH) / 2 + offY);
  } else if (gravity === "southwest" || gravity === "south" || gravity === "southeast") {
    y = Math.trunc(imgH - boxH - offY);
  }
  return { x, y };
}

function parseGravity(raw: string): GravityPosition {
  const norm = raw.toLowerCase().replace(/[-_\s]/g, "");
  switch (norm) {
    case "north":
      return "north";
    case "northeast":
      return "northeast";
    case "east":
      return "east";
    case "southeast":
      return "southeast";
    case "south":
      return "south";
    case "southwest":
      return "southwest";
    case "west":
      return "west";
    case "northwest":
      return "northwest";
    case "center":
    case "centre":
    default:
      return "center";
  }
}

function parseKernel(raw: string): ResizeKernel {
  const norm = raw.toLowerCase();
  if (norm === "point" || norm === "nearest" || norm === "box") return "nearest";
  if (norm === "triangle" || norm === "bilinear" || norm === "linear" || norm === "hermite") return "bilinear";
  if (norm === "cubic" || norm === "catrom" || norm === "spline") return "cubic";
  if (norm === "mitchell") return "mitchell";
  if (norm === "lanczos2") return "lanczos2";
  return "lanczos3";
}

function parseCompose(raw: string): BlendMode {
  const norm = raw.toLowerCase().replace(/[-_]/g, "");
  switch (norm) {
    case "clear":
      return "clear";
    case "src":
    case "source":
    case "copy":
      return "source";
    case "over":
    case "srcover":
      return "over";
    case "in":
    case "srcin":
      return "in";
    case "out":
    case "srcout":
      return "out";
    case "atop":
    case "srcatop":
      return "atop";
    case "dest":
    case "dst":
      return "dest";
    case "destover":
    case "dstover":
      return "dest-over";
    case "destin":
    case "dstin":
      return "dest-in";
    case "destout":
    case "dstout":
      return "dest-out";
    case "destatop":
    case "dstatop":
      return "dest-atop";
    case "xor":
      return "xor";
    case "add":
    case "plus":
    case "lineardodge":
      return "add";
    case "saturate":
      return "saturate";
    case "multiply":
      return "multiply";
    case "screen":
      return "screen";
    case "overlay":
      return "overlay";
    case "darken":
      return "darken";
    case "lighten":
      return "lighten";
    case "colordodge":
      return "color-dodge";
    case "colorburn":
      return "color-burn";
    case "hardlight":
      return "hard-light";
    case "softlight":
      return "soft-light";
    case "difference":
      return "difference";
    case "exclusion":
      return "exclusion";
    default:
      return "over";
  }
}

function* applyMagickCompositeLayerSteps(dst: RgbaImage, src: RgbaImage, modeRaw: string, left: number, top: number, composeArgs?: string, signal?: AbortSignal): Generator<void, RgbaImage, void> {
    let cooperativeWork = 0;
    const norm = modeRaw.toLowerCase().replace(/[-_\s]/g, "");
    const out = new Uint8Array(dst.data);
    const dw = dst.width;
    const dh = dst.height;
    const sw = src.width;
    const sh = src.height;
    for (let sy = 0; sy < sh; sy++) {
        if (++cooperativeWork % 65536 === 0)
            yield;
        const dy = top + sy;
        if (dy < 0 || dy >= dh)
            continue;
        for (let sx = 0; sx < sw; sx++) {
            if (++cooperativeWork % 65536 === 0)
                yield;
            const dx = left + sx;
            if (dx < 0 || dx >= dw)
                continue;
            const sIdx = (sy * sw + sx) * 4;
            const dIdx = (dy * dw + dx) * 4;
            const sr = src.data[sIdx]!;
            const sg = src.data[sIdx + 1]!;
            const sb = src.data[sIdx + 2]!;
            const saByte = src.data[sIdx + 3]!;
            const dr = dst.data[dIdx]!;
            const dg = dst.data[dIdx + 1]!;
            const db = dst.data[dIdx + 2]!;
            const daByte = dst.data[dIdx + 3]!;
            const sa = saByte / 255;
            const da = daByte / 255;
            if (norm === "dissolve") {
                const [sStr, dStr] = (composeArgs || "100").split(/[xX,]/);
                const sMod = Math.max(0, Math.min(1, (parseFloat(sStr || "100") || 0) / 100));
                const dMod = dStr !== undefined ? Math.max(0, Math.min(1, (parseFloat(dStr) || 0) / 100)) : 1;
                const effSa = sa * sMod;
                const effDa = da * dMod;
                const outA = effSa + effDa * (1 - effSa);
                if (outA <= 1e-6) {
                    out[dIdx] = 0;
                    out[dIdx + 1] = 0;
                    out[dIdx + 2] = 0;
                    out[dIdx + 3] = 0;
                }
                else {
                    out[dIdx] = clampByteVal((sr * effSa + dr * effDa * (1 - effSa)) / outA);
                    out[dIdx + 1] = clampByteVal((sg * effSa + dg * effDa * (1 - effSa)) / outA);
                    out[dIdx + 2] = clampByteVal((sb * effSa + db * effDa * (1 - effSa)) / outA);
                    out[dIdx + 3] = clampByteVal(outA * 255);
                }
                continue;
            }
            if (norm === "blend") {
                const [sStr, dStr] = (composeArgs || "50").split(/[xX,]/);
                const wSrc = Math.max(0, (parseFloat(sStr || "50") || 0) / 100);
                const wDst = dStr !== undefined ? Math.max(0, (parseFloat(dStr) || 0) / 100) : Math.max(0, 1 - wSrc);
                out[dIdx] = clampByteVal(sr * wSrc + dr * wDst);
                out[dIdx + 1] = clampByteVal(sg * wSrc + dg * wDst);
                out[dIdx + 2] = clampByteVal(sb * wSrc + db * wDst);
                out[dIdx + 3] = clampByteVal(saByte * wSrc + daByte * wDst);
                continue;
            }
            if (norm === "src" || norm === "source" || norm === "copy") {
                out[dIdx] = sr;
                out[dIdx + 1] = sg;
                out[dIdx + 2] = sb;
                out[dIdx + 3] = saByte;
                continue;
            }
            if (norm === "dst" || norm === "dest") {
                continue;
            }
            if (norm === "clear") {
                out[dIdx] = 0;
                out[dIdx + 1] = 0;
                out[dIdx + 2] = 0;
                out[dIdx + 3] = 0;
                continue;
            }
            if (norm === "copyopacity" || norm === "copyalpha") {
                out[dIdx + 3] = saByte;
                continue;
            }
            if (norm === "copyred") {
                out[dIdx] = sr;
                continue;
            }
            if (norm === "copygreen") {
                out[dIdx + 1] = sg;
                continue;
            }
            if (norm === "copyblue") {
                out[dIdx + 2] = sb;
                continue;
            }
            if (norm === "difference") {
                out[dIdx] = Math.abs(sr - dr);
                out[dIdx + 1] = Math.abs(sg - dg);
                out[dIdx + 2] = Math.abs(sb - db);
                out[dIdx + 3] = Math.abs(saByte - daByte);
                continue;
            }
            if (norm === "in" || norm === "srcin") {
                const factor = sa * da;
                out[dIdx] = clampByteVal(sr * factor);
                out[dIdx + 1] = clampByteVal(sg * factor);
                out[dIdx + 2] = clampByteVal(sb * factor);
                out[dIdx + 3] = clampByteVal(factor * 255);
                continue;
            }
            if (norm === "out" || norm === "srcout") {
                const factor = sa * (1 - da);
                out[dIdx] = clampByteVal(sr * factor);
                out[dIdx + 1] = clampByteVal(sg * factor);
                out[dIdx + 2] = clampByteVal(sb * factor);
                out[dIdx + 3] = clampByteVal(factor * 255);
                continue;
            }
            if (norm === "dstin" || norm === "destin") {
                const factor = sa * da;
                out[dIdx] = dr;
                out[dIdx + 1] = dg;
                out[dIdx + 2] = db;
                out[dIdx + 3] = clampByteVal(factor * 255);
                continue;
            }
            if (norm === "dstout" || norm === "destout") {
                const factor = da * (1 - sa);
                out[dIdx] = dr;
                out[dIdx + 1] = dg;
                out[dIdx + 2] = db;
                out[dIdx + 3] = clampByteVal(factor * 255);
                continue;
            }
            if (norm === "atop" || norm === "srcatop") {
                out[dIdx] = clampByteVal(sr * sa * da + dr * da * (1 - sa));
                out[dIdx + 1] = clampByteVal(sg * sa * da + dg * da * (1 - sa));
                out[dIdx + 2] = clampByteVal(sb * sa * da + db * da * (1 - sa));
                out[dIdx + 3] = daByte;
                continue;
            }
            if (norm === "dstatop" || norm === "destatop") {
                out[dIdx] = clampByteVal(dr * da * sa + sr * sa * (1 - da));
                out[dIdx + 1] = clampByteVal(dg * da * sa + sg * sa * (1 - da));
                out[dIdx + 2] = clampByteVal(db * da * sa + sb * sa * (1 - da));
                out[dIdx + 3] = saByte;
                continue;
            }
            if (norm === "xor") {
                const outA = sa * (1 - da) + da * (1 - sa);
                out[dIdx] = clampByteVal(sr * sa * (1 - da) + dr * da * (1 - sa));
                out[dIdx + 1] = clampByteVal(sg * sa * (1 - da) + dg * da * (1 - sa));
                out[dIdx + 2] = clampByteVal(sb * sa * (1 - da) + db * da * (1 - sa));
                out[dIdx + 3] = clampByteVal(outA * 255);
                continue;
            }
            if (norm === "multiply" ||
                norm === "screen" ||
                norm === "overlay" ||
                norm === "darken" ||
                norm === "lighten" ||
                norm === "exclusion") {
                const gamma = sa + da - sa * da;
                const sChan = [sr / 255, sg / 255, sb / 255];
                const dChan = [dr / 255, dg / 255, db / 255];
                for (let c = 0; c < 3; c++) {
                    if (++cooperativeWork % 65536 === 0)
                        yield;
                    const sc = sChan[c]!;
                    const dc = dChan[c]!;
                    if (norm === "darken") {
                        const comp = Math.min(sc * sa, dc * da) + sc * sa * (1 - da) + dc * da * (1 - sa);
                        out[dIdx + c] = clampByteVal(comp * 255);
                    }
                    else if (norm === "lighten") {
                        const comp = Math.max(sc, dc) * sa * da + sc * sa * (1 - da) + dc * da * (1 - sa);
                        out[dIdx + c] = clampByteVal(comp * 255);
                    }
                    else if (norm === "exclusion") {
                        const comp = gamma * (sc * sa + dc - 2 * sc * dc * sa);
                        out[dIdx + c] = clampByteVal(comp * 255);
                    }
                    else {
                        let f = 0;
                        if (norm === "multiply")
                            f = sc * dc;
                        else if (norm === "screen")
                            f = sc + dc - sc * dc;
                        else
                            f = dc <= 0.5 ? 2 * sc * dc : 1 - 2 * (1 - sc) * (1 - dc);
                        const comp = f * sa * da + sc * sa * (1 - da) + dc * da * (1 - sa);
                        const unpremul = gamma > 1e-6 && norm === "overlay" ? comp / gamma : comp;
                        out[dIdx + c] = clampByteVal(unpremul * 255);
                    }
                }
                out[dIdx + 3] = clampByteVal(gamma * 255);
                continue;
            }
        }
    }
    if (norm === "over" ||
        norm === "srcover" ||
        norm === "dstover" ||
        norm === "destover" ||
        norm === "plus" ||
        norm === "add" ||
        norm === "lineardodge" ||
        norm === "colordodge" ||
        norm === "colorburn" ||
        norm === "hardlight" ||
        norm === "softlight" ||
        norm === "saturate") {
        const ox = Math.round(left);
        const oy = Math.round(top);
        if (ox >= 0 && oy >= 0 && ox + src.width <= dst.width && oy + src.height <= dst.height) {
            return (yield* compositeImageSteps(dst, [rgbaToCompositeLayer(src, ox, oy, parseCompose(modeRaw))]));
        }
        const sx0 = Math.max(0, -ox);
        const sy0 = Math.max(0, -oy);
        const sx1 = Math.min(src.width, dst.width - ox);
        const sy1 = Math.min(src.height, dst.height - oy);
        if (sx1 <= sx0 || sy1 <= sy0)
            return dst;
        const clipped = (yield* extractImageSteps(src, { left: sx0, top: sy0, width: sx1 - sx0, height: sy1 - sy0 }));
        return (yield* compositeImageSteps(dst, [rgbaToCompositeLayer(clipped, Math.max(0, ox), Math.max(0, oy), parseCompose(modeRaw))]));
    }
    return { ...dst, data: out, hasAlpha: true };
}

function rgbaToCss(c: RgbaColor): string {
  if (c.a === 0) return "none";
  if (c.a < 255) {
    return `rgba(${c.r},${c.g},${c.b},${(c.a / 255).toFixed(3)})`;
  }
  const hex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${hex(c.r)}${hex(c.g)}${hex(c.b)}`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function detachRgbaBuffer(u8: Uint8Array): void {
  if (u8.byteOffset === 0 && typeof (u8.buffer as any).transfer === "function") {
    try { (u8.buffer as any).transfer(0); } catch { /* Buffer detachment is best-effort; ordinary garbage collection remains available. */ }
  }
}

function* blitOverRgbaInPlaceSteps(
  dst: RgbaImage,
  src: RgbaImage,
  left: number,
  top: number
): Generator<void, void, void> {
  const ox = Math.round(left);
  const oy = Math.round(top);
  const x0 = Math.max(0, ox);
  const y0 = Math.max(0, oy);
  const x1 = Math.min(dst.width, ox + src.width);
  const y1 = Math.min(dst.height, oy + src.height);
  if (x1 <= x0 || y1 <= y0) return;
  const dstData = dst.data;
  const srcData = src.data;
  let work = 0;
  for (let y = y0; y < y1; y++) {
    if (++work % 64 === 0) yield;
    const sy = y - oy;
    let dstIdx = (y * dst.width + x0) * 4;
    let srcIdx = (sy * src.width + (x0 - ox)) * 4;
    for (let x = x0; x < x1; x++) {
      const sa = srcData[srcIdx + 3]!;
      if (sa === 255) {
        dstData[dstIdx] = srcData[srcIdx]!;
        dstData[dstIdx + 1] = srcData[srcIdx + 1]!;
        dstData[dstIdx + 2] = srcData[srcIdx + 2]!;
        dstData[dstIdx + 3] = 255;
      } else if (sa > 0) {
        const da = dstData[dstIdx + 3]!;
        const sAlpha = sa / 255;
        const dAlpha = (da / 255) * (1 - sAlpha);
        const outAlpha = sAlpha + dAlpha;
        if (outAlpha > 0) {
          dstData[dstIdx] = Math.round((srcData[srcIdx]! * sAlpha + dstData[dstIdx]! * dAlpha) / outAlpha);
          dstData[dstIdx + 1] = Math.round((srcData[srcIdx + 1]! * sAlpha + dstData[dstIdx + 1]! * dAlpha) / outAlpha);
          dstData[dstIdx + 2] = Math.round((srcData[srcIdx + 2]! * sAlpha + dstData[dstIdx + 2]! * dAlpha) / outAlpha);
          dstData[dstIdx + 3] = Math.round(outAlpha * 255);
        }
      }
      dstIdx += 4;
      srcIdx += 4;
    }
  }
}

function rgbaToCompositeLayer(
  overlay: RgbaImage,
  left: number,
  top: number,
  blend: BlendMode = "over"
): CompositeLayer {
  return {
    input: overlay.data,
    raw: {
      width: overlay.width,
      height: overlay.height,
      channels: 4
    },
    left: Math.round(left),
    top: Math.round(top),
    blend
  };
}

function* createSolidRgbaImageSteps(width: number, height: number, color: RgbaColor): Generator<void, RgbaImage, void> {
    yield;
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    const data = new Uint8Array(new ArrayBuffer(w * h * 4 + h), 0, w * h * 4);
    const tmp = new Uint8Array([color.r, color.g, color.b, color.a]);
    const packed = new Uint32Array(tmp.buffer)[0]!;
    const u32 = new Uint32Array(data.buffer, 0, w * h);
    for (let p = 0; p < u32.length; p += 16384) {
        u32.fill(packed, p, Math.min(u32.length, p + 16384));
        yield;
    }
    return {
        width: w,
        height: h,
        format: "png",
        channels: 4,
        depth: "uchar",
        density: 72,
        space: "srgb",
        hasAlpha: true,
        data
    };
}

function createLabelSvg(text: string, state: MagickState): string {
  const fontSize = Math.max(8, state.pointsize);
  const w = state.hasSize ? state.sizeWidth : Math.max(16, Math.ceil(text.length * fontSize * 0.65) + 8);
  const h = state.hasSize ? state.sizeHeight : Math.max(12, Math.ceil(fontSize * 1.4));
  const bg = state.background.a > 0 ? `<rect width="${w}" height="${h}" fill="${rgbaToCss(state.background)}"/>` : "";
  const isHorizCenter = state.gravity === "center" || state.gravity === "north" || state.gravity === "south";
  const isHorizEast = state.gravity === "northeast" || state.gravity === "east" || state.gravity === "southeast";
  const textX = isHorizCenter ? Math.round(w / 2) : isHorizEast ? Math.max(2, w - 4) : 2;
  const anchor = isHorizCenter ? ' text-anchor="middle"' : isHorizEast ? ' text-anchor="end"' : "";
  const textY = state.gravity === "center" || state.gravity === "west" || state.gravity === "east"
    ? Math.round(h / 2 + fontSize * 0.35)
    : Math.round(h * 0.75);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${bg}<text x="${textX}" y="${textY}"${anchor} font-size="${fontSize}" fill="${rgbaToCss(state.fill)}">${escapeXml(text)}</text></svg>`;
  return svg;
}

function magickResizeOptions(img:Pick<RgbaImage,"width"|"height">,geomStr:string,kernel:ResizeKernel):Parameters<typeof resizeImageSteps>[1]|undefined {
    const g = parseMagickGeometry(geomStr);
    const srcW = img.width;
    const srcH = img.height;
    let targetW: number;
    let targetH: number;
    if (g.areaLimit !== undefined) {
        const currentArea = srcW * srcH;
        const scale = Math.sqrt(g.areaLimit / Math.max(1, currentArea));
        if (g.shrinkOnly && scale >= 1)
            return undefined;
        if (g.enlargeOnly && scale <= 1)
            return undefined;
        targetW = Math.max(1, Math.round(srcW * scale));
        targetH = Math.max(1, Math.round(srcH * scale));
    }
    else if (g.isPercent) {
        const sx = (g.percentX ?? 100) / 100;
        const sy = (g.percentY ?? 100) / 100;
        targetW = Math.max(1, Math.round(srcW * sx));
        targetH = Math.max(1, Math.round(srcH * sy));
    }
    else if (g.forceExact) {
        targetW = Math.max(1, Math.round(g.width ?? srcW));
        targetH = Math.max(1, Math.round(g.height ?? srcH));
        if (g.shrinkOnly && srcW <= targetW && srcH <= targetH)
            return undefined;
        if (g.enlargeOnly && srcW >= targetW && srcH >= targetH)
            return undefined;
    }
    else if (g.fillArea) {
        const boxW = g.width ?? srcW;
        const boxH = g.height ?? srcH;
        if (g.shrinkOnly && srcW <= boxW && srcH <= boxH)
            return undefined;
        if (g.enlargeOnly && srcW >= boxW && srcH >= boxH)
            return undefined;
        const scale = Math.max(boxW / srcW, boxH / srcH);
        targetW = Math.max(1, Math.round(srcW * scale));
        targetH = Math.max(1, Math.round(srcH * scale));
    }
    else {
        const boxW = g.width;
        const boxH = g.height;
        if (boxW !== undefined && boxH !== undefined) {
            if (g.shrinkOnly && srcW <= boxW && srcH <= boxH)
                return undefined;
            if (g.enlargeOnly && srcW >= boxW && srcH >= boxH)
                return undefined;
            const scale = Math.min(boxW / srcW, boxH / srcH);
            targetW = Math.max(1, Math.round(srcW * scale));
            targetH = Math.max(1, Math.round(srcH * scale));
        }
        else if (boxW !== undefined) {
            if (g.shrinkOnly && srcW <= boxW)
                return undefined;
            if (g.enlargeOnly && srcW >= boxW)
                return undefined;
            const scale = boxW / srcW;
            targetW = Math.max(1, Math.round(boxW));
            targetH = Math.max(1, Math.round(srcH * scale));
        }
        else if (boxH !== undefined) {
            if (g.shrinkOnly && srcH <= boxH)
                return undefined;
            if (g.enlargeOnly && srcH >= boxH)
                return undefined;
            const scale = boxH / srcH;
            targetW = Math.max(1, Math.round(srcW * scale));
            targetH = Math.max(1, Math.round(boxH));
        }
        else {
            return undefined;
        }
    }
    return {
        width: targetW,
        height: targetH,
        fit: "fill",
        position: "center",
        kernel,
        background: { r: 0, g: 0, b: 0, a: 0 },
        withoutEnlargement: false,
        withoutReduction: false
    };
}

function* applyMagickResizeSteps(img:RgbaImage,geomStr:string,kernel:ResizeKernel):Generator<void,RgbaImage,void>{const options=magickResizeOptions(img,geomStr,kernel);return options?yield*resizeImageSteps(img,options):img;}

function* applyMagickCropSteps(img: RgbaImage, geomStr: string, gravity: GravityPosition): Generator<void, RgbaImage, void> {
    return (yield* applyMagickCropToStackSteps(img, geomStr, gravity))[0]!;
}

function* applyMagickCropToStackSteps(img: RgbaImage, geomStr: string, gravity: GravityPosition): Generator<void, RgbaImage[], void> {
    let work = 0;
    const g = parseMagickGeometry(geomStr);
    if (g.isSubdivide) {
        const cols = Math.max(1, Math.round(g.width ?? 1));
        const rows = Math.max(1, Math.round(g.height ?? 1));
        const tiles: RgbaImage[] = [];
        for (let r = 0; r < rows; r++) {
            if (++work % 16384 === 0)
                yield;
            const top = Math.min(img.height - 1, Math.round((r * img.height) / rows));
            const nextTop = Math.max(top + 1, Math.min(img.height, Math.round(((r + 1) * img.height) / rows)));
            const h = nextTop - top;
            for (let c = 0; c < cols; c++) {
                if (++work % 16384 === 0)
                    yield;
                const left = Math.min(img.width - 1, Math.round((c * img.width) / cols));
                const nextLeft = Math.max(left + 1, Math.min(img.width, Math.round(((c + 1) * img.width) / cols)));
                const w = nextLeft - left;
                tiles.push((yield* extractImageSteps(img, { left, top, width: w, height: h })));
            }
        }
        return tiles;
    }
    const area=magickCropArea(img,geomStr,gravity);return area?[(yield*extractImageSteps(img,area))]:[img];
}

function magickCropArea(img:Pick<RgbaImage,"width"|"height">,geomStr:string,gravity:GravityPosition):Parameters<typeof extractImageSteps>[1]|undefined {
 const g=parseMagickGeometry(geomStr);
    const rawW = g.isPercent
        ? Math.max(1, Math.round((img.width * (g.percentX ?? 100)) / 100))
        : Math.max(1, Math.round(g.width ?? img.width));
    const rawH = g.isPercent
        ? Math.max(1, Math.round((img.height * (g.percentY ?? 100)) / 100))
        : Math.max(1, Math.round(g.height ?? img.height));
    const { x: x0, y: y0 } = gravityAdjustBox(img.width, img.height, rawW, rawH, g.x, g.y, gravity);
    if (x0 === img.width || y0 === img.height) {
        return undefined;
    }
    const ix0 = Math.max(0, x0);
    const iy0 = Math.max(0, y0);
    const ix1 = Math.min(img.width, x0 + rawW);
    const iy1 = Math.min(img.height, y0 + rawH);
    if (ix1 <= ix0 || iy1 <= iy0) {
        return {left:0,top:0,width:1,height:1};
    }
    return {
            left: ix0,
            top: iy0,
            width: ix1 - ix0,
            height: iy1 - iy0
    };
}

function magickExtentLayout(img: Pick<RgbaImage, "width" | "height">, geomStr: string, state: MagickState) {
    const g = parseMagickGeometry(geomStr);
    const targetW = Math.max(1, Math.round(g.width ?? img.width));
    const targetH = Math.max(1, Math.round(g.height ?? img.height));
    const offset = resolveGravityOffset(targetW - img.width, targetH - img.height, state.gravity);
    const isEast = state.gravity === "east" || state.gravity === "northeast" || state.gravity === "southeast";
    const isSouth = state.gravity === "south" || state.gravity === "southwest" || state.gravity === "southeast";
    const left = Math.round(offset.left - (isEast ? -g.x : g.x));
    const top = Math.round(offset.top - (isSouth ? -g.y : g.y));
    const dstX0 = Math.max(0, left);
    const dstY0 = Math.max(0, top);
    const dstX1 = Math.min(targetW, left + img.width);
    const dstY1 = Math.min(targetH, top + img.height);
    return { width: targetW, height: targetH, left: dstX0, top: dstY0, area: dstX1 <= dstX0 || dstY1 <= dstY0 ? undefined : { left: dstX0 - left, top: dstY0 - top, width: dstX1 - dstX0, height: dstY1 - dstY0 } };
}
function* applyMagickExtentSteps(img: RgbaImage, geomStr: string, state: MagickState, signal?: AbortSignal): Generator<void, RgbaImage, void> {
    yield;
    const layout = magickExtentLayout(img, geomStr, state), canvas = yield* createSolidRgbaImageSteps(layout.width, layout.height, state.background);
    if (!layout.area) return canvas;
    const subImg = yield* extractImageSteps(img, layout.area);
    return yield* compositeImageSteps(canvas, [rgbaToCompositeLayer(subImg, layout.left, layout.top, "over")]);
}
async function decodeStoredMagickSvg(svg: string, density: number, backend: CompareFileSession, signal: AbortSignal): Promise<StoredRgbaImage> {
    const encoder = new TextEncoder(), base = backend.storage.allocate(0);
    let size = 0;
    for (let offset = 0; offset < svg.length;) {
        await yieldTurn(signal);
        const bytes = new Uint8Array(4096), { read, written } = encoder.encodeInto(svg.slice(offset, offset + 4097), bytes);
        await backend.storage.write(backend.storage.allocate(written), bytes.subarray(0, written));
        offset += read; size += written;
    }
    return decodeImageToStorage({ size, async read(position, length) { return backend.storage.read(base + position, length); } }, backend.storage, signal, { density });
}
async function createStoredCanvas(width: number, height: number, color: RgbaColor, backend: CompareFileSession, signal: AbortSignal): Promise<StoredRgbaImage> {
    return { ...await decodeImageToStorage({ size: 0, async read() { return new Uint8Array(); } }, backend.storage, signal, { create: { width, height, channels: 4, background: { r: color.r, g: color.g, b: color.b, alpha: color.a / 255 } } }), format: "png" };
}

type MagickDrawShape = { kind: "shape"; color: RgbaColor; x: number; y: number } & ({ shape: "rectangle"; width: number; height: number } | { shape: "circle"; radius: number });
type MagickDrawStep = MagickDrawShape | { kind: "svg"; svg: string };

function* drawShapePixelSteps(image: Pick<RgbaImage, "width" | "height">, shape: MagickDrawShape): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const { color } = shape;
    const x0 = Math.max(0, Math.floor(shape.shape === "rectangle" ? shape.x : shape.x - shape.radius - 1));
    const y0 = Math.max(0, Math.floor(shape.shape === "rectangle" ? shape.y : shape.y - shape.radius - 1));
    const x1 = Math.min(image.width, Math.ceil(shape.shape === "rectangle" ? shape.x + shape.width : shape.x + shape.radius + 1));
    const y1 = Math.min(image.height, Math.ceil(shape.shape === "rectangle" ? shape.y + shape.height : shape.y + shape.radius + 1));
    for (let start = 0; start < image.width * image.height; start += 1024) {
        yield;
        const count = Math.min(1024, image.width * image.height - start), bytes = yield { kind: "read", position: start * 4, length: count * 4 };
        if (!bytes || bytes.length !== count * 4) throw new Error("Truncated drawing pixels");
        const data = new Uint8Array(bytes);
        for (let i = 0; i < count; i++) {
            const x = (start + i) % image.width, y = Math.floor((start + i) / image.width);
            if (x < x0 || x >= x1 || y < y0 || y >= y1) continue;
            const coverage = shape.shape === "rectangle" ? 1 : Math.max(0, Math.min(1, shape.radius + 0.5 - Math.hypot(x - shape.x, y - shape.y)));
            const alpha = color.a / 255 * coverage, offset = i * 4;
            if (alpha >= 0.999) {
                data[offset] = color.r; data[offset + 1] = color.g; data[offset + 2] = color.b; data[offset + 3] = 255;
            } else if (alpha > 0) {
                const da = data[offset + 3]! / 255, outA = alpha + da * (1 - alpha);
                if (outA > 0) {
                    data[offset] = Math.round((color.r * alpha + data[offset]! * da * (1 - alpha)) / outA);
                    data[offset + 1] = Math.round((color.g * alpha + data[offset + 1]! * da * (1 - alpha)) / outA);
                    data[offset + 2] = Math.round((color.b * alpha + data[offset + 2]! * da * (1 - alpha)) / outA);
                    data[offset + 3] = Math.round(outA * 255);
                }
            }
        }
        yield { kind: "write", position: start * 4, data };
    }
}

function* drawOverlayPixelSteps(image: Pick<RgbaImage, "width" | "height">, overlay: Pick<RgbaImage, "width" | "height">): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    for (let start = 0; start < image.width * image.height; start += 1024) {
        yield;
        const count = Math.min(1024, image.width * image.height - start), bytes = yield { kind: "read", position: start * 4, length: count * 4 };
        if (!bytes || bytes.length !== count * 4) throw new Error("Truncated drawing pixels");
        const data = new Uint8Array(bytes);
        for (let i = 0; i < count; i++) {
            const x = (start + i) % image.width, y = Math.floor((start + i) / image.width);
            if (x >= overlay.width || y >= overlay.height) continue;
            const source = yield { kind: "read", image: 1, position: (y * overlay.width + x) * 4, length: 4 };
            if (!source || source.length !== 4) throw new Error("Truncated drawing overlay");
            const sa = source[3]!, offset = i * 4;
            if (sa === 255) data.set(source, offset);
            else if (sa > 0) {
                const da = data[offset + 3]! / 255, alpha = sa / 255, outA = alpha + da * (1 - alpha);
                if (outA > 0) {
                    for (let channel = 0; channel < 3; channel++) data[offset + channel] = Math.round((source[channel]! * alpha + data[offset + channel]! * da * (1 - alpha)) / outA);
                    data[offset + 3] = Math.round(outA * 255);
                }
            }
        }
        yield { kind: "write", position: start * 4, data };
    }
}

function* magickDrawSteps(img: Pick<RgbaImage, "width" | "height">, drawCmd: string, state: MagickState): Generator<MagickDrawStep | undefined, void, void> {
    yield;
    let cooperativeWork = 0;
    const svgElements: string[] = [];
    let fill = rgbaToCss(state.fill);
    let stroke = rgbaToCss(state.stroke);
    let strokeWidth = state.strokeWidth;
    const tokens: string[] = [];
    for (let offset = 0; offset < drawCmd.length;) {
        if (++cooperativeWork % 65536 === 0) yield;
        const char = drawCmd[offset]!;
        if (char === "," || char.trim() === "") { offset++; continue; }
        if (char === "'" || char === '"') {
            const end = drawCmd.indexOf(char, offset + 1);
            if (end >= 0) { tokens.push(drawCmd.slice(offset + 1, end)); offset = end + 1; continue; }
        }
        const start = offset++;
        while (offset < drawCmd.length && drawCmd[offset] !== "," && drawCmd[offset]!.trim() !== "") offset++;
        tokens.push(drawCmd.slice(start, offset));
    }
    let i = 0;
    const num = () => Number(tokens[i++] ?? 0);
    while (i < tokens.length) {
        if (++cooperativeWork % 65536 === 0)
            yield;
        const cmd = tokens[i++]!.toLowerCase();
        if (cmd === "fill") {
            fill = rgbaToCss(parseColor(tokens[i++] ?? "#000000"));
        }
        else if (cmd === "stroke") {
            stroke = rgbaToCss(parseColor(tokens[i++] ?? "#000000"));
        }
        else if (cmd === "stroke-width" || cmd === "strokewidth") {
            strokeWidth = Math.max(0, num());
        }
        else if (cmd === "rectangle") {
            const x0 = num();
            const y0 = num();
            const x1 = num();
            const y1 = num();
            const rx = Math.min(x0, x1);
            const ry = Math.min(y0, y1);
            const rw = Math.max(1, Math.abs(x1 - x0) + 1);
            const rh = Math.max(1, Math.abs(y1 - y0) + 1);
            if (fill !== "none" && (stroke === "none" || strokeWidth <= 0) && svgElements.length === 0) {
                yield { kind: "shape", shape: "rectangle", color: parseColor(fill), x: rx, y: ry, width: rw, height: rh };
            } else {
                if (fill !== "none") {
                    svgElements.push(`<rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" fill="${fill}"/>`);
                }
                if (stroke !== "none" && strokeWidth > 0) {
                    svgElements.push(`<polygon points="${rx},${ry} ${rx + rw - 1},${ry} ${rx + rw - 1},${ry + rh - 1} ${rx},${ry + rh - 1}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}"/>`);
                }
            }
        }
        else if (cmd === "roundrectangle") {
            const x0 = num();
            const y0 = num();
            const x1 = num();
            const y1 = num();
            const wc = num();
            const hc = num();
            const rx = Math.min(x0, x1);
            const ry = Math.min(y0, y1);
            const rw = Math.max(1, Math.abs(x1 - x0) + 1);
            const rh = Math.max(1, Math.abs(y1 - y0) + 1);
            if (fill !== "none") {
                svgElements.push(`<rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" rx="${wc}" ry="${hc}" fill="${fill}"/>`);
            }
            if (stroke !== "none" && strokeWidth > 0) {
                svgElements.push(`<polygon points="${rx},${ry} ${rx + rw - 1},${ry} ${rx + rw - 1},${ry + rh - 1} ${rx},${ry + rh - 1}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}"/>`);
            }
        }
        else if (cmd === "circle") {
            const cx = num();
            const cy = num();
            const px = num();
            const py = num();
            const r = Math.max(1, Math.hypot(px - cx, py - cy));
            if (fill !== "none" && (stroke === "none" || strokeWidth <= 0) && svgElements.length === 0) {
                yield { kind: "shape", shape: "circle", color: parseColor(fill), x: cx, y: cy, radius: r };
            } else {
                svgElements.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`);
            }
        }
        else if (cmd === "ellipse") {
            const cx = num();
            const cy = num();
            const rx = num();
            const ry = num();
            num();
            num();
            svgElements.push(`<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`);
        }
        else if (cmd === "line") {
            const x0 = num();
            const y0 = num();
            const x1 = num();
            const y1 = num();
            const lineStroke = stroke === "none" ? fill : stroke;
            svgElements.push(`<line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" stroke="${lineStroke}" stroke-width="${Math.max(1, strokeWidth)}"/>`);
        }
        else if (cmd === "point") {
            const x = num();
            const y = num();
            svgElements.push(`<rect x="${x}" y="${y}" width="1" height="1" fill="${fill}"/>`);
        }
        else if (cmd === "text") {
            const x = num();
            const y = num();
            const txt = tokens[i++] ?? "";
            svgElements.push(`<text x="${x}" y="${y}" font-size="${state.pointsize}" fill="${fill}">${escapeXml(txt)}</text>`);
        }
        else if (cmd === "polygon" || cmd === "polyline") {
            const pts: string[] = [];
            while (i < tokens.length && !Number.isNaN(Number(tokens[i]))) {
                if (++cooperativeWork % 65536 === 0)
                    yield;
                const px = num();
                const py = num();
                pts.push(`${px},${py}`);
            }
            if (pts.length >= 2) {
                if (cmd === "polygon") {
                    svgElements.push(`<polygon points="${pts.join(" ")}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`);
                }
                else {
                    const lineStroke = stroke === "none" ? fill : stroke;
                    svgElements.push(`<polyline points="${pts.join(" ")}" fill="none" stroke="${lineStroke}" stroke-width="${Math.max(1, strokeWidth)}"/>`);
                }
            }
        }
        else if (cmd === "bezier") {
            const pts: Array<{
                x: number;
                y: number;
            }> = [];
            while (i < tokens.length && !Number.isNaN(Number(tokens[i]))) {
                if (++cooperativeWork % 65536 === 0)
                    yield;
                pts.push({ x: num(), y: num() });
            }
            if (pts.length === 3) {
                const lineStroke = stroke === "none" ? fill : stroke;
                svgElements.push(`<path d="M ${pts[0]!.x} ${pts[0]!.y} Q ${pts[1]!.x} ${pts[1]!.y} ${pts[2]!.x} ${pts[2]!.y}" fill="none" stroke="${lineStroke}" stroke-width="${Math.max(1, strokeWidth)}"/>`);
            }
            else if (pts.length >= 4) {
                const lineStroke = stroke === "none" ? fill : stroke;
                const rest = pts.slice(1).map((p) => `${p.x} ${p.y}`).join(" ");
                svgElements.push(`<path d="M ${pts[0]!.x} ${pts[0]!.y} C ${rest}" fill="none" stroke="${lineStroke}" stroke-width="${Math.max(1, strokeWidth)}"/>`);
            }
        }
        else if (cmd === "path") {
            const d = tokens[i++] ?? "";
            svgElements.push(`<path d="${escapeXml(d)}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`);
        }
    }
    if (svgElements.length > 0) yield { kind: "svg", svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${img.width}" height="${img.height}">${svgElements.join("")}</svg>` };
}

function hasAnnotationOffset(value: string): boolean {
    const digit = (char: string | undefined) => char !== undefined && char >= "0" && char <= "9";
    if ((value[0] === "+" || value[0] === "-") && digit(value[1])) return true;
    let i = 0;
    while (digit(value[i])) i++;
    return i > 0 && value[i] === "x" && digit(value[i + 1]);
}

function* annotatePixelSteps(img: Pick<RgbaImage, "width" | "height">, offsetStr: string, text: string, state: MagickState): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const fill = state.fill;
    const g = parseMagickGeometry(offsetStr);
    const fontSize = Math.max(8, state.pointsize);
    const estW = Math.max(8, Math.ceil(text.length * fontSize * 0.6));
    const estH = Math.max(8, Math.ceil(fontSize));
    const gravOff = resolveGravityOffset(img.width - estW, img.height - estH, state.gravity);
    const x = Math.max(0, Math.round(gravOff.left + g.x));
    const y = Math.max(fontSize, Math.round(gravOff.top + estH + g.y));
    const scale = (state.density || 72) / 72;
    const effFontSize = Math.max(6, fontSize * scale);
    const glyphH = Math.max(7, Math.round(effFontSize * 0.76));
    const glyphW = Math.max(5, Math.round(glyphH * (5 / 7)));
    const advanceX = Math.max(glyphW + 1, Math.round(glyphW * 1.2));
    const baseTopY = Math.round(y * scale - glyphH);
    const startX = x * scale;
    const srcA = fill.a / 255;
    for (let start = 0; start < img.width * img.height; start += 1024) {
        yield;
        const count = Math.min(1024, img.width * img.height - start);
        const bytes = yield { kind: "read", position: start * 4, length: count * 4 };
        if (!bytes || bytes.length !== count * 4) throw new Error("Truncated annotation pixels");
        const dst = new Uint8Array(bytes);
        if (fill.a > 0) for (let i = 0; i < count; i++) {
            const screenX = (start + i) % img.width, screenY = Math.floor((start + i) / img.width);
            const ci = Math.floor((screenX - Math.round(startX)) / advanceX);
            if (ci < 0 || ci >= text.length) continue;
            const ch = text.charCodeAt(ci);
            if (ch <= 32) continue;
            const glyphIdx = Math.max(0, Math.min(94, ch - 32));
            const isDescender = ch === 103 || ch === 106 || ch === 112 || ch === 113 || ch === 121 || ch === 44 || ch === 59;
            const charTopY = baseTopY + (isDescender ? Math.max(1, Math.round(glyphH / 7)) : 0);
            const px = screenX - Math.round(startX + ci * advanceX), py = screenY - charTopY;
            if (px < 0 || px >= glyphW || py < 0 || py >= glyphH) continue;
            const gx = Math.min(4, Math.floor(px * 5 / glyphW)), gy = Math.min(6, Math.floor(py * 7 / glyphH));
            if ((FONT_5X7[glyphIdx * 5 + gx]! & (1 << gy)) === 0) continue;
            const dIdx = i * 4;
            if (fill.a === 255) {
                dst[dIdx] = fill.r; dst[dIdx + 1] = fill.g; dst[dIdx + 2] = fill.b; dst[dIdx + 3] = 255;
            } else {
                const dA = dst[dIdx + 3]! / 255, outA = srcA + dA * (1 - srcA);
                if (outA > 0) {
                    dst[dIdx] = Math.round((fill.r * srcA + dst[dIdx]! * dA * (1 - srcA)) / outA);
                    dst[dIdx + 1] = Math.round((fill.g * srcA + dst[dIdx + 1]! * dA * (1 - srcA)) / outA);
                    dst[dIdx + 2] = Math.round((fill.b * srcA + dst[dIdx + 2]! * dA * (1 - srcA)) / outA);
                    dst[dIdx + 3] = Math.round(outA * 255);
                }
            }
        }
        yield { kind: "write", position: start * 4, data: dst };
    }
}

function* appendStackImagesSteps(stack: RgbaImage[], vertical: boolean, state: MagickState): Generator<void, RgbaImage, void> {
    let work = 0;
    if (stack.length === 0) {
        return (yield* createSolidRgbaImageSteps(1, 1, state.background));
    }
    if (stack.length === 1)
        return stack[0]!;
    const totalW = vertical
        ? Math.max(...stack.map((im) => im.width))
        : stack.reduce((acc, im) => acc + im.width, 0);
    const totalH = vertical
        ? stack.reduce((acc, im) => acc + im.height, 0)
        : Math.max(...stack.map((im) => im.height));
    const canvas = (yield* createSolidRgbaImageSteps(totalW, totalH, state.background));
    let cursor = 0;
    for (const im of stack) {
        if (++work % 16384 === 0)
            yield;
        if (vertical) {
            const off = resolveGravityOffset(totalW - im.width, 0, state.gravity);
            yield* blitOverRgbaInPlaceSteps(canvas, im, off.left, cursor);
            cursor += im.height;
        }
        else {
            const off = resolveGravityOffset(0, totalH - im.height, state.gravity);
            yield* blitOverRgbaInPlaceSteps(canvas, im, cursor, off.top);
            cursor += im.width;
        }
    }
    return canvas;
}

function inferOutputFormat(spec: string, fallback: ImageFormat = "png"): { format: ImageFormat; path: string } {
  const prefixMatch = /^([a-zA-Z0-9]+):(.*)$/.exec(spec);
  if (prefixMatch) {
    const prefix = prefixMatch[1]!.toLowerCase();
    const rest = prefixMatch[2]!;
    const fmt = extToImageFormat(prefix);
    if (fmt) {
      return { format: fmt, path: rest };
    }
  }
  const dotIdx = spec.lastIndexOf(".");
  if (dotIdx >= 0) {
    const ext = spec.slice(dotIdx + 1).toLowerCase();
    const fmt = extToImageFormat(ext);
    if (fmt) return { format: fmt, path: spec };
  }
  return { format: fallback, path: spec };
}

function extToImageFormat(ext: string): ImageFormat | undefined {
  switch (ext.toLowerCase()) {
    case "png":
      return "png";
    case "jpg":
    case "jpeg":
      return "jpeg";
    case "webp":
      return "webp";
    case "gif":
      return "gif";
    case "bmp":
      return "bmp";
    case "tif":
    case "tiff":
      return "tiff";
    case "ppm":
      return "ppm";
    case "pgm":
      return "pgm";
    case "pbm":
      return "pbm";
    case "heic":
      return "heic";
    case "heif":
      return "heif";
    case "avif":
      return "avif";
    case "pdf":
      return "pdf";
    case "svg":
      return "svg";
    default:
      return undefined;
  }
}

function* parseInputOperandSteps(token: string, files: Map<string, Uint8Array>, state: MagickState, stdinBytes?: Uint8Array): Generator<void, RgbaImage | undefined, void> {
    const list = (yield* parseInputOperandsSteps(token, files, state, stdinBytes));
    return list?.[0];
}

function* applyInlineReadModifierSteps(img: RgbaImage, inlineGeom: string, kernel: ResizeKernel): Generator<void, RgbaImage, void> {
    const g = parseMagickGeometry(inlineGeom);
    if (g.hasOffset) {
        return (yield* applyMagickCropSteps(img, inlineGeom, "northwest"));
    }
    return (yield* applyMagickResizeSteps(img, inlineGeom, kernel));
}

function inferMaxDecodeDimensionFromUpcomingTokens(
    tokens: readonly string[],
    startIdx: number,
    inlineGeom?: string
): number | undefined {
    if (inlineGeom) {
        const g = parseMagickGeometry(inlineGeom);
        if (!g.hasOffset && !g.isPercent && g.areaLimit === undefined && (g.width !== undefined || g.height !== undefined)) {
            const dim = Math.max(g.width ?? 0, g.height ?? 0);
            if (dim >= 32) return dim;
        }
    }
    const coordDependentOps = new Set([
        "-crop", "-chop", "-splice", "-trim", "-roll", "-shave",
        "-extent", "-border", "-frame", "-draw", "-annotate",
        "-region", "-floodfill", "-repage", "+repage", "-distort"
    ]);
    for (let k = startIdx; k < tokens.length; k++) {
        const tok = tokens[k]!;
        if (coordDependentOps.has(tok)) return undefined;
        if (tok === "-resize" || tok === "-thumbnail" || tok === "-scale" || tok === "-sample") {
            const geomStr = tokens[k + 1];
            if (!geomStr) return undefined;
            const g = parseMagickGeometry(geomStr);
            if (!g.hasOffset && !g.isPercent && g.areaLimit === undefined && (g.width !== undefined || g.height !== undefined)) {
                const dim = Math.max(g.width ?? 0, g.height ?? 0);
                if (dim >= 32) return dim;
            }
            return undefined;
        }
    }
    return undefined;
}

function parseInputToken(token:string):{baseToken:string;pageSpec?:string;inlineGeom?:string}{
    let baseToken = token;
    let pageSpec: string | undefined;
    let inlineGeom: string | undefined;
    const bracketMatch = /^(.*)\[([^\]]+)\]$/.exec(baseToken);
    if (bracketMatch) {
        baseToken = bracketMatch[1]!;
        const inside = bracketMatch[2]!;
        if (/^-?\d+$/.test(inside) || /^-?\d+--?\d+$/.test(inside) || /^-?\d+(,-?\d+)+$/.test(inside)) {
            pageSpec = inside;
        }
        else {
            inlineGeom = inside;
        }
    }
 return {baseToken,...(pageSpec===undefined?{}:{pageSpec}),...(inlineGeom===undefined?{}:{inlineGeom})};
}

function* selectedInputPages(pageSpec:string|undefined,totalPages:number):Generator<number>{
 const resolveIdx=(n:number)=>n<0?Math.max(0,totalPages+n):Math.min(Math.max(0,n),Math.max(0,totalPages-1));
 if(pageSpec===undefined){for(let page=0;page<totalPages;page++)yield page;}
 else if(/^-?\d+$/.test(pageSpec))yield resolveIdx(parseInt(pageSpec,10));
 else if(/^-?\d+--?\d+$/.test(pageSpec)){const match=/^(-?\d+)-(-?\d+)$/.exec(pageSpec)!;const start=resolveIdx(parseInt(match[1]!,10)),end=resolveIdx(parseInt(match[2]!,10)),step=start<=end?1:-1;for(let page=start;;page+=step){yield page;if(page===end)break;}}
 else for(const page of pageSpec.split(","))yield resolveIdx(parseInt(page,10));
}

function* parseInputOperandsSteps(token: string, files: Map<string, Uint8Array>, state: MagickState, stdinBytes?: Uint8Array, maxDecodeDimension?: number): Generator<void, RgbaImage[] | undefined, void> {
    let work = 0;
    const {baseToken,pageSpec,inlineGeom}=parseInputToken(token);
    function* applyMod(imgs: RgbaImage[]): Generator<void, RgbaImage[], void> {
        if (!inlineGeom)
            return imgs;
        return yield* mapSteps(imgs, function* (im) { return yield* applyInlineReadModifierSteps(im, inlineGeom, state.kernel); });
    }
    const lower = baseToken.toLowerCase();
    if (lower.startsWith("tile:")) {
        const patterns = (yield* parseInputOperandsSteps(baseToken.slice(5), files, state, stdinBytes));
        if (!patterns)
            return undefined;
        return yield* applyMod((yield* mapSteps(patterns, function* (pattern) {
            const tiled = (yield* createSolidRgbaImageSteps(state.sizeWidth, state.sizeHeight, state.background));
            for (let y = 0; y < tiled.height; y++) {
                for (let x = 0; x < tiled.width; x++) {
                    const source = ((y % pattern.height) * pattern.width + x % pattern.width) * 4;
                    tiled.data.set(pattern.data.subarray(source, source + 4), (y * tiled.width + x) * 4);
                }
            }
            return tiled;
        })));
    }
    if (lower.startsWith("xc:") || lower.startsWith("canvas:")) {
        const colorStr = baseToken.slice(baseToken.indexOf(":") + 1) || "white";
        const c = parseColor(colorStr);
        return yield* applyMod([(yield* createSolidRgbaImageSteps(state.sizeWidth, state.sizeHeight, c))]);
    }
    if (lower.startsWith("gradient:") || lower.startsWith("radial-gradient:")) {
        const radial = lower.startsWith("radial-gradient:");
        const spec = baseToken.slice(baseToken.indexOf(":") + 1);
        const [c1Str, c2Str] = spec ? spec.split("-") : [];
        const c1 = parseColor(c1Str || "#ffffff");
        const c2 = parseColor(c2Str || "#000000");
        return yield* applyMod([(yield* createGradientImageSteps(state.sizeWidth, state.sizeHeight, c1, c2, radial))]);
    }
    if (lower.startsWith("pattern:") || lower.startsWith("plasma:")) {
        return yield* applyMod([(yield* createCheckerboardImageSteps(state.sizeWidth, state.sizeHeight))]);
    }
    if (lower === "rose:" || lower === "logo:" || lower === "wizard:" || lower === "granite:") {
        return yield* applyMod([(yield* createRoseImageSteps())]);
    }
    if (lower.startsWith("label:") || lower.startsWith("caption:")) {
        const text = baseToken.slice(baseToken.indexOf(":") + 1);
        return yield* applyMod([decodeImage(new TextEncoder().encode(createLabelSvg(text, state)), { density: state.density })]);
    }
    if (lower === "null:") {
        return yield* applyMod([(yield* createSolidRgbaImageSteps(1, 1, { r: 0, g: 0, b: 0, a: 0 }))]);
    }
    let cleanToken = baseToken;
    const prefixMatch = /^([a-zA-Z0-9]+):(.*)$/.exec(cleanToken);
    if (prefixMatch && extToImageFormat(prefixMatch[1]!)) {
        cleanToken = prefixMatch[2]!;
    }
    const rawBytes = cleanToken === "-" ? stdinBytes : files.get(cleanToken) ?? files.get(token);
    if (!rawBytes)
        return undefined;
    let totalPages = 1;
    let inputMeta: ImageMetadata | undefined;
    try {
        inputMeta = readImageMetadata(rawBytes, { density: state.density });
        if (inputMeta.pages && inputMeta.pages > 1)
            totalPages = inputMeta.pages;
    }
    catch {
        totalPages = 1;
    }
    const pageIndices:number[]=[];for(const page of selectedInputPages(pageSpec,totalPages)){if(++work%16384===0)yield;pageIndices.push(page);}
    const effectiveMaxDecodeDim = inferMaxDecodeDimensionFromUpcomingTokens([], 0, inlineGeom) ?? maxDecodeDimension;
    const results: RgbaImage[] = [];
    for (const pageIdx of pageIndices) {
        if (++work % 16384 === 0)
            yield;
        let img = decodeImage(rawBytes, {
            density: state.density,
            ...(effectiveMaxDecodeDim !== undefined ? { maxDecodeDimension: effectiveMaxDecodeDim } : {}),
            ...(totalPages > 1 || pageSpec !== undefined ? { page: pageIdx } : {})
        });
        const source: MagickFormatContext = {
            filePath: cleanToken, byteLen: rawBytes.byteLength,
            originalWidth: inputMeta?.width ?? img.width, originalHeight: inputMeta?.height ?? img.height, sceneIdx: pageIdx
        };
        img = Object.assign(img, { [magickInput]: source });
        if (inlineGeom) {
            img = (yield* applyInlineReadModifierSteps(img, inlineGeom, state.kernel));
        }
        results.push(img);
    }
    return results;
}

function tryHandleMagickListOption(argv: readonly string[]): ImageMagickCliResult | undefined {
    const endIdx = argv.indexOf("--");
    const limit = endIdx < 0 ? argv.length : endIdx;
    for (let i = 0; i < limit; i++) {
        const arg = argv[i]!;
        if (arg === "-list" || arg === "--list") {
            const listType = (argv[i + 1] ?? "list").toLowerCase();
            if (listType === "font" || listType === "type") {
                return {
                    exitCode: 0,
                    stdout: [
                        "  Font: DejaVu-Sans",
                        "    family: DejaVu Sans",
                        "    style: Normal",
                        "    stretch: Normal",
                        "    weight: 400",
                        "  Font: DejaVu-Sans-Bold",
                        "    family: DejaVu Sans",
                        "    style: Normal",
                        "    stretch: Normal",
                        "    weight: 700",
                        "  Font: DejaVu-Sans-Mono",
                        "    family: DejaVu Sans Mono",
                        "    style: Normal",
                        "    stretch: Normal",
                        "    weight: 400",
                        "  Font: Arial",
                        "    family: Arial",
                        "    style: Normal",
                        "    stretch: Normal",
                        "    weight: 400",
                        "  Font: Helvetica",
                        "    family: Helvetica",
                        "    style: Normal",
                        "    stretch: Normal",
                        "    weight: 400",
                        "  Font: Liberation-Sans",
                        "    family: Liberation Sans",
                        "    style: Normal",
                        "    stretch: Normal",
                        "    weight: 400",
                        ""
                    ].join("\n"),
                    stderr: ""
                };
            }
            if (listType === "format") {
                return {
                    exitCode: 0,
                    stdout: [
                        "   Format  Module    Mode  Description",
                        "-------------------------------------------------------------------------------",
                        "      BMP* BMP       rw-   Microsoft Windows bitmap image",
                        "      GIF* GIF       rw+   CompuServe graphics interchange format",
                        "     JPEG* JPEG      rw-   Joint Photographic Experts Group JFIF format",
                        "      JPG* JPEG      rw-   Joint Photographic Experts Group JFIF format",
                        "      PNG* PNG       rw-   Portable Network Graphics",
                        "      PPM* PNM       rw+   Portable pixmap format (color)",
                        "      SVG* SVG       r--   Scalable Vector Graphics",
                        "     TIFF* TIFF      rw+   Tagged Image File Format",
                        "     WEBP* WEBP      rw-   WebP Image Format",
                        ""
                    ].join("\n"),
                    stderr: ""
                };
            }
            if (listType === "color") {
                return {
                    exitCode: 0,
                    stdout: [
                        "Name                  Color                   Compliance",
                        "-------------------------------------------------------------------------------",
                        "black                 srgb(0,0,0)             SVG, X11, XPM",
                        "white                 srgb(255,255,255)       SVG, X11, XPM",
                        "red                   srgb(255,0,0)           SVG, X11, XPM",
                        "green                 srgb(0,128,0)           SVG",
                        "blue                  srgb(0,0,255)           SVG, X11, XPM",
                        "transparent           srgba(0,0,0,0)          SVG, X11, XPM",
                        ""
                    ].join("\n"),
                    stderr: ""
                };
            }
            if (listType === "configure") {
                return {
                    exitCode: 0,
                    stdout: [
                        "Name                  Value",
                        "-------------------------------------------------------------------------------",
                        "DELEGATES             png jpeg webp tiff gif svg freetype",
                        "FEATURES              Cipher DPC",
                        "NAME                  ImageMagick",
                        "VERSION               7.1.1",
                        ""
                    ].join("\n"),
                    stderr: ""
                };
            }
            return {
                exitCode: 0,
                stdout: "color\nconfigure\ndelegate\nfont\nformat\nlocale\nlog\nmagic\nmodule\nresource\nthreshold\ntype\n",
                stderr: ""
            };
        }
    }
    return undefined;
}

type IdentifyStep=void|{run():Promise<void>};
async function drainIdentifySteps<T>(steps:Generator<IdentifyStep,T,void>,signal?:AbortSignal):Promise<T>{
 try{let next=steps.next();while(!next.done){try{if(next.value)await next.value.run();else await yieldTurn(signal);next=steps.next();}catch(error){next=steps.throw(error);}}return next.value;}
 finally{steps.return(undefined as T);}
}

async function writeIdentifyText(sink: ByteSink, text: string, signal?: AbortSignal): Promise<void> {
    const encoder = new TextEncoder();
    for (let offset = 0; offset < text.length;) {
        const bytes = new Uint8Array(4096);
        // One extra UTF-16 code unit keeps a surrogate pair intact at the slice boundary.
        const { read, written } = encoder.encodeInto(text.slice(offset, offset + 4097), bytes);
        await writeBytes(sink, bytes.subarray(0, written), signal);
        offset += read;
    }
}
function* runIdentifyCliSteps(argv: readonly string[], files: Map<string, Uint8Array>, stdinBytes?: Uint8Array, signal?: AbortSignal, reader?:IdentifyFileReader, output?:Pick<IdentifyFileInput,"stdout"|"stderr">): Generator<IdentifyStep, ImageMagickCliResult, void> {
    const listRes = tryHandleMagickListOption(argv);
    if (listRes) return listRes;
    let cooperativeWork = 63;
    let verbose = false;
    let customFormat: string | undefined;
    const targets: string[] = [];
    for (let i = 0; i < argv.length; i++) {
        if (++cooperativeWork % 64 === 0)
            yield;
        const a = argv[i]!;
        if (a === "--help" || a === "-help" || a === "-h") {
            return {
                exitCode: 0,
                stdout: "Usage: identify [-ping] [-verbose] [-format FORMAT] file...\n",
                stderr: ""
            };
        }
        if (a === "--version" || a === "-version") {
            return {
                exitCode: 0,
                stdout: "Version: ImageMagick 7.1.1-safe-bash (@poe-code/image-ast)\n",
                stderr: ""
            };
        }
        if (a === "-verbose" || a === "--verbose") {
            verbose = true;
        }
        else if (a === "-ping" || a === "--ping") {
            // Metadata-first reading
        }
        else if (a === "-format" || a === "--format") {
            customFormat = argv[++i] ?? "";
        }
        else if (a === "-" || !a.startsWith("-")) {
            targets.push(a);
        }
    }
    if (targets.length === 0) {
        return {
            exitCode: 1,
            stdout: "",
            stderr: "identify: missing an image filename\n"
        };
    }
    const outParts: string[] = [];
    const errParts: string[] = [];
    const flush = function* (): Generator<IdentifyStep, void, void> {
        for (const [sink, parts] of [[output?.stdout, outParts], [output?.stderr, errParts]] as const) {
            if (!sink) continue;
            for (const text of parts) yield { async run() { await writeIdentifyText(sink, text, signal); } };
            parts.length = 0;
        }
    };
    let exitCode = 0;
    for (const inPath of targets) {
        yield;
        const bracketMatch = /^(.*)\[(\d+)\]$/.exec(inPath);
        let baseInPath = bracketMatch ? bracketMatch[1]! : inPath;
        const colon = baseInPath.indexOf(":");
        if (colon > 0 && extToImageFormat(baseInPath.slice(0, colon))) {
            baseInPath = baseInPath.slice(colon + 1);
        }
        const pageIdx = bracketMatch ? parseInt(bracketMatch[2]!, 10) : undefined;
        let inspected:IdentifyInspection|undefined;
        if(reader)yield {async run(){inspected=await reader(baseInPath,pageIdx,verbose,customFormat===undefined?undefined:(metadata,size,pixels)=>formatRetainedIdentify(customFormat!,metadata,{filePath:baseInPath,byteLen:size,sceneIdx:pageIdx??0},pixels,signal));}};
        const bytes = baseInPath === "-" ? stdinBytes : files.get(inPath) ?? files.get(baseInPath);
        if (!bytes&&!inspected) {
            errParts.push(`identify: unable to open image '${inPath}': No such file or directory\n`);
            exitCode = 1;
            yield* flush();
            continue;
        }
        try {
            const inputOptions = pageIdx !== undefined ? { page: pageIdx } : undefined;
            if(inspected&&"error" in inspected)throw inspected.error;
            const meta = inspected?.metadata??readImageMetadata(bytes!, inputOptions),size=inspected?.size??bytes!.byteLength;
            const encoded=inspected?.bytes??bytes;
            const bitDepth = meta.depth === "ushort" ? "16" : meta.depth === "bit" ? "1" : "8";
            const spaceLabel = meta.space === "b-w" ? "Gray" : meta.space === "cmyk" ? "CMYK" : "sRGB";
            if (customFormat !== undefined) {
                outParts.push(inspected?.formatted??(yield* formatMagickPropertyStringSteps(customFormat, meta, () => decodeImage(encoded!, inputOptions), {
                    filePath: baseInPath, byteLen: size, sceneIdx: pageIdx ?? 0
                })));
            }
            else if (verbose) {
                const stats = inspected?.stats??(yield* computeImageStatsSteps(decodeImage(encoded!, inputOptions)));
                outParts.push(`Image: ${inPath}\n` +
                    `  Format: ${meta.format.toUpperCase()}\n` +
                    `  Geometry: ${meta.width}x${meta.height}+0+0\n` +
                    `  Resolution: ${meta.density}x${meta.density}\n` +
                    `  Colorspace: ${spaceLabel}\n` +
                    `  Depth: ${bitDepth}-bit\n` +
                    `  Channels: ${meta.channels}\n` +
                    `  Alpha: ${meta.hasAlpha ? "True" : "False"}\n` +
                    `  Filesize: ${size}B\n` +
                    `  Entropy: ${stats.entropy.toFixed(4)}\n`);
            }
            else {
                outParts.push(`${inPath} ${meta.format.toUpperCase()} ${meta.width}x${meta.height} ${meta.width}x${meta.height}+0+0 ${bitDepth}-bit ${spaceLabel} ${size}B 0.000u 0:00.000\n`);
            }
        }
        catch (err) {
            errParts.push(`identify: improper image header '${inPath}': ${(err as Error).message}\n`);
            exitCode = 1;
        }
        yield* flush();
    }
    return {
        exitCode,
        stdout: outParts.join(""),
        stderr: errParts.join("")
    };
}
export async function runIdentifyCli(argv: readonly string[], files: Map<string, Uint8Array>|IdentifyFileInput, stdinBytes?: Uint8Array, signal?: AbortSignal): Promise<ImageMagickCliResult> {
    if(files instanceof Map)return drainIdentifySteps(runIdentifyCliSteps(argv,files,stdinBytes,signal),signal);
    const active=signal??new AbortController().signal;
    const result = await withIdentifyFiles(files,stdinBytes,active,reader=>drainIdentifySteps(runIdentifyCliSteps(argv,new Map(),stdinBytes,active,reader,files),active));
    for (const channel of ["stdout", "stderr"] as const) {
        if (files[channel]) await writeIdentifyText(files[channel]!, result[channel], active);
    }
    return { ...result, stdout: files.stdout ? "" : result.stdout, stderr: files.stderr ? "" : result.stderr };
}
export function runIdentifyCliSync(argv: readonly string[], files: Map<string, Uint8Array>, stdinBytes?: Uint8Array, signal?: AbortSignal): ImageMagickCliResult {
    const steps = runIdentifyCliSteps(argv, files, stdinBytes, signal);
    let next = steps.next();
    while (!next.done) {
        next = steps.next();
    }
    return next.value;
}

function* parseMagickIndexSpec(spec: string, length: number): Generator<number> {
  if (length <= 0) return;
  const resolve = (n: number): number =>
    n < 0 ? Math.max(0, length + n) : Math.min(Math.max(0, n), length - 1);
  for (const part of spec.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const separator = trimmed.indexOf("-", 1);
    const integer = (value: string) => { const digits = value.startsWith("-") ? value.slice(1) : value; return digits.length > 0 && Array.from(digits).every(c => c >= "0" && c <= "9"); };
    const rangeMatch = separator > 0 && integer(trimmed.slice(0, separator)) && integer(trimmed.slice(separator + 1)) ? [trimmed, trimmed.slice(0, separator), trimmed.slice(separator + 1)] : undefined;
    if (rangeMatch) {
      const s = resolve(parseInt(rangeMatch[1]!, 10));
      const e = resolve(parseInt(rangeMatch[2]!, 10));
      if (s <= e) {
        for (let k = s; k <= e; k++) yield k;
      } else {
        for (let k = s; k >= e; k--) yield k;
      }
    } else {
      const num = parseInt(trimmed, 10);
      if (!Number.isNaN(num)) {
        const idx = num < 0 ? length + num : num;
        if (idx >= 0 && idx < length) yield idx;
      }
    }
  }
}

type MagickHistogram = Float64Array[];
type MagickAnalysisOperation = { end: number; lookup(histogram: MagickHistogram, image: Pick<RgbaImage, "width" | "height" | "hasAlpha">): Uint8Array[] };
function* accumulateMagickHistogram(data: Uint8Array, histogram: MagickHistogram): Generator<void, void, void> {
    for (let i = 0; i < data.length; i += 4) {
        if (i && i % 65536 === 0) yield;
        for (let channel = 0; channel < 4; channel++) histogram[channel]![data[i + channel]!]!++;
    }
}
function* applyMagickLookup(image: RgbaImage, lookup: Uint8Array[]): Generator<void, RgbaImage, void> {
    const data = new Uint8Array(image.data);
    for (let i = 0; i < data.length; i += 4) {
        if (i && i % 65536 === 0) yield;
        for (let channel = 0; channel < 4; channel++) data[i + channel] = lookup[channel]![data[i + channel]!]!;
    }
    return { ...image, data };
}
function parseMagickAnalysisOperation(tokens: readonly string[], state: MagickState, start: number): MagickAnalysisOperation | undefined {
    const token = tokens[start];
    if (!["-auto-level", "-auto-gamma", "-normalize", "-contrast-stretch", "-linear-stretch", "-equalize"].includes(token ?? "")) return;
    let end = start;
    const argument = token === "-normalize" ? "2%x1%" : token === "-contrast-stretch" || token === "-linear-stretch" ? tokens[++end] ?? "0%x0%" : "";
    const independent = state.channelExplicit, channels = independent ? state.channels : { r: true, g: true, b: true, a: false };
    return { end, lookup(histogram, image) {
        const lookup = Array.from({ length: 4 }, () => Uint8Array.from({ length: 256 }, (_, value) => value));
        const count = Math.max(1, image.width * image.height);
        if (token === "-auto-gamma") {
            const channelCount = image.hasAlpha ? 4 : 3;
            let sum = 0;
            for (let channel = 0; channel < channelCount; channel++) for (let value = 0; value < 256; value++) sum += histogram[channel]![value]! * value;
            const mean = sum / Math.max(1, image.width * image.height * channelCount * 255);
            if (mean > 0 && mean < 1) {
                const exponent = Math.log(0.5) / Math.log(mean);
                for (let channel = 0; channel < channelCount; channel++) for (let value = 0; value < 256; value++) lookup[channel]![value] = clampByteVal(Math.pow(value / 255, exponent) * 255);
            }
        } else if (token === "-auto-level") {
            const mins = [255, 255, 255, 255], maxs = [0, 0, 0, 0], active = [channels.r, channels.g, channels.b, channels.a];
            for (let channel = 0; channel < 4; channel++) for (let value = 0; value < 256; value++) if (histogram[channel]![value]! > 0) { mins[channel] = Math.min(mins[channel]!, value); maxs[channel] = Math.max(maxs[channel]!, value); }
            if (!independent) { const low = Math.min(mins[0]!, mins[1]!, mins[2]!), high = Math.max(maxs[0]!, maxs[1]!, maxs[2]!); mins[0] = mins[1] = mins[2] = low; maxs[0] = maxs[1] = maxs[2] = high; }
            for (let channel = 0; channel < 4; channel++) {
                const range = maxs[channel]! - mins[channel]!;
                if (active[channel] && range > 0) for (let value = 0; value < 256; value++) lookup[channel]![value] = clampByteVal((value - mins[channel]!) / range * 255);
            }
        } else if (token === "-equalize") {
            for (let channel = 0; channel < 3; channel++) {
                let cumulative = 0, first = 0;
                for (let value = 0; value < 256; value++) {
                    cumulative += histogram[channel]![value]!;
                    if (first === 0 && cumulative > 0) first = cumulative;
                    lookup[channel]![value] = clampByteVal((cumulative - first) / Math.max(1, count - first) * 255);
                }
            }
        } else {
            const [black, white] = argument.split("x"), percentage = argument.includes("%"), blackValue = parseFloat(black || "0") || 0, whiteValue = white !== undefined ? parseFloat(white) || 0 : blackValue;
            const lowTarget = percentage ? blackValue / 100 * count : blackValue, highTarget = percentage ? (100 - whiteValue) / 100 * count : count - whiteValue;
            for (let channel = 0; channel < 3; channel++) {
                let low = 0, high = 255, sum = 0;
                for (let value = 0; value < 256; value++) { sum += histogram[channel]![value]!; if (sum > lowTarget) { low = value; break; } }
                sum = 0;
                for (let value = 0; value < 256; value++) { sum += histogram[channel]![value]!; if (sum >= highTarget) { high = value; break; } }
                if (high > low) for (let value = 0; value < 256; value++) lookup[channel]![value] = clampByteVal((value - low) / (high - low) * 255);
            }
        }
        return lookup;
    } };
}

type MagickPixelOperation = { end: number; apply(image: RgbaImage): Generator<void, RgbaImage, void> };
function parseMagickPixelOperation(tokens: readonly string[], settings: MagickState, start: number, signal?: AbortSignal): MagickPixelOperation | undefined {
    const state = { ...settings }, token = tokens[start];
    let i = start, apply: MagickPixelOperation["apply"];
    if (token === "-alpha") {
        const mode = (tokens[++i] ?? "on").toLowerCase();
        if (mode === "remove") {
            apply = function* (im) {
                return (yield* removeAlphaImageSteps((yield* flattenImageSteps(im, state.background))));
            };
        }
        else if (mode === "off" || mode === "deactivate" || mode === "opaque") {
            apply = function* (im) {
                let pixelWork = 0;
                const out = new Uint8Array(im.data);
                for (let idx = 3; idx < out.length; idx += 4) {
                    if (++pixelWork % 16384 === 0)
                        yield;
                    out[idx] = 255;
                }
                return { ...im, data: out, hasAlpha: mode === "opaque" };
            };
        }
        else if (mode === "transparent") {
            apply = function* (im) {
                let pixelWork = 0;
                const out = new Uint8Array(im.data);
                for (let idx = 3; idx < out.length; idx += 4) {
                    if (++pixelWork % 16384 === 0)
                        yield;
                    out[idx] = 0;
                }
                return { ...im, data: out, hasAlpha: true };
            };
        }
        else if (mode === "copy" || mode === "shape") {
            apply = function* (im) {
                let pixelWork = 0;
                const out = new Uint8Array(im.data);
                for (let idx = 0; idx < out.length; idx += 4) {
                    if (++pixelWork % 16384 === 0)
                        yield;
                    const inten = clampByteVal(0.212656 * out[idx]! + 0.715158 * out[idx + 1]! + 0.072186 * out[idx + 2]!);
                    if (mode === "shape") {
                        out[idx] = state.background.r;
                        out[idx + 1] = state.background.g;
                        out[idx + 2] = state.background.b;
                    }
                    out[idx + 3] = inten;
                }
                return { ...im, data: out, hasAlpha: true };
            };
        }
        else if (mode === "on" || mode === "set" || mode === "activate") {
            apply = function* (im) {
                return (yield* ensureAlphaImageSteps(im, 1));
            };
        }
        else if (mode === "extract") {
            apply = function* (im) {
                return (yield* extractChannelImageSteps((yield* ensureAlphaImageSteps(im, 1)), 3));
            };
        }
        else { apply = function* (im) { yield; return im; }; }
    } else if (token === "-color-matrix" || token === "-recolor") {
        const matrix = tokens[++i] ?? "1,0,0 0,1,0 0,0,1";
        apply = image => applyMagickColorMatrixSteps(image, matrix, signal);
    } else if (token === "-opaque" || token === "+opaque") {
        const target = parseColor(tokens[++i] ?? "#000000");
        apply = image => applyMagickOpaqueSteps(image, target, state.fill, state.fuzz, token === "+opaque", signal);
    } else if (token === "-transparent" || token === "+transparent") {
        const target = parseColor(tokens[++i] ?? "#ffffff");
        apply = image => applyMagickTransparentSteps(image, target, state.fuzz, token === "+transparent", signal);
    } else if (token === "-evaluate") {
        const operation = tokens[++i] ?? "Add", value = tokens[++i] ?? "0";
        apply = image => applyMagickEvaluateSteps(image, operation, value, state.channels, signal);
    } else if (token === "-function") {
        const operation = tokens[++i] ?? "Polynomial", value = tokens[++i] ?? "1,0";
        apply = image => applyMagickFunctionSteps(image, operation, value, state.channels, signal);
    } else if (token === "-sepia-tone" || token === "-solarize") {
        const value = tokens[++i] ?? (token === "-sepia-tone" ? "80%" : "50%");
        apply = image => token === "-sepia-tone" ? applyMagickSepiaToneSteps(image, value, signal) : applyMagickSolarizeSteps(image, value, signal);
    } else if (token === "-posterize" || token === "-colors") {
        const levels = Number(tokens[++i] ?? 8);
        apply = image => applyMagickPosterizeSteps(image, levels, signal);
    } else if (token === "-monochrome") {
        apply = function* (image) { return yield* thresholdImageSteps(yield* grayscaleImageSteps(image), 128, true); };
    } else if (token === "-modulate") {
        const parts = (tokens[++i] ?? "100,100,100").split(",").map(Number);
        const options = { brightness: (parts[0] ?? 100) / 100, saturation: (parts[1] ?? 100) / 100, hue: ((parts[2] ?? 100) - 100) * 1.8, lightness: 0 };
        apply = image => modulateImageSteps(image, options);
    } else if (token === "-brightness-contrast") {
        const geometry = parseMagickGeometry(tokens[++i] ?? "0x0"), slope = 1 + (geometry.height ?? 0) / 100, offset = (geometry.width ?? 0) / 100 * 255;
        apply = image => linearImageSteps(image, [slope], [offset]);
    } else if (token === "-threshold") {
        const raw = tokens[++i] ?? "50%", value = Math.round(raw.endsWith("%") ? parseFloat(raw) / 100 * 255 : parseFloat(raw));
        apply = image => thresholdImageSteps(image, value, true);
    } else if (token === "-tint" || token === "-colorize") {
        i++;
        apply = image => tintImageSteps(image, state.fill);
    }
    else if (token === "-negate" || token === "+negate") {
        const onlyGray = token === "+negate";
        const ch = state.channelExplicit ? state.channels : { r: true, g: true, b: true, a: false };
        apply = function* (im) {
            let pixelWork = 0;
            const out = new Uint8Array(im.data);
            for (let idx = 0; idx < out.length; idx += 4) {
                if (++pixelWork % 16384 === 0)
                    yield;
                const r = out[idx]!;
                const g = out[idx + 1]!;
                const b = out[idx + 2]!;
                if (onlyGray && !(r === g && g === b))
                    continue;
                if (ch.r)
                    out[idx] = 255 - r;
                if (ch.g)
                    out[idx + 1] = 255 - g;
                if (ch.b)
                    out[idx + 2] = 255 - b;
                if (ch.a)
                    out[idx + 3] = 255 - out[idx + 3]!;
            }
            return { ...im, data: out };
        };
    }
    else if (token === "-contrast" || token === "+contrast") {
        const slope = token === "-contrast" ? 1.15 : 0.87;
        const offset = 128 * (1 - slope);
        apply = image => linearImageSteps(image, [slope], [offset]);
    }
    else if (token === "-sigmoidal-contrast" || token === "+sigmoidal-contrast") {
        const raw = tokens[++i] ?? "3x50%";
        const [cStr, mStr] = raw.split("x");
        const beta = Math.max(1e-4, parseFloat(cStr || "3"));
        const mRaw = parseFloat(mStr || "50");
        const alpha = (mStr ?? "50%").endsWith("%") ? mRaw / 100 : mRaw / 255;
        const sig = (u: number) => 1 / (1 + Math.exp(beta * (alpha - u)));
        const s0 = sig(0);
        const s1 = sig(1);
        const span = Math.max(1e-6, s1 - s0);
        apply = function* (im) {
            let pixelWork = 0;
            const out = new Uint8Array(im.data);
            for (let idx = 0; idx < out.length; idx += 4) {
                if (++pixelWork % 16384 === 0)
                    yield;
                for (let c = 0; c < 3; c++) {
                    if (++pixelWork % 16384 === 0)
                        yield;
                    const u = out[idx + c]! / 255;
                    out[idx + c] = clampByteVal(((sig(u) - s0) / span) * 255);
                }
            }
            return { ...im, data: out };
        };
    }
    else if (token === "-level" || token === "+level") {
        const raw = tokens[++i] ?? "0,100%";
        const parts = raw.split(",");
        const anyPct = raw.includes("%");
        const parsePt = (p: string | undefined, def: number) => {
            if (!p || p.length === 0)
                return def;
            if (p.endsWith("%") || anyPct) {
                return (parseFloat(p) / 100) * 255;
            }
            return parseFloat(p);
        };
        const black = parsePt(parts[0], 0);
        const white = parsePt(parts[1], 255);
        const gamma = parts[2] !== undefined ? Math.max(0.01, parseFloat(parts[2])) : 1.0;
        const inverse = token === "+level";
        apply = function* (im) {
            let pixelWork = 0;
            const out = new Uint8Array(im.data);
            const span = Math.max(1e-6, white - black);
            for (let idx = 0; idx < out.length; idx += 4) {
                if (++pixelWork % 16384 === 0)
                    yield;
                for (let c = 0; c < 3; c++) {
                    if (++pixelWork % 16384 === 0)
                        yield;
                    const v = out[idx + c]!;
                    if (inverse) {
                        const gVal = Math.pow(Math.max(0, Math.min(1, v / 255)), 1 / gamma);
                        out[idx + c] = clampByteVal(black + gVal * span);
                    }
                    else {
                        const norm = Math.max(0, Math.min(1, (v - black) / span));
                        out[idx + c] = clampByteVal(Math.pow(norm, 1 / gamma) * 255);
                    }
                }
            }
            return { ...im, data: out };
        };
    }
    else if (token === "-black-threshold" || token === "-white-threshold") {
        const raw = tokens[++i] ?? "50%";
        const thresh = raw.endsWith("%") ? (parseFloat(raw) / 100) * 255 : parseFloat(raw);
        const isBlack = token === "-black-threshold";
        apply = function* (im) {
            let pixelWork = 0;
            const out = new Uint8Array(im.data);
            for (let idx = 0; idx < out.length; idx += 4) {
                if (++pixelWork % 16384 === 0)
                    yield;
                const intensity = 0.212656 * out[idx]! + 0.715158 * out[idx + 1]! + 0.072186 * out[idx + 2]!;
                if (isBlack && intensity <= thresh) {
                    out[idx] = 0;
                    out[idx + 1] = 0;
                    out[idx + 2] = 0;
                }
                else if (!isBlack && intensity > thresh) {
                    out[idx] = 255;
                    out[idx + 1] = 255;
                    out[idx + 2] = 255;
                }
            }
            return { ...im, data: out };
        };
    }
    else return;
    return { end: i, apply };
}

async function transformStoredMagickPixels(image: StoredRgbaImage, backend: CompareFileSession, operation: MagickPixelOperation, signal: AbortSignal): Promise<StoredRgbaImage> {
    const size = image.width * image.height * 4, position = backend.storage.allocate(size);
    let result = image;
    for (let offset = 0; offset < size; offset += 16384) {
        if (offset % 1048576 === 0) await yieldTurn(signal);
        const data = await backend.storage.read(image.position + offset, Math.min(16384, size - offset));
        const transformed = await drainSteps(operation.apply({ ...image, width: data.length / 4, height: 1, data }), signal);
        const { data: pixels, data16: ignored, ...metadata } = transformed;
        await backend.storage.write(position + offset, pixels);
        result = { ...metadata, width: image.width, height: image.height, position };
    }
    return result;
}

function applyMagickReadSetting(tokens: readonly string[], state: MagickState, start: number): number | undefined {
    let i = start;
    const t = tokens[i];
if (t === "-channel") {
            state.channels = parseChannelMask(tokens[++i] ?? "rgb");
            state.channelExplicit = true;
        }
        else if (t === "+channel") {
            state.channels = { r: true, g: true, b: true, a: false };
            state.channelExplicit = false;
        }
        else if (t === "-size") {
            const g = parseMagickGeometry(tokens[++i] ?? "1x1");
            state.sizeWidth = Math.max(1, Math.round(g.width ?? 1));
            state.sizeHeight = Math.max(1, Math.round(g.height ?? state.sizeWidth));
            state.hasSize = true;
        }
        else if (t === "+size") {
            state.hasSize = false;
        }
        else if (t === "-background") {
            state.background = parseColor(tokens[++i] ?? "#ffffff");
        }
        else if (t === "-fill") {
            state.fill = parseColor(tokens[++i] ?? "#000000");
        }
        else if (t === "-stroke") {
            state.stroke = parseColor(tokens[++i] ?? "#000000");
        }
        else if (t === "-strokewidth") {
            state.strokeWidth = Math.max(0, Number(tokens[++i] ?? 1));
        }
        else if (t === "-bordercolor") {
            state.borderColor = parseColor(tokens[++i] ?? "#dfdfdf");
        }
        else if (t === "-pointsize") {
            state.pointsize = Math.max(1, Number(tokens[++i] ?? 12));
        }
        else if (t === "-gravity") {
            state.gravity = parseGravity(tokens[++i] ?? "center");
        }
        else if (t === "+gravity") {
            state.gravity = "northwest";
        }
        else if (t === "-quality") {
            state.quality = Math.max(1, Math.min(100, Number(tokens[++i] ?? 92)));
        }
        else if (t === "-density") {
            const g = parseMagickGeometry(tokens[++i] ?? "72");
            state.density = Math.max(1, Math.round(g.width ?? 72));
        }
        else if (t === "-fuzz") {
            const rawFuzz = tokens[++i] ?? "10";
            state.fuzz = rawFuzz.endsWith("%")
                ? Math.round((parseFloat(rawFuzz) / 100) * 255)
                : Math.round(parseFloat(rawFuzz));
        }
        else if (t === "-filter") {
            state.kernel = parseKernel(tokens[++i] ?? "lanczos");
        }
        else if (t === "-compose") {
            const cRaw = tokens[++i] ?? "over";
            state.composeRaw = cRaw;
            state.compose = parseCompose(cRaw);
        }
        else if (t === "-define") {
            const defStr = tokens[++i] ?? "";
            const m = /^compose:args=(.*)$/i.exec(defStr);
            if (m)
                state.composeArgs = m[1]!;
        }
        else if (t === "-set") {
            const k = (tokens[++i] ?? "").toLowerCase();
            const v = tokens[++i] ?? "";
            if (k === "option:compose:args")
                state.composeArgs = v;
        } else return undefined;
    return i;
}

function* evaluatePipelineTokensSteps(tokens: readonly string[], files: Map<string, Uint8Array>, state: MagickState, parentStack: RgbaImage[] = [], stdinBytes?: Uint8Array, signal?: AbortSignal): Generator<void, RgbaImage[], void> {
    let cooperativeWork = 63;
    let stack: RgbaImage[] = [];
    let operandsOnly = false;
    let i = 0;
    while (i < tokens.length) {
        yield;
        const t = tokens[i]!;
        if (!operandsOnly && t === "--") { operandsOnly = true; i++; continue; }
        if (operandsOnly) {
            const loaded = yield* parseInputOperandsSteps(t, files, state, stdinBytes);
            if (loaded) stack.push(...loaded);
            i++;
            continue;
        }
        if (t === "(") {
            let depth = 1;
            let j = i + 1;
            while (j < tokens.length && depth > 0) {
                if (++cooperativeWork % 65536 === 0)
                    yield;
                if (tokens[j] === "(")
                    depth++;
                else if (tokens[j] === ")")
                    depth--;
                j++;
            }
            const endIdx = depth === 0 ? j - 1 : j;
            const subTokens = tokens.slice(i + 1, endIdx);
            const subState: MagickState = { ...state };
            const subResult = (yield* evaluatePipelineTokensSteps(subTokens, files, subState, stack, stdinBytes, signal));
            stack.push(...subResult);
            i = j;
            continue;
        }
        const setting = applyMagickReadSetting(tokens, state, i);
        const pixelOperation = setting === undefined ? parseMagickPixelOperation(tokens, state, i, signal) : undefined;
        const warpOperation = setting === undefined ? parseMagickWarpOperation(tokens, state, i) : undefined;
        const analysisOperation = setting === undefined && !pixelOperation ? parseMagickAnalysisOperation(tokens, state, i) : undefined;
        if (setting !== undefined) { i = setting; }
        else if (analysisOperation) {
            i = analysisOperation.end;
            stack = yield* mapSteps(stack, function* (image) {
                const histogram = Array.from({ length: 4 }, () => new Float64Array(256));
                yield* accumulateMagickHistogram(image.data, histogram);
                return yield* applyMagickLookup(image, analysisOperation.lookup(histogram, image));
            });
        }
        else if (pixelOperation) { i = pixelOperation.end; stack = yield* mapSteps(stack, pixelOperation.apply); }
        else if (warpOperation) {
            i = warpOperation.end;
            stack = yield* mapSteps(stack, function* (image) {
                const plan = warpOperation.plan(image);
                return plan ? yield* applyMagickRasterSteps(image, warpPixelSteps(image, plan, warpOperation.background), signal, plan) : image;
            });
        }
        else if (t === "-write" || t === "+write") {
            const writePath = tokens[++i] ?? "";
            if (stack.length > 0 && writePath && writePath.toLowerCase() !== "null:") {
                const top = stack[stack.length - 1]!;
                const { format, path } = inferOutputFormat(writePath, top.format);
                if (stack.length > 1 && (/%0?\d*d/.test(path) || !state.adjoin)) {
                    for (let idx = 0; idx < stack.length; idx++) {
                        if (++cooperativeWork % 65536 === 0)
                            yield;
                        const framePath = formatSceneOutputPath(path, idx);
                        const { data: frameBytes } = encodeImage(stack[idx]!, { format, quality: state.quality });
                        files.set(framePath, frameBytes);
                    }
                }
                else {
                    const { data: encoded } = encodeImage(top, { format, quality: state.quality });
                    files.set(path, encoded);
                }
            }
        }
        else if (t === "-geometry") {
            state.geometry = tokens[++i] ?? "+0+0";
        }
        else if (t === "-tile") {
            state.tile = tokens[++i];
        }
        else if (t === "-strip") {
            state.strip = true;
        }
        else if (t === "-format") {
            state.formatStr = tokens[++i] ?? "";
        }
        else if (t === "+adjoin") {
            state.adjoin = false;
        }
        else if (t === "-adjoin") {
            state.adjoin = true;
        }
        else if (t === "-delay" || t === "-loop" || t === "-dispose") {
            i++;
        }
        else if (t === "-coalesce" || t === "-deconstruct") {
            // Coalesces frames in-place
        }
        else if (t === "-splice") {
            const geom = tokens[++i] ?? "0x0";
            stack = yield* mapSteps(stack, function* (im) {
                return (yield* applyMagickSpliceSteps(im, geom, state.background, state.gravity, signal));
            });
        }
        else if (t === "-chop") {
            const geom = tokens[++i] ?? "0x0";
            stack = yield* mapSteps(stack, function* (im) {
                return (yield* applyMagickChopSteps(im, geom, state.gravity, signal));
            });
        }
        else if (t === "-roll") {
            const geom = tokens[++i] ?? "+0+0";
            stack = yield* mapSteps(stack, function* (im) {
                return (yield* applyMagickRollSteps(im, geom, signal));
            });
        }
        else if (t === "-morph") {
            const count = Number(tokens[++i] ?? 1);
            stack = (yield* applyMagickMorphSteps(stack, count, signal));
        }
        else if (t === "-floodfill") {
            const geom = tokens[++i] ?? "+0+0";
            const nextTok = tokens[i + 1];
            let targetColor: RgbaColor | undefined;
            if (nextTok && !nextTok.startsWith("-") && !nextTok.startsWith("+") && !files.has(nextTok)) {
                try {
                    targetColor = parseColor(nextTok);
                    i++;
                }
                catch {
                    // Optional target color omitted
                }
            }
            stack = yield* mapSteps(stack, function* (im) {
                return (yield* applyMagickFloodfillSteps(im, geom, targetColor, state.fill, state.fuzz, signal));
            });
        }
        else if (t === "-evaluate-sequence") {
            const op = tokens[++i] ?? "Mean";
            if (stack.length > 0) {
                stack = [(yield* applyMagickEvaluateSequenceSteps(stack, op, signal))];
            }
        }
        else if (t === "-convolve") {
            const kSpec = tokens[++i] ?? "1";
            stack = yield* mapSteps(stack, function* (im) {
                return (yield* applyMagickCustomConvolveSteps(im, kSpec, signal));
            });
        }
        else if (t === "-remap") {
            const palSpec = tokens[++i] ?? "";
            const palImg = (yield* parseInputOperandSteps(palSpec, files, state, stdinBytes));
            if (palImg) {
                stack = yield* mapSteps(stack, function* (im) {
                    return (yield* applyMagickRemapSteps(im, palImg, state.dither, signal));
                });
            }
        }
        else if (t === "-clut" || t === "-hald-clut") {
            if (stack.length >= 2) {
                const lut = stack[stack.length - 1]!;
                const mapped = yield* mapSteps(stack.slice(0, -1), function* (im) {
                    return (yield* applyMagickClutSteps(im, lut, state.channels, signal));
                });
                stack = mapped;
            }
        }
        else if (t === "-fx") {
            const expr = tokens[++i] ?? "u";
            if (stack.length > 0) {
                const base = stack[0]!;
                stack = [yield* applyMagickRasterSteps(base, magickFxPixelSteps(stack, expr, state.channels), signal, base, stack)];
            }
        }
        else if (t === "-shadow") {
            const geom = tokens[++i] ?? "80x3+5+5";
            stack = yield* mapSteps(stack, function* (im) {
                return (yield* applyMagickShadowSteps(im, geom, state.background, signal));
            });
        }
        else if (t === "-vignette") {
            i++;
            stack = yield* mapSteps(stack, function* (im) {
                return yield* applyMagickRasterSteps(im, vignettePixelSteps(im, state.background), signal);
            });
        }
        else if (t === "-dither" || t === "+dither") {
            if (t === "+dither") {
                state.dither = false;
            }
            else {
                const dMode = (tokens[++i] ?? "floydsteinberg").toLowerCase();
                state.dither = dMode !== "none";
            }
        }
        else if (t === "-edge" || t === "-canny") {
            i++;
            stack = yield* mapSteps(stack, function* (im) {
                return (yield* applyMagickRasterSteps(im, convolvePixelSteps(im, [-1, -1, -1, -1, 8, -1, -1, -1, -1], 0), signal));
            });
        }
        else if (t === "-emboss") {
            i++;
            stack = yield* mapSteps(stack, function* (im) {
                return (yield* applyMagickRasterSteps(im, convolvePixelSteps(im, [-2, -1, 0, -1, 1, 1, 0, 1, 2], 128), signal));
            });
        }
        else if (t === "-charcoal" || t === "-sketch") {
            i++;
            stack = yield* mapSteps(stack, function* (im) {
                const blurred = yield* blurImageSteps(im, 1);
                return yield* grayscaleImageSteps(yield* negateImageSteps(yield* applyMagickRasterSteps(blurred, convolvePixelSteps(blurred, [-1, -1, -1, -1, 8, -1, -1, -1, -1], 0), signal), { alpha: false }));
            });
        }
        else if (t === "+repage" || t === "-repage") {
            if (t === "-repage")
                i++;
        }
        else if (t === "-resize" || t === "-scale" || t === "-sample" || t === "-thumbnail") {
            const geom = tokens[++i] ?? "100%";
            const k = t === "-sample" ? "nearest" : state.kernel;
            stack = (yield* mapSteps(stack, function* (im) {
                return (yield* applyMagickResizeSteps(im, geom, k));
            }));
        }
        else if (t === "-crop") {
            const geom = tokens[++i] ?? "100%";
            const nextStack: RgbaImage[] = [];
            for (const im of stack) {
                if (++cooperativeWork % 65536 === 0)
                    yield;
                nextStack.push(...(yield* applyMagickCropToStackSteps(im, geom, state.gravity)));
            }
            stack = nextStack;
        }
        else if (t === "-extent") {
            const geom = tokens[++i] ?? "100%";
            stack = yield* mapSteps(stack, function* (im) {
                return (yield* applyMagickExtentSteps(im, geom, state, signal));
            });
        }
        else if (t === "-border") {
            const g = parseMagickGeometry(tokens[++i] ?? "0x0");
            const bw = Math.max(0, Math.round(g.width ?? 0));
            const bh = Math.max(0, Math.round(g.height ?? bw));
            stack = (yield* mapSteps(stack, function* (im) {
                return (yield* extendImageSteps(im, {
                    top: bh,
                    bottom: bh,
                    left: bw,
                    right: bw,
                    background: state.borderColor,
                    extendWith: "background"
                }));
            }));
        }
        else if (t === "-shave") {
            const g = parseMagickGeometry(tokens[++i] ?? "0x0");
            const sw = Math.max(0, Math.round(g.width ?? 0));
            const sh = Math.max(0, Math.round(g.height ?? sw));
            stack = (yield* mapSteps(stack, function* (im) {
                const clampedSw = Math.min(Math.floor((im.width - 1) / 2), sw);
                const clampedSh = Math.min(Math.floor((im.height - 1) / 2), sh);
                return (yield* extractImageSteps(im, {
                    left: clampedSw,
                    top: clampedSh,
                    width: Math.max(1, im.width - clampedSw * 2),
                    height: Math.max(1, im.height - clampedSh * 2)
                }));
            }));
        }
        else if (t === "-trim") {
            stack = (yield* mapSteps(stack, function* (im) {
                return (yield* trimImageSteps(im, { threshold: state.fuzz }));
            }));
        }
        else if (t === "-rotate") {
            const deg = Number(tokens[++i] ?? 0);
            stack = (yield* mapSteps(stack, function* (im) {
                return (yield* rotateImageSteps(im, deg, state.background));
            }));
        }
        else if (t === "-flip") {
            stack = (yield* mapSteps(stack, function* (im) {
                return (yield* flipImageSteps(im));
            }));
        }
        else if (t === "-flop") {
            stack = (yield* mapSteps(stack, function* (im) {
                return (yield* flopImageSteps(im));
            }));
        }
        else if (t === "-transpose") {
            stack = (yield* mapSteps(stack, function* (im) {
                return (yield* rotateImageSteps((yield* flipImageSteps(im)), 90, state.background));
            }));
        }
        else if (t === "-transverse") {
            stack = (yield* mapSteps(stack, function* (im) {
                return (yield* rotateImageSteps((yield* flopImageSteps(im)), 90, state.background));
            }));
        }
        else if (t === "-auto-orient") {
            stack = (yield* mapSteps(stack, function* (im) {
                return (yield* applyExifOrientationSteps(im));
            }));
        }
        else if (t === "-colorspace" || t === "-grayscale") {
            const cs = (tokens[++i] ?? "gray").toLowerCase();
            if (cs.includes("gray") || cs.includes("grey") || cs === "rec709luma" || cs === "rec601luma") {
                stack = (yield* mapSteps(stack, function* (im) {
                    return (yield* grayscaleImageSteps(im));
                }));
            }
        }
        else if (t === "-gamma") {
            const gammaVal = Math.max(0.1, Number(tokens[++i] ?? 1.0));
            stack = (yield* mapSteps(stack, function* (im) {
                return (yield* gammaImageSteps(im, gammaVal, gammaVal));
            }));
        }
        else if (t === "-raise" || t === "+raise") {
            const g = parseMagickGeometry(tokens[++i] ?? "4");
            const bw = Math.max(1, Math.round(g.width ?? 4));
            const raised = t === "-raise";
            stack = (yield* mapSteps(stack, function* (im) {
                let pixelWork = 0;
                const out = new Uint8Array(im.data);
                for (let y = 0; y < im.height; y++) {
                    if (++pixelWork % 16384 === 0)
                        yield;
                    for (let x = 0; x < im.width; x++) {
                        if (++pixelWork % 16384 === 0)
                            yield;
                        const topLeft = y < bw || x < bw;
                        const botRight = y >= im.height - bw || x >= im.width - bw;
                        if (!topLeft && !botRight)
                            continue;
                        const lighten = raised ? topLeft : botRight;
                        const idx = (y * im.width + x) * 4;
                        for (let c = 0; c < 3; c++) {
                            if (++pixelWork % 16384 === 0)
                                yield;
                            out[idx + c] = clampByteVal(lighten ? out[idx + c]! + 40 : out[idx + c]! - 40);
                        }
                    }
                }
                return { ...im, data: out };
            }));
        }
        else if (t === "-frame") {
            const g = parseMagickGeometry(tokens[++i] ?? "4x4");
            const fw = Math.max(0, Math.round(g.width ?? 4));
            const fh = Math.max(0, Math.round(g.height ?? fw));
            stack = (yield* mapSteps(stack, function* (im) {
                return (yield* extendImageSteps(im, {
                    top: fh,
                    bottom: fh,
                    left: fw,
                    right: fw,
                    background: state.borderColor,
                    extendWith: "background"
                }));
            }));
        }
        else if (t === "-deskew") {
            i++;
        }
        else if (t === "-blur" || t === "-gaussian-blur") {
            const g = parseMagickGeometry(tokens[++i] ?? "0x1");
            const sigma = Math.max(0.3, g.height ?? g.width ?? 1);
            stack = (yield* mapSteps(stack, function* (im) {
                return (yield* blurImageSteps(im, sigma));
            }));
        }
        else if (t === "-sharpen" || t === "-unsharp") {
            const g = parseMagickGeometry(tokens[++i] ?? "0x1");
            const sigma = Math.max(0.3, g.height ?? g.width ?? 1);
            stack = (yield* mapSteps(stack, function* (im) {
                return (yield* sharpenImageSteps(im, sigma));
            }));
        }
        else if (t === "-median") {
            const r = Math.max(1, Math.round(Number(tokens[++i] ?? 3)));
            stack = (yield* mapSteps(stack, function* (im) {
                return (yield* medianImageSteps(im, r));
            }));
        }
        else if (t === "-morphology") {
            const method = (tokens[++i] ?? "dilate").toLowerCase();
            let kernelSpec = "";
            if (tokens[i + 1] && !tokens[i + 1]!.startsWith("-") && !tokens[i + 1]!.startsWith("+")) {
                kernelSpec = tokens[++i]!;
            }
            if (method.includes("convolve") || method.includes("correlate")) {
                stack = yield* mapSteps(stack, function* (im) {
                    return (yield* applyMagickCustomConvolveSteps(im, kernelSpec, signal));
                });
            }
            else {
                stack = yield* mapSteps(stack, function* (im) {
                    return (yield* applyMagickMorphology4ChSteps(im, method, kernelSpec, signal));
                });
            }
        }
        else if (t === "-statistic") {
            const statType = (tokens[++i] ?? "median").toLowerCase();
            const geom = tokens[++i] ?? "3x3";
            stack = yield* mapSteps(stack, function* (im) {
                return (yield* applyMagickMorphology4ChSteps(im, statType, geom, signal));
            });
        }
        else if (t === "-separate") {
            const nextStack: RgbaImage[] = [];
            for (const im of stack) {
                if (++cooperativeWork % 65536 === 0)
                    yield;
                if (state.channelExplicit) {
                    if (state.channels.r)
                        nextStack.push((yield* extractChannelImageSteps(im, 0)));
                    if (state.channels.g)
                        nextStack.push((yield* extractChannelImageSteps(im, 1)));
                    if (state.channels.b)
                        nextStack.push((yield* extractChannelImageSteps(im, 2)));
                    if (state.channels.a)
                        nextStack.push((yield* extractChannelImageSteps((yield* ensureAlphaImageSteps(im, 1)), 3)));
                }
                else {
                    nextStack.push((yield* extractChannelImageSteps(im, 0)), (yield* extractChannelImageSteps(im, 1)), (yield* extractChannelImageSteps(im, 2)));
                    if (im.hasAlpha) {
                        nextStack.push((yield* extractChannelImageSteps((yield* ensureAlphaImageSteps(im, 1)), 3)));
                    }
                }
            }
            stack = nextStack;
        }
        else if (t === "-combine") {
            if (stack.length >= 3) {
                const rIm = stack[0]!;
                const gIm = stack[1] ?? rIm;
                const bIm = stack[2] ?? rIm;
                const aIm = stack[3];
                const out = new Uint8Array(rIm.width * rIm.height * 4);
                for (let p = 0; p < out.length; p += 4) {
                    if (++cooperativeWork % 65536 === 0)
                        yield;
                    out[p] = rIm.data[p]!;
                    out[p + 1] = gIm.data[p]!;
                    out[p + 2] = bIm.data[p]!;
                    out[p + 3] = aIm ? aIm.data[p]! : 255;
                }
                stack = [{ ...rIm, space: "srgb", data: out, channels: 4, hasAlpha: Boolean(aIm) }];
            }
        }
        else if (t === "-draw") {
            const drawSpec = tokens[++i] ?? "";
            stack = yield* mapSteps(stack, function* (im) {
                for (const step of magickDrawSteps(im, drawSpec, state)) {
                    if (!step) { yield; continue; }
                    if (step.kind === "shape") im = yield* applyMagickRasterSteps(im, drawShapePixelSteps(im, step), signal);
                    else {
                        const overlay = decodeImage(new TextEncoder().encode(step.svg), { density: state.density });
                        im = yield* applyMagickRasterSteps(im, drawOverlayPixelSteps(im, overlay), signal, im, [im, overlay]);
                        detachRgbaBuffer(overlay.data);
                    }
                }
                return im;
            });
        }
        else if (t === "-annotate") {
            const offsetOrText = tokens[++i] ?? "+0+0";
            const hasExplicitOffset = hasAnnotationOffset(offsetOrText);
            const offset = hasExplicitOffset ? offsetOrText : "+0+0";
            const text = hasExplicitOffset ? (tokens[++i] ?? "") : offsetOrText;
            stack = yield* mapSteps(stack, function* (im) {
                return (yield* applyMagickRasterSteps(im, annotatePixelSteps(im, offset, text, state), signal));
            });
        }
        else if (t === "+clone" || t === "-clone") {
            const sourcePool = stack.length > 0 ? stack : parentStack;
            const spec = t === "+clone" ? "-1" : (tokens[++i] ?? "-1");
            for (const idx of parseMagickIndexSpec(spec, sourcePool.length)) {
                if (++cooperativeWork % 65536 === 0)
                    yield;
                const chosen = sourcePool[idx];
                if (chosen)
                    stack.push({ ...chosen, data: new Uint8Array(chosen.data) });
            }
        }
        else if (t === "-duplicate" || t === "+duplicate") {
            let count = 1;
            let idxSpec = "-1";
            if (t === "-duplicate") {
                const nextTok = tokens[i + 1];
                if (nextTok && /^\d+/.test(nextTok)) {
                    i++;
                    const commaIdx = nextTok.indexOf(",");
                    if (commaIdx >= 0) {
                        count = Math.max(0, parseInt(nextTok.slice(0, commaIdx), 10));
                        idxSpec = nextTok.slice(commaIdx + 1) || "-1";
                    }
                    else {
                        count = Math.max(0, parseInt(nextTok, 10));
                    }
                }
            }
            const sourcePool = stack.length > 0 ? stack : parentStack;
            const sourceLength = sourcePool.length;
            for (let k = 0; k < count; k++) {
                if (++cooperativeWork % 65536 === 0)
                    yield;
                for (const idx of parseMagickIndexSpec(idxSpec, sourceLength)) {
                    if (++cooperativeWork % 65536 === 0)
                        yield;
                    const chosen = sourcePool[idx];
                    if (chosen)
                        stack.push({ ...chosen, data: new Uint8Array(chosen.data) });
                }
            }
        }
        else if (t === "+insert" || t === "-insert") {
            const rawIdx = t === "+insert" ? 0 : Number(tokens[++i] ?? 0);
            if (stack.length > 1) {
                const last = stack.pop()!;
                const target = rawIdx < 0 ? Math.max(0, stack.length + 1 + rawIdx) : Math.min(stack.length, Math.max(0, rawIdx));
                stack.splice(target, 0, last);
            }
        }
        else if (t === "+swap" || t === "-swap") {
            let i1 = stack.length - 2;
            let i2 = stack.length - 1;
            if (t === "-swap") {
                const [s1, s2] = (tokens[++i] ?? "-2,-1").split(",").map((n) => Number(n));
                i1 = (s1 ?? -2) < 0 ? stack.length + (s1 ?? -2) : (s1 ?? 0);
                i2 = (s2 ?? -1) < 0 ? stack.length + (s2 ?? -1) : (s2 ?? 0);
            }
            if (stack[i1] && stack[i2]) {
                const tmp = stack[i1]!;
                stack[i1] = stack[i2]!;
                stack[i2] = tmp;
            }
        }
        else if (t === "+delete" || t === "-delete") {
            if (t === "+delete") {
                const popped = stack.pop();
                if (popped) detachRgbaBuffer(popped.data);
            }
            else {
                const toDelete = new Set(parseMagickIndexSpec(tokens[++i] ?? "-1", stack.length));
                stack = stack.filter((im, idx) => {
                    if (toDelete.has(idx)) {
                        detachRgbaBuffer(im.data);
                        return false;
                    }
                    return true;
                });
            }
        }
        else if (t === "-reverse") {
            stack.reverse();
        }
        else if (t === "-append" || t === "+append") {
            const oldStack = stack;
            const appended = (yield* appendStackImagesSteps(oldStack, t === "-append", state));
            for (const im of oldStack) {
                if (im.data.buffer !== appended.data.buffer) detachRgbaBuffer(im.data);
            }
            stack = [appended];
        }
        else if (t === "-flatten" || t === "-mosaic" || (t === "-layers" && ["flatten", "merge", "mosaic"].includes((tokens[i + 1] ?? "").toLowerCase()))) {
            if (t === "-layers")
                i++;
            if (stack.length > 0) {
                const oldStack = stack;
                const maxW = Math.max(...oldStack.map((im) => im.width));
                const maxH = Math.max(...oldStack.map((im) => im.height));
                const canvas = (yield* createSolidRgbaImageSteps(maxW, maxH, state.background));
                const layers = oldStack.map((im) => rgbaToCompositeLayer(im, 0, 0, state.compose));
                const flattened = (yield* compositeImageSteps(canvas, layers));
                if (canvas.data.buffer !== flattened.data.buffer) detachRgbaBuffer(canvas.data);
                for (const im of oldStack) {
                    if (im.data.buffer !== flattened.data.buffer) detachRgbaBuffer(im.data);
                }
                stack = [flattened];
            }
        }
        else if (t === "-composite") {
            if (stack.length >= 2) {
                const base = stack[0]!;
                const origOverlay = stack[1]!;
                let overlay = origOverlay;
                let gx = 0;
                let gy = 0;
                if (state.geometry) {
                    const g = parseMagickGeometry(state.geometry);
                    if (g.width !== undefined || g.height !== undefined) {
                        overlay = (yield* applyMagickResizeSteps(origOverlay, state.geometry, state.kernel));
                        if (overlay.data.buffer !== origOverlay.data.buffer) detachRgbaBuffer(origOverlay.data);
                    }
                    gx = g.x;
                    gy = g.y;
                }
                const pos = gravityAdjustBox(base.width, base.height, overlay.width, overlay.height, gx, gy, state.gravity);
                let composed: RgbaImage;
                if (state.composeRaw.toLowerCase() === "over") {
                    yield* blitOverRgbaInPlaceSteps(base, overlay, pos.x, pos.y);
                    detachRgbaBuffer(overlay.data);
                    composed = base;
                } else {
                    composed = (yield* applyMagickCompositeLayerSteps(base, overlay, state.composeRaw, pos.x, pos.y, state.composeArgs, signal));
                    if (composed !== base) detachRgbaBuffer(base.data);
                    if (composed !== overlay) detachRgbaBuffer(overlay.data);
                }
                stack = [composed, ...stack.slice(2)];
            }
        }
        else {
            const isLabelOperand = /^(?:label|caption):/i.test(t);
            const mergeOntoCanvas = isLabelOperand && stack.length === 1 && state.hasSize && stack[0]!.width === state.sizeWidth && stack[0]!.height === state.sizeHeight && state.background.r === 255 && state.background.g === 255 && state.background.b === 255 && state.background.a === 255;
            const prevBg = state.background;
            if (mergeOntoCanvas) {
                state.background = { r: 0, g: 0, b: 0, a: 0 };
            }
            const maxDecodeDim = inferMaxDecodeDimensionFromUpcomingTokens(tokens, i + 1);
            const loaded = (yield* parseInputOperandsSteps(t, files, state, stdinBytes, maxDecodeDim));
            if (mergeOntoCanvas) {
                state.background = prevBg;
            }
            if (loaded) {
                if (mergeOntoCanvas && loaded[0]) {
                    yield* blitOverRgbaInPlaceSteps(stack[0]!, loaded[0], 0, 0);
                    detachRgbaBuffer(loaded[0].data);
                } else {
                    stack.push(...loaded);
                }
            }
        }
        i++;
    }
    return stack;
}

function* runConvertCliSteps(argv: readonly string[], files: Map<string, Uint8Array>, stdinBytes?: Uint8Array, signal?: AbortSignal): Generator<void, ImageMagickCliResult, void> {
    const listRes = tryHandleMagickListOption(argv);
    if (listRes) return listRes;
    let cooperativeWork = 63;
    const optionArgs = argv.slice(0, argv.indexOf("--") < 0 ? argv.length : argv.indexOf("--"));
    if (argv.length === 0 || optionArgs.includes("--help") || optionArgs.includes("-help") || optionArgs.includes("-h")) {
        return {
            exitCode: 0,
            stdout: "Usage: magick [input-options] input-file [operators] output-file\n",
            stderr: ""
        };
    }
    if (optionArgs.includes("--version") || optionArgs.includes("-version")) {
        return {
            exitCode: 0,
            stdout: "Version: ImageMagick 7.1.1-safe-bash (@poe-code/image-ast)\n",
            stderr: ""
        };
    }
    const outSpec = argv[argv.length - 1]!;
    const pipelineTokens = argv.slice(0, -1);
    const state = createDefaultState();
    try {
        const stack = (yield* evaluatePipelineTokensSteps(pipelineTokens, files, state, [], stdinBytes, signal));
        if (stack.length === 0) {
            return {
                exitCode: 1,
                stdout: "",
                stderr: `magick: no images defined '${outSpec}'\n`
            };
        }
        const finalImg = stack[stack.length - 1]!;
        const outLower = outSpec.toLowerCase();
        if (outLower === "info:" || outLower === "info:-") {
            const formatted: string[] = [];
            for (const [idx, im] of stack.entries()) {
                formatted.push(state.formatStr
                    ? yield* formatMagickPropertyStringSteps(state.formatStr, im, () => im, {
                        ...(im as MagickImage)[magickInput], sceneIdx: idx, sceneCount: stack.length, quality: state.quality
                    })
                    : `${im.width}x${im.height} sRGB 8-bit`);
            }
            const outText = formatted.join(state.formatStr ? "" : "\n");
            return {
                exitCode: 0,
                stdout: outText.endsWith("\n") ? outText : `${outText}\n`,
                stderr: ""
            };
        }
        if (outLower.startsWith("txt:")) {
            const txt = (yield* formatTxtEnumerationSteps(finalImg));
            const target = outSpec.slice(4);
            if (!target || target === "-") {
                return { exitCode: 0, stdout: txt, stderr: "" };
            }
            files.set(target, new TextEncoder().encode(txt));
            return { exitCode: 0, stdout: "", stderr: "" };
        }
        if (outLower.startsWith("histogram:")) {
            const hist = (yield* formatHistogramOutputSteps(finalImg));
            return { exitCode: 0, stdout: hist, stderr: "" };
        }
        const { format, path: outPath } = inferOutputFormat(outSpec, "png");
        if (stack.length > 1 && (/%0?\d*d/.test(outPath) || !state.adjoin)) {
            for (let idx = 0; idx < stack.length; idx++) {
                if (++cooperativeWork % 64 === 0)
                    yield;
                const framePath = formatSceneOutputPath(outPath, idx);
                const { data: frameBytes } = encodeImage(stack[idx]!, { format, quality: state.quality });
                files.set(framePath, frameBytes);
            }
            return { exitCode: 0, stdout: "", stderr: "" };
        }
        let toEncode = finalImg;
        let encodePageHeight: number | undefined;
        if (stack.length > 1 && format === "gif") {
            const fw = stack[0]!.width;
            const fh = stack[0]!.height;
            const combined = new Uint8Array(fw * fh * stack.length * 4);
            for (let idx = 0; idx < stack.length; idx++) {
                if (++cooperativeWork % 64 === 0)
                    yield;
                const frame = stack[idx]!.width === fw && stack[idx]!.height === fh
                    ? stack[idx]!
                    : (yield* applyMagickResizeSteps(stack[idx]!, `${fw}x${fh}!`, state.kernel));
                combined.set(frame.data, idx * fw * fh * 4);
            }
            toEncode = {
                ...stack[0]!,
                width: fw,
                height: fh * stack.length,
                pages: stack.length,
                pageHeight: fh,
                data: combined
            };
            encodePageHeight = fh;
        }
        if (typeof (globalThis as { gc?: () => void }).gc === "function") { try { const gc = (globalThis as { gc?: () => void }).gc!; gc(); gc(); } catch { /* Collection is best-effort. */ } }
        const { data: encoded } = encodeImage(toEncode, {
            format,
            quality: state.quality,
            ...(encodePageHeight !== undefined ? { pageHeight: encodePageHeight } : {}),
            consumeInput: true
        } as any);
        detachRgbaBuffer(toEncode.data);
        for (const im of stack) detachRgbaBuffer(im.data);
        if (outPath === "-" || outSpec.endsWith(":-")) {
            return {
                exitCode: 0,
                stdout: "",
                stderr: "",
                stdoutBytes: encoded
            };
        }
        files.set(outPath, encoded);
        return { exitCode: 0, stdout: "", stderr: "" };
    }
    catch (err) {
        return {
            exitCode: 1,
            stdout: "",
            stderr: `magick: ${(err as Error).message}\n`
        };
    }
}
async function transformStoredMagickRaster(image: StoredRgbaImage, backend: CompareFileSession, steps: Generator<ConvolveRequest | undefined, void, Uint8Array | undefined>, signal: AbortSignal, dimensions: Pick<StoredRgbaImage, "width" | "height" | "hasAlpha"> = image, sources: readonly StoredRgbaImage[] | ((index: number) => Promise<StoredRgbaImage>) = [image], checkpoint?: () => Promise<void>): Promise<StoredRgbaImage> {
    const position = backend.storage.allocate(dimensions.width * dimensions.height * 4), cache = new Map<string, Uint8Array>();
    let next = steps.next();
    while (!next.done) {
        signal.throwIfAborted();
        const request = next.value;
        if (!request) { await yieldTurn(signal); await checkpoint?.(); next = steps.next(); }
        else if (request.kind === "write") { await backend.storage.write(position + request.position, request.data); next = steps.next(); }
        else {
            const source = typeof sources === "function" ? await sources(request.image ?? 0) : sources[request.image ?? 0]!;
            if (request.length !== 4) { next = steps.next(await backend.storage.read(source.position + request.position, request.length)); continue; }
            const sourceSize = source.width * source.height * 4, page = Math.floor(request.position / 4096) * 4096, key = (request.image ?? 0) + ":" + page;
            let bytes = cache.get(key);
            if (!bytes) {
                bytes = new Uint8Array(await backend.storage.read(source.position + page, Math.min(4096, sourceSize - page)));
                if (cache.size === 32) cache.delete(cache.keys().next().value!);
                cache.set(key, bytes);
            }
            next = steps.next(bytes.subarray(request.position - page, request.position - page + request.length));
        }
    }
    return { ...image, width: dimensions.width, height: dimensions.height, hasAlpha: dimensions.hasAlpha, position };
}

async function morphStoredMagickImage(image: StoredRgbaImage, backend: CompareFileSession, plan: ReturnType<typeof magickMorphologyPlan>, signal: AbortSignal): Promise<StoredRgbaImage> {
    const images = [image], size = image.width * image.height * 4;
    for (const step of plan.steps) {
        if (step.mode === "diff") {
            const position = backend.storage.allocate(size);
            const a = images[step.a]!, b = images[step.b]!;
            for (let offset = 0; offset < size; offset += 16384) {
                await yieldTurn(signal);
                const length = Math.min(16384, size - offset);
                const left = new Uint8Array(await backend.storage.read(a.position + offset, length));
                const bytes = await drainSteps(subtractMagickPixelSteps(left, await backend.storage.read(b.position + offset, length)), signal);
                await backend.storage.write(position + offset, bytes);
            }
            images.push({ ...image, position });
        } else {
            const source = images[step.source]!;
            images.push(await transformStoredMagickRaster(source, backend, morphologyPixelSteps(source, plan.rx, plan.ry, step.mode), signal));
        }
    }
    return images.at(-1)!;
}

async function transformStoredMagickCoordinates(image: StoredRgbaImage, backend: CompareFileSession, token: string, geometry: string, state: MagickState, signal: AbortSignal): Promise<StoredRgbaImage> {
    const g = parseMagickGeometry(geometry), w = image.width, h = image.height;
    type Span = { source: number; target: number; length: number };
    let xs: Span[], ys: Span[], width = w, height = h;
    if (token === "-roll") {
        const dx = ((Math.round(g.x || g.width || 0) % w) + w) % w;
        const dy = ((Math.round(g.y || g.height || 0) % h) + h) % h;
        xs = [{ source: w - dx, target: 0, length: dx }, { source: 0, target: dx, length: w - dx }];
        ys = [{ source: h - dy, target: 0, length: dy }, { source: 0, target: dy, length: h - dy }];
    } else if (token === "-splice") {
        const sw = Math.max(0, Math.round(g.width ?? 0)), sh = Math.max(0, Math.round(g.height ?? 0));
        const base = resolveGravityOffset(w, h, state.gravity);
        const east = state.gravity === "east" || state.gravity === "northeast" || state.gravity === "southeast";
        const south = state.gravity === "south" || state.gravity === "southwest" || state.gravity === "southeast";
        const x = Math.max(0, Math.min(w, Math.round(base.left + (east ? -g.x : g.x))));
        const y = Math.max(0, Math.min(h, Math.round(base.top + (south ? -g.y : g.y))));
        width += sw; height += sh;
        xs = [{ source: 0, target: 0, length: x }, { source: x, target: x + sw, length: w - x }];
        ys = [{ source: 0, target: 0, length: y }, { source: y, target: y + sh, length: h - y }];
    } else {
        const cw = Math.max(0, Math.round(g.width ?? 0)), ch = Math.max(0, Math.round(g.height ?? 0));
        const { x, y } = gravityAdjustBox(w, h, cw, ch, g.x, g.y, state.gravity);
        if (x + cw < 0 || y + ch < 0 || x > w || y > h) return image;
        const x0 = Math.max(0, Math.min(w, x)), x1 = Math.max(x0, Math.min(w, x + cw));
        const y0 = Math.max(0, Math.min(h, y)), y1 = Math.max(y0, Math.min(h, y + ch));
        if (x1 - x0 >= w || y1 - y0 >= h) return image;
        width -= x1 - x0; height -= y1 - y0;
        xs = [{ source: 0, target: 0, length: x0 }, { source: x1, target: x0, length: w - x1 }];
        ys = [{ source: 0, target: 0, length: y0 }, { source: y1, target: y0, length: h - y1 }];
    }
    const position = token === "-splice" ? (await createStoredCanvas(width, height, state.background, backend, signal)).position : backend.storage.allocate(width * height * 4);
    let work = 0;
    for (const y of ys) for (let row = 0; row < y.length; row++) for (const x of xs) {
        for (let offset = 0; offset < x.length; offset += 4096) {
            if (work++ % 64 === 0) await yieldTurn(signal);
            const length = Math.min(4096, x.length - offset) * 4;
            const bytes = await backend.storage.read(image.position + ((y.source + row) * w + x.source + offset) * 4, length);
            await backend.storage.write(position + ((y.target + row) * width + x.target + offset) * 4, bytes);
        }
    }
    return { ...image, position, width, height, ...(token === "-splice" ? { hasAlpha: true } : {}) };
}

async function compositeStoredMagick(base: StoredRgbaImage, overlay: StoredRgbaImage, backend: CompareFileSession, signal: AbortSignal, left: number, top: number, mode: string, args?: string, generic = false, inPlace = false): Promise<StoredRgbaImage> {
    const position = inPlace ? base.position : backend.storage.allocate(base.width * base.height * 4);
    for (let start = 0; !inPlace && start < base.width * base.height * 4; start += 16384) {
        await yieldTurn(signal); await backend.storage.write(position + start, await backend.storage.read(base.position + start, Math.min(16384, base.width * base.height * 4 - start)));
    }
    for (let y = Math.max(0, top); y < Math.min(base.height, top + overlay.height); y++) {
        for (let x = Math.max(0, left); x < Math.min(base.width, left + overlay.width); x += 4096) {
            await yieldTurn(signal);
            const count = Math.min(4096, Math.min(base.width, left + overlay.width) - x), destination = (y * base.width + x) * 4;
            const dst: RgbaImage = { ...base, width: count, height: 1, data: new Uint8Array(await backend.storage.read(position + destination, count * 4)) };
            const src: RgbaImage = { ...overlay, width: count, height: 1, data: new Uint8Array(await backend.storage.read(overlay.position + ((y - top) * overlay.width + x - left) * 4, count * 4)) };
            let result = dst;
            if (generic) result = await drainSteps(compositeImageSteps(dst, [rgbaToCompositeLayer(src, 0, 0, mode as MagickState["compose"])]), signal);
            else if (mode.toLowerCase() === "over") await drainSteps(blitOverRgbaInPlaceSteps(dst, src, 0, 0), signal);
            else result = await drainSteps(applyMagickCompositeLayerSteps(dst, src, mode, 0, 0, args, signal), signal);
            await backend.storage.write(position + destination, result.data);
        }
    }
    return { ...base, position };
}

async function tryConvertFiles(argv: readonly string[], input: ConvertFileInput, stdinBytes: Uint8Array | undefined, signal: AbortSignal): Promise<ImageMagickCliResult | undefined> {
    if (!input.filesystem.capabilities || !input.filesystem.open || !input.filesystem.removeFileConditional) return;
    const outSpec = argv.at(-1);
    if (!outSpec || argv.some(token => ["--help", "-help", "-h", "--version", "-version", "-list", "--list"].includes(token))) return;
    if (["info:", "txt:", "histogram:"].some(prefix => outSpec.toLowerCase().startsWith(prefix))) return;
    const output = inferOutputFormat(outSpec, "png");
    if (output.format === "gif" || output.path.includes("%")) return;
    await yieldTurn(signal);
    let state = createDefaultState();
    const tokens = argv.slice(0, -1), scopes: { state: MagickState; end: number }[] = [];
    type Operation = Parameters<typeof transformStoredImage>[2];
    type StackStep = (stack: StoredImageStack, backend: CompareFileSession, parents: StoredImageStack[]) => Promise<StoredImageStack>;
    type Step = ((image: StoredRgbaImage | undefined, backend: CompareFileSession) => Promise<StoredRgbaImage | undefined>) | { runStack: StackStep };
    const steps: Step[] = [];
    const stackStep = (runStack: StackStep) => { steps.push({ runStack }); };
    let inputs = 0, operandsOnly = false;
    const transform = (operation: (image: StoredRgbaImage) => Operation | undefined) => {
        steps.push(async (image, backend) => { if (!image) return; const node = operation(image); return node ? transformStoredImage(image, backend.storage, node, signal) : image; });
    };
    try {
    for (let i = 0; i < tokens.length; i++) {
        if (i && i % 64 === 0) await yieldTurn(signal);
        const token = tokens[i]!;
        if (token === "") continue;
        if (!operandsOnly && token === "--") { operandsOnly = true; continue; }
        if (!operandsOnly && token === "(") {
            let depth = 1, end = i + 1;
            for (; end < tokens.length; end++) { if (tokens[end] === "(") depth++; else if (tokens[end] === ")" && --depth === 0) break; }
            scopes.push({ state, end }); state = { ...state };
            stackStep(async (stack, backend, parents) => { parents.push(stack); return new StoredImageStack(backend.storage, signal, stack); });
            continue;
        }
        if (scopes.at(-1)?.end === i) {
            state = scopes.pop()!.state; operandsOnly = false;
            stackStep(async (stack, _backend, parents) => { const parent = parents.pop()!; for (let n = 0; n < stack.length; n++) await parent.push((await stack.get(n))!); return parent; });
            continue;
        }
        if (!operandsOnly && ["+clone", "-clone", "+duplicate", "-duplicate", "+delete", "-delete", "+swap", "-swap", "-reverse", "+insert", "-insert"].includes(token)) {
            let spec = "-1", count = 1;
            if (["-clone", "-delete", "-swap", "-insert"].includes(token)) spec = tokens[++i] ?? (token === "-swap" ? "-2,-1" : token === "-insert" ? "0" : "-1");
            if (token === "-duplicate" && tokens[i + 1]?.[0] && tokens[i + 1]![0]! >= "0" && tokens[i + 1]![0]! <= "9") {
                const value = tokens[++i]!, comma = value.indexOf(","); count = Math.max(0, parseInt(value, 10)); spec = comma < 0 ? "-1" : value.slice(comma + 1) || "-1";
            }
            stackStep(async (stack, _backend, parents) => {
                if (token.endsWith("clone") || token.endsWith("duplicate")) {
                    const source = stack.length ? stack : parents.at(-1) ?? stack, length = source.length;
                    for (let repeat = 0; repeat < count; repeat++) for (const index of parseMagickIndexSpec(spec, length)) { await yieldTurn(signal); await stack.push((await source.get(index))!); }
                } else if (token.endsWith("delete")) await stack.remove(parseMagickIndexSpec(spec, stack.length));
                else if (token === "-reverse") { for (let n = 0; n < Math.floor(stack.length / 2); n++) { await yieldTurn(signal); await stack.swap(n, stack.length - 1 - n); } }
                else if (token.endsWith("insert")) {
                    const raw = token === "+insert" ? 0 : Number(spec), target = raw < 0 ? Math.max(0, stack.length + raw) : Math.min(stack.length - 1, Math.max(0, raw));
                    for (let n = stack.length - 1; n > target; n--) { await yieldTurn(signal); await stack.swap(n, n - 1); }
                } else { const values = (token === "+swap" ? "-2,-1" : spec).split(",").map(Number); const a = values[0] ?? -2, b = values[1] ?? -1; await stack.swap(a < 0 ? stack.length + a : a, b < 0 ? stack.length + b : b); }
                return stack;
            });
            continue;
        }
        const setting = operandsOnly ? undefined : applyMagickReadSetting(tokens, state, i);
        if (setting !== undefined) { i = setting; continue; }
        const warpOperation = operandsOnly ? undefined : parseMagickWarpOperation(tokens, state, i);
        if (warpOperation) {
            i = warpOperation.end;
            steps.push(async (image, backend) => {
                if (!image) return;
                const plan = warpOperation.plan(image);
                return plan ? transformStoredMagickRaster(image, backend, warpPixelSteps(image, plan, warpOperation.background), signal, plan) : image;
            });
            continue;
        }
        const pixelOperation = operandsOnly ? undefined : parseMagickPixelOperation(tokens, state, i, signal);
        if (pixelOperation) {
            i = pixelOperation.end;
            steps.push(async (image, backend) => image ? transformStoredMagickPixels(image, backend, pixelOperation, signal) : undefined);
            continue;
        }
        const analysisOperation = operandsOnly ? undefined : parseMagickAnalysisOperation(tokens, state, i);
        if (analysisOperation) {
            i = analysisOperation.end;
            steps.push(async (image, backend) => {
                if (!image) return;
                const histogram = Array.from({ length: 4 }, () => new Float64Array(256)), size = image.width * image.height * 4;
                for (let offset = 0; offset < size; offset += 16384) {
                    if (offset % 1048576 === 0) await yieldTurn(signal);
                    await drainSteps(accumulateMagickHistogram(await backend.storage.read(image.position + offset, Math.min(16384, size - offset)), histogram), signal);
                }
                const lookup = analysisOperation.lookup(histogram, image);
                return transformStoredMagickPixels(image, backend, { end: analysisOperation.end, apply: pixels => applyMagickLookup(pixels, lookup) }, signal);
            });
            continue;
        }
        if (!operandsOnly && ["-append", "+append", "-flatten", "-mosaic", "-composite"].includes(token)) {
            const settings = { ...state };
            stackStep(async (stack, backend) => {
                if (!stack.length || (token === "-composite" && stack.length < 2)) return stack;
                let result: StoredRgbaImage;
                if (token === "-composite") {
                    const base = (await stack.get(0))!; let overlay = (await stack.get(1))!, gx = 0, gy = 0;
                    if (settings.geometry) { const geometry = parseMagickGeometry(settings.geometry); gx = geometry.x; gy = geometry.y; const resize = magickResizeOptions(overlay, settings.geometry, settings.kernel); if (resize) overlay = await transformStoredImage(overlay, backend.storage, { kind: "resize", ...resize }, signal); }
                    const offset = gravityAdjustBox(base.width, base.height, overlay.width, overlay.height, gx, gy, settings.gravity);
                    result = await compositeStoredMagick(base, overlay, backend, signal, offset.x, offset.y, settings.composeRaw, settings.composeArgs);
                    await stack.remove([1]); await stack.set(0, result); return stack;
                }
                const append = token.endsWith("append"), vertical = token === "-append";
                if (append && stack.length === 1) return stack;
                let width = 0, height = 0;
                for (let n = 0; n < stack.length; n++) { await yieldTurn(signal); const frame = (await stack.get(n))!; width = append && !vertical ? width + frame.width : Math.max(width, frame.width); height = append && vertical ? height + frame.height : Math.max(height, frame.height); }
                result = await createStoredCanvas(width, height, settings.background, backend, signal);
                let cursor = 0;
                for (let n = 0; n < stack.length; n++) {
                    const frame = (await stack.get(n))!, offset = resolveGravityOffset(vertical ? width - frame.width : 0, vertical ? 0 : height - frame.height, settings.gravity);
                    result = await compositeStoredMagick(result, frame, backend, signal, append ? vertical ? offset.left : cursor : 0, append ? vertical ? cursor : offset.top : 0, append ? "over" : settings.compose, undefined, !append, true);
                    cursor += vertical ? frame.height : frame.width;
                }
                stack.length = 0; await stack.push(result); return stack;
            }); continue;
        }
        if (!operandsOnly && token === "-geometry") { state.geometry = tokens[++i] ?? "+0+0"; continue; }
        if (!operandsOnly && token === "+gravity") { state.gravity = "northwest"; continue; }
        if (!operandsOnly && token === "-strip") { state.strip = true; continue; }
        if (!operandsOnly && token === "+repage") continue;
        if (!operandsOnly && token === "-repage") { i++; continue; }
        if (!operandsOnly && (token === "-write" || token === "+write")) {
            const path = tokens[++i] ?? "", quality = state.quality;
            stackStep(async (stack, backend) => {
                const image = await stack.get(stack.length - 1);
                if (image && path && path.toLowerCase() !== "null:") {
                    const output = inferOutputFormat(path, image.format);
                    if (stack.length > 1 && hasSceneOutputPattern(output.path)) {
                        for (let index = 0; index < stack.length; index++) { await yieldTurn(signal); await backend.stage((await stack.get(index))!, formatSceneOutputPath(output.path, index), { format: output.format, quality }); }
                    } else await backend.stage(image, output.path, { format: output.format, quality });
                }
                return stack;
            });
        } else if (!operandsOnly && (token === "-dither" || token === "+dither")) {
            state.dither = token === "-dither" ? (tokens[++i] ?? "floydsteinberg").toLowerCase() !== "none" : false;
        } else if (!operandsOnly && token === "-remap") {
            const palette = tokens[++i] ?? "", settings = { ...state };
            steps.push(async (image, backend) => {
                if (!image) return;
                const colors = await parseStoredCompareInput(palette, settings, backend, signal);
                return colors ? remapStoredImage(image, colors, backend.storage, settings.dither, signal) : image;
            });
        } else if (!operandsOnly && token === "-floodfill") {
            const geometry = parseMagickGeometry(tokens[++i] ?? "+0+0"), candidate = tokens[i + 1], replacement = state.fill, fuzz = state.fuzz;
            let target: RgbaColor | undefined;
            if (candidate && !candidate.startsWith("-") && !candidate.startsWith("+")) {
                let file = false;
                try { file = (await input.filesystem.stat(resolvePath(input.cwd, candidate), { signal })).type === "file"; }
                catch (error) { if (!(error instanceof FsError) || !["ENOENT", "ENOTDIR", "EISDIR", "EACCES", "EPERM"].includes(error.code)) throw error; }
                if (!file) { try { target = parseColor(candidate); i++; } catch { /* Optional color omitted. */ } }
            }
            steps.push(async (image, backend) => {
                if (!image) return;
                const x = Math.max(0, Math.min(image.width - 1, Math.round(geometry.x || geometry.width || 0)));
                const y = Math.max(0, Math.min(image.height - 1, Math.round(geometry.y || geometry.height || 0)));
                return floodfillStoredImage(image, backend.storage, x, y, target, replacement, fuzz, signal);
            });
        } else if (!operandsOnly && token === "-draw") {
            const drawing = tokens[++i] ?? "", settings = { ...state };
            steps.push(async (image, backend) => {
                if (!image) return;
                for (const step of magickDrawSteps(image, drawing, settings)) {
                    if (!step) { await yieldTurn(signal); continue; }
                    if (step.kind === "shape") image = await transformStoredMagickRaster(image, backend, drawShapePixelSteps(image, step), signal);
                    else {
                        const overlay = await decodeStoredMagickSvg(step.svg, settings.density, backend, signal);
                        image = await transformStoredMagickRaster(image, backend, drawOverlayPixelSteps(image, overlay), signal, image, [image, overlay]);
                    }
                }
                return image;
            });
        } else if (!operandsOnly && token === "-annotate") {
            const offsetOrText = tokens[++i] ?? "+0+0", explicit = hasAnnotationOffset(offsetOrText);
            const offset = explicit ? offsetOrText : "+0+0", text = explicit ? (tokens[++i] ?? "") : offsetOrText, settings = { ...state };
            steps.push(async (image, backend) => image ? transformStoredMagickRaster(image, backend, annotatePixelSteps(image, offset, text, settings), signal) : undefined);
        } else if (!operandsOnly && token === "-fx") {
            const expression = tokens[++i] ?? "u", channels = state.channels;
            stackStep(async (stack, backend) => {
                const base = await stack.get(0); if (!base) return stack;
                const frames = new Map<number, StoredRgbaImage>([[0, base]]), indices = new WeakMap<FxImage, number>(); indices.set(base, 0);
                let demanded: number | undefined;
                const source: FxStack = {
                    length: stack.length,
                    get(index) { if (index < 0 || index >= stack.length || !Number.isInteger(index)) return; const frame = frames.get(index); if (!frame) { demanded = index; throw new FxFrameDemand(); } return frame; },
                    indexOf(image) { return indices.get(image) ?? -1; },
                    // Metadata retained during replay is bounded by expression references, not the number of input frames.
                    reset() { if (frames.size > 32) { frames.clear(); frames.set(0, base); } }
                };
                const result = await transformStoredMagickRaster(base, backend, magickFxPixelSteps(source, expression, channels), signal, base, async index => (await stack.get(index))!, async () => {
                    if (demanded === undefined) return; const index = demanded; demanded = undefined; const frame = (await stack.get(index))!; frames.set(index, frame); indices.set(frame, index);
                });
                stack.length = 0; await stack.push(result); return stack;
            });
        } else if (!operandsOnly && token === "-vignette") {
            i++;
            const background = state.background;
            steps.push(async (image, backend) => image ? transformStoredMagickRaster(image, backend, vignettePixelSteps(image, background), signal) : undefined);
        } else if (!operandsOnly && token === "-shadow") {
            const geometry = tokens[++i] ?? "80x3+5+5", background = state.background;
            steps.push(async (image, backend) => {
                if (!image) return;
                const layout = magickShadowLayout(image, geometry), base = await transformStoredMagickRaster(image, backend, shadowPixelSteps(image, layout, background), signal, layout);
                return transformStoredImage(base, backend.storage, { kind: "blur", sigma: layout.sigma }, signal);
            });
        } else if (!operandsOnly && (token === "-morphology" || token === "-statistic")) {
            const method = (tokens[++i] ?? (token === "-morphology" ? "dilate" : "median")).toLowerCase();
            let spec = "";
            if (token === "-statistic") spec = tokens[++i] ?? "3x3";
            else if (tokens[i + 1] && !tokens[i + 1]!.startsWith("-") && !tokens[i + 1]!.startsWith("+")) spec = tokens[++i]!;
            if (token === "-morphology" && (method.includes("convolve") || method.includes("correlate"))) {
                const kernel = parseMagickConvolveKernel(spec);
                steps.push(async (image, backend) => image && kernel.length ? transformStoredMagickRaster(image, backend, convolvePixelSteps(image, kernel, 0), signal) : image);
            } else {
                const plan = magickMorphologyPlan(method, spec);
                steps.push(async (image, backend) => image ? morphStoredMagickImage(image, backend, plan, signal) : undefined);
            }
        } else if (!operandsOnly && ["-convolve", "-edge", "-canny", "-emboss", "-charcoal", "-sketch"].includes(token)) {
            const spec = tokens[++i] ?? "1", charcoal = token === "-charcoal" || token === "-sketch";
            const kernel = token === "-convolve" ? parseMagickConvolveKernel(spec) : token === "-emboss" ? [-2, -1, 0, -1, 1, 1, 0, 1, 2] : [-1, -1, -1, -1, 8, -1, -1, -1, -1];
            if (charcoal) transform(() => ({ kind: "blur", sigma: 1 }));
            steps.push(async (image, backend) => image && kernel.length ? transformStoredMagickRaster(image, backend, convolvePixelSteps(image, kernel, token === "-emboss" ? 128 : 0), signal) : image);
            if (charcoal) {
                steps.push(async (image, backend) => image ? transformStoredMagickPixels(image, backend, { end: i, apply: pixels => negateImageSteps(pixels, { alpha: false }) }, signal) : undefined);
                transform(() => ({ kind: "grayscale" }));
            }
        } else if (!operandsOnly && ["-roll", "-splice", "-chop"].includes(token)) {
            const geometry = tokens[++i] ?? (token === "-roll" ? "+0+0" : "0x0"), captured = { ...state };
            steps.push(async (image, backend) => image ? transformStoredMagickCoordinates(image, backend, token, geometry, captured, signal) : undefined);
        } else if (!operandsOnly && ["-resize", "-scale", "-sample", "-thumbnail"].includes(token)) {
            const geometry = tokens[++i] ?? "100%", kernel = token === "-sample" ? "nearest" : state.kernel;
            transform(image => { const options = magickResizeOptions(image, geometry, kernel); return options ? { kind: "resize", ...options } : undefined; });
        } else if (!operandsOnly && ["-flip", "-flop", "-auto-orient"].includes(token)) {
            const kind = token === "-flip" ? "flip" : token === "-flop" ? "flop" : "autoOrient";
            transform(() => ({ kind }));
        } else if (!operandsOnly && token === "-rotate") {
            const angle = Number(tokens[++i] ?? 0), background = state.background;
            transform(() => ({ kind: "rotate", angle, background }));
        } else if (!operandsOnly && token === "-gamma") {
            const gamma = Math.max(0.1, Number(tokens[++i] ?? 1));
            transform(() => ({ kind: "gamma", gamma, gammaOut: gamma }));
        } else if (!operandsOnly && ["-colorspace", "-grayscale"].includes(token)) {
            const space = (tokens[++i] ?? "gray").toLowerCase();
            if (space.includes("gray") || space.includes("grey") || space === "rec709luma" || space === "rec601luma") transform(() => ({ kind: "grayscale" }));
        } else if (!operandsOnly && ["-blur", "-gaussian-blur", "-sharpen", "-unsharp"].includes(token)) {
            const geometry = parseMagickGeometry(tokens[++i] ?? "0x1"), sigma = Math.max(0.3, geometry.height ?? geometry.width ?? 1);
            const kind = token === "-blur" || token === "-gaussian-blur" ? "blur" : "sharpen";
            transform(() => kind === "blur" ? { kind, sigma } : { kind, sigma, m1: 1, m2: 2 });
        } else if (!operandsOnly && token === "-crop") {
            const geometry = tokens[++i] ?? "100%", parsed = parseMagickGeometry(geometry), gravity = state.gravity;
            transform(image => {
                if (parsed.isSubdivide) {
                    const columns = Math.max(1, Math.round(parsed.width ?? 1)), rows = Math.max(1, Math.round(parsed.height ?? 1));
                    const left = Math.min(image.width - 1, Math.round((columns - 1) * image.width / columns)), top = Math.min(image.height - 1, Math.round((rows - 1) * image.height / rows));
                    return { kind: "extract", left, top, width: image.width - left, height: image.height - top };
                }
                const area = magickCropArea(image, geometry, gravity);
                return area ? { kind: "extract", ...area } : undefined;
            });
        } else if (!operandsOnly && token === "-shave") {
            const geometry = parseMagickGeometry(tokens[++i] ?? "0x0"), width = Math.max(0, Math.round(geometry.width ?? 0)), height = Math.max(0, Math.round(geometry.height ?? width));
            transform(image => { const left = Math.min(Math.floor((image.width - 1) / 2), width), top = Math.min(Math.floor((image.height - 1) / 2), height); return { kind: "extract", left, top, width: Math.max(1, image.width - left * 2), height: Math.max(1, image.height - top * 2) }; });
        } else if (!operandsOnly && token === "-trim") {
            const threshold = state.fuzz;
            transform(() => ({ kind: "trim", threshold }));
        } else if (!operandsOnly && token === "-median") {
            const size = Math.max(1, Math.round(Number(tokens[++i] ?? 3)));
            transform(() => ({ kind: "median", size }));
        } else if (!operandsOnly && token === "-extent") {
            const geometry = tokens[++i] ?? "100%", captured = { ...state };
            steps.push(async (image, backend) => {
                if (!image) return;
                const layout = magickExtentLayout(image, geometry, captured), canvas = await createStoredCanvas(layout.width, layout.height, captured.background, backend, signal);
                if (!layout.area) return canvas;
                const overlay = await transformStoredImage(image, backend.storage, { kind: "extract", ...layout.area }, signal);
                return transformStoredImage(canvas, backend.storage, { kind: "composite", layers: [{ input: new Uint8Array(), left: layout.left, top: layout.top, blend: "over" }] }, signal, { async readImage() { return overlay; } });
            });
        } else if (!operandsOnly && (token === "-border" || token === "-frame")) {
            const geometry = parseMagickGeometry(tokens[++i] ?? (token === "-frame" ? "4x4" : "0x0")), left = Math.max(0, Math.round(geometry.width ?? (token === "-frame" ? 4 : 0))), top = Math.max(0, Math.round(geometry.height ?? left)), background = state.borderColor;
            transform(() => ({ kind: "extend", left, right: left, top, bottom: top, background, extendWith: "background" }));
        } else {
            if (!operandsOnly && ((token.startsWith("-") && token !== "-") || token.startsWith("+") || token === "(" || token === ")")) return;
            inputs++;
            const captured = { ...state }, literal = operandsOnly, maxDecodeDimension = inferMaxDecodeDimensionFromUpcomingTokens(tokens, i + 1);
            stackStep(async (stack, backend) => {
                const base = stack.length === 1 ? await stack.get(0) : undefined, lower = token.toLowerCase();
                const merge = !literal && (lower.startsWith("label:") || lower.startsWith("caption:")) && base && captured.hasSize && base.width === captured.sizeWidth && base.height === captured.sizeHeight && Object.values(captured.background).every(value => value === 255);
                const settings = merge ? { ...captured, background: { r: 0, g: 0, b: 0, a: 0 } } : captured;
                await parseStoredCompareInput(token, settings, backend, signal, { visit: async image => {
                    if (merge) await stack.set(0, await compositeStoredMagick(base, image, backend, signal, 0, 0, "over"));
                    else await stack.push(image);
                }, ...(maxDecodeDimension === undefined ? {} : { maxDecodeDimension }) }); return stack;
            });
        }
    }
    } catch (error) {
        signal.throwIfAborted();
        return { exitCode: 1, stdout: "", stderr: `magick: ${(error as Error).message}\n` };
    }
    if (scopes.length) state = scopes[0]!.state;
    if (!inputs) return;
    return withCompareFiles(input, stdinBytes, signal, async backend => {
        let image: StoredRgbaImage | undefined;
        try {
            let stack = new StoredImageStack(backend.storage, signal); const parents: StoredImageStack[] = [];
            for (const step of steps) {
                signal.throwIfAborted();
                if (typeof step !== "function") stack = await step.runStack(stack, backend, parents);
                else for (let n = 0; n < stack.length; n++) { const result = await step(await stack.get(n), backend); if (result) await stack.set(n, result); }
            }
            while (parents.length) { const parent = parents.pop()!; for (let n = 0; n < stack.length; n++) await parent.push((await stack.get(n))!); stack = parent; }
            image = await stack.get(stack.length - 1);
        }
        catch (error) {
            signal.throwIfAborted();
            if (error instanceof CompareInputFailure) throw error.reason;
            await backend.publishPending();
            return { exitCode: 1, stdout: "", stderr: `magick: ${(error as Error).message}\n` };
        }
        if (!image) { await backend.publishPending(); return { exitCode: 1, stdout: "", stderr: `magick: no images defined '${outSpec}'\n` }; }
        await yieldTurn(signal);
        const stdoutBytes = await backend.publish(image, output.path, { format: output.format, quality: state.quality });
        return { exitCode: 0, stdout: "", stderr: "", ...(stdoutBytes ? { stdoutBytes } : {}) };
    });
}

export async function runConvertCli(argv: readonly string[], files: Map<string, Uint8Array> | ConvertFileInput, stdinBytes?: Uint8Array, signal?: AbortSignal): Promise<ImageMagickCliResult> {
    if (files instanceof Map) return drainSteps(runConvertCliSteps(argv, files, stdinBytes, signal), signal);
    const active = signal ?? new AbortController().signal;
    const retained = await tryConvertFiles(argv, files, stdinBytes, active);
    if (!retained) return runBufferedImageFiles(argv, files, runConvertCli, stdinBytes, active);
    if (files.stderr && retained.stderr) { await writeIdentifyText(files.stderr, retained.stderr, active); return { ...retained, stderr: "" }; }
    return retained;
}
export function runConvertCliSync(argv: readonly string[], files: Map<string, Uint8Array>, stdinBytes?: Uint8Array, signal?: AbortSignal): ImageMagickCliResult {
    const steps = runConvertCliSteps(argv, files, stdinBytes, signal);
    let next = steps.next();
    while (!next.done) {
        next = steps.next();
    }
    return next.value;
}

function* parseMogrifySteps(argv: readonly string[]): Generator<void, { target: string; args: string[] }[], void> {
    const plans: { target: string; args: string[] }[] = [];
    let cooperativeWork = 63;
    let outFormatExt: string | undefined;
    let outDir: string | undefined;
    const opTokens: string[] = [];
    const readSettings: string[] = [];
    const targets: string[] = [];
    const flagsWithOneArg = new Set([
        "-resize",
        "-scale",
        "-sample",
        "-thumbnail",
        "-crop",
        "-extent",
        "-border",
        "-bordercolor",
        "-shave",
        "-rotate",
        "-background",
        "-fill",
        "-stroke",
        "-strokewidth",
        "-pointsize",
        "-gravity",
        "-quality",
        "-density",
        "-fuzz",
        "-filter",
        "-colorspace",
        "-grayscale",
        "-modulate",
        "-brightness-contrast",
        "-gamma",
        "-level",
        "+level",
        "-threshold",
        "-black-threshold",
        "-white-threshold",
        "-sigmoidal-contrast",
        "+sigmoidal-contrast",
        "-convolve",
        "-color-matrix",
        "-evaluate-sequence",
        "-remap",
        "-splice",
        "-chop",
        "-roll",
        "-liquid-rescale",
        "-adaptive-resize",
        "-define",
        "-write",
        "+write",
        "-compose",
        "-geometry",
        "-size",
        "-depth",
        "-units",
        "-interlace",
        "-sampling-factor",
        "-tint",
        "-colorize",
        "-blur",
        "-gaussian-blur",
        "-sharpen",
        "-unsharp",
        "-median",
        "-alpha",
        "-draw",
        "-channel",
        "-opaque",
        "+opaque",
        "-transparent",
        "+transparent",
        "-fx",
        "-shear",
        "-swirl",
        "-implode",
        "-wave",
        "-shadow",
        "-vignette",
        "-sepia-tone",
        "-solarize",
        "-posterize",
        "-colors",
        "-dither",
        "-edge",
        "-canny",
        "-emboss",
        "-charcoal",
        "-sketch"
    ]);
    for (let i = 0; i < argv.length; i++) {
        if (++cooperativeWork % 64 === 0)
            yield;
        const t = argv[i]!;
        if (t === "-format") {
            outFormatExt = (argv[++i] ?? "png").replace(/^\./, "").toLowerCase();
        }
        else if (t === "-path") {
            outDir = argv[++i];
        }
        else if (t === "-annotate") {
            const a1 = argv[++i] ?? "+0+0";
            if (hasAnnotationOffset(a1)) {
                opTokens.push("-annotate", a1, argv[++i] ?? "");
            }
            else {
                opTokens.push("-annotate", a1);
            }
        }
        else if (t === "-evaluate" ||
            t === "-function" ||
            t === "-morphology" ||
            t === "-statistic" ||
            t === "-set" ||
            t === "-distort" ||
            t === "+distort") {
            opTokens.push(t, argv[++i] ?? "", argv[++i] ?? "");
        }
        else if (["-density", "-background", "-fuzz", "-filter", "-size"].includes(t)) {
            readSettings.push(t, argv[++i] ?? "");
        }
        else if (flagsWithOneArg.has(t)) {
            opTokens.push(t, argv[++i] ?? "");
        }
        else if (t.startsWith("-") || t.startsWith("+")) {
            opTokens.push(t);
        }
        else {
            targets.push(t);
        }
    }
    for (const target of targets) {
        if (++cooperativeWork % 64 === 0)
            yield;
        const baseName = target.split("/").pop() ?? target;
        const stem = baseName.replace(/\.[^.]+$/, "");
        const origExt = baseName.includes(".") ? baseName.split(".").pop()! : "png";
        const targetExt = outFormatExt ?? origExt;
        const destDir = outDir ? outDir.replace(/\/+$/, "") : target.slice(0, Math.max(0, target.lastIndexOf("/")));
        const destPath = outFormatExt || outDir ? `${destDir ? destDir + "/" : ""}${stem}.${targetExt}` : target;
        plans.push({ target, args: [...readSettings, target, ...opTokens, destPath] });
    }
    return plans;
}
function* runMogrifyCliSteps(argv: readonly string[], files: Map<string, Uint8Array>, _stdinBytes?: Uint8Array, signal?: AbortSignal): Generator<void, ImageMagickCliResult, void> {
    for (const plan of yield* parseMogrifySteps(argv)) {
        if (!files.has(plan.target)) return { exitCode: 1, stdout: "", stderr: `mogrify: unable to open image '${plan.target}': No such file or directory\n` };
        const result = yield* runConvertCliSteps(plan.args, files, undefined, signal);
        if (result.exitCode !== 0) return result;
    }
    return { exitCode: 0, stdout: "", stderr: "" };
}
export async function runMogrifyCli(argv: readonly string[], files: Map<string, Uint8Array> | ConvertFileInput, _stdinBytes?: Uint8Array, signal?: AbortSignal): Promise<ImageMagickCliResult> {
    if (files instanceof Map) return drainSteps(runMogrifyCliSteps(argv, files, _stdinBytes, signal), signal);
    const active = signal ?? new AbortController().signal;
    let accounted = 0;
    for (const plan of await drainSteps(parseMogrifySteps(argv), active)) {
        active.throwIfAborted();
        let exists = false;
        try { exists = (await files.filesystem.stat(resolvePath(files.cwd, plan.target), { signal: active })).type === "file"; }
        catch (error) {
            active.throwIfAborted();
            if (!(error instanceof FsError) || !["ENOENT", "ENOTDIR", "EISDIR", "EACCES", "EPERM"].includes(error.code)) throw error;
        }
        if (!exists) {
            const stderr = `mogrify: unable to open image '${plan.target}': No such file or directory\n`;
            if (files.stderr) await writeIdentifyText(files.stderr, stderr, active);
            return { exitCode: 1, stdout: "", stderr: files.stderr ? "" : stderr };
        }
        let current = 0;
        const result = await runConvertCli(plan.args, { ...files, inputBudget: { check(total) { files.inputBudget?.check(accounted + total); current = total; } } }, undefined, active);
        accounted += current;
        if (result.exitCode !== 0) return result;
    }
    return { exitCode: 0, stdout: "", stderr: "" };
}
export function runMogrifyCliSync(argv: readonly string[], files: Map<string, Uint8Array>, _stdinBytes?: Uint8Array, signal?: AbortSignal): ImageMagickCliResult {
    const steps = runMogrifyCliSteps(argv, files, _stdinBytes, signal);
    let next = steps.next();
    while (!next.done) {
        next = steps.next();
    }
    return next.value;
}

function* runCompositeCliSteps(argv: readonly string[], files: Map<string, Uint8Array>, stdinBytes?: Uint8Array, signal?: AbortSignal): Generator<void, ImageMagickCliResult, void> {
    let cooperativeWork = 63;
    const options: string[] = [];
    const operands: string[] = [];
    for (let i = 0; i < argv.length; i++) {
        if (++cooperativeWork % 64 === 0)
            yield;
        const t = argv[i]!;
        if (t === "-gravity" || t === "-geometry" || t === "-compose" || t === "-background" || t === "-quality" || t === "-define") {
            options.push(t, argv[++i] ?? "");
        }
        else if (t === "-dissolve") {
            options.push("-define", `compose:args=${argv[++i] ?? "100"}`, "-compose", "Dissolve");
        }
        else if (t === "-blend" || t === "-watermark") {
            options.push("-define", `compose:args=${argv[++i] ?? "50"}`, "-compose", "Blend");
        }
        else if (t.startsWith("-")) {
            options.push(t);
        }
        else {
            operands.push(t);
        }
    }
    if (operands.length < 3) {
        return {
            exitCode: 1,
            stdout: "",
            stderr: "composite: missing an image filename\n"
        };
    }
    const overlay = operands[0]!;
    const base = operands[1]!;
    const out = operands[operands.length - 1]!;
    return (yield* runConvertCliSteps([base, overlay, ...options, "-composite", out], files, stdinBytes, signal));
}
export async function runCompositeCli(argv: readonly string[], files: Map<string, Uint8Array>, stdinBytes?: Uint8Array, signal?: AbortSignal): Promise<ImageMagickCliResult> {
    return drainSteps(runCompositeCliSteps(argv, files, stdinBytes, signal), signal);
}
export function runCompositeCliSync(argv: readonly string[], files: Map<string, Uint8Array>, stdinBytes?: Uint8Array, signal?: AbortSignal): ImageMagickCliResult {
    const steps = runCompositeCliSteps(argv, files, stdinBytes, signal);
    let next = steps.next();
    while (!next.done) {
        next = steps.next();
    }
    return next.value;
}


async function parseStoredCompareInput(token:string,state:MagickState,backend:CompareFileSession,signal:AbortSignal,readOptions:{lastPage?:boolean;maxDecodeDimension?:number;visit?:(image:StoredRgbaImage)=>Promise<void>}={}):Promise<StoredRgbaImage|undefined>{
 const {baseToken,pageSpec,inlineGeom}=parseInputToken(token),lower=baseToken.toLowerCase();let image:StoredRgbaImage|undefined;
 if(lower.startsWith("tile:")){
  if(readOptions.visit){
   await parseStoredCompareInput(baseToken.slice(5),state,backend,signal,{visit:async pattern=>{image=await finish(await tile(pattern));await readOptions.visit!(image);}});
   return image;
  }
  const pattern=await parseStoredCompareInput(baseToken.slice(5),state,backend,signal,{lastPage:readOptions.lastPage===true});if(!pattern)return;
  image=await tile(pattern);
 }else if(lower.startsWith("xc:")||lower.startsWith("canvas:")||lower==="null:"){
  const color=lower==="null:"?{r:0,g:0,b:0,a:0}:parseColor(baseToken.slice(baseToken.indexOf(":")+1)||"white"),width=lower==="null:"?1:state.sizeWidth,height=lower==="null:"?1:state.sizeHeight;
  image=await createStoredCanvas(width,height,color,backend,signal);
 }else if(lower.startsWith("gradient:")||lower.startsWith("radial-gradient:")||lower.startsWith("pattern:")||lower.startsWith("plasma:")){
  const width=Math.max(1,Math.round(state.sizeWidth)),height=Math.max(1,Math.round(state.sizeHeight)),position=backend.storage.allocate(width*height*4);
  const checker=lower.startsWith("pattern:")||lower.startsWith("plasma:"),radial=lower.startsWith("radial-gradient:");
  const [first,last]=baseToken.slice(baseToken.indexOf(":")+1).split("-"),a=parseColor(checker?"white":first||"#ffffff"),b=parseColor(checker?"black":last||"#000000");
  const cx=(width-1)/2,cy=(height-1)/2,radius=Math.max(1,Math.hypot(cx,cy));
  for(let start=0;start<width*height;start+=4096){
   if(start%262144===0)await yieldTurn(signal);
   const count=Math.min(4096,width*height-start),bytes=new Uint8Array(count*4);
   for(let i=0;i<count;i++){
    const x=(start+i)%width,y=Math.floor((start+i)/width),offset=i*4;
    if(checker){const cell=((Math.floor(x/8)+Math.floor(y/8))&1)===0?102:153;bytes[offset]=cell;bytes[offset+1]=cell;bytes[offset+2]=cell;bytes[offset+3]=255;}
    else{const t=radial?Math.min(1,Math.hypot(x-cx,y-cy)/radius):height<=1?0:y/(height-1);bytes[offset]=clampByteVal(a.r*(1-t)+b.r*t);bytes[offset+1]=clampByteVal(a.g*(1-t)+b.g*t);bytes[offset+2]=clampByteVal(a.b*(1-t)+b.b*t);bytes[offset+3]=clampByteVal(a.a*(1-t)+b.a*t);}
   }
   await backend.storage.write(position+start*4,bytes);
  }
  image={position,width,height,format:"png",channels:4,depth:"uchar",space:"srgb",density:72,hasAlpha:true};
 }else if(lower.startsWith("label:")||lower.startsWith("caption:")){
  image=await decodeStoredMagickSvg(createLabelSvg(baseToken.slice(baseToken.indexOf(":")+1),state),state.density,backend,signal);
 }else{
  const generated=await drainSteps(parseInputOperandSteps(baseToken,new Map(),state),signal);
  if(generated)image=await backend.retain(generated);
  else{
   let path=baseToken;const colon=path.indexOf(":");if(colon>0&&extToImageFormat(path.slice(0,colon)))path=path.slice(colon+1);
   if(readOptions.visit){
    await backend.load(path,function*(metadata){const total=metadata?.pages&&metadata.pages>1?metadata.pages:1;const maxDecodeDimension=inferMaxDecodeDimensionFromUpcomingTokens([],0,inlineGeom)??readOptions.maxDecodeDimension;for(const page of selectedInputPages(pageSpec,total))yield {density:state.density,...(total>1||pageSpec!==undefined?{page}:{}),...(maxDecodeDimension===undefined?{}:{maxDecodeDimension})};},async(frame,configured,metadata,byteLength)=>{image=await finish(Object.assign(frame,{[magickInput]:{filePath:path,byteLen:byteLength,originalWidth:metadata?.width??frame.width,originalHeight:metadata?.height??frame.height,sceneIdx:configured.page??0}}));await readOptions.visit!(image);});
    return image;
   }
   image=await backend.load(path,metadata=>{const total=metadata?.pages&&metadata.pages>1?metadata.pages:1,pages=selectedInputPages(pageSpec,total);let page=pages.next().value??0;if(readOptions.lastPage){for(const selected of pages)page=selected;}pages.return(undefined);const maxDecodeDimension=inferMaxDecodeDimensionFromUpcomingTokens([],0,inlineGeom)??readOptions.maxDecodeDimension;return {density:state.density,...(total>1||pageSpec!==undefined?{page}:{}),...(maxDecodeDimension===undefined?{}:{maxDecodeDimension})};});
  }
 }
 if(image){image=await finish(image);await readOptions.visit?.(image);}
 return image;
 async function tile(pattern:StoredRgbaImage):Promise<StoredRgbaImage>{
  const width=state.sizeWidth,height=state.sizeHeight,position=backend.storage.allocate(width*height*4);
  let cachedPosition=-1,cached:Uint8Array=new Uint8Array();
  for(let start=0;start<width*height;start+=4096){
   if(start%262144===0)await yieldTurn(signal);
   const count=Math.min(4096,width*height-start),bytes=new Uint8Array(count*4);
   for(let offset=0;offset<count;){
    const x=(start+offset)%width,y=Math.floor((start+offset)/width),px=x%pattern.width,py=y%pattern.height,blockX=Math.floor(px/4096)*4096;
    const sourcePosition=pattern.position+(py*pattern.width+blockX)*4;
    if(cachedPosition!==sourcePosition){cached=await backend.storage.read(sourcePosition,Math.min(4096,pattern.width-blockX)*4);cachedPosition=sourcePosition;}
    const sourceOffset=px-blockX,take=Math.min(count-offset,width-x,pattern.width-px,cached.length/4-sourceOffset);
    bytes.set(cached.subarray(sourceOffset*4,(sourceOffset+take)*4),offset*4);offset+=take;
   }
   await backend.storage.write(position+start*4,bytes);
  }
  return {position,width,height,format:"png",channels:4,depth:"uchar",space:"srgb",density:72,hasAlpha:true};

 }
 async function finish(image:StoredRgbaImage):Promise<StoredRgbaImage>{
 if(inlineGeom){const geometry=parseMagickGeometry(inlineGeom);if(geometry.hasOffset){const area=magickCropArea(image,inlineGeom,"northwest");if(area)image=await transformStoredImage(image,backend.storage,{kind:"extract",...area},signal);}else{const resize=magickResizeOptions(image,inlineGeom,state.kernel);if(resize)image=await transformStoredImage(image,backend.storage,{kind:"resize",...resize},signal);}}
 return image;
 }
}

function* runCompareCliSteps(argv: readonly string[], files: Map<string, Uint8Array>, stdinBytes?: Uint8Array, signal?: AbortSignal,backend?:CompareFileSession): Generator<IdentifyStep, ImageMagickCliResult, void> {
    let cooperativeWork = 63;
    const state = createDefaultState();
    state.fuzz = 0;
    let metric = "rmse";
    let highlightColor: RgbaColor = { r: 241, g: 0, b: 30, a: 255 };
    let lowlightColor: RgbaColor | undefined;
    let composeSrc = false;
    let dissimilarityThreshold: number | undefined;
    const operands: string[] = [];
    for (let i = 0; i < argv.length; i++) {
        if (++cooperativeWork % 64 === 0)
            yield;
        const t = argv[i]!;
        if (t === "--help" || t === "-help" || t === "-h") {
            return {
                exitCode: 0,
                stdout: "Usage: compare [-metric AE|MAE|MSE|RMSE|PSNR|SSIM|PAE|NCC] [-fuzz value%] [-highlight-color color] [-lowlight-color color] reference.png candidate.png diff.png\n",
                stderr: ""
            };
        }
        else if (t === "-metric") {
            metric = (argv[++i] ?? "rmse").toLowerCase();
        }
        else if (t === "-fuzz") {
            const rawFuzz = argv[++i] ?? "0";
            state.fuzz = rawFuzz.endsWith("%")
                ? (parseFloat(rawFuzz) / 100) * 255
                : parseFloat(rawFuzz);
        }
        else if (t === "-highlight-color") {
            highlightColor = parseColor(argv[++i] ?? "#f1001e");
        }
        else if (t === "-lowlight-color") {
            lowlightColor = parseColor(argv[++i] ?? "#ffffff");
        }
        else if (t === "-compose") {
            const cm = (argv[++i] ?? "over").toLowerCase();
            if (cm === "src" || cm === "source" || cm === "copy")
                composeSrc = true;
        }
        else if (t === "-dissimilarity-threshold") {
            dissimilarityThreshold = Number(argv[++i] ?? 1);
        }
        else if (t === "-density") {
            const g = parseMagickGeometry(argv[++i] ?? "72");
            state.density = Math.max(1, Math.round(g.width ?? 72));
        }
        else if (t === "-quality") {
            state.quality = Math.max(1, Math.min(100, Number(argv[++i] ?? 92)));
        }
        else if (t.startsWith("-") && t.length > 1) {
            // Skip optional flags with arguments if recognized
            if (t === "-format" || t === "-alpha" || t === "-channel")
                i++;
        }
        else {
            operands.push(t);
        }
    }
    if (operands.length < 2) {
        return {
            exitCode: 2,
            stdout: "",
            stderr: "compare: missing an image filename\n"
        };
    }
    const refSpec = operands[0]!;
    const candSpec = operands[1]!;
    const outSpec = operands[2] ?? "null:";
    let imgA: RgbaImage | StoredRgbaImage | undefined;
    let imgB: RgbaImage | StoredRgbaImage | undefined;
    try {
        if(backend)yield {async run(){imgA=await parseStoredCompareInput(refSpec,state,backend,signal!);}};else imgA = (yield* parseInputOperandSteps(refSpec, files, state, stdinBytes));
        if (typeof (globalThis as { gc?: () => void }).gc === "function") { try { const gc = (globalThis as { gc?: () => void }).gc!; gc(); } catch { /* Collection is best-effort. */ } }
        if(backend)yield {async run(){imgB=await parseStoredCompareInput(candSpec,state,backend,signal!);}};else imgB = (yield* parseInputOperandSteps(candSpec, files, state, stdinBytes));
    }
    catch (err) {
        signal?.throwIfAborted();if(err instanceof CompareInputFailure)throw err.reason;
        return {
            exitCode: 2,
            stdout: "",
            stderr: `compare: improper image header: ${(err as Error).message}\n`
        };
    }
    if (!imgA) {
        return {
            exitCode: 2,
            stdout: "",
            stderr: `compare: unable to open image '${refSpec}': No such file or directory\n`
        };
    }
    if (!imgB) {
        return {
            exitCode: 2,
            stdout: "",
            stderr: `compare: unable to open image '${candSpec}': No such file or directory\n`
        };
    }
    const width=Math.max(imgA.width,imgB.width),height=Math.max(imgA.height,imgB.height);
    const diff=outSpec.toLowerCase()!=="null:",diffPosition=backend&&diff?backend.storage.allocate(width*height*4):undefined;
    const diffData=!backend&&diff?new Uint8Array(width*height*4):undefined;
    const comparison=compareImageSteps(imgA,imgB,{metric,fuzz:state.fuzz,highlightColor,composeSrc,diff,...(lowlightColor?{lowlightColor}:{}),...(dissimilarityThreshold===undefined?{}:{dissimilarityThreshold})});
    let compared=comparison.next();
    try{while(!compared.done){const request=compared.value;
      if(!request){yield;compared=comparison.next();}
      else if(request.kind==="read"){const image=request.image===0?imgA:imgB;let bytes:Uint8Array;if("data" in image)bytes=image.data.subarray(request.position,request.position+request.length);else {yield {async run(){bytes=await backend!.storage.read(image.position+request.position,request.length);}};}compared=comparison.next(bytes!);}
      else{if(backend)yield {async run(){await backend.storage.write(diffPosition!+request.position,request.data);}};else diffData!.set(request.data,request.position);compared=comparison.next();}
    }}finally{comparison.return(undefined as never);}
    const {metric:metricStr,exitCode}=compared.value;
    if("data" in imgA)detachRgbaBuffer(imgA.data);if("data" in imgB)detachRgbaBuffer(imgB.data);
    if(backend&&diff){const {format,path}=inferOutputFormat(outSpec,"png");let stdoutBytes:Uint8Array|undefined;yield {async run(){stdoutBytes=await backend.publish({width,height,format:"png",channels:4,depth:"uchar",density:state.density,space:"srgb",hasAlpha:true,position:diffPosition!},path,{format,quality:state.quality});}};return {exitCode,stdout:"",stderr:`${metricStr}\n`,...(stdoutBytes?{stdoutBytes}:{})};}
    if (diffData) {
        const diffImg: RgbaImage = {
            width,
            height,
            format: "png",
            channels: 4,
            depth: "uchar",
            density: state.density,
            space: "srgb",
            hasAlpha: true,
            data: diffData
        };
        const { format, path: outPath } = inferOutputFormat(outSpec, "png");
        const { data: encoded } = encodeImage(diffImg, { format, quality: state.quality, consumeInput: true } as any);
        detachRgbaBuffer(diffData);
        if (outPath === "-" || outSpec.endsWith(":-")) {
            return {
                exitCode,
                stdout: "",
                stderr: `${metricStr}\n`,
                stdoutBytes: encoded
            };
        }
        files.set(outPath, encoded);
    }
    return {
        exitCode,
        stdout: "",
        stderr: `${metricStr}\n`
    };
}
export async function runCompareCli(argv: readonly string[], files: Map<string, Uint8Array>|CompareFileInput, stdinBytes?: Uint8Array, signal?: AbortSignal): Promise<ImageMagickCliResult> {
 if(files instanceof Map)return drainIdentifySteps(runCompareCliSteps(argv,files,stdinBytes,signal),signal);
 const active=signal??new AbortController().signal;return withCompareFiles(files,stdinBytes,active,backend=>drainIdentifySteps(runCompareCliSteps(argv,new Map(),stdinBytes,active,backend),active));
}
export function runCompareCliSync(argv: readonly string[], files: Map<string, Uint8Array>, stdinBytes?: Uint8Array, signal?: AbortSignal): ImageMagickCliResult {
    const steps = runCompareCliSteps(argv, files, stdinBytes, signal);
    let next = steps.next();
    while (!next.done) {
        next = steps.next();
    }
    return next.value;
}

function* runMontageCliSteps(argv: readonly string[], files: Map<string, Uint8Array>, stdinBytes?: Uint8Array, signal?: AbortSignal): Generator<void, ImageMagickCliResult, void> {
    let cooperativeWork = 63;
    const state = createDefaultState();
    let tileCols: number | undefined;
    let tileRows: number | undefined;
    let cellW: number | undefined;
    let cellH: number | undefined;
    let padX = 2;
    let padY = 2;
    let borderW = 0;
    const operands: string[] = [];
    for (let i = 0; i < argv.length; i++) {
        if (++cooperativeWork % 64 === 0)
            yield;
        const t = argv[i]!;
        if (t === "-tile") {
            const g = parseMagickGeometry(argv[++i] ?? "2x2");
            tileCols = g.width;
            tileRows = g.height;
        }
        else if (t === "-geometry") {
            const g = parseMagickGeometry(argv[++i] ?? "+2+2");
            cellW = g.width;
            cellH = g.height;
            if (g.hasOffset) {
                padX = Math.max(0, Math.round(g.x));
                padY = Math.max(0, Math.round(g.y));
            }
        }
        else if (t === "-background") {
            state.background = parseColor(argv[++i] ?? "#ffffff");
        }
        else if (t === "-bordercolor") {
            state.borderColor = parseColor(argv[++i] ?? "#dfdfdf");
        }
        else if (t === "-border") {
            borderW = Math.max(0, Math.round(Number(argv[++i] ?? 0)));
        }
        else if (t === "-gravity") {
            state.gravity = parseGravity(argv[++i] ?? "center");
        }
        else if (t === "-quality") {
            state.quality = Math.max(1, Math.min(100, Number(argv[++i] ?? 92)));
        }
        else if (t === "-mode" || t === "-label" || t === "-title") {
            i++;
        }
        else if (!t.startsWith("-")) {
            operands.push(t);
        }
    }
    if (operands.length < 2) {
        return {
            exitCode: 1,
            stdout: "",
            stderr: "montage: missing an image filename\n"
        };
    }
    const outSpec = operands[operands.length - 1]!;
    const inPaths = operands.slice(0, -1);
    const fastMetaDims: { width: number; height: number }[] = [];
    let canStreamTiles = cellW === undefined && cellH === undefined;
    if (canStreamTiles) {
        for (const p of inPaths) {
            const rawBytes = files.get(p);
            if (!rawBytes || p.includes("[") || p.includes(":") || rawBytes[0] === 0x47) {
                canStreamTiles = false;
                break;
            }
            try {
                const meta = readImageMetadata(rawBytes);
                if (!meta.width || !meta.height) {
                    canStreamTiles = false;
                    break;
                }
                fastMetaDims.push({ width: meta.width + borderW * 2, height: meta.height + borderW * 2 });
            } catch {
                canStreamTiles = false;
                break;
            }
        }
    }

    let canvas: RgbaImage;
    let anyTransparent = state.background.a < 255 || (borderW > 0 && state.borderColor.a < 255);

    if (canStreamTiles && fastMetaDims.length === inPaths.length) {
        const n = fastMetaDims.length;
        const cols = tileCols ?? (tileRows ? Math.ceil(n / tileRows) : Math.ceil(Math.sqrt(n)));
        const rows = tileRows ?? Math.ceil(n / cols);
        const maxThumbW = Math.max(0, ...fastMetaDims.map((d) => d.width));
        const maxThumbH = Math.max(0, ...fastMetaDims.map((d) => d.height));
        const slotW = maxThumbW + padX * 2;
        const slotH = maxThumbH + padY * 2;
        const canvasW = Math.max(1, cols * slotW);
        const canvasH = Math.max(1, rows * slotH);
            if (typeof (globalThis as { gc?: () => void }).gc === "function") { try { const gc = (globalThis as { gc?: () => void }).gc!; gc(); gc(); } catch { /* Optional host GC hints must not interrupt image processing. */ } }
        canvas = (yield* createSolidRgbaImageSteps(canvasW, canvasH, state.background));
        for (let idx = 0; idx < inPaths.length; idx++) {
            const col = idx % cols;
            const row = Math.floor(idx / cols);
            if (row >= rows) break;
            const p = inPaths[idx]!;
            const effW = fastMetaDims[idx]!.width;
            const effH = fastMetaDims[idx]!.height;
            const rawTileW = effW - borderW * 2;
            const rawTileH = effH - borderW * 2;
            const cellX = col * slotW + padX;
            const cellY = row * slotH + padY;
            const off = resolveGravityOffset(maxThumbW - effW, maxThumbH - effH, state.gravity);
            const dstX = cellX + off.left;
            const dstY = cellY + off.top;
            if (borderW > 0 && state.borderColor.a > 0) {
                const bc = state.borderColor;
                const x0 = Math.max(0, dstX);
                const y0 = Math.max(0, dstY);
                const x1 = Math.min(canvas.width, dstX + effW);
                const y1 = Math.min(canvas.height, dstY + effH);
                const ix0 = dstX + borderW;
                const iy0 = dstY + borderW;
                const ix1 = ix0 + rawTileW;
                const iy1 = iy0 + rawTileH;
                for (let by = y0; by < y1; by++) {
                    const inY = by >= iy0 && by < iy1;
                    for (let bx = x0; bx < x1; bx++) {
                        if (inY && bx >= ix0 && bx < ix1) {
                            bx = ix1 - 1;
                            continue;
                        }
                        const di = (by * canvas.width + bx) * 4;
                        if (bc.a === 255) {
                            canvas.data[di] = bc.r;
                            canvas.data[di + 1] = bc.g;
                            canvas.data[di + 2] = bc.b;
                            canvas.data[di + 3] = 255;
                        } else {
                            const sa = bc.a / 255;
                            const da = (canvas.data[di + 3] ?? 0) / 255;
                            const outA = sa + da * (1 - sa);
                            if (outA > 0) {
                                canvas.data[di] = Math.round((bc.r * sa + (canvas.data[di] ?? 0) * da * (1 - sa)) / outA);
                                canvas.data[di + 1] = Math.round((bc.g * sa + (canvas.data[di + 1] ?? 0) * da * (1 - sa)) / outA);
                                canvas.data[di + 2] = Math.round((bc.b * sa + (canvas.data[di + 2] ?? 0) * da * (1 - sa)) / outA);
                                canvas.data[di + 3] = Math.round(outA * 255);
                            }
                        }
                    }
                }
            }
            const rawTileBytes = files.get(p);
            const directPng = rawTileBytes ? decodePngToCanvas(rawTileBytes, canvas, dstX + borderW, dstY + borderW) : undefined;
            if (directPng) {
                if (directPng.anyTransparent) anyTransparent = true;
                continue;
            }
            let loadedList: RgbaImage[] | undefined;
            try {
                loadedList = (yield* parseInputOperandsSteps(p, files, state, stdinBytes));
            } catch (err) {
                detachRgbaBuffer(canvas.data);
                return {
                    exitCode: 1,
                    stdout: "",
                    stderr: `montage: improper image header '${p}': ${(err as Error).message}\n`
                };
            }
            const im = loadedList?.[0];
            if (!im) {
                detachRgbaBuffer(canvas.data);
                return {
                    exitCode: 1,
                    stdout: "",
                    stderr: `montage: unable to open image '${p}': No such file or directory\n`
                };
            }
            if (!anyTransparent) {
                for (let k = 3; k < im.data.length; k += 4) {
                    if (im.data[k]! < 255) { anyTransparent = true; break; }
                }
            }
            yield* blitOverRgbaInPlaceSteps(canvas, im, dstX + borderW, dstY + borderW);
            detachRgbaBuffer(im.data);
        }
    } else {
        const images: RgbaImage[] = [];
        for (const p of inPaths) {
            yield;
            let loadedList: RgbaImage[] | undefined;
            try {
                loadedList = (yield* parseInputOperandsSteps(p, files, state, stdinBytes));
            }
            catch (err) {
                return {
                    exitCode: 1,
                    stdout: "",
                    stderr: `montage: improper image header '${p}': ${(err as Error).message}\n`
                };
            }
            if (!loadedList || loadedList.length === 0) {
                return {
                    exitCode: 1,
                    stdout: "",
                    stderr: `montage: unable to open image '${p}': No such file or directory\n`
                };
            }
            for (const loaded of loadedList) {
                if (++cooperativeWork % 64 === 0)
                    yield;
                let thumb = loaded;
                if (cellW !== undefined || cellH !== undefined) {
                    const geomSpec = `${cellW ?? ""}${cellH !== undefined ? "x" + cellH : ""}`;
                    thumb = (yield* applyMagickResizeSteps(thumb, geomSpec, state.kernel));
                    if (thumb !== loaded) detachRgbaBuffer(loaded.data);
                }
                if (borderW > 0) {
                    const prev = thumb;
                    thumb = (yield* extendImageSteps(thumb, {
                        top: borderW,
                        bottom: borderW,
                        left: borderW,
                        right: borderW,
                        background: state.borderColor,
                        extendWith: "background"
                    }));
                    if (thumb !== prev) detachRgbaBuffer(prev.data);
                }
                images.push(thumb);
            }
        }
        const n = images.length;
        const cols = tileCols ?? (tileRows ? Math.ceil(n / tileRows) : Math.ceil(Math.sqrt(n)));
        const rows = tileRows ?? Math.ceil(n / cols);
        const maxThumbW = Math.max(cellW ?? 0, ...images.map((im) => im.width));
        const maxThumbH = Math.max(cellH ?? 0, ...images.map((im) => im.height));
        const slotW = maxThumbW + padX * 2;
        const slotH = maxThumbH + padY * 2;
        const canvasW = Math.max(1, cols * slotW);
        const canvasH = Math.max(1, rows * slotH);
        canvas = (yield* createSolidRgbaImageSteps(canvasW, canvasH, state.background));
        for (let idx = 0; idx < images.length; idx++) {
            if (++cooperativeWork % 64 === 0)
                yield;
            const col = idx % cols;
            const row = Math.floor(idx / cols);
            if (row >= rows)
                break;
            const im = images[idx]!;
            images[idx] = undefined as unknown as RgbaImage;
            if (!anyTransparent) {
                for (let k = 3; k < im.data.length; k += 4) {
                    if (im.data[k]! < 255) { anyTransparent = true; break; }
                }
            }
            const cellX = col * slotW + padX;
            const cellY = row * slotH + padY;
            const off = resolveGravityOffset(maxThumbW - im.width, maxThumbH - im.height, state.gravity);
            yield* blitOverRgbaInPlaceSteps(canvas, im, cellX + off.left, cellY + off.top);
            detachRgbaBuffer(im.data);
        }
        images.length = 0;
    }
    if (!anyTransparent) {
        (canvas as { hasAlpha?: boolean; channels?: number }).hasAlpha = false;
        (canvas as { hasAlpha?: boolean; channels?: number }).channels = 3;
    }
    const { format, path: outPath } = inferOutputFormat(outSpec, "png");
    if (typeof (globalThis as { gc?: () => void }).gc === "function") { try { const gc = (globalThis as { gc?: () => void }).gc!; gc(); gc(); } catch { /* Optional host GC hints must not interrupt image processing. */ } }
    const { data: encoded } = encodeImage(canvas, { format, quality: state.quality, consumeInput: true } as any);
    detachRgbaBuffer(canvas.data);
    if (outPath === "-" || outSpec.endsWith(":-")) {
        return { exitCode: 0, stdout: "", stderr: "", stdoutBytes: encoded };
    }
    files.set(outPath, encoded);
    return { exitCode: 0, stdout: "", stderr: "" };
}
export async function runMontageCli(argv: readonly string[], files: Map<string, Uint8Array>, stdinBytes?: Uint8Array, signal?: AbortSignal): Promise<ImageMagickCliResult> {
    return drainSteps(runMontageCliSteps(argv, files, stdinBytes, signal), signal);
}
export function runMontageCliSync(argv: readonly string[], files: Map<string, Uint8Array>, stdinBytes?: Uint8Array, signal?: AbortSignal): ImageMagickCliResult {
    const steps = runMontageCliSteps(argv, files, stdinBytes, signal);
    let next = steps.next();
    while (!next.done) {
        next = steps.next();
    }
    return next.value;
}



function* runMagickCliSteps(argv: readonly string[], files: Map<string, Uint8Array>, stdinBytes?: Uint8Array, signal?: AbortSignal): Generator<IdentifyStep, ImageMagickCliResult, void> {
    const sub = argv[0];
    if (sub === "identify") {
        return (yield* runIdentifyCliSteps(argv.slice(1), files, stdinBytes, signal));
    }
    if (sub === "mogrify") {
        return (yield* runMogrifyCliSteps(argv.slice(1), files, undefined, signal));
    }
    if (sub === "composite") {
        return (yield* runCompositeCliSteps(argv.slice(1), files, stdinBytes, signal));
    }
    if (sub === "montage") {
        return (yield* runMontageCliSteps(argv.slice(1), files, stdinBytes, signal));
    }
    if (sub === "compare") {
        return (yield* runCompareCliSteps(argv.slice(1), files, stdinBytes, signal));
    }
    if (sub === "convert") {
        return (yield* runConvertCliSteps(argv.slice(1), files, stdinBytes, signal));
    }
    return (yield* runConvertCliSteps(argv, files, stdinBytes, signal));
}
export async function runMagickCli(argv: readonly string[], files: Map<string, Uint8Array> | ConvertFileInput, stdinBytes?: Uint8Array, signal?: AbortSignal): Promise<ImageMagickCliResult> {
    if (files instanceof Map) return drainIdentifySteps(runMagickCliSteps(argv, files, stdinBytes, signal), signal);
    if (argv[0] === "identify") return runIdentifyCli(argv.slice(1), files, stdinBytes, signal);
    if (argv[0] === "compare") return runCompareCli(argv.slice(1), files, stdinBytes, signal);
    if (argv[0] === "mogrify") return runMogrifyCli(argv.slice(1), files, stdinBytes, signal);
    if (["composite", "montage"].includes(argv[0] ?? "")) return runBufferedImageFiles(argv, files, runMagickCli, stdinBytes, signal ?? new AbortController().signal);
    return runConvertCli(argv[0] === "convert" ? argv.slice(1) : argv, files, stdinBytes, signal);
}
export function runMagickCliSync(argv: readonly string[], files: Map<string, Uint8Array>, stdinBytes?: Uint8Array, signal?: AbortSignal): ImageMagickCliResult {
    const steps = runMagickCliSteps(argv, files, stdinBytes, signal);
    let next = steps.next();
    while (!next.done) {
        next = steps.next();
    }
    return next.value;
}

async function runBufferedImageFiles(argv: readonly string[], input: ConvertFileInput, runner: (argv: readonly string[], files: Map<string, Uint8Array>, stdinBytes?: Uint8Array, signal?: AbortSignal) => Promise<ImageMagickCliResult>, stdinBytes: Uint8Array | undefined, signal: AbortSignal): Promise<ImageMagickCliResult> {
    const context = { fs: input.filesystem, cwd: input.cwd, signal, stdin: input.stdin ?? (async function* () {})(), ...(input.registerCleanup ? { registerCleanup: input.registerCleanup } : {}) };
    const vfsFiles = new Map<string, Uint8Array>();
    let cooperativeWork = 63, accountedBytes = 0;
    const chargeInput = (bytes: number) => { accountedBytes += bytes; input.inputBudget?.check(accountedBytes); };
    if (stdinBytes) chargeInput(stdinBytes.length);
    let needsStdin = false;
    const hasOutputOperand = runner !== runIdentifyCli && !(runner === runMagickCli && argv[0] === "identify");
    let operandsOnly = false;
    for (const [index, token] of argv.entries()) {
      if (++cooperativeWork % 64 === 0) await yieldTurn(context.signal);
      if (!operandsOnly && token === "--") { operandsOnly = true; continue; }
      if (token === "-" || token.endsWith(":-")) {
        if (!hasOutputOperand || index < argv.length - 1) needsStdin = true;
        continue;
      }
      if (!operandsOnly && (token.startsWith("-") || token.startsWith("+") || token === "(" || token === ")")) continue;
      let candidate = token.toLowerCase().startsWith("tile:") ? token.slice(5) : token;
      const prefixMatch = /^([a-zA-Z0-9]+):(.*)$/.exec(candidate);
      if (prefixMatch && extToImageFormat(prefixMatch[1]!)) {
        candidate = prefixMatch[2]!;
      }
      const bracketMatch = /^(.*)\[([^\]]+)\]$/.exec(candidate);
      if (bracketMatch) {
        candidate = bracketMatch[1]!;
      }
      let bytes: Uint8Array;
      try {
        bytes = await context.fs.readFile(resolvePath(context.cwd, candidate), {
          signal: signal
        });
      } catch (error) {
        if (!(error instanceof FsError) || !["ENOENT", "ENOTDIR", "EISDIR", "EACCES", "EPERM"].includes(error.code)) throw error;
        // Output file or pseudo-operand
        continue;
      }
      chargeInput(bytes.byteLength);
      vfsFiles.set(candidate, bytes);
    }


    if (needsStdin && stdinBytes === undefined) {
      const chunks: Uint8Array[] = [];
      let total = 0;
      for await (const chunk of readBytes(context.stdin, signal)) {
      if (++cooperativeWork % 64 === 0) await yieldTurn(context.signal);
        chargeInput(chunk.byteLength);
        chunks.push(chunk);
        total += chunk.byteLength;
      }
      stdinBytes = new Uint8Array(total);
      let off = 0;
      for (const chunk of chunks) {
      if (++cooperativeWork % 64 === 0) await yieldTurn(context.signal);
        stdinBytes.set(chunk, off);
        off += chunk.byteLength;
      }
    }
    input.inputBudget?.check(accountedBytes);
    const existingSnap = new Map(vfsFiles);
    const res = await runner(argv, vfsFiles, stdinBytes, signal);
    let delivered = res;
    if (input.stderr && res.stderr) { await writeIdentifyText(input.stderr, res.stderr, signal); delivered = { ...delivered, stderr: "" }; }
    if (input.stdout) {
        if (res.stdoutBytes) await writeBytes(input.stdout, res.stdoutBytes, signal);
        else if (res.stdout) await writeIdentifyText(input.stdout, res.stdout, signal);
        const { stdoutBytes: ignored, ...result } = delivered;
        delivered = { ...result, stdout: "" };
    }
    for (const [key, val] of vfsFiles.entries()) {
      if (++cooperativeWork % 64 === 0) await yieldTurn(context.signal);
      if (existingSnap.get(key) !== val) {
        const abs = resolvePath(context.cwd, key);
        await writeFileOutput(context, val, data => context.fs.writeFile(abs, data, { signal: signal }));
      }
    }
    vfsFiles.clear();
    existingSnap.clear();
    if (typeof (globalThis as { gc?: () => void }).gc === "function") { try { const gc = (globalThis as { gc?: () => void }).gc!; gc(); gc(); } catch { /* Optional host GC hints must not interrupt image processing. */ } }
    return delivered;
}

async function executeVfsMagickTool(
  context: CommandContext,
  runner: (
    argv: readonly string[],
    files: Map<string, Uint8Array>,
    stdinBytes?: Uint8Array,
    signal?: AbortSignal
  ) => Promise<ImageMagickCliResult>,
  maxInputBytes: number
): Promise<{ exitCode: number }> {
  const invocation = createOutputOperation(context, { write: async () => {} });
  try {
    const carrier = getCommandArguments(context);
    const argv = [...carrier.args];
    const budget = new InputByteBudget(maxInputBytes);
    let accountedBytes = 0;
    const chargeInput = (bytes: number) => {
      budget.charge(bytes);
      accountedBytes += bytes;
      context.inputBudget?.check(accountedBytes);
    };
    if(runner===runCompareCli||(runner===runMagickCli&&argv[0]==="compare")){
      const result=await runCompareCli(runner===runMagickCli?argv.slice(1):argv,{filesystem:context.fs,cwd:context.cwd,stdin:context.stdin,stdout:invocation.child(context.stdout).output,...(context.registerCleanup?{registerCleanup:context.registerCleanup}:{}),inputBudget:{check(total){chargeInput(total-accountedBytes);}}},undefined,invocation.signal);
      if(result.stderr)await writeBytes(context.stderr,new TextEncoder().encode(result.stderr),invocation.signal);
      if(result.stdout)await writeBytes(invocation.child(context.stdout).output,new TextEncoder().encode(result.stdout),invocation.signal);
      return {exitCode:result.exitCode};
    }
    if(runner===runIdentifyCli||(runner===runMagickCli&&argv[0]==="identify")){
      const result=await runIdentifyCli(runner===runMagickCli?argv.slice(1):argv,{filesystem:context.fs,cwd:context.cwd,stdin:context.stdin,stdout:invocation.child(context.stdout).output,stderr:context.stderr,inputBudget:{check(total){chargeInput(total-accountedBytes);}}},undefined,invocation.signal);
      if(result.stderr)await writeBytes(context.stderr,new TextEncoder().encode(result.stderr),invocation.signal);
      if(result.stdout)await writeBytes(invocation.child(context.stdout).output,new TextEncoder().encode(result.stdout),invocation.signal);
      return {exitCode:result.exitCode};
    }
    const fileInput: ConvertFileInput = { filesystem: context.fs, cwd: context.cwd, stdin: context.stdin, stderr: context.stderr, stdout: invocation.child(context.stdout).output, ...(context.registerCleanup ? { registerCleanup: context.registerCleanup } : {}), inputBudget: { check(total) { chargeInput(total - accountedBytes); } } };
    const isConvert = runner === runConvertCli || (runner === runMagickCli && !["mogrify", "composite", "montage"].includes(argv[0] ?? ""));
    const isMogrify = runner === runMogrifyCli || (runner === runMagickCli && argv[0] === "mogrify");
    const res = isConvert ? await runConvertCli(runner === runMagickCli && argv[0] === "convert" ? argv.slice(1) : argv, fileInput, undefined, invocation.signal)
        : isMogrify ? await runMogrifyCli(runner === runMagickCli ? argv.slice(1) : argv, fileInput, undefined, invocation.signal)
        : await runBufferedImageFiles(argv, fileInput, runner, undefined, invocation.signal);

    if (res.stderr) {
      await writeBytes(context.stderr, new TextEncoder().encode(res.stderr), invocation.signal);
    }
    if (res.stdoutBytes) {
      const stdout = invocation.child(context.stdout);
      await writeBytes(stdout.output, res.stdoutBytes, invocation.signal);
    } else if (res.stdout) {
      const stdout = invocation.child(context.stdout);
      await writeBytes(stdout.output, new TextEncoder().encode(res.stdout), invocation.signal);
    }

    return { exitCode: res.exitCode };
  } finally {
    await invocation.close();
  }
}

export function createMagickCommand(options: ImageMagickCommandOptions = {}): CommandDefinition {
  const maxInputBytes = InputByteBudget.limit(options.limits?.maxInputBytes);
  return Object.freeze({
    name: "magick",
    runtimeIdentity: commandRuntimeIdentity,
    description: "ImageMagick v7 image processor powered by @poe-code/image-ast",
    execute(context: CommandContext) {
      return executeVfsMagickTool(context, runMagickCli, maxInputBytes);
    }
  });
}

export const magickCommand: CommandDefinition = createMagickCommand();

export function createConvertCommand(options: ImageMagickCommandOptions = {}): CommandDefinition {
  const maxInputBytes = InputByteBudget.limit(options.limits?.maxInputBytes);
  return Object.freeze({
    name: "convert",
    runtimeIdentity: commandRuntimeIdentity,
    description: "ImageMagick convert pipeline powered by @poe-code/image-ast",
    execute(context: CommandContext) {
      return executeVfsMagickTool(context, runConvertCli, maxInputBytes);
    }
  });
}

export const convertCommand: CommandDefinition = createConvertCommand();

export function createMogrifyCommand(options: ImageMagickCommandOptions = {}): CommandDefinition {
  const maxInputBytes = InputByteBudget.limit(options.limits?.maxInputBytes);
  return Object.freeze({
    name: "mogrify",
    runtimeIdentity: commandRuntimeIdentity,
    description: "ImageMagick in-place batch image processor powered by @poe-code/image-ast",
    execute(context: CommandContext) {
      return executeVfsMagickTool(context, runMogrifyCli, maxInputBytes);
    }
  });
}

export const mogrifyCommand: CommandDefinition = createMogrifyCommand();

export function createCompositeCommand(options: ImageMagickCommandOptions = {}): CommandDefinition {
  const maxInputBytes = InputByteBudget.limit(options.limits?.maxInputBytes);
  return Object.freeze({
    name: "composite",
    runtimeIdentity: commandRuntimeIdentity,
    description: "ImageMagick overlay composition tool powered by @poe-code/image-ast",
    execute(context: CommandContext) {
      return executeVfsMagickTool(context, runCompositeCli, maxInputBytes);
    }
  });
}

export const compositeCommand: CommandDefinition = createCompositeCommand();

export function createMontageCommand(options: ImageMagickCommandOptions = {}): CommandDefinition {
  const maxInputBytes = InputByteBudget.limit(options.limits?.maxInputBytes);
  return Object.freeze({
    name: "montage",
    runtimeIdentity: commandRuntimeIdentity,
    description: "ImageMagick contact-sheet grid generator powered by @poe-code/image-ast",
    execute(context: CommandContext) {
      return executeVfsMagickTool(context, runMontageCli, maxInputBytes);
    }
  });
}

export const montageCommand: CommandDefinition = createMontageCommand();

export function createIdentifyCommand(options: ImageMagickCommandOptions = {}): CommandDefinition {
  const maxInputBytes = InputByteBudget.limit(options.limits?.maxInputBytes);
  return Object.freeze({
    name: "identify",
    runtimeIdentity: commandRuntimeIdentity,
    description: "ImageMagick image metadata inspector powered by @poe-code/image-ast",
    execute(context: CommandContext) {
      return executeVfsMagickTool(context, runIdentifyCli, maxInputBytes);
    }
  });
}

export const identifyCommand: CommandDefinition = createIdentifyCommand();

export function createCompareCommand(options: ImageMagickCommandOptions = {}): CommandDefinition {
  const maxInputBytes = InputByteBudget.limit(options.limits?.maxInputBytes);
  return Object.freeze({
    name: "compare",
    runtimeIdentity: commandRuntimeIdentity,
    description: "ImageMagick image comparison and diff generator powered by @poe-code/image-ast",
    execute(context: CommandContext) {
      return executeVfsMagickTool(context, runCompareCli, maxInputBytes);
    }
  });
}

export const compareCommand: CommandDefinition = createCompareCommand();

export function imagemagickPlugin(options: ImageMagickCommandOptions = {}): VirtualShellPlugin {
  const magick = createMagickCommand(options);
  const convert = createConvertCommand(options);
  const mogrify = createMogrifyCommand(options);
  const composite = createCompositeCommand(options);
  const montage = createMontageCommand(options);
  const identify = createIdentifyCommand(options);
  const compare = createCompareCommand(options);
  const replace = options.replace ?? false;
  return {
    name: "imagemagick",
    setup(host) {
      host.commands.register(magick, { replace });
      host.commands.register(convert, { replace });
      host.commands.register(mogrify, { replace });
      host.commands.register(composite, { replace });
      host.commands.register(montage, { replace });
      host.commands.register(identify, { replace });
      host.commands.register(compare, { replace });
    }
  };
}

export const imagemagickCommands = imagemagickPlugin;

export type ImagemagickCommandsOptions = ImageMagickCommandOptions;

export { createMagickCommand as createImagemagickCommand };

export function createImagemagickCommands(options: ImagemagickCommandsOptions = {}): readonly CommandDefinition[] {
    return [createMagickCommand(options), createConvertCommand(options), createMogrifyCommand(options), createCompositeCommand(options), createMontageCommand(options), createIdentifyCommand(options), createCompareCommand(options)];
}



function* mapSteps<T, U>(values: readonly T[], mapper: (value: T) => Generator<void, U, void>): Generator<void, U[], void> {
  const result: U[] = new Array(values.length);
  const mutable = Array.isArray(values) ? (values as unknown[]) : undefined;
  for (let i = 0; i < values.length; i++) {
    const val = values[i]!;
    if (mutable) mutable[i] = undefined;
    const mapped = yield* mapper(val);
    const valData = (val as unknown as { data?: unknown })?.data;
    const mappedData = (mapped as unknown as { data?: unknown })?.data;
    if (valData instanceof Uint8Array && mappedData instanceof Uint8Array && valData.buffer !== mappedData.buffer) {
      detachRgbaBuffer(valData);
    }
    result[i] = mapped;
  }
  return result;
}
