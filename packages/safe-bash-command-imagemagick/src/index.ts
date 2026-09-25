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
  negateImage,
  normalizeImage,
  parseColor,
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

  if (isArea) {
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
    const [wStr, hStr] = s.split(/[xX]/);
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
  geometry: string | undefined;
  tile: string | undefined;
  strip: boolean;
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
    geometry: undefined,
    tile: undefined,
    strip: false
  };
}

function resolveGravityOffset(
  spaceW: number,
  spaceH: number,
  gravity: GravityPosition
): { readonly left: number; readonly top: number } {
  let left = 0;
  let top = 0;
  if (gravity === "north" || gravity === "center" || gravity === "south") {
    left = Math.round(spaceW / 2);
  } else if (gravity === "northeast" || gravity === "east" || gravity === "southeast") {
    left = Math.round(spaceW);
  }
  if (gravity === "west" || gravity === "center" || gravity === "east") {
    top = Math.round(spaceH / 2);
  } else if (gravity === "southwest" || gravity === "south" || gravity === "southeast") {
    top = Math.round(spaceH);
  }
  return { left, top };
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
  const g = parseMagickGeometry(geomStr);
  const cropW = g.isPercent
    ? Math.max(1, Math.round((img.width * (g.percentX ?? 100)) / 100))
    : Math.min(img.width, Math.max(1, Math.round(g.width ?? img.width)));
  const cropH = g.isPercent
    ? Math.max(1, Math.round((img.height * (g.percentY ?? 100)) / 100))
    : Math.min(img.height, Math.max(1, Math.round(g.height ?? img.height)));

  let left = g.x;
  let top = g.y;
  if (!g.hasOffset || gravity !== "northwest") {
    const base = resolveGravityOffset(img.width - cropW, img.height - cropH, gravity);
    left = base.left + g.x;
    top = base.top + g.y;
  }
  const clampedLeft = Math.max(0, Math.min(img.width - 1, Math.round(left)));
  const clampedTop = Math.max(0, Math.min(img.height - 1, Math.round(top)));
  const finalW = Math.max(1, Math.min(cropW, img.width - clampedLeft));
  const finalH = Math.max(1, Math.min(cropH, img.height - clampedTop));
  return extractImage(img, { left: clampedLeft, top: clampedTop, width: finalW, height: finalH });
}

function applyMagickExtent(img: RgbaImage, geomStr: string, state: MagickState): RgbaImage {
  const g = parseMagickGeometry(geomStr);
  const targetW = Math.max(1, Math.round(g.width ?? img.width));
  const targetH = Math.max(1, Math.round(g.height ?? img.height));
  const canvas = createSolidRgbaImage(targetW, targetH, state.background);
  const offset = resolveGravityOffset(targetW - img.width, targetH - img.height, state.gravity);
  const left = offset.left + g.x;
  const top = offset.top + g.y;
  return compositeImage(canvas, [rgbaToCompositeLayer(img, left, top, "over")]);
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
      const rw = Math.max(1, Math.abs(x1 - x0));
      const rh = Math.max(1, Math.abs(y1 - y0));
      svgElements.push(
        `<rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`
      );
    } else if (cmd === "roundrectangle") {
      const x0 = num();
      const y0 = num();
      const x1 = num();
      const y1 = num();
      const wc = num();
      const hc = num();
      const rx = Math.min(x0, x1);
      const ry = Math.min(y0, y1);
      const rw = Math.max(1, Math.abs(x1 - x0));
      const rh = Math.max(1, Math.abs(y1 - y0));
      svgElements.push(
        `<rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" rx="${wc}" ry="${hc}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`
      );
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
  const lower = token.toLowerCase();
  if (lower.startsWith("xc:") || lower.startsWith("canvas:")) {
    const colorStr = token.slice(token.indexOf(":") + 1) || "white";
    const c = parseColor(colorStr);
    return createSolidRgbaImage(state.sizeWidth, state.sizeHeight, c);
  }
  if (lower.startsWith("label:") || lower.startsWith("caption:")) {
    const text = token.slice(token.indexOf(":") + 1);
    return createLabelImage(text, state);
  }
  if (lower === "null:") {
    return createSolidRgbaImage(1, 1, { r: 0, g: 0, b: 0, a: 0 });
  }

  let cleanToken = token;
  const prefixMatch = /^([a-zA-Z0-9]+):(.*)$/.exec(cleanToken);
  if (prefixMatch && extToImageFormat(prefixMatch[1]!)) {
    cleanToken = prefixMatch[2]!;
  }

  let pageIdx: number | undefined;
  let inlineResize: string | undefined;
  const bracketMatch = /^(.*)\[([^\]]+)\]$/.exec(cleanToken);
  if (bracketMatch) {
    cleanToken = bracketMatch[1]!;
    const inside = bracketMatch[2]!;
    if (/^\d+$/.test(inside)) {
      pageIdx = parseInt(inside, 10);
    } else {
      inlineResize = inside;
    }
  }

  const rawBytes = cleanToken === "-" ? stdinBytes : files.get(cleanToken) ?? files.get(token);
  if (!rawBytes) return undefined;

  let img = decodeImage(rawBytes, {
    density: state.density,
    ...(pageIdx !== undefined ? { page: pageIdx } : {})
  });
  if (inlineResize) {
    img = applyMagickResize(img, inlineResize, state.kernel);
  }
  return img;
}

function formatIdentifyCustom(fmt: string, filePath: string, meta: ImageMetadata, byteLen: number): string {
  const baseName = filePath.split("/").pop() ?? filePath;
  const rootName = baseName.replace(/\.[^.]+$/, "");
  const ext = baseName.includes(".") ? baseName.split(".").pop()! : "";
  const bitDepth = meta.depth === "ushort" ? "16" : meta.depth === "bit" ? "1" : "8";
  const space = meta.space === "b-w" ? "Gray" : meta.space === "cmyk" ? "CMYK" : "sRGB";
  return fmt
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
    } else if (!a.startsWith("-")) {
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
    const baseInPath = bracketMatch ? bracketMatch[1]! : inPath;
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
        outParts.push(formatIdentifyCustom(customFormat, baseInPath, meta, bytes.byteLength));
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
      const subTokens = tokens.slice(i + 1, j - 1);
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
      state.compose = parseCompose(tokens[++i] ?? "over");
    } else if (t === "-geometry") {
      state.geometry = tokens[++i] ?? "+0+0";
    } else if (t === "-tile") {
      state.tile = tokens[++i];
    } else if (t === "-strip") {
      state.strip = true;
    } else if (t === "+repage" || t === "-repage") {
      if (t === "-repage") i++;
    } else if (t === "-resize" || t === "-scale" || t === "-sample" || t === "-thumbnail") {
      const geom = tokens[++i] ?? "100%";
      const k = t === "-sample" ? "nearest" : state.kernel;
      stack = stack.map((im) => applyMagickResize(im, geom, k));
    } else if (t === "-crop") {
      const geom = tokens[++i] ?? "100%";
      stack = stack.map((im) => applyMagickCrop(im, geom, state.gravity));
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
      stack = stack.map((im) =>
        extractImage(im, {
          left: sw,
          top: sh,
          width: Math.max(1, im.width - sw * 2),
          height: Math.max(1, im.height - sh * 2)
        })
      );
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
      stack = stack.map((im) => negateImage(im, { alpha: false }));
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
      stack = stack.map((im) => linearImage(im, [slope, slope, slope], [offset, offset, offset]));
    } else if (t === "-gamma") {
      const gammaVal = Math.max(0.1, Number(tokens[++i] ?? 1.0));
      stack = stack.map((im) => gammaImage(im, gammaVal, gammaVal));
    } else if (t === "-normalize" || t === "-auto-level" || t === "-contrast-stretch") {
      if (t === "-contrast-stretch") i++;
      stack = stack.map((im) => normalizeImage(im));
    } else if (t === "-level") {
      const raw = tokens[++i] ?? "0,100%";
      const isPct = raw.endsWith("%");
      const clean = raw.replace(/%/g, "");
      const [bStr, wStr] = clean.split(",");
      const black = isPct ? (Number(bStr ?? 0) / 100) * 255 : Number(bStr ?? 0);
      const white = isPct ? (Number(wStr ?? 100) / 100) * 255 : Number(wStr ?? 255);
      const span = Math.max(1, white - black);
      const slope = 255 / span;
      const offset = -black * slope;
      stack = stack.map((im) => linearImage(im, [slope, slope, slope], [offset, offset, offset]));
    } else if (t === "-threshold") {
      const raw = tokens[++i] ?? "50%";
      const val = raw.endsWith("%")
        ? Math.round((parseFloat(raw) / 100) * 255)
        : Math.round(parseFloat(raw));
      stack = stack.map((im) => thresholdImage(im, val, true));
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
      if (tokens[i + 1] && !tokens[i + 1]!.startsWith("-") && !tokens[i + 1]!.startsWith("+")) {
        i++;
      }
      stack = stack.map((im) => (method.includes("erode") ? erodeImage(im, 1) : dilateImage(im, 1)));
    } else if (t === "-alpha") {
      const mode = (tokens[++i] ?? "on").toLowerCase();
      if (mode === "off" || mode === "remove" || mode === "deactivate") {
        stack = stack.map((im) => removeAlphaImage(flattenImage(im, state.background)));
      } else if (mode === "on" || mode === "set" || mode === "activate") {
        stack = stack.map((im) => ensureAlphaImage(im, 1));
      } else if (mode === "extract") {
        stack = stack.map((im) => extractChannelImage(im, 3));
      }
    } else if (t === "-separate") {
      const nextStack: RgbaImage[] = [];
      for (const im of stack) {
        nextStack.push(
          extractChannelImage(im, 0),
          extractChannelImage(im, 1),
          extractChannelImage(im, 2)
        );
      }
      stack = nextStack;
    } else if (t === "-combine") {
      if (stack.length >= 3) {
        const base = stack[0]!;
        let combined = joinChannelImage(base, [stack[1]!, stack[2]!]);
        if (stack[3]) {
          combined = joinChannelImage(combined, [stack[3]!]);
        }
        stack = [combined];
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
      if (t === "+clone") {
        const last = sourcePool[sourcePool.length - 1];
        if (last) stack.push({ ...last, data: new Uint8Array(last.data) });
      } else {
        const idxSpec = tokens[++i] ?? "-1";
        const idx = Number(idxSpec);
        const resolved = idx < 0 ? sourcePool.length + idx : idx;
        const chosen = sourcePool[resolved];
        if (chosen) stack.push({ ...chosen, data: new Uint8Array(chosen.data) });
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
        const idx = Number(tokens[++i] ?? -1);
        const resolved = idx < 0 ? stack.length + idx : idx;
        if (resolved >= 0 && resolved < stack.length) {
          stack.splice(resolved, 1);
        }
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
        const composed = compositeImage(base, [
          rgbaToCompositeLayer(overlay, grav.left + gx, grav.top + gy, state.compose)
        ]);
        stack = [composed, ...stack.slice(2)];
      }
    } else {
      const loaded = parseInputOperand(t, files, state, stdinBytes);
      if (loaded) {
        stack.push(loaded);
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
    if (outSpec.toLowerCase() === "info:" || outSpec.toLowerCase() === "info:-") {
      return {
        exitCode: 0,
        stdout: `${finalImg.width}x${finalImg.height} sRGB 8-bit\n`,
        stderr: ""
      };
    }

    const { format, path: outPath } = inferOutputFormat(outSpec, "png");
    const { data: encoded } = encodeImage(finalImg, { format, quality: state.quality });

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
  let outFormat: ImageFormat | undefined;
  let outDir: string | undefined;
  const opTokens: string[] = [];
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
    "-threshold",
    "-tint",
    "-colorize",
    "-blur",
    "-gaussian-blur",
    "-sharpen",
    "-unsharp",
    "-median",
    "-alpha",
    "-draw"
  ]);

  for (let i = 0; i < argv.length; i++) {
    const t = argv[i]!;
    if (t === "-format") {
      outFormat = extToImageFormat(argv[++i] ?? "png") ?? "png";
    } else if (t === "-path") {
      outDir = argv[++i];
    } else if (t === "-annotate") {
      const a1 = argv[++i] ?? "+0+0";
      if (/^[+-]\d/.test(a1) || /^\d+x\d+/.test(a1)) {
        opTokens.push("-annotate", a1, argv[++i] ?? "");
      } else {
        opTokens.push("-annotate", a1);
      }
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
    const targetExt = outFormat ?? extToImageFormat(origExt) ?? "png";
    const destDir = outDir ? outDir.replace(/\/+$/, "") : target.slice(0, target.lastIndexOf("/"));
    const destPath = outFormat || outDir ? `${destDir ? destDir + "/" : ""}${stem}.${targetExt}` : target;

    const res = await runConvertCli([target, ...opTokens, destPath], files);
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
    if (t === "-gravity" || t === "-geometry" || t === "-compose" || t === "-background" || t === "-quality") {
      options.push(t, argv[++i] ?? "");
    } else if (t === "-dissolve" || t === "-blend" || t === "-watermark") {
      i++;
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
    const loaded = parseInputOperand(p, files, state, stdinBytes);
    if (!loaded) {
      return {
        exitCode: 1,
        stdout: "",
        stderr: `montage: unable to open image '${p}': No such file or directory\n`
      };
    }
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

  const n = images.length;
  const cols = tileCols ?? Math.ceil(Math.sqrt(n));
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
    for (const token of argv) {
      if (token === "-" || token.endsWith(":-")) {
        needsStdin = true;
        continue;
      }
      if (token.startsWith("-") || token.startsWith("+") || token === "(" || token === ")") continue;
      let candidate = token;
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

export function imagemagickPlugin(options: ImageMagickCommandOptions = {}): VirtualShellPlugin {
  const magick = createMagickCommand(options);
  const convert = createConvertCommand(options);
  const mogrify = createMogrifyCommand(options);
  const composite = createCompositeCommand(options);
  const montage = createMontageCommand(options);
  const identify = createIdentifyCommand(options);
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
    }
  };
}

export const imagemagickCommands = imagemagickPlugin;
