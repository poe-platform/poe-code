import { isWbmpBytes, readWbmpHeader, decodeWbmpImage } from "./wbmp-input.js";
import { isOtbBytes, readOtbHeader, decodeOtbImage } from "./otb-input.js";
import { encodeFitsImage } from "./fits-output.js";
import { isFitsBytes, readFitsHeader, decodeFitsImage } from "./fits-input.js";
import { encodeSixelImage } from "./sixel-output.js";
import { isSixelBytes, readSixelMetadata, decodeSixelImage } from "./sixel-input.js";
import { isPsdBytes, readPsdHeader, decodePsdImage } from "./psd-input.js";
import { isPcxBytes, readPcxHeader, decodePcxImage } from "./pcx-input.js";
import { encodePsdImage } from "./psd-output.js";
import { isXwdBytes, readXwdHeader, decodeXwdImage } from "./xwd-input.js";
import { isQoiBytes, readQoiMetadata, decodeQoiImage } from "./qoi-input.js";
import { encodeQoiImage } from "./qoi-output.js";
import { isMiffBytes, readMiffHeader, decodeMiffImage } from "./miff-input.js";
import { encodeOtbImage } from "./otb-output.js";
import { encodeWbmpImage } from "./wbmp-output.js";
import { encodeXbmImage } from "./xbm-output.js";
import { isXbmBytes, readXbmImage } from "./xbm.js";
import { encodePcxImage } from "./pcx-output.js";
import { encodeXwdImage } from "./xwd-output.js";
import { encodeXpmImage } from "./xpm-output.js";
import { isXpmBytes, readXpmImage } from "./xpm.js";
import { encodeHdrImage } from "./hdr-output.js";
import { isRadianceBytes, readRadianceHeader, decodeRadianceImage } from "./radiance.js";
import { isExrBytes, readExrHeader, decodeExrImage } from "./exr.js";
import { encodeExrImage } from "./exr-output.js";
import { encodePfmImage } from "./pfm-output.js";
import { isFarbfeldBytes, readFarbfeldMetadata, decodeFarbfeldImage } from "./farbfeld.js";
import { isPhmBytes, readPhmHeader, decodePhmImage } from "./phm.js";
import { isPfmBytes, readPfmHeader, decodePfmImage } from "./pfm.js";
import { encodeTgaImage, tgaChannels } from "./tga-output.js";
import { isTgaBytes, readTgaMetadata, decodeTgaImage } from "./tga.js";
import { isTxtBytes, readTxtImage } from "./txt.js";
import {encodeIcoImage} from "./ico-output.js";
import { isIcoBytes, readIcoEntry, decodeIcoImage } from "./ico-input.js";
import { isMngBytes, readMngLayout, decodeMngImage } from "./mng-input.js";
import { encodeMngImage } from "./mng.js";
import { encodeApngImage } from "./apng-output.js";
import {netpbmFormat} from "./netpbm-format.js";
import { encodeMiffImage, miffChannels } from "./miff.js";
import {tiffChannels} from "./tiff-layout.js";
import {imageOutputFormat} from "../output-format.js";
import {TextPixels} from "./text-pixels.js";
import {CreatedPixels} from "./create-pixels.js";
import {checkLimitInputPixels} from "../limits.js";
import {
  type ImageFormat,
  type ImageMetadata,
  type OutputEncodeOptions,
  type RgbaImage,
  type SharpInputOptions
} from "../ast.js";
import { decodePngImage,
  decodePngToCanvas, encodePngImage, isPngBytes, readPngMetadata } from "./png.js";
import { decodeJpegImage, encodeJpegImage, isJpegBytes, readJpegMetadata } from "./jpeg.js";
import { decodeWebpImage, encodeWebpImage, isWebpBytes, readWebpMetadata } from "./webp.js";
import {
  decodeHeifImage,
  detectHeifFormat,
  encodeHeifImage,
  isHeifBytes,
  readHeifMetadata
} from "./heif.js";
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
  encodePdfImage,
  isPdfBytes,
  isSvgBytes,
  readPdfMetadata,
  readSvgMetadata
} from "./svg-pdf.js";


export function detectImageFormat(bytes: Uint8Array): ImageFormat {
  if (isSixelBytes(bytes)) return "sixel";
  if (isPcxBytes(bytes)) return "pcx";
  if (isFitsBytes(bytes)) return "fits";
  if (isXwdBytes(bytes)) return "xwd";
  if (isQoiBytes(bytes)) return "qoi";
  if (isPsdBytes(bytes)) return "psd";
  if (isMiffBytes(bytes)) return "miff";
  if (isExrBytes(bytes)) return "exr";
  if (isRadianceBytes(bytes)) return "hdr";
  if (isFarbfeldBytes(bytes)) return "farbfeld";
  if (isPhmBytes(bytes)) return "phm";
  if (isPfmBytes(bytes)) return "pfm";
  if (isXbmBytes(bytes)) return "xbm";
  if (isXpmBytes(bytes)) return "xpm";
  if (isTxtBytes(bytes)) return "txt";
  if (isTgaBytes(bytes)) return "tga";
  if (isIcoBytes(bytes)) return bytes[2] === 1 ? "ico" : "cur";
  if (isOtbBytes(bytes)) return "otb";
  if (isMngBytes(bytes)) return "mng";
  if (isPngBytes(bytes)) return "png";
  if (isJpegBytes(bytes)) return "jpeg";
  if (isWebpBytes(bytes)) return "webp";
  if (isHeifBytes(bytes)) return detectHeifFormat(bytes) ?? "heic";
  if (isGifBytes(bytes)) return "gif";
  if (isNetpbmBytes(bytes)) {
    const m = String.fromCharCode(bytes[0]!, bytes[1]!);
    if (m === "P7") return "pam";
    if (m === "P1" || m === "P4") return "pbm";
    if (m === "P2" || m === "P5") return "pgm";
    return "ppm";
  }
  if (isBmpBytes(bytes)) return "bmp";
  if (isTiffBytes(bytes)) return "tiff";
  if (isPdfBytes(bytes)) return "pdf";
  if (isSvgBytes(bytes)) return "svg";
  if (isWbmpBytes(bytes)) return "wbmp";
  throw new Error("Input buffer contains unsupported image format");
}


function renderTextInput(spec:NonNullable<SharpInputOptions["text"]>,density?:number):RgbaImage {
 const pixels=new TextPixels(spec,density),data=new Uint8Array(pixels.metadata.width*pixels.metadata.height*4);pixels.fill(data);return {...pixels.metadata,data};
}

export function readImageMetadata(
  bytes?: Uint8Array,
  options?: SharpInputOptions
): ImageMetadata {
  if (options?.text) {
    const rendered = new TextPixels(options.text, options.density).metadata;
    return {
      format: "raw",
      width: rendered.width,
      height: rendered.height,
      space: rendered.space,
      channels: rendered.channels,
      depth: "uchar",
      density: rendered.density,
      hasAlpha: rendered.hasAlpha,
      size: rendered.width * rendered.height * rendered.channels
    };
  }
  if (options?.create) {
    const { width, height, channels, pageHeight } = options.create;
    checkLimitInputPixels(width, height, options);
    return {
      format: "raw",
      width,
      height,
      space: channels < 3 ? "b-w" : "srgb",
      channels,
      depth: "uchar",
      density: options.density ?? 72,
      hasAlpha: channels === 2 || channels === 4,
      ...(pageHeight !== undefined ? { pageHeight, pages: Math.max(1, Math.floor(height / pageHeight)) } : {}),
      size: width * height * channels
    };
  }
  if (options?.raw && bytes) {
    const { width, height, channels, pageHeight, depth: rawDepth } = options.raw;
    checkLimitInputPixels(width, height, options);
    const depth = rawDepth ?? "uchar";
    const is16Bit =
      depth === "ushort" ||
      depth === "short" ||
      depth === "uint" ||
      depth === "int" ||
      depth === "float" ||
      depth === "double";
    return {
      format: "raw",
      width,
      height,
      space: is16Bit ? (channels < 3 ? "grey16" : "rgb16") : channels < 3 ? "b-w" : "srgb",
      channels,
      depth,
      density: options.density ?? 72,
      hasAlpha: channels === 2 || channels === 4,
      ...(pageHeight !== undefined ? { pageHeight, pages: Math.max(1, Math.floor(height / pageHeight)) } : {}),
      size: bytes.byteLength
    };
  }
  if (!bytes || bytes.length === 0) {
    throw new Error(!bytes ? "Input file is missing:" : "Input buffer contains unsupported image format");
  }
  const fmt = detectImageFormat(bytes);
  let meta: ImageMetadata;
  switch (fmt) {
    case "otb": meta = readOtbHeader(bytes).metadata; break;
    case "sixel": meta = readSixelMetadata(bytes, options); break;
    case "pcx": meta = readPcxHeader(bytes).metadata; break;
    case "xwd": meta = readXwdHeader(bytes).metadata; break;
    case "fits": meta = readFitsHeader(bytes).metadata; break;
    case "qoi": meta = readQoiMetadata(bytes); break;
    case "hdr": meta = readRadianceHeader(bytes).metadata; break;
    case "exr": meta = readExrHeader(bytes).metadata; break;
    case "psd": meta = readPsdHeader(bytes, options).metadata; break;
    case "miff": meta = readMiffHeader(bytes, options?.page).metadata; break;
    case "farbfeld": meta = readFarbfeldMetadata(bytes); break;
    case "phm": meta = readPhmHeader(bytes, options?.page).metadata; break;
    case "tga":
      meta = readTgaMetadata(bytes);
      break;
    case "wbmp": meta = readWbmpHeader(bytes).metadata; break;
    case "xbm": meta = readXbmImage(bytes, options, true); break;
    case "xpm": meta = readXpmImage(bytes, options, true); break;
    case "txt":
      meta = readTxtImage(bytes, options, true);
      break;
    case "ico":
    case "cur":
      meta = readIcoEntry(bytes, options).metadata;
      break;
    case "mng":
      meta = readMngLayout(bytes).metadata;
      break;
    case "png":
      meta = readPngMetadata(bytes);
      break;
    case "jpeg":
      meta = readJpegMetadata(bytes);
      break;
    case "webp":
      meta = readWebpMetadata(bytes);
      break;
    case "heic":
    case "heif":
    case "avif":
      meta = readHeifMetadata(bytes);
      break;
    case "gif":
      meta = readGifMetadata(bytes, options);
      break;
    case "pfm": meta = readPfmHeader(bytes, options?.page).metadata; break;
    case "pam":
    case "ppm":
    case "pgm":
    case "pbm":
      meta = readNetpbmMetadata(bytes, options?.page);
      break;
    case "bmp":
      meta = readBmpMetadata(bytes);
      break;
    case "tiff": {
      const decoded = decodeTiffImage(bytes, options?.page);
      meta = {
        ...(decoded.properties ? {properties:decoded.properties} : {}),
        format: "tiff",
        ...(decoded.pages === undefined ? {} : {pages: decoded.pages}),
        width: decoded.width,
        height: decoded.height,
        space: decoded.space,
        channels: decoded.channels,
        depth: decoded.depth,
        ...(decoded.bitsPerSample !== undefined ? { bitsPerSample: decoded.bitsPerSample } : {}),
        density: decoded.density,
        ...(decoded.resolution ? {resolution: decoded.resolution} : {}),
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

  checkLimitInputPixels(meta.width, meta.height, options);
  return meta;
}

export function decodeImage(
  bytes?: Uint8Array,
  options?: SharpInputOptions
): RgbaImage {
  if (options?.text) {
    return renderTextInput(options.text, options.density);
  }
  if (options?.create) {
    const source=new CreatedPixels({...options,create:options.create});
    const data=new Uint8Array(source.metadata.width*source.metadata.height*4);
    source.fill(data);
    return {...source.metadata,data};
  }
  if (options?.raw && bytes) {
    const { width, height, channels, premultiplied, pageHeight, depth: rawDepth } = options.raw;
    const depth = rawDepth ?? "uchar";
    const is16Bit =
      depth === "ushort" ||
      depth === "short" ||
      depth === "uint" ||
      depth === "int" ||
      depth === "float" ||
      depth === "double";
    if (!is16Bit && depth === "uchar" && channels === 4 && !premultiplied && bytes.byteLength >= width * height * 4) {
      return {
        width,
        height,
        data: bytes.subarray(0, width * height * 4),
        format: "raw",
        space: "srgb",
        channels: 4,
        depth: "uchar",
        density: options.density ?? 72,
        hasAlpha: true,
        ...(pageHeight !== undefined
          ? { pageHeight, pages: Math.max(1, Math.floor(height / pageHeight)) }
          : {})
      };
    }
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const readSample = (sampleIdx: number): number => {
      switch (depth) {
        case "char":
          return sampleIdx < bytes.byteLength ? Math.max(0, dv.getInt8(sampleIdx)) : 0;
        case "ushort":
          return sampleIdx * 2 + 1 < bytes.byteLength ? dv.getUint16(sampleIdx * 2, true) : 0;
        case "short":
          return sampleIdx * 2 + 1 < bytes.byteLength ? Math.max(0, dv.getInt16(sampleIdx * 2, true)) : 0;
        case "uint":
          return sampleIdx * 4 + 3 < bytes.byteLength ? dv.getUint32(sampleIdx * 4, true) : 0;
        case "int":
          return sampleIdx * 4 + 3 < bytes.byteLength ? Math.max(0, dv.getInt32(sampleIdx * 4, true)) : 0;
        case "float":
          return sampleIdx * 4 + 3 < bytes.byteLength ? Math.max(0, dv.getFloat32(sampleIdx * 4, true)) : 0;
        case "double":
          return sampleIdx * 8 + 7 < bytes.byteLength ? Math.max(0, dv.getFloat64(sampleIdx * 8, true)) : 0;
        default:
          return bytes[sampleIdx] ?? 0;
      }
    };
    const toU8 = (val: number): number =>
      is16Bit ? Math.min(255, Math.max(0, Math.floor(val / 256))) : Math.min(255, Math.max(0, Math.floor(val)));
    const toU16 = (val: number): number => Math.min(65535, Math.max(0, Math.round(val)));

    const data = new Uint8Array(width * height * 4);
    const data16 = is16Bit ? new Uint16Array(width * height * 4) : undefined;
    for (let i = 0; i < width * height; i++) {
      if (channels === 4) {
        const sR = readSample(i * 4);
        const sG = readSample(i * 4 + 1);
        const sB = readSample(i * 4 + 2);
        const sA = readSample(i * 4 + 3);
        const r = toU8(sR);
        const g = toU8(sG);
        const b = toU8(sB);
        const a = toU8(sA);
        if (premultiplied && a > 0 && a < 255) {
          const scale = 255 / a;
          data[i * 4] = Math.min(255, Math.floor(r * scale));
          data[i * 4 + 1] = Math.min(255, Math.floor(g * scale));
          data[i * 4 + 2] = Math.min(255, Math.floor(b * scale));
        } else {
          data[i * 4] = r;
          data[i * 4 + 1] = g;
          data[i * 4 + 2] = b;
        }
        data[i * 4 + 3] = a;
        if (data16) {
          data16[i * 4] = toU16(sR);
          data16[i * 4 + 1] = toU16(sG);
          data16[i * 4 + 2] = toU16(sB);
          data16[i * 4 + 3] = toU16(sA);
        }
      } else if (channels === 3) {
        const sR = readSample(i * 3);
        const sG = readSample(i * 3 + 1);
        const sB = readSample(i * 3 + 2);
        data[i * 4] = toU8(sR);
        data[i * 4 + 1] = toU8(sG);
        data[i * 4 + 2] = toU8(sB);
        data[i * 4 + 3] = 255;
        if (data16) {
          data16[i * 4] = toU16(sR);
          data16[i * 4 + 1] = toU16(sG);
          data16[i * 4 + 2] = toU16(sB);
          data16[i * 4 + 3] = 65535;
        }
      } else if (channels === 2) {
        const sG = readSample(i * 2);
        const sA = readSample(i * 2 + 1);
        const rawG = toU8(sG);
        const a = toU8(sA);
        const g = premultiplied && a > 0 && a < 255 ? Math.min(255, Math.floor((rawG * 255) / a)) : rawG;
        data[i * 4] = g;
        data[i * 4 + 1] = g;
        data[i * 4 + 2] = g;
        data[i * 4 + 3] = a;
        if (data16) {
          const u16G = toU16(sG);
          data16[i * 4] = u16G;
          data16[i * 4 + 1] = u16G;
          data16[i * 4 + 2] = u16G;
          data16[i * 4 + 3] = toU16(sA);
        }
      } else {
        const sG = readSample(i);
        const g = toU8(sG);
        data[i * 4] = g;
        data[i * 4 + 1] = g;
        data[i * 4 + 2] = g;
        data[i * 4 + 3] = 255;
        if (data16) {
          const u16G = toU16(sG);
          data16[i * 4] = u16G;
          data16[i * 4 + 1] = u16G;
          data16[i * 4 + 2] = u16G;
          data16[i * 4 + 3] = 65535;
        }
      }
    }
    return {
      width,
      height,
      data,
      ...(data16 ? { data16 } : {}),
      format: "raw",
      space: channels < 3 ? "b-w" : "srgb",
      channels,
      depth: "uchar",
      density: options.density ?? 72,
      hasAlpha: channels === 2 || channels === 4,
      ...(pageHeight !== undefined ? { pageHeight, pages: Math.max(1, Math.floor(height / pageHeight)) } : {})
    };
  }
  if (!bytes || bytes.length === 0) {
    throw new Error(!bytes ? "Input file is missing:" : "Input buffer contains unsupported image format");
  }
  const meta = readImageMetadata(bytes, options);
  let decoded: RgbaImage;
  switch (meta.format) {
    case "otb": decoded = decodeOtbImage(bytes, options); break;
    case "sixel": decoded = decodeSixelImage(bytes, options); break;
    case "pcx": decoded = decodePcxImage(bytes, options); break;
    case "xwd": decoded = decodeXwdImage(bytes, options); break;
    case "qoi": decoded = decodeQoiImage(bytes, options); break;
    case "fits": decoded = decodeFitsImage(bytes, options); break;
    case "hdr": decoded = decodeRadianceImage(bytes, options); break;
    case "exr": decoded = decodeExrImage(bytes, options); break;
    case "psd": decoded = decodePsdImage(bytes, options); break;
    case "miff": decoded = decodeMiffImage(bytes, options); break;
    case "farbfeld": decoded = decodeFarbfeldImage(bytes, options); break;
    case "phm": decoded = decodePhmImage(bytes, options); break;
    case "tga":
      decoded = decodeTgaImage(bytes, options);
      break;
    case "wbmp": decoded = decodeWbmpImage(bytes, options); break;
    case "xbm": decoded = readXbmImage(bytes, options); break;
    case "xpm": decoded = readXpmImage(bytes, options); break;
    case "txt":
      decoded = readTxtImage(bytes, options);
      break;
    case "mng":
      decoded = decodeMngImage(bytes, options);
      break;
    case "png":
      decoded = decodePngImage(bytes);
      break;
    case "jpeg":
      decoded = decodeJpegImage(bytes, options);
      break;
    case "webp":
      decoded = decodeWebpImage(bytes, options);
      break;
    case "heic":
    case "heif":
    case "avif":
      decoded = decodeHeifImage(bytes);
      break;
    case "gif":
      decoded = decodeGifImage(bytes, options);
      break;
    case "pfm": decoded = decodePfmImage(bytes, options); break;
    case "pam":
    case "ppm":
    case "pgm":
    case "pbm":
      decoded = decodeNetpbmImage(bytes, options?.page);
      break;
    case "ico":
    case "cur":
      return decodeIcoImage(bytes, options);
    case "bmp":
      decoded = decodeBmpImage(bytes);
      break;
    case "tiff":
      decoded = decodeTiffImage(bytes, options?.page);
      break;
    case "pdf":
      decoded = decodePdfImage(bytes, options);
      break;
    case "svg":
      decoded = decodeSvgImage(bytes, options);
      break;
    default:
      throw new Error(`Unsupported format: ${meta.format}`);
  }
  return decoded;
}

export function encodeImage(
  img: RgbaImage,
  options: OutputEncodeOptions
): { readonly data: Uint8Array; readonly format: ImageFormat; readonly channels: number } {
  const requested = imageOutputFormat(img.format,options.format);
  if (img.netpbmPages?.length && ["pnm", "ppm", "pgm", "pbm", "pam", "pfm", "phm"].includes(requested)) {
    const frames = img.netpbmPages.map(page => encodeImage({ ...page, netpbmPages: undefined }, options));
    const data = new Uint8Array(frames.reduce((size, frame) => size + frame.data.length, 0));
    let offset = 0;
    for (const frame of frames) { data.set(frame.data, offset); offset += frame.data.length; }
    return { ...frames[0]!, data };
  }
  const fmt = requested === "pnm" ? netpbmFormat(img.data16 ?? img.data) : requested;

  switch (fmt) {
    case "fits": return encodeFitsImage(img);
    case "sixel": return { data: encodeSixelImage(img), format: "sixel", channels: 3 };
    case "psd": return { data: encodePsdImage(img), format: "psd", channels: img.hasAlpha ? 4 : 3 };
    case "hdr": return { data: encodeHdrImage(img), format: "hdr", channels: 3 };
    case "exr": return { data: encodeExrImage(img), format: "exr", channels: img.hasAlpha ? 4 : 3 };
    case "qoi": return { data: encodeQoiImage(img), format: "qoi", channels: img.hasAlpha ? 4 : 3 };
    case "otb": return { data: encodeOtbImage(img), format: "otb", channels: 1 };
    case "wbmp": return { data: encodeWbmpImage(img), format: "wbmp", channels: 1 };
    case "xbm": return { data: encodeXbmImage(img, options.outputFilename), format: "xbm", channels: 1 };
    case "xwd": return { data: encodeXwdImage(img), format: "xwd", channels: 3 };
    case "pcx": return { data: encodePcxImage(img, options), format: "pcx", channels: 3 };
    case "xpm": return { data: encodeXpmImage(img, options.outputFilename), format: "xpm", channels: img.hasAlpha ? 4 : 3 };
    case "tga": return { data: encodeTgaImage(img, options), format: "tga", channels: tgaChannels(img) };
    case "ico":
    case "cur": return { data: encodeIcoImage(img), format: fmt, channels: 4 };
    case "mng": return { data: encodeMngImage(img, options), format: "mng", channels: 4 };
    case "apng": return { data: encodeApngImage(img, options), format: "apng", channels: 4 };
    case "miff": return { data: encodeMiffImage(img, options.miffDepth, options.miffCompression, options.loop), format: "miff", channels: miffChannels(img) };
    case "png": {
      const data = encodePngImage(img, {
        ...(options.synthesizeExif === undefined ? {} : { synthesizeExif: options.synthesizeExif }),
        ...(options.palette === undefined ? {} : { palette: options.palette }),
        pngCoder: options.pngCoder,
        pngInterlace: options.pngInterlace,
        pngColorType: options.pngColorType,
        pngPreserveColormap: options.pngPreserveColormap,
        pngBitDepth: options.pngBitDepth,
        ...(options.forceOpaque ? { forceOpaque: true } : {}),
        ...(options.omitPngResolution ? { omitPngResolution: true } : {}),
        ...(options.compressionLevel !== undefined
          ? { compressionLevel: options.compressionLevel }
          : {}),
        ...(options.consumeInput ? { consumeInput: true } : {}),
        ...(options.density === undefined ? {} : {density: options.density}),
        ...(options.orientation !== undefined ? { orientation: options.orientation } : img.orientation !== undefined ? { orientation: img.orientation } : {})
      });
      const outChannels = data[25] === 0 ? 1 : data[25] === 4 ? 2 : data[25] === 6 ? 4 : 3;
      return { data, format: "png", channels: outChannels };
    }
    case "jpeg": {
      const data = encodeJpegImage(img, {
        ...(options.synthesizeExif === undefined ? {} : { synthesizeExif: options.synthesizeExif }),
        quality: options.quality ?? 85,
        ...(options.jpegRestartInterval === undefined ? {} : { jpegRestartInterval: options.jpegRestartInterval }),
        ...(options.jpegDctMethod === undefined ? {} : { jpegDctMethod: options.jpegDctMethod }),
        ...(options.jpegOptimizeCoding === undefined ? {} : { jpegOptimizeCoding: options.jpegOptimizeCoding }),
        ...(options.jpegArithmeticCoding === undefined ? {} : { jpegArithmeticCoding: options.jpegArithmeticCoding }),
        ...(options.jpegProgressive === undefined ? {} : { jpegProgressive: options.jpegProgressive }),
        ...(options.samplingFactor === undefined ? {} : { samplingFactor: options.samplingFactor }),
        ...(options.chromaSubsampling === undefined ? {} : { chromaSubsampling: options.chromaSubsampling }),
        ...(options.density === undefined ? {} : {density: options.density}),
        ...(options.orientation !== undefined ? { orientation: options.orientation } : {})
      });
      return { data, format: "jpeg", channels: img.space === "b-w" || img.space === "grey16" ? 1 : img.space === "cmyk" ? 4 : 3 };
    }
    case "webp": {
      const orientation = options.orientation ?? img.orientation;
      const data = encodeWebpImage(img, {
        ...(options.synthesizeExif === undefined ? {} : { synthesizeExif: options.synthesizeExif }),
        ...(options.effort === undefined ? {} : { effort: options.effort }),
        ...(options.alphaCompression === undefined ? {} : { alphaCompression: options.alphaCompression }),
        ...(options.smartSubsample === undefined ? {} : { smartSubsample: options.smartSubsample }),
        ...(options.alphaQuality === undefined ? {} : { alphaQuality: options.alphaQuality }),
        ...(options.webpExact === undefined ? {} : { webpExact: options.webpExact }),
        ...(options.pageHeight === undefined ? {} : { pageHeight: options.pageHeight }),
        ...(options.delay === undefined ? {} : { delay: options.delay }),
        ...(options.loop === undefined ? {} : { loop: options.loop }),
        quality: options.quality ?? 80,
        ...(options.lossless !== undefined ? { lossless: options.lossless } : {}),
        density: options.density ?? img.density,
        ...(orientation !== undefined ? { orientation } : {})
      });
      return { data, format: "webp", channels: img.hasAlpha ? 4 : 3 };
    }
    case "heic":
    case "heif":
    case "avif": {
      const orientation = options.orientation ?? img.orientation;
      const data = encodeHeifImage(img, {
        format: fmt,
        ...(options.quality !== undefined ? { quality: options.quality } : {}),
        ...(options.compression !== undefined ? { compression: options.compression } : {}),
        ...(options.lossless !== undefined ? { lossless: options.lossless } : {}),
        density: options.density ?? img.density,
        ...(orientation !== undefined ? { orientation } : {})
      });
      const isBw = img.space === "b-w" || img.channels === 1 || img.channels === 2;
      const outChannels = isBw ? (img.hasAlpha ? 2 : 1) : img.hasAlpha ? 4 : 3;
      return { data, format: fmt, channels: outChannels };
    }
    case "gif": {
      const data = encodeGifImage(img, {
        gifVersion: options.gifVersion,
        gifInterlace: options.gifInterlace,
        ...(options.gifTransdiff ? { gifTransdiff: true } : {}),
        globalPalette: options.globalPalette,
        transparentColor: options.transparentColor,
        ...(options.pageHeight !== undefined ? { pageHeight: options.pageHeight } : {}),
        ...(options.delay !== undefined ? { delay: options.delay } : {}),
        ...(options.loop !== undefined ? { loop: options.loop } : {}),
        ...(options.optimizeFrames ? { optimizeFrames: true } : {})
      });
      return { data, format: "gif", channels: 4 };
    }
    case "phm":
    case "pfm": return encodePfmImage(img, fmt, options.endian);
    case "pam": {
      const data = encodePpm(img, options.netpbmDepth, false, true);
      return { data, format: "pam", channels: (img.space === "b-w" || img.space === "grey16" ? 1 : img.space === "cmyk" ? 4 : 3) + (img.hasAlpha ? 1 : 0) };
    }
    case "ppm": {
      const data = encodePpm(img, options.netpbmDepth, requested !== "pnm" && options.netpbmAscii);
      return { data, format: "ppm", channels: 3 };
    }
    case "pgm": {
      const data = encodePgm(img, options.netpbmDepth, options.netpbmAscii);
      return { data, format: "pgm", channels: 1 };
    }
    case "pbm": {
      const data = encodePbm(img, options.netpbmAscii);
      return { data, format: "pbm", channels: 1 };
    }
    case "bmp": {
      const data = encodeBmpImage(img, options);
      return { data, format: "bmp", channels: data[options.bmpFormat === "dib" ? 14 : data[14] === 12 ? 24 : 28] === 32 ? 4 : 3 };
    }
    case "tiff": {
      const orientation = options.orientation ?? img.orientation;
      const data = encodeTiffImage(img, {
        ...(options.tiffBig === undefined ? {} : {tiffBig: options.tiffBig}),
        ...(options.tiffIntegerDepth === undefined ? {} : {tiffIntegerDepth: options.tiffIntegerDepth}),
        ...(options.tiffSigned === undefined ? {} : {tiffSigned: options.tiffSigned}),
        ...(options.tiffFloatDepth === undefined ? {} : {tiffFloatDepth: options.tiffFloatDepth}),
        ...(options.tiffPlanar === undefined ? {} : {tiffPlanar: options.tiffPlanar}),
        ...(options.tiffAlpha === undefined ? {} : {tiffAlpha: options.tiffAlpha}),
        ...(options.tiffEndian === undefined ? {} : {tiffEndian: options.tiffEndian}),
        ...(options.tiffFillOrder === undefined ? {} : {tiffFillOrder: options.tiffFillOrder}),
        ...(options.tiffRowsPerStrip === undefined ? {} : {tiffRowsPerStrip: options.tiffRowsPerStrip}),
        ...(options.tiffTile === undefined ? {} : {tiffTile: options.tiffTile}),
        ...(options.tiffCompression === undefined ? {} : {tiffCompression: options.tiffCompression}),
        ...(options.quality === undefined ? {} : {quality: options.quality}),
        ...(options.density === undefined ? {} : {density: options.density}),
        ...(orientation !== undefined ? { orientation } : {})
      });
      return { data, format: "tiff", channels: options.tiffCompression === "jpeg" ? 3 : tiffChannels(img) };
    }
    case "pdf": {
      const data = encodePdfImage(img);
      return { data, format: "pdf", channels: img.hasAlpha ? 4 : 3 };
    }
    case "raw": {
      let rawU8: Uint8Array;
      let outCh: 1 | 2 | 3 | 4 = img.channels === 5 ? 4 : img.channels;
      if (img.channels >= 4) {
        rawU8 = new Uint8Array(img.data);
        outCh = 4;
      } else if (img.channels === 3) {
        rawU8 = new Uint8Array(img.width * img.height * 3);
        for (let i = 0; i < img.width * img.height; i++) {
          rawU8[i * 3] = img.data[i * 4]!;
          rawU8[i * 3 + 1] = img.data[i * 4 + 1]!;
          rawU8[i * 3 + 2] = img.data[i * 4 + 2]!;
        }
        outCh = 3;
      } else if (img.channels === 2) {
        rawU8 = new Uint8Array(img.width * img.height * 2);
        for (let i = 0; i < img.width * img.height; i++) {
          rawU8[i * 2] = img.data[i * 4]!;
          rawU8[i * 2 + 1] = img.data[i * 4 + 3]!;
        }
        outCh = 2;
      } else {
        rawU8 = new Uint8Array(img.width * img.height);
        for (let i = 0; i < img.width * img.height; i++) {
          rawU8[i] = img.data[i * 4]!;
        }
        outCh = 1;
      }
      const depth = options.rawDepth ?? "uchar";
      if (depth === "uchar") {
        return { data: rawU8, format: "raw", channels: outCh };
      }
      const is16Bit = img.space === "rgb16" || img.space === "grey16";
      const len = rawU8.length;
      let rawU16: Uint16Array | undefined;
      if (is16Bit && img.data16) {
        rawU16 = new Uint16Array(len);
        if (outCh === 4) {
          rawU16.set(img.data16.subarray(0, len));
        } else if (outCh === 3) {
          for (let i = 0; i < img.width * img.height; i++) {
            rawU16[i * 3] = img.data16[i * 4]!;
            rawU16[i * 3 + 1] = img.data16[i * 4 + 1]!;
            rawU16[i * 3 + 2] = img.data16[i * 4 + 2]!;
          }
        } else if (outCh === 2) {
          for (let i = 0; i < img.width * img.height; i++) {
            rawU16[i * 2] = img.data16[i * 4]!;
            rawU16[i * 2 + 1] = img.data16[i * 4 + 3]!;
          }
        } else {
          for (let i = 0; i < img.width * img.height; i++) {
            rawU16[i] = img.data16[i * 4]!;
          }
        }
      }
      const mapVal = (v: number, idx: number): number =>
        rawU16 ? rawU16[idx]! : is16Bit ? (v === 255 ? 65535 : v === 1 ? 511 : v * 256) : v;
      const ArrayType=depth==="char"?Int8Array:depth==="ushort"?Uint16Array:depth==="short"?Int16Array:
        depth==="uint"?Uint32Array:depth==="int"?Int32Array:depth==="float"?Float32Array:depth==="double"?Float64Array:undefined;
      if(ArrayType){
        const arr=new ArrayType(len);
        for(let i=0;i<len;i++)arr[i]=depth==="char"?Math.min(127,rawU8[i]!):depth==="short"?Math.min(32767,mapVal(rawU8[i]!,i)):mapVal(rawU8[i]!,i);
        return {data:new Uint8Array(arr.buffer),format:"raw",channels:outCh};
      }
      return { data: rawU8, format: "raw", channels: outCh };
    }
    default:
      throw new Error(`Unsupported output format: ${fmt}`);
  }
}
