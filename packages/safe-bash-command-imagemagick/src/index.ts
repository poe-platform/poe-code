import {
  commandRuntimeIdentity,
  getCommandArguments,
  type CommandContext,
  type CommandDefinition
} from "safe-bash-contracts/command";
import { readBytes, writeBytes } from "safe-bash-contracts/io";
import { createOutputOperation } from "safe-bash-contracts/output";
import type { VirtualShellPlugin } from "safe-bash-contracts/plugin";
import sharp, {
  applyExifOrientation,
  blurImage,
  compositeImage,
  decodeImage,
  dilateImage,
  encodeImage,
  ensureAlphaImage,
  erodeImage,
  extendImage,
  extractChannelImage,
  extractImage,
  flattenImage,
  flipImage,
  flopImage,
  gammaImage,
  grayscaleImage,
  joinChannelImage,
  linearImage,
  medianImage,
  modulateImage,
  readImageMetadata,
  negateImage,
  normalizeImage,
  parseColor as baseParseColor,
  removeAlphaImage,
  resizeImage,
  rotateImage,
  sharpenImage,
  thresholdImage,
  tintImage,
  trimImage,
  type BlendMode,
  type CompositeLayer,
  type GravityPosition,
  type ImageFormat,
  type ImageMetadata,
  type ResizeKernel,
  type RgbaColor,
  type RgbaImage
} from "@poe-code/image-ast";

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

export interface ImageMagickCommandOptions {
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

function applyMagickMorphology4Ch(
  img: RgbaImage,
  methodRaw: string,
  kernelSpec: string
): RgbaImage {
  const m = methodRaw.toLowerCase();
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

  const step = (src: RgbaImage, isMax: boolean): RgbaImage => {
    const w = src.width;
    const h = src.height;
    const out = new Uint8Array(src.data.length);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dstOff = (y * w + x) * 4;
        for (let c = 0; c < 4; c++) {
          let best = src.data[dstOff + c]!;
          for (let dy = -ry; dy <= ry; dy++) {
            const sy = Math.max(0, Math.min(h - 1, y + dy));
            for (let dx = -rx; dx <= rx; dx++) {
              const sx = Math.max(0, Math.min(w - 1, x + dx));
              const v = src.data[(sy * w + sx) * 4 + c]!;
              if (isMax ? v > best : v < best) best = v;
            }
          }
          out[dstOff + c] = best;
        }
      }
    }
    return { ...src, data: out };
  };

  const diffImg = (a: RgbaImage, b: RgbaImage): RgbaImage => {
    const out = new Uint8Array(a.data.length);
    for (let i = 0; i < out.length; i++) {
      out[i] = clampByteVal(a.data[i]! - b.data[i]!);
    }
    return { ...a, data: out };
  };

  if (m === "erode" || m === "minimum") return step(img, false);
  if (m === "dilate" || m === "maximum") return step(img, true);
  if (m === "open") return step(step(img, false), true);
  if (m === "close") return step(step(img, true), false);
  if (m === "edgein") return diffImg(img, step(img, false));
  if (m === "edgeout") return diffImg(step(img, true), img);
  if (m === "edge" || m === "gradient") return diffImg(step(img, true), step(img, false));
  if (m === "tophat") return diffImg(img, step(step(img, false), true));
  if (m === "bottomhat") return diffImg(step(step(img, true), false), img);
  if (m === "median") {
    const w = img.width;
    const h = img.height;
    const out = new Uint8Array(img.data.length);
    const win: number[] = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dstOff = (y * w + x) * 4;
        for (let c = 0; c < 4; c++) {
          win.length = 0;
          for (let dy = -ry; dy <= ry; dy++) {
            const sy = Math.max(0, Math.min(h - 1, y + dy));
            for (let dx = -rx; dx <= rx; dx++) {
              const sx = Math.max(0, Math.min(w - 1, x + dx));
              win.push(img.data[(sy * w + sx) * 4 + c]!);
            }
          }
          win.sort((a, b) => a - b);
          out[dstOff + c] = win[Math.floor(win.length / 2)]!;
        }
      }
    }
    return { ...img, data: out };
  }
  return step(img, true);
}

function createRoseImage(): RgbaImage {
  const w = 70;
  const h = 46;
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
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

function applyMagickFloodfill(
  img: RgbaImage,
  geomStr: string,
  targetColor: RgbaColor | undefined,
  replacement: RgbaColor,
  fuzz: number
): RgbaImage {
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
      if (nb >= 0 && visited[nb] === 0 && matchesRef(nb)) {
        visited[nb] = 1;
        queue[tail++] = nb;
      }
    }
  }
  return { ...img, data: out, hasAlpha: true };
}

function applyMagickEvaluateSequence(stack: readonly RgbaImage[], opRaw: string): RgbaImage {
  if (stack.length === 0) {
    throw new Error("evaluate-sequence requires at least one image");
  }
  if (stack.length === 1) return stack[0]!;
  const base = stack[0]!;
  const w = base.width;
  const h = base.height;
  const normalized = stack.map((im) =>
    im.width === w && im.height === h ? im : applyMagickResize(im, `${w}x${h}!`, "bilinear")
  );
  const n = normalized.length;
  const out = new Uint8Array(w * h * 4);
  const op = opRaw.toLowerCase().replace(/[-_]/g, "");
  const vals = new Float64Array(n);

  for (let i = 0; i < out.length; i++) {
    if ((i & 3) === 3) {
      out[i] = base.data[i]!;
      continue;
    }
    for (let k = 0; k < n; k++) {
      vals[k] = normalized[k]!.data[i]!;
    }
    let res = vals[0]!;
    if (op === "mean" || op === "average") {
      let s = 0;
      for (let k = 0; k < n; k++) s += vals[k]!;
      res = s / n;
    } else if (op === "median") {
      const baseOff = i & ~3;
      const order = Array.from({ length: n }, (_, k) => k).sort((a, b) => {
        const da = normalized[a]!.data;
        const db = normalized[b]!.data;
        const sumA = da[baseOff]! + da[baseOff + 1]! + da[baseOff + 2]! + da[baseOff + 3]!;
        const sumB = db[baseOff]! + db[baseOff + 1]! + db[baseOff + 2]! + db[baseOff + 3]!;
        return sumA - sumB;
      });
      res = vals[order[Math.floor(n / 2)]!]!;
    } else if (op === "min") {
      res = Math.min(...vals);
    } else if (op === "max") {
      res = Math.max(...vals);
    } else if (op === "add") {
      let s = 0;
      for (let k = 0; k < n; k++) s += vals[k]!;
      res = s;
    } else if (op === "multiply") {
      let p = 1;
      for (let k = 0; k < n; k++) p *= vals[k]! / 255;
      res = p * 255;
    }
    out[i] = clampByteVal(res);
  }
  return { ...base, data: out };
}

function applyMagickCustomConvolve(img: RgbaImage, spec: string): RgbaImage {
  const afterColon = spec.includes(":") ? spec.slice(spec.indexOf(":") + 1) : spec;
  const coeffs = afterColon
    .trim()
    .split(/[\s,]+/)
    .filter((s) => s.length > 0)
    .map(Number)
    .filter((n) => Number.isFinite(n));
  if (coeffs.length === 0) return img;
  const side = Math.max(1, Math.round(Math.sqrt(coeffs.length)));
  const half = Math.floor(side / 2);
  const w = img.width;
  const h = img.height;
  const out = new Uint8Array(img.data);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let ky = 0; ky < side; ky++) {
          const sy = Math.max(0, Math.min(h - 1, y + ky - half));
          for (let kx = 0; kx < side; kx++) {
            const sx = Math.max(0, Math.min(w - 1, x + kx - half));
            const weight = coeffs[ky * side + kx] ?? 0;
            sum += img.data[(sy * w + sx) * 4 + c]! * weight;
          }
        }
        out[(y * w + x) * 4 + c] = clampByteVal(sum);
      }
    }
  }
  return { ...img, data: out };
}

function applyMagickColorMatrix(img: RgbaImage, spec: string): RgbaImage {
  const afterColon = spec.includes(":") ? spec.slice(spec.indexOf(":") + 1) : spec;
  const m = afterColon
    .trim()
    .split(/[\s,]+/)
    .filter((s) => s.length > 0)
    .map(Number);
  if (m.length < 9) return img;
  const out = new Uint8Array(img.data);
  const cols = m.length >= 16 ? Math.round(Math.sqrt(m.length)) : 3;
  for (let i = 0; i < out.length; i += 4) {
    const r = out[i]!;
    const g = out[i + 1]!;
    const b = out[i + 2]!;
    out[i] = clampByteVal((m[0] ?? 1) * r + (m[1] ?? 0) * g + (m[2] ?? 0) * b);
    out[i + 1] = clampByteVal((m[cols] ?? 0) * r + (m[cols + 1] ?? 1) * g + (m[cols + 2] ?? 0) * b);
    out[i + 2] = clampByteVal(
      (m[cols * 2] ?? 0) * r + (m[cols * 2 + 1] ?? 0) * g + (m[cols * 2 + 2] ?? 1) * b
    );
  }
  return { ...img, data: out };
}

function applyMagickEqualize(img: RgbaImage): RgbaImage {
  const out = new Uint8Array(img.data);
  const totalPixels = Math.max(1, img.width * img.height);
  for (let c = 0; c < 3; c++) {
    const hist = new Uint32Array(256);
    for (let i = c; i < out.length; i += 4) {
      hist[out[i]!]!++;
    }
    const lut = new Uint8Array(256);
    let cdf = 0;
    let cdfMin = 0;
    for (let v = 0; v < 256; v++) {
      cdf += hist[v]!;
      if (cdfMin === 0 && cdf > 0) cdfMin = cdf;
      const denom = Math.max(1, totalPixels - cdfMin);
      lut[v] = clampByteVal(((cdf - cdfMin) / denom) * 255);
    }
    for (let i = c; i < out.length; i += 4) {
      out[i] = lut[out[i]!]!;
    }
  }
  return { ...img, data: out };
}

function applyMagickRemap(img: RgbaImage, palImg: RgbaImage, dither: boolean): RgbaImage {
  const palette: Array<{ r: number; g: number; b: number }> = [];
  const seen = new Set<number>();
  for (let i = 0; i < palImg.data.length; i += 4) {
    const r = palImg.data[i]!;
    const g = palImg.data[i + 1]!;
    const b = palImg.data[i + 2]!;
    const key = (r << 16) | (g << 8) | b;
    if (!seen.has(key)) {
      seen.add(key);
      palette.push({ r, g, b });
      if (palette.length >= 256) break;
    }
  }
  if (palette.length === 0) return img;

  const w = img.width;
  const h = img.height;
  const buf = new Float32Array(img.data);
  const out = new Uint8Array(img.data);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const oldR = Math.max(0, Math.min(255, buf[idx]!));
      const oldG = Math.max(0, Math.min(255, buf[idx + 1]!));
      const oldB = Math.max(0, Math.min(255, buf[idx + 2]!));

      let best = palette[0]!;
      let bestDist = Infinity;
      for (const p of palette) {
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
          if (nx < 0 || nx >= w || ny < 0 || ny >= h) return;
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

function formatMagickPropertyString(fmt: string, img: RgbaImage, sceneIdx = 0, sceneCount = 1): string {
  let sum = 0;
  let minV = 255;
  let maxV = 0;
  const count = Math.max(1, img.width * img.height * 3);
  for (let i = 0; i < img.data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const v = img.data[i + c]!;
      sum += v;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
  }
  const meanV = sum / count;
  const vars = new Map<string, number>();

  return fmt
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/%w/g, String(img.width))
    .replace(/%h/g, String(img.height))
    .replace(/%s/g, String(sceneIdx))
    .replace(/%n/g, String(sceneCount))
    .replace(/%z/g, "8")
    .replace(/%m/g, img.format.toUpperCase())
    .replace(/%\[mean\]/gi, formatMetricNum(meanV))
    .replace(/%\[min\]/gi, String(minV))
    .replace(/%\[max\]/gi, String(maxV))
    .replace(/%\[fx:([^\]]+)\]/gi, (_m, expr: string) => {
      const fn = compileFxExpression(expr);
      vars.clear();
      const val = fn({
        stack: [img],
        x: 0,
        y: 0,
        w: img.width,
        h: img.height,
        ch: 0,
        vars
      });
      return formatMetricNum(val);
    })
    .replace(/%\[pixel:([^\]]+)\]/gi, (_m, expr: string) => {
      const coordMatch = /p\{\s*(-?\d+)\s*,\s*(-?\d+)\s*\}/i.exec(expr);
      const px = coordMatch ? Math.max(0, Math.min(img.width - 1, Number(coordMatch[1]))) : 0;
      const py = coordMatch ? Math.max(0, Math.min(img.height - 1, Number(coordMatch[2]))) : 0;
      const idx = (py * img.width + px) * 4;
      return `srgb(${img.data[idx]!},${img.data[idx + 1]!},${img.data[idx + 2]!})`;
    });
}

function formatTxtEnumeration(img: RgbaImage): string {
  const lines: string[] = [
    `# ImageMagick pixel enumeration: ${img.width},${img.height},255,srgba`
  ];
  const hex = (n: number) => n.toString(16).toUpperCase().padStart(2, "0");
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const idx = (y * img.width + x) * 4;
      const r = img.data[idx]!;
      const g = img.data[idx + 1]!;
      const b = img.data[idx + 2]!;
      const a = img.data[idx + 3]!;
      lines.push(
        `${x},${y}: (${r},${g},${b},${a})  #${hex(r)}${hex(g)}${hex(b)}${a < 255 ? hex(a) : ""}  srgba(${r},${g},${b},${(a / 255).toFixed(3)})`
      );
    }
  }
  return lines.join("\n") + "\n";
}

function formatHistogramOutput(img: RgbaImage): string {
  const counts = new Map<number, number>();
  for (let i = 0; i < img.data.length; i += 4) {
    const key = ((img.data[i]! << 24) | (img.data[i + 1]! << 16) | (img.data[i + 2]! << 8) | img.data[i + 3]!) >>> 0;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const hex = (n: number) => n.toString(16).toUpperCase().padStart(2, "0");
  const lines: string[] = [];
  for (const [key, cnt] of counts.entries()) {
    const r = (key >>> 24) & 0xff;
    const g = (key >>> 16) & 0xff;
    const b = (key >>> 8) & 0xff;
    lines.push(`  ${cnt}: (${r},${g},${b}) #${hex(r)}${hex(g)}${hex(b)} srgb(${r},${g},${b})`);
  }
  return lines.join("\n") + "\n";
}

function createGradientImage(
  width: number,
  height: number,
  c1: RgbaColor,
  c2: RgbaColor,
  radial: boolean
): RgbaImage {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const data = new Uint8Array(w * h * 4);
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;
  const maxR = Math.max(1, Math.hypot(cx, cy));

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = radial
        ? Math.min(1, Math.hypot(x - cx, y - cy) / maxR)
        : h <= 1
          ? 0
          : y / (h - 1);
      const idx = (y * w + x) * 4;
      data[idx] = clampByteVal(c1.r * (1 - t) + c2.r * t);
      data[idx + 1] = clampByteVal(c1.g * (1 - t) + c2.g * t);
      data[idx + 2] = clampByteVal(c1.b * (1 - t) + c2.b * t);
      data[idx + 3] = clampByteVal(c1.a * (1 - t) + c2.a * t);
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

function createCheckerboardImage(width: number, height: number): RgbaImage {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
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

function applyMagickSplice(
  img: RgbaImage,
  geomStr: string,
  bg: RgbaColor,
  gravity: GravityPosition = "northwest"
): RgbaImage {
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
  const out = new Uint8Array(outW * outH * 4);

  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const dstIdx = (y * outW + x) * 4;
      if ((x >= sx && x < sx + sw) || (y >= sy && y < sy + sh)) {
        out[dstIdx] = bg.r;
        out[dstIdx + 1] = bg.g;
        out[dstIdx + 2] = bg.b;
        out[dstIdx + 3] = bg.a;
      } else {
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

function applyMagickChop(
  img: RgbaImage,
  geomStr: string,
  gravity: GravityPosition = "northwest"
): RgbaImage {
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
  const out = new Uint8Array(outW * outH * 4);

  for (let y = 0; y < outH; y++) {
    const srcY = y < cy0 ? y : Math.min(img.height - 1, y + choppedH);
    for (let x = 0; x < outW; x++) {
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

function applyMagickRoll(img: RgbaImage, geomStr: string): RgbaImage {
  const g = parseMagickGeometry(geomStr);
  const rx = Math.round(g.x || g.width || 0);
  const ry = Math.round(g.y || g.height || 0);
  const w = img.width;
  const h = img.height;
  const out = new Uint8Array(img.data.length);

  for (let y = 0; y < h; y++) {
    const sy = (((y - ry) % h) + h) % h;
    for (let x = 0; x < w; x++) {
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

function applyMagickMorph(stack: readonly RgbaImage[], countRaw: number): RgbaImage[] {
  const count = Math.max(0, Math.round(countRaw));
  if (stack.length < 2 || count === 0) return [...stack];
  const out: RgbaImage[] = [];
  for (let idx = 0; idx < stack.length - 1; idx++) {
    const a = stack[idx]!;
    const b = stack[idx + 1]!;
    out.push(a);
    for (let step = 1; step <= count; step++) {
      const t = step / (count + 1);
      const w = Math.max(1, Math.round(a.width * (1 - t) + b.width * t));
      const h = Math.max(1, Math.round(a.height * (1 - t) + b.height * t));
      const ra = a.width === w && a.height === h ? a : applyMagickResize(a, `${w}x${h}!`, "bilinear");
      const rb = b.width === w && b.height === h ? b : applyMagickResize(b, `${w}x${h}!`, "bilinear");
      const data = new Uint8Array(w * h * 4);
      for (let p = 0; p < data.length; p++) {
        data[p] = clampByteVal(ra.data[p]! * (1 - t) + rb.data[p]! * t);
      }
      out.push({ ...ra, width: w, height: h, data });
    }
  }
  out.push(stack[stack.length - 1]!);
  return out;
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

function applyMagickOpaque(
  img: RgbaImage,
  target: RgbaColor,
  replacement: RgbaColor,
  fuzz: number,
  invert: boolean
): RgbaImage {
  const out = new Uint8Array(img.data);
  for (let i = 0; i < out.length; i += 4) {
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

function applyMagickTransparent(
  img: RgbaImage,
  target: RgbaColor,
  fuzz: number,
  invert: boolean
): RgbaImage {
  const out = new Uint8Array(img.data);
  for (let i = 0; i < out.length; i += 4) {
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

function applyMagickEvaluate(
  img: RgbaImage,
  opRaw: string,
  valStr: string,
  channels: { r: boolean; g: boolean; b: boolean; a: boolean }
): RgbaImage {
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
    for (let c = 0; c < 4; c++) {
      if (!mask[c]) continue;
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

function applyMagickFunction(
  img: RgbaImage,
  funcRaw: string,
  paramsRaw: string,
  channels: { r: boolean; g: boolean; b: boolean; a: boolean }
): RgbaImage {
  const fn = funcRaw.toLowerCase();
  const params = paramsRaw.split(",").map((s) => Number(s.trim()));
  const out = new Uint8Array(img.data);
  const mask = [channels.r, channels.g, channels.b, channels.a];

  for (let i = 0; i < out.length; i += 4) {
    for (let c = 0; c < 4; c++) {
      if (!mask[c]) continue;
      const x = out[i + c]! / 255;
      let y = x;
      if (fn === "polynomial") {
        y = params.reduce((acc, coeff) => acc * x + coeff, 0);
      } else if (fn === "sinusoid") {
        const freq = params[0] ?? 1;
        const phase = params[1] ?? 0;
        const amp = params[2] ?? 0.5;
        const bias = params[3] ?? 0.5;
        y = amp * Math.sin(2 * Math.PI * (freq * x + phase / 360)) + bias;
      } else if (fn === "arcsin") {
        const w = params[0] ?? 1;
        const center = params[1] ?? 0.5;
        const range = params[2] ?? 1;
        const bias = params[3] ?? 0.5;
        const arg = Math.max(-1, Math.min(1, (2 / w) * (x - center)));
        y = (range / Math.PI) * Math.asin(arg) + bias;
      } else if (fn === "arctan") {
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

function applyMagickClut(
  baseImg: RgbaImage,
  lutImg: RgbaImage,
  channels: { r: boolean; g: boolean; b: boolean; a: boolean }
): RgbaImage {
  const out = new Uint8Array(baseImg.data);
  const horiz = lutImg.width >= lutImg.height;
  const len = Math.max(1, horiz ? lutImg.width : lutImg.height);
  const mask = [channels.r, channels.g, channels.b, channels.a];

  for (let i = 0; i < out.length; i += 4) {
    for (let c = 0; c < 4; c++) {
      if (!mask[c]) continue;
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

interface FxEvalContext {
  readonly stack: readonly RgbaImage[];
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly ch: number;
  readonly vars: Map<string, number>;
}

function sampleFxImage(
  img: RgbaImage | undefined,
  px: number,
  py: number,
  ch: number
): number {
  if (!img) return 0;
  const cx = Math.max(0, Math.min(img.width - 1, Math.round(px)));
  const cy = Math.max(0, Math.min(img.height - 1, Math.round(py)));
  const idx = (cy * img.width + cx) * 4;
  const r = img.data[idx]! / 255;
  const g = img.data[idx + 1]! / 255;
  const b = img.data[idx + 2]! / 255;
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
  return img.data[idx + (ch & 3)]! / 255;
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
        const targetImg = ctx.stack[targetIdx] ?? ctx.stack[0];
        if (propName === "w") return targetImg?.width ?? ctx.w;
        if (propName === "h") return targetImg?.height ?? ctx.h;

        const px = coordX ? coordX(ctx) : ctx.x;
        const py = coordY ? coordY(ctx) : ctx.y;

        if (name === "r" || name === "red") return sampleFxImage(targetImg, px, py, 0);
        if (name === "g" || name === "green") return sampleFxImage(targetImg, px, py, 1);
        if (name === "b" || name === "blue") return sampleFxImage(targetImg, px, py, 2);
        if (name === "a" || name === "alpha" || name === "opacity") return sampleFxImage(targetImg, px, py, 3);
        if (name === "intensity" || name === "luma" || name === "luminance") {
          return sampleFxImage(targetImg, px, py, 4);
        }
        if (name === "hue") return sampleFxImage(targetImg, px, py, 5);
        if (name === "saturation") return sampleFxImage(targetImg, px, py, 6);
        if (name === "lightness") return sampleFxImage(targetImg, px, py, 7);

        const ch = propName ? propToChannel(propName, ctx.ch) : ctx.ch;
        return sampleFxImage(targetImg, px, py, ch);
      };
    }
    next();
    return () => 0;
  }

  return parseTernary();
}

function applyMagickFx(
  stack: readonly RgbaImage[],
  exprStr: string,
  channels: { r: boolean; g: boolean; b: boolean; a: boolean }
): RgbaImage {
  const base = stack[0]!;
  const out = new Uint8Array(base.data);
  const evalFn = compileFxExpression(exprStr);
  const mask = [channels.r, channels.g, channels.b, channels.a];
  const vars = new Map<string, number>();

  for (let y = 0; y < base.height; y++) {
    for (let x = 0; x < base.width; x++) {
      const idx = (y * base.width + x) * 4;
      for (let c = 0; c < 4; c++) {
        if (!mask[c]) continue;
        vars.clear();
        const val = evalFn({
          stack,
          x,
          y,
          w: base.width,
          h: base.height,
          ch: c,
          vars
        });
        out[idx + c] = clampByteVal(val * 255);
      }
    }
  }
  return { ...base, data: out };
}

function sampleBilinear(
  img: RgbaImage,
  sx: number,
  sy: number,
  bg: RgbaColor,
  out: Uint8Array,
  outOff: number
): void {
  if (sx < -0.5 || sy < -0.5 || sx > img.width - 0.5 || sy > img.height - 0.5) {
    out[outOff] = bg.r;
    out[outOff + 1] = bg.g;
    out[outOff + 2] = bg.b;
    out[outOff + 3] = bg.a;
    return;
  }
  const x0 = Math.max(0, Math.min(img.width - 1, Math.floor(sx)));
  const y0 = Math.max(0, Math.min(img.height - 1, Math.floor(sy)));
  const x1 = Math.max(0, Math.min(img.width - 1, x0 + 1));
  const y1 = Math.max(0, Math.min(img.height - 1, y0 + 1));
  const fx = Math.max(0, Math.min(1, sx - x0));
  const fy = Math.max(0, Math.min(1, sy - y0));

  const i00 = (y0 * img.width + x0) * 4;
  const i10 = (y0 * img.width + x1) * 4;
  const i01 = (y1 * img.width + x0) * 4;
  const i11 = (y1 * img.width + x1) * 4;

  for (let c = 0; c < 4; c++) {
    const v0 = img.data[i00 + c]! * (1 - fx) + img.data[i10 + c]! * fx;
    const v1 = img.data[i01 + c]! * (1 - fx) + img.data[i11 + c]! * fx;
    out[outOff + c] = clampByteVal(v0 * (1 - fy) + v1 * fy);
  }
}

function applyMagickShear(img: RgbaImage, geomStr: string, bg: RgbaColor): RgbaImage {
  const g = parseMagickGeometry(geomStr);
  const degX = g.width ?? 0;
  const degY = g.height ?? 0;
  const tanX = Math.tan((degX * Math.PI) / 180);
  const tanY = Math.tan((degY * Math.PI) / 180);
  const outW = Math.max(1, Math.round(img.width + Math.abs(tanX) * img.height));
  const outH = Math.max(1, Math.round(img.height + Math.abs(tanY) * img.width));
  const out = new Uint8Array(outW * outH * 4);
  const cxSrc = (img.width - 1) / 2;
  const cySrc = (img.height - 1) / 2;
  const cxDst = (outW - 1) / 2;
  const cyDst = (outH - 1) / 2;
  const det = 1 - tanX * tanY || 1;

  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const dx = x - cxDst;
      const dy = y - cyDst;
      const sx = cxSrc + (dx - tanX * dy) / det;
      const sy = cySrc + (dy - tanY * dx) / det;
      sampleBilinear(img, sx, sy, bg, out, (y * outW + x) * 4);
    }
  }
  return { ...img, width: outW, height: outH, data: out, hasAlpha: true };
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

function applyMagickDistort(img: RgbaImage, methodRaw: string, argsRaw: string, bg: RgbaColor): RgbaImage {
  const method = methodRaw.toLowerCase().replace(/[-_]/g, "");
  const nums = argsRaw
    .trim()
    .split(/[\s,]+/)
    .filter((s) => s.length > 0)
    .map(Number);
  const w = img.width;
  const h = img.height;
  const out = new Uint8Array(w * h * 4);

  if (method === "srt" || method === "scalerotatetranslate") {
    let cx = (w - 1) / 2;
    let cy = (h - 1) / 2;
    let scaleX = 1;
    let scaleY = 1;
    let angleDeg = 0;
    let nx = cx;
    let ny = cy;
    if (nums.length === 1) {
      angleDeg = nums[0]!;
    } else if (nums.length === 2) {
      scaleX = scaleY = nums[0] || 1;
      angleDeg = nums[1]!;
    } else if (nums.length === 3) {
      cx = nx = nums[0]!;
      cy = ny = nums[1]!;
      angleDeg = nums[2]!;
    } else if (nums.length === 4) {
      cx = nx = nums[0]!;
      cy = ny = nums[1]!;
      scaleX = scaleY = nums[2] || 1;
      angleDeg = nums[3]!;
    } else if (nums.length === 5) {
      cx = nx = nums[0]!;
      cy = ny = nums[1]!;
      scaleX = nums[2] || 1;
      scaleY = nums[3] || 1;
      angleDeg = nums[4]!;
    } else if (nums.length === 6) {
      cx = nums[0]!;
      cy = nums[1]!;
      scaleX = scaleY = nums[2] || 1;
      angleDeg = nums[3]!;
      nx = nums[4]!;
      ny = nums[5]!;
    } else if (nums.length >= 7) {
      cx = nums[0]!;
      cy = nums[1]!;
      scaleX = nums[2] || 1;
      scaleY = nums[3] || 1;
      angleDeg = nums[4]!;
      nx = nums[5]!;
      ny = nums[6]!;
    }
    const rad = (angleDeg * Math.PI) / 180;
    const cosA = Math.cos(rad);
    const sinA = Math.sin(rad);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = x - nx;
        const dy = y - ny;
        const sx = cx + (dx * cosA + dy * sinA) / scaleX;
        const sy = cy + (-dx * sinA + dy * cosA) / scaleY;
        sampleBilinear(img, sx, sy, bg, out, (y * w + x) * 4);
      }
    }
    return { ...img, data: out, hasAlpha: true };
  }

  if ((method === "perspective" && nums.length >= 16) || (method === "perspectiveprojection" && nums.length >= 8)) {
    let hCoeff: number[];
    if (method === "perspectiveprojection") {
      hCoeff = nums.slice(0, 8);
    } else {
      // Solve inverse homography mapping dst (dx, dy) -> src (sx, sy)
      const A: number[][] = [];
      const bVec: number[] = [];
      for (let p = 0; p < 4; p++) {
        const sx = nums[p * 4]!;
        const sy = nums[p * 4 + 1]!;
        const dx = nums[p * 4 + 2]!;
        const dy = nums[p * 4 + 3]!;
        A.push([dx, dy, 1, 0, 0, 0, -dx * sx, -dy * sx]);
        bVec.push(sx);
        A.push([0, 0, 0, dx, dy, 1, -dx * sy, -dy * sy]);
        bVec.push(sy);
      }
      hCoeff = solveLinearSystem(A, bVec);
    }
    if (hCoeff.every((c) => Math.abs(c) < 1e-12)) {
      return img;
    }
    const [c0, c1, c2, c3, c4, c5, c6, c7] = hCoeff as [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number
    ];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const denom = c6 * x + c7 * y + 1 || 1e-9;
        const sx = (c0 * x + c1 * y + c2) / denom;
        const sy = (c3 * x + c4 * y + c5) / denom;
        sampleBilinear(img, sx, sy, bg, out, (y * w + x) * 4);
      }
    }
    return { ...img, data: out, hasAlpha: true };
  }

  if (method === "affine" && nums.length >= 12) {
    const A: number[][] = [];
    const bx: number[] = [];
    const by: number[] = [];
    for (let p = 0; p < 3; p++) {
      const sx = nums[p * 4]!;
      const sy = nums[p * 4 + 1]!;
      const dx = nums[p * 4 + 2]!;
      const dy = nums[p * 4 + 3]!;
      A.push([dx, dy, 1]);
      bx.push(sx);
      by.push(sy);
    }
    const rx = solveLinearSystem(A, bx);
    const ry = solveLinearSystem(A, by);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const sx = rx[0]! * x + rx[1]! * y + rx[2]!;
        const sy = ry[0]! * x + ry[1]! * y + ry[2]!;
        sampleBilinear(img, sx, sy, bg, out, (y * w + x) * 4);
      }
    }
    return { ...img, data: out, hasAlpha: true };
  }

  if (method === "barrel" && nums.length >= 3) {
    const A = nums[0] ?? 0;
    const B = nums[1] ?? 0;
    const C = nums[2] ?? 0;
    const D = nums[3] ?? 1 - A - B - C;
    const cx = nums[4] ?? (w - 1) / 2;
    const cy = nums[5] ?? (h - 1) / 2;
    const rNorm = Math.min(w, h) / 2;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = (x - cx) / rNorm;
        const dy = (y - cy) / rNorm;
        const r = Math.hypot(dx, dy);
        const factor = A * r * r * r + B * r * r + C * r + D;
        const sx = cx + dx * factor * rNorm;
        const sy = cy + dy * factor * rNorm;
        sampleBilinear(img, sx, sy, bg, out, (y * w + x) * 4);
      }
    }
    return { ...img, data: out, hasAlpha: true };
  }

  return img;
}

function applyMagickSwirl(img: RgbaImage, degrees: number, bg: RgbaColor): RgbaImage {
  const w = img.width;
  const h = img.height;
  const out = new Uint8Array(w * h * 4);
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;
  const maxR = Math.max(cx, cy, 1);
  const radTotal = (degrees * Math.PI) / 180;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const r = Math.hypot(dx, dy);
      if (r < maxR) {
        const factor = 1 - r / maxR;
        const angle = factor * factor * radTotal;
        const cosA = Math.cos(angle);
        const sinA = Math.sin(angle);
        const sx = cx + dx * cosA - dy * sinA;
        const sy = cy + dx * sinA + dy * cosA;
        sampleBilinear(img, sx, sy, bg, out, (y * w + x) * 4);
      } else {
        sampleBilinear(img, x, y, bg, out, (y * w + x) * 4);
      }
    }
  }
  return { ...img, data: out };
}

function applyMagickImplode(img: RgbaImage, amount: number, bg: RgbaColor): RgbaImage {
  const w = img.width;
  const h = img.height;
  const out = new Uint8Array(w * h * 4);
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;
  const maxR = Math.min(cx, cy, 1);
  const clamped = Math.max(-0.95, Math.min(0.95, amount));
  const exp = 1 / (1 - clamped);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const r = Math.hypot(dx, dy);
      if (r < maxR && r > 0) {
        const newR = maxR * Math.pow(r / maxR, exp);
        const scale = newR / r;
        sampleBilinear(img, cx + dx * scale, cy + dy * scale, bg, out, (y * w + x) * 4);
      } else {
        sampleBilinear(img, x, y, bg, out, (y * w + x) * 4);
      }
    }
  }
  return { ...img, data: out };
}

function applyMagickWave(img: RgbaImage, geomStr: string, bg: RgbaColor): RgbaImage {
  const g = parseMagickGeometry(geomStr);
  const amp = g.width ?? 5;
  const waveLen = Math.max(1, g.height ?? 50);
  const extraH = Math.round(Math.abs(amp) * 2);
  const outW = img.width;
  const outH = img.height + extraH;
  const out = new Uint8Array(outW * outH * 4);
  const yPad = Math.abs(amp);

  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const sy = y - yPad - amp * Math.sin((2 * Math.PI * x) / waveLen);
      sampleBilinear(img, x, sy, bg, out, (y * outW + x) * 4);
    }
  }
  return { ...img, width: outW, height: outH, data: out, hasAlpha: true };
}

function applyMagickShadow(img: RgbaImage, geomStr: string, shadowColor: RgbaColor): RgbaImage {
  const g = parseMagickGeometry(geomStr);
  const opacity = Math.max(0, Math.min(100, g.width ?? 80)) / 100;
  const sigma = Math.max(0.5, g.height ?? 3);
  const pad = Math.max(2, Math.ceil(sigma * 2) + Math.max(Math.abs(g.x), Math.abs(g.y)));
  const outW = img.width + pad * 2;
  const outH = img.height + pad * 2;
  const data = new Uint8Array(outW * outH * 4);
  const offX = pad + Math.round(g.x);
  const offY = pad + Math.round(g.y);

  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const dx = x + offX;
      const dy = y + offY;
      if (dx < 0 || dy < 0 || dx >= outW || dy >= outH) continue;
      const srcA = img.data[(y * img.width + x) * 4 + 3]!;
      const dstIdx = (dy * outW + dx) * 4;
      data[dstIdx] = shadowColor.r;
      data[dstIdx + 1] = shadowColor.g;
      data[dstIdx + 2] = shadowColor.b;
      data[dstIdx + 3] = clampByteVal(srcA * opacity);
    }
  }
  const shadowBase: RgbaImage = {
    ...img,
    width: outW,
    height: outH,
    data,
    hasAlpha: true
  };
  return blurImage(shadowBase, sigma);
}

function applyMagickVignette(img: RgbaImage, _geomStr: string, bg: RgbaColor): RgbaImage {
  const w = img.width;
  const h = img.height;
  const out = new Uint8Array(img.data);
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const nx = (x - cx) / Math.max(1, cx);
      const ny = (y - cy) / Math.max(1, cy);
      const d = Math.hypot(nx, ny);
      const t = Math.max(0, Math.min(1, (d - 0.65) / 0.55));
      const idx = (y * w + x) * 4;
      out[idx] = clampByteVal(out[idx]! * (1 - t) + bg.r * t);
      out[idx + 1] = clampByteVal(out[idx + 1]! * (1 - t) + bg.g * t);
      out[idx + 2] = clampByteVal(out[idx + 2]! * (1 - t) + bg.b * t);
    }
  }
  return { ...img, data: out };
}

function applyMagickSepiaTone(img: RgbaImage, threshStr: string): RgbaImage {
  const raw = parseFloat(threshStr);
  const strength = Math.max(0, Math.min(1, (threshStr.endsWith("%") ? raw : raw / 255) / 100 || 0.8));
  const out = new Uint8Array(img.data);
  for (let i = 0; i < out.length; i += 4) {
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

function applyMagickSolarize(img: RgbaImage, threshStr: string): RgbaImage {
  const raw = parseFloat(threshStr);
  const thresh = threshStr.endsWith("%") ? (raw / 100) * 255 : raw;
  const out = new Uint8Array(img.data);
  for (let i = 0; i < out.length; i += 4) {
    if (out[i]! > thresh) out[i] = 255 - out[i]!;
    if (out[i + 1]! > thresh) out[i + 1] = 255 - out[i + 1]!;
    if (out[i + 2]! > thresh) out[i + 2] = 255 - out[i + 2]!;
  }
  return { ...img, data: out };
}

function applyMagickPosterize(img: RgbaImage, levelsRaw: number): RgbaImage {
  const levels = Math.max(2, Math.min(256, Math.round(levelsRaw)));
  const step = 255 / (levels - 1);
  const out = new Uint8Array(img.data);
  for (let i = 0; i < out.length; i += 4) {
    out[i] = clampByteVal(Math.round((out[i]! / 255) * (levels - 1)) * step);
    out[i + 1] = clampByteVal(Math.round((out[i + 1]! / 255) * (levels - 1)) * step);
    out[i + 2] = clampByteVal(Math.round((out[i + 2]! / 255) * (levels - 1)) * step);
  }
  return { ...img, data: out };
}

function applyMagickConvolve3x3(img: RgbaImage, kernel: readonly number[], bias = 0): RgbaImage {
  const w = img.width;
  const h = img.height;
  const out = new Uint8Array(img.data);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 3; c++) {
        let sum = bias;
        let kIdx = 0;
        for (let ky = -1; ky <= 1; ky++) {
          const sy = Math.max(0, Math.min(h - 1, y + ky));
          for (let kx = -1; kx <= 1; kx++) {
            const sx = Math.max(0, Math.min(w - 1, x + kx));
            sum += img.data[(sy * w + sx) * 4 + c]! * kernel[kIdx++]!;
          }
        }
        out[(y * w + x) * 4 + c] = clampByteVal(sum);
      }
    }
  }
  return { ...img, data: out };
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

function applyMagickCompositeLayer(
  dst: RgbaImage,
  src: RgbaImage,
  modeRaw: string,
  left: number,
  top: number,
  composeArgs?: string
): RgbaImage {
  const norm = modeRaw.toLowerCase().replace(/[-_\s]/g, "");
  const out = new Uint8Array(dst.data);
  const dw = dst.width;
  const dh = dst.height;
  const sw = src.width;
  const sh = src.height;

  for (let sy = 0; sy < sh; sy++) {
    const dy = top + sy;
    if (dy < 0 || dy >= dh) continue;
    for (let sx = 0; sx < sw; sx++) {
      const dx = left + sx;
      if (dx < 0 || dx >= dw) continue;
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
        } else {
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
      if (
        norm === "multiply" ||
        norm === "screen" ||
        norm === "overlay" ||
        norm === "darken" ||
        norm === "lighten" ||
        norm === "exclusion"
      ) {
        const gamma = sa + da - sa * da;
        const sChan = [sr / 255, sg / 255, sb / 255];
        const dChan = [dr / 255, dg / 255, db / 255];
        for (let c = 0; c < 3; c++) {
          const sc = sChan[c]!;
          const dc = dChan[c]!;
          if (norm === "darken") {
            const comp = Math.min(sc * sa, dc * da) + sc * sa * (1 - da) + dc * da * (1 - sa);
            out[dIdx + c] = clampByteVal(comp * 255);
          } else if (norm === "lighten") {
            const comp = Math.max(sc, dc) * sa * da + sc * sa * (1 - da) + dc * da * (1 - sa);
            out[dIdx + c] = clampByteVal(comp * 255);
          } else if (norm === "exclusion") {
            const comp = gamma * (sc * sa + dc - 2 * sc * dc * sa);
            out[dIdx + c] = clampByteVal(comp * 255);
          } else {
            let f = 0;
            if (norm === "multiply") f = sc * dc;
            else if (norm === "screen") f = sc + dc - sc * dc;
            else f = dc <= 0.5 ? 2 * sc * dc : 1 - 2 * (1 - sc) * (1 - dc);
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

  if (
    norm === "over" ||
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
    norm === "saturate"
  ) {
    return compositeImage(dst, [rgbaToCompositeLayer(src, left, top, parseCompose(modeRaw))]);
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

function createSolidRgbaImage(width: number, height: number, color: RgbaColor): RgbaImage {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const idx = i * 4;
    data[idx] = color.r;
    data[idx + 1] = color.g;
    data[idx + 2] = color.b;
    data[idx + 3] = color.a;
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

function createLabelImage(text: string, state: MagickState): RgbaImage {
  const fontSize = Math.max(8, state.pointsize);
  const w = state.hasSize ? state.sizeWidth : Math.max(16, Math.ceil(text.length * fontSize * 0.65) + 8);
  const h = state.hasSize ? state.sizeHeight : Math.max(12, Math.ceil(fontSize * 1.4));
  const bg = state.background.a > 0 ? `<rect width="${w}" height="${h}" fill="${rgbaToCss(state.background)}"/>` : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${bg}<text x="2" y="${Math.round(h * 0.75)}" font-size="${fontSize}" fill="${rgbaToCss(state.fill)}">${escapeXml(text)}</text></svg>`;
  return decodeImage(new TextEncoder().encode(svg), { density: state.density });
}

function applyMagickResize(img: RgbaImage, geomStr: string, kernel: ResizeKernel): RgbaImage {
  const g = parseMagickGeometry(geomStr);
  const srcW = img.width;
  const srcH = img.height;

  let targetW: number;
  let targetH: number;

  if (g.areaLimit !== undefined) {
    const currentArea = srcW * srcH;
    const scale = Math.sqrt(g.areaLimit / Math.max(1, currentArea));
    if (g.shrinkOnly && scale >= 1) return img;
    if (g.enlargeOnly && scale <= 1) return img;
    targetW = Math.max(1, Math.round(srcW * scale));
    targetH = Math.max(1, Math.round(srcH * scale));
  } else if (g.isPercent) {
    const sx = (g.percentX ?? 100) / 100;
    const sy = (g.percentY ?? 100) / 100;
    targetW = Math.max(1, Math.round(srcW * sx));
    targetH = Math.max(1, Math.round(srcH * sy));
  } else if (g.forceExact) {
    targetW = Math.max(1, Math.round(g.width ?? srcW));
    targetH = Math.max(1, Math.round(g.height ?? srcH));
    if (g.shrinkOnly && srcW <= targetW && srcH <= targetH) return img;
    if (g.enlargeOnly && srcW >= targetW && srcH >= targetH) return img;
  } else if (g.fillArea) {
    const boxW = g.width ?? srcW;
    const boxH = g.height ?? srcH;
    if (g.shrinkOnly && srcW <= boxW && srcH <= boxH) return img;
    if (g.enlargeOnly && srcW >= boxW && srcH >= boxH) return img;
    const scale = Math.max(boxW / srcW, boxH / srcH);
    targetW = Math.max(1, Math.round(srcW * scale));
    targetH = Math.max(1, Math.round(srcH * scale));
  } else {
    const boxW = g.width;
    const boxH = g.height;
    if (boxW !== undefined && boxH !== undefined) {
      if (g.shrinkOnly && srcW <= boxW && srcH <= boxH) return img;
      if (g.enlargeOnly && srcW >= boxW && srcH >= boxH) return img;
      const scale = Math.min(boxW / srcW, boxH / srcH);
      targetW = Math.max(1, Math.round(srcW * scale));
      targetH = Math.max(1, Math.round(srcH * scale));
    } else if (boxW !== undefined) {
      if (g.shrinkOnly && srcW <= boxW) return img;
      if (g.enlargeOnly && srcW >= boxW) return img;
      const scale = boxW / srcW;
      targetW = Math.max(1, Math.round(boxW));
      targetH = Math.max(1, Math.round(srcH * scale));
    } else if (boxH !== undefined) {
      if (g.shrinkOnly && srcH <= boxH) return img;
      if (g.enlargeOnly && srcH >= boxH) return img;
      const scale = boxH / srcH;
      targetW = Math.max(1, Math.round(srcW * scale));
      targetH = Math.max(1, Math.round(boxH));
    } else {
      return img;
    }
  }

  return resizeImage(img, {
    width: targetW,
    height: targetH,
    fit: "fill",
    position: "center",
    kernel,
    background: { r: 0, g: 0, b: 0, a: 0 },
    withoutEnlargement: false,
    withoutReduction: false
  });
}

function applyMagickCrop(img: RgbaImage, geomStr: string, gravity: GravityPosition): RgbaImage {
  return applyMagickCropToStack(img, geomStr, gravity)[0]!;
}

function applyMagickCropToStack(
  img: RgbaImage,
  geomStr: string,
  gravity: GravityPosition
): RgbaImage[] {
  const g = parseMagickGeometry(geomStr);
  if (g.isSubdivide) {
    const cols = Math.max(1, Math.round(g.width ?? 1));
    const rows = Math.max(1, Math.round(g.height ?? 1));
    const tiles: RgbaImage[] = [];
    for (let r = 0; r < rows; r++) {
      const top = Math.min(img.height - 1, Math.round((r * img.height) / rows));
      const nextTop = Math.max(top + 1, Math.min(img.height, Math.round(((r + 1) * img.height) / rows)));
      const h = nextTop - top;
      for (let c = 0; c < cols; c++) {
        const left = Math.min(img.width - 1, Math.round((c * img.width) / cols));
        const nextLeft = Math.max(left + 1, Math.min(img.width, Math.round(((c + 1) * img.width) / cols)));
        const w = nextLeft - left;
        tiles.push(extractImage(img, { left, top, width: w, height: h }));
      }
    }
    return tiles;
  }
  const rawW = g.isPercent
    ? Math.max(1, Math.round((img.width * (g.percentX ?? 100)) / 100))
    : Math.max(1, Math.round(g.width ?? img.width));
  const rawH = g.isPercent
    ? Math.max(1, Math.round((img.height * (g.percentY ?? 100)) / 100))
    : Math.max(1, Math.round(g.height ?? img.height));

  const { x: x0, y: y0 } = gravityAdjustBox(img.width, img.height, rawW, rawH, g.x, g.y, gravity);
  if (x0 === img.width || y0 === img.height) {
    return [img];
  }
  const ix0 = Math.max(0, x0);
  const iy0 = Math.max(0, y0);
  const ix1 = Math.min(img.width, x0 + rawW);
  const iy1 = Math.min(img.height, y0 + rawH);
  if (ix1 <= ix0 || iy1 <= iy0) {
    return [extractImage(img, { left: 0, top: 0, width: 1, height: 1 })];
  }
  return [
    extractImage(img, {
      left: ix0,
      top: iy0,
      width: ix1 - ix0,
      height: iy1 - iy0
    })
  ];
}

function applyMagickExtent(img: RgbaImage, geomStr: string, state: MagickState): RgbaImage {
  const g = parseMagickGeometry(geomStr);
  const targetW = Math.max(1, Math.round(g.width ?? img.width));
  const targetH = Math.max(1, Math.round(g.height ?? img.height));
  const canvas = createSolidRgbaImage(targetW, targetH, state.background);
  const offset = resolveGravityOffset(targetW - img.width, targetH - img.height, state.gravity);
  const isEast = state.gravity === "east" || state.gravity === "northeast" || state.gravity === "southeast";
  const isSouth = state.gravity === "south" || state.gravity === "southwest" || state.gravity === "southeast";
  const left = Math.round(offset.left - (isEast ? -g.x : g.x));
  const top = Math.round(offset.top - (isSouth ? -g.y : g.y));
  const dstX0 = Math.max(0, left);
  const dstY0 = Math.max(0, top);
  const dstX1 = Math.min(targetW, left + img.width);
  const dstY1 = Math.min(targetH, top + img.height);
  if (dstX1 <= dstX0 || dstY1 <= dstY0) {
    return canvas;
  }
  const subImg = extractImage(img, {
    left: dstX0 - left,
    top: dstY0 - top,
    width: dstX1 - dstX0,
    height: dstY1 - dstY0
  });
  return compositeImage(canvas, [rgbaToCompositeLayer(subImg, dstX0, dstY0, "over")]);
}

function applyMagickDraw(img: RgbaImage, drawCmd: string, state: MagickState): RgbaImage {
  const svgElements: string[] = [];
  let fill = rgbaToCss(state.fill);
  let stroke = rgbaToCss(state.stroke);
  let strokeWidth = state.strokeWidth;

  const tokenRe = /'([^']*)'|"([^"]*)"|([^\s,]+)|,/g;
  const tokens: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(drawCmd)) !== null) {
    if (m[0] === ",") continue;
    tokens.push(m[1] ?? m[2] ?? m[3] ?? "");
  }

  let i = 0;
  const num = () => Number(tokens[i++] ?? 0);
  while (i < tokens.length) {
    const cmd = tokens[i++]!.toLowerCase();
    if (cmd === "fill") {
      fill = rgbaToCss(parseColor(tokens[i++] ?? "#000000"));
    } else if (cmd === "stroke") {
      stroke = rgbaToCss(parseColor(tokens[i++] ?? "#000000"));
    } else if (cmd === "stroke-width" || cmd === "strokewidth") {
      strokeWidth = Math.max(0, num());
    } else if (cmd === "rectangle") {
      const x0 = num();
      const y0 = num();
      const x1 = num();
      const y1 = num();
      const rx = Math.min(x0, x1);
      const ry = Math.min(y0, y1);
      const rw = Math.max(1, Math.abs(x1 - x0) + 1);
      const rh = Math.max(1, Math.abs(y1 - y0) + 1);
      if (fill !== "none") {
        svgElements.push(
          `<rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" fill="${fill}"/>`
        );
      }
      if (stroke !== "none" && strokeWidth > 0) {
        svgElements.push(
          `<polygon points="${rx},${ry} ${rx + rw - 1},${ry} ${rx + rw - 1},${ry + rh - 1} ${rx},${ry + rh - 1}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}"/>`
        );
      }
    } else if (cmd === "roundrectangle") {
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
        svgElements.push(
          `<rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" rx="${wc}" ry="${hc}" fill="${fill}"/>`
        );
      }
      if (stroke !== "none" && strokeWidth > 0) {
        svgElements.push(
          `<polygon points="${rx},${ry} ${rx + rw - 1},${ry} ${rx + rw - 1},${ry + rh - 1} ${rx},${ry + rh - 1}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}"/>`
        );
      }
    } else if (cmd === "circle") {
      const cx = num();
      const cy = num();
      const px = num();
      const py = num();
      const r = Math.max(1, Math.hypot(px - cx, py - cy));
      svgElements.push(
        `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`
      );
    } else if (cmd === "ellipse") {
      const cx = num();
      const cy = num();
      const rx = num();
      const ry = num();
      num();
      num();
      svgElements.push(
        `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`
      );
    } else if (cmd === "line") {
      const x0 = num();
      const y0 = num();
      const x1 = num();
      const y1 = num();
      const lineStroke = stroke === "none" ? fill : stroke;
      svgElements.push(
        `<line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" stroke="${lineStroke}" stroke-width="${Math.max(1, strokeWidth)}"/>`
      );
    } else if (cmd === "point") {
      const x = num();
      const y = num();
      svgElements.push(`<rect x="${x}" y="${y}" width="1" height="1" fill="${fill}"/>`);
    } else if (cmd === "text") {
      const x = num();
      const y = num();
      const txt = tokens[i++] ?? "";
      svgElements.push(
        `<text x="${x}" y="${y}" font-size="${state.pointsize}" fill="${fill}">${escapeXml(txt)}</text>`
      );
    } else if (cmd === "polygon" || cmd === "polyline") {
      const pts: string[] = [];
      while (i < tokens.length && !Number.isNaN(Number(tokens[i]))) {
        const px = num();
        const py = num();
        pts.push(`${px},${py}`);
      }
      if (pts.length >= 2) {
        if (cmd === "polygon") {
          svgElements.push(
            `<polygon points="${pts.join(" ")}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`
          );
        } else {
          const lineStroke = stroke === "none" ? fill : stroke;
          svgElements.push(
            `<polyline points="${pts.join(" ")}" fill="none" stroke="${lineStroke}" stroke-width="${Math.max(1, strokeWidth)}"/>`
          );
        }
      }
    } else if (cmd === "bezier") {
      const pts: Array<{ x: number; y: number }> = [];
      while (i < tokens.length && !Number.isNaN(Number(tokens[i]))) {
        pts.push({ x: num(), y: num() });
      }
      if (pts.length === 3) {
        const lineStroke = stroke === "none" ? fill : stroke;
        svgElements.push(
          `<path d="M ${pts[0]!.x} ${pts[0]!.y} Q ${pts[1]!.x} ${pts[1]!.y} ${pts[2]!.x} ${pts[2]!.y}" fill="none" stroke="${lineStroke}" stroke-width="${Math.max(1, strokeWidth)}"/>`
        );
      } else if (pts.length >= 4) {
        const lineStroke = stroke === "none" ? fill : stroke;
        const rest = pts.slice(1).map((p) => `${p.x} ${p.y}`).join(" ");
        svgElements.push(
          `<path d="M ${pts[0]!.x} ${pts[0]!.y} C ${rest}" fill="none" stroke="${lineStroke}" stroke-width="${Math.max(1, strokeWidth)}"/>`
        );
      }
    } else if (cmd === "path") {
      const d = tokens[i++] ?? "";
      svgElements.push(
        `<path d="${escapeXml(d)}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`
      );
    }
  }

  if (svgElements.length === 0) return img;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${img.width}" height="${img.height}">${svgElements.join("")}</svg>`;
  const overlay = decodeImage(new TextEncoder().encode(svg), { density: state.density });
  return compositeImage(img, [rgbaToCompositeLayer(overlay, 0, 0, "over")]);
}

function applyMagickAnnotate(img: RgbaImage, offsetStr: string, text: string, state: MagickState): RgbaImage {
  const g = parseMagickGeometry(offsetStr);
  const fontSize = Math.max(8, state.pointsize);
  const estW = Math.max(8, Math.ceil(text.length * fontSize * 0.6));
  const estH = Math.max(8, Math.ceil(fontSize));
  const gravOff = resolveGravityOffset(img.width - estW, img.height - estH, state.gravity);
  const x = Math.max(0, gravOff.left + g.x);
  const y = Math.max(fontSize, gravOff.top + estH + g.y);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${img.width}" height="${img.height}"><text x="${x}" y="${y}" font-size="${fontSize}" fill="${rgbaToCss(state.fill)}">${escapeXml(text)}</text></svg>`;
  const overlay = decodeImage(new TextEncoder().encode(svg), { density: state.density });
  return compositeImage(img, [rgbaToCompositeLayer(overlay, 0, 0, "over")]);
}

function appendStackImages(stack: RgbaImage[], vertical: boolean, state: MagickState): RgbaImage {
  if (stack.length === 0) {
    return createSolidRgbaImage(1, 1, state.background);
  }
  if (stack.length === 1) return stack[0]!;

  const totalW = vertical
    ? Math.max(...stack.map((im) => im.width))
    : stack.reduce((acc, im) => acc + im.width, 0);
  const totalH = vertical
    ? stack.reduce((acc, im) => acc + im.height, 0)
    : Math.max(...stack.map((im) => im.height));

  const canvas = createSolidRgbaImage(totalW, totalH, state.background);
  const layers = [];
  let cursor = 0;
  for (const im of stack) {
    if (vertical) {
      const off = resolveGravityOffset(totalW - im.width, 0, state.gravity);
      layers.push(rgbaToCompositeLayer(im, off.left, cursor, "over"));
      cursor += im.height;
    } else {
      const off = resolveGravityOffset(0, totalH - im.height, state.gravity);
      layers.push(rgbaToCompositeLayer(im, cursor, off.top, "over"));
      cursor += im.width;
    }
  }
  return compositeImage(canvas, layers);
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

function parseInputOperand(
  token: string,
  files: Map<string, Uint8Array>,
  state: MagickState,
  stdinBytes?: Uint8Array
): RgbaImage | undefined {
  const list = parseInputOperands(token, files, state, stdinBytes);
  return list?.[0];
}

function applyInlineReadModifier(img: RgbaImage, inlineGeom: string, kernel: ResizeKernel): RgbaImage {
  const g = parseMagickGeometry(inlineGeom);
  if (g.hasOffset) {
    return applyMagickCrop(img, inlineGeom, "northwest");
  }
  return applyMagickResize(img, inlineGeom, kernel);
}

function parseInputOperands(
  token: string,
  files: Map<string, Uint8Array>,
  state: MagickState,
  stdinBytes?: Uint8Array
): RgbaImage[] | undefined {
  let baseToken = token;
  let pageSpec: string | undefined;
  let inlineGeom: string | undefined;
  const bracketMatch = /^(.*)\[([^\]]+)\]$/.exec(baseToken);
  if (bracketMatch) {
    baseToken = bracketMatch[1]!;
    const inside = bracketMatch[2]!;
    if (/^-?\d+$/.test(inside) || /^-?\d+--?\d+$/.test(inside) || /^-?\d+(,-?\d+)+$/.test(inside)) {
      pageSpec = inside;
    } else {
      inlineGeom = inside;
    }
  }

  const applyMod = (imgs: RgbaImage[]): RgbaImage[] =>
    inlineGeom ? imgs.map((im) => applyInlineReadModifier(im, inlineGeom, state.kernel)) : imgs;

  const lower = baseToken.toLowerCase();
  if (lower.startsWith("tile:")) {
    const patterns = parseInputOperands(baseToken.slice(5), files, state, stdinBytes);
    if (!patterns) return undefined;
    return applyMod(patterns.map(pattern => {
      const tiled = createSolidRgbaImage(state.sizeWidth, state.sizeHeight, state.background);
      for (let y = 0; y < tiled.height; y++) {
        for (let x = 0; x < tiled.width; x++) {
          const source = ((y % pattern.height) * pattern.width + x % pattern.width) * 4;
          tiled.data.set(pattern.data.subarray(source, source + 4), (y * tiled.width + x) * 4);
        }
      }
      return tiled;
    }));
  }
  if (lower.startsWith("xc:") || lower.startsWith("canvas:")) {
    const colorStr = baseToken.slice(baseToken.indexOf(":") + 1) || "white";
    const c = parseColor(colorStr);
    return applyMod([createSolidRgbaImage(state.sizeWidth, state.sizeHeight, c)]);
  }
  if (lower.startsWith("gradient:") || lower.startsWith("radial-gradient:")) {
    const radial = lower.startsWith("radial-gradient:");
    const spec = baseToken.slice(baseToken.indexOf(":") + 1);
    const [c1Str, c2Str] = spec ? spec.split("-") : [];
    const c1 = parseColor(c1Str || "#ffffff");
    const c2 = parseColor(c2Str || "#000000");
    return applyMod([createGradientImage(state.sizeWidth, state.sizeHeight, c1, c2, radial)]);
  }
  if (lower.startsWith("pattern:") || lower.startsWith("plasma:")) {
    return applyMod([createCheckerboardImage(state.sizeWidth, state.sizeHeight)]);
  }
  if (lower === "rose:" || lower === "logo:" || lower === "wizard:" || lower === "granite:") {
    return applyMod([createRoseImage()]);
  }
  if (lower.startsWith("label:") || lower.startsWith("caption:")) {
    const text = baseToken.slice(baseToken.indexOf(":") + 1);
    return applyMod([createLabelImage(text, state)]);
  }
  if (lower === "null:") {
    return applyMod([createSolidRgbaImage(1, 1, { r: 0, g: 0, b: 0, a: 0 })]);
  }

  let cleanToken = baseToken;
  const prefixMatch = /^([a-zA-Z0-9]+):(.*)$/.exec(cleanToken);
  if (prefixMatch && extToImageFormat(prefixMatch[1]!)) {
    cleanToken = prefixMatch[2]!;
  }

  const rawBytes = cleanToken === "-" ? stdinBytes : files.get(cleanToken) ?? files.get(token);
  if (!rawBytes) return undefined;

  let totalPages = 1;
  try {
    const meta = readImageMetadata(rawBytes);
    if (meta.pages && meta.pages > 1) totalPages = meta.pages;
  } catch {
    totalPages = 1;
  }

  const resolveIdx = (n: number): number =>
    n < 0 ? Math.max(0, totalPages + n) : Math.min(Math.max(0, n), Math.max(0, totalPages - 1));

  let pageIndices: number[];
  if (pageSpec !== undefined) {
    if (/^-?\d+$/.test(pageSpec)) {
      pageIndices = [resolveIdx(parseInt(pageSpec, 10))];
    } else if (/^-?\d+--?\d+$/.test(pageSpec)) {
      const m = /^(-?\d+)-(-?\d+)$/.exec(pageSpec)!;
      const start = resolveIdx(parseInt(m[1]!, 10));
      const end = resolveIdx(parseInt(m[2]!, 10));
      pageIndices = [];
      if (start <= end) {
        for (let p = start; p <= end; p++) pageIndices.push(p);
      } else {
        for (let p = start; p >= end; p--) pageIndices.push(p);
      }
    } else {
      pageIndices = pageSpec.split(",").map((s) => resolveIdx(parseInt(s, 10)));
    }
  } else if (totalPages > 1) {
    pageIndices = Array.from({ length: totalPages }, (_, idx) => idx);
  } else {
    pageIndices = [0];
  }

  const results: RgbaImage[] = [];
  for (const pageIdx of pageIndices) {
    let img = decodeImage(rawBytes, {
      density: state.density,
      ...(totalPages > 1 || pageSpec !== undefined ? { page: pageIdx } : {})
    });
    if (inlineGeom) {
      img = applyInlineReadModifier(img, inlineGeom, state.kernel);
    }
    results.push(img);
  }
  return results;
}

function formatIdentifyCustom(
  fmt: string,
  filePath: string,
  meta: ImageMetadata,
  byteLen: number,
  rawBytes?: Uint8Array
): string {
  const baseName = filePath.split("/").pop() ?? filePath;
  const rootName = baseName.replace(/\.[^.]+$/, "");
  const ext = baseName.includes(".") ? baseName.split(".").pop()! : "";
  const bitDepth = meta.depth === "ushort" ? "16" : meta.depth === "bit" ? "1" : "8";
  const space = meta.space === "b-w" ? "Gray" : meta.space === "cmyk" ? "CMYK" : "sRGB";
  let out = fmt
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/%w/g, String(meta.width))
    .replace(/%h/g, String(meta.height))
    .replace(/%m/g, meta.format.toUpperCase())
    .replace(/%z/g, bitDepth)
    .replace(/%q/g, bitDepth)
    .replace(/%r/g, `DirectClass ${space}`)
    .replace(/%f/g, baseName)
    .replace(/%t/g, rootName)
    .replace(/%e/g, ext)
    .replace(/%i/g, filePath)
    .replace(/%b/g, `${byteLen}B`)
    .replace(/%B/g, String(byteLen))
    .replace(/%x/g, String(meta.density ?? 72))
    .replace(/%y/g, String(meta.density ?? 72))
    .replace(/%n/g, String(meta.pages ?? 1))
    .replace(/%\[colorspace\]/gi, space);
  if (rawBytes && /%\[(fx:|pixel:|mean\]|min\]|max\])/i.test(out)) {
    out = formatMagickPropertyString(out, decodeImage(rawBytes));
  }
  return out;
}

export async function runIdentifyCli(
  argv: readonly string[],
  files: Map<string, Uint8Array>,
  stdinBytes?: Uint8Array
): Promise<ImageMagickCliResult> {
  let verbose = false;
  let customFormat: string | undefined;
  const targets: string[] = [];

  for (let i = 0; i < argv.length; i++) {
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
    } else if (a === "-ping" || a === "--ping") {
      // Metadata-first reading
    } else if (a === "-format" || a === "--format") {
      customFormat = argv[++i] ?? "";
    } else if (a === "-" || !a.startsWith("-")) {
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
  let exitCode = 0;

  for (const inPath of targets) {
    const bracketMatch = /^(.*)\[(\d+)\]$/.exec(inPath);
    let baseInPath = bracketMatch ? bracketMatch[1]! : inPath;
    const colon = baseInPath.indexOf(":");
    if (colon > 0 && extToImageFormat(baseInPath.slice(0, colon))) {
      baseInPath = baseInPath.slice(colon + 1);
    }
    const pageIdx = bracketMatch ? parseInt(bracketMatch[2]!, 10) : undefined;
    const bytes = baseInPath === "-" ? stdinBytes : files.get(inPath) ?? files.get(baseInPath);
    if (!bytes) {
      errParts.push(`identify: unable to open image '${inPath}': No such file or directory\n`);
      exitCode = 1;
      continue;
    }
    try {
      const inst = sharp(bytes, pageIdx !== undefined ? { page: pageIdx } : undefined);
      const meta = await inst.metadata();
      const bitDepth = meta.depth === "ushort" ? "16" : meta.depth === "bit" ? "1" : "8";
      const spaceLabel = meta.space === "b-w" ? "Gray" : meta.space === "cmyk" ? "CMYK" : "sRGB";

      if (customFormat !== undefined) {
        outParts.push(formatIdentifyCustom(customFormat, baseInPath, meta, bytes.byteLength, bytes));
      } else if (verbose) {
        const stats = await inst.stats();
        outParts.push(
          `Image: ${inPath}\n` +
            `  Format: ${meta.format.toUpperCase()}\n` +
            `  Geometry: ${meta.width}x${meta.height}+0+0\n` +
            `  Resolution: ${meta.density}x${meta.density}\n` +
            `  Colorspace: ${spaceLabel}\n` +
            `  Depth: ${bitDepth}-bit\n` +
            `  Channels: ${meta.channels}\n` +
            `  Alpha: ${meta.hasAlpha ? "True" : "False"}\n` +
            `  Filesize: ${bytes.byteLength}B\n` +
            `  Entropy: ${stats.entropy.toFixed(4)}\n`
        );
      } else {
        outParts.push(
          `${inPath} ${meta.format.toUpperCase()} ${meta.width}x${meta.height} ${meta.width}x${meta.height}+0+0 ${bitDepth}-bit ${spaceLabel} ${bytes.byteLength}B 0.000u 0:00.000\n`
        );
      }
    } catch (err) {
      errParts.push(`identify: improper image header '${inPath}': ${(err as Error).message}\n`);
      exitCode = 1;
    }
  }

  return {
    exitCode,
    stdout: outParts.join(""),
    stderr: errParts.join("")
  };
}

function parseMagickIndexSpec(spec: string, length: number): number[] {
  if (length <= 0) return [];
  const resolve = (n: number): number =>
    n < 0 ? Math.max(0, length + n) : Math.min(Math.max(0, n), length - 1);
  const out: number[] = [];
  for (const part of spec.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const rangeMatch = /^(-?\d+)-(-?\d+)$/.exec(trimmed);
    if (rangeMatch) {
      const s = resolve(parseInt(rangeMatch[1]!, 10));
      const e = resolve(parseInt(rangeMatch[2]!, 10));
      if (s <= e) {
        for (let k = s; k <= e; k++) out.push(k);
      } else {
        for (let k = s; k >= e; k--) out.push(k);
      }
    } else {
      const num = parseInt(trimmed, 10);
      if (!Number.isNaN(num)) {
        const idx = num < 0 ? length + num : num;
        if (idx >= 0 && idx < length) out.push(idx);
      }
    }
  }
  return out;
}

function evaluatePipelineTokens(
  tokens: readonly string[],
  files: Map<string, Uint8Array>,
  state: MagickState,
  parentStack: RgbaImage[] = [],
  stdinBytes?: Uint8Array
): RgbaImage[] {
  let stack: RgbaImage[] = [];
  let i = 0;

  while (i < tokens.length) {
    const t = tokens[i]!;

    if (t === "(") {
      let depth = 1;
      let j = i + 1;
      while (j < tokens.length && depth > 0) {
        if (tokens[j] === "(") depth++;
        else if (tokens[j] === ")") depth--;
        j++;
      }
      const endIdx = depth === 0 ? j - 1 : j;
      const subTokens = tokens.slice(i + 1, endIdx);
      const subState: MagickState = { ...state };
      const subResult = evaluatePipelineTokens(subTokens, files, subState, stack, stdinBytes);
      stack.push(...subResult);
      i = j;
      continue;
    }

    if (t === "-size") {
      const g = parseMagickGeometry(tokens[++i] ?? "1x1");
      state.sizeWidth = Math.max(1, Math.round(g.width ?? 1));
      state.sizeHeight = Math.max(1, Math.round(g.height ?? state.sizeWidth));
      state.hasSize = true;
    } else if (t === "+size") {
      state.hasSize = false;
    } else if (t === "-background") {
      state.background = parseColor(tokens[++i] ?? "#ffffff");
    } else if (t === "-fill") {
      state.fill = parseColor(tokens[++i] ?? "#000000");
    } else if (t === "-stroke") {
      state.stroke = parseColor(tokens[++i] ?? "#000000");
    } else if (t === "-strokewidth") {
      state.strokeWidth = Math.max(0, Number(tokens[++i] ?? 1));
    } else if (t === "-bordercolor") {
      state.borderColor = parseColor(tokens[++i] ?? "#dfdfdf");
    } else if (t === "-pointsize") {
      state.pointsize = Math.max(1, Number(tokens[++i] ?? 12));
    } else if (t === "-gravity") {
      state.gravity = parseGravity(tokens[++i] ?? "center");
    } else if (t === "+gravity") {
      state.gravity = "northwest";
    } else if (t === "-quality") {
      state.quality = Math.max(1, Math.min(100, Number(tokens[++i] ?? 92)));
    } else if (t === "-density") {
      const g = parseMagickGeometry(tokens[++i] ?? "72");
      state.density = Math.max(1, Math.round(g.width ?? 72));
    } else if (t === "-fuzz") {
      const rawFuzz = tokens[++i] ?? "10";
      state.fuzz = rawFuzz.endsWith("%")
        ? Math.round((parseFloat(rawFuzz) / 100) * 255)
        : Math.round(parseFloat(rawFuzz));
    } else if (t === "-filter") {
      state.kernel = parseKernel(tokens[++i] ?? "lanczos");
    } else if (t === "-compose") {
      const cRaw = tokens[++i] ?? "over";
      state.composeRaw = cRaw;
      state.compose = parseCompose(cRaw);
    } else if (t === "-define") {
      const defStr = tokens[++i] ?? "";
      const m = /^compose:args=(.*)$/i.exec(defStr);
      if (m) state.composeArgs = m[1]!;
    } else if (t === "-set") {
      const k = (tokens[++i] ?? "").toLowerCase();
      const v = tokens[++i] ?? "";
      if (k === "option:compose:args") state.composeArgs = v;
    } else if (t === "-write" || t === "+write") {
      const writePath = tokens[++i] ?? "";
      if (stack.length > 0 && writePath && writePath.toLowerCase() !== "null:") {
        const top = stack[stack.length - 1]!;
        const { format, path } = inferOutputFormat(writePath, top.format);
        if (stack.length > 1 && (/%0?\d*d/.test(path) || !state.adjoin)) {
          for (let idx = 0; idx < stack.length; idx++) {
            const framePath = formatSceneOutputPath(path, idx);
            const { data: frameBytes } = encodeImage(stack[idx]!, { format, quality: state.quality });
            files.set(framePath, frameBytes);
          }
        } else {
          const { data: encoded } = encodeImage(top, { format, quality: state.quality });
          files.set(path, encoded);
        }
      }
    } else if (t === "-geometry") {
      state.geometry = tokens[++i] ?? "+0+0";
    } else if (t === "-tile") {
      state.tile = tokens[++i];
    } else if (t === "-strip") {
      state.strip = true;
    } else if (t === "-format") {
      state.formatStr = tokens[++i] ?? "";
    } else if (t === "+adjoin") {
      state.adjoin = false;
    } else if (t === "-adjoin") {
      state.adjoin = true;
    } else if (t === "-delay" || t === "-loop" || t === "-dispose") {
      i++;
    } else if (t === "-coalesce" || t === "-deconstruct") {
      // Coalesces frames in-place
    } else if (t === "-splice") {
      const geom = tokens[++i] ?? "0x0";
      stack = stack.map((im) => applyMagickSplice(im, geom, state.background, state.gravity));
    } else if (t === "-chop") {
      const geom = tokens[++i] ?? "0x0";
      stack = stack.map((im) => applyMagickChop(im, geom, state.gravity));
    } else if (t === "-roll") {
      const geom = tokens[++i] ?? "+0+0";
      stack = stack.map((im) => applyMagickRoll(im, geom));
    } else if (t === "-morph") {
      const count = Number(tokens[++i] ?? 1);
      stack = applyMagickMorph(stack, count);
    } else if (t === "-floodfill") {
      const geom = tokens[++i] ?? "+0+0";
      const nextTok = tokens[i + 1];
      let targetColor: RgbaColor | undefined;
      if (nextTok && !nextTok.startsWith("-") && !nextTok.startsWith("+") && !files.has(nextTok)) {
        try {
          targetColor = parseColor(nextTok);
          i++;
        } catch {
          // Optional target color omitted
        }
      }
      stack = stack.map((im) => applyMagickFloodfill(im, geom, targetColor, state.fill, state.fuzz));
    } else if (t === "-evaluate-sequence") {
      const op = tokens[++i] ?? "Mean";
      if (stack.length > 0) {
        stack = [applyMagickEvaluateSequence(stack, op)];
      }
    } else if (t === "-convolve") {
      const kSpec = tokens[++i] ?? "1";
      stack = stack.map((im) => applyMagickCustomConvolve(im, kSpec));
    } else if (t === "-color-matrix" || t === "-recolor") {
      const mSpec = tokens[++i] ?? "1,0,0 0,1,0 0,0,1";
      stack = stack.map((im) => applyMagickColorMatrix(im, mSpec));
    } else if (t === "-equalize") {
      stack = stack.map((im) => applyMagickEqualize(im));
    } else if (t === "-remap") {
      const palSpec = tokens[++i] ?? "";
      const palImg = parseInputOperand(palSpec, files, state, stdinBytes);
      if (palImg) {
        stack = stack.map((im) => applyMagickRemap(im, palImg, state.dither));
      }
    } else if (t === "-channel") {
      state.channels = parseChannelMask(tokens[++i] ?? "rgb");
      state.channelExplicit = true;
    } else if (t === "+channel") {
      state.channels = { r: true, g: true, b: true, a: false };
      state.channelExplicit = false;
    } else if (t === "-opaque" || t === "+opaque") {
      const targetColor = parseColor(tokens[++i] ?? "#000000");
      const invert = t === "+opaque";
      stack = stack.map((im) => applyMagickOpaque(im, targetColor, state.fill, state.fuzz, invert));
    } else if (t === "-transparent" || t === "+transparent") {
      const targetColor = parseColor(tokens[++i] ?? "#ffffff");
      const invert = t === "+transparent";
      stack = stack.map((im) => applyMagickTransparent(im, targetColor, state.fuzz, invert));
    } else if (t === "-evaluate") {
      const op = tokens[++i] ?? "Add";
      const val = tokens[++i] ?? "0";
      stack = stack.map((im) => applyMagickEvaluate(im, op, val, state.channels));
    } else if (t === "-function") {
      const fn = tokens[++i] ?? "Polynomial";
      const params = tokens[++i] ?? "1,0";
      stack = stack.map((im) => applyMagickFunction(im, fn, params, state.channels));
    } else if (t === "-clut" || t === "-hald-clut") {
      if (stack.length >= 2) {
        const lut = stack[stack.length - 1]!;
        const mapped = stack.slice(0, -1).map((im) => applyMagickClut(im, lut, state.channels));
        stack = mapped;
      }
    } else if (t === "-fx") {
      const expr = tokens[++i] ?? "u";
      if (stack.length > 0) {
        stack = [applyMagickFx(stack, expr, state.channels)];
      }
    } else if (t === "-shear") {
      const geom = tokens[++i] ?? "0x0";
      stack = stack.map((im) => applyMagickShear(im, geom, state.background));
    } else if (t === "-distort" || t === "+distort") {
      const method = tokens[++i] ?? "SRT";
      const args = tokens[++i] ?? "0";
      stack = stack.map((im) => applyMagickDistort(im, method, args, state.background));
    } else if (t === "-swirl") {
      const deg = Number(tokens[++i] ?? 0);
      stack = stack.map((im) => applyMagickSwirl(im, deg, state.background));
    } else if (t === "-implode") {
      const amt = Number(tokens[++i] ?? 0);
      stack = stack.map((im) => applyMagickImplode(im, amt, state.background));
    } else if (t === "-wave") {
      const geom = tokens[++i] ?? "5x50";
      stack = stack.map((im) => applyMagickWave(im, geom, state.background));
    } else if (t === "-shadow") {
      const geom = tokens[++i] ?? "80x3+5+5";
      stack = stack.map((im) => applyMagickShadow(im, geom, state.background));
    } else if (t === "-vignette") {
      const geom = tokens[++i] ?? "0x2";
      stack = stack.map((im) => applyMagickVignette(im, geom, state.background));
    } else if (t === "-sepia-tone") {
      const thresh = tokens[++i] ?? "80%";
      stack = stack.map((im) => applyMagickSepiaTone(im, thresh));
    } else if (t === "-solarize") {
      const thresh = tokens[++i] ?? "50%";
      stack = stack.map((im) => applyMagickSolarize(im, thresh));
    } else if (t === "-posterize" || t === "-colors") {
      const lv = Number(tokens[++i] ?? 8);
      stack = stack.map((im) => applyMagickPosterize(im, lv));
    } else if (t === "-dither" || t === "+dither") {
      if (t === "+dither") {
        state.dither = false;
      } else {
        const dMode = (tokens[++i] ?? "floydsteinberg").toLowerCase();
        state.dither = dMode !== "none";
      }
    } else if (t === "-edge" || t === "-canny") {
      i++;
      stack = stack.map((im) => applyMagickConvolve3x3(im, [-1, -1, -1, -1, 8, -1, -1, -1, -1], 0));
    } else if (t === "-emboss") {
      i++;
      stack = stack.map((im) => applyMagickConvolve3x3(im, [-2, -1, 0, -1, 1, 1, 0, 1, 2], 128));
    } else if (t === "-charcoal" || t === "-sketch") {
      i++;
      stack = stack.map((im) =>
        grayscaleImage(
          negateImage(
            applyMagickConvolve3x3(blurImage(im, 1), [-1, -1, -1, -1, 8, -1, -1, -1, -1], 0),
            { alpha: false }
          )
        )
      );
    } else if (t === "+repage" || t === "-repage") {
      if (t === "-repage") i++;
    } else if (t === "-resize" || t === "-scale" || t === "-sample" || t === "-thumbnail") {
      const geom = tokens[++i] ?? "100%";
      const k = t === "-sample" ? "nearest" : state.kernel;
      stack = stack.map((im) => applyMagickResize(im, geom, k));
    } else if (t === "-crop") {
      const geom = tokens[++i] ?? "100%";
      const nextStack: RgbaImage[] = [];
      for (const im of stack) {
        nextStack.push(...applyMagickCropToStack(im, geom, state.gravity));
      }
      stack = nextStack;
    } else if (t === "-extent") {
      const geom = tokens[++i] ?? "100%";
      stack = stack.map((im) => applyMagickExtent(im, geom, state));
    } else if (t === "-border") {
      const g = parseMagickGeometry(tokens[++i] ?? "0x0");
      const bw = Math.max(0, Math.round(g.width ?? 0));
      const bh = Math.max(0, Math.round(g.height ?? bw));
      stack = stack.map((im) =>
        extendImage(im, {
          top: bh,
          bottom: bh,
          left: bw,
          right: bw,
          background: state.borderColor,
          extendWith: "background"
        })
      );
    } else if (t === "-shave") {
      const g = parseMagickGeometry(tokens[++i] ?? "0x0");
      const sw = Math.max(0, Math.round(g.width ?? 0));
      const sh = Math.max(0, Math.round(g.height ?? sw));
      stack = stack.map((im) => {
        const clampedSw = Math.min(Math.floor((im.width - 1) / 2), sw);
        const clampedSh = Math.min(Math.floor((im.height - 1) / 2), sh);
        return extractImage(im, {
          left: clampedSw,
          top: clampedSh,
          width: Math.max(1, im.width - clampedSw * 2),
          height: Math.max(1, im.height - clampedSh * 2)
        });
      });
    } else if (t === "-trim") {
      stack = stack.map((im) => trimImage(im, { threshold: state.fuzz }));
    } else if (t === "-rotate") {
      const deg = Number(tokens[++i] ?? 0);
      stack = stack.map((im) => rotateImage(im, deg, state.background));
    } else if (t === "-flip") {
      stack = stack.map((im) => flipImage(im));
    } else if (t === "-flop") {
      stack = stack.map((im) => flopImage(im));
    } else if (t === "-transpose") {
      stack = stack.map((im) => rotateImage(flipImage(im), 90, state.background));
    } else if (t === "-transverse") {
      stack = stack.map((im) => rotateImage(flopImage(im), 90, state.background));
    } else if (t === "-auto-orient") {
      stack = stack.map((im) => applyExifOrientation(im));
    } else if (t === "-negate" || t === "+negate") {
      const onlyGray = t === "+negate";
      const ch = state.channelExplicit ? state.channels : { r: true, g: true, b: true, a: false };
      stack = stack.map((im) => {
        const out = new Uint8Array(im.data);
        for (let idx = 0; idx < out.length; idx += 4) {
          const r = out[idx]!;
          const g = out[idx + 1]!;
          const b = out[idx + 2]!;
          if (onlyGray && !(r === g && g === b)) continue;
          if (ch.r) out[idx] = 255 - r;
          if (ch.g) out[idx + 1] = 255 - g;
          if (ch.b) out[idx + 2] = 255 - b;
          if (ch.a) out[idx + 3] = 255 - out[idx + 3]!;
        }
        return { ...im, data: out };
      });
    } else if (t === "-colorspace" || t === "-grayscale") {
      const cs = (tokens[++i] ?? "gray").toLowerCase();
      if (cs.includes("gray") || cs.includes("grey") || cs === "rec709luma" || cs === "rec601luma") {
        stack = stack.map((im) => grayscaleImage(im));
      }
    } else if (t === "-monochrome") {
      stack = stack.map((im) => thresholdImage(grayscaleImage(im), 128, true));
    } else if (t === "-modulate") {
      const parts = (tokens[++i] ?? "100,100,100").split(",").map((p) => Number(p));
      const brightness = (parts[0] ?? 100) / 100;
      const saturation = (parts[1] ?? 100) / 100;
      const hue = ((parts[2] ?? 100) - 100) * 1.8;
      stack = stack.map((im) => modulateImage(im, { brightness, saturation, hue, lightness: 0 }));
    } else if (t === "-brightness-contrast") {
      const g = parseMagickGeometry(tokens[++i] ?? "0x0");
      const b = g.width ?? 0;
      const c = g.height ?? 0;
      const slope = 1 + c / 100;
      const offset = (b / 100) * 255;
      stack = stack.map((im) => linearImage(im, [slope], [offset]));
    } else if (t === "-gamma") {
      const gammaVal = Math.max(0.1, Number(tokens[++i] ?? 1.0));
      stack = stack.map((im) => gammaImage(im, gammaVal, gammaVal));
    } else if (t === "-auto-level") {
      const indep = state.channelExplicit;
      const ch = state.channelExplicit ? state.channels : { r: true, g: true, b: true, a: false };
      stack = stack.map((im) => {
        const out = new Uint8Array(im.data);
        const mins = [255, 255, 255, 255];
        const maxs = [0, 0, 0, 0];
        for (let idx = 0; idx < out.length; idx += 4) {
          for (let c = 0; c < 4; c++) {
            const v = out[idx + c]!;
            if (v < mins[c]!) mins[c] = v;
            if (v > maxs[c]!) maxs[c] = v;
          }
        }
        if (!indep) {
          const gMin = Math.min(mins[0]!, mins[1]!, mins[2]!);
          const gMax = Math.max(maxs[0]!, maxs[1]!, maxs[2]!);
          mins[0] = mins[1] = mins[2] = gMin;
          maxs[0] = maxs[1] = maxs[2] = gMax;
        }
        const active = [ch.r, ch.g, ch.b, ch.a];
        for (let idx = 0; idx < out.length; idx += 4) {
          for (let c = 0; c < 4; c++) {
            if (!active[c]) continue;
            const range = maxs[c]! - mins[c]!;
            if (range > 0) {
              out[idx + c] = clampByteVal(((out[idx + c]! - mins[c]!) / range) * 255);
            }
          }
        }
        return { ...im, data: out };
      });
    } else if (t === "-normalize" || t === "-contrast-stretch" || t === "-linear-stretch") {
      const arg = t === "-normalize" ? "2%x1%" : (tokens[++i] ?? "0%x0%");
      const [bStr, wStr] = arg.split("x");
      const isPct = arg.includes("%");
      const bVal = parseFloat(bStr || "0") || 0;
      const wVal = wStr !== undefined ? (parseFloat(wStr) || 0) : bVal;
      stack = stack.map((im) => {
        const out = new Uint8Array(im.data);
        const nPix = Math.max(1, im.width * im.height);
        const lowTarget = isPct ? (bVal / 100) * nPix : bVal;
        const highTarget = isPct ? ((100 - wVal) / 100) * nPix : nPix - wVal;
        for (let c = 0; c < 3; c++) {
          const hist = new Uint32Array(256);
          for (let idx = c; idx < out.length; idx += 4) hist[out[idx]!]!++;
          let lowBin = 0;
          let acc = 0;
          for (let b = 0; b < 256; b++) {
            acc += hist[b]!;
            if (acc > lowTarget) {
              lowBin = b;
              break;
            }
          }
          let highBin = 255;
          acc = 0;
          for (let b = 0; b < 256; b++) {
            acc += hist[b]!;
            if (acc >= highTarget) {
              highBin = b;
              break;
            }
          }
          const range = highBin - lowBin;
          if (range > 0) {
            for (let idx = c; idx < out.length; idx += 4) {
              out[idx] = clampByteVal(((out[idx]! - lowBin) / range) * 255);
            }
          }
        }
        return { ...im, data: out };
      });
    } else if (t === "-contrast" || t === "+contrast") {
      const slope = t === "-contrast" ? 1.15 : 0.87;
      const offset = 128 * (1 - slope);
      stack = stack.map((im) => linearImage(im, [slope], [offset]));
    } else if (t === "-raise" || t === "+raise") {
      const g = parseMagickGeometry(tokens[++i] ?? "4");
      const bw = Math.max(1, Math.round(g.width ?? 4));
      const raised = t === "-raise";
      stack = stack.map((im) => {
        const out = new Uint8Array(im.data);
        for (let y = 0; y < im.height; y++) {
          for (let x = 0; x < im.width; x++) {
            const topLeft = y < bw || x < bw;
            const botRight = y >= im.height - bw || x >= im.width - bw;
            if (!topLeft && !botRight) continue;
            const lighten = raised ? topLeft : botRight;
            const idx = (y * im.width + x) * 4;
            for (let c = 0; c < 3; c++) {
              out[idx + c] = clampByteVal(lighten ? out[idx + c]! + 40 : out[idx + c]! - 40);
            }
          }
        }
        return { ...im, data: out };
      });
    } else if (t === "-frame") {
      const g = parseMagickGeometry(tokens[++i] ?? "4x4");
      const fw = Math.max(0, Math.round(g.width ?? 4));
      const fh = Math.max(0, Math.round(g.height ?? fw));
      stack = stack.map((im) =>
        extendImage(im, {
          top: fh,
          bottom: fh,
          left: fw,
          right: fw,
          background: state.borderColor,
          extendWith: "background"
        })
      );
    } else if (t === "-deskew") {
      i++;
    } else if (t === "-auto-gamma") {
      stack = stack.map((im) => {
        const out = new Uint8Array(im.data);
        const numCh = im.hasAlpha ? 4 : 3;
        let sum = 0;
        for (let idx = 0; idx < out.length; idx += 4) {
          for (let c = 0; c < numCh; c++) sum += out[idx + c]!;
        }
        const mean = sum / Math.max(1, im.width * im.height * numCh * 255);
        if (mean > 0 && mean < 1) {
          const exp = Math.log(0.5) / Math.log(mean);
          for (let idx = 0; idx < out.length; idx += 4) {
            for (let c = 0; c < numCh; c++) {
              out[idx + c] = clampByteVal(Math.pow(out[idx + c]! / 255, exp) * 255);
            }
          }
        }
        return { ...im, data: out };
      });
    } else if (t === "-sigmoidal-contrast" || t === "+sigmoidal-contrast") {
      const raw = tokens[++i] ?? "3x50%";
      const [cStr, mStr] = raw.split("x");
      const beta = Math.max(1e-4, parseFloat(cStr || "3"));
      const mRaw = parseFloat(mStr || "50");
      const alpha = (mStr ?? "50%").endsWith("%") ? mRaw / 100 : mRaw / 255;
      const sig = (u: number) => 1 / (1 + Math.exp(beta * (alpha - u)));
      const s0 = sig(0);
      const s1 = sig(1);
      const span = Math.max(1e-6, s1 - s0);
      stack = stack.map((im) => {
        const out = new Uint8Array(im.data);
        for (let idx = 0; idx < out.length; idx += 4) {
          for (let c = 0; c < 3; c++) {
            const u = out[idx + c]! / 255;
            out[idx + c] = clampByteVal(((sig(u) - s0) / span) * 255);
          }
        }
        return { ...im, data: out };
      });
    } else if (t === "-level" || t === "+level") {
      const raw = tokens[++i] ?? "0,100%";
      const parts = raw.split(",");
      const anyPct = raw.includes("%");
      const parsePt = (p: string | undefined, def: number) => {
        if (!p || p.length === 0) return def;
        if (p.endsWith("%") || anyPct) {
          return (parseFloat(p) / 100) * 255;
        }
        return parseFloat(p);
      };
      const black = parsePt(parts[0], 0);
      const white = parsePt(parts[1], 255);
      const gamma = parts[2] !== undefined ? Math.max(0.01, parseFloat(parts[2])) : 1.0;
      const inverse = t === "+level";
      stack = stack.map((im) => {
        const out = new Uint8Array(im.data);
        const span = Math.max(1e-6, white - black);
        for (let idx = 0; idx < out.length; idx += 4) {
          for (let c = 0; c < 3; c++) {
            const v = out[idx + c]!;
            if (inverse) {
              const gVal = Math.pow(Math.max(0, Math.min(1, v / 255)), 1 / gamma);
              out[idx + c] = clampByteVal(black + gVal * span);
            } else {
              const norm = Math.max(0, Math.min(1, (v - black) / span));
              out[idx + c] = clampByteVal(Math.pow(norm, 1 / gamma) * 255);
            }
          }
        }
        return { ...im, data: out };
      });
    } else if (t === "-threshold") {
      const raw = tokens[++i] ?? "50%";
      const val = raw.endsWith("%")
        ? Math.round((parseFloat(raw) / 100) * 255)
        : Math.round(parseFloat(raw));
      stack = stack.map((im) => thresholdImage(im, val, true));
    } else if (t === "-black-threshold" || t === "-white-threshold") {
      const raw = tokens[++i] ?? "50%";
      const thresh = raw.endsWith("%") ? (parseFloat(raw) / 100) * 255 : parseFloat(raw);
      const isBlack = t === "-black-threshold";
      stack = stack.map((im) => {
        const out = new Uint8Array(im.data);
        for (let idx = 0; idx < out.length; idx += 4) {
          const intensity = 0.212656 * out[idx]! + 0.715158 * out[idx + 1]! + 0.072186 * out[idx + 2]!;
          if (isBlack && intensity <= thresh) {
            out[idx] = 0;
            out[idx + 1] = 0;
            out[idx + 2] = 0;
          } else if (!isBlack && intensity > thresh) {
            out[idx] = 255;
            out[idx + 1] = 255;
            out[idx + 2] = 255;
          }
        }
        return { ...im, data: out };
      });
    } else if (t === "-tint" || t === "-colorize") {
      i++;
      stack = stack.map((im) => tintImage(im, state.fill));
    } else if (t === "-blur" || t === "-gaussian-blur") {
      const g = parseMagickGeometry(tokens[++i] ?? "0x1");
      const sigma = Math.max(0.3, g.height ?? g.width ?? 1);
      stack = stack.map((im) => blurImage(im, sigma));
    } else if (t === "-sharpen" || t === "-unsharp") {
      const g = parseMagickGeometry(tokens[++i] ?? "0x1");
      const sigma = Math.max(0.3, g.height ?? g.width ?? 1);
      stack = stack.map((im) => sharpenImage(im, sigma));
    } else if (t === "-median") {
      const r = Math.max(1, Math.round(Number(tokens[++i] ?? 3)));
      stack = stack.map((im) => medianImage(im, r));
    } else if (t === "-morphology") {
      const method = (tokens[++i] ?? "dilate").toLowerCase();
      let kernelSpec = "";
      if (tokens[i + 1] && !tokens[i + 1]!.startsWith("-") && !tokens[i + 1]!.startsWith("+")) {
        kernelSpec = tokens[++i]!;
      }
      if (method.includes("convolve") || method.includes("correlate")) {
        stack = stack.map((im) => applyMagickCustomConvolve(im, kernelSpec));
      } else {
        stack = stack.map((im) => applyMagickMorphology4Ch(im, method, kernelSpec));
      }
    } else if (t === "-statistic") {
      const statType = (tokens[++i] ?? "median").toLowerCase();
      const geom = tokens[++i] ?? "3x3";
      stack = stack.map((im) => applyMagickMorphology4Ch(im, statType, geom));
    } else if (t === "-alpha") {
      const mode = (tokens[++i] ?? "on").toLowerCase();
      if (mode === "remove") {
        stack = stack.map((im) => removeAlphaImage(flattenImage(im, state.background)));
      } else if (mode === "off" || mode === "deactivate" || mode === "opaque") {
        stack = stack.map((im) => {
          const out = new Uint8Array(im.data);
          for (let idx = 3; idx < out.length; idx += 4) out[idx] = 255;
          return { ...im, data: out, hasAlpha: mode === "opaque" };
        });
      } else if (mode === "transparent") {
        stack = stack.map((im) => {
          const out = new Uint8Array(im.data);
          for (let idx = 3; idx < out.length; idx += 4) out[idx] = 0;
          return { ...im, data: out, hasAlpha: true };
        });
      } else if (mode === "copy" || mode === "shape") {
        stack = stack.map((im) => {
          const out = new Uint8Array(im.data);
          for (let idx = 0; idx < out.length; idx += 4) {
            const inten = clampByteVal(
              0.212656 * out[idx]! + 0.715158 * out[idx + 1]! + 0.072186 * out[idx + 2]!
            );
            if (mode === "shape") {
              out[idx] = state.background.r;
              out[idx + 1] = state.background.g;
              out[idx + 2] = state.background.b;
            }
            out[idx + 3] = inten;
          }
          return { ...im, data: out, hasAlpha: true };
        });
      } else if (mode === "on" || mode === "set" || mode === "activate") {
        stack = stack.map((im) => ensureAlphaImage(im, 1));
      } else if (mode === "extract") {
        stack = stack.map((im) => extractChannelImage(ensureAlphaImage(im, 1), 3));
      }
    } else if (t === "-separate") {
      const nextStack: RgbaImage[] = [];
      for (const im of stack) {
        if (state.channelExplicit) {
          if (state.channels.r) nextStack.push(extractChannelImage(im, 0));
          if (state.channels.g) nextStack.push(extractChannelImage(im, 1));
          if (state.channels.b) nextStack.push(extractChannelImage(im, 2));
          if (state.channels.a) nextStack.push(extractChannelImage(ensureAlphaImage(im, 1), 3));
        } else {
          nextStack.push(
            extractChannelImage(im, 0),
            extractChannelImage(im, 1),
            extractChannelImage(im, 2)
          );
          if (im.hasAlpha) {
            nextStack.push(extractChannelImage(ensureAlphaImage(im, 1), 3));
          }
        }
      }
      stack = nextStack;
    } else if (t === "-combine") {
      if (stack.length >= 3) {
        const rIm = stack[0]!;
        const gIm = stack[1] ?? rIm;
        const bIm = stack[2] ?? rIm;
        const aIm = stack[3];
        const out = new Uint8Array(rIm.width * rIm.height * 4);
        for (let p = 0; p < out.length; p += 4) {
          out[p] = rIm.data[p]!;
          out[p + 1] = gIm.data[p]!;
          out[p + 2] = bIm.data[p]!;
          out[p + 3] = aIm ? aIm.data[p]! : 255;
        }
        stack = [{ ...rIm, space: "srgb", data: out, channels: 4, hasAlpha: Boolean(aIm) }];
      }
    } else if (t === "-draw") {
      const drawSpec = tokens[++i] ?? "";
      stack = stack.map((im) => applyMagickDraw(im, drawSpec, state));
    } else if (t === "-annotate") {
      const offsetOrText = tokens[++i] ?? "+0+0";
      const hasExplicitOffset = /^[+-]\d/.test(offsetOrText) || /^\d+x\d+/.test(offsetOrText);
      const offset = hasExplicitOffset ? offsetOrText : "+0+0";
      const text = hasExplicitOffset ? (tokens[++i] ?? "") : offsetOrText;
      stack = stack.map((im) => applyMagickAnnotate(im, offset, text, state));
    } else if (t === "+clone" || t === "-clone") {
      const sourcePool = stack.length > 0 ? stack : parentStack;
      const spec = t === "+clone" ? "-1" : (tokens[++i] ?? "-1");
      for (const idx of parseMagickIndexSpec(spec, sourcePool.length)) {
        const chosen = sourcePool[idx];
        if (chosen) stack.push({ ...chosen, data: new Uint8Array(chosen.data) });
      }
    } else if (t === "-duplicate" || t === "+duplicate") {
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
          } else {
            count = Math.max(0, parseInt(nextTok, 10));
          }
        }
      }
      const sourcePool = stack.length > 0 ? stack : parentStack;
      const indices = parseMagickIndexSpec(idxSpec, sourcePool.length);
      for (let k = 0; k < count; k++) {
        for (const idx of indices) {
          const chosen = sourcePool[idx];
          if (chosen) stack.push({ ...chosen, data: new Uint8Array(chosen.data) });
        }
      }
    } else if (t === "+insert" || t === "-insert") {
      const rawIdx = t === "+insert" ? 0 : Number(tokens[++i] ?? 0);
      if (stack.length > 1) {
        const last = stack.pop()!;
        const target = rawIdx < 0 ? Math.max(0, stack.length + 1 + rawIdx) : Math.min(stack.length, Math.max(0, rawIdx));
        stack.splice(target, 0, last);
      }
    } else if (t === "+swap" || t === "-swap") {
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
    } else if (t === "+delete" || t === "-delete") {
      if (t === "+delete") {
        stack.pop();
      } else {
        const toDelete = new Set(parseMagickIndexSpec(tokens[++i] ?? "-1", stack.length));
        stack = stack.filter((_, idx) => !toDelete.has(idx));
      }
    } else if (t === "-reverse") {
      stack.reverse();
    } else if (t === "-append" || t === "+append") {
      stack = [appendStackImages(stack, t === "-append", state)];
    } else if (t === "-flatten" || t === "-mosaic" || (t === "-layers" && ["flatten", "merge", "mosaic"].includes((tokens[i + 1] ?? "").toLowerCase()))) {
      if (t === "-layers") i++;
      if (stack.length > 0) {
        const maxW = Math.max(...stack.map((im) => im.width));
        const maxH = Math.max(...stack.map((im) => im.height));
        const canvas = createSolidRgbaImage(maxW, maxH, state.background);
        const layers = stack.map((im) => rgbaToCompositeLayer(im, 0, 0, state.compose));
        stack = [compositeImage(canvas, layers)];
      }
    } else if (t === "-composite") {
      if (stack.length >= 2) {
        const base = stack[0]!;
        let overlay = stack[1]!;
        let gx = 0;
        let gy = 0;
        if (state.geometry) {
          const g = parseMagickGeometry(state.geometry);
          if (g.width !== undefined || g.height !== undefined) {
            overlay = applyMagickResize(overlay, state.geometry, state.kernel);
          }
          gx = g.x;
          gy = g.y;
        }
        const grav = resolveGravityOffset(base.width - overlay.width, base.height - overlay.height, state.gravity);
        const composed = applyMagickCompositeLayer(
          base,
          overlay,
          state.composeRaw,
          grav.left + gx,
          grav.top + gy,
          state.composeArgs
        );
        stack = [composed, ...stack.slice(2)];
      }
    } else {
      const loaded = parseInputOperands(t, files, state, stdinBytes);
      if (loaded) {
        stack.push(...loaded);
      }
    }

    i++;
  }

  return stack;
}

export async function runConvertCli(
  argv: readonly string[],
  files: Map<string, Uint8Array>,
  stdinBytes?: Uint8Array
): Promise<ImageMagickCliResult> {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-help") || argv.includes("-h")) {
    return {
      exitCode: 0,
      stdout: "Usage: magick [input-options] input-file [operators] output-file\n",
      stderr: ""
    };
  }
  if (argv.includes("--version") || argv.includes("-version")) {
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
    const stack = evaluatePipelineTokens(pipelineTokens, files, state, [], stdinBytes);
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
      const outText = state.formatStr
        ? stack.map((im, idx) => formatMagickPropertyString(state.formatStr!, im, idx, stack.length)).join("")
        : stack.map((im) => `${im.width}x${im.height} sRGB 8-bit`).join("\n");
      return {
        exitCode: 0,
        stdout: outText.endsWith("\n") ? outText : `${outText}\n`,
        stderr: ""
      };
    }
    if (outLower.startsWith("txt:")) {
      const txt = formatTxtEnumeration(finalImg);
      const target = outSpec.slice(4);
      if (!target || target === "-") {
        return { exitCode: 0, stdout: txt, stderr: "" };
      }
      files.set(target, new TextEncoder().encode(txt));
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    if (outLower.startsWith("histogram:")) {
      const hist = formatHistogramOutput(finalImg);
      return { exitCode: 0, stdout: hist, stderr: "" };
    }

    const { format, path: outPath } = inferOutputFormat(outSpec, "png");

    if (stack.length > 1 && (/%0?\d*d/.test(outPath) || !state.adjoin)) {
      for (let idx = 0; idx < stack.length; idx++) {
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
        const frame =
          stack[idx]!.width === fw && stack[idx]!.height === fh
            ? stack[idx]!
            : applyMagickResize(stack[idx]!, `${fw}x${fh}!`, state.kernel);
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
    const { data: encoded } = encodeImage(toEncode, {
      format,
      quality: state.quality,
      ...(encodePageHeight !== undefined ? { pageHeight: encodePageHeight } : {})
    });

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
  } catch (err) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `magick: ${(err as Error).message}\n`
    };
  }
}

export async function runMogrifyCli(
  argv: readonly string[],
  files: Map<string, Uint8Array>
): Promise<ImageMagickCliResult> {
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
    const t = argv[i]!;
    if (t === "-format") {
      outFormatExt = (argv[++i] ?? "png").replace(/^\./, "").toLowerCase();
    } else if (t === "-path") {
      outDir = argv[++i];
    } else if (t === "-annotate") {
      const a1 = argv[++i] ?? "+0+0";
      if (/^[+-]\d/.test(a1) || /^\d+x\d+/.test(a1)) {
        opTokens.push("-annotate", a1, argv[++i] ?? "");
      } else {
        opTokens.push("-annotate", a1);
      }
    } else if (
      t === "-evaluate" ||
      t === "-function" ||
      t === "-morphology" ||
      t === "-statistic" ||
      t === "-set" ||
      t === "-distort" ||
      t === "+distort"
    ) {
      opTokens.push(t, argv[++i] ?? "", argv[++i] ?? "");
    } else if (["-density", "-background", "-fuzz", "-filter", "-size"].includes(t)) {
      readSettings.push(t, argv[++i] ?? "");
    } else if (flagsWithOneArg.has(t)) {
      opTokens.push(t, argv[++i] ?? "");
    } else if (t.startsWith("-") || t.startsWith("+")) {
      opTokens.push(t);
    } else if (files.has(t)) {
      targets.push(t);
    } else {
      targets.push(t);
    }
  }

  for (const target of targets) {
    if (!files.has(target)) {
      return {
        exitCode: 1,
        stdout: "",
        stderr: `mogrify: unable to open image '${target}': No such file or directory\n`
      };
    }
    const baseName = target.split("/").pop() ?? target;
    const stem = baseName.replace(/\.[^.]+$/, "");
    const origExt = baseName.includes(".") ? baseName.split(".").pop()! : "png";
    const targetExt = outFormatExt ?? origExt;
    const destDir = outDir ? outDir.replace(/\/+$/, "") : target.slice(0, Math.max(0, target.lastIndexOf("/")));
    const destPath = outFormatExt || outDir ? `${destDir ? destDir + "/" : ""}${stem}.${targetExt}` : target;

    const res = await runConvertCli([...readSettings, target, ...opTokens, destPath], files);
    if (res.exitCode !== 0) return res;
  }

  return { exitCode: 0, stdout: "", stderr: "" };
}

export async function runCompositeCli(
  argv: readonly string[],
  files: Map<string, Uint8Array>,
  stdinBytes?: Uint8Array
): Promise<ImageMagickCliResult> {
  const options: string[] = [];
  const operands: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const t = argv[i]!;
    if (t === "-gravity" || t === "-geometry" || t === "-compose" || t === "-background" || t === "-quality" || t === "-define") {
      options.push(t, argv[++i] ?? "");
    } else if (t === "-dissolve") {
      options.push("-define", `compose:args=${argv[++i] ?? "100"}`, "-compose", "Dissolve");
    } else if (t === "-blend" || t === "-watermark") {
      options.push("-define", `compose:args=${argv[++i] ?? "50"}`, "-compose", "Blend");
    } else if (t.startsWith("-")) {
      options.push(t);
    } else {
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
  return runConvertCli([base, overlay, ...options, "-composite", out], files, stdinBytes);
}

function formatMetricNum(n: number): string {
  if (!Number.isFinite(n)) return "inf";
  if (Math.abs(n) < 1e-9) return "0";
  const fixed = n.toFixed(6).replace(/\.?0+$/, "");
  return fixed === "-0" ? "0" : fixed;
}

export async function runCompareCli(
  argv: readonly string[],
  files: Map<string, Uint8Array>,
  stdinBytes?: Uint8Array
): Promise<ImageMagickCliResult> {
  const state = createDefaultState();
  state.fuzz = 0;
  let metric = "rmse";
  let highlightColor: RgbaColor = { r: 241, g: 0, b: 30, a: 255 };
  let lowlightColor: RgbaColor | undefined;
  let composeSrc = false;
  let dissimilarityThreshold: number | undefined;
  const operands: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const t = argv[i]!;
    if (t === "--help" || t === "-help" || t === "-h") {
      return {
        exitCode: 0,
        stdout:
          "Usage: compare [-metric AE|MAE|MSE|RMSE|PSNR|SSIM|PAE|NCC] [-fuzz value%] [-highlight-color color] [-lowlight-color color] reference.png candidate.png diff.png\n",
        stderr: ""
      };
    } else if (t === "-metric") {
      metric = (argv[++i] ?? "rmse").toLowerCase();
    } else if (t === "-fuzz") {
      const rawFuzz = argv[++i] ?? "0";
      state.fuzz = rawFuzz.endsWith("%")
        ? (parseFloat(rawFuzz) / 100) * 255
        : parseFloat(rawFuzz);
    } else if (t === "-highlight-color") {
      highlightColor = parseColor(argv[++i] ?? "#f1001e");
    } else if (t === "-lowlight-color") {
      lowlightColor = parseColor(argv[++i] ?? "#ffffff");
    } else if (t === "-compose") {
      const cm = (argv[++i] ?? "over").toLowerCase();
      if (cm === "src" || cm === "source" || cm === "copy") composeSrc = true;
    } else if (t === "-dissimilarity-threshold") {
      dissimilarityThreshold = Number(argv[++i] ?? 1);
    } else if (t === "-density") {
      const g = parseMagickGeometry(argv[++i] ?? "72");
      state.density = Math.max(1, Math.round(g.width ?? 72));
    } else if (t === "-quality") {
      state.quality = Math.max(1, Math.min(100, Number(argv[++i] ?? 92)));
    } else if (t.startsWith("-") && t.length > 1) {
      // Skip optional flags with arguments if recognized
      if (t === "-format" || t === "-alpha" || t === "-channel") i++;
    } else {
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

  let imgA: RgbaImage | undefined;
  let imgB: RgbaImage | undefined;
  try {
    imgA = parseInputOperand(refSpec, files, state, stdinBytes);
    imgB = parseInputOperand(candSpec, files, state, stdinBytes);
  } catch (err) {
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

  const width = Math.max(imgA.width, imgB.width);
  const height = Math.max(imgA.height, imgB.height);
  const totalPixels = Math.max(1, width * height);
  const diffData = new Uint8Array(width * height * 4);

  let aeCount = 0;
  let sumAbs = 0;
  let sumSq = 0;
  let maxAbs = 0;

  const lumA = new Float64Array(totalPixels);
  const lumB = new Float64Array(totalPixels);
  let sumLumA = 0;
  let sumLumB = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pIdx = y * width + x;
      const outOff = pIdx * 4;
      const inBoundsA = x < imgA.width && y < imgA.height;
      const inBoundsB = x < imgB.width && y < imgB.height;
      const offA = inBoundsA ? (y * imgA.width + x) * 4 : -1;
      const offB = inBoundsB ? (y * imgB.width + x) * 4 : -1;

      const rA = offA >= 0 ? imgA.data[offA]! : 0;
      const gA = offA >= 0 ? imgA.data[offA + 1]! : 0;
      const bA = offA >= 0 ? imgA.data[offA + 2]! : 0;
      const aA = offA >= 0 ? imgA.data[offA + 3]! : 0;

      const rB = offB >= 0 ? imgB.data[offB]! : 0;
      const gB = offB >= 0 ? imgB.data[offB + 1]! : 0;
      const bB = offB >= 0 ? imgB.data[offB + 2]! : 0;
      const aB = offB >= 0 ? imgB.data[offB + 3]! : 0;

      const dr = Math.abs(rA - rB);
      const dg = Math.abs(gA - gB);
      const db = Math.abs(bA - bB);
      const da = Math.abs(aA - aB);
      const alphaA = aA / 255;
      const alphaB = aB / 255;
      const pdr = Math.abs(rA * alphaA - rB * alphaB);
      const pdg = Math.abs(gA * alphaA - gB * alphaB);
      const pdb = Math.abs(bA * alphaA - bB * alphaB);
      const hasAlpha = imgA.hasAlpha || imgB.hasAlpha;
      const maxDelta = hasAlpha ? Math.max(pdr, pdg, pdb, da) : Math.max(dr, dg, db);

      if (!inBoundsA || !inBoundsB || maxDelta > state.fuzz) {
        aeCount++;
        diffData[outOff] = highlightColor.r;
        diffData[outOff + 1] = highlightColor.g;
        diffData[outOff + 2] = highlightColor.b;
        diffData[outOff + 3] = highlightColor.a;
      } else if (composeSrc) {
        diffData[outOff] = 0;
        diffData[outOff + 1] = 0;
        diffData[outOff + 2] = 0;
        diffData[outOff + 3] = 0;
      } else if (lowlightColor) {
        diffData[outOff] = lowlightColor.r;
        diffData[outOff + 1] = lowlightColor.g;
        diffData[outOff + 2] = lowlightColor.b;
        diffData[outOff + 3] = lowlightColor.a;
      } else {
        diffData[outOff] = Math.round(rA * 0.3 + 255 * 0.7);
        diffData[outOff + 1] = Math.round(gA * 0.3 + 255 * 0.7);
        diffData[outOff + 2] = Math.round(bA * 0.3 + 255 * 0.7);
        diffData[outOff + 3] = 255;
      }

      if (hasAlpha) {
        sumAbs += pdr + pdg + pdb + da;
        sumSq += pdr * pdr + pdg * pdg + pdb * pdb + da * da;
      } else {
        sumAbs += dr + dg + db;
        sumSq += dr * dr + dg * dg + db * db;
      }
      if (maxDelta > maxAbs) maxAbs = maxDelta;

      const lA = (0.299 * rA + 0.587 * gA + 0.114 * bA) / 255;
      const lB = (0.299 * rB + 0.587 * gB + 0.114 * bB) / 255;
      lumA[pIdx] = lA;
      lumB[pIdx] = lB;
      sumLumA += lA;
      sumLumB += lB;
    }
  }

  const numCh = imgA.hasAlpha || imgB.hasAlpha ? 4 : 3;
  const maeNorm = sumAbs / (totalPixels * numCh * 255);
  const mseNorm = sumSq / (totalPixels * numCh * 255 * 255);
  const rmseNorm = Math.sqrt(mseNorm);
  const paeNorm = maxAbs / 255;

  const muA = sumLumA / totalPixels;
  const muB = sumLumB / totalPixels;
  let varA = 0;
  let varB = 0;
  let covAB = 0;
  for (let i = 0; i < totalPixels; i++) {
    const dA = lumA[i]! - muA;
    const dB = lumB[i]! - muB;
    varA += dA * dA;
    varB += dB * dB;
    covAB += dA * dB;
  }
  varA /= totalPixels;
  varB /= totalPixels;
  covAB /= totalPixels;

  const c1 = 0.0001;
  const c2 = 0.0009;
  const ssim =
    ((2 * muA * muB + c1) * (2 * covAB + c2)) /
    ((muA * muA + muB * muB + c1) * (varA + varB + c2));
  const ncc = varA === 0 && varB === 0 ? 1 : covAB / (Math.sqrt(varA * varB) || 1);

  let metricStr: string;
  switch (metric) {
    case "ae":
      metricStr = String(aeCount);
      break;
    case "mae":
      metricStr = `${formatMetricNum(maeNorm * 65535)} (${formatMetricNum(maeNorm)})`;
      break;
    case "mse":
      metricStr = `${formatMetricNum(mseNorm * 65535)} (${formatMetricNum(mseNorm)})`;
      break;
    case "pae":
      metricStr = `${formatMetricNum(paeNorm * 65535)} (${formatMetricNum(paeNorm)})`;
      break;
    case "psnr":
      metricStr = mseNorm === 0 ? "inf" : formatMetricNum(10 * Math.log10(1 / mseNorm));
      break;
    case "ssim":
      metricStr = formatMetricNum(ssim);
      break;
    case "dssim":
      metricStr = formatMetricNum((1 - ssim) / 2);
      break;
    case "ncc":
      metricStr = formatMetricNum(ncc);
      break;
    case "rmse":
    default:
      metricStr = `${formatMetricNum(rmseNorm * 65535)} (${formatMetricNum(rmseNorm)})`;
      break;
  }

  const exitCode =
    dissimilarityThreshold !== undefined ? (rmseNorm > dissimilarityThreshold ? 1 : 0) : (aeCount > 0 ? 1 : 0);

  if (outSpec.toLowerCase() !== "null:") {
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
    const { data: encoded } = encodeImage(diffImg, { format, quality: state.quality });
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

export async function runMontageCli(
  argv: readonly string[],
  files: Map<string, Uint8Array>,
  stdinBytes?: Uint8Array
): Promise<ImageMagickCliResult> {
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
    const t = argv[i]!;
    if (t === "-tile") {
      const g = parseMagickGeometry(argv[++i] ?? "2x2");
      tileCols = g.width;
      tileRows = g.height;
    } else if (t === "-geometry") {
      const g = parseMagickGeometry(argv[++i] ?? "+2+2");
      cellW = g.width;
      cellH = g.height;
      if (g.hasOffset) {
        padX = Math.max(0, Math.round(g.x));
        padY = Math.max(0, Math.round(g.y));
      }
    } else if (t === "-background") {
      state.background = parseColor(argv[++i] ?? "#ffffff");
    } else if (t === "-bordercolor") {
      state.borderColor = parseColor(argv[++i] ?? "#dfdfdf");
    } else if (t === "-border") {
      borderW = Math.max(0, Math.round(Number(argv[++i] ?? 0)));
    } else if (t === "-gravity") {
      state.gravity = parseGravity(argv[++i] ?? "center");
    } else if (t === "-quality") {
      state.quality = Math.max(1, Math.min(100, Number(argv[++i] ?? 92)));
    } else if (t === "-mode" || t === "-label" || t === "-title") {
      i++;
    } else if (!t.startsWith("-")) {
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
  const images: RgbaImage[] = [];

  for (const p of inPaths) {
    let loadedList: RgbaImage[] | undefined;
    try {
      loadedList = parseInputOperands(p, files, state, stdinBytes);
    } catch (err) {
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
      let thumb = loaded;
      if (cellW !== undefined || cellH !== undefined) {
        const geomSpec = `${cellW ?? ""}${cellH !== undefined ? "x" + cellH : ""}`;
        thumb = applyMagickResize(thumb, geomSpec, state.kernel);
      }
      if (borderW > 0) {
        thumb = extendImage(thumb, {
          top: borderW,
          bottom: borderW,
          left: borderW,
          right: borderW,
          background: state.borderColor,
          extendWith: "background"
        });
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

  const canvas = createSolidRgbaImage(canvasW, canvasH, state.background);
  const layers = [];
  for (let idx = 0; idx < images.length; idx++) {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    if (row >= rows) break;
    const im = images[idx]!;
    const cellX = col * slotW + padX;
    const cellY = row * slotH + padY;
    const off = resolveGravityOffset(maxThumbW - im.width, maxThumbH - im.height, state.gravity);
    layers.push(rgbaToCompositeLayer(im, cellX + off.left, cellY + off.top, "over"));
  }

  const composed = compositeImage(canvas, layers);
  const { format, path: outPath } = inferOutputFormat(outSpec, "png");
  const { data: encoded } = encodeImage(composed, { format, quality: state.quality });
  if (outPath === "-" || outSpec.endsWith(":-")) {
    return { exitCode: 0, stdout: "", stderr: "", stdoutBytes: encoded };
  }
  files.set(outPath, encoded);
  return { exitCode: 0, stdout: "", stderr: "" };
}

export async function runMagickCli(
  argv: readonly string[],
  files: Map<string, Uint8Array>,
  stdinBytes?: Uint8Array
): Promise<ImageMagickCliResult> {
  const sub = argv[0];
  if (sub === "identify") {
    return runIdentifyCli(argv.slice(1), files, stdinBytes);
  }
  if (sub === "mogrify") {
    return runMogrifyCli(argv.slice(1), files);
  }
  if (sub === "composite") {
    return runCompositeCli(argv.slice(1), files, stdinBytes);
  }
  if (sub === "montage") {
    return runMontageCli(argv.slice(1), files, stdinBytes);
  }
  if (sub === "compare") {
    return runCompareCli(argv.slice(1), files, stdinBytes);
  }
  if (sub === "convert") {
    return runConvertCli(argv.slice(1), files, stdinBytes);
  }
  return runConvertCli(argv, files, stdinBytes);
}

async function executeVfsMagickTool(
  context: CommandContext,
  runner: (
    argv: readonly string[],
    files: Map<string, Uint8Array>,
    stdinBytes?: Uint8Array
  ) => Promise<ImageMagickCliResult>
): Promise<{ exitCode: number }> {
  const invocation = createOutputOperation(context, { write: async () => {} });
  try {
    const carrier = getCommandArguments(context);
    const argv = [...carrier.args];
    const vfsFiles = new Map<string, Uint8Array>();
    const resolveVfsPath = (p: string) =>
      p.startsWith("/") ? p : `${context.cwd === "/" ? "" : context.cwd}/${p}`;

    let needsStdin = false;
    const hasOutputOperand = runner !== runIdentifyCli && !(runner === runMagickCli && argv[0] === "identify");
    for (const [index, token] of argv.entries()) {
      if (token === "-" || token.endsWith(":-")) {
        if (!hasOutputOperand || index < argv.length - 1) needsStdin = true;
        continue;
      }
      if (token.startsWith("-") || token.startsWith("+") || token === "(" || token === ")") continue;
      let candidate = token.toLowerCase().startsWith("tile:") ? token.slice(5) : token;
      const prefixMatch = /^([a-zA-Z0-9]+):(.*)$/.exec(candidate);
      if (prefixMatch && extToImageFormat(prefixMatch[1]!)) {
        candidate = prefixMatch[2]!;
      }
      const bracketMatch = /^(.*)\[([^\]]+)\]$/.exec(candidate);
      if (bracketMatch) {
        candidate = bracketMatch[1]!;
      }
      try {
        const bytes = await context.fs.readFile(resolveVfsPath(candidate), {
          signal: invocation.signal
        });
        vfsFiles.set(candidate, bytes);
      } catch {
        // Output file or pseudo-operand
      }
    }

    let stdinBytes: Uint8Array | undefined;
    if (needsStdin) {
      const chunks: Uint8Array[] = [];
      let total = 0;
      for await (const chunk of readBytes(context.stdin, invocation.signal)) {
        chunks.push(chunk);
        total += chunk.byteLength;
      }
      stdinBytes = new Uint8Array(total);
      let off = 0;
      for (const chunk of chunks) {
        stdinBytes.set(chunk, off);
        off += chunk.byteLength;
      }
    }
    const existingSnap = new Map(vfsFiles);
    const res = await runner(argv, vfsFiles, stdinBytes);

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

    for (const [key, val] of vfsFiles.entries()) {
      if (existingSnap.get(key) !== val) {
        const abs = resolveVfsPath(key);
        const parentDir = abs.slice(0, abs.lastIndexOf("/")) || "/";
        try {
          await context.fs.mkdir(parentDir, { recursive: true, signal: invocation.signal });
        } catch {
          // Directory already exists
        }
        await context.fs.writeFile(abs, val, { signal: invocation.signal });
      }
    }
    return { exitCode: res.exitCode };
  } finally {
    await invocation.close();
  }
}

export function createMagickCommand(_options: ImageMagickCommandOptions = {}): CommandDefinition {
  return Object.freeze({
    name: "magick",
    runtimeIdentity: commandRuntimeIdentity,
    description: "ImageMagick v7 image processor powered by @poe-code/image-ast",
    execute(context: CommandContext) {
      return executeVfsMagickTool(context, runMagickCli);
    }
  });
}

export const magickCommand: CommandDefinition = createMagickCommand();

export function createConvertCommand(_options: ImageMagickCommandOptions = {}): CommandDefinition {
  return Object.freeze({
    name: "convert",
    runtimeIdentity: commandRuntimeIdentity,
    description: "ImageMagick convert pipeline powered by @poe-code/image-ast",
    execute(context: CommandContext) {
      return executeVfsMagickTool(context, runConvertCli);
    }
  });
}

export const convertCommand: CommandDefinition = createConvertCommand();

export function createMogrifyCommand(_options: ImageMagickCommandOptions = {}): CommandDefinition {
  return Object.freeze({
    name: "mogrify",
    runtimeIdentity: commandRuntimeIdentity,
    description: "ImageMagick in-place batch image processor powered by @poe-code/image-ast",
    execute(context: CommandContext) {
      return executeVfsMagickTool(context, (argv, files) => runMogrifyCli(argv, files));
    }
  });
}

export const mogrifyCommand: CommandDefinition = createMogrifyCommand();

export function createCompositeCommand(_options: ImageMagickCommandOptions = {}): CommandDefinition {
  return Object.freeze({
    name: "composite",
    runtimeIdentity: commandRuntimeIdentity,
    description: "ImageMagick overlay composition tool powered by @poe-code/image-ast",
    execute(context: CommandContext) {
      return executeVfsMagickTool(context, runCompositeCli);
    }
  });
}

export const compositeCommand: CommandDefinition = createCompositeCommand();

export function createMontageCommand(_options: ImageMagickCommandOptions = {}): CommandDefinition {
  return Object.freeze({
    name: "montage",
    runtimeIdentity: commandRuntimeIdentity,
    description: "ImageMagick contact-sheet grid generator powered by @poe-code/image-ast",
    execute(context: CommandContext) {
      return executeVfsMagickTool(context, runMontageCli);
    }
  });
}

export const montageCommand: CommandDefinition = createMontageCommand();

export function createIdentifyCommand(_options: ImageMagickCommandOptions = {}): CommandDefinition {
  return Object.freeze({
    name: "identify",
    runtimeIdentity: commandRuntimeIdentity,
    description: "ImageMagick image metadata inspector powered by @poe-code/image-ast",
    execute(context: CommandContext) {
      return executeVfsMagickTool(context, runIdentifyCli);
    }
  });
}

export const identifyCommand: CommandDefinition = createIdentifyCommand();

export function createCompareCommand(_options: ImageMagickCommandOptions = {}): CommandDefinition {
  return Object.freeze({
    name: "compare",
    runtimeIdentity: commandRuntimeIdentity,
    description: "ImageMagick image comparison and diff generator powered by @poe-code/image-ast",
    execute(context: CommandContext) {
      return executeVfsMagickTool(context, runCompareCli);
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
