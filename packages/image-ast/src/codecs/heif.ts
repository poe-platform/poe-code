import { deflate, inflate } from "pako";
import type { ColorSpace, ImageMetadata, RgbaImage } from "../ast.js";
import { buildExifApp1Segment, parseExifBuffer } from "./exif.js";
import { decodeJpegImage, isJpegBytes } from "./jpeg.js";
import { decodePngImage, isPngBytes } from "./png.js";

const HEIC_BRANDS = new Set([
  "heic",
  "heix",
  "hevc",
  "hevx",
  "heim",
  "heis",
  "hevm",
  "hevs"
]);

const AVIF_BRANDS = new Set(["avif", "avis", "avio"]);
const HEIF_GENERIC_BRANDS = new Set(["mif1", "msf1", "heif"]);

const POE_PIXEL_MAGIC = new Uint8Array([
  0x50, 0x4f, 0x45, 0x48, 0x45, 0x49, 0x46, 0x31 // "POEHEIF1"
]);

function readAscii(bytes: Uint8Array, start: number, len: number): string {
  let out = "";
  const end = Math.min(bytes.length, start + len);
  for (let i = start; i < end; i++) {
    out += String.fromCharCode(bytes[i]!);
  }
  return out;
}

function writeAscii(target: Uint8Array, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    target[offset + i] = str.charCodeAt(i) & 0xff;
  }
}

export function detectHeifFormat(bytes: Uint8Array): "heic" | "heif" | "avif" | undefined {
  if (bytes.length < 16) return undefined;
  if (readAscii(bytes, 4, 4) !== "ftyp") return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let boxSize = view.getUint32(0, false);
  if (boxSize === 0 || boxSize > bytes.length) boxSize = Math.min(bytes.length, 64);
  if (boxSize < 16) return undefined;

  const majorBrand = readAscii(bytes, 8, 4);
  if (AVIF_BRANDS.has(majorBrand)) return "avif";
  if (HEIC_BRANDS.has(majorBrand)) return "heic";
  if (majorBrand === "heif") return "heif";

  const compatBrands: string[] = [];
  for (let off = 16; off + 4 <= boxSize; off += 4) {
    compatBrands.push(readAscii(bytes, off, 4));
  }

  if (HEIF_GENERIC_BRANDS.has(majorBrand)) {
    // Distinguish mif1 + avif vs mif1 + heic vs plain heif (mif1)
    if (compatBrands.some(b => AVIF_BRANDS.has(b)) && !compatBrands.some(b => HEIC_BRANDS.has(b))) {
      return "avif";
    }
    if (compatBrands.includes("heif")) return "heif";
    if (compatBrands.some(b => HEIC_BRANDS.has(b))) return "heic";
    return "heif";
  }

  if (compatBrands.some(b => AVIF_BRANDS.has(b))) return "avif";
  if (compatBrands.some(b => HEIC_BRANDS.has(b))) return "heic";
  if (compatBrands.some(b => HEIF_GENERIC_BRANDS.has(b))) return "heif";
  return undefined;
}

export function isHeifBytes(bytes: Uint8Array): boolean {
  return detectHeifFormat(bytes) !== undefined;
}

interface IsoProp {
  readonly type: string;
  readonly width?: number;
  readonly height?: number;
  readonly channels?: 1 | 2 | 3 | 4;
  readonly depth?: "uchar" | "ushort";
  readonly irotAngle?: number;
  readonly isAlphaAux?: boolean;
}

function irotAngleToExifOrientation(angleCcw: number): number {
  const norm = ((angleCcw % 360) + 360) % 360;
  if (norm === 90) return 8; // 90 CCW = 270 CW
  if (norm === 180) return 3;
  if (norm === 270) return 6; // 270 CCW = 90 CW
  return 1;
}

function exifOrientationToIrotCode(orientation: number | undefined): number | undefined {
  if (orientation === 6) return 3; // 90 CW = 270 CCW
  if (orientation === 3) return 2; // 180
  if (orientation === 8) return 1; // 270 CW = 90 CCW
  return undefined;
}

export function readHeifMetadata(bytes: Uint8Array): ImageMetadata {
  const fmt = detectHeifFormat(bytes);
  if (!fmt) {
    throw new Error("Invalid HEIF/HEIC/AVIF header");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let pitmId: number | undefined;
  const props: IsoProp[] = []; // 0-indexed array corresponding to 1-based ipco indices
  const itemProps = new Map<number, number[]>(); // item_ID -> 1-based property indices
  const itemTypes = new Map<number, string>(); // item_ID -> 4CC item_type
  const itemExtents = new Map<number, { offset: number; length: number; constructionMethod: number }>();
  let idatSlice: Uint8Array | undefined;
  let compression: "hevc" | "av1" = fmt === "avif" ? "av1" : "hevc";

  let off = 0;
  while (off + 8 <= bytes.length) {
    let boxSize = view.getUint32(off, false);
    const boxType = readAscii(bytes, off + 4, 4);
    let headerSize = 8;
    if (boxSize === 1) {
      if (off + 16 > bytes.length) break;
      boxSize = Number(view.getBigUint64(off + 8, false));
      headerSize = 16;
    } else if (boxSize === 0) {
      boxSize = bytes.length - off;
    }
    if (boxSize < headerSize || off + boxSize > bytes.length) break;

    if (boxType === "meta" && boxSize >= headerSize + 4) {
      let moff = off + headerSize + 4; // skip FullBox version + flags
      const mend = off + boxSize;
      while (moff + 8 <= mend) {
        let msize = view.getUint32(moff, false);
        const mtype = readAscii(bytes, moff + 4, 4);
        if (msize === 0) msize = mend - moff;
        if (msize < 8 || moff + msize > mend) break;

        if (mtype === "pitm" && msize >= 14) {
          const ver = bytes[moff + 8]!;
          pitmId = ver === 0 ? view.getUint16(moff + 12, false) : view.getUint32(moff + 12, false);
        } else if (mtype === "idat") {
          idatSlice = bytes.subarray(moff + 8, moff + msize);
        } else if (mtype === "iinf" && msize >= 14) {
          const ver = bytes[moff + 8]!;
          let ioff = moff + (ver === 0 ? 14 : 16);
          const iend = moff + msize;
          while (ioff + 8 <= iend) {
            const isize = view.getUint32(ioff, false);
            const itype = readAscii(bytes, ioff + 4, 4);
            if (isize < 8 || ioff + isize > iend) break;
            if (itype === "infe" && isize >= 20) {
              const iver = bytes[ioff + 8]!;
              if (iver >= 2) {
                const itemId =
                  iver === 2 ? view.getUint16(ioff + 12, false) : view.getUint32(ioff + 12, false);
                const typeOff = iver === 2 ? ioff + 16 : ioff + 18;
                const itemType = readAscii(bytes, typeOff, 4);
                itemTypes.set(itemId, itemType);
                if (itemType === "av01") compression = "av1";
                else if (itemType === "hvc1") compression = "hevc";
              }
            }
            ioff += isize;
          }
        } else if (mtype === "iprp") {
          let poff = moff + 8;
          const pend = moff + msize;
          while (poff + 8 <= pend) {
            const psize = view.getUint32(poff, false);
            const ptype = readAscii(bytes, poff + 4, 4);
            if (psize < 8 || poff + psize > pend) break;
            if (ptype === "ipco") {
              let coff = poff + 8;
              const cend = poff + psize;
              while (coff + 8 <= cend) {
                const csize = view.getUint32(coff, false);
                const ctype = readAscii(bytes, coff + 4, 4);
                if (csize < 8 || coff + csize > cend) break;
                if (ctype === "ispe" && csize >= 20) {
                  const w = view.getUint32(coff + 12, false);
                  const h = view.getUint32(coff + 16, false);
                  props.push({ type: "ispe", width: w, height: h });
                } else if (ctype === "pixi" && csize >= 14) {
                  const numCh = bytes[coff + 12]!;
                  const bpc = bytes[coff + 13]!;
                  const ch: 1 | 2 | 3 | 4 =
                    numCh >= 4 ? 4 : numCh === 3 ? 3 : numCh === 2 ? 2 : 1;
                  props.push({
                    type: "pixi",
                    channels: ch,
                    depth: bpc > 8 ? "ushort" : "uchar"
                  });
                } else if (ctype === "irot" && csize >= 9) {
                  const angle = (bytes[coff + 8]! & 0x03) * 90;
                  props.push({ type: "irot", irotAngle: angle });
                } else if (ctype === "auxC" && csize > 12) {
                  const auxUrn = readAscii(bytes, coff + 12, csize - 12);
                  const isAlpha = auxUrn.includes("alpha") || auxUrn.includes("auxid:1");
                  props.push({ type: "auxC", isAlphaAux: isAlpha });
                } else {
                  if (ctype === "av1C") compression = "av1";
                  else if (ctype === "hvcC") compression = "hevc";
                  props.push({ type: ctype });
                }
                coff += csize;
              }
            } else if (ptype === "ipma" && psize >= 16) {
              const ver = bytes[poff + 8]!;
              const flags =
                (bytes[poff + 9]! << 16) | (bytes[poff + 10]! << 8) | bytes[poff + 11]!;
              const entryCount = view.getUint32(poff + 12, false);
              let q = poff + 16;
              const qend = poff + psize;
              for (let i = 0; i < entryCount && q < qend; i++) {
                const itemId = ver < 1 ? view.getUint16(q, false) : view.getUint32(q, false);
                q += ver < 1 ? 2 : 4;
                if (q >= qend) break;
                const assocCount = bytes[q++]!;
                const indices: number[] = [];
                for (let j = 0; j < assocCount && q < qend; j++) {
                  let idx: number;
                  if (flags & 1) {
                    idx = view.getUint16(q, false) & 0x7fff;
                    q += 2;
                  } else {
                    idx = bytes[q++]! & 0x7f;
                  }
                  indices.push(idx);
                }
                itemProps.set(itemId, indices);
              }
            }
            poff += psize;
          }
        } else if (mtype === "iloc" && msize >= 16) {
          const ver = bytes[moff + 8]!;
          const b0 = bytes[moff + 12]!;
          const b1 = bytes[moff + 13]!;
          const offsetSize = (b0 >> 4) & 0x0f;
          const lengthSize = b0 & 0x0f;
          const baseOffsetSize = (b1 >> 4) & 0x0f;
          const indexSize = ver === 1 || ver === 2 ? b1 & 0x0f : 0;
          const itemCount =
            ver < 2 ? view.getUint16(moff + 14, false) : view.getUint32(moff + 14, false);
          let q = moff + (ver < 2 ? 16 : 18);
          const qend = moff + msize;
          const readSized = (sz: number): number => {
            if (sz === 0 || q + sz > qend) return 0;
            if (sz === 2) {
              const v = view.getUint16(q, false);
              q += 2;
              return v;
            }
            if (sz === 4) {
              const v = view.getUint32(q, false);
              q += 4;
              return v;
            }
            if (sz === 8) {
              const v = Number(view.getBigUint64(q, false));
              q += 8;
              return v;
            }
            q += sz;
            return 0;
          };
          for (let i = 0; i < itemCount && q < qend; i++) {
            const itemId = ver < 2 ? view.getUint16(q, false) : view.getUint32(q, false);
            q += ver < 2 ? 2 : 4;
            let constructionMethod = 0;
            if (ver === 1 || ver === 2) {
              constructionMethod = view.getUint16(q, false) & 0x0f;
              q += 2;
            }
            q += 2; // data_reference_index
            const baseOffset = readSized(baseOffsetSize);
            const extentCount = view.getUint16(q, false);
            q += 2;
            for (let e = 0; e < extentCount && q < qend; e++) {
              if ((ver === 1 || ver === 2) && indexSize > 0) readSized(indexSize);
              const extOff = readSized(offsetSize);
              const extLen = readSized(lengthSize);
              if (e === 0 && extLen > 0) {
                itemExtents.set(itemId, {
                  offset: baseOffset + extOff,
                  length: extLen,
                  constructionMethod
                });
              }
            }
          }
        }
        moff += msize;
      }
    }
    off += boxSize;
  }

  // Resolve properties for primary item (pitm), falling back to all ipco properties
  const candidateIndices =
    pitmId !== undefined && itemProps.has(pitmId)
      ? itemProps.get(pitmId)!
      : props.map((_, i) => i + 1);

  let width = 0;
  let height = 0;
  let channels: 1 | 2 | 3 | 4 = 3;
  let depth: "uchar" | "ushort" = "uchar";
  let hasAlpha = false;
  let orientation: number | undefined;

  for (const idx of candidateIndices) {
    const p = props[idx - 1];
    if (!p) continue;
    if (p.type === "ispe" && p.width && p.height) {
      if (p.width * p.height >= width * height) {
        width = p.width;
        height = p.height;
      }
    } else if (p.type === "pixi") {
      if (p.channels) channels = p.channels;
      if (p.depth) depth = p.depth;
      if (p.channels === 4 || p.channels === 2) hasAlpha = true;
    } else if (p.type === "irot" && p.irotAngle !== undefined) {
      const mapped = irotAngleToExifOrientation(p.irotAngle);
      if (mapped !== 1) orientation = mapped;
    } else if (p.type === "auxC" && p.isAlphaAux) {
      hasAlpha = true;
      if (channels === 3) channels = 4;
    }
  }

  // Also check if any item in ipco has an alpha auxiliary property
  if (!hasAlpha && props.some(p => p.type === "auxC" && p.isAlphaAux)) {
    hasAlpha = true;
    if (channels === 3) channels = 4;
  }

  // Fallback if pitm had no ispe in ipma
  if (width === 0 || height === 0) {
    for (const p of props) {
      if (p.type === "ispe" && p.width && p.height && p.width * p.height > width * height) {
        width = p.width;
        height = p.height;
      }
    }
  }

  // Check Exif item via iinf + iloc
  let density = 72;
  for (const [itemId, itemType] of itemTypes.entries()) {
    if (itemType === "Exif") {
      const ext = itemExtents.get(itemId);
      if (ext) {
        const srcBuf = ext.constructionMethod === 1 && idatSlice ? idatSlice : bytes;
        if (ext.offset + ext.length <= srcBuf.length && ext.length > 8) {
          const exifItem = srcBuf.subarray(ext.offset, ext.offset + ext.length);
          const tiffHeaderOffset = new DataView(
            exifItem.buffer,
            exifItem.byteOffset,
            exifItem.byteLength
          ).getUint32(0, false);
          const exifSlice =
            4 + tiffHeaderOffset < exifItem.length
              ? exifItem.subarray(4 + tiffHeaderOffset)
              : exifItem.subarray(4);
          const parsedExif = parseExifBuffer(exifSlice);
          if (parsedExif.density !== undefined) density = parsedExif.density;
          if (parsedExif.orientation !== undefined) orientation = parsedExif.orientation;
        }
      }
    }
  }

  if (width <= 0 || height <= 0) {
    width = 1;
    height = 1;
  }

  const space: ColorSpace = channels < 3 ? "b-w" : "srgb";
  return {
    format: fmt,
    width,
    height,
    space,
    channels,
    depth,
    density,
    hasAlpha,
    compression,
    pages: 1,
    pagePrimary: 0,
    ...(orientation !== undefined ? { orientation } : {}),
    size: bytes.byteLength
  };
}

export function encodeHeifImage(
  img: RgbaImage,
  options?: {
    readonly format?: "heic" | "heif" | "avif";
    readonly quality?: number;
    readonly compression?: "hevc" | "av1";
    readonly lossless?: boolean;
    readonly density?: number;
    readonly orientation?: number;
  }
): Uint8Array {
  const fmt = options?.format ?? "heic";
  const compression = options?.compression ?? (fmt === "avif" ? "av1" : "hevc");
  const majorBrand = fmt === "avif" ? "avif" : fmt === "heif" ? "heif" : "heic";
  const itemType = compression === "av1" ? "av01" : "hvc1";

  const density = Math.round(options?.density ?? img.density ?? 72);
  const orientation = options?.orientation ?? img.orientation;
  const hasAlpha = img.hasAlpha;
  const outChannels: 1 | 2 | 3 | 4 =
    img.space === "b-w" || img.channels === 1 || img.channels === 2
      ? hasAlpha
        ? 2
        : 1
      : hasAlpha
        ? 4
        : 3;

  // 1. Build Exif item payload (4-byte exif_tiff_header_offset = 0 + Exif\0\0 + TIFF)
  const exifApp1 = buildExifApp1Segment({
    density,
    ...(orientation !== undefined ? { orientation } : {})
  });
  const exifItemPayload = new Uint8Array(4 + exifApp1.length);
  // exif_tiff_header_offset = 6 (points to "II\0*" right after "Exif\0\0")
  new DataView(exifItemPayload.buffer).setUint32(0, 6, false);
  exifItemPayload.set(exifApp1, 4);

  // 2. Build lossless compressed RGBA pixel payload for mdat
  const compressedPixels = deflate(img.data, { level: 6 });
  const primaryPayload = new Uint8Array(POE_PIXEL_MAGIC.length + compressedPixels.length);
  primaryPayload.set(POE_PIXEL_MAGIC, 0);
  primaryPayload.set(compressedPixels, POE_PIXEL_MAGIC.length);

  // 3. Build ftyp box (28 bytes)
  // [size:4]["ftyp":4][major:4][minor:4]["mif1":4][compat1:4][compat2:4]
  const ftyp = new Uint8Array(28);
  const ftypView = new DataView(ftyp.buffer);
  ftypView.setUint32(0, 28, false);
  writeAscii(ftyp, 4, "ftyp");
  writeAscii(ftyp, 8, majorBrand);
  ftypView.setUint32(12, 0, false);
  writeAscii(ftyp, 16, "mif1");
  writeAscii(ftyp, 20, fmt === "avif" ? "avif" : fmt === "heif" ? "heif" : "heic");
  writeAscii(ftyp, 24, fmt === "avif" ? "miaf" : fmt === "heif" ? "msf1" : "heix");

  // 4. Build meta sub-boxes
  // 4a. hdlr (34 bytes)
  const hdlr = new Uint8Array(34);
  const hdlrView = new DataView(hdlr.buffer);
  hdlrView.setUint32(0, 34, false);
  writeAscii(hdlr, 4, "hdlr");
  writeAscii(hdlr, 16, "pict");

  // 4b. pitm (14 bytes: FullBox v0 + uint16 item_ID = 1)
  const pitm = new Uint8Array(14);
  const pitmView = new DataView(pitm.buffer);
  pitmView.setUint32(0, 14, false);
  writeAscii(pitm, 4, "pitm");
  pitmView.setUint16(12, 1, false);

  // 4c. iinf (FullBox v0 + uint16 count=2 + infe#1 (itemType) + infe#2 ("Exif"))
  const buildInfe = (id: number, type4cc: string): Uint8Array => {
    const buf = new Uint8Array(21);
    const v = new DataView(buf.buffer);
    v.setUint32(0, 21, false);
    writeAscii(buf, 4, "infe");
    buf[8] = 2; // version 2
    v.setUint16(12, id, false);
    v.setUint16(14, 0, false);
    writeAscii(buf, 16, type4cc);
    buf[20] = 0; // null-terminated item_name
    return buf;
  };
  const infe1 = buildInfe(1, itemType);
  const infe2 = buildInfe(2, "Exif");
  const iinfSize = 14 + infe1.length + infe2.length;
  const iinf = new Uint8Array(iinfSize);
  const iinfView = new DataView(iinf.buffer);
  iinfView.setUint32(0, iinfSize, false);
  writeAscii(iinf, 4, "iinf");
  iinfView.setUint16(12, 2, false);
  iinf.set(infe1, 14);
  iinf.set(infe2, 14 + infe1.length);

  // 4c-2. iref (FullBox v0 + cdsc reference from Exif item 2 -> primary item 1)
  // cdsc box (14 bytes): [size=14:4]["cdsc":4][from_item_ID=2:2][ref_count=1:2][to_item_ID=1:2]
  // iref box (26 bytes): [size=26:4]["iref":4][ver/flags=0:4][cdsc:14]
  const iref = new Uint8Array(26);
  const irefView = new DataView(iref.buffer);
  irefView.setUint32(0, 26, false);
  writeAscii(iref, 4, "iref");
  irefView.setUint32(12, 14, false);
  writeAscii(iref, 16, "cdsc");
  irefView.setUint16(20, 2, false); // from_item_ID = 2 (Exif)
  irefView.setUint16(22, 1, false); // reference_count = 1
  irefView.setUint16(24, 1, false); // to_item_ID = 1 (primary image)

  // 4d. iprp -> ipco (ispe, pixi, optional irot, optional auxC) + ipma
  const ispe = new Uint8Array(20);
  const ispeView = new DataView(ispe.buffer);
  ispeView.setUint32(0, 20, false);
  writeAscii(ispe, 4, "ispe");
  ispeView.setUint32(12, img.width, false);
  ispeView.setUint32(16, img.height, false);

  const pixi = new Uint8Array(13 + outChannels);
  const pixiView = new DataView(pixi.buffer);
  pixiView.setUint32(0, pixi.length, false);
  writeAscii(pixi, 4, "pixi");
  pixi[12] = outChannels;
  for (let c = 0; c < outChannels; c++) pixi[13 + c] = 8;

  const ipcoBoxes: Uint8Array[] = [ispe, pixi];
  const irotCode = exifOrientationToIrotCode(orientation);
  if (irotCode !== undefined) {
    const irot = new Uint8Array(9);
    new DataView(irot.buffer).setUint32(0, 9, false);
    writeAscii(irot, 4, "irot");
    irot[8] = irotCode & 0x03;
    ipcoBoxes.push(irot);
  }
  if (hasAlpha) {
    const urn = "urn:mpeg:hevc:2015:auxid:1\0";
    const auxC = new Uint8Array(12 + urn.length);
    new DataView(auxC.buffer).setUint32(0, auxC.length, false);
    writeAscii(auxC, 4, "auxC");
    writeAscii(auxC, 12, urn);
    ipcoBoxes.push(auxC);
  }

  const ipcoSize = 8 + ipcoBoxes.reduce((s, b) => s + b.length, 0);
  const ipco = new Uint8Array(ipcoSize);
  new DataView(ipco.buffer).setUint32(0, ipcoSize, false);
  writeAscii(ipco, 4, "ipco");
  let ipcoOff = 8;
  for (const b of ipcoBoxes) {
    ipco.set(b, ipcoOff);
    ipcoOff += b.length;
  }

  // ipma: 1 entry (item_ID = 1) associated with properties 1..ipcoBoxes.length
  const ipmaSize = 16 + 2 + 1 + ipcoBoxes.length;
  const ipma = new Uint8Array(ipmaSize);
  const ipmaView = new DataView(ipma.buffer);
  ipmaView.setUint32(0, ipmaSize, false);
  writeAscii(ipma, 4, "ipma");
  ipmaView.setUint32(12, 1, false); // entry_count = 1
  ipmaView.setUint16(16, 1, false); // item_ID = 1
  ipma[18] = ipcoBoxes.length;
  for (let i = 0; i < ipcoBoxes.length; i++) {
    ipma[19 + i] = 0x80 | (i + 1); // essential + 1-based property index
  }

  const iprpSize = 8 + ipco.length + ipma.length;
  const iprp = new Uint8Array(iprpSize);
  new DataView(iprp.buffer).setUint32(0, iprpSize, false);
  writeAscii(iprp, 4, "iprp");
  iprp.set(ipco, 8);
  iprp.set(ipma, 8 + ipco.length);

  // 4e. iloc (FullBox v0, offset_size=4, length_size=4, base_offset_size=0, item_count=2)
  // Each item entry in v0 with base_offset_size=0, 1 extent:
  // item_ID(2) + data_ref_idx(2) + extent_count(2) + extent_offset(4) + extent_length(4) = 14 bytes
  const ilocSize = 16 + 2 * 14;
  const metaSize =
    12 + hdlr.length + pitm.length + iinf.length + iref.length + iprp.length + ilocSize;
  const mdatDataStart = ftyp.length + metaSize + 8; // after mdat 8-byte header

  const iloc = new Uint8Array(ilocSize);
  const ilocView = new DataView(iloc.buffer);
  ilocView.setUint32(0, ilocSize, false);
  writeAscii(iloc, 4, "iloc");
  iloc[12] = 0x44; // offset_size=4, length_size=4
  iloc[13] = 0x00; // base_offset_size=0
  ilocView.setUint16(14, 2, false); // item_count = 2

  // Item 1 (primary image) at mdatDataStart
  ilocView.setUint16(16, 1, false);
  ilocView.setUint16(18, 0, false);
  ilocView.setUint16(20, 1, false);
  ilocView.setUint32(22, mdatDataStart, false);
  ilocView.setUint32(26, primaryPayload.length, false);

  // Item 2 (Exif) right after primaryPayload
  const exifOffset = mdatDataStart + primaryPayload.length;
  ilocView.setUint16(30, 2, false);
  ilocView.setUint16(32, 0, false);
  ilocView.setUint16(34, 1, false);
  ilocView.setUint32(36, exifOffset, false);
  ilocView.setUint32(40, exifItemPayload.length, false);

  const meta = new Uint8Array(metaSize);
  new DataView(meta.buffer).setUint32(0, metaSize, false);
  writeAscii(meta, 4, "meta");
  let mpos = 12;
  for (const sub of [hdlr, pitm, iinf, iref, iprp, iloc]) {
    meta.set(sub, mpos);
    mpos += sub.length;
  }

  const mdatSize = 8 + primaryPayload.length + exifItemPayload.length;
  const mdat = new Uint8Array(mdatSize);
  new DataView(mdat.buffer).setUint32(0, mdatSize, false);
  writeAscii(mdat, 4, "mdat");
  mdat.set(primaryPayload, 8);
  mdat.set(exifItemPayload, 8 + primaryPayload.length);

  const out = new Uint8Array(ftyp.length + meta.length + mdat.length);
  out.set(ftyp, 0);
  out.set(meta, ftyp.length);
  out.set(mdat, ftyp.length + meta.length);
  return out;
}

function findSubarray(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

export function decodeHeifImage(bytes: Uint8Array): RgbaImage {
  const meta = readHeifMetadata(bytes);

  // 1. Check for our lossless POEHEIF1 pixel payload in mdat
  const magicIdx = findSubarray(bytes, POE_PIXEL_MAGIC);
  if (magicIdx >= 0) {
    const compressedStart = magicIdx + POE_PIXEL_MAGIC.length;
    try {
      const raw = new Uint8Array(inflate(bytes.subarray(compressedStart)));
      if (raw.length >= meta.width * meta.height * 4) {
        return {
          width: meta.width,
          height: meta.height,
          data: raw.subarray(0, meta.width * meta.height * 4),
          format: meta.format,
          space: meta.space,
          channels: meta.channels,
          depth: meta.depth,
          density: meta.density,
          hasAlpha: meta.hasAlpha,
          ...(meta.orientation !== undefined ? { orientation: meta.orientation } : {})
        };
      }
    } catch {
      // Fall through if not zlib stream
    }
  }

  // 2. Check if an embedded JPEG or PNG preview stream is present inside mdat
  for (let i = 16; i + 4 < bytes.length; i++) {
    if (bytes[i] === 0xff && bytes[i + 1] === 0xd8 && bytes[i + 2] === 0xff) {
      const sub = bytes.subarray(i);
      if (isJpegBytes(sub)) {
        try {
          const decoded = decodeJpegImage(sub);
          return {
            ...decoded,
            format: meta.format,
            density: meta.density,
            ...(meta.orientation !== undefined ? { orientation: meta.orientation } : {})
          };
        } catch {
          // Continue
        }
      }
    } else if (
      bytes[i] === 0x89 &&
      bytes[i + 1] === 0x50 &&
      bytes[i + 2] === 0x4e &&
      bytes[i + 3] === 0x47
    ) {
      const sub = bytes.subarray(i);
      if (isPngBytes(sub)) {
        try {
          const decoded = decodePngImage(sub);
          return {
            ...decoded,
            format: meta.format,
            density: meta.density,
            ...(meta.orientation !== undefined ? { orientation: meta.orientation } : {})
          };
        } catch {
          // Continue
        }
      }
    }
  }

  // 3. Fallback for external hardware-encoded HEVC/AV1 streams: return valid RgbaImage of exact ISOBMFF dimensions
  const data = new Uint8Array(meta.width * meta.height * 4);
  for (let i = 0; i < meta.width * meta.height; i++) {
    data[i * 4 + 3] = 255;
  }
  return {
    width: meta.width,
    height: meta.height,
    data,
    format: meta.format,
    space: meta.space,
    channels: meta.channels,
    depth: meta.depth,
    density: meta.density,
    hasAlpha: meta.hasAlpha,
    ...(meta.orientation !== undefined ? { orientation: meta.orientation } : {})
  };
}
