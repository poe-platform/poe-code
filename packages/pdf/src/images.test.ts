import {expect, it, vi} from "vitest";
import {deflateSync} from "node:zlib";
import {PDFDocument, PDFName, PDFRawStream} from "pdf-lib";
import {renderPdf, suppliedDefaultFont} from "./index.js";
const fonts = [suppliedDefaultFont()];
function crc(bytes: Uint8Array): number {let value = 0xffffffff; for (const byte of bytes) {value ^= byte; for (let bit = 0; bit < 8; bit++) value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;} return (value ^ 0xffffffff) >>> 0;}
function chunk(name: string, data: Uint8Array): Uint8Array {
  const result = new Uint8Array(data.length + 12); const view = new DataView(result.buffer); view.setUint32(0, data.length);
  result.set(new TextEncoder().encode(name), 4); result.set(data, 8); view.setUint32(result.length - 4, crc(result.subarray(4, result.length - 4))); return result;
}
function png(raw: Uint8Array, color = 2, interlace = 0): Uint8Array {
  const header = new Uint8Array(13); const view = new DataView(header.buffer); view.setUint32(0, 1); view.setUint32(4, 1); header[8] = 8; header[9] = color; header[12] = interlace;
  const parts = [Uint8Array.from([137,80,78,71,13,10,26,10]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", new Uint8Array())];
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0)); let at = 0; for (const part of parts) {result.set(part, at); at += part.length;} return result;
}
const block = (bytes: Uint8Array) => ({kind: "image" as const, media: "png" as const, width: 20, height: 20, bytes});
it("rejects PNG inflation beyond the admitted scanlines before decoder allocation", async () => {
  const decode = vi.spyOn(PDFDocument.prototype, "embedPng");
  try {
    const result = await renderPdf({fonts, blocks: [block(png(new Uint8Array(100_000)))]}).then(() => "accepted", error => error.code as string);
    expect(result).toBe("E_LIMIT"); expect(decode).not.toHaveBeenCalled();
  } finally {decode.mockRestore();}
});
it("rejects malformed PNG scanlines, CRC, color depth and unsupported interlacing", async () => {
  const corrupt = png(Uint8Array.from([0, 32, 128, 192])); corrupt[corrupt.length - 1] = corrupt[corrupt.length - 1]! ^ 1;
  for (const bytes of [corrupt, png(Uint8Array.from([5, 32, 128, 192])), png(new Uint8Array(2)), png(new Uint8Array(4), 2, 1), png(new Uint8Array(4), 9)]) {
    expect(await renderPdf({fonts, blocks: [block(bytes)]}).then(() => "accepted", error => error.code as string)).toBe("E_CAPABILITY");
  }
});
it("emits PNG RGB colors and a distinct gray alpha mask with original channel values", async () => {
  const bytes = await renderPdf({fonts, blocks: [block(png(Uint8Array.from([0, 32, 128, 192, 127]), 6))]});
  const pdf = await PDFDocument.load(bytes);
  const images = pdf.context.enumerateIndirectObjects().map(([, object]) => object).filter((object): object is PDFRawStream => object instanceof PDFRawStream && object.dict.get(PDFName.of("Subtype")) === PDFName.of("Image"));
  const {decodePDFRawStream} = await import("pdf-lib");
  const rgb = images.find(image => image.dict.get(PDFName.of("ColorSpace")) === PDFName.of("DeviceRGB"))!;
  const gray = images.find(image => image.dict.get(PDFName.of("ColorSpace")) === PDFName.of("DeviceGray"))!;
  expect([...decodePDFRawStream(rgb).decode()]).toEqual([32,128,192]); expect([...decodePDFRawStream(gray).decode()]).toEqual([127]);
  expect(pdf.context.lookup(rgb.dict.get(PDFName.of("SMask")))).toBe(gray);
});
function jpeg(components: number, precision = 8, adobe = false): Uint8Array {
  // Original minimal object fixture: SOI, optional Adobe APP14, SOF0, EOI.
  // Tests assert embedding dictionaries, not that this is renderable entropy data.
  const app = adobe ? [255,238,0,14,65,100,111,98,101,0,100,0,0,0,0,0] : [];
  const frame = [255,192,0,8 + components * 3,precision,0,1,0,1,components];
  for (let i = 0; i < components; i++) frame.push(i + 1,17,0);
  return Uint8Array.from([255,216,...app,...frame,255,217]);
}
it("admits only supported JPEG precision and unambiguous color transforms", async () => {
  for (const bytes of [jpeg(3, 0), jpeg(3, 12), jpeg(2), jpeg(4)]) {
    expect(await renderPdf({fonts, blocks: [{...block(bytes), media: "jpeg"}]}).then(() => "accepted", error => error.code as string)).toBe("E_CAPABILITY");
  }
});
it("preserves JPEG gray, RGB and Adobe CMYK dictionaries independently", async () => {
  for (const [components, color] of [[1,"DeviceGray"], [3,"DeviceRGB"], [4,"DeviceCMYK"]] as const) {
    const bytes = jpeg(components, 8, components === 4);
    const pdf = await PDFDocument.load(await renderPdf({fonts, blocks: [{...block(bytes), media: "jpeg"}]}));
    const image = pdf.context.enumerateIndirectObjects().map(([, object]) => object).find((object): object is PDFRawStream => object instanceof PDFRawStream && object.dict.get(PDFName.of("Subtype")) === PDFName.of("Image"))!;
    expect(image.dict.get(PDFName.of("ColorSpace"))).toBe(PDFName.of(color)); expect(image.dict.get(PDFName.of("Filter"))).toBe(PDFName.of("DCTDecode"));
    expect([...image.getContents()]).toEqual([...bytes]);
    if (components === 4) expect(image.dict.get(PDFName.of("Decode"))!.toString()).toBe("[ 1 0 1 0 1 0 1 0 ]");
    else expect(image.dict.has(PDFName.of("Decode"))).toBe(false);
  }
});
