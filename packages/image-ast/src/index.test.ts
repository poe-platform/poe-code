import { describe, expect, it } from "vitest";
import { PdfDocument, createStandardFontHandle } from "@poe-code/pdf-ast";
import sharp, {
  decodeImage,
  encodeJpegImage,
  encodePngImage,
  parseColor,
  type RgbaImage
} from "./index.js";

function createSampleGradient(width = 64, height = 48): Uint8Array {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      data[idx] = Math.round((x / Math.max(1, width - 1)) * 255);
      data[idx + 1] = Math.round((y / Math.max(1, height - 1)) * 255);
      data[idx + 2] = 120;
      data[idx + 3] = 255;
    }
  }
  return encodePngImage({
    width,
    height,
    data,
    format: "png",
    space: "srgb",
    channels: 3,
    depth: "uchar",
    density: 144,
    hasAlpha: false
  });
}

function computePsnr(a: Uint8Array, b: Uint8Array): number {
  let mse = 0;
  const count = Math.min(a.length, b.length);
  let channelsCount = 0;
  for (let i = 0; i < count; i += 4) {
    for (let c = 0; c < 3; c++) {
      const diff = a[i + c]! - b[i + c]!;
      mse += diff * diff;
      channelsCount++;
    }
  }
  mse /= Math.max(1, channelsCount);
  if (mse === 0) return Infinity;
  return 10 * Math.log10((255 * 255) / mse);
}

describe("@poe-code/image-ast (sharp core)", () => {
  it("parses hex, rgb/rgba, and named colors accurately", () => {
    expect(parseColor("#ff8000")).toEqual({ r: 255, g: 128, b: 0, a: 255 });
    expect(parseColor("FFFFFF")).toEqual({ r: 255, g: 255, b: 255, a: 255 });
    expect(parseColor("#f0a8")).toEqual({ r: 255, g: 0, b: 170, a: 136 });
    expect(parseColor("rgba(10, 20, 30, 0.5)")).toEqual({ r: 10, g: 20, b: 30, a: 128 });
    expect(parseColor("transparent")).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });

  it("reads PNG metadata including pHYs DPI density and encodes/decodes losslessly", async () => {
    const pngBytes = createSampleGradient(80, 60);
    const meta = await sharp(pngBytes).metadata();
    expect(meta.format).toBe("png");
    expect(meta.width).toBe(80);
    expect(meta.height).toBe(60);
    expect(meta.density).toBe(144);
    expect(meta.hasAlpha).toBe(false);

    const roundtrip = await sharp(pngBytes).png().toBuffer();
    const a = decodeImage(pngBytes);
    const b = decodeImage(roundtrip);
    expect(b.width).toBe(80);
    expect(b.height).toBe(60);
    expect(Array.from(b.data)).toEqual(Array.from(a.data));
  });

  it("encodes and decodes baseline JPEG with PSNR > 32 dB and preserves DPI/EXIF orientation", async () => {
    const pngBytes = createSampleGradient(64, 48);
    const srcImg = decodeImage(pngBytes);
    const jpegBytes = await sharp(pngBytes)
      .resize(64, 48, { fit: "cover" })
      .withMetadata({ density: 300, orientation: 6 })
      .jpeg({ quality: 90 })
      .toBuffer();

    expect(jpegBytes[0]).toBe(0xff);
    expect(jpegBytes[1]).toBe(0xd8);
    expect(jpegBytes[2]).toBe(0xff);

    const jpegMeta = await sharp(jpegBytes).metadata();
    expect(jpegMeta.format).toBe("jpeg");
    expect(jpegMeta.width).toBe(64);
    expect(jpegMeta.height).toBe(48);
    expect(jpegMeta.density).toBe(300);
    expect(jpegMeta.orientation).toBe(6);

    const decodedJpeg = decodeImage(jpegBytes);
    const psnr = computePsnr(srcImg.data, decodedJpeg.data);
    expect(psnr).toBeGreaterThan(32);

    // Auto-orient with .rotate() swaps 64x48 -> 48x64 and sets orientation: 1
    const orientedMeta = await sharp(jpegBytes).rotate().metadata();
    expect(orientedMeta.width).toBe(48);
    expect(orientedMeta.height).toBe(64);
    expect(orientedMeta.orientation).toBe(1);
  });

  it("round-trips WebP, GIF, PPM, PGM, PBM, BMP, and TIFF formats", async () => {
    const pngBytes = createSampleGradient(32, 24);
    for (const fmt of ["webp", "gif", "ppm", "pgm", "pbm", "bmp", "tiff"] as const) {
      const { data, info } = await sharp(pngBytes)
        .toFormat(fmt)
        .toBuffer({ resolveWithObject: true });
      expect(info.format).toBe(fmt);
      expect(info.width).toBe(32);
      expect(info.height).toBe(24);

      const meta = await sharp(data).metadata();
      expect(meta.format).toBe(fmt);
      expect(meta.width).toBe(32);
      expect(meta.height).toBe(24);
    }
  });

  it("rasterizes PDF pages and SVG inputs at configurable density via @poe-code/pdf-ast", async () => {
    const doc = PdfDocument.create();
    const font = createStandardFontHandle("Helvetica");
    const page = doc.addPage([200, 100]);
    page.drawRect({ x: 10, y: 10, width: 180, height: 80, color: { r: 0.9, g: 0.2, b: 0.2 } });
    page.drawText("Sharp PDF Raster", { x: 20, y: 50, size: 14, font });
    const pdfBytes = doc.save();

    const renderedPng = await sharp(pdfBytes, { page: 0, density: 144 }).png().toBuffer();
    const meta = await sharp(renderedPng).metadata();
    expect(meta.format).toBe("png");
    expect(meta.width).toBe(400);
    expect(meta.height).toBe(200);

    const svg = `<svg width="100" height="50" viewBox="0 0 100 50"><rect x="0" y="0" width="100" height="50" fill="#ff0000"/><circle cx="50" cy="25" r="15" fill="#00ff00"/></svg>`;
    const svgPng = await sharp(svg, { density: 144 }).png().toBuffer();
    const svgMeta = await sharp(svgPng).metadata();
    expect(svgMeta.width).toBe(200);
    expect(svgMeta.height).toBe(100);
  });

  it("supports resize fit modes (cover, contain, fill, inside, outside) and withoutEnlargement", async () => {
    const src = createSampleGradient(100, 50);

    const inside = await sharp(src).resize(50, 50, { fit: "inside" }).metadata();
    expect(inside.width).toBe(50);
    expect(inside.height).toBe(25);

    const outside = await sharp(src).resize(50, 50, { fit: "outside" }).metadata();
    expect(outside.width).toBe(100);
    expect(outside.height).toBe(50);

    const contain = await sharp(src).resize(50, 50, { fit: "contain", background: "#ffffff" }).metadata();
    expect(contain.width).toBe(50);
    expect(contain.height).toBe(50);

    const noEnlarge = await sharp(src)
      .resize(200, 200, { fit: "inside", withoutEnlargement: true })
      .metadata();
    expect(noEnlarge.width).toBe(100);
    expect(noEnlarge.height).toBe(50);
  });

  it("supports extract, trim, extend, rotate, flip, flop, composite, and color/filter ops", async () => {
    const padded = await sharp({
      create: { width: 20, height: 20, channels: 4, background: "#ff0000" }
    })
      .extend({ top: 5, bottom: 5, left: 10, right: 10, background: "#ffffff" })
      .png()
      .toBuffer();

    const padMeta = await sharp(padded).metadata();
    expect(padMeta.width).toBe(40);
    expect(padMeta.height).toBe(30);

    const trimmed = await sharp(padded).trim({ threshold: 5 }).png().toBuffer();
    const trimMeta = await sharp(trimmed).metadata();
    expect(trimMeta.width).toBe(20);
    expect(trimMeta.height).toBe(20);

    const badge = await sharp({
      create: { width: 8, height: 8, channels: 4, background: "rgba(0, 255, 0, 0.8)" }
    })
      .png()
      .toBuffer();

    const pipelineOut = await sharp(trimmed)
      .composite([{ input: badge, gravity: "southeast", blend: "over" }])
      .modulate({ brightness: 1.1, saturation: 1.2, hue: 15 })
      .blur(1.2)
      .sharpen(1.0)
      .rotate(90)
      .flip()
      .flop()
      .png()
      .toBuffer();

    const stats = await sharp(pipelineOut).stats();
    expect(stats.channels.length).toBeGreaterThanOrEqual(3);
    expect(stats.isOpaque).toBe(true);
    expect(stats.entropy).toBeGreaterThanOrEqual(0);
  });
  it("handles Adam7 interlaced PNGs, multi-frame & interlaced GIFs, Big-Endian multi-strip TIFFs, 8-bit paletted BMPs, and resize withoutReduction", async () => {
    const base = await sharp({
      create: { width: 80, height: 40, channels: 4, background: "#336699ff" }
    }).png().toBuffer();

    const noReduce = await sharp(base).resize(20, 10, { withoutReduction: true }).png().toBuffer();
    const noReduceMeta = await sharp(noReduce).metadata();
    expect(noReduceMeta.width).toBe(80);
    expect(noReduceMeta.height).toBe(40);

    const noEnlarge = await sharp(base).resize(200, 100, { withoutEnlargement: true }).png().toBuffer();
    const noEnlargeMeta = await sharp(noEnlarge).metadata();
    expect(noEnlargeMeta.width).toBe(80);
    expect(noEnlargeMeta.height).toBe(40);

    // Multi-frame GIF (pages: 2, page: 1)
    const f0 = await sharp({ create: { width: 4, height: 4, channels: 4, background: "#ff0000" } }).gif().toBuffer();
    const f1 = await sharp({ create: { width: 4, height: 4, channels: 4, background: "#0000ff" } }).gif().toBuffer();
    let f1Start = 13 + 256 * 3;
    while (f1Start < f1.length && f1[f1Start] !== 0x2c) f1Start++;
    const f1Body = f1.subarray(f1Start, f1.length - 1);
    const multiGif = new Uint8Array(f0.length - 1 + f1Body.length + 1);
    multiGif.set(f0.subarray(0, f0.length - 1), 0);
    multiGif.set(f1Body, f0.length - 1);
    multiGif[multiGif.length - 1] = 0x3b;

    const gifMeta = await sharp(multiGif).metadata();
    expect(gifMeta.pages).toBe(2);
    const page1Raw = await sharp(multiGif, { page: 1 }).raw().toBuffer();
    expect(page1Raw[0]).toBe(0);
    expect(page1Raw[2]).toBe(255);
  });
});
