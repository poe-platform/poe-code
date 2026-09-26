import { encode as encodeJpeg } from "jpeg-js";
import { SsconvertError, type CapabilityContext } from "../../contracts.js";
import { ImageExportError, profileImageTargets } from "./formats.js";
import { encodeProfileRaster } from "./profile-raster.js";

export type ImagePathCommand =
  | { readonly kind: "move" | "line"; readonly x: number; readonly y: number }
  | { readonly kind: "curve"; readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number; readonly x: number; readonly y: number }
  | { readonly kind: "close" };
export type ImageCommand =
  | { readonly kind: "rectangle"; readonly x: number; readonly y: number; readonly width: number; readonly height: number; readonly fill: string }
  | { readonly kind: "path"; readonly commands: readonly ImagePathCommand[]; readonly fill?: string; readonly stroke?: string; readonly lineWidth?: number }
  | { readonly kind: "text"; readonly x: number; readonly y: number; readonly text: string; readonly size: number; readonly font: "Helvetica"; readonly fill: string };
/** The scene producer owns chart layout and profile-specific font/raster fidelity.
 * Codecs never synthesize a raster from an unrelated vector or drop scene commands.
 */
export interface ImageSurface {
  readonly width: number;
  readonly height: number;
  readonly commands: readonly ImageCommand[];
  readonly raster?: { readonly width: number; readonly height: number; readonly rgba: Uint8Array };
}
const encoder = new TextEncoder();
function number(value: number): string {
  if (!Number.isFinite(value)) throw new ImageExportError("Invalid image geometry");
  return String(value === 0 ? 0 : value);
}
function color(text: string): readonly [number, number, number] {
  if (text.length !== 7 || text[0] !== "#" || !Array.from(text.slice(1)).every(char => "0123456789abcdefABCDEF".includes(char)))
    throw new ImageExportError("Unsupported image color");
  return [Number.parseInt(text.slice(1, 3), 16) / 255, Number.parseInt(text.slice(3, 5), 16) / 255, Number.parseInt(text.slice(5, 7), 16) / 255];
}
function literal(text: string): string {
  if (Array.from(text).some(char => char.codePointAt(0)! > 126 || char.codePointAt(0)! < 32))
    throw new ImageExportError("Unsupported image text encoding");
  return text.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
}
function xml(text: string, context: CapabilityContext): string {
  let escaped = "", bytes = 0;
  bounded(text.length, context.limits.workbookWork ?? context.limits.inputBytes + context.limits.cells * 32, "text work");
  for (const char of text) {
    context.signal.throwIfAborted();
    const point = char.codePointAt(0)!;
    if (!(point === 9 || point === 10 || point === 13 || point >= 32 && point <= 0xd7ff || point >= 0xe000 && point <= 0xfffd || point >= 0x10000 && point <= 0x10ffff))
      throw new ImageExportError("Unsupported image text encoding");
    const value = char === "&" ? "&amp;" : char === "<" ? "&lt;" : char === ">" ? "&gt;" : char === '"' ? "&quot;" : char;
    bytes += value.length > char.length ? value.length : point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
    bounded(bytes, context.limits.outputBytes, "output bytes");
    escaped += value;
  }
  return escaped;
}
function utf8Length(text: string, context: CapabilityContext): number {
  let bytes = 0;
  for (const char of text) {
    context.signal.throwIfAborted();
    const point = char.codePointAt(0)!;
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
    bounded(bytes, context.limits.outputBytes, "output bytes");
  }
  return bytes;
}
function bounded(amount: number, maximum: number, name: string): void {
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > maximum)
    throw new SsconvertError("resource-limit", `ssconvert image ${name} limit exceeded`);
}
function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(data.length + 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, data.length);
  bytes.set(encoder.encode(type), 4); bytes.set(data, 8);
  let crc = 0xffffffff;
  for (const byte of bytes.subarray(4, bytes.length - 4)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  view.setUint32(bytes.length - 4, (crc ^ 0xffffffff) >>> 0);
  return bytes;
}
function join(parts: readonly Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return bytes;
}
/** RFC 1950/1951 stored blocks. Pixel fidelity is independent of compression. */
function deflateStored(raw: Uint8Array, context: CapabilityContext): Uint8Array {
  const parts: Uint8Array[] = [new Uint8Array([0x78, 0x01])];
  let a = 1, b = 0;
  for (let offset = 0; offset < raw.length; offset += 65535) {
    context.signal.throwIfAborted();
    const block = raw.subarray(offset, Math.min(offset + 65535, raw.length));
    const header = new Uint8Array(5); const view = new DataView(header.buffer);
    header[0] = offset + block.length === raw.length ? 1 : 0;
    view.setUint16(1, block.length, true); view.setUint16(3, 65535 - block.length, true);
    parts.push(header, block);
    for (const byte of block) { a = (a + byte) % 65521; b = (b + a) % 65521; }
  }
  const checksum = new Uint8Array(4);
  new DataView(checksum.buffer).setUint32(0, ((b << 16) | a) >>> 0);
  parts.push(checksum);
  return join(parts);
}
function raster(surface: ImageSurface, context: CapabilityContext) {
  const value = surface.raster;
  if (!value) throw new ImageExportError("Missing profile-specific raster surface");
  if (!Number.isSafeInteger(value.width) || !Number.isSafeInteger(value.height) || value.width < 1 || value.height < 1 || value.width > 32767 || value.height > 32767)
    throw new ImageExportError("Invalid raster surface geometry");
  bounded(value.width * value.height * 4, context.limits.workbookWork ?? context.limits.inputBytes + context.limits.cells * 32, "raster work");
  if (value.rgba.byteLength !== value.width * value.height * 4) throw new ImageExportError("Invalid raster surface bytes");
  return value;
}
function encodePng(surface: ImageSurface, context: CapabilityContext): Uint8Array {
  const { width, height, rgba } = raster(surface, context);
  const length = (width * 4 + 1) * height;
  bounded(length + Math.ceil(length / 65535) * 5 + 63, context.limits.outputBytes, "output bytes");
  const raw = new Uint8Array(length);
  for (let row = 0; row < height; row++) {
    context.signal.throwIfAborted();
    raw.set(rgba.subarray(row * width * 4, (row + 1) * width * 4), row * (width * 4 + 1) + 1);
  }
  const ihdr = new Uint8Array(13); const view = new DataView(ihdr.buffer);
  view.setUint32(0, width); view.setUint32(4, height); ihdr[8] = 8; ihdr[9] = 6;
  return join([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk("IHDR", ihdr), pngChunk("IDAT", deflateStored(raw, context)), pngChunk("IEND", new Uint8Array())]);
}
function vectorContent(surface: ImageSurface, format: string, context: CapabilityContext): string {
  let body = "";
  let bodyBytes = 0;
  let work = 0;
  const maximum = context.limits.workbookWork ?? context.limits.inputBytes + context.limits.cells * 32;
  const paint = (fill: string, stroke = false) => color(fill).map(number).join(" ") + (format === "pdf" ? stroke ? " RG\n" : " rg\n" : " setrgbcolor\n");
  const append = (text: string) => { bodyBytes += utf8Length(text, context); bounded(bodyBytes, context.limits.outputBytes, "output bytes"); body += text; };
  for (const command of surface.commands) {
    context.signal.throwIfAborted(); bounded(++work, maximum, "vector work");
    if (command.kind === "rectangle") {
      const box = [command.x, command.y, command.width, command.height].map(number);
      color(command.fill);
      if (format === "svg") append(`<rect x="${box[0]}" y="${box[1]}" width="${box[2]}" height="${box[3]}" fill="${command.fill}"/>\n`);
      else append(paint(command.fill) + box.join(" ") + (format === "pdf" ? " re f\n" : " rectfill\n"));
    } else if (command.kind === "text") {
      color(command.fill);
      if (command.font !== "Helvetica") throw new ImageExportError("Unsupported image font");
      work += command.text.length;
      bounded(work, maximum, "text work");
      if (!(command.size > 0)) throw new ImageExportError("Invalid image font size");
      const x = number(command.x), y = number(command.y), size = number(command.size);
      if (format === "svg") append(`<text x="${x}" y="${y}" font-family="${command.font}" font-size="${size}" fill="${command.fill}">${xml(command.text, context)}</text>\n`);
      else if (format === "pdf") append(paint(command.fill) + `BT /F1 ${size} Tf 1 0 0 -1 ${x} ${y} Tm (${literal(command.text)}) Tj ET\n`);
      else append(paint(command.fill) + `gsave ${x} ${y} translate 1 -1 scale /Helvetica findfont ${size} scalefont setfont 0 0 moveto (${literal(command.text)}) show grestore\n`);
    } else {
      if (command.fill) color(command.fill);
      if (command.stroke) color(command.stroke);
      if (command.lineWidth !== undefined && !(command.lineWidth >= 0)) throw new ImageExportError("Invalid image line width");
      let path = "";
      for (const point of command.commands) {
        context.signal.throwIfAborted(); bounded(++work, maximum, "vector work");
        let segment: string;
        if (point.kind === "close") segment = format === "svg" ? "Z " : format === "pdf" ? "h\n" : "closepath\n";
        else {
          const coordinates = (point.kind === "curve" ? [point.x1, point.y1, point.x2, point.y2, point.x, point.y] : [point.x, point.y]).map(number).join(" ");
          segment = format === "svg" ? `${point.kind === "move" ? "M" : point.kind === "line" ? "L" : "C"}${coordinates} ` : `${coordinates} ${format === "pdf" ? point.kind === "move" ? "m" : point.kind === "line" ? "l" : "c" : point.kind === "move" ? "moveto" : point.kind === "line" ? "lineto" : "curveto"}\n`;
        }
        bounded(path.length + segment.length, context.limits.outputBytes, "output bytes"); path += segment;
      }
      if (format === "svg") append(`<path d="${path}" fill="${command.fill ?? "none"}" stroke="${command.stroke ?? "none"}" stroke-width="${number(command.lineWidth ?? 1)}"/>\n`);
      else if (format === "pdf") append((command.fill ? paint(command.fill) : "") + (command.stroke ? paint(command.stroke, true) + `${number(command.lineWidth ?? 1)} w\n` : "") + path + (command.fill && command.stroke ? "B\n" : command.fill ? "f\n" : command.stroke ? "S\n" : "n\n"));
      else append("newpath\n" + path + (command.fill ? "gsave\n" + paint(command.fill) + "fill grestore\n" : "") + (command.stroke ? paint(command.stroke) + `${number(command.lineWidth ?? 1)} setlinewidth stroke\n` : "newpath\n"));
    }
  }
  return body;
}
function pdf(surface: ImageSurface, content: string): string {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${number(surface.width)} ${number(surface.height)}] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>`,
    `<< /Length ${encoder.encode(content).length} >>\nstream\n${content}endstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
  ];
  let document = "%PDF-1.7\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) { offsets.push(encoder.encode(document).length); document += `${index + 1} 0 obj\n${object}\nendobj\n`; }
  const xref = encoder.encode(document).length;
  document += `xref\n0 ${offsets.length}\n0000000000 65535 f \n` + offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  return document + `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
}
export async function encodeGraphImage(surface: ImageSurface, format: string, context: CapabilityContext): Promise<Uint8Array> {
  context.signal.throwIfAborted();
  const descriptor = profileImageTargets.find(candidate => candidate.id === format);
  if (!descriptor) throw new ImageExportError("Unknown image format");
  if (!descriptor.graphRenderable) throw new ImageExportError("Unknown failure while saving image");
  if (!(surface.width >= 1 && surface.height >= 1)) throw new ImageExportError("Invalid image geometry");
  number(surface.width); number(surface.height);
  let bytes: Uint8Array;
  if (format === "png") bytes = encodePng(surface, context);
  else if (["bmp", "ico", "tiff"].includes(format)) bytes = encodeProfileRaster(raster(surface, context), format, context);
  else if (format === "jpeg") {
    const image = raster(surface, context);
    const rgba = new Uint8Array(image.rgba.length);
    for (let offset = 0; offset < rgba.length; offset += 4) {
      if (offset % (image.width * 4) === 0) context.signal.throwIfAborted();
      const alpha = image.rgba[offset + 3]!;
      for (let channel = 0; channel < 3; channel++) rgba[offset + channel] = Math.floor((image.rgba[offset + channel]! * alpha + 255 * (255 - alpha) + 127) / 255);
      rgba[offset + 3] = 255;
    }
    bytes = new Uint8Array(encodeJpeg({ width: image.width, height: image.height, data: rgba }, 75).data);
  } else {
    const content = vectorContent(surface, format, context);
    const width = number(surface.width), height = number(surface.height);
    if (format === "svg") bytes = encoder.encode(`<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n${content}</svg>\n`);
    else if (format === "pdf") bytes = encoder.encode(pdf(surface, `q\n1 0 0 -1 0 ${height} cm\n${content}Q\n`));
    else {
      const inkBox = surface.commands.length === 0 ? `0 ${Math.ceil(surface.height)} 0 ${Math.ceil(surface.height)}` : `0 0 ${Math.ceil(surface.width)} ${Math.ceil(surface.height)}`;
      bytes = encoder.encode(`%!PS-Adobe-3.0${format === "eps" ? " EPSF-3.0" : ""}\n%%Pages: 1\n%%LanguageLevel: 2\n%%BoundingBox: ${inkBox}\n%%DocumentMedia: ${width}x${height} ${width} ${height} 0 () ()\n%%EndComments\n%%Page: 1 1\n%%PageMedia: ${width}x${height}\n%%PageBoundingBox: ${inkBox}\n${format === "eps" ? "" : `<< /PageSize [${width} ${height}] >> setpagedevice\n`}gsave\n0 ${height} translate 1 -1 scale\n${content}grestore\nshowpage\n%%EOF\n`);
    }
  }
  context.signal.throwIfAborted(); bounded(bytes.byteLength, context.limits.outputBytes, "output bytes");
  return bytes;
}
