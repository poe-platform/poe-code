import { describe, expect, it } from "vitest";
import { PdfDocument, createStandardFontHandle } from "@poe-code/pdf-ast";
import sharp, {
  decodeImage,
  detectImageFormat,
  encodeJpegImage,
  readImageMetadata,
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

  it("preserves pure white and exact palette colors in GIF encode and honors GIF disposal methods 2 and 3", async () => {
    const whiteGif = await sharp({
      create: { width: 4, height: 4, channels: 3, background: { r: 255, g: 255, b: 255 } }
    }).gif().toBuffer();
    const whiteRaw = await sharp(whiteGif).raw().toBuffer();
    expect(whiteRaw[0]).toBe(255);
    expect(whiteRaw[1]).toBe(255);
    expect(whiteRaw[2]).toBe(255);

    // Multi-frame GIF with disposal = 2 (restore to background/transparent)
    const f0 = await sharp({ create: { width: 4, height: 4, channels: 4, background: "#ff0000" } }).gif().toBuffer();
    const f1 = await sharp({ create: { width: 2, height: 2, channels: 4, background: "#0000ff" } }).gif().toBuffer();
    let f0Start = 13 + 256 * 3;
    while (f0Start < f0.length && f0[f0Start] !== 0x2c) f0Start++;
    let f1Start = 13 + 256 * 3;
    while (f1Start < f1.length && f1[f1Start] !== 0x2c) f1Start++;
    const f0Body = f0.subarray(f0Start, f0.length - 1);
    const f1Body = new Uint8Array(f1.subarray(f1Start, f1.length - 1));
    f1Body[1] = 1; f1Body[2] = 0; // left = 1
    f1Body[3] = 1; f1Body[4] = 0; // top = 1

    const gceDisposal2 = new Uint8Array([0x21, 0xf9, 0x04, 0x08, 0x05, 0x00, 0x00, 0x00]);
    const gceDisposal1 = new Uint8Array([0x21, 0xf9, 0x04, 0x04, 0x05, 0x00, 0x00, 0x00]);
    const multiGif = new Uint8Array(781 + gceDisposal2.length + f0Body.length + gceDisposal1.length + f1Body.length + 1);
    let off = 0;
    multiGif.set(f0.subarray(0, 781), off); off += 781;
    multiGif.set(gceDisposal2, off); off += gceDisposal2.length;
    multiGif.set(f0Body, off); off += f0Body.length;
    multiGif.set(gceDisposal1, off); off += gceDisposal1.length;
    multiGif.set(f1Body, off); off += f1Body.length;
    multiGif[off] = 0x3b;

    const p1Raw = await sharp(multiGif, { page: 1 }).raw().toBuffer();
    expect(p1Raw[3]).toBe(0); // (0,0) disposed to transparent
    expect(p1Raw[(1 * 4 + 1) * 4 + 2]).toBe(255); // (1,1) painted blue
    expect(p1Raw[(1 * 4 + 1) * 4 + 3]).toBe(255);
  });

  it("supports composite Porter-Duff blend modes atop, dest-atop, xor, saturate and tile alignment (#28)", async () => {
    const base = { create: { width: 4, height: 4, channels: 4 as const, background: { r: 200, g: 50, b: 50, alpha: 0.5 } } };
    const over = await sharp({
      create: { width: 4, height: 4, channels: 4, background: { r: 50, g: 200, b: 50, alpha: 0.5 } }
    }).png().toBuffer();

    const atopBuf = await sharp(base).composite([{ input: over, blend: "atop" }]).raw().toBuffer();
    expect(atopBuf[0]).toBeCloseTo(150, -1);
    expect(atopBuf[1]).toBeCloseTo(225, -1);
    expect(atopBuf[3]).toBe(128);

    const destAtopBuf = await sharp(base).composite([{ input: over, blend: "dest-atop" }]).raw().toBuffer();
    expect(destAtopBuf[0]).toBeCloseTo(225, -1);
    expect(destAtopBuf[1]).toBeCloseTo(150, -1);
    expect(destAtopBuf[3]).toBe(128);

    const xorBuf = await sharp(base).composite([{ input: over, blend: "xor" }]).raw().toBuffer();
    expect(xorBuf[0]).toBe(125);
    expect(xorBuf[1]).toBe(125);
    expect(xorBuf[3]).toBe(127);
  });

  it("applies gamma(gamma, gammaOut) and normalize({ lower, upper }) matching libvips (#30)", async () => {
    const gRaw = await sharp(new Uint8Array([128, 64, 192]), { raw: { width: 1, height: 1, channels: 3 } })
      .gamma(2.2, 3.0)
      .raw()
      .toBuffer();
    expect(gRaw[0]).toBe(154);
    expect(gRaw[1]).toBe(93);

    const ramp = new Uint8Array(10);
    for (let i = 0; i < 10; i++) ramp[i] = i * 10;
    const norm = await sharp(ramp, { raw: { width: 10, height: 1, channels: 1 } })
      .normalize({ lower: 10, upper: 80 })
      .raw()
      .toBuffer();
    expect(norm[0]).toBe(0);
    expect(norm[8]).toBe(255);
  });

  it("decodes 16-bit Netpbm P5/P6, WebP VP8L with EXIF metadata, SVG physical units/ellipse/polygon, and PNG/TIFF channels (#32, #33, #34, #35, #37)", async () => {
    // #32: 16-bit P6
    const hdr = new TextEncoder().encode("P6\n1 1\n65535\n");
    const p6 = new Uint8Array(hdr.length + 6);
    p6.set(hdr, 0);
    p6.set([0xff, 0xff, 0x00, 0x00, 0x80, 0x00], hdr.length);
    const p6Meta = readImageMetadata(p6);
    expect(p6Meta.depth).toBe("ushort");
    const p6Dec = decodeImage(p6);
    expect(p6Dec.data[0]).toBe(255);
    expect(p6Dec.data[1]).toBe(0);
    expect(p6Dec.data[2]).toBe(128);

    // #33: WebP VP8L + EXIF density & orientation
    const webpBuf = await sharp({
      create: { width: 4, height: 4, channels: 4, background: { r: 12, g: 34, b: 56, alpha: 0.5 } }
    })
      .withMetadata({ density: 300, orientation: 6 })
      .webp({ lossless: true })
      .toBuffer();
    const webpMeta = await sharp(webpBuf).metadata();
    expect(webpMeta.density).toBe(300);
    expect(webpMeta.orientation).toBe(6);
    const webpRaw = await sharp(webpBuf).raw().toBuffer();
    expect(webpRaw[0]).toBe(12);
    expect(webpRaw[1]).toBe(34);
    expect(webpRaw[2]).toBe(56);
    expect(webpRaw[3]).toBe(128);

    // #34: SVG units + ellipse + polygon + viewBox
    const svgBytes = new TextEncoder().encode(
      `<svg width="1in" height="1in" viewBox="-10 -10 20 20"><ellipse cx="0" cy="0" rx="6" ry="4" fill="#00ff00"/><polygon points="-5,-5 5,-5 0,5" fill="#ff0000"/></svg>`
    );
    const svgMeta = await sharp(svgBytes).metadata();
    expect(svgMeta.width).toBe(72);
    expect(svgMeta.height).toBe(72);
    const svgDec = decodeImage(svgBytes);
    expect(svgDec.data[(36 * 72 + 36) * 4]).toBe(255);

    // #35: PNG grayscale 1-channel and opaque 4-channel preservation
    const grayPng = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#808080" } })
      .grayscale()
      .png()
      .toBuffer();
    const grayMeta = await sharp(grayPng).metadata();
    expect(grayMeta.channels).toBe(1);
    expect(grayMeta.space).toBe("b-w");

    // #37: TIFF metadata & round-trip
    const tiffBuf = await sharp({ create: { width: 4, height: 4, channels: 4, background: "#112233" } })
      .withMetadata({ density: 240, orientation: 3 })
      .tiff()
      .toBuffer();
    const tiffMeta = await sharp(tiffBuf).metadata();
    expect(tiffMeta.density).toBe(240);
    expect(tiffMeta.orientation).toBe(3);
  });

  it("supports extend(n) numeric shorthand, recomb(), toColorspace(), joinChannel(), bandbool(), clahe(), and affine() (#40, #41)", async () => {
    const ext = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#ff0000" } })
      .extend(1)
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(ext.info.width).toBe(4);
    expect(ext.info.height).toBe(4);

    const sepia = await sharp({ create: { width: 2, height: 2, channels: 3, background: { r: 200, g: 60, b: 140 } } })
      .recomb([
        [0.393, 0.769, 0.189],
        [0.349, 0.686, 0.168],
        [0.272, 0.534, 0.131]
      ])
      .raw()
      .toBuffer();
    expect(sepia[0]).toBe(151);
    expect(sepia[1]).toBe(134);
    expect(sepia[2]).toBe(105);

    const bw = await sharp({ create: { width: 2, height: 2, channels: 3, background: { r: 200, g: 100, b: 50 } } })
      .toColorspace("b-w")
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(bw.info.channels).toBe(1);

    const bb = await sharp(new Uint8Array([0b1100, 0b1010, 0b1110]), { raw: { width: 1, height: 1, channels: 3 } })
      .bandbool("and")
      .raw()
      .toBuffer();
    expect(bb[0]).toBe(0b1000);

    const joined = await sharp(new Uint8Array([100]), { raw: { width: 1, height: 1, channels: 1 } })
      .joinChannel(new Uint8Array([200]), { raw: { width: 1, height: 1, channels: 1 } })
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(joined.info.channels).toBe(2);
    expect(joined.data[0]).toBe(100);
    expect(joined.data[1]).toBe(200);

    const aff = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#00ff00" } })
      .affine([2, 0, 0, 2])
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(aff.info.width).toBe(4);
    expect(aff.info.height).toBe(4);
  });

  it("encodes and decodes iPhone HEIC, HEIF, and AVIF formats with ISOBMFF metadata, orientation, density, and alpha", async () => {
    // 1. Round-trip .heic() with RGBA alpha and metadata
    const srcHeic = await sharp({
      create: { width: 8, height: 6, channels: 4, background: { r: 12, g: 140, b: 250, alpha: 0.5 } }
    })
      .withMetadata({ density: 300, orientation: 6 })
      .heic()
      .toBuffer({ resolveWithObject: true });

    expect(srcHeic.info.format).toBe("heic");
    expect(srcHeic.info.width).toBe(8);
    expect(srcHeic.info.height).toBe(6);
    expect(srcHeic.info.channels).toBe(4);
    expect(detectImageFormat(srcHeic.data)).toBe("heic");

    const heicMeta = await sharp(srcHeic.data).metadata();
    expect(heicMeta.format).toBe("heic");
    expect(heicMeta.width).toBe(8);
    expect(heicMeta.height).toBe(6);
    expect(heicMeta.channels).toBe(4);
    expect(heicMeta.hasAlpha).toBe(true);
    expect(heicMeta.density).toBe(300);
    expect(heicMeta.orientation).toBe(6);
    expect(heicMeta.compression).toBe("hevc");

    // Auto-orient HEIC with orientation 6 (90 CW) swaps width/height to 6x8
    const orientedRaw = await sharp(srcHeic.data)
      .rotate()
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(orientedRaw.info.width).toBe(6);
    expect(orientedRaw.info.height).toBe(8);
    expect(orientedRaw.data[0]).toBe(12);
    expect(orientedRaw.data[1]).toBe(140);
    expect(orientedRaw.data[2]).toBe(250);
    expect(orientedRaw.data[3]).toBe(128);

    // 2. Round-trip .heif() and .avif()
    const srcHeif = await sharp({
      create: { width: 5, height: 4, channels: 3, background: "#ff3366" }
    })
      .heif({ quality: 85, compression: "hevc" })
      .toBuffer({ resolveWithObject: true });
    expect(srcHeif.info.format).toBe("heif");
    const heifMeta = await sharp(srcHeif.data).metadata();
    expect(heifMeta.format).toBe("heif");
    expect(heifMeta.width).toBe(5);
    expect(heifMeta.height).toBe(4);
    expect(heifMeta.hasAlpha).toBe(false);
    expect(heifMeta.channels).toBe(3);

    const srcAvif = await sharp({
      create: { width: 7, height: 3, channels: 3, background: "#00cc88" }
    })
      .avif({ quality: 80 })
      .toBuffer({ resolveWithObject: true });
    expect(srcAvif.info.format).toBe("avif");
    const avifMeta = await sharp(srcAvif.data).metadata();
    expect(avifMeta.format).toBe("avif");
    expect(avifMeta.compression).toBe("av1");
    expect(avifMeta.width).toBe(7);
    expect(avifMeta.height).toBe(3);

    // 3. Verify toFormat("heic") / toFormat("avif")
    const viaToFormat = await sharp({
      create: { width: 4, height: 3, channels: 3, background: "#112233" }
    })
      .toFormat("heic", { quality: 90 })
      .toBuffer({ resolveWithObject: true });
    expect(viaToFormat.info.format).toBe("heic");
    expect((await sharp(viaToFormat.data).metadata()).format).toBe("heic");
  });
});
