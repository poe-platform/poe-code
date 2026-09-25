import { deflate, inflate } from "pako";
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

const DEFAULT_MAX_DECODED_BYTES = 64_000_000;

export function encodeFlate(bytes: Uint8Array): Uint8Array {
  return deflate(bytes);
}

export function decodeFlate(
  bytes: Uint8Array,
  parms?: PdfFilterDecodeParms,
  maxDecodedBytes = DEFAULT_MAX_DECODED_BYTES
): Uint8Array {
  let inflated: Uint8Array;
  try {
    inflated = inflate(bytes);
  } catch {
    try {
      inflated = inflate(bytes, { raw: true });
    } catch {
      throw new PdfError("E_CAPABILITY", "Invalid FlateDecode compressed stream");
    }
  }
  if (inflated.byteLength > maxDecodedBytes) {
    throw new PdfError("E_LIMIT", "FlateDecode output exceeds maximum decoded byte budget");
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

const CCITT_WHITE_CODES: ReadonlyMap<string, number> = new Map([
  ["00110101", 0], ["000111", 1], ["0111", 2], ["1000", 3], ["1011", 4], ["1100", 5], ["1110", 6], ["1111", 7],
  ["10011", 8], ["10100", 9], ["00111", 10], ["01000", 11], ["001000", 12], ["000011", 13], ["110100", 14], ["110101", 15],
  ["101010", 16], ["101011", 17], ["0100111", 18], ["0001100", 19], ["0001000", 20], ["0010111", 21], ["0000011", 22], ["0000100", 23],
  ["0101000", 24], ["0101011", 25], ["0010011", 26], ["0100100", 27], ["0011000", 28], ["00000010", 29], ["00000011", 30], ["00011010", 31],
  ["00011011", 32], ["00010010", 33], ["00010011", 34], ["00010100", 35], ["00010101", 36], ["00010110", 37], ["00010111", 38], ["00101000", 39],
  ["00101001", 40], ["00101010", 41], ["00101011", 42], ["00101100", 43], ["00101101", 44], ["00000100", 45], ["00000101", 46], ["00001010", 47],
  ["00001011", 48], ["01010010", 49], ["01010011", 50], ["01010100", 51], ["01010101", 52], ["00100100", 53], ["00100101", 54], ["01011000", 55],
  ["01011001", 56], ["01011010", 57], ["01011011", 58], ["01001010", 59], ["01001011", 60], ["00110010", 61], ["00110011", 62], ["00110100", 63],
  ["11011", 64], ["10010", 128], ["010111", 192], ["0110111", 256], ["00110110", 320], ["00110111", 384], ["01100100", 448], ["01100101", 512],
  ["01101000", 576], ["01100111", 640], ["010011011", 1728],
]);

const CCITT_BLACK_CODES: ReadonlyMap<string, number> = new Map([
  ["0000110111", 0], ["010", 1], ["11", 2], ["10", 3], ["011", 4], ["0011", 5], ["0010", 6], ["00011", 7],
  ["000101", 8], ["000100", 9], ["0000100", 10], ["0000101", 11], ["0000111", 12], ["00000100", 13], ["00000111", 14], ["000011000", 15],
  ["0000010111", 16], ["0000011000", 17], ["0000001000", 18], ["00001100111", 19], ["00001101000", 20], ["00001101100", 21], ["00000110111", 22], ["00000101000", 23],
  ["00000010111", 24], ["00000011000", 25], ["000011001010", 26], ["000011001011", 27], ["000011001100", 28], ["000011001101", 29], ["000001101000", 30], ["000001101001", 31],
  ["000001101010", 32], ["000001101011", 33], ["000011010010", 34], ["000011010011", 35], ["000011010100", 36], ["000011010101", 37], ["000011010110", 38], ["000011010111", 39],
  ["000001101100", 40], ["000001101101", 41], ["000011011010", 42], ["000011011011", 43], ["000001010100", 44], ["000001010101", 45], ["000001010110", 46], ["000001010111", 47],
  ["000001100100", 48], ["000001100101", 49], ["000001010010", 50], ["000001010011", 51], ["000000100100", 52], ["000000110111", 53], ["000000111000", 54], ["000000100111", 55],
  ["000000101000", 56], ["000001011000", 57], ["000001011001", 58], ["000000101011", 59], ["000000101100", 60], ["000001011010", 61], ["000001100110", 62], ["000001100111", 63],
  ["0000001111", 64], ["000011001000", 128], ["000011001001", 192], ["000001011011", 256],
]);

export function decodeCcittFax(bytes: Uint8Array, parms?: PdfFilterDecodeParms): Uint8Array {
  const columns = Math.max(1, parms?.Columns ?? 1728);
  const maxRows = parms?.Rows && parms.Rows > 0 ? parms.Rows : 2048;
  const k = parms?.K ?? 0;
  const blackIs1 = parms?.BlackIs1 ?? false;
  const byteAlign = parms?.EncodedByteAlign ?? false;
  const rowBytes = Math.ceil(columns / 8);

  const totalBits = bytes.length * 8;
  let bitPos = 0;
  const readBit = (): number | undefined => {
    if (bitPos >= totalBits) return undefined;
    const b = (bytes[bitPos >>> 3]! >>> (7 - (bitPos & 7))) & 1;
    bitPos++;
    return b;
  };
  const readRunLength = (isBlack: boolean): number | undefined => {
    const table = isBlack ? CCITT_BLACK_CODES : CCITT_WHITE_CODES;
    let totalRun = 0;
    while (true) {
      let prefix = "";
      let matched: number | undefined;
      for (let len = 1; len <= 13; len++) {
        const bit = readBit();
        if (bit === undefined) return undefined;
        prefix += bit ? "1" : "0";
        if (prefix === "000000000001") return undefined; // EOL / EOFB
        const val = table.get(prefix);
        if (val !== undefined) {
          matched = val;
          break;
        }
      }
      if (matched === undefined) return undefined;
      totalRun += matched;
      if (matched < 64) return totalRun;
    }
  };

  const decodedRows: Uint8Array[] = [];
  let refLine = new Uint8Array(columns); // 0 = white, 1 = black

  while (decodedRows.length < maxRows && bitPos < totalBits) {
    if (byteAlign && (bitPos & 7) !== 0) {
      bitPos = (bitPos + 7) & ~7;
    }
    const curLine = new Uint8Array(columns);
    if (k < 0) {
      // Group 4 2D decoding
      let a0 = -1;
      let curColor = 0; // 0 = white, 1 = black
      let eofb = false;
      while ((a0 < 0 ? 0 : a0) < columns) {
        let modePrefix = "";
        let mode: string | undefined;
        for (let len = 1; len <= 12; len++) {
          const bit = readBit();
          if (bit === undefined) {
            eofb = true;
            break;
          }
          modePrefix += bit ? "1" : "0";
          if (modePrefix === "1") { mode = "V0"; break; }
          if (modePrefix === "011") { mode = "VR1"; break; }
          if (modePrefix === "010") { mode = "VL1"; break; }
          if (modePrefix === "001") { mode = "H"; break; }
          if (modePrefix === "0001") { mode = "P"; break; }
          if (modePrefix === "000011") { mode = "VR2"; break; }
          if (modePrefix === "000010") { mode = "VL2"; break; }
          if (modePrefix === "0000011") { mode = "VR3"; break; }
          if (modePrefix === "0000010") { mode = "VL3"; break; }
          if (modePrefix === "000000000001") {
            eofb = true;
            break;
          }
        }
        if (eofb || !mode) break;

        const startPos = a0 < 0 ? 0 : a0;
        // Find b1 (first changing element on refLine to the right of a0 with opposite color of curColor)
        let b1 = columns;
        for (let x = a0 < 0 ? 0 : a0 + 1; x < columns; x++) {
          const prevColor = x === 0 ? 0 : refLine[x - 1]!;
          if (refLine[x]! !== prevColor && refLine[x]! === (1 - curColor)) {
            b1 = x;
            break;
          }
        }
        let b2 = columns;
        for (let x = b1 + 1; x < columns; x++) {
          if (refLine[x]! !== refLine[x - 1]!) {
            b2 = x;
            break;
          }
        }

        if (mode === "P") {
          for (let x = startPos; x < Math.min(columns, b2); x++) curLine[x] = curColor;
          a0 = b2;
        } else if (mode === "H") {
          const r1 = readRunLength(curColor === 1) ?? 0;
          const r2 = readRunLength(curColor === 0) ?? 0;
          const a1 = Math.min(columns, startPos + r1);
          const a2 = Math.min(columns, a1 + r2);
          for (let x = startPos; x < a1; x++) curLine[x] = curColor;
          for (let x = a1; x < a2; x++) curLine[x] = 1 - curColor;
          a0 = a2;
        } else {
          let offset = 0;
          if (mode === "VR1") offset = 1;
          else if (mode === "VR2") offset = 2;
          else if (mode === "VR3") offset = 3;
          else if (mode === "VL1") offset = -1;
          else if (mode === "VL2") offset = -2;
          else if (mode === "VL3") offset = -3;
          const a1 = Math.max(startPos, Math.min(columns, b1 + offset));
          for (let x = startPos; x < a1; x++) curLine[x] = curColor;
          a0 = a1;
          curColor = 1 - curColor;
        }
      }
      if (eofb && a0 < 0) break;
    } else {
      // Group 3 1D decoding
      let xPos = 0;
      let isBlack = false;
      let aborted = false;
      while (xPos < columns) {
        const run = readRunLength(isBlack);
        if (run === undefined) {
          aborted = xPos === 0;
          break;
        }
        const endX = Math.min(columns, xPos + run);
        if (isBlack) {
          for (let x = xPos; x < endX; x++) curLine[x] = 1;
        }
        xPos = endX;
        isBlack = !isBlack;
      }
      if (aborted) break;
    }

    const packedRow = new Uint8Array(rowBytes);
    for (let x = 0; x < columns; x++) {
      const isBlackPixel = curLine[x] === 1;
      const bitVal = blackIs1 ? (isBlackPixel ? 1 : 0) : (isBlackPixel ? 0 : 1);
      if (bitVal) {
        const bIdx = x >>> 3;
        packedRow[bIdx] = (packedRow[bIdx] ?? 0) | (1 << (7 - (x & 7)));
      }
    }
    decodedRows.push(packedRow);
    refLine = curLine;
  }

  if (decodedRows.length === 0) {
    return bytes;
  }
  const out = new Uint8Array(decodedRows.length * rowBytes);
  for (let r = 0; r < decodedRows.length; r++) {
    out.set(decodedRows[r]!, r * rowBytes);
  }
  return out;
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

function extractDecodeParms(
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
