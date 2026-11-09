import { virtualPixelIndex } from "./virtual-pixel.js";
import { builtinPattern } from "./builtin-patterns.js";
import { gradientRadii } from "./gradient-radii.js";
import { gradientVector } from "./gradient-vector.js";
import { gradientProjection } from "./gradient.js";
import { besselJ } from "./bessel.js";
import { localThresholdPixelSteps, parseLocalThresholdGeometry } from "./local-threshold-kernel.js";
import { automaticThreshold } from "./auto-threshold.js";
import { identifyStatisticsSteps } from "./identify-statistics.js";
import { identifyHullSteps } from "./identify-hull.js";
import { identifyMomentsSteps } from "./identify-moments.js";
import { identifyMaximumSteps, identifyStoredMaximum } from "./identify-locate.js";
import { hilbertPixels, riemersmaRemapSteps } from "./riemersma.js";
import { convertCmykPixels, copyCmykChannelsToRgb, formatCmykPixel, rgbToCmyk } from "./colorspace-cmyk.js";
import { modulateRgb } from "./modulate.js";
import { cyclePixelSteps } from "./cycle.js";
import { magnifyPixelSteps, parseMagnifyMethod, type MagnifyMethod } from "./magnify-kernel.js";
import { ftxtInput } from "./ftxt-input.js";
import { ftxtPixels, storedFtxt } from "./ftxt.js";
import { decodeApngSteps, readApng } from "./apng-input.js";
import { signatureSteps } from "./signature.js";
import { encipherPixelSteps } from "./encipher-kernel.js";
import { regionPixelSteps, type Region } from "./region.js";
import { writeMaskPixelSteps } from "./write-mask.js";
import { matchesMagickGlob, mogrifyTargets, mogrifyFileTargets } from "./mogrify-glob.js";
import { rawRgbInput } from "./raw-rgb.js";
import { encodeImage, isRawCoder, type ImageFormat } from "./raw-output.js";
import { deskewAngleSteps, storedDeskewAngle, deskewPlan, deskewPixelSteps } from "./deskew.js";
import { compareLayerBounds, optimizePlusPixels, optimizeTransparencyPixels } from "./compare-layers.js";
import { plasmaPixelSteps } from "./plasma.js";
import { createMagickRandom } from "./random.js";
import { evaluateNoiseSteps } from "./noise.js";
import { orderedDitherPixelSteps, parseOrderedDither } from "./ordered-dither.js";
import { extendEdgePixelSteps } from "./extend-edge-kernel.js";
import { bilevelPixelSteps } from "./bilevel-kernel.js";
import { histogramPixelSteps } from "./histogram-kernel.js";
import { convertHuePixels, prepareHueOutput, formatHuePixel, hueTextPixel, type HueMetadata } from "./colorspace-hue.js";
import { sharpenPixelSteps } from "./sharpen-kernel.js";
import { waveletDenoisePixelSteps } from "./wavelet-denoise-kernel.js";
import { meanShiftPixelSteps, parseMeanShiftGeometry } from "./mean-shift-kernel.js";
import { rotationalBlurPixelSteps } from "./rotational-blur-kernel.js";
import { kuwaharaPixelSteps } from "./kuwahara-kernel.js";
import { blurPixelSteps, parseUnsharpGeometry } from "./blur-kernel.js";
import { magickFramePixels, montageShadowPixels } from "./montage-frame.js";
import { morphPixelSteps, pointResizePixelSteps, resizePixelSteps, type MagickResizeKernel as ResizeKernel, type ResizeFilterSettings } from "./resize-kernel.js";
import { trimGeometrySteps, trimMagickSteps, trimStoredMagick } from "./trim.js";
import { sketchPixelSteps } from "./sketch-kernel.js";
import { gifDitherSteps } from "./gif-dither.js";
import { quantizePixelSteps } from "./quantize.js";
import { uniqueColorsSteps, uniqueColorsStored } from "./unique-colors.js";
import { connectedComponentsSteps, connectedComponentsStored } from "./connected-components.js";
import { type LookupInterpolation, clutPixelSteps, haldClutPixelSteps, combinePixelSteps, evaluateSequencePixelSteps } from "./sequence-kernel.js";
import { IntegerTable } from "@poe-code/safe-fs/storage";
import { withImageInputs } from "./image-input.js";
import { srgbDepthEnumerationLine, gray16EnumerationLine, pixelEnumerationLine, histogramLine, storedPixelEnumeration, storedHistogram, sparseColorPoints, storedSparseColor, encodeText } from "./text-output.js";
import { StoredImageStack, magickInput, type MagickFormatContext, type StoredMagickImage } from "./stored-stack.js";
import { remapColorOrder, remapStoredImage } from "./remap.js";
import { drawReplacePixelSteps } from "./draw-replace.js";
import { floodfillStoredImage, matchesAlphaFloodfill } from "./floodfill.js";
import { createHoughTransform } from "./hough-kernel.js";
import { cannyPixelSteps } from "./canny-kernel.js";
import { shadowPixelSteps, vignetteLayout, vignettePixelSteps, raisePixelSteps } from "./effects-kernel.js";
import { shearPlan, shearPixelSteps } from "./shear-kernel.js";
import { compositePixelsSteps, magickCompositeMode } from "./composite-pixels.js";
import { warpPixelSteps, type WarpPlan, type VirtualPixelMethod } from "./warp-kernel.js";
import { distancePixelSteps, manhattanDistanceScale } from "./distance-kernel.js";
import { hitAndMissPixelSteps, morphologyPixelSteps, type MorphologyRow } from "./morphology-kernel.js";
import { edgePixelSteps } from "./edge-kernel.js";
import { charcoalPixelSteps } from "./charcoal-kernel.js";
import { embossPixelSteps } from "./emboss-kernel.js";
import { convolvePixelSteps, type ConvolveKernel, type ConvolveRequest } from "./convolve-kernel.js";
import {withCompareFiles,CompareInputFailure,type CompareFileInput,type CompareFileSession} from "./compare-file.js";
export type {CompareFileInput} from "./compare-file.js";
export interface ConvertFileInput extends CompareFileInput { readonly stderr?: ByteSink; }
import {compareImageSteps,formatMetricNum,formatSignificantMetric} from "./compare-kernel.js";
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
import { readImageMetadataFromSource, decodeImageToStorage, transformStoredImage,type StoredRgbaImage as BaseStoredRgbaImage, UnsupportedStoredResource, decodeImage, decodePngToCanvas, FONT_5X7, readImageMetadata, parseColor as baseParseColor, type BlendMode, type CompositeLayer, type GravityPosition, type ImageMetadata as BaseImageMetadata, type ImageByteSource, type RgbaColor, type RgbaImage as BaseRgbaImage, applyExifOrientationSteps, compositeImageSteps, computeImageStatsSteps, ensureAlphaImageSteps, extendImageSteps, extractChannelImageSteps, extractImageSteps, flipImageSteps, flopImageSteps, grayscaleImageSteps, resizeImageSteps, rotateImageSteps, thresholdImageSteps } from "@poe-code/image-ast/portable";

type ReadMask = Pick<BaseRgbaImage, "width" | "height"> & Partial<Pick<BaseRgbaImage, "data" | "data16">> & { position?: number };
type RgbaImage = BaseRgbaImage & HueMetadata & { alphaBlend?: boolean | undefined; evaluateSamples?: Float64Array | undefined; region?: Region | undefined; readMask?: ReadMask | undefined; writeMask?: BaseRgbaImage | undefined };
type StoredRgbaImage = BaseStoredRgbaImage & HueMetadata & { alphaBlend?: boolean | undefined; storedEvaluateSamples?: number | undefined; region?: Region | undefined; readMask?: ReadMask | undefined; storedWriteMask?: Pick<BaseStoredRgbaImage, "width" | "height" | "position" | "hasAlpha"> | undefined };
type ImageMetadata = BaseImageMetadata & HueMetadata;

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

function parseColor(raw: string, precise = false): RgbaColor {
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
  const round = (value: number) => precise ? value : Math.round(value);
  if (/^#[0-9a-f]{12}$/i.test(s)) {
    const r = round(parseInt(s.slice(1, 5), 16) / 257);
    const g = round(parseInt(s.slice(5, 9), 16) / 257);
    const b = round(parseInt(s.slice(9, 13), 16) / 257);
    return { r, g, b, a: 255 };
  }
  if (/^#[0-9a-f]{16}$/i.test(s)) {
    const r = round(parseInt(s.slice(1, 5), 16) / 257);
    const g = round(parseInt(s.slice(5, 9), 16) / 257);
    const b = round(parseInt(s.slice(9, 13), 16) / 257);
    const a = round(parseInt(s.slice(13, 17), 16) / 257);
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
  readonly hasYOffset: boolean;
  readonly forceExact: boolean;
  readonly shrinkOnly: boolean;
  readonly enlargeOnly: boolean;
  readonly fillArea: boolean;
  readonly isPercent: boolean;
  readonly percentX?: number;
  readonly percentY?: number;
  readonly areaLimit?: number;
  readonly isSubdivide?: boolean;
  readonly aspectRatio?: number;
}

function normalizeMagickHexOffsets(raw: string): string {
    // Normalize signed hexadecimal offsets without treating size separators as hex.
    let normalized = "";
    for (let i = 0; i < raw.length; i++) {
        normalized += raw[i];
        if ((raw[i] === "+" || raw[i] === "-") && raw[i + 1] === "0" && raw[i + 2]?.toLowerCase() === "x") {
            let end = i + 3;
            while (end < raw.length && raw[end]! >= "0" && raw[end]! <= "9") end++;
            if (end > i + 3) {
                normalized += Number.parseInt(raw.slice(i + 3, end), 16);
                i = end - 1;
            }
        }
    }
    return normalized;
}

export function parseMagickGeometry(raw: string): MagickGeometry {
  let s = normalizeMagickHexOffsets([...raw].filter(character => character.trim() !== "").join(""));
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
  let hasYOffset = false;
  const offsetMatch = /^([^+-]*)([+-]\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)(?:([+-]\d+(?:\.\d+)?(?:[eE][+-]?\d+)?))?$/.exec(s);
  if (offsetMatch) {
    s = offsetMatch[1]!;
    x = Number(offsetMatch[2]!);
    y = offsetMatch[3] !== undefined ? Number(offsetMatch[3]!) : 0;
    hasOffset = true;
    hasYOffset = offsetMatch[3] !== undefined;
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

  if (s.includes(":")) {
    const parts = s.split(":");
    const ratio = Number(parts[0]) / Number(parts[1]);
    if (parts.length === 2 && Number(parts[0]) > 0 && Number(parts[1]) > 0 && Number.isFinite(ratio)) {
      return { aspectRatio: ratio, x, y, hasOffset, hasYOffset, forceExact, shrinkOnly, enlargeOnly, fillArea, isPercent: false };
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
        hasYOffset,
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
      hasYOffset,
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
      hasYOffset,
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
    hasYOffset,
    forceExact,
    shrinkOnly,
    enlargeOnly,
    fillArea,
    isPercent: false
  };
}

function parseDelay(value: string, current: number): number {
  value = value.replaceAll("%", "");
  const [delay, ticks = "100"] = [...value].filter(character => character !== ">" && character !== "<").join("").split("x");
  const milliseconds = Math.floor(Math.round(Number(delay)) * 100 / (Number(ticks) || 1)) * 10;
  if (value.includes(">")) return Math.min(current, milliseconds);
  if (value.includes("<")) return Math.max(current, milliseconds);
  return milliseconds;
}

interface MagickState {
  distortScale?: string;
  gradientBoundingBox?: MagickGeometry;
  gradientDirection?: string;
  gradientAngle?: number;
  gradientVector?: string;
  gradientRadii?: string;
  gradientExtent?: string;
  gradientCenter?: { x: number; y: number };
  ftxtFormat?: string;
  comment?: string;
  label?: string;
  filenameLiteral?: boolean;
  optionProperties?: Record<string, string>;
  distortViewport?: string;
  sizeWidth: number;
  sizeHeight: number;
  hasSize: boolean;
  page?: NonNullable<RgbaImage["virtualCanvas"]>;
  iconAutoResize?: number[];
  inputDepth?: number;
  netpbmAscii?: boolean;
  bmpFormat?: "bmp2" | "bmp3" | "bmp4";
  bmp3Alpha?: boolean;
  bmpSubtype?: "RGB565" | "RGB555" | "ARGB4444" | "ARGB1555";
  miffCompression?: "rle" | "none" | "bzip" | "zip";
  tgaCompression?: "rle" | "none";
  bmpCompression?: "rle" | "none";
  tiffTile?: { width: number; height: number };
  tiffCompression?: "none" | "lzw" | "deflate" | "packbits" | "jpeg";
  pngInterlace?: boolean;
  gifInterlace?: boolean;
  tiffFloatingPoint?: boolean;
  tiffSigned?: boolean;
  tiffPlanar?: boolean;
  tiffAlpha?: "associated" | "unassociated" | "unspecified";
  tiffEndian?: "msb" | "lsb";
  tiffRowsPerStrip?: number;
  inputEndian?: string;
  background: RgbaColor;
  backgroundExplicit?: boolean;
  tileOffset?: { x: number; y: number };
  virtualPixel?: VirtualPixelMethod;
  fill: RgbaColor;
  stroke: RgbaColor;
  strokeWidth: number;
  antialias?: boolean;
  borderColor: RgbaColor;
  matteColor: RgbaColor;
  pointsize: number;
  gravity: GravityPosition;
  jpegProgressive?: boolean;
  jpegArithmeticCoding?: boolean;
  jpegOptimizeCoding?: boolean;
  webpExact?: boolean;
  webpSmartSubsample?: boolean;
  webpAlphaCompression?: 0 | 1;
  webpAlphaQuality?: number;
  jpegDctMethod?: "integer" | "float" | "fastest";
  quality: number;
  webpTargetSize?: number;
  webpPass?: number;
  webpMethod?: number;
  webpLossless?: boolean;
  jpegExtent?: number;
  jpegRestartInterval?: number;
  samplingFactor?: string;
  pngBitDepth?: 8 | 16;
  pngPreserveColormap?: boolean;
  pngColorType?: string;
  omitPngResolution?: boolean;
  delay?: string;
  disposal?: number;
  transparentColor?: ReturnType<typeof parseColor>;
  loop?: number;
  optimizeLayers?: boolean;
  density: number;
  orientation?: number;
  units?: "inch" | "cm" | "unknown";
  fuzz: number;
  alphaFuzz: number;
  trimPercentBackground?: number;
  houghAccumulator?: boolean;
  deskewAutoCrop?: string;
  trimEdges?: string;
  trimMinSize?: { width?: number; height?: number };
  interpolation?: LookupInterpolation;
  kernel: ResizeKernel | undefined;
  magnifyMethod?: MagnifyMethod;
  modulateColorspace?: string;
  resizeFilter?: ResizeFilterSettings;
  sampleOffset?: { x: number; y: number };
  pointFilter?: boolean;
  compose: BlendMode;
  composeRaw: string;
  composeArgs: string | undefined;
  composeTile?: boolean;
  geometry: string | undefined;
  tile: string | undefined;
  strip: boolean;
  adjoin: boolean;
  scene?: number;
  dither: false | "riemersma" | "floydsteinberg";
  diffusionAmount?: number;
  quantizeGray?: boolean;
  treeDepth?: number;
  formatStr: string | undefined;
  channels: { r: boolean; g: boolean; b: boolean; a: boolean };
  channelExplicit: boolean;
  intensity: string;
  precision?: number;
  connectedVerbose?: boolean;
  connectedExcludeHeader?: boolean;
  connectedExcludeIds?: boolean;
  connectedMeanColor?: boolean;
  connectedAreaThreshold?: number;
  connectedBackgroundId?: number;
  connectedKeep?: number[][];
  connectedRemove?: number[][];
  connectedRemoveColors?: RgbaColor[];
  connectedKeepColors?: RgbaColor[];
  connectedKeepTop?: number;
  connectedSort?: "x" | "area";
  connectedSortOrder?: "increasing" | "decreasing";
  connectedPerimeterThreshold?: number[];
  connectedMinorAxisThreshold?: number[];
  connectedEccentricityThreshold?: number[];
  connectedDiameterThreshold?: number[];
  connectedCircularityThreshold?: number[];
  connectedMajorAxisThreshold?: number[];
  connectedAngleThreshold?: number[];
  seed?: number;
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
    matteColor: { r: 189, g: 189, b: 189, a: 255 },
    pointsize: 12,
    gravity: "northwest",
    quality: 92,
    density: 72,
    fuzz: 10,
    alphaFuzz: 0,
    kernel: undefined,
    compose: "over",
    composeRaw: "Over",
    composeArgs: undefined,
    geometry: undefined,
    tile: undefined,
    strip: false,
    adjoin: true,
    dither: "riemersma",
    formatStr: undefined,
    channels: { r: true, g: true, b: true, a: false },
    channelExplicit: false,
    intensity: "rec709luma"
  };
}

function magickMedianRows(spec: string): number[] {
  const geometry = parseMagickGeometry(spec);
  const width = Math.max(1, Math.trunc(geometry.width ?? 1));
  const height = Math.max(1, Math.trunc(geometry.height ?? geometry.width ?? 1));
  return Array<number>(height).fill((width - 1) / 2);
}

function parseMagickMorphologyMethod(raw: string): { method: string; iterations: number } {
  const [method = "", count] = raw.toLowerCase().split(":");
  const iterations = count === undefined ? 1 : Number(count);
  if (!Number.isSafeInteger(iterations) || iterations < 0 || count === "")
    throw new Error(`unsupported morphology iteration count '${raw}'`);
  return { method, iterations };
}

type MorphologyStep = { mode: "distance"; scale: number; reverse: boolean; source: number } | { mode: "thinning"; kernels: { foreground: number[][]; background: number[][] }[] } | { mode: "min" | "max" | "median" | "mean" | "mode" | "rms" | "standarddeviation" | "contrast" | "nonpeak"; source: number } | { mode: "diff"; a: number; b: number };
function explicitMorphologyRows(spec: string, match?: 0 | 1): number[][] | undefined {
  const colon = spec.indexOf(":");
  if (colon < 0 || !"0123456789".includes(spec[0] ?? " ")) return undefined;
  const geometry = parseMagickGeometry(spec.slice(0, colon));
  const width = geometry.width ?? 0, height = geometry.height ?? width;
  const x = geometry.hasOffset ? geometry.x : Math.floor((width - 1) / 2);
  const y = geometry.hasOffset ? geometry.y : Math.floor((height - 1) / 2);
  const cells = spec.slice(colon + 1).trim().split(/[\s,]+/);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1
      || x < 0 || x >= width || y < 0 || y >= height || cells.length !== width * height)
    throw new Error(`invalid morphology kernel '${spec}'`);
  const radius = Math.max(y, height - 1 - y);
  const rows: number[][] = Array.from({ length: radius * 2 + 1 }, () => []);
  for (let row = 0; row < height; row++) {
    const offsets = rows[row - y + radius]!;
    for (let column = 0; column < width; column++) {
      if (cells[row * width + column]!.toLowerCase() === "nan") continue;
      const value = Number(cells[row * width + column]);
      if (value !== 1 && !(match !== undefined && value === 0)) throw new Error(`unsupported non-flat morphology kernel '${spec}'`);
      if (match === undefined || value === match) offsets.push(column - x);
    }
  }
  return rows;
}

function magickMorphologyPlan(methodRaw: string, kernelSpec: string): { rows: MorphologyRow[]; backgroundRows?: MorphologyRow[]; dilateRows?: MorphologyRow[]; steps: MorphologyStep[]; iterations: number } {
  const { method, iterations } = parseMagickMorphologyMethod(methodRaw);
  if (method === "distance") {
    const scale = manhattanDistanceScale(kernelSpec);
    return { iterations: iterations === 0 ? 0 : 1, rows: [], steps: [
      { mode: "distance", scale, reverse: false, source: 0 },
      { mode: "distance", scale, reverse: true, source: 1 }
    ] };
  }
  if (method === "thinning") {
    const specs = kernelSpec.toLowerCase() === "edges" ? [
      "3x3:0,nan,1,0,nan,1,0,nan,1",
      "3x3:1,nan,0,1,nan,0,1,nan,0",
      "3x3:1,1,1,nan,nan,nan,0,0,0",
      "3x3:0,0,0,nan,nan,nan,1,1,1"
    ] : [kernelSpec];
    const kernels = specs.map(spec => {
      const foreground = explicitMorphologyRows(spec, 1), background = explicitMorphologyRows(spec, 0);
      if (!foreground || !background) throw new Error(`invalid morphology kernel '${kernelSpec}'`);
      return { foreground, background };
    });
    return { rows: [], iterations, steps: [{ mode: "thinning", kernels }] };
  }
  if (method === "hitandmiss") {
    const rows = explicitMorphologyRows(kernelSpec, 1);
    if (!rows) throw new Error(`invalid morphology kernel '${kernelSpec}'`);
    return { rows, backgroundRows: explicitMorphologyRows(kernelSpec, 0)!, iterations, steps: [{ source: 0, mode: "min" }] };
  }
  if (method === "nonpeak") return { iterations, rows: magickMedianRows(kernelSpec), steps: [{ source: 0, mode: "nonpeak" }] };
  if (method === "contrast") return { iterations, rows: magickMedianRows(kernelSpec), steps: [{ source: 0, mode: "contrast" }] };
  if (method === "standarddeviation") return { iterations, rows: magickMedianRows(kernelSpec), steps: [{ source: 0, mode: "standarddeviation" }] };
  if (method === "rootmeansquare" || method === "rms") return { iterations, rows: magickMedianRows(kernelSpec), steps: [{ source: 0, mode: "rms" }] };
  if (method === "mode") return { iterations, rows: magickMedianRows(kernelSpec), steps: [{ source: 0, mode: "mode" }] };
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

  const shape = (colonIdx < 0 ? kernelSpec : kernelSpec.slice(0, colonIdx)).toLowerCase();
  const disk = shape === "disk";
  const radius = Number(sizePart) || 4.5;
  if (disk) ry = Math.max(0, Math.floor(radius));
  if (shape === "octagon" || shape === "diamond" || shape === "plus" || shape === "cross") {
    rx = ry = Math.max(1, Math.floor(Number(sizePart) || (shape === "diamond" ? 1 : 2)));
  }
  let innerRadius = 0;
  if (shape === "ring") {
    const radii = colonIdx < 0 ? [2.5, 3.5] : sizePart.split(",").map(Number);
    innerRadius = radii.length === 1 ? 0 : Math.min(...radii.slice(0, 2));
    rx = Math.max(...radii.slice(0, 2));
    ry = Math.floor(rx);
  }
  const rows: MorphologyRow[] = Array.from({ length: ry * 2 + 1 }, (_, row) => {
    const dy = Math.abs(row - ry);
    if (shape === "ring") {
      const outer = Math.floor(Math.sqrt(rx * rx - dy * dy));
      if (dy > innerRadius) return outer;
      const inner = Math.floor(Math.sqrt(innerRadius * innerRadius - dy * dy));
      return Array.from({ length: outer * 2 + 1 }, (_, column) => column - outer).filter(column => Math.abs(column) > inner);
    }
    if (disk) return Math.floor(Math.sqrt(radius * radius - dy * dy));
    if (shape === "cross") return dy === 0 ? [0] : [-dy, dy];
    if (shape === "diamond") return rx - dy;
    if (shape === "plus") return dy === 0 ? rx : 0;
    if (shape === "octagon") return Math.min(rx, rx + Math.floor(rx / 2) - dy);
    return rx;
  });

  const filter = (source: number, mode: "min" | "max" | "median" | "mean" | "mode" | "rms" | "standarddeviation" | "contrast" | "nonpeak"): MorphologyStep => ({ source, mode });
  const diff = (a: number, b: number): MorphologyStep => ({ mode: "diff", a, b });
  let steps: MorphologyStep[];
  switch (method) {
    case "erode": case "minimum": steps = [filter(0, "min")]; break;
    case "median": steps = [filter(0, "median")]; break;
    case "mean": steps = [filter(0, "mean")]; break;
    case "open": steps = [filter(0, "min"), filter(1, "max")]; break;
    case "close": steps = [filter(0, "max"), filter(1, "min")]; break;
    case "edgein": steps = [filter(0, "min"), diff(0, 1)]; break;
    case "edgeout": steps = [filter(0, "max"), diff(1, 0)]; break;
    case "edge": case "gradient": steps = [filter(0, "max"), filter(0, "min"), diff(1, 2)]; break;
    case "tophat": steps = [filter(0, "min"), filter(1, "max"), diff(0, 2)]; break;
    case "bottomhat": steps = [filter(0, "max"), filter(1, "min"), diff(2, 0)]; break;
    case "dilate": case "maximum": steps = [filter(0, "max")]; break;
    default: throw new Error(`unrecognized function '${methodRaw}'`);
  }
  const explicit = explicitMorphologyRows(kernelSpec);
  if (explicit) return { rows: explicit, dilateRows: explicit.slice().reverse().map(row =>
    row.map(offset => -offset)), steps, iterations };
  if (!["square", "rectangle", "disk", "diamond", "plus", "cross", "octagon", "ring"].includes(shape)
      && !(colonIdx < 0 && kernelSpec.split("x").every(size => size.trim() !== "" && Number.isFinite(Number(size)))))
    throw new Error(`invalid morphology kernel '${kernelSpec}'`);
  return { rows, steps, iterations };
}
function* subtractMagickPixelSteps(a: Uint8Array, b: Uint8Array, hasAlpha: boolean, channels?: readonly boolean[]): Generator<void, Uint8Array, void> {
    const result = new Uint8Array(a.length);
    for (let i = 0; i < a.length; i++) {
        if (i % 16384 === 0) yield;
        result[i] = channels && !channels[i % 4] ? a[i]! : i % 4 === 3 && !hasAlpha ? 255 : clampByteVal(a[i]! - b[i]!);
    }
    return result;
}
function* applyMagickMorphology4ChSteps(img: RgbaImage, methodRaw: string, kernelSpec: string, signal?: AbortSignal, channels?: readonly boolean[]): Generator<void, RgbaImage, void> {
    const plan = magickMorphologyPlan(methodRaw, kernelSpec), images = [img];
    if (plan.iterations === 0) return img;
    for (const step of plan.steps) {
        if (step.mode === "thinning") {
            let source = images.at(-1)!;
            for (let pass = 0; pass < plan.iterations; pass++)
                for (const kernel of step.kernels)
                    source = yield* applyMagickRasterSteps(source, hitAndMissPixelSteps(source, kernel.foreground, kernel.background, channels, true), signal);
            images.push(source);
        } else if (step.mode === "diff") {
            const a = images[step.a]!, b = images[step.b]!;
            images.push({ ...a, data: yield* subtractMagickPixelSteps(a.data, b.data, img.hasAlpha, channels) });
        } else {
            let source = images[step.source]!;
            for (let pass = 0; pass < plan.iterations; pass++)
                source = yield* applyMagickRasterSteps(source, step.mode === "distance" ? distancePixelSteps(source, step.scale, step.reverse, channels) : plan.backgroundRows ? hitAndMissPixelSteps(source, plan.rows, plan.backgroundRows, channels) : morphologyPixelSteps(source, step.mode === "max" ? plan.dilateRows ?? plan.rows : plan.rows, step.mode, channels), signal);
            images.push(source);
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
  fuzz: number, signal?: AbortSignal, alphaOnly = false, channels?: readonly boolean[], fillToBorder = false): Generator<void, RgbaImage, void> {
    let cooperativeWork = 0;
    const g = parseMagickGeometry(geomStr);
  const w = img.width;
  const h = img.height;
  const sx = Math.round(g.x);
  const sy = Math.round(g.y);
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return img;
  const out = new Uint8Array(img.data);
  const seedOff = (sy * w + sx) * 4;
  const refR = targetColor ? targetColor.r : out[seedOff]!;
  const refG = targetColor ? targetColor.g : out[seedOff + 1]!;
  const refB = targetColor ? targetColor.b : out[seedOff + 2]!;

  const matchesRef = (pIdx: number): boolean => {
    const off = pIdx * 4;
    return fillToBorder !== matchesAlphaFloodfill(out[off]!, out[off + 1]!, out[off + 2]!, out[off + 3]!, refR, refG, refB, (fillToBorder || !alphaOnly) && targetColor ? targetColor.a : img.data[seedOff + 3]!, fuzz, targetColor ? 0 : fuzz);
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
    if (!alphaOnly) {
      if (!channels || channels[0]) out[off] = replacement.r;
      if (!channels || channels[1]) out[off + 1] = replacement.g;
      if (!channels || channels[2]) out[off + 2] = replacement.b;
    }
    if (!channels || channels[3]) out[off + 3] = replacement.a;

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

function* applyMagickEvaluateSequenceSteps(stack: readonly RgbaImage[], opRaw: string, channels: readonly boolean[] | undefined, state: MagickState, signal?: AbortSignal): Generator<void, RgbaImage, void> {
    if (stack.length === 0) {
        throw new Error("evaluate-sequence requires at least one image");
    }
    const first = stack[0]!;
    const base = stack.some(image => image.space !== "b-w" && image.space !== "grey16") ? { ...first, space: "srgb" as const, channels: 4 as const } : first;
    const w = stack.reduce((width, image) => Math.max(width, image.width), 0);
    const h = stack.reduce((height, image) => Math.max(height, image.height), 0);
    const normalized = (yield* mapSteps(stack, function* (im) {
        if (state.virtualPixel === "transparent" || (state.virtualPixel === "background" || state.virtualPixel?.endsWith("-tile") === true) && state.background.a < 255) im = { ...im, hasAlpha: true };
        if (im.width === w && im.height === h) return im;
        return yield* applyMagickRasterSteps(im, extendEdgePixelSteps(im, w, h, !!im.data16, state.virtualPixel, state.background), signal, { ...im, width: w, height: h });
    }));
    const virtualCanvas = magickResizeCanvas(base, w, h);
    return { ...yield* applyMagickRasterSteps(base, evaluateSequencePixelSteps(w * h * 4, normalized, opRaw, channels, normalized.some(image => !!image.data16), state.seed ?? 0, w), signal, { ...base, width: w, height: h, hasAlpha: normalized.some(image => image.hasAlpha) }, normalized), ...(virtualCanvas ? { virtualCanvas } : {}) };
}

function parseMagickConvolveKernel(spec: string, normalize = true, reverse = false): ConvolveKernel {
    const afterColon = spec.includes(":") ? spec.slice(spec.indexOf(":") + 1) : spec;
    const kernel = afterColon.trim().split(/[\s,]+/).filter(s => s.length > 0).map(Number).filter(Number.isFinite);
    const sum = kernel.reduce((total, weight) => total + weight, 0);
    const geometry = parseMagickGeometry(spec.includes(":") ? spec.slice(0, spec.indexOf(":")) : "");
    const width = geometry.width ?? Math.max(1, Math.round(Math.sqrt(kernel.length)));
    const height = geometry.height ?? width;
    const x = geometry.hasOffset ? geometry.x : Math.floor((width - 1) / 2);
    const y = geometry.hasOffset ? geometry.y : Math.floor((height - 1) / 2);
    const weights = !normalize || sum === 0 ? kernel : kernel.map(weight => weight / sum);
    return { weights: reverse ? weights.reverse() : weights, width, height,
        x: reverse ? width - 1 - x : x, y: reverse ? height - 1 - y : y };
}
function* applyMagickCustomConvolveSteps(img: RgbaImage, spec: string, signal?: AbortSignal): Generator<void, RgbaImage, void> {
    const kernel = parseMagickConvolveKernel(spec);
    return kernel.weights.length ? yield* applyMagickRasterSteps(img, convolvePixelSteps(img, kernel, 0), signal) : img;
}

function* applyMagickColorMatrixSteps(img: RgbaImage, spec: string, signal?: AbortSignal): Generator<void, RgbaImage, void> {
    let cooperativeWork = 0;
    const separator = spec.indexOf(":");
    const name = (separator < 0 ? spec : spec.slice(0, separator)).trim().toLowerCase();
    const argument = separator < 0 ? undefined : Number(spec.slice(separator + 1));
    let named: number[] | undefined;
    if (name === "unity") named = [argument ?? 1];
    else if (name === "sobel" && (argument === undefined || argument === 0)) named = [1, 0, -1, 2, 0, -2, 1, 0, -1];
    else if (name === "square" && (argument === undefined || Number.isFinite(argument))) {
        // Only RGB, black, alpha and the constant column affect a color matrix.
        // Larger all-ones kernels have the same effect as a 6x6 matrix.
        const size = Math.min(6, Math.max(3, Math.floor(2 * Math.abs(argument ?? 1) + 1)));
        named = new Array<number>(size * size).fill(1);
    }
    const afterColon = spec.includes(":") ? spec.slice(spec.indexOf(":") + 1) : spec;
    const m = named ?? afterColon
        .trim()
        .split(/[\s,]+/)
        .filter((s) => s.length > 0)
        .map(s => Number(s.endsWith("%") ? s.slice(0, -1) : s));
    if (!spec.includes(":") && !Number.isFinite(m[0]))
        throw new Error("Invalid color matrix: expected a numeric first coefficient");
    const geometry = !named && spec.includes(":") ? parseMagickGeometry(spec.slice(0, spec.indexOf(":"))) : undefined;
    const cols = geometry ? geometry.width ?? 0 : Math.sqrt(m.length);
    const rows = geometry ? geometry.height ?? cols : cols;
    if (cols <= 0 || rows <= 0 || !Number.isInteger(cols) || !Number.isInteger(rows) || cols * rows !== m.length)
        throw new Error("Invalid color matrix: coefficient count must match the dimensions or be a nonzero square");
    const out = new Uint8Array(img.data);
    const samples = img.evaluateSamples ?? img.data16 ?? img.data;
    const scale = !img.evaluateSamples && img.data16 ? 257 : 1;
    const evaluateSamples = Float64Array.from(samples, value => value / scale);
    const data16 = img.data16 ? new Uint16Array(img.data16) : undefined;
    for (let i = 0; i < out.length; i += 4) {
        if (++cooperativeWork % 65536 === 0)
            yield;
        for (let channel = 0; channel < (img.hasAlpha ? 4 : 3); channel++) {
            // ImageMagick reserves the fourth matrix channel for CMYK black.
            const row = channel === 3 ? 4 : channel;
            if (row >= rows) continue;
            let value = cols >= 6 ? m[row * cols + 5]! * 255 : 0;
            for (let col = 0; col < 3; col++)
                value += (col < cols ? m[row * cols + col]! : row === col ? 1 : 0) * (samples[i + col]! / scale);
            if (cols >= 5) value += m[row * cols + 4]! * (samples[i + 3]! / scale);
            else if (channel === 3) value += samples[i + 3]! / scale;
            evaluateSamples[i + channel] = value;
            if (data16) data16[i + channel] = Math.round(Math.max(0, Math.min(65535, value * 257)));
            out[i + channel] = data16 ? Math.round(data16[i + channel]! / 257) : clampByteVal(value);
        }
        if (img.space === "b-w" || img.space === "grey16") {
            // Native RGB channel writes share one gray sample; the blue row wins.
            out[i] = out[i + 1] = out[i + 2]!;
            if (data16) data16[i] = data16[i + 1] = data16[i + 2]!;
            evaluateSamples[i] = evaluateSamples[i + 1] = evaluateSamples[i + 2]!;
        }
    }
    return { ...img, data: out, evaluateSamples, ...(data16 ? { data16 } : {}) };
}

function* applyMagickRemapSteps(img: RgbaImage, palImg: RgbaImage, dither: boolean, diffusionAmount: number, signal?: AbortSignal): Generator<void, RgbaImage, void> {
    let cooperativeWork = 0;
    const palette: Array<{
        r: number;
        g: number;
        b: number;
        a: number;
    }> = [];
    const seen = new Set<number>();
    for (let i = 0; i < palImg.data.length; i += 4) {
        if (++cooperativeWork % 65536 === 0)
            yield;
        const r = palImg.data[i]!;
        const g = palImg.data[i + 1]!;
        const b = palImg.data[i + 2]!;
        const a = palImg.data[i + 3]!;
        const key = (r << 24) | (g << 16) | (b << 8) | a;
        if (!seen.has(key)) {
            seen.add(key);
            palette.push({ r, g, b, a });
        }
    }
    if (palette.length === 0)
        return img;
    palette.sort((a, b) => remapColorOrder(b.r, b.g, b.b) - remapColorOrder(a.r, a.g, a.b));
    const w = img.width;
    const h = img.height;
    const buf = new Float32Array(img.data);
    // Native diffusion works on associated RGB; ClosestColor applies alpha again.
    if (palImg.hasAlpha) for (let i = 0; i < buf.length; i += 4) {
        if (++cooperativeWork % 65536 === 0) yield;
        const alpha = buf[i + 3]! / 255;
        for (let c = 0; c < 3; c++) buf[i + c]! *= alpha;
    }
    const out = new Uint8Array(img.data);
    const data16 = img.data16 ? new Uint16Array(out.length) : undefined;
    for (let y = 0; y < h; y++) {
        if (++cooperativeWork % 65536 === 0)
            yield;
        // Native Floyd–Steinberg alternates the scan direction each row.
        const direction = y % 2 === 0 ? 1 : -1;
        for (let step = 0; step < w; step++) {
            const x = direction === 1 ? step : w - 1 - step;
            if (++cooperativeWork % 65536 === 0)
                yield;
            const idx = (y * w + x) * 4;
            const oldR = Math.max(0, Math.min(255, buf[idx]!));
            const oldG = Math.max(0, Math.min(255, buf[idx + 1]!));
            const oldB = Math.max(0, Math.min(255, buf[idx + 2]!));
            const oldA = Math.max(0, Math.min(255, buf[idx + 3]!));
            const alpha = palImg.hasAlpha ? oldA / 255 : 1;
            let best = palette[0]!;
            let bestDist = Infinity;
            for (const p of palette) {
                if (++cooperativeWork % 65536 === 0)
                    yield;
                const beta = palImg.hasAlpha ? p.a / 255 : 1;
                const d = (oldR * alpha - p.r * beta) ** 2 + (oldG * alpha - p.g * beta) ** 2 + (oldB * alpha - p.b * beta) ** 2 + (oldA - p.a) ** 2;
                if (d < bestDist) {
                    bestDist = d;
                    best = p;
                }
            }
            out[idx] = best.r;
            out[idx + 1] = best.g;
            out[idx + 2] = best.b;
            out[idx + 3] = best.a;
            if (data16) {
                for (let c = 0; c < 4; c++) data16[idx + c] = out[idx + c]! * 257;
            }
            if (dither) {
                const alpha = palImg.hasAlpha ? best.a / 255 : 1;
                const errR = (oldR - best.r * alpha) * diffusionAmount;
                const errG = (oldG - best.g * alpha) * diffusionAmount;
                const errB = (oldB - best.b * alpha) * diffusionAmount;
                const errA = (oldA - best.a) * diffusionAmount;
                const spread = (nx: number, ny: number, wgt: number) => {
                    if (nx < 0 || nx >= w || ny < 0 || ny >= h)
                        return;
                    const nIdx = (ny * w + nx) * 4;
                    buf[nIdx] = buf[nIdx]! + errR * wgt;
                    buf[nIdx + 1] = buf[nIdx + 1]! + errG * wgt;
                    buf[nIdx + 2] = buf[nIdx + 2]! + errB * wgt;
                    buf[nIdx + 3] = buf[nIdx + 3]! + errA * wgt;
                };
                spread(x + direction, y, 7 / 16);
                spread(x - direction, y + 1, 3 / 16);
                spread(x, y + 1, 5 / 16);
                spread(x + direction, y + 1, 1 / 16);
            }
        }
    }
    return { ...img, data: out, ...(data16 ? { data16 } : {}) };
}

type MagickImage = RgbaImage & { [magickInput]?: MagickFormatContext };

function* readMaskSelectionSteps<Step, Resume>(image: { width: number; readMask?: ReadMask | undefined }, position: number, length: number,
  load?: (position: number, length: number) => Generator<Step, Uint8Array, Resume>
): Generator<Step, Uint8Array | undefined, Resume> {
  const mask = image.readMask;
  if (!mask) return;
  const selected = new Uint8Array(length / 4);
  for (let start = 0; start < selected.length;) {
    const pixel = position / 4 + start, x = pixel % image.width, y = Math.floor(pixel / image.width);
    const count = Math.min(selected.length - start, image.width - x);
    const available = y < mask.height ? Math.max(0, Math.min(count, mask.width - x)) : 0;
    if (available) {
      const offset = (y * mask.width + x) * 4;
      const samples = mask.data16?.subarray(offset, offset + available * 4) ?? mask.data?.subarray(offset, offset + available * 4) ?? (yield* load!(offset, available * 4));
      const threshold = mask.data16 ? 65535 / 2 : 255 / 2;
      for (let i = 0; i < available; i++) selected[start + i] = Number(0.212656 * samples[i * 4]! + 0.715158 * samples[i * 4 + 1]! + 0.072186 * samples[i * 4 + 2]! > threshold);
    }
    start += count;
  }
  return selected;
}

function* magickPixelPropertiesSteps<Step=never, Resume=void>(
  img: Omit<RgbaImage,"data"|"data16"> & Partial<Pick<RgbaImage,"data"|"data16">>,
  load?: (position:number,length:number)=>Generator<Step,{data:Uint8Array;data16?:Uint16Array},Resume>,
  statistics?: Record<string, number>,
  countColors = false,
  loadMask?: (position: number, length: number) => Generator<Step, Uint8Array, Resume>,
  channelSelection?: MagickFormatContext["channelSelection"],
  precision = 6
): Generator<undefined|Step, Record<string, string>, Resume> {
  const channels = img.hasAlpha ? 4 : 3;
  const selectedChannels = channelSelection ? [channelSelection.r, channelSelection.g, channelSelection.b, channelSelection.a].slice(0, channels) : new Array<boolean>(channels).fill(true);
  const selectedCount = Math.max(1, selectedChannels.filter(Boolean).length);
  const sums = new Array<number>(channels).fill(0);
  const squares = new Array<number>(channels).fill(0);
  const means = [0, 0, 0, 0], moments = [0, 0, 0, 0];
  const histograms = statistics ? Array.from({ length: channels }, () => new Float64Array(65536)) : undefined;
  let min = 65535;
  let max = 0;
  let opaque = true;
  let gray = true;
  let bilevel = true;
  let bitDepth = 1;
  const colors = new Set<string>();
  const uniqueColors = countColors ? new Set<string>() : undefined;
  let count = 0;
  for(let offset=0;offset<img.width*img.height*4;offset+=8192){
  const length=Math.min(8192,img.width*img.height*4-offset);
  const chunk=load?yield*load(offset,length):{data:img.data!.subarray(offset,offset+length),data16:img.data16?.subarray(offset,offset+length)};
  const selection = yield* readMaskSelectionSteps(img, offset, length, loadMask);
  const samples = chunk.data16 ?? chunk.data;
  const range = chunk.data16 ? 65535 : 255;
  for (let i = 0; i < chunk.data.length; i += 4) {
    if (i % 65536 === 0) yield;
    const selected = !selection || selection[i / 4] === 1;
    if (selected) count++;
    const r = samples[i]!;
    const g = samples[i + 1]!;
    const b = samples[i + 2]!;
    const a = img.hasAlpha ? samples[i + 3]! : range;
    uniqueColors?.add(`${r},${g},${b},${a}`);
    opaque &&= a === range;
    gray &&= r === g && g === b;
    bilevel &&= (r === 0 || r === range) && (g === 0 || g === range) && (b === 0 || b === range);
    // Only palette classification needs distinct colors; stop growing at 257.
    if (colors.size <= 256) {
      colors.add(`${r},${g},${b},${a}`);
    }
    for (let c = 0; c < channels; c++) {
      const value = samples[i + c]!;
      if (statistics && selected) {
        const n = count, delta = value / range - means[c]!;
        means[c]! += delta / n;
        moments[c]! += delta * (value / range - means[c]!);
      }
      while (bitDepth < (chunk.data16 ? 16 : 8)) {
        const levels = 2 ** bitDepth - 1;
        // Effective depth requires exact representation, without rounding samples.
        if ((value * levels) % range === 0) break;
        bitDepth++;
      }
      const v = chunk.data16 ? value : value * 257;
      if (selected) {
        sums[c]! += v; squares[c]! += v * v;
        if (histograms) histograms[c]![v]!++;
      }
      if (selectedChannels[c]) {
        min = Math.min(min, v);
        max = Math.max(max, v);
      }
    }
  }
  }
  count = Math.max(1, count);
  let selectedMedian = 0;
  let skewness = 0, kurtosis = 0;
  let entropy = 0;
  if (statistics) {
    statistics.mean = 0;
    statistics.standard_deviation = 0;
    statistics.minima = 1;
    statistics.maxima = 0;
    statistics.median = 0;
    for (let c = 0; c < channels; c++) {
      const deviation = Math.sqrt(Math.max(0, moments[c]! / Math.max(1, count - 1)));
      const histogram = histograms![c]!;
      if (selectedChannels[c]) {
        let distinct = 0, channelEntropy = 0;
        for (let value = 0; value < histogram.length; value++) {
          if (value % 8192 === 0) yield;
          if (histogram[value] === 0) continue;
          distinct++;
          const probability = histogram[value]! / count;
          channelEntropy -= probability * Math.log2(probability);
        }
        // ImageMagick normalizes by occupied bins; constant channels contribute zero.
        if (distinct > 1) entropy += channelEntropy / Math.log2(distinct) / selectedCount;
      }
      let minimum = 0, maximum = 65535, median = 0, cumulative = 0;
      while (minimum < 65535 && histogram[minimum] === 0) minimum++;
      while (maximum > 0 && histogram[maximum] === 0) maximum--;
      if (selectedChannels[c] && deviation > 0) {
        let third = 0, fourth = 0;
        const mean = sums[c]! / count;
        for (let value = minimum; value <= maximum; value++) {
          if (value % 8192 === 0) yield;
          if (histogram[value] === 0) continue;
          const delta = (value - mean) / 65535 / deviation;
          const probability = histogram[value]! / count;
          third += probability * delta ** 3;
          fourth += probability * delta ** 4;
        }
        // Native uses sample deviation, population moments and excess kurtosis.
        // Constant channels contribute zero to both channel averages.
        skewness += third / selectedCount;
        kurtosis += (fourth - 3) / selectedCount;
      }
      for (; median < 65535; median++) {
        if (median % 8192 === 0) yield;
        cumulative += histogram[median]!;
        if (cumulative >= Math.ceil(count / 2)) break;
      }
      statistics[`minima.${c}`] = minimum / 65535;
      statistics[`maxima.${c}`] = maximum / 65535;
      statistics[`median.${c}`] = median / 65535;
      if (selectedChannels[c]) selectedMedian += median / selectedCount;
      statistics.minima = Math.min(statistics.minima, minimum / 65535);
      statistics.maxima = Math.max(statistics.maxima, maximum / 65535);
      statistics.median += median / 65535 / channels;
      statistics[`mean.${c}`] = means[c]!;
      statistics[`standard_deviation.${c}`] = deviation;
      statistics.mean += means[c]! / channels;
      statistics.standard_deviation += deviation / channels;
    }
    if (!img.hasAlpha) {
      statistics["minima.3"] = 0;
      statistics["maxima.3"] = 0;
      statistics["median.3"] = 0;
      statistics["mean.3"] = 0;
      statistics["standard_deviation.3"] = 0;
    }
  }
  const suffix = img.hasAlpha ? "Alpha" : "";
  const type = img.space === "cmyk" ? `ColorSeparation${suffix}`
    : gray ? (bilevel ? "Bilevel" : `Grayscale${suffix}`)
    : `${colors.size <= 256 ? "Palette" : "TrueColor"}${suffix}`;
  const deviation = sums.reduce((sum, value, c) => sum + (selectedChannels[c] ? Math.sqrt(Math.max(0,
    (squares[c]! - value * value / count) / Math.max(1, count - 1))) : 0), 0) / selectedCount;
  return {
    ...(uniqueColors ? { colors: String(uniqueColors.size) } : {}),
    mean: formatSignificantMetric(sums.reduce((sum, value, c) => sum + (selectedChannels[c] ? value : 0), 0) / (count * selectedCount), precision),
    min: formatSignificantMetric(min, precision),
    max: formatSignificantMetric(max, precision),
    median: formatSignificantMetric(selectedMedian, precision),
    "standard-deviation": formatSignificantMetric(deviation, precision),
    skewness: formatSignificantMetric(skewness, precision),
    kurtosis: formatSignificantMetric(kurtosis, precision),
    entropy: formatSignificantMetric(entropy, precision),
    opaque: opaque ? "True" : "False",
    type,
    "bit-depth": String(bitDepth)
  };
}

function* formatMagickPropertyStringSteps<Step=never>(
  fmt: string,
  meta: ImageMetadata & Pick<RgbaImage, "readMask" | "writeMask"> & Pick<StoredRgbaImage, "storedWriteMask">,
  getImage: () => RgbaImage,
  context: MagickFormatContext & { analysis?: { warnings: string }; optionProperties?: Record<string, string> | undefined } = {},
  resolvePixels?: (property:string)=>Generator<Step,string,void>
): Generator<void|Step, string, void> {
  const filePath = context.filePath ?? "";
  const baseName = filePath.slice(filePath.lastIndexOf("/") + 1);
  const dot = baseName.lastIndexOf(".");
  const bitDepth = String(meta.bitsPerSample ?? (meta.depth === "ushort" ? 16 : meta.depth === "bit" ? 1 : 8));
  const space = meta.magickColorspace ?? (meta.space === "b-w" || meta.space === "grey16" ? "Gray" : meta.space === "cmyk" ? "CMYK" : "sRGB");
  const compression = ({ png: "Zip", jpeg: "JPEG", gif: "LZW", heic: "HEVC", heif: "HEVC", avif: "AV1" } as Partial<Record<ImageFormat, string>>)[meta.format] ?? "None";
  const page = meta.virtualCanvas ?? { width: meta.width, height: meta.height, x: 0, y: 0 };
  const pageX = `${page.x < 0 ? "" : "+"}${page.x}`, pageY = `${page.y < 0 ? "" : "+"}${page.y}`;
  const resolution = meta.resolution;
  const resolutionScale = resolution?.unit === "meter" ? 100 : 1;
  const short: Record<string, string> = {
    w: String(meta.width), h: String(meta.height), m: meta.format.toUpperCase(),
    z: bitDepth, q: "16", r: `${meta.isPalette ? "PseudoClass" : "DirectClass"} ${space} ${meta.hasAlpha ? "Alpha" : ""}`,
    f: baseName, t: dot < 0 ? baseName : baseName.slice(0, dot), e: dot < 0 ? "" : baseName.slice(dot + 1), i: filePath,
    b: `${context.byteLen ?? 0}B`, B: String(context.byteLen ?? 0),
    x: String(resolution ? Number((resolution.x / resolutionScale).toPrecision(6)) : meta.density ?? 72),
    y: String(resolution ? Number((resolution.y / resolutionScale).toPrecision(6)) : meta.density ?? 72),
    s: String(context.sceneIdx ?? 0), n: String(context.sceneCount ?? meta.pages ?? 1),
    g: `${page.width}x${page.height}${pageX}${pageY}`, P: `${page.width}x${page.height}`, X: pageX, Y: pageY,
    c: meta.properties?.comment ?? "", C: compression, Q: String(context.quality ?? meta.quality ?? 92)
  };
  const properties: Record<string, string> = {
    ...meta.properties,
    profiles: [...(meta.icc ? ["icc"] : []), ...Object.keys(meta.gifApplications ?? {}).map(name => `gif:${name.toLowerCase()}`)].join(","),
    gamma: String(meta.gamma ?? 1 / 2.2),
    orientation: ["Undefined", "TopLeft", "TopRight", "BottomRight", "BottomLeft", "LeftTop", "RightTop", "RightBottom", "LeftBottom"][meta.orientation ?? 0] ?? "Undefined",
    ...(meta.jpegSamplingFactor === undefined ? {} : { "jpeg:sampling-factor": meta.jpegSamplingFactor }),
    "exif:orientation": meta.orientation === undefined ? "" : String(meta.orientation),
    colorspace: space, channels: `${space.toLowerCase()}${meta.hasAlpha ? "a" : " "} ${(meta.space === "b-w" || meta.space === "grey16" ? 1 : meta.space === "cmyk" ? 4 : 3) + (meta.hasAlpha ? 1 : 0) + (meta.isPalette ? 1 : 0) + (meta.readMask ? 1 : 0) + (meta.writeMask || meta.storedWriteMask ? 1 : 0)}.0`,
    width: String(context.originalWidth ?? meta.width), height: String(context.originalHeight ?? meta.height),
    depth: bitDepth, size: short.b!, compression, quality: short.Q!, page: short.P!,
    "resolution.x": short.x!, "resolution.y": short.y!,
    units: resolution?.unit === "meter" ? "PixelsPerCentimeter" : "Undefined"
  };
  let img: RgbaImage | undefined;
  let pixels: Record<string, string> | undefined;
  let signature: string | undefined;
  const statistics: Record<string, number> = {};
  const parts: string[] = [];
  // Only tokenize the original template. Expanded filenames and literal percent
  // escapes must never become new input, including for computed properties.
  const tokens = /\\[ntr\\%]|%%|%\[|%[a-z#@]/gi;
  let previous = 0;
  let match: RegExpExecArray | null;
  while ((match = tokens.exec(fmt)) !== null) {
    // Native single-letter escapes stay literal immediately after a digit.
    if (match[0].startsWith("%") && match[0] !== "%[" && match[0] !== "%%"
      && "0123456789".includes(fmt[match.index - 1] ?? " ")) continue;
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
    } else if (token === "%#" || token.toLowerCase() === "%[signature]") {
      signature ??= resolvePixels ? yield* resolvePixels("signature") : yield* signatureSteps(img ??= getImage());
      parts.push(signature);
    } else if (token === "%@") {
      short["@"] ??= resolvePixels ? yield* resolvePixels("trim-geometry") : yield* trimGeometrySteps(img ??= getImage(), function*(position, length) {
        yield;
        return { data: img!.data.subarray(position, position + length), ...(img!.data16 ? { data16: img!.data16.subarray(position, position + length) } : {}) };
      }, context.analysis);
      parts.push(short["@"]);
    } else if (token === "%T") {
      const delay = resolvePixels ? yield* resolvePixels("delay") : String((meta.delay ?? (img ??= getImage()).delay)?.[(meta as MagickImage)[magickInput]?.sceneIdx ?? context.sceneIdx ?? 0] ?? 0);
      parts.push(String(Number(delay) / 10));
    } else if (token === "%D") {
      const disposal = (meta as RgbaImage).disposal;
      parts.push(["Undefined", "None", "Background", "Previous"][(typeof disposal === "number" ? disposal : disposal?.[context.sceneIdx ?? 0]) ?? 0] ?? "Undefined");
    } else if (token === "%k" || token.toLowerCase() === "%[colors]") {
      if (resolvePixels) {
        short.k ??= yield* resolvePixels("colors");
      } else {
        img ??= getImage();
        if (pixels?.colors === undefined) pixels = yield* magickPixelPropertiesSteps(img, undefined, statistics, true, undefined, context.channelSelection, context.precision);
        short.k = pixels.colors!;
      }
      parts.push(short.k!);
    } else if (token[1] !== "[") {
      parts.push(short[token[1]!] ?? token);
    } else {
      const property = token.slice(2, -1);
      const key = property.toLowerCase();
      if (Object.hasOwn(properties, key)) {
        parts.push(properties[key]!);
      } else if (Object.hasOwn(properties, `artifact:${key}`)) {
        parts.push(properties[`artifact:${key}`]!);
      } else if (Object.hasOwn(context.optionProperties ?? {}, key.startsWith("option:") ? key.slice(7) : key)) {
        parts.push(context.optionProperties![key.startsWith("option:") ? key.slice(7) : key]!);
      } else if (key === "comment") {
        if (context.analysis) context.analysis.warnings += `magick: unknown image property '${token}'\n`;
        parts.push("");
      } else if (["mean", "min", "max", "median", "standard-deviation", "skewness", "kurtosis", "entropy", "opaque", "type", "bit-depth"].includes(key)) {
        if(resolvePixels){parts.push(yield*resolvePixels(property));continue;}
        img ??= getImage();
        pixels ??= yield* magickPixelPropertiesSteps(img, undefined, statistics, false, undefined, context.channelSelection, context.precision);
        parts.push(pixels[key]!);
      } else if (key.startsWith("fx:") || key.startsWith("pixel:") || key.startsWith("hex:")) {
        if(resolvePixels){parts.push(yield*resolvePixels(property));continue;}
        img ??= getImage();
        const fn = compileFxExpression(property.slice(property.indexOf(":") + 1));
        if (fn.needsStatistics) pixels ??= yield* magickPixelPropertiesSteps(img, undefined, statistics, false, undefined, context.channelSelection, context.precision);
        const ctx: FxEvalContext = { statistics, stack: [img], x: 0, y: 0, w: img.width, h: img.height, ch: 0, vars: new Map() };
        if (key.startsWith("fx:")) {
          parts.push(formatSignificantMetric(fn(ctx), context.precision));
        } else {
          const channels: number[] = [];
          const hexMaximum = (img.bitsPerSample ?? (img.depth === "ushort" ? 16 : 8)) > 8 ? 65535 : 255;
          for (const ch of img.space === "cmyk" ? (img.hasAlpha ? [0, 1, 2, 8, 3] : [0, 1, 2, 8]) : (img.hasAlpha ? [0, 1, 2, 3] : [0, 1, 2])) {
            ctx.vars.clear();
            if (key.startsWith("hex:")) {
              channels.push(Math.max(0, Math.min(hexMaximum, Math.round(fn({ ...ctx, ch }) * hexMaximum))));
              continue;
            }
            channels.push((img.space === "cmyk" || img.magickColorspace === "HSL" || img.magickColorspace === "HSB" || img.magickColorspace === "HWB" || img.magickColorspace === "XYZ" || img.magickColorspace === "YCbCr" || img.magickColorspace === "YUV" || img.magickColorspace === "CIELab") && key.startsWith("pixel:") ? fn({ ...ctx, ch }) : clampByteVal(fn({ ...ctx, ch }) * 255));
          }
          if (key.startsWith("hex:")) {
            parts.push(channels.map(value => value.toString(16).toUpperCase().padStart(hexMaximum === 65535 ? 4 : 2, "0")).join(""));
          } else {
            if (img.magickColorspace === "HSL" || img.magickColorspace === "HSB" || img.magickColorspace === "HWB" || img.magickColorspace === "XYZ" || img.magickColorspace === "YCbCr" || img.magickColorspace === "YUV" || img.magickColorspace === "CIELab") { parts.push(formatHuePixel(channels, img.magickColorspace, img.hasAlpha)); continue; }
            if (img.space === "cmyk") { parts.push(formatCmykPixel(channels, img.hasAlpha)); continue; }
            // Preserve the existing RGB pixel spelling for opaque samples.
            parts.push(channels[3] !== undefined && channels[3] !== 255
              ? `srgba(${channels.slice(0, 3).join(",")},${formatMetricNum(channels[3] / 255)})`
              : `srgb(${channels.slice(0, 3).join(",")})`);
          }
        }
      } else if (["*", "?", "["].some(character => property.includes(character))) {
        // Wildcards enumerate stored properties, not computed fields or artifacts.
        for (const name of Object.keys(meta.properties ?? {}).sort()) {
          yield;
          if (!name.toLowerCase().startsWith("artifact:") && (yield* matchesMagickGlob(key, name.toLowerCase()))) {
            parts.push(`${name}=${meta.properties![name]}\n`);
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
function* formatStoredFxSteps(property:string,{image,storage}:IdentifyRaster,getStatistics:()=>Generator<IdentifyStep,Record<string,number>,void>,signal?:AbortSignal,precision = 6):Generator<IdentifyStep,string,void>{
 const fn=compileFxExpression(property.slice(property.indexOf(":")+1)),key=property.toLowerCase(),samples=new Map<number,{data:Uint8Array;data16?:Uint16Array;hueSamples?:Float64Array}>();
 const statistics=fn.needsStatistics?yield*getStatistics():undefined;
 const context:FxEvalContext={statistics,stack:[image],x:0,y:0,w:image.width,h:image.height,ch:0,vars:new Map(),sample(target,x,y,ch){
  if(!target)return 0;
  const px=Math.max(0,Math.min(target.width-1,Math.round(x))),py=Math.max(0,Math.min(target.height-1,Math.round(y))),position=(py*target.width+px)*4;
  if(!Number.isFinite(position))return NaN;
  const data=samples.get(position);if(!data)throw new FxPixelDemand(position);
  // ImageMagick discards hidden PNG colors only when alpha is exactly zero.
  if(target.format === "png" && target.hasAlpha && (data.data16 ?? data.data)[3] === 0){
   data.data.fill(0,0,3);data.data16?.fill(0,0,3);
  }
  return sampleFxImage({...target,width:1,height:1,...data},0,0,ch);
 }};
 // The expression language has no loops or external effects. Replay after a
 // missing sample, resetting local assignments. Samples are bounded by the
 // expression's references, independent of image dimensions, and retired here.
 const channels:number[]=[];
 const hexMaximum=(image.bitsPerSample ?? (image.depth === "ushort" ? 16 : 8)) > 8 ? 65535 : 255;
 for(const ch of key.startsWith("fx:") ? [0] : image.space === "cmyk" ? (image.hasAlpha ? [0,1,2,8,3] : [0,1,2,8]) : (image.hasAlpha ? [0,1,2,3] : [0,1,2])){
  let value:number;
  while(true){
   signal?.throwIfAborted();context.vars.clear();
   try{value=fn({...context,ch});break;}
   catch(error){if(!(error instanceof FxPixelDemand))throw error;
    yield {async run(){const data=await storage.read(image.position+error.position,4,signal?{signal}:undefined);const hue = (image as StoredRgbaImage).storedHueSamples; const floatBytes = hue === undefined ? undefined : await storage.read(hue+error.position*8,32,signal?{signal}:undefined); const original=image.storedData16 ? await storage.read(image.storedData16.position+error.position*2,8,signal?{signal}:undefined) : undefined; samples.set(error.position,{data:new Uint8Array(data),...(floatBytes?{hueSamples:new Float64Array(floatBytes.buffer.slice(floatBytes.byteOffset,floatBytes.byteOffset+32))}:{}),...(original?{data16:new Uint16Array(original.buffer.slice(original.byteOffset,original.byteOffset+8))}:{})});}};
   }
  }
  if(key.startsWith("fx:"))return formatSignificantMetric(value, precision);
  if(key.startsWith("hex:")){channels.push(Math.max(0,Math.min(hexMaximum,Math.round(value*hexMaximum))));continue;}
  channels.push((image.space === "cmyk" || (image as StoredRgbaImage).magickColorspace === "HSL" || (image as StoredRgbaImage).magickColorspace === "HSB" || (image as StoredRgbaImage).magickColorspace === "HWB" || (image as StoredRgbaImage).magickColorspace === "XYZ" || (image as StoredRgbaImage).magickColorspace === "YCbCr" || (image as StoredRgbaImage).magickColorspace === "YUV" || (image as StoredRgbaImage).magickColorspace === "CIELab") && key.startsWith("pixel:") ? value : clampByteVal(value*255));
 }
 if(key.startsWith("hex:"))return channels.map(value=>value.toString(16).toUpperCase().padStart(hexMaximum === 65535 ? 4 : 2,"0")).join("");
 if(((image as StoredRgbaImage).magickColorspace === "HSL" || (image as StoredRgbaImage).magickColorspace === "HSB" || (image as StoredRgbaImage).magickColorspace === "HWB" || (image as StoredRgbaImage).magickColorspace === "XYZ" || (image as StoredRgbaImage).magickColorspace === "YCbCr" || (image as StoredRgbaImage).magickColorspace === "YUV" || (image as StoredRgbaImage).magickColorspace === "CIELab"))return formatHuePixel(channels, (image as StoredRgbaImage).magickColorspace as "HSL" | "HSB" | "HWB" | "XYZ" | "CIELab" | "YCbCr" | "YUV", image.hasAlpha);
 if(image.space === "cmyk")return formatCmykPixel(channels,image.hasAlpha);
 return channels[3]!==undefined&&channels[3]!==255?`srgba(${channels.slice(0,3).join(",")},${formatMetricNum(channels[3]/255)})`:`srgb(${channels.slice(0,3).join(",")})`;
}

async function formatRetainedIdentify(format:string,metadata:ImageMetadata,context:MagickFormatContext & { analysis?: { warnings: string }; optionProperties?: Record<string, string> | undefined },getRaster:()=>Promise<IdentifyRaster>,signal?:AbortSignal):Promise<string>{
 let raster:IdentifyRaster|undefined,properties:Record<string,string>|undefined;
 const statistics:Record<string,number>={};
 function* resolve(property:string):Generator<IdentifyStep,string,void>{
  if(!raster)yield {async run(){raster=await getRaster();}};
  if(property === "delay") {
   let delay = 0;
   yield { async run() { const scene = (metadata as MagickImage)[magickInput]?.sceneIdx ?? context.sceneIdx ?? 0; delay = await raster!.image.storedDelay?.at(scene, signal ? { signal } : undefined) ?? raster!.image.delay?.[scene] ?? 0; } };
   return String(delay);
  }
  if(property.includes(":"))return yield*formatStoredFxSteps(property,raster!,function*(){yield*resolve("mean");return statistics;},signal,context.precision);
  function* load(position:number,length:number):Generator<IdentifyStep,{data:Uint8Array;data16?:Uint16Array},void>{
   let chunk!: {data:Uint8Array;data16?:Uint16Array};
   yield {async run(){const {image,storage}=raster!,data=await storage.read(image.position+position,length,signal?{signal}:undefined);
    const original=image.storedData16;
    const bytes=original?await storage.read(original.position+position*2,Math.max(0,Math.min(length,original.length-position))*2,signal?{signal}:undefined):undefined;
    chunk={data,...(bytes?{data16:new Uint16Array(bytes.buffer,bytes.byteOffset,bytes.byteLength/2)}:{})};
   }};
   return chunk;
  }
  if(property === "trim-geometry")return yield*trimGeometrySteps(raster!.image,load,context.analysis);
  if(property === "signature")return yield*signatureSteps(raster!.image,load);
  if(!properties || (property === "colors" && properties.colors === undefined))properties=yield*magickPixelPropertiesSteps(raster!.image,load,statistics,property === "colors", function*(position, length): Generator<IdentifyStep, Uint8Array, void> {
   let data!: Uint8Array;
   yield { async run() { data = await raster!.storage.read((raster!.image as StoredRgbaImage).readMask!.position! + position, length, signal ? { signal } : undefined); } };
   return data;
  }, context.channelSelection, context.precision);
  return properties[property.toLowerCase()]!;
 }
 return drainIdentifySteps(formatMagickPropertyStringSteps(format,metadata,()=>{throw new UnsupportedStoredResource("Pixel formatting requires decoded input");},context,resolve),signal);
}

function* formatTxtEnumerationSteps(img: RgbaImage, depth?: number): Generator<void, string, void> {
    const maximum = ["HSL", "HSB", "HWB", "XYZ"].includes(img.magickColorspace ?? "") && (depth ?? img.bitsPerSample ?? (img.depth === "ushort" ? 16 : 8)) <= 8 ? 255 : 65535;
    const colorspace = `${img.space === "b-w" || img.space === "grey16" ? "gray" : img.magickColorspace === "RGB" ? "rgb" : "srgb"}${img.hasAlpha ? "a" : ""}`;
    const srgbDepth = depth !== undefined && img.space === "srgb" && !img.magickColorspace;
    const gray16 = (img.space === "b-w" || img.space === "grey16") && img.data16 !== undefined;
    let work = 0;
    const lines: string[] = [
        srgbDepth ? `# ImageMagick pixel enumeration: ${img.width},${img.height},0,${depth > 8 ? 65535 : 255},srgb${img.hasAlpha ? "a" : ""}` : gray16 ? `# ImageMagick pixel enumeration: ${img.width},${img.height},0,65535,gray${img.hasAlpha ? "a" : ""}` : (img.magickColorspace === "HSL" || img.magickColorspace === "HSB" || img.magickColorspace === "HWB" || img.magickColorspace === "XYZ" || img.magickColorspace === "YCbCr" || img.magickColorspace === "YUV" || img.magickColorspace === "CIELab") ? `# ImageMagick pixel enumeration: ${img.width},${img.height},0,${maximum},${img.magickColorspace.toLowerCase()}${img.hasAlpha ? "a" : ""}` : `# ImageMagick pixel enumeration: ${img.width},${img.height},0,255,${colorspace}`
    ];
    for (let y = 0; y < img.height; y++) {
        if (++work % 16384 === 0)
            yield;
        for (let x = 0; x < img.width; x++) {
            if (++work % 16384 === 0)
                yield;
            const idx = (y * img.width + x) * 4;
            if (srgbDepth) {
                lines.push(srgbDepthEnumerationLine(x, y, (img.data16 ?? img.data).subarray(idx, idx + 4), img.hasAlpha, depth));
                continue;
            }
            if (gray16) {
                lines.push(gray16EnumerationLine(x, y, img.data16![idx]!, img.hasAlpha ? img.data16![idx + 3]! : undefined));
                continue;
            }
            const r = img.data[idx]!;
            const g = img.data[idx + 1]!;
            const b = img.data[idx + 2]!;
            const a = img.data[idx + 3]!;
            lines.push((img.magickColorspace === "HSL" || img.magickColorspace === "HSB" || img.magickColorspace === "HWB" || img.magickColorspace === "XYZ" || img.magickColorspace === "YCbCr" || img.magickColorspace === "YUV" || img.magickColorspace === "CIELab") ? `${x},${y}: ${hueTextPixel(Array.from(img.data16?.subarray(idx, idx + 4) ?? img.data.subarray(idx, idx + 4), value => img.data16 ? value : value * 257), img.hasAlpha, img.magickColorspace, (img.magickColorspace === "HSL" || img.magickColorspace === "HWB" || img.magickColorspace === "XYZ" || img.magickColorspace === "YCbCr" || img.magickColorspace === "YUV" || img.magickColorspace === "CIELab") && img.hueSamples ? Array.from(img.hueSamples.subarray(idx, idx + 4)) : undefined, maximum)}` : pixelEnumerationLine(x, y, r, g, b, a, colorspace));
        }
    }
    return lines.join("\n") + "\n";
}

function* formatHistogramOutputSteps(img: RgbaImage): Generator<void, string, void> {
    let work = 0;
    const counts = new Map<number | bigint | string, number>();
    for (let i = 0; i < img.data.length; i += 4) {
        if (++work % 16384 === 0)
            yield;
        const key = (img.magickColorspace === "HSL" || img.magickColorspace === "HSB" || img.magickColorspace === "HWB" || img.magickColorspace === "XYZ" || img.magickColorspace === "YCbCr" || img.magickColorspace === "YUV" || img.magickColorspace === "CIELab") ? hueTextPixel(Array.from(img.data16?.subarray(i, i + 4) ?? img.data.subarray(i, i + 4), value => img.data16 ? value : value * 257), img.hasAlpha, img.magickColorspace, (img.magickColorspace === "HSL" || img.magickColorspace === "HWB" || img.magickColorspace === "XYZ" || img.magickColorspace === "YCbCr" || img.magickColorspace === "YUV" || img.magickColorspace === "CIELab") && img.hueSamples ? Array.from(img.hueSamples.subarray(i, i + 4)) : undefined) : img.data16 ? img.data16.subarray(i, i + 4).reduce((key, value) => (key << 16n) | BigInt(value), 0n) : ((img.data[i]! << 24) | (img.data[i + 1]! << 16) | (img.data[i + 2]! << 8) | img.data[i + 3]!) >>> 0;
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const lines: string[] = [];
    for (const [key, cnt] of [...counts.entries()].sort(([a], [b]) => typeof a !== "string" && typeof b !== "string" ? a < b ? -1 : a > b ? 1 : 0 : 0)) {
        if (++work % 16384 === 0)
            yield;
        lines.push(typeof key === "string" ? `  ${cnt}: ${key}` : histogramLine(key, cnt, img.hasAlpha));
    }
    return lines.join("\n") + "\n";
}

function writeGradientPixel(data: Uint8Array, samples: Uint16Array, offset: number, first: RgbaColor, last: RgbaColor, t: number): void {
    const firstAlpha = first.a * (1 - t);
    const lastAlpha = last.a * t;
    const alpha = firstAlpha + lastAlpha;
    const divisor = alpha || 1;
    samples[offset] = Math.round((first.r * firstAlpha + last.r * lastAlpha) / divisor * 257);
    data[offset] = clampByteVal(samples[offset]! / 257);
    samples[offset + 1] = Math.round((first.g * firstAlpha + last.g * lastAlpha) / divisor * 257);
    data[offset + 1] = clampByteVal(samples[offset + 1]! / 257);
    samples[offset + 2] = Math.round((first.b * firstAlpha + last.b * lastAlpha) / divisor * 257);
    data[offset + 2] = clampByteVal(samples[offset + 2]! / 257);
    samples[offset + 3] = Math.round(alpha * 257);
    data[offset + 3] = clampByteVal(samples[offset + 3]! / 257);
}
function* createGradientImageSteps(width: number, height: number, c1: RgbaColor, c2: RgbaColor, radial: boolean, direction?: string, angle?: number, vector?: string, box?: MagickGeometry, center?: { x: number; y: number }, radii?: string, extent?: string): Generator<void, RgbaImage, void> {
    let work = 0;
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    const data = new Uint8Array(new ArrayBuffer(w * h * 4 + h), 0, w * h * 4);
    const data16 = new Uint16Array(w * h * 4);
    const axes = gradientRadii(w, h, extent, radii);
    const vectorFactor = gradientVector(w, h, (radial && center) ? undefined : radial || angle === undefined ? vector : undefined, radial, axes);
    if (!radial && direction === undefined && angle === undefined && !vectorFactor && box === undefined) {
        const u64 = new BigUint64Array(data16.buffer);
        const u32 = new Uint32Array(data.buffer, 0, w * h);
        const tmp = new Uint8Array(4);
        const samples = new Uint16Array(4);
        const tmp64 = new BigUint64Array(samples.buffer);
        const tmp32 = new Uint32Array(tmp.buffer);
        const steps = h === 1 ? w : h;
        const span = h === 1 ? 1 : w;
        for (let i = 0; i < steps; i++) {
            const t = steps <= 1 ? 0 : i * (1 / (steps - 1));
            writeGradientPixel(tmp, samples, 0, c1, c2, t);
            u64.fill(tmp64[0]!, i * span, (i + 1) * span);
            u32.fill(tmp32[0]!, i * span, (i + 1) * span);
        }
    } else {
        const cx = center?.x ?? (w - 1) / 2;
        const cy = center?.y ?? (h - 1) / 2;
        const projection = gradientProjection(w, h, direction, angle);
        for (let y = 0; y < h; y++) {
            if (++work % 16384 === 0)
                yield;
            for (let x = 0; x < w; x++) {
                if (++work % 16384 === 0)
                    yield;
                const outside = box && (x < box.x || y < box.y || x >= box.x + (box.width ?? w) || y >= box.y + (box.height ?? h));
                const t = outside ? 0 : vectorFactor ? vectorFactor(x, y) : radial ? Math.min(1, Math.hypot((x - cx) / axes[0], (y - cy) / axes[1])) : Math.max(0, Math.min(1, projection.offset + x * projection.x + y * projection.y));
                const idx = (y * w + x) * 4;
                writeGradientPixel(data, data16, idx, c1, c2, t);
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
        hasAlpha: c1.a < 255 || c2.a < 255,
        data,
        data16
    };
}

function* createPatternImageSteps(width: number, height: number, pattern: ReturnType<typeof builtinPattern>): Generator<void, RgbaImage, void> {
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
            const cell = pattern.gray(x, y);
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

function resolveMagickSpliceGeometry(raw: string, width: number, height: number) {
    // Splice treats @ dimensions literally, unlike resize's area geometry.
    const g = parseMagickGeometry(raw.replaceAll("@", ""));
    const hasDimensions = raw.toLowerCase().includes("x");
    return { ...g,
        width: Math.max(0, Math.round(g.aspectRatio !== undefined ? Math.min(width, height * g.aspectRatio) : g.isPercent
            ? (g.width ?? 100) * width / 100
            : g.width ?? (hasDimensions ? 0 : width))),
        height: Math.max(0, Math.round(g.aspectRatio !== undefined ? Math.min(height, width / g.aspectRatio) : g.isPercent
            ? (g.height ?? g.width ?? 100) * height / 100
            : g.height ?? (hasDimensions ? 0 : height)))
    };
}

function resolveMagickChopGeometry(g: MagickGeometry, raw: string, width: number, height: number) {
    if (g.aspectRatio !== undefined) {
        return {
            width: Math.max(0, Math.round(Math.min(width, height * g.aspectRatio))),
            height: Math.max(0, Math.round(Math.min(height, width / g.aspectRatio)))
        };
    }
    const offsetOnly = g.hasOffset && g.width === undefined && g.height === undefined;
    return {
        width: offsetOnly ? width : Math.max(0, Math.round((g.width ?? 0) * (g.isPercent ? width / 100 : 1))),
        height: offsetOnly ? height : Math.max(0, Math.round((g.height ?? (g.isPercent || raw.toLowerCase().includes("x") ? 0 : height)) * (g.isPercent ? height / 100 : 1)))
    };
}

function parseMagickRotationalBlurAngle(raw: string): number {
    const suffix = [...raw].findIndex(c => "xX!#%(),/:<>@\\^".includes(c));
    const degrees = (suffix < 0 ? raw : raw.slice(0, suffix)).trim();
    const angle = Number(degrees);
    if (!degrees || Number.isNaN(angle) || [...raw].some(c => c.trim() !== "" && !"0123456789eExX!#%()+,-./:<>@\\^".includes(c))) {
        throw new Error(`invalid argument for option '-rotational-blur': ${raw}`);
    }
    return angle;
}

function parseMagickVignetteGeometry(raw: string): MagickGeometry {
    if (!raw.trim() || [...raw].some(c => c.trim() !== "" && !"0123456789eExX!#%()+,-./:<>@\\^".includes(c))) {
        throw new Error(`invalid argument for option '-vignette': ${raw}`);
    }
    return parseMagickGeometry(raw);
}

function parseMagickRaiseGeometry(raw: string, option: string): MagickGeometry {
    if (!raw.trim() || [...raw].some(c => c.trim() !== "" && !"0123456789eExX!#%()+,-./:<>@\\^".includes(c))) {
        throw new Error(`invalid argument for option '${option}': ${raw}`);
    }
    return parseMagickGeometry(raw);
}

function validateMagickSpliceGeometry(raw: string): void {
    // Native geometry permits modifiers and separators, but never ignores unknown characters.
    if (!raw.trim() || [...raw].some(c => c.trim() !== "" && !"0123456789eExX!#%()+,-./:<>@\\^".includes(c))) {
        throw new Error(`invalid argument for option '-splice': ${raw}`);
    }
}

function* applyMagickSpliceSteps(img: RgbaImage, geomStr: string, bg: RgbaColor, gravity: GravityPosition = "northwest", signal?: AbortSignal): Generator<void, RgbaImage, void> {
    let cooperativeWork = 0;
    const g = resolveMagickSpliceGeometry(geomStr, img.width, img.height);
    const sw = g.width, sh = g.height;
    // Native splice rounds the gravity box and the splice anchor separately.
    const box = gravityAdjustBox(img.width, img.height, sw, sh, g.x, g.y, gravity);
    // Native West splice uses the width for its vertical anchor.
    const anchor = resolveGravityOffset(sw, gravity === "west" ? sw : sh, gravity);
    const outW = img.width + sw;
    const outH = img.height + sh;
    const xOffset = box.x + anchor.left;
    // Clip the inserted band at the left edge; the canvas still grows by sw.
    // Unfilled columns read virtual edge pixels from the source.
    const spliceWidth = Math.max(0, sw + Math.min(0, xOffset));
    const sx = xOffset > img.width ? outW : Math.max(0, xOffset);
    if (box.y + anchor.top > outH) throw new Error("pixels are not authentic");
    const sy = Math.max(0, Math.min(img.height, box.y + anchor.top));
    const out = new Uint8Array(new ArrayBuffer(outW * outH * 4 + outH), 0, outW * outH * 4);
    const data16 = img.data16 ? new Uint16Array(out.length) : undefined;
    const background = [bg.r, bg.g, bg.b, bg.a].map(value => Math.round(value * 257));
    for (let y = 0; y < outH; y++) {
        if (++cooperativeWork % 65536 === 0)
            yield;
        for (let x = 0; x < outW; x++) {
            if (++cooperativeWork % 65536 === 0)
                yield;
            const dstIdx = (y * outW + x) * 4;
            if ((x >= sx && x < sx + spliceWidth) || (y >= sy && y < sy + sh)) {
                out[dstIdx] = Math.round(bg.r);
                out[dstIdx + 1] = Math.round(bg.g);
                out[dstIdx + 2] = Math.round(bg.b);
                out[dstIdx + 3] = Math.round(bg.a);
                if (data16) data16.set(background, dstIdx);
            }
            else {
                const origX = Math.min(img.width - 1, x < sx ? x : x - spliceWidth);
                const origY = y < sy ? y : y - sh;
                const srcIdx = (origY * img.width + origX) * 4;
                out[dstIdx] = img.data[srcIdx]!;
                out[dstIdx + 1] = img.data[srcIdx + 1]!;
                out[dstIdx + 2] = img.data[srcIdx + 2]!;
                out[dstIdx + 3] = img.data[srcIdx + 3]!;
                if (data16) data16.set(img.data16!.subarray(srcIdx, srcIdx + 4), dstIdx);
            }
        }
    }
    const virtualCanvas = magickResizeCanvas(img, outW, outH);
    return { ...img, width: outW, height: outH, data: out, ...(data16 ? { data16 } : {}), hasAlpha: true, ...(virtualCanvas ? { virtualCanvas } : {}) };
}

function* applyMagickChopSteps(img: RgbaImage, geomStr: string, gravity: GravityPosition = "northwest", signal?: AbortSignal, analysis?: { warnings: string }): Generator<void, RgbaImage, void> {
    let cooperativeWork = 0;
    const g = parseMagickGeometry(geomStr);
    const { width: cw, height: ch } = resolveMagickChopGeometry(g, geomStr, img.width, img.height);
    const { x: x0, y: y0 } = gravityAdjustBox(img.width, img.height, cw, ch, g.x, g.y, gravity);
    if (x0 + cw < 0 || y0 + ch < 0 || x0 > img.width || y0 > img.height) {
        if (analysis) analysis.warnings += `magick: geometry does not contain image '${geomStr}'\n`;
        return img;
    }
    const cx0 = Math.max(0, Math.min(img.width, x0));
    const cx1 = Math.max(cx0, Math.min(img.width, x0 + cw));
    const cy0 = Math.max(0, Math.min(img.height, y0));
    const cy1 = Math.max(cy0, Math.min(img.height, y0 + ch));
    const choppedW = cx1 - cx0;
    const choppedH = cy1 - cy0;
    if (choppedW >= img.width || choppedH >= img.height) {
        if (analysis) analysis.warnings += `magick: geometry does not contain image '${geomStr}'\n`;
        return img;
    }
    const outW = img.width - choppedW;
    const outH = img.height - choppedH;
    const out = new Uint8Array(new ArrayBuffer(outW * outH * 4 + outH), 0, outW * outH * 4);
    const data16 = img.data16 ? new Uint16Array(out.length) : undefined;
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
            if (data16) data16.set(img.data16!.subarray(srcIdx, srcIdx + 4), dstIdx);
        }
    }
    const virtualCanvas = magickResizeCanvas(img, outW, outH);
    return { ...img, width: outW, height: outH, data: out, ...(data16 ? { data16 } : {}), ...(virtualCanvas ? { virtualCanvas } : {}) };
}

function validateMagickTransformGeometry(raw: string, option: string): void {
    const value = raw.trim();
    let dimensions = false;
    for (const char of value) {
        if (char === "x" || char === "X" || char === ":") dimensions = true;
        if ((char.trim() !== "" && !"0123456789eExX!#%()+,-./:<>@\\^".includes(char)) ||
            (!dimensions && (char === "/" || (char === "," && value[0] !== "+" && value[0] !== "-")))) {
            throw new Error(`invalid argument for option '${option}': ${raw}`);
        }
    }
    if (!value || value === "+" || value === "-") throw new Error(`invalid argument for option '${option}': ${raw}`);
}

function parseMagickBorderGeometry(raw: string): MagickGeometry {
    validateMagickTransformGeometry(raw, "-border");
    const geometry = parseMagickGeometry(raw.replace(":", "x"));
    if (geometry.width === undefined && geometry.height === undefined && geometry.aspectRatio === undefined && geometry.areaLimit === undefined) {
        throw new Error(`invalid argument for option '-border': ${raw}`);
    }
    return geometry.height === undefined && raw.toLowerCase().includes("x") ? { ...geometry, height: 0 } : geometry;
}

function parseMagickRollGeometry(raw: string): MagickGeometry {
    raw = raw.replaceAll(" ", "");
    const normalized = normalizeMagickHexOffsets(raw.replaceAll("#", ""));
    // Native roll consumes at most two offsets; comma/colon ends the offset list.
    let offsets = 0;
    let end = normalized.length;
    for (let i = 0; i < normalized.length; i++) {
        const char = normalized[i];
        if ((char === "+" || char === "-") && normalized[i - 1]?.toLowerCase() !== "e") {
            offsets++;
            if (offsets > 2) { end = i; break; }
        } else if (offsets > 0 && (char === "," || char === ":")) {
            end = i;
            break;
        }
    }
    const geometry = parseMagickGeometry(normalized.slice(0, end));
    // Native percentage roll geometries leave the pixel offsets at zero.
    if (raw.includes("%")) return { ...geometry, x: 0, y: 0 };
    // A size followed by offsets needs an x separator, even with no height.
    if (geometry.hasOffset && geometry.width !== undefined && !normalized.toLowerCase().includes("x")) {
        throw new Error(`invalid argument for option '-roll': ${raw}`);
    }
    return { ...geometry, x: Math.trunc(geometry.x), y: Math.trunc(geometry.y) };
}

function* applyMagickRollSteps(img: RgbaImage, geomStr: string, signal?: AbortSignal): Generator<void, RgbaImage, void> {
    let cooperativeWork = 0;
    const g = parseMagickRollGeometry(geomStr);
    const rx = g.x;
    const ry = g.y;
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

function parseMagickMorphCount(argument: string): number {
    validateMagickTransformGeometry(argument, "-morph");
    const count = Number.parseInt(argument, 10) || 0;
    if (!Number.isFinite(count)) throw new Error(`invalid argument for option '-morph': ${argument}`);
    return Math.max(0, count);
}

function* applyMagickMorphSteps(stack: readonly RgbaImage[], countRaw: number, channels: readonly boolean[] | undefined, kernel: ResizeKernel | undefined, signal?: AbortSignal, settings?: ResizeFilterSettings): Generator<void, RgbaImage[], void> {
    let cooperativeWork = 0;
    const count = Math.max(0, Math.trunc(countRaw));
    if (stack.length === 1 && count > 1) {
        const out: RgbaImage[] = [];
        for (let index = 0; index < count; index++) {
            if (++cooperativeWork % 65536 === 0) yield;
            out.push(stack[0]!);
        }
        return out;
    }
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
            const virtualCanvas = magickResizeCanvas(a, w, h);
            out.push({ ...yield* applyMagickRasterSteps(a, morphPixelSteps(a, b, w, h, t, channels, !!(a.data16 || b.data16), kernel, settings), signal, { ...a, width: w, height: h }, [a, b]), ...(virtualCanvas ? { virtualCanvas } : {}) });
        }
    }
    out.push(stack[stack.length - 1]!);
    return out;
}

function hasSceneOutputPattern(path: string, literal = false): boolean {
    if (literal) return false;
    for (let index = 0; index < path.length; index++) if (path[index] === "%") {
        if (path[index + 1] === "%") { index++; continue; }
        let end = index + 1;
        while (path[end] !== undefined && path[end]! >= "0" && path[end]! <= "9") end++;
        if (path[end] === "d" || path[end] === "o" || path[end] === "x") return true;
    }
    return false;
}

function formatAdjoinedOutputPath(path: string, count: number, scene: number, literal = false): string {
    if (count > 1) {
        if (literal) {
            if (hasSceneOutputPattern(path)) return formatSceneOutputPath(path, scene, true);
        } else {
            for (let index = 0; index < path.length; index++) if (path[index] === "%") {
                if (path[index + 1] === "%") { index++; continue; }
                return formatSceneOutputPath(path, scene);
            }
        }
    }
    return literal ? path : path.replaceAll("%%", "%");
}

function formatSceneOutputPath(pattern: string, index: number, literal = false, properties?: ImageMetadata["properties"]): string {
  let path = "", hasScene = false;
  for (let cursor = 0; cursor < pattern.length; cursor++) {
    if (!literal && pattern[cursor] === "%") {
      if (pattern[cursor + 1] === "%") {
        path += "%";
        cursor++;
        continue;
      }
      if (pattern.startsWith("%[", cursor)) {
        const end = pattern.indexOf("]", cursor + 2);
        if (end >= 0) {
          const key = pattern.slice(cursor + 2, end).toLowerCase();
          const value = key.startsWith("filename:") ? properties?.[key] : undefined;
          path += value ?? pattern.slice(cursor + 1, end + 1);
          hasScene = true;
          cursor = end;
          continue;
        }
      }
      let end = cursor + 1;
      while (pattern[end] !== undefined && pattern[end]! >= "0" && pattern[end]! <= "9") end++;
      if (pattern[end] === "d" || pattern[end] === "o" || pattern[end] === "x") {
        const width = Number(pattern.slice(cursor + 1, end));
        path += index.toString(pattern[end] === "o" ? 8 : pattern[end] === "x" ? 16 : 10).padStart(width, pattern[cursor + 1] === "0" ? "0" : " ");
        hasScene = true;
        cursor = end;
        continue;
      }
    }
    path += pattern[cursor];
  }
  if (hasScene) return path;
  const dot = path.lastIndexOf(".");
  if (dot > 0) {
    return `${path.slice(0, dot)}-${index}${path.slice(dot)}`;
  }
  return `${path}-${index}`;
}

function parseChannelMask(spec: string): { r: boolean; g: boolean; b: boolean; a: boolean } {
  const names: Record<string, string> = {
    r: "r", red: "r", c: "r", cyan: "r", gray: "r", h: "r", hue: "r",
    g: "g", green: "g", m: "g", magenta: "g", s: "g", saturation: "g",
    b: "b", blue: "b", y: "b", yellow: "b", l: "b", lightness: "b",
    a: "a", alpha: "a", o: "a",
    all: "rgba", default: "rgba", sync: "", k: "", black: "",
    "0": "r", "1": "g", "2": "b", "3": "", "4": "a",
    readmask: "", writemask: "", meta0: ""
  };
  let selected = "";
  for (const part of spec.toLowerCase().split(spec.includes("|") ? "|" : ",")) {
    // Native consumes one name per delimiter; whitespace ends that name.
    const trimmed = part.trim();
    let end = 0;
    while (end < trimmed.length && trimmed[end]!.trim() !== "") end++;
    const token = trimmed.slice(0, end);
    if (token.startsWith("!") && Object.hasOwn(names, token.slice(1))) {
      const excluded = names[token.slice(1)]!;
      selected = [...selected].filter(channel => !excluded.includes(channel)).join("");
    } else if (Object.hasOwn(names, token)) selected += names[token];
    else if (token.length > 0 && [...token].every(c => "rgbacmyko".includes(c))) {
      for (const c of token) selected += names[c];
    } else throw new Error(`unrecognized channel type '${spec}'`);
  }
  return { r: selected.includes("r"), g: selected.includes("g"), b: selected.includes("b"), a: selected.includes("a") };
}

function clampByteVal(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(255, Math.round(n)));
}

function* applyMagickOpaqueSteps(img: RgbaImage, target: RgbaColor, replacement: RgbaColor, fuzz: number, invert: boolean, channels: MagickState["channels"], signal?: AbortSignal): Generator<void, RgbaImage, void> {
    let cooperativeWork = 0;
    const out = new Uint8Array(img.data);
    const data16 = img.data16 ? new Uint16Array(img.data16) : undefined;
    const samples = data16 ?? out, scale = data16 ? 257 : 1;
    const gray = img.space === "b-w" || img.space === "grey16";
    const mask = [channels.r, channels.g, channels.b, channels.a];
    const paint = [replacement.r, replacement.g, replacement.b, replacement.a];
    for (let i = 0; i < out.length; i += 4) {
        if (++cooperativeWork % 65536 === 0)
            yield;
        const dr = Math.abs(samples[i]! / scale - target.r);
        const dg = Math.abs(samples[i + 1]! / scale - target.g);
        const db = Math.abs(samples[i + 2]! / scale - target.b);
        const alpha = samples[i + 3]! / scale;
        // Native opaque painting compares alpha plus opacity-weighted RGB distance.
        const distance = (alpha - target.a) ** 2
            + (dr ** 2 + dg ** 2 + db ** 2) * (alpha / 255) * (target.a / 255) / 3;
        const matched = distance <= fuzz ** 2;
        if (invert ? !matched : matched) {
            for (let channel = 0; channel < 4; channel++) {
                if (!mask[channel]) continue;
                // Grayscale RGB channels share one sample; the last selected write wins.
                const start = gray && channel < 3 ? 0 : channel;
                const end = gray && channel < 3 ? 3 : channel + 1;
                for (let output = start; output < end; output++) {
                    out[i + output] = paint[channel]!;
                    if (data16) data16[i + output] = paint[channel]! * 257;
                }
            }
        }
    }
    return { ...img, data: out, ...(data16 ? { data16 } : {}), hasAlpha: img.hasAlpha || channels.a && replacement.a < 255 };
}

function* applyMagickTransparentSteps(img: RgbaImage, target: RgbaColor, fuzz: number, invert: boolean, signal?: AbortSignal): Generator<void, RgbaImage, void> {
    let cooperativeWork = 0;
    const out = new Uint8Array(img.data);
    const data16 = img.data16 ? new Uint16Array(img.data16) : undefined;
    const samples = data16 ?? out, scale = data16 ? 257 : 1;
    for (let i = 0; i < out.length; i += 4) {
        if (++cooperativeWork % 65536 === 0)
            yield;
        const dr = Math.abs(samples[i]! / scale - target.r);
        const dg = Math.abs(samples[i + 1]! / scale - target.g);
        const db = Math.abs(samples[i + 2]! / scale - target.b);
        const alpha = samples[i + 3]! / scale;
        // Native transparent painting compares alpha plus opacity-weighted RGB distance.
        const distance = (alpha - target.a) ** 2
            + (dr ** 2 + dg ** 2 + db ** 2) * (alpha / 255) * (target.a / 255) / 3;
        const matched = distance <= fuzz ** 2;
        if (invert ? !matched : matched) {
            out[i + 3] = 0;
            if (data16) data16[i + 3] = 0;
        }
    }
    return { ...img, data: out, ...(data16 ? { data16 } : {}), hasAlpha: true };
}

function* applyMagickEvaluateSteps(img: RgbaImage, op: string, valStr: string, channels: {
    r: boolean;
    g: boolean;
    b: boolean;
    a: boolean;
}, random: (() => number) | undefined, signal?: AbortSignal): Generator<void, RgbaImage, void> {
    let cooperativeWork = 0;
    const isPct = valStr.trim().endsWith("%");
    const rawNum = parseFloat(valStr);
    const vByte = isPct
        ? (rawNum / 100) * 255
        : rawNum / 257;
    const vFactor = isPct ? (rawNum / 100) * 65535 : rawNum;
    // Native Sine/Cosine percentages scale by QuantumRange + 1.
    const vFrequency = isPct ? (rawNum / 100) * 65536 : rawNum;
    const out = new Uint8Array(img.data);
    const mask = [channels.r, channels.g, channels.b, channels.a && img.hasAlpha];
    // Keep HDRI samples separate from the bounded encoding views.
    const evaluateSamples = img.evaluateSamples?.slice() ?? Float64Array.from(img.data16 ?? img.data, value => img.data16 ? value / 257 : value);
    const data16 = img.data16 ? new Uint16Array(img.data16) : undefined;

    for (let i = 0; i < out.length; i += 4) {
        if (++cooperativeWork % 65536 === 0) {
            signal?.throwIfAborted();
            yield;
        }
        for (let c = 0; c < 4; c++) {
            if (++cooperativeWork % 65536 === 0)
                yield;
            if (!mask[c])
                continue;
            const cur = evaluateSamples[i + c]!;
            let next = cur;
            switch (op) {
                case "clamp":
                    next = Math.max(0, Math.min(255, cur));
                    break;
                case "uniformnoise":
                case "gaussiannoise":
                case "laplaciannoise":
                case "multiplicativenoise":
                case "poissonnoise":
                case "impulsenoise":
                    next = yield* evaluateNoiseSteps(cur, op, vFactor, random!);
                    break;
                case "median":
                    next = cur + vByte;
                    break;
                case "add":
                case "sum":
                    // Native percentages use QuantumRange + 1 before scaling to bytes.
                    next = cur + (isPct ? (rawNum / 100) * 65536 / 257 : vByte);
                    break;
                case "addmodulus":
                    // Wrap Q16 samples before reducing to the byte-scale HDRI view.
                    next = (((cur * 257 + (isPct ? rawNum / 100 * 65536 : rawNum)) % 65536) + 65536) % 65536 / 257;
                    break;
                case "mean":
                    next = (cur + vByte) / 2;
                    break;
                case "rms":
                case "rootmeansquare":
                    // Evaluate squares Q16 values; only evaluate-sequence takes the root.
                    next = cur * cur * 257 + vByte;
                    break;
                case "subtract":
                    // Native percentages use QuantumRange + 1 before scaling to bytes.
                    next = cur - (isPct ? (rawNum / 100) * 65536 / 257 : vByte);
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
                case "exp":
                case "exponential":
                    next = 255 * Math.exp(vFactor * (cur / 255));
                    break;
                case "log":
                    next = vFactor === 0 ? 0 : 255 * Math.log(1 + vFactor * (cur / 255)) / Math.log(1 + vFactor);
                    break;
                case "inverselog":
                    next = vFactor === 0 ? 255 : 255 * Math.pow(vFactor + 1, cur / 255 - 1) / vFactor;
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
                    // Native adds half a quantum before truncating masks toward zero.
                    next = ((cur * 257) & Math.trunc(vFactor + 0.5)) / 257;
                    break;
                case "or":
                    next = ((cur * 257) | Math.trunc(vFactor + 0.5)) / 257;
                    break;
                case "xor":
                    next = ((cur * 257) ^ Math.trunc(vFactor + 0.5)) / 257;
                    break;
                case "leftshift":
                    next = cur === 0 ? 0 : cur * 2 ** Math.max(0, Math.round(vFactor));
                    break;
                case "rightshift":
                    // Preserve quantum precision until byte encoding; JS shifts truncate and wrap at 32 bits.
                    next = cur / 2 ** Math.max(0, Math.trunc(vFactor));
                    break;
                case "abs":
                    next = Math.abs(cur + vByte);
                    break;
                case "sin":
                case "sine":
                    next = 255 * (0.5 + 0.5 * Math.sin(2 * Math.PI * vFrequency * (cur / 255)));
                    break;
                case "cos":
                case "cosine":
                    next = 255 * (0.5 + 0.5 * Math.cos(2 * Math.PI * vFrequency * (cur / 255)));
                    break;
                case "threshold":
                    next = cur > vByte ? 255 : 0;
                    break;
                case "thresholdblack":
                    next = cur <= vByte ? 0 : cur;
                    break;
                case "thresholdwhite":
                    next = cur > vByte ? 255 : cur;
                    break;
                default:
                    break;
            }
            evaluateSamples[i + c] = next;
            // Positive overflow saturates on output while HDRI samples retain their range.
            out[i + c] = clampByteVal(Math.min(255, next));
            if (data16) data16[i + c] = Math.round(Math.max(0, Math.min(65535, next * 257)));
        }
    }
    return { ...img, data: out, evaluateSamples, ...(data16 ? { data16 } : {}) };
}

function* applyMagickFunctionSteps(img: RgbaImage, funcRaw: string, params: readonly number[], channels: {
    r: boolean;
    g: boolean;
    b: boolean;
    a: boolean;
}, signal?: AbortSignal): Generator<void, RgbaImage, void> {
    let cooperativeWork = 0;
    const fn = funcRaw.toLowerCase();
    const out = new Uint8Array(img.data);
    const data16 = img.data16?.slice();
    const evaluateSamples = img.evaluateSamples?.slice() ?? Float64Array.from(img.data16 ?? img.data, value => img.data16 ? value / 257 : value);
    const mask = [channels.r, channels.g, channels.b, channels.a && img.hasAlpha];
    for (let i = 0; i < out.length; i += 4) {
        if (++cooperativeWork % 65536 === 0)
            yield;
        for (let c = 0; c < 4; c++) {
            if (++cooperativeWork % 65536 === 0)
                yield;
            if (!mask[c])
                continue;
            const x = evaluateSamples[i + c]! / 255;
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
                // Match native Q16-HDRI float storage before rounding to a byte.
                y = Math.fround(Math.max(0, Math.min(1, y)) * 65535) / 65535;
            }
            else if (fn === "arcsin") {
                const w = params[0] ?? 1;
                const center = params[1] ?? 0.5;
                const range = params[2] ?? 1;
                const bias = params[3] ?? 0.5;
                const arg = x === center ? 0 : Math.max(-1, Math.min(1, (2 / w) * (x - center)));
                y = (range / Math.PI) * Math.asin(arg) + bias;
            }
            else if (fn === "arctan") {
                const slope = params[0] ?? 1;
                const center = params[1] ?? 0.5;
                const range = params[2] ?? 1;
                const bias = params[3] ?? 0.5;
                y = (range / Math.PI) * Math.atan(slope * Math.PI * (x - center)) + bias;
            }
            evaluateSamples[i + c] = y * 255;
            out[i + c] = clampByteVal(y * 255);
            if (data16) data16[i + c] = Math.round(Math.max(0, Math.min(1, y)) * 65535);
        }
    }
    return { ...img, data: out, evaluateSamples, ...(data16 ? { data16 } : {}) };
}

type FxImage = Omit<RgbaImage,"data"|"data16"> & Partial<Pick<RgbaImage,"data"|"data16">>;
interface FxStack { readonly length: number; get(index: number): FxImage | undefined; indexOf(image: FxImage): number; reset?(): void }
class FxFrameDemand {}
interface FxEvalContext {
  readonly statistics?: Readonly<Record<string, number>> | undefined;
  readonly stack: FxStack | readonly FxImage[];
  readonly sample?: typeof sampleFxImage;
  readonly interpolation?: LookupInterpolation | undefined;
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
  // ImageMagick samples red for alpha qualifiers when no alpha channel exists.
  if (ch === 3 && !img.hasAlpha) ch = 0;
  const cx = Math.max(0, Math.min(img.width - 1, Math.round(px)));
  const cy = Math.max(0, Math.min(img.height - 1, Math.round(py)));
  const idx = (cy * img.width + cx) * 4;
  if (img.space === "cmyk" && (ch < 3 || ch === 8)) {
    const channel = ch === 8 ? 3 : ch;
    if (img.hueSamples) return img.hueSamples[idx + channel]!;
    const input = img.data16 ?? img.data!, range = img.data16 ? 65535 : 255;
    return rgbToCmyk(input[idx]! / range, input[idx + 1]! / range, input[idx + 2]! / range)[channel]!;
  }
  if ((img.magickColorspace === "HSL" || img.magickColorspace === "HSB" || img.magickColorspace === "HWB" || img.magickColorspace === "XYZ" || img.magickColorspace === "YCbCr" || img.magickColorspace === "YUV" || img.magickColorspace === "CIELab") && img.hueSamples && ch < 4) return img.hueSamples[idx + ch]!;
  if ((img.magickColorspace === "HSL" || img.magickColorspace === "HSB" || img.magickColorspace === "HWB" || img.magickColorspace === "XYZ" || img.magickColorspace === "YCbCr" || img.magickColorspace === "YUV" || img.magickColorspace === "CIELab") && img.data16 && ch < 4) return img.data16[idx + ch]! / 65535;
  return sampleFxPixel(img.data16 ?? img.data!, idx, ch, img.data16 ? 65535 : 255);
}
function interpolateFxImage(sample: typeof sampleFxImage, img: FxImage | undefined, x: number, y: number, ch: number, interpolation?: LookupInterpolation): number {
  if (interpolation === "mesh") throw new Error("Unsupported FX interpolation: mesh");
  if (!img) return 0;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return NaN;
  const left = Math.floor(x), top = Math.floor(y), dx = x - left, dy = y - top;
  if (interpolation === "integer") return sample(img, left, top, ch);
  if (interpolation === "nearest") return sample(img, Math.floor(x + 0.5), Math.floor(y + 0.5), ch);
  if (interpolation !== "average" && dx === 0 && dy === 0) return sample(img, x, y, ch);
  if (ch >= 4 && ch <= 7) {
    return sampleFxPixel([0, 1, 2].map(channel => interpolateFxImage(sample, img, x, y, channel, interpolation)), 0, ch, 1);
  }
  let value = 0, alpha = 0;
  for (let row = 0; row < 2; row++) {
    for (let column = 0; column < 2; column++) {
      const weight = interpolation === "average" ? 0.25 : (column ? dx : 1 - dx) * (row ? dy : 1 - dy);
      if (weight === 0) continue;
      const opacity = img.hasAlpha && ch !== 3 ? sample(img, left + column, top + row, 3) : 1;
      value += weight * opacity * sample(img, left + column, top + row, ch);
      alpha += weight * opacity;
    }
  }
  return alpha === 0 ? 0 : value / alpha;
}

function sampleFxPixel(data: ArrayLike<number>, offset: number, ch: number, maximum = 255): number {
  const r = data[offset]! / maximum;
  const g = data[offset + 1]! / maximum;
  const b = data[offset + 2]! / maximum;
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
      // Form the ratio before normalization to preserve exact rounding boundaries.
      const high = Math.max(data[offset]!, data[offset + 1]!, data[offset + 2]!);
      const low = Math.min(data[offset]!, data[offset + 1]!, data[offset + 2]!);
      return (high - low) / Math.max(1e-7 * maximum, l > 0.5 ? 2 * maximum - high - low : high + low);
    }
    let h = 0;
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return h / 6;
  }
  return data[offset + (ch & 3)]! / maximum;
}

function propToChannel(prop: string): number {
  const p = prop.toLowerCase();
  if (p === "r") return 0;
  if (p === "g") return 1;
  if (p === "b") return 2;
  if (p === "a" || p === "o") return 3;
  if (p === "intensity") return 4;
  if (p === "hue") return 5;
  if (p === "saturation") return 6;
  if (p === "lightness") return 7;
  if (p === "k") return 8;
  throw new Error(`Bad channel qualifier: ${prop}`);
}

function compileFxExpression(exprStr: string) {
  let needsStatistics = false;
  const requireStatistics = () => { needsStatistics = true; };
  const statements = exprStr
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const compiledStmts = statements.map((stmt) => {
    const assignMatch = /^([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*([^=].*)$/.exec(stmt);
    if (assignMatch) {
      const varName = assignMatch[1]!.toLowerCase();
      const rhsFn = compileSingleFxExpr(assignMatch[2]!, requireStatistics);
      return (ctx: FxEvalContext) => {
        const val = rhsFn(ctx);
        ctx.vars.set(varName, val);
        return val;
      };
    }
    return compileSingleFxExpr(stmt, requireStatistics);
  });

  return Object.assign((ctx: FxEvalContext) => {
    let last = 0;
    for (const fn of compiledStmts) {
      last = fn(ctx);
    }
    return last;
  }, { needsStatistics });
}

function compileSingleFxExpr(src: string, requireStatistics: () => void): (ctx: FxEvalContext) => number {
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
    if (two === "==" || two === "!=" || two === "<=" || two === ">=" || two === "&&" || two === "||" || two === "**" || two === "<<" || two === ">>") {
      tokens.push({ type: "op", val: two });
      k += 2;
      continue;
    }
    if ("+-*/%^<>!?&|".includes(ch)) {
      tokens.push({ type: "op", val: ch });
      k++;
      continue;
    }
    if ("(),.{}:[]".includes(ch)) {
      tokens.push({ type: "punc", val: ch });
      k++;
      continue;
    }
    throw new Error(`Invalid FX character: ${ch}`);
  }

  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  function expectToken(value: string): void {
    if (next()?.val !== value) throw new Error(`Expected '${value}' in FX expression`);
  }

  function parseTernary(): (ctx: FxEvalContext) => number {
    const cond = parseOr();
    if (peek()?.val === "?") {
      next();
      const tBranch = parseTernary();
      expectToken(":");
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
    let left = parseBitwiseOr();
    while (peek()?.val === "&&") {
      next();
      const right = parseBitwiseOr();
      const prev = left;
      left = (ctx) => (prev(ctx) !== 0 && right(ctx) !== 0 ? 1 : 0);
    }
    return left;
  }

  function bitwiseInteger(value: number): bigint {
    // ImageMagick rounds to the nearest unsigned 64-bit integer, saturating at its limits.
    if (!(value > 0)) return 0n;
    if (value >= 2 ** 64) return (1n << 64n) - 1n;
    return BigInt(Math.floor(value + 0.5));
  }

  function parseBitwiseOr(): (ctx: FxEvalContext) => number {
    let left = parseBitwiseAnd();
    while (peek()?.val === "|") {
      next();
      const right = parseBitwiseAnd();
      const prev = left;
      left = (ctx) => Number(bitwiseInteger(prev(ctx)) | bitwiseInteger(right(ctx)));
    }
    return left;
  }

  function parseBitwiseAnd(): (ctx: FxEvalContext) => number {
    let left = parseEquality();
    while (peek()?.val === "&") {
      next();
      const right = parseEquality();
      const prev = left;
      left = (ctx) => Number(bitwiseInteger(prev(ctx)) & bitwiseInteger(right(ctx)));
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
    let left = parseShift();
    while (
      peek()?.val === "<" ||
      peek()?.val === "<=" ||
      peek()?.val === ">" ||
      peek()?.val === ">="
    ) {
      const op = next()!.val;
      const right = parseShift();
      const prev = left;
      if (op === "<") left = (ctx) => (prev(ctx) < right(ctx) ? 1 : 0);
      else if (op === "<=") left = (ctx) => (prev(ctx) <= right(ctx) ? 1 : 0);
      else if (op === ">") left = (ctx) => (prev(ctx) > right(ctx) ? 1 : 0);
      else left = (ctx) => (prev(ctx) >= right(ctx) ? 1 : 0);
    }
    return left;
  }

  function parseShift(): (ctx: FxEvalContext) => number {
    let left = parseAdditive();
    while (peek()?.val === "<<" || peek()?.val === ">>") {
      const op = next()!.val;
      const right = parseAdditive();
      const prev = left;
      left = (ctx) => {
        const value = bitwiseInteger(prev(ctx)), shift = bitwiseInteger(right(ctx));
        if (shift >= 64n) throw new Error(`Undefined FX shift: ${shift}`);
        return Number(op === "<<" ? BigInt.asUintN(64, value << shift) : value >> shift);
      };
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
      else if (op === "/") left = (ctx) => prev(ctx) / right(ctx);
      else left = (ctx) => {
        const d = right(ctx);
        return d === 0 ? 0 : prev(ctx) % d;
      };
    }
    return left;
  }

  function parsePower(): (ctx: FxEvalContext) => number {
    let left = parseUnary();
    while (peek()?.val === "^" || peek()?.val === "**") {
      next();
      const exp = parseUnary();
      const base = left;
      left = (ctx) => Math.pow(base(ctx), exp(ctx));
    }
    return left;
  }

  function parseUnary(): (ctx: FxEvalContext) => number {
    if (peek()?.val === "-") {
      next();
      const u = parsePower();
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
    if (!tok) throw new Error("Expected operand in FX expression");
    if (tok.type === "num") {
      next();
      const val = Number(tok.val);
      if (!Number.isFinite(val)) throw new Error(`Invalid FX number: ${tok.val}`);
      return () => val;
    }
    if (tok.val === "(") {
      next();
      const inner = parseTernary();
      expectToken(")");
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
        expectToken(")");
        if (name === "channel") {
          if (args.length < 1 || args.length > 5) {
            throw new Error(`FX function 'channel' expects 1 to 5 arguments, got ${args.length}`);
          }
          // The fourth argument is CMYK black; alpha is the fifth.
          return ctx => args[ctx.ch === 3 ? 4 : ctx.ch]?.(ctx) ?? 0;
        }
        if (!["sin", "sinc", "gauss", "cos", "tan", "asin", "acos", "atan", "atan2", "sinh", "cosh", "tanh", "squish", "j0", "j1",
          "sqrt", "pow", "exp", "log", "log10", "ln", "abs", "min", "max", "floor", "ceil",
          "round", "int", "trunc", "sign", "isnan", "not", "hypot", "mod", "gcd", "clamp", "if", "rand"].includes(name)) {
          throw new Error(`Unknown FX function: ${name}`);
        }
        const arity = name === "rand" ? 0 : name === "if" ? 3
          : ["atan2", "pow", "min", "max", "hypot", "mod", "gcd"].includes(name) ? 2 : 1;
        if (args.length !== arity) {
          throw new Error(`FX function '${name}' expects ${arity} arguments, got ${args.length}`);
        }
        return (ctx) => {
          const vals = args.map((a) => a(ctx));
          const a0 = vals[0] ?? 0;
          const a1 = vals[1] ?? 0;
          const a2 = vals[2] ?? 1;
          switch (name) {
            case "sin":
              return Math.sin(a0);
            case "sinc":
              return a0 === 0 ? 0 : Math.sin(Math.PI * a0) / (Math.PI * a0);
            case "gauss":
              return Math.exp(-a0 * a0 / 2) / Math.sqrt(2 * Math.PI);
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
            case "j0":
              return besselJ(0, a0);
            case "j1":
              return besselJ(1, a0);
            case "squish":
              return 1 / (1 + Math.exp(-a0));
            case "sqrt":
              return Math.sqrt(a0);
            case "not":
              return a0 < 1e-12 ? 1 : 0;
            case "isnan":
              return Number.isNaN(a0) ? 1 : 0;
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
            case "int":
              return Math.floor(a0);
            case "ceil":
              return Math.ceil(a0);
            case "round":
              return Math.round(a0);
            case "trunc":
              return Math.trunc(a0);
            case "sign":
              return a0 < 0 ? -1 : 1;
            case "hypot":
              return Math.hypot(a0, a1);
            case "gcd": {
              let x = a0;
              let y = a1;
              // Match ImageMagick's tolerance and recursion limit without recursion.
              for (let depth = 0; ; depth++) {
                if (x < y) {
                  [x, y] = [y, x];
                  continue;
                }
                if (Math.abs(y) < 0.001 || depth >= 200) return x;
                [x, y] = [y, x - y * Math.floor(x / y)];
              }
            }
            case "mod":
              return a1 === 0 ? 0 : a0 - Math.floor(a0 / a1) * a1;
            case "clamp":
              return Math.max(0, Math.min(1, a0));
            case "if":
              return a0 !== 0 ? a1 : a2;
            case "rand":
              return 0.5;
            default:
              throw new Error(`Unknown FX function: ${name}`);
          }
        };
      }

      const color = X11_NAMED_COLORS[name];
      if (color && peek()?.val === ".") {
        throw new Error(`Expected operator at '.${tokens[pos + 1]?.val ?? ""}'`);
      }

      // Check for array index e.g. u[1]
      let imgIndex: ((ctx: FxEvalContext) => number) | undefined;
      if (name === "u" && peek()?.val === "[") {
        next();
        imgIndex = parseTernary();
        expectToken("]");
      }

      // Pixel coordinates are absolute in braces and relative in brackets.
      let coordX: ((ctx: FxEvalContext) => number) | undefined;
      let coordY: ((ctx: FxEvalContext) => number) | undefined;
      let propName: string | undefined;
      let relative = false;

      if (name === "p" && (peek()?.val === "{" || peek()?.val === "[")) {
        relative = next()!.val === "[";
        coordX = parseTernary();
        expectToken(",");
        coordY = parseTernary();
        expectToken(relative ? "]" : "}");
      }
      while (peek()?.val === ".") {
        if (["entropy", "skewness", "kurtosis"].includes(name)) {
          throw new Error(`Expected operator at '.${tokens[pos + 1]?.val ?? ""}'`);
        }
        next();
        const property = next();
        if (property?.type !== "id") throw new Error("Expected property in FX expression");
        const sub = property.val.toLowerCase();
        if (sub === "p" && (peek()?.val === "{" || peek()?.val === "[")) {
          relative = next()!.val === "[";
          coordX = parseTernary();
          expectToken(",");
          coordY = parseTernary();
          expectToken(relative ? "]" : "}");
        } else {
          propName = sub;
        }
      }

      const isStatistic = ["mean", "standard_deviation", "minima", "maxima", "median"].includes(name);
      if (isStatistic) requireStatistics();
      return (ctx) => {
        if (ctx.vars.has(name) && !propName && !coordX) {
          return ctx.vars.get(name)!;
        }
        if (color) return color[ctx.ch]! / 255;
        if (isStatistic && ctx.statistics) {
          return ctx.statistics[propName ? `${name}.${propToChannel(propName)}` : name] ?? 0;
        }
        if (name === "i") return ctx.x;
        if (name === "j") return ctx.y;
        if (name === "w") return ctx.w;
        if (name === "h") return ctx.h;
        if (name === "n") return ctx.stack.length;
        if (name === "quantumrange" || name === "maxrgb") return 65535;
        if (name === "quantumscale") return 1 / 65535;
        if (name === "epsilon") return 1e-12;
        if (name === "phi") return (1 + Math.sqrt(5)) / 2;
        if (name === "pi") return Math.PI;
        if (name === "e") return Math.E;

        const rawIdx = imgIndex ? Math.round(imgIndex(ctx)) : name === "v" ? 1 : 0;
        const len = Math.max(1, ctx.stack.length);
        const targetIdx = rawIdx < 0 ? ((rawIdx % len) + len) % len : rawIdx;
        if (imgIndex && (!Number.isFinite(targetIdx) || targetIdx >= ctx.stack.length)) {
          throw new Error(`ImgNum ${rawIdx} bad for ImgListLen ${ctx.stack.length}`);
        }
        if (name === "t" || propName === "t") return targetIdx;
        const targetImg = "get" in ctx.stack ? ctx.stack.get(targetIdx) ?? ctx.stack.get(0) : ctx.stack[targetIdx] ?? ctx.stack[0];
        if (name === "depth") return targetImg?.bitsPerSample ?? (targetImg?.depth === "ushort" ? 16 : targetImg?.depth === "bit" ? 1 : 8);
        if (propName === "w") return targetImg?.width ?? ctx.w;
        if (propName === "h") return targetImg?.height ?? ctx.h;

        const px = coordX ? coordX(ctx) + (relative ? ctx.x : 0) : ctx.x;
        const py = coordY ? coordY(ctx) + (relative ? ctx.y : 0) : ctx.y;

        // RGB rasters have no separate black channel.
        if (name === "k") return targetImg?.space === "cmyk" ? (ctx.sample ?? sampleFxImage)(targetImg, px, py, 8) : 0;
        if (name === "r") return (ctx.sample ?? sampleFxImage)(targetImg, px, py, 0);
        if (name === "g") return (ctx.sample ?? sampleFxImage)(targetImg, px, py, 1);
        if (name === "b") return (ctx.sample ?? sampleFxImage)(targetImg, px, py, 2);
        if (name === "a" || name === "alpha" || name === "opacity") return (ctx.sample ?? sampleFxImage)(targetImg, px, py, 3);
        if (name === "intensity" || name === "luma" || name === "luminance") {
          return (ctx.sample ?? sampleFxImage)(targetImg, px, py, 4);
        }
        if (name === "hue") return (ctx.sample ?? sampleFxImage)(targetImg, px, py, 5);
        if (name === "saturation") return (ctx.sample ?? sampleFxImage)(targetImg, px, py, 6);
        if (name === "lightness") return (ctx.sample ?? sampleFxImage)(targetImg, px, py, 7);

        const ch = propName ? propToChannel(propName) : ctx.ch;
        return interpolateFxImage(ctx.sample ?? sampleFxImage, targetImg, px, py, ch, ctx.interpolation);
      };
    }
    throw new Error(`Expected operand in FX expression, got: ${tok.val}`);
  }

  const expression = parseTernary();
  if (peek()) throw new Error(`Unexpected token in FX expression: ${peek()!.val}`);
  return expression;
}

function* magickFxPixelSteps(input: readonly FxImage[] | FxStack, expression: string, channels: MagickState["channels"], method: VirtualPixelMethod | undefined, background: RgbaColor, interpolation: LookupInterpolation | undefined): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const stack: FxStack = "get" in input ? input : { length: input.length, get: index => input[index], indexOf: image => input.indexOf(image) };
    const base = stack.get(0)!, evaluate = compileFxExpression(expression), mask = [channels.r, channels.g, channels.b, channels.a && base.hasAlpha];
    const highDepth = !!(base.data16 || ("storedData16" in base && base.storedData16)), maximum = highDepth ? 65535 : 255;
    const statistics: Record<string, number> | undefined = evaluate.needsStatistics ? {} : undefined;
    if (statistics) {
        yield* magickPixelPropertiesSteps<ConvolveRequest, Uint8Array | undefined>(base, function*(position, length) {
            const data = yield { kind: "read", highDepth, position, length };
            if (!data || data.length !== length * (highDepth ? 2 : 1)) throw new Error("Truncated expression statistics");
            const data16 = highDepth ? new Uint16Array(data.slice().buffer) : undefined;
            return data16 ? { data: Uint8Array.from(data16, value => Math.round(value / 257)), data16 } : { data };
        }, statistics, false, function*(position, length) {
            return (yield { kind: "read", image: stack.length, position, length })!;
        });
        const selected = mask.filter((enabled, channel) => enabled && (channel !== 3 || base.hasAlpha)).length;
        for (const name of ["mean", "standard_deviation", "minima", "maxima", "median"]) {
            statistics[name] = name === "minima" && selected > 0 ? 1 : 0;
            for (let channel = 0; channel < 4; channel++) {
                if (!mask[channel]) {
                    statistics[`${name}.${channel}`] = 0;
                    continue;
                }
                const value = statistics[`${name}.${channel}`]!;
                if (name === "minima") statistics[name] = Math.min(statistics[name]!, value);
                else if (name === "maxima") statistics[name] = Math.max(statistics[name]!, value);
                else statistics[name]! += value / selected;
            }
        }
    }
    const samples = new Map<string, Uint8Array | Uint16Array>(), vars = new Map<string, number>();
    const samplePixel: typeof sampleFxImage = (target, x, y, channel) => {
        if (!target) return 0;
        let px = Math.round(x), py = Math.round(y);
        if (!Number.isFinite(px) || !Number.isFinite(py)) return NaN;
        if (px < 0 || py < 0 || px >= target.width || py >= target.height) {
            const index = virtualPixelIndex(px, py, target.width, target.height, method ?? "edge");
            if (index >= 0) {
                px = index % target.width; py = Math.floor(index / target.width);
            } else {
                const gray = method === "white" ? 255 : method === "gray" ? 128 : 0;
                return sampleFxPixel(method === "background" || method?.endsWith("-tile") === true ? [background.r, background.g, background.b, background.a] : [gray, gray, gray, method === "transparent" ? 0 : 255], 0, channel);
            }
        }
        const position = (py * target.width + px) * 4;
        if (!Number.isFinite(position)) return NaN;
        const image = stack.indexOf(target), pixel = samples.get(image + ":" + position);
        if (pixel === undefined) throw new FxPixelDemand(position, image);
        return sampleFxPixel(pixel, 0, channel, maximum);
    };
    for (let start = 0; start < base.width * base.height; start += 1024) {
        yield;
        const count = Math.min(1024, base.width * base.height - start), bytes = yield { kind: "read", highDepth, position: start * 4, length: count * 4 };
        if (!bytes || bytes.length !== count * 4 * (highDepth ? 2 : 1)) throw new Error("Truncated expression pixels");
        const data = highDepth ? new Uint16Array(bytes.slice().buffer) : new Uint8Array(bytes);
        for (let i = 0; i < count; i++) {
            const position = (start + i) * 4, offset = i * 4;
            stack.reset?.();
            samples.clear();
            samples.set("0:" + position, data.slice(offset, offset + 4));
            for (let ch = 0; ch < 4; ch++) {
                if (!mask[ch]) continue;
                // ImageMagick convert evaluates statistics as zero in the red output channel.
                const context: FxEvalContext = { statistics: statistics && ch === 0 ? {} : statistics, stack, x: (start + i) % base.width, y: Math.floor((start + i) / base.width), w: base.width, h: base.height, ch, vars, sample: samplePixel, interpolation };
                // Replaying local assignments is deterministic; retain only this pixel's demanded samples.
                while (true) {
                    vars.clear();
                    try { data[offset + ch] = Math.round(Math.max(0, Math.min(1, evaluate(context))) * maximum); break; }
                    catch (error) {
                        if (error instanceof FxFrameDemand) { yield; continue; }
                        if (!(error instanceof FxPixelDemand)) throw error;
                        const value = yield { kind: "read", highDepth, image: error.image, position: error.position, length: 4 };
                        if (!value || value.length !== 4 * (highDepth ? 2 : 1)) throw new Error("Truncated expression pixels");
                        samples.set(error.image + ":" + error.position, highDepth ? new Uint16Array(value.slice().buffer) : new Uint8Array(value));
                    }
                }
            }
        }
        yield { kind: "write", highDepth, position: start * 4, data: new Uint8Array(data.buffer) };
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
    if (Math.abs(pivot) < 1e-12) throw new Error("Unsolvable Matrix");
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
    const bestFit = (plan: WarpPlan, forward: WarpPlan["map"]): WarpPlan => {
        if (token !== "+distort") return plan;
        // Transform pixel edges, then round outwards to include the best-fit border.
        const corners = [-0.5, w - 0.5].flatMap(x => [-0.5, h - 0.5].map(y => forward(x, y)));
        const x = Math.floor(Math.min(...corners.map(point => point[0]!))), y = Math.floor(Math.min(...corners.map(point => point[1]!)));
        const width = Math.ceil(Math.max(...corners.map(point => point[0]!))) - x + 1, height = Math.ceil(Math.max(...corners.map(point => point[1]!))) - y + 1;
        return { ...plan, width, height, map: (px, py) => plan.map(px + x, py + y), virtualCanvas: { width, height, x, y } };
    };
    if (token === "-swirl") {
        const centerX = w / 2, centerY = h / 2, radius = Math.max(w, h) / 2, radians = (Number.parseFloat(spec) * Math.PI) / 180;
        const scaleX = radius / centerX, scaleY = radius / centerY;
        return result((x, y) => {
            const dx = (x - centerX) * scaleX, dy = (y - centerY) * scaleY, r = Math.hypot(dx, dy);
            if (r >= radius) return [x, y, true];
            if (radians === 0) return [x, y];
            const factor = 1 - r / radius, angle = factor * factor * radians, cos = Math.cos(angle), sin = Math.sin(angle);
            return [centerX + (dx * cos - dy * sin) / scaleX, centerY + (dx * sin + dy * cos) / scaleY];
        }, w, h, img.hasAlpha);
    }
    if (token === "-implode") {
        const centerX = w / 2, centerY = h / 2, radius = Math.max(w, h) / 2, amount = Number.parseFloat(spec);
        const scaleX = radius / centerX, scaleY = radius / centerY;
        return result((x, y) => {
            const dx = x - centerX, dy = y - centerY, r = Math.hypot(dx * scaleX, dy * scaleY);
            if (r >= radius) return [x, y, true];
            if (r === 0) return [x, y];
            const scale = Math.pow(Math.sin(Math.PI * r / radius / 2), -amount);
            return [centerX + dx * scale, centerY + dy * scale];
        }, w, h, img.hasAlpha);
    }
    if (token === "-wave") {
        const g = parseMagickGeometry(spec), amplitude = g.width ?? 0, padding = Math.abs(amplitude);
        const wavelength = Number.parseFloat(spec.toLowerCase().split("x")[1] ?? "");
        const length = Number.isNaN(wavelength) ? 1 : wavelength;
        // Native uses a safe reciprocal and stores the sine displacement as a float.
        const reciprocal = Math.abs(length) >= 1e-12 ? 1 / length : (length < 0 ? -1 : 1) / 1e-12;
        return result((x, y) => [x, y - Math.fround(padding + amplitude * Math.sin(2 * Math.PI * x * reciprocal))], w, h + Math.trunc(padding * 2));
    }
    const method = spec.toLowerCase().replace(/[-_]/g, ""), nums = args.trim().split(/[\s,]+/).filter(s => s.length > 0).map(Number);
    if (nums.some(value => !Number.isFinite(value))) throw new Error("invalid list of numbers");
    if (method === "arc") throw new Error("Unsupported distortion method: Arc");
    if (method === "srt" || method === "scalerotatetranslate") {
        let ox = cx, oy = cy, scaleX = 1, scaleY = 1, angle = 0, nx = cx, ny = cy;
        if (nums.length === 1) angle = nums[0]!;
        else if (nums.length === 2) { scaleX = scaleY = nums[0] || 1; angle = nums[1]!; }
        else if (nums.length >= 3) {
            ox = nx = nums[0]! - 0.5; oy = ny = nums[1]! - 0.5;
            if (nums.length === 3) angle = nums[2]!;
            else if (nums.length === 4 || nums.length === 6) { scaleX = scaleY = nums[2] || 1; angle = nums[3]!; }
            else { scaleX = nums[2] || 1; scaleY = nums[3] || 1; angle = nums[4]!; }
            if (nums.length === 6) { nx = nums[4]! - 0.5; ny = nums[5]! - 0.5; }
            else if (nums.length >= 7) { nx = nums[5]! - 0.5; ny = nums[6]! - 0.5; }
        }
        const radians = (angle * Math.PI) / 180, cos = Math.cos(radians), sin = Math.sin(radians);
        const map: WarpPlan["map"] = (x, y) => { const dx = x - nx, dy = y - ny; return [ox + (dx * cos + dy * sin) / scaleX, oy + (-dx * sin + dy * cos) / scaleY]; };
        const derivatives = () => [cos / scaleX, sin / scaleX, -sin / scaleY, cos / scaleY] as const;
        return bestFit({ ...result(map), derivatives }, (x, y) => {
            const dx = (x - ox) * scaleX, dy = (y - oy) * scaleY;
            return [nx + dx * cos - dy * sin, ny + dx * sin + dy * cos];
        });
    }
    if (method === "affine" && (nums.length === 0 || nums.length % 4 !== 0)) throw new Error("Affine requires complete source/destination point pairs");
    if (method === "affineprojection") {
        if (nums.length !== 6) throw new Error("AffineProjection needs 6 coefficient values");
        const [sx, ry, rx, sy, tx, ty] = nums as [number, number, number, number, number, number];
        const determinant = sx * sy - rx * ry;
        const reciprocal = 1 / (Math.abs(determinant) >= 1e-12 ? determinant : determinant < 0 ? -1e-12 : 1e-12);
        const a = sy * reciprocal, b = -rx * reciprocal, c = -ry * reciprocal, d = sx * reciprocal;
        const e = -(a * tx + b * ty), f = -(c * tx + d * ty);
        // Coefficients map source edges to destination edges; invert for pixel-center sampling.
        const plan = result((x, y) => [a * (x + 0.5) + b * (y + 0.5) + e - 0.5, c * (x + 0.5) + d * (y + 0.5) + f - 0.5]);
        return bestFit({ ...plan, derivatives: () => [a, b, c, d] }, (x, y) =>
            [sx * (x + 0.5) + rx * (y + 0.5) + tx - 0.5, ry * (x + 0.5) + sy * (y + 0.5) + ty - 0.5]);
    }
    if (method === "perspective" && (nums.length === 0 || nums.length % 4 !== 0)) throw new Error("Perspective requires complete source/destination point pairs");
    if (method === "perspectiveprojection" && nums.length !== 8) throw new Error("PerspectiveProjection needs 8 coefficient values");
    if ((method === "perspective" && nums.length >= 16) || method === "perspectiveprojection") {
        let coefficients: number[];
        if (method === "perspectiveprojection") {
            const [a, b, c, d, e, f, g, i] = nums as [number, number, number, number, number, number, number, number];
            // The supplied projection maps source to destination. Its adjugate
            // maps back for sampling; the common determinant cancels on division.
            coefficients = [e - f * i, c * i - b, b * f - c * e, f * g - d, a - c * g, c * d - a * f, d * i - e * g, b * g - a * i, a * e - b * d];
        }
        else {
            // Accumulate the normal equations for the destination-to-source fit.
            // All control pairs contribute, with fixed storage for eight coefficients.
            const matrix = Array.from({ length: 8 }, () => Array<number>(8).fill(0)), values = Array<number>(8).fill(0);
            for (let p = 0; p + 3 < nums.length; p += 4) {
                const sx = nums[p]!, sy = nums[p + 1]!, dx = nums[p + 2]!, dy = nums[p + 3]!;
                const rows = [[dx, dy, 1, 0, 0, 0, -dx * sx, -dy * sx], [0, 0, 0, dx, dy, 1, -dx * sy, -dy * sy]];
                for (let axis = 0; axis < 2; axis++) {
                    const row = rows[axis]!, value = axis === 0 ? sx : sy;
                    for (let i = 0; i < 8; i++) {
                        values[i]! += row[i]! * value;
                        for (let j = 0; j < 8; j++) matrix[i]![j]! += row[i]! * row[j]!;
                    }
                }
            }
            coefficients = solveLinearSystem(matrix, values);
        }
        if (coefficients.every(c => Math.abs(c) < 1e-12)) return result(() => [0, 0]);
        const [a, b, c, d, e, f, g, i, j = 1] = coefficients as [number, number, number, number, number, number, number, number, number?];
        const plan = result((x, y) => {
            // Fit coordinates use pixel edges; the sampler uses pixel centers.
            const px = x + 0.5, py = y + 0.5, denominator = g * px + i * py + j || 1e-9;
            return [(a * px + b * py + c) / denominator - 0.5, (d * px + e * py + f) / denominator - 0.5];
        });
        return bestFit(plan, (x, y) => {
            // Invert the sampling homography and transform physical pixel edges.
            const px = x + 0.5, py = y + 0.5;
            const denominator = (d * i - e * g) * px + (b * g - a * i) * py + a * e - b * d;
            return [((e * j - f * i) * px + (c * i - b * j) * py + b * f - c * e) / denominator - 0.5,
                ((f * g - d * j) * px + (a * j - c * g) * py + c * d - a * f) / denominator - 0.5];
        });
    }
    if ((method === "affine" && (nums.length === 4 || nums.length === 8 || nums.length >= 12)) || (method === "perspective" && [4, 8, 12].includes(nums.length))) {
        // Perspective falls back to affine mapping with fewer than four pairs.
        // One pair translates; two pairs fix rotation and uniform scale.
        if (nums.length === 4) nums.push(nums[0]! + 1, nums[1]!, nums[2]! + 1, nums[3]!);
        if (nums.length === 8) nums.push(
            nums[0]! - (nums[5]! - nums[1]!), nums[1]! + (nums[4]! - nums[0]!),
            nums[2]! - (nums[7]! - nums[3]!), nums[3]! + (nums[6]! - nums[2]!)
        );
        // Fit destination to source using every pair, with fixed-size normal equations.
        const matrix = Array.from({ length: 3 }, () => Array<number>(3).fill(0)), xs = Array<number>(3).fill(0), ys = Array<number>(3).fill(0);
        for (let p = 0; p + 3 < nums.length; p += 4) {
            const row = [nums[p + 2]!, nums[p + 3]!, 1];
            for (let i = 0; i < 3; i++) {
                xs[i]! += row[i]! * nums[p]!;
                ys[i]! += row[i]! * nums[p + 1]!;
                for (let j = 0; j < 3; j++) matrix[i]![j]! += row[i]! * row[j]!;
            }
        }
        const rx = solveLinearSystem(matrix, xs), ry = solveLinearSystem(matrix, ys);
        // Control points use pixel edges; sampling uses pixel centers.
        const plan = { ...result((x, y) => [rx[0]! * (x + 0.5) + rx[1]! * (y + 0.5) + rx[2]! - 0.5, ry[0]! * (x + 0.5) + ry[1]! * (y + 0.5) + ry[2]! - 0.5]),
            derivatives: () => [rx[0]!, rx[1]!, ry[0]!, ry[1]!] as const };
        return bestFit(plan, (x, y) => {
            const px = x + 0.5 - rx[2]!, py = y + 0.5 - ry[2]!;
            const determinant = rx[0]! * ry[1]! - rx[1]! * ry[0]!;
            return [(ry[1]! * px - rx[1]! * py) / determinant - 0.5, (rx[0]! * py - ry[0]! * px) / determinant - 0.5];
        });
    }
    if (method === "barrelinverse") {
        if (![3, 4, 5, 6, 8, 10].includes(nums.length) || !nums.every(Number.isFinite)) throw new Error("Invalid BarrelInverse arguments");
        const a = nums[0]!, b = nums[1]!, c = nums[2]!, d = nums.length === 3 || nums.length === 5 ? 1 - a - b - c : nums[3]!;
        const ay = nums.length >= 8 ? nums[4]! : a, by = nums.length >= 8 ? nums[5]! : b, cyCoefficient = nums.length >= 8 ? nums[6]! : c, dyCoefficient = nums.length >= 8 ? nums[7]! : d;
        const center = nums.length === 5 ? 3 : nums.length === 6 ? 4 : nums.length === 10 ? 8 : undefined;
        // ImageMagick centers use pixel edges; the sampler uses pixel centers.
        const ox = center === undefined ? cx : nums[center]! - 0.5, oy = center === undefined ? cy : nums[center + 1]! - 0.5, radius = Math.min(w, h) / 2;
        return {
            ...result((x, y) => {
                const dx = (x - ox) / radius, dy = (y - oy) / radius, r = Math.hypot(dx, dy);
                if (r === 0) return [x, y];
                return [ox + dx * radius / (((a * r + b) * r + c) * r + d), oy + dy * radius / (((ay * r + by) * r + cyCoefficient) * r + dyCoefficient)];
            }),
            derivatives(x, y) {
                const dx = (x - ox) / radius, dy = (y - oy) / radius, r = Math.hypot(dx, dy);
                const fx = 1 / (((a * r + b) * r + c) * r + d), fy = 1 / (((ay * r + by) * r + cyCoefficient) * r + dyCoefficient);
                const gx = r > 0 ? -(3 * a * r * r + 2 * b * r + c) / r * fx * fx : 0;
                const gy = r > 0 ? -(3 * ay * r * r + 2 * by * r + cyCoefficient) / r * fy * fy : 0;
                return [fx + dx * dx * gx, dx * dy * gx, dx * dy * gy, fy + dy * dy * gy];
            }
        };
    }
    if (method === "barrel") {
        if (![3, 4, 5, 6, 8, 10].includes(nums.length) || !nums.every(Number.isFinite)) throw new Error("Invalid Barrel arguments");
        const a = nums[0]!, b = nums[1]!, c = nums[2]!, d = nums.length === 3 || nums.length === 5 ? 1 - a - b - c : nums[3]!;
        const ay = nums.length >= 8 ? nums[4]! : a, by = nums.length >= 8 ? nums[5]! : b, cyCoefficient = nums.length >= 8 ? nums[6]! : c, dyCoefficient = nums.length >= 8 ? nums[7]! : d;
        const center = nums.length === 5 ? 3 : nums.length === 6 ? 4 : nums.length === 10 ? 8 : undefined;
        // ImageMagick centers use pixel edges; the sampler uses pixel centers.
        const ox = center === undefined ? cx : nums[center]! - 0.5, oy = center === undefined ? cy : nums[center + 1]! - 0.5, radius = Math.min(w, h) / 2;
        return {
            ...result((x, y) => {
                const dx = (x - ox) / radius, dy = (y - oy) / radius, r = Math.hypot(dx, dy);
                return [ox + dx * radius * (((a * r + b) * r + c) * r + d), oy + dy * radius * (((ay * r + by) * r + cyCoefficient) * r + dyCoefficient)];
            }),
            derivatives(x, y) {
                const dx = (x - ox) / radius, dy = (y - oy) / radius, r = Math.hypot(dx, dy);
                const fx = ((a * r + b) * r + c) * r + d, fy = ((ay * r + by) * r + cyCoefficient) * r + dyCoefficient;
                const gx = r > 0 ? (3 * a * r * r + 2 * b * r + c) / r : 0;
                const gy = r > 0 ? (3 * ay * r * r + 2 * by * r + cyCoefficient) / r : 0;
                return [fx + dx * dx * gx, dx * dy * gx, dx * dy * gy, fy + dy * dy * gy];
            }
        };
    }
    return;
}
function parseMagickRotation(spec: string) {
    // Rotation reads the leading angle; geometry dimensions and ratios do not change it.
    const angle = Number.parseFloat(spec);
    if (!Number.isFinite(angle) || [...spec].some(c => c.trim() !== "" && !"0123456789eExX!#%()+,-./:<>@\\^".includes(c))) {
        throw new Error(`invalid rotation angle: ${spec}`);
    }
    const condition = spec.endsWith(">") ? ">" : spec.endsWith("<") ? "<" : undefined;
    return {
        angle,
        applies: (image: Pick<RgbaImage, "width" | "height">) => condition === ">" ? image.width > image.height : condition === "<" ? image.width < image.height : true
    };
}
function parseMagickWarpOperation(tokens: readonly string[], state: MagickState, start: number, analysis: { warnings: string }) {
    const token = tokens[start]!;
    // Right angles retain the lossless pixel permutation; arbitrary rotations
    // use ImageMagick's best-fit SRT canvas and background virtual pixels.
    if (token === "-rotate") {
        const { angle, applies } = parseMagickRotation(tokens[start + 1] ?? "0"), background = state.background, backgroundExplicit = state.backgroundExplicit, kernel = state.kernel, filter = state.resizeFilter;
        if (state.kernel === "nearest" && state.interpolation === "mesh") throw new Error("Unsupported rotation interpolation: mesh");
        const nearest = state.kernel === "nearest" && state.interpolation === "nearest";
        if (!Number.isFinite(angle) || angle % 90 === 0) return;
        return { end: start + 1, plan: (image: Pick<RgbaImage, "width" | "height" | "hasAlpha" | "backgroundColor" | "virtualCanvas">): (WarpPlan & { space?: RgbaImage["space"]; steps: ReturnType<typeof warpPixelSteps> }) | undefined => {
            if (!applies(image)) return;
            const plan = { ...magickWarpPlan(image, "+distort", "SRT", String(angle % 360))!, nearest };
            const page = image.virtualCanvas;
            // RotateImage scales the page dimensions to the best-fit raster, but
            // adds its origin to the original page offsets without scaling them.
            if (page && plan.virtualCanvas) plan.virtualCanvas = {
                width: Math.floor(page.width * plan.width / image.width + 0.5),
                height: Math.floor(page.height * plan.height / image.height + 0.5),
                x: page.x + plan.virtualCanvas.x,
                y: page.y + plan.virtualCanvas.y
            };
            return { ...plan, steps: warpPixelSteps(image, plan, backgroundExplicit ? background : image.backgroundColor ?? background, "background", kernel, filter) };
        } };
    }
    if (!["-shear", "-swirl", "-implode", "-wave", "-distort", "+distort"].includes(token)) return;
    let i = start;
    const distort = token === "-distort" || token === "+distort";
    const viewport = distort ? state.distortViewport : undefined;
    const scale = distort && state.distortScale !== undefined ? Math.abs(Number.parseFloat(state.distortScale)) : undefined;
    if (scale !== undefined && (!Number.isFinite(scale) || scale < 0.1)) throw new Error("invalid argument for option distort:scale");
    const spec = tokens[++i] ?? (distort ? "SRT" : token === "-wave" ? "5x50" : token === "-shear" ? "0x0" : "0"), args = distort ? tokens[++i] ?? "0" : "0";
    if (["-wave", "-swirl", "-implode"].includes(token) && !spec.includes("%[")) validateMagickTransformGeometry(spec, token);
    const interpolation = state.interpolation ?? "bilinear";
    const background = state.background, backgroundExplicit = state.backgroundExplicit, virtualPixel = state.virtualPixel ?? (distort || token === "-implode" ? "edge" : undefined);
    const kernel = distort ? state.kernel : undefined, filter = distort ? state.resizeFilter : undefined;
    const compose = state.composeRaw, composeArgs = state.composeArgs, fuzz = state.alphaFuzz;
    return { end: i, plan: (image: Pick<RgbaImage, "width" | "height" | "hasAlpha" | "space" | "backgroundColor" | "bitsPerSample" | "virtualCanvas">, geometry = spec) => {
        if (token === "-shear") {
            const plan = shearPlan(image, geometry);
            const virtualCanvas = plan.tx === 0 && plan.ty === 0 ? undefined : {
                width: plan.width, height: plan.height, x: image.virtualCanvas?.x ?? 0, y: image.virtualCanvas?.y ?? 0
            };
            return { ...plan, virtualCanvas, steps: shearPixelSteps(image, plan, backgroundExplicit ? background : image.backgroundColor ?? background, compose, composeArgs, fuzz) };
        }
        if (["-wave", "-swirl", "-implode"].includes(token)) validateMagickTransformGeometry(geometry, token);
        let plan = magickWarpPlan(image, token, geometry, args);
        if (plan && (token === "-swirl" || token === "-implode")) {
            if (interpolation === "mesh") throw new Error(`Unsupported ${token.slice(1)} interpolation: mesh`);
            plan = { ...plan, interpolation,
                hasAlpha: plan.hasAlpha || virtualPixel === "transparent" || (virtualPixel === "background" || virtualPixel?.endsWith("-tile") === true) && background.a < 255 };
        }
        const samplingOrigin = plan?.virtualCanvas;
        if (plan && distort && image.virtualCanvas) {
            const page = image.virtualCanvas, origin = plan.virtualCanvas;
            // Scale the input page to the output raster; only best-fit retains
            // the input offsets in addition to the computed viewport origin.
            plan = { ...plan, virtualCanvas: {
                width: Math.floor(page.width * plan.width / image.width + 0.5),
                height: Math.floor(page.height * plan.height / image.height + 0.5),
                x: origin ? page.x + origin.x : 0,
                y: origin ? page.y + origin.y : 0
            } };
        }
        if (plan && viewport !== undefined) {
            const geometry = parseMagickGeometry(viewport);
            if ((!geometry.hasOffset && geometry.width === undefined && geometry.height === undefined) ||
                ![...viewport].every(char => char.trim() === "" || "0123456789.eExX+-!<>^%@".includes(char)) ||
                ![geometry.width ?? 1, geometry.height ?? 1, geometry.x, geometry.y].every(Number.isFinite)) {
                analysis.warnings += `magick: invalid setting 'distort:viewport' '${viewport}'\n`;
            } else {
                const original = plan, origin = plan.virtualCanvas;
                let width = Math.round(geometry.width ?? (geometry.height === undefined ? plan.width : 0)), height = Math.round(geometry.height ?? plan.height);
                // Native cloning restores the source size if either dimension is zero.
                if (width === 0 || height === 0) { width = image.width; height = image.height; }
                const x = geometry.hasOffset ? Math.trunc(geometry.x) : origin?.x ?? 0, y = geometry.hasYOffset ? Math.trunc(geometry.y) : origin?.y ?? 0;
                const dx = x - (samplingOrigin?.x ?? 0), dy = y - (samplingOrigin?.y ?? 0);
                // Best-fit maps already include their page origin. Replace that
                // origin for both sampling and filter derivatives.
                plan = { ...plan, width, height, virtualCanvas: { width, height, x, y },
                    map: (px, py) => original.map(px + dx, py + dy),
                    ...(original.derivatives ? { derivatives: (px: number, py: number) => original.derivatives!(px + dx, py + dy) } : {}) };
            }
        }
        if (plan && token === "-wave") {
            let color = backgroundExplicit ? background : image.backgroundColor ?? background;
            const gray = image.space === "b-w" || image.space === "grey16";
            // Native PNG reading leaves sub-byte grayscale bKGD samples unscaled.
            if (!backgroundExplicit && image.backgroundColor && gray && (image.bitsPerSample ?? 8) < 8) {
                const value = Math.round(color.b * (2 ** image.bitsPerSample! - 1) / 255);
                color = { r: value, g: value, b: value, a: color.a };
            }
            // Wave always uses background virtual pixels. Explicit background mode
            // promotes grayscale to RGB; otherwise native's gray cache uses blue.
            if (gray && virtualPixel !== "background") color = { r: color.b, g: color.b, b: color.b, a: color.a };
            return { ...plan, space: gray && virtualPixel === "background" ? "srgb" as const : image.space, steps: warpPixelSteps(image, { ...plan, interpolation }, color, "background") };
        }
        if (plan && scale !== undefined) {
            const original = plan, originX = original.virtualCanvas?.x ?? 0, originY = original.virtualCanvas?.y ?? 0;
            let width = Math.floor(original.width * scale + 0.5), height = Math.floor(original.height * scale + 0.5);
            if (width === 0 || height === 0) { width = image.width; height = image.height; }
            const x = Math.trunc(originX * scale + 0.5), y = Math.trunc(originY * scale + 0.5);
            if (![width, height, x, y, width * height * 8].every(Number.isSafeInteger) || width < 1 || height < 1)
                throw new Error("Distortion dimensions exceed limit");
            // Scale destination pixel centers and the inverse-map filter footprint.
            plan = {
                ...original, width, height,
                ...(original.virtualCanvas ? { virtualCanvas: {
                    width: Math.floor((image.virtualCanvas?.width ?? image.width) * width / image.width + 0.5),
                    height: Math.floor((image.virtualCanvas?.height ?? image.height) * height / image.height + 0.5), x, y
                } } : {}),
                map: (px, py) => original.map((px + x + 0.5) / scale - 0.5 - originX, (py + y + 0.5) / scale - 0.5 - originY),
                ...(original.derivatives ? { derivatives: (px: number, py: number) => {
                    const [ux, uy, vx, vy] = original.derivatives!((px + x + 0.5) / scale - 0.5 - originX, (py + y + 0.5) / scale - 0.5 - originY);
                    return [ux / scale, uy / scale, vx / scale, vy / scale] as const;
                } } : {})
            };
        }
        return plan ? { ...plan, steps: warpPixelSteps(image, plan, background, virtualPixel, kernel, filter) } : undefined;
    } };
}

function magickShadowLayout(image: Pick<RgbaImage, "width" | "height" | "virtualCanvas">, geometry: string) {
    const g = parseMagickGeometry(geometry), opacity = Math.max(0, g.width ?? 0) / 100, sigma = Math.max(0, g.height ?? 1);
    if (![...geometry].every(char => "0123456789.eExX+- %!<>^@".includes(char)) ||
        (!Number.isFinite(g.width) && !Number.isFinite(g.height))) {
        throw new Error(`invalid argument for option '-shadow': ${geometry}`);
    }
    // The general geometry parser supplies zero for missing offsets; shadow defaults each to four.
    let offsets = 0;
    for (const char of geometry) if (char === "+" || char === "-") offsets++;
    const pad = Math.floor(sigma * 2 + 0.5), x = g.hasOffset ? Math.round(g.x) : 4, y = g.hasOffset && offsets > 1 ? Math.round(g.y) : 4;
    const page = image.virtualCanvas ?? { width: image.width, height: image.height, x: 0, y: 0 };
    // Match PNG unsigned page dimensions, including underflow; never use them as raster dimensions.
    return { width: image.width + pad * 2, height: image.height + pad * 2, hasAlpha: true, offsetX: pad, offsetY: pad, opacity, sigma,
        virtualCanvas: { width: ((page.width + pad + x) >>> 0) || image.width + pad * 2, height: ((page.height + pad + y) >>> 0) || image.height + pad * 2, x: page.x + x - pad, y: page.y + y - pad } };
}
function* applyMagickShadowSteps(image: RgbaImage, geometry: string, color: RgbaColor, signal?: AbortSignal): Generator<void, RgbaImage, void> {
    const layout = magickShadowLayout(image, geometry);
    if ((image.space === "b-w" || image.space === "grey16") && (color.r !== color.g || color.g !== color.b))
        image = { ...image, space: "srgb", channels: 4 };
    const base = { ...yield* applyMagickRasterSteps(image, shadowPixelSteps(image, layout, color), signal, layout), virtualCanvas: layout.virtualCanvas };
    return layout.sigma === 0 ? base : yield* applyMagickRasterSteps(base, blurPixelSteps(base, { height: layout.sigma }, false, { r: false, g: false, b: false, a: true }), signal);
}

function magickSepiaTone(intensity: number, threshold: number, gray: boolean): [number, number, number] {
    const blue = Math.max(threshold / 7, intensity - threshold / 6, 0);
    return gray ? [blue, blue, blue] : [
        Math.max(0, Math.min(255, intensity + 255 - threshold)),
        Math.max(threshold / 7, Math.min(255, intensity + 255 - 7 * threshold / 6), 0),
        blue
    ];
}

function* applyMagickSolarizeSteps(img: RgbaImage, thresh: number, channels: MagickState["channels"], signal?: AbortSignal): Generator<void, RgbaImage, void> {
    let cooperativeWork = 0;
    // Native palette solarize updates the RGB colormap, ignoring the channel mask.
    const mask = img.isPalette ? [true, true, true, false] : [channels.r, channels.g, channels.b, channels.a && img.hasAlpha];
    const out = new Uint8Array(img.data);
    const data16 = img.data16?.slice();
    const hueSamples = img.hueSamples?.slice();
    const evaluateSamples = img.evaluateSamples?.slice();
    for (let i = 0; i < out.length; i += 4) {
        if (++cooperativeWork % 65536 === 0) {
            signal?.throwIfAborted();
            yield;
        }
        for (let channel = 0; channel < 4; channel++) {
            if (!mask[channel]) continue;
            const offset = i + channel;
            const value = evaluateSamples ? evaluateSamples[offset]! * 257
                : hueSamples ? hueSamples[offset]! * 65535
                : data16 ? data16[offset]! : out[offset]! * 257;
            if (!(value > thresh)) continue;
            const next = 65535 - value;
            out[offset] = clampByteVal(next / 257);
            if (data16) data16[offset] = Math.round(Math.max(0, Math.min(65535, next)));
            if (hueSamples) hueSamples[offset] = next / 65535;
            if (evaluateSamples) evaluateSamples[offset] = next / 257;
        }
    }
    return { ...img, data: out, ...(data16 ? { data16 } : {}), ...(hueSamples ? { hueSamples } : {}), ...(evaluateSamples ? { evaluateSamples } : {}) };
}

function* posterizePixelSteps(img: Pick<RgbaImage, "width" | "height" | "hasAlpha">, levelsRaw: number, dither: boolean, channels: MagickState["channels"], signal?: AbortSignal): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    let cooperativeWork = 0;
    const levels = Math.max(2, Math.trunc(levelsRaw));
    const step = 255 / (levels - 1);
    const mask = [channels.r, channels.g, channels.b, channels.a];
    type PaletteNode = { children: PaletteNode[]; color?: number[] };
    let palette: PaletteNode | undefined;
    // Native posterize uses Riemersma only for palettes with 2–16 levels.
    dither &&= levelsRaw >= 2 && levels <= 16;
    if (!dither && levelsRaw >= 2) {
        // Quantize Q16 samples directly; an eight-bit palette loses both input
        // precision and output levels. Transfers stay bounded in caller storage.
        for (let position = 0; position < img.width * img.height * 4; position += 4096) {
            signal?.throwIfAborted();
            const length = Math.min(4096, img.width * img.height * 4 - position);
            const bytes = (yield { kind: "read", highDepth: true, position, length })!;
            const samples = new Uint16Array(bytes.slice().buffer);
            for (let i = 0; i < samples.length; i++) {
                if (mask[i % 4]) samples[i] = Math.round(Math.round(samples[i]! / 65535 * (levels - 1)) / (levels - 1) * 65535);
            }
            yield { kind: "write", highDepth: true, position, data: new Uint8Array(samples.buffer) };
        }
        return;
    }
    const errors = new Float64Array(16 * 4);
    const weights = Float64Array.from({ length: 16 }, (_, i) => 16 ** (-1 - i / 15));
    function* scan(): Generator<number> {
        for (let i = 0; i < img.width * img.height * 4; i += 4) yield i;
    }
    for (const i of dither ? hilbertPixels(img) : scan()) {
        if (++cooperativeWork % 1024 === 0) { signal?.throwIfAborted(); yield; }
        const input = (yield { kind: "read", position: i, length: 4 })!;
        const out = new Uint8Array(4);
        const alpha = img.hasAlpha ? input[3]! / 255 : 1;
        const target = [input[0]! * alpha, input[1]! * alpha, input[2]! * alpha, input[3]!];
        if (dither) for (let channel = 0; channel < 4; channel++) {
            for (let entry = 0; entry < 16; entry++) target[channel]! += weights[entry]! * errors[entry * 4 + channel]!;
            target[channel] = Math.max(0, Math.min(255, target[channel]!));
        }
        if (levelsRaw < 0) {
            // Native converts negative counts to size_t: effectively unlimited levels.
            out.set(input);
        } else if (levelsRaw < 2) {
            // Q16-HDRI zero-level quantization produces negative samples. Native
            // palette conversion associates them with negative alpha before
            // clamping alpha to zero, retaining these RGB values under transparency.
            const negativeAlpha = levelsRaw < 1 && img.hasAlpha && channels.a && input[3]! >= 128;
            for (let channel = 0; channel < 3; channel++) {
                out[channel] = negativeAlpha
                    ? mask[channel] && input[channel]! >= 128 ? 255 : 0
                    : mask[channel] || img.hasAlpha && channels.a ? 0 : input[channel]!;
            }
            out[3] = img.hasAlpha && channels.a ? 0 : input[3]!;
        } else if (dither && img.hasAlpha && target[3]! < 255) {
            // ImageMagick searches the parent of the deepest matching RGBA
            // octree node, using associated alpha for both lookup and distance.
            if (!palette) {
                palette = { children: [] };
                for (let a = 0; a < levels; a++) for (let b = 0; b < levels; b++) for (let g = 0; g < levels; g++) for (let r = 0; r < levels; r++) {
                    if (++cooperativeWork % 1024 === 0) { signal?.throwIfAborted(); yield; }
                    const color = a === 0 ? [0, 0, 0, 0] : [r * step, g * step, b * step, a * step];
                    const bytes = color.map((value, channel) => Math.round(channel === 3 ? value : value * color[3]! / 255));
                    let node = palette;
                    for (let bit = 7; bit >= 0; bit--) {
                        const id = ((bytes[0]! >> bit) & 1) | (((bytes[1]! >> bit) & 1) << 1) | (((bytes[2]! >> bit) & 1) << 2) | (((bytes[3]! >> bit) & 1) << 3);
                        node = node.children[id] ??= { children: [] };
                    }
                    node.color = color;
                }
            }
            const bytes = target.map(Math.round);
            let node = palette, parent = palette;
            for (let bit = 7; bit > 0; bit--) {
                const id = ((bytes[0]! >> bit) & 1) | (((bytes[1]! >> bit) & 1) << 1) | (((bytes[2]! >> bit) & 1) << 2) | (((bytes[3]! >> bit) & 1) << 3);
                const child = node.children[id];
                if (!child) break;
                parent = node;
                node = child;
            }
            let distance = Infinity, closest = [0, 0, 0, 0];
            const pending = [parent];
            while (pending.length) {
                if (++cooperativeWork % 1024 === 0) { signal?.throwIfAborted(); yield; }
                const candidate = pending.pop()!;
                // Reverse insertion visits octree children in native order.
                for (let child = candidate.children.length - 1; child >= 0; child--) {
                    if (candidate.children[child]) pending.push(candidate.children[child]!);
                }
                if (!candidate.color) continue;
                const color = candidate.color, candidateAlpha = color[3]! / 255;
                let error = (color[3]! - target[3]!) ** 2;
                for (let channel = 0; channel < 3; channel++) error += (color[channel]! * candidateAlpha - target[channel]! * (target[3]! / 255)) ** 2;
                if (error <= distance) { distance = error; closest = color; }
            }
            for (let channel = 0; channel < 4; channel++) out[channel] = clampByteVal(closest[channel]!);
        } else {
            for (let channel = 0; channel < 4; channel++) {
                // Dithering maps to a palette whose unselected RGB entries are
                // zero; direct posterization preserves unselected samples.
                out[channel] = !mask[channel]
                    ? dither ? channel === 3 ? 255 : 0 : input[channel]!
                    : clampByteVal(Math.round(((dither ? target[channel]! : input[channel]!) / 255) * (levels - 1)) * step);
            }
        }
        if (dither) {
            errors.copyWithin(0, 4);
            const outputAlpha = img.hasAlpha ? out[3]! / 255 : 1;
            for (let channel = 0; channel < 4; channel++) errors[60 + channel] = target[channel]! - out[channel]! * (channel === 3 ? 1 : outputAlpha);
        }
        yield { kind: "write", position: i, data: out };
    }
}

function* applyMagickRasterSteps(img: RgbaImage, steps: Generator<ConvolveRequest | undefined, void, Uint8Array | undefined>, signal?: AbortSignal, dimensions: Pick<RgbaImage, "width" | "height" | "hasAlpha"> = img, sources: readonly RgbaImage[] = [img]): Generator<void, RgbaImage, void> {
    const data = new Uint8Array(dimensions.width * dimensions.height * 4);
    let hueSamples: Float64Array | undefined;
    let data16: Uint16Array | undefined;
    let next = steps.next();
    while (!next.done) {
        signal?.throwIfAborted();
        const request = next.value;
        if (!request) { yield; next = steps.next(); }
        else if (request.kind === "read") {
            const source = sources[request.image ?? 0]!;
            if (request.hue) {
                const inks = source.hueSamples?.subarray(request.position, request.position + request.length);
                next = steps.next(inks ? new Uint8Array(inks.buffer, inks.byteOffset, inks.byteLength) : new Uint8Array());
                continue;
            }
            const samples = source.data16?.subarray(request.position, request.position + request.length);
            next = steps.next(request.highDepth
                ? samples ? new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength) : new Uint8Array(Uint16Array.from(source.data.subarray(request.position, request.position + request.length), value => value * 257).buffer)
                : source.data.subarray(request.position, request.position + request.length));
        } else {
            if (request.hue) {
                hueSamples ??= new Float64Array(data.length);
                hueSamples.set(new Float64Array(request.data.slice().buffer), request.position);
            } else if (request.highDepth) {
                const samples = new Uint16Array(request.data.slice().buffer);
                data16 ??= new Uint16Array(data.length);
                data16.set(samples, request.position);
                data.set(Uint8Array.from(samples, value => Math.round(value / 257)), request.position);
            } else data.set(request.data, request.position);
            next = steps.next();
        }
    }
    // Raster steps replace the pixels; the original high-depth samples are stale.
    const { data16: _data16, ...metadata } = img;
    return { ...metadata, width: dimensions.width, height: dimensions.height, hasAlpha: dimensions.hasAlpha, data, ...(data16 ? { data16 } : {}), ...(hueSamples ? { hueSamples } : {}) };
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
  if (norm === "bartlett" || norm === "blackman" || norm === "bohman" || norm === "cosine" || norm === "hamming" || norm === "hann" || norm === "kaiser" || norm === "parzen" || norm === "welch") return norm;
  if (norm === "gaussian" || norm === "jinc" || norm === "lagrange" || norm === "sinc" || norm === "sincfast" || norm === "magickernelsharp2013" || norm === "magickernelsharp2021") return norm;
  if (norm === "box") return "box";
  if (norm === "point" || norm === "nearest") return "nearest";
  if (norm === "triangle" || norm === "bilinear" || norm === "linear") return "bilinear";
  if (norm === "cubic" || norm === "spline") return "cubic";
  if (norm === "catrom" || norm === "cubicspline" || norm === "hermite" || norm === "quadratic" || norm === "robidoux" || norm === "robidouxsharp") return norm;
  if (norm === "mitchell") return "mitchell";
  if (norm === "lanczos2" || norm === "lanczos2sharp" || norm === "lanczossharp") return norm;
  if (norm === "lanczos" || norm === "lanczos3") return "lanczos3";
  throw new Error(`unrecognized image filter '${raw}'`);
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


function* compositeMaskPixelSteps(image: Pick<RgbaImage, "width" | "height">, mask: Pick<RgbaImage, "width" | "height" | "hasAlpha">): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x += 4096) {
        yield;
        const count = Math.min(4096, image.width - x), position = (y * image.width + x) * 4;
        const data = new Uint8Array((yield { kind: "read", position, length: count * 4 })!);
        const masked = y < mask.height ? Math.max(0, Math.min(count, mask.width - x)) : 0;
        if (masked) {
            const pixels = (yield { kind: "read", image: 1, position: (y * mask.width + x) * 4, length: masked * 4 })!;
            for (let i = 0; i < masked * 4; i += 4) {
                const alpha = mask.hasAlpha ? pixels[i + 3]! : 0.212656 * pixels[i]! + 0.715158 * pixels[i + 1]! + 0.072186 * pixels[i + 2]!;
                data[i + 3] = clampByteVal(data[i + 3]! * alpha / 255);
            }
        }
        yield { kind: "write", position, data };
    }
}

function* applyMagickCompositeLayerSteps(dst: RgbaImage, src: RgbaImage, modeRaw: string, left: number, top: number, composeArgs?: string, signal?: AbortSignal, fuzz = 0, clipToOverlay = false): Generator<void, RgbaImage, void> {
    const { delegated, preservesAlpha } = magickCompositeMode(modeRaw);
    if (delegated) {
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
    const out = new Uint8Array(dst.data.length);
    yield* compositePixelsSteps(dst, src, out, modeRaw, left, top, composeArgs, fuzz, clipToOverlay);
    const hasAlpha = preservesAlpha ? dst.hasAlpha : true;
    return { ...dst, data: out, hasAlpha, channels: hasAlpha ? dst.channels : dst.channels <= 2 ? 1 : 3 };
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

function* createSolidRgbaImageSteps(width: number, height: number, color: RgbaColor, highDepth = false): Generator<void, RgbaImage, void> {
    yield;
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    const data = new Uint8Array(new ArrayBuffer(w * h * 4 + h), 0, w * h * 4);
    const data16 = highDepth ? new Uint16Array(w * h * 4) : undefined;
    const tmp = new Uint8Array([color.r, color.g, color.b, color.a]);
    const packed = new Uint32Array(tmp.buffer)[0]!;
    const u32 = new Uint32Array(data.buffer, 0, w * h);
    for (let p = 0; p < u32.length; p += 16384) {
        u32.fill(packed, p, Math.min(u32.length, p + 16384));
        if (data16) for (let i = p * 4; i < Math.min(data.length, (p + 16384) * 4); i++) data16[i] = data[i]! * 257;
        yield;
    }
    return {
        ...(data16 ? { data16 } : {}),
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

function magickResizeOptions(img:Pick<RgbaImage,"width"|"height"|"hasAlpha">,geomStr:string,kernel:ResizeKernel | undefined): (Omit<Parameters<typeof resizeImageSteps>[1], "kernel"> & { kernel: ResizeKernel }) | undefined {
    const g = parseMagickGeometry(geomStr);
    const srcW = img.width;
    const srcH = img.height;
    let targetW: number;
    let targetH: number;
    if (g.aspectRatio !== undefined) {
        targetW = Math.max(1, Math.round(Math.min(srcW, srcH * g.aspectRatio)));
        targetH = Math.max(1, Math.round(Math.min(srcH, srcW / g.aspectRatio)));
    }
    else if (g.areaLimit !== undefined) {
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
        const sx = (g.width ?? 100) / 100;
        const sy = (g.percentY ?? 100) / 100;
        targetW = Math.max(1, Math.round(srcW * sx));
        targetH = Math.max(1, Math.round(srcH * sy));
    }
    else if (g.forceExact) {
        targetW = Math.max(1, Math.round(g.width ?? srcW));
        targetH = Math.max(1, Math.round(g.height ?? srcH));
        if (g.shrinkOnly) {
            targetW = Math.min(srcW, targetW);
            targetH = Math.min(srcH, targetH);
        }
        if (g.enlargeOnly) {
            targetW = Math.max(srcW, targetW);
            targetH = Math.max(srcH, targetH);
        }
        if (srcW === targetW && srcH === targetH)
            return undefined;
    }
    else if (g.fillArea) {
        const boxW = g.width ?? g.height ?? srcW;
        const boxH = g.height ?? g.width ?? srcH;
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
        kernel: kernel ?? (img.hasAlpha || targetW * targetH > srcW * srcH ? "mitchell" : "lanczos3"),
        background: { r: 0, g: 0, b: 0, a: 0 },
        withoutEnlargement: false,
        withoutReduction: false
    };
}

function magickResizeCanvas(image: Pick<RgbaImage, "width" | "height" | "virtualCanvas">, width: number, height: number) {
    const page = image.virtualCanvas;
    if (!page) return undefined;
    let scaleX = width / image.width, scaleY = height / image.height;
    const pageWidth = Math.floor(scaleX * page.width + 0.5), pageHeight = Math.floor(scaleY * page.height + 0.5);
    // CloneImage uses the smaller ratio for offsets when the ratios differ by less than two.
    if (Math.abs(scaleX - scaleY) < 2) scaleX = scaleY = Math.min(scaleX, scaleY);
    return { width: pageWidth, height: pageHeight, x: Math.ceil(scaleX * page.x - 0.5), y: Math.ceil(scaleY * page.y - 0.5) };
}

function* applyMagickResizeSteps(img: RgbaImage, geomStr: string, kernel: ResizeKernel | undefined, thumbnail = false, sample = false, scale = false, settings?: ResizeFilterSettings, sampleOffset?: { x: number; y: number }): Generator<void, RgbaImage, void> {
    const options = magickResizeOptions(img, geomStr, kernel ?? (thumbnail ? "lanczos3" : undefined));
    if (!options || (options.width === img.width && options.height === img.height)) return img;
    kernel = options.kernel;
    const width = options.width!, height = options.height!;
    let resized = !settings && !img.data16 && !scale && (kernel === "linear")
        ? yield* resizeImageSteps(img, { ...options, kernel })
        : yield* applyMagickRasterSteps(img, !scale && kernel === "nearest" ? pointResizePixelSteps(img, width, height, sample, 4, sampleOffset) : resizePixelSteps(img, width, height, thumbnail, scale, kernel, !!img.data16, settings), undefined, { ...img, width, height });
    if (!scale && kernel === "nearest" && img.data16) {
        const source = new Uint8Array(img.data16.buffer, img.data16.byteOffset, img.data16.byteLength);
        const data16 = new Uint16Array(width * height * 4), bytes = new Uint8Array(data16.buffer);
        const steps = pointResizePixelSteps(img, width, height, sample, 8, sampleOffset);
        let next = steps.next();
        while (!next.done) {
            const request = next.value;
            if (!request) { yield; next = steps.next(); }
            else if (request.kind === "read") next = steps.next(source.subarray(request.position, request.position + request.length));
            else { bytes.set(request.data, request.position); next = steps.next(); }
        }
        resized = { ...resized, data16 };
    }
    const virtualCanvas = thumbnail ? undefined : magickResizeCanvas(img, width, height);
    return virtualCanvas ? { ...resized, virtualCanvas } : resized;
}

async function resizeStoredMagickImage(image: StoredRgbaImage, backend: CompareFileSession, options: NonNullable<ReturnType<typeof magickResizeOptions>>, signal: AbortSignal, thumbnail = false, sample = false, scale = false, settings?: ResizeFilterSettings, sampleOffset?: { x: number; y: number }): Promise<StoredRgbaImage> {
    const width = options.width!, height = options.height!;
    if (width === image.width && height === image.height) return image;
    let resized = !settings && !image.storedData16 && !scale && (options.kernel === "linear")
        ? await transformStoredImage(image, backend.storage, { kind: "resize", ...options, kernel: options.kernel }, signal)
        : await transformStoredMagickRaster(image, backend, !scale && options.kernel === "nearest" ? pointResizePixelSteps(image, width, height, sample, 4, sampleOffset) : resizePixelSteps(image, width, height, thumbnail, scale, options.kernel, !!image.storedData16, settings), signal, { ...image, width, height });
    if (!scale && options.kernel === "nearest" && image.storedData16) {
        const storedData16 = { position: backend.storage.allocate(width * height * 8), length: width * height * 4 };
        const steps = pointResizePixelSteps(image, width, height, sample, 8, sampleOffset);
        let next = steps.next();
        while (!next.done) {
            signal.throwIfAborted();
            const request = next.value;
            if (!request) { await yieldTurn(signal); next = steps.next(); }
            else if (request.kind === "read") next = steps.next(await backend.storage.read(image.storedData16.position + request.position, request.length));
            else { await backend.storage.write(storedData16.position + request.position, request.data); next = steps.next(); }
        }
        resized = { ...resized, storedData16 };
    }
    const virtualCanvas = thumbnail ? undefined : magickResizeCanvas(image, width, height);
    return virtualCanvas ? { ...resized, virtualCanvas } : resized;
}

function magickRotateCanvas(image: Pick<RgbaImage, "width" | "height" | "virtualCanvas">, angle: number) {
    const rotation = ((angle % 360) + 360) % 360;
    const page = image.virtualCanvas ?? { width: image.width, height: image.height, x: 0, y: 0 };
    if (Math.abs(rotation - 90) < 1e-6)
        return { width: page.height, height: page.width, x: page.height - image.height - page.y, y: page.x };
    if (Math.abs(rotation - 180) < 1e-6)
        return { ...page, x: page.width - image.width - page.x, y: page.height - image.height - page.y };
    if (Math.abs(rotation - 270) < 1e-6)
        return { width: page.height, height: page.width, x: page.y, y: page.width - image.width - page.x };
    return page;
}

function magickMirrorCanvas(image: Pick<RgbaImage, "width" | "height" | "virtualCanvas">, kind: "flip" | "flop") {
    const page = image.virtualCanvas ?? { width: image.width, height: image.height, x: 0, y: 0 };
    return kind === "flip"
        ? { ...page, y: page.height ? page.height - image.height - page.y : page.y }
        : { ...page, x: page.width ? page.width - image.width - page.x : page.x };
}

function magickTransposeCanvas(image: Pick<RgbaImage, "width" | "height" | "virtualCanvas">, transverse: boolean) {
    const page = image.virtualCanvas ?? { width: image.width, height: image.height, x: 0, y: 0 };
    let scaleX = image.height / image.width, scaleY = image.width / image.height;
    // Native CloneImage scales the page before transpose swaps its axes.
    const width = Math.floor(scaleY * page.height + 0.5), height = Math.floor(scaleX * page.width + 0.5);
    if (Math.abs(scaleX - scaleY) < 2) scaleX = scaleY = Math.min(scaleX, scaleY);
    const x = Math.ceil(scaleY * page.y - 0.5), y = Math.ceil(scaleX * page.x - 0.5);
    return { width, height, x: transverse && width ? width - image.height - x : x, y: transverse && height ? height - image.width - y : y };
}

function magickAutoOrientCanvas(image: Pick<RgbaImage, "width" | "height" | "virtualCanvas" | "orientation">) {
    if (!image.virtualCanvas && image.orientation !== 5 && image.orientation !== 7) return undefined;
    switch (image.orientation) {
        case 2: return magickMirrorCanvas(image, "flop");
        case 3: return magickRotateCanvas(image, 180);
        case 4: return magickMirrorCanvas(image, "flip");
        case 5: return magickTransposeCanvas(image, false);
        case 6: return magickRotateCanvas(image, 90);
        case 7: return magickTransposeCanvas(image, true);
        case 8: return magickRotateCanvas(image, 270);
        default: return image.virtualCanvas;
    }
}

function magickBorderCanvas(image: Pick<RgbaImage, "width" | "height" | "virtualCanvas">, width: number, height: number) {
    const page = image.virtualCanvas ?? { width: image.width, height: image.height, x: 0, y: 0 };
    return { ...page, width: page.width ? page.width + width * 2 : 0, height: page.height ? page.height + height * 2 : 0 };
}

function magickCropCanvas(image: Pick<RgbaImage, "width" | "height" | "virtualCanvas">, left: number, top: number) {
    const page = image.virtualCanvas ?? { width: image.width, height: image.height, x: 0, y: 0 };
    return { ...page, x: page.x + left, y: page.y + top };
}

function magickRepageCanvas(image: Pick<RgbaImage, "width" | "height" | "virtualCanvas">, geometry: MagickGeometry) {
    const page = image.virtualCanvas ?? { width: image.width, height: image.height, x: 0, y: 0 };
    return {
        width: geometry.width ?? page.width,
        height: geometry.height ?? (geometry.width === undefined ? page.height : geometry.width),
        x: geometry.hasOffset ? geometry.x + (geometry.forceExact ? page.x : 0) : page.x,
        y: geometry.hasOffset ? geometry.y + (geometry.forceExact ? page.y : 0) : page.y
    };
}

function* applyMagickCropSteps(img: RgbaImage, geomStr: string, gravity: GravityPosition): Generator<void, RgbaImage, void> {
    return (yield* applyMagickCropToStackSteps(img, geomStr, gravity))[0]!;
}

function* applyMagickCropToStackSteps(img: RgbaImage, geomStr: string, gravity: GravityPosition, analysis?: { warnings: string }): Generator<void, RgbaImage[], void> {
    const tiles: RgbaImage[] = [];
    for (const area of magickCropAreas(img, geomStr, gravity)) {
        yield;
        if (area === null) {
            if (analysis) analysis.warnings += `magick: geometry does not contain image '${geomStr}'\n`;
            tiles.push({ ...(yield* createSolidRgbaImageSteps(1, 1, { r: 255, g: 255, b: 255, a: 0 })),
                ...(img.delay ? { delay: img.delay } : {}),
                ...((img as MagickImage)[magickInput] ? { [magickInput]: (img as MagickImage)[magickInput] } : {}),
                virtualCanvas: { ...magickCropCanvas(img, 0, 0), x: -1, y: -1 } });
            continue;
        }
        tiles.push(area ? { ...(yield* extractImageSteps(img, area)), virtualCanvas: magickCropCanvas(img, area.left, area.top) } : img);
    }
    return tiles;
}

function* magickCropAreas(img: Pick<RgbaImage, "width" | "height" | "virtualCanvas">, geomStr: string, gravity: GravityPosition): Generator<Parameters<typeof extractImageSteps>[1] | undefined | null> {
    const g = parseMagickGeometry(geomStr);
    if (g.isSubdivide) {
        const cols = Math.max(1, Math.round(g.width ?? 1));
        const rows = Math.max(1, Math.round(g.height ?? 1));
        for (let r = 0; r < rows; r++) {
            const top = Math.min(img.height - 1, Math.round((r * img.height) / rows));
            const nextTop = Math.max(top + 1, Math.min(img.height, Math.round(((r + 1) * img.height) / rows)));
            for (let c = 0; c < cols; c++) {
                const left = Math.min(img.width - 1, Math.round((c * img.width) / cols));
                const nextLeft = Math.max(left + 1, Math.min(img.width, Math.round(((c + 1) * img.width) / cols)));
                yield { left, top, width: nextLeft - left, height: nextTop - top };
            }
        }
    } else if (!g.hasOffset) {
        const width = Math.max(1, Math.round(g.isPercent ? img.width * (g.percentX ?? 100) / 100 : g.width || img.width));
        const height = Math.max(1, Math.round(g.isPercent ? img.height * (g.percentY ?? 100) / 100 : g.height || img.height));
        for (let top = 0; top < img.height; top += height)
            for (let left = 0; left < img.width; left += width)
                yield { left, top, width: Math.min(width, img.width - left), height: Math.min(height, img.height - top) };
    } else {
        yield magickCropArea(img, geomStr, gravity);
    }
}

function magickCropArea(img:Pick<RgbaImage,"width"|"height"|"virtualCanvas">,geomStr:string,gravity:GravityPosition):Parameters<typeof extractImageSteps>[1]|undefined|null {
 const g=parseMagickGeometry(geomStr);
    const rawW = g.isPercent
        ? Math.max(1, Math.round((img.width * (g.percentX ?? 100)) / 100))
        : Math.max(1, Math.round(g.width ?? img.width));
    const rawH = g.isPercent
        ? Math.max(1, Math.round((img.height * (g.percentY ?? 100)) / 100))
        : Math.max(1, Math.round(g.height ?? img.height));
    const position = gravityAdjustBox(img.width, img.height, rawW, rawH, g.x, g.y, gravity);
    // Crop geometry uses page coordinates; extraction uses local raster coordinates.
    const x0 = position.x - (img.virtualCanvas?.x ?? 0);
    const y0 = position.y - (img.virtualCanvas?.y ?? 0);
    if (x0 === img.width || y0 === img.height) {
        return undefined;
    }
    const ix0 = Math.max(0, x0);
    const iy0 = Math.max(0, y0);
    const ix1 = Math.min(img.width, x0 + rawW);
    const iy1 = Math.min(img.height, y0 + rawH);
    if (ix1 <= ix0 || iy1 <= iy0) {
        return null;
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
    const targetW = Math.max(1, Math.round(g.aspectRatio !== undefined ? Math.min(img.width, img.height * g.aspectRatio) : g.isPercent ? img.width * (g.percentX ?? 100) / 100 : g.width ?? img.width));
    const targetH = Math.max(1, Math.round(g.aspectRatio !== undefined ? Math.min(img.height, img.width / g.aspectRatio) : g.isPercent ? img.height * (g.percentY ?? 100) / 100 : g.height ?? img.height));
    if ((g.enlargeOnly && img.width > targetW && img.height > targetH)
        || (g.shrinkOnly && img.width < targetW && img.height < targetH)) return undefined;
    const offset = gravityAdjustBox(img.width, img.height, targetW, targetH, g.x, g.y, state.gravity);
    const left = -offset.x;
    const top = -offset.y;
    const dstX0 = Math.max(0, left);
    const dstY0 = Math.max(0, top);
    const dstX1 = Math.min(targetW, left + img.width);
    const dstY1 = Math.min(targetH, top + img.height);
    return { width: targetW, height: targetH, left: dstX0, top: dstY0, area: dstX1 <= dstX0 || dstY1 <= dstY0 ? undefined : { left: dstX0 - left, top: dstY0 - top, width: dstX1 - dstX0, height: dstY1 - dstY0 } };
}
function* applyMagickExtentSteps(img: RgbaImage, geomStr: string, state: MagickState, signal?: AbortSignal): Generator<void, RgbaImage, void> {
    yield;
    const layout = magickExtentLayout(img, geomStr, state);
    if (!layout) return img;
    const virtualCanvas = magickResizeCanvas(img, layout.width, layout.height);
    const source = (img as MagickImage)[magickInput];
    const background = state.backgroundExplicit ? state.background : img.backgroundColor ?? state.background;
    const canvas = { ...yield* createSolidRgbaImageSteps(layout.width, layout.height, background, !!img.data16),
        ...(img.delay ? { delay: img.delay } : {}), ...(source ? { [magickInput]: source } : {}), ...(virtualCanvas ? { virtualCanvas } : {}) };
    if (!layout.area) return canvas;
    if (img.data16 && canvas.data16) {
        for (let y = 0; y < layout.area.height; y++) for (let x = 0; x < layout.area.width; x += 4096) {
            yield;
            const start = ((layout.area.top + y) * img.width + layout.area.left + x) * 4;
            const samples = img.data16.slice(start, start + Math.min(4096, layout.area.width - x) * 4);
            extentSamplesOverBackground(samples, background);
            const target = ((layout.top + y) * layout.width + layout.left + x) * 4;
            canvas.data16.set(samples, target);
            canvas.data.set(Uint8Array.from(samples, value => Math.round(value / 257)), target);
        }
        return canvas;
    }
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
function extentSamplesOverBackground(samples: Uint16Array, background: RgbaColor): void {
    const color = [background.r * 257, background.g * 257, background.b * 257];
    for (let i = 0; i < samples.length; i += 4) {
        const alpha = samples[i + 3]! / 65535, behind = background.a / 255 * (1 - alpha), combined = alpha + behind;
        for (let c = 0; c < 3; c++) samples[i + c] = combined ? Math.round((samples[i + c]! * alpha + color[c]! * behind) / combined) : 0;
        samples[i + 3] = Math.round(combined * 65535);
    }
}

async function createStoredCanvas(width: number, height: number, color: RgbaColor, backend: CompareFileSession, signal: AbortSignal, highDepth = false): Promise<StoredRgbaImage> {
    const image: StoredRgbaImage = { ...await decodeImageToStorage({ size: 0, async read() { return new Uint8Array(); } }, backend.storage, signal, { create: { width, height, channels: 4, background: { r: color.r, g: color.g, b: color.b, alpha: color.a / 255 } } }), format: "png" };
    if (highDepth) {
        const storedData16 = { position: backend.storage.allocate(width * height * 8), length: width * height * 4 };
        for (let offset = 0; offset < width * height * 4; offset += 16384) {
            await yieldTurn(signal);
            const bytes = await backend.storage.read(image.position + offset, Math.min(16384, width * height * 4 - offset));
            const samples = Uint16Array.from(bytes, value => value * 257);
            await backend.storage.write(storedData16.position + offset * 2, new Uint8Array(samples.buffer));
        }
        return { ...image, storedData16 };
    }
    return image;
}

type MagickDrawShape = { kind: "shape"; tile: boolean; color: RgbaColor; x: number; y: number; antialias?: boolean } & ({ shape: "rectangle"; width: number; height: number } | { shape: "circle"; radius: number } | { shape: "line"; x1: number; y1: number; width: number; fill: RgbaColor });
type MagickDrawStep = MagickDrawShape | { kind: "svg"; svg: string } | ({ kind: "floodfill" } | { kind: "paint-point" } | { kind: "reset" } | { kind: "replace" }) & { x: number; y: number; color: RgbaColor; alphaOnly: boolean; fillToBorder: boolean };

function* drawPointPixelSteps(image: Pick<RgbaImage, "width" | "height">, point: { kind: "paint-point" | "reset"; x: number; y: number; color: RgbaColor; alphaOnly: boolean }, highDepth: boolean): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const seed = point.y * image.width + point.x, scale = highDepth ? 257 : 1;
    for (let start = 0; start < image.width * image.height; start += 1024) {
        yield;
        const count = Math.min(1024, image.width * image.height - start);
        const bytes = yield { kind: "read", position: start * 4, length: count * 4, highDepth };
        if (!bytes || bytes.length !== count * 4 * (highDepth ? 2 : 1)) throw new Error("Truncated drawing pixels");
        const data = highDepth ? new Uint16Array(bytes.slice().buffer) : new Uint8Array(bytes);
        for (let offset = point.kind === "reset" ? 0 : (seed - start) * 4; offset >= 0 && offset < count * 4; offset += point.kind === "reset" ? 4 : count * 4) {
            if (!point.alphaOnly) {
                data[offset] = point.color.r * scale;
                data[offset + 1] = point.color.g * scale;
                data[offset + 2] = point.color.b * scale;
            }
            data[offset + 3] = Math.round(point.color.a * scale);
        }
        yield { kind: "write", position: start * 4, data: new Uint8Array(data.buffer), highDepth };
    }
}

function* drawShapePixelSteps(image: Pick<RgbaImage, "width" | "height">, shape: MagickDrawShape, highDepth = false, tile?: Pick<RgbaImage, "width" | "height">): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const quantum = highDepth ? 65535 : 255, scale = highDepth ? 257 : 1;
    const radius = shape.shape === "circle" ? shape.radius : shape.shape === "line" ? shape.width / 2 : 0;
    const x0 = Math.max(0, Math.floor(shape.shape === "rectangle" ? shape.x : Math.min(shape.x, shape.shape === "line" ? shape.x1 : shape.x) - radius - 1));
    const y0 = Math.max(0, Math.floor(shape.shape === "rectangle" ? shape.y : Math.min(shape.y, shape.shape === "line" ? shape.y1 : shape.y) - radius - 1));
    const x1 = Math.min(image.width, Math.ceil(shape.shape === "rectangle" ? shape.x + shape.width : Math.max(shape.x, shape.shape === "line" ? shape.x1 : shape.x) + radius + 1));
    const y1 = Math.min(image.height, Math.ceil(shape.shape === "rectangle" ? shape.y + shape.height : Math.max(shape.y, shape.shape === "line" ? shape.y1 : shape.y) + radius + 1));
    for (let start = 0; start < image.width * image.height; start += 1024) {
        yield;
        const count = Math.min(1024, image.width * image.height - start), bytes = yield { kind: "read", position: start * 4, length: count * 4, highDepth };
        if (!bytes || bytes.length !== count * 4 * (highDepth ? 2 : 1)) throw new Error("Truncated drawing pixels");
        const data = highDepth ? new Uint16Array(bytes.slice().buffer) : new Uint8Array(bytes);
        for (let i = 0; i < count; i++) {
            const x = (start + i) % image.width, y = Math.floor((start + i) / image.width);
            if (x < x0 || x >= x1 || y < y0 || y >= y1) continue;
            let coverage = 1;
            if (shape.shape === "circle") {
                // ImageMagick traces circles with angular steps of 1/(8r), then
                // fills boundary pixels and squares the exterior distance fade.
                const px = x - shape.x, py = y - shape.y, step = 1 / (8 * shape.radius);
                const angle = (Math.atan2(py, px) + 2 * Math.PI) % (2 * Math.PI);
                const start = Math.floor(angle / step) * step, end = Math.min(start + step, 2 * Math.PI);
                const ax = shape.radius * Math.cos(start), ay = shape.radius * Math.sin(start);
                const dx = shape.radius * Math.cos(end) - ax, dy = shape.radius * Math.sin(end) - ay;
                const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
                const distance = Math.hypot(px - ax - t * dx, py - ay - t * dy);
                coverage = dx * (py - ay) - dy * (px - ax) >= 0 ? 1 : Math.max(0, 1 - distance) ** 2;
                if (shape.antialias === false) coverage = coverage >= 0.5 ? 1 : 0;
            }
            let color = shape.color;
            if (shape.shape === "line") {
                const dx = shape.x1 - shape.x, dy = shape.y1 - shape.y;
                const lengthSquared = dx * dx + dy * dy;
                const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((x - shape.x) * dx + (y - shape.y) * dy) / lengthSquared));
                const distance = Math.hypot(x - shape.x - t * dx, y - shape.y - t * dy);
                // Native edge bounds exclude the leading edge and include the
                // trailing edge. Stroke coverage extends 3/4 pixel past midwidth.
                const mid = shape.width / 2;
                if (x <= Math.min(shape.x, shape.x1) - mid - 0.5 || x > Math.max(shape.x, shape.x1) + mid + 0.5 ||
                    y <= Math.min(shape.y, shape.y1) - mid - 0.5 || y > Math.max(shape.y, shape.y1) + mid + 0.5) continue;
                coverage = distance <= Math.abs(mid - 0.25) ? 1 : Math.max(0, mid + 0.75 - distance) ** 2;
                if (shape.antialias === false) coverage = coverage >= 0.5 ? 1 : 0;
                if (distance <= 0.5 && shape.fill.a > 0) {
                    const alpha = shape.fill.a / 255, offset = i * 4, da = data[offset + 3]! / quantum;
                    const outA = alpha + da * (1 - alpha);
                    for (const [channel, value] of [shape.fill.r, shape.fill.g, shape.fill.b].entries()) data[offset + channel] = Math.round((value * scale * alpha + data[offset + channel]! * da * (1 - alpha)) / outA);
                    data[offset + 3] = Math.round(outA * quantum);
                }
            }
            if (shape.tile && tile) {
                const source = yield { kind: "read", image: 1, position: ((y % tile.height) * tile.width + x % tile.width) * 4, length: 4 };
                if (!source || source.length !== 4) throw new Error("Truncated drawing tile");
                color = { r: source[0]!, g: source[1]!, b: source[2]!, a: source[3]! * shape.color.a / 255 };
            }
            const alpha = color.a / 255 * coverage, offset = i * 4;
            if (alpha >= 0.999) {
                data[offset] = color.r * scale; data[offset + 1] = color.g * scale; data[offset + 2] = color.b * scale; data[offset + 3] = quantum;
            } else if (alpha > 0) {
                const da = data[offset + 3]! / quantum, outA = alpha + da * (1 - alpha);
                if (outA > 0) {
                    data[offset] = Math.round((color.r * scale * alpha + data[offset]! * da * (1 - alpha)) / outA);
                    data[offset + 1] = Math.round((color.g * scale * alpha + data[offset + 1]! * da * (1 - alpha)) / outA);
                    data[offset + 2] = Math.round((color.b * scale * alpha + data[offset + 2]! * da * (1 - alpha)) / outA);
                    data[offset + 3] = Math.round(outA * quantum);
                }
            }
        }
        yield { kind: "write", position: start * 4, data: new Uint8Array(data.buffer), highDepth };
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
    let tile = state.tile !== undefined;
    let stroke = rgbaToCss(state.stroke);
    let strokeWidth = state.strokeWidth;
    let fillOpacity: number | undefined;
    let strokeOpacity: number | undefined;
    let affine: [number, number, number, number, number, number] = [1, 0, 0, 1, 0, 0];
    const contexts: { fill: string; tile: boolean; stroke: string; strokeWidth: number; affine: typeof affine; fillOpacity: number | undefined; strokeOpacity: number | undefined }[] = [];
    const tokens: string[] = [];
    for (let offset = 0; offset < drawCmd.length;) {
        if (++cooperativeWork % 65536 === 0) yield;
        const char = drawCmd[offset]!;
        if (char === "," || char.trim() === "") { offset++; continue; }
        if (char === "#") {
            const end = drawCmd.indexOf("\n", offset + 1);
            offset = end < 0 ? drawCmd.length : end + 1;
            continue;
        }
        if (char === "'" || char === '"') {
            const end = drawCmd.indexOf(char, offset + 1);
            if (end >= 0) { tokens.push(drawCmd.slice(offset + 1, end)); offset = end + 1; continue; }
        }
        const start = offset++;
        while (offset < drawCmd.length && drawCmd[offset] !== "," && drawCmd[offset]!.trim() !== "") offset++;
        tokens.push(drawCmd.slice(start, offset));
    }
    let i = 0;
    const num = () => {
        const value = Number(tokens[i++]);
        if (!Number.isFinite(value)) throw new Error("Drawing requires finite numeric coordinates");
        return value;
    };
    while (i < tokens.length) {
        if (++cooperativeWork % 65536 === 0)
            yield;
        const cmd = tokens[i++]!.toLowerCase();
        const fillColor = { ...parseColor(fill) }, strokeColor = { ...parseColor(stroke) };
        if (fillOpacity !== undefined && fill !== "none") fillColor.a = fillOpacity * 255;
        if (strokeOpacity !== undefined && stroke !== "none") strokeColor.a = strokeOpacity * 255;
        const paintFill = rgbaToCss(fillColor), paintStroke = rgbaToCss(strokeColor);
        if (svgElements.length > 0 && (["line", "circle"].includes(cmd) ||
            ((fillOpacity !== undefined || strokeOpacity !== undefined) && ["point", "rectangle"].includes(cmd)))) {
            yield { kind: "svg", svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${img.width}" height="${img.height}"${state.antialias === false ? ' shape-rendering="crispEdges"' : ""}>${svgElements.join("")}</svg>` };
            svgElements.length = 0;
        }
        const elementStart = svgElements.length;
        const transformed = affine.some((value, index) => value !== (index === 0 || index === 3 ? 1 : 0));
        if (cmd === "push" || cmd === "pop") {
            if (tokens[i++]?.toLowerCase() !== "graphic-context") throw new Error(`${cmd} drawing requires graphic-context`);
            if (cmd === "push") contexts.push({ fill, tile, stroke, strokeWidth, affine, fillOpacity, strokeOpacity });
            else {
                const context = contexts.pop();
                if (!context) throw new Error("Cannot pop graphic-context without a matching push");
                ({ fill, tile, stroke, strokeWidth, affine, fillOpacity, strokeOpacity } = context);
            }
        }
        else if (cmd === "translate" || cmd === "scale" || cmd === "rotate" || cmd === "affine") {
            let next: typeof affine;
            if (cmd === "translate") next = [1, 0, 0, 1, num(), num()];
            else if (cmd === "scale") next = [num(), 0, 0, num(), 0, 0];
            else if (cmd === "rotate") {
                const angle = (num() % 360) * Math.PI / 180, cosine = Math.cos(angle), sine = Math.sin(angle);
                next = [cosine, sine, -sine, cosine, 0, 0];
            } else next = [num(), num(), num(), num(), num(), num()];
            const [a, b, c, d, e, f] = affine, [g, h, j, k, l, m] = next;
            affine = [a * g + c * h, b * g + d * h, a * j + c * k, b * j + d * k, a * l + c * m + e, b * l + d * m + f];
            if (!affine.every(Number.isFinite)) throw new Error("Drawing requires a finite transform");
        }
        else if (cmd === "fill") {
            fill = rgbaToCss(parseColor(tokens[i++] ?? "#000000"));
            tile = false;
        }
        else if (cmd === "stroke") {
            stroke = rgbaToCss(parseColor(tokens[i++] ?? "#000000"));
        }
        else if (cmd === "fill-opacity" || cmd === "stroke-opacity") {
            const raw = tokens[i++];
            const value = raw?.endsWith("%") ? Number(raw.slice(0, -1)) / 100 : Number(raw);
            if (!raw || !Number.isFinite(value)) throw new Error(`${cmd} drawing requires a finite opacity`);
            const opacity = Math.max(0, Math.min(1, value));
            if (cmd === "fill-opacity") fillOpacity = opacity;
            else strokeOpacity = opacity;
        }
        else if (cmd === "stroke-width" || cmd === "strokewidth") {
            strokeWidth = Math.max(0, num());
        }
        else if (cmd === "color" || cmd === "alpha") {
            const px = num(), py = num(), method = tokens[i++]?.toLowerCase();
            const x = affine[0] * px + affine[2] * py + affine[4], y = affine[1] * px + affine[3] * py + affine[5];
            if ((method !== "floodfill" && method !== "filltoborder" && method !== "replace" && method !== "point" && method !== "reset") || !Number.isFinite(x) || !Number.isFinite(y)) throw new Error(`${cmd} drawing requires finite coordinates and the floodfill, filltoborder, replace, point or reset method`);
            if (svgElements.length > 0) {
                yield { kind: "svg", svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${img.width}" height="${img.height}"${state.antialias === false ? ' shape-rendering="crispEdges"' : ""}>${svgElements.join("")}</svg>` };
                svgElements.length = 0;
            }
            // Native draw coordinates select the lower pixel at exact half ties.
            const seedX = Math.ceil(x - 0.5), seedY = Math.ceil(y - 0.5);
            if (method !== "reset" && (seedX < 0 || seedY < 0 || seedX >= img.width || seedY >= img.height)) throw new Error(`${cmd} ${method} seed is outside the image`);
            yield { kind: method === "reset" ? "reset" : method === "replace" ? "replace" : method === "point" ? "paint-point" : "floodfill", x: seedX, y: seedY, color: fillColor, alphaOnly: cmd === "alpha", fillToBorder: method === "filltoborder" };
        }
        else if (cmd === "rectangle") {
            const x0 = num();
            const y0 = num();
            // Native drawing collapses a NaN endpoint onto the starting coordinate.
            const x1 = ["nan", "+nan", "-nan"].includes(tokens[i]?.toLowerCase() ?? "") ? (i++, x0) : num();
            const y1 = ["nan", "+nan", "-nan"].includes(tokens[i]?.toLowerCase() ?? "") ? (i++, y0) : num();
            const rx = Math.min(x0, x1);
            const ry = Math.min(y0, y1);
            const rw = Math.max(1, Math.abs(x1 - x0) + 1);
            const rh = Math.max(1, Math.abs(y1 - y0) + 1);
            if (fill !== "none" && (strokeColor.a === 0 || strokeWidth <= 0) && svgElements.length === 0 && !transformed) {
                yield { kind: "shape", shape: "rectangle", tile, color: fillColor, x: rx, y: ry, width: rw, height: rh };
            } else {
                if (fill !== "none") {
                    svgElements.push(`<rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" fill="${paintFill}"/>`);
                }
                if (stroke !== "none" && strokeWidth > 0) {
                    svgElements.push(`<polygon points="${rx},${ry} ${rx + rw - 1},${ry} ${rx + rw - 1},${ry + rh - 1} ${rx},${ry + rh - 1}" fill="none" stroke="${paintStroke}" stroke-width="${strokeWidth}"/>`);
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
                svgElements.push(`<rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" rx="${wc}" ry="${hc}" fill="${paintFill}"/>`);
            }
            if (stroke !== "none" && strokeWidth > 0) {
                svgElements.push(`<polygon points="${rx},${ry} ${rx + rw - 1},${ry} ${rx + rw - 1},${ry + rh - 1} ${rx},${ry + rh - 1}" fill="none" stroke="${paintStroke}" stroke-width="${strokeWidth}"/>`);
            }
        }
        else if (cmd === "circle") {
            const cx = num();
            const cy = num();
            const px = num();
            const py = num();
            const r = Math.max(1, Math.hypot(px - cx, py - cy));
            if (fill !== "none" && (strokeColor.a === 0 || strokeWidth <= 0) && svgElements.length === 0 && !transformed) {
                yield { kind: "shape", shape: "circle", tile, color: fillColor, x: cx, y: cy, radius: r, antialias: state.antialias !== false };
            } else {
                svgElements.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${paintFill}" stroke="${paintStroke}" stroke-width="${strokeWidth}"/>`);
            }
        }
        else if (cmd === "ellipse") {
            const cx = num();
            const cy = num();
            const rx = num();
            const ry = num();
            num();
            num();
            svgElements.push(`<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${paintFill}" stroke="${paintStroke}" stroke-width="${strokeWidth}"/>`);
        }
        else if (cmd === "line") {
            const x0 = num();
            const y0 = num();
            const x1 = num();
            const y1 = num();
            const lineStroke = stroke === "none" ? paintFill : paintStroke;
            if (!transformed && svgElements.length === 0) {
                yield { kind: "shape", shape: "line", tile: false, color: stroke === "none" ? fillColor : strokeColor, fill: stroke === "none" ? { ...fillColor, a: 0 } : fillColor, x: x0, y: y0, x1, y1, width: Math.max(1, strokeWidth), antialias: state.antialias !== false };
            } else {
                svgElements.push(`<line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" stroke="${lineStroke}" stroke-width="${Math.max(1, strokeWidth)}"/>`);
            }
        }
        else if (cmd === "point") {
            const px = num(), py = num();
            const x = affine[0] * px + affine[2] * py + affine[4], y = affine[1] * px + affine[3] * py + affine[5];
            if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("Drawing requires finite point coordinates");
            if (fillOpacity !== undefined && !transformed && svgElements.length === 0) yield { kind: "shape", shape: "rectangle", tile: false, color: fillColor, x, y, width: 1, height: 1 };
            else svgElements.push(`<rect x="${x}" y="${y}" width="1" height="1" fill="${paintFill}"/>`);
        }
        else if (cmd === "text") {
            const x = num();
            const y = num();
            const txt = tokens[i++] ?? "";
            svgElements.push(`<text x="${x}" y="${y}" font-size="${state.pointsize}" fill="${paintFill}">${escapeXml(txt)}</text>`);
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
            if (pts.length < (cmd === "polygon" ? 3 : 1)) throw new Error(`${cmd} drawing has too few points`);
            if (cmd === "polygon") {
                svgElements.push(`<polygon data-magick-fill="1" points="${pts.join(" ")}" fill="${paintFill}" stroke="${paintStroke}" stroke-width="${strokeWidth}"/>`);
            }
            else {
                const lineStroke = stroke === "none" ? paintFill : paintStroke;
                svgElements.push(`<polyline points="${pts.join(" ")}" fill="none" stroke="${lineStroke}" stroke-width="${Math.max(1, strokeWidth)}"/>`);
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
            if (pts.length < 3) throw new Error("bezier drawing has too few points");
            if (pts.length === 3) {
                svgElements.push(`<path d="M ${pts[0]!.x} ${pts[0]!.y} Q ${pts[1]!.x} ${pts[1]!.y} ${pts[2]!.x} ${pts[2]!.y}" fill="${paintFill}" stroke="${paintStroke}" stroke-width="${strokeWidth}"/>`);
            }
            else if (pts.length >= 4) {
                const rest = pts.slice(1).map((p) => `${p.x} ${p.y}`).join(" ");
                svgElements.push(`<path d="M ${pts[0]!.x} ${pts[0]!.y} C ${rest}" fill="${paintFill}" stroke="${paintStroke}" stroke-width="${strokeWidth}"/>`);
            }
        }
        else if (cmd === "path") {
            const d = tokens[i++] ?? "";
            svgElements.push(`<path data-magick-fill="1" d="${escapeXml(d)}" fill="${paintFill}" stroke="${paintStroke}" stroke-width="${strokeWidth}"/>`);
        }
        else {
            throw new Error(`Unsupported drawing primitive: ${cmd}`);
        }
        if (transformed && cmd !== "point" && svgElements.length > elementStart) {
            const elements = svgElements.splice(elementStart);
            svgElements.push(`<g transform="matrix(${affine.join(" ")})">${elements.join("")}</g>`);
        }
    }
    if (svgElements.length > 0) yield { kind: "svg", svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${img.width}" height="${img.height}"${state.antialias === false ? ' shape-rendering="crispEdges"' : ""}>${svgElements.join("")}</svg>` };
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
    const offset = gravityAdjustBox(img.width, img.height, estW, estH, g.x, g.y, state.gravity);
    const x = Math.max(0, offset.x);
    const y = Math.max(fontSize, offset.y + estH);
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

// Scan bounded pixel chunks into edge profiles, shared by buffered and stored execution.
function* smushLayoutSteps(images: Pick<RgbaImage, "width" | "height" | "hasAlpha">[], vertical: boolean, gap: number, gravity: GravityPosition, method: VirtualPixelMethod | undefined, background: RgbaColor): Generator<{ index: number; position: number; length: number }, { width: number; height: number; virtualCanvas: NonNullable<RgbaImage["virtualCanvas"]>; offsets: { left: number; top: number }[] }, Uint8Array | Uint16Array> {
    const cross = Math.max(...images.map(image => vertical ? image.width : image.height));
    const offsets: { left: number; top: number }[] = [];
    const edgeGap = (profile: Float64Array, line: number, empty: number): number => {
        const pixel = virtualPixelIndex(vertical ? line : 0, vertical ? 0 : line, vertical ? profile.length : 1, vertical ? 1 : profile.length, method ?? "edge");
        if (pixel >= 0) return profile[pixel]!;
        const transparent = method === "transparent" || (method === "background" || method?.endsWith("-tile") === true) && background.a === 0;
        return transparent ? empty : 0;
    };
    let cursor = 0, previous: { trailing: Float64Array; offset: number; empty: number } | undefined;
    for (let index = 0; index < images.length; index++) {
        const image = images[index]!, length = vertical ? image.height : image.width, breadth = vertical ? image.width : image.height;
        const alignment = resolveGravityOffset(vertical ? cross - breadth : 0, vertical ? 0 : cross - breadth, gravity);
        const offset = vertical ? alignment.left : alignment.top;
        const leading = new Float64Array(breadth).fill(length), trailing = new Float64Array(breadth).fill(length - 1);
        if (image.hasAlpha) {
            for (let start = 0; start < image.width * image.height; start += 4096) {
                const bytes = yield { index, position: start * 4, length: Math.min(4096, image.width * image.height - start) * 4 };
                for (let pixel = 0; pixel < bytes.length / 4; pixel++) {
                    if (bytes[pixel * 4 + 3] === 0) continue;
                    const x = (start + pixel) % image.width, y = Math.floor((start + pixel) / image.width);
                    const line = vertical ? x : y, along = vertical ? y : x;
                    leading[line] = Math.min(leading[line]!, along);
                    trailing[line] = Math.min(trailing[line]!, length - along - 1);
                }
            }
        } else { leading.fill(0); trailing.fill(0); }
        if (previous) {
            let trim = length;
            for (let line = 0; line < cross; line++) {
                const before = edgeGap(previous.trailing, line - previous.offset, previous.empty);
                const after = edgeGap(leading, line - offset, image.hasAlpha ? length : 0);
                trim = Math.min(trim, before + after);
            }
            cursor += gap - trim;
        }
        offsets.push({ left: vertical ? offset : cursor, top: vertical ? cursor : offset });
        cursor += length;
        previous = { trailing, offset, empty: image.hasAlpha ? length - 1 : 0 };
    }
    const extent = images.reduce((sum, image) => sum + (vertical ? image.height : image.width), 0) + gap * (images.length - 1);
    return { width: vertical ? cross : cursor, height: vertical ? cursor : cross,
        virtualCanvas: { width: vertical ? cross : extent, height: vertical ? extent : cross, x: 0, y: 0 }, offsets };
}

function* smushCompositePixelSteps(canvas: Pick<RgbaImage, "width" | "height">, frame: Pick<RgbaImage, "width" | "height">, left: number, top: number, highDepth: boolean): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const quantum = highDepth ? 65535 : 255;
    for (let y = 0; y < canvas.height; y++) {
        for (let x = 0; x < canvas.width; x += 4096) {
            yield;
            const count = Math.min(4096, canvas.width - x), position = (y * canvas.width + x) * 4;
            const bytes = (yield { kind: "read", position, length: count * 4, highDepth })!;
            const output = highDepth ? new Uint16Array(bytes.slice().buffer) : bytes.slice();
            const start = Math.max(x, left), end = Math.min(x + count, left + frame.width);
            if (y >= top && y < top + frame.height && start < end) {
                const input = (yield { kind: "read", image: 1, position: ((y - top) * frame.width + start - left) * 4, length: (end - start) * 4, highDepth })!;
                const samples = highDepth ? new Uint16Array(input.slice().buffer) : input;
                for (let pixel = start; pixel < end; pixel++) {
                    const src = (pixel - start) * 4, dst = (pixel - x) * 4;
                    const sa = samples[src + 3]! / quantum, da = output[dst + 3]! / quantum * (1 - sa), alpha = sa + da;
                    if (sa === 0) continue;
                    for (let channel = 0; channel < 3; channel++) output[dst + channel] = Math.round((samples[src + channel]! * sa + output[dst + channel]! * da) / alpha);
                    output[dst + 3] = Math.round(alpha * quantum);
                }
            }
            yield { kind: "write", position, data: new Uint8Array(output.buffer, output.byteOffset, output.byteLength), highDepth };
        }
    }
}

function smushGap(value: string | undefined): number {
    if (value === undefined || [...value].some(c => c.trim() !== "" && !"0123456789eExX!#%()+,-./:<>@\\^".includes(c))) {
        throw new Error("Invalid smush geometry");
    }
    const gap = Number.parseInt(value, 10);
    if (!Number.isSafeInteger(gap)) throw new Error("Invalid smush geometry");
    return gap;
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
    const background = state.backgroundExplicit ? state.background : stack[0]!.backgroundColor ?? state.background;
    const canvas = (yield* createSolidRgbaImageSteps(totalW, totalH, background, stack.some(im => !!im.data16)));
    let hasAlpha = background.a < 255;
    let cursor = 0;
    const mixedCmyk = stack.some(image => image.space === "cmyk") && stack.some(image => image.space !== "cmyk");
    for (let im of stack) {
        if (mixedCmyk && im.space === "cmyk") im = yield* copyCmykChannelsToRgb(im);
        if (++work % 16384 === 0)
            yield;
        const off = resolveGravityOffset(vertical ? totalW - im.width : 0, vertical ? 0 : totalH - im.height, state.gravity);
        const left = vertical ? off.left : cursor, top = vertical ? cursor : off.top;
        for (let y = 0; y < im.height; y++) {
            for (let x = 0; x < im.width; x += 4096) {
                yield;
                const start = (y * im.width + x) * 4;
                canvas.data.set(im.data.subarray(start, start + Math.min(4096, im.width - x) * 4), ((top + y) * totalW + left + x) * 4);
                if (canvas.data16) canvas.data16.set(im.data16?.subarray(start, start + Math.min(4096, im.width - x) * 4) ?? Uint16Array.from(im.data.subarray(start, start + Math.min(4096, im.width - x) * 4), value => value * 257), ((top + y) * totalW + left + x) * 4);
            }
        }
        hasAlpha ||= im.hasAlpha;
        cursor += vertical ? im.height : im.width;
    }
    const first = stack[0]! as MagickImage;
    return { ...canvas, channels: hasAlpha ? 4 : 3, delay: [first.delay?.[first[magickInput]?.sceneIdx ?? 0] ?? 0], ...(first.disposal !== undefined ? { disposal: first.disposal } : {}), ...(first.icc ? { icc: first.icc } : {}), hasAlpha, ...(first.properties ? { properties: first.properties } : {}), density: first.density, ...(first.resolution ? { resolution: first.resolution } : {}), virtualCanvas: first.virtualCanvas ?? { width: first.width, height: first.height, x: 0, y: 0 } };
}

function expandFilenameProperties(spec: string, properties: ImageMetadata["properties"]): string {
    let output = "";
    for (let i = 0; i < spec.length;) {
        if (spec.startsWith("%%", i)) {
            output += "%%";
            i += 2;
            continue;
        }
        if (spec.startsWith("%[", i)) {
            const end = spec.indexOf("]", i + 2);
            if (end >= 0) {
                const key = spec.slice(i + 2, end).toLowerCase();
                output += (key.startsWith("filename:") ? properties?.[key] : undefined) ?? spec.slice(i + 1, end + 1);
                i = end + 1;
                continue;
            }
        }
        output += spec[i++];
    }
    return output;
}

function pngOutputColorType(value: string | undefined, format: ImageFormat, analysis: { warnings: string }): 0 | 2 | 3 | 4 | 6 | undefined {
    if (format !== "png" || value === undefined) return undefined;
    const color = Number(value);
    if (value.trim() !== "" && (color === 0 || color === 2 || color === 3 || color === 4 || color === 6)) return color;
    analysis.warnings += `magick: ignoring invalid defined png:color-type =${value}\n`;
    return undefined;
}

function inferOutputFormat(spec: string, fallback: ImageFormat = "png"): { format: ImageFormat; path: string; tiffBig?: boolean; gifVersion?: "87a"; bmpFormat?: "bmp2" | "bmp3"; pngCoder?: "png00" | "png8" | "png24" | "png32" | "png48" | "png64" } {
  const prefixMatch = /^([a-zA-Z0-9]+):(.*)$/.exec(spec);
  if (prefixMatch) {
    const prefix = prefixMatch[1]!.toLowerCase();
    const rest = prefixMatch[2]!;
    const fmt = prefix === "tiff64" ? "tiff" : extToImageFormat(prefix);
    if (fmt) {
      return { format: fmt, path: rest, ...(prefix === "tiff64" ? { tiffBig: true } : {}), ...(prefix === "gif87" ? { gifVersion: "87a" as const } : {}), ...(prefix === "bmp2" || prefix === "bmp3" ? { bmpFormat: prefix } : {}), ...(["png00", "png8", "png24", "png32", "png48", "png64"].includes(prefix) ? { pngCoder: prefix as "png00" | "png8" | "png24" | "png32" | "png48" | "png64" } : {}) };
    }
  }
  const dotIdx = spec.lastIndexOf(".");
  if (dotIdx >= 0) {
    const ext = spec.slice(dotIdx + 1).toLowerCase();
    const fmt = extToImageFormat(ext);
    if (fmt) return { ...inferOutputFormat(`${ext}:${spec}`, fallback), path: spec };
  }
  return { format: fallback, path: spec };
}

function extToImageFormat(ext: string): ImageFormat | undefined {
  const rawCoder = ext.toLowerCase();
  if (isRawCoder(rawCoder)) return rawCoder;
  switch (ext.toLowerCase()) {
    case "qoi":
      return "qoi";
    case "xbm":
      return "xbm";
    case "xpm":
      return "xpm";
    case "tga":
      return "tga";
    case "txt":
      return "txt";
    case "ico":
    case "cur":
      return "ico";
    case "mng":
      return "mng";
    case "apng":
      return "apng";
    case "miff":
      return "miff";
    case "png":
    case "png24":
    case "png8":
    case "png32":
    case "png48":
    case "png64":
    case "png00":
      return "png";
    case "jpg":
    case "jpeg":
      return "jpeg";
    case "webp":
      return "webp";
    case "gif87":
    case "gif":
      return "gif";
    case "bmp2":
    case "bmp3":
    case "bmp":
      return "bmp";
    case "tif":
    case "tiff":
      return "tiff";
    case "pam":
      return "pam";
    case "phm":
      return "phm";
    case "hdr":
      return "hdr";
    case "exr":
      return "exr";
    case "pfm":
      return "pfm";
    case "pnm":
      return "pnm";
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

function* applyInlineReadModifierSteps(img: RgbaImage, inlineGeom: string, kernel: ResizeKernel | undefined, settings?: ResizeFilterSettings): Generator<void, RgbaImage, void> {
    const g = parseMagickGeometry(inlineGeom);
    if (g.hasOffset) {
        return (yield* applyMagickCropSteps(img, inlineGeom, "northwest"));
    }
    return (yield* applyMagickResizeSteps(img, inlineGeom, kernel, false, false, false, settings));
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
        "-region", "-floodfill", "+floodfill", "-repage", "+repage", "-distort"
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
        // Unknown suffixes belong to the filename, not to read geometry.
        if ([...bracketMatch[2]!].some(char => char.trim() !== "" && !"0123456789eExX!#%()+,-./:<>@\\^".includes(char))) {
            return { baseToken };
        }
        baseToken = bracketMatch[1]!;
        let inside = bracketMatch[2]!;
        if ([...inside].every(char => "0123456789-, ".includes(char))) {
            // Spaces may surround indices and separators, but cannot join digits.
            let normalized = "", spaced = false;
            for (const char of inside) {
                if (char === " ") { spaced = true; continue; }
                if (spaced && "0123456789".includes(char) && normalized.length > 0 && "0123456789".includes(normalized.at(-1)!)) {
                    throw new Error(`invalid image index '${inside}'`);
                }
                normalized += char;
                spaced = false;
            }
            inside = normalized;
        }
        if (inside.includes(",") && !inside.startsWith(",") && [...inside].every(char => "0123456789-,".includes(char))) {
            // Native skips middle empty entries, but a trailing comma selects frame zero.
            const entries = inside.split(",");
            if (entries.at(-1) === "") entries[entries.length - 1] = "0";
            inside = entries.filter(entry => entry !== "").join(",");
        }
        if (/^-?\d+$/.test(inside) || /^-?\d+--?\d+$/.test(inside) || /^-?\d+(,-?\d+)+$/.test(inside)) {
            pageSpec = inside;
        }
        else {
            const geometry = parseMagickGeometry(inside);
            // A read offset alone does not request a crop of the remaining canvas.
            if (!geometry.hasOffset || geometry.width !== undefined || geometry.height !== undefined) inlineGeom = inside;
        }
    }
 return {baseToken,...(pageSpec===undefined?{}:{pageSpec}),...(inlineGeom===undefined?{}:{inlineGeom})};
}

function haldInputMetadata(token: string): Omit<RgbaImage, "data"> {
    const parsed = Number.parseInt(token.slice(5), 10);
    const level = Number.isNaN(parsed) || parsed < 2 ? 8 : parsed;
    const width = level ** 3;
    if (!Number.isSafeInteger(width * width * 8) || width * width * 8 > 0x7fffffff) throw new Error("Hald image dimensions exceed resource limits");
    return { width, height: width, format: "png", channels: 3, depth: 255 % (level * level - 1) === 0 ? "uchar" : "ushort", space: "srgb", density: 72, hasAlpha: false };
}

function* haldInputPixelSteps(width: number): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const side = Math.round(Math.cbrt(width)) ** 2;
    const highDepth = 255 % (side - 1) !== 0, quantum = highDepth ? 65535 : 255;
    for (let start = 0; start < width * width; start += 4096) {
        yield;
        const count = Math.min(4096, width * width - start) * 4;
        const samples = highDepth ? new Uint16Array(count) : new Uint8Array(count);
        for (let offset = 0; offset < samples.length; offset += 4) {
            const pixel = start + offset / 4;
            samples[offset] = Math.round((pixel % side) * quantum / (side - 1));
            samples[offset + 1] = Math.round((Math.floor(pixel / side) % side) * quantum / (side - 1));
            samples[offset + 2] = Math.round(Math.floor(pixel / (side * side)) * quantum / (side - 1));
            samples[offset + 3] = quantum;
        }
        yield { kind: "write", position: start * 4, highDepth, data: new Uint8Array(samples.buffer) };
    }
}

function* selectedInputPages(pageSpec: string | undefined, totalPages: number): Generator<number> {
    if (pageSpec === undefined) {
        for (let page = 0; page < totalPages; page++) yield page;
        return;
    }
    for (const [first, last] of parseMagickIndices(pageSpec)) {
        const start = first! < 0 ? totalPages + first! : first!;
        if (start < 0 || start >= totalPages) throw new Error(`invalid image index ${first}`);
        const end = last === undefined ? start : Math.max(0, Math.min(totalPages - 1, last < 0 ? totalPages + last : last));
        const step = start <= end ? 1 : -1;
        for (let page = start;; page += step) {
            yield page;
            if (page === end) break;
        }
    }
}

function* parseInputOperandsSteps(token: string, files: Map<string, Uint8Array>, state: MagickState, stdinBytes?: Uint8Array, maxDecodeDimension?: number): Generator<void, RgbaImage[] | undefined, void> {
    let work = 0;
    const {baseToken,pageSpec,inlineGeom}=parseInputToken(token);
    function* applyMod(imgs: RgbaImage[]): Generator<void, RgbaImage[], void> {
        return yield* mapSteps(imgs, function* (im) {
            if (state.page !== undefined) im = { ...im, virtualCanvas: state.page };
            if (state.orientation !== undefined) im = { ...im, orientation: state.orientation };
            if (state.units !== undefined) im = applyMagickUnits(im, state.units);
            for (const key of ["comment", "label"] as const) {
                const value = state[key];
                if (value !== undefined) {
                    const expanded = yield* formatMagickPropertyStringSteps(value, im, () => im, { filePath: baseToken });
                    im = { ...im, properties: { ...im.properties, [key]: expanded } };
                }
            }
            if (state.disposal !== undefined) im = { ...im, disposal: state.disposal };
            if (state.delay !== undefined) {
                const delay = state.delay;
                im = { ...im, delay: (im.delay ?? [0]).map(current => parseDelay(delay, current)) };
            }
            return inlineGeom ? yield* applyInlineReadModifierSteps(im, inlineGeom, state.kernel, state.resizeFilter) : im;
        });
    }
    const lower = baseToken.toLowerCase();
    if (lower.startsWith("tile:")) {
        if (!state.hasSize) throw new Error("must specify image size for TILE input");
        const patterns = (yield* parseInputOperandsSteps(baseToken.slice(5), files, state, stdinBytes));
        if (!patterns)
            return undefined;
        return yield* applyMod((yield* mapSteps(patterns, function* (pattern) {
            const tiled = (yield* createSolidRgbaImageSteps(state.sizeWidth, state.sizeHeight, { r: 0, g: 0, b: 0, a: 0 }));
            const { x: offsetX, y: offsetY } = state.tileOffset ?? { x: 0, y: 0 };
            for (let y = 0; y < tiled.height; y++) {
                for (let x = 0; x < tiled.width; x++) {
                    const sx = x - offsetX, sy = y - offsetY;
                    if (sx < 0 || sy < 0 || sx >= tiled.width || sy >= tiled.height) continue;
                    const source = ((sy % pattern.height) * pattern.width + sx % pattern.width) * 4;
                    tiled.data.set(pattern.data.subarray(source, source + 4), (y * tiled.width + x) * 4);
                }
            }
            return { ...tiled, hasAlpha: pattern.hasAlpha || offsetX !== 0 || offsetY !== 0 };
        })));
    }
    if (lower.startsWith("hald:")) {
        const metadata = haldInputMetadata(baseToken);
        return yield* applyMod([yield* applyMagickRasterSteps({ ...metadata, data: new Uint8Array() }, haldInputPixelSteps(metadata.width))]);
    }
    if (lower.startsWith("xc:") || lower.startsWith("canvas:")) {
        const colorStr = baseToken.slice(baseToken.indexOf(":") + 1) || "white";
        const c = parseColor(colorStr);
        return yield* applyMod([{ ...(yield* createSolidRgbaImageSteps(state.sizeWidth, state.sizeHeight, c)), hasAlpha: c.a < 255 }]);
    }
    if (lower.startsWith("gradient:") || lower.startsWith("radial-gradient:")) {
        const radial = lower.startsWith("radial-gradient:");
        const spec = baseToken.slice(baseToken.indexOf(":") + 1);
        const [c1Str, c2Str] = spec ? spec.split("-") : [];
        const c1 = parseColor(c1Str || "#ffffff");
        const c2 = parseColor(c2Str || "#000000");
        return yield* applyMod([(yield* createGradientImageSteps(state.sizeWidth, state.sizeHeight, c1, c2, radial, state.gradientDirection, state.gradientAngle, state.gradientVector, state.gradientBoundingBox, state.gradientCenter, state.gradientRadii, state.gradientExtent))]);
    }
    if (lower.startsWith("plasma:")) {
        const spec = baseToken.slice(7), fractal = spec.toLowerCase() === "fractal";
        const [first, last] = fractal ? [] : spec.split("-");
        const metadata = { width: state.sizeWidth, height: state.sizeHeight, format: "png" as const, channels: 3 as const, depth: "ushort" as const, space: "srgb" as const, density: 72, hasAlpha: false };
        return yield* applyMod([yield* applyMagickRasterSteps({ ...metadata, data: new Uint8Array() }, plasmaPixelSteps(metadata.width, metadata.height, parseColor(first || (fractal ? "#808080" : "white")), parseColor(last || "black"), fractal, state.seed ?? 0))]);
    }
    if (lower.startsWith("pattern:")) {
        const pattern = builtinPattern(baseToken.slice(8));
        return yield* applyMod([(yield* createPatternImageSteps(state.hasSize ? state.sizeWidth : pattern.width, state.hasSize ? state.sizeHeight : pattern.height, pattern))]);
    }
    if (lower === "rose:" || lower === "logo:" || lower === "wizard:" || lower === "granite:") {
        return yield* applyMod([(yield* createRoseImageSteps())]);
    }
    if (lower.startsWith("label:") || lower.startsWith("caption:")) {
        const text = baseToken.slice(baseToken.indexOf(":") + 1);
        return yield* applyMod([decodeImage(new TextEncoder().encode(createLabelSvg(text, state)), { density: state.density })]);
    }
    if (lower === "null:") {
        return yield* applyMod([Object.assign(yield* createSolidRgbaImageSteps(1, 1, { r: 0, g: 0, b: 0, a: 0 }), { [magickInput]: { filePath: "null:" } })]);
    }
    if (lower.startsWith("apng:")) {
        const path = baseToken.slice(5), bytes = path === "-" ? stdinBytes : files.get(path);
        if (!bytes) return undefined;
        const frames = yield* decodeApngSteps(bytes), selected: RgbaImage[] = [];
        for (const page of selectedInputPages(pageSpec, frames.length)) {
            const frame = frames[page]!;
            selected.push(Object.assign(frame, { [magickInput]: { filePath: path, byteLen: bytes.length, originalWidth: frame.width, originalHeight: frame.height, sceneIdx: page } }));
        }
        return yield* applyMod(selected);
    }
    const rgb = lower.startsWith("rgb:"), ftxt = lower.startsWith("ftxt:");
    let cleanToken = ftxt ? baseToken.slice(5) : rgb ? baseToken.slice(4) : baseToken;
    const prefixMatch = /^([a-zA-Z0-9]+):(.*)$/.exec(cleanToken);
    if (prefixMatch && extToImageFormat(prefixMatch[1]!)) {
        cleanToken = prefixMatch[2]!;
    }
    let rawBytes = cleanToken === "-" ? stdinBytes : files.get(cleanToken) ?? files.get(token);
    if (!rawBytes)
        return undefined;
    if (ftxt) {
        if (!state.hasSize) throw new Error("must specify image size for FTXT input");
        const steps = ftxtInput(state.sizeWidth, state.sizeHeight, rawBytes.length);
        let next = steps.next(), offset = 0;
        let bytes: Uint8Array | undefined;
        while (!next.done) {
            yield;
            if (next.value instanceof Uint8Array) {
                bytes ??= new Uint8Array(next.value.length + state.sizeWidth * state.sizeHeight * 6);
                bytes.set(next.value, offset); offset += next.value.length;
                next = steps.next(new Uint8Array());
            } else next = steps.next(rawBytes.subarray(next.value.position, next.value.position + next.value.length));
        }
        rawBytes = bytes!;
    }
    if (rgb) {
        if (!state.hasSize) throw new Error("must specify image size for RGB input");
        const raw = rawRgbInput(state.sizeWidth, state.sizeHeight, state.inputDepth ?? 16, state.inputEndian ?? "lsb", rawBytes.length);
        const bytes = new Uint8Array(raw.size);
        for (let position = 0; position < raw.size; position += 8192) {
            yield;
            const steps = raw.read(position, Math.min(8192, raw.size - position));
            let next = steps.next();
            while (!next.done) next = steps.next(rawBytes.subarray(next.value.position, next.value.position + next.value.length));
            bytes.set(next.value, position);
        }
        rawBytes = bytes;
    }
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
            coalesce: false,
            density: state.density,
            ...(effectiveMaxDecodeDim !== undefined ? { maxDecodeDimension: effectiveMaxDecodeDim } : {}),
            ...(totalPages > 1 || pageSpec !== undefined ? { page: pageIdx } : {})
        });
        const source: MagickFormatContext = {
            filePath: cleanToken, byteLen: rawBytes.byteLength,
            originalWidth: inputMeta?.width ?? img.width, originalHeight: inputMeta?.height ?? img.height, sceneIdx: pageIdx
        };
        img = Object.assign(img, { [magickInput]: source });
        results.push(img);
    }
    return yield* applyMod(results);
}

function tryHandleMagickListOption(argv: readonly string[]): ImageMagickCliResult | undefined {
    const endIdx = argv.indexOf("--");
    const limit = endIdx < 0 ? argv.length : endIdx;
    for (let i = 0; i < limit; i++) {
        const arg = argv[i]!;
        if (arg === "-list" || arg === "--list") {
            const listType = (argv[i + 1] ?? "list").toLowerCase();
            if (listType === "channel" || listType === "metric") {
                return {
                    exitCode: 0,
                    stdout: (listType === "metric"
                        ? ["AE", "DPC", "DSSIM", "Fuzz", "MAE", "MEPP", "MSE", "NCC", "PAE", "PDC", "PHASE", "PHASH", "PSNR", "RMSE", "SSIM"]
                        : ["All", "Sync", "Default", "A", "Alpha", "Black", "B", "Blue", "C", "Chroma", "Cyan", "Gray", "G", "Green", "H", "Hue", "K", "L", "Lightness", "Luminance", "M", "Magenta", "Meta",
                            ...Array.from({ length: 22 }, (_, index) => `Meta${index}`),
                            "R", "ReadMask", "Red", "S", "Saturation", "WriteMask", "Y", "Yellow",
                            ...Array.from({ length: 32 }, (_, index) => String(index))]).join("\n") + "\n",
                    stderr: ""
                };
            }
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
    let moments = false;
    let convexHull = false;
    let customFormat: string | undefined;
    let precision = 6;
    let locateMaximum = false;
    let locateLimit = 0;
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
        else if (a === "-define" || a === "+define") {
            const value = argv[++i];
            if (value === undefined) return { exitCode: 1, stdout: "", stderr: `identify: missing an argument for option '${a}'\n` };
            const equals = value.indexOf("="), key = equals < 0 ? value : value.slice(0, equals);
            const setting = equals < 0 ? "" : value.slice(equals + 1);
            if (key === "identify:locate") locateMaximum = a === "-define" && setting.toLowerCase() === "maximum";
            if (key === "identify:limit") locateLimit = a === "+define" ? 0 : Math.max(0, Math.trunc(Number(setting)) || 0);
            if (key === "identify:convex-hull") convexHull = a === "-define" && (equals < 0 || ["true", "1", "yes", "on"].includes(value.slice(equals + 1).toLowerCase()));
        }
        else if (a === "-moments" || a === "+moments") { moments = a === "-moments"; }
        else if (a === "-ping" || a === "--ping") {
            // Metadata-first reading
        }
        else if (a === "-format" || a === "--format") {
            customFormat = argv[++i] ?? "";
        }
        else if (a === "-precision") {
            const value = argv[++i];
            if (value === undefined) return { exitCode: 1, stdout: "", stderr: "identify: missing an argument for option '-precision'\n" };
            const requested = Number(value);
            if (!value.trim() || !Number.isFinite(requested)) return { exitCode: 1, stdout: "", stderr: "identify: invalid argument for option '-precision'\n" };
            precision = requested < 1 ? 6 : Math.min(100, Math.trunc(requested));
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
    for (let targetIndex = 0; targetIndex < targets.length; targetIndex++) {
        let inPath = targets[targetIndex]!;
        yield;
        const bracketMatch = /^(.*)\[(\d+)\]$/.exec(inPath);
        let baseInPath = bracketMatch ? bracketMatch[1]! : inPath;
        const colon = baseInPath.indexOf(":");
        if (colon > 0 && extToImageFormat(baseInPath.slice(0, colon))) {
            baseInPath = baseInPath.slice(colon + 1);
        }
        const pageIdx = bracketMatch ? parseInt(bracketMatch[2]!, 10) : undefined;
        const analysis = { warnings: "" };
        let inspected:IdentifyInspection|undefined;
        if(reader)yield {async run(){inspected=await reader(baseInPath,pageIdx,verbose,customFormat===undefined?(locateMaximum ? async (_metadata,_size,pixels)=>identifyStoredMaximum(await pixels(),locateLimit,precision,signal) : undefined):(metadata,size,pixels)=>formatRetainedIdentify(customFormat!,metadata,{filePath:baseInPath,byteLen:size,sceneIdx:pageIdx??0,precision,analysis},pixels,signal),convexHull && verbose && customFormat === undefined ? precision : undefined,moments && verbose && customFormat === undefined ? precision : undefined,precision);}};
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
            if (pageIdx === undefined && meta.format === "tiff" && (meta.pages ?? 1) > 1) {
                for (let page = 1; page < meta.pages!; page++) {
                    yield;
                    targets.splice(targetIndex + page, 0, `${baseInPath}[${page}]`);
                }
                inPath = `${baseInPath}[0]`;
            }
            const encoded=inspected?.bytes??bytes;
            const bitDepth = meta.depth === "ushort" ? "16" : meta.depth === "bit" ? "1" : "8";
            const spaceLabel = meta.space === "b-w" ? "Gray" : meta.space === "cmyk" ? "CMYK" : "sRGB";
            if (customFormat !== undefined) {
                outParts.push(inspected?.formatted??(yield* formatMagickPropertyStringSteps(customFormat, meta, () => decodeImage(encoded!, inputOptions), {
                    filePath: baseInPath, byteLen: size, sceneIdx: pageIdx ?? 0, precision, analysis
                })));
            }
            else if (locateMaximum) {
                if (inspected?.formatted !== undefined) outParts.push(inspected.formatted);
                else {
                    const image = decodeImage(encoded!, inputOptions), steps = identifyMaximumSteps(image, locateLimit, precision);
                    let next = steps.next();
                    while (!next.done) {
                        if (!next.value) { yield; next = steps.next(); }
                        else {
                            const { position, length } = next.value;
                            next = steps.next((image.data16 ?? image.data).subarray(position, position + length));
                        }
                    }
                    outParts.push(next.value);
                }
            }
            else if (verbose) {
                const stats = inspected?.stats??(yield* computeImageStatsSteps(decodeImage(encoded!, inputOptions)));
                const histogram = inspected?.histogram ?? (yield* formatHistogramOutputSteps(decodeImage(encoded!, inputOptions)));
                const colors = histogram.trim() ? histogram.trimEnd().split("\n").length : 0;
                outParts.push(`Image: ${inPath}\n` +
                    `  Format: ${meta.format.toUpperCase()}\n` +
                    `  Geometry: ${meta.width}x${meta.height}+0+0\n` +
                    `  Resolution: ${meta.density}x${meta.density}\n` +
                    `  Colorspace: ${spaceLabel}\n` +
                    `  Depth: ${bitDepth}-bit\n` +
                    `  Channels: ${meta.channels}\n` +
                    `  Alpha: ${meta.hasAlpha ? "True" : "False"}\n` +
                    `  Filesize: ${size}B\n` +
                    `  Entropy: ${stats.entropy.toFixed(4)}\n` +
                    `  Colors: ${colors}\n  Histogram:\n${histogram}`);
                if (inspected?.statistics !== undefined) outParts.push(inspected.statistics);
                else {
                    const image = decodeImage(encoded!, inputOptions), steps = identifyStatisticsSteps(image, precision);
                    let next = steps.next();
                    while (!next.done) {
                        yield;
                        next = next.value ? steps.next((image.data16 ?? image.data).subarray(next.value.position, next.value.position + next.value.length)) : steps.next();
                    }
                    outParts.push(next.value);
                }
                if (convexHull) {
                    if (inspected?.hull !== undefined) outParts.push(inspected.hull);
                    else {
                        const image = decodeImage(encoded!, inputOptions), steps = identifyHullSteps(image, precision);
                        let next = steps.next();
                        while (!next.done) {
                            yield;
                            next = next.value ? steps.next((image.data16 ?? image.data).subarray(next.value.position, next.value.position + next.value.length)) : steps.next();
                        }
                        outParts.push(next.value);
                    }
                }
                if (moments) {
                    if (inspected?.moments !== undefined) outParts.push(inspected.moments);
                    else {
                        const image = decodeImage(encoded!, inputOptions), steps = identifyMomentsSteps(image, precision);
                        let next = steps.next();
                        while (!next.done) {
                            yield;
                            next = next.value ? steps.next((image.data16 ?? image.data).subarray(next.value.position, next.value.position + next.value.length)) : steps.next();
                        }
                        outParts.push(next.value);
                    }
                }
            }
            else {
                outParts.push(`${inPath} ${meta.format.toUpperCase()} ${meta.width}x${meta.height} ${meta.width}x${meta.height}+0+0 ${bitDepth}-bit ${spaceLabel} ${size}B 0.000u 0:00.000\n`);
            }
            if (analysis.warnings) errParts.push(analysis.warnings);
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

function parseMagickInsertPosition(spec: string): number {
    if (!spec.trim() || [...spec].some(c => c.trim() !== "" && !"0123456789eExX!#%()+,-./:<>@^".includes(c))) {
        throw new Error(`invalid argument for option '-insert': ${spec}`);
    }
    const geometry = [...spec].filter(c => c.trim() !== "" && c !== "(" && c !== ")").join("");
    const component = geometry.split(",")[0]!.split("/")[0]!;
    // Geometry modifiers set native parse flags even without a dimension.
    const hasGeometryFlag = geometry.startsWith("-") || [...geometry].some(c => "xX.!#%:<>@^".includes(c));
    if (!hasGeometryFlag && !(component && Number.isFinite(Number(component)))) {
        throw new Error(`invalid argument for option '-insert': ${spec}`);
    }
    // Native validates geometry, then reads only the leading decimal integer.
    return Number.parseInt(spec, 10) || 0;
}

function parseMagickIndices(spec: string, ranges = true): number[][] {
  if (!spec.trim() || spec.trimStart().startsWith(",")) throw new Error(`invalid argument ${spec}`);
  return Array.from(spec, c => !c.trim() || (!ranges && c === "x") ? "," : c).join("").split(",").filter(part => part.trim()).map(part => {
    const value = part.trim();
    const separator = ranges ? value.indexOf("-", 1) : -1;
    const values = separator > 0 ? [value.slice(0, separator), value.slice(separator + 1)] : [value];
    return values.map(value => {
      const digits = value.startsWith("-") || (!ranges && value.startsWith("+")) ? value.slice(1) : value;
      if (!digits.length || !Array.from(digits).every(c => c >= "0" && c <= "9") || !Number.isSafeInteger(Number(value))) {
        throw new Error(`invalid argument ${spec}`);
      }
      return Number(value);
    });
  });
}

function* parseMagickIndexSpec(spec: string, length: number, operation: "clone" | "delete"): Generator<number> {
  const parts = parseMagickIndices(spec);
  if (length <= 0) return;
  const resolve = (n: number): number =>
    n < 0 ? Math.max(0, length + n) : Math.min(Math.max(0, n), length - 1);
  for (const [num, end] of parts) {
    if (end !== undefined) {
      if (operation === "delete") {
        const s = Math.max(0, num! < 0 ? length + num! : num!);
        const e = Math.min(length - 1, end < 0 ? length + end : end);
        for (let k = s; k <= e; k++) yield k;
        continue;
      }
      if (num! >= length) throw new Error(`invalid image index ${num}`);
      const s = resolve(num!), e = resolve(end), step = s <= e ? 1 : -1;
      for (let k = s;; k += step) { yield k; if (k === e) break; }
    } else {
      const idx = num! < 0 ? length + num! : num!;
      if (idx >= 0 && idx < length) yield idx;
      else if (operation === "clone") throw new Error(`invalid image index ${num}`);
    }
  }
}

function magickIntensity(r: number, g: number, b: number, method: string, quantum: number, linear: boolean): number {
    switch (method) {
        case "average": case "mean": return (r + g + b) / 3;
        case "brightness": return Math.max(r, g, b);
        case "lightness": return (Math.min(r, g, b) + Math.max(r, g, b)) / 2;
        case "ms": return (r * r + g * g + b * b) / (3 * quantum);
        case "rms": return Math.sqrt((r * r + g * g + b * b) / 3);
    }
    const luminance = method === "rec601luminance" || method === "rec709luminance";
    if (luminance && !linear) {
        r = quantum * (r / quantum <= 0.04045 ? r / quantum / 12.92 : ((r / quantum + 0.055) / 1.055) ** 2.4);
        g = quantum * (g / quantum <= 0.04045 ? g / quantum / 12.92 : ((g / quantum + 0.055) / 1.055) ** 2.4);
        b = quantum * (b / quantum <= 0.04045 ? b / quantum / 12.92 : ((b / quantum + 0.055) / 1.055) ** 2.4);
    } else if (!luminance && linear) {
        r = quantum * (r / quantum <= 0.0031308 ? r / quantum * 12.92 : 1.055 * (r / quantum) ** (1 / 2.4) - 0.055);
        g = quantum * (g / quantum <= 0.0031308 ? g / quantum * 12.92 : 1.055 * (g / quantum) ** (1 / 2.4) - 0.055);
        b = quantum * (b / quantum <= 0.0031308 ? b / quantum * 12.92 : 1.055 * (b / quantum) ** (1 / 2.4) - 0.055);
    }
    return method === "rec601luma" || method === "rec601luminance"
        ? 0.298839 * r + 0.586811 * g + 0.11435 * b
        : 0.212656 * r + 0.715158 * g + 0.072186 * b;
}

type MagickHistogram = Float64Array[];
type MagickAnalysisOperation = { end: number; luminance: boolean; highDepth?: boolean; transform(histogram: MagickHistogram, image: Pick<RgbaImage, "width" | "height" | "hasAlpha" | "space">): MagickPixelOperation["apply"] };
function* accumulateMagickHistogram(data: Uint8Array | Uint16Array, histogram: MagickHistogram, method: string, linear: boolean): Generator<void, void, void> {
    for (let i = 0; i < data.length; i += 4) {
        if (i && i % 65536 === 0) yield;
        for (let channel = 0; channel < 4; channel++) histogram[channel]![data[i + channel]!]!++;
        // Keep ImageMagick's 16-bit histogram precision for fractional luma.
        if (histogram[4]) histogram[4][Math.round((data instanceof Uint16Array ? 1 : 257) * magickIntensity(data[i]!, data[i + 1]!, data[i + 2]!, method, data instanceof Uint16Array ? 65535 : 255, linear))]!++;
    }
}
function* applyMagickLookup(image: RgbaImage, lookup: Uint8Array[]): Generator<void, RgbaImage, void> {
    const data = new Uint8Array(image.data);
    const samples = lookup[0]!.length === 65536 ? image.data16 ?? image.data : image.data;
    for (let i = 0; i < data.length; i += 4) {
        if (i && i % 65536 === 0) yield;
        for (let channel = 0; channel < 4; channel++) data[i + channel] = lookup[channel]![samples[i + channel]!]!;
    }
    const { data16: ignored, ...metadata } = image;
    return { ...metadata, data };
}
function parseConnectedComponents(tokens: readonly string[], start: number): number {
    const value = tokens[start + 1];
    if (tokens[start] !== "-connected-components") throw new Error(`Unsupported option: ${tokens[start]}`);
    if (!value?.trim() || !Number.isFinite(Number(value))) throw new Error("connected-components: connectivity must be numeric");
    // Native converts to an unsigned integer before choosing the neighborhood.
    const connectivity = Math.trunc(Number(value));
    return connectivity >= 0 && connectivity <= 4 ? 4 : 8;
}

function parseMagickAnalysisOperation(tokens: readonly string[], state: MagickState, start: number): MagickAnalysisOperation | undefined {
    const token = tokens[start];
    if (token === "-auto-threshold") {
        const method = tokens[start + 1]?.toLowerCase();
        if (!method || !["otsu", "kapur", "triangle"].includes(method)) throw new Error(`invalid argument '-auto-threshold' '${tokens[start + 1] ?? ""}'`);
        const captured = { ...state, channels: { ...state.channels } };
        return { end: start + 1, luminance: true, highDepth: true, transform(histogram) {
            const threshold = automaticThreshold(histogram[4]!, method);
            const operation = parseMagickPixelOperation(["-threshold", String(65535 * threshold / 100)], captured, 0)!;
            return function* (image) {
                const result = yield* operation.apply(image);
                return { ...result, properties: { ...result.properties, "auto-threshold:threshold": `${Number(threshold.toPrecision(6))}%` } };
            };
        } };
    }
    if (token === "-sepia-tone") {
        const argument = tokens[start + 1] ?? "80%", raw = parseFloat(argument);
        // Native CLI percentages span QuantumRange + 1 (65536), in Q16 units.
        const threshold = (argument.endsWith("%") ? raw * 65536 / 100 : raw) / 257;
        const independent = state.channelExplicit, channels = [state.channels.r, state.channels.g, state.channels.b, state.channels.a];
        return { end: start + 1, luminance: true, transform(histogram, image) {
            const gray = image.space === "b-w" || image.space === "grey16";
            const bins = histogram[4]!, count = image.width * image.height;
            let low = 0, high = bins.length - 1, sum = 0;
            for (; low < bins.length - 1; low++) { sum += bins[low]!; if (sum > 0.02 * count) break; }
            sum = 0;
            for (; high > 0; high--) { sum += bins[high]!; if (sum > 0.01 * count) break; }
            // Native SepiaToneImage normalizes the transformed luma, then increases HSV contrast.
            // Tone is monotonic, so input luma percentiles also locate the toned percentiles.
            const luma = (value: number) => {
                const [r, g, b] = magickSepiaTone(value / 257, threshold, gray);
                return Math.round(257 * (0.212656 * r + 0.715158 * g + 0.072186 * b)) / 257;
            };
            const black = luma(low), white = luma(high);
            const blacks = [black, black, black, black], whites = [white, white, white, white];
            if (independent) {
                for (let channel = 0; channel < 3; channel++) {
                    blacks[channel] = Math.round(magickSepiaTone(low / 257, threshold, gray)[channel]! * 257) / 257;
                    whites[channel] = Math.round(magickSepiaTone(high / 257, threshold, gray)[channel]! * 257) / 257;
                }
                const alpha = histogram[3]!;
                let lowAlpha = 0, highAlpha = 255, sum = 0;
                for (; lowAlpha < 255; lowAlpha++) { sum += alpha[lowAlpha]!; if (sum > 0.02 * count) break; }
                sum = 0;
                for (; highAlpha > 0; highAlpha--) { sum += alpha[highAlpha]!; if (sum > 0.01 * count) break; }
                blacks[3] = lowAlpha; whites[3] = highAlpha;
            }
            return function* (pixels) {
                const { data16: ignored, ...metadata } = pixels;
                const data = new Uint8Array(pixels.data);
                for (let i = 0; i < data.length; i += 4) {
                    if (i % 65536 === 0) yield;
                    const intensity = 0.212656 * data[i]! + 0.715158 * data[i + 1]! + 0.072186 * data[i + 2]!;
                    const tone = magickSepiaTone(intensity, threshold, gray);
                    // Sepia tones all RGB channels; only normalization honors the channel mask.
                    for (let channel = 0; channel < 4; channel++) {
                        if (independent && !channels[channel] || channel === 3 && !image.hasAlpha) continue;
                        const black = blacks[channel]!, white = whites[channel]!;
                        if (white <= black) continue;
                        // Native normalization indexes its Q16 stretch map with rounded tone values.
                        if (channel < 3) tone[channel] = Math.max(0, Math.min(255, (Math.round(tone[channel]! * 257) / 257 - black) / (white - black) * 255));
                        else data[i + 3] = clampByteVal((data[i + 3]! - black) / (white - black) * 255);
                    }
                    const brightness = Math.max(...tone) / 255;
                    const contrast = 0.5 * brightness + 0.25 * (Math.sin(Math.PI * (brightness - 0.5)) + 1);
                    for (let channel = 0; channel < 3; channel++) data[i + channel] = clampByteVal(brightness === 0 ? 0 : tone[channel]! * contrast / brightness);
                }
                return { ...metadata, data };
            };
        } };
    }
    if (!["-auto-level", "-auto-gamma", "-normalize", "-contrast-stretch", "-linear-stretch", "-equalize"].includes(token ?? "")) return;
    let end = start;
    const argument = token === "-contrast-stretch" || token === "-linear-stretch" ? tokens[++end] ?? "0%x0%" : "";
    const independent = state.channelExplicit, channels = independent ? state.channels : { r: true, g: true, b: true, a: false };
    return { end, highDepth: token === "-equalize", luminance: token === "-linear-stretch" || (token === "-normalize" || token === "-contrast-stretch" || token === "-equalize") && !independent, transform(histogram, image) {
        const levels = histogram[0]!.length;
        const lookup = Array.from({ length: 4 }, () => Uint8Array.from({ length: levels }, (_, value) => clampByteVal(value * 255 / (levels - 1))));
        const count = Math.max(1, image.width * image.height);
        if (token === "-auto-gamma") {
            const channelCount = image.hasAlpha ? 4 : 3;
            const sums = [0, 0, 0, 0];
            for (let channel = 0; channel < channelCount; channel++) for (let value = 0; value < 256; value++) sums[channel]! += histogram[channel]![value]! * value;
            const sharedMean = sums.reduce((sum, value) => sum + value, 0) / (count * channelCount * 255);
            // Explicit channels use independent RGB means; native leaves alpha unchanged.
            const active = [channels.r, channels.g, channels.b, !independent && image.hasAlpha];
            for (let channel = 0; channel < channelCount; channel++) {
                if (!active[channel]) continue;
                const mean = independent ? sums[channel]! / (count * 255) : sharedMean;
                if (mean <= 0 || mean >= 1) continue;
                const exponent = Math.log(0.5) / Math.log(mean);
                for (let value = 0; value < 256; value++) lookup[channel]![value] = clampByteVal(Math.pow(value / 255, exponent) * 255);
            }
        } else if (token === "-auto-level") {
            const mins = [255, 255, 255, 255], maxs = [0, 0, 0, 0], active = [channels.r, channels.g, channels.b, (!independent || channels.a) && image.hasAlpha];
            for (let channel = 0; channel < 4; channel++) for (let value = 0; value < 256; value++) if (histogram[channel]![value]! > 0) { mins[channel] = Math.min(mins[channel]!, value); maxs[channel] = Math.max(maxs[channel]!, value); }
            if (!independent) {
                // Native default channels share one range, including alpha when present.
                const channelCount = image.hasAlpha ? 4 : 3;
                const low = Math.min(...mins.slice(0, channelCount)), high = Math.max(...maxs.slice(0, channelCount));
                mins.fill(low); maxs.fill(high);
            }
            for (let channel = 0; channel < 4; channel++) {
                const range = maxs[channel]! - mins[channel]!;
                if (active[channel] && range > 0) for (let value = 0; value < 256; value++) lookup[channel]![value] = clampByteVal((value - mins[channel]!) / range * 255);
            }
        } else if (token === "-linear-stretch") {
            const [black, white] = argument.split("x"), percentage = argument.includes("%");
            const lowTarget = (parseFloat(black || "0") || 0) * (percentage ? count / 100 : 1);
            // An omitted white point is the remaining pixel count, not the black point.
            const highTarget = white === undefined ? count - lowTarget : (parseFloat(white) || 0) * (percentage ? count / 100 : 1);
            const bins = histogram[4]!;
            let low = 0, high = bins.length - 1, sum = 0;
            for (; low < bins.length - 1; low++) { sum += bins[low]!; if (sum >= lowTarget) break; }
            sum = 0;
            for (; high > 0; high--) { sum += bins[high]!; if (sum >= highTarget) break; }
            const active = [channels.r, channels.g, channels.b, (!independent || channels.a) && image.hasAlpha];
            for (let channel = 0; channel < 4; channel++) {
                if (!active[channel]) continue;
                for (let value = 0; value < 256; value++) lookup[channel]![value] = high === low
                    ? (value * 257 > low ? 255 : 0)
                    : clampByteVal((value * 257 - low) / (high - low) * 255);
            }
        } else if (token === "-normalize" || token === "-contrast-stretch") {
            const [black, white] = argument.split("x"), percentage = argument.includes("%");
            const blackValue = parseFloat(black || "0") || 0, whiteValue = white === undefined ? blackValue : parseFloat(white) || 0;
            const lowTarget = token === "-normalize" ? 0.02 * count : percentage ? blackValue / 100 * count : blackValue;
            const highTarget = token === "-normalize" ? 0.01 * count : percentage ? whiteValue / 100 * count : whiteValue;
            const active = [channels.r, channels.g, channels.b, (!independent || channels.a) && image.hasAlpha];
            for (let channel = 0; channel < 4; channel++) {
                if (!active[channel]) continue;
                const bins = histogram[4] ?? histogram[channel]!, scale = histogram[4] ? 257 : 1;
                let low = 0, high = bins.length - 1, sum = 0;
                for (; low < bins.length - 1; low++) { sum += bins[low]!; if (sum > lowTarget) break; }
                sum = 0;
                for (; high > 0; high--) { sum += bins[high]!; if (sum > highTarget) break; }
                if (high > low) for (let value = 0; value < 256; value++) lookup[channel]![value] = clampByteVal((value * scale - low) / (high - low) * 255);
            }
        } else if (token === "-equalize") {
            const active = [channels.r, channels.g, channels.b, (!independent || channels.a) && image.hasAlpha];
            for (let channel = 0; channel < 4; channel++) {
                if (!active[channel]) continue;
                const bins = histogram[4] ?? histogram[channel]!, scale = histogram[4] ? 65535 / (levels - 1) : 1;
                // Native equalization subtracts the zero bin, not the first occupied bin.
                const black = bins[0]!;
                if (count === black) continue;
                let cumulative = 0, bin = 0;
                for (let value = 0; value < levels; value++) {
                    for (; bin <= value * scale; bin++) cumulative += bins[bin]!;
                    lookup[channel]![value] = clampByteVal((cumulative - black) / (count - black) * 255);
                }
            }
        }
        return image => applyMagickLookup(image, lookup);
    } };
}

type MagickPixelOperation = { warning?: string; evaluate?: boolean; highDepth?: boolean; end: number; apply(image: RgbaImage, pixelOffset?: number): Generator<void, RgbaImage, void> };
function parseMagickPixelOperation(tokens: readonly string[], settings: MagickState, start: number, signal?: AbortSignal): MagickPixelOperation | undefined {
    const state = { ...settings }, token = tokens[start];
    let i = start, apply: MagickPixelOperation["apply"], highDepth = false, warning: string | undefined;
    if (token === "-colorspace" || token === "-grayscale" || token === "-type") {
        const value = tokens[++i];
        const imageType = token === "-type" ? (value ?? "").toLowerCase() : undefined;
        if (imageType !== undefined && !["bilevel", "grayscale", "grayscalealpha"].includes(imageType)) {
            throw new Error(`unsupported image type '${value ?? ""}'`);
        }
        const space = imageType === undefined ? (value ?? "gray").toLowerCase() : "gray";
        if (token === "-grayscale" && !["average", "mean", "brightness", "lightness", "ms", "rms", "rec601luma", "rec601luminance", "rec709luma", "rec709luminance"].includes(space)) {
            throw new Error(`unsupported grayscale method '${tokens[i] ?? ""}'`);
        }
        apply = function* (image) {
            if (image.magickColorspace === "RGB" && space === "rgb") return image;
            if ((image.magickColorspace === "HSL" || image.magickColorspace === "HSB" || image.magickColorspace === "HWB" || image.magickColorspace === "XYZ" || image.magickColorspace === "YCbCr" || image.magickColorspace === "YUV" || image.magickColorspace === "CIELab") && (space === image.magickColorspace.toLowerCase() || (space === "lab" && image.magickColorspace === "CIELab"))) return image;
            if (image.magickColorspace === "HSL" || image.magickColorspace === "HSB" || image.magickColorspace === "HWB" || image.magickColorspace === "XYZ" || image.magickColorspace === "YCbCr" || image.magickColorspace === "YUV" || image.magickColorspace === "CIELab") image = yield* convertHuePixels(image, "sRGB");
            if (image.space === "cmyk" && space !== "cmyk") {
                const { hueSamples: ignoredCmyk, storedHueSamples: ignoredStoredCmyk, ...rgb } = image;
                image = { ...rgb, space: "srgb", channels: image.hasAlpha ? 4 : 3 };
            }
            if (space === "rgb" || image.magickColorspace === "RGB") {
                const linearize = space === "rgb";
                const data = new Uint8Array(image.data.length), data16 = new Uint16Array(data.length);
                const input = image.data16 ?? image.data, range = image.data16 ? 65535 : 255;
                for (let idx = 0; idx < data.length; idx++) {
                    if (idx % 65536 === 0) yield;
                    let value = input[idx]! / range;
                    if (idx % 4 !== 3) value = linearize
                        ? value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
                        : value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
                    data[idx] = clampByteVal(value * 255);
                    data16[idx] = Math.round(value * 65535);
                }
                const { magickColorspace: ignored, ...metadata } = image;
                image = { ...metadata, data, data16, space: "srgb", channels: image.hasAlpha ? 4 : 3, ...(linearize ? { magickColorspace: "RGB" as const } : {}) };
                if (linearize) return image;
            }
            if (space === "cmyk") return yield* convertCmykPixels(image);
            if (space === "lab" || space === "cielab") return yield* convertHuePixels(image, "CIELab");
            if (space === "hsl" || space === "hsb" || space === "hwb" || space === "xyz" || space === "ycbcr" || space === "yuv") return yield* convertHuePixels(image, space === "yuv" ? "YUV" : space === "ycbcr" ? "YCbCr" : space === "xyz" ? "XYZ" : space === "hwb" ? "HWB" : space === "hsb" ? "HSB" : "HSL");
            if (token !== "-grayscale" && !space.includes("gray") && !space.includes("grey") && space !== "rec709luma" && space !== "rec601luma") return image;
            const out = new Uint8Array(image.data);
            for (let idx = 0; idx < out.length; idx += 4) {
                if (idx % 65536 === 0) yield;
                let r = out[idx]!, g = out[idx + 1]!, b = out[idx + 2]!;
                // Luminance uses linear light; luma uses encoded sRGB samples.
                if (space === "rec601luminance" || space === "rec709luminance") {
                    r = 255 * (r / 255 <= 0.04045 ? r / 255 / 12.92 : ((r / 255 + 0.055) / 1.055) ** 2.4);
                    g = 255 * (g / 255 <= 0.04045 ? g / 255 / 12.92 : ((g / 255 + 0.055) / 1.055) ** 2.4);
                    b = 255 * (b / 255 <= 0.04045 ? b / 255 / 12.92 : ((b / 255 + 0.055) / 1.055) ** 2.4);
                }
                let intensity: number;
                switch (space) {
                    case "average": case "mean": intensity = (r + g + b) / 3; break;
                    case "brightness": intensity = Math.max(r, g, b); break;
                    case "lightness": intensity = (Math.min(r, g, b) + Math.max(r, g, b)) / 2; break;
                    // Native MS squares Q16 quantum values before clipping.
                    case "ms": intensity = (r * r + g * g + b * b) * 257 / 3; break;
                    case "rms": intensity = Math.sqrt((r * r + g * g + b * b) / 3); break;
                    case "rec601luma": case "rec601luminance": intensity = 0.298839 * r + 0.586811 * g + 0.11435 * b; break;
                    default: intensity = 0.212656 * r + 0.715158 * g + 0.072186 * b;
                }
                const gray = imageType === "bilevel" ? (intensity > 127.5 ? 255 : 0) : clampByteVal(intensity);
                out[idx] = out[idx + 1] = out[idx + 2] = gray;
                if (imageType !== undefined && (imageType !== "grayscalealpha" || !image.hasAlpha)) out[idx + 3] = 255;
            }
            const { data16: ignored, ...metadata } = image;
            const hasAlpha = imageType === undefined ? image.hasAlpha : imageType === "grayscalealpha";
            return { ...metadata, data: out, space: "b-w", hasAlpha, channels: hasAlpha ? 2 : 1 };
        };
    }
    else if (token === "-gamma" || token === "+gamma") {
        highDepth = true;
        const value = tokens[++i] ?? "1";
        const parts = value.split(",");
        if (parts.some(part => !part.trim() || !Number.isFinite(Number(part)))) throw new Error(`Invalid gamma: ${value}`);
        const gamma = Number(parts[0]);
        const exponent = token === "+gamma" ? gamma : gamma === 0 ? Number.MAX_VALUE : 1 / gamma;
        const channels = state.channelExplicit ? state.channels : { r: true, g: true, b: true, a: true };
        const mask = [channels.r, channels.g, channels.b, channels.a];
        const lookup = mask.map(active =>
            Uint8Array.from({ length: 256 }, (_, value) => active ? clampByteVal(255 * Math.min(1, Math.pow(value / 255, exponent))) : value));
        apply = function* (image) {
            // Native PNG readback treats the rounded sRGB gAMA value as 1/2.2.
            const inputGamma = image.gamma === undefined || image.gamma === 0.45455 ? 1 / 2.2 : image.gamma;
            if (image.data16) {
                const data16 = new Uint16Array(image.data16), data = new Uint8Array(image.data);
                for (let idx = 0; idx < data.length; idx++) {
                    if (idx % 65536 === 0) yield;
                    if (!mask[idx % 4] || idx % 4 === 3 && !image.hasAlpha) continue;
                    data16[idx] = Math.round(65535 * Math.min(1, Math.pow(data16[idx]! / 65535, exponent)));
                    data[idx] = clampByteVal(data16[idx]! / 257);
                }
                return { ...image, data, data16, gamma: inputGamma * gamma };
            }
            return { ...yield* applyMagickLookup(image, lookup), gamma: inputGamma * gamma };
        };
    }
    else if (token === "-alpha") {
        const mode = (tokens[++i] ?? "on").toLowerCase();
        highDepth = ["discrete", "deactivate", "associate", "disassociate", "off", "opaque", "activate", "on", "set", "extract"].includes(mode);
        if (mode === "offifopaque") {
            highDepth = true;
            apply = function* (im) {
                if (!im.hasAlpha) return im;
                const samples = im.data16 ?? im.data, maximum = im.data16 ? 65535 : 255;
                for (let index = 3; index < samples.length; index += 4) {
                    if (index % 65536 === 3) { signal?.throwIfAborted(); yield; }
                    if (samples[index] !== maximum) return im;
                }
                return { ...im, hasAlpha: false };
            };
        }
        else if (mode === "remove") {
            highDepth = true;
            apply = function* (im) {
                const out = new Uint8Array(im.data.length);
                const data16 = new Uint16Array(im.data.length);
                const color = state.backgroundExplicit ? state.background : im.backgroundColor ?? state.background;
                const background = [color.r, color.g, color.b];
                for (let idx = 0; idx < out.length; idx += 4) {
                    if (idx % 65536 === 0) yield;
                    const alpha = im.hasAlpha ? (im.data16 ? im.data16[idx + 3]! / 65535 : im.data[idx + 3]! / 255) : 1;
                    for (let channel = 0; channel < 3; channel++) {
                        const bg = background[im.channels === 2 ? 0 : channel]!;
                        const source = im.data16 ? im.data16[idx + channel]! : im.data[idx + channel]! * 257;
                        const blended = source * alpha + bg * 257 * (1 - alpha);
                        data16[idx + channel] = Math.round(blended);
                        // Round the unquantized blend directly for 8-bit output.
                        out[idx + channel] = clampByteVal(blended / 257);
                    }
                    out[idx + 3] = 255;
                    data16[idx + 3] = 65535;
                }
                return { ...im, data: out, data16, hasAlpha: false, channels: im.channels === 4 ? 3 : im.channels === 2 ? 1 : im.channels };
            };
        }
        else if (mode === "associate" || mode === "disassociate") {
            apply = function* (im) {
                const out = new Uint8Array(im.data), data16 = new Uint16Array(im.data.length);
                for (let idx = 0; idx < out.length; idx += 4) {
                    if (idx % 65536 === 0) yield;
                    const alpha = im.hasAlpha ? (im.data16 ? im.data16[idx + 3]! / 65535 : im.data[idx + 3]! / 255) : 1;
                    const scale = mode === "associate" ? alpha : 1 / Math.max(alpha, 1e-12);
                    for (let channel = 0; channel < 3; channel++) {
                        const source = im.data16 ? im.data16[idx + channel]! : im.data[idx + channel]! * 257;
                        const scaled = Math.min(65535, source * scale);
                        data16[idx + channel] = Math.round(scaled);
                        out[idx + channel] = clampByteVal(scaled / 257);
                    }
                    data16[idx + 3] = im.data16 ? im.data16[idx + 3]! : im.data[idx + 3]! * 257;
                }
                return { ...im, data: out, data16, hasAlpha: false };
            };
        }
        else if (mode === "deactivate" || mode === "discrete") {
            apply = function* (im) {
                yield;
                return { ...im, hasAlpha: false };
            };
        }
        else if (mode === "background") {
            apply = function* (im) {
                let pixelWork = 0;
                const out = new Uint8Array(im.data);
                for (let idx = 0; idx < out.length; idx += 4) {
                    if (++pixelWork % 16384 === 0)
                        yield;
                    if (out[idx + 3] === 0) {
                        out[idx] = state.background.r;
                        out[idx + 1] = state.background.g;
                        out[idx + 2] = state.background.b;
                    }
                }
                return { ...im, data: out };
            };
        }
        else if (mode === "off" || mode === "opaque") {
            apply = function* (im) {
                let pixelWork = 0;
                const out = new Uint8Array(im.data);
                const data16 = im.data16 ? new Uint16Array(im.data16) : undefined;
                for (let idx = 3; idx < out.length; idx += 4) {
                    if (++pixelWork % 16384 === 0)
                        yield;
                    out[idx] = mode === "off" ? 0 : 255;
                    if (data16) data16[idx] = mode === "off" ? 0 : 65535;
                }
                return { ...im, data: out, ...(data16 ? { data16 } : {}), hasAlpha: mode === "opaque", alphaBlend: mode === "opaque" };
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
                return { ...im, data: out, hasAlpha: true, alphaBlend: true };
            };
        }
        else if (mode === "copy" || mode === "shape") {
            apply = function* (im) {
                let pixelWork = 0;
                const out = new Uint8Array(im.data);
                for (let idx = 0; idx < out.length; idx += 4) {
                    if (++pixelWork % 16384 === 0)
                        yield;
                    const inten = clampByteVal(magickIntensity(out[idx]!, out[idx + 1]!, out[idx + 2]!, state.intensity, 255, im.magickColorspace === "RGB"));
                    if (mode === "shape") {
                        out[idx] = state.background.r;
                        out[idx + 1] = state.background.g;
                        out[idx + 2] = state.background.b;
                    }
                    out[idx + 3] = inten;
                }
                return { ...im, data: out, hasAlpha: true, alphaBlend: mode === "shape" };
            };
        }
        else if (mode === "activate") {
            apply = function* (im) {
                yield;
                return { ...im, hasAlpha: true, alphaBlend: true, channels: im.channels <= 2 ? 2 : 4 };
            };
        }
        else if (mode === "on" || mode === "set") {
            apply = function* (im) {
                if (im.hasAlpha && im.alphaBlend !== false) return im;
                const opaque = yield* prepareInactiveAlphaOutput({ ...im, hasAlpha: false });
                return { ...opaque, hasAlpha: true, alphaBlend: true, channels: im.channels <= 2 ? 2 : 4 };
            };
        }
        else if (mode === "extract") {
            apply = function* (im) {
                return yield* extractChannelImageSteps({ ...im, hasAlpha: true }, 3);
            };
        }
        else { throw new Error(`Unsupported alpha mode: ${mode}`); }
    } else if (token === "-channel-fx") {
        highDepth = true;
        const expression = tokens[++i] ?? "";
        if (!expression.includes("=>")) return undefined;
        const names = [["r", "red"], ["g", "green"], ["b", "blue"], ["a", "alpha"]];
        const assignments = expression.split(",").flatMap(assignment => {
            const exchange = assignment.includes("<=>");
            const parts = assignment.split(exchange ? "<=>" : "=>");
            const channels = parts.map(part => names.findIndex(aliases => aliases.includes(part.trim().toLowerCase())));
            if (parts.length !== 2 || channels.some(channel => channel < 0))
                throw new Error(`unsupported channel-fx assignment '${assignment}'`);
            const source = channels[0]!, target = channels[1]!;
            return exchange ? [{ source, target }, { source: target, target: source }] : [{ source, target }];
        });
        apply = function* (image) {
            const data = new Uint8Array(image.data), data16 = image.data16 ? new Uint16Array(image.data16) : undefined;
            const hasAlpha = image.hasAlpha || assignments.some(({ target }) => target === 3);
            for (let offset = 0; offset < data.length; offset += 4) {
                if (offset % 65536 === 0) { signal?.throwIfAborted(); yield; }
                for (const { source, target } of assignments) {
                    data[offset + target] = source === 3 && !image.hasAlpha ? 255 : image.data[offset + source]!;
                    if (data16) data16[offset + target] = source === 3 && !image.hasAlpha ? 65535 : image.data16![offset + source]!;
                }
            }
            return { ...image, data, ...(data16 ? { data16 } : {}), hasAlpha, space: "srgb", channels: hasAlpha ? 4 : 3 };
        };
    } else if (token === "-recolor") {
        throw new Error('option has been replaced \'-recolor\', use "-color-matrix"');
    } else if (token === "-color-matrix") {
        highDepth = true;
        const matrix = tokens[++i] ?? "1,0,0 0,1,0 0,0,1";
        apply = image => applyMagickColorMatrixSteps(image, matrix, signal);
    } else if (token === "-opaque" || token === "+opaque" || token === "-transparent" || token === "+transparent") {
        highDepth = true;
        const opaque = token.endsWith("opaque");
        const value = tokens[++i] ?? (opaque ? "#000000" : "#ffffff");
        let target: RgbaColor;
        try {
            target = parseColor(value, true);
        } catch {
            warning = `magick: unrecognized color \`${value}'\n`;
            target = { r: 0, g: 0, b: 0, a: 255 };
        }
        apply = opaque
            ? image => applyMagickOpaqueSteps(image, target, state.fill, state.alphaFuzz, token === "+opaque", state.channelExplicit ? state.channels : { r: true, g: true, b: true, a: true }, signal)
            : image => applyMagickTransparentSteps(image, target, state.alphaFuzz, token === "+transparent", signal);
    } else if (token === "-clamp") {
        highDepth = true;
        const channels = state.channelExplicit ? state.channels : { r: true, g: true, b: true, a: true };
        apply = image => applyMagickEvaluateSteps(image, "clamp", "0", channels, undefined, signal);
    } else if (token === "-evaluate") {
        const operationRaw = tokens[++i] ?? "Add", value = tokens[++i] ?? "0";
        const operation = operationRaw.toLowerCase().split("-").join("").split("_").join("");
        highDepth = true;
        if (!["add", "sum", "addmodulus", "mean", "median", "subtract", "multiply", "divide", "pow", "exp", "exponential", "log", "inverselog", "set", "min", "max",
            "and", "or", "xor", "leftshift", "rightshift", "abs", "sin", "sine", "cos", "cosine",
            "threshold", "thresholdblack", "thresholdwhite", "rms", "rootmeansquare", "uniformnoise", "impulsenoise", "gaussiannoise", "laplaciannoise", "multiplicativenoise", "poissonnoise"].includes(operation)) {
            throw new Error(`unrecognized evaluate operator '-evaluate' '${operationRaw}'`);
        }
        const operand = value.trim().endsWith("%") ? value.trim().slice(0, -1) : value;
        if (!Number.isFinite(Number(operand)) || !Number.isFinite(Number.parseFloat(operand))) {
            throw new Error(`invalid argument '-evaluate' '${value}'`);
        }
        const channels = state.channelExplicit ? state.channels : { r: true, g: true, b: true, a: true };
        let random: (() => number) | undefined;
        apply = (image, pixelOffset = 0) => {
            if ((operation === "uniformnoise" || operation === "gaussiannoise" || operation === "impulsenoise" || operation === "laplaciannoise" || operation === "multiplicativenoise" || operation === "poissonnoise") && pixelOffset === 0)
                random = createMagickRandom(state.seed ?? 0);
            return applyMagickEvaluateSteps(image, operation, value, channels, random, signal);
        };
    } else if (token === "-function") {
        highDepth = true;
        const operation = tokens[++i] ?? "Polynomial", value = tokens[++i] ?? "1,0";
        if (!["polynomial", "sinusoid", "arcsin", "arctan"].includes(operation.toLowerCase())) {
            throw new Error(`unrecognized function '-function' '${operation}'`);
        }
        const channels = state.channelExplicit ? state.channels : { r: true, g: true, b: true, a: true };
        const parameters = value.split(",").flatMap(part => part.trim().split(/\s+/));
        if (parameters.some(parameter => !Number.isFinite(Number(parameter)) || Number.parseFloat(parameter) !== Number(parameter))) {
            throw new Error(`invalid list of numbers '-function' '${value}'`);
        }
        const coefficients = parameters.map(Number);
        apply = image => applyMagickFunctionSteps(image, operation, coefficients, channels, signal);
    } else if (token === "-solarize") {
        highDepth = true;
        const value = tokens[++i] ?? "50%";
        const geometry = value.trim().toLowerCase();
        const firstDigit = geometry.startsWith("-") || geometry.startsWith("+") ? 1 : 0;
        const separator = geometry.indexOf("x", geometry.startsWith("0x", firstDigit) ? firstDigit + 2 : 0);
        const fields = (separator < 0 ? [geometry] : [geometry.slice(0, separator), geometry.slice(separator + 1)]).map(field => field.trim());
        const thresholds = fields.map(field => {
            const threshold = (field.endsWith("%") ? field.slice(0, -1) : field).trim();
            const unsigned = threshold.startsWith("-") || threshold.startsWith("+") ? threshold.slice(1) : threshold;
            const hexadecimal = unsigned.startsWith("0x");
            const raw = hexadecimal ? Number(unsigned) * (threshold.startsWith("-") ? -1 : 1) : Number(threshold);
            if (!Number.isFinite(raw) || (!hexadecimal && Number.parseFloat(threshold) !== raw)) {
                throw new Error(`invalid argument '-solarize' '${value}'`);
            }
            return field.endsWith("%") ? (raw / 100) * 65535 : raw;
        });
        const channels = state.channelExplicit ? state.channels : { r: true, g: true, b: true, a: true };
        apply = image => applyMagickSolarizeSteps(image, thresholds[0]!, channels, signal);
    } else if (token === "-ordered-dither") {
        const options = parseOrderedDither(tokens[++i] ?? ""), channels = state.channelExplicit ? state.channels : { r: true, g: true, b: true, a: true };
        apply = image => applyMagickRasterSteps(image, orderedDitherPixelSteps(image, options, [channels.r, channels.g, channels.b, channels.a]), signal);
    } else if (token === "-posterize") {
        highDepth = true;
        const value = tokens[++i] ?? "", levels = Number(value);
        if (!value.trim() || !Number.isFinite(levels)) throw new Error(`invalid argument '-posterize' '${value}'`);
        const channels = state.channelExplicit ? state.channels : { r: true, g: true, b: true, a: true };
        apply = image => applyMagickRasterSteps(image, posterizePixelSteps(image, levels, state.dither !== false, channels, signal), signal);
    } else if (token === "-monochrome") {
        apply = function* (image) { return yield* thresholdImageSteps(yield* grayscaleImageSteps(image), 128, true); };
    } else if (token === "-modulate") {
        highDepth = true;
        const raw = tokens[++i] ?? "";
        if (!raw.trim() || [...raw].some(c => c.trim() !== "" && !"0123456789eExX!#%()+,-./:<>@\\^".includes(c))) {
            throw new Error(`invalid argument for option '-modulate': ${raw}`);
        }
        for (let offset = 0; offset < raw.length; offset++) {
            if (raw[offset]?.toLowerCase() !== "e") continue;
            const next = raw[offset + 1] === "+" || raw[offset + 1] === "-" ? offset + 2 : offset + 1;
            if (!"0123456789.".includes(raw[offset - 1] ?? " ") || !"0123456789".includes(raw[next] ?? " ")) {
                throw new Error(`invalid argument for option '-modulate': ${raw}`);
            }
        }
        // Native modulation geometry defaults omitted components to 100.
        let value = "", component = 0;
        for (const c of raw) {
            if (c === "," || c === "/") value += component++ === 0 ? "x" : "+";
            else if (c.trim() !== "" && !"!#%()<>@\\^".includes(c)) value += c;
        }
        const geometry = parseMagickGeometry(value);
        const brightness = (geometry.width ?? 100) / 100, saturation = (geometry.height ?? 100) / 100, hueShift = ((geometry.hasOffset ? geometry.x : 100) - 100) * 3 / 100;
        const colorspace = state.modulateColorspace ?? "hsl";
        apply = function* (image) {
            const out = new Uint8Array(image.data);
            const data16 = image.data16 ? new Uint16Array(image.data16) : undefined;
            const samples = data16 ?? out, quantum = data16 ? 65535 : 255;
            for (let idx = 0; idx < out.length; idx += 4) {
                if (idx % 65536 === 0) { signal?.throwIfAborted(); yield; }
                const r = samples[idx]! / quantum, g = samples[idx + 1]! / quantum, b = samples[idx + 2]! / quantum;
                const rgb = modulateRgb(r, g, b, brightness, saturation, hueShift % 6, colorspace);
                for (let channel = 0; channel < 3; channel++) {
                    const sample = Math.max(0, Math.min(quantum, Math.round(rgb[channel]! * quantum)));
                    if (data16) data16[idx + channel] = sample;
                    out[idx + channel] = data16 ? Math.round(sample / 257) : sample;
                }
            }
            return { ...image, data: out, ...(data16 ? { data16 } : {}) };
        };
    } else if (token === "-brightness-contrast") {
        highDepth = true;
        const raw = (tokens[++i] ?? "").replaceAll(",", "x").replaceAll("/", "x");
        validateMagickTransformGeometry(raw, token);
        const [brightness = 0, contrast = 0] = raw.split("x").map(value => parseFloat(value) || 0);
        // ImageMagick BrightnessContrastImage: a polynomial centered at midgray.
        const slope = contrast < 0 ? 1 + contrast / 100 : 100 / (contrast === 100 ? 1e-12 : 100 - contrast);
        const channels = state.channelExplicit ? state.channels : { r: true, g: true, b: true, a: true };
        apply = function* (image) {
            const out = new Uint8Array(image.data);
            const data16 = image.data16 ? new Uint16Array(image.data16) : undefined;
            const samples = data16 ?? out, quantum = data16 ? 65535 : 255;
            const offset = (brightness / 100 * quantum - quantum / 2) * slope + quantum / 2;
            const mask = [channels.r, channels.g, channels.b, channels.a && image.hasAlpha];
            for (let idx = 0; idx < out.length; idx += 4) {
                if (idx % 65536 === 0) yield;
                for (let channel = 0; channel < 4; channel++) {
                    if (!mask[channel]) continue;
                    const sample = Math.max(0, Math.min(quantum, Math.round(samples[idx + channel]! * slope + offset)));
                    if (data16) data16[idx + channel] = sample;
                    out[idx + channel] = data16 ? Math.round(sample / 257) : sample;
                }
            }
            return { ...image, data: out, ...(data16 ? { data16 } : {}) };
        };
    } else if (token === "-range-threshold") {
        highDepth = true;
        const raw = tokens[++i] ?? "";
        const parts = raw.split(",").map(part => part.endsWith("%") ? part.slice(0, -1) : part);
        if (parts.length !== 4 || parts.some(part => !part.trim() || !Number.isFinite(Number(part)))) {
            throw new Error(`invalid argument '-range-threshold' '${raw}'`);
        }
        const scale = raw.includes("%") ? 65535 / 100 : 1;
        const [lowBlack, lowWhite, highWhite, highBlack] = parts.map(part => Number(part) * scale) as [number, number, number, number];
        const channels = state.channels;
        const explicit = state.channelExplicit;
        apply = function* (image) {
            const out = new Uint8Array(image.data);
            const data16 = image.data16 ? new Uint16Array(image.data16) : undefined;
            const samples = data16 ?? out, quantumScale = data16 ? 1 : 257, maximum = data16 ? 65535 : 255;
            const mask = explicit ? [channels.r, channels.g, channels.b, channels.a && image.hasAlpha] : [true, true, true, image.hasAlpha];
            for (let idx = 0; idx < out.length; idx += 4) {
                if (idx % 65536 === 0) yield;
                const intensity = samples[idx] === samples[idx + 1] && samples[idx] === samples[idx + 2] ? samples[idx]! * quantumScale : (0.212656 * samples[idx]! + 0.715158 * samples[idx + 1]! + 0.072186 * samples[idx + 2]!) * quantumScale;
                for (let channel = 0; channel < 4; channel++) {
                    if (!mask[channel]) continue;
                    const value = explicit ? samples[idx + channel]! * quantumScale : intensity;
                    const level = value <= lowBlack || value >= highBlack ? 0
                        : value < lowWhite ? (value - lowBlack) / (lowWhite - lowBlack)
                        : value > highWhite ? (highBlack - value) / (highBlack - highWhite) : 1;
                    samples[idx + channel] = Math.round(level * maximum);
                    out[idx + channel] = Math.round(data16 ? samples[idx + channel]! / 257 : samples[idx + channel]!);
                }
            }
            return { ...image, data: out, ...(data16 ? { data16 } : {}) };
        };
    } else if (token === "-threshold") {
        highDepth = true;
        const raw = tokens[++i] ?? "", threshold = raw.endsWith("%") ? raw.slice(0, -1) : raw;
        if (!Number.isFinite(Number(threshold)) || Number.parseFloat(threshold) !== Number(threshold)) {
            throw new Error(`invalid argument '-threshold' '${raw}'`);
        }
        const value = raw.endsWith("%") ? Number(threshold) / 100 * 65535 : Number(threshold);
        const channels = state.channelExplicit ? state.channels : undefined;
        apply = function* (image) {
            const out = new Uint8Array(image.data);
            const data16 = image.data16 ? new Uint16Array(image.data16) : undefined;
            const samples = data16 ?? out, quantumScale = data16 ? 1 : 257, maximum = data16 ? 65535 : 255;
            const mask = channels ? [channels.r, channels.g, channels.b, channels.a && image.hasAlpha] : undefined;
            for (let idx = 0; idx < out.length; idx += 4) {
                if (idx % 65536 === 0) yield;
                if (mask) {
                    for (let channel = 0; channel < 4; channel++) {
                        if (mask[channel]) {
                            const white = samples[idx + channel]! * quantumScale > value;
                            samples[idx + channel] = white ? maximum : 0;
                            out[idx + channel] = white ? 255 : 0;
                        }
                    }
                } else {
                    const intensity = (0.212656 * samples[idx]! + 0.715158 * samples[idx + 1]! + 0.072186 * samples[idx + 2]!) * quantumScale;
                    const result = intensity > value ? 255 : 0;
                    samples[idx] = samples[idx + 1] = samples[idx + 2] = result ? maximum : 0;
                    out[idx] = out[idx + 1] = out[idx + 2] = result;
                    // Native default threshold assigns the intensity result to alpha too.
                    if (image.hasAlpha) {
                        samples[idx + 3] = result ? maximum : 0;
                        out[idx + 3] = result;
                    }
                }
            }
            return { ...image, data: out, ...(data16 ? { data16 } : {}) };
        };
    } else if (token === "-colorize") {
        highDepth = true;
        const value = tokens[++i] ?? "";
        const strengths = value.replaceAll("x", ",").split(",").map(part => {
            const percent = part.endsWith("%") ? part.slice(0, -1) : part;
            if (!Number.isFinite(Number(percent)) || Number.parseFloat(percent) !== Number(percent)) {
                throw new Error(`invalid argument '-colorize' '${value}'`);
            }
            return Number(percent) / 100;
        });
        const [red = 1, green = red, blue = red] = strengths;
        const blend = [red, green, blue];
        const fill = [state.fill.r, state.fill.g, state.fill.b];
        const mask = [state.channels.r, state.channels.g, state.channels.b];
        apply = function* (image) {
            if ((image.space === "b-w" || image.space === "grey16") && (fill[0] !== fill[1] || fill[1] !== fill[2] || mask[0] !== mask[1] || mask[1] !== mask[2] || red !== green || green !== blue))
                image = { ...image, space: "srgb", channels: image.hasAlpha ? 4 : 3 };
            const out = new Uint8Array(image.data);
            const data16 = image.data16 ? new Uint16Array(image.data16) : undefined;
            const samples = data16 ?? out, quantum = data16 ? 65535 : 255;
            for (let idx = 0; idx < out.length; idx += 4) {
                if (idx % 65536 === 0) yield;
                for (let channel = 0; channel < 3; channel++) {
                    const strength = blend[channel]!;
                    if (!mask[channel]) continue;
                    const sample = Math.max(0, Math.min(quantum, Math.round(samples[idx + channel]! * (1 - strength) + fill[channel]! * (quantum / 255) * strength)));
                    if (data16) data16[idx + channel] = sample;
                    out[idx + channel] = data16 ? Math.round(sample / 257) : sample;
                }
            }
            return { ...image, data: out, ...(data16 ? { data16 } : {}) };
        };
    } else if (token === "-tint") {
        highDepth = true;
        const value = tokens[++i] ?? "";
        const [red = 1, green = red, blue = red] = value.split(",").map(part => {
            const percent = part.endsWith("%") ? part.slice(0, -1) : part;
            if (!Number.isFinite(Number(percent)) || Number.parseFloat(percent) !== Number(percent)) {
                throw new Error(`invalid argument '-tint' '${value}'`);
            }
            return Number(percent) / 100;
        });
        const strengths = [red, green, blue];
        const fill = [state.fill.r, state.fill.g, state.fill.b];
        // ImageMagick subtracts the fill luminance even at zero strength.
        const intensity = 0.212656 * state.fill.r + 0.715158 * state.fill.g + 0.072186 * state.fill.b;
        const vector = fill.map((channel, index) => channel * strengths[index]! - intensity);
        apply = function* (image) {
            const out = new Uint8Array(image.data);
            const data16 = image.data16 ? new Uint16Array(image.data16) : undefined;
            const samples = data16 ?? out, quantum = data16 ? 65535 : 255;
            for (let idx = 0; idx < out.length; idx += 4) {
                if (idx % 65536 === 0) yield;
                for (let channel = 0; channel < 3; channel++) {
                    const value = samples[idx + channel]!;
                    const weight = value / quantum - 0.5;
                    const sample = Math.max(0, Math.min(quantum, Math.round(value + vector[channel]! * (quantum / 255) * (1 - 4 * weight * weight))));
                    if (data16) data16[idx + channel] = sample;
                    out[idx + channel] = data16 ? Math.round(sample / 257) : sample;
                }
            }
            return { ...image, data: out, ...(data16 ? { data16 } : {}) };
        };
    }
    else if (token === "-negate" || token === "+negate") {
        highDepth = true;
        const onlyGray = token === "+negate";
        const ch = state.channelExplicit ? state.channels : { r: true, g: true, b: true, a: true };
        apply = function* (im) {
            const out = new Uint8Array(im.data);
            const data16 = im.data16 ? new Uint16Array(im.data16) : undefined;
            const samples = data16 ?? out, range = data16 ? 65535 : 255;
            const mask = [ch.r, ch.g, ch.b, ch.a && im.hasAlpha];
            for (let idx = 0; idx < out.length; idx += 4) {
                if (idx % 65536 === 0) { signal?.throwIfAborted(); yield; }
                const gray = samples[idx] === samples[idx + 1] && samples[idx + 1] === samples[idx + 2];
                for (let c = 0; c < 4; c++) {
                    if ((!onlyGray || gray) && mask[c]) samples[idx + c] = range - samples[idx + c]!;
                    if (data16) out[idx + c] = clampByteVal(data16[idx + c]! / 257);
                }
            }
            return { ...im, data: out, ...(data16 ? { data16 } : {}) };
        };
    }
    else if (token === "-contrast" || token === "+contrast") {
        const sign = token === "-contrast" ? 1 : -1;
        apply = function* (image) {
            const out = new Uint8Array(image.data);
            for (let idx = 0; idx < out.length; idx += 4) {
                if (idx % 65536 === 0) yield;
                // Native ContrastImage changes HSV brightness, preserving hue, saturation and alpha.
                const brightness = Math.max(out[idx]!, out[idx + 1]!, out[idx + 2]!) / 255;
                const adjusted = brightness + sign * 0.5 * (0.5 * (Math.sin(Math.PI * (brightness - 0.5)) + 1) - brightness);
                for (let channel = 0; channel < 3; channel++) {
                    out[idx + channel] = clampByteVal(brightness === 0 ? 0 : out[idx + channel]! * adjusted / brightness);
                }
            }
            const { data16: ignored, ...metadata } = image;
            return { ...metadata, data: out };
        };
    }
    else if (token === "-sigmoidal-contrast" || token === "+sigmoidal-contrast") {
        highDepth = true;
        const raw = tokens[++i] ?? "";
        validateMagickTransformGeometry(raw, token);
        const [cStr, mStr] = raw.split("x");
        const strength = parseFloat(cStr ?? "");
        if (!Number.isFinite(strength)) {
            throw new Error(`invalid argument for option '${token}': ${raw}`);
        }
        const beta = Math.max(1e-4, strength);
        const mRaw = parseFloat(mStr || "50");
        const alpha = (mStr ?? "50%").endsWith("%") ? mRaw / 100 : mRaw / 65535;
        const sig = (u: number) => 1 / (1 + Math.exp(beta * (alpha - u)));
        const s0 = sig(0);
        const s1 = sig(1);
        const span = Math.max(1e-6, s1 - s0);
        const inverse = token === "+sigmoidal-contrast";
        const channels = state.channelExplicit ? state.channels : { r: true, g: true, b: true, a: true };
        apply = function* (im) {
            const mask = [channels.r, channels.g, channels.b, channels.a && im.hasAlpha];
            let pixelWork = 0;
            const out = new Uint8Array(im.data);
            const data16 = im.data16 ? new Uint16Array(im.data16) : undefined;
            const samples = data16 ?? out, range = data16 ? 65535 : 255;
            for (let idx = 0; idx < out.length; idx += 4) {
                if (++pixelWork % 16384 === 0)
                    yield;
                for (let c = 0; c < 4; c++) {
                    if (++pixelWork % 16384 === 0)
                        yield;
                    if (!mask[c])
                        continue;
                    const u = samples[idx + c]! / range;
                    const value = inverse
                        ? alpha - Math.log(1 / (s0 + u * span) - 1) / beta
                        : (sig(u) - s0) / span;
                    samples[idx + c] = Math.max(0, Math.min(range, Math.round(value * range)));
                    if (data16) out[idx + c] = clampByteVal(data16[idx + c]! / 257);
                }
            }
            return { ...im, data: out, ...(data16 ? { data16 } : {}) };
        };
    }
    else if (token === "-level" || token === "+level") {
        highDepth = true;
        const raw = tokens[++i] ?? "0,100%";
        if (!raw.trim() || [...raw].some(c => c.trim() !== "" && !"0123456789eExX!#%()+,-./:<>@\\^".includes(c))) {
            throw new Error(`invalid argument for option '${token}': ${raw}`);
        }
        const parts = raw.replaceAll("x", ",").split(",");
        const anyPct = raw.includes("%");
        const parsePt = (p: string | undefined, def: number) => {
            if (!p || p.length === 0)
                return def;
            if (p.endsWith("%") || anyPct) {
                return (parseFloat(p) / 100) * 255;
            }
            return parseFloat(p) / 257;
        };
        const black = parsePt(parts[0], 0);
        const white = parsePt(parts[1], 255 - black);
        const gamma = parts[2] !== undefined ? Math.max(0.01, parseFloat(parts[2])) : 1.0;
        const inverse = token === "+level";
        const channels = state.channelExplicit ? state.channels : { r: true, g: true, b: true, a: true };
        apply = function* (im) {
            const mask = [channels.r, channels.g, channels.b, channels.a && im.hasAlpha];
            let pixelWork = 0;
            const out = new Uint8Array(im.data);
            const data16 = im.data16 ? new Uint16Array(im.data16) : undefined;
            const samples = data16 ?? out, scale = data16 ? 257 : 1;
            const span = white === black ? 1e-6 : white - black;
            for (let idx = 0; idx < out.length; idx += 4) {
                if (++pixelWork % 16384 === 0)
                    yield;
                for (let c = 0; c < 4; c++) {
                    if (++pixelWork % 16384 === 0)
                        yield;
                    if (!mask[c])
                        continue;
                    const v = samples[idx + c]! / scale;
                    let value: number;
                    if (inverse) {
                        const gVal = Math.pow(Math.max(0, Math.min(1, v / 255)), gamma);
                        value = black + gVal * span;
                    }
                    else {
                        const norm = Math.max(0, Math.min(1, (v - black) / span));
                        value = Math.pow(norm, 1 / gamma) * 255;
                    }
                    samples[idx + c] = Math.max(0, Math.min(255 * scale, Math.round(value * scale)));
                    if (data16) out[idx + c] = clampByteVal(data16[idx + c]! / 257);
                }
            }
            return { ...im, data: out, ...(data16 ? { data16 } : {}) };
        };
    }
    else if (token === "-black-threshold" || token === "-white-threshold") {
        highDepth = true;
        const raw = tokens[++i] ?? "50%";
        if (!raw.trim() || [...raw].some(c => c.trim() !== "" && !"0123456789eExX!#%()+,-./:<>@\\^".includes(c))) {
            throw new Error(`invalid argument for option '${token}': ${raw}`);
        }
        const parts = raw.split(",");
        // Native recognizes four plain comma coordinates before processing percent signs.
        const coordinates = parts.length >= 4 && parts.slice(0, 3).every(part => part.trim() !== "" && Number.isFinite(Number(part)));
        const scale = raw.includes("%") && !coordinates ? 65535 / 100 : 1;
        // Only the first x separates threshold components; subsequent x values are ignored.
        const values = (parts.length > 1 ? parts : raw.toLowerCase().split("x").slice(0, 2)).map(part => parseFloat(part) * scale);
        const thresh = values[0]!;
        const thresholds = [thresh, values[1] ?? thresh, values[2] ?? thresh, values[3] ?? 65535];
        const isBlack = token === "-black-threshold";
        const channels = state.channels;
        apply = function* (im) {
            let pixelWork = 0;
            const out = new Uint8Array(im.data);
            const data16 = im.data16 ? new Uint16Array(im.data16) : undefined;
            const samples = data16 ?? out, quantumScale = data16 ? 1 : 257, maximum = data16 ? 65535 : 255;
            const mask = state.channelExplicit
                ? [channels.r, channels.g, channels.b, channels.a && im.hasAlpha]
                : [true, true, true, im.hasAlpha];
            for (let idx = 0; idx < out.length; idx += 4) {
                if (++pixelWork % 16384 === 0)
                    yield;
                const intensity = (0.212656 * samples[idx]! + 0.715158 * samples[idx + 1]! + 0.072186 * samples[idx + 2]!) * quantumScale;
                for (let channel = 0; channel < 4; channel++) {
                    const value = state.channelExplicit ? samples[idx + channel]! * quantumScale : intensity;
                    if (mask[channel] && (isBlack ? value < thresholds[channel]! : value > thresholds[channel]!)) {
                        samples[idx + channel] = isBlack ? 0 : maximum;
                        out[idx + channel] = isBlack ? 0 : 255;
                    }
                }
            }
            return { ...im, data: out, ...(data16 ? { data16 } : {}) };
        };
    }
    else return;
    return { end: i, apply, ...(warning ? { warning } : {}), evaluate: token === "-color-matrix" || token === "-function" || token === "-evaluate" || token === "-clamp" || token === "-solarize", highDepth: highDepth || token === "-colorspace" || token === "-grayscale" || token === "-type" };
}

function parseChannelSelections(expression: string): number[][] {
    const names = [["r", "red"], ["g", "green"], ["b", "blue"], ["a", "alpha"]];
    return expression.split(";").map(group => group.split(",").map(name => {
        const channel = names.findIndex(aliases => aliases.includes(name.trim().toLowerCase()));
        if (channel < 0) throw new Error(`unsupported channel-fx selection '${name}'`);
        return channel;
    }));
}

function* selectMagickChannels(image: RgbaImage, channels: number[]): Generator<void, RgbaImage> {
    const data = new Uint8Array(image.data), data16 = image.data16 ? new Uint16Array(image.data16) : undefined;
    for (let offset = 0; offset < data.length; offset += 4) {
        if (offset % 65536 === 0) yield;
        for (let target = 0; target < 3; target++) {
            const source = channels[target] ?? channels[0]!;
            data[offset + target] = source === 3 && !image.hasAlpha ? 255 : image.data[offset + source]!;
            if (data16) data16[offset + target] = source === 3 && !image.hasAlpha ? 65535 : image.data16![offset + source]!;
        }
    }
    return { ...image, data, ...(data16 ? { data16 } : {}), space: "srgb", channels: image.hasAlpha ? 4 : 3 };
}

function* separateMagickChannelSteps(image: RgbaImage, channel: 0 | 1 | 2 | 3): Generator<void, RgbaImage> {
    const missingChannel = channel === 3 ? !image.hasAlpha : channel !== 0 && (image.space === "b-w" || image.space === "grey16");
    const separated = yield* extractChannelImageSteps(missingChannel ? yield* ensureAlphaImageSteps({ ...image, hasAlpha: false }, 0) : image, missingChannel ? 3 : channel);
    if (!image.evaluateSamples) return separated;
    const evaluateSamples = new Float64Array(image.evaluateSamples.length);
    for (let offset = 0; offset < evaluateSamples.length; offset += 4) {
        if (offset % 65536 === 0) yield;
        const value = missingChannel ? 0 : image.evaluateSamples[offset + channel]!;
        evaluateSamples[offset] = evaluateSamples[offset + 1] = evaluateSamples[offset + 2] = value;
        evaluateSamples[offset + 3] = 255;
    }
    return { ...separated, evaluateSamples };
}

async function transformStoredMagickPixels(image: StoredRgbaImage, backend: CompareFileSession, operation: MagickPixelOperation, signal: AbortSignal, highDepth = false): Promise<StoredRgbaImage> {
    const size = image.width * image.height * 4, position = backend.storage.allocate(size);
    let result = image;
    let storedData16: StoredRgbaImage["storedData16"];
    let storedHueSamples: number | undefined;
    let storedEvaluateSamples: number | undefined;
    const chunkSize = operation.evaluate ? 2048 : 16384;
    for (let offset = 0; offset < size; offset += chunkSize) {
        if (offset % 1048576 === 0) await yieldTurn(signal);
        const data = await backend.storage.read(image.position + offset, Math.min(chunkSize, size - offset));
        const bytes16 = (highDepth || operation.highDepth) && image.storedData16 ? await backend.storage.read(image.storedData16.position + offset * 2, data.length * 2) : undefined;
        const data16 = bytes16 ? new Uint16Array(bytes16.buffer, bytes16.byteOffset, bytes16.byteLength / 2) : undefined;
        const floatBytes = (highDepth || operation.highDepth) && image.storedHueSamples !== undefined ? await backend.storage.read(image.storedHueSamples + offset * 8, data.length * 8) : undefined;
        const hueSamples = floatBytes ? new Float64Array(floatBytes.buffer.slice(floatBytes.byteOffset, floatBytes.byteOffset + floatBytes.byteLength)) : undefined;
        const evaluateBytes = operation.evaluate && image.storedEvaluateSamples !== undefined ? await backend.storage.read(image.storedEvaluateSamples + offset * 8, data.length * 8) : undefined;
        const evaluateSamples = evaluateBytes ? new Float64Array(evaluateBytes.buffer.slice(evaluateBytes.byteOffset, evaluateBytes.byteOffset + evaluateBytes.byteLength)) : undefined;
        const { storedEvaluateSamples: ignoredEvaluate, storedData16: ignoredSource, storedHueSamples: ignoredHue, ...inputMetadata } = image;
        const transformed = await drainSteps(operation.apply({ ...inputMetadata, width: data.length / 4, height: 1, data, ...(evaluateSamples ? {evaluateSamples} : {}), ...(data16 ? {data16} : {}), ...(hueSamples ? {hueSamples} : {}) }, offset / 4), signal);
        const { data: pixels, evaluateSamples: outputEvaluate, data16: output16, hueSamples: outputHue, ...metadata } = transformed;
        if (outputEvaluate) {
            storedEvaluateSamples ??= backend.storage.allocate(size * 8);
            await backend.storage.write(storedEvaluateSamples + offset * 8, new Uint8Array(outputEvaluate.buffer, outputEvaluate.byteOffset, outputEvaluate.byteLength));
        }
        if (outputHue) {
            storedHueSamples ??= backend.storage.allocate(size * 8);
            await backend.storage.write(storedHueSamples + offset * 8, new Uint8Array(outputHue.buffer, outputHue.byteOffset, outputHue.byteLength));
        }
        if (output16) {
            storedData16 ??= {position: backend.storage.allocate(size * 2), length: size};
            await backend.storage.write(storedData16.position + offset * 2, new Uint8Array(output16.buffer, output16.byteOffset, output16.byteLength));
        }
        await backend.storage.write(position + offset, pixels);
        result = { ...metadata, width: image.width, height: image.height, position, ...(storedEvaluateSamples === undefined ? {} : {storedEvaluateSamples}), ...(storedData16 ? {storedData16} : {}), ...(storedHueSamples === undefined ? {} : {storedHueSamples}) };
    }
    return result;
}

function* prepareMiffPages(stack: readonly MagickImage[]): Generator<void, RgbaImage> {
    const miffPages: RgbaImage[] = [];
    for (const frame of stack) { yield; miffPages.push(yield* prepareMagickOutput(frame, "miff")); }
    return { ...miffPages[0]!, miffPages };
}

function prepareStoredMiffPages(stack: StoredImageStack, image: StoredRgbaImage, backend: CompareFileSession, signal: AbortSignal): StoredRgbaImage {
    return { ...image, storedMiffPages: { length: stack.length, async at(index) {
        return prepareStoredMagickOutput((await stack.get(index))!, "miff", backend, signal);
    } } };
}

function* prepareTiffPages(stack: readonly MagickImage[]): Generator<void, RgbaImage> {
    const tiffPages: RgbaImage[] = [];
    for (const frame of stack) { yield; tiffPages.push(yield* prepareMagickOutput(frame, "tiff")); }
    return { ...tiffPages[0]!, tiffPages };
}

function prepareStoredTiffPages(stack: StoredImageStack, image: StoredRgbaImage, backend: CompareFileSession, signal: AbortSignal): StoredRgbaImage {
    return { ...image, storedTiffPages: { length: stack.length, async at(index) {
        return prepareStoredMagickOutput((await stack.get(index))!, "tiff", backend, signal);
    } } };
}

function* prepareIcoPages(stack: readonly MagickImage[], sizes?: readonly number[], kernel?: ResizeKernel, settings?: ResizeFilterSettings): Generator<void, RgbaImage> {
    const icoPages: RgbaImage[] = [];
    if (sizes) {
        const source = yield* prepareMagickOutput(stack[0]!, "ico");
        for (const size of sizes) icoPages.push(yield* applyMagickResizeSteps(source, `${size}x${size}!`, kernel, false, false, false, settings));
    } else for (const frame of stack) { yield; icoPages.push(yield* prepareMagickOutput(frame, "ico")); }
    return { ...icoPages[0]!, icoPages };
}

async function prepareStoredIcoPages(stack: StoredImageStack, image: StoredRgbaImage, backend: CompareFileSession, signal: AbortSignal, sizes?: readonly number[], kernel?: ResizeKernel, settings?: ResizeFilterSettings): Promise<StoredRgbaImage> {
    if (sizes) {
        const source = await prepareStoredMagickOutput((await stack.get(0))!, "ico", backend, signal);
        stack = new StoredImageStack(backend.storage, signal);
        for (const size of sizes) {
            const options = magickResizeOptions(source, `${size}x${size}!`, kernel)!;
            await stack.push(await resizeStoredMagickImage(source, backend, options, signal, false, false, false, settings));
        }
        image = (await stack.get(0))!;
    }
    return { ...image, storedIcoPages: { length: stack.length, async at(index) {
        return prepareStoredMagickOutput((await stack.get(index))!, "ico", backend, signal);
    } } };
}

function* prepareGifFrames(stack: readonly MagickImage[], dither: MagickState["dither"] = false, diffusionAmount = 1): Generator<void, RgbaImage> {
    let cooperativeWork = 0;
    let fw = 0, fh = 0;
    for (const frame of stack) { fw = Math.max(fw, frame.width); fh = Math.max(fh, frame.height); }
    const combined = new Uint8Array(fw * fh * stack.length * 4);
    const delays: number[] = [];
    const disposals: number[] = [];
    for (let idx = 0; idx < stack.length; idx++) {
        if (++cooperativeWork % 64 === 0) yield;
        const outputFrame = yield* prepareMagickOutput(stack[idx]!, "gif", dither, diffusionAmount);
        disposals.push(typeof outputFrame.disposal === "number" ? outputFrame.disposal : 0);
        delays.push(outputFrame.delay?.[(stack[idx] as MagickImage)[magickInput]?.sceneIdx ?? 0] ?? 0);
        for (let y = 0; y < outputFrame.height; y++) {
            if (++cooperativeWork % 64 === 0) yield;
            combined.set(outputFrame.data.subarray(y * outputFrame.width * 4, (y + 1) * outputFrame.width * 4), (idx * fw * fh + y * fw) * 4);
        }
    }
    return {
        ...(yield* prepareMagickOutput(stack[0]!, "gif", dither, diffusionAmount)),
        width: fw,
        height: fh * stack.length,
        pages: stack.length,
        pageHeight: fh,
        delay: delays,
        disposal: disposals,
        gifFrames: stack.map(frame => ({ icc: frame.icc, gifApplications: frame.gifApplications, comment: frame.properties?.comment, gifCommentBytes: frame.gifCommentBytes, width: frame.width, height: frame.height, x: frame.virtualCanvas?.x ?? 0, y: frame.virtualCanvas?.y ?? 0 })),
        data: combined
    };
}

async function prepareStoredGifFrames(stack: StoredImageStack, backend: CompareFileSession, signal: AbortSignal, dither: MagickState["dither"] = false, diffusionAmount = 1): Promise<StoredRgbaImage> {
    const first = await prepareStoredMagickOutput((await stack.get(0))!, "gif", backend, signal, dither, diffusionAmount);
    let width = first.width, height = first.height;
    for (let index = 1; index < stack.length; index++) {
        const frame = (await stack.get(index))!;
        width = Math.max(width, frame.width); height = Math.max(height, frame.height);
    }
    const size = width * height * 4, position = backend.storage.allocate(size * stack.length);
    for (let index = 0; index < stack.length; index++) {
        const frame = await prepareStoredMagickOutput((await stack.get(index))!, "gif", backend, signal, dither, diffusionAmount);
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x += 4096) {
            await yieldTurn(signal);
            const count = Math.min(4096, width - x), bytes = new Uint8Array(count * 4);
            if (y < frame.height && x < frame.width) bytes.set(await backend.storage.read(frame.position + (y * frame.width + x) * 4, Math.min(count, frame.width - x) * 4));
            await backend.storage.write(position + index * size + (y * width + x) * 4, bytes);
        }
    }
    const { storedData16: ignored, ...metadata } = first;
    return { ...metadata, position, width, height: height * stack.length, pages: stack.length, pageHeight: height,
        storedGifFrame: { async at(index) {
            const frame = (await stack.get(index))!;
            return { icc: frame.icc, gifApplications: frame.gifApplications, comment: frame.properties?.comment, gifCommentBytes: frame.gifCommentBytes, width: frame.width, height: frame.height, x: frame.virtualCanvas?.x ?? 0, y: frame.virtualCanvas?.y ?? 0 };
        } },
        storedDisposal: { length: stack.length, async at(index) {
            const frame = (await stack.get(index))!;
            return typeof frame.disposal === "number" ? frame.disposal : 0;
        } },
        storedDelay: { length: stack.length, async at(index) {
            const frame = (await stack.get(index))!;
            const scene = frame[magickInput]?.sceneIdx ?? 0;
            return await frame.storedDelay?.at(scene, { signal }) ?? frame.delay?.[scene] ?? 0;
        } }
    };
}

// Inactive alpha remains in the working pixels, but must not leak into encoded output.
function* prepareInactiveAlphaOutput(image: RgbaImage): Generator<void, RgbaImage, void> {
    if (image.hasAlpha) return image;
    const data = new Uint8Array(image.data);
    const data16 = image.data16 ? new Uint16Array(image.data16) : undefined;
    for (let index = 3; index < data.length; index += 4) {
        if (index % 65536 === 3) yield;
        data[index] = 255;
        if (data16) data16[index] = 65535;
    }
    return { ...image, data, ...(data16 ? { data16 } : {}) };
}

function* prepareMagickOutput(image: RgbaImage, format: ImageFormat, dither: MagickState["dither"] = false, diffusionAmount = 1, pngCoder?: ReturnType<typeof inferOutputFormat>["pngCoder"]): Generator<void, RgbaImage, void> {
    // Forced RGBA PNG coders enable blending, resetting copy-only alpha to opaque.
    if ((pngCoder === "png32" || pngCoder === "png64") && image.alphaBlend === false) image = yield* ensureAlphaImageSteps({ ...image, hasAlpha: false }, 1);
    if (format === "png" && image.properties) image = { ...image, properties: Object.fromEntries(Object.entries(image.properties).filter(([key]) => !key.toLowerCase().startsWith("artifact:"))) };
    if (format === "gif" && !image.isPalette && dither) image = { ...(yield* applyMagickRasterSteps(image, gifDitherSteps(image, dither, diffusionAmount))), isPalette: true };
    if (image.space === "cmyk" && format === "tiff") throw new Error("unsupported colorspace 'CMYK' for TIFF output");
    image = yield* prepareInactiveAlphaOutput(yield* prepareHueOutput(image, format));
    if (format === "gif" && image.format === "gif" && !image.backgroundColor) image = { ...image, backgroundColor: { r: image.data[0]!, g: image.data[1]!, b: image.data[2]!, a: 255 } };
    if (format === "miff") {
        const scene = (image as MagickImage)[magickInput]?.sceneIdx ?? 0;
        return { ...image, delay: [image.delay?.[scene] ?? image.delay?.[0] ?? 0], disposal: typeof image.disposal === "number" ? image.disposal : image.disposal?.[scene] ?? 0 };
    }
    if (format !== "pbm" && format !== "xbm") return image;
    const source = image.data16 ? { ...image, data: new Uint8Array(image.data16.buffer, image.data16.byteOffset, image.data16.byteLength) } : image;
    return yield* applyMagickRasterSteps({ ...image, space: "b-w", channels: 1, hasAlpha: false }, bilevelPixelSteps(image.width * image.height, !!image.data16), undefined, { ...image, hasAlpha: false }, [source]);
}

async function prepareStoredMagickOutput(image: StoredRgbaImage, format: ImageFormat, backend: CompareFileSession, signal: AbortSignal, dither: MagickState["dither"] = false, diffusionAmount = 1, pngCoder?: ReturnType<typeof inferOutputFormat>["pngCoder"]): Promise<StoredRgbaImage> {
    if ((pngCoder === "png32" || pngCoder === "png64") && image.alphaBlend === false) {
        image = await transformStoredMagickPixels(image, backend, { end: 0, highDepth: true, apply: frame => ensureAlphaImageSteps({ ...frame, hasAlpha: false }, 1) }, signal);
    }
    if (format === "png" && image.properties) image = { ...image, properties: Object.fromEntries(Object.entries(image.properties).filter(([key]) => !key.toLowerCase().startsWith("artifact:"))) };
    if (format === "gif" && !image.isPalette && dither) image = { ...(await transformStoredMagickRaster(image, backend, gifDitherSteps(image, dither, diffusionAmount), signal)), isPalette: true };
    if (image.space === "cmyk" && format === "tiff") throw new Error("unsupported colorspace 'CMYK' for TIFF output");
    if (image.magickColorspace === "HSL" || image.magickColorspace === "HSB" || image.magickColorspace === "HWB" || image.magickColorspace === "XYZ" || image.magickColorspace === "YCbCr" || image.magickColorspace === "YUV" || image.magickColorspace === "CIELab") {
        image = await transformStoredMagickPixels(image, backend, { end: 0, highDepth: true, apply: frame => prepareHueOutput(frame, format) }, signal);
    }
    if (!image.hasAlpha) image = await transformStoredMagickPixels(image, backend, { end: 0, highDepth: true, apply: prepareInactiveAlphaOutput }, signal);
    if (format === "gif" && image.format === "gif" && !image.backgroundColor) {
        const pixel = await backend.storage.read(image.position, 4);
        image = { ...image, backgroundColor: { r: pixel[0]!, g: pixel[1]!, b: pixel[2]!, a: 255 } };
    }
    if (format === "miff") {
        const scene = (image as StoredMagickImage)[magickInput]?.sceneIdx ?? 0;
        const frame = { ...image, delay: [await image.storedDelay?.at(scene, { signal }) ?? image.delay?.[scene] ?? image.delay?.[0] ?? 0], disposal: typeof image.disposal === "number" ? image.disposal : image.disposal?.[scene] ?? 0 };
        delete frame.storedDelay;
        return frame;
    }
    if (format !== "pbm" && format !== "xbm") return image;
    const source = image.storedData16 ? { ...image, position: image.storedData16.position } : image;
    return transformStoredMagickRaster({ ...image, space: "b-w", channels: 1, hasAlpha: false }, backend, bilevelPixelSteps(image.width * image.height, !!image.storedData16), signal, { ...image, hasAlpha: false }, [source]);
}

function parseMagickDisposal(value: string): number {
    const names = ["undefined", "none", "background", "previous"];
    const disposal = names.indexOf(value.toLowerCase());
    if (disposal >= 0) return disposal;
    if (["0", "1", "2", "3"].includes(value)) return Number(value);
    return 0;
}

function parseMagickOrientation(value: string): number {
    const orientation = ["undefined", "topleft", "topright", "bottomright", "bottomleft", "lefttop", "righttop", "rightbottom", "leftbottom"].indexOf(value.toLowerCase());
    if (orientation < 0) throw new Error(`unrecognized image orientation '-orient' '${value}'`);
    return orientation;
}

function parseMagickUnits(value: string): NonNullable<MagickState["units"]> {
    switch (value.toLowerCase()) {
        case "pixelsperinch": return "inch";
        case "pixelspercentimeter": return "cm";
        case "undefined": return "unknown";
        default: throw new Error(`unrecognized units type '-units' '${value}'`);
    }
}

function applyMagickUnits<T extends ImageMetadata & { magickUnits?: MagickState["units"] }>(image: T, unit: NonNullable<MagickState["units"]>): T {
    if (!image.resolution) return { ...image, magickUnits: unit };
    const scale = image.resolution?.unit === "meter" ? 100 : 1;
    const x = image.resolution.x / scale;
    const y = image.resolution.y / scale;
    return { ...image, density: x * (unit === "cm" ? 2.54 : 1), resolution: { x, y, unit } };
}

function magickResampleGeometry(image: ImageMetadata, value: string): string {
    const geometry = parseMagickGeometry(value);
    const x = geometry.width ?? 72, y = geometry.height ?? x;
    if (!(x > 0) || !(y > 0)) throw new Error(`invalid argument '-resample' '${value}'`);
    const scale = image.resolution?.unit === "meter" ? 100 : 1;
    const sourceX = (image.resolution ? image.resolution.x / scale : image.density) || 72;
    const sourceY = (image.resolution ? image.resolution.y / scale : image.density) || 72;
    return `${Math.max(1, Math.round(image.width * x / sourceX))}x${Math.max(1, Math.round(image.height * y / sourceY))}!`;
}

function updateMagickProperty(properties: ImageMetadata["properties"], key: string, value?: string): Record<string, string> {
    const normalized = key.toLowerCase();
    const updated = Object.fromEntries(Object.entries(properties ?? {}).filter(([name]) => name.toLowerCase() !== normalized));
    if (value !== undefined) updated[key] = value;
    return updated;
}

function applyMagickDensity<T extends ImageMetadata & { magickUnits?: MagickState["units"] }>(image: T, value: string): T {
    const geometry = parseMagickGeometry(value);
    const x = geometry.width ?? 72, y = geometry.height ?? x;
    const unit = image.resolution?.unit ?? image.magickUnits ?? "unknown";
    const scale = unit === "meter" ? 100 : 1;
    return { ...image, density: x * (unit === "cm" || unit === "meter" ? 2.54 : 1),
        resolution: { x: x * scale, y: y * scale, unit } };
}

function applyMagickReadSetting(tokens: readonly string[], state: MagickState, start: number): number | undefined {
    let i = start;
    const t = tokens[i];
if (t === "-seed") {
            state.seed = Number(tokens[++i] ?? 0);
            if (!Number.isSafeInteger(state.seed) || state.seed < 0) throw new Error("Invalid random seed");
        }
        else if (t === "-precision") {
            const value = tokens[++i], requested = Number(value);
            if (value === undefined || !value.trim() || !Number.isFinite(requested)) throw new Error("invalid argument for option '-precision'");
            state.precision = requested < 1 ? 6 : Math.min(100, Math.trunc(requested));
        }
        else if (t === "-treedepth") {
            const value = tokens[++i], depth = Number(value);
            if (value === undefined || !value.trim() || !Number.isSafeInteger(depth) || depth < 0) throw new Error("invalid argument for option '-treedepth'");
            state.treeDepth = depth;
        }
        else if (t === "+treedepth") { delete state.treeDepth; }
        else if (t === "-quantize") {
            state.quantizeGray = (tokens[++i] ?? "").toLowerCase() === "gray";
        }
        else if (t === "+quantize") {
            state.quantizeGray = false;
        }
        else if (t === "-intensity") {
            const method = (tokens[++i] ?? "").toLowerCase();
            if (!["undefined", "average", "mean", "brightness", "lightness", "ms", "rms", "rec601luma", "rec601luminance", "rec709luma", "rec709luminance"].includes(method)) {
                throw new Error(`unrecognized intensity method '${tokens[i] ?? ""}'`);
            }
            state.intensity = method === "undefined" ? "rec709luma" : method;
        }
        else if (t === "+intensity") { state.intensity = "rec709luma"; }
        else if (t === "-channel") {
            state.channels = parseChannelMask(tokens[++i] ?? "rgb");
            state.channelExplicit = true;
        }
        else if (t === "+channel") {
            state.channels = { r: true, g: true, b: true, a: false };
            state.channelExplicit = false;
        }
        else if (t === "-depth") {
            state.inputDepth = Number(tokens[++i]);
            if (!Number.isInteger(state.inputDepth) || state.inputDepth < 1) throw new Error("invalid input depth");
        }
        else if (t === "-interlace") {
            const interlace = (tokens[++i] ?? "").toLowerCase();
            if (interlace !== "plane" && interlace !== "line" && interlace !== "none" && interlace !== "png" && interlace !== "gif") throw new Error(`unsupported interlace type '${interlace}'`);
            state.jpegProgressive = interlace === "plane" || interlace === "line";
            state.tiffPlanar = interlace === "plane";
            state.pngInterlace = interlace === "png";
            state.gifInterlace = interlace === "gif";
        }
        else if (t === "+interlace") { delete state.jpegProgressive; delete state.tiffPlanar; delete state.pngInterlace; delete state.gifInterlace; }
        else if (t === "-compress") {
            const compression = (tokens[++i] ?? "").toLowerCase();
            const method = ({ none: "none", lzw: "lzw", zip: "deflate", rle: "packbits", jpeg: "jpeg", bzip: "none" } as const)[compression as "none" | "lzw" | "zip" | "rle" | "jpeg" | "bzip"];
            if (method === undefined) throw new Error(`unsupported compression '${compression}'`);
            state.tiffCompression = method;
            state.miffCompression = compression === "zip" || compression === "rle" || compression === "bzip" ? compression : "none";
            state.tgaCompression = compression === "rle" ? "rle" : "none";
            state.bmpCompression = compression === "rle" ? "rle" : "none";
            state.netpbmAscii = compression === "none";
        }
        else if (t === "+compress") { delete state.netpbmAscii; delete state.tiffCompression; delete state.bmpCompression; delete state.tgaCompression; delete state.miffCompression; }
        else if (t === "+depth") { delete state.inputDepth; }
        else if (t === "-endian") {
            const endian = (tokens[++i] ?? "").toLowerCase();
            if (!["msb", "lsb", "undefined"].includes(endian)) throw new Error(`unrecognized endian type '${endian}'`);
            state.inputEndian = endian;
        }
        else if (t === "+endian") { delete state.inputEndian; }
        else if (t === "-page") {
            const value = tokens[++i] ?? "";
            validateMagickTransformGeometry(value, t);
            const geometry = parseMagickGeometry(value);
            state.page = { width: geometry.width ?? 0, height: geometry.height ?? 0, x: geometry.x, y: geometry.y };
        }
        else if (t === "+page") { delete state.page; }
        else if (t === "-tile-offset") {
            const value = tokens[++i] ?? "";
            validateMagickTransformGeometry(value, t);
            const geometry = parseMagickGeometry(value);
            state.tileOffset = { x: geometry.x, y: geometry.y };
        }
        else if (t === "+tile-offset") { delete state.tileOffset; }
        else if (t === "-size") {
            const g = parseMagickGeometry(tokens[++i] ?? "1x1");
            state.sizeWidth = Math.max(1, Math.round(g.width ?? 1));
            state.sizeHeight = Math.max(1, Math.round(g.height ?? state.sizeWidth));
            state.hasSize = true;
        }
        else if (t === "+size") {
            state.hasSize = false;
        }
        else if (t === "-virtual-pixel") {
            const method = (tokens[++i] ?? "").toLowerCase();
            if (method !== "edge" && method !== "background" && method !== "transparent" && method !== "black" && method !== "white" && method !== "gray" && method !== "tile" && method !== "mirror" && method !== "horizontal-tile" && method !== "vertical-tile" && method !== "checker-tile" && method !== "horizontal-tile-edge" && method !== "vertical-tile-edge") throw new Error(`Unsupported virtual-pixel method: ${method}`);
            state.virtualPixel = method;
        }
        else if (t === "+virtual-pixel") {
            delete state.virtualPixel;
        }
        else if (t === "-background") {
            state.background = parseColor(tokens[++i] ?? "#ffffff", true);
            state.backgroundExplicit = true;
        }
        else if (t === "-fill") {
            state.fill = parseColor(tokens[++i] ?? "#000000");
            state.tile = undefined;
        }
        else if (t === "-antialias" || t === "+antialias") {
            state.antialias = t === "-antialias";
        }
        else if (t === "-stroke") {
            state.stroke = parseColor(tokens[++i] ?? "#000000");
        }
        else if (t === "-strokewidth") {
            state.strokeWidth = Math.max(0, Number(tokens[++i] ?? 1));
        }
        else if (t === "-mattecolor") {
            state.matteColor = parseColor(tokens[++i] ?? "#bdbdbd");
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
        else if (t === "-comment" || t === "-label") {
            state[t === "-comment" ? "comment" : "label"] = tokens[++i] ?? "";
        }
        else if (t === "-sampling-factor") {
            state.samplingFactor = tokens[++i] ?? "";
        }
        else if (t === "+sampling-factor") {
            delete state.samplingFactor;
        }
        else if (t === "-quality") {
            state.quality = Math.max(1, Math.min(100, Number(tokens[++i] ?? 92)));
        }
        else if (t === "-density") {
            const g = parseMagickGeometry(tokens[++i] ?? "72");
            state.density = Math.max(1, Math.round(g.width ?? 72));
        }
        else if (t === "+fuzz") {
            state.alphaFuzz = 0;
            state.fuzz = 0;
        }
        else if (t === "-fuzz") {
            const rawFuzz = tokens[++i] ?? "";
            const value = rawFuzz.endsWith("%") ? rawFuzz.slice(0, -1) : rawFuzz;
            const fuzz = Number(value);
            if (value.trim() === "" || !Number.isFinite(fuzz)) {
                throw new Error(`invalid argument for option '-fuzz': ${rawFuzz}`);
            }
            // Keep existing color-operation tolerance; alpha uses native Q16 units.
            state.alphaFuzz = rawFuzz.endsWith("%") ? fuzz * 255 / 100 : fuzz / 257;
            state.fuzz = rawFuzz.endsWith("%")
                ? Math.round((fuzz / 100) * 255)
                : Math.round(fuzz);
        }
        else if (t === "-interpolate") {
            const method = (tokens[++i] ?? "").toLowerCase();
            if (method === "nearest" || method === "nearest-neighbor") state.interpolation = "nearest";
            else if (method === "integer" || method === "average" || method === "bilinear" || method === "mesh") state.interpolation = method;
            else throw new Error(`unrecognized interpolate method '${method}'`);
        }
        else if (t === "+interpolate") {
            delete state.interpolation;
        }
        else if (t === "-filter") {
            const filter = tokens[++i] ?? "lanczos";
            state.kernel = parseKernel(filter);
            state.pointFilter = filter.toLowerCase() === "point";
        }
        else if (t === "+filter") {
            state.kernel = undefined;
            delete state.pointFilter;
        }
        else if (t === "-compose") {
            const cRaw = tokens[++i] ?? "over";
            state.composeRaw = cRaw;
            state.compose = parseCompose(cRaw);
        }
        else if (t === "+define") {
            const key = (tokens[++i] ?? "").toLowerCase();
            if (key === "connected-components:verbose") delete state.connectedVerbose;
            if (key === "filter:blur" || key === "filter:support" || key === "filter:lobes" || key === "filter:b" || key === "filter:c" || key === "filter:sigma" || key === "filter:window") {
                state.resizeFilter = { ...state.resizeFilter };
                delete state.resizeFilter[key.slice(7) as keyof ResizeFilterSettings];
            }
            if (key === "distort:scale") delete state.distortScale;
            if (key === "sample:offset") delete state.sampleOffset;
            if (key === "distort:viewport") delete state.distortViewport;
            if (key === "jpeg:arithmetic-coding") delete state.jpegArithmeticCoding;
            if (key === "jpeg:restart-interval") delete state.jpegRestartInterval;
            if (key === "jpeg:dct-method") delete state.jpegDctMethod;
            if (key === "webp:use-sharp-yuv") delete state.webpSmartSubsample;
            if (key === "webp:exact") delete state.webpExact;
            if (key === "webp:alpha-compression") delete state.webpAlphaCompression;
            if (key === "webp:alpha-quality") delete state.webpAlphaQuality;
            if (key === "jpeg:optimize-coding") delete state.jpegOptimizeCoding;
            if (key === "webp:target-size") delete state.webpTargetSize;
            if (key === "webp:pass") delete state.webpPass;
            if (key === "webp:method") delete state.webpMethod;
            if (key === "webp:lossless") delete state.webpLossless;
            if (key === "jpeg:extent") delete state.jpegExtent;
            if (key === "png:preserve-colormap") delete state.pngPreserveColormap;
            if (key === "gradient:bounding-box") delete state.gradientBoundingBox;
            if (key === "gradient:direction") delete state.gradientDirection;
            if (key === "gradient:angle") delete state.gradientAngle;
            if (key === "gradient:radii") delete state.gradientRadii;
            if (key === "gradient:extent") delete state.gradientExtent;
            if (key === "gradient:vector") delete state.gradientVector;
            if (key === "gradient:center") delete state.gradientCenter;
            if (key === "filename:literal") delete state.filenameLiteral;
            if (key === "ftxt:format") delete state.ftxtFormat;
            if (key === "icon:auto-resize") delete state.iconAutoResize;
            if (key === "bmp:format") delete state.bmpFormat;
            if (key === "bmp:subtype") delete state.bmpSubtype;
            if (key === "bmp3:alpha") delete state.bmp3Alpha;
            if (key === "hough-lines:accumulator") delete state.houghAccumulator;
            if (key === "deskew:auto-crop") delete state.deskewAutoCrop;
            if (key === "trim:minsize") delete state.trimMinSize;
            if (key === "connected-components:background-id") delete state.connectedBackgroundId;
            if (key === "connected-components:area-threshold") delete state.connectedAreaThreshold;
            if (key === "connected-components:keep-top") delete state.connectedKeepTop;
            if (key === "connected-components:sort") delete state.connectedSort;
            if (key === "connected-components:sort-order") delete state.connectedSortOrder;
            if (key === "connected-components:angle-threshold") delete state.connectedAngleThreshold;
            if (key === "connected-components:perimeter-threshold") delete state.connectedPerimeterThreshold;
            if (key === "connected-components:minor-axis-threshold") delete state.connectedMinorAxisThreshold;
            if (key === "connected-components:eccentricity-threshold") delete state.connectedEccentricityThreshold;
            if (key === "connected-components:diameter-threshold") delete state.connectedDiameterThreshold;
            if (key === "connected-components:circularity-threshold") delete state.connectedCircularityThreshold;
            if (key === "connected-components:major-axis-threshold") delete state.connectedMajorAxisThreshold;
            if (key === "connected-components:keep") delete state.connectedKeep;
            if (key === "connected-components:remove-colors") delete state.connectedRemoveColors;
            if (key === "connected-components:keep-colors") delete state.connectedKeepColors;
            if (key === "connected-components:remove") delete state.connectedRemove;
            if (key === "connected-components:exclude-header") delete state.connectedExcludeHeader;
            if (key === "connected-components:exclude-ids") delete state.connectedExcludeIds;
            if (key === "connected-components:mean-color") delete state.connectedMeanColor;
            if (key === "trim:percent-background") delete state.trimPercentBackground;
            if (key === "tiff:tile-geometry") delete state.tiffTile;
            if (key === "quantum:format") { delete state.tiffFloatingPoint; delete state.tiffSigned; }
            if (key === "tiff:alpha") delete state.tiffAlpha;
            if (key === "tiff:endian") delete state.tiffEndian;
            if (key === "tiff:rows-per-strip") delete state.tiffRowsPerStrip;
            if (key === "dither:diffusion-amount") delete state.diffusionAmount;
            if (key === "modulate:colorspace") delete state.modulateColorspace;
            if (key === "magnify:method") delete state.magnifyMethod;
            if (key === "trim:edges") delete state.trimEdges;
        }
        else if (t === "-define") {
            const defStr = tokens[++i] ?? "";
            if (defStr.toLowerCase().startsWith("distort:viewport=")) state.distortViewport = defStr.slice("distort:viewport=".length);
            if (defStr.toLowerCase().startsWith("magnify:method=")) state.magnifyMethod = parseMagnifyMethod(defStr.slice("magnify:method=".length));
            const [filterKey, filterValue] = defStr.toLowerCase().split("=");
            if (filterKey === "distort:scale") state.distortScale = filterValue ?? "";
            if (filterKey === "gradient:bounding-box") state.gradientBoundingBox = parseMagickGeometry(filterValue ?? "");
            if (filterKey === "gradient:radii") state.gradientRadii = filterValue ?? "";
            if (filterKey === "gradient:extent") state.gradientExtent = filterValue ?? "";
            if (filterKey === "gradient:vector") state.gradientVector = filterValue ?? "";
            if (filterKey === "gradient:center") {
              const coordinates = (filterValue ?? "").replaceAll(",", " ").split(" ").filter(Boolean).map(Number);
              if (coordinates.length === 2 && coordinates.every(Number.isFinite)) state.gradientCenter = { x: coordinates[0]!, y: coordinates[1]! };
            }
            if (filterKey === "gradient:direction") state.gradientDirection = filterValue ?? "south";
            if (filterKey === "gradient:angle") state.gradientAngle = Number.parseFloat(filterValue ?? "") || 0;
            if (filterKey === "filename:literal") state.filenameLiteral = filterValue === undefined || ["true", "1", "yes", "on"].includes(filterValue);
            if (filterKey === "dither:diffusion-amount") {
                const amount = parseFloat(filterValue ?? "");
                state.diffusionAmount = Number.isFinite(amount) ? amount / (filterValue?.includes("%") ? 100 : 1) : 0;
            }
            if (filterKey === "modulate:colorspace") state.modulateColorspace = filterValue ?? "hsl";
            if (filterKey === "sample:offset") {
                const geometry = parseMagickGeometry(filterValue ?? "");
                const x = geometry.width ?? 0;
                state.sampleOffset = { x: x / 100, y: (geometry.height ?? x) / 100 };
            }
            if (filterKey === "jpeg:arithmetic-coding") state.jpegArithmeticCoding = filterValue === undefined || ["true", "1", "yes", "on"].includes(filterValue.toLowerCase());
            if (filterKey === "jpeg:restart-interval") {
                const interval = Number(filterValue);
                if (!filterValue?.trim() || !Number.isInteger(interval) || interval < 0 || interval > 65535) throw new Error("JPEG restart interval must be an integer from 0 to 65535");
                state.jpegRestartInterval = interval;
            }
            if (filterKey === "jpeg:dct-method") state.jpegDctMethod = filterValue === "integer" || filterValue === "float" ? filterValue : "fastest";
            if (filterKey === "webp:use-sharp-yuv") state.webpSmartSubsample = filterValue === undefined || ["true", "1", "yes", "on"].includes(filterValue);
            if (filterKey === "webp:exact") state.webpExact = filterValue === undefined || ["true", "1", "yes", "on"].includes(filterValue);
            if (filterKey === "jpeg:optimize-coding") state.jpegOptimizeCoding = filterValue === undefined || ["true", "1", "yes", "on"].includes(filterValue);
            if (filterKey === "webp:alpha-compression") {
                const compression = Number(filterValue);
                if (!filterValue?.trim() || (compression !== 0 && compression !== 1)) throw new Error("webp:alpha-compression must be 0 or 1");
                state.webpAlphaCompression = compression;
            }
            if (filterKey === "webp:alpha-quality") {
                const quality = Number(filterValue);
                if (filterValue === undefined || filterValue.trim() === "" || !Number.isInteger(quality) || quality < 0 || quality > 100) throw new Error("webp:alpha-quality must be an integer from 0 to 100");
                state.webpAlphaQuality = quality;
            }
            if (filterKey === "webp:target-size") {
                const size = Number(filterValue);
                if (!filterValue?.trim() || !Number.isInteger(size) || size < 0 || size > 2147483647) throw new Error("webp:target-size must be an integer from 0 to 2147483647");
                state.webpTargetSize = size;
            }
            if (filterKey === "webp:pass") {
                const passes = Number(filterValue);
                if (!filterValue?.trim() || !Number.isInteger(passes) || passes < 1 || passes > 10) throw new Error("webp:pass must be an integer from 1 to 10");
                state.webpPass = passes;
            }
            if (filterKey === "webp:method") {
                const method = Number(filterValue);
                if (filterValue === undefined || filterValue.trim() === "" || !Number.isInteger(method) || method < 0 || method > 6) throw new Error("webp:method must be an integer from 0 to 6");
                state.webpMethod = method;
            }
            if (filterKey === "webp:lossless") state.webpLossless = filterValue === undefined || ["true", "1", "yes", "on"].includes(filterValue);
            if (filterKey === "jpeg:extent") {
                const value = (filterValue ?? "").trim();
                const suffix = ["kib", "mib", "gib", "kb", "mb", "gb", "k", "m", "g", "b"].find(unit => value.endsWith(unit));
                const amount = Number(suffix ? value.slice(0, -suffix.length) : value);
                const power = suffix ? "kmg".indexOf(suffix[0]!) + 1 : 0;
                const bytes = amount * (suffix?.includes("i") ? 1024 : 1000) ** power;
                if (!Number.isFinite(bytes) || bytes <= 0) throw new Error(`Invalid JPEG extent: ${filterValue ?? ""}`);
                state.jpegExtent = bytes;
            }
            if (filterKey === "filter:b" || filterKey === "filter:c" || filterKey === "filter:sigma") {
                const value = Number(filterValue);
                if (!filterValue?.trim() || !Number.isFinite(value) || (filterKey === "filter:sigma" && value <= 0)) throw new Error(`Invalid filter define: ${defStr}`);
                state.resizeFilter = { ...state.resizeFilter, [filterKey.slice(7)]: value };
            }
            if (filterKey === "filter:window") {
                if (!["box", "bartlett", "blackman", "bohman", "cosine", "hamming", "hann", "kaiser", "parzen", "welch", "sinc", "sincfast"].includes(filterValue ?? "")) throw new Error(`Unsupported filter window: ${filterValue ?? ""}`);
                state.resizeFilter = { ...state.resizeFilter, window: parseKernel(filterValue!) };
            }
            if (filterKey === "filter:blur" || filterKey === "filter:support" || filterKey === "filter:lobes") {
                const value = Number(filterValue);
                if (!Number.isFinite(value)) throw new Error(`Invalid filter define: ${defStr}`);
                state.resizeFilter = { ...state.resizeFilter, [filterKey.slice(7)]: filterKey === "filter:lobes" ? Math.max(1, Math.trunc(value)) : filterKey === "filter:support" ? Math.abs(value) : Math.max(1e-12, value) };
            }
            if (defStr.toLowerCase().startsWith("ftxt:format=")) state.ftxtFormat = defStr.slice("ftxt:format=".length);
            if (defStr.toLowerCase() === "icon:auto-resize" || defStr.toLowerCase().startsWith("icon:auto-resize=")) {
                const value = defStr.slice("icon:auto-resize".length + 1);
                const sizes = value ? value.split(",").map(Number) : [256, 192, 128, 96, 64, 48, 40, 32, 24, 16];
                if (sizes.length > 65535 || sizes.some(size => !Number.isInteger(size) || size < 1 || size > 256)) throw new Error("Invalid icon:auto-resize dimensions (expected integers from 1 to 256)");
                state.iconAutoResize = sizes;
            }
            if (defStr.toLowerCase().startsWith("bmp:subtype=")) {
                const subtype = defStr.slice("bmp:subtype=".length).toUpperCase();
                delete state.bmpSubtype;
                if (subtype === "RGB565" || subtype === "RGB555" || subtype === "ARGB4444" || subtype === "ARGB1555") state.bmpSubtype = subtype;
            }
            if (defStr.toLowerCase().startsWith("bmp:format=")) {
                const version = defStr.slice("bmp:format=".length).toLowerCase();
                if (version === "bmp2" || version === "bmp3" || version === "bmp4") state.bmpFormat = version;
            }
            if (defStr.toLowerCase().startsWith("bmp3:alpha=")) state.bmp3Alpha = ["true", "1", "yes", "on"].includes(defStr.split("=")[1]!.toLowerCase());
            if (defStr.toLowerCase().startsWith("hough-lines:accumulator=")) state.houghAccumulator = ["true", "1", "yes", "on"].includes(defStr.split("=")[1]!.toLowerCase());
            if (defStr.toLowerCase().startsWith("deskew:auto-crop=")) state.deskewAutoCrop = defStr.slice("deskew:auto-crop=".length).toLowerCase();
            if (defStr.toLowerCase().startsWith("trim:percent-background=")) state.trimPercentBackground = Number.parseFloat(defStr.slice("trim:percent-background=".length)) || 0;
            if (defStr.toLowerCase().startsWith("trim:edges=")) state.trimEdges = defStr.slice("trim:edges=".length);
            if (defStr.toLowerCase().startsWith("trim:minsize=")) state.trimMinSize = parseMagickGeometry(defStr.slice("trim:minsize=".length));
            if (defStr.toLowerCase().startsWith("quantum:format=")) state.tiffFloatingPoint = defStr.slice("quantum:format=".length).toLowerCase() === "floating-point";
            if (defStr.toLowerCase().startsWith("quantum:format=")) state.tiffSigned = defStr.slice("quantum:format=".length).toLowerCase() === "signed";
            if (defStr.toLowerCase().startsWith("tiff:alpha=")) {
                const alpha = defStr.slice("tiff:alpha=".length).toLowerCase();
                if (alpha === "associated" || alpha === "unassociated" || alpha === "unspecified") state.tiffAlpha = alpha;
            }
            if (defStr.toLowerCase().startsWith("tiff:endian=")) {
                const endian = defStr.slice("tiff:endian=".length).toLowerCase();
                if (endian === "msb" || endian === "lsb") state.tiffEndian = endian;
            }
            if (defStr.toLowerCase().startsWith("tiff:rows-per-strip=")) {
                const rows = Number(defStr.slice("tiff:rows-per-strip=".length));
                if (Number.isSafeInteger(rows) && rows > 0 && rows <= 0xffffffff) state.tiffRowsPerStrip = rows;
            }
            if (defStr.toLowerCase().split("=")[0] === "png:preserve-colormap") state.pngPreserveColormap = !["false", "0", "no", "off"].includes((defStr.split("=")[1] ?? "true").toLowerCase());
            if (defStr.toLowerCase().startsWith("png:color-type=")) state.pngColorType = defStr.slice("png:color-type=".length);
            if (defStr.toLowerCase().startsWith("png:bit-depth=")) {
                const depth = Number(defStr.slice("png:bit-depth=".length));
                if (depth === 8 || depth === 16) state.pngBitDepth = depth;
            }
            if (defStr.toLowerCase().startsWith("png:exclude-chunk=")) {
                state.omitPngResolution = defStr.slice("png:exclude-chunk=".length).split(",").some(chunk => ["phys", "all"].includes(chunk.trim().toLowerCase()));
            }
            if (defStr.toLowerCase().startsWith("connected-components:")) {
                const [key, value, extra] = defStr.toLowerCase().split("=");
                if (key === "connected-components:verbose") {
                    if (extra !== undefined || !["true", "false", "1", "0", "yes", "no", "on", "off"].includes(value ?? "")) throw new Error(`Unsupported connected-components define: ${defStr}`);
                    state.connectedVerbose = ["true", "1", "yes", "on"].includes(value!);
                } else if (key === "connected-components:sort") {
                    if (extra !== undefined || (value !== "x" && value !== "area")) throw new Error(`Unsupported connected-components define: ${defStr}`);
                    state.connectedSort = value;
                } else if (key === "connected-components:sort-order") {
                    if (extra !== undefined || (value !== "increasing" && value !== "decreasing")) throw new Error(`Unsupported connected-components define: ${defStr}`);
                    state.connectedSortOrder = value;
                } else if (key === "connected-components:diameter-threshold" || key === "connected-components:eccentricity-threshold" || key === "connected-components:minor-axis-threshold" || key === "connected-components:perimeter-threshold" || key === "connected-components:angle-threshold" || key === "connected-components:major-axis-threshold" || key === "connected-components:circularity-threshold") {
                    const bounds = value?.trim().split("-").map(part => part.trim()) ?? [];
                    if (extra !== undefined || bounds.length < 1 || bounds.length > 2 || bounds.some(part => !part || !Number.isFinite(Number(part)) || Number(part) < 0)) throw new Error(`Unsupported connected-components define: ${defStr}`);
                    const threshold = [Number(bounds[0]), bounds.length === 2 ? Number(bounds[1]) : Infinity];
                    if (key === "connected-components:angle-threshold") state.connectedAngleThreshold = threshold;
                    else if (key === "connected-components:major-axis-threshold") state.connectedMajorAxisThreshold = threshold;
                    else if (key === "connected-components:diameter-threshold") state.connectedDiameterThreshold = threshold;
                    else if (key === "connected-components:minor-axis-threshold") state.connectedMinorAxisThreshold = threshold;
                    else if (key === "connected-components:eccentricity-threshold") state.connectedEccentricityThreshold = threshold;
                    else if (key === "connected-components:circularity-threshold") state.connectedCircularityThreshold = threshold;
                    else state.connectedPerimeterThreshold = threshold;
                } else if (key === "connected-components:keep-top") {
                    const count = Number(value);
                    if (extra !== undefined || !value?.trim() || !Number.isSafeInteger(count) || count < 0) throw new Error(`Unsupported connected-components define: ${defStr}`);
                    state.connectedKeepTop = count;
                } else if (key === "connected-components:remove-colors" || key === "connected-components:keep-colors") {
                    if (extra !== undefined || !value?.trim()) throw new Error(`Unsupported connected-components define: ${defStr}`);
                    const colors = value.split(";").map(color => parseColor(color, true));
                    if (key === "connected-components:keep-colors") state.connectedKeepColors = colors;
                    else state.connectedRemoveColors = colors;
                } else if (key === "connected-components:keep" || key === "connected-components:remove") {
                    if (extra !== undefined || !value?.trim()) throw new Error(`Unsupported connected-components define: ${defStr}`);
                    const ranges = parseMagickIndices(value);
                    if (key === "connected-components:keep") state.connectedKeep = ranges;
                    else state.connectedRemove = ranges;
                } else if (key === "connected-components:background-id") {
                    const id = Number(value);
                    if (extra !== undefined || !value?.trim() || !Number.isSafeInteger(id) || id < 0) throw new Error(`Unsupported connected-components define: ${defStr}`);
                    state.connectedBackgroundId = id;
                } else if (key === "connected-components:area-threshold") {
                    const threshold = Number(value);
                    if (extra !== undefined || !value?.trim() || !Number.isFinite(threshold) || threshold < 0) throw new Error(`Unsupported connected-components define: ${defStr}`);
                    state.connectedAreaThreshold = threshold;
                } else {
                    if (extra !== undefined || (key !== "connected-components:mean-color" && key !== "connected-components:exclude-header" && key !== "connected-components:exclude-ids") || (value !== "true" && value !== "false")) throw new Error(`Unsupported connected-components define: ${defStr}`);
                    if (key === "connected-components:mean-color") state.connectedMeanColor = value === "true";
                    else if (key === "connected-components:exclude-header") state.connectedExcludeHeader = value === "true";
                    else if (key === "connected-components:exclude-ids") state.connectedExcludeIds = value === "true";
                }
            }
            if (defStr.toLowerCase().startsWith("tiff:tile-geometry=")) {
                const dimensions = defStr.slice("tiff:tile-geometry=".length).split("x");
                const width = Number(dimensions[0]), height = Number(dimensions[1] ?? dimensions[0]);
                if (dimensions.length > 2 || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 || width % 16 !== 0 || height % 16 !== 0) throw new Error(`Invalid TIFF tile geometry: ${defStr}`);
                state.tiffTile = { width, height };
            }
            if (defStr.toLowerCase().startsWith("compose:tile=")) state.composeTile = defStr.slice("compose:tile=".length).toLowerCase() === "true";
            const m = /^compose:args=(.*)$/i.exec(defStr);
            if (m)
                state.composeArgs = m[1]!;
        }
        else if (t === "-set") {
            const k = (tokens[++i] ?? "").toLowerCase();
            const v = tokens[++i] ?? "";
            if (k.startsWith("option:")) state.optionProperties = { ...state.optionProperties, [k.slice("option:".length)]: v };
            if (k === "option:connected-components:verbose") {
                const value = v.toLowerCase();
                if (!["true", "false", "1", "0", "yes", "no", "on", "off"].includes(value)) throw new Error(`Unsupported connected-components setting: ${k}=${v}`);
                state.connectedVerbose = ["true", "1", "yes", "on"].includes(value);
            } else if (k.startsWith("option:connected-components:") || k.startsWith("connected-components:")) throw new Error(`Unsupported connected-components setting: ${k}`);
            if (k === "option:compose:args")
                state.composeArgs = v;
        } else return undefined;
    return i;
}

function magickRegion(image: Pick<RgbaImage, "width" | "height">, spec: string, gravity: GravityPosition): Region {
    const g = parseMagickGeometry(spec);
    const width = Math.round(g.isPercent ? image.width * (g.percentX ?? 100) / 100 : g.width ?? image.width);
    const height = Math.round(g.isPercent ? image.height * (g.percentY ?? 100) / 100 : g.height ?? image.height);
    if (!spec || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error(`invalid region geometry '${spec}'`);
    return { ...gravityAdjustBox(image.width, image.height, width, height, g.x, g.y, gravity), width, height };
}

function* evaluatePipelineTokensSteps(tokens: readonly string[], files: Map<string, Uint8Array>, state: MagickState, parentStack?: RgbaImage[], stdinBytes?: Uint8Array, signal?: AbortSignal, analysis = createConvertAnalysis(), registers = new Map<string, RgbaImage[]>()): Generator<void, RgbaImage[], void> {
    let cooperativeWork = 63;
    let stack: RgbaImage[] = [];
    let operandsOnly = false;
    let i = 0;
    while (i < tokens.length) {
        yield;
        const t = tokens[i]!;
        if (!operandsOnly && t === "--") { operandsOnly = true; i++; continue; }
        if (t.slice(0, 4).toLowerCase() === "mpr:") {
            const saved = registers.get(t.slice(4));
            if (!saved) throw new Error(`unable to open image '${t}'`);
            for (const image of saved) {
                yield;
                stack.push({ ...image, data: new Uint8Array(image.data) });
            }
            i++;
            continue;
        }
        if (operandsOnly) {
            const loaded = yield* parseInputOperandsSteps(t, files, state, stdinBytes);
            if (!loaded) throw new Error(`unable to open image '${t}'`);
            for (const warning of loaded[0]?.decodeWarnings ?? []) analysis.warnings += `magick: ${warning}\n`;
            stack.push(...loaded);
            i++;
            continue;
        }
        if (t === "-quiet" || t === "+quiet") { analysis.quiet = t === "-quiet"; i++; continue; }
        // Conversion warnings remain nonfatal, including with -regard-warnings.
        if (t === "-regard-warnings" || t === "+regard-warnings") { i++; continue; }
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
            const subResult = (yield* evaluatePipelineTokensSteps(subTokens, files, subState, stack, stdinBytes, signal, analysis, registers));
            stack.push(...subResult);
            i = j;
            continue;
        }
        if (t === "+orient") {
            delete state.orientation;
            i++;
            continue;
        }
        if (t === "-orient") {
            const orientation = state.orientation = parseMagickOrientation(tokens[++i] ?? "");
            stack = yield* mapMagickImagesSteps(stack, function* (image) { yield; return { ...image, orientation }; });
            i++;
            continue;
        }
        if (t === "-units") {
            const units = state.units = parseMagickUnits(tokens[++i] ?? "");
            stack = yield* mapMagickImagesSteps(stack, function* (image) { yield; return applyMagickUnits(image, units); });
            i++;
            continue;
        }
        if (t === "-density") {
            const value = tokens[++i] ?? "72";
            state.density = Math.max(1, Math.round(parseMagickGeometry(value).width ?? 72));
            stack = yield* mapMagickImagesSteps(stack, function* (image) { yield; return applyMagickDensity(image, value); });
            i++;
            continue;
        }
        if (t === "-set" && tokens[i + 1]?.toLowerCase() === "delay") {
            const delay = Number((tokens[i + 2] ?? "0").replaceAll("%", "")) * 10;
            stack = yield* mapMagickImagesSteps(stack, function* (image) {
                yield;
                return { ...image, delay: Array(image.delay?.length ?? 1).fill(delay) };
            });
            i += 3;
            continue;
        }
        if (t === "-set" && tokens[i + 1]?.toLowerCase() === "dispose") {
            const disposal = parseMagickDisposal(tokens[i + 2] ?? "");
            stack = yield* mapMagickImagesSteps(stack, function* (image) {
                yield;
                return { ...image, disposal };
            });
            i += 3;
            continue;
        }
        if (t === "-set" && !tokens[i + 1]?.toLowerCase().startsWith("option:") && !tokens[i + 1]?.toLowerCase().startsWith("connected-components:")) {
            const key = tokens[++i] ?? "", value = tokens[++i] ?? "";
            stack = yield* mapMagickImagesSteps(stack, function* (image) {
                const expandedKey = yield* formatMagickPropertyStringSteps(key, image, () => image, { ...(image as MagickImage)[magickInput], optionProperties: state.optionProperties });
                const expanded = yield* formatMagickPropertyStringSteps(value, image, () => image, { ...(image as MagickImage)[magickInput], optionProperties: state.optionProperties });
                if (["width", "height", "size"].includes(expandedKey.toLowerCase())) {
                    analysis.warnings += `magick: attempt to set read-only property '${expandedKey}'\n`;
                    return image;
                }
                if (expandedKey.toLowerCase() === "units") return applyMagickUnits(image, parseMagickUnits(expanded));
                if (expandedKey.toLowerCase() === "depth") return { ...image, bitsPerSample: Number(expanded) };
                if (expandedKey.toLowerCase() === "gamma") return { ...image, gamma: parseFloat(expanded) };
                if (expandedKey.toLowerCase() === "page") return { ...image, virtualCanvas: magickRepageCanvas(image, { ...parseMagickGeometry(expanded), forceExact: false }) };
                return expandedKey.toLowerCase() === "density" ? applyMagickDensity(image, expanded) : { ...image, properties: updateMagickProperty(image.properties, expandedKey, expanded) };
            });
            i++;
            continue;
        }
        if (t === "+set") {
            const key = tokens[++i] ?? "";
            stack = yield* mapMagickImagesSteps(stack, function* (image) {
                yield;
                const properties = updateMagickProperty(image.properties, key);
                return { ...image, properties };
            });
            i++;
            continue;
        }
        if (t === "-region" || t === "+region") {
            const geometry = t === "-region" ? tokens[++i] : undefined;
            if (t === "-region" && !geometry) throw new Error("missing argument '-region'");
            stack = stack.map(image => ({ ...image, region: geometry === undefined ? undefined : magickRegion(image, geometry, state.gravity) }));
            i++;
            continue;
        }
        if (t === "-write-mask" || t === "+write-mask" || t === "-clip-mask" || t === "+clip-mask") {
            const path = t.startsWith("-") ? tokens[++i] : undefined;
            if (t.startsWith("-") && !path) throw new Error(`missing argument '${t}'`);
            const mask = path ? yield* parseInputOperandSteps(path, files, state, stdinBytes) : undefined;
            if (path && !mask) throw new Error(`unable to open image '${path}'`);
            stack = stack.map(image => ({ ...image, writeMask: mask }));
            i++;
            continue;
        }
        const setting = applyMagickReadSetting(tokens, state, i);
        if (setting === undefined && (t === "-solarize" || t === "-color-matrix")) {
            const value = tokens[++i] ?? (t === "-solarize" ? "50%" : "1,0,0 0,1,0 0,0,1");
            stack = yield* mapMagickImagesSteps(stack, function* (image) {
                const expanded = yield* formatMagickPropertyStringSteps(value, image, () => image, { ...(image as MagickImage)[magickInput], optionProperties: state.optionProperties });
                return yield* parseMagickPixelOperation([t, expanded], state, 0, signal)!.apply(image);
            });
            i++;
            continue;
        }
        const pixelOperation = setting === undefined ? parseMagickPixelOperation(tokens, state, i, signal) : undefined;
        const warpOperation = setting === undefined && t !== "-rotate" ? parseMagickWarpOperation(tokens, state, i, analysis) : undefined;
        const analysisOperation = setting === undefined && !pixelOperation ? parseMagickAnalysisOperation(tokens, state, i) : undefined;
        if (setting !== undefined) {
            i = setting;
            if (t === "-depth" && state.inputDepth! < 16) {
                const levels = 2 ** state.inputDepth!, channels = state.channelExplicit ? state.channels : { r: true, g: true, b: true, a: true };
                stack = yield* mapMagickImagesSteps(stack, image => applyMagickRasterSteps(image, posterizePixelSteps(image, levels, false, channels, signal), signal));
            }
            if (t === "-page") stack = yield* mapMagickImagesSteps(stack, function* (image) { yield; return { ...image, virtualCanvas: state.page! }; });
        }
        else if (t === "-connected-components" || t === "+connected-components") {
            const connectivity = parseConnectedComponents(tokens, i++);
            stack = yield* mapMagickImagesSteps(stack, function* (image) {
                const result = yield* connectedComponentsSteps(image, connectivity, state.alphaFuzz, state.connectedVerbose ?? false, state.connectedMeanColor ?? false, state.connectedAreaThreshold ?? 0, state.connectedKeep, state.connectedRemove, state.connectedRemoveColors, state.connectedKeepTop, state.connectedSort, state.connectedAngleThreshold, state.connectedPerimeterThreshold, state.connectedExcludeHeader, state.connectedExcludeIds, state.connectedBackgroundId, state.connectedSortOrder, state.connectedMajorAxisThreshold, state.connectedMinorAxisThreshold, state.connectedEccentricityThreshold, state.connectedDiameterThreshold, state.connectedCircularityThreshold, state.connectedKeepColors, state.precision);
                analysis.text += result.text;
                return result.image;
            });
        }
        else if (analysisOperation) {
            i = analysisOperation.end;
            stack = yield* mapMagickImagesSteps(stack, function* (image) {
                const histogram = Array.from({ length: analysisOperation.luminance ? 5 : 4 }, (_, channel) => new Float64Array(channel === 4 || analysisOperation.highDepth && image.data16 ? 65536 : 256));
                yield* accumulateMagickHistogram(analysisOperation.highDepth ? image.data16 ?? image.data : image.data, histogram, state.intensity, image.magickColorspace === "RGB");
                return yield* analysisOperation.transform(histogram, image)(image);
            });
        }
        else if (t === "-cycle") {
            const amount = Number(tokens[++i]);
            stack = yield* mapMagickImagesSteps(stack, image => applyMagickRasterSteps(image, cyclePixelSteps(image, amount), signal));
        }
        else if (t === "-unique-colors") {
            stack = yield* mapMagickImagesSteps(stack, uniqueColorsSteps);
        }
        else if (t === "-colors") {
            const colors = Number(tokens[++i]);
            stack = yield* mapMagickImagesSteps(stack, image => {
                const { data16: ignored, hueSamples: ignoredHue, ...pixels } = image;
                return applyMagickRasterSteps({ ...pixels, isPalette: true }, quantizePixelSteps(image.data.length, colors, state.quantizeGray, state.treeDepth), signal);
            });
        }
        else if (pixelOperation) {
            if (pixelOperation.warning) analysis.warnings += pixelOperation.warning;
            if (t === "-contrast" || t === "+contrast") analysis.warnings += `magick: option has been replaced '${t}', use "${t[0]}level"\n`;
            i = pixelOperation.end;
            stack = yield* mapMagickImagesSteps(stack, image => {
                const { evaluateSamples: ignoredEvaluate, ...bounded } = image;
                const input = pixelOperation.evaluate ? image : bounded;
                const { data16: ignored, ...pixels } = input;
                return pixelOperation.apply(pixelOperation.highDepth ? input : pixels);
            });
        }
        else if (warpOperation) {
            i = warpOperation.end;
            const geometry = ["-shear", "-wave", "-swirl", "-implode"].includes(t) ? tokens[i] : undefined;
            stack = yield* mapMagickImagesSteps(stack, function* (image) {
                const expanded = geometry?.includes("%[") ? yield* formatMagickPropertyStringSteps(geometry, image, () => image, { ...(image as MagickImage)[magickInput], optionProperties: state.optionProperties }) : geometry;
                const plan = warpOperation.plan(image, expanded);
                if (!plan) return image;
                const output = yield* applyMagickRasterSteps(image, plan.steps, signal, plan);
                return { ...output, ...("space" in plan && plan.space ? { space: plan.space, channels: plan.space === "srgb" ? 4 as const : output.channels } : {}), ...(plan.virtualCanvas ? { virtualCanvas: plan.virtualCanvas } : {}) };
            });
        }
        else if (t === "-write" || t === "+write") {
            if (i + 1 >= tokens.length) throw new Error(`missing argument '${t}'`);
            if (stack.length === 0) throw new Error(`no images for write '${t}'`);
            const writeTemplate = tokens[++i] ?? "";
            const writePath = expandFilenameProperties(writeTemplate, stack[0]!.properties);
            if (writePath.slice(0, 4).toLowerCase() === "mpr:") {
                const saved: RgbaImage[] = [];
                for (const image of stack) {
                    yield;
                    saved.push({ ...image, data: new Uint8Array(image.data) });
                }
                registers.set(writePath.slice(4), saved);
            }
            else if (stack.length > 0 && writePath && writePath.toLowerCase() !== "null:") {
                const top = stack[stack.length - 1]!;
                const { format, path, pngCoder, bmpFormat, gifVersion, tiffBig } = inferOutputFormat(writePath, top.format);
                if ((!state.filenameLiteral && writePath !== writeTemplate) || hasSceneOutputPattern(path, state.filenameLiteral) || (stack.length > 1 && (!state.adjoin || (path !== "-" && ["png", "jpeg", "bmp"].includes(format))))) {
                    for (let idx = 0; idx < stack.length; idx++) {
                        if (++cooperativeWork % 65536 === 0)
                            yield;
                        const framePath = formatSceneOutputPath(inferOutputFormat(writeTemplate, top.format).path, (state.scene ?? (stack[0] as MagickImage)[magickInput]?.sceneIdx ?? 0) + idx, state.filenameLiteral, stack[idx]!.properties);
                        const { data: frameBytes } = encodeImage({ ...(yield* prepareMagickOutput(stack[idx]!, format, state.dither, state.diffusionAmount, pngCoder)), ...(format === "gif" && state.backgroundExplicit ? { backgroundColor: state.background } : {}) }, { format, pngCoder, gifVersion, tiffBig, bmpFormat: bmpFormat ?? state.bmpFormat ?? "bmp4", palette: true, pngColorType: pngOutputColorType(state.pngColorType, format, analysis), ...(state.miffCompression === undefined ? {} : { miffCompression: state.miffCompression }), ...(state.tgaCompression === undefined ? {} : { tgaCompression: state.tgaCompression }), ...(state.bmpCompression === undefined ? {} : { bmpCompression: state.bmpCompression }), ...(state.bmpSubtype === undefined ? {} : { bmpSubtype: state.bmpSubtype }), ...(state.bmp3Alpha === undefined ? {} : { bmp3Alpha: state.bmp3Alpha }), ...(state.inputDepth === undefined ? {} : { tiffIntegerDepth: state.inputDepth <= 8 ? 8 : state.inputDepth <= 16 ? 16 : 32 }), ...(state.tiffSigned === undefined ? {} : { tiffSigned: state.tiffSigned }), ...(state.tiffFloatingPoint ? { tiffFloatDepth: (state.inputDepth ?? 32) <= 16 ? 16 : (state.inputDepth ?? 32) <= 32 ? 32 : 64 } : {}), ...(state.tiffPlanar === undefined ? {} : { tiffPlanar: state.tiffPlanar }), ...(state.tiffAlpha === undefined ? {} : { tiffAlpha: state.tiffAlpha }), ...(state.tiffEndian === undefined ? {} : { tiffEndian: state.tiffEndian }), ...(state.tiffRowsPerStrip === undefined ? {} : { tiffRowsPerStrip: state.tiffRowsPerStrip }), ...(state.tiffTile === undefined ? {} : { tiffTile: state.tiffTile }), ...(state.tiffCompression === undefined ? {} : { tiffCompression: state.tiffCompression }), netpbmAscii: state.netpbmAscii ?? false, ...(state.inputDepth === undefined ? {} : { netpbmDepth: Math.min(16, state.inputDepth), miffDepth: state.inputDepth <= 8 ? 8 : 16 }), endian: state.inputEndian, pngPreserveColormap: state.pngPreserveColormap, pngBitDepth: state.pngBitDepth, ...(state.jpegRestartInterval === undefined ? {} : { jpegRestartInterval: state.jpegRestartInterval }), ...(state.jpegDctMethod === undefined ? {} : { jpegDctMethod: state.jpegDctMethod }), ...(state.jpegOptimizeCoding === undefined ? {} : { jpegOptimizeCoding: state.jpegOptimizeCoding }), ...(state.jpegArithmeticCoding === undefined ? {} : { jpegArithmeticCoding: state.jpegArithmeticCoding }), ...(state.jpegProgressive === undefined ? {} : { jpegProgressive: state.jpegProgressive }), pngInterlace: state.pngInterlace, gifInterlace: state.gifInterlace, transparentColor: state.transparentColor, omitPngResolution: state.strip || state.omitPngResolution === true, ...(state.samplingFactor === undefined ? {} : { samplingFactor: state.samplingFactor }), chromaSubsampling: state.quality < 90 ? "4:2:0" : "4:4:4", webpExact: state.webpExact ?? false, smartSubsample: state.webpSmartSubsample ?? false, alphaCompression: state.webpAlphaCompression ?? 1, alphaQuality: state.webpAlphaQuality ?? 100, webpTargetSize: state.webpTargetSize, webpPass: state.webpPass, jpegExtent: state.jpegExtent, quality: state.quality, ...(format === "webp" ? { effort: state.webpMethod ?? 4, lossless: state.webpLossless ?? state.quality >= 100 } : {}) });
                        files.set(framePath, frameBytes);
                    }
                }
                else {
                    const image = stack.length > 1 && format === "miff" ? yield* prepareMiffPages(stack) : format === "ico" ? yield* prepareIcoPages(stack, state.iconAutoResize, state.kernel, state.resizeFilter) : stack.length > 1 && format === "tiff" ? yield* prepareTiffPages(stack) : stack.length > 1 && (format === "gif" || format === "apng" || format === "mng" || format === "webp") ? yield* prepareGifFrames(stack, format === "gif" ? state.dither : false, state.diffusionAmount) : yield* prepareMagickOutput(top, format, state.dither, state.diffusionAmount, pngCoder);
                    const { data: encoded } = encodeImage({ ...(image), ...(format === "gif" && state.backgroundExplicit ? { backgroundColor: state.background } : {}) }, { format, pngCoder, gifVersion, tiffBig, bmpFormat: bmpFormat ?? state.bmpFormat ?? "bmp4", palette: true, pngColorType: pngOutputColorType(state.pngColorType, format, analysis), ...(stack.length > 1 && (format === "gif" || format === "apng" || format === "mng" || format === "webp") ? { pageHeight: image.pageHeight } : {}), ...(format === "gif" && stack.length === 1 ? { loop: 1, delay: image.delay?.[(top as MagickImage)[magickInput]?.sceneIdx ?? 0] ?? 0 } : state.loop === undefined ? {} : { loop: state.loop }), ...(state.optimizeLayers ? { optimizeFrames: true, gifTransdiff: true } : {}), ...(state.miffCompression === undefined ? {} : { miffCompression: state.miffCompression }), ...(state.tgaCompression === undefined ? {} : { tgaCompression: state.tgaCompression }), ...(state.bmpCompression === undefined ? {} : { bmpCompression: state.bmpCompression }), ...(state.bmpSubtype === undefined ? {} : { bmpSubtype: state.bmpSubtype }), ...(state.bmp3Alpha === undefined ? {} : { bmp3Alpha: state.bmp3Alpha }), ...(state.inputDepth === undefined ? {} : { tiffIntegerDepth: state.inputDepth <= 8 ? 8 : state.inputDepth <= 16 ? 16 : 32 }), ...(state.tiffSigned === undefined ? {} : { tiffSigned: state.tiffSigned }), ...(state.tiffFloatingPoint ? { tiffFloatDepth: (state.inputDepth ?? 32) <= 16 ? 16 : (state.inputDepth ?? 32) <= 32 ? 32 : 64 } : {}), ...(state.tiffPlanar === undefined ? {} : { tiffPlanar: state.tiffPlanar }), ...(state.tiffAlpha === undefined ? {} : { tiffAlpha: state.tiffAlpha }), ...(state.tiffEndian === undefined ? {} : { tiffEndian: state.tiffEndian }), ...(state.tiffRowsPerStrip === undefined ? {} : { tiffRowsPerStrip: state.tiffRowsPerStrip }), ...(state.tiffTile === undefined ? {} : { tiffTile: state.tiffTile }), ...(state.tiffCompression === undefined ? {} : { tiffCompression: state.tiffCompression }), netpbmAscii: state.netpbmAscii ?? false, ...(state.inputDepth === undefined ? {} : { netpbmDepth: Math.min(16, state.inputDepth), miffDepth: state.inputDepth <= 8 ? 8 : 16 }), endian: state.inputEndian, pngPreserveColormap: state.pngPreserveColormap, pngBitDepth: state.pngBitDepth, ...(state.jpegRestartInterval === undefined ? {} : { jpegRestartInterval: state.jpegRestartInterval }), ...(state.jpegDctMethod === undefined ? {} : { jpegDctMethod: state.jpegDctMethod }), ...(state.jpegOptimizeCoding === undefined ? {} : { jpegOptimizeCoding: state.jpegOptimizeCoding }), ...(state.jpegArithmeticCoding === undefined ? {} : { jpegArithmeticCoding: state.jpegArithmeticCoding }), ...(state.jpegProgressive === undefined ? {} : { jpegProgressive: state.jpegProgressive }), pngInterlace: state.pngInterlace, gifInterlace: state.gifInterlace, transparentColor: state.transparentColor, omitPngResolution: state.strip || state.omitPngResolution === true, ...(state.samplingFactor === undefined ? {} : { samplingFactor: state.samplingFactor }), chromaSubsampling: state.quality < 90 ? "4:2:0" : "4:4:4", webpExact: state.webpExact ?? false, smartSubsample: state.webpSmartSubsample ?? false, alphaCompression: state.webpAlphaCompression ?? 1, alphaQuality: state.webpAlphaQuality ?? 100, webpTargetSize: state.webpTargetSize, webpPass: state.webpPass, jpegExtent: state.jpegExtent, quality: state.quality, ...(format === "webp" ? { effort: state.webpMethod ?? 4, lossless: state.webpLossless ?? state.quality >= 100 } : {}) });
                    if (path === "-") analysis.bytes.push(encoded);
                    else files.set(formatAdjoinedOutputPath(path, stack.length, state.scene ?? 0, state.filenameLiteral), encoded);
                }
            }
        }
        else if (t === "-geometry") {
            state.geometry = tokens[++i] ?? "+0+0";
        }
        else if (t === "-tile") {
            state.tile = tokens[++i];
        }
        else if (t === "-encipher" || t === "-decipher") {
            const name = tokens[++i];
            if (!name) throw new Error(`missing argument '${t}'`);
            const key = files.get(name);
            if (!key) throw new Error(`unable to open key '${name}'`);
            stack = yield* mapMagickImagesSteps(stack, function* (image) {
                return yield* applyMagickRasterSteps(image, encipherPixelSteps(image, key), signal);
            });
        }
        else if (t === "-profile" || t === "+profile") {
            const name = tokens[++i];
            if (!name) throw new Error(`missing argument '${t}'`);
            const profile = t === "-profile" ? files.get(name) : undefined;
            if (t === "-profile" && !profile) throw new Error(`unable to open profile '${name}'`);
            stack = stack.map(image => applyMagickProfile(image, name, profile));
        }
        else if (t === "-strip") {
            state.strip = true;
            for (let index = 0; index < stack.length; index++) { const {gifApplications: ignoredGifApplications, icc: ignored, exif: ignoredExif, orientation: ignoredOrientation, properties: ignoredProperties, ...image} = stack[index]!; stack[index] = image; }
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
        else if (t === "-scene") {
            state.scene = Number(tokens[++i]);
            if (!Number.isSafeInteger(state.scene) || state.scene < 0) throw new Error("invalid scene number");
        }
        else if (t === "-delay") {
            state.delay = tokens[++i] ?? "0";
        }
        else if (t === "-transparent-color") {
            state.transparentColor = parseColor(tokens[++i] ?? "");
        }
        else if (t === "-loop") {
            state.loop = Number(tokens[++i] ?? 0);
        }
        else if (t === "-dispose") {
            state.disposal = parseMagickDisposal(tokens[++i] ?? "");
        }
        else if (t === "-layers" && tokens[i + 1]?.toLowerCase() === "trimbounds") {
            i++;
            let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
            for (const frame of stack) {
                const x = frame.virtualCanvas?.x ?? 0, y = frame.virtualCanvas?.y ?? 0;
                left = Math.min(left, x); top = Math.min(top, y);
                right = Math.max(right, x + frame.width); bottom = Math.max(bottom, y + frame.height);
                yield;
            }
            stack = yield* mapMagickImagesSteps(stack, function* (frame) {
                yield;
                return { ...frame, virtualCanvas: { width: right - left, height: bottom - top, x: (frame.virtualCanvas?.x ?? 0) - left, y: (frame.virtualCanvas?.y ?? 0) - top } };
            });
        }
        else if (t === "-layers" && tokens[i + 1]?.toLowerCase() === "removezero") {
            i++;
            const frames: RgbaImage[] = [];
            for (const frame of stack) {
                if ((frame.delay?.[(frame as MagickImage)[magickInput]?.sceneIdx ?? 0] ?? 0) !== 0) frames.push(frame);
                yield;
            }
            if (frames.length) stack = frames;
            else if (stack.length) analysis.warnings += "magick: animation only contains zero time delays\n";
        }
        else if (t === "-deconstruct" || (t === "-layers" && ["compareany", "compareoverlay", "compareclear", "removedups", "optimizeplus"].includes((tokens[i + 1] ?? "").toLowerCase()))) {
            const method = t === "-layers" ? tokens[i + 1]!.toLowerCase() : "compareany";
            const optimizePlus = t === "-layers" && tokens[i + 1]?.toLowerCase() === "optimizeplus";
            const removeDups = optimizePlus || (t === "-layers" && tokens[i + 1]?.toLowerCase() === "removedups");
            if (optimizePlus) {
                for (const frame of stack) {
                    if (frame.width !== stack[0]!.width || frame.height !== stack[0]!.height)
                        throw new Error("images are not the same size");
                    if ((frame.virtualCanvas?.width || frame.width) !== frame.width ||
                        (frame.virtualCanvas?.height || frame.height) !== frame.height ||
                        frame.virtualCanvas?.x || frame.virtualCanvas?.y) throw new Error("image pages are not coalesced");
                    yield;
                }
                // OptimizePlus treats validated full-canvas frames as independent displays.
                stack = stack.map(frame => ({ ...frame, disposal: 1 }));
                state.optimizeLayers = true;
            }
            if (t === "-layers") i++;
            const frames: RgbaImage[] = stack.length ? [stack[0]!] : [];
            for (let n = 1; n < stack.length; n++) {
                let current = stack[n]!;
                const previous = stack[n - 1]!;
                if (removeDups && (previous.width !== current.width || previous.height !== current.height ||
                    (previous.virtualCanvas?.x ?? 0) !== (current.virtualCanvas?.x ?? 0) ||
                    (previous.virtualCanvas?.y ?? 0) !== (current.virtualCanvas?.y ?? 0))) {
                    frames.push(current);
                    continue;
                }
                if (optimizePlus) {
                    if (state.alphaFuzz > 0) {
                        current = yield* applyMagickRasterSteps(current, optimizePlusPixels(current, state.alphaFuzz), signal, current, [current, previous]);
                        stack[n] = current;
                    }
                    const clearing = compareLayerBounds(previous, current, 0, "compareclear");
                    let clear = clearing.next();
                    while (!clear.done) {
                        if (!clear.value) { yield; clear = clearing.next(); }
                        else {
                            const { image, position, length } = clear.value;
                            clear = clearing.next((image ? current : previous).data.subarray(position, position + length));
                        }
                    }
                    if (clear.value) {
                        // Keep the previous display, then clear only the pixels the next frame erases.
                        const prior = frames[frames.length - 1]!;
                        frames[frames.length - 1] = { ...prior, disposal: 1, delay: Array(prior.delay?.length ?? 1).fill(0) };
                        frames.push({ ...yield* extractImageSteps(previous, clear.value),
                            virtualCanvas: magickCropCanvas(previous, clear.value.left, clear.value.top),
                            disposal: 2, delay: Array(previous.delay?.length ?? 1).fill(prior.delay?.[(prior as MagickImage)[magickInput]?.sceneIdx ?? 0] ?? 0) });
                        frames.push(current);
                        continue;
                    }
                }
                const bounds = compareLayerBounds(previous, current, state.alphaFuzz, method);
                let next = bounds.next();
                while (!next.done) {
                    if (!next.value) { yield; next = bounds.next(); }
                    else {
                        const { image, position, length } = next.value;
                        next = bounds.next((image ? current : previous).data.subarray(position, position + length));
                    }
                }
                if (removeDups) {
                    // OptimizePlus preserves the first transition, including an empty one.
                    if (next.value || (optimizePlus && n === 1)) frames.push(current);
                    else {
                        const prior = frames[frames.length - 1]!;
                        const delay = (prior.delay?.[(prior as MagickImage)[magickInput]?.sceneIdx ?? 0] ?? 0) +
                            (current.delay?.[(current as MagickImage)[magickInput]?.sceneIdx ?? 0] ?? 0);
                        const survivor = optimizePlus ? prior : current;
                        frames[frames.length - 1] = { ...survivor, delay: Array(survivor.delay?.length ?? 1).fill(delay) };
                    }
                } else if (next.value) frames.push({ ...yield* extractImageSteps(current, next.value), virtualCanvas: magickCropCanvas(current, next.value.left, next.value.top) });
            }
            stack = frames;
        }
        else if (t === "-layers" && tokens[i + 1]?.toLowerCase() === "optimizetransparency") {
            i++;
            if (stack.length > 1) {
                const first = stack[0]!, width = first.virtualCanvas?.width || first.width, height = first.virtualCanvas?.height || first.height;
                let canvas: RgbaImage = { ...yield* createSolidRgbaImageSteps(width, height, { r: 0, g: 0, b: 0, a: 0 }), virtualCanvas: { width, height, x: 0, y: 0 } };
                for (let n = 0; n < stack.length; n++) {
                    const current = stack[n]!, previous = canvas;
                    const x = current.virtualCanvas?.x ?? 0, y = current.virtualCanvas?.y ?? 0;
                    if (n > 0) stack[n] = yield* applyMagickRasterSteps(current, optimizeTransparencyPixels(canvas, current, state.fuzz), signal, { ...current, hasAlpha: true }, [current, canvas]);
                    // Keep the original pixels for subsequent comparisons and apply disposal.
                    canvas = yield* compositeImageSteps(canvas, [rgbaToCompositeLayer(current, x, y, "over")]);
                    if (current.disposal === 3) canvas = previous;
                    else if (current.disposal === 2) {
                        const data = new Uint8Array(canvas.data);
                        for (let row = Math.max(0, y); row < Math.min(height, y + current.height); row++) {
                            yield;
                            if (Math.min(width, x + current.width) > Math.max(0, x)) data.fill(0, (row * width + Math.max(0, x)) * 4, (row * width + Math.min(width, x + current.width)) * 4);
                        }
                        canvas = { ...canvas, data, hasAlpha: true };
                    }
                }
            }
        }
        else if (t === "-coalesce" || (t === "-layers" && ["coalesce", "dispose", "optimize"].includes((tokens[i + 1] ?? "").toLowerCase()))) {
            const dispose = t === "-layers" && tokens[i + 1]?.toLowerCase() === "dispose";
            const optimize = t === "-layers" && tokens[i + 1]?.toLowerCase() === "optimize";
            if (optimize) state.optimizeLayers = true;
            if (t === "-layers") i++;
            if (stack.length && (!optimize || stack.some(frame => frame.width !== (stack[0]!.virtualCanvas?.width || stack[0]!.width) || frame.height !== (stack[0]!.virtualCanvas?.height || stack[0]!.height) || frame.virtualCanvas?.x || frame.virtualCanvas?.y))) {
                const first = stack[0]!, width = first.virtualCanvas?.width || first.width, height = first.virtualCanvas?.height || first.height;
                const background = { ...(first.backgroundColor ?? { r: 255, g: 255, b: 255 }), a: dispose || first.hasAlpha ? 0 : 255 };
                let canvas: RgbaImage = { ...first, width, height, data: (yield* createSolidRgbaImageSteps(width, height, background)).data, hasAlpha: true, virtualCanvas: { width, height, x: 0, y: 0 } };
                const frames: RgbaImage[] = [];
                for (const inputFrame of stack) {
                    // Native DisposeImages repeats the first input, including its timing.
                    const frame = dispose ? first : inputFrame;
                    const previous = canvas, x = frame.virtualCanvas?.x ?? 0, y = frame.virtualCanvas?.y ?? 0;
                    canvas = yield* compositeImageSteps(canvas, [rgbaToCompositeLayer(frame, x, y, "over")]);
                    let disposal = 1;
                    const prior = frames.at(-1), priorInput = stack[frames.length - 1];
                    if (!dispose && prior && priorInput) {
                        // Native clears the preceding frame only where pixels become transparent.
                        const left = Math.max(0, priorInput.virtualCanvas?.x ?? 0), top = Math.max(0, priorInput.virtualCanvas?.y ?? 0);
                        const right = Math.min(width, (priorInput.virtualCanvas?.x ?? 0) + priorInput.width), bottom = Math.min(height, (priorInput.virtualCanvas?.y ?? 0) + priorInput.height);
                        for (let row = top; row < bottom && disposal === 1; row++) {
                            for (let column = left; column < right; column++) {
                                if ((column - left) % 4096 === 0) yield;
                                const alpha = (row * width + column) * 4 + 3;
                                if (prior.data[alpha]! >= 128 && canvas.data[alpha]! < 128) { disposal = 2; break; }
                            }
                        }
                        frames[frames.length - 1] = { ...prior, disposal };
                    }
                    if (!dispose) frames.push({ ...frame, width, height, data: canvas.data, hasAlpha: canvas.hasAlpha, virtualCanvas: { width, height, x: 0, y: 0 }, disposal });
                    if (frame.disposal === 3) canvas = previous;
                    else if (frame.disposal === 2) {
                        const data = new Uint8Array(canvas.data);
                        for (let row = Math.max(0, y); row < Math.min(height, y + frame.height); row++) {
                            yield;
                            data.fill(0, (row * width + Math.max(0, x)) * 4, (row * width + Math.min(width, x + frame.width)) * 4);
                        }
                        canvas = { ...canvas, data, hasAlpha: true };
                    }
                    if (dispose) frames.push({ ...first, width, height, data: canvas.data, hasAlpha: canvas.hasAlpha, virtualCanvas: { width, height, x: 0, y: 0 } });
                }
                stack = frames;
            }
        }
        else if (t === "-splice") {
            const geom = tokens[++i] ?? "0x0";
            stack = yield* mapMagickImagesSteps(stack, function* (im) {
                const expanded = yield* formatMagickPropertyStringSteps(geom, { ...im, properties: { ...state.optionProperties, ...im.properties } }, () => im, (im as MagickImage)[magickInput]);
                validateMagickSpliceGeometry(expanded);
                return (yield* applyMagickSpliceSteps(im, expanded, state.backgroundExplicit ? state.background : im.backgroundColor ?? state.background, state.gravity, signal));
            });
        }
        else if (t === "-chop") {
            const geom = tokens[++i] ?? "0x0";
            stack = yield* mapMagickImagesSteps(stack, function* (im) {
                const expanded = yield* formatMagickPropertyStringSteps(geom, { ...im, properties: { ...state.optionProperties, ...im.properties } }, () => im, (im as MagickImage)[magickInput]);
                validateMagickTransformGeometry(expanded, t);
                return (yield* applyMagickChopSteps(im, expanded, state.gravity, signal, analysis));
            });
        }
        else if (t === "-roll") {
            const geom = tokens[++i] ?? "+0+0";
            stack = yield* mapMagickImagesSteps(stack, function* (im) {
                const expanded = yield* formatMagickPropertyStringSteps(geom, { ...im, properties: { ...state.optionProperties, ...im.properties } }, () => im, (im as MagickImage)[magickInput]);
                validateMagickTransformGeometry(expanded, t);
                return (yield* applyMagickRollSteps(im, expanded, signal));
            });
        }
        else if (t === "-morph") {
            const argument = tokens[++i] ?? "1", image = stack[0];
            const expanded = image ? yield* formatMagickPropertyStringSteps(argument, image, () => image, { ...(image as MagickImage)[magickInput], optionProperties: state.optionProperties }) : argument;
            const count = parseMagickMorphCount(expanded);
            stack = (yield* applyMagickMorphSteps(stack, count, state.channelExplicit ? [state.channels.r, state.channels.g, state.channels.b, state.channels.a] : undefined, state.kernel, signal, state.resizeFilter));
        }
        else if (t === "-floodfill" || t === "+floodfill") {
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
            stack = yield* mapMagickImagesSteps(stack, function* (im) {
                return (yield* applyMagickFloodfillSteps(im, geom, targetColor, state.fill, state.alphaFuzz, signal, false, state.channelExplicit ? [state.channels.r, state.channels.g, state.channels.b, state.channels.a] : undefined, t === "+floodfill"));
            });
        }
        else if (t === "-evaluate-sequence" || t === "-average") {
            const op = t === "-average" ? "Mean" : tokens[++i] ?? "Mean";
            if (t === "-average") analysis.warnings += 'magick: option has been replaced \'-average\', use "-evaluate-sequence Mean"\n';
            if (stack.length > 0) {
                stack = [(yield* applyMagickEvaluateSequenceSteps(stack, op, state.channelExplicit ? [state.channels.r, state.channels.g, state.channels.b, state.channels.a] : undefined, state, signal))];
            }
        }
        else if (t === "-convolve") {
            const kSpec = tokens[++i] ?? "1";
            stack = yield* mapMagickImagesSteps(stack, function* (im) {
                return (yield* applyMagickCustomConvolveSteps(im, kSpec, signal));
            });
        }
        else if (t === "-read-mask" || t === "+read-mask") {
            if (!stack.length) throw new Error(`no images found for operation '${t}'`);
            const spec = t === "-read-mask" ? tokens[++i] : undefined;
            if (t === "-read-mask" && !spec) throw new Error(`missing argument '${t}'`);
            const readMask = spec ? yield* parseInputOperandSteps(spec, files, state, stdinBytes) : undefined;
            if (spec && !readMask) throw new Error(`unable to read mask '${spec}'`);
            stack = yield* mapSteps(stack, function* (image) { yield; return { ...image, readMask }; });
        }
        else if (t === "-remap") {
            if (!stack.length) throw new Error(`no images found for operation '${t}'`);
            const palSpec = tokens[++i] ?? "";
            const palImg = palSpec.slice(0, 4).toLowerCase() === "mpr:"
                ? registers.get(palSpec.slice(4))?.[0]
                : yield* parseInputOperandSteps(palSpec, files, state, stdinBytes);
            if (!palImg) throw new Error(`unable to open image '${palSpec}'`);
            stack = yield* mapMagickImagesSteps(stack, function* (im) {
                return state.dither === "riemersma"
                    ? yield* applyMagickRasterSteps(im, riemersmaRemapSteps(im, palImg, !!im.data16, state.diffusionAmount ?? 1), signal, im, [im, palImg])
                    : yield* applyMagickRemapSteps(im, palImg, state.dither !== false, state.diffusionAmount ?? 1, signal);
            });
        }
        else if (t === "-clut" || t === "-hald-clut") {
            if (stack.length < 2) throw new Error(`image sequence is required '${t}'`);
            if (stack.length >= 2) {
                const lut = stack[t === "-clut" ? 1 : stack.length - 1]!;
                const im = stack[0]!;
                const hasAlpha = im.hasAlpha || (t === "-hald-clut" && lut.hasAlpha && (state.channels.a || !state.channelExplicit));
                const { magickColorspace: ignoredColorspace, ...metadata } = im;
                const colorspace = t === "-hald-clut" ? lut.magickColorspace : im.magickColorspace;
                let result = yield* applyMagickRasterSteps({ ...metadata, ...(colorspace ? { magickColorspace: colorspace } : {}), space: "srgb", channels: hasAlpha ? 4 : 3 }, (t === "-hald-clut" ? haldClutPixelSteps : clutPixelSteps)(im.width * im.height * 4, lut, [state.channels.r, state.channels.g, state.channels.b, t === "-clut" ? im.hasAlpha && (state.channels.a || !state.channelExplicit) : state.channels.a || !state.channelExplicit], !!(im.data16 || lut.data16), state.interpolation), signal, { ...im, hasAlpha }, [im, lut]);
                if (im.region) result = yield* applyMagickRasterSteps(result, regionPixelSteps(result, im.region, !!result.data16), signal, result, [result, im]);
                if (im.writeMask) result = yield* applyMagickRasterSteps(result, writeMaskPixelSteps(result, im.writeMask, !!result.data16), signal, result, [result, im, im.writeMask]);
                stack = [result];
            }
        }
        else if (t === "-fx") {
            const expr = tokens[++i] ?? "u", channels = state.channelExplicit ? state.channels : { r: true, g: true, b: true, a: true };
            if (stack.length > 0) {
                const base = stack[0]!;
                stack = [yield* applyMagickRasterSteps(base, magickFxPixelSteps(stack, expr, channels, state.virtualPixel, state.background, state.interpolation), signal, { ...base, hasAlpha: base.hasAlpha || channels.a && (state.virtualPixel === "transparent" || (state.virtualPixel === "background" || state.virtualPixel?.endsWith("-tile") === true) && state.background.a < 255) }, stack)];
            }
        }
        else if (t === "-shadow") {
            const geom = tokens[++i] ?? "80x3+5+5";
            stack = yield* mapMagickImagesSteps(stack, function* (im) {
                return (yield* applyMagickShadowSteps(im, geom, state.backgroundExplicit ? state.background : im.backgroundColor ?? state.background, signal));
            });
        }
        else if (t === "-vignette") {
            const geometry = parseMagickVignetteGeometry(tokens[++i] ?? "0x1");
            stack = yield* mapMagickImagesSteps(stack, function* (im) {
                const layout = vignetteLayout(im);
                return { ...yield* applyMagickRasterSteps(im, vignettePixelSteps(im, state.backgroundExplicit ? state.background : im.backgroundColor ?? state.background, geometry, state.channelExplicit ? state.channels : undefined), signal, layout), virtualCanvas: layout.virtualCanvas };
            });
        }
        else if (t === "-dither" || t === "+dither") {
            if (t === "+dither") {
                state.dither = false;
            }
            else {
                const dMode = (tokens[++i] ?? "riemersma").toLowerCase();
                state.dither = dMode === "none" ? false : dMode === "floydsteinberg" ? "floydsteinberg" : "riemersma";
            }
        }
        else if (t === "-hough-lines") {
            const spec = tokens[++i] ?? "", result: RgbaImage[] = [];
            for (const image of stack) {
                const transform = createHoughTransform(image, spec, state.background, state.stroke, state.fill, state.strokeWidth);
                const source = { ...image, space: "srgb" as const, channels: 4 as const };
                result.push(yield* applyMagickRasterSteps(source, transform.lines(), signal, { ...image, hasAlpha: state.background.a < 255 }));
                if (state.houghAccumulator) result.push(yield* applyMagickRasterSteps(source, transform.accumulator(), signal, { width: 180, height: transform.height, hasAlpha: false }));
            }
            stack = result;
        }
        else if (t === "-canny") {
            const spec = tokens[++i] ?? "0x1+10%+30%", channels = state.channelExplicit ? { ...state.channels } : undefined, virtualPixel = state.virtualPixel, background = state.background;
            stack = yield* mapMagickImagesSteps(stack, function* (im) {
                return yield* applyMagickRasterSteps(im, cannyPixelSteps(im, spec, channels, virtualPixel, background), signal, { ...im, hasAlpha: false });
            });
        }
        else if (t === "-edge") {
            const argument = tokens[++i] ?? "", radius = Number(argument);
            if (!argument.trim() || !Number.isFinite(radius)) throw new Error(`invalid argument for option '-edge': ${argument}`);
            stack = yield* mapMagickImagesSteps(stack, function* (im) {
                return (yield* applyMagickRasterSteps(im, edgePixelSteps(im, radius, state.channelExplicit ? state.channels : undefined, state.virtualPixel, state.background), signal));
            });
        }
        else if (t === "-emboss") {
            const geometry = parseMagickGeometry(tokens[++i] ?? "0x1");
            stack = yield* mapMagickImagesSteps(stack, function* (im) {
                return (yield* applyMagickRasterSteps(im, embossPixelSteps(im, geometry), signal));
            });
        }
        else if (t === "-charcoal") {
            const geometry = parseMagickGeometry(tokens[++i] ?? "0x1");
            stack = yield* mapMagickImagesSteps(stack, function* (im) {
                const edges = yield* applyMagickRasterSteps(im, edgePixelSteps(im, geometry.width ?? 0), signal, { ...im, hasAlpha: false });
                return yield* applyMagickRasterSteps(edges, charcoalPixelSteps(edges, geometry), signal);
            });
        }
        else if (t === "-sketch") {
            const geometry = parseMagickGeometry(tokens[++i] ?? "0x1"), seed = state.seed ?? 0;
            stack = yield* mapMagickImagesSteps(stack, function* (im) {
                return yield* applyMagickRasterSteps(im, sketchPixelSteps(im, geometry, seed), signal);
            });
        }
        else if (t === "+repage" || t === "-repage") {
            if (t === "-repage") {
                const geometry = parseMagickGeometry(tokens[++i] ?? "0x0");
                stack = yield* mapMagickImagesSteps(stack, function* (image) {
                    yield;
                    return { ...image, virtualCanvas: magickRepageCanvas(image, geometry) };
                });
            }
            else stack = yield* mapMagickImagesSteps(stack, function* (image) {
                yield;
                const { virtualCanvas: ignoredCanvas, ...reset } = image;
                return reset;
            });
        }
        else if (t === "-resample") {
            const value = tokens[++i] ?? "72";
            stack = yield* mapMagickImagesSteps(stack, function* (image) {
                const resized = yield* applyMagickResizeSteps(image, magickResampleGeometry(image, value), state.kernel, false, false, false, state.resizeFilter);
                return applyMagickDensity(resized, value);
            });
        }
        else if (t === "-magnify") {
            const factor = state.magnifyMethod === "scale3x" ? 3 : 2;
            stack = yield* mapMagickImagesSteps(stack, function* (image) {
                return yield* applyMagickRasterSteps(image, magnifyPixelSteps(image, state.magnifyMethod), signal, { ...image, width: image.width * factor, height: image.height * factor });
            });
        }
        else if (t === "-resize" || t === "-scale" || t === "-sample" || t === "-thumbnail") {
            const geom = tokens[++i] ?? "100%";
            validateMagickTransformGeometry(geom, t);
            const k = t === "-sample" ? "nearest" : state.kernel;
            stack = (yield* mapMagickImagesSteps(stack, function* (im) {
                return (yield* applyMagickResizeSteps(im, geom, k, t === "-thumbnail", t === "-sample", t === "-scale", state.resizeFilter, state.sampleOffset));
            }));
        }
        else if (t === "-crop") {
            const geom = tokens[++i] ?? "100%";
            const nextStack: RgbaImage[] = [];
            for (const im of stack) {
                if (++cooperativeWork % 65536 === 0)
                    yield;
                nextStack.push(...(yield* applyMagickCropToStackSteps(im, geom, state.gravity, analysis)));
            }
            stack = nextStack;
        }
        else if (t === "-extent") {
            const geom = tokens[++i] ?? "100%";
            stack = yield* mapMagickImagesSteps(stack, function* (im) {
                return (yield* applyMagickExtentSteps(im, geom, state, signal));
            });
        }
        else if (t === "-border") {
            const g = parseMagickBorderGeometry(tokens[++i] ?? "");
            stack = (yield* mapMagickImagesSteps(stack, function* (im) {
                const bw = Math.max(0, Math.round(g.isPercent ? im.width * (g.percentX ?? 100) / 100 : g.width ?? 0));
                const bh = Math.max(0, Math.round(g.isPercent ? im.height * (g.percentY ?? 100) / 100 : g.height ?? bw));
                const canvas = yield* createSolidRgbaImageSteps(im.width + bw * 2, im.height + bh * 2, state.borderColor);
                let composed = canvas;
                if (state.composeRaw.toLowerCase() === "over") yield* blitOverRgbaInPlaceSteps(canvas, im, bw, bh);
                else composed = yield* applyMagickCompositeLayerSteps(canvas, im, state.composeRaw, bw, bh, state.composeArgs, signal, state.alphaFuzz, true);
                return { ...composed, virtualCanvas: magickBorderCanvas(im, bw, bh) };
            }));
        }
        else if (t === "-shave") {
            const geometry = tokens[++i] ?? "";
            stack = (yield* mapMagickImagesSteps(stack, function* (im) {
                const expanded = yield* formatMagickPropertyStringSteps(geometry, { ...im, properties: { ...state.optionProperties, ...im.properties } }, () => im, (im as MagickImage)[magickInput]);
                validateMagickTransformGeometry(expanded, t);
                const g = parseMagickGeometry(expanded.replace(":", "x"));
                const sw = Math.max(0, Math.round(g.isPercent ? im.width * (g.percentX ?? 100) / 100 : g.width ?? 0));
                const sh = Math.max(0, Math.round(g.isPercent ? im.height * (g.percentY ?? 100) / 100 : g.height ?? (expanded.toLowerCase().includes("x") ? 0 : sw)));
                if ((g.hasOffset && g.width === undefined && g.height === undefined) || sw * 2 >= im.width || sh * 2 >= im.height) {
                    analysis.warnings += `magick: geometry does not contain image '${geometry}'\n`;
                    return im;
                }
                return { ...yield* extractImageSteps(im, {
                    left: sw,
                    top: sh,
                    width: im.width - sw * 2,
                    height: im.height - sh * 2
                }), virtualCanvas: magickBorderCanvas(im, -sw, -sh) };
            }));
        }
        else if (t === "-trim") {
            stack = (yield* mapMagickImagesSteps(stack, function* (im) {
                return (yield* trimMagickSteps(im, state.alphaFuzz, state.trimEdges, state.trimMinSize, state.trimPercentBackground, analysis));
            }));
        }
        else if (t === "-rotate") {
            const spec = tokens[++i] ?? "0";
            stack = (yield* mapMagickImagesSteps(stack, function* (im) {
                const expanded = yield* formatMagickPropertyStringSteps(spec, im, () => im, { ...(im as MagickImage)[magickInput], optionProperties: state.optionProperties });
                const operation = parseMagickWarpOperation(["-rotate", expanded], state, 0, analysis);
                const { angle: deg, applies } = parseMagickRotation(expanded);
                if (!applies(im)) return im;
                const plan = operation?.plan(im);
                if (plan) return { ...yield* applyMagickRasterSteps(im, plan.steps, signal, plan), ...(plan.virtualCanvas ? { virtualCanvas: plan.virtualCanvas } : {}) };
                return { ...yield* rotateImageSteps(im, deg, state.background), ...(im.virtualCanvas ? { virtualCanvas: magickRotateCanvas(im, deg) } : {}) };
            }));
        }
        else if (t === "-flip") {
            stack = (yield* mapMagickImagesSteps(stack, function* (im) {
                return { ...yield* flipImageSteps(im), virtualCanvas: magickMirrorCanvas(im, "flip") };
            }));
        }
        else if (t === "-flop") {
            stack = (yield* mapMagickImagesSteps(stack, function* (im) {
                return { ...yield* flopImageSteps(im), virtualCanvas: magickMirrorCanvas(im, "flop") };
            }));
        }
        else if (t === "-transpose") {
            stack = (yield* mapMagickImagesSteps(stack, function* (im) {
                return { ...yield* rotateImageSteps((yield* flipImageSteps(im)), 90, state.background), virtualCanvas: magickTransposeCanvas(im, false) };
            }));
        }
        else if (t === "-transverse") {
            stack = (yield* mapMagickImagesSteps(stack, function* (im) {
                return { ...yield* rotateImageSteps((yield* flopImageSteps(im)), 90, state.background), virtualCanvas: magickTransposeCanvas(im, true) };
            }));
        }
        else if (t === "-auto-orient") {
            if (!stack.length) throw new Error(`no images found for operation '${t}'`);
            stack = (yield* mapMagickImagesSteps(stack, function* (im) {
                let output = yield* applyExifOrientationSteps(im);
                const virtualCanvas = magickAutoOrientCanvas(im);
                if (state.orientation !== undefined) output = { ...output, orientation: state.orientation };
                return virtualCanvas ? { ...output, virtualCanvas } : output;
            }));
        }
        else if (t === "-raise" || t === "+raise") {
            const g = parseMagickRaiseGeometry(tokens[++i] ?? "", t);
            const raised = t === "-raise";
            stack = yield* mapMagickImagesSteps(stack, function* (image) {
                const bw = Math.max(0, Math.round(g.isPercent ? image.width * (g.percentX ?? 100) / 100 : g.width ?? 4));
                const bh = Math.max(0, Math.round(g.isPercent ? image.height * (g.percentY ?? 100) / 100 : g.height ?? bw));
                return yield* applyMagickRasterSteps(image, raisePixelSteps(image, bw, bh, raised, [state.channels.r, state.channels.g, state.channels.b, image.hasAlpha && (state.channels.a || !state.channelExplicit)]), signal);
            });
        }
        else if (t === "-frame") {
            const raw = tokens[++i] ?? "";
            validateMagickTransformGeometry(raw, t);
            const g = parseMagickGeometry(raw.replace(":", "x"));
            const hasAxes = raw.toLowerCase().includes("x");
            stack = yield* mapMagickImagesSteps(stack, function* (im) {
                const fw = Math.max(0, Math.round(g.isPercent ? im.width * (g.percentX ?? 100) / 100 : g.width ?? (hasAxes ? 0 : im.width)));
                const fh = Math.max(0, Math.round(g.isPercent ? im.height * (g.percentY ?? 100) / 100 : g.height ?? (hasAxes ? 0 : g.width ?? im.height)));
                const width = im.width + 2 * fw, height = im.height + 2 * fh;
                const canvas = { ...yield* applyMagickRasterSteps(im, magickFramePixels(im, width, height, state.borderColor, state.matteColor, fw, fh, g.x, g.y, state.composeRaw.toLowerCase() === "over"), signal,
                    { width, height, hasAlpha: im.hasAlpha || state.matteColor.a < 255 || state.borderColor.a < 255 }), virtualCanvas: magickBorderCanvas(im, fw, fh) };
                if (state.composeRaw.toLowerCase() === "over") return canvas;
                return yield* applyMagickCompositeLayerSteps(canvas, im, state.composeRaw, fw, fh, state.composeArgs, signal, state.alphaFuzz, true);
            });
        }
        else if (t === "-deskew") {
            const spec = tokens[++i] ?? "";
            stack = yield* mapMagickImagesSteps(stack, function* (image) {
                const plan = deskewPlan(image, yield* deskewAngleSteps(image, spec), state.pointFilter);
                const rotated = { ...yield* applyMagickRasterSteps(image, deskewPixelSteps(image, plan, state.backgroundExplicit ? state.background : image.backgroundColor ?? state.background, state.deskewAutoCrop), signal, plan), virtualCanvas: plan.virtualCanvas, properties: plan.properties };
                if (!["1", "true", "yes", "on"].includes(state.deskewAutoCrop ?? "")) return rotated;
                const median = yield* applyMagickRasterSteps(rotated, morphologyPixelSteps(rotated, magickMedianRows("3"), "median"), signal);
                // Native crop geometry is relative to the virtual page, not the raster origin.
                const bounds = yield* trimMagickSteps({ ...median, virtualCanvas: { ...plan.virtualCanvas, x: 0, y: 0 } }, state.alphaFuzz);
                if (bounds.virtualCanvas!.x === -1 && bounds.virtualCanvas!.y === -1) return bounds;
                return { ...yield* extractImageSteps(rotated, { left: bounds.virtualCanvas!.x - plan.virtualCanvas.x, top: bounds.virtualCanvas!.y - plan.virtualCanvas.y, width: bounds.width, height: bounds.height }), virtualCanvas: bounds.virtualCanvas! };
            });
        }
        else if (t === "-blur" || t === "-gaussian-blur") {
            const g = parseMagickGeometry(tokens[++i] ?? "0x1");
            stack = yield* mapMagickImagesSteps(stack, function* (im) {
                return yield* applyMagickRasterSteps(im, blurPixelSteps(im, g, t === "-gaussian-blur", state.channelExplicit ? state.channels : undefined), signal);
            });
        }
        else if (t === "-wavelet-denoise") {
            const geometry = tokens[++i] ?? "";
            stack = yield* mapMagickImagesSteps(stack, function* (im) {
                return yield* applyMagickRasterSteps(im, waveletDenoisePixelSteps(im, geometry), signal);
            });
        }
        else if (t === "-lat") {
            const geometry = parseLocalThresholdGeometry(tokens[++i] ?? "");
            stack = yield* mapMagickImagesSteps(stack, function* (im) {
                return yield* applyMagickRasterSteps(im, localThresholdPixelSteps(im, geometry, state.background, state.virtualPixel, state.channelExplicit ? state.channels : undefined), signal);
            });
        }
        else if (t === "-mean-shift") {
            const geometry = parseMeanShiftGeometry(tokens[++i] ?? "");
            stack = yield* mapMagickImagesSteps(stack, function* (im) {
                return yield* applyMagickRasterSteps(im, meanShiftPixelSteps(im, geometry, state.background, state.virtualPixel), signal);
            });
        }
        else if (t === "-kuwahara") {
            const geometry = parseMagickGeometry(tokens[++i] ?? "0x1");
            stack = yield* mapMagickImagesSteps(stack, function* (im) {
                return yield* applyMagickRasterSteps(im, kuwaharaPixelSteps(im, geometry, state.background, state.virtualPixel, state.channelExplicit ? state.channels : undefined), signal);
            });
        }
        else if (t === "-rotational-blur") {
            const geometry = tokens[++i] ?? "";
            stack = yield* mapMagickImagesSteps(stack, function* (im) {
                const expanded = yield* formatMagickPropertyStringSteps(geometry, im, () => im, { ...(im as MagickImage)[magickInput], optionProperties: state.optionProperties });
                const angle = parseMagickRotationalBlurAngle(expanded);
                return yield* applyMagickRasterSteps(im, rotationalBlurPixelSteps(im, angle, state.background, state.virtualPixel, state.channelExplicit ? state.channels : undefined), signal);
            });
        }
        else if (t === "-sharpen") {
            const geometry = parseMagickGeometry(tokens[++i] ?? "0x1");
            stack = yield* mapMagickImagesSteps(stack, function* (im) {
                return yield* applyMagickRasterSteps(im, sharpenPixelSteps(im, geometry), signal);
            });
        }
        else if (t === "-unsharp") {
            const geometry = parseUnsharpGeometry(tokens[++i] ?? "0x1");
            stack = yield* mapMagickImagesSteps(stack, function* (im) {
                return yield* applyMagickRasterSteps(im, blurPixelSteps(im, geometry, false, state.channelExplicit ? state.channels : undefined, geometry), signal);
            });
        }
        else if (t === "-median") {
            const rows = magickMedianRows(tokens[++i] ?? "3");
            stack = yield* mapMagickImagesSteps(stack, function* (im) {
                return yield* applyMagickRasterSteps(im, morphologyPixelSteps(im, rows, "median"), signal);
            });
        }
        else if (t === "-morphology") {
            const method = (tokens[++i] ?? "dilate").toLowerCase();
            let kernelSpec = "";
            if (tokens[i + 1] && !tokens[i + 1]!.startsWith("-") && !tokens[i + 1]!.startsWith("+")) {
                kernelSpec = tokens[++i]!;
            }
            if (method.split(":")[0] === "convolve" || method.split(":")[0] === "correlate") {
                const { iterations } = parseMagickMorphologyMethod(method);
                const kernel = parseMagickConvolveKernel(kernelSpec, false, method.split(":")[0] === "convolve");
                stack = yield* mapMagickImagesSteps(stack, function* (im) {
                    for (let pass = 0; kernel.weights.length && pass < iterations; pass++)
                        im = yield* applyMagickRasterSteps(im, convolvePixelSteps(im, kernel, 0), signal);
                    return im;
                });
            }
            else {
                stack = yield* mapMagickImagesSteps(stack, function* (im) {
                    return (yield* applyMagickMorphology4ChSteps(im, method, kernelSpec, signal, state.channelExplicit ? [state.channels.r, state.channels.g, state.channels.b, state.channels.a] : undefined));
                });
            }
        }
        else if (t === "-statistic") {
            const statType = (tokens[++i] ?? "median").toLowerCase();
            const geom = tokens[++i] ?? "3x3";
            stack = yield* mapMagickImagesSteps(stack, function* (im) {
                return (yield* applyMagickMorphology4ChSteps(im, statType, geom, signal, state.channelExplicit ? [state.channels.r, state.channels.g, state.channels.b, state.channels.a] : undefined));
            });
        }
        else if (t === "-channel-fx") {
            const selections = parseChannelSelections(tokens[++i] ?? ""), image = stack[0];
            const result: RgbaImage[] = [];
            if (image) for (const channels of selections) result.push(yield* selectMagickChannels(image, channels));
            stack = result;
        }
        else if (t === "-separate") {
            const nextStack: RgbaImage[] = [];
            for (const im of stack) {
                if (++cooperativeWork % 65536 === 0)
                    yield;
                const mask = [state.channels.r, state.channels.g, state.channels.b, state.channels.a];
                const channels = ([0, 1, 2, 3] as const).filter(channel =>
                    (channel === 3 ? im.hasAlpha : channel === 0 || (im.space !== "b-w" && im.space !== "grey16")) && (!state.channelExplicit || mask[channel]));
                // ImageMagick emits a black plane when none of the selected channels exist.
                if (channels.length === 0) channels.push(im.space === "b-w" || im.space === "grey16" ? 1 : 3);
                for (const channel of channels)
                    nextStack.push((yield* separateMagickChannelSteps(im, channel)));
            }
            stack = nextStack;
        }
        else if (t === "-combine") {
            if (stack.length > 0) {
                const rIm = stack[0]!;
                const sources = stack.slice(0, 4);
                const result = yield* applyMagickRasterSteps(rIm, combinePixelSteps(sources, sources.some(image => !!image.data16)), signal, rIm, sources);
                stack = [{ ...result, space: "srgb", channels: 4, hasAlpha: sources.length === 4 }];
            }
        }
        else if (t === "-draw") {
            const drawSpec = tokens[++i] ?? "";
            const tile = state.tile === undefined ? undefined : yield* parseInputOperandSteps(state.tile, files, state, stdinBytes);
            if (state.tile !== undefined && !tile) throw new Error(`Unable to read drawing tile '${state.tile}'`);
            stack = yield* mapMagickImagesSteps(stack, function* (im) {
                for (const step of magickDrawSteps(im, drawSpec, state)) {
                    if (!step) { yield; continue; }
                    if ((im.space === "b-w" || im.space === "grey16") && !((step.kind === "floodfill" || step.kind === "paint-point" || step.kind === "reset" || step.kind === "replace") && step.alphaOnly))
                        im = { ...im, space: "srgb", channels: im.hasAlpha ? 4 : 3 };
                    if (step.kind === "shape") im = yield* applyMagickRasterSteps(im, drawShapePixelSteps(im, step, !!im.data16, tile), signal, im, tile ? [im, tile] : [im]);
                    else if (step.kind === "paint-point" || step.kind === "reset") im = yield* applyMagickRasterSteps(im, drawPointPixelSteps(im, step, !!im.data16), signal, { ...im, hasAlpha: im.hasAlpha || step.color.a < 255 });
                    else if (step.kind === "replace") im = yield* applyMagickRasterSteps(im, drawReplacePixelSteps(im, step.x, step.y, step.color, step.alphaOnly, state.alphaFuzz, !!im.data16), signal, { ...im, hasAlpha: true });
                    else if (step.kind === "floodfill") im = yield* applyMagickFloodfillSteps(im, `+${step.x}+${step.y}`, step.fillToBorder ? state.borderColor : undefined, step.color, state.alphaFuzz, signal, step.alphaOnly, undefined, step.fillToBorder);
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
            stack = yield* mapMagickImagesSteps(stack, function* (im) {
                return (yield* applyMagickRasterSteps(im, annotatePixelSteps(im, offset, text, state), signal));
            });
        }
        else if (t === "+clone" || t === "-clone") {
            const sourcePool = parentStack ?? stack;
            if (sourcePool.length === 0) throw new Error(`UnableToCloneImage ${t}`);
            const spec = t === "+clone" ? "-1" : (tokens[++i] ?? "-1");
            for (const idx of parseMagickIndexSpec(spec, sourcePool.length, "clone")) {
                if (++cooperativeWork % 65536 === 0)
                    yield;
                const chosen = sourcePool[idx];
                if (chosen)
                    stack.push({ ...chosen, data: new Uint8Array(chosen.data) });
            }
        }
        else if (t === "-duplicate" || t === "+duplicate") {
            if (stack.length === 0) throw new Error(`no images found for operation ${t}`);
            let count = 1;
            let idxSpec = "-1";
            if (t === "-duplicate") {
                const value = tokens[++i] ?? "", comma = value.indexOf(",");
                const countSpec = comma < 0 ? value : value.slice(0, comma);
                count = parseInt(countSpec, 10);
                if (!Number.isSafeInteger(count)) throw new Error(`invalid argument ${value}`);
                idxSpec = comma < 0 ? "-1" : value.slice(comma + 1) || "-1";
                parseMagickIndices(idxSpec);
            }
            const sourcePool = stack;
            const sourceLength = sourcePool.length;
            for (let k = 0; k < count; k++) {
                if (++cooperativeWork % 65536 === 0)
                    yield;
                for (const idx of parseMagickIndexSpec(idxSpec, sourceLength, "clone")) {
                    if (++cooperativeWork % 65536 === 0)
                        yield;
                    const chosen = sourcePool[idx];
                    if (chosen)
                        stack.push({ ...chosen, data: new Uint8Array(chosen.data) });
                }
            }
        }
        else if (t === "+insert" || t === "-insert") {
            const rawIdx = t === "+insert" ? 0 : parseMagickInsertPosition(tokens[++i] ?? "0");
            const target = rawIdx < 0 ? stack.length - 1 + rawIdx : rawIdx;
            if (!Number.isInteger(target) || target < 0 || target >= stack.length || (rawIdx < 0 && target === 0)) throw new Error(`invalid image index ${t}`);
            if (stack.length > 1) {
                const last = stack.pop()!;
                stack.splice(target, 0, last);
            }
        }
        else if (t === "+swap" || t === "-swap") {
            let i1 = stack.length - 2;
            let i2 = stack.length - 1;
            if (t === "-swap") {
                const [s1, s2] = parseMagickIndices(tokens[++i] ?? "-2,-1", false).flat();
                i1 = (s1 ?? -2) < 0 ? stack.length + (s1 ?? -2) : (s1 ?? 0);
                i2 = (s2 ?? -1) < 0 ? stack.length + (s2 ?? -1) : (s2 ?? 0);
            }
            if (i1 === i2 || !stack[i1] || !stack[i2]) throw new Error(`invalid image index ${t}`);
            const tmp = stack[i1]!;
            stack[i1] = stack[i2]!;
            stack[i2] = tmp;
        }
        else if (t === "+delete" || t === "-delete") {
            if (t === "+delete") {
                const popped = stack.pop();
                if (popped) detachRgbaBuffer(popped.data);
            }
            else {
                const toDelete = new Set(parseMagickIndexSpec(tokens[++i] ?? "-1", stack.length, "delete"));
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
        else if (t === "-smush" || t === "+smush") {
            const geometry = tokens[++i] ?? "", image = stack[0];
            const gap = smushGap(image ? yield* formatMagickPropertyStringSteps(geometry, image, () => image, { ...(image as MagickImage)[magickInput], optionProperties: state.optionProperties }) : geometry);
            if (stack.length) {
                const background = state.backgroundExplicit ? state.background : image!.backgroundColor ?? state.background;
                const layout = smushLayoutSteps(stack, t === "-smush", gap, state.gravity, state.virtualPixel, background);
                let next = layout.next();
                while (!next.done) {
                    yield;
                    const request = next.value;
                    const image = stack[request.index]!;
                    next = layout.next((image.data16 ?? image.data).subarray(request.position, request.position + request.length));
                }
                const { width, height, virtualCanvas, offsets } = next.value;
                let canvas = yield* createSolidRgbaImageSteps(width, height, background);
                for (let n = 0; n < stack.length; n++) {
                    canvas = yield* applyMagickRasterSteps(canvas, smushCompositePixelSteps(canvas, stack[n]!, offsets[n]!.left, offsets[n]!.top, !!(canvas.data16 || stack[n]!.data16)), signal, canvas, [canvas, stack[n]!]);
                }
                for (const image of stack) detachRgbaBuffer(image.data);
                stack = [{ ...canvas, virtualCanvas }];
            }
        }
        else if (t === "-append" || t === "+append") {
            const oldStack = stack;
            const appended = (yield* appendStackImagesSteps(oldStack, t === "-append", state));
            for (const im of oldStack) {
                if (im.data.buffer !== appended.data.buffer) detachRgbaBuffer(im.data);
            }
            stack = [appended];
        }
        else if (t === "-layers" && tokens[i + 1]?.toLowerCase() === "optimizeframe") {
            for (const frame of stack) {
                if (frame.width !== stack[0]!.width || frame.height !== stack[0]!.height ||
                    (frame.virtualCanvas?.width || frame.width) !== frame.width ||
                    (frame.virtualCanvas?.height || frame.height) !== frame.height ||
                    frame.virtualCanvas?.x || frame.virtualCanvas?.y) throw new Error("image pages are not coalesced");
            }
            state.optimizeLayers = true; i++;
        }
        else if (t === "-flatten" || t === "-mosaic" || (t === "-layers" && ["flatten", "merge", "mosaic"].includes((tokens[i + 1] ?? "").toLowerCase()))) {
            const flatten = t === "-flatten" || (t === "-layers" && tokens[i + 1]?.toLowerCase() === "flatten");
            if (t === "-layers")
                i++;
            if (stack.length > 0) {
                const oldStack = stack;
                const maxW = flatten ? oldStack[0]!.virtualCanvas?.width || oldStack[0]!.width : Math.max(...oldStack.map((im) => im.width));
                const maxH = flatten ? oldStack[0]!.virtualCanvas?.height || oldStack[0]!.height : Math.max(...oldStack.map((im) => im.height));
                const canvas = (yield* createSolidRgbaImageSteps(maxW, maxH, state.background));
                const layers: CompositeLayer[] = [];
                for (const im of oldStack) {
                    const x = flatten ? im.virtualCanvas?.x ?? 0 : 0, y = flatten ? im.virtualCanvas?.y ?? 0 : 0;
                    const left = Math.max(0, -x), top = Math.max(0, -y);
                    const width = Math.min(im.width - left, maxW - Math.max(0, x)), height = Math.min(im.height - top, maxH - Math.max(0, y));
                    if (width <= 0 || height <= 0) continue;
                    const clipped = left || top || width !== im.width || height !== im.height
                        ? yield* extractImageSteps(im, { left, top, width, height })
                        : im;
                    layers.push(rgbaToCompositeLayer(clipped, Math.max(0, x), Math.max(0, y), state.compose));
                }
                const flattened = (yield* compositeImageSteps(canvas, layers));
                if (canvas.data.buffer !== flattened.data.buffer) detachRgbaBuffer(canvas.data);
                for (const im of oldStack) {
                    if (im.data.buffer !== flattened.data.buffer) detachRgbaBuffer(im.data);
                }
                const first = oldStack[0]! as MagickImage;
                stack = [{ ...flattened, delay: [first.delay?.[first[magickInput]?.sceneIdx ?? 0] ?? 0] }];
                if (flatten && first.orientation !== undefined) stack[0] = { ...stack[0]!, orientation: first.orientation };
            }
        }
        else if (t === "-layers" && tokens[i + 1]?.toLowerCase() === "composite") {
            i++;
            const separator = stack.findIndex(frame => (frame as MagickImage)[magickInput]?.filePath === "null:");
            if (separator < 0) throw new Error("missing Null Image List Separator layers Composite");
            const destinations = stack.slice(0, separator), sources = stack.slice(separator + 1);
            if (!destinations.length || !sources.length) throw new Error("image sequence is required '-layers Composite'");
            const count = destinations.length === 1 ? sources.length : sources.length === 1 ? destinations.length : Math.min(destinations.length, sources.length);
            const geometry = parseMagickGeometry(state.geometry ?? "+0+0");
            const composed: RgbaImage[] = [];
            for (let n = 0; n < count; n++) {
                const base = destinations[destinations.length === 1 ? 0 : n]!, overlay = sources[sources.length === 1 ? 0 : n]!;
                const offset = gravityAdjustBox(base.width, base.height, overlay.width, overlay.height, geometry.x, geometry.y, state.gravity);
                const result = yield* applyMagickCompositeLayerSteps(base, overlay, state.composeRaw, offset.x, offset.y, state.composeArgs, signal, state.alphaFuzz);
                composed.push({ ...base, ...result });
            }
            stack = composed;
        }
        else if (t === "-composite") {
            if (stack.length >= 2) {
                const base = stack[0]!;
                const mask = stack[2];
                const origOverlay = mask ? yield* applyMagickRasterSteps(stack[1]!, compositeMaskPixelSteps(stack[1]!, mask), signal, { ...stack[1]!, hasAlpha: true }, [stack[1]!, mask]) : stack[1]!;
                if (mask) { detachRgbaBuffer(stack[1]!.data); detachRgbaBuffer(mask.data); }
                let overlay = origOverlay;
                let gx = 0;
                let gy = 0;
                if (state.geometry && !state.composeTile) {
                    const g = parseMagickGeometry(state.geometry);
                    if (g.width !== undefined || g.height !== undefined) {
                        overlay = (yield* applyMagickResizeSteps(origOverlay, state.geometry, state.kernel, false, false, false, state.resizeFilter));
                        if (overlay.data.buffer !== origOverlay.data.buffer) detachRgbaBuffer(origOverlay.data);
                    }
                    gx = g.x;
                    gy = g.y;
                }
                if (state.composeTile) {
                    const tiled = yield* createSolidRgbaImageSteps(base.width, base.height, { r: 0, g: 0, b: 0, a: 0 });
                    for (let y = 0; y < base.height; y++) {
                        for (let x = 0; x < base.width; x++) {
                            if ((y * base.width + x) % 4096 === 0) yield;
                            const source = ((y % overlay.height) * overlay.width + x % overlay.width) * 4;
                            tiled.data.set(overlay.data.subarray(source, source + 4), (y * base.width + x) * 4);
                        }
                    }
                    detachRgbaBuffer(overlay.data);
                    overlay = tiled;
                }
                const pos = gravityAdjustBox(base.width, base.height, overlay.width, overlay.height, gx, gy, state.gravity);
                let composed: RgbaImage;
                if (state.composeRaw.toLowerCase() === "over") {
                    yield* blitOverRgbaInPlaceSteps(base, overlay, pos.x, pos.y);
                    detachRgbaBuffer(overlay.data);
                    composed = base;
                } else {
                    composed = (yield* applyMagickCompositeLayerSteps(base, overlay, state.composeRaw, pos.x, pos.y, state.composeArgs, signal, state.alphaFuzz));
                    if (composed !== base) detachRgbaBuffer(base.data);
                    if (composed !== overlay) detachRgbaBuffer(overlay.data);
                }
                stack = [composed, ...stack.slice(mask ? 3 : 2)];
            } else {
                throw new Error("image sequence is required '-composite'");
            }
        }
        else {
            if ((t.startsWith("-") && t !== "-") || t.startsWith("+")) throw new Error(`unrecognized option '${t}'`);
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
            if (!loaded) throw new Error(`unable to open image '${t}'`);
            for (const warning of loaded[0]?.decodeWarnings ?? []) analysis.warnings += `magick: ${warning}\n`;
            if (mergeOntoCanvas && loaded[0]) {
                yield* blitOverRgbaInPlaceSteps(stack[0]!, loaded[0], 0, 0);
                detachRgbaBuffer(loaded[0].data);
            } else {
                stack.push(...loaded);
            }
        }
        i++;
    }
    return stack;
}

function createConvertAnalysis() {
    let warnings = "";
    return {
        text: "", bytes: [] as Uint8Array[], quiet: false,
        get warnings() { return warnings; },
        set warnings(value: string) { if (!this.quiet) warnings = value; }
    };
}

function combineConvertOutput(result: ImageMagickCliResult, analysis: { text: string; warnings: string; bytes: Uint8Array[] }): ImageMagickCliResult {
    const stdout = analysis.text + result.stdout, stderr = analysis.warnings + result.stderr;
    if (!analysis.bytes.length) return { ...result, stdout, stderr };
    const chunks = [...analysis.bytes, ...(result.stdoutBytes ? [result.stdoutBytes] : stdout ? [new TextEncoder().encode(stdout)] : [])];
    const stdoutBytes = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.length, 0));
    let offset = 0;
    for (const chunk of chunks) { stdoutBytes.set(chunk, offset); offset += chunk.length; }
    return { ...result, stdout: "", stderr, stdoutBytes };
}

function* runConvertCliSteps(argv: readonly string[], files: Map<string, Uint8Array>, stdinBytes?: Uint8Array, signal?: AbortSignal): Generator<void, ImageMagickCliResult, void> {
    const analysis = createConvertAnalysis();
    const result = yield* runConvertCliResultSteps(argv, files, stdinBytes, signal, analysis);
    return combineConvertOutput(result, analysis);
}
function* runConvertCliResultSteps(argv: readonly string[], files: Map<string, Uint8Array>, stdinBytes?: Uint8Array, signal?: AbortSignal, analysis = createConvertAnalysis()): Generator<void, ImageMagickCliResult, void> {
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
    let outSpec = argv[argv.length - 1]!;
    const pipelineTokens = argv.slice(0, -1);
    const state = createDefaultState();
    try {
        const stack = (yield* evaluatePipelineTokensSteps(pipelineTokens, files, state, undefined, stdinBytes, signal, analysis));
        if (stack.length === 0) {
            return {
                exitCode: 1,
                stdout: "",
                stderr: `magick: no images defined '${outSpec}'\n`
            };
        }
        const outputTemplate = outSpec;
        outSpec = expandFilenameProperties(outSpec, stack[0]!.properties);
        const filenameExpanded = outSpec !== outputTemplate;
        const histogramInfo = outSpec.toLowerCase().startsWith("histogram:info:");
        const histogramComment = histogramInfo && state.formatStr === "%c";
        if (histogramInfo) outSpec = outSpec.slice(10);
        if (!histogramComment && (histogramInfo || (outSpec.toLowerCase().startsWith("histogram:") && !["", "-"].includes(outSpec.slice(10))))) {
            if (!histogramInfo) outSpec = outSpec.slice(10);
            for (let index = 0; index < stack.length; index++) {
                let source = stack[index]!;
                if (histogramInfo && state.formatStr && (state.formatStr.includes("%c") || state.formatStr.includes("%[comment]"))) source = { ...source, properties: { ...source.properties, comment: yield* formatHistogramOutputSteps(source) } };
                stack[index] = yield* applyMagickRasterSteps({ ...source, space: "srgb", channels: 3 }, histogramPixelSteps(source.width * source.height), signal, { width: 256, height: 200, hasAlpha: false });
            }
        }
        const finalImg = stack[stack.length - 1]!;
        const outLower = outSpec.toLowerCase();
        if (outLower === "null:" || outLower.startsWith("mpr:")) return { exitCode: 0, stdout: "", stderr: "" };
        if (outLower.startsWith("info:")) {
            const formatted: string[] = [];
            for (const [idx, im] of stack.entries()) {
                formatted.push(histogramComment ? yield* formatHistogramOutputSteps(im) : state.formatStr !== undefined
                    ? yield* formatMagickPropertyStringSteps(state.formatStr, im, () => im, {
                        ...(im as MagickImage)[magickInput], analysis, sceneIdx: idx, sceneCount: stack.length, quality: state.quality, channelSelection: state.channelExplicit ? state.channels : undefined
                    })
                    : `${im.width}x${im.height} ${im.magickColorspace ?? "sRGB"} 8-bit`);
            }
            const outText = formatted.join(state.formatStr !== undefined ? "" : "\n");
            const result = histogramInfo && state.formatStr !== undefined || outText.endsWith("\n") ? outText : `${outText}\n`;
            const target = outSpec.slice(5);
            if (target && target !== "-") {
                files.set(target, new TextEncoder().encode(result));
                return { exitCode: 0, stdout: "", stderr: "" };
            }
            return { exitCode: 0, stdout: result, stderr: "" };
        }
        if (outLower.startsWith("ftxt:") || (outLower.endsWith(".ftxt") && !outSpec.includes(":"))) {
            let text = "", work = 0;
            for (const frame of stack) for (const row of ftxtPixels(frame, state.ftxtFormat)) {
                if (++work % 4096 === 0) yield;
                text += row;
            }
            const target = outLower.startsWith("ftxt:") ? outSpec.slice(5) : outSpec;
            if (!target || target === "-") return { exitCode: 0, stdout: text, stderr: "" };
            files.set(target, new TextEncoder().encode(text));
            return { exitCode: 0, stdout: "", stderr: "" };
        }
        if (outLower.startsWith("sparse-color:") || outLower.startsWith("txt:") || (outLower.endsWith(".txt") && !outSpec.includes(":"))) {
            let txt = "";
            for (const frame of stack) {
                if (outLower.startsWith("sparse-color:")) {
                    const data = frame.data16 ?? frame.data;
                    for (let start = 0; start < data.length; start += 16384) {
                        yield;
                        for (const point of sparseColorPoints(frame, data.subarray(start, start + 16384), start / 4)) txt += point;
                    }
                } else txt += yield* formatTxtEnumerationSteps(frame, state.inputDepth);
            }
            const target = outLower.startsWith("sparse-color:") ? outSpec.slice(13) : outLower.startsWith("txt:") ? outSpec.slice(4) : outSpec;
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
        const { format, path: outPath, pngCoder, bmpFormat, gifVersion, tiffBig } = inferOutputFormat(outSpec, "png");
        if ((!state.filenameLiteral && filenameExpanded) || hasSceneOutputPattern(outPath, state.filenameLiteral) || (stack.length > 1 && (!state.adjoin || (outPath !== "-" && ["png", "jpeg", "bmp"].includes(format))))) {
            for (let idx = 0; idx < stack.length; idx++) {
                if (++cooperativeWork % 64 === 0)
                    yield;
                const framePath = formatSceneOutputPath(inferOutputFormat(outputTemplate).path, (state.scene ?? (stack[0] as MagickImage)[magickInput]?.sceneIdx ?? 0) + idx, state.filenameLiteral, stack[idx]!.properties);
                const { data: frameBytes } = encodeImage({ ...(yield* prepareMagickOutput(stack[idx]!, format, state.dither, state.diffusionAmount, pngCoder)), ...(format === "gif" && state.backgroundExplicit ? { backgroundColor: state.background } : {}) }, { format, pngCoder, gifVersion, tiffBig, bmpFormat: bmpFormat ?? state.bmpFormat ?? "bmp4", palette: true, pngColorType: pngOutputColorType(state.pngColorType, format, analysis), ...(state.miffCompression === undefined ? {} : { miffCompression: state.miffCompression }), ...(state.tgaCompression === undefined ? {} : { tgaCompression: state.tgaCompression }), ...(state.bmpCompression === undefined ? {} : { bmpCompression: state.bmpCompression }), ...(state.bmpSubtype === undefined ? {} : { bmpSubtype: state.bmpSubtype }), ...(state.bmp3Alpha === undefined ? {} : { bmp3Alpha: state.bmp3Alpha }), ...(state.inputDepth === undefined ? {} : { tiffIntegerDepth: state.inputDepth <= 8 ? 8 : state.inputDepth <= 16 ? 16 : 32 }), ...(state.tiffSigned === undefined ? {} : { tiffSigned: state.tiffSigned }), ...(state.tiffFloatingPoint ? { tiffFloatDepth: (state.inputDepth ?? 32) <= 16 ? 16 : (state.inputDepth ?? 32) <= 32 ? 32 : 64 } : {}), ...(state.tiffPlanar === undefined ? {} : { tiffPlanar: state.tiffPlanar }), ...(state.tiffAlpha === undefined ? {} : { tiffAlpha: state.tiffAlpha }), ...(state.tiffEndian === undefined ? {} : { tiffEndian: state.tiffEndian }), ...(state.tiffRowsPerStrip === undefined ? {} : { tiffRowsPerStrip: state.tiffRowsPerStrip }), ...(state.tiffTile === undefined ? {} : { tiffTile: state.tiffTile }), ...(state.tiffCompression === undefined ? {} : { tiffCompression: state.tiffCompression }), netpbmAscii: state.netpbmAscii ?? false, ...(state.inputDepth === undefined ? {} : { netpbmDepth: Math.min(16, state.inputDepth), miffDepth: state.inputDepth <= 8 ? 8 : 16 }), endian: state.inputEndian, pngPreserveColormap: state.pngPreserveColormap, pngBitDepth: state.pngBitDepth, ...(state.jpegRestartInterval === undefined ? {} : { jpegRestartInterval: state.jpegRestartInterval }), ...(state.jpegDctMethod === undefined ? {} : { jpegDctMethod: state.jpegDctMethod }), ...(state.jpegOptimizeCoding === undefined ? {} : { jpegOptimizeCoding: state.jpegOptimizeCoding }), ...(state.jpegArithmeticCoding === undefined ? {} : { jpegArithmeticCoding: state.jpegArithmeticCoding }), ...(state.jpegProgressive === undefined ? {} : { jpegProgressive: state.jpegProgressive }), pngInterlace: state.pngInterlace, gifInterlace: state.gifInterlace, transparentColor: state.transparentColor, omitPngResolution: state.strip || state.omitPngResolution === true, ...(state.samplingFactor === undefined ? {} : { samplingFactor: state.samplingFactor }), chromaSubsampling: state.quality < 90 ? "4:2:0" : "4:4:4", webpExact: state.webpExact ?? false, smartSubsample: state.webpSmartSubsample ?? false, alphaCompression: state.webpAlphaCompression ?? 1, alphaQuality: state.webpAlphaQuality ?? 100, webpTargetSize: state.webpTargetSize, webpPass: state.webpPass, jpegExtent: state.jpegExtent, quality: state.quality, ...(format === "webp" ? { effort: state.webpMethod ?? 4, lossless: state.webpLossless ?? state.quality >= 100 } : {}) });
                files.set(framePath, frameBytes);
            }
            return { exitCode: 0, stdout: "", stderr: "" };
        }
        let toEncode = stack.length > 1 && format === "miff" ? yield* prepareMiffPages(stack) : format === "ico" ? yield* prepareIcoPages(stack, state.iconAutoResize, state.kernel, state.resizeFilter) : stack.length > 1 && format === "tiff" ? yield* prepareTiffPages(stack) : yield* prepareMagickOutput(finalImg, format, state.dither, state.diffusionAmount, pngCoder);
        let encodePageHeight: number | undefined;
        if (stack.length > 1 && (format === "gif" || format === "apng" || format === "mng" || format === "webp")) {
            toEncode = yield* prepareGifFrames(stack, format === "gif" ? state.dither : false, state.diffusionAmount);
            encodePageHeight = toEncode.pageHeight;
        }
        if (typeof (globalThis as { gc?: () => void }).gc === "function") { try { const gc = (globalThis as { gc?: () => void }).gc!; gc(); gc(); } catch { /* Collection is best-effort. */ } }
        const { data: encoded } = encodeImage({ ...(toEncode), ...(format === "gif" && state.backgroundExplicit ? { backgroundColor: state.background } : {}) }, {
            format, pngCoder, gifVersion, tiffBig, bmpFormat: bmpFormat ?? state.bmpFormat ?? "bmp4", palette: true, pngColorType: pngOutputColorType(state.pngColorType, format, analysis),
            ...(state.miffCompression === undefined ? {} : { miffCompression: state.miffCompression }), ...(state.tgaCompression === undefined ? {} : { tgaCompression: state.tgaCompression }), ...(state.bmpCompression === undefined ? {} : { bmpCompression: state.bmpCompression }), ...(state.bmpSubtype === undefined ? {} : { bmpSubtype: state.bmpSubtype }), ...(state.bmp3Alpha === undefined ? {} : { bmp3Alpha: state.bmp3Alpha }), ...(state.inputDepth === undefined ? {} : { tiffIntegerDepth: state.inputDepth <= 8 ? 8 : state.inputDepth <= 16 ? 16 : 32 }), ...(state.tiffSigned === undefined ? {} : { tiffSigned: state.tiffSigned }), ...(state.tiffFloatingPoint ? { tiffFloatDepth: (state.inputDepth ?? 32) <= 16 ? 16 : (state.inputDepth ?? 32) <= 32 ? 32 : 64 } : {}), ...(state.tiffPlanar === undefined ? {} : { tiffPlanar: state.tiffPlanar }), ...(state.tiffAlpha === undefined ? {} : { tiffAlpha: state.tiffAlpha }), ...(state.tiffEndian === undefined ? {} : { tiffEndian: state.tiffEndian }), ...(state.tiffRowsPerStrip === undefined ? {} : { tiffRowsPerStrip: state.tiffRowsPerStrip }), ...(state.tiffTile === undefined ? {} : { tiffTile: state.tiffTile }), ...(state.tiffCompression === undefined ? {} : { tiffCompression: state.tiffCompression }), netpbmAscii: state.netpbmAscii ?? false, ...(state.inputDepth === undefined ? {} : { netpbmDepth: Math.min(16, state.inputDepth), miffDepth: state.inputDepth <= 8 ? 8 : 16 }), endian: state.inputEndian, pngPreserveColormap: state.pngPreserveColormap, pngBitDepth: state.pngBitDepth, ...(state.jpegRestartInterval === undefined ? {} : { jpegRestartInterval: state.jpegRestartInterval }), ...(state.jpegDctMethod === undefined ? {} : { jpegDctMethod: state.jpegDctMethod }), ...(state.jpegOptimizeCoding === undefined ? {} : { jpegOptimizeCoding: state.jpegOptimizeCoding }), ...(state.jpegArithmeticCoding === undefined ? {} : { jpegArithmeticCoding: state.jpegArithmeticCoding }), ...(state.jpegProgressive === undefined ? {} : { jpegProgressive: state.jpegProgressive }), pngInterlace: state.pngInterlace, gifInterlace: state.gifInterlace, transparentColor: state.transparentColor, omitPngResolution: state.strip || state.omitPngResolution === true, ...(state.samplingFactor === undefined ? {} : { samplingFactor: state.samplingFactor }), chromaSubsampling: state.quality < 90 ? "4:2:0" : "4:4:4", webpExact: state.webpExact ?? false, smartSubsample: state.webpSmartSubsample ?? false, alphaCompression: state.webpAlphaCompression ?? 1, alphaQuality: state.webpAlphaQuality ?? 100, webpTargetSize: state.webpTargetSize, webpPass: state.webpPass, jpegExtent: state.jpegExtent, quality: state.quality, ...(format === "webp" ? { effort: state.webpMethod ?? 4, lossless: state.webpLossless ?? state.quality >= 100 } : {}),
            ...(encodePageHeight !== undefined ? { pageHeight: encodePageHeight } : { delay: toEncode.delay?.[(finalImg as MagickImage)[magickInput]?.sceneIdx ?? 0] }),
            ...(format === "gif" && stack.length === 1 ? { loop: 1 } : state.loop === undefined ? {} : { loop: state.loop }), ...(state.optimizeLayers ? { optimizeFrames: true, gifTransdiff: true } : {}),
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
        files.set(formatAdjoinedOutputPath(outPath, stack.length, state.scene ?? 0, state.filenameLiteral), encoded);
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
    let storedHueSamples: number | undefined;
    let storedData16: StoredRgbaImage["storedData16"];
    let next = steps.next();
    while (!next.done) {
        signal.throwIfAborted();
        const request = next.value;
        if (!request) { await yieldTurn(signal); await checkpoint?.(); next = steps.next(); }
        else if (request.kind === "write") {
            if (request.hue) {
                storedHueSamples ??= backend.storage.allocate(dimensions.width * dimensions.height * 32);
                await backend.storage.write(storedHueSamples + request.position * 8, request.data);
            } else if (request.highDepth) {
                storedData16 ??= { position: backend.storage.allocate(dimensions.width * dimensions.height * 8), length: dimensions.width * dimensions.height * 4 };
                await backend.storage.write(storedData16.position + request.position * 2, request.data);
                const samples = new Uint16Array(request.data.slice().buffer);
                await backend.storage.write(position + request.position, Uint8Array.from(samples, value => Math.round(value / 257)));
            } else await backend.storage.write(position + request.position, request.data);
            next = steps.next();
        }
        else {
            const source = typeof sources === "function" ? await sources(request.image ?? 0) : sources[request.image ?? 0]!;
            if (request.hue) {
                next = steps.next(source.storedHueSamples === undefined ? new Uint8Array() : await backend.storage.read(source.storedHueSamples + request.position * 8, request.length * 8));
                continue;
            }
            const highDepth = request.highDepth && source.storedData16, stride = highDepth ? 2 : 1;
            const base = highDepth ? highDepth.position : source.position;
            const offset = request.position * stride, length = request.length * stride;
            let bytes: Uint8Array;
            if (request.length !== 4) bytes = await backend.storage.read(base + offset, length);
            else {
                const sourceSize = source.width * source.height * 4 * stride, page = Math.floor(offset / 4096) * 4096, key = (request.image ?? 0) + ":" + stride + ":" + page;
                let cached = cache.get(key);
                if (!cached) {
                    cached = new Uint8Array(await backend.storage.read(base + page, Math.min(4096, sourceSize - page)));
                    if (cache.size === 32) cache.delete(cache.keys().next().value!);
                    cache.set(key, cached);
                }
                bytes = cached.subarray(offset - page, offset - page + length);
            }
            next = steps.next(request.highDepth && !highDepth ? new Uint8Array(Uint16Array.from(bytes, value => value * 257).buffer) : bytes);
        }
    }
    const { storedData16: _storedData16, ...metadata } = image;
    return { ...metadata, width: dimensions.width, height: dimensions.height, hasAlpha: dimensions.hasAlpha, position, ...(storedData16 ? { storedData16 } : {}), ...(storedHueSamples === undefined ? {} : { storedHueSamples }) };
}

async function morphStoredMagickImage(image: StoredRgbaImage, backend: CompareFileSession, plan: ReturnType<typeof magickMorphologyPlan>, signal: AbortSignal, channels?: readonly boolean[]): Promise<StoredRgbaImage> {
    const images = [image], size = image.width * image.height * 4;
    if (plan.iterations === 0) return image;
    for (const step of plan.steps) {
        if (step.mode === "thinning") {
            let source = images.at(-1)!;
            for (let pass = 0; pass < plan.iterations; pass++)
                for (const kernel of step.kernels)
                    source = await transformStoredMagickRaster(source, backend, hitAndMissPixelSteps(source, kernel.foreground, kernel.background, channels, true), signal);
            images.push(source);
        } else if (step.mode === "diff") {
            const position = backend.storage.allocate(size);
            const a = images[step.a]!, b = images[step.b]!;
            for (let offset = 0; offset < size; offset += 16384) {
                await yieldTurn(signal);
                const length = Math.min(16384, size - offset);
                const left = new Uint8Array(await backend.storage.read(a.position + offset, length));
                const bytes = await drainSteps(subtractMagickPixelSteps(left, await backend.storage.read(b.position + offset, length), image.hasAlpha, channels), signal);
                await backend.storage.write(position + offset, bytes);
            }
            images.push({ ...image, position });
        } else {
            let source = images[step.source]!;
            for (let pass = 0; pass < plan.iterations; pass++)
                source = await transformStoredMagickRaster(source, backend, step.mode === "distance" ? distancePixelSteps(source, step.scale, step.reverse, channels) : plan.backgroundRows ? hitAndMissPixelSteps(source, plan.rows, plan.backgroundRows, channels) : morphologyPixelSteps(source, step.mode === "max" ? plan.dilateRows ?? plan.rows : plan.rows, step.mode, channels), signal);
            images.push(source);
        }
    }
    return images.at(-1)!;
}

async function transformStoredMagickCoordinates(image: StoredRgbaImage, backend: CompareFileSession, token: string, geometry: string, state: MagickState, signal: AbortSignal, analysis: { warnings: string }): Promise<StoredRgbaImage> {
    const g = token === "-roll" ? parseMagickRollGeometry(geometry) : parseMagickGeometry(geometry), w = image.width, h = image.height;
    type Span = { source: number; target: number; length: number };
    let xs: Span[], ys: Span[], width = w, height = h;
    if (token === "-roll") {
        const dx = ((g.x % w) + w) % w;
        const dy = ((g.y % h) + h) % h;
        xs = [{ source: w - dx, target: 0, length: dx }, { source: 0, target: dx, length: w - dx }];
        ys = [{ source: h - dy, target: 0, length: dy }, { source: 0, target: dy, length: h - dy }];
    } else if (token === "-splice") {
        const { width: sw, height: sh } = resolveMagickSpliceGeometry(geometry, w, h);
        const box = gravityAdjustBox(w, h, sw, sh, g.x, g.y, state.gravity);
        // Native West splice uses the width for its vertical anchor.
        const anchor = resolveGravityOffset(sw, state.gravity === "west" ? sw : sh, state.gravity);
        width += sw; height += sh;
        const xOffset = box.x + anchor.left;
        const spliceWidth = Math.max(0, sw + Math.min(0, xOffset));
        const x = xOffset > w ? width : Math.max(0, xOffset);
        if (box.y + anchor.top > height) throw new Error("pixels are not authentic");
        const y = Math.max(0, Math.min(h, box.y + anchor.top));
        xs = [{ source: 0, target: 0, length: x }, { source: x, target: x + spliceWidth, length: Math.max(0, width - x - spliceWidth) }];
        ys = [{ source: 0, target: 0, length: y }, { source: y, target: y + sh, length: h - y }];
    } else {
        const { width: cw, height: ch } = resolveMagickChopGeometry(g, geometry, w, h);
        const { x, y } = gravityAdjustBox(w, h, cw, ch, g.x, g.y, state.gravity);
        if (x + cw < 0 || y + ch < 0 || x > w || y > h) {
            analysis.warnings += `magick: geometry does not contain image '${geometry}'\n`;
            return image;
        }
        const x0 = Math.max(0, Math.min(w, x)), x1 = Math.max(x0, Math.min(w, x + cw));
        const y0 = Math.max(0, Math.min(h, y)), y1 = Math.max(y0, Math.min(h, y + ch));
        if (x1 - x0 >= w || y1 - y0 >= h) {
            analysis.warnings += `magick: geometry does not contain image '${geometry}'\n`;
            return image;
        }
        width -= x1 - x0; height -= y1 - y0;
        xs = [{ source: 0, target: 0, length: x0 }, { source: x1, target: x0, length: w - x1 }];
        ys = [{ source: 0, target: 0, length: y0 }, { source: y1, target: y0, length: h - y1 }];
    }
    const background = state.backgroundExplicit ? state.background : image.backgroundColor ?? state.background;
    const position = token === "-splice" ? (await createStoredCanvas(width, height, background, backend, signal)).position : backend.storage.allocate(width * height * 4);
    const storedData16 = image.storedData16 ? { position: backend.storage.allocate(width * height * 8), length: width * height * 4 } : undefined;
    if (storedData16 && token === "-splice") {
        const color = [background.r, background.g, background.b, background.a].map(value => Math.round(value * 257));
        for (let offset = 0; offset < storedData16.length; offset += 16384) {
            await yieldTurn(signal);
            const samples = new Uint16Array(Math.min(16384, storedData16.length - offset));
            for (let i = 0; i < samples.length; i += 4) samples.set(color, i);
            await backend.storage.write(storedData16.position + offset * 2, new Uint8Array(samples.buffer));
        }
    }
    let work = 0;
    for (const plane of [{ source: image.position, target: position, stride: 4 }, ...(storedData16 ? [{ source: image.storedData16!.position, target: storedData16.position, stride: 8 }] : [])]) {
        for (const y of ys) for (let row = 0; row < y.length; row++) for (const x of xs) {
            for (let offset = 0; offset < x.length; offset += 4096) {
                if (work++ % 64 === 0) await yieldTurn(signal);
                const length = Math.min(4096, x.length - offset) * plane.stride;
                const sourceX = Math.min(w - 1, x.source + offset);
                const sourceLength = Math.min(length, (w - sourceX) * plane.stride);
                let bytes = await backend.storage.read(plane.source + ((y.source + row) * w + sourceX) * plane.stride, sourceLength);
                if (sourceLength < length) {
                    const extended = new Uint8Array(length);
                    extended.set(bytes);
                    const edge = bytes.subarray(sourceLength - plane.stride);
                    for (let i = sourceLength; i < length; i += plane.stride) extended.set(edge, i);
                    bytes = extended;
                }
                await backend.storage.write(plane.target + ((y.target + row) * width + x.target + offset) * plane.stride, bytes);
            }
        }
    }
    const virtualCanvas = token !== "-roll" ? magickResizeCanvas(image, width, height) : undefined;
    return { ...image, position, width, height, ...(storedData16 ? { storedData16 } : {}), ...(token === "-splice" ? { hasAlpha: true } : {}),
        ...(virtualCanvas ? { virtualCanvas } : {}) };
}

async function compositeStoredMagick(base: StoredRgbaImage, overlay: StoredRgbaImage, backend: CompareFileSession, signal: AbortSignal, left: number, top: number, mode: string, args?: string, generic = false, inPlace = false, montageRounding = false, tile = false, fuzz = 0, clipToOverlay = false): Promise<StoredRgbaImage> {
    const compositeMode = magickCompositeMode(mode);
    let hasAlpha = base.hasAlpha || (!generic && !compositeMode.delegated && !compositeMode.preservesAlpha);
    const position = inPlace ? base.position : backend.storage.allocate(base.width * base.height * 4);
    for (let start = 0; !inPlace && start < base.width * base.height * 4; start += 16384) {
        await yieldTurn(signal); await backend.storage.write(position + start, await backend.storage.read(base.position + start, Math.min(16384, base.width * base.height * 4 - start)));
    }
    const maskDestination = !generic && ["dstin", "destin", "srcin", "in", "srcout", "out", "dstatop", "destatop"].includes(compositeMode.name);
    const extendSource = !clipToOverlay && (maskDestination || (!generic && ["src", "source", "copy"].includes(compositeMode.name)));
    const right = tile || extendSource ? base.width : Math.min(base.width, left + overlay.width);
    const bottom = tile || extendSource ? base.height : Math.min(base.height, top + overlay.height);
    for (let y = extendSource ? 0 : Math.max(0, top); y < bottom; y++) {
        for (let x = extendSource ? 0 : Math.max(0, left); x < right;) {
            await yieldTurn(signal);
            const sourceX = tile ? x % overlay.width : Math.max(0, Math.min(overlay.width - 1, x - left));
            const sourceY = tile ? y % overlay.height : Math.max(0, Math.min(overlay.height - 1, y - top));
            const repeatEdge = extendSource && !tile && (x < left || x >= left + overlay.width);
            const count = Math.min(4096, right - x, repeatEdge ? (x < left ? left - x : right - x) : overlay.width - sourceX), destination = (y * base.width + x) * 4;
            const dst: RgbaImage = { ...base, width: count, height: 1, data: new Uint8Array(await backend.storage.read(position + destination, count * 4)) };
            if (maskDestination && !tile && (x < left || x >= left + overlay.width || y < top || y >= top + overlay.height)) {
                if (base.hasAlpha) {
                    for (let pixel = 3; pixel < dst.data.length; pixel += 4) dst.data[pixel] = 0;
                    await backend.storage.write(position + destination, dst.data);
                }
                x += count;
                continue;
            }
            const sourceData = await backend.storage.read(overlay.position + (sourceY * overlay.width + sourceX) * 4, repeatEdge ? 4 : count * 4);
            const src: RgbaImage = { ...overlay, width: count, height: 1, data: new Uint8Array(count * 4) };
            if (repeatEdge) for (let pixel = 0; pixel < count; pixel++) src.data.set(sourceData, pixel * 4);
            else src.data.set(sourceData);
            let result = dst;
            if (montageRounding) {
                for (let pixel = 0; pixel < count * 4; pixel += 4) {
                    const alpha = src.data[pixel + 3]!;
                    if (alpha === 255) dst.data.set(src.data.subarray(pixel, pixel + 4), pixel);
                    else if (alpha > 0) {
                        const sa = alpha / 255, da = dst.data[pixel + 3]! / 255, outA = sa + da * (1 - sa);
                        for (let channel = 0; channel < 3; channel++) dst.data[pixel + channel] = Math.round((src.data[pixel + channel]! * sa + dst.data[pixel + channel]! * da * (1 - sa)) / outA);
                        dst.data[pixel + 3] = Math.round(outA * 255);
                    }
                }
            }
            else if (generic) result = await drainSteps(compositeImageSteps(dst, [rgbaToCompositeLayer(src, 0, 0, mode as MagickState["compose"])]), signal);
            else if (mode.toLowerCase() === "over") await drainSteps(blitOverRgbaInPlaceSteps(dst, src, 0, 0), signal);
            else result = await drainSteps(applyMagickCompositeLayerSteps(dst, src, mode, 0, 0, args, signal, fuzz), signal);
            hasAlpha ||= result.hasAlpha;
            await backend.storage.write(position + destination, result.data);
            x += count;
        }
    }
    return { ...base, position, hasAlpha, channels: hasAlpha ? base.channels : base.channels <= 2 ? 1 : 3 };
}

function applyMagickProfile<T extends { readonly icc?: Uint8Array; readonly exif?: Uint8Array }>(image: T, name: string, profile?: Uint8Array): T {
    if (profile) {
        if (profile.length < 128 || String.fromCharCode(...profile.subarray(36, 40)) !== "acsp") throw new Error(`invalid ICC profile '${name}'`);
        if (image.icc && (image.icc.length !== profile.length || image.icc.some((byte, index) => byte !== profile[index]))) throw new Error("ICC color conversion is unsupported");
        return { ...image, icc: profile };
    }
    if (["exif", "*"].includes(name.toLowerCase())) {
        const { exif: ignored, ...rest } = image;
        image = rest as T;
    }
    if (["icc", "icm", "*"].includes(name.toLowerCase())) {
        const { icc: ignored, ...rest } = image;
        return rest as T;
    }
    return image;
}

async function tryConvertFiles(argv: readonly string[], input: ConvertFileInput, stdinBytes: Uint8Array | undefined, signal: AbortSignal): Promise<ImageMagickCliResult | undefined> {
    const analysis = createConvertAnalysis();
    const result = await tryConvertFilesResult(argv, input, stdinBytes, signal, analysis);
    return result ? combineConvertOutput(result, analysis) : undefined;
}
async function tryConvertFilesResult(argv: readonly string[], input: ConvertFileInput, stdinBytes: Uint8Array | undefined, signal: AbortSignal, analysis: ReturnType<typeof createConvertAnalysis>): Promise<ImageMagickCliResult | undefined> {
    if (!input.filesystem.capabilities || !input.filesystem.open || !input.filesystem.removeFileConditional) return;
    let outSpec = argv.at(-1) ?? "";
    const optionArgs = argv.slice(0, argv.indexOf("--") < 0 ? argv.length : argv.indexOf("--"));
    if (!outSpec || tryHandleMagickListOption(argv) || optionArgs.some(token => ["--help", "-help", "-h", "--version", "-version"].includes(token))) {
        await probeImageArguments(argv, input, stdinBytes, signal);
        return drainSteps(runConvertCliSteps(argv, new Map(), stdinBytes, signal), signal);
    }
    let output: ReturnType<typeof inferOutputFormat>;
    await yieldTurn(signal);
    let state = createDefaultState();
    const tokens = argv.slice(0, -1), scopes: { state: MagickState; end: number }[] = [];
    type StackStep = (stack: StoredImageStack, backend: CompareFileSession, parents: StoredImageStack[]) => Promise<StoredImageStack>;
    type Step = ((image: StoredRgbaImage | undefined, backend: CompareFileSession) => Promise<StoredRgbaImage | undefined>) | { runStack: StackStep };
    const steps: Step[] = [];
    const registers = new Map<string, StoredImageStack>();
    const stackStep = (runStack: StackStep) => { steps.push({ runStack }); };
    let operandsOnly = false;
    try {
    output = inferOutputFormat(outSpec, "png");
    for (let i = 0; i < tokens.length; i++) {
        if (i && i % 64 === 0) await yieldTurn(signal);
        const token = tokens[i]!;
        if (token === "") continue;
        if (!operandsOnly && (token === "-quiet" || token === "+quiet")) {
            stackStep(async stack => { analysis.quiet = token === "-quiet"; return stack; });
            continue;
        }
        if (!operandsOnly && (token === "-regard-warnings" || token === "+regard-warnings")) continue;
        if (!operandsOnly && token === "-sampling-factor") { state.samplingFactor = tokens[++i] ?? ""; continue; }
        if (!operandsOnly && token === "+sampling-factor") { delete state.samplingFactor; continue; }
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
            if (token === "-duplicate") {
                const value = tokens[++i] ?? "", comma = value.indexOf(",");
                count = parseInt(value, 10);
                if (!Number.isSafeInteger(count)) throw new Error(`invalid argument ${value}`);
                spec = comma < 0 ? "-1" : value.slice(comma + 1) || "-1";
                parseMagickIndices(spec);
            }
            stackStep(async (stack, _backend, parents) => {
                if (token.endsWith("duplicate") && stack.length === 0) throw new Error(`no images found for operation ${token}`);
                if (token.endsWith("clone") || token.endsWith("duplicate")) {
                    const source = token.endsWith("clone") ? parents.at(-1) ?? stack : stack;
                    const length = source.length;
                    if (token.endsWith("clone") && length === 0) throw new Error(`UnableToCloneImage ${token}`);
                    for (let repeat = 0; repeat < count; repeat++) for (const index of parseMagickIndexSpec(spec, length, "clone")) { await yieldTurn(signal); await stack.push((await source.get(index))!); }
                } else if (token.endsWith("delete")) await stack.remove(parseMagickIndexSpec(spec, stack.length, "delete"));
                else if (token === "-reverse") { for (let n = 0; n < Math.floor(stack.length / 2); n++) { await yieldTurn(signal); await stack.swap(n, stack.length - 1 - n); } }
                else if (token.endsWith("insert")) {
                    const raw = token === "+insert" ? 0 : parseMagickInsertPosition(spec), target = raw < 0 ? stack.length - 1 + raw : raw;
                    if (!Number.isInteger(target) || target < 0 || target >= stack.length || (raw < 0 && target === 0)) throw new Error(`invalid image index ${token}`);
                    for (let n = stack.length - 1; n > target; n--) { await yieldTurn(signal); await stack.swap(n, n - 1); }
                } else {
                    const values = parseMagickIndices(token === "+swap" ? "-2,-1" : spec, false).flat();
                    const a = values[0] ?? -2, b = values[1] ?? -1;
                    const i1 = a < 0 ? stack.length + a : a, i2 = b < 0 ? stack.length + b : b;
                    if (i1 === i2 || i1 < 0 || i2 < 0 || i1 >= stack.length || i2 >= stack.length) throw new Error(`invalid image index ${token}`);
                    await stack.swap(i1, i2);
                }
                return stack;
            });
            continue;
        }
        if (!operandsOnly && token === "-channel-fx" && !(tokens[i + 1] ?? "").includes("=>")) {
            const selections = parseChannelSelections(tokens[++i] ?? "");
            stackStep(async (stack, backend) => {
                const result = new StoredImageStack(backend.storage, signal, stack), image = await stack.get(0);
                if (image) for (const channels of selections) {
                    await result.push(await transformStoredMagickPixels(image, backend, { end: 0, highDepth: true, apply: image => selectMagickChannels(image, channels) }, signal));
                }
                return result;
            });
            continue;
        }
        if (!operandsOnly && ["-clut", "-hald-clut", "-separate", "-combine", "-morph", "-evaluate-sequence", "-average"].includes(token)) {
            const argument = token === "-morph" || token === "-evaluate-sequence" ? tokens[++i] ?? (token === "-morph" ? "1" : "Mean") : token === "-average" ? "Mean" : "", settings = { ...state, channels: { ...state.channels } };
            stackStep(async (stack, backend) => {
                if (token === "-average") analysis.warnings += 'magick: option has been replaced \'-average\', use "-evaluate-sequence Mean"\n';
                if (token === "-clut" || token === "-hald-clut") {
                    if (stack.length < 2) throw new Error(`image sequence is required '${token}'`);
                    const lut = (await stack.get(token === "-clut" ? 1 : stack.length - 1))! as StoredRgbaImage;
                    const image = (await stack.get(0))! as StoredRgbaImage;
                    const mask = [settings.channels.r, settings.channels.g, settings.channels.b, token === "-clut" ? image.hasAlpha && (settings.channels.a || !settings.channelExplicit) : settings.channels.a || !settings.channelExplicit];
                    const hasAlpha = image.hasAlpha || (token === "-hald-clut" && lut.hasAlpha && mask[3]!);
                    const { magickColorspace: ignoredColorspace, ...metadata } = image;
                    const colorspace = token === "-hald-clut" ? lut.magickColorspace : image.magickColorspace;
                    let result = await transformStoredMagickRaster({ ...metadata, ...(colorspace ? { magickColorspace: colorspace } : {}), space: "srgb", channels: hasAlpha ? 4 : 3 }, backend, (token === "-hald-clut" ? haldClutPixelSteps : clutPixelSteps)(image.width * image.height * 4, lut, mask, !!(image.storedData16 || lut.storedData16), settings.interpolation), signal, { ...image, hasAlpha }, [image, lut]);
                    if (image.region) result = await transformStoredMagickRaster(result, backend, regionPixelSteps(result, image.region, !!result.storedData16), signal, result, [result, image]);
                    if (image.storedWriteMask) result = await transformStoredMagickRaster(result, backend, writeMaskPixelSteps(result, image.storedWriteMask, !!result.storedData16), signal, result, [result, image, { ...image, ...image.storedWriteMask }]);
                    await stack.set(0, result);
                    stack.length = 1;
                } else if (token === "-separate") {
                    const result = new StoredImageStack(backend.storage, signal, stack), mask = [settings.channels.r, settings.channels.g, settings.channels.b, settings.channels.a];
                    for (let index = 0; index < stack.length; index++) {
                        const image = (await stack.get(index))!;
                        const channels = ([0, 1, 2, 3] as const).filter(channel =>
                            (channel === 3 ? image.hasAlpha : channel === 0 || (image.space !== "b-w" && image.space !== "grey16")) && (!settings.channelExplicit || mask[channel]));
                        if (channels.length === 0) channels.push(image.space === "b-w" || image.space === "grey16" ? 1 : 3);
                        for (const channel of channels) {
                            await result.push(await transformStoredMagickPixels(image, backend, { end: 0, highDepth: true, evaluate: true, apply: image => separateMagickChannelSteps(image, channel) }, signal));
                        }
                    }
                    return result;
                } else if (token === "-combine") {
                    if (stack.length === 0) return stack;
                    const sources: StoredRgbaImage[] = [];
                    for (let index = 0; index < Math.min(4, stack.length); index++) sources.push((await stack.get(index))!);
                    const base = sources[0]!, result = await transformStoredMagickRaster(base, backend, combinePixelSteps(sources, sources.some(image => !!image.storedData16)), signal, base, sources);
                    stack.length = 0; await stack.push({ ...result, space: "srgb", channels: 4, hasAlpha: sources.length === 4 });
                } else if (token === "-morph") {
                    const image = await stack.get(0);
                    const expanded = image ? await formatRetainedIdentify(argument, image, { ...(image as StoredMagickImage)[magickInput], optionProperties: settings.optionProperties }, async () => ({ image, storage: backend.storage }), signal) : argument;
                    const count = parseMagickMorphCount(expanded);
                    if (stack.length === 1 && count > 1) {
                        const image = (await stack.get(0))!;
                        for (let index = 1; index < count; index++) {
                            await yieldTurn(signal);
                            await stack.push(image);
                        }
                        return stack;
                    }
                    if (stack.length < 2 || count === 0) return stack;
                    const result = new StoredImageStack(backend.storage, signal, stack);
                    for (let index = 0; index < stack.length - 1; index++) {
                        const a = (await stack.get(index))!, b = (await stack.get(index + 1))!; await result.push(a);
                        for (let step = 1; step <= count; step++) {
                            await yieldTurn(signal);
                            const fraction = step / (count + 1), width = Math.max(1, Math.round(a.width * (1 - fraction) + b.width * fraction)), height = Math.max(1, Math.round(a.height * (1 - fraction) + b.height * fraction));
                            const virtualCanvas = magickResizeCanvas(a, width, height);
                            await result.push({ ...await transformStoredMagickRaster(a, backend, morphPixelSteps(a, b, width, height, fraction, settings.channelExplicit ? [settings.channels.r, settings.channels.g, settings.channels.b, settings.channels.a] : undefined, !!(a.storedData16 || b.storedData16), settings.kernel, settings.resizeFilter), signal, { ...a, width, height }, [a, b]), ...(virtualCanvas ? { virtualCanvas } : {}) });
                        }
                    }
                    await result.push((await stack.get(stack.length - 1))!); return result;
                } else if (stack.length > 0) {
                    let width = 0, height = 0;
                    const frames: StoredRgbaImage[] = [];
                    let highDepth = false;
                    for (let index = 0; index < stack.length; index++) {
                        const image = (await stack.get(index))!;
                        width = Math.max(width, image.width); height = Math.max(height, image.height);
                        frames.push({ ...image, hasAlpha: image.hasAlpha || settings.virtualPixel === "transparent" || (settings.virtualPixel === "background" || settings.virtualPixel?.endsWith("-tile") === true) && settings.background.a < 255 });
                        highDepth ||= !!image.storedData16;
                    }
                    for (let index = 0; index < stack.length; index++) {
                        const image = (await stack.get(index))!;
                        if (image.width !== width || image.height !== height) {
                            const virtualCanvas = magickResizeCanvas(image, width, height);
                            await stack.set(index, { ...await transformStoredMagickRaster(image, backend, extendEdgePixelSteps(image, width, height, !!image.storedData16, settings.virtualPixel, settings.background), signal, { ...image, width, height }), ...(virtualCanvas ? { virtualCanvas } : {}) });
                        }
                    }
                    const first = (await stack.get(0))!;
                    const base = frames.some(image => image.space !== "b-w" && image.space !== "grey16") ? { ...first, space: "srgb" as const, channels: 4 as const } : first;
                    const result = await transformStoredMagickRaster(base, backend, evaluateSequencePixelSteps(base.width * base.height * 4, frames, argument, settings.channelExplicit ? [settings.channels.r, settings.channels.g, settings.channels.b, settings.channels.a] : undefined, highDepth, settings.seed ?? 0, base.width), signal, { ...base, hasAlpha: frames.some(image => image.hasAlpha) }, async index => (await stack.get(index))!);
                    stack.length = 0; await stack.push(result);
                }
                return stack;
            });
            continue;
        }
        if (!operandsOnly && token === "+orient") {
            delete state.orientation;
            continue;
        }
        if (!operandsOnly && token === "-orient") {
            const orientation = state.orientation = parseMagickOrientation(tokens[++i] ?? "");
            steps.push(async image => image ? { ...image, orientation } : undefined);
            continue;
        }
        if (!operandsOnly && token === "-units") {
            const units = state.units = parseMagickUnits(tokens[++i] ?? "");
            steps.push(async image => image ? applyMagickUnits(image, units) : undefined);
            continue;
        }
        if (!operandsOnly && token === "-density") {
            const value = tokens[++i] ?? "72";
            state.density = Math.max(1, Math.round(parseMagickGeometry(value).width ?? 72));
            steps.push(async image => image ? applyMagickDensity(image, value) : undefined);
            continue;
        }
        if (!operandsOnly && token === "-set" && tokens[i + 1]?.toLowerCase() === "delay") {
            const delay = Number((tokens[i + 2] ?? "0").replaceAll("%", "")) * 10;
            steps.push(async image => image ? {
                ...image,
                storedDelay: { length: image.storedDelay?.length ?? image.delay?.length ?? 1, async at() { return delay; } },
            } : undefined);
            i += 2;
            continue;
        }
        if (!operandsOnly && token === "-set" && tokens[i + 1]?.toLowerCase() === "dispose") {
            const disposal = parseMagickDisposal(tokens[i + 2] ?? "");
            steps.push(async image => image ? { ...image, disposal } : undefined);
            i += 2;
            continue;
        }
        if (!operandsOnly && token === "-set" && !tokens[i + 1]?.toLowerCase().startsWith("option:") && !tokens[i + 1]?.toLowerCase().startsWith("connected-components:")) {
            const key = tokens[++i] ?? "", value = tokens[++i] ?? "";
            const optionProperties = state.optionProperties;
            steps.push(async (image, backend) => {
                if (!image) return;
                const expandedKey = await formatRetainedIdentify(key, image, { ...(image as StoredMagickImage)[magickInput], optionProperties }, async () => ({ image, storage: backend.storage }), signal);
                const expanded = await formatRetainedIdentify(value, image, { ...(image as StoredMagickImage)[magickInput], optionProperties }, async () => ({ image, storage: backend.storage }), signal);
                if (["width", "height", "size"].includes(expandedKey.toLowerCase())) {
                    analysis.warnings += `magick: attempt to set read-only property '${expandedKey}'\n`;
                    return image;
                }
                if (expandedKey.toLowerCase() === "units") return applyMagickUnits(image, parseMagickUnits(expanded));
                if (expandedKey.toLowerCase() === "depth") return { ...image, bitsPerSample: Number(expanded) };
                if (expandedKey.toLowerCase() === "gamma") return { ...image, gamma: parseFloat(expanded) };
                if (expandedKey.toLowerCase() === "page") return { ...image, virtualCanvas: magickRepageCanvas(image, { ...parseMagickGeometry(expanded), forceExact: false }) };
                return expandedKey.toLowerCase() === "density" ? applyMagickDensity(image, expanded) : { ...image, properties: updateMagickProperty(image.properties, expandedKey, expanded) };
            });
            continue;
        }
        if (!operandsOnly && token === "+set") {
            const key = tokens[++i] ?? "";
            steps.push(async image => {
                if (!image) return;
                const properties = updateMagickProperty(image.properties, key);
                return { ...image, properties };
            });
            continue;
        }
        if (!operandsOnly && (token === "-region" || token === "+region")) {
            const geometry = token === "-region" ? tokens[++i] : undefined, gravity = state.gravity;
            if (token === "-region" && !geometry) throw new Error("missing argument '-region'");
            steps.push(async image => image ? { ...image, region: geometry === undefined ? undefined : magickRegion(image, geometry, gravity) } : undefined);
            continue;
        }
        if (!operandsOnly && (token === "-write-mask" || token === "+write-mask" || token === "-clip-mask" || token === "+clip-mask")) {
            const path = token.startsWith("-") ? tokens[++i] : undefined, settings = { ...state };
            if (token.startsWith("-") && !path) throw new Error(`missing argument '${token}'`);
            stackStep(async (stack, backend) => {
                const mask = path ? await parseStoredCompareInput(path, settings, backend, signal) : undefined;
                if (path && !mask) throw new Error(`unable to open image '${path}'`);
                const storedWriteMask = mask ? { width: mask.width, height: mask.height, position: mask.position, hasAlpha: mask.hasAlpha } : undefined;
                for (let n = 0; n < stack.length; n++) await stack.set(n, { ...(await stack.get(n))!, storedWriteMask } as StoredRgbaImage);
                return stack;
            });
            continue;
        }
        const setting = operandsOnly ? undefined : applyMagickReadSetting(tokens, state, i);
        if (setting !== undefined) {
            i = setting;
            if (token === "-depth" && state.inputDepth! < 16) {
                const levels = 2 ** state.inputDepth!, channels = state.channelExplicit ? state.channels : { r: true, g: true, b: true, a: true };
                steps.push(async (image, backend) => image ? transformStoredMagickRaster(image, backend, posterizePixelSteps(image, levels, false, channels, signal), signal) : undefined);
            }
            if (token === "-page") {
                const page = state.page!;
                steps.push(async image => image ? { ...image, virtualCanvas: page } : undefined);
            }
            continue;
        }
        const warpOperation = operandsOnly || token === "-rotate" ? undefined : parseMagickWarpOperation(tokens, state, i, analysis);
        if (warpOperation) {
            i = warpOperation.end;
            const geometry = ["-shear", "-wave", "-swirl", "-implode"].includes(token) ? tokens[i] : undefined, optionProperties = state.optionProperties;
            steps.push(async (image, backend) => {
                if (!image) return;
                const expanded = geometry?.includes("%[") ? await formatRetainedIdentify(geometry, image, { ...(image as StoredMagickImage)[magickInput], optionProperties }, async () => ({ image, storage: backend.storage }), signal) : geometry;
                const plan = warpOperation.plan(image, expanded);
                if (!plan) return image;
                const output = await transformStoredMagickRaster(image, backend, plan.steps, signal, plan);
                return { ...output, ...("space" in plan && plan.space ? { space: plan.space, channels: plan.space === "srgb" ? 4 as const : output.channels } : {}), ...(plan.virtualCanvas ? { virtualCanvas: plan.virtualCanvas } : {}) };
            });
            continue;
        }
        if (!operandsOnly && token === "-cycle") {
            const amount = Number(tokens[++i]);
            steps.push(async (image, backend) => image ? transformStoredMagickRaster(image, backend, cyclePixelSteps(image, amount), signal) : undefined);
            continue;
        }
        if (!operandsOnly && token === "-unique-colors") {
            steps.push(async (image, backend) => image ? uniqueColorsStored(image, backend.storage, signal) : undefined);
            continue;
        }
        if (!operandsOnly && token === "-colors") {
            const colors = Number(tokens[++i]), grayscale = state.quantizeGray, treeDepth = state.treeDepth;
            steps.push(async (image, backend) => image ? transformStoredMagickRaster({ ...image, isPalette: true }, backend, quantizePixelSteps(image.width * image.height * 4, colors, grayscale, treeDepth), signal) : undefined);
            continue;
        }
        if (!operandsOnly && token === "-ordered-dither") {
            const options = parseOrderedDither(tokens[++i] ?? ""), channels = state.channelExplicit ? state.channels : { r: true, g: true, b: true, a: true };
            const mask = [channels.r, channels.g, channels.b, channels.a];
            steps.push(async (image, backend) => image ? transformStoredMagickRaster(image, backend, orderedDitherPixelSteps(image, options, mask), signal) : undefined);
            continue;
        }
        if (!operandsOnly && token === "-posterize") {
            const value = tokens[++i] ?? "", levels = Number(value);
            if (!value.trim() || !Number.isFinite(levels)) throw new Error(`invalid argument '-posterize' '${value}'`);
            const dither = state.dither !== false, channels = state.channelExplicit ? state.channels : { r: true, g: true, b: true, a: true };
            steps.push(async (image, backend) => image ? transformStoredMagickRaster(image, backend, posterizePixelSteps(image, levels, dither, channels, signal), signal) : undefined);
            continue;
        }
        if (!operandsOnly && (token === "-solarize" || token === "-color-matrix")) {
            const value = tokens[++i] ?? (token === "-solarize" ? "50%" : "1,0,0 0,1,0 0,0,1"), settings = { ...state };
            steps.push(async (image, backend) => {
                if (!image) return;
                const expanded = await formatRetainedIdentify(value, image, { ...(image as StoredMagickImage)[magickInput], optionProperties: settings.optionProperties }, async () => ({ image, storage: backend.storage }), signal);
                return transformStoredMagickPixels(image, backend, parseMagickPixelOperation([token, expanded], settings, 0, signal)!, signal);
            });
            continue;
        }
        if (!operandsOnly && token === "-alpha" && tokens[i + 1]?.toLowerCase() === "offifopaque") {
            i++;
            steps.push(async (image, backend) => {
                if (!image?.hasAlpha) return image;
                const position = image.storedData16?.position ?? image.position;
                const size = image.width * image.height * (image.storedData16 ? 8 : 4);
                for (let offset = 0; offset < size; offset += 16384) {
                    await yieldTurn(signal);
                    const bytes = await backend.storage.read(position + offset, Math.min(16384, size - offset));
                    const samples = image.storedData16 ? new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2) : bytes;
                    const maximum = image.storedData16 ? 65535 : 255;
                    for (let index = 3; index < samples.length; index += 4) {
                        if (samples[index] !== maximum) return image;
                    }
                }
                return { ...image, hasAlpha: false };
            });
            continue;
        }
        const pixelOperation = operandsOnly ? undefined : parseMagickPixelOperation(tokens, state, i, signal);
        if (pixelOperation) {
            if (pixelOperation.warning) stackStep(async stack => {
                analysis.warnings += pixelOperation.warning!;
                return stack;
            });
            if (token === "-contrast" || token === "+contrast") stackStep(async stack => {
                analysis.warnings += `magick: option has been replaced '${token}', use "${token[0]}level"\n`;
                return stack;
            });
            i = pixelOperation.end;
            steps.push(async (image, backend) => image ? transformStoredMagickPixels(image, backend, pixelOperation, signal) : undefined);
            continue;
        }
        if (!operandsOnly && token === "-hough-lines") {
            const spec = tokens[++i] ?? "", settings = { ...state };
            stackStep(async (stack, backend) => {
                const result = new StoredImageStack(backend.storage, signal, stack);
                for (let index = 0; index < stack.length; index++) {
                    const image = (await stack.get(index))!;
                    const transform = createHoughTransform(image, spec, settings.background, settings.stroke, settings.fill, settings.strokeWidth);
                    const source = { ...image, space: "srgb" as const, channels: 4 as const };
                    await result.push(await transformStoredMagickRaster(source, backend, transform.lines(), signal, { ...image, hasAlpha: settings.background.a < 255 }));
                    if (settings.houghAccumulator) await result.push(await transformStoredMagickRaster(source, backend, transform.accumulator(), signal, { width: 180, height: transform.height, hasAlpha: false }));
                }
                return result;
            });
            continue;
        }
        if (!operandsOnly && (token === "-connected-components" || token === "+connected-components")) {
            const connectivity = parseConnectedComponents(tokens, i++), fuzz = state.alphaFuzz, verbose = state.connectedVerbose ?? false, meanColor = state.connectedMeanColor ?? false, areaThreshold = state.connectedAreaThreshold ?? 0, keep = state.connectedKeep, remove = state.connectedRemove, removeColors = state.connectedRemoveColors, keepTop = state.connectedKeepTop, sort = state.connectedSort, sortOrder = state.connectedSortOrder, majorAxisThreshold = state.connectedMajorAxisThreshold, angleThreshold = state.connectedAngleThreshold, keepColors = state.connectedKeepColors, circularityThreshold = state.connectedCircularityThreshold, minorAxisThreshold = state.connectedMinorAxisThreshold, eccentricityThreshold = state.connectedEccentricityThreshold, diameterThreshold = state.connectedDiameterThreshold, perimeterThreshold = state.connectedPerimeterThreshold, excludeHeader = state.connectedExcludeHeader, backgroundId = state.connectedBackgroundId, excludeIds = state.connectedExcludeIds, precision = state.precision;
            steps.push(async (image, backend) => {
                if (!image) return;
                const result = await connectedComponentsStored(image, backend.storage, connectivity, fuzz, verbose, signal, meanColor, areaThreshold, keep, remove, removeColors, keepTop, sort, angleThreshold, perimeterThreshold, excludeHeader, excludeIds, backgroundId, sortOrder, majorAxisThreshold, minorAxisThreshold, eccentricityThreshold, diameterThreshold, circularityThreshold, keepColors, precision);
                if (input.stdout) await writeIdentifyText(input.stdout, result.text, signal);
                else analysis.text += result.text;
                return result.image;
            });
            continue;
        }
        const analysisOperation = operandsOnly ? undefined : parseMagickAnalysisOperation(tokens, state, i);
        if (analysisOperation) {
            i = analysisOperation.end;
            const intensity = state.intensity;
            steps.push(async (image, backend) => {
                if (!image) return;
                const histogram = Array.from({ length: analysisOperation.luminance ? 5 : 4 }, (_, channel) => new Float64Array(channel === 4 || analysisOperation.highDepth && image.storedData16 ? 65536 : 256)), size = image.width * image.height * 4;
                for (let offset = 0; offset < size; offset += 16384) {
                    if (offset % 1048576 === 0) await yieldTurn(signal);
                    const original = analysisOperation.highDepth ? image.storedData16 : undefined;
                    const bytes = await backend.storage.read((original?.position ?? image.position) + offset * (original ? 2 : 1), Math.min(16384, size - offset) * (original ? 2 : 1));
                    await drainSteps(accumulateMagickHistogram(original ? new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2) : bytes, histogram, intensity, image.magickColorspace === "RGB"), signal);
                }
                return transformStoredMagickPixels(image, backend, { end: analysisOperation.end, apply: analysisOperation.transform(histogram, image) }, signal, analysisOperation.highDepth);
            });
            continue;
        }
        if (!operandsOnly && (token === "-smush" || token === "+smush")) {
            const geometry = tokens[++i] ?? "", settings = { ...state };
            stackStep(async (stack, backend) => {
                const image = await stack.get(0);
                const gap = smushGap(image ? await formatRetainedIdentify(geometry, image, { ...(image as StoredMagickImage)[magickInput], optionProperties: settings.optionProperties }, async () => ({ image, storage: backend.storage }), signal) : geometry);
                if (!image) return stack;
                const images: StoredRgbaImage[] = [];
                for (let n = 0; n < stack.length; n++) images.push((await stack.get(n))!);
                const background = settings.backgroundExplicit ? settings.background : image.backgroundColor ?? settings.background;
                const layout = smushLayoutSteps(images, token === "-smush", gap, settings.gravity, settings.virtualPixel, background);
                let next = layout.next();
                while (!next.done) {
                    await yieldTurn(signal);
                    const request = next.value;
                    const image = images[request.index]!;
                    if (image.storedData16) {
                        const bytes = await backend.storage.read(image.storedData16.position + request.position * 2, request.length * 2);
                        next = layout.next(new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2));
                    } else next = layout.next(await backend.storage.read(image.position + request.position, request.length));
                }
                const { width, height, virtualCanvas, offsets } = next.value;
                let canvas = await createStoredCanvas(width, height, background, backend, signal);
                for (let n = 0; n < images.length; n++) canvas = await transformStoredMagickRaster(canvas, backend, smushCompositePixelSteps(canvas, images[n]!, offsets[n]!.left, offsets[n]!.top, !!(canvas.storedData16 || images[n]!.storedData16)), signal, canvas, [canvas, images[n]!]);
                stack.length = 0;
                await stack.push({ ...canvas, virtualCanvas });
                return stack;
            });
            continue;
        }
        if (!operandsOnly && token === "-layers" && tokens[i + 1]?.toLowerCase() === "optimizeframe") {
            stackStep(async stack => {
                const first = await stack.get(0);
                for (let n = 0; n < stack.length; n++) {
                    const frame = (await stack.get(n))!;
                    if (frame.width !== first!.width || frame.height !== first!.height ||
                        (frame.virtualCanvas?.width || frame.width) !== frame.width ||
                        (frame.virtualCanvas?.height || frame.height) !== frame.height ||
                        frame.virtualCanvas?.x || frame.virtualCanvas?.y) throw new Error("image pages are not coalesced");
                }
                return stack;
            });
            state.optimizeLayers = true; i++; continue;
        }
        if (!operandsOnly && token === "-layers" && tokens[i + 1]?.toLowerCase() === "composite") {
            i++;
            const settings = { ...state };
            stackStep(async (stack, backend) => {
                let separator = -1;
                for (let n = 0; n < stack.length; n++) {
                    if ((await stack.get(n))![magickInput]?.filePath === "null:") { separator = n; break; }
                }
                if (separator < 0) throw new Error("missing Null Image List Separator layers Composite");
                const sourceCount = stack.length - separator - 1;
                if (!separator || !sourceCount) throw new Error("image sequence is required '-layers Composite'");
                const count = separator === 1 ? sourceCount : sourceCount === 1 ? separator : Math.min(separator, sourceCount);
                const geometry = parseMagickGeometry(settings.geometry ?? "+0+0");
                const first = (await stack.get(0))!;
                for (let n = 0; n < count; n++) {
                    const base = separator === 1 ? first : (await stack.get(n))!;
                    const overlay = (await stack.get(separator + 1 + (sourceCount === 1 ? 0 : n)))!;
                    const offset = gravityAdjustBox(base.width, base.height, overlay.width, overlay.height, geometry.x, geometry.y, settings.gravity);
                    const result = await compositeStoredMagick(base, overlay, backend, signal, offset.x, offset.y, settings.composeRaw, settings.composeArgs, false, false, false, false, settings.alphaFuzz);
                    await stack.set(n, result);
                }
                stack.length = count;
                return stack;
            }); continue;
        }
        if (!operandsOnly && (["-append", "+append", "-flatten", "-mosaic", "-composite"].includes(token) || (token === "-layers" && ["flatten", "merge", "mosaic"].includes((tokens[i + 1] ?? "").toLowerCase())))) {
            const flatten = token === "-flatten" || (token === "-layers" && tokens[i + 1]?.toLowerCase() === "flatten");
            if (token === "-layers") i++;
            const settings = { ...state };
            stackStep(async (stack, backend) => {
                if (token === "-composite" && stack.length < 2) throw new Error("image sequence is required '-composite'");
                if (!stack.length) return stack;
                let result: StoredRgbaImage;
                if (token === "-composite") {
                    const base = (await stack.get(0))!; let overlay = (await stack.get(1))!, gx = 0, gy = 0;
                    const mask = await stack.get(2);
                    if (mask) overlay = await transformStoredMagickRaster(overlay, backend, compositeMaskPixelSteps(overlay, mask), signal, { ...overlay, hasAlpha: true }, [overlay, mask]);
                    if (settings.geometry && !settings.composeTile) { const geometry = parseMagickGeometry(settings.geometry); gx = geometry.x; gy = geometry.y; const resize = magickResizeOptions(overlay, settings.geometry, settings.kernel); if (resize) overlay = await resizeStoredMagickImage(overlay, backend, resize, signal, false, false, false, settings.resizeFilter); }
                    const offset = settings.composeTile ? { x: 0, y: 0 } : gravityAdjustBox(base.width, base.height, overlay.width, overlay.height, gx, gy, settings.gravity);
                    result = await compositeStoredMagick(base, overlay, backend, signal, offset.x, offset.y, settings.composeRaw, settings.composeArgs, false, false, false, settings.composeTile, settings.alphaFuzz);
                    await stack.remove(mask ? [1, 2] : [1]); await stack.set(0, result); return stack;
                }
                const append = token.endsWith("append"), vertical = token === "-append";
                if (append && stack.length === 1) return stack;
                let width = 0, height = 0, highDepth = false, cmyk = false, nonCmyk = false;
                for (let n = 0; n < (flatten ? 1 : stack.length); n++) { await yieldTurn(signal); const frame = (await stack.get(n))!; cmyk ||= frame.space === "cmyk"; nonCmyk ||= frame.space !== "cmyk"; highDepth ||= !!frame.storedData16; width = append && !vertical ? width + frame.width : Math.max(width, frame.width); height = append && vertical ? height + frame.height : Math.max(height, frame.height); }
                if (flatten) {
                    const first = (await stack.get(0))!;
                    width = first.virtualCanvas?.width || first.width;
                    height = first.virtualCanvas?.height || first.height;
                }
                const background = append && !settings.backgroundExplicit ? (await stack.get(0))!.backgroundColor ?? settings.background : settings.background;
                result = await createStoredCanvas(width, height, background, backend, signal, append && highDepth);
                if (append) {
                    const first = (await stack.get(0))!, scene = first[magickInput]?.sceneIdx ?? 0;
                    result = { ...result, delay: [await first.storedDelay?.at(scene, { signal }) ?? first.delay?.[scene] ?? 0], ...(first.disposal !== undefined ? { disposal: first.disposal } : {}), ...(first.icc ? { icc: first.icc } : {}), hasAlpha: background.a < 255, ...(first.properties ? { properties: first.properties } : {}), density: first.density, ...(first.resolution ? { resolution: first.resolution } : {}), virtualCanvas: first.virtualCanvas ?? { width: first.width, height: first.height, x: 0, y: 0 } };
                }
                let cursor = 0;
                for (let n = 0; n < stack.length; n++) {
                    let frame = (await stack.get(n))!;
                    if (append && cmyk && nonCmyk && frame.space === "cmyk") frame = await transformStoredMagickPixels(frame, backend, { end: 0, highDepth: true, apply: copyCmykChannelsToRgb }, signal);
                    const offset = resolveGravityOffset(vertical ? width - frame.width : 0, vertical ? 0 : height - frame.height, settings.gravity);
                    if (append) {
                        const left = vertical ? offset.left : cursor, top = vertical ? cursor : offset.top;
                        for (let y = 0; y < frame.height; y++) {
                            for (let x = 0; x < frame.width; x += 4096) {
                                await yieldTurn(signal);
                                const pixels = await backend.storage.read(frame.position + (y * frame.width + x) * 4, Math.min(4096, frame.width - x) * 4);
                                await backend.storage.write(result.position + ((top + y) * width + left + x) * 4, pixels);
                                if (result.storedData16) {
                                    const bytes = frame.storedData16
                                        ? await backend.storage.read(frame.storedData16.position + (y * frame.width + x) * 8, pixels.length * 2)
                                        : new Uint8Array(Uint16Array.from(pixels, value => value * 257).buffer);
                                    await backend.storage.write(result.storedData16.position + ((top + y) * width + left + x) * 8, bytes);
                                }
                            }
                        }
                        result = { ...result, hasAlpha: result.hasAlpha || frame.hasAlpha };
                    }
                    else result = await compositeStoredMagick(result, frame, backend, signal, flatten ? frame.virtualCanvas?.x ?? 0 : 0, flatten ? frame.virtualCanvas?.y ?? 0 : 0, settings.compose, undefined, true, true);
                    cursor += vertical ? frame.height : frame.width;
                }
                if (append) result = { ...result, channels: result.hasAlpha ? 4 : 3 };
                if (!append) {
                    const first = (await stack.get(0))!, scene = first[magickInput]?.sceneIdx ?? 0;
                    result = { ...result, delay: [await first.storedDelay?.at(scene, { signal }) ?? first.delay?.[scene] ?? 0] };
                    if (flatten && first.orientation !== undefined) result = { ...result, orientation: first.orientation };
                }
                stack.length = 0; await stack.push(result); return stack;
            }); continue;
        }
        if (!operandsOnly && token === "-format") { state.formatStr = tokens[++i] ?? ""; continue; }
        if (!operandsOnly && token === "-delay") { state.delay = tokens[++i] ?? "0"; continue; }
        if (!operandsOnly && token === "-transparent-color") { state.transparentColor = parseColor(tokens[++i] ?? ""); continue; }
        if (!operandsOnly && token === "-loop") { state.loop = Number(tokens[++i] ?? 0); continue; }
        if (!operandsOnly && token === "-dispose") { state.disposal = parseMagickDisposal(tokens[++i] ?? ""); continue; }
        if (!operandsOnly && token === "-tile") { state.tile = tokens[++i]; continue; }
        if (!operandsOnly && token === "-layers" && tokens[i + 1]?.toLowerCase() === "trimbounds") {
            i++;
            stackStep(async stack => {
                let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
                for (let n = 0; n < stack.length; n++) {
                    const frame = (await stack.get(n))!;
                    const x = frame.virtualCanvas?.x ?? 0, y = frame.virtualCanvas?.y ?? 0;
                    left = Math.min(left, x); top = Math.min(top, y);
                    right = Math.max(right, x + frame.width); bottom = Math.max(bottom, y + frame.height);
                }
                for (let n = 0; n < stack.length; n++) {
                    const frame = (await stack.get(n))!;
                    await stack.set(n, { ...frame, virtualCanvas: { width: right - left, height: bottom - top, x: (frame.virtualCanvas?.x ?? 0) - left, y: (frame.virtualCanvas?.y ?? 0) - top } });
                }
                return stack;
            });
            continue;
        }
        if (!operandsOnly && token === "-layers" && tokens[i + 1]?.toLowerCase() === "removezero") {
            i++;
            stackStep(async (stack, backend) => {
                const frames = new StoredImageStack(backend.storage, signal);
                for (let n = 0; n < stack.length; n++) {
                    const frame = (await stack.get(n))!, scene = frame[magickInput]?.sceneIdx ?? 0;
                    const delay = await frame.storedDelay?.at(scene, { signal }) ?? frame.delay?.[scene] ?? 0;
                    if (delay !== 0) await frames.push(frame);
                }
                if (frames.length) return frames;
                if (stack.length) analysis.warnings += "magick: animation only contains zero time delays\n";
                return stack;
            });
            continue;
        }
        if (!operandsOnly && (token === "-deconstruct" || (token === "-layers" && ["compareany", "compareoverlay", "compareclear", "removedups", "optimizeplus"].includes((tokens[i + 1] ?? "").toLowerCase())))) {
            const method = token === "-layers" ? tokens[i + 1]!.toLowerCase() : "compareany";
            const optimizePlus = token === "-layers" && tokens[i + 1]?.toLowerCase() === "optimizeplus";
            const removeDups = optimizePlus || (token === "-layers" && tokens[i + 1]?.toLowerCase() === "removedups");
            if (optimizePlus) state.optimizeLayers = true;
            if (token === "-layers") i++;
            const fuzz = state.alphaFuzz;
            stackStep(async (stack, backend) => {
                if (optimizePlus) {
                    const first = await stack.get(0);
                    for (let n = 0; n < stack.length; n++) {
                        const frame = (await stack.get(n))!;
                        if (frame.width !== first!.width || frame.height !== first!.height)
                            throw new Error("images are not the same size");
                        if ((frame.virtualCanvas?.width || frame.width) !== frame.width ||
                            (frame.virtualCanvas?.height || frame.height) !== frame.height ||
                            frame.virtualCanvas?.x || frame.virtualCanvas?.y) throw new Error("image pages are not coalesced");
                        // OptimizePlus chooses new disposal from the displayed pixels.
                        await stack.set(n, { ...frame, disposal: 1 });
                    }
                }
                const frames = new StoredImageStack(backend.storage, signal);
                let previous = await stack.get(0);
                if (previous) await frames.push(previous);
                for (let n = 1; n < stack.length; n++) {
                    let current = (await stack.get(n))!;
                    if (removeDups && (previous!.width !== current.width || previous!.height !== current.height ||
                        (previous!.virtualCanvas?.x ?? 0) !== (current.virtualCanvas?.x ?? 0) ||
                        (previous!.virtualCanvas?.y ?? 0) !== (current.virtualCanvas?.y ?? 0))) {
                        await frames.push(current);
                        previous = current;
                        continue;
                    }
                    if (optimizePlus) {
                        if (fuzz > 0) current = await transformStoredMagickRaster(current, backend, optimizePlusPixels(current, fuzz), signal, current, [current, previous!]);
                        const clearing = compareLayerBounds(previous!, current, 0, "compareclear");
                        let clear = clearing.next();
                        while (!clear.done) {
                            if (!clear.value) { await yieldTurn(signal); clear = clearing.next(); }
                            else {
                                const { image, position, length } = clear.value;
                                clear = clearing.next(await backend.storage.read((image ? current : previous!).position + position, length));
                            }
                        }
                        if (clear.value) {
                            const prior = (await frames.get(frames.length - 1))!;
                            await frames.set(frames.length - 1, { ...prior, disposal: 1,
                                storedDelay: { length: prior.storedDelay?.length ?? prior.delay?.length ?? 1, async at() { return 0; } } });
                            await frames.push({ ...await transformStoredImage(previous!, backend.storage, { kind: "extract", ...clear.value }, signal),
                                virtualCanvas: magickCropCanvas(previous!, clear.value.left, clear.value.top),
                                disposal: 2, storedDelay: {
                                    length: previous!.storedDelay?.length ?? previous!.delay?.length ?? 1,
                                    async at() {
                                        const scene = prior[magickInput]?.sceneIdx ?? 0;
                                        return await prior.storedDelay?.at(scene, { signal }) ?? prior.delay?.[scene] ?? 0;
                                    },
                                } });
                            await frames.push(current);
                            previous = current;
                            continue;
                        }
                    }
                    const bounds = compareLayerBounds(previous!, current, fuzz, method);
                    let next = bounds.next();
                    while (!next.done) {
                        if (!next.value) { await yieldTurn(signal); next = bounds.next(); }
                        else {
                            const { image, position, length } = next.value;
                            next = bounds.next(await backend.storage.read((image ? current : previous!).position + position, length));
                        }
                    }
                    if (removeDups) {
                        // OptimizePlus preserves the first transition, including an empty one.
                        if (next.value || (optimizePlus && n === 1)) await frames.push(current);
                        else {
                            const prior = (await frames.get(frames.length - 1))!;
                            const priorScene = prior[magickInput]?.sceneIdx ?? 0, scene = current[magickInput]?.sceneIdx ?? 0;
                            const delay = (await prior.storedDelay?.at(priorScene, { signal }) ?? prior.delay?.[priorScene] ?? 0) +
                                (await current.storedDelay?.at(scene, { signal }) ?? current.delay?.[scene] ?? 0);
                            const survivor = optimizePlus ? prior : current;
                            await frames.set(frames.length - 1, { ...survivor, storedDelay: {
                                length: survivor.storedDelay?.length ?? survivor.delay?.length ?? 1,
                                async at() { return delay; },
                            } });
                        }
                    } else if (next.value) await frames.push({ ...await transformStoredImage(current, backend.storage, { kind: "extract", ...next.value }, signal), virtualCanvas: magickCropCanvas(current, next.value.left, next.value.top) });
                    previous = current;
                }
                return frames;
            });
            continue;
        }
        if (!operandsOnly && token === "-layers" && tokens[i + 1]?.toLowerCase() === "optimizetransparency") {
            i++;
            const fuzz = state.fuzz;
            stackStep(async (stack, backend) => {
                if (stack.length < 2) return stack;
                const first = (await stack.get(0))!, width = first.virtualCanvas?.width || first.width, height = first.virtualCanvas?.height || first.height;
                let canvas = await createStoredCanvas(width, height, { r: 0, g: 0, b: 0, a: 0 }, backend, signal);
                for (let n = 0; n < stack.length; n++) {
                    const current = (await stack.get(n))!, previous = canvas;
                    const x = current.virtualCanvas?.x ?? 0, y = current.virtualCanvas?.y ?? 0;
                    if (n > 0) await stack.set(n, await transformStoredMagickRaster(current, backend, optimizeTransparencyPixels(canvas, current, fuzz), signal, { ...current, hasAlpha: true }, [current, canvas]));
                    canvas = await compositeStoredMagick(canvas, current, backend, signal, x, y, "over", undefined, true);
                    if (current.disposal === 3) canvas = previous;
                    else if (current.disposal === 2) {
                        const clear = await createStoredCanvas(current.width, current.height, { r: 0, g: 0, b: 0, a: 0 }, backend, signal);
                        canvas = await compositeStoredMagick(canvas, clear, backend, signal, x, y, "source", undefined, true);
                    }
                }
                return stack;
            });
            continue;
        }
        if (!operandsOnly && (token === "-coalesce" || (token === "-layers" && ["coalesce", "dispose", "optimize"].includes((tokens[i + 1] ?? "").toLowerCase())))) {
            const dispose = token === "-layers" && tokens[i + 1]?.toLowerCase() === "dispose";
            const optimize = token === "-layers" && tokens[i + 1]?.toLowerCase() === "optimize";
            if (optimize) state.optimizeLayers = true;
            if (token === "-layers") i++;
            stackStep(async (stack, backend) => {
                if (!stack.length) return stack;
                const first = (await stack.get(0))!, width = first.virtualCanvas?.width || first.width, height = first.virtualCanvas?.height || first.height;
                if (optimize) {
                    let coalesced = true;
                    for (let n = 0; n < stack.length; n++) {
                        const frame = (await stack.get(n))!;
                        if (frame.width !== width || frame.height !== height || frame.virtualCanvas?.x || frame.virtualCanvas?.y) { coalesced = false; break; }
                    }
                    if (coalesced) return stack;
                }
                const background = { ...(first.backgroundColor ?? { r: 255, g: 255, b: 255 }), a: dispose || first.hasAlpha ? 0 : 255 };
                let canvas = await createStoredCanvas(width, height, background, backend, signal);
                const frames = new StoredImageStack(backend.storage, signal);
                for (let index = 0; index < stack.length; index++) {
                    const frame = dispose ? first : (await stack.get(index))!, previous = canvas, x = frame.virtualCanvas?.x ?? 0, y = frame.virtualCanvas?.y ?? 0;
                    canvas = await compositeStoredMagick(canvas, frame, backend, signal, x, y, "over", undefined, true);
                    let disposal = 1;
                    if (!dispose && index > 0) {
                        const prior = (await frames.get(index - 1))!, priorInput = (await stack.get(index - 1))!;
                        const left = Math.max(0, priorInput.virtualCanvas?.x ?? 0), top = Math.max(0, priorInput.virtualCanvas?.y ?? 0);
                        const right = Math.min(width, (priorInput.virtualCanvas?.x ?? 0) + priorInput.width), bottom = Math.min(height, (priorInput.virtualCanvas?.y ?? 0) + priorInput.height);
                        for (let row = top; row < bottom && disposal === 1; row++) {
                            for (let column = left; column < right && disposal === 1; column += 4096) {
                                await yieldTurn(signal);
                                const offset = (row * width + column) * 4, length = Math.min(4096, right - column) * 4;
                                const before = await backend.storage.read(prior.position + offset, length), after = await backend.storage.read(canvas.position + offset, length);
                                for (let alpha = 3; alpha < length; alpha += 4) {
                                    if (before[alpha]! >= 128 && after[alpha]! < 128) { disposal = 2; break; }
                                }
                            }
                        }
                        await frames.set(index - 1, { ...prior, disposal });
                    }
                    if (!dispose) await frames.push({ ...frame, width, height, position: canvas.position, hasAlpha: canvas.hasAlpha, virtualCanvas: { width, height, x: 0, y: 0 }, disposal });
                    if (frame.disposal === 3) canvas = previous;
                    else if (frame.disposal === 2) {
                        const clear = await createStoredCanvas(frame.width, frame.height, { r: 0, g: 0, b: 0, a: 0 }, backend, signal);
                        canvas = await compositeStoredMagick(canvas, clear, backend, signal, x, y, "source", undefined, true);
                    }
                    if (dispose) await frames.push({ ...first, width, height, position: canvas.position, hasAlpha: canvas.hasAlpha, virtualCanvas: { width, height, x: 0, y: 0 } });
                }
                return frames;
            });
            continue;
        }
        if (!operandsOnly && token === "-scene") {
            state.scene = Number(tokens[++i]);
            if (!Number.isSafeInteger(state.scene) || state.scene < 0) throw new Error("invalid scene number");
            continue;
        }
        if (!operandsOnly && (token === "+adjoin" || token === "-adjoin")) { state.adjoin = token === "-adjoin"; continue; }
        if (!operandsOnly && token === "-geometry") { state.geometry = tokens[++i] ?? "+0+0"; continue; }
        if (!operandsOnly && token === "+gravity") { state.gravity = "northwest"; continue; }
        if (!operandsOnly && (token === "-encipher" || token === "-decipher")) {
            const name = tokens[++i];
            if (!name) throw new Error(`missing argument '${token}'`);
            stackStep(async (stack, backend) => {
                const key = await backend.read(name, async source => {
                    const bytes = new Uint8Array(source.size);
                    for (let offset = 0; offset < source.size; offset += 16384) {
                        await yieldTurn(signal);
                        bytes.set(await source.read(offset, Math.min(16384, source.size - offset), { signal }), offset);
                    }
                    return bytes;
                });
                if (!key) throw new Error(`unable to open key '${name}'`);
                try {
                    for (let index = 0; index < stack.length; index++) {
                        const image = (await stack.get(index))!;
                        await stack.set(index, await transformStoredMagickRaster(image, backend, encipherPixelSteps(image, key), signal));
                    }
                } finally { key.fill(0); }
                return stack;
            });
            continue;
        }
        if (!operandsOnly && (token === "-profile" || token === "+profile")) {
            const name = tokens[++i];
            if (!name) throw new Error(`missing argument '${token}'`);
            stackStep(async (stack, backend) => {
                const profile = token === "-profile" ? await backend.read(name, async source => {
                    const bytes = new Uint8Array(source.size);
                    for (let offset = 0; offset < source.size; offset += 16384) {
                        await yieldTurn(signal);
                        bytes.set(await source.read(offset, Math.min(16384, source.size - offset), { signal }), offset);
                    }
                    return bytes;
                }) : undefined;
                if (token === "-profile" && !profile) throw new Error(`unable to open profile '${name}'`);
                for (let index = 0; index < stack.length; index++) await stack.set(index, applyMagickProfile((await stack.get(index))!, name, profile));
                return stack;
            });
            continue;
        }
        if (!operandsOnly && token === "-strip") {
            state.strip = true;
            steps.push(async image => { if (!image) return image; const {gifApplications: ignoredGifApplications, icc: ignored, exif: ignoredExif, orientation: ignoredOrientation, properties: ignoredProperties, ...rest} = image; return rest; });
            continue;
        }
        if (!operandsOnly && token === "+repage") {
            steps.push(async image => {
                if (!image) return;
                const { virtualCanvas: ignoredCanvas, ...reset } = image;
                return reset;
            });
            continue;
        }
        if (!operandsOnly && token === "-repage") {
            const geometry = parseMagickGeometry(tokens[++i] ?? "0x0");
            steps.push(async image => image ? { ...image, virtualCanvas: magickRepageCanvas(image, geometry) } : undefined);
            continue;
        }
        if (!operandsOnly && (token === "-write" || token === "+write")) {
            if (i + 1 >= tokens.length) {
                stackStep(async () => { throw new Error(`missing argument '${token}'`); });
                break;
            }
            const background = state.backgroundExplicit ? state.background : undefined;
            const dither = state.dither, diffusionAmount = state.diffusionAmount;
            const writeTemplate = tokens[++i] ?? "", iconAutoResize = state.iconAutoResize, iconKernel = state.kernel, iconFilter = state.resizeFilter, endian = state.inputEndian, quality = state.quality, effort = state.webpMethod ?? 4, lossless = state.webpLossless ?? state.quality >= 100, webpExact = state.webpExact ?? false, smartSubsample = state.webpSmartSubsample ?? false, alphaCompression = state.webpAlphaCompression ?? 1, alphaQuality = state.webpAlphaQuality ?? 100, webpTargetSize = state.webpTargetSize, webpPass = state.webpPass, jpegExtent = state.jpegExtent, pngPreserveColormap = state.pngPreserveColormap, pngBitDepth = state.pngBitDepth, jpegRestartInterval = state.jpegRestartInterval, jpegArithmeticCoding = state.jpegArithmeticCoding, jpegProgressive = state.jpegProgressive, jpegOptimizeCoding = state.jpegOptimizeCoding, jpegDctMethod = state.jpegDctMethod, pngInterlace = state.pngInterlace, gifInterlace = state.gifInterlace, transparentColor = state.transparentColor, pngColorType = state.pngColorType, omitPngResolution = state.strip || state.omitPngResolution === true, samplingFactor = state.samplingFactor, bmpFormat = state.bmpFormat, bmp3Alpha = state.bmp3Alpha, bmpSubtype = state.bmpSubtype, miffCompression = state.miffCompression, tgaCompression = state.tgaCompression, bmpCompression = state.bmpCompression, tiffIntegerDepth = state.inputDepth === undefined ? undefined : state.inputDepth <= 8 ? 8 : state.inputDepth <= 16 ? 16 : 32, tiffSigned = state.tiffSigned, tiffFloatDepth = state.tiffFloatingPoint ? (state.inputDepth ?? 32) <= 16 ? 16 : (state.inputDepth ?? 32) <= 32 ? 32 : 64 : undefined, tiffPlanar = state.tiffPlanar, tiffAlpha = state.tiffAlpha, tiffEndian = state.tiffEndian, tiffRowsPerStrip = state.tiffRowsPerStrip, tiffTile = state.tiffTile, tiffCompression = state.tiffCompression, netpbmAscii = state.netpbmAscii ?? false, netpbmDepth = state.inputDepth === undefined ? undefined : Math.min(16, state.inputDepth), adjoin = state.adjoin, filenameLiteral = state.filenameLiteral, scene = state.scene, loop = state.loop, optimizeLayers = state.optimizeLayers;
            stackStep(async (stack, backend) => {
                if (stack.length === 0) throw new Error(`no images for write '${token}'`);
                const image = await stack.get(stack.length - 1);
                const path = expandFilenameProperties(writeTemplate, (await stack.get(0))!.properties);
                if (path.slice(0, 4).toLowerCase() === "mpr:") {
                    const saved = new StoredImageStack(backend.storage, signal, stack);
                    for (let index = 0; index < stack.length; index++) {
                        await yieldTurn(signal);
                        await saved.push((await stack.get(index))!);
                    }
                    registers.set(path.slice(4), saved);
                }
                else if (image && path && path.toLowerCase() !== "null:") {
                    const output = inferOutputFormat(path, image.format);
                    if ((!filenameLiteral && path !== writeTemplate) || hasSceneOutputPattern(output.path, filenameLiteral) || (stack.length > 1 && (!adjoin || (output.path !== "-" && ["png", "jpeg", "bmp"].includes(output.format))))) {
                        const firstScene = scene ?? (await stack.get(0))![magickInput]?.sceneIdx ?? 0;
                        for (let index = 0; index < stack.length; index++) { await yieldTurn(signal); await backend.stage({ ...(await prepareStoredMagickOutput((await stack.get(index))!, output.format, backend, signal, dither, diffusionAmount, output.pngCoder)), ...(output.format === "gif" && background ? { backgroundColor: background } : {}) }, formatSceneOutputPath(inferOutputFormat(writeTemplate, image.format).path, firstScene + index, filenameLiteral, (await stack.get(index))!.properties), { format: output.format, tiffBig: output.tiffBig, pngCoder: output.pngCoder, gifVersion: output.gifVersion, bmpFormat: output.bmpFormat ?? bmpFormat ?? "bmp4", palette: true, pngColorType: pngOutputColorType(pngColorType, output.format, analysis), endian, pngPreserveColormap, pngBitDepth, ...(jpegRestartInterval === undefined ? {} : { jpegRestartInterval }), ...(jpegDctMethod === undefined ? {} : { jpegDctMethod }), ...(jpegOptimizeCoding === undefined ? {} : { jpegOptimizeCoding }), ...(jpegArithmeticCoding === undefined ? {} : { jpegArithmeticCoding }), ...(jpegProgressive === undefined ? {} : { jpegProgressive }), pngInterlace, gifInterlace, transparentColor, omitPngResolution, ...(miffCompression === undefined ? {} : { miffCompression }), ...(tgaCompression === undefined ? {} : { tgaCompression }), ...(bmpCompression === undefined ? {} : { bmpCompression }), ...(bmpSubtype === undefined ? {} : { bmpSubtype }), ...(bmp3Alpha === undefined ? {} : { bmp3Alpha }), ...(tiffIntegerDepth === undefined ? {} : { tiffIntegerDepth }), ...(tiffSigned === undefined ? {} : { tiffSigned }), ...(tiffFloatDepth === undefined ? {} : { tiffFloatDepth }), ...(tiffPlanar === undefined ? {} : { tiffPlanar }), ...(tiffAlpha === undefined ? {} : { tiffAlpha }), ...(tiffEndian === undefined ? {} : { tiffEndian }), ...(tiffRowsPerStrip === undefined ? {} : { tiffRowsPerStrip }), ...(tiffTile === undefined ? {} : { tiffTile }), ...(tiffCompression === undefined ? {} : { tiffCompression }), netpbmAscii, ...(netpbmDepth === undefined ? {} : { netpbmDepth, miffDepth: netpbmDepth <= 8 ? 8 : 16 }), ...(samplingFactor === undefined ? {} : { samplingFactor }), chromaSubsampling: quality < 90 ? "4:2:0" : "4:4:4", webpTargetSize, webpPass, jpegExtent, webpExact, smartSubsample, alphaCompression, alphaQuality, quality, ...(output.format === "webp" ? { effort, lossless } : {}) }); }
                    } else {
                        const frames = stack.length > 1 && output.format === "miff" ? prepareStoredMiffPages(stack, image, backend, signal) : output.format === "ico" ? await prepareStoredIcoPages(stack, image, backend, signal, iconAutoResize, iconKernel, iconFilter) : stack.length > 1 && output.format === "tiff" ? prepareStoredTiffPages(stack, image, backend, signal) : stack.length > 1 && (output.format === "gif" || output.format === "apng" || output.format === "mng" || output.format === "webp") ? await prepareStoredGifFrames(stack, backend, signal, output.format === "gif" ? dither : false, diffusionAmount) : await prepareStoredMagickOutput(image, output.format, backend, signal, dither, diffusionAmount, output.pngCoder);
                        const bytes = await backend.stage({ ...(frames), ...(output.format === "gif" && background ? { backgroundColor: background } : {}) }, formatAdjoinedOutputPath(output.path, stack.length, scene ?? 0, filenameLiteral), { format: output.format, tiffBig: output.tiffBig, pngCoder: output.pngCoder, gifVersion: output.gifVersion, bmpFormat: output.bmpFormat ?? bmpFormat ?? "bmp4", palette: true, pngColorType: pngOutputColorType(pngColorType, output.format, analysis), ...(stack.length > 1 && (output.format === "gif" || output.format === "apng" || output.format === "mng" || output.format === "webp") ? { pageHeight: frames.pageHeight } : {}), endian, pngPreserveColormap, pngBitDepth, ...(jpegRestartInterval === undefined ? {} : { jpegRestartInterval }), ...(jpegDctMethod === undefined ? {} : { jpegDctMethod }), ...(jpegOptimizeCoding === undefined ? {} : { jpegOptimizeCoding }), ...(jpegArithmeticCoding === undefined ? {} : { jpegArithmeticCoding }), ...(jpegProgressive === undefined ? {} : { jpegProgressive }), pngInterlace, gifInterlace, transparentColor, omitPngResolution, ...(miffCompression === undefined ? {} : { miffCompression }), ...(tgaCompression === undefined ? {} : { tgaCompression }), ...(bmpCompression === undefined ? {} : { bmpCompression }), ...(bmpSubtype === undefined ? {} : { bmpSubtype }), ...(bmp3Alpha === undefined ? {} : { bmp3Alpha }), ...(tiffIntegerDepth === undefined ? {} : { tiffIntegerDepth }), ...(tiffSigned === undefined ? {} : { tiffSigned }), ...(tiffFloatDepth === undefined ? {} : { tiffFloatDepth }), ...(tiffPlanar === undefined ? {} : { tiffPlanar }), ...(tiffAlpha === undefined ? {} : { tiffAlpha }), ...(tiffEndian === undefined ? {} : { tiffEndian }), ...(tiffRowsPerStrip === undefined ? {} : { tiffRowsPerStrip }), ...(tiffTile === undefined ? {} : { tiffTile }), ...(tiffCompression === undefined ? {} : { tiffCompression }), netpbmAscii, ...(netpbmDepth === undefined ? {} : { netpbmDepth, miffDepth: netpbmDepth <= 8 ? 8 : 16 }), ...(samplingFactor === undefined ? {} : { samplingFactor }), chromaSubsampling: quality < 90 ? "4:2:0" : "4:4:4", webpTargetSize, webpPass, jpegExtent, webpExact, smartSubsample, alphaCompression, alphaQuality, quality, ...(output.format === "webp" ? { effort, lossless } : {}), ...(output.format === "gif" && stack.length === 1 ? { loop: 1, delay: await image.storedDelay?.at(image[magickInput]?.sceneIdx ?? 0, { signal }) ?? image.delay?.[image[magickInput]?.sceneIdx ?? 0] ?? 0 } : loop === undefined ? {} : { loop }), ...(optimizeLayers ? { optimizeFrames: true, gifTransdiff: true } : {}) });
                        if (bytes) analysis.bytes.push(bytes);
                    }
                }
                return stack;
            });
        } else if (!operandsOnly && (token === "-dither" || token === "+dither")) {
            const dMode = token === "-dither" ? (tokens[++i] ?? "riemersma").toLowerCase() : "none";
            state.dither = dMode === "none" ? false : dMode === "floydsteinberg" ? "floydsteinberg" : "riemersma";
        } else if (!operandsOnly && (token === "-read-mask" || token === "+read-mask")) {
            const spec = token === "-read-mask" ? tokens[++i] : undefined, settings = { ...state };
            if (token === "-read-mask" && !spec) throw new Error(`missing argument '${token}'`);
            stackStep(async (stack, backend) => {
                if (!stack.length) throw new Error(`no images found for operation '${token}'`);
                const mask = spec ? await parseStoredCompareInput(spec, settings, backend, signal) : undefined;
                if (spec && !mask) throw new Error(`unable to read mask '${spec}'`);
                const readMask = mask ? { width: mask.width, height: mask.height, position: mask.position } : undefined;
                for (let n = 0; n < stack.length; n++) await stack.set(n, { ...(await stack.get(n))!, readMask } as StoredRgbaImage);
                return stack;
            });
        } else if (!operandsOnly && token === "-remap") {
            const palette = tokens[++i] ?? "", settings = { ...state };
            stackStep(async stack => {
                if (!stack.length) throw new Error(`no images found for operation '${token}'`);
                return stack;
            });
            steps.push(async (image, backend) => {
                if (!image) return;
                const colors = palette.slice(0, 4).toLowerCase() === "mpr:"
                    ? await registers.get(palette.slice(4))?.get(0)
                    : await parseStoredCompareInput(palette, settings, backend, signal);
                if (!colors) throw new Error(`unable to open image '${palette}'`);
                return settings.dither === "riemersma"
                    ? transformStoredMagickRaster(image, backend, riemersmaRemapSteps(image, colors, !!image.storedData16, settings.diffusionAmount ?? 1), signal, image, [image, colors])
                    : remapStoredImage(image, colors, backend.storage, settings.dither !== false, settings.diffusionAmount ?? 1, signal);
            });
        } else if (!operandsOnly && (token === "-floodfill" || token === "+floodfill")) {
            const geometry = parseMagickGeometry(tokens[++i] ?? "+0+0"), candidate = tokens[i + 1], replacement = state.fill, fuzz = state.alphaFuzz;
            const channels = state.channelExplicit ? [state.channels.r, state.channels.g, state.channels.b, state.channels.a] : undefined;
            let target: RgbaColor | undefined;
            if (candidate && !candidate.startsWith("-") && !candidate.startsWith("+")) {
                let file = false;
                try { file = (await input.filesystem.stat(resolvePath(input.cwd, candidate), { signal })).type === "file"; }
                catch (error) { if (!(error instanceof FsError) || !["ENOENT", "ENOTDIR", "EISDIR", "EACCES", "EPERM"].includes(error.code)) throw error; }
                if (!file) { try { target = parseColor(candidate); i++; } catch { /* Optional color omitted. */ } }
            }
            steps.push(async (image, backend) => {
                if (!image) return;
                const x = Math.round(geometry.x);
                const y = Math.round(geometry.y);
                if (x < 0 || y < 0 || x >= image.width || y >= image.height) return image;
                return floodfillStoredImage(image, backend.storage, x, y, target, replacement, fuzz, signal, false, channels, token === "+floodfill");
            });
        } else if (!operandsOnly && token === "-draw") {
            const drawing = tokens[++i] ?? "", settings = { ...state };
            steps.push(async (image, backend) => {
                if (!image) return;
                const tile = settings.tile === undefined ? undefined : await parseStoredCompareInput(settings.tile, settings, backend, signal);
                for (const step of magickDrawSteps(image, drawing, settings)) {
                    if (!step) { await yieldTurn(signal); continue; }
                    if ((image.space === "b-w" || image.space === "grey16") && !((step.kind === "floodfill" || step.kind === "paint-point" || step.kind === "reset" || step.kind === "replace") && step.alphaOnly))
                        image = { ...image, space: "srgb", channels: image.hasAlpha ? 4 : 3 };
                    if (step.kind === "shape") image = await transformStoredMagickRaster(image, backend, drawShapePixelSteps(image, step, !!image.storedData16, tile), signal, image, tile ? [image, tile] : [image]);
                    else if (step.kind === "paint-point" || step.kind === "reset") image = await transformStoredMagickRaster(image, backend, drawPointPixelSteps(image, step, !!image.storedData16), signal, { ...image, hasAlpha: image.hasAlpha || step.color.a < 255 });
                    else if (step.kind === "replace") image = await transformStoredMagickRaster(image, backend, drawReplacePixelSteps(image, step.x, step.y, step.color, step.alphaOnly, settings.alphaFuzz, !!image.storedData16), signal, { ...image, hasAlpha: true });
                    else if (step.kind === "floodfill") image = await floodfillStoredImage(image, backend.storage, step.x, step.y, step.fillToBorder ? settings.borderColor : undefined, step.color, settings.alphaFuzz, signal, step.alphaOnly, undefined, step.fillToBorder);
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
            const expression = tokens[++i] ?? "u", channels = state.channelExplicit ? state.channels : { r: true, g: true, b: true, a: true }, virtualPixel = state.virtualPixel, background = state.background, interpolation = state.interpolation;
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
                const result = await transformStoredMagickRaster(base, backend, magickFxPixelSteps(source, expression, channels, virtualPixel, background, interpolation), signal, { ...base, hasAlpha: base.hasAlpha || channels.a && (virtualPixel === "transparent" || (virtualPixel === "background" || virtualPixel?.endsWith("-tile") === true) && background.a < 255) }, async index => index === stack.length ? { ...base, ...((base as StoredRgbaImage).readMask!) } : (await stack.get(index))!, async () => {
                    if (demanded === undefined) return; const index = demanded; demanded = undefined; const frame = (await stack.get(index))!; frames.set(index, frame); indices.set(frame, index);
                });
                stack.length = 0; await stack.push(result); return stack;
            });
        } else if (!operandsOnly && (token === "-raise" || token === "+raise")) {
            const g = parseMagickRaiseGeometry(tokens[++i] ?? "", token), raised = token === "-raise", channels = { ...state.channels, a: state.channels.a || !state.channelExplicit };
            steps.push(async (image, backend) => {
                if (!image) return;
                const bw = Math.max(0, Math.round(g.isPercent ? image.width * (g.percentX ?? 100) / 100 : g.width ?? 4));
                const bh = Math.max(0, Math.round(g.isPercent ? image.height * (g.percentY ?? 100) / 100 : g.height ?? bw));
                return transformStoredMagickRaster(image, backend, raisePixelSteps(image, bw, bh, raised, [channels.r, channels.g, channels.b, image.hasAlpha && channels.a]), signal);
            });
        } else if (!operandsOnly && (token === "-transpose" || token === "-transverse")) {
            const background = state.background, kind = token === "-transpose" ? "flip" : "flop";
            steps.push(async (image, backend) => image ? { ...await transformStoredImage(await transformStoredImage(image, backend.storage, { kind }, signal), backend.storage, { kind: "rotate", angle: 90, background }, signal), virtualCanvas: magickTransposeCanvas(image, kind === "flop") } : undefined);
        } else if (!operandsOnly && token === "-vignette") {
            const geometry = parseMagickVignetteGeometry(tokens[++i] ?? "0x1");
            const background = state.background, backgroundExplicit = state.backgroundExplicit, channels = state.channelExplicit ? { ...state.channels } : undefined;
            steps.push(async (image, backend) => {
                if (!image) return;
                const layout = vignetteLayout(image);
                return { ...await transformStoredMagickRaster(image, backend, vignettePixelSteps(image, backgroundExplicit ? background : image.backgroundColor ?? background, geometry, channels), signal, layout), virtualCanvas: layout.virtualCanvas };
            });
        } else if (!operandsOnly && token === "-shadow") {
            const geometry = tokens[++i] ?? "80x3+5+5", background = state.background, backgroundExplicit = state.backgroundExplicit;
            steps.push(async (image, backend) => {
                if (!image) return;
                const layout = magickShadowLayout(image, geometry);
                if ((image.space === "b-w" || image.space === "grey16") && (background.r !== background.g || background.g !== background.b))
                    image = { ...image, space: "srgb", channels: 4 };
                const base = { ...await transformStoredMagickRaster(image, backend, shadowPixelSteps(image, layout, backgroundExplicit ? background : image.backgroundColor ?? background), signal, layout), virtualCanvas: layout.virtualCanvas };
                return layout.sigma === 0 ? base : transformStoredMagickRaster(base, backend, blurPixelSteps(base, { height: layout.sigma }, false, { r: false, g: false, b: false, a: true }), signal);
            });
        } else if (!operandsOnly && (token === "-morphology" || token === "-statistic")) {
            const method = (tokens[++i] ?? (token === "-morphology" ? "dilate" : "median")).toLowerCase();
            let spec = "";
            if (token === "-statistic") spec = tokens[++i] ?? "3x3";
            else if (tokens[i + 1] && !tokens[i + 1]!.startsWith("-") && !tokens[i + 1]!.startsWith("+")) spec = tokens[++i]!;
            if (token === "-morphology" && (method.split(":")[0] === "convolve" || method.split(":")[0] === "correlate")) {
                const { iterations } = parseMagickMorphologyMethod(method);
                const kernel = parseMagickConvolveKernel(spec, false, method.split(":")[0] === "convolve");
                steps.push(async (image, backend) => {
                    for (let pass = 0; image && kernel.weights.length && pass < iterations; pass++)
                        image = await transformStoredMagickRaster(image, backend, convolvePixelSteps(image, kernel, 0), signal);
                    return image;
                });
            } else {
                const plan = magickMorphologyPlan(method, spec);
                const channels = state.channelExplicit ? [state.channels.r, state.channels.g, state.channels.b, state.channels.a] : undefined;
                steps.push(async (image, backend) => image ? morphStoredMagickImage(image, backend, plan, signal, channels) : undefined);
            }
        } else if (!operandsOnly && token === "-emboss") {
            const geometry = parseMagickGeometry(tokens[++i] ?? "0x1");
            steps.push(async (image, backend) => image ? transformStoredMagickRaster(image, backend, embossPixelSteps(image, geometry), signal) : undefined);
        } else if (!operandsOnly && token === "-canny") {
            const spec = tokens[++i] ?? "0x1+10%+30%", channels = state.channelExplicit ? { ...state.channels } : undefined, virtualPixel = state.virtualPixel, background = state.background;
            steps.push(async (image, backend) => image ? transformStoredMagickRaster(image, backend, cannyPixelSteps(image, spec, channels, virtualPixel, background), signal, { ...image, hasAlpha: false }) : undefined);
        } else if (!operandsOnly && token === "-charcoal") {
            const geometry = parseMagickGeometry(tokens[++i] ?? "0x1");
            steps.push(async (image, backend) => {
                if (!image) return;
                const edges = await transformStoredMagickRaster(image, backend, edgePixelSteps(image, geometry.width ?? 0), signal, { ...image, hasAlpha: false });
                return transformStoredMagickRaster(edges, backend, charcoalPixelSteps(edges, geometry), signal);
            });
        } else if (!operandsOnly && token === "-sketch") {
            const geometry = parseMagickGeometry(tokens[++i] ?? "0x1"), seed = state.seed ?? 0;
            steps.push(async (image, backend) => image ? transformStoredMagickRaster(image, backend, sketchPixelSteps(image, geometry, seed), signal) : undefined);
        } else if (!operandsOnly && token === "-edge") {
            const argument = tokens[++i] ?? "", radius = Number(argument);
            if (!argument.trim() || !Number.isFinite(radius)) throw new Error(`invalid argument for option '-edge': ${argument}`);
            const channels = state.channelExplicit ? state.channels : undefined, virtualPixel = state.virtualPixel, background = state.background;
            steps.push(async (image, backend) => image ? transformStoredMagickRaster(image, backend, edgePixelSteps(image, radius, channels, virtualPixel, background), signal) : undefined);
        } else if (!operandsOnly && token === "-convolve") {
            const spec = tokens[++i] ?? "1";
            const kernel = parseMagickConvolveKernel(spec);
            steps.push(async (image, backend) => image && kernel.weights.length ? transformStoredMagickRaster(image, backend, convolvePixelSteps(image, kernel, 0), signal) : image);
        } else if (!operandsOnly && ["-roll", "-splice", "-chop"].includes(token)) {
            const geometry = tokens[++i] ?? (token === "-roll" ? "+0+0" : "0x0"), captured = { ...state };
            steps.push(async (image, backend) => {
                if (!image) return;
                const expanded = await formatRetainedIdentify(geometry, { ...image, properties: { ...captured.optionProperties, ...image.properties } }, (image as StoredMagickImage)[magickInput] ?? {}, async () => ({ image, storage: backend.storage }), signal);
                if (token === "-splice") validateMagickSpliceGeometry(expanded);
                else validateMagickTransformGeometry(expanded, token);
                return transformStoredMagickCoordinates(image, backend, token, expanded, captured, signal, analysis);
            });
        } else if (!operandsOnly && token === "-resample") {
            const value = tokens[++i] ?? "72", kernel = state.kernel, settings = state.resizeFilter;
            steps.push(async (image, backend) => {
                if (!image) return;
                const options = magickResizeOptions(image, magickResampleGeometry(image, value), kernel);
                const resized = options ? await resizeStoredMagickImage(image, backend, options, signal, false, false, false, settings) : image;
                return applyMagickDensity(resized, value);
            });
        } else if (!operandsOnly && token === "-magnify") {
            const method = state.magnifyMethod, factor = method === "scale3x" ? 3 : 2;
            steps.push(async (image, backend) => image ? transformStoredMagickRaster(image, backend, magnifyPixelSteps(image, method), signal, { ...image, width: image.width * factor, height: image.height * factor }) : undefined);
        } else if (!operandsOnly && ["-resize", "-scale", "-sample", "-thumbnail"].includes(token)) {
            const geometry = tokens[++i] ?? "100%", kernel = token === "-sample" ? "nearest" : state.kernel, thumbnail = token === "-thumbnail", settings = state.resizeFilter, sampleOffset = state.sampleOffset;
            validateMagickTransformGeometry(geometry, token);
            steps.push(async (image, backend) => { if (!image) return; const options = magickResizeOptions(image, geometry, kernel ?? (thumbnail ? "lanczos3" : undefined)); return options ? resizeStoredMagickImage(image, backend, options, signal, thumbnail, token === "-sample", token === "-scale", settings, sampleOffset) : image; });
        } else if (!operandsOnly && ["-flip", "-flop", "-auto-orient"].includes(token)) {
            if (token === "-auto-orient") stackStep(async stack => {
                if (!stack.length) throw new Error(`no images found for operation '${token}'`);
                return stack;
            });
            const kind = token === "-flip" ? "flip" : token === "-flop" ? "flop" : "autoOrient", orientation = state.orientation;
            steps.push(async (image, backend) => {
                if (!image) return;
                let output = await transformStoredImage(image, backend.storage, { kind }, signal);
                if (kind === "autoOrient" && orientation !== undefined) output = { ...output, orientation };
                const virtualCanvas = kind === "autoOrient" ? magickAutoOrientCanvas(image) : magickMirrorCanvas(image, kind);
                return virtualCanvas ? { ...output, virtualCanvas } : output;
            });
        } else if (!operandsOnly && token === "-deskew") {
            const spec = tokens[++i] ?? "", background = state.background, autoCrop = state.deskewAutoCrop, fuzz = state.alphaFuzz, pointFilter = state.pointFilter;
            const backgroundExplicit = state.backgroundExplicit;
            steps.push(async (image, backend) => {
                if (!image) return;
                const plan = deskewPlan(image, await storedDeskewAngle(image, backend.storage, spec, signal), pointFilter);
                const rotated = { ...await transformStoredMagickRaster(image, backend, deskewPixelSteps(image, plan, backgroundExplicit ? background : image.backgroundColor ?? background, autoCrop), signal, plan), virtualCanvas: plan.virtualCanvas, properties: plan.properties };
                if (!["1", "true", "yes", "on"].includes(autoCrop ?? "")) return rotated;
                const median = await transformStoredMagickRaster(rotated, backend, morphologyPixelSteps(rotated, magickMedianRows("3"), "median"), signal);
                const bounds = await trimStoredMagick({ ...median, virtualCanvas: { ...plan.virtualCanvas, x: 0, y: 0 } }, backend.storage, fuzz, signal);
                if (bounds.virtualCanvas!.x === -1 && bounds.virtualCanvas!.y === -1) return bounds;
                return { ...await transformStoredImage(rotated, backend.storage, { kind: "extract", left: bounds.virtualCanvas!.x - plan.virtualCanvas.x, top: bounds.virtualCanvas!.y - plan.virtualCanvas.y, width: bounds.width, height: bounds.height }, signal), virtualCanvas: bounds.virtualCanvas! };
            });
        } else if (!operandsOnly && token === "-rotate") {
            const spec = tokens[++i] ?? "0", settings = { ...state };
            steps.push(async (image, backend) => {
                if (!image) return;
                const expanded = await formatRetainedIdentify(spec, image, { ...(image as StoredMagickImage)[magickInput], optionProperties: settings.optionProperties }, async () => ({ image, storage: backend.storage }), signal);
                const operation = parseMagickWarpOperation(["-rotate", expanded], settings, 0, analysis);
                const { angle, applies } = parseMagickRotation(expanded);
                if (!applies(image)) return image;
                const plan = operation?.plan(image);
                if (plan) return { ...await transformStoredMagickRaster(image, backend, plan.steps, signal, plan), ...(plan.virtualCanvas ? { virtualCanvas: plan.virtualCanvas } : {}) };
                return {
                    ...await transformStoredImage(image, backend.storage, { kind: "rotate", angle, background: settings.background }, signal),
                    ...(image.virtualCanvas ? { virtualCanvas: magickRotateCanvas(image, angle) } : {})
                };
            });
        } else if (!operandsOnly && (token === "-blur" || token === "-gaussian-blur")) {
            const geometry = parseMagickGeometry(tokens[++i] ?? "0x1"), channels = state.channelExplicit ? state.channels : undefined;
            steps.push(async (image, backend) => image ? transformStoredMagickRaster(image, backend, blurPixelSteps(image, geometry, token === "-gaussian-blur", channels), signal) : undefined);
        } else if (!operandsOnly && token === "-wavelet-denoise") {
            const geometry = tokens[++i] ?? "";
            steps.push(async (image, backend) => image ? transformStoredMagickRaster(image, backend, waveletDenoisePixelSteps(image, geometry), signal) : undefined);
        } else if (!operandsOnly && token === "-lat") {
            const geometry = parseLocalThresholdGeometry(tokens[++i] ?? ""), background = state.background, virtualPixel = state.virtualPixel, channels = state.channelExplicit ? state.channels : undefined;
            steps.push(async (image, backend) => image ? transformStoredMagickRaster(image, backend, localThresholdPixelSteps(image, geometry, background, virtualPixel, channels), signal) : undefined);
        } else if (!operandsOnly && token === "-mean-shift") {
            const geometry = parseMeanShiftGeometry(tokens[++i] ?? ""), background = state.background, virtualPixel = state.virtualPixel;
            steps.push(async (image, backend) => image ? transformStoredMagickRaster(image, backend, meanShiftPixelSteps(image, geometry, background, virtualPixel), signal) : undefined);
        } else if (!operandsOnly && token === "-kuwahara") {
            const geometry = parseMagickGeometry(tokens[++i] ?? "0x1"), background = state.background, virtualPixel = state.virtualPixel, channels = state.channelExplicit ? state.channels : undefined;
            steps.push(async (image, backend) => image ? transformStoredMagickRaster(image, backend, kuwaharaPixelSteps(image, geometry, background, virtualPixel, channels), signal) : undefined);
        } else if (!operandsOnly && token === "-rotational-blur") {
            const geometry = tokens[++i] ?? "", background = state.background, virtualPixel = state.virtualPixel, channels = state.channelExplicit ? state.channels : undefined, optionProperties = state.optionProperties;
            steps.push(async (image, backend) => {
                if (!image) return;
                const expanded = await formatRetainedIdentify(geometry, image, { ...(image as StoredMagickImage)[magickInput], optionProperties }, async () => ({ image, storage: backend.storage }), signal);
                const angle = parseMagickRotationalBlurAngle(expanded);
                return transformStoredMagickRaster(image, backend, rotationalBlurPixelSteps(image, angle, background, virtualPixel, channels), signal);
            });
        } else if (!operandsOnly && token === "-sharpen") {
            const geometry = parseMagickGeometry(tokens[++i] ?? "0x1");
            steps.push(async (image, backend) => image ? transformStoredMagickRaster(image, backend, sharpenPixelSteps(image, geometry), signal) : undefined);
        } else if (!operandsOnly && token === "-unsharp") {
            const geometry = parseUnsharpGeometry(tokens[++i] ?? "0x1"), channels = state.channelExplicit ? state.channels : undefined;
            steps.push(async (image, backend) => image ? transformStoredMagickRaster(image, backend, blurPixelSteps(image, geometry, false, channels, geometry), signal) : undefined);
        } else if (!operandsOnly && token === "-crop") {
            const geometry = tokens[++i] ?? "100%", gravity = state.gravity;
            stackStep(async (stack, backend) => {
                const frames = new StoredImageStack(backend.storage, signal);
                for (let n = 0; n < stack.length; n++) {
                    const image = (await stack.get(n))!;
                    for (const area of magickCropAreas(image, geometry, gravity)) {
                        await yieldTurn(signal);
                        if (area === null) {
                            analysis.warnings += `magick: geometry does not contain image '${geometry}'\n`;
                            await frames.push({ ...await createStoredCanvas(1, 1, { r: 255, g: 255, b: 255, a: 0 }, backend, signal),
                                ...(image.delay ? { delay: image.delay } : {}), ...(image.storedDelay ? { storedDelay: image.storedDelay } : {}),
                                ...(image[magickInput] ? { [magickInput]: image[magickInput] } : {}),
                                virtualCanvas: { ...magickCropCanvas(image, 0, 0), x: -1, y: -1 } });
                            continue;
                        }
                        await frames.push(area ? {
                            ...await transformStoredImage(image, backend.storage, { kind: "extract", ...area }, signal),
                            virtualCanvas: magickCropCanvas(image, area.left, area.top)
                        } : image);
                    }
                }
                return frames;
            });
        } else if (!operandsOnly && token === "-shave") {
            const geometry = tokens[++i] ?? "", captured = { ...state };
            steps.push(async (image, backend) => {
                if (!image) return;
                const expanded = await formatRetainedIdentify(geometry, { ...image, properties: { ...captured.optionProperties, ...image.properties } }, (image as StoredMagickImage)[magickInput] ?? {}, async () => ({ image, storage: backend.storage }), signal);
                validateMagickTransformGeometry(expanded, token);
                const parsed = parseMagickGeometry(expanded.replace(":", "x"));
                const width = Math.max(0, Math.round(parsed.isPercent ? image.width * (parsed.percentX ?? 100) / 100 : parsed.width ?? 0));
                const height = Math.max(0, Math.round(parsed.isPercent ? image.height * (parsed.percentY ?? 100) / 100 : parsed.height ?? (expanded.toLowerCase().includes("x") ? 0 : width)));
                if ((parsed.hasOffset && parsed.width === undefined && parsed.height === undefined) || width * 2 >= image.width || height * 2 >= image.height) {
                    analysis.warnings += `magick: geometry does not contain image '${geometry}'\n`;
                    return image;
                }
                return { ...await transformStoredImage(image, backend.storage, { kind: "extract", left: width, top: height, width: image.width - width * 2, height: image.height - height * 2 }, signal),
                    virtualCanvas: magickBorderCanvas(image, -width, -height) };
            });
        } else if (!operandsOnly && token === "-trim") {
            const fuzz = state.alphaFuzz, edges = state.trimEdges, minSize = state.trimMinSize, percentBackground = state.trimPercentBackground;
            steps.push(async (image, backend) => image ? trimStoredMagick(image, backend.storage, fuzz, signal, edges, minSize, percentBackground, analysis) : undefined);
        } else if (!operandsOnly && token === "-median") {
            const rows = magickMedianRows(tokens[++i] ?? "3");
            steps.push(async (image, backend) => image ? transformStoredMagickRaster(image, backend, morphologyPixelSteps(image, rows, "median"), signal) : undefined);
        } else if (!operandsOnly && token === "-extent") {
            const geometry = tokens[++i] ?? "100%", captured = { ...state };
            steps.push(async (image, backend) => {
                if (!image) return;
                const layout = magickExtentLayout(image, geometry, captured);
                if (!layout) return image;
                const virtualCanvas = magickResizeCanvas(image, layout.width, layout.height);
                const source = (image as StoredMagickImage)[magickInput];
                const background = captured.backgroundExplicit ? captured.background : image.backgroundColor ?? captured.background;
                const canvas = { ...await createStoredCanvas(layout.width, layout.height, background, backend, signal, !!image.storedData16),
                    ...(image.delay ? { delay: image.delay } : {}), ...(image.storedDelay ? { storedDelay: image.storedDelay } : {}),
                    ...(source ? { [magickInput]: source } : {}), ...(virtualCanvas ? { virtualCanvas } : {}) };
                if (!layout.area) return canvas;
                if (image.storedData16 && canvas.storedData16) {
                    for (let y = 0; y < layout.area.height; y++) for (let x = 0; x < layout.area.width; x += 4096) {
                        await yieldTurn(signal);
                        const start = ((layout.area.top + y) * image.width + layout.area.left + x) * 4;
                        const bytes = await backend.storage.read(image.storedData16.position + start * 2, Math.min(4096, layout.area.width - x) * 8);
                        const samples = new Uint16Array(bytes.slice().buffer);
                        extentSamplesOverBackground(samples, background);
                        const target = ((layout.top + y) * layout.width + layout.left + x) * 4;
                        await backend.storage.write(canvas.storedData16.position + target * 2, new Uint8Array(samples.buffer));
                        await backend.storage.write(canvas.position + target, Uint8Array.from(samples, value => Math.round(value / 257)));
                    }
                    return canvas;
                }
                const overlay = await transformStoredImage(image, backend.storage, { kind: "extract", ...layout.area }, signal);
                return transformStoredImage(canvas, backend.storage, { kind: "composite", layers: [{ input: new Uint8Array(), left: layout.left, top: layout.top, blend: "over" }] }, signal, { async readImage() { return overlay; } });
            });
        } else if (!operandsOnly && token === "-frame") {
            const raw = tokens[++i] ?? "";
            validateMagickTransformGeometry(raw, token);
            const hasAxes = raw.toLowerCase().includes("x");
            const geometry = parseMagickGeometry(raw.replace(":", "x"));
            const { borderColor, matteColor, composeRaw, composeArgs, alphaFuzz } = state;
            steps.push(async (image, backend) => {
                if (!image) return;
                const left = Math.max(0, Math.round(geometry.isPercent ? image.width * (geometry.percentX ?? 100) / 100 : geometry.width ?? (hasAxes ? 0 : image.width)));
                const top = Math.max(0, Math.round(geometry.isPercent ? image.height * (geometry.percentY ?? 100) / 100 : geometry.height ?? (hasAxes ? 0 : geometry.width ?? image.height)));
                const width = image.width + 2 * left, height = image.height + 2 * top;
                const canvas = { ...await transformStoredMagickRaster(image, backend, magickFramePixels(image, width, height, borderColor, matteColor, left, top, geometry.x, geometry.y, composeRaw.toLowerCase() === "over"), signal,
                    { width, height, hasAlpha: image.hasAlpha || matteColor.a < 255 || borderColor.a < 255 }), virtualCanvas: magickBorderCanvas(image, left, top) };
                if (composeRaw.toLowerCase() === "over") return canvas;
                return compositeStoredMagick(canvas, image, backend, signal, left, top, composeRaw, composeArgs, false, true, false, false, alphaFuzz, true);
            });
        } else if (!operandsOnly && token === "-border") {
            const geometry = parseMagickBorderGeometry(tokens[++i] ?? ""), background = state.borderColor, compose = state.composeRaw, composeArgs = state.composeArgs, fuzz = state.alphaFuzz;
            steps.push(async (image, backend) => {
                if (!image) return;
                const left = Math.max(0, Math.round(geometry.isPercent ? image.width * (geometry.percentX ?? 100) / 100 : geometry.width ?? 0));
                const top = Math.max(0, Math.round(geometry.isPercent ? image.height * (geometry.percentY ?? 100) / 100 : geometry.height ?? left));
                const canvas = await createStoredCanvas(image.width + left * 2, image.height + top * 2, background, backend, signal);
                return { ...await compositeStoredMagick(canvas, image, backend, signal, left, top, compose, composeArgs, false, true, false, false, fuzz, true),
                    virtualCanvas: magickBorderCanvas(image, left, top) };
            });
        } else {
            if (!operandsOnly && ((token.startsWith("-") && token !== "-") || token.startsWith("+"))) {
                // Execute preceding writes before reporting the option error.
                stackStep(async () => { throw new Error(`unrecognized option '${token}'`); });
                break;
            }
            if (!operandsOnly && (token === "(" || token === ")")) continue;
            const captured = { ...state }, literal = operandsOnly, maxDecodeDimension = inferMaxDecodeDimensionFromUpcomingTokens(tokens, i + 1);
            stackStep(async (stack, backend) => {
                if (token.slice(0, 4).toLowerCase() === "mpr:") {
                    const saved = registers.get(token.slice(4));
                    if (!saved) throw new Error(`unable to open image '${token}'`);
                    for (let index = 0; index < saved.length; index++) {
                        await yieldTurn(signal);
                        await stack.push((await saved.get(index))!);
                    }
                    return stack;
                }
                const base = stack.length === 1 ? await stack.get(0) : undefined, lower = token.toLowerCase();
                const merge = !literal && (lower.startsWith("label:") || lower.startsWith("caption:")) && base && captured.hasSize && base.width === captured.sizeWidth && base.height === captured.sizeHeight && Object.values(captured.background).every(value => value === 255);
                const settings = merge ? { ...captured, background: { r: 0, g: 0, b: 0, a: 0 } } : captured;
                const loaded = await parseStoredCompareInput(token, settings, backend, signal, { visit: async image => {
                    for (const warning of image.decodeWarnings ?? []) analysis.warnings += `magick: ${warning}\n`;
                    if (merge) {
                        const composed = await compositeStoredMagick(base, image, backend, signal, 0, 0, "over");
                        await stack.set(0, { ...composed, hasAlpha: base.hasAlpha, channels: base.channels });
                    }
                    else await stack.push(image);
                }, ...(maxDecodeDimension === undefined ? {} : { maxDecodeDimension }) });
                if (!loaded) throw new Error(`unable to open image '${token}'`);
                return stack;
            });
        }
    }
    } catch (error) {
        signal.throwIfAborted();
        return { exitCode: 1, stdout: "", stderr: `magick: ${(error as Error).message}\n` };
    }
    if (scopes.length) state = scopes[0]!.state;
    return withCompareFiles(input, stdinBytes, signal, async backend => {
        let image: StoredRgbaImage | undefined, stack = new StoredImageStack(backend.storage, signal);
        try {
            const parents: StoredImageStack[] = [];
            for (const step of steps) {
                signal.throwIfAborted();
                if (typeof step !== "function") stack = await step.runStack(stack, backend, parents);
                else for (let n = 0; n < stack.length; n++) {
                    const original = (await stack.get(n))! as StoredRgbaImage;
                    let result = await step(original, backend);
                    if (result && original.storedWriteMask && result.position !== original.position && result.width === original.width && result.height === original.height) {
                        result = await transformStoredMagickRaster(result, backend, writeMaskPixelSteps(result, original.storedWriteMask, !!(result.storedData16 || original.storedData16)), signal, result, [result, original, { ...original, ...original.storedWriteMask }]);
                    }
                    if (result && original.region && result.position !== original.position && result.width === original.width && result.height === original.height) {
                        result = await transformStoredMagickRaster(result, backend, regionPixelSteps(result, original.region), signal, result, [result, original]);
                    }
                    if (result) await stack.set(n, result);
                }
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
        const outputTemplate = outSpec;
        outSpec = expandFilenameProperties(outSpec, (await stack.get(0))!.properties);
        const filenameExpanded = outSpec !== outputTemplate;
        const histogramInfo = outSpec.toLowerCase().startsWith("histogram:info:");
        const histogramComment = histogramInfo && state.formatStr === "%c";
        if (histogramInfo) outSpec = outSpec.slice(10);
        if (!histogramComment && (histogramInfo || (outSpec.toLowerCase().startsWith("histogram:") && !["", "-"].includes(outSpec.slice(10))))) {
            if (!histogramInfo) outSpec = outSpec.slice(10);
            for (let index = 0; index < stack.length; index++) {
                let source = (await stack.get(index))!;
                if (histogramInfo && state.formatStr && (state.formatStr.includes("%c") || state.formatStr.includes("%[comment]"))) {
                    let comment = "";
                    for await (const part of storedHistogram(source, backend.storage, signal)) comment += part;
                    source = { ...source, properties: { ...source.properties, comment } };
                }
                await stack.set(index, await transformStoredMagickRaster({ ...source, space: "srgb", channels: 3 }, backend, histogramPixelSteps(source.width * source.height), signal, { width: 256, height: 200, hasAlpha: false }));
            }
            image = (await stack.get(stack.length - 1))!;
        }
        output = inferOutputFormat(outSpec, "png");
        if (output.format === "tiff") for (let index = 0; index < stack.length; index++) {
            if ((await stack.get(index) as StoredRgbaImage).magickColorspace === "CIELab") return { exitCode: 1, stdout: "", stderr: "magick: unsupported colorspace 'Lab' for TIFF output\n" };
            if ((await stack.get(index))!.space === "cmyk") return { exitCode: 1, stdout: "", stderr: "magick: unsupported colorspace 'CMYK' for TIFF output\n" };
        }
        if (outSpec.toLowerCase() === "null:" || outSpec.toLowerCase().startsWith("mpr:")) { await backend.publishPending(); return { exitCode: 0, stdout: "", stderr: "" }; }
        const lower = outSpec.toLowerCase(), info = lower.startsWith("info:");
        const ftxt = lower.startsWith("ftxt:") || (lower.endsWith(".ftxt") && !outSpec.includes(":"));
        const sparse = lower.startsWith("sparse-color:");
        const text = sparse || lower.startsWith("txt:") || (lower.endsWith(".txt") && !outSpec.includes(":"));
        if (info || text || ftxt || lower.startsWith("histogram:")) {
            async function* information(): AsyncGenerator<string> {
                let last = "";
                for (let index = 0; index < stack.length; index++) {
                    await yieldTurn(signal);
                    const frame = (await stack.get(index))!;
                    if (sparse) { yield* storedSparseColor(frame, backend.storage, signal); continue; }
                    if (ftxt) { yield* storedFtxt(frame, backend.storage, signal, state.ftxtFormat); continue; }
                    if (text) { yield* storedPixelEnumeration(frame, backend.storage, signal, state.inputDepth); continue; }
                    if (histogramComment) { yield* storedHistogram(frame, backend.storage, signal); continue; }
                    if (index && state.formatStr === undefined) yield "\n";
                    const formatted = state.formatStr !== undefined ? await formatRetainedIdentify(state.formatStr, frame, { ...frame[magickInput], analysis, sceneIdx: index, sceneCount: stack.length, quality: state.quality, channelSelection: state.channelExplicit ? state.channels : undefined }, async () => ({ image: frame, storage: backend.storage }), signal) : `${frame.width}x${frame.height} ${(frame as StoredRgbaImage).magickColorspace ?? "sRGB"} 8-bit`;
                    if (formatted) last = formatted.at(-1)!;
                    yield formatted;
                }
                if (!text && !ftxt && !(histogramInfo && state.formatStr !== undefined) && last !== "\n") yield "\n";
            }
            try {
                const parts = info || text || ftxt ? information() : storedHistogram(image, backend.storage, signal);
                const chunks = encodeText(parts, signal), target = sparse ? outSpec.slice(13) : info || lower.startsWith("ftxt:") ? outSpec.slice(5) : ftxt ? outSpec : lower.startsWith("txt:") ? outSpec.slice(4) : text ? outSpec : "-";
                if (target && target !== "-") {
                    await backend.publishText(image, target, chunks);
                    return { exitCode: 0, stdout: "", stderr: "" };
                }
                let stdout = "";
                if (input.stdout) for await (const chunk of chunks) await writeBytes(input.stdout, chunk, signal);
                else for await (const part of parts) { signal.throwIfAborted(); stdout += part; }
                await backend.publishPending();
                return { exitCode: 0, stdout, stderr: "" };
            } catch (error) {
                signal.throwIfAborted();
                if (error instanceof CompareInputFailure) throw error.reason;
                await backend.publishPending();
                return { exitCode: 1, stdout: "", stderr: `magick: ${(error as Error).message}\n` };
            }
        }
        if ((!state.filenameLiteral && filenameExpanded) || hasSceneOutputPattern(output.path, state.filenameLiteral) || (stack.length > 1 && (!state.adjoin || (output.path !== "-" && ["png", "jpeg", "bmp"].includes(output.format))))) {
            const firstScene = state.scene ?? (await stack.get(0))![magickInput]?.sceneIdx ?? 0;
            for (let index = 0; index < stack.length; index++) {
                await yieldTurn(signal);
                await backend.stage({ ...(await prepareStoredMagickOutput((await stack.get(index))!, output.format, backend, signal, state.dither, state.diffusionAmount, output.pngCoder)), ...(output.format === "gif" && state.backgroundExplicit ? { backgroundColor: state.background } : {}) }, formatSceneOutputPath(inferOutputFormat(outputTemplate).path, firstScene + index, state.filenameLiteral, (await stack.get(index))!.properties), { format: output.format, tiffBig: output.tiffBig, pngCoder: output.pngCoder, gifVersion: output.gifVersion, bmpFormat: output.bmpFormat ?? state.bmpFormat ?? "bmp4", palette: true, pngColorType: pngOutputColorType(state.pngColorType, output.format, analysis), ...(state.miffCompression === undefined ? {} : { miffCompression: state.miffCompression }), ...(state.tgaCompression === undefined ? {} : { tgaCompression: state.tgaCompression }), ...(state.bmpCompression === undefined ? {} : { bmpCompression: state.bmpCompression }), ...(state.bmpSubtype === undefined ? {} : { bmpSubtype: state.bmpSubtype }), ...(state.bmp3Alpha === undefined ? {} : { bmp3Alpha: state.bmp3Alpha }), ...(state.inputDepth === undefined ? {} : { tiffIntegerDepth: state.inputDepth <= 8 ? 8 : state.inputDepth <= 16 ? 16 : 32 }), ...(state.tiffSigned === undefined ? {} : { tiffSigned: state.tiffSigned }), ...(state.tiffFloatingPoint ? { tiffFloatDepth: (state.inputDepth ?? 32) <= 16 ? 16 : (state.inputDepth ?? 32) <= 32 ? 32 : 64 } : {}), ...(state.tiffPlanar === undefined ? {} : { tiffPlanar: state.tiffPlanar }), ...(state.tiffAlpha === undefined ? {} : { tiffAlpha: state.tiffAlpha }), ...(state.tiffEndian === undefined ? {} : { tiffEndian: state.tiffEndian }), ...(state.tiffRowsPerStrip === undefined ? {} : { tiffRowsPerStrip: state.tiffRowsPerStrip }), ...(state.tiffTile === undefined ? {} : { tiffTile: state.tiffTile }), ...(state.tiffCompression === undefined ? {} : { tiffCompression: state.tiffCompression }), netpbmAscii: state.netpbmAscii ?? false, ...(state.inputDepth === undefined ? {} : { netpbmDepth: Math.min(16, state.inputDepth), miffDepth: state.inputDepth <= 8 ? 8 : 16 }), endian: state.inputEndian, pngPreserveColormap: state.pngPreserveColormap, pngBitDepth: state.pngBitDepth, ...(state.jpegRestartInterval === undefined ? {} : { jpegRestartInterval: state.jpegRestartInterval }), ...(state.jpegDctMethod === undefined ? {} : { jpegDctMethod: state.jpegDctMethod }), ...(state.jpegOptimizeCoding === undefined ? {} : { jpegOptimizeCoding: state.jpegOptimizeCoding }), ...(state.jpegArithmeticCoding === undefined ? {} : { jpegArithmeticCoding: state.jpegArithmeticCoding }), ...(state.jpegProgressive === undefined ? {} : { jpegProgressive: state.jpegProgressive }), pngInterlace: state.pngInterlace, gifInterlace: state.gifInterlace, transparentColor: state.transparentColor, omitPngResolution: state.strip || state.omitPngResolution === true, ...(state.samplingFactor === undefined ? {} : { samplingFactor: state.samplingFactor }), chromaSubsampling: state.quality < 90 ? "4:2:0" : "4:4:4", webpExact: state.webpExact ?? false, smartSubsample: state.webpSmartSubsample ?? false, alphaCompression: state.webpAlphaCompression ?? 1, alphaQuality: state.webpAlphaQuality ?? 100, webpTargetSize: state.webpTargetSize, webpPass: state.webpPass, jpegExtent: state.jpegExtent, quality: state.quality, ...(output.format === "webp" ? { effort: state.webpMethod ?? 4, lossless: state.webpLossless ?? state.quality >= 100 } : {}) });
            }
            await backend.publishPending();
            return { exitCode: 0, stdout: "", stderr: "" };
        }
        if (stack.length > 1 && output.format === "miff") image = prepareStoredMiffPages(stack, image, backend, signal);
        if (output.format === "ico") image = await prepareStoredIcoPages(stack, image, backend, signal, state.iconAutoResize, state.kernel, state.resizeFilter);
        if (stack.length > 1 && output.format === "tiff") image = prepareStoredTiffPages(stack, image, backend, signal);
        let pageHeight: number | undefined;
        if (stack.length > 1 && (output.format === "gif" || output.format === "apng" || output.format === "mng" || output.format === "webp")) {
            image = await prepareStoredGifFrames(stack, backend, signal, output.format === "gif" ? state.dither : false, state.diffusionAmount);
            pageHeight = image.pageHeight;
        }
        const scene = pageHeight === undefined ? (await stack.get(0))![magickInput]?.sceneIdx ?? 0 : 0;
        const delay = pageHeight === undefined ? await image.storedDelay?.at(scene, { signal }) ?? image.delay?.[scene] : undefined;
        const stdoutBytes = await backend.publish({ ...(await prepareStoredMagickOutput(image, output.format, backend, signal, state.dither, state.diffusionAmount, output.pngCoder)), ...(output.format === "gif" && state.backgroundExplicit ? { backgroundColor: state.background } : {}) }, formatAdjoinedOutputPath(output.path, stack.length, state.scene ?? 0, state.filenameLiteral), { format: output.format, tiffBig: output.tiffBig, pngCoder: output.pngCoder, gifVersion: output.gifVersion, bmpFormat: output.bmpFormat ?? state.bmpFormat ?? "bmp4", palette: true, pngColorType: pngOutputColorType(state.pngColorType, output.format, analysis), ...(state.miffCompression === undefined ? {} : { miffCompression: state.miffCompression }), ...(state.tgaCompression === undefined ? {} : { tgaCompression: state.tgaCompression }), ...(state.bmpCompression === undefined ? {} : { bmpCompression: state.bmpCompression }), ...(state.bmpSubtype === undefined ? {} : { bmpSubtype: state.bmpSubtype }), ...(state.bmp3Alpha === undefined ? {} : { bmp3Alpha: state.bmp3Alpha }), ...(state.inputDepth === undefined ? {} : { tiffIntegerDepth: state.inputDepth <= 8 ? 8 : state.inputDepth <= 16 ? 16 : 32 }), ...(state.tiffSigned === undefined ? {} : { tiffSigned: state.tiffSigned }), ...(state.tiffFloatingPoint ? { tiffFloatDepth: (state.inputDepth ?? 32) <= 16 ? 16 : (state.inputDepth ?? 32) <= 32 ? 32 : 64 } : {}), ...(state.tiffPlanar === undefined ? {} : { tiffPlanar: state.tiffPlanar }), ...(state.tiffAlpha === undefined ? {} : { tiffAlpha: state.tiffAlpha }), ...(state.tiffEndian === undefined ? {} : { tiffEndian: state.tiffEndian }), ...(state.tiffRowsPerStrip === undefined ? {} : { tiffRowsPerStrip: state.tiffRowsPerStrip }), ...(state.tiffTile === undefined ? {} : { tiffTile: state.tiffTile }), ...(state.tiffCompression === undefined ? {} : { tiffCompression: state.tiffCompression }), netpbmAscii: state.netpbmAscii ?? false, ...(state.inputDepth === undefined ? {} : { netpbmDepth: Math.min(16, state.inputDepth), miffDepth: state.inputDepth <= 8 ? 8 : 16 }), endian: state.inputEndian, pngPreserveColormap: state.pngPreserveColormap, pngBitDepth: state.pngBitDepth, ...(state.jpegRestartInterval === undefined ? {} : { jpegRestartInterval: state.jpegRestartInterval }), ...(state.jpegDctMethod === undefined ? {} : { jpegDctMethod: state.jpegDctMethod }), ...(state.jpegOptimizeCoding === undefined ? {} : { jpegOptimizeCoding: state.jpegOptimizeCoding }), ...(state.jpegArithmeticCoding === undefined ? {} : { jpegArithmeticCoding: state.jpegArithmeticCoding }), ...(state.jpegProgressive === undefined ? {} : { jpegProgressive: state.jpegProgressive }), pngInterlace: state.pngInterlace, gifInterlace: state.gifInterlace, transparentColor: state.transparentColor, omitPngResolution: state.strip || state.omitPngResolution === true, ...(state.samplingFactor === undefined ? {} : { samplingFactor: state.samplingFactor }), chromaSubsampling: state.quality < 90 ? "4:2:0" : "4:4:4", webpExact: state.webpExact ?? false, smartSubsample: state.webpSmartSubsample ?? false, alphaCompression: state.webpAlphaCompression ?? 1, alphaQuality: state.webpAlphaQuality ?? 100, webpTargetSize: state.webpTargetSize, webpPass: state.webpPass, jpegExtent: state.jpegExtent, quality: state.quality, ...(output.format === "webp" ? { effort: state.webpMethod ?? 4, lossless: state.webpLossless ?? state.quality >= 100 } : {}), ...(pageHeight === undefined ? {} : { pageHeight }), ...(delay === undefined ? {} : { delay }), ...(output.format === "gif" && stack.length === 1 ? { loop: 1 } : state.loop === undefined ? {} : { loop: state.loop }), ...(state.optimizeLayers ? { optimizeFrames: true, gifTransdiff: true } : {}) });
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

function* parseMogrifySteps(argv: readonly string[]): Generator<void, ({ target: string; identify: boolean; verbose: boolean; regardWarnings: boolean; args: (target: string) => string[] } | ImageMagickCliResult)[], void> {
    const listResult = tryHandleMagickListOption(argv);
    if (listResult) return [listResult];
    const optionArgs = argv.slice(0, argv.indexOf("--") < 0 ? argv.length : argv.indexOf("--"));
    if (argv.length === 0 || optionArgs.some(arg => ["-help", "--help", "-h"].includes(arg))) {
        return [{
            exitCode: argv.length === 0 ? 1 : 0,
            stdout: "Usage: mogrify [options] file...\n",
            stderr: argv.length === 0 ? "mogrify: missing required argument\n" : ""
        }];
    }
    if (optionArgs.includes("-version") || optionArgs.includes("--version")) {
        return [{ exitCode: 0, stdout: "Version: ImageMagick 7.1.1-safe-bash (@poe-code/image-ast)\n", stderr: "" }];
    }
    const plans: ({ target: string; identify: boolean; verbose: boolean; regardWarnings: boolean; args: (target: string) => string[] } | ImageMagickCliResult)[] = [];
    let cooperativeWork = 63;
    let identify = false, verbose = false, regardWarnings = false;
    let outFormatExt: string | undefined;
    let outDir: string | undefined;
    const opTokens: string[] = [];
    const writeTokens: string[] = [];
    const readSettings: string[] = [];
    const flagsWithOneArg = new Set([
        "-resample",
        "-resize",
        "-scale",
        "-sample",
        "-thumbnail",
        "-crop",
        "-extent",
        "-border",
        "-bordercolor",
        "-mattecolor",
        "-frame",
        "-shave",
        "-rotate",
        "-deskew",
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
        "-interpolate",
        "-colorspace",
        "-grayscale",
        "-type",
        "-modulate",
        "-brightness-contrast",
        "-gamma", "+gamma",
        "-level",
        "+level",
        "-threshold",
        "-range-threshold",
        "-black-threshold",
        "-white-threshold",
        "-sigmoidal-contrast",
        "+sigmoidal-contrast",
        "-convolve",
        "-color-matrix",
        "-channel-fx",
        "-evaluate-sequence",
        "-remap",
        "-read-mask",
        "-encipher", "-decipher",
        "-splice",
        "-chop",
        "-roll",
        "-liquid-rescale",
        "-adaptive-resize",
        "-define",
        "+set",
        "-write",
        "+write",
        "-compose",
        "-geometry",
        "-size",
        "-depth",
        "-compress",
        "-endian",
        "-units",
        "-interlace",
        "-sampling-factor",
        "-tint",
        "-colorize",
        "-blur",
        "-gaussian-blur",
        "-rotational-blur",
        "-lat",
        "-mean-shift",
        "-wavelet-denoise",
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
        "-ordered-dither",
        "-colors",
        "-dither",
        "-edge",
        "-canny",
        "-hough-lines",
        "-emboss",
        "-charcoal",
        "-region", "-write-mask", "-clip-mask", "-sketch", "-seed", "-quantize", "-treedepth", "-virtual-pixel", "-orient", "-profile", "+profile",
        "-scene", "-delay", "-loop", "-transparent-color", "-dispose", "-morph", "-repage", "-raise", "+raise",
        "-clone", "-insert", "-swap", "-delete", "-smush", "+smush", "-layers", "-recolor",
        "-contrast-stretch", "-linear-stretch", "-intensity", "-connected-components", "+connected-components"
    ]);
    const flagsWithTwoArgs = new Set(["-annotate", "-evaluate", "-function", "-morphology", "-statistic", "-set", "-distort", "+distort", "-floodfill", "+floodfill"]);
    const readFlags = new Set(["-density", "-background", "-fuzz", "-filter", "-size", "-page", "-comment", "-label"]);
    const flagsWithoutArgs = new Set([
        "-antialias", "+antialias",
        "-identify", "+identify", "-verbose", "+verbose", "-regard-warnings", "+regard-warnings",
        "-negate", "+negate", "-contrast", "+contrast", "-trim", "-flip", "-flop", "-transpose", "-transverse", "-auto-orient",
        "-auto-level", "-auto-gamma", "-normalize", "-equalize", "-monochrome", "-strip", "-unique-colors",
        "-separate", "-combine", "-reverse", "-append", "+append", "-flatten", "-mosaic", "-composite",
        "-coalesce", "-deconstruct", "-average", "-clut", "-hald-clut", "-adjoin", "+adjoin",
        "+region", "+write-mask", "+clip-mask", "+repage", "+channel", "+quantize", "+treedepth", "+compress", "+depth", "+endian", "+size",
        "+read-mask", "+interpolate", "+intensity", "+filter", "+page", "+orient",
        "+virtual-pixel", "+gravity", "+sampling-factor", "+dither", "+clone", "+insert", "+swap", "+delete"
    ]);
    for (let i = 0; i < argv.length; i++) {
        if (++cooperativeWork % 64 === 0)
            yield;
        const t = argv[i]!;
        const option = t.startsWith("-") || t.startsWith("+");
        const count = flagsWithTwoArgs.has(t) ? 2
            : flagsWithOneArg.has(t) || readFlags.has(t) || t === "-format" || t === "-path" ? 1 : 0;
        if (option && count === 0 && !flagsWithoutArgs.has(t)) {
            plans.push({ exitCode: 1, stdout: "", stderr: `mogrify: unrecognized option '${t}'\n` });
            break;
        }
        if (i + count >= argv.length) {
            plans.push({ exitCode: 1, stdout: "", stderr: `mogrify: missing argument '${t}'\n` });
            break;
        }
        if (t === "-identify" || t === "+identify") identify = t === "-identify";
        else if (t === "-verbose" || t === "+verbose") verbose = t === "-verbose";
        else if (t === "-regard-warnings" || t === "+regard-warnings") regardWarnings = t === "-regard-warnings";
        else if (t === "-format") {
            const format = argv[++i]!;
            if (!extToImageFormat(format)) {
                plans.push({ exitCode: 1, stdout: "", stderr: `mogrify: unrecognized image format '${format}'\n` });
                break;
            }
            outFormatExt = format;
        }
        else if (t === "-path") {
            outDir = argv[++i]!;
        }
        else if (option) {
            (t === "-write" || t === "+write" ? writeTokens : readFlags.has(t) || t === "+filter" || t === "+page" ? readSettings : opTokens).push(...argv.slice(i, i + count + 1));
            i += count;
        }
        else {
            // Mogrify writes snapshots after all operations for the current input.
            const before = [...readSettings], after = [...opTokens, ...writeTokens];
            const directory = outDir, format = outFormatExt;
            plans.push({ target: t, identify, verbose, regardWarnings, args(target) {
                const baseName = target.slice(target.lastIndexOf("/") + 1);
                const dot = baseName.lastIndexOf(".");
                const stem = dot < 0 || dot === baseName.length - 1 ? baseName : baseName.slice(0, dot);
                const destDir = directory ? (directory.endsWith("/") ? directory : directory + "/") : target.slice(0, target.lastIndexOf("/") + 1);
                const destPath = format ? `${destDir}${stem}.${format}` : directory ? `${destDir}${baseName}` : target;
                return [...before, target, ...after, destPath];
            } });
        }
    }
    return plans;
}
function* runMogrifyCliSteps(argv: readonly string[], files: Map<string, Uint8Array>, _stdinBytes?: Uint8Array, signal?: AbortSignal): Generator<void, ImageMagickCliResult, void> {
    const combined = { exitCode: 0, stdout: "", stderr: "" };
    for (const plan of yield* parseMogrifySteps(argv)) {
        if ("exitCode" in plan) return { ...plan, stdout: combined.stdout + plan.stdout, stderr: combined.stderr + plan.stderr };
        for (const target of yield* mogrifyTargets(plan.target, files.keys())) {
            if (!files.has(target)) return { ...combined, exitCode: 1, stderr: combined.stderr + `mogrify: unable to open image '${target}': No such file or directory\n` };
            const args = plan.args(target);
            if (plan.verbose) combined.stderr += runIdentifyCliSync([target], files, undefined, signal).stdout;
            const result = yield* runConvertCliSteps(args, files, undefined, signal);
            combined.stdout += result.stdout;
            combined.stderr += result.stderr;
            if (result.exitCode !== 0) return { ...combined, exitCode: result.exitCode };
            if (plan.identify || plan.verbose) combined.stdout += runIdentifyCliSync([args.at(-1)!], files, undefined, signal).stdout;
            if (plan.regardWarnings && result.stderr) combined.exitCode = 1;
        }
    }
    return combined;
}
export async function runMogrifyCli(argv: readonly string[], files: Map<string, Uint8Array> | ConvertFileInput, _stdinBytes?: Uint8Array, signal?: AbortSignal): Promise<ImageMagickCliResult> {
    if (files instanceof Map) return drainSteps(runMogrifyCliSteps(argv, files, _stdinBytes, signal), signal);
    const active = signal ?? new AbortController().signal;
    const { stderr: errorSink, ...conversionInput } = files;
    let accounted = 0;
    const combined = { exitCode: 0, stdout: "", stderr: "" };
    for (const plan of await drainSteps(parseMogrifySteps(argv), active)) {
        active.throwIfAborted();
        if ("exitCode" in plan) {
            if (files.stdout) await writeIdentifyText(files.stdout, plan.stdout, active);
            if (files.stderr) await writeIdentifyText(files.stderr, plan.stderr, active);
            return { exitCode: plan.exitCode, stdout: combined.stdout + (files.stdout ? "" : plan.stdout), stderr: combined.stderr + (files.stderr ? "" : plan.stderr) };
        }
        for (const name of await mogrifyFileTargets(plan.target, files.filesystem, files.cwd, active)) {
            const args = plan.args(name);
            let exists = false;
            try { exists = (await files.filesystem.stat(resolvePath(files.cwd, name), { signal: active })).type === "file"; }
            catch (error) {
                active.throwIfAborted();
                if (!(error instanceof FsError) || !["ENOENT", "ENOTDIR", "EISDIR", "EACCES", "EPERM"].includes(error.code)) throw error;
            }
            if (!exists) {
                const stderr = `mogrify: unable to open image '${name}': No such file or directory\n`;
                if (files.stderr) await writeIdentifyText(files.stderr, stderr, active);
                return { ...combined, exitCode: 1, stderr: combined.stderr + (files.stderr ? "" : stderr) };
            }
            if (plan.verbose) {
                const report = await runIdentifyCli([name], { filesystem: files.filesystem, cwd: files.cwd, ...(files.stderr ? { stdout: files.stderr } : {}) }, undefined, active);
                combined.stderr += report.stdout + report.stderr;
            }
            let current = 0;
            const target = resolvePath(files.cwd, name);
            const replaceLink = resolvePath(files.cwd, args.at(-1)!) === target && (await files.filesystem.lstat(target, { signal: active })).type === "symlink";
            // Encode beside the link, then replace its directory entry only on success.
            const staging = replaceLink ? `${target.slice(0, target.lastIndexOf("/"))}/.mogrify-${crypto.randomUUID()}` : undefined;
            if (staging) await files.filesystem.mkdir(staging, { signal: active, mode: 0o700 });
            try {
                const output = staging ? `${staging}/${target.slice(target.lastIndexOf("/") + 1)}` : undefined;
                const conversionArgs = output ? [...args.slice(0, -1), output] : args;
                const result = await runConvertCli(conversionArgs, { ...conversionInput, inputBudget: { check(total) { files.inputBudget?.check(accounted + total); current = total; } } }, undefined, active);
                accounted += current;
                combined.stdout += result.stdout;
                if (files.stderr) await writeIdentifyText(files.stderr, result.stderr, active);
                else combined.stderr += result.stderr;
                if (result.exitCode !== 0) return { ...combined, exitCode: result.exitCode };
                if (output) await files.filesystem.rename(output, target, { signal: active });
                if (plan.identify || plan.verbose) {
                    const report = await runIdentifyCli([args.at(-1)!], { filesystem: files.filesystem, cwd: files.cwd, ...(files.stdout ? { stdout: files.stdout } : {}), ...(errorSink ? { stderr: errorSink } : {}) }, undefined, active);
                    combined.stdout += report.stdout;
                    combined.stderr += report.stderr;
                }
                if (plan.regardWarnings && result.stderr) combined.exitCode = 1;
            } finally {
                if (staging) await files.filesystem.rm(staging, { recursive: true, force: true });
            }
        }
    }
    return combined;
}
export function runMogrifyCliSync(argv: readonly string[], files: Map<string, Uint8Array>, _stdinBytes?: Uint8Array, signal?: AbortSignal): ImageMagickCliResult {
    const steps = runMogrifyCliSteps(argv, files, _stdinBytes, signal);
    let next = steps.next();
    while (!next.done) {
        next = steps.next();
    }
    return next.value;
}

function* parseCompositeArgumentsSteps(argv: readonly string[]): Generator<void, string[] | ImageMagickCliResult, void> {
    let cooperativeWork = 63;
    const options: string[] = [];
    const operands: string[] = [];
    for (let i = 0; i < argv.length; i++) {
        if (++cooperativeWork % 64 === 0)
            yield;
        const t = argv[i]!;
        if (t === "-gravity" || t === "-geometry" || t === "-compose" || t === "-background" || t === "-quality" || t === "-define" || t === "-resize" || t === "-rotate" || t === "-fuzz") {
            options.push(t, argv[++i] ?? "");
        }
        else if (t === "-tile" || t === "+tile") {
            options.push("-define", `compose:tile=${t === "-tile"}`);
        }
        else if (t === "-dissolve") {
            options.push("-define", `compose:args=${argv[++i] ?? "100"}`, "-compose", "Dissolve");
        }
        else if (t === "-watermark") {
            options.push("-define", `compose:args=${argv[++i] ?? "50"}`, "-compose", "Modulate");
        }
        else if (t === "-blend") {
            options.push("-define", `compose:args=${argv[++i] ?? "50"}`, "-compose", "Blend");
        }
        else if (t !== "-" && t.startsWith("-")) {
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
    return [base, overlay, ...operands.slice(2, -1), ...options, "-composite", out];
}
function* runCompositeCliSteps(argv: readonly string[], files: Map<string, Uint8Array>, stdinBytes?: Uint8Array, signal?: AbortSignal): Generator<void, ImageMagickCliResult, void> {
    const parsed = yield* parseCompositeArgumentsSteps(argv);
    return Array.isArray(parsed) ? yield* runConvertCliSteps(parsed, files, stdinBytes, signal) : parsed;
}
async function probeImageArguments(argv: readonly string[], files: ConvertFileInput, stdinBytes: Uint8Array | undefined, active: AbortSignal): Promise<void> {
    // Preserve input admission and read failures before the legacy missing-operand diagnostic.
    await withImageInputs(files, stdinBytes, active, async read => {
        const inspect = async (source: ImageByteSource) => {
            for (let position = 0; position < source.size; position += 16384) {
                await yieldTurn(active);
                await source.read(position, Math.min(16384, source.size - position), { signal: active });
            }
        };
        let operandsOnly = false;
        for (let index = 0; index < argv.length; index++) {
            await yieldTurn(active);
            const token = argv[index]!;
            if (!operandsOnly && token === "--") { operandsOnly = true; continue; }
            if (token === "-" || token.endsWith(":-")) { if (index < argv.length - 1) await read("-", inspect); continue; }
            if (!operandsOnly && (token.startsWith("-") || token.startsWith("+") || token === "(" || token === ")")) continue;
            let path = parseInputToken(token.toLowerCase().startsWith("tile:") ? token.slice(5) : token).baseToken;
            const colon = path.indexOf(":"); if (colon > 0 && extToImageFormat(path.slice(0, colon))) path = path.slice(colon + 1);
            await read(path, inspect);
        }
    });
}
export async function runCompositeCli(argv: readonly string[], files: Map<string, Uint8Array> | ConvertFileInput, stdinBytes?: Uint8Array, signal?: AbortSignal): Promise<ImageMagickCliResult> {
    if (files instanceof Map) return drainSteps(runCompositeCliSteps(argv, files, stdinBytes, signal), signal);
    const active = signal ?? new AbortController().signal, parsed = await drainSteps(parseCompositeArgumentsSteps(argv), active);
    if (Array.isArray(parsed)) return runConvertCli(parsed, files, stdinBytes, active);
    await probeImageArguments(argv, files, stdinBytes, active);
    if (files.stderr && parsed.stderr) { await writeIdentifyText(files.stderr, parsed.stderr, active); return { ...parsed, stderr: "" }; }
    return parsed;
}
export function runCompositeCliSync(argv: readonly string[], files: Map<string, Uint8Array>, stdinBytes?: Uint8Array, signal?: AbortSignal): ImageMagickCliResult {
    const steps = runCompositeCliSteps(argv, files, stdinBytes, signal);
    let next = steps.next();
    while (!next.done) {
        next = steps.next();
    }
    return next.value;
}


async function parseStoredCompareInput(token:string,state:MagickState,backend:CompareFileSession,signal:AbortSignal,readOptions:{source?:ImageByteSource|null|undefined;lastPage?:boolean;maxDecodeDimension?:number;visit?:(image:StoredRgbaImage)=>Promise<void>}={}):Promise<StoredRgbaImage|undefined>{
 const {baseToken,pageSpec,inlineGeom}=parseInputToken(token),lower=baseToken.toLowerCase();let image:StoredRgbaImage|undefined;
 if(lower.startsWith("tile:")){
  if(!state.hasSize)throw new Error("must specify image size for TILE input");
  if(readOptions.visit){
   await parseStoredCompareInput(baseToken.slice(5),state,backend,signal,{source:readOptions.source,visit:async pattern=>{image=await finish(await tile(pattern));await readOptions.visit!(image);}});
   return image;
  }
  const pattern=await parseStoredCompareInput(baseToken.slice(5),state,backend,signal,{source:readOptions.source,lastPage:readOptions.lastPage===true});if(!pattern)return;
  image=await tile(pattern);
 }else if(lower.startsWith("ftxt:")){
  if(!state.hasSize)throw new Error("must specify image size for FTXT input");
  const consume=async(source:ImageByteSource)=>{
   const steps=ftxtInput(state.sizeWidth,state.sizeHeight,source.size);
   let next=steps.next(),position=0,size=0,written=0;
   while(!next.done){
    await yieldTurn(signal);
    if(next.value instanceof Uint8Array){
     if(size===0){size=next.value.length+state.sizeWidth*state.sizeHeight*6;position=backend.storage.allocate(size);}
     await backend.storage.write(position+written,next.value);written+=next.value.length;
     next=steps.next(new Uint8Array());
    }else next=steps.next(await source.read(next.value.position,next.value.length,{signal}));
   }
   return parseStoredCompareInput(`ppm:${token.slice(5)}`,state,backend,signal,{...readOptions,source:{size,async read(offset,length){return backend.storage.read(position+offset,length);}}});
  };
  return readOptions.source===null?undefined:readOptions.source?consume(readOptions.source):backend.read(baseToken.slice(5),consume);
 }else if(lower.startsWith("rgb:")){
  if(!state.hasSize)throw new Error("must specify image size for RGB input");
  const path=baseToken.slice(4);
  const consume=async(source:ImageByteSource)=>{
   const raw=rawRgbInput(state.sizeWidth,state.sizeHeight,state.inputDepth??16,state.inputEndian??"lsb",source.size);
   return parseStoredCompareInput(`ppm:${token.slice(4)}`,state,backend,signal,{...readOptions,source:{size:raw.size,async read(position,length){
    const steps=raw.read(position,length);let next=steps.next();
    while(!next.done)next=steps.next(await source.read(next.value.position,next.value.length,{signal}));
    return next.value;
   }}});
  };
  return readOptions.source===null?undefined:readOptions.source?consume(readOptions.source):backend.read(path,consume);
 }else if(lower.startsWith("hald:")){
  const metadata=haldInputMetadata(baseToken);
  image=await transformStoredMagickRaster({...metadata,position:0},backend,haldInputPixelSteps(metadata.width),signal);
 }else if(lower.startsWith("xc:")||lower.startsWith("canvas:")||lower==="null:"){
  const color=lower==="null:"?{r:0,g:0,b:0,a:0}:parseColor(baseToken.slice(baseToken.indexOf(":")+1)||"white"),width=lower==="null:"?1:state.sizeWidth,height=lower==="null:"?1:state.sizeHeight;
  image={...await createStoredCanvas(width,height,color,backend,signal),hasAlpha:color.a<255,...(lower==="null:"?{[magickInput]:{filePath:"null:"}}:{})};
 }else if(lower.startsWith("plasma:")){
  const spec=baseToken.slice(7),fractal=spec.toLowerCase()==="fractal",[first,last]=fractal?[]:spec.split("-");
  const metadata={width:state.sizeWidth,height:state.sizeHeight,format:"png" as const,channels:3 as const,depth:"ushort" as const,space:"srgb" as const,density:72,hasAlpha:false};
  image=await transformStoredMagickRaster({...metadata,position:0},backend,plasmaPixelSteps(metadata.width,metadata.height,parseColor(first||(fractal?"#808080":"white")),parseColor(last||"black"),fractal,state.seed??0),signal);
 }else if(lower.startsWith("gradient:")||lower.startsWith("radial-gradient:")||lower.startsWith("pattern:")){
  const pattern=lower.startsWith("pattern:")?builtinPattern(baseToken.slice(8)):undefined;
  const width=Math.max(1,Math.round(pattern&&!state.hasSize&&lower.startsWith("pattern:")?pattern.width:state.sizeWidth)),height=Math.max(1,Math.round(pattern&&!state.hasSize&&lower.startsWith("pattern:")?pattern.height:state.sizeHeight)),position=backend.storage.allocate(width*height*4);
  const checker=!!pattern,radial=lower.startsWith("radial-gradient:");
  const storedData16=checker?undefined:{position:backend.storage.allocate(width*height*8),length:width*height*4};
  const [first,last]=baseToken.slice(baseToken.indexOf(":")+1).split("-"),a=parseColor(checker?"white":first||"#ffffff"),b=parseColor(checker?"black":last||"#000000");
  const cx=state.gradientCenter?.x??(width-1)/2,cy=state.gradientCenter?.y??(height-1)/2,axes=gradientRadii(width,height,state.gradientExtent,state.gradientRadii),box=state.gradientBoundingBox;
  const projection=gradientProjection(width,height,state.gradientDirection,state.gradientAngle);
  const vectorFactor=gradientVector(width,height,(radial&&state.gradientCenter)?undefined:radial||state.gradientAngle===undefined?state.gradientVector:undefined,radial,axes);
  for(let start=0;start<width*height;start+=4096){
   if(start%262144===0)await yieldTurn(signal);
   const count=Math.min(4096,width*height-start),bytes=new Uint8Array(count*4),samples=checker?undefined:new Uint16Array(count*4);
   for(let i=0;i<count;i++){
    const x=(start+i)%width,y=Math.floor((start+i)/width),offset=i*4;
    if(pattern){const cell=pattern.gray(x,y);bytes[offset]=cell;bytes[offset+1]=cell;bytes[offset+2]=cell;bytes[offset+3]=255;}
    else{const outside=box&&(x<box.x||y<box.y||x>=box.x+(box.width??width)||y>=box.y+(box.height??height));const t=outside?0:vectorFactor?vectorFactor(x,y):radial?Math.min(1,Math.hypot((x-cx)/axes[0],(y-cy)/axes[1])):Math.max(0,Math.min(1,projection.offset+x*projection.x+y*projection.y));writeGradientPixel(bytes,samples!,offset,a,b,t);}
   }
   await backend.storage.write(position+start*4,bytes);
   if(storedData16&&samples)await backend.storage.write(storedData16.position+start*8,new Uint8Array(samples.buffer));
  }
  image={position,width,height,...(storedData16?{storedData16}:{}),format:"png",channels:4,depth:"uchar",space:"srgb",density:72,hasAlpha:checker||a.a<255||b.a<255};
 }else if(lower.startsWith("label:")||lower.startsWith("caption:")){
  image=await decodeStoredMagickSvg(createLabelSvg(baseToken.slice(baseToken.indexOf(":")+1),state),state.density,backend,signal);
 }else{
  const generated=await drainSteps(parseInputOperandSteps(baseToken,new Map(),state),signal);
  if(generated)image=await backend.retain(generated);
  else{
   if (lower.startsWith("apng:")) {
    const path = baseToken.slice(5);
    const consume = async (source: ImageByteSource) => {
     const frames: StoredRgbaImage[] = [];
     await readApng(source, backend.storage, signal, async (frame, index) => {
      frames.push(Object.assign(frame, { [magickInput]: { filePath: path, byteLen: source.size, originalWidth: frame.width, originalHeight: frame.height, sceneIdx: index } }));
     });
     for (const page of selectedInputPages(pageSpec, frames.length)) {
      image = await finish(frames[page]!);
      await readOptions.visit?.(image);
      if (!readOptions.visit && !readOptions.lastPage) break;
     }
    };
    if (readOptions.source) await consume(readOptions.source);
    else if (readOptions.source !== null) await backend.read(path, consume);
    return image;
   }
   let path=baseToken;const colon=path.indexOf(":");if(colon>0&&extToImageFormat(path.slice(0,colon)))path=path.slice(colon+1);
   if(readOptions.visit){
    await backend.load(path,function*(metadata){const total=metadata?.pages&&metadata.pages>1?metadata.pages:1;const maxDecodeDimension=inferMaxDecodeDimensionFromUpcomingTokens([],0,inlineGeom)??readOptions.maxDecodeDimension;for(const page of selectedInputPages(pageSpec,total))yield {coalesce:false,density:state.density,...(total>1||pageSpec!==undefined?{page}:{}),...(maxDecodeDimension===undefined?{}:{maxDecodeDimension})};},async(frame,configured,metadata,byteLength)=>{image=await finish(Object.assign(frame,{[magickInput]:{filePath:path,byteLen:byteLength,originalWidth:metadata?.width??frame.width,originalHeight:metadata?.height??frame.height,sceneIdx:configured.page??0}}));await readOptions.visit!(image);},readOptions.source);
    return image;
   }
   image=await backend.load(path,metadata=>{const total=metadata?.pages&&metadata.pages>1?metadata.pages:1,pages=selectedInputPages(pageSpec,total);let page=pages.next().value??0;if(readOptions.lastPage){for(const selected of pages)page=selected;}pages.return(undefined);const maxDecodeDimension=inferMaxDecodeDimensionFromUpcomingTokens([],0,inlineGeom)??readOptions.maxDecodeDimension;return {coalesce:false,density:state.density,...(total>1||pageSpec!==undefined?{page}:{}),...(maxDecodeDimension===undefined?{}:{maxDecodeDimension})};},undefined,readOptions.source);
  }
 }
 if(image){image=await finish(image);await readOptions.visit?.(image);}
 return image;
 async function tile(pattern:StoredRgbaImage):Promise<StoredRgbaImage>{
  const width=state.sizeWidth,height=state.sizeHeight,position=backend.storage.allocate(width*height*4);
  const {x:offsetX,y:offsetY}=state.tileOffset??{x:0,y:0};
  let cachedPosition=-1,cached:Uint8Array=new Uint8Array();
  for(let start=0;start<width*height;start+=4096){
   if(start%262144===0)await yieldTurn(signal);
   const count=Math.min(4096,width*height-start),bytes=new Uint8Array(count*4);
   for(let offset=0;offset<count;){
    const x=(start+offset)%width,y=Math.floor((start+offset)/width),sx=x-offsetX,sy=y-offsetY;
    if(sx<0||sy<0||sx>=width||sy>=height){offset+=Math.min(count-offset,width-x,sx<0?-sx:width-x);continue;}
    const px=sx%pattern.width,py=sy%pattern.height,blockX=Math.floor(px/4096)*4096;
    const sourcePosition=pattern.position+(py*pattern.width+blockX)*4;
    if(cachedPosition!==sourcePosition){cached=await backend.storage.read(sourcePosition,Math.min(4096,pattern.width-blockX)*4);cachedPosition=sourcePosition;}
    const sourceOffset=px-blockX,take=Math.min(count-offset,width-x,width-sx,pattern.width-px,cached.length/4-sourceOffset);
    bytes.set(cached.subarray(sourceOffset*4,(sourceOffset+take)*4),offset*4);offset+=take;
   }
   await backend.storage.write(position+start*4,bytes);
  }
  return {position,width,height,format:"png",channels:4,depth:"uchar",space:"srgb",density:72,hasAlpha:pattern.hasAlpha||offsetX!==0||offsetY!==0};

 }
 async function finish(image:StoredRgbaImage):Promise<StoredRgbaImage>{
  if(state.page!==undefined)image={...image,virtualCanvas:state.page};
  if(state.orientation!==undefined)image={...image,orientation:state.orientation};
  if(state.units!==undefined)image=applyMagickUnits(image,state.units);
 for (const key of ["comment", "label"] as const) {
  const value = state[key];
  if (value !== undefined) {
   const expanded = await formatRetainedIdentify(value, image, { filePath: baseToken }, async () => ({ image, storage: backend.storage }), signal);
   image = { ...image, properties: { ...image.properties, [key]: expanded } };
  }
 }
 if(state.disposal!==undefined)image={...image,disposal:state.disposal};
 if (state.delay !== undefined) {
  const delay = state.delay, original = image;
  image = { ...image, storedDelay: {
   length: original.storedDelay?.length ?? original.delay?.length ?? 1,
   async at(scene, options) {
    const current = await original.storedDelay?.at(scene, options) ?? original.delay?.[scene] ?? 0;
    return parseDelay(delay, current);
   },
  } };
 }
 if(inlineGeom){const geometry=parseMagickGeometry(inlineGeom);if(geometry.hasOffset){const area=magickCropArea(image,inlineGeom,"northwest");if(area===null)image={...await createStoredCanvas(1,1,{r:255,g:255,b:255,a:0},backend,signal),...(image.delay?{delay:image.delay}:{}),...(image.storedDelay?{storedDelay:image.storedDelay}:{}),...((image as StoredMagickImage)[magickInput]?{[magickInput]:(image as StoredMagickImage)[magickInput]}:{}),virtualCanvas:{...magickCropCanvas(image,0,0),x:-1,y:-1}};else if(area)image={...await transformStoredImage(image,backend.storage,{kind:"extract",...area},signal),virtualCanvas:magickCropCanvas(image,area.left,area.top)};}else{const resize=magickResizeOptions(image,inlineGeom,state.kernel);if(resize)image=await resizeStoredMagickImage(image,backend,resize,signal,false,false,false,state.resizeFilter);}}
 return image;
 }
}

function* runCompareCliSteps(argv: readonly string[], files: Map<string, Uint8Array>, stdinBytes?: Uint8Array, signal?: AbortSignal,backend?:CompareFileSession): Generator<IdentifyStep, ImageMagickCliResult, void> {
    const listRes = tryHandleMagickListOption(argv);
    if (listRes) return listRes;
    let cooperativeWork = 63;
    const state = createDefaultState();
    state.fuzz = 0;
    let pngColorType: string | undefined;
    let channels: number[] | undefined;
    let metric = "rmse";
    let phashColorspaces = ["xyy", "hsb"];
    let phashNormalize = false;
    let precision = 6;
    let metricExplicit = false;
    let subimageSearch = false;
    let similarityThreshold = -1;
    let dissimilarityThreshold = 0.2;
    let ssimRadius = 5;
    let ssimSigma = 1.5;
    let highlightColor: RgbaColor | undefined;
    let lowlightColor: RgbaColor | undefined;
    let colorWarnings = "";
    let quiet = false;
    let verbose = false;
    let regardWarnings = false;
    let compose = "over";
    const operands: string[] = [];
    for (let i = 0; i < argv.length; i++) {
        if (++cooperativeWork % 64 === 0)
            yield;
        const t = argv[i]!;
        if (t === "--help" || t === "-help" || t === "-h") {
            return {
                exitCode: 0,
                stdout: "Usage: compare [-metric AE|MAE|MEPP|MSE|RMSE|Fuzz|PSNR|SSIM|PAE|NCC|DPC|PHASH] [-fuzz value%] [-highlight-color color] [-lowlight-color color] reference.png candidate.png diff.png\n",
                stderr: ""
            };
        }
        else if (t === "-quiet" || t === "+quiet") quiet = t === "-quiet";
        else if (t === "-verbose" || t === "+verbose") verbose = t === "-verbose";
        else if (t === "-regard-warnings" || t === "+regard-warnings") regardWarnings = t === "-regard-warnings";
        else if (t === "-subimage-search" || t === "+subimage-search") {
            subimageSearch = t === "-subimage-search";
        }
        else if (t === "-define") {
            const definition = argv[++i];
            if (definition === undefined) return { exitCode: 2, stdout: "", stderr: "compare: missing an argument for option '-define'\n" };
            const [key, value] = definition.split("=");
            if (key?.toLowerCase() === "png:color-type") pngColorType = value;
            else if (key?.toLowerCase() === "compare:ssim-radius") ssimRadius = Number.parseFloat(value ?? "") || 0;
            else if (key?.toLowerCase() === "compare:ssim-sigma") ssimSigma = Number.parseFloat(value ?? "") || 0;
            else if (key?.toLowerCase() === "phash:normalize") phashNormalize = ["true", "yes", "on", "1"].includes(value?.toLowerCase() ?? "");
            else if (key?.toLowerCase() === "phash:colorspaces") {
                phashColorspaces = (value ?? "").toLowerCase().split(",").slice(0, 6).map(space => space.trim());
                if (phashColorspaces.some(space => !["rgb", "srgb", "xyy", "hsb"].includes(space)))
                    return { exitCode: 2, stdout: "", stderr: `compare: unsupported PHASH colorspaces '${value ?? ""}'\n` };
            }
        }
        else if (t === "-format") {
            state.formatStr = argv[++i];
            if (state.formatStr === undefined) return { exitCode: 2, stdout: "", stderr: "compare: missing an argument for option '-format'\n" };
        }
        else if (t === "-channel") {
            const value = argv[++i] ?? "";
            const names: Record<string, readonly number[]> = {
                red: [0], green: [1], blue: [2], alpha: [3], opacity: [3],
                all: [0, 1, 2, 3], default: [0, 1, 2, 3]
            };
            channels = [];
            for (const part of value.toLowerCase().split(",")) {
                const token = part.trim();
                const selected = Object.hasOwn(names, token) ? names[token] : (token.length > 0 && [...token].every(c => "rgba".includes(c))
                    ? [...token].map(c => "rgba".indexOf(c)) : undefined);
                if (!selected) return { exitCode: 2, stdout: "", stderr: `compare: invalid argument for option '-channel': ${value}\n` };
                for (const channel of selected) if (!channels.includes(channel)) channels.push(channel);
            }
        }
        else if (t === "+channel") {
            channels = undefined;
        }
        else if (t === "-precision") {
            const value = argv[++i];
            if (value === undefined) return { exitCode: 2, stdout: "", stderr: "compare: missing an argument for option '-precision'\n" };
            const requested = Number(value);
            if (value.trim() === "" || !Number.isFinite(requested)) return { exitCode: 2, stdout: "", stderr: `compare: invalid argument for option '-precision': ${value}\n` };
            precision = requested < 1 ? 6 : Math.min(100, Math.trunc(requested));
        }
        else if (t === "-metric") {
            const rawMetric = argv[++i] ?? "rmse";
            metric = rawMetric.toLowerCase();
            metricExplicit = metric !== "undefined";
            if (!metricExplicit) metric = "rmse";
            if (!["ae", "mae", "mepp", "mse", "rmse", "fuzz", "pae", "psnr", "ssim", "dssim", "ncc", "dpc", "pdc", "phase", "phash"].includes(metric)) {
                return { exitCode: 2, stdout: "", stderr: `compare: unrecognized metric type '${rawMetric}'\n` };
            }
        }
        else if (t === "-fuzz") {
            const rawFuzz = argv[++i] ?? "";
            const value = rawFuzz.endsWith("%") ? rawFuzz.slice(0, -1) : rawFuzz;
            const fuzz = Number(value);
            if (value.trim() === "" || !Number.isFinite(fuzz)) {
                return { exitCode: 2, stdout: "", stderr: `compare: invalid argument for option '-fuzz': ${rawFuzz}\n` };
            }
            state.fuzz = rawFuzz.endsWith("%")
                ? (fuzz / 100) * 255
                : fuzz / 257;
        }
        else if (t === "-highlight-color" || t === "-lowlight-color") {
            const value = argv[++i] ?? (t === "-highlight-color" ? "#f1001e" : "#ffffff");
            let color: RgbaColor;
            try {
                color = parseColor(value);
            } catch {
                colorWarnings += `compare: unrecognized color \`${value}'\n`;
                color = { r: 0, g: 0, b: 0, a: 255 };
            }
            if (t === "-highlight-color") highlightColor = color;
            else lowlightColor = color;
        }
        else if (t === "-compose") {
            const rawCompose = argv[++i] ?? "";
            const cm = rawCompose.trim().toLowerCase().split("-").join("").split("_").join("");
            // ImageMagick compose names, including legacy aliases and our Source alias.
            if (![
                "atop", "blend", "blur", "bumpmap", "changemask", "clear", "colorburn", "colordodge", "colorize",
                "copyalpha", "copyblack", "copyblue", "copy", "copycyan", "copygreen", "copymagenta", "copyred", "copyyellow",
                "darken", "darkenintensity", "difference", "displace", "dissolve", "distort", "dividedst", "dividesrc",
                "dstatop", "dst", "dstin", "dstout", "dstover", "exclusion", "freeze", "hardlight", "hardmix", "hue", "in",
                "intensity", "interpolate", "lightenintensity", "lighten", "linearburn", "lineardodge", "linearlight", "luminize",
                "mathematics", "minusdst", "minussrc", "modulate", "modulusadd", "modulussubtract", "multiply", "negate", "none",
                "out", "overlay", "over", "pegtoplight", "pinlight", "plus", "reflect", "replace", "rmse", "saturate", "screen",
                "saliencyblend", "seamlessblend", "softburn", "softdodge", "softlight", "srcatop", "srcin", "srcout", "srcover",
                "src", "stamp", "stereo", "vividlight", "xor", "copyopacity", "add", "subtract", "minus", "divide", "undefined", "source"
            ].includes(cm)) {
                return { exitCode: 2, stdout: "", stderr: `compare: unrecognized compose operator '${rawCompose}'\n` };
            }
            compose = cm;
        }
        else if (t === "-dissimilarity-threshold" || t === "-similarity-threshold") {
            const rawThreshold = argv[++i] ?? "";
            const value = rawThreshold.endsWith("%") ? rawThreshold.slice(0, -1) : rawThreshold;
            if (value.trim() === "" || !Number.isFinite(Number(value))) {
                return { exitCode: 2, stdout: "", stderr: `compare: invalid argument for option '${t}': ${rawThreshold}\n` };
            }
            const threshold = Number(value) / (rawThreshold.endsWith("%") ? 100 : 1);
            if (t === "-similarity-threshold") similarityThreshold = threshold;
            else dissimilarityThreshold = threshold;
        }
        else if (t === "-density") {
            const g = parseMagickGeometry(argv[++i] ?? "72");
            state.density = Math.max(1, Math.round(g.width ?? 72));
        }
        else if (t === "-quality") {
            state.quality = Math.max(1, Math.min(100, Number(argv[++i] ?? 92)));
        }
        else if (t.startsWith("-") && t.length > 1) {
            return { exitCode: 2, stdout: "", stderr: `compare: unrecognized option '${t}'\n` };
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
    const outSpec = operands[operands.length - 1]!;
    let imgA: RgbaImage | StoredRgbaImage | undefined;
    let imgB: RgbaImage | StoredRgbaImage | undefined;
    let inputErrors = "";
    let imageDetails = "";
    // Compare consumes the first two images in the combined input sequence.
    for (const operand of operands.slice(0, -1)) {
        try {
            let found = false;
            if (backend) yield { async run() {
                await parseStoredCompareInput(operand, state, backend, signal!, { visit: async image => {
                    found = true;
                    if (verbose) imageDetails += `${operand} ${image.format.toUpperCase()} ${image.width}x${image.height}\n`;
                    if (!imgA) imgA = image;
                    else if (!imgB) imgB = image;
                } });
            } };
            else {
                const images = yield* parseInputOperandsSteps(operand, files, state, stdinBytes);
                found = Boolean(images?.length);
                for (const image of images ?? []) {
                    if (verbose) imageDetails += `${operand} ${image.format.toUpperCase()} ${image.width}x${image.height}\n`;
                    if (!imgA) imgA = image;
                    else if (!imgB) imgB = image;
                }
            }
            if (!found) inputErrors += `compare: unable to open image '${operand}': No such file or directory\n`;
            if (typeof (globalThis as { gc?: () => void }).gc === "function") { try { const gc = (globalThis as { gc?: () => void }).gc!; gc(); } catch { /* Collection is best-effort. */ } }
        }
        catch (err) {
            signal?.throwIfAborted();if(err instanceof CompareInputFailure)throw err.reason;
            inputErrors += `compare: improper image header: ${(err as Error).message}\n`;
        }
    }
    if (!imgA || !imgB) {
        return {
            exitCode: 2,
            stdout: "",
            stderr: inputErrors || "compare: missing an image filename\n"
        };
    }
    if (subimageSearch && (imgB.width > imgA.width || imgB.height > imgA.height))
        return { exitCode: 2, stdout: "", stderr: `compare: geometry does not contain image '${refSpec}'\n` };
    const width=Math.max(imgA.width,imgB.width),height=Math.max(imgA.height,imgB.height);
    const diff=outSpec.toLowerCase()!=="null:",diffPosition=backend&&diff?backend.storage.allocate(width*height*4):undefined;
    const diffData=!backend&&diff?new Uint8Array(width*height*4):undefined;
    const similarityPosition = backend && diff && subimageSearch ? backend.storage.allocate(width * height * 4) : undefined;
    const similarityData = !backend && diff && subimageSearch ? new Uint8Array(width * height * 4) : undefined;
    const composeSrc = ["src", "source", "copy"].includes(compose);
    const comparison=compareImageSteps(imgA,imgB,{metric,precision,ssimRadius,ssimSigma,phashColorspaces,phashNormalize,...(channels ? { channels } : {}),subimageSearch,similarityThreshold,fuzz:state.fuzz,highlightColor:highlightColor ?? {r:241,g:0,b:30,a:204},composeSrc,diff,...(lowlightColor?{lowlightColor}:{}),
        ...(!composeSrc && compose !== "over" && compose !== "srcover" ? { compose: function* (reference: Uint8Array, overlay: Uint8Array) {
            const canvas: RgbaImage = { width: reference.length / 4, height: 1, format: "png", channels: 4, depth: "uchar", density: state.density, space: "srgb", hasAlpha: true, data: new Uint8Array(reference.length).fill(255) };
            // Compare first composites the reference onto white, then makes that
            // canvas opaque before applying the highlight/lowlight overlay.
            const base = yield* applyMagickCompositeLayerSteps(canvas, { ...canvas, data: reference }, compose, 0, 0, undefined, signal);
            for (let i = 3; i < base.data.length; i += 4) base.data[i] = 255;
            return (yield* applyMagickCompositeLayerSteps(base, { ...canvas, data: overlay }, compose, 0, 0, undefined, signal)).data;
        } } : {})
    });
    let compared=comparison.next();
    try{while(!compared.done){const request=compared.value;
      if(!request){yield;compared=comparison.next();}
      else if (request.kind === "read") {
          const image = request.image === 0 ? imgA : imgB;
          let samples!: Uint8Array | Float64Array;
          if ("data" in image) {
              samples = image.data16
                  ? Float64Array.from(image.data16.subarray(request.position, request.position + request.length), value => value / 257)
                  : image.data.subarray(request.position, request.position + request.length);
          } else yield { async run() {
              if (image.storedData16) {
                  const bytes = await backend!.storage.read(image.storedData16.position + request.position * 2, request.length * 2);
                  samples = Float64Array.from(new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2), value => value / 257);
              } else samples = await backend!.storage.read(image.position + request.position, request.length);
          } };
          compared = comparison.next(samples);
      }
      else {
          const position = request.kind === "similarity" ? similarityPosition : diffPosition;
          const data = request.kind === "similarity" ? similarityData : diffData;
          if (backend) yield { async run() { await backend.storage.write(position! + request.position, request.data); } };
          else data!.set(request.data, request.position);
          compared = comparison.next();
      }
    }}finally{comparison.return(undefined as never);}
    const {metric:metricStr}=compared.value;
    const exitCode = inputErrors || (regardWarnings && colorWarnings) ? 2 : compared.value.exitCode;
    const searchScore = metric === "ssim" || metric === "ncc" || metric === "dpc" || metric === "phase" ? 1 - 2 * compared.value.distortion : compared.value.distortion;
    // Native UndefinedErrorMetric prints RMSE but uses the opposite warning comparison.
    const diagnostics = verbose
        ? imageDetails + `Image: ${refSpec}\n  Channel distortion: ${metricExplicit ? metric.toUpperCase() : "Undefined"}\n`
            + (metricExplicit ? `    all: ${metricStr}\n` : "")
            + `${refSpec}=>${outSpec} ${inferOutputFormat(outSpec, "png").format.toUpperCase()} ${width}x${height}\n`
        : `${metricStr}\n`;
    const comparisonStderr = inputErrors + diagnostics + (quiet ? "" : colorWarnings) + (subimageSearch && (metricExplicit ? searchScore > dissimilarityThreshold : searchScore < dissimilarityThreshold)
        ? `compare: images too dissimilar '${refSpec}'\n` : "");
    let stdout = "";
    if (state.formatStr !== undefined) {
        const image = { ...imgA, properties: { ...imgA.properties, distortion: formatMetricNum(compared.value.distortion) } };
        const context = { filePath: parseInputToken(refSpec).baseToken };
        if ("data" in image) stdout = yield* formatMagickPropertyStringSteps(state.formatStr, image, () => image, context);
        else yield { async run() {
            stdout = await formatRetainedIdentify(state.formatStr!, image, context, async () => ({ image, storage: backend!.storage }), signal);
        } };
    }
    if("data" in imgA)detachRgbaBuffer(imgA.data);if("data" in imgB)detachRgbaBuffer(imgB.data);
    if (diff) {
        const { format, path, pngCoder, bmpFormat, gifVersion, tiffBig } = inferOutputFormat(outSpec, "png");
        const pngWarnings = { warnings: "" };
        const colorType = pngOutputColorType(pngColorType, format, pngWarnings);
        const opaque = colorType === 0 || colorType === 2;
        const metadata = { width, height, format: "png" as const, channels: opaque ? 3 as const : 4 as const, depth: "uchar" as const, density: state.density, space: "srgb" as const, hasAlpha: !opaque };
        const encoding = { format, pngCoder, gifVersion, tiffBig, bmpFormat: bmpFormat ?? state.bmpFormat ?? "bmp4" as const, ...(state.bmpSubtype === undefined ? {} : { bmpSubtype: state.bmpSubtype }), pngColorType: colorType, ...(opaque ? { forceOpaque: true } : {}), chromaSubsampling: state.quality < 90 ? "4:2:0" as const : "4:4:4" as const, webpExact: state.webpExact ?? false, smartSubsample: state.webpSmartSubsample ?? false, alphaCompression: state.webpAlphaCompression ?? 1, alphaQuality: state.webpAlphaQuality ?? 100, quality: state.quality, ...(format === "webp" ? { effort: state.webpMethod ?? 4, lossless: state.webpLossless ?? state.quality >= 100 } : {}) };
        const split = hasSceneOutputPattern(path) || (subimageSearch && !["gif", "miff", "tiff"].includes(format));
        let stdoutBytes: Uint8Array | undefined;
        const stdoutChunks: Uint8Array[] = [];
        if (backend) yield { async run() {
            const active = signal ?? new AbortController().signal;
            const stack = new StoredImageStack(backend.storage, active);
            await stack.push({ ...metadata, position: diffPosition! });
            if (similarityPosition !== undefined) await stack.push({ ...metadata, position: similarityPosition });
            if (split) {
                for (let index = 0; index < stack.length; index++) {
                    const bytes = await backend.stage((await stack.get(index))!, path === "-" ? path : formatSceneOutputPath(path, index), encoding);
                    if (bytes) stdoutChunks.push(bytes);
                }
                await backend.publishPending();
            } else {
                let image = (await stack.get(0))!;
                if (subimageSearch && format === "miff") image = prepareStoredMiffPages(stack, image, backend, active);
                if (subimageSearch && format === "tiff") image = prepareStoredTiffPages(stack, image, backend, active);
                if (subimageSearch && format === "gif") image = await prepareStoredGifFrames(stack, backend, active);
                stdoutBytes = await backend.publish(image, path.replaceAll("%%", "%"), { ...encoding, ...(image.pageHeight === undefined ? {} : { pageHeight: image.pageHeight }) });
            }
        } };
        else {
            const stack: RgbaImage[] = [{ ...metadata, data: diffData! }];
            if (similarityData) stack.push({ ...metadata, data: similarityData });
            if (split) {
                for (let index = 0; index < stack.length; index++) {
                    const { data } = encodeImage(stack[index]!, encoding);
                    if (path === "-") stdoutChunks.push(data);
                    else files.set(formatSceneOutputPath(path, index), data);
                }
            } else {
                let image = stack[0]!;
                if (subimageSearch && format === "miff") image = yield* prepareMiffPages(stack);
                if (subimageSearch && format === "tiff") image = yield* prepareTiffPages(stack);
                if (subimageSearch && format === "gif") image = yield* prepareGifFrames(stack);
                const { data } = encodeImage({ ...(image), ...(format === "gif" && state.backgroundExplicit ? { backgroundColor: state.background } : {}) }, { ...encoding, ...(image.pageHeight === undefined ? {} : { pageHeight: image.pageHeight }) });
                if (path === "-") stdoutBytes = data;
                else files.set(path.replaceAll("%%", "%"), data);
                detachRgbaBuffer(image.data);
            }
            for (const image of stack) detachRgbaBuffer(image.data);
        }
        if (stdoutChunks.length) {
            stdoutBytes = new Uint8Array(stdoutChunks.reduce((sum, bytes) => sum + bytes.length, 0));
            let position = 0;
            for (const bytes of stdoutChunks) { stdoutBytes.set(bytes, position); position += bytes.length; }
        }
        return { exitCode: regardWarnings && pngWarnings.warnings ? 2 : exitCode, stdout, stderr: comparisonStderr + (quiet ? "" : pngWarnings.warnings), ...(stdoutBytes ? { stdoutBytes } : {}) };
    }
    return {
        exitCode,
        stdout,
        stderr: comparisonStderr
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

interface MontageArguments {
    trim: boolean; shadow: boolean;
    orientations: ("flip" | "flop" | "transpose")[]; rotation: number; concatenate: boolean; state: MagickState; tileCols: number | undefined; tileRows: number | undefined; cellW: number | undefined; cellH: number | undefined;
    frame: { size: number; width: number; height: number; outer: number; inner: number } | undefined; matte: RgbaColor; padX: number; padY: number; borderW: number; operands: string[]; labels: string[]; geometry: string; thumbnail: string | undefined; title: string | undefined; texture: string | undefined;
}
function* parseMontageArguments(argv: readonly string[]): Generator<void, MontageArguments | ImageMagickCliResult, void> {
    let cooperativeWork = 63;
    const state = createDefaultState();
    state.gravity = "center";
    let tileCols: number | undefined;
    let tileRows: number | undefined;
    let cellW: number | undefined = 120;
    let cellH: number | undefined = 120;
    let geometry = "120x120>";
    let trim = false;
    let concatenate = false;
    let rotation = 0;
    const orientations: ("flip" | "flop" | "transpose")[] = [];
    let thumbnail: string | undefined;
    let title: string | undefined;
    let texture: string | undefined;
    let padX = 4;
    let padY = 3;
    let borderW = 0;
    let frame: MontageArguments["frame"];
    let shadow = false;
    let matte = parseColor("#bdbdbd");
    const operands: string[] = [];
    const labels: string[] = [];
    let label = "";
    for (let i = 0; i < argv.length; i++) {
        if (++cooperativeWork % 64 === 0)
            yield;
        const t = argv[i]!;
        if (t === "-tile") {
            const g = parseMagickGeometry(argv[++i] ?? "2x2");
            tileCols = g.width;
            tileRows = g.height;
        }
        else if (t === "-flip" || t === "-flop" || t === "-transpose") {
            orientations.push(t === "-flip" ? "flip" : t === "-flop" ? "flop" : "transpose");
        }
        else if (t === "-rotate") {
            rotation = parseMagickRotation(argv[++i] ?? "0").angle;
        }
        else if (t === "-trim") {
            trim = true;
        }
        else if (t === "-shadow" || t === "+shadow") {
            shadow = t === "-shadow";
        }
        else if (t === "-thumbnail") {
            thumbnail = argv[++i];
        }
        else if (t === "-geometry") {
            geometry = argv[++i] ?? "+2+2";
            const g = parseMagickGeometry(geometry);
            cellW = g.width;
            cellH = g.height;
            if (cellW !== undefined || cellH !== undefined) concatenate = false;
            if (g.hasOffset) {
                padX = Math.max(0, Math.round(g.x));
                padY = Math.max(0, Math.round(g.y));
            }
        }
        else if (t === "-background") {
            state.background = parseColor(argv[++i] ?? "#ffffff");
        }
        else if (t === "-texture") {
            texture = argv[++i];
            if (texture === undefined) return { exitCode: 1, stdout: "", stderr: "montage: missing argument for -texture\n" };
        }
        else if (t === "+texture") {
            texture = undefined;
        }
        else if (t === "-bordercolor") {
            state.borderColor = parseColor(argv[++i] ?? "#dfdfdf");
        }
        else if (t === "-border") {
            borderW = Math.max(0, Math.round(parseMagickGeometry(argv[++i] ?? "0").width ?? 0));
        }
        else if (t === "-gravity") {
            state.gravity = parseGravity(argv[++i] ?? "center");
        }
        else if (t === "-quality") {
            state.quality = Math.max(1, Math.min(100, Number(argv[++i] ?? 92)));
        }
        else if (t === "-label") {
            label = argv[++i] ?? "";
        }
        else if (t === "+label") {
            label = "";
        }
        else if (t === "-reverse") {
            operands.reverse();
            labels.reverse();
        }
        else if (t === "-duplicate" || t === "+duplicate") {
            if (!operands.length) return { exitCode: 1, stdout: "", stderr: `montage: no images found for operation ${t}\n` };
            let count = 1, spec = "-1";
            if (t === "-duplicate") {
                const value = argv[++i] ?? "", comma = value.indexOf(",");
                count = Number(comma < 0 ? value : value.slice(0, comma));
                if (!value || !Number.isSafeInteger(count)) return { exitCode: 1, stdout: "", stderr: `montage: invalid argument '${value}'\n` };
                spec = comma < 0 ? "-1" : value.slice(comma + 1) || "-1";
            }
            const length = operands.length;
            try {
                parseMagickIndices(spec);
                for (let repeat = 0; repeat < count; repeat++) {
                    for (const index of parseMagickIndexSpec(spec, length, "clone")) {
                        if (++cooperativeWork % 64 === 0) yield;
                        operands.push(operands[index]!);
                        labels.push(labels[index]!);
                    }
                }
            } catch (error) {
                return { exitCode: 1, stdout: "", stderr: `montage: ${(error as Error).message}\n` };
            }
        }
        else if (t === "-set") {
            const property = argv[++i];
            const value = argv[++i] ?? "";
            if (property === "label") labels.fill(value);
        }
        else if (t === "-pointsize") {
            state.pointsize = Math.max(1, Number(argv[++i] ?? 12));
        }
        else if (t === "-fill") {
            state.fill = parseColor(argv[++i] ?? "#000000");
        }
        else if (t === "-mattecolor") {
            matte = parseColor(argv[++i] ?? "#bdbdbd");
        }
        else if (t === "-frame") {
            const value = argv[++i];
            if (value === undefined) return { exitCode: 1, stdout: "", stderr: "montage: missing argument for -frame\n" };
            const g = parseMagickGeometry(value);
            const width = Math.max(0, Math.round(g.width ?? 0)), height = Math.max(0, Math.round(g.height ?? g.width ?? 0));
            frame = { size: Math.max(width, height), width, height, outer: g.x, inner: g.y };
        }
        else if (t === "+frame") {
            frame = undefined;
        }
        else if (t === "-mode") {
            const mode = (argv[++i] ?? "").toLowerCase();
            if (mode !== "frame" && mode !== "unframe" && mode !== "concatenate") {
                return { exitCode: 1, stdout: "", stderr: `montage: unrecognized image mode '${argv[i] ?? ""}'\n` };
            }
            frame = mode === "frame" ? { size: 15, width: 15, height: 15, outer: 3, inner: 3 } : undefined;
            shadow = !!frame;
            if (mode === "unframe") borderW = 0;
            if (mode === "concatenate") {
                concatenate = true;
                state.gravity = "northwest";
                cellW = cellH = undefined;
                padX = padY = borderW = 0;
            }
        }
        else if (t === "-title") {
            title = argv[++i] ?? "";
        }
        else if (t === "+title") {
            title = undefined;
        }
        else if (t === "-font") {
            const font = argv[++i];
            return { exitCode: 1, stdout: "", stderr: font === undefined
                ? "montage: missing argument for -font\n"
                : `montage: unsupported font '${font}'; only bundled bitmap glyphs are available\n` };
        }
        else if (t.length > 1 && (t.startsWith("-") || t.startsWith("+"))) {
            return { exitCode: 1, stdout: "", stderr: `montage: unrecognized option '${t}'\n` };
        }
        else {
            operands.push(t);
            labels.push(label);
        }
    }
    return { trim, shadow, orientations, rotation, concatenate, state, tileCols, tileRows, cellW, cellH, padX, padY, borderW, operands, labels, geometry, thumbnail, frame, matte, title, texture };
}
function montageTitleSvg(title: string, width: number, state: MagickState, padY: number): { svg: string; height: number } {
    // Montage doubles the title point size and reserves twice the normal line metrics.
    // Arial-compatible layout metrics; glyphs still use the portable bitmap renderer.
    const lineHeight = 2 * (Math.ceil(state.pointsize * 1854 / 2048) + Math.ceil(state.pointsize * 434 / 2048));
    const lines = title.split("\n");
    const height = lines.length * lineHeight + padY * 2;
    const text = lines.map((line, index) => `<text x="${width / 2}" y="${padY + index * lineHeight + Math.ceil(state.pointsize * 2 * 1854 / 2048)}" text-anchor="middle" font-size="${state.pointsize * 2}" fill="${rgbaToCss(state.fill)}">${escapeXml(line)}</text>`).join("");
    return { height, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${text}</svg>` };
}
function* runMontageCliSteps(argv: readonly string[], files: Map<string, Uint8Array>, stdinBytes?: Uint8Array, signal?: AbortSignal): Generator<void, ImageMagickCliResult, void> {
    let cooperativeWork = 63;
    const parsed = yield* parseMontageArguments(argv);
    if ("exitCode" in parsed) return parsed;
    const { trim, shadow, orientations, rotation, concatenate, state, tileCols, tileRows, cellW, cellH, padX, padY, borderW, operands, labels, geometry, thumbnail, frame, matte, title, texture } = parsed;
    const variableCells = !frame && cellW === undefined && cellH === undefined;
    if (operands.length < 2) {
        return {
            exitCode: 1,
            stdout: "",
            stderr: "montage: missing an image filename\n"
        };
    }
    let textureImage: RgbaImage | undefined;
    if (texture !== undefined) {
        try { textureImage = yield* parseInputOperandSteps(texture, files, state, stdinBytes); }
        catch (error) {
            return { exitCode: 1, stdout: "", stderr: `montage: improper image header '${texture}': ${(error as Error).message}\n` };
        }
        if (!textureImage) return { exitCode: 1, stdout: "", stderr: `montage: unable to open image '${texture}': No such file or directory\n` };
    }
    const outSpec = operands[operands.length - 1]!;
    const inPaths = operands.slice(0, -1);
    let inputErrors = "";
    const fastMetaDims: { width: number; height: number }[] = [];
    let canStreamTiles = !shadow && !trim && orientations.length === 0 && rotation === 0 && !frame && borderW === 0 && thumbnail === undefined && cellW === undefined && cellH === undefined && !labels.some(Boolean);
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

    const stdoutChunks: Uint8Array[] = [];
    function* writePage(canvas: RgbaImage, page: number, multiple: boolean): Generator<void, void, void> {
        if (title !== undefined) {
            const { svg, height } = montageTitleSvg(title, canvas.width, state, padY);
            const caption = decodeImage(new TextEncoder().encode(svg));
            const previous = canvas;
            canvas = yield* extendImageSteps(canvas, { top: height, bottom: 0, left: 0, right: 0, background: state.background, extendWith: "background" });
            detachRgbaBuffer(previous.data);
            yield* blitOverRgbaInPlaceSteps(canvas, caption, 0, 0);
            detachRgbaBuffer(caption.data);
        }
        if (!anyTransparent) {
            (canvas as { hasAlpha?: boolean; channels?: number }).hasAlpha = false;
            (canvas as { hasAlpha?: boolean; channels?: number }).channels = 3;
        }
        const { format, path, pngCoder, bmpFormat, gifVersion, tiffBig } = inferOutputFormat(outSpec, "png");
        const outPath = path === "-" ? path : multiple || hasSceneOutputPattern(path) ? formatSceneOutputPath(path, page) : path.replaceAll("%%", "%");
        if (typeof (globalThis as { gc?: () => void }).gc === "function") { try { const gc = (globalThis as { gc?: () => void }).gc!; gc(); gc(); } catch { /* Optional host GC hints must not interrupt image processing. */ } }
        const { data: encoded } = encodeImage(canvas, { format, pngCoder, gifVersion, tiffBig, bmpFormat: bmpFormat ?? state.bmpFormat ?? "bmp4", ...(state.bmpSubtype === undefined ? {} : { bmpSubtype: state.bmpSubtype }), pngPreserveColormap: state.pngPreserveColormap, pngBitDepth: state.pngBitDepth, ...(state.jpegRestartInterval === undefined ? {} : { jpegRestartInterval: state.jpegRestartInterval }), ...(state.jpegDctMethod === undefined ? {} : { jpegDctMethod: state.jpegDctMethod }), ...(state.jpegOptimizeCoding === undefined ? {} : { jpegOptimizeCoding: state.jpegOptimizeCoding }), ...(state.jpegArithmeticCoding === undefined ? {} : { jpegArithmeticCoding: state.jpegArithmeticCoding }), ...(state.jpegProgressive === undefined ? {} : { jpegProgressive: state.jpegProgressive }), pngInterlace: state.pngInterlace, gifInterlace: state.gifInterlace, transparentColor: state.transparentColor, chromaSubsampling: state.quality < 90 ? "4:2:0" : "4:4:4", webpExact: state.webpExact ?? false, smartSubsample: state.webpSmartSubsample ?? false, alphaCompression: state.webpAlphaCompression ?? 1, alphaQuality: state.webpAlphaQuality ?? 100, quality: state.quality, ...(format === "webp" ? { effort: state.webpMethod ?? 4, lossless: state.webpLossless ?? state.quality >= 100 } : {}), consumeInput: true } as any);
        detachRgbaBuffer(canvas.data);
        if (outPath === "-" || outSpec.endsWith(":-")) {
            stdoutChunks.push(encoded);
            return;
        }
        files.set(outPath, encoded);
    }
    let canvas: RgbaImage;
    let anyTransparent = state.background.a < 255 || (borderW > 0 && state.borderColor.a < 255);

    if (canStreamTiles && fastMetaDims.length === inPaths.length) {
        const n = fastMetaDims.length;
        const cols = tileCols ?? Math.ceil(n / (tileRows ?? Math.max(1, Math.floor(Math.sqrt(n)))));
        const rows = tileRows ?? Math.ceil(n / cols);
        const maxThumbW = Math.max(0, ...fastMetaDims.map((d) => d.width));
        const maxThumbH = Math.max(0, ...fastMetaDims.map((d) => d.height));
        const slotW = maxThumbW + padX * 2;
        const slotH = maxThumbH + padY * 2;
        for (let pageStart = 0; pageStart < n; pageStart += cols * rows) {
            const rowWidths: number[] = [], rowHeights: number[] = [];
            if (variableCells) for (let index = 0; index < Math.min(n - pageStart, cols * rows); index++) {
                if (++cooperativeWork % 64 === 0) yield;
                const row = Math.floor(index / cols), image = fastMetaDims[pageStart + index]!;
                rowWidths[row] = (rowWidths[row] ?? 0) + image.width + padX * 2;
                rowHeights[row] = Math.max(rowHeights[row] ?? 0, image.height + padY * 2);
            }
            const pageSize = Math.min(n - pageStart, cols * rows);
            if (variableCells && pageSize % cols) {
                rowWidths[Math.floor(pageSize / cols)]! += (cols - pageSize % cols) * (fastMetaDims[pageStart + pageSize - 1]!.width + padX * 2);
            }
            const canvasW = Math.max(1, variableCells ? Math.max(0, ...rowWidths) : cols * slotW);
            const canvasH = Math.max(1, variableCells ? rowHeights.reduce((sum, height) => sum + height, 0) : rows * slotH);
            let tileX = 0, tileY = 0;
                if (typeof (globalThis as { gc?: () => void }).gc === "function") { try { const gc = (globalThis as { gc?: () => void }).gc!; gc(); gc(); } catch { /* Optional host GC hints must not interrupt image processing. */ } }
            canvas = (yield* createSolidRgbaImageSteps(canvasW, canvasH, state.background));
            if (textureImage) for (let y = 0; y < canvasH; y += textureImage.height) {
                for (let x = 0; x < canvasW; x += textureImage.width) {
                    if (++cooperativeWork % 64 === 0) yield;
                    yield* blitOverRgbaInPlaceSteps(canvas, textureImage, x, y);
                }
            }
            for (let idx = pageStart; idx < pageStart + pageSize; idx++) {
                const col = (idx - pageStart) % cols;
                const row = Math.floor((idx - pageStart) / cols);
                const p = inPaths[idx]!;
                const effW = fastMetaDims[idx]!.width;
                const effH = fastMetaDims[idx]!.height;
                if (variableCells && col === 0) {
                    tileX = 0;
                    if (row > 0) tileY += rowHeights[row - 1]!;
                }
                const cellX = (variableCells ? tileX : col * slotW) + padX;
                const cellY = (variableCells ? tileY : row * slotH) + padY;
                const off = resolveGravityOffset(variableCells ? 0 : maxThumbW - effW, variableCells && !concatenate ? 0 : (variableCells ? rowHeights[row]! - padY * 2 : maxThumbH) - effH, state.gravity);
                tileX += effW + padX * 2;
                const dstX = cellX + off.left;
                const dstY = cellY + off.top;
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
            yield* writePage(canvas, pageStart / (cols * rows), n > cols * rows);
        }
    } else {
        const images: RgbaImage[] = [];
        for (const [inputIndex, p] of inPaths.entries()) {
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
                inputErrors += `montage: unable to open image '${p}': No such file or directory\n`;
                continue;
            }
            for (const loaded of loadedList) {
                if (++cooperativeWork % 64 === 0)
                    yield;
                let thumb = loaded;
                if (trim) {
                    thumb = yield* trimMagickSteps(loaded, state.alphaFuzz);
                    if (thumb !== loaded) detachRgbaBuffer(loaded.data);
                }
                for (const orientation of orientations) {
                    const previous = thumb;
                    thumb = yield* (orientation === "flop" ? flopImageSteps(thumb) : flipImageSteps(thumb));
                    if (thumb !== previous) detachRgbaBuffer(previous.data);
                    if (orientation === "transpose") {
                        const flipped = thumb;
                        thumb = yield* rotateImageSteps(flipped, 90, state.background);
                        if (thumb !== flipped) detachRgbaBuffer(flipped.data);
                    }
                }
                if (rotation !== 0) {
                    const previous = thumb;
                    thumb = yield* rotateImageSteps(thumb, rotation, state.background);
                    if (thumb !== previous) detachRgbaBuffer(previous.data);
                }
                if (thumbnail !== undefined) {
                    const previous = thumb;
                    thumb = yield* applyMagickResizeSteps(thumb, thumbnail, state.kernel, true, false, false, state.resizeFilter);
                    if (thumb !== previous) detachRgbaBuffer(previous.data);
                }
                if (cellW !== undefined || cellH !== undefined) {
                    const previous = thumb;
                    thumb = (yield* applyMagickResizeSteps(thumb, geometry, state.kernel, true, false, false, state.resizeFilter));
                    if (thumb !== previous) detachRgbaBuffer(previous.data);
                }
                if (!frame && borderW > 0) {
                    const prev = thumb;
                    thumb = yield* createSolidRgbaImageSteps(prev.width + borderW * 2, prev.height + borderW * 2, state.borderColor);
                    yield* blitOverRgbaInPlaceSteps(thumb, prev, borderW, borderW);
                    if (thumb !== prev) detachRgbaBuffer(prev.data);
                }
                if (labels[inputIndex]) {
                    const text = yield* formatMagickPropertyStringSteps(labels[inputIndex]!, thumb, () => thumb, { filePath: parseInputToken(p).baseToken });
                    const height = Math.ceil(Math.max(8, state.pointsize) * 1.4);
                    const caption = decodeImage(new TextEncoder().encode(createLabelSvg(text, { ...state, hasSize: true, sizeWidth: thumb.width, sizeHeight: height, gravity: "center" })));
                    const previous = thumb;
                    thumb = yield* extendImageSteps(thumb, { top: 0, bottom: height, left: 0, right: 0, background: state.background, extendWith: "background" });
                    if (thumb !== previous) detachRgbaBuffer(previous.data);
                    yield* blitOverRgbaInPlaceSteps(thumb, caption, 0, thumb.height - height);
                    detachRgbaBuffer(caption.data);
                }
                images.push(thumb);
            }
        }
        const n = images.length;
        if (!n) return { exitCode: 1, stdout: "", stderr: inputErrors };
        const cols = tileCols ?? Math.ceil(n / (tileRows ?? Math.max(1, Math.floor(Math.sqrt(n)))));
        const rows = tileRows ?? Math.ceil(n / cols);
        const maxThumbW = Math.max((cellW ?? 0) + (frame ? 0 : borderW * 2), ...images.map((im) => im.width));
        const maxThumbH = Math.max(cellH ?? 0, ...images.map((im) => im.height));
        const slotW = maxThumbW + padX * 2 + (frame ? frame.size * 2 : 0);
        const slotH = maxThumbH + padY * 2 + (frame ? frame.size * 2 : 0) + (shadow ? 4 : 0);
        for (let pageStart = 0; pageStart < n; pageStart += cols * rows) {
            const rowWidths: number[] = [], rowHeights: number[] = [];
            if (variableCells) for (let index = 0; index < Math.min(n - pageStart, cols * rows); index++) {
                if (++cooperativeWork % 64 === 0) yield;
                const row = Math.floor(index / cols), image = images[pageStart + index]!;
                rowWidths[row] = (rowWidths[row] ?? 0) + image.width + padX * 2;
                rowHeights[row] = Math.max(rowHeights[row] ?? 0, image.height + padY * 2 + (shadow ? 4 : 0));
            }
            const pageSize = Math.min(n - pageStart, cols * rows);
            if (variableCells && pageSize % cols) {
                rowWidths[Math.floor(pageSize / cols)]! += (cols - pageSize % cols) * (images[pageStart + pageSize - 1]!.width + padX * 2);
            }
            const canvasW = Math.max(1, variableCells ? Math.max(0, ...rowWidths) + (shadow ? 4 : 0) : cols * slotW + (shadow ? 4 : 0));
            const canvasH = Math.max(1, variableCells ? rowHeights.reduce((sum, height) => sum + height, 0) : rows * slotH);
            let tileX = 0, tileY = 0;
            canvas = (yield* createSolidRgbaImageSteps(canvasW, canvasH, state.background));
            if (textureImage) for (let y = 0; y < canvasH; y += textureImage.height) {
                for (let x = 0; x < canvasW; x += textureImage.width) {
                    if (++cooperativeWork % 64 === 0) yield;
                    yield* blitOverRgbaInPlaceSteps(canvas, textureImage, x, y);
                }
            }
            for (let idx = pageStart; idx < pageStart + pageSize; idx++) {
                if (++cooperativeWork % 64 === 0)
                    yield;
                const col = (idx - pageStart) % cols;
                const row = Math.floor((idx - pageStart) / cols);
                let im = images[idx]!;
                images[idx] = undefined as unknown as RgbaImage;
                if (!anyTransparent) {
                    for (let k = 3; k < im.data.length; k += 4) {
                        if (im.data[k]! < 255) { anyTransparent = true; break; }
                    }
                }
                if (variableCells && col === 0) {
                    tileX = 0;
                    if (row > 0) tileY += rowHeights[row - 1]!;
                }
                const cellX = (variableCells ? tileX : col * slotW) + padX;
                const cellY = (variableCells ? tileY : row * slotH) + padY;
                if (frame) {
                    const previous = im;
                    im = yield* applyMagickRasterSteps(im, magickFramePixels(im, maxThumbW + frame.width * 2, maxThumbH + frame.height * 2, state.borderColor, frame.outer || frame.inner ? matte : state.background, frame.width, frame.height, frame.outer, frame.inner), signal, { width: maxThumbW + frame.width * 2, height: maxThumbH + frame.height * 2, hasAlpha: true });
                    detachRgbaBuffer(previous.data);
                    if (!shadow) {
                        yield* blitOverRgbaInPlaceSteps(canvas, im, cellX, cellY);
                        detachRgbaBuffer(im.data);
                        continue;
                    }
                    const shadowImage = yield* applyMagickRasterSteps(im, montageShadowPixels(im), signal, { width: im.width + 20, height: im.height + 20, hasAlpha: true });
                    yield* blitOverRgbaInPlaceSteps(shadowImage, im, 0, 0);
                    detachRgbaBuffer(im.data);
                    yield* blitOverRgbaInPlaceSteps(canvas, shadowImage, cellX, cellY);
                    detachRgbaBuffer(shadowImage.data);
                    continue;
                }
                const off = resolveGravityOffset(variableCells ? 0 : maxThumbW - im.width, variableCells && !concatenate ? 0 : (variableCells ? rowHeights[row]! - padY * 2 - (shadow ? 4 : 0) : maxThumbH) - im.height, state.gravity);
                tileX += im.width + padX * 2;
                if (shadow) {
                    const shadowImage = yield* applyMagickRasterSteps(im, montageShadowPixels(im), signal, { width: im.width + 20, height: im.height + 20, hasAlpha: true });
                    yield* blitOverRgbaInPlaceSteps(canvas, shadowImage, cellX + off.left, cellY + off.top);
                    detachRgbaBuffer(shadowImage.data);
                }
                // Concatenate offsets bordered tiles without enlarging the canvas.
                yield* blitOverRgbaInPlaceSteps(canvas, im, cellX + off.left + (concatenate ? borderW : 0), cellY + off.top + (concatenate ? borderW : 0));
                detachRgbaBuffer(im.data);
            }
            yield* writePage(canvas, pageStart / (cols * rows), n > cols * rows);
        }
        images.length = 0;
    }
    const stdoutBytes = new Uint8Array(stdoutChunks.reduce((size, chunk) => size + chunk.length, 0));
    let offset = 0;
    for (const chunk of stdoutChunks) { stdoutBytes.set(chunk, offset); offset += chunk.length; }
    return { exitCode: inputErrors ? 1 : 0, stdout: "", stderr: inputErrors, ...(stdoutChunks.length ? { stdoutBytes } : {}) };
}
async function runMontageFiles(argv: readonly string[], input: ConvertFileInput, stdinBytes: Uint8Array | undefined, signal: AbortSignal): Promise<ImageMagickCliResult> {
    const parsed = await drainSteps(parseMontageArguments(argv), signal);
    if ("exitCode" in parsed) return parsed;
    const { trim, shadow, orientations, rotation, concatenate, state, tileCols, tileRows, cellW, cellH, padX, padY, borderW, operands, labels, geometry, thumbnail, frame, matte, title, texture } = parsed;
    const variableCells = !frame && cellW === undefined && cellH === undefined;
    if (operands.length < 2) { await probeImageArguments(argv, input, stdinBytes, signal); return { exitCode: 1, stdout: "", stderr: "montage: missing an image filename\n" }; }
    const outSpec = operands.at(-1)!, paths = operands.slice(0, -1);
    return withCompareFiles(input, stdinBytes, signal, async backend => {
        let textureImage: StoredRgbaImage | undefined;
        if (texture !== undefined) {
            try { textureImage = await parseStoredCompareInput(texture, state, backend, signal); }
            catch (error) {
                signal.throwIfAborted(); if (error instanceof CompareInputFailure) throw error.reason;
                return { exitCode: 1, stdout: "", stderr: `montage: improper image header '${texture}': ${(error as Error).message}\n` };
            }
            if (!textureImage) return { exitCode: 1, stdout: "", stderr: `montage: unable to open image '${texture}': No such file or directory\n` };
        }
        let inputErrors = "";
        const sources = new IntegerTable(backend.storage, 128), images = new StoredImageStack(backend.storage, signal);
        let fast = !shadow && !trim && orientations.length === 0 && rotation === 0 && !frame && borderW === 0 && thumbnail === undefined && cellW === undefined && cellH === undefined && !labels.some(Boolean), maxThumbW = cellW ?? 0, maxThumbH = cellH ?? 0;
        const sourceAt = async (index: number): Promise<ImageByteSource | null> => {
            const size = Number(await sources.get(BigInt(index * 5 + 1)) ?? -1n);
            if (size < 0) return null;
            const position = Number(await sources.get(BigInt(index * 5))!);
            return { size, async read(start, length) {
                signal.throwIfAborted();
                if (!Number.isSafeInteger(start) || !Number.isSafeInteger(length) || start < 0 || length < 0 || length > 16384 || start + length > size) throw new RangeError("Invalid montage input range");
                return new Uint8Array(await backend.storage.read(position + start, length));
            } };
        };
        // Snapshot each admitted input once, preserving its identity across layout and decoding.
        for (let index = 0; index < paths.length; index++) {
            await yieldTurn(signal);
            const token = paths[index]!;
            let path = parseInputToken(token.toLowerCase().startsWith("tile:") ? token.slice(5) : token).baseToken;
            const colon = path.indexOf(":"); if (colon > 0 && extToImageFormat(path.slice(0, colon))) path = path.slice(colon + 1);
            await backend.read(path, async source => {
                const position = backend.storage.allocate(source.size);
                for (let start = 0; start < source.size; start += 16384) {
                    await yieldTurn(signal);
                    await backend.storage.write(position + start, await source.read(start, Math.min(16384, source.size - start), { signal }));
                }
                await sources.set(BigInt(index * 5), BigInt(position)); await sources.set(BigInt(index * 5 + 1), BigInt(source.size));
            });
            if (!fast) continue;
            const source = await sourceAt(index);
            if (!source || token.includes("[") || token.includes(":")) { fast = false; continue; }
            const prefix = await source.read(0, Math.min(26, source.size));
            if (prefix[0] === 0x47) { fast = false; continue; }
            try {
                const metadata = await readImageMetadataFromSource(source, signal, undefined, backend.storage);
                if (!metadata.width || !metadata.height) { fast = false; continue; }
                const width = metadata.width + borderW * 2, height = metadata.height + borderW * 2;
                maxThumbW = Math.max(maxThumbW, width); maxThumbH = Math.max(maxThumbH, height);
                await sources.set(BigInt(index * 5 + 2), BigInt(width)); await sources.set(BigInt(index * 5 + 3), BigInt(height));
                let directPng = metadata.format === "png" && !metadata.isProgressive && prefix[24] === 8 && (prefix[25] === 2 || prefix[25] === 6), idat = false;
                if (directPng) for (let offset = 8; offset + 8 <= source.size;) {
                    await yieldTurn(signal);
                    const header = await source.read(offset, 8), size = new DataView(header.buffer, header.byteOffset, 4).getUint32(0, false);
                    if (offset + 8 + size > source.size) break;
                    const name = String.fromCharCode(...header.subarray(4));
                    if (name === "tRNS") directPng = false;
                    if (name === "IDAT") idat = true;
                    if (name === "IEND") break;
                    offset += 12 + size;
                }
                await sources.set(BigInt(index * 5 + 4), directPng && idat ? 1n : 0n);
            } catch { signal.throwIfAborted(); fast = false; }
        }
        if (!fast) {
            maxThumbW = (cellW ?? 0) + (frame ? 0 : borderW * 2); maxThumbH = cellH ?? 0;
            for (let index = 0; index < paths.length; index++) {
                const path = paths[index]!;
                try {
                    const loaded = await parseStoredCompareInput(path, state, backend, signal, { source: await sourceAt(index), visit: async image => {
                        if (trim) image = await trimStoredMagick(image, backend.storage, state.alphaFuzz, signal);
                        for (const orientation of orientations) {
                            image = await transformStoredImage(image, backend.storage, { kind: orientation === "transpose" ? "flip" : orientation }, signal);
                            if (orientation === "transpose") image = await transformStoredImage(image, backend.storage, { kind: "rotate", angle: 90, background: state.background }, signal);
                        }
                        if (rotation !== 0) image = await transformStoredImage(image, backend.storage, { kind: "rotate", angle: rotation, background: state.background }, signal);
                        if (thumbnail !== undefined) {
                            const resize = magickResizeOptions(image, thumbnail, state.kernel ?? "lanczos3");
                            if (resize) image = await resizeStoredMagickImage(image, backend, resize, signal, true, false, false, state.resizeFilter);
                        }
                        if (cellW !== undefined || cellH !== undefined) {
                            const resize = magickResizeOptions(image, geometry, state.kernel ?? "lanczos3");
                            if (resize) image = await resizeStoredMagickImage(image, backend, resize, signal, true, false, false, state.resizeFilter);
                        }
                        if (!frame && borderW > 0) {
                            const border = await createStoredCanvas(image.width + borderW * 2, image.height + borderW * 2, state.borderColor, backend, signal);
                            image = await compositeStoredMagick(border, image, backend, signal, borderW, borderW, "over", undefined, false, true);
                        }
                        if (labels[index]) {
                            const labeled = image;
                            const text = await formatRetainedIdentify(labels[index]!, image, { filePath: parseInputToken(path).baseToken }, async () => ({ image: labeled, storage: backend.storage }), signal);
                            const height = Math.ceil(Math.max(8, state.pointsize) * 1.4);
                            const caption = await decodeStoredMagickSvg(createLabelSvg(text, { ...state, hasSize: true, sizeWidth: image.width, sizeHeight: height, gravity: "center" }), 72, backend, signal);
                            image = await transformStoredImage(image, backend.storage, { kind: "extend", top: 0, bottom: height, left: 0, right: 0, background: state.background, extendWith: "background" }, signal);
                            image = await compositeStoredMagick(image, caption, backend, signal, 0, image.height - height, "over", undefined, false, true);
                        }
                        maxThumbW = Math.max(maxThumbW, image.width); maxThumbH = Math.max(maxThumbH, image.height); await images.push(image);
                    } });
                    if (!loaded) inputErrors += `montage: unable to open image '${path}': No such file or directory\n`;
                } catch (error) {
                    signal.throwIfAborted(); if (error instanceof CompareInputFailure) throw error.reason;
                    return { exitCode: 1, stdout: "", stderr: `montage: improper image header '${path}': ${(error as Error).message}\n` };
                }
            }
        }
        const n = fast ? paths.length : images.length;
        if (!n) return { exitCode: 1, stdout: "", stderr: inputErrors };
        const cols = tileCols ?? Math.ceil(n / (tileRows ?? Math.max(1, Math.floor(Math.sqrt(n))))), rows = tileRows ?? Math.ceil(n / cols);
        const slotW = maxThumbW + padX * 2 + (frame ? frame.size * 2 : 0), slotH = maxThumbH + padY * 2 + (frame ? frame.size * 2 : 0) + (shadow ? 4 : 0);
        const stdoutChunks: Uint8Array[] = [];
        for (let pageStart = 0; pageStart < n; pageStart += cols * rows) {
            const pageSize = Math.min(n - pageStart, cols * rows);
            const rowHeights = new IntegerTable(backend.storage, 128);
            let canvasWidth = cols * slotW + (shadow ? 4 : 0), canvasHeight = rows * slotH;
            if (variableCells) {
                canvasWidth = canvasHeight = 0;
                let rowWidth = 0, rowHeight = 0;
                for (let index = 0; index < pageSize; index++) {
                    await yieldTurn(signal);
                    const image = fast ? undefined : (await images.get(pageStart + index))!;
                    const width = image ? image.width : Number(await sources.get(BigInt((pageStart + index) * 5 + 2)));
                    const height = image ? image.height : Number(await sources.get(BigInt((pageStart + index) * 5 + 3)));
                    rowWidth += width + padX * 2;
                    rowHeight = Math.max(rowHeight, height + padY * 2 + (shadow ? 4 : 0));
                    if (index % cols === cols - 1 || index === pageSize - 1) {
                        await rowHeights.set(BigInt(Math.floor(index / cols)), BigInt(rowHeight));
                        if (index === pageSize - 1) rowWidth += (cols - 1 - index % cols) * (width + padX * 2);
                        canvasWidth = Math.max(canvasWidth, rowWidth + (shadow ? 4 : 0));
                        canvasHeight += rowHeight;
                        rowWidth = rowHeight = 0;
                    }
                }
            }
            let tileX = 0, tileY = 0;
            let canvas = await createStoredCanvas(Math.max(1, canvasWidth), Math.max(1, canvasHeight), state.background, backend, signal);
            if (textureImage) canvas = await compositeStoredMagick(canvas, textureImage, backend, signal, 0, 0, "over", undefined, false, true, false, true);
            let anyTransparent = state.background.a < 255 || (borderW > 0 && state.borderColor.a < 255);
            for (let index = 0; index < pageSize; index++) {
                await yieldTurn(signal);
                const col = index % cols, row = Math.floor(index / cols);
                let image: StoredRgbaImage | undefined, directPng = false;
                if (fast) {
                    const path = paths[pageStart + index]!;
                    try { image = await parseStoredCompareInput(path, state, backend, signal, { source: await sourceAt(pageStart + index) }); }
                    catch (error) {
                        signal.throwIfAborted(); if (error instanceof CompareInputFailure) throw error.reason;
                        return { exitCode: 1, stdout: "", stderr: `montage: improper image header '${path}': ${(error as Error).message}\n` };
                    }
                    if (!image) return { exitCode: 1, stdout: "", stderr: `montage: unable to open image '${path}': No such file or directory\n` };
                    directPng = await sources.get(BigInt((pageStart + index) * 5 + 4)) === 1n;
                } else image = (await images.get(pageStart + index))!;
                if (frame) {
                    image = await transformStoredMagickRaster(image, backend, magickFramePixels(image, maxThumbW + frame.width * 2, maxThumbH + frame.height * 2, state.borderColor, frame.outer || frame.inner ? matte : state.background, frame.width, frame.height, frame.outer, frame.inner), signal, { width: maxThumbW + frame.width * 2, height: maxThumbH + frame.height * 2, hasAlpha: true });
                    if (!shadow) {
                        canvas = await compositeStoredMagick(canvas, image, backend, signal, col * slotW + padX, row * slotH + padY, "over", undefined, false, true);
                        continue;
                    }
                    let shadowImage = await transformStoredMagickRaster(image, backend, montageShadowPixels(image), signal, { width: image.width + 20, height: image.height + 20, hasAlpha: true });
                    shadowImage = await compositeStoredMagick(shadowImage, image, backend, signal, 0, 0, "over", undefined, false, true);
                    canvas = await compositeStoredMagick(canvas, shadowImage, backend, signal, col * slotW + padX, row * slotH + padY, "over", undefined, false, true);
                    continue;
                }
                const width = fast ? Number(await sources.get(BigInt((pageStart + index) * 5 + 2))) : image.width, height = fast ? Number(await sources.get(BigInt((pageStart + index) * 5 + 3))) : image.height;
                if (variableCells && col === 0) {
                    tileX = 0;
                    if (row > 0) tileY += Number(await rowHeights.get(BigInt(row - 1)));
                }
                const offset = resolveGravityOffset(variableCells ? 0 : maxThumbW - width, variableCells && !concatenate ? 0 : (variableCells ? Number(await rowHeights.get(BigInt(row))) - padY * 2 - (shadow ? 4 : 0) : maxThumbH) - height, state.gravity);
                // Concatenate offsets bordered tiles without enlarging the canvas.
                const x = (variableCells ? tileX : col * slotW) + (concatenate ? borderW : 0) + padX + offset.left, y = (variableCells ? tileY : row * slotH) + (concatenate ? borderW : 0) + padY + offset.top;
                tileX += width + padX * 2;
                if (!anyTransparent) for (let start = 0; start < image.width * image.height * 4; start += 16384) {
                    await yieldTurn(signal);
                    const bytes = await backend.storage.read(image.position + start, Math.min(16384, image.width * image.height * 4 - start));
                    for (let k = 3; k < bytes.length; k += 4) if (bytes[k]! < 255) { anyTransparent = true; break; }
                    if (anyTransparent) break;
                }
                if (shadow) {
                    const shadowImage = await transformStoredMagickRaster(image, backend, montageShadowPixels(image), signal, { width: image.width + 20, height: image.height + 20, hasAlpha: true });
                    canvas = await compositeStoredMagick(canvas, shadowImage, backend, signal, x, y, "over", undefined, false, true);
                }
                canvas = await compositeStoredMagick(canvas, image, backend, signal, x + (fast ? borderW : 0), y + (fast ? borderW : 0), "over", undefined, false, true, directPng);
            }
            if (title !== undefined) {
                const { svg, height } = montageTitleSvg(title, canvas.width, state, padY);
                const caption = await decodeStoredMagickSvg(svg, 72, backend, signal);
                canvas = await transformStoredImage(canvas, backend.storage, { kind: "extend", top: height, bottom: 0, left: 0, right: 0, background: state.background, extendWith: "background" }, signal);
                canvas = await compositeStoredMagick(canvas, caption, backend, signal, 0, 0, "over", undefined, false, true);
            }
            if (!anyTransparent) canvas = { ...canvas, hasAlpha: false, channels: 3 };
            const { format, path } = inferOutputFormat(outSpec, "png");
            const outputPath = path === "-" ? path : n > cols * rows || hasSceneOutputPattern(path) ? formatSceneOutputPath(path, pageStart / (cols * rows)) : path.replaceAll("%%", "%");
            const stdoutBytes = await (n > cols * rows ? backend.stage : backend.publish)(canvas, outputPath, { format, chromaSubsampling: state.quality < 90 ? "4:2:0" : "4:4:4", webpExact: state.webpExact ?? false, smartSubsample: state.webpSmartSubsample ?? false, alphaCompression: state.webpAlphaCompression ?? 1, alphaQuality: state.webpAlphaQuality ?? 100, quality: state.quality, ...(format === "webp" ? { effort: state.webpMethod ?? 4, lossless: state.webpLossless ?? state.quality >= 100 } : {}) });
            if (stdoutBytes) stdoutChunks.push(stdoutBytes);
        }
        if (n > cols * rows) await backend.publishPending();
        const stdoutBytes = new Uint8Array(stdoutChunks.reduce((size, chunk) => size + chunk.length, 0));
        let offset = 0;
        for (const chunk of stdoutChunks) { stdoutBytes.set(chunk, offset); offset += chunk.length; }
        return { exitCode: inputErrors ? 1 : 0, stdout: "", stderr: inputErrors, ...(stdoutChunks.length ? { stdoutBytes } : {}) };
    });
}
export async function runMontageCli(argv: readonly string[], files: Map<string, Uint8Array> | ConvertFileInput, stdinBytes?: Uint8Array, signal?: AbortSignal): Promise<ImageMagickCliResult> {
    if (files instanceof Map) return drainSteps(runMontageCliSteps(argv, files, stdinBytes, signal), signal);
    const active = signal ?? new AbortController().signal;
    const result = await runMontageFiles(argv, files, stdinBytes, active);
    if (files.stderr && result.stderr) { await writeIdentifyText(files.stderr, result.stderr, active); return { ...result, stderr: "" }; }
    return result;
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
    if (argv[0] === "composite") return runCompositeCli(argv.slice(1), files, stdinBytes, signal);
    if (argv[0] === "montage") return runMontageCli(argv.slice(1), files, stdinBytes, signal);
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
      candidate = parseInputToken(candidate).baseToken;
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
        try {
          await writeFileOutput(context, val, data => context.fs.writeFile(abs, data, { signal: signal }));
        } catch (error) {
          signal.throwIfAborted();
          if (error instanceof FsError && ["ENOENT", "ENOTDIR"].includes(error.code))
            throw new FsError(error.code, { syscall: "write", path: key, cause: error });
          throw error;
        }
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
    const isComposite = runner === runCompositeCli || (runner === runMagickCli && argv[0] === "composite");
    const isMontage = runner === runMontageCli || (runner === runMagickCli && argv[0] === "montage");
    const isMogrify = runner === runMogrifyCli || (runner === runMagickCli && argv[0] === "mogrify");
    const res = isConvert ? await runConvertCli(runner === runMagickCli && argv[0] === "convert" ? argv.slice(1) : argv, fileInput, undefined, invocation.signal)
        : isComposite ? await runCompositeCli(runner === runMagickCli ? argv.slice(1) : argv, fileInput, undefined, invocation.signal)
        : isMontage ? await runMontageCli(runner === runMagickCli ? argv.slice(1) : argv, fileInput, undefined, invocation.signal)
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
  } catch (error) {
    invocation.signal.throwIfAborted();
    if (!(error instanceof FsError) || !["ENOENT", "ENOTDIR"].includes(error.code)) throw error;
    await writeBytes(context.stderr, new TextEncoder().encode(`magick: ${error.message}\n`), invocation.signal);
    return { exitCode: 1 };
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



function* mapMagickImagesSteps(images: readonly RgbaImage[], transform: (image: RgbaImage) => Generator<void, RgbaImage, void>): Generator<void, RgbaImage[], void> {
    return yield* mapSteps(images, function* (original) {
        let result = yield* transform(original);
        if (original.region && result.data !== original.data && result.width === original.width && result.height === original.height) {
            result = yield* applyMagickRasterSteps(result, regionPixelSteps(result, original.region), undefined, result, [result, original]);
        }
        if (!original.writeMask || result.data === original.data || result.width !== original.width || result.height !== original.height) return result;
        return yield* applyMagickRasterSteps(result, writeMaskPixelSteps(result, original.writeMask, !!(result.data16 || original.data16)), undefined, result, [result, original, original.writeMask]);
    });
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
