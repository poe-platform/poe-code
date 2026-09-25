import type { ImageMetadata, RgbaImage } from "../ast.js";
import { buildExifApp1Segment, parseExifBuffer } from "./exif.js";

const ZIGZAG = new Uint8Array([
  0, 1, 8, 16, 9, 2, 3, 10,
  17, 24, 32, 25, 18, 11, 4, 5,
  12, 19, 26, 33, 40, 48, 41, 34,
  27, 20, 13, 6, 7, 14, 21, 28,
  35, 42, 49, 56, 57, 50, 43, 36,
  29, 22, 15, 23, 30, 37, 44, 51,
  58, 59, 52, 45, 38, 31, 39, 46,
  53, 60, 61, 54, 47, 55, 62, 63
]);

const STD_LUMA_QUANT = new Uint8Array([
  16, 11, 10, 16, 24, 40, 51, 61,
  12, 12, 14, 19, 26, 58, 60, 55,
  14, 13, 16, 24, 40, 57, 69, 56,
  14, 17, 22, 29, 51, 87, 80, 62,
  18, 22, 37, 56, 68, 109, 103, 77,
  24, 35, 55, 64, 81, 104, 113, 92,
  49, 64, 78, 87, 103, 121, 120, 101,
  72, 92, 95, 98, 112, 100, 103, 99
]);

const STD_CHROMA_QUANT = new Uint8Array([
  17, 18, 24, 47, 99, 99, 99, 99,
  18, 21, 26, 66, 99, 99, 99, 99,
  24, 26, 56, 99, 99, 99, 99, 99,
  47, 66, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99
]);

const STD_DC_LUMA_NRCODES = new Uint8Array([0, 0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0]);
const STD_DC_LUMA_VALUES = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
const STD_DC_CHROMA_NRCODES = new Uint8Array([0, 0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0]);
const STD_DC_CHROMA_VALUES = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);

const STD_AC_LUMA_NRCODES = new Uint8Array([0, 0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d]);
const STD_AC_LUMA_VALUES = new Uint8Array([
  0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07,
  0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0,
  0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28,
  0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49,
  0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69,
  0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
  0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7,
  0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5,
  0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2,
  0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
  0xf9, 0xfa
]);

const STD_AC_CHROMA_NRCODES = new Uint8Array([0, 0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 0x77]);
const STD_AC_CHROMA_VALUES = new Uint8Array([
  0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x51, 0x07, 0x61, 0x71,
  0x13, 0x22, 0x32, 0x81, 0x08, 0x14, 0x42, 0x91, 0xa1, 0xb1, 0xc1, 0x09, 0x23, 0x33, 0x52, 0xf0,
  0x15, 0x62, 0x72, 0xd1, 0x0a, 0x16, 0x24, 0x34, 0xe1, 0x25, 0xf1, 0x17, 0x18, 0x19, 0x1a, 0x26,
  0x27, 0x28, 0x29, 0x2a, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48,
  0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68,
  0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87,
  0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5,
  0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3,
  0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda,
  0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
  0xf9, 0xfa
]);

const COS_TABLE = (() => {
  const table = new Float64Array(64);
  for (let u = 0; u < 8; u++) {
    const cu = u === 0 ? Math.SQRT1_2 : 1;
    for (let x = 0; x < 8; x++) {
      table[u * 8 + x] = cu * Math.cos(((2 * x + 1) * u * Math.PI) / 16);
    }
  }
  return table;
})();

export function isJpegBytes(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

export function readJpegMetadata(bytes: Uint8Array): ImageMetadata {
  if (!isJpegBytes(bytes)) {
    throw new Error("Invalid JPEG signature");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0;
  let height = 0;
  let channels: 1 | 2 | 3 | 4 = 3;
  let isProgressive = false;
  let density = 72;
  let orientation: number | undefined;

  let pos = 2;
  while (pos + 4 <= bytes.length) {
    if (bytes[pos] !== 0xff) {
      pos++;
      continue;
    }
    while (pos < bytes.length && bytes[pos] === 0xff) pos++;
    if (pos >= bytes.length) break;
    const marker = bytes[pos]!;
    pos++;
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      if (marker === 0xd9) break;
      continue;
    }
    if (pos + 2 > bytes.length) break;
    const segLen = view.getUint16(pos, false);
    if (segLen < 2 || pos + segLen > bytes.length) break;
    const payload = bytes.subarray(pos + 2, pos + segLen);

    if (marker === 0xe0 && payload.length >= 12) {
      // JFIF APP0
      if (
        payload[0] === 0x4a &&
        payload[1] === 0x46 &&
        payload[2] === 0x49 &&
        payload[3] === 0x46 &&
        payload[4] === 0x00
      ) {
        const units = payload[7]!;
        const xDensity = (payload[8]! << 8) | payload[9]!;
        if (xDensity > 0) {
          if (units === 1) density = xDensity;
          else if (units === 2) density = Math.round(xDensity * 2.54);
        }
      }
    } else if (marker === 0xe1 && payload.length >= 8) {
      // EXIF APP1
      const exif = parseExifBuffer(payload);
      if (exif.orientation !== undefined) orientation = exif.orientation;
      if (exif.density !== undefined) density = exif.density;
    } else if (
      marker === 0xc0 ||
      marker === 0xc1 ||
      marker === 0xc2
    ) {
      isProgressive = marker === 0xc2;
      height = (payload[1]! << 8) | payload[2]!;
      width = (payload[3]! << 8) | payload[4]!;
      const comps = payload[5]!;
      channels = comps === 1 ? 1 : comps === 4 ? 4 : 3;
      break;
    }
    pos += segLen;
  }

  if (width <= 0 || height <= 0) {
    throw new Error("Invalid JPEG dimensions");
  }

  return {
    format: "jpeg",
    width,
    height,
    space: channels === 1 ? "b-w" : channels === 4 ? "cmyk" : "srgb",
    channels,
    depth: "uchar",
    density,
    hasAlpha: false,
    ...(orientation !== undefined ? { orientation } : {}),
    isProgressive,
    size: bytes.byteLength
  };
}

interface HuffmanNode {
  children?: [HuffmanNode | undefined, HuffmanNode | undefined];
  symbol?: number;
}

function buildHuffmanTree(counts: Uint8Array, symbols: Uint8Array): HuffmanNode {
  const root: HuffmanNode = { children: [undefined, undefined] };
  let symbolIdx = 0;
  let level: HuffmanNode[] = [root];
  for (let len = 0; len < 16; len++) {
    const nextLevel: HuffmanNode[] = [];
    for (const node of level) {
      if (!node.children) node.children = [undefined, undefined];
      for (let b = 0; b < 2; b++) {
        const child: HuffmanNode = {};
        node.children[b] = child;
        nextLevel.push(child);
      }
    }
    const count = counts[len] ?? 0;
    for (let i = 0; i < count && i < nextLevel.length; i++) {
      nextLevel[i]!.symbol = symbols[symbolIdx++]!;
    }
    level = nextLevel.slice(count);
  }
  return root;
}

function idct8x8(coeffs: Int32Array, quant: Uint16Array, out: Uint8Array): void {
  const dequant = new Float64Array(64);
  for (let i = 0; i < 64; i++) {
    dequant[ZIGZAG[i]!] = coeffs[i]! * quant[i]!;
  }
  const temp = new Float64Array(64);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      let sum = 0;
      for (let u = 0; u < 8; u++) {
        sum += dequant[y * 8 + u]! * COS_TABLE[u * 8 + x]!;
      }
      temp[y * 8 + x] = sum * 0.5;
    }
  }
  for (let x = 0; x < 8; x++) {
    for (let y = 0; y < 8; y++) {
      let sum = 0;
      for (let v = 0; v < 8; v++) {
        sum += temp[v * 8 + x]! * COS_TABLE[v * 8 + y]!;
      }
      const val = Math.round(sum * 0.5 + 128);
      out[y * 8 + x] = val < 0 ? 0 : val > 255 ? 255 : val;
    }
  }
}

interface ComponentSpec {
  id: number;
  h: number;
  v: number;
  qId: number;
  dcId: number;
  acId: number;
  dcPred: number;
  blocksX: number;
  blocksY: number;
  blocks: Int32Array[];
}

export function decodeJpegImage(bytes: Uint8Array): RgbaImage {
  const meta = readJpegMetadata(bytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const quantTables: Uint16Array[] = [
    new Uint16Array(STD_LUMA_QUANT),
    new Uint16Array(STD_CHROMA_QUANT),
    new Uint16Array(STD_CHROMA_QUANT),
    new Uint16Array(STD_CHROMA_QUANT)
  ];
  const dcTrees: HuffmanNode[] = [
    buildHuffmanTree(STD_DC_LUMA_NRCODES.subarray(1), STD_DC_LUMA_VALUES),
    buildHuffmanTree(STD_DC_CHROMA_NRCODES.subarray(1), STD_DC_CHROMA_VALUES),
    buildHuffmanTree(STD_DC_CHROMA_NRCODES.subarray(1), STD_DC_CHROMA_VALUES),
    buildHuffmanTree(STD_DC_CHROMA_NRCODES.subarray(1), STD_DC_CHROMA_VALUES)
  ];
  const acTrees: HuffmanNode[] = [
    buildHuffmanTree(STD_AC_LUMA_NRCODES.subarray(1), STD_AC_LUMA_VALUES),
    buildHuffmanTree(STD_AC_CHROMA_NRCODES.subarray(1), STD_AC_CHROMA_VALUES),
    buildHuffmanTree(STD_AC_CHROMA_NRCODES.subarray(1), STD_AC_CHROMA_VALUES),
    buildHuffmanTree(STD_AC_CHROMA_NRCODES.subarray(1), STD_AC_CHROMA_VALUES)
  ];

  let width = 0;
  let height = 0;
  let maxH = 1;
  let maxV = 1;
  let mcusX = 0;
  let mcusY = 0;
  let restartInterval = 0;
  const components: ComponentSpec[] = [];

  let pos = 2;
  while (pos + 2 <= bytes.length) {
    if (bytes[pos] !== 0xff) {
      pos++;
      continue;
    }
    while (pos < bytes.length && bytes[pos] === 0xff) pos++;
    if (pos >= bytes.length) break;
    const marker = bytes[pos]!;
    pos++;
    if (marker === 0xd9) break;
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) continue;
    if (pos + 2 > bytes.length) break;
    const segLen = view.getUint16(pos, false);
    if (segLen < 2 || pos + segLen > bytes.length) break;
    const payload = bytes.subarray(pos + 2, pos + segLen);

    if (marker === 0xdb) {
      // DQT
      let qPos = 0;
      while (qPos < payload.length) {
        const info = payload[qPos++]!;
        const precision = info >>> 4;
        const qId = info & 0x0f;
        const table = new Uint16Array(64);
        for (let i = 0; i < 64; i++) {
          table[i] = precision === 0 ? payload[qPos++]! : (payload[qPos++]! << 8) | payload[qPos++]!;
        }
        quantTables[qId] = table;
      }
    } else if (marker === 0xc4) {
      // DHT
      let hPos = 0;
      while (hPos < payload.length) {
        const info = payload[hPos++]!;
        const tableClass = info >>> 4;
        const hId = info & 0x0f;
        const counts = payload.subarray(hPos, hPos + 16);
        hPos += 16;
        let totalSymbols = 0;
        for (let i = 0; i < 16; i++) totalSymbols += counts[i]!;
        const symbols = payload.subarray(hPos, hPos + totalSymbols);
        hPos += totalSymbols;
        const tree = buildHuffmanTree(counts, symbols);
        if (tableClass === 0) dcTrees[hId] = tree;
        else acTrees[hId] = tree;
      }
    } else if (marker === 0xdd && payload.length >= 2) {
      // DRI
      restartInterval = (payload[0]! << 8) | payload[1]!;
    } else if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      height = (payload[1]! << 8) | payload[2]!;
      width = (payload[3]! << 8) | payload[4]!;
      const numComps = payload[5]!;
      components.length = 0;
      maxH = 1;
      maxV = 1;
      for (let i = 0; i < numComps; i++) {
        const id = payload[6 + i * 3]!;
        const hv = payload[6 + i * 3 + 1]!;
        const h = hv >>> 4;
        const v = hv & 0x0f;
        const qId = payload[6 + i * 3 + 2]!;
        if (h > maxH) maxH = h;
        if (v > maxV) maxV = v;
        components.push({
          id,
          h,
          v,
          qId,
          dcId: 0,
          acId: 0,
          dcPred: 0,
          blocksX: 0,
          blocksY: 0,
          blocks: []
        });
      }
      mcusX = Math.ceil(width / (maxH * 8));
      mcusY = Math.ceil(height / (maxV * 8));
      for (const comp of components) {
        comp.blocksX = mcusX * comp.h;
        comp.blocksY = mcusY * comp.v;
        comp.blocks = Array.from({ length: comp.blocksX * comp.blocksY }, () => new Int32Array(64));
      }
    } else if (marker === 0xda) {
      // SOS
      const scanCompsCount = payload[0]!;
      const scanComps: ComponentSpec[] = [];
      for (let i = 0; i < scanCompsCount; i++) {
        const compId = payload[1 + i * 2]!;
        const tdta = payload[1 + i * 2 + 1]!;
        const comp = components.find(c => c.id === compId) ?? components[i];
        if (comp) {
          comp.dcId = tdta >>> 4;
          comp.acId = tdta & 0x0f;
          scanComps.push(comp);
        }
      }
      const ssPos = 1 + scanCompsCount * 2;
      const spectralStart = payload[ssPos] ?? 0;
      const spectralEnd = payload[ssPos + 1] ?? 63;
      const ahAl = payload[ssPos + 2] ?? 0;
      const approxHigh = ahAl >>> 4;
      const approxLow = ahAl & 0x0f;

      // Decode entropy-coded data starting after SOS segment
      let scanPos = pos + segLen;
      let bitBuf = 0;
      let bitCount = 0;
      let eobRun = 0;

      const readBit = (): number => {
        if (bitCount === 0) {
          if (scanPos >= bytes.length) return 0;
          let b = bytes[scanPos++]!;
          if (b === 0xff) {
            while (scanPos < bytes.length && bytes[scanPos] === 0xff) scanPos++;
            const next = bytes[scanPos] ?? 0;
            if (next === 0x00) {
              scanPos++;
            } else if (next >= 0xd0 && next <= 0xd7) {
              scanPos++;
              b = bytes[scanPos++] ?? 0;
            } else {
              return 0;
            }
          }
          bitBuf = b;
          bitCount = 8;
        }
        const bit = (bitBuf >>> (bitCount - 1)) & 1;
        bitCount--;
        return bit;
      };

      const readBits = (n: number): number => {
        let val = 0;
        for (let i = 0; i < n; i++) {
          val = (val << 1) | readBit();
        }
        return val;
      };

      const receiveExtend = (n: number): number => {
        if (n === 0) return 0;
        const v = readBits(n);
        return v < 1 << (n - 1) ? v + (-1 << n) + 1 : v;
      };

      const decodeSymbol = (tree: HuffmanNode): number => {
        let node: HuffmanNode | undefined = tree;
        while (node && node.symbol === undefined) {
          const bit = readBit();
          node = node.children?.[bit];
        }
        return node?.symbol ?? 0;
      };

      const decodeBlockBaseline = (comp: ComponentSpec, block: Int32Array) => {
        const dcTree = dcTrees[comp.dcId] ?? dcTrees[0]!;
        const acTree = acTrees[comp.acId] ?? acTrees[0]!;
        const t = decodeSymbol(dcTree);
        const diff = receiveExtend(t);
        comp.dcPred += diff;
        block[0] = comp.dcPred;
        let k = 1;
        while (k < 64) {
          const rs = decodeSymbol(acTree);
          const r = rs >>> 4;
          const s = rs & 0x0f;
          if (s === 0) {
            if (r === 15) {
              k += 16;
              continue;
            }
            break;
          }
          k += r;
          if (k < 64) {
            block[k] = receiveExtend(s);
          }
          k++;
        }
      };

      const decodeBlockProgressive = (comp: ComponentSpec, block: Int32Array) => {
        if (spectralStart === 0) {
          if (approxHigh === 0) {
            const dcTree = dcTrees[comp.dcId] ?? dcTrees[0]!;
            const t = decodeSymbol(dcTree);
            const diff = receiveExtend(t);
            comp.dcPred += diff;
            block[0] = comp.dcPred << approxLow;
          } else {
            if (readBit() !== 0) {
              block[0] = (block[0] ?? 0) | (1 << approxLow);
            }
          }
        } else if (approxHigh === 0) {
          if (eobRun > 0) {
            eobRun--;
            return;
          }
          const acTree = acTrees[comp.acId] ?? acTrees[0]!;
          for (let k = spectralStart; k <= spectralEnd; k++) {
            const rs = decodeSymbol(acTree);
            const r = rs >>> 4;
            const s = rs & 0x0f;
            if (s === 0) {
              if (r < 15) {
                eobRun = (1 << r) + readBits(r) - 1;
                break;
              }
              k += 15;
            } else {
              k += r;
              if (k <= spectralEnd) {
                block[k] = receiveExtend(s) << approxLow;
              }
            }
          }
        }
      };

      let mcuCounter = 0;
      if (scanComps.length === 1 && (spectralStart > 0 || scanCompsCount === 1 && components.length > 1)) {
        const comp = scanComps[0]!;
        const blocksCols = Math.ceil(width / (8 * (maxH / comp.h)));
        const blocksRows = Math.ceil(height / (8 * (maxV / comp.v)));
        for (let by = 0; by < blocksRows; by++) {
          for (let bx = 0; bx < blocksCols; bx++) {
            if (restartInterval > 0 && mcuCounter > 0 && mcuCounter % restartInterval === 0) {
              comp.dcPred = 0;
              eobRun = 0;
              bitCount = 0;
            }
            const block = comp.blocks[by * comp.blocksX + bx]!;
            if (meta.isProgressive) decodeBlockProgressive(comp, block);
            else decodeBlockBaseline(comp, block);
            mcuCounter++;
          }
        }
      } else {
        for (let my = 0; my < mcusY; my++) {
          for (let mx = 0; mx < mcusX; mx++) {
            if (restartInterval > 0 && mcuCounter > 0 && mcuCounter % restartInterval === 0) {
              for (const c of scanComps) c.dcPred = 0;
              eobRun = 0;
              bitCount = 0;
            }
            for (const comp of scanComps) {
              for (let vy = 0; vy < comp.v; vy++) {
                for (let hx = 0; hx < comp.h; hx++) {
                  const bx = mx * comp.h + hx;
                  const by = my * comp.v + vy;
                  const block = comp.blocks[by * comp.blocksX + bx]!;
                  if (meta.isProgressive) decodeBlockProgressive(comp, block);
                  else decodeBlockBaseline(comp, block);
                }
              }
            }
            mcuCounter++;
          }
        }
      }

      pos = scanPos;
      continue;
    }
    pos += segLen;
  }

  const compPixels = components.map(comp => {
    const pixels = new Uint8Array(comp.blocksX * 8 * comp.blocksY * 8);
    const blockOut = new Uint8Array(64);
    const quant = quantTables[comp.qId] ?? quantTables[0]!;
    for (let by = 0; by < comp.blocksY; by++) {
      for (let bx = 0; bx < comp.blocksX; bx++) {
        idct8x8(comp.blocks[by * comp.blocksX + bx]!, quant, blockOut);
        for (let y = 0; y < 8; y++) {
          const dstOffset = (by * 8 + y) * (comp.blocksX * 8) + bx * 8;
          for (let x = 0; x < 8; x++) {
            pixels[dstOffset + x] = blockOut[y * 8 + x]!;
          }
        }
      }
    }
    return { comp, pixels, stride: comp.blocksX * 8 };
  });

  const samplePlane = (
    plane: { readonly comp: ComponentSpec; readonly pixels: Uint8Array; readonly stride: number },
    x: number,
    y: number
  ): number => {
    const h = plane.comp.h;
    const v = plane.comp.v;
    if (h === maxH && v === maxV) {
      return plane.pixels[y * plane.stride + x]!;
    }
    const maxCx = Math.max(0, Math.ceil((width * h) / maxH) - 1);
    const maxCy = Math.max(0, Math.ceil((height * v) / maxV) - 1);
    const sx = ((x + 0.5) * h) / maxH - 0.5;
    const sy = ((y + 0.5) * v) / maxV - 0.5;
    const rawX0 = Math.floor(sx);
    const rawY0 = Math.floor(sy);
    const x0 = Math.max(0, Math.min(maxCx, rawX0));
    const x1 = Math.max(0, Math.min(maxCx, rawX0 + 1));
    const y0 = Math.max(0, Math.min(maxCy, rawY0));
    const y1 = Math.max(0, Math.min(maxCy, rawY0 + 1));
    const fx = Math.max(0, Math.min(1, sx - rawX0));
    const fy = Math.max(0, Math.min(1, sy - rawY0));
    const p00 = plane.pixels[y0 * plane.stride + x0]!;
    const p10 = plane.pixels[y0 * plane.stride + x1]!;
    const p01 = plane.pixels[y1 * plane.stride + x0]!;
    const p11 = plane.pixels[y1 * plane.stride + x1]!;
    const top = p00 + (p10 - p00) * fx;
    const bot = p01 + (p11 - p01) * fx;
    return top + (bot - top) * fy;
  };

  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const outIdx = (y * width + x) * 4;
      if (compPixels.length === 1) {
        const c0 = compPixels[0]!;
        const g = c0.pixels[y * c0.stride + x]!;
        rgba[outIdx] = g;
        rgba[outIdx + 1] = g;
        rgba[outIdx + 2] = g;
        rgba[outIdx + 3] = 255;
      } else if (compPixels.length >= 3) {
        const cY = compPixels[0]!;
        const cCb = compPixels[1]!;
        const cCr = compPixels[2]!;
        const yVal = samplePlane(cY, x, y);
        const cbVal = samplePlane(cCb, x, y) - 128;
        const crVal = samplePlane(cCr, x, y) - 128;

        let r = Math.round(yVal + 1.402 * crVal);
        let g = Math.round(yVal - 0.344136 * cbVal - 0.714136 * crVal);
        let b = Math.round(yVal + 1.772 * cbVal);
        r = r < 0 ? 0 : r > 255 ? 255 : r;
        g = g < 0 ? 0 : g > 255 ? 255 : g;
        b = b < 0 ? 0 : b > 255 ? 255 : b;

        if (compPixels.length === 4) {
          const cK = compPixels[3]!;
          const kVal = cK.pixels[Math.floor((y * cK.comp.v) / maxV) * cK.stride + Math.floor((x * cK.comp.h) / maxH)]! / 255;
          rgba[outIdx] = Math.round(r * kVal);
          rgba[outIdx + 1] = Math.round(g * kVal);
          rgba[outIdx + 2] = Math.round(b * kVal);
          rgba[outIdx + 3] = 255;
        } else {
          rgba[outIdx] = r;
          rgba[outIdx + 1] = g;
          rgba[outIdx + 2] = b;
          rgba[outIdx + 3] = 255;
        }
      }
    }
  }

  return {
    width,
    height,
    data: rgba,
    format: "jpeg",
    space: meta.space,
    channels: meta.channels,
    depth: "uchar",
    density: meta.density,
    hasAlpha: false,
    ...(meta.orientation !== undefined ? { orientation: meta.orientation } : {}),
    ...(meta.isProgressive !== undefined ? { isProgressive: meta.isProgressive } : {})
  };
}

function buildEncodeTable(nrcodes: Uint8Array, values: Uint8Array): { code: Uint16Array; len: Uint8Array } {
  const code = new Uint16Array(256);
  const len = new Uint8Array(256);
  let p = 0;
  let codeVal = 0;
  for (let l = 1; l <= 16; l++) {
    const count = nrcodes[l]!;
    for (let i = 0; i < count; i++) {
      const sym = values[p++]!;
      code[sym] = codeVal;
      len[sym] = l;
      codeVal++;
    }
    codeVal <<= 1;
  }
  return { code, len };
}

const ENC_DC_LUMA = buildEncodeTable(STD_DC_LUMA_NRCODES, STD_DC_LUMA_VALUES);
const ENC_DC_CHROMA = buildEncodeTable(STD_DC_CHROMA_NRCODES, STD_DC_CHROMA_VALUES);
const ENC_AC_LUMA = buildEncodeTable(STD_AC_LUMA_NRCODES, STD_AC_LUMA_VALUES);
const ENC_AC_CHROMA = buildEncodeTable(STD_AC_CHROMA_NRCODES, STD_AC_CHROMA_VALUES);

function fdct8x8(block: Float64Array, quant: Uint8Array, outZigZag: Int32Array): void {
  const temp = new Float64Array(64);
  for (let y = 0; y < 8; y++) {
    for (let u = 0; u < 8; u++) {
      let sum = 0;
      for (let x = 0; x < 8; x++) {
        sum += block[y * 8 + x]! * COS_TABLE[u * 8 + x]!;
      }
      temp[y * 8 + u] = sum * 0.5;
    }
  }
  for (let v = 0; v < 8; v++) {
    for (let u = 0; u < 8; u++) {
      let sum = 0;
      for (let y = 0; y < 8; y++) {
        sum += temp[y * 8 + u]! * COS_TABLE[v * 8 + y]!;
      }
      const coeff = sum * 0.5;
      const zigIdx = ZIGZAG.indexOf(v * 8 + u);
      if (zigIdx >= 0) {
        outZigZag[zigIdx] = Math.round(coeff / (quant[zigIdx] ?? 1));
      }
    }
  }
}

function scaleQuantTable(base: Uint8Array, quality: number): Uint8Array {
  const q = Math.max(1, Math.min(100, Math.round(quality)));
  const scale = q < 50 ? Math.floor(5000 / q) : 200 - q * 2;
  const out = new Uint8Array(64);
  for (let i = 0; i < 64; i++) {
    const zIdx = ZIGZAG[i]!;
    const v = Math.floor((base[zIdx]! * scale + 50) / 100);
    out[i] = v < 1 ? 1 : v > 255 ? 255 : v;
  }
  return out;
}

export function encodeJpegImage(
  img: RgbaImage,
  options?: {
    readonly quality?: number;
    readonly density?: number;
    readonly orientation?: number;
  }
): Uint8Array {
  const { width, height, data } = img;
  const quality = options?.quality ?? 85;
  const density = Math.max(1, Math.round(options?.density ?? img.density ?? 72));
  const orientation = options?.orientation ?? img.orientation;

  const lumaQ = scaleQuantTable(STD_LUMA_QUANT, quality);
  const chromaQ = scaleQuantTable(STD_CHROMA_QUANT, quality);

  const bytes: number[] = [];
  const writeU16 = (v: number) => {
    bytes.push((v >>> 8) & 0xff, v & 0xff);
  };
  const writeSegment = (marker: number, payload: Uint8Array) => {
    bytes.push(0xff, marker);
    writeU16(payload.length + 2);
    for (let i = 0; i < payload.length; i++) bytes.push(payload[i]!);
  };

  // SOI
  bytes.push(0xff, 0xd8);

  // APP0 JFIF
  const app0 = new Uint8Array([
    0x4a, 0x46, 0x49, 0x46, 0x00,
    0x01, 0x01,
    0x01, // units = DPI
    (density >>> 8) & 0xff, density & 0xff,
    (density >>> 8) & 0xff, density & 0xff,
    0x00, 0x00
  ]);
  writeSegment(0xe0, app0);

  // Optional APP1 Exif
  if (orientation !== undefined && orientation >= 1 && orientation <= 8) {
    writeSegment(0xe1, buildExifApp1Segment({ orientation, density }));
  }

  // DQT
  const dqt = new Uint8Array(130);
  dqt[0] = 0x00;
  dqt.set(lumaQ, 1);
  dqt[65] = 0x01;
  dqt.set(chromaQ, 66);
  writeSegment(0xdb, dqt);

  // SOF0 (Baseline DCT, 4:4:4 for crisp edge fidelity)
  const sof0 = new Uint8Array([
    8,
    (height >>> 8) & 0xff, height & 0xff,
    (width >>> 8) & 0xff, width & 0xff,
    3,
    1, 0x11, 0,
    2, 0x11, 1,
    3, 0x11, 1
  ]);
  writeSegment(0xc0, sof0);

  // DHT
  const dhtParts: number[] = [];
  const appendDht = (tcTh: number, nrcodes: Uint8Array, values: Uint8Array) => {
    dhtParts.push(tcTh);
    for (let i = 1; i <= 16; i++) dhtParts.push(nrcodes[i]!);
    for (let i = 0; i < values.length; i++) dhtParts.push(values[i]!);
  };
  appendDht(0x00, STD_DC_LUMA_NRCODES, STD_DC_LUMA_VALUES);
  appendDht(0x10, STD_AC_LUMA_NRCODES, STD_AC_LUMA_VALUES);
  appendDht(0x01, STD_DC_CHROMA_NRCODES, STD_DC_CHROMA_VALUES);
  appendDht(0x11, STD_AC_CHROMA_NRCODES, STD_AC_CHROMA_VALUES);
  writeSegment(0xc4, new Uint8Array(dhtParts));

  // SOS
  const sos = new Uint8Array([
    3,
    1, 0x00,
    2, 0x11,
    3, 0x11,
    0, 63, 0
  ]);
  writeSegment(0xda, sos);

  let bitBuf = 0;
  let bitCnt = 0;
  const writeBits = (code: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) {
      bitBuf = (bitBuf << 1) | ((code >>> i) & 1);
      bitCnt++;
      if (bitCnt === 8) {
        bytes.push(bitBuf);
        if (bitBuf === 0xff) bytes.push(0x00);
        bitBuf = 0;
        bitCnt = 0;
      }
    }
  };

  const encodeNumber = (val: number): { category: number; bits: number } => {
    if (val === 0) return { category: 0, bits: 0 };
    const abs = Math.abs(val);
    const category = 32 - Math.clz32(abs);
    const bits = val > 0 ? val : (1 << category) - 1 + val;
    return { category, bits };
  };

  const encodeBlock = (
    zz: Int32Array,
    prevDc: number,
    dcTab: { code: Uint16Array; len: Uint8Array },
    acTab: { code: Uint16Array; len: Uint8Array }
  ): number => {
    const diff = zz[0]! - prevDc;
    const dcEnc = encodeNumber(diff);
    writeBits(dcTab.code[dcEnc.category]!, dcTab.len[dcEnc.category]!);
    if (dcEnc.category > 0) writeBits(dcEnc.bits, dcEnc.category);

    let zeroRun = 0;
    for (let k = 1; k < 64; k++) {
      const v = zz[k]!;
      if (v === 0) {
        zeroRun++;
      } else {
        while (zeroRun >= 16) {
          writeBits(acTab.code[0xf0]!, acTab.len[0xf0]!);
          zeroRun -= 16;
        }
        const acEnc = encodeNumber(v);
        const sym = (zeroRun << 4) | acEnc.category;
        writeBits(acTab.code[sym]!, acTab.len[sym]!);
        writeBits(acEnc.bits, acEnc.category);
        zeroRun = 0;
      }
    }
    if (zeroRun > 0) {
      writeBits(acTab.code[0x00]!, acTab.len[0x00]!);
    }
    return zz[0]!;
  };

  const yBlock = new Float64Array(64);
  const cbBlock = new Float64Array(64);
  const crBlock = new Float64Array(64);
  const zzOut = new Int32Array(64);
  let dcY = 0;
  let dcCb = 0;
  let dcCr = 0;

  for (let by = 0; by < height; by += 8) {
    for (let bx = 0; bx < width; bx += 8) {
      for (let py = 0; py < 8; py++) {
        const sy = Math.min(height - 1, by + py);
        for (let px = 0; px < 8; px++) {
          const sx = Math.min(width - 1, bx + px);
          const idx = (sy * width + sx) * 4;
          const a = data[idx + 3]! / 255;
          const r = data[idx]! * a + 255 * (1 - a);
          const g = data[idx + 1]! * a + 255 * (1 - a);
          const b = data[idx + 2]! * a + 255 * (1 - a);
          const bIdx = py * 8 + px;
          yBlock[bIdx] = 0.299 * r + 0.587 * g + 0.114 * b - 128;
          cbBlock[bIdx] = -0.168736 * r - 0.331264 * g + 0.5 * b;
          crBlock[bIdx] = 0.5 * r - 0.418688 * g - 0.081312 * b;
        }
      }
      fdct8x8(yBlock, lumaQ, zzOut);
      dcY = encodeBlock(zzOut, dcY, ENC_DC_LUMA, ENC_AC_LUMA);
      fdct8x8(cbBlock, chromaQ, zzOut);
      dcCb = encodeBlock(zzOut, dcCb, ENC_DC_CHROMA, ENC_AC_CHROMA);
      fdct8x8(crBlock, chromaQ, zzOut);
      dcCr = encodeBlock(zzOut, dcCr, ENC_DC_CHROMA, ENC_AC_CHROMA);
    }
  }

  if (bitCnt > 0) {
    writeBits((1 << (8 - bitCnt)) - 1, 8 - bitCnt);
  }

  // EOI
  bytes.push(0xff, 0xd9);
  return new Uint8Array(bytes);
}
