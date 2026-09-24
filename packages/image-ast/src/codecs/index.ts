import {
  parseColor,
  type ImageFormat,
  type ImageMetadata,
  type OutputEncodeOptions,
  type RgbaImage,
  type SharpInputOptions
} from "../ast.js";
import { decodePngImage, encodePngImage, isPngBytes, readPngMetadata } from "./png.js";
import { decodeJpegImage, encodeJpegImage, isJpegBytes, readJpegMetadata } from "./jpeg.js";
import { decodeWebpImage, encodeWebpImage, isWebpBytes, readWebpMetadata } from "./webp.js";
import { decodeGifImage, encodeGifImage, isGifBytes, readGifMetadata } from "./gif.js";
import {
  decodeBmpImage,
  decodeNetpbmImage,
  decodeTiffImage,
  encodeBmpImage,
  encodePbm,
  encodePgm,
  encodePpm,
  encodeTiffImage,
  isBmpBytes,
  isNetpbmBytes,
  isTiffBytes,
  readBmpMetadata,
  readNetpbmMetadata
} from "./netpbm.js";
import {
  decodePdfImage,
  decodeSvgImage,
  isPdfBytes,
  isSvgBytes,
  readPdfMetadata,
  readSvgMetadata
} from "./svg-pdf.js";

const DEFAULT_PIXEL_LIMIT = 268402689; // 16383 * 16383 (matches sharp default)

export function detectImageFormat(bytes: Uint8Array): ImageFormat {
  if (isPngBytes(bytes)) return "png";
  if (isJpegBytes(bytes)) return "jpeg";
  if (isWebpBytes(bytes)) return "webp";
  if (isGifBytes(bytes)) return "gif";
  if (isNetpbmBytes(bytes)) {
    const m = String.fromCharCode(bytes[0]!, bytes[1]!);
    if (m === "P1" || m === "P4") return "pbm";
    if (m === "P2" || m === "P5") return "pgm";
    return "ppm";
  }
  if (isBmpBytes(bytes)) return "bmp";
  if (isTiffBytes(bytes)) return "tiff";
  if (isPdfBytes(bytes)) return "pdf";
  if (isSvgBytes(bytes)) return "svg";
  throw new Error("Input buffer contains unsupported image format");
}

export function readImageMetadata(
  bytes?: Uint8Array,
  options?: SharpInputOptions
): ImageMetadata {
  if (options?.create) {
    const { width, height, channels } = options.create;
    return {
      format: "raw",
      width,
      height,
      space: "srgb",
      channels,
      depth: "uchar",
      density: options.density ?? 72,
      hasAlpha: channels === 4,
      size: width * height * channels
    };
  }
  if (options?.raw && bytes) {
    const { width, height, channels } = options.raw;
    return {
      format: "raw",
      width,
      height,
      space: channels < 3 ? "b-w" : "srgb",
      channels,
      depth: "uchar",
      density: options.density ?? 72,
      hasAlpha: channels === 2 || channels === 4,
      size: bytes.byteLength
    };
  }
  if (!bytes || bytes.length === 0) {
    throw new Error("Empty image input");
  }
  const fmt = detectImageFormat(bytes);
  let meta: ImageMetadata;
  switch (fmt) {
    case "png":
      meta = readPngMetadata(bytes);
      break;
    case "jpeg":
      meta = readJpegMetadata(bytes);
      break;
    case "webp":
      meta = readWebpMetadata(bytes);
      break;
    case "gif":
      meta = readGifMetadata(bytes);
      break;
    case "ppm":
    case "pgm":
    case "pbm":
      meta = readNetpbmMetadata(bytes);
      break;
    case "bmp":
      meta = readBmpMetadata(bytes);
      break;
    case "tiff": {
      const decoded = decodeTiffImage(bytes);
      meta = {
        format: "tiff",
        width: decoded.width,
        height: decoded.height,
        space: decoded.space,
        channels: decoded.channels,
        depth: decoded.depth,
        density: decoded.density,
        hasAlpha: decoded.hasAlpha,
        ...(decoded.orientation !== undefined ? { orientation: decoded.orientation } : {}),
        size: bytes.byteLength
      };
      break;
    }
    case "pdf":
      meta = readPdfMetadata(bytes, options);
      break;
    case "svg":
      meta = readSvgMetadata(bytes, options);
      break;
    default:
      throw new Error(`Unsupported format: ${fmt}`);
  }

  const limit =
    options?.limitInputPixels === false
      ? Infinity
      : (options?.limitInputPixels ?? DEFAULT_PIXEL_LIMIT);
  if (meta.width * meta.height > limit) {
    throw new Error(
      `Input image exceeds pixel limit (${meta.width}x${meta.height} > ${limit})`
    );
  }
  return meta;
}

export function decodeImage(
  bytes?: Uint8Array,
  options?: SharpInputOptions
): RgbaImage {
  if (options?.create) {
    const { width, height, channels, background } = options.create;
    const bg = parseColor(background, channels === 4 ? 255 : 255);
    const data = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      data[i * 4] = bg.r;
      data[i * 4 + 1] = bg.g;
      data[i * 4 + 2] = bg.b;
      data[i * 4 + 3] = channels === 4 ? bg.a : 255;
    }
    return {
      width,
      height,
      data,
      format: "raw",
      space: "srgb",
      channels,
      depth: "uchar",
      density: options.density ?? 72,
      hasAlpha: channels === 4
    };
  }
  if (options?.raw && bytes) {
    const { width, height, channels } = options.raw;
    const data = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      if (channels === 4) {
        data[i * 4] = bytes[i * 4] ?? 0;
        data[i * 4 + 1] = bytes[i * 4 + 1] ?? 0;
        data[i * 4 + 2] = bytes[i * 4 + 2] ?? 0;
        data[i * 4 + 3] = bytes[i * 4 + 3] ?? 255;
      } else if (channels === 3) {
        data[i * 4] = bytes[i * 3] ?? 0;
        data[i * 4 + 1] = bytes[i * 3 + 1] ?? 0;
        data[i * 4 + 2] = bytes[i * 3 + 2] ?? 0;
        data[i * 4 + 3] = 255;
      } else if (channels === 2) {
        const g = bytes[i * 2] ?? 0;
        data[i * 4] = g;
        data[i * 4 + 1] = g;
        data[i * 4 + 2] = g;
        data[i * 4 + 3] = bytes[i * 2 + 1] ?? 255;
      } else {
        const g = bytes[i] ?? 0;
        data[i * 4] = g;
        data[i * 4 + 1] = g;
        data[i * 4 + 2] = g;
        data[i * 4 + 3] = 255;
      }
    }
    return {
      width,
      height,
      data,
      format: "raw",
      space: channels < 3 ? "b-w" : "srgb",
      channels,
      depth: "uchar",
      density: options.density ?? 72,
      hasAlpha: channels === 2 || channels === 4
    };
  }
  if (!bytes || bytes.length === 0) {
    throw new Error("Empty image input");
  }
  const meta = readImageMetadata(bytes, options);
  switch (meta.format) {
    case "png":
      return decodePngImage(bytes);
    case "jpeg":
      return decodeJpegImage(bytes);
    case "webp":
      return decodeWebpImage(bytes);
    case "gif":
      return decodeGifImage(bytes, options);
    case "ppm":
    case "pgm":
    case "pbm":
      return decodeNetpbmImage(bytes);
    case "bmp":
      return decodeBmpImage(bytes);
    case "tiff":
      return decodeTiffImage(bytes);
    case "pdf":
      return decodePdfImage(bytes, options);
    case "svg":
      return decodeSvgImage(bytes, options);
    default:
      throw new Error(`Unsupported format: ${meta.format}`);
  }
}

export function encodeImage(
  img: RgbaImage,
  options: OutputEncodeOptions
): { readonly data: Uint8Array; readonly format: ImageFormat; readonly channels: number } {
  const fmt: ImageFormat =
    options.format === "pdf" || options.format === "svg"
      ? "png"
      : (options.format ?? (img.format === "pdf" || img.format === "svg" ? "png" : img.format));

  switch (fmt) {
    case "png": {
      const data = encodePngImage(img, {
        ...(options.compressionLevel !== undefined
          ? { compressionLevel: options.compressionLevel }
          : {}),
        density: options.density ?? img.density,
        ...(options.orientation !== undefined ? { orientation: options.orientation } : img.orientation !== undefined ? { orientation: img.orientation } : {})
      });
      const isBw = img.space === "b-w" || img.channels === 1 || img.channels === 2;
      const outChannels = isBw ? (img.hasAlpha ? 2 : 1) : (img.hasAlpha ? 4 : 3);
      return { data, format: "png", channels: outChannels };
    }
    case "jpeg": {
      const data = encodeJpegImage(img, {
        quality: options.quality ?? 85,
        density: options.density ?? img.density,
        ...(options.orientation !== undefined ? { orientation: options.orientation } : {})
      });
      return { data, format: "jpeg", channels: 3 };
    }
    case "webp": {
      const orientation = options.orientation ?? img.orientation;
      const data = encodeWebpImage(img, {
        quality: options.quality ?? 80,
        ...(options.lossless !== undefined ? { lossless: options.lossless } : {}),
        density: options.density ?? img.density,
        ...(orientation !== undefined ? { orientation } : {})
      });
      return { data, format: "webp", channels: img.hasAlpha ? 4 : 3 };
    }
    case "gif": {
      const data = encodeGifImage(img);
      return { data, format: "gif", channels: 4 };
    }
    case "ppm": {
      const data = encodePpm(img);
      return { data, format: "ppm", channels: 3 };
    }
    case "pgm": {
      const data = encodePgm(img);
      return { data, format: "pgm", channels: 1 };
    }
    case "pbm": {
      const data = encodePbm(img);
      return { data, format: "pbm", channels: 1 };
    }
    case "bmp": {
      const data = encodeBmpImage(img);
      return { data, format: "bmp", channels: 3 };
    }
    case "tiff": {
      const orientation = options.orientation ?? img.orientation;
      const data = encodeTiffImage(img, {
        density: options.density ?? img.density,
        ...(orientation !== undefined ? { orientation } : {})
      });
      return { data, format: "tiff", channels: 4 };
    }
    case "raw": {
      if (img.channels === 4) {
        return { data: new Uint8Array(img.data), format: "raw", channels: 4 };
      }
      if (img.channels === 3) {
        const rgb = new Uint8Array(img.width * img.height * 3);
        for (let i = 0; i < img.width * img.height; i++) {
          rgb[i * 3] = img.data[i * 4]!;
          rgb[i * 3 + 1] = img.data[i * 4 + 1]!;
          rgb[i * 3 + 2] = img.data[i * 4 + 2]!;
        }
        return { data: rgb, format: "raw", channels: 3 };
      }
      if (img.channels === 2) {
        const ga = new Uint8Array(img.width * img.height * 2);
        for (let i = 0; i < img.width * img.height; i++) {
          ga[i * 2] = img.data[i * 4]!;
          ga[i * 2 + 1] = img.data[i * 4 + 3]!;
        }
        return { data: ga, format: "raw", channels: 2 };
      }
      const gray = new Uint8Array(img.width * img.height);
      for (let i = 0; i < img.width * img.height; i++) {
        gray[i] = img.data[i * 4]!;
      }
      return { data: gray, format: "raw", channels: 1 };
    }
    default:
      throw new Error(`Unsupported output format: ${fmt}`);
  }
}
