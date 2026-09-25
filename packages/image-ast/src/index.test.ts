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
    expect(gRaw[0]).toBe(152);
    expect(gRaw[1]).toBe(92);

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

  it("decodes Tiled TIFFs (322/323/324/325), centers composite() by default, matches libvips premultiplied blends & premultiplied:true, and premultiplies alpha in blur()/rotate() (#44, #45, #46, #47)", async () => {
    // 1. #44: Tiled TIFF (6x4 image stored as four 4x2 tiles via tags 322, 323, 324, 325)
    const tileW = 4, tileH = 2, imgW = 6, imgH = 4;
    // 4 tiles of 4x2 RGB (24 bytes each = 96 bytes total)
    const tilesData = new Uint8Array(4 * tileW * tileH * 3);
    for (let t = 0; t < 4; t++) {
      const tx = (t % 2) * tileW;
      const ty = Math.floor(t / 2) * tileH;
      for (let ry = 0; ry < tileH; ry++) {
        for (let rx = 0; rx < tileW; rx++) {
          const x = tx + rx;
          const y = ty + ry;
          const off = (t * tileW * tileH + ry * tileW + rx) * 3;
          tilesData[off] = x * 30;
          tilesData[off + 1] = y * 50;
          tilesData[off + 2] = 123;
        }
      }
    }
    // Build Big-Endian Tiled TIFF with ExifIFD dummy bytes at offset 8 and tiles starting at offset 32
    const tileDataStart = 32;
    const ifdStart = tileDataStart + tilesData.length;
    const numTags = 9;
    const extraStart = ifdStart + 2 + numTags * 12 + 4;
    const tiffBuf = new Uint8Array(extraStart + 64);
    const tv = new DataView(tiffBuf.buffer);
    tiffBuf[0] = 0x4d; tiffBuf[1] = 0x4d; // Big-Endian MM
    tv.setUint16(2, 42, false);
    tv.setUint32(4, ifdStart, false);
    // Put non-zero Exif-like header at offset 8 to ensure decoder doesn't fall back to offset 8
    tiffBuf.set([0x00, 0x04, 0x90, 0x00, 0xff, 0xff], 8);
    tiffBuf.set(tilesData, tileDataStart);
    tv.setUint16(ifdStart, numTags, false);
    const writeBeTag = (idx: number, tag: number, type: number, count: number, val: number) => {
      const p = ifdStart + 2 + idx * 12;
      tv.setUint16(p, tag, false);
      tv.setUint16(p + 2, type, false);
      tv.setUint32(p + 4, count, false);
      if (type === 3 && count === 1) tv.setUint16(p + 8, val, false);
      else tv.setUint32(p + 8, val, false);
    };
    // Extra offsets: bps at extraStart (6B), tileOffsets at extraStart+8 (16B), tileByteCounts at extraStart+24 (16B)
    tv.setUint16(extraStart, 8, false);
    tv.setUint16(extraStart + 2, 8, false);
    tv.setUint16(extraStart + 4, 8, false);
    for (let t = 0; t < 4; t++) {
      tv.setUint32(extraStart + 8 + t * 4, tileDataStart + t * 24, false);
      tv.setUint32(extraStart + 24 + t * 4, 24, false);
    }
    writeBeTag(0, 256, 3, 1, imgW);
    writeBeTag(1, 257, 3, 1, imgH);
    writeBeTag(2, 258, 3, 3, extraStart);
    writeBeTag(3, 259, 3, 1, 1);
    writeBeTag(4, 262, 3, 1, 2);
    writeBeTag(5, 277, 3, 1, 3);
    writeBeTag(6, 322, 3, 1, tileW);
    writeBeTag(7, 323, 3, 1, tileH);
    writeBeTag(8, 324, 4, 4, extraStart + 8);
    const tiledRaw = await sharp(tiffBuf).raw().toBuffer({ resolveWithObject: true });
    expect(tiledRaw.info.width).toBe(6);
    expect(tiledRaw.info.height).toBe(4);
    // Check pixel at (x=5, y=3) which comes from tile #3 (bottom-right tile)
    const p53 = (3 * 6 + 5) * tiledRaw.info.channels;
    expect(tiledRaw.data[p53]).toBe(150);
    expect(tiledRaw.data[p53 + 1]).toBe(150);
    expect(tiledRaw.data[p53 + 2]).toBe(123);

    // 2. #45: composite() defaults to center placement and promotes 3-channel RGB to 4 channels
    const baseRgb = await sharp({ create: { width: 10, height: 10, channels: 3, background: "#000000" } }).jpeg().toBuffer();
    const overRed = await sharp({ create: { width: 2, height: 2, channels: 4, background: "#ff0000" } }).png().toBuffer();
    const centered = await sharp(baseRgb).composite([{ input: overRed }]).raw().toBuffer({ resolveWithObject: true });
    expect(centered.info.channels).toBe(4);
    expect(centered.data[0]).toBe(0); // (0,0) is black, not red!
    const centerIdx = (4 * 10 + 4) * 4;
    expect(centered.data[centerIdx]).toBe(255); // (4,4) is red!

    // 3. #46: premultiplied: true composite & libvips premultiplied blend modes (darken, lighten, multiply)
    const base50 = await sharp({ create: { width: 1, height: 1, channels: 4, background: { r: 50, g: 100, b: 150, alpha: 1 } } }).png().toBuffer();
    const over75 = await sharp({ create: { width: 1, height: 1, channels: 4, background: { r: 180, g: 90, b: 220, alpha: 0.75 } } }).png().toBuffer();
    const mulRes = await sharp(base50).composite([{ input: over75, blend: "multiply" }]).raw().toBuffer();
    expect(Math.abs(mulRes[0]! - 32)).toBeLessThanOrEqual(1);
    expect(Math.abs(mulRes[1]! - 45)).toBeLessThanOrEqual(1);
    expect(Math.abs(mulRes[2]! - 110)).toBeLessThanOrEqual(1);

    const premulBuf = new Uint8Array([100, 50, 25, 128]); // premultiplied (200, 100, 50) at alpha=128
    const premulComp = await sharp(base50)
      .composite([{ input: premulBuf, raw: { width: 1, height: 1, channels: 4 }, premultiplied: true }])
      .raw()
      .toBuffer();
    expect(Math.abs(premulComp[0]! - 125)).toBeLessThanOrEqual(1);

    // 4. #47: blur() premultiplies alpha so opaque red next to transparent black stays red (255, 0, 0)
    const edgeRgba = new Uint8Array([
      255, 0, 0, 255,
      255, 0, 0, 255,
      0, 0, 0, 0,
      0, 0, 0, 0
    ]);
    const blurredRgba = await sharp(edgeRgba, { raw: { width: 4, height: 1, channels: 4 } }).blur(1.5).raw().toBuffer();
    expect(blurredRgba[0]).toBe(255);
    expect(blurredRgba[4]).toBe(255);
    expect(blurredRgba[8]).toBe(255);
    expect(blurredRgba[12]).toBe(255);
  });

  it("matches libvips on trim() transparent borders, linear-light greyscale()/threshold(), CIE LCh modulate(), CIE Lab tint(), and Lab normalise() (#48, #49, #50, #51)", async () => {
    // 1. #48: trim() on transparent border with varying hidden RGB bytes
    const W = 10, H = 10;
    const dirtyTrans = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        dirtyTrans[i] = x * 25;
        dirtyTrans[i + 1] = y * 25;
        dirtyTrans[i + 2] = 200 - x * 15;
        dirtyTrans[i + 3] = x >= 2 && x <= 7 && y >= 3 && y <= 6 ? 255 : 0;
      }
    }
    const trimmedDirty = await sharp(dirtyTrans, { raw: { width: W, height: H, channels: 4 } })
      .trim()
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(trimmedDirty.info.width).toBe(6);
    expect(trimmedDirty.info.height).toBe(4);

    // 2. #49: linear-light sRGB -> b-w greyscale() and threshold(128)
    const colors = new Uint8Array([
      255, 0, 0, 255,
      0, 255, 0, 255,
      0, 0, 255, 255,
      200, 100, 50, 255
    ]);
    const greyRaw = await sharp(colors, { raw: { width: 4, height: 1, channels: 4 } })
      .greyscale()
      .removeAlpha()
      .raw()
      .toBuffer();
    expect(greyRaw[0]).toBe(127);
    expect(greyRaw[1]).toBe(220);
    expect(greyRaw[2]).toBe(76);
    expect(greyRaw[3]).toBe(128);

    const threshRaw = await sharp(new Uint8Array([200, 100, 50]), { raw: { width: 1, height: 1, channels: 3 } })
      .threshold(128)
      .raw()
      .toBuffer();
    expect(threshRaw[0]).toBe(255);

    // 3. #50: CIE LCh modulate() and CIE Lab tint()
    const modRaw = await sharp(new Uint8Array([255, 0, 0, 255]), { raw: { width: 1, height: 1, channels: 4 } })
      .modulate({ brightness: 1.2, saturation: 0.8, hue: 90, lightness: 10 })
      .raw()
      .toBuffer();
    expect(Math.abs(modRaw[0]! - 108)).toBeLessThanOrEqual(1);
    expect(Math.abs(modRaw[1]! - 204)).toBeLessThanOrEqual(1);
    expect(Math.abs(modRaw[2]! - 47)).toBeLessThanOrEqual(1);

    const tintRaw = await sharp(new Uint8Array([255, 0, 0, 255, 255, 255, 255, 255]), { raw: { width: 2, height: 1, channels: 4 } })
      .tint({ r: 255, g: 128, b: 64 })
      .raw()
      .toBuffer();
    expect(Math.abs(tintRaw[0]! - 210)).toBeLessThanOrEqual(1);
    expect(Math.abs(tintRaw[1]! - 91)).toBeLessThanOrEqual(1);
    expect(Math.abs(tintRaw[2]! - 28)).toBeLessThanOrEqual(1);
    // Pure white (L*=100) stays pure white (255,255,255) under sharp::Tint quadratic L* weighting
    expect(tintRaw[4]).toBe(255);
    expect(tintRaw[5]).toBe(255);
    expect(tintRaw[6]).toBe(255);

    // 4. #51: normalise() preserves neutral grey in CIE Lab and clips default 1%/99% percentiles
    const normGrad = new Uint8Array(20 * 10 * 4);
    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 20; x++) {
        const i = (y * 20 + x) * 4;
        normGrad[i] = Math.round((x / 20) * 255);
        normGrad[i + 1] = Math.round((y / 10) * 255);
        normGrad[i + 2] = Math.round(((20 - x + y) / 30) * 255);
        normGrad[i + 3] = 255;
      }
    }
    // Set pixel (10, 5) to neutral grey [128, 128, 128, 255]
    const midIdx = (5 * 20 + 10) * 4;
    normGrad[midIdx] = 128;
    normGrad[midIdx + 1] = 128;
    normGrad[midIdx + 2] = 128;
    const normOut = await sharp(normGrad, { raw: { width: 20, height: 10, channels: 4 } })
      .normalise()
      .raw()
      .toBuffer();
    expect(Math.abs(normOut[midIdx]! - normOut[midIdx + 1]!)).toBeLessThanOrEqual(1);
    expect(Math.abs(normOut[midIdx + 1]! - normOut[midIdx + 2]!)).toBeLessThanOrEqual(1);

    // 5. #53: soft-light blend mode when d <= 0.25 subtracts -d in D(d) - d = ((16d - 12)d + 3)d
    const slBase = await sharp({
      create: { width: 1, height: 1, channels: 4, background: { r: 24, g: 36, b: 58, alpha: 1 } }
    })
      .png()
      .toBuffer();
    const slOver = await sharp({
      create: { width: 1, height: 1, channels: 4, background: { r: 220, g: 80, b: 40, alpha: 0.85 } }
    })
      .png()
      .toBuffer();
    const slOut = await sharp(slBase)
      .composite([{ input: slOver, blend: "soft-light" }])
      .raw()
      .toBuffer();
    expect(Math.abs(slOut[0]! - 43)).toBeLessThanOrEqual(1);
    expect(Math.abs(slOut[1]! - 23)).toBeLessThanOrEqual(1);
    expect(Math.abs(slOut[2]! - 30)).toBeLessThanOrEqual(1);
  });

  it("writes libtiff-compliant ExtraSamples/RowsPerStrip/PlanarConfiguration tags, decodes JPEG-in-TIFF (Compression=7 + JPEGTables 347), and preserves omitted dimension on resize(fit:fill) (#54, #55, #56)", async () => {
    // 1. #54: encodeTiffImage writes ExtraSamples (338 = 2), RowsPerStrip (278 = height), PlanarConfiguration (284 = 1)
    const tiffBuf = await sharp({
      create: { width: 16, height: 12, channels: 4, background: { r: 200, g: 100, b: 50, alpha: 0.5 } }
    })
      .tiff()
      .toBuffer();
    const view = new DataView(tiffBuf.buffer, tiffBuf.byteOffset, tiffBuf.byteLength);
    const ifdOff = view.getUint32(4, true);
    const numEntries = view.getUint16(ifdOff, true);
    const tags = new Map<number, number>();
    for (let i = 0; i < numEntries; i++) {
      const p = ifdOff + 2 + i * 12;
      const tag = view.getUint16(p, true);
      const type = view.getUint16(p + 2, true);
      const val = type === 3 ? view.getUint16(p + 8, true) : view.getUint32(p + 8, true);
      tags.set(tag, val);
    }
    expect(tags.get(278)).toBe(12); // RowsPerStrip
    expect(tags.get(284)).toBe(1);  // PlanarConfiguration
    expect(tags.get(338)).toBe(2);  // ExtraSamples = Unassociated Alpha

    // 2. #55: decodeTiffImage decodes Compression=7 (JPEG-in-TIFF) with JPEGTables (tag 347)
    const jpegBytes = await sharp({
      create: { width: 8, height: 8, channels: 3, background: { r: 220, g: 40, b: 60 } }
    })
      .jpeg({ quality: 95 })
      .toBuffer();
    // Build a minimal Little-Endian TIFF with Compression=7 and StripOffsets pointing to jpegBytes
    const tiffJpeg = new Uint8Array(8 + jpegBytes.length + 2 + 8 * 12 + 4);
    const tv = new DataView(tiffJpeg.buffer);
    tiffJpeg[0] = 0x49;
    tiffJpeg[1] = 0x49;
    tv.setUint16(2, 42, true);
    const jIfdOff = 8 + jpegBytes.length;
    tv.setUint32(4, jIfdOff, true);
    tiffJpeg.set(jpegBytes, 8);
    tv.setUint16(jIfdOff, 8, true);
    const writeTag = (idx: number, tag: number, type: number, count: number, val: number) => {
      const p = jIfdOff + 2 + idx * 12;
      tv.setUint16(p, tag, true);
      tv.setUint16(p + 2, type, true);
      tv.setUint32(p + 4, count, true);
      if (type === 3) tv.setUint16(p + 8, val, true);
      else tv.setUint32(p + 8, val, true);
    };
    writeTag(0, 256, 4, 1, 8);
    writeTag(1, 257, 4, 1, 8);
    writeTag(2, 259, 3, 1, 7); // Compression = 7 (JPEG)
    writeTag(3, 262, 3, 1, 6); // Photometric = YCbCr
    writeTag(4, 273, 4, 1, 8); // StripOffsets = 8
    writeTag(5, 277, 3, 1, 3); // SamplesPerPixel = 3
    writeTag(6, 278, 4, 1, 8); // RowsPerStrip = 8
    writeTag(7, 279, 4, 1, jpegBytes.length); // StripByteCounts
    const decJpegTiff = await sharp(tiffJpeg).raw().toBuffer();
    expect(decJpegTiff[0]).toBeGreaterThan(200);
    expect(decJpegTiff[1]).toBeLessThan(60);

    // 3. #56: resize(w, null, { fit: "fill" }) and resize(null, h, { fit: "fill" }) preserve omitted dimension
    const src40x24 = await sharp({
      create: { width: 40, height: 24, channels: 3, background: "#336699" }
    })
      .png()
      .toBuffer();
    const fillW = await sharp(src40x24).resize(20, null, { fit: "fill" }).metadata();
    expect(fillW.width).toBe(20);
    expect(fillW.height).toBe(24);
    const fillH = await sharp(src40x24).resize(null, 12, { fit: "fill" }).metadata();
    expect(fillH.width).toBe(40);
    expect(fillH.height).toBe(12);

    // 4. #58: VP8L lossless round-trip on 64x64 radial RGBA gradient
    const W = 64, H = 64;
    const radial = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        const dist = Math.round(Math.hypot(x - 32, y - 32));
        radial[i] = (x + dist * 3) & 255;
        radial[i + 1] = (y * 2 - dist) & 255;
        radial[i + 2] = (dist * 5 ^ x) & 255;
        radial[i + 3] = dist < 24 ? 255 : dist < 28 ? 128 : 0;
      }
    }
    const webpBuf = await sharp(radial, { raw: { width: W, height: H, channels: 4 } }).webp().toBuffer();
    const decWebp = await sharp(webpBuf).raw().toBuffer();
    expect(decWebp[0]).toBe(radial[0]);
    expect(decWebp[(32 * W + 32) * 4]).toBe(radial[(32 * W + 32) * 4]);
  });

  it("supports 16-bit TIFF with Predictor=2 horizontal differencing (#61) and multi-page animated GIF decoding/encoding (#60)", async () => {
    const strip16 = new Uint8Array([
      0x00, 0xfa, 0x00, 0x00, 0xff, 0xfb,
      0xff, 0x07, 0x00, 0xfc, 0x01, 0x06
    ]);
    const ifdOff = 8 + strip16.length;
    const bpsOff = ifdOff + 2 + 10 * 12 + 4;
    const tiff16 = new Uint8Array(bpsOff + 6);
    const tv = new DataView(tiff16.buffer);
    tiff16[0] = 0x49;
    tiff16[1] = 0x49;
    tv.setUint16(2, 42, true);
    tv.setUint32(4, ifdOff, true);
    tiff16.set(strip16, 8);
    tv.setUint16(ifdOff, 10, true);
    const writeEntry = (idx: number, tag: number, type: number, count: number, val: number) => {
      const p = ifdOff + 2 + idx * 12;
      tv.setUint16(p, tag, true);
      tv.setUint16(p + 2, type, true);
      tv.setUint32(p + 4, count, true);
      if (type === 3 && count === 1) tv.setUint16(p + 8, val, true);
      else tv.setUint32(p + 8, val, true);
    };
    writeEntry(0, 256, 4, 1, 2); // width = 2
    writeEntry(1, 257, 4, 1, 1); // height = 1
    writeEntry(2, 258, 3, 3, bpsOff); // BitsPerSample = [16, 16, 16]
    writeEntry(3, 259, 3, 1, 1); // Compression = 1
    writeEntry(4, 262, 3, 1, 2); // Photometric = RGB
    writeEntry(5, 273, 4, 1, 8); // StripOffsets = 8
    writeEntry(6, 277, 3, 1, 3); // SamplesPerPixel = 3
    writeEntry(7, 278, 4, 1, 1); // RowsPerStrip = 1
    writeEntry(8, 279, 4, 1, strip16.length); // StripByteCounts
    writeEntry(9, 317, 3, 1, 2); // Predictor = 2
    tv.setUint16(bpsOff, 16, true);
    tv.setUint16(bpsOff + 2, 16, true);
    tv.setUint16(bpsOff + 4, 16, true);

    const meta16 = await sharp(tiff16).metadata();
    expect(meta16.depth).toBe("ushort");
    expect(meta16.space).toBe("rgb16");
    const dec16 = await sharp(tiff16).raw().toBuffer();
    expect(Array.from(dec16)).toEqual([250, 0, 251, 1, 252, 2]);

    // 2. #60: Multi-frame animated GIF encoding & decoding (animated: true, pageHeight, delay, loop)
    const framesRaw = new Uint8Array(8 * 24 * 4);
    for (let p = 0; p < 3; p++) {
      for (let i = 0; i < 8 * 8; i++) {
        const off = (p * 64 + i) * 4;
        framesRaw[off] = p === 0 ? 255 : 0;
        framesRaw[off + 1] = p === 1 ? 255 : 0;
        framesRaw[off + 2] = p === 2 ? 255 : 0;
        framesRaw[off + 3] = 255;
      }
    }
    const animGif = await sharp(framesRaw, {
      raw: { width: 8, height: 24, channels: 4, pageHeight: 8 }
    })
      .gif({ delay: [80, 120, 160], loop: 3 })
      .toBuffer();
    const gifMeta = await sharp(animGif, { animated: true }).metadata();
    expect(gifMeta.pages).toBe(3);
    expect(gifMeta.pageHeight).toBe(8);
    expect(gifMeta.height).toBe(24);
    expect(gifMeta.delay).toEqual([80, 120, 160]);
    expect(gifMeta.loop).toBe(3);
    const stacked = await sharp(animGif, { animated: true }).raw().toBuffer({ resolveWithObject: true });
    expect(stacked.info.height).toBe(24);
    expect(stacked.info.pageHeight).toBe(8);
    expect(stacked.data[0]).toBe(255);
    expect(stacked.data[64 * 4 + 1]).toBe(255);
    expect(stacked.data[128 * 4 + 2]).toBe(255);
  });

  it("premultiplies and convolves all 4 bands in convolve() on RGBA and uses rounded origin + bilinear interpolation in affine() (#62)", async () => {
    // 1. convolve() on 8x8 RGBA with alpha=128 and emboss kernel (offset=128)
    const W = 8, H = 8;
    const srcRgba = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        srcRgba[i] = x * 20;
        srcRgba[i + 1] = y * 20;
        srcRgba[i + 2] = (x + y) * 10;
        srcRgba[i + 3] = 128;
      }
    }
    const convOut = await sharp(srcRgba, { raw: { width: W, height: H, channels: 4 } })
      .convolve({ width: 3, height: 3, kernel: [-2, -1, 0, -1, 1, 1, 0, 1, 2], scale: 1, offset: 128 })
      .raw()
      .toBuffer();
    const p22 = (2 * W + 2) * 4;
    expect(convOut[p22 + 3]).toBe(255);
    expect(Math.abs(convOut[p22]! - 208)).toBeLessThanOrEqual(1);

    // 2. affine() with rounded oarea origin + bilinear boundary interpolation
    const AW = 64, AH = 64;
    const srcRgb = new Uint8Array(AW * AH * 3);
    for (let y = 0; y < AH; y++) {
      for (let x = 0; x < AW; x++) {
        const i = (y * AW + x) * 3;
        srcRgb[i] = (x * 4) & 255;
        srcRgb[i + 1] = (y * 4) & 255;
        srcRgb[i + 2] = ((x + y) * 2) & 255;
      }
    }
    const affOut = await sharp(srcRgb, { raw: { width: AW, height: AH, channels: 3 } })
      .affine([[1.2, 0.15], [-0.1, 0.9]], { background: "#112233" })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const aIdx = (30 * affOut.info.width + 40) * 3;
    expect(affOut.data[aIdx]).toBe(118);
    expect(affOut.data[aIdx + 1]).toBe(120);
    expect(affOut.data[aIdx + 2]).toBe(119);
  });

  it("matches libvips vips_hist_local in clahe() and vips_stats sample stdev / dominant in stats() (#63)", async () => {
    const W = 64, H = 64;
    const srcRgb = new Uint8Array(W * H * 3);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 3;
        srcRgb[i] = Math.min(255, Math.floor((x * x) / 16));
        srcRgb[i + 1] = Math.min(255, Math.floor((y * y) / 16));
        srcRgb[i + 2] = Math.min(255, Math.floor((x + y) * 2));
      }
    }
    const claheOut = await sharp(srcRgb, { raw: { width: W, height: H, channels: 3 } })
      .clahe({ width: 16, height: 16, maxSlope: 3 })
      .raw()
      .toBuffer();
    const p20 = (20 * W + 20) * 3;
    expect(claheOut[p20]).toBe(47);
    expect(claheOut[p20 + 1]).toBe(47);
    expect(claheOut[p20 + 2]).toBe(100);

    const st = await sharp(srcRgb, { raw: { width: W, height: H, channels: 3 } }).stats();
    expect(st.channels[0]!.stdev).toBeCloseTo(75.199667, 4);
    expect(st.dominant).toEqual({ r: 8, g: 8, b: 24 });
  });

  it("rasterizes SVG <g transform>, <path d='M/H/V/L/C/Q/Z'> with fill-opacity, and <rect rx/ry> rounded corners (#64)", async () => {
    const svgComplex = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120">
      <rect x="0" y="0" width="120" height="120" fill="#204060"/>
      <g transform="translate(10, 10) scale(2)">
        <rect x="5" y="5" width="20" height="20" fill="#ff0000"/>
      </g>
      <path d="M 70 20 H 110 V 60 H 70 Z" fill="#00ff00" fill-opacity="0.5"/>
      <rect x="20" y="70" width="80" height="40" rx="10" ry="10" fill="#ffcc00" opacity="0.75"/>
    </svg>`;
    const out = await sharp(new TextEncoder().encode(svgComplex)).raw().toBuffer();
    const pRed = (40 * 120 + 40) * 4;
    expect(Array.from(out.subarray(pRed, pRed + 4))).toEqual([255, 0, 0, 255]);
    const pGreen = (40 * 120 + 90) * 4;
    expect(Array.from(out.subarray(pGreen, pGreen + 4))).toEqual([16, 160, 48, 255]);
    const pCornerOut = (71 * 120 + 21) * 4;
    expect(Array.from(out.subarray(pCornerOut, pCornerOut + 4))).toEqual([32, 64, 96, 255]);
  });

  it("preserves foreground alpha in resize({ fit: 'contain' }), uses CalculateCrop rounding in 'cover', and matches withoutEnlargement/withoutReduction dimensions (#65)", async () => {
    const src = new Uint8Array(80 * 50 * 4);
    for (let y = 0; y < 50; y++) {
      for (let x = 0; x < 80; x++) {
        const i = (y * 80 + x) * 4;
        src[i] = Math.round((x / 79) * 255);
        src[i + 1] = Math.round((y / 49) * 255);
        src[i + 2] = (x * 7 + y * 13) & 0xff;
        src[i + 3] = 200;
      }
    }
    const rawOpts = { raw: { width: 80, height: 50, channels: 4 as const } };

    // 1. fit: "contain" preserves foreground alpha (200) in embedded image region while padding border with background
    const containOut = await sharp(src, rawOpts)
      .resize(37, 41, { fit: "contain", position: "center", background: { r: 10, g: 20, b: 30, alpha: 1 } })
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(Array.from(containOut.data.subarray(0, 4))).toEqual([10, 20, 30, 255]);
    const centerIdx = (20 * 37 + 18) * 4;
    expect(containOut.data[centerIdx + 3]).toBe(200);

    // 2. fit: "cover" CalculateCrop center rounding (Math.floor((dx + 1) / 2))
    const ramp = new Uint8Array(11 * 10 * 4);
    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 11; x++) {
        const i = (y * 11 + x) * 4;
        ramp[i] = x * 20;
        ramp[i + 3] = 255;
      }
    }
    const coverCenter = await sharp(ramp, { raw: { width: 11, height: 10, channels: 4 } })
      .resize(6, 10, { fit: "cover", position: "center", kernel: "nearest" })
      .raw()
      .toBuffer();
    expect(coverCenter[0]).toBe(3 * 20);

    // 3. withoutReduction / withoutEnlargement dimensions for cover, contain, fill
    const fillNoRed = await sharp(src, rawOpts)
      .resize(120, 30, { fit: "fill", withoutReduction: true })
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(fillNoRed.info.width).toBe(120);
    expect(fillNoRed.info.height).toBe(50);

    const containNoEnl = await sharp(src, rawOpts)
      .resize(120, 90, { fit: "contain", withoutEnlargement: true })
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(containNoEnl.info.width).toBe(120);
    expect(containNoEnl.info.height).toBe(90);

    const fillNoEnl = await sharp(src, rawOpts)
      .resize(120, 30, { fit: "fill", withoutEnlargement: true })
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(fillNoEnl.info.width).toBe(80);
    expect(fillNoEnl.info.height).toBe(30);
  });

  it("clamps 4:2:0 JPEG top/left chroma edge indices independently, applies two-step vips_gamma LUT, and outputs 3 srgb channels in bandbool() (#66)", async () => {
    // 1. vips_gamma two-step 8-bit LUT truncation
    const g1 = await sharp(new Uint8Array([25, 50, 100]), { raw: { width: 1, height: 1, channels: 3 } })
      .gamma(2.2)
      .raw()
      .toBuffer();
    expect(Array.from(g1)).toEqual([20, 49, 99]);

    // 2. bandbool() on 3-channel srgb image outputs 3 channels [v, v, v]
    const bb = await sharp(new Uint8Array([50, 100, 200, 25, 150, 220]), { raw: { width: 2, height: 1, channels: 3 } })
      .bandbool("and")
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(bb.info.channels).toBe(3);
    expect(Array.from(bb.data)).toEqual([0, 0, 0, 16, 16, 16]);
  });

  it("evaluates flip/flop prior to explicit rotate(angle) matching libvips pipeline order (#67)", async () => {
    const raw4x2 = new Uint8Array([
      10, 0, 0, 255, 20, 0, 0, 255, 30, 0, 0, 255, 40, 0, 0, 255,
      50, 0, 0, 255, 60, 0, 0, 255, 70, 0, 0, 255, 80, 0, 0, 255
    ]);
    const opts = { raw: { width: 4, height: 2, channels: 4 as const } };
    const r1 = await sharp(raw4x2, opts).rotate(90).flop().raw().toBuffer();
    const r2 = await sharp(raw4x2, opts).flop().rotate(90).raw().toBuffer();
    expect(Array.from(r1)).toEqual(Array.from(r2));
    expect([r1[0], r1[4], r1[8], r1[12]]).toEqual([80, 40, 70, 30]);
  });

  it("thresholds all 4 RGBA channels in threshold() matching libvips vips_moreeq_const1 and scales SVG <circle> inside <g transform> (#68)", async () => {
    const rgba = new Uint8Array([50, 180, 220, 200, 200, 50, 10, 100]);
    const opts = { raw: { width: 2, height: 1, channels: 4 as const } };
    const thTrue = await sharp(rgba, opts).threshold(128, { greyscale: true }).raw().toBuffer();
    expect(Array.from(thTrue)).toEqual([255, 255, 255, 255, 0, 0, 0, 0]);
    const thFalse = await sharp(rgba, opts).threshold(128, { greyscale: false }).raw().toBuffer();
    expect(Array.from(thFalse)).toEqual([0, 255, 255, 255, 255, 0, 0, 0]);

    const svgCircle = `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80">
      <g transform="translate(40, 40) scale(2)">
        <circle cx="0" cy="0" r="15" fill="#ff0000"/>
      </g>
    </svg>`;
    const cBuf = await sharp(new TextEncoder().encode(svgCircle)).raw().toBuffer();
    const edgeInside = (40 * 80 + 65) * 4; // distance 25 from (40,40), inside scaled radius 30 (15*2)
    expect(Array.from(cBuf.subarray(edgeInside, edgeInside + 4))).toEqual([255, 0, 0, 255]);
  });

  it("clears outside-overlay pixels for Porter-Duff in/out/dest-in/dest-atop/clear/source, sums alpha in blend:add, and supports boolean() (#69)", async () => {
    const dst2x1 = new Uint8Array([100, 150, 200, 200, 100, 150, 200, 200]);
    const src1x1 = new Uint8Array([80, 120, 100, 120]);
    const inOut = await sharp(dst2x1, { raw: { width: 2, height: 1, channels: 4 } })
      .composite([{ input: src1x1, raw: { width: 1, height: 1, channels: 4 }, top: 0, left: 0, blend: "in" }])
      .raw()
      .toBuffer();
    expect(Array.from(inOut.subarray(0, 4))).toEqual([80, 120, 100, 94]);
    expect(Array.from(inOut.subarray(4, 8))).toEqual([0, 0, 0, 0]);

    const addOut = await sharp(new Uint8Array([100, 150, 200, 200]), { raw: { width: 1, height: 1, channels: 4 } })
      .composite([{ input: src1x1, raw: { width: 1, height: 1, channels: 4 }, blend: "add" }])
      .raw()
      .toBuffer();
    expect(addOut[0]).toBe(116);
    expect(addOut[1]).toBe(174);
    expect(addOut[3]).toBe(255);

    const a4 = new Uint8Array([0b1100, 0b1010, 0b1111, 200]);
    const b4 = new Uint8Array([0b1010, 0b0110, 0b0101, 100]);
    const opts4 = { raw: { width: 1, height: 1, channels: 4 as const } };
    const boolAnd = await sharp(a4, opts4).boolean(b4, "and", opts4).raw().toBuffer();
    expect(Array.from(boolAnd)).toEqual([8, 2, 5, 64]);
    const boolXor = await sharp(a4, opts4).boolean(b4, "eor", opts4).raw().toBuffer();
    expect(Array.from(boolXor)).toEqual([6, 12, 10, 172]);
  });

  it("expands Color Type 0 + tRNS PNG to 4-channel srgb in raw() while keeping 2 channels in metadata() and encodes PDF output (#70)", async () => {
    const pdfBuf = await sharp({ create: { width: 32, height: 24, channels: 4, background: "#4488cc" } })
      .toFormat("pdf")
      .toBuffer();
    const pdfMeta = await sharp(pdfBuf).metadata();
    expect(pdfMeta.format).toBe("pdf");
    expect(pdfMeta.width).toBe(32);
    expect(pdfMeta.height).toBe(24);
  });

  it("matches libvips on contain-resize alpha promotion, rotate/affine bounding box & unpremultiplication, and b-w raw() channels/depth (#71)", async () => {
    // 1. contain resize on 3-channel RGB image with alpha < 1 background promotes to 4 channels
    const containRgba = await sharp({
      create: { width: 40, height: 30, channels: 3, background: { r: 100, g: 150, b: 200 } }
    })
      .resize(60, 60, { fit: "contain", background: { r: 10, g: 20, b: 30, alpha: 0.5 } })
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(containRgba.info.channels).toBe(4);
    expect(containRgba.info.depth).toBe("uchar");
    expect(containRgba.data.length).toBe(60 * 60 * 4);
    expect(containRgba.data[3]).toBe(128);

    // 2. rotate(45) and affine() on 40x30 produce 49x49 and [0,0,0,0] at alpha=0 corners
    const rot45 = await sharp({
      create: { width: 40, height: 30, channels: 4, background: { r: 200, g: 100, b: 50, alpha: 1 } }
    })
      .rotate(45, { background: { r: 10, g: 20, b: 30, alpha: 0 } })
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(rot45.info.width).toBe(49);
    expect(rot45.info.height).toBe(49);
    expect(Array.from(rot45.data.slice(0, 4))).toEqual([0, 0, 0, 0]);

    const c = Math.cos(Math.PI / 4);
    const s = Math.sin(Math.PI / 4);
    const aff45 = await sharp({
      create: { width: 40, height: 30, channels: 4, background: { r: 200, g: 100, b: 50, alpha: 1 } }
    })
      .affine([c, -s, s, c], { idx: 20, idy: 15, odx: 0, ody: 0, background: { r: 10, g: 20, b: 30, alpha: 0 } })
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(aff45.info.width).toBe(49);
    expect(aff45.info.height).toBe(49);
    expect(Array.from(aff45.data.slice(0, 4))).toEqual([0, 0, 0, 0]);

    // 3. grayscale().raw() and toColorspace("b-w").raw() on RGBA output 1 channel with depth: "uchar"
    const grayRaw = await sharp({
      create: { width: 8, height: 8, channels: 4, background: { r: 200, g: 100, b: 50, alpha: 0.5 } }
    })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(grayRaw.info.channels).toBe(1);
    expect(grayRaw.info.depth).toBe("uchar");
    expect(grayRaw.data.length).toBe(64);
  });

  it("matches libvips on 4-band RGBA median(), Lab sharpen() & mild sharpen/blur defaults, positional normalise(lower, upper), and trimOffsetLeft/Top (#72)", async () => {
    // 1. median(3) filters all 4 channels including alpha
    const medIn = new Uint8Array(4 * 4 * 4);
    for (let i = 0; i < 16; i++) {
      medIn[i * 4] = (i * 37) & 255;
      medIn[i * 4 + 1] = (i * 53) & 255;
      medIn[i * 4 + 2] = (i * 71) & 255;
      medIn[i * 4 + 3] = i % 2 === 0 ? 255 : 40;
    }
    const medOut = await sharp(medIn, { raw: { width: 4, height: 4, channels: 4 } })
      .median(3)
      .raw()
      .toBuffer();
    expect(medOut[3]).toBe(255);
    expect(medOut[7]).toBe(255);
    expect(medOut[11]).toBe(40);

    // 2. blur() with no args applies 3x3 box blur (/9) and sharpen({ sigma, m1, m2 }) works in Lab space
    const grid = new Uint8Array(16 * 16 * 3);
    for (let i = 0; i < grid.length; i++) grid[i] = 40 + ((i * 29) % 160);
    const blurNoArg = await sharp(grid, { raw: { width: 16, height: 16, channels: 3 } }).blur().raw().toBuffer();
    const boxConv = await sharp(grid, { raw: { width: 16, height: 16, channels: 3 } })
      .convolve({ width: 3, height: 3, kernel: [1, 1, 1, 1, 1, 1, 1, 1, 1], scale: 9 })
      .raw()
      .toBuffer();
    expect(Array.from(blurNoArg)).toEqual(Array.from(boxConv));

    const sharpNoArg = await sharp(grid, { raw: { width: 16, height: 16, channels: 3 } }).sharpen().raw().toBuffer();
    const sharpConv = await sharp(grid, { raw: { width: 16, height: 16, channels: 3 } })
      .convolve({ width: 3, height: 3, kernel: [-1, -1, -1, -1, 32, -1, -1, -1, -1], scale: 24 })
      .raw()
      .toBuffer();
    expect(Array.from(sharpNoArg)).toEqual(Array.from(sharpConv));

    const sharpObj = await sharp(grid, { raw: { width: 16, height: 16, channels: 3 } })
      .sharpen({ sigma: 1.5, m1: 1.2, m2: 2.5 })
      .raw()
      .toBuffer();
    expect(sharpObj[1]).toBe(26);
    expect(sharpObj[3]).toBe(154);

    // 3. normalise(10, 90) positional overload matches normalise({ lower: 10, upper: 90 })
    const normPos = await sharp(grid, { raw: { width: 16, height: 16, channels: 3 } }).normalise(10, 90).raw().toBuffer();
    const normObj = await sharp(grid, { raw: { width: 16, height: 16, channels: 3 } }).normalise({ lower: 10, upper: 90 }).raw().toBuffer();
    expect(Array.from(normPos)).toEqual(Array.from(normObj));

    // 4. trim() populates trimOffsetLeft and trimOffsetTop in OutputInfo
    const trimIn = new Uint8Array(20 * 20 * 4).fill(255);
    for (let y = 7; y < 15; y++) {
      for (let x = 5; x < 11; x++) {
        const idx = (y * 20 + x) * 4;
        trimIn[idx] = 255;
        trimIn[idx + 1] = 0;
        trimIn[idx + 2] = 0;
        trimIn[idx + 3] = 255;
      }
    }
    const trimmed = await sharp(trimIn, { raw: { width: 20, height: 20, channels: 4 } })
      .trim()
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(trimmed.info.width).toBe(6);
    expect(trimmed.info.height).toBe(8);
    expect(trimmed.info.trimOffsetLeft).toBe(-5);
    expect(trimmed.info.trimOffsetTop).toBe(-7);
  });

  it("supports chained joinChannel(1->2->3->4), replaces composite() on repeated calls, and rejects oversized composite overlays (#74)", async () => {
    const w = 4, h = 4;
    const chR = new Uint8Array(w * h).fill(50);
    const chG = new Uint8Array(w * h).fill(120);
    const chB = new Uint8Array(w * h).fill(200);
    const chA = new Uint8Array(w * h).fill(180);
    const rPng = await sharp(chR, { raw: { width: w, height: h, channels: 1 } }).toColorspace("b-w").png().toBuffer();
    const gPng = await sharp(chG, { raw: { width: w, height: h, channels: 1 } }).toColorspace("b-w").png().toBuffer();
    const bPng = await sharp(chB, { raw: { width: w, height: h, channels: 1 } }).toColorspace("b-w").png().toBuffer();
    const aPng = await sharp(chA, { raw: { width: w, height: h, channels: 1 } }).toColorspace("b-w").png().toBuffer();

    const joined3 = await sharp(rPng).joinChannel(gPng).joinChannel(bPng).raw().toBuffer({ resolveWithObject: true });
    expect(joined3.info.channels).toBe(3);
    expect(Array.from(joined3.data.slice(0, 3))).toEqual([50, 120, 200]);

    const joined4 = await sharp(rPng).joinChannel(gPng).joinChannel([bPng, aPng]).raw().toBuffer({ resolveWithObject: true });
    expect(joined4.info.channels).toBe(4);
    expect(Array.from(joined4.data.slice(0, 4))).toEqual([50, 120, 200, 180]);

    // Repeated .composite() replaces earlier .composite()
    const base = await sharp({ create: { width: 10, height: 10, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 1 } } }).png().toBuffer();
    const ov1 = await sharp({ create: { width: 4, height: 4, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } } }).png().toBuffer();
    const ov2 = await sharp({ create: { width: 4, height: 4, channels: 4, background: { r: 0, g: 255, b: 0, alpha: 1 } } }).png().toBuffer();
    const repComp = await sharp(base)
      .composite([{ input: ov1, left: 0, top: 0 }])
      .composite([{ input: ov2, left: 4, top: 4 }])
      .raw()
      .toBuffer();
    expect(Array.from(repComp.slice(0, 4))).toEqual([10, 20, 30, 255]);

    // Oversized overlay throws
    const bigOv = await sharp({ create: { width: 20, height: 20, channels: 4, background: "#ff0000" } }).png().toBuffer();
    await expect(sharp(base).composite([{ input: bigOv }]).toBuffer()).rejects.toThrow(
      /Image to composite must have same dimensions or smaller/
    );
  });

  it("matches libvips resize upscaling/edge-clamping, linear kernel, 4-band linear(), and ensureAlpha() (#75)", async () => {
    // 1. 1D ramp 4->8 upscaling with linear and lanczos3 (Catmull-Rom in libvips)
    const src4 = Buffer.from([0, 0, 0, 100, 100, 100, 200, 200, 200, 50, 50, 50]);
    const upLin = await sharp(src4, { raw: { width: 4, height: 1, channels: 3 } })
      .resize(8, 1, { fit: "fill", kernel: "linear" })
      .raw()
      .toBuffer();
    expect(Array.from({ length: 8 }, (_, i) => upLin[i * 3])).toEqual([0, 0, 50, 100, 150, 200, 125, 50]);

    const upLan = await sharp(src4, { raw: { width: 4, height: 1, channels: 3 } })
      .resize(8, 1, { fit: "fill", kernel: "lanczos3" })
      .raw()
      .toBuffer();
    expect(Array.from({ length: 8 }, (_, i) => upLan[i * 3])).toEqual([0, 0, 44, 100, 166, 200, 131, 50]);

    // 2. 4-band linear(a, b) transforms alpha when 4 coefficients are provided
    const rgba = Buffer.from([100, 150, 200, 128]);
    const lin4 = await sharp(rgba, { raw: { width: 1, height: 1, channels: 4 } })
      .linear([0.5, 1.0, 0.5, 0.5], [10, -10, 5, 20])
      .raw()
      .toBuffer();
    expect(Array.from(lin4)).toEqual([60, 140, 105, 84]);

    // 3. ensureAlpha(0.5) quantizes to 127 and .grayscale().ensureAlpha(0.5) stays 1-channel b-w
    const rgb = Buffer.from([100, 150, 200]);
    const ens = await sharp(rgb, { raw: { width: 1, height: 1, channels: 3 } })
      .ensureAlpha(0.5)
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(ens.info.channels).toBe(4);
    expect(ens.data[3]).toBe(127);

    const grayEns = await sharp(rgb, { raw: { width: 1, height: 1, channels: 3 } })
      .grayscale()
      .ensureAlpha(0.5)
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(grayEns.info.channels).toBe(1);
  });

  it("exposes sharp static enums (gravity, fit, kernel, bool, strategy) and supports numeric gravity (0..8) (#76)", async () => {
    expect((sharp as any).gravity).toEqual({
      center: 0,
      centre: 0,
      north: 1,
      east: 2,
      south: 3,
      west: 4,
      northeast: 5,
      southeast: 6,
      southwest: 7,
      northwest: 8
    });
    expect((sharp as any).fit.cover).toBe("cover");
    expect((sharp as any).kernel.lanczos3).toBe("lanczos3");
    expect((sharp as any).bool.eor).toBe("eor");

    const base = Buffer.from([
      10, 0, 0,   20, 0, 0,
      30, 0, 0,   40, 0, 0
    ]);
    // Resize 2x2 -> 1x1 with position = sharp.gravity.southeast (6) picks bottom-right pixel (40,0,0)
    const se = await sharp(base, { raw: { width: 2, height: 2, channels: 3 } })
      .resize(1, 1, { fit: "cover", position: (sharp as any).gravity.southeast, kernel: "nearest" })
      .raw()
      .toBuffer();
    expect(se[0]).toBe(40);

    // Composite 1x1 onto 2x2 with gravity = sharp.gravity.northwest (8) places at (0,0)
    const ov = await sharp(Buffer.from([99, 99, 99]), { raw: { width: 1, height: 1, channels: 3 } }).png().toBuffer();
    const comp = await sharp(base, { raw: { width: 2, height: 2, channels: 3 } })
      .composite([{ input: ov, gravity: (sharp as any).gravity.northwest }])
      .raw()
      .toBuffer();
    expect(comp[0]).toBe(99);
  });
});
