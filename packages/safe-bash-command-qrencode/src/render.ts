import { encodeImage } from "@poe-code/image-ast/portable";
import type { QrSymbol } from "./encoder.js";

export const outputTypes = [
  "PNG",
  "PNG32",
  "SVG",
  "EPS",
  "ASCII",
  "ASCIIi",
  "UTF8",
  "UTF8i",
  "ANSI",
  "ANSI256",
  "ANSIUTF8"
] as const;
export interface RenderOptions {
  readonly type: (typeof outputTypes)[number];
  readonly size: number;
  readonly margin: number;
  readonly dpi: number;
  readonly foreground: readonly number[];
  readonly background: readonly number[];
}
export function renderQr(
  symbol: QrSymbol,
  options: RenderOptions,
  maxMemoryBytes: number
): Uint8Array {
  const { type, size, margin, dpi, foreground: fg, background: bg } = options;
  const n = symbol.modules.length,
    width = n + 2 * margin,
    pixels = width * size;
  const raster = type === "PNG" || type === "PNG32",
    vector = type === "SVG" || type === "EPS";
  const estimate = raster
    ? pixels * pixels * 24 + 1_048_576
    : vector
      ? n * n * 240 + 4096
      : width * width * 48 + 4096;
  if (
    !Number.isSafeInteger(pixels) ||
    pixels > 0x7fffffff ||
    !Number.isSafeInteger(estimate) ||
    estimate > maxMemoryBytes
  )
    throw new Error("QR output exceeds memory budget");
  const dark = (x: number, y: number): boolean => symbol.modules[y - margin]?.[x - margin] ?? false;
  if (raster) {
    const data = new Uint8Array(pixels * pixels * 4);
    for (let y = 0; y < pixels; y++)
      for (let x = 0; x < pixels; x++)
        data.set(dark(Math.floor(x / size), Math.floor(y / size)) ? fg : bg, (y * pixels + x) * 4);
    return encodeImage(
      {
        width: pixels,
        height: pixels,
        data,
        format: "png",
        space: "srgb",
        channels: 4,
        depth: "uchar",
        density: dpi,
        hasAlpha: true
      },
      { format: "png" }
    ).data;
  }
  let text = "";
  if (type === "SVG") {
    const color = (c: readonly number[]): string => `rgb(${c[0]},${c[1]},${c[2]})`;
    text = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${pixels}" height="${pixels}" viewBox="0 0 ${width} ${width}" shape-rendering="crispEdges">\n<rect width="${width}" height="${width}" fill="${color(bg)}" fill-opacity="${bg[3]! / 255}"/>\n<path fill="${color(fg)}" fill-opacity="${fg[3]! / 255}" d="`;
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++)
        if (symbol.modules[y]![x]) text += `M${x + margin} ${y + margin}h1v1h-1z`;
    text += '"/>\n</svg>\n';
  } else if (type === "EPS") {
    const rgb = (c: readonly number[]): string =>
      c
        .slice(0, 3)
        .map((v) => v / 255)
        .join(" ");
    text = `%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 ${pixels} ${pixels}\n%%EndComments\n${rgb(bg)} setrgbcolor\n0 0 ${pixels} ${pixels} rectfill\n${rgb(fg)} setrgbcolor\n`;
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++)
        if (symbol.modules[y]![x])
          text += `${(x + margin) * size} ${(width - y - margin - 1) * size} ${size} ${size} rectfill\n`;
    text += "showpage\n%%EOF\n";
  } else if (type === "ASCII" || type === "ASCIIi") {
    for (let y = 0; y < width; y++) {
      for (let x = 0; x < width; x++) text += dark(x, y) !== (type === "ASCIIi") ? "##" : "  ";
      text += "\n";
    }
  } else if (type === "ANSI" || type === "ANSI256") {
    const white = type === "ANSI" ? "\x1b[47m" : "\x1b[48;5;231m",
      black = type === "ANSI" ? "\x1b[40m" : "\x1b[48;5;16m";
    for (let y = 0; y < width; y++) {
      text += white;
      let previous = false;
      for (let x = 0; x < width; x++) {
        const value = dark(x, y);
        if (value !== previous) text += value ? black : white;
        previous = value;
        text += "  ";
      }
      if (previous) text += white;
      text += "\x1b[0m\n";
    }
  } else {
    const inverted = type === "UTF8i";
    for (let y = 0; y < width; y += 2) {
      if (type === "ANSIUTF8") text += "\x1b[40;37;1m";
      for (let x = 0; x < width; x++) {
        const top = dark(x, y) !== inverted,
          bottom = dark(x, y + 1) !== inverted;
        text += ["█", "▄", "▀", " "][Number(top) + 2 * Number(bottom)];
      }
      if (type === "ANSIUTF8") text += "\x1b[0m";
      text += "\n";
    }
  }
  return new TextEncoder().encode(text);
}
