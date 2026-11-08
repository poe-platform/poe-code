import { decodeCcittFax } from "./ccitt.js";
export { decodeCcittFax } from "./ccitt.js";
import { createByteCodec, transformBytes, ByteCodecError } from "@poe-code/compression";
import { FlateStream, Stream } from "../vendor/pdfjs-fonts.mjs";
import { dictGet, type PdfCosDict, type PdfCosNode, type PdfCosStream } from "../ast.js";
import { PdfError } from "../errors.js";

export interface PdfFilterDecodeParms {
  readonly Predictor?: number | undefined;
  readonly Columns?: number | undefined;
  readonly Colors?: number | undefined;
  readonly BitsPerComponent?: number | undefined;
  readonly EarlyChange?: number | undefined;
  readonly K?: number | undefined;
  readonly Rows?: number | undefined;
  readonly BlackIs1?: boolean | undefined;
  readonly EncodedByteAlign?: boolean | undefined;
}

const DEFAULT_MAX_DECODED_BYTES = Infinity;

export function encodeFlate(bytes: Uint8Array): Uint8Array {
  return transformBytes(bytes, { direction: "encode", format: "zlib" });
}

// Keep PDF.js recovery while checking the budget before any output-buffer growth.
class BoundedFlateStream extends FlateStream {
  constructor(bytes: Uint8Array, private readonly maxDecodedBytes: number) {
    super(new Stream(bytes));
  }

  override ensureBuffer(requested: number): Uint8Array {
    if (requested > this.maxDecodedBytes) {
      throw new PdfError("E_LIMIT", "FlateDecode output exceeds maximum decoded byte budget");
    }
    if (requested <= this.buffer.byteLength) return this.buffer;
    let size = this.minBufferLength;
    while (size < requested) size *= 2;
    const prev = this.buffer;
    const buffer = new Uint8Array(Math.min(size, this.maxDecodedBytes));
    buffer.set(prev);
    // PDF.js shares the initial empty buffer across all decoder instances.
    if (prev.byteLength > 0 && prev.byteOffset === 0 && typeof (prev.buffer as unknown as { transfer?: (n: number) => ArrayBuffer }).transfer === "function") {
      try { (prev.buffer as unknown as { transfer: (n: number) => ArrayBuffer }).transfer(0); } catch { /* Detachment is best effort for host buffers. */ }
    }
    return (this.buffer = buffer);
  }
}

export function decodeFlate(
  bytes: Uint8Array,
  parms?: PdfFilterDecodeParms,
  maxDecodedBytes = DEFAULT_MAX_DECODED_BYTES
): Uint8Array {
  let inflated: Uint8Array;
  try {
    inflated = new BoundedFlateStream(bytes, maxDecodedBytes).getBytes();
  } catch (error) {
    if (error instanceof PdfError && error.code === "E_LIMIT") throw error;
    // Like pypdf, retain useful output when a wrapped stream ends prematurely.
    // Keep raw-DEFLATE compatibility and reject malformed data/header errors.
    const wrapped = (bytes[0] === 0x1f && bytes[1] === 0x8b) ||
      (bytes.length >= 2 && (bytes[0]! & 15) === 8 && (bytes[0]! >>> 4) <= 7 &&
        ((bytes[0]! << 8) | bytes[1]!) % 31 === 0);
    const decoder = createByteCodec({
      direction: "decode",
      format: wrapped ? "zlib-or-gzip" : "raw",
      chunkSize: Math.max(1, Math.min(64 * 1024, maxDecodedBytes + 1)),
    });
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      for (const chunk of decoder.push(bytes, true)) {
        length += chunk.length;
        if (length > maxDecodedBytes) {
          throw new PdfError("E_LIMIT", "FlateDecode output exceeds maximum decoded byte budget");
        }
        chunks.push(chunk);
      }
    } catch (error) {
      if (error instanceof PdfError) throw error;
      if (!(wrapped && error instanceof ByteCodecError && error.code === "truncated" && length > 0)) {
        throw new PdfError("E_CAPABILITY", "Invalid FlateDecode compressed stream");
      }
    } finally { decoder.close(); }
    inflated = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      inflated.set(chunk, offset);
      offset += chunk.length;
    }
  }
  return applyPredictor(inflated, parms);
}

export function applyPredictor(bytes: Uint8Array, parms?: PdfFilterDecodeParms): Uint8Array {
  const predictor = parms?.Predictor ?? 1;
  if (predictor <= 1) return bytes;

  const colors = parms?.Colors ?? 1;
  const bits = parms?.BitsPerComponent ?? 8;
  const columns = parms?.Columns ?? 1;
  if (colors < 1 || ![1, 2, 4, 8, 16].includes(bits) || columns < 1) {
    throw new PdfError("E_CAPABILITY", "Invalid PDF stream predictor parameters");
  }

  const bytesPerPixel = Math.max(1, Math.ceil((colors * bits) / 8));
  const rowBytes = Math.ceil((columns * colors * bits) / 8);

  if (predictor === 2) {
    const rows = Math.floor(bytes.length / rowBytes);
    const out = new Uint8Array(bytes.subarray(0, rows * rowBytes));
    for (let r = 0; r < rows; r++) {
      const base = r * rowBytes;
      if (bits === 8) {
        for (let i = bytesPerPixel; i < rowBytes; i++) {
          out[base + i] = (out[base + i]! + out[base + i - bytesPerPixel]!) & 0xff;
        }
      } else if (bits === 16) {
        for (let i = bytesPerPixel; i + 1 < rowBytes; i += 2) {
          const cur = (out[base + i]! << 8) | out[base + i + 1]!;
          const prev = (out[base + i - bytesPerPixel]! << 8) | out[base + i - bytesPerPixel + 1]!;
          const sum = (cur + prev) & 0xffff;
          out[base + i] = (sum >>> 8) & 0xff;
          out[base + i + 1] = sum & 0xff;
        }
      } else if (bits === 1 || bits === 2 || bits === 4) {
        const totalSamples = columns * colors;
        const mask = (1 << bits) - 1;
        const samples = new Uint8Array(totalSamples);
        for (let s = 0; s < totalSamples; s++) {
          const bitOffset = s * bits;
          const byteIdx = base + (bitOffset >>> 3);
          const shift = 8 - bits - (bitOffset & 7);
          samples[s] = ((out[byteIdx] ?? 0) >>> shift) & mask;
        }
        for (let s = colors; s < totalSamples; s++) {
          samples[s] = (samples[s]! + samples[s - colors]!) & mask;
        }
        out.fill(0, base, base + rowBytes);
        for (let s = 0; s < totalSamples; s++) {
          const bitOffset = s * bits;
          const byteIdx = base + (bitOffset >>> 3);
          const shift = 8 - bits - (bitOffset & 7);
          out[byteIdx] = (out[byteIdx] ?? 0) | ((samples[s]! & mask) << shift);
        }
      }
    }
    return out;
  }

  if (predictor >= 10 && predictor <= 15) {
    const stride = rowBytes + 1;
    const rows = Math.floor(bytes.length / stride);
    const out = new Uint8Array(rows * rowBytes);
    for (let r = 0; r < rows; r++) {
      const srcBase = r * stride;
      const dstBase = r * rowBytes;
      const filter = bytes[srcBase]!;
      if (filter > 4) {
        throw new PdfError("E_CAPABILITY", `Invalid PNG row predictor type: ${filter}`);
      }
      for (let i = 0; i < rowBytes; i++) {
        const raw = bytes[srcBase + 1 + i]!;
        const left = i >= bytesPerPixel ? out[dstBase + i - bytesPerPixel]! : 0;
        const up = r > 0 ? out[dstBase - rowBytes + i]! : 0;
        const upLeft = r > 0 && i >= bytesPerPixel ? out[dstBase - rowBytes + i - bytesPerPixel]! : 0;
        let pred = 0;
        if (filter === 1) pred = left;
        else if (filter === 2) pred = up;
        else if (filter === 3) pred = (left + up) >>> 1;
        else if (filter === 4) {
          const p = left + up - upLeft;
          const pa = Math.abs(p - left);
          const pb = Math.abs(p - up);
          const pc = Math.abs(p - upLeft);
          pred = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
        }
        out[dstBase + i] = (raw + pred) & 0xff;
      }
    }
    return out;
  }

  throw new PdfError("E_CAPABILITY", `Unsupported PDF predictor: ${predictor}`);
}

export function encodeAsciiHex(bytes: Uint8Array): Uint8Array {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i]!.toString(16).padStart(2, "0").toUpperCase();
  }
  out += ">";
  return new TextEncoder().encode(out);
}

export function decodeAsciiHex(bytes: Uint8Array): Uint8Array {
  const nibbles: number[] = [];
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!;
    if (b === 0x3e) break;
    if (b === 0x00 || b === 0x09 || b === 0x0a || b === 0x0c || b === 0x0d || b === 0x20) continue;
    const v =
      b >= 0x30 && b <= 0x39
        ? b - 0x30
        : b >= 0x41 && b <= 0x46
          ? b - 0x41 + 10
          : b >= 0x61 && b <= 0x66
            ? b - 0x61 + 10
            : -1;
    if (v < 0) throw new PdfError("E_CAPABILITY", "Invalid byte in ASCIIHexDecode stream");
    nibbles.push(v);
  }
  if (nibbles.length % 2 === 1) nibbles.push(0);
  const out = new Uint8Array(nibbles.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = (nibbles[i * 2]! << 4) | nibbles[i * 2 + 1]!;
  }
  return out;
}

export function encodeAscii85(bytes: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i + 4 <= bytes.length) {
    const val =
      ((bytes[i]! << 24) >>> 0) +
      ((bytes[i + 1]! << 16) >>> 0) +
      ((bytes[i + 2]! << 8) >>> 0) +
      (bytes[i + 3]! >>> 0);
    if (val === 0) {
      out.push(0x7a);
    } else {
      let rem = val;
      const digits = [0, 0, 0, 0, 0];
      for (let d = 4; d >= 0; d--) {
        digits[d] = (rem % 85) + 33;
        rem = Math.floor(rem / 85);
      }
      out.push(...digits);
    }
    i += 4;
  }
  const remCount = bytes.length - i;
  if (remCount > 0) {
    let val = 0;
    for (let j = 0; j < 4; j++) {
      val = val * 256 + (j < remCount ? bytes[i + j]! : 0);
    }
    const digits = [0, 0, 0, 0, 0];
    for (let d = 4; d >= 0; d--) {
      digits[d] = (val % 85) + 33;
      val = Math.floor(val / 85);
    }
    for (let j = 0; j < remCount + 1; j++) {
      out.push(digits[j]!);
    }
  }
  out.push(0x7e, 0x3e);
  return Uint8Array.from(out);
}

export function decodeAscii85(bytes: Uint8Array): Uint8Array {
  const out: number[] = [];
  const group: number[] = [];
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!;
    if (b === 0x7e) break;
    if (b === 0x00 || b === 0x09 || b === 0x0a || b === 0x0c || b === 0x0d || b === 0x20) continue;
    if (b === 0x7a) {
      if (group.length !== 0) throw new PdfError("E_CAPABILITY", "Invalid 'z' inside ASCII85 group");
      out.push(0, 0, 0, 0);
      continue;
    }
    if (b < 33 || b > 117) throw new PdfError("E_CAPABILITY", "Invalid ASCII85 character");
    group.push(b - 33);
    if (group.length === 5) {
      let val = 0;
      for (const d of group) val = val * 85 + d;
      out.push((val >>> 24) & 0xff, (val >>> 16) & 0xff, (val >>> 8) & 0xff, val & 0xff);
      group.length = 0;
    }
  }
  if (group.length === 1) throw new PdfError("E_CAPABILITY", "Invalid trailing ASCII85 group");
  if (group.length > 1) {
    const count = group.length - 1;
    while (group.length < 5) group.push(84);
    let val = 0;
    for (const d of group) val = val * 85 + d;
    const bytes4 = [(val >>> 24) & 0xff, (val >>> 16) & 0xff, (val >>> 8) & 0xff, val & 0xff];
    for (let j = 0; j < count; j++) out.push(bytes4[j]!);
  }
  return Uint8Array.from(out);
}

export function encodeRunLength(bytes: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < bytes.length) {
    let runLen = 1;
    while (i + runLen < bytes.length && bytes[i + runLen] === bytes[i] && runLen < 128) {
      runLen++;
    }
    if (runLen > 1) {
      out.push(257 - runLen, bytes[i]!);
      i += runLen;
    } else {
      const start = i;
      let litLen = 0;
      while (i < bytes.length && litLen < 128) {
        if (i + 2 < bytes.length && bytes[i] === bytes[i + 1] && bytes[i] === bytes[i + 2]) break;
        i++;
        litLen++;
      }
      out.push(litLen - 1);
      for (let j = 0; j < litLen; j++) out.push(bytes[start + j]!);
    }
  }
  out.push(128);
  return Uint8Array.from(out);
}

export function decodeRunLength(bytes: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < bytes.length) {
    const len = bytes[i++]!;
    if (len === 128) break;
    if (len < 128) {
      const count = len + 1;
      for (let j = 0; j < count && i < bytes.length; j++) {
        out.push(bytes[i++]!);
      }
    } else {
      const count = 257 - len;
      const val = bytes[i++] ?? 0;
      for (let j = 0; j < count; j++) out.push(val);
    }
  }
  return Uint8Array.from(out);
}

export function encodeLzw(bytes: Uint8Array): Uint8Array {
  const CLEAR_CODE = 256;
  const EOD_CODE = 257;
  let dict = new Map<string, number>();
  let nextCode = 258;
  let codeSize = 9;

  const resetDict = () => {
    dict = new Map();
    for (let i = 0; i < 256; i++) dict.set(String.fromCharCode(i), i);
    nextCode = 258;
    codeSize = 9;
  };

  const out: number[] = [];
  let bitBuf = 0;
  let bitCount = 0;
  const writeCode = (code: number, bits: number) => {
    bitBuf = (bitBuf << bits) | code;
    bitCount += bits;
    while (bitCount >= 8) {
      bitCount -= 8;
      out.push((bitBuf >>> bitCount) & 0xff);
    }
  };

  resetDict();
  writeCode(CLEAR_CODE, codeSize);

  if (bytes.length > 0) {
    let w = String.fromCharCode(bytes[0]!);
    for (let i = 1; i < bytes.length; i++) {
      const c = String.fromCharCode(bytes[i]!);
      const wc = w + c;
      if (dict.has(wc)) {
        w = wc;
      } else {
        writeCode(dict.get(w)!, codeSize);
        dict.set(wc, nextCode++);
        if (nextCode === 512 || nextCode === 1024 || nextCode === 2048) {
          codeSize++;
        } else if (nextCode >= 4095) {
          writeCode(CLEAR_CODE, codeSize);
          resetDict();
        }
        w = c;
      }
    }
    writeCode(dict.get(w)!, codeSize);
  }
  writeCode(EOD_CODE, codeSize);
  if (bitCount > 0) {
    out.push((bitBuf << (8 - bitCount)) & 0xff);
  }
  return Uint8Array.from(out);
}

export function decodeLzw(bytes: Uint8Array, parms?: PdfFilterDecodeParms): Uint8Array {
  const earlyChange = parms?.EarlyChange ?? 1;
  const CLEAR_CODE = 256;
  const EOD_CODE = 257;
  let table: Uint8Array[] = [];
  let codeSize = 9;
  let prev: Uint8Array | undefined;

  const resetTable = () => {
    table = [];
    for (let i = 0; i < 256; i++) table[i] = Uint8Array.from([i]);
    table[CLEAR_CODE] = new Uint8Array(0);
    table[EOD_CODE] = new Uint8Array(0);
    codeSize = 9;
    prev = undefined;
  };
  resetTable();

  let bitPos = 0;
  const readCode = (): number | undefined => {
    if (bitPos + codeSize > bytes.length * 8) return undefined;
    let code = 0;
    for (let i = 0; i < codeSize; i++) {
      const byteIdx = (bitPos + i) >>> 3;
      const bitIdx = 7 - ((bitPos + i) & 7);
      const bit = (bytes[byteIdx]! >>> bitIdx) & 1;
      code = (code << 1) | bit;
    }
    bitPos += codeSize;
    return code;
  };

  const chunks: Uint8Array[] = [];
  while (true) {
    const code = readCode();
    if (code === undefined || code === EOD_CODE) break;
    if (code === CLEAR_CODE) {
      resetTable();
      continue;
    }
    let entry: Uint8Array;
    if (code < table.length) {
      entry = table[code]!;
    } else if (code === table.length && prev !== undefined) {
      entry = new Uint8Array(prev.length + 1);
      entry.set(prev, 0);
      entry[prev.length] = prev[0]!;
    } else {
      throw new PdfError("E_CAPABILITY", "Invalid LZW code in stream");
    }
    chunks.push(entry);
    if (prev !== undefined && table.length < 4096) {
      const combined = new Uint8Array(prev.length + 1);
      combined.set(prev, 0);
      combined[prev.length] = entry[0]!;
      table.push(combined);
      const threshold = (1 << codeSize) - earlyChange;
      if (table.length === threshold && codeSize < 12) {
        codeSize++;
      }
    }
    prev = entry;
  }

  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return applyPredictor(out, parms);
}

export function decodePdfFilter(
  filterName: string,
  bytes: Uint8Array,
  parms?: PdfFilterDecodeParms,
  maxDecodedBytes = DEFAULT_MAX_DECODED_BYTES
): Uint8Array {
  switch (filterName) {
    case "FlateDecode":
    case "Fl":
      return decodeFlate(bytes, parms, maxDecodedBytes);
    case "LZWDecode":
    case "LZW":
      return decodeLzw(bytes, parms);
    case "ASCIIHexDecode":
    case "AHx":
      return decodeAsciiHex(bytes);
    case "ASCII85Decode":
    case "A85":
      return decodeAscii85(bytes);
    case "RunLengthDecode":
    case "RL":
      return decodeRunLength(bytes);
    case "CCITTFaxDecode":
    case "CCF":
      return decodeCcittFax(bytes, parms);
    case "DCTDecode":
    case "DCT":
    case "JPXDecode":
    case "JBIG2Decode":
    case "Identity":
    case "Crypt":
      return bytes;
    default:
      throw new PdfError("E_CAPABILITY", `Unsupported PDF filter: ${filterName}`);
  }
}

export function decodePdfFilterPipeline(
  filters: readonly string[],
  bytes: Uint8Array,
  parmsList?: readonly (PdfFilterDecodeParms | undefined)[],
  maxDecodedBytes = DEFAULT_MAX_DECODED_BYTES
): Uint8Array {
  let current = bytes;
  for (let i = 0; i < filters.length; i++) {
    current = decodePdfFilter(filters[i]!, current, parmsList?.[i], maxDecodedBytes);
  }
  return current;
}

export function extractDecodeParms(
  dict: PdfCosDict,
  resolve: (node: PdfCosNode | undefined) => PdfCosNode | undefined = n => n
): PdfFilterDecodeParms {
  const p = resolve(dictGet(dict, "Predictor"));
  const c = resolve(dictGet(dict, "Colors"));
  const b = resolve(dictGet(dict, "BitsPerComponent") ?? dictGet(dict, "BPC"));
  const cols = resolve(dictGet(dict, "Columns"));
  const ec = resolve(dictGet(dict, "EarlyChange"));
  const kNode = resolve(dictGet(dict, "K"));
  const rowsNode = resolve(dictGet(dict, "Rows"));
  const biNode = resolve(dictGet(dict, "BlackIs1"));
  const baNode = resolve(dictGet(dict, "EncodedByteAlign"));
  return {
    Predictor: p?.kind === "number" ? p.value : undefined,
    Colors: c?.kind === "number" ? c.value : undefined,
    BitsPerComponent: b?.kind === "number" ? b.value : undefined,
    Columns: cols?.kind === "number" ? cols.value : undefined,
    EarlyChange: ec?.kind === "number" ? ec.value : undefined,
    K: kNode?.kind === "number" ? kNode.value : undefined,
    Rows: rowsNode?.kind === "number" ? rowsNode.value : undefined,
    BlackIs1: biNode?.kind === "boolean" ? biNode.value : undefined,
    EncodedByteAlign: baNode?.kind === "boolean" ? baNode.value : undefined,
  };
}

export function decodeStreamObject(
  stream: PdfCosStream,
  maxDecodedBytes = DEFAULT_MAX_DECODED_BYTES,
  resolve: (node: PdfCosNode | undefined) => PdfCosNode | undefined = n => n
): Uint8Array {
  const filterNode = resolve(dictGet(stream.dict, "Filter") ?? dictGet(stream.dict, "F"));
  if (!filterNode) return stream.rawBytes;

  const parmsNode = resolve(dictGet(stream.dict, "DecodeParms") ?? dictGet(stream.dict, "DP"));
  if (filterNode.kind === "name") {
    const parms = parmsNode?.kind === "dict" ? extractDecodeParms(parmsNode, resolve) : undefined;
    return decodePdfFilter(filterNode.decoded, stream.rawBytes, parms, maxDecodedBytes);
  }
  if (filterNode.kind === "array") {
    const filters: string[] = [];
    for (const item of filterNode.items) {
      const resolvedItem = resolve(item);
      if (resolvedItem?.kind === "name") filters.push(resolvedItem.decoded);
    }
    const parmsList: (PdfFilterDecodeParms | undefined)[] = [];
    if (parmsNode?.kind === "array") {
      for (const item of parmsNode.items) {
        const resolvedItem = resolve(item);
        parmsList.push(resolvedItem?.kind === "dict" ? extractDecodeParms(resolvedItem, resolve) : undefined);
      }
    } else if (parmsNode?.kind === "dict") {
      const singleParms = extractDecodeParms(parmsNode, resolve);
      for (const f of filters) {
        if (
          f === "FlateDecode" ||
          f === "Fl" ||
          f === "LZWDecode" ||
          f === "LZW" ||
          f === "CCITTFaxDecode" ||
          f === "CCF" ||
          f === "JBIG2Decode"
        ) {
          parmsList.push(singleParms);
        } else {
          parmsList.push(undefined);
        }
      }
    }
    return decodePdfFilterPipeline(filters, stream.rawBytes, parmsList, maxDecodedBytes);
  }
  return stream.rawBytes;
}
