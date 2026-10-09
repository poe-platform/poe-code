import {computeImageStatsSteps} from "./ops/transform.js";
import {decodeImage,encodeImage} from "./codecs/index.js";
import {decodeWebpImage,encodeWebpImage} from "./codecs/webp.js";
import { decodeTiffImage } from "./codecs/netpbm.js";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { fileURLToPath } from "node:url";
import { defaultRuntime } from "@poe-code/compression";
import { encodeJpegImage, decodeJpegImage } from "./codecs/jpeg.js";
import type { ImageMetadata, RgbaImage, SharpInputOptions } from "./ast.js";
export interface JpegInputSpec {
  kind: "literal" | "encoded" | "synthetic";
  base64?: string;
  width?: number;
  height?: number;
  components?: number;
  sampling?: number;
  progressive?: boolean;
  separate?: boolean;
  truncate?: number;
  quality?: number;
}
const segment = (marker: number, data: number[]) => [
  255,
  marker,
  (data.length + 2) >>> 8,
  (data.length + 2) & 255,
  ...data
];
function entropy(bits: string): number[] {
  const padded = bits.padEnd(Math.ceil(bits.length / 8) * 8, "1"),
    out: number[] = [];
  for (let i = 0; i < padded.length; i += 8) {
    const byte = Number.parseInt(padded.slice(i, i + 8), 2);
    out.push(byte);
    if (byte === 255) out.push(0);
  }
  return out;
}
export function jpegInputFixture(spec: JpegInputSpec): Uint8Array {
  if (spec.kind === "literal") return new Uint8Array(Buffer.from(spec.base64!, "base64"));
  const width = spec.width ?? 17,
    height = spec.height ?? 19;
  if (spec.kind === "encoded") {
    const data = Uint8Array.from(
        { length: width * height * 4 },
        (_, i) => (i * 43 + Math.floor(i / 7)) % 256
      ),
      image: RgbaImage = {
        width,
        height,
        data,
        channels: 4,
        format: "raw",
        space: "srgb",
        depth: "uchar",
        density: 144,
        orientation: 6,
        hasAlpha: true
      },
      bytes = encodeJpegImage(image, { quality: spec.quality ?? 85 });
    return spec.truncate === undefined
      ? bytes
      : bytes.subarray(0, Math.max(0, bytes.length + spec.truncate));
  }
  const count = spec.components ?? 3,
    scale = spec.sampling ?? 2,
    h = Array.from({ length: count }, (_, i) => (i === 0 ? scale : 1)),
    v = h,
    maxH = scale,
    maxV = scale,
    mcusX = Math.ceil(width / (8 * maxH)),
    mcusY = Math.ceil(height / (8 * maxV));
  const bytes = [
    255,
    216,
    ...segment(219, [0, ...new Array(64).fill(8)]),
    ...segment(spec.progressive ? 194 : 192, [
      8,
      height >>> 8,
      height & 255,
      width >>> 8,
      width & 255,
      count,
      ...h.flatMap((hv, i) => [i + 1, (hv << 4) | v[i]!, 0])
    ]),
    ...segment(196, [0, 2, ...new Array(15).fill(0), 0, 8, 16, 1, ...new Array(15).fill(0), 0])
  ];
  const addScan = (comps: number[], start: number, end: number) => {
    let bits = "";
    const indices = new Array(count).fill(0);
    const add = (comp: number) => {
      if (start === 0) {
        const amplitude = (indices[comp]++ + comp) % 2 === 0 ? 128 : 127;
        bits += "1" + amplitude.toString(2).padStart(8, "0");
      }
      if (end > 0) bits += "0";
    };
    if ((comps.length === 1 && count > 1) || start > 0) {
      const comp = comps[0]!;
      for (let y = 0; y < Math.ceil(height / (8 * (maxV / v[comp]!))); y++)
        for (let x = 0; x < Math.ceil(width / (8 * (maxH / h[comp]!))); x++) add(comp);
    } else
      for (let my = 0; my < mcusY; my++)
        for (let mx = 0; mx < mcusX; mx++)
          for (const comp of comps)
            for (let vy = 0; vy < v[comp]!; vy++) for (let hx = 0; hx < h[comp]!; hx++) add(comp);
    bytes.push(
      ...segment(218, [comps.length, ...comps.flatMap((comp) => [comp + 1, 0]), start, end, 0]),
      ...entropy(bits)
    );
  };
  const components = Array.from({ length: count }, (_, i) => i);
  if (spec.progressive) {
    addScan(components, 0, 0);
    for (const comp of components) addScan([comp], 1, 63);
  } else if (spec.separate) for (const comp of components) addScan([comp], 0, 63);
  else addScan(components, 0, 63);
  bytes.push(255, 217);
  const result = Uint8Array.from(bytes);
  return spec.truncate === undefined
    ? result
    : result.subarray(0, Math.max(0, result.length + spec.truncate));
}
export interface JpegInputVector {
  name: string;
  spec: JpegInputSpec;
  options: Pick<SharpInputOptions, "maxDecodeDimension">;
  inputHash: string;
  metadata?: ImageMetadata;
  expected?: Omit<RgbaImage, "data">;
  hash?: string;
  error?: string;
}

// Independent original decoder results at e1398e5c28, including captured authored entropy/refinement/table fixtures.
export const jpegInputVectors: JpegInputVector[] = [
  {
    name: "decodes complete baseline entropy",
    spec: {
      kind: "literal",
      base64:
        "/9j/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAALCAABAAEBAREA/8QAJgABAAAAAAAAAAAAAAAAAAAAABABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAAPwA//9k="
    },
    options: {},
    inputHash: "d7e98b662c74dcc8fd2a62381df06a4baf558919188bea95c09f06ee8da7a737",
    metadata: {
      format: "jpeg",
      width: 1,
      height: 1,
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false,
      size: 137
    },
    expected: {
      width: 1,
      height: 1,
      format: "jpeg",
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false
    },
    hash: "79dfad351f79ef0e65a11fff0a9ed44bf628f9390ff06b92ee4ee5e2477616ea"
  },
  {
    name: "rejects missing baseline entropy before EOI",
    spec: {
      kind: "literal",
      base64:
        "/9j/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAALCAABAAEBAREA/8QAJgABAAAAAAAAAAAAAAAAAAAAABABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAAPwD/2Q=="
    },
    options: {},
    inputHash: "a35bb35161fc436b1a6ebadea07cee833b451e90ea5a4547d71984563ca6e4a9",
    metadata: {
      format: "jpeg",
      width: 1,
      height: 1,
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false,
      size: 136
    },
    error: "Unexpected JPEG marker in entropy data"
  },
  {
    name: "consumes restart markers between baseline scan units",
    spec: {
      kind: "literal",
      base64:
        "/9j/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAALCAABAAkBAREA/8QAJgABAAAAAAAAAAAAAAAAAAAAABABAAAAAAAAAAAAAAAAAAAAAP/dAAQAAf/aAAgBAQAAPwA//9A//9k="
    },
    options: {},
    inputHash: "66de95b07a96f7a05f694e96b5064af8761de975e49b8664d70a03e930394c1c",
    metadata: {
      format: "jpeg",
      width: 9,
      height: 1,
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false,
      size: 146
    },
    expected: {
      width: 9,
      height: 1,
      format: "jpeg",
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false
    },
    hash: "abd3a57626cafbd24f63da2100b2838af7003ddc6aef6a43a5dd88d366c22c70"
  },
  {
    name: "decodes complete progressive entropy",
    spec: {
      kind: "literal",
      base64:
        "/9j/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wgALCAABAAEBAREA/8QAJgABAAAAAAAAAAAAAAAAAAAAABABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAAAAB//9oACAEBAAE/AH//2Q=="
    },
    options: {},
    inputHash: "22b17e8ce52738254c04139fbd4478ca578d3c238819d589bd11d188741da525",
    metadata: {
      format: "jpeg",
      width: 1,
      height: 1,
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: true,
      size: 148
    },
    expected: {
      width: 1,
      height: 1,
      format: "jpeg",
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: true
    },
    hash: "79dfad351f79ef0e65a11fff0a9ed44bf628f9390ff06b92ee4ee5e2477616ea"
  },
  {
    name: "rejects missing progressive entropy before EOI",
    spec: {
      kind: "literal",
      base64:
        "/9j/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wgALCAABAAEBAREA/8QAJgABAAAAAAAAAAAAAAAAAAAAABABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAAAAD/2gAIAQEAAT8A/9k="
    },
    options: {},
    inputHash: "8ed83bc20ead9f2637bf9a5b4c147d3829766de4cdce16433bd8f63a0964bbed",
    metadata: {
      format: "jpeg",
      width: 1,
      height: 1,
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: true,
      size: 146
    },
    error: "Unexpected JPEG marker in entropy data"
  },
  {
    name: "consumes restart markers between progressive scan units",
    spec: {
      kind: "literal",
      base64:
        "/9j/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wgALCAABAAkBAREA/8QAJgABAAAAAAAAAAAAAAAAAAAAABABAAAAAAAAAAAAAAAAAAAAAP/dAAQAAf/aAAgBAQAAAAB//9B//9oACAEBAAE/AH//0H//2Q=="
    },
    options: {},
    inputHash: "943bbf829c6fc1c5c9a4f402a44a1e9076a9c203c66dac2da67087954dcdaee8",
    metadata: {
      format: "jpeg",
      width: 9,
      height: 1,
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: true,
      size: 160
    },
    expected: {
      width: 9,
      height: 1,
      format: "jpeg",
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: true
    },
    hash: "abd3a57626cafbd24f63da2100b2838af7003ddc6aef6a43a5dd88d366c22c70"
  },
  {
    name: "rejects exhausted entropy at EOF and an incomplete byte-stuffing escape",
    spec: {
      kind: "literal",
      base64:
        "/9j/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAALCAABAAEBAREA/8QAJgABAAAAAAAAAAAAAAAAAAAAABABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAAPwA="
    },
    options: {},
    inputHash: "74abc79123bdca39c07bb1ce0f21b5e91eaecea5a9b49c8b84f5f0c32fe263f8",
    metadata: {
      format: "jpeg",
      width: 1,
      height: 1,
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false,
      size: 134
    },
    error: "Truncated JPEG entropy data"
  },
  {
    name: "rejects exhausted entropy at EOF and an incomplete byte-stuffing escape",
    spec: {
      kind: "literal",
      base64:
        "/9j/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAALCAABAAEBAREA/8QAJgABAAAAAAAAAAAAAAAAAAAAABABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAAPwD/"
    },
    options: {},
    inputHash: "839f74f809186ab040c09713af5e9cc3b9f62404507e015b15a6e1f991fa1fdd",
    metadata: {
      format: "jpeg",
      width: 1,
      height: 1,
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false,
      size: 135
    },
    error: "Truncated JPEG entropy escape"
  },
  {
    name: "rejects an unassigned Huffman code without inventing a zero symbol",
    spec: {
      kind: "literal",
      base64:
        "/9j/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAALCAABAAEBAREA/8QAJgABAAAAAAAAAAAAAAAAAAAAABABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAAPwCAAAD/2Q=="
    },
    options: {},
    inputHash: "96426b8df8ba62b47165114a6059660f7536361de38364c9bc6163c453c7a25b",
    metadata: {
      format: "jpeg",
      width: 1,
      height: 1,
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false,
      size: 139
    },
    error: "Invalid JPEG Huffman code"
  },
  {
    name: "rejects a restart marker inside a scan unit",
    spec: {
      kind: "literal",
      base64:
        "/9j/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAALCAABAAEBAREA/8QAJgABAAAAAAAAAAAAAAAAAAAAABABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAAPwD/0D//2Q=="
    },
    options: {},
    inputHash: "d8f9af9b594a3b756ebdb85a3d885d0c643f50a74d13068b52d17331756b86c5",
    metadata: {
      format: "jpeg",
      width: 1,
      height: 1,
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false,
      size: 139
    },
    error: "Unexpected JPEG marker in entropy data"
  },
  {
    name: "requires the declared restart marker and its sequence",
    spec: {
      kind: "literal",
      base64:
        "/9j/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAALCAABAAkBAREA/8QAJgABAAAAAAAAAAAAAAAAAAAAABABAAAAAAAAAAAAAAAAAAAAAP/dAAQAAf/aAAgBAQAAPwA/P//Z"
    },
    options: {},
    inputHash: "7f52ffaf66bb13c576b960747678f6ecf5d85ebe02b1cdcff30f1dfd70ded0af",
    metadata: {
      format: "jpeg",
      width: 9,
      height: 1,
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false,
      size: 144
    },
    error: "Invalid JPEG restart sequence"
  },
  {
    name: "requires the declared restart marker and its sequence",
    spec: {
      kind: "literal",
      base64:
        "/9j/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAALCAABAAkBAREA/8QAJgABAAAAAAAAAAAAAAAAAAAAABABAAAAAAAAAAAAAAAAAAAAAP/dAAQAAf/aAAgBAQAAPwA//9E//9k="
    },
    options: {},
    inputHash: "8e717c08946c33f557c7f35958fcb81094f38770b1e5a7ee97e66e50a408ecb0",
    metadata: {
      format: "jpeg",
      width: 9,
      height: 1,
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false,
      size: 146
    },
    error: "Invalid JPEG restart sequence"
  },
  {
    name: "decodes a stuffed FF amplitude byte",
    spec: {
      kind: "literal",
      base64:
        "/9j/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAALCAABABkBAREA/8QAJwABAQAAAAAAAAAAAAAAAAAAAAgQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AAv8Af//Z"
    },
    options: {},
    inputHash: "3cd995f49f182bc86aa0e70f5a1fbba21f67a6acfb0285a7d05ee3fb47949154",
    metadata: {
      format: "jpeg",
      width: 25,
      height: 1,
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false,
      size: 141
    },
    expected: {
      width: 25,
      height: 1,
      format: "jpeg",
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false
    },
    hash: "896c75eeacacf0dfa61f702ec72ea72010dfaace4ed7be4a45b638f98ef2ed96"
  },
  {
    name: "refines existing AC coefficients with positive sign %s 0",
    spec: {
      kind: "literal",
      base64:
        "/9j/2wBDABAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAALCAABAAgBAREA/8QALAABAAAAAAAAAAAAAAAAAAAAABAAAAcAAAAAAAAAAAAAAAAAAAECERIQ8P/aAAgBAQAAPwAsf//Z"
    },
    options: {},
    inputHash: "7c320857ca8cc0fefa8d719c16926a4aa8a2d89534b50c34ad685002c24d7931",
    metadata: {
      format: "jpeg",
      width: 8,
      height: 1,
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false,
      size: 144
    },
    expected: {
      width: 8,
      height: 1,
      format: "jpeg",
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false
    },
    hash: "eecb9962808dd8d8b3cec188b9a4ef0dbd1f668e26cabdb9c90883d1fca6e63a"
  },
  {
    name: "refines existing AC coefficients with positive sign %s 0",
    spec: {
      kind: "literal",
      base64:
        "/9j/2wBDABAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wgALCAABAAgBAREA/8QALAABAAAAAAAAAAAAAAAAAAAAABAAAAcAAAAAAAAAAAAAAAAAAAECERIQ8P/aAAgBAQAAAAB//9oACAEBAAE/ATH/2gAIAQEAAT8QH//Z"
    },
    options: {},
    inputHash: "beec4545f7ffcd109a09b53313d7617b02f889f6663495c62f76ede8153914f0",
    metadata: {
      format: "jpeg",
      width: 8,
      height: 1,
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: true,
      size: 165
    },
    expected: {
      width: 8,
      height: 1,
      format: "jpeg",
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: true
    },
    hash: "eecb9962808dd8d8b3cec188b9a4ef0dbd1f668e26cabdb9c90883d1fca6e63a"
  },
  {
    name: "refines existing AC coefficients with positive sign %s 1",
    spec: {
      kind: "literal",
      base64:
        "/9j/2wBDABAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAALCAABAAgBAREA/8QALAABAAAAAAAAAAAAAAAAAAAAABAAAAcAAAAAAAAAAAAAAAAAAAECERIQ8P/aAAgBAQAAPwAgf//Z"
    },
    options: {},
    inputHash: "3f8255a5e6bf8d1f5b3f486040e5294a3a97ac26c227758691ebc364caf90eb9",
    metadata: {
      format: "jpeg",
      width: 8,
      height: 1,
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false,
      size: 144
    },
    expected: {
      width: 8,
      height: 1,
      format: "jpeg",
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false
    },
    hash: "cd01dec91f632d03b971a02dc789939156b63ae9409ea133926d301b21d03917"
  },
  {
    name: "refines existing AC coefficients with positive sign %s 1",
    spec: {
      kind: "literal",
      base64:
        "/9j/2wBDABAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wgALCAABAAgBAREA/8QALAABAAAAAAAAAAAAAAAAAAAAABAAAAcAAAAAAAAAAAAAAAAAAAECERIQ8P/aAAgBAQAAAAB//9oACAEBAAE/ASH/2gAIAQEAAT8QH//Z"
    },
    options: {},
    inputHash: "20a2d91906c0598f15e8054fcd4966dc272633338a37887dda8964c00cb6ea2e",
    metadata: {
      format: "jpeg",
      width: 8,
      height: 1,
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: true,
      size: 165
    },
    expected: {
      width: 8,
      height: 1,
      format: "jpeg",
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: true
    },
    hash: "cd01dec91f632d03b971a02dc789939156b63ae9409ea133926d301b21d03917"
  },
  {
    name: "inserts a negative coefficient before an existing coefficient and consumes its correction",
    spec: {
      kind: "literal",
      base64:
        "/9j/2wBDABAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wgALCAABAAgBAREA/8QALAABAAAAAAAAAAAAAAAAAAAAABAAAAcAAAAAAAAAAAAAAAAAAAECERIQ8P/aAAgBAQAAAAB//9oACAEBAAE/AXH/2gAIAQEAAT8QIf/Z"
    },
    options: {},
    inputHash: "f086ee1c2c968d248ca355c1ec59b643c4d14104391b54b19d7ee6e34ff30b29",
    metadata: {
      format: "jpeg",
      width: 8,
      height: 1,
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: true,
      size: 165
    },
    expected: {
      width: 8,
      height: 1,
      format: "jpeg",
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: true
    },
    hash: "e4567c1b67c5a30cde955c0d7b968fca956c3423d6bd17726ceb308fee34ab2f"
  },
  {
    name: "inserts a negative coefficient before an existing coefficient and consumes its correction",
    spec: {
      kind: "literal",
      base64:
        "/9j/2wBDABAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAALCAABAAgBAREA/8QALAABAAAAAAAAAAAAAAAAAAAAABAAAAcAAAAAAAAAAAAAAAAAAAECERIQ8P/aAAgBAQAAPwASx//Z"
    },
    options: {},
    inputHash: "cc1b9bbf2385dce5d7b6c7ab75cadf6c03faa909a85e637d8dcce09b88a05384",
    metadata: {
      format: "jpeg",
      width: 8,
      height: 1,
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false,
      size: 144
    },
    expected: {
      width: 8,
      height: 1,
      format: "jpeg",
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false
    },
    hash: "e4567c1b67c5a30cde955c0d7b968fca956c3423d6bd17726ceb308fee34ab2f"
  },
  {
    name: "counts only zero coefficients in a refinement ZRL",
    spec: {
      kind: "literal",
      base64:
        "/9j/2wBDABAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wgALCAABAAgBAREA/8QALAABAAAAAAAAAAAAAAAAAAAAABAAAAcAAAAAAAAAAAAAAAAAAAECERIQ8P/aAAgBAQAAAAB//9oACAEBAAE/ATH/2gAIAQEAAT8Q0x//2Q=="
    },
    options: {},
    inputHash: "5858883db7d50b30b0dfab4b15ac22788473939d9fa2818247db57f8b02a462e",
    metadata: {
      format: "jpeg",
      width: 8,
      height: 1,
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: true,
      size: 166
    },
    expected: {
      width: 8,
      height: 1,
      format: "jpeg",
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: true
    },
    hash: "2bb34157e9abd27bfdb7c466146f8a3eed00316b8434bb917ec83d37d1052f29"
  },
  {
    name: "counts only zero coefficients in a refinement ZRL",
    spec: {
      kind: "literal",
      base64:
        "/9j/2wBDABAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAALCAABAAgBAREA/8QALAABAAAAAAAAAAAAAAAAAAAAABAAAAcAAAAAAAAAAAAAAAAAAAECERIQ8P/aAAgBAQAAPwAvGP/Z"
    },
    options: {},
    inputHash: "6dc4d711e0459970a89936ab97940d0827e0bb69d8e05813c7a1b8e964839363",
    metadata: {
      format: "jpeg",
      width: 8,
      height: 1,
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false,
      size: 144
    },
    expected: {
      width: 8,
      height: 1,
      format: "jpeg",
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false
    },
    hash: "2bb34157e9abd27bfdb7c466146f8a3eed00316b8434bb917ec83d37d1052f29"
  },
  {
    name: "retains correction bits across an EOB run spanning two blocks",
    spec: {
      kind: "literal",
      base64:
        "/9j/2wBDABAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wgALCAABABABAREA/8QALAABAAAAAAAAAAAAAAAAAAAAABAAAAcAAAAAAAAAAAAAAAAAAAECERIQ8P/aAAgBAQAAAAA//9oACAEBAAE/ATBj/9oACAEBAAE/EKv/2Q=="
    },
    options: {},
    inputHash: "9d6ffea5a0b5c3a6995b9b8b3937251426db4450ba2574189ca2aa62c11ac767",
    metadata: {
      format: "jpeg",
      width: 16,
      height: 1,
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: true,
      size: 166
    },
    expected: {
      width: 16,
      height: 1,
      format: "jpeg",
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: true
    },
    hash: "311957b20a50006e99777a0435eaaa13ef653e83200f95ac6f90839f3732b151"
  },
  {
    name: "retains correction bits across an EOB run spanning two blocks",
    spec: {
      kind: "literal",
      base64:
        "/9j/2wBDABAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAALCAABABABAREA/8QALAABAAAAAAAAAAAAAAAAAAAAABAAAAcAAAAAAAAAAAAAAAAAAAECERIQ8P/aAAgBAQAAPwAsFD//2Q=="
    },
    options: {},
    inputHash: "d39c5e0686003daf1848779934b058cec4c4cfa9ec756006ffdbdbd8459db5a4",
    metadata: {
      format: "jpeg",
      width: 16,
      height: 1,
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false,
      size: 145
    },
    expected: {
      width: 16,
      height: 1,
      format: "jpeg",
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false
    },
    hash: "311957b20a50006e99777a0435eaaa13ef653e83200f95ac6f90839f3732b151"
  },
  {
    name: "consumes restart markers in refinement scans",
    spec: {
      kind: "literal",
      base64:
        "/9j/2wBDABAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wgALCAABABABAREA/8QALAABAAAAAAAAAAAAAAAAAAAAABAAAAcAAAAAAAAAAAAAAAAAAAECERIQ8P/dAAQAAf/aAAgBAQAAAAB//9B//9oACAEBAAE/ATH/0DH/2gAIAQEAAT8QH//QH//Z"
    },
    options: {},
    inputHash: "1f1224ec693457d2393eede1ae8c56186011cb2995318b4885603d9fb3d6e8fd",
    metadata: {
      format: "jpeg",
      width: 16,
      height: 1,
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: true,
      size: 180
    },
    expected: {
      width: 16,
      height: 1,
      format: "jpeg",
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: true
    },
    hash: "555fd4ebe09c91d273405349104f25ebea01c6b293163697f63a1ce85a4f3818"
  },
  {
    name: "consumes restart markers in refinement scans",
    spec: {
      kind: "literal",
      base64:
        "/9j/2wBDABAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAALCAABABABAREA/8QALAABAAAAAAAAAAAAAAAAAAAAABAAAAcAAAAAAAAAAAAAAAAAAAECERIQ8P/aAAgBAQAAPwAsFj//2Q=="
    },
    options: {},
    inputHash: "1cd603dfae304005048f97d0a1223236564cd478e0d3b0b7d124dc61ce78c241",
    metadata: {
      format: "jpeg",
      width: 16,
      height: 1,
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false,
      size: 145
    },
    expected: {
      width: 16,
      height: 1,
      format: "jpeg",
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false
    },
    hash: "555fd4ebe09c91d273405349104f25ebea01c6b293163697f63a1ce85a4f3818"
  },
  {
    name: "rejects a refinement scan without entropy",
    spec: {
      kind: "literal",
      base64:
        "/9j/2wBDABAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wgALCAABAAgBAREA/8QALAABAAAAAAAAAAAAAAAAAAAAABAAAAcAAAAAAAAAAAAAAAAAAAECERIQ8P/aAAgBAQAAAAB//9oACAEBAAE/ATH/2gAIAQEAAT8Q/9k="
    },
    options: {},
    inputHash: "919b8038a4adf77945d04910ca097d06d11a37486cc6c40c32068e6a57ecd959",
    metadata: {
      format: "jpeg",
      width: 8,
      height: 1,
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: true,
      size: 164
    },
    error: "Unexpected JPEG marker in entropy data"
  },
  {
    name: "rejects a new refinement coefficient with size other than one",
    spec: {
      kind: "literal",
      base64:
        "/9j/2wBDABAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wgALCAABAAgBAREA/8QALAABAAAAAAAAAAAAAAAAAAAAABAAAAcAAAAAAAAAAAAAAAAAAAECERIQ8P/aAAgBAQAAAAB//9oACAEBAAE/AR//2gAIAQEAAT8QX//Z"
    },
    options: {},
    inputHash: "45e387de17954e1a1a199565f93d1e215d3ff9a134cf92c7f5f252766b7e14c5",
    metadata: {
      format: "jpeg",
      width: 8,
      height: 1,
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: true,
      size: 165
    },
    error: "Invalid JPEG refinement coefficient size"
  },
  {
    name: "rejects exhaustion while refining existing coefficients after an EOB symbol",
    spec: {
      kind: "literal",
      base64:
        "/9j/2wBDABAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wgALCAABAAgBAREA/8QALAABAAAAAAAAAAAAAAAAAAAAABAAAAcAAAAAAAAAAAAAAAAAAAECERIQ8P/aAAgBAQAAAAB//9oACAEBAAE/ATMzMx//2gAIAQEAAT8QH//Z"
    },
    options: {},
    inputHash: "1764a1dcc30feaca2d1c3e2beb09723d407699f43652bf15b3c22579a263384c",
    metadata: {
      format: "jpeg",
      width: 8,
      height: 1,
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: true,
      size: 168
    },
    error: "Unexpected JPEG marker in entropy data"
  },
  {
    name: "rejects a JPEG with %s 0",
    spec: {
      kind: "literal",
      base64:
        "/9j/wAALCAABAAEBAREA/8QAJgABAAAAAAAAAAAAAAAAAAAAABABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAAPwA//9k="
    },
    options: {},
    inputHash: "6bbc72594fbb45b685d2b923d60a8b3c3d4cec4cd92dc098c9cfecbc9a5a1ae9",
    metadata: {
      format: "jpeg",
      width: 1,
      height: 1,
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false,
      size: 68
    },
    error: "Missing JPEG quantization table"
  },
  {
    name: "rejects a JPEG with %s 1",
    spec: {
      kind: "literal",
      base64:
        "/9j/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAALCAABAAEBARED/8QAJgABAAAAAAAAAAAAAAAAAAAAABABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAAPwA//9k="
    },
    options: {},
    inputHash: "837c195f8f75931e62732588a34642ce4ca89befe4c39429075adbce4f2bf070",
    metadata: {
      format: "jpeg",
      width: 1,
      height: 1,
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false,
      size: 137
    },
    error: "Missing JPEG quantization table"
  },
  {
    name: "rejects a JPEG with %s 2",
    spec: {
      kind: "literal",
      base64:
        "/9j/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAALCAABAAEBAREA/8QAJgABAAAAAAAAAAAAAAAAAAAAABABAAAAAAAAAAAAAAAAAAAAAP/aAAgBCQAAPwA//9k="
    },
    options: {},
    inputHash: "942587953d9b0b777a6ed511f1f983a3fb090a816c1e3aa19c3faffbeff62eeb",
    metadata: {
      format: "jpeg",
      width: 1,
      height: 1,
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false,
      size: 137
    },
    error: "Unknown JPEG scan component"
  },
  {
    name: "rejects a JPEG with %s 3",
    spec: {
      kind: "literal",
      base64:
        "/9j/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAALCAABAAEBAREA/9oACAEBAAA/ACv/2Q=="
    },
    options: {},
    inputHash: "c327d8ca95d6c1535943e0132ea5dffeee039d559413fdf8179a3fea58f1b528",
    metadata: {
      format: "jpeg",
      width: 1,
      height: 1,
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false,
      size: 97
    },
    error: "Invalid JPEG Huffman code"
  },
  {
    name: "rejects a JPEG with %s 4",
    spec: {
      kind: "literal",
      base64:
        "/9j/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAALCAABAAEBAREA/8QAJgABAAAAAAAAAAAAAAAAAAAAABABAAAAAAAAAAAAAAAAAAAAAP/aAAgBARAAPwAf/9k="
    },
    options: {},
    inputHash: "af6526e3ed5c94097f49d75ecf026203b5864274ffe9e4f537c575c8163f59bb",
    metadata: {
      format: "jpeg",
      width: 1,
      height: 1,
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false,
      size: 137
    },
    error: "Invalid JPEG Huffman code"
  },
  {
    name: "rejects a JPEG with %s 5",
    spec: {
      kind: "literal",
      base64:
        "/9j/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAALCAABAAEBAREA/8QAJgABAAAAAAAAAAAAAAAAAAAAABABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQEAPwAf/9k="
    },
    options: {},
    inputHash: "0e8a1da34ce8da9c0d49fe142b2fd6d5472cf5d1e963b6f8de374b6f61be6a5c",
    metadata: {
      format: "jpeg",
      width: 1,
      height: 1,
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false,
      size: 137
    },
    error: "Invalid JPEG Huffman code"
  },
  {
    name: "rejects a JPEG with %s 6",
    spec: {
      kind: "literal",
      base64:
        "/9j/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAALCAABAAEBAREA/8QAJgABAAAAAAAAAAAAAAAAAAAAABABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAf8APwA//9k="
    },
    options: {},
    inputHash: "9873f33171e47d64885f56f787932b86bdaea30030e80a943171e0d369b014e1",
    metadata: {
      format: "jpeg",
      width: 1,
      height: 1,
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false,
      size: 137
    },
    error: "Invalid JPEG Huffman code"
  },
  {
    name: "decodes explicitly defined nondefault tables %j 1",
    spec: {
      kind: "literal",
      base64:
        "/9j/2wBDAwEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAALCAABAAEBARED/8QAJgABAAAAAAAAAAAAAAAAAAAAABABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAAPwA//9k="
    },
    options: {},
    inputHash: "71b17d8cb16378d465ef40c651435b7ec3cef4f87ead63b35f661d8676d1b209",
    metadata: {
      format: "jpeg",
      width: 1,
      height: 1,
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false,
      size: 137
    },
    expected: {
      width: 1,
      height: 1,
      format: "jpeg",
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false
    },
    hash: "79dfad351f79ef0e65a11fff0a9ed44bf628f9390ff06b92ee4ee5e2477616ea"
  },
  {
    name: "decodes explicitly defined nondefault tables %j 2",
    spec: {
      kind: "literal",
      base64:
        "/9j/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAALCAABAAEBAREA/8QAJgIBAAAAAAAAAAAAAAAAAAAAABIBAAAAAAAAAAAAAAAAAAAAAP/aAAgBASIAPwA//9k="
    },
    options: {},
    inputHash: "2c9bf624829cf4fce85650cd0480f2c50160610691bece4e418bc55d9c718df0",
    metadata: {
      format: "jpeg",
      width: 1,
      height: 1,
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false,
      size: 137
    },
    expected: {
      width: 1,
      height: 1,
      format: "jpeg",
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false
    },
    hash: "79dfad351f79ef0e65a11fff0a9ed44bf628f9390ff06b92ee4ee5e2477616ea"
  },
  {
    name: "encoded 1x1 shrinkundefined",
    spec: { kind: "encoded", width: 1, height: 1 },
    options: {},
    inputHash: "d862662e48c2d2044050777b25941685f00aec0fcdf89426cd59dab8f4314dd0",
    metadata: {
      format: "jpeg",
      width: 1,
      height: 1,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 144,
      hasAlpha: false,
      orientation: 6,
      isProgressive: false,
      size: 702
    },
    expected: {
      width: 1,
      height: 1,
      format: "jpeg",
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 144,
      hasAlpha: false,
      orientation: 6,
      isProgressive: false
    },
    hash: "e7170dc5af25abdfab5179966de69de714e611c1da2575617cceec04517a3700"
  },
  {
    name: "encoded 1x1 shrink128",
    spec: { kind: "encoded", width: 1, height: 1 },
    options: { maxDecodeDimension: 128 },
    inputHash: "d862662e48c2d2044050777b25941685f00aec0fcdf89426cd59dab8f4314dd0",
    metadata: {
      format: "jpeg",
      width: 1,
      height: 1,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 144,
      hasAlpha: false,
      orientation: 6,
      isProgressive: false,
      size: 702
    },
    expected: {
      width: 1,
      height: 1,
      format: "jpeg",
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 144,
      hasAlpha: false,
      orientation: 6,
      isProgressive: false
    },
    hash: "e7170dc5af25abdfab5179966de69de714e611c1da2575617cceec04517a3700"
  },
  {
    name: "encoded 1x1 shrink256",
    spec: { kind: "encoded", width: 1, height: 1 },
    options: { maxDecodeDimension: 256 },
    inputHash: "d862662e48c2d2044050777b25941685f00aec0fcdf89426cd59dab8f4314dd0",
    metadata: {
      format: "jpeg",
      width: 1,
      height: 1,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 144,
      hasAlpha: false,
      orientation: 6,
      isProgressive: false,
      size: 702
    },
    expected: {
      width: 1,
      height: 1,
      format: "jpeg",
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 144,
      hasAlpha: false,
      orientation: 6,
      isProgressive: false
    },
    hash: "e7170dc5af25abdfab5179966de69de714e611c1da2575617cceec04517a3700"
  },
  {
    name: "encoded 7x9 shrinkundefined",
    spec: { kind: "encoded", width: 7, height: 9 },
    options: {},
    inputHash: "15fff52e3996017342aa53955c47a05ab721cdc3c94947213c82188411a86b67",
    metadata: {
      format: "jpeg",
      width: 7,
      height: 9,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 144,
      hasAlpha: false,
      orientation: 6,
      isProgressive: false,
      size: 794
    },
    expected: {
      width: 7,
      height: 9,
      format: "jpeg",
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 144,
      hasAlpha: false,
      orientation: 6,
      isProgressive: false
    },
    hash: "e1dcb044d54f81ed14f5f630ee9502049c97d00f917352c6ca9eca654768cd5b"
  },
  {
    name: "encoded 7x9 shrink128",
    spec: { kind: "encoded", width: 7, height: 9 },
    options: { maxDecodeDimension: 128 },
    inputHash: "15fff52e3996017342aa53955c47a05ab721cdc3c94947213c82188411a86b67",
    metadata: {
      format: "jpeg",
      width: 7,
      height: 9,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 144,
      hasAlpha: false,
      orientation: 6,
      isProgressive: false,
      size: 794
    },
    expected: {
      width: 7,
      height: 9,
      format: "jpeg",
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 144,
      hasAlpha: false,
      orientation: 6,
      isProgressive: false
    },
    hash: "e1dcb044d54f81ed14f5f630ee9502049c97d00f917352c6ca9eca654768cd5b"
  },
  {
    name: "encoded 7x9 shrink256",
    spec: { kind: "encoded", width: 7, height: 9 },
    options: { maxDecodeDimension: 256 },
    inputHash: "15fff52e3996017342aa53955c47a05ab721cdc3c94947213c82188411a86b67",
    metadata: {
      format: "jpeg",
      width: 7,
      height: 9,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 144,
      hasAlpha: false,
      orientation: 6,
      isProgressive: false,
      size: 794
    },
    expected: {
      width: 7,
      height: 9,
      format: "jpeg",
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 144,
      hasAlpha: false,
      orientation: 6,
      isProgressive: false
    },
    hash: "e1dcb044d54f81ed14f5f630ee9502049c97d00f917352c6ca9eca654768cd5b"
  },
  {
    name: "encoded 17x19 shrinkundefined",
    spec: { kind: "encoded", width: 17, height: 19 },
    options: {},
    inputHash: "2fa50d293bc2af909677354648cd04e136cf03406d845f9ce403ce56a6f2ad67",
    metadata: {
      format: "jpeg",
      width: 17,
      height: 19,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 144,
      hasAlpha: false,
      orientation: 6,
      isProgressive: false,
      size: 1166
    },
    expected: {
      width: 17,
      height: 19,
      format: "jpeg",
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 144,
      hasAlpha: false,
      orientation: 6,
      isProgressive: false
    },
    hash: "85aafa1803d7b23d236895cd92ae38daa9b3034fb37c23066ef36f4290df3aaf"
  },
  {
    name: "encoded 17x19 shrink128",
    spec: { kind: "encoded", width: 17, height: 19 },
    options: { maxDecodeDimension: 128 },
    inputHash: "2fa50d293bc2af909677354648cd04e136cf03406d845f9ce403ce56a6f2ad67",
    metadata: {
      format: "jpeg",
      width: 17,
      height: 19,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 144,
      hasAlpha: false,
      orientation: 6,
      isProgressive: false,
      size: 1166
    },
    expected: {
      width: 17,
      height: 19,
      format: "jpeg",
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 144,
      hasAlpha: false,
      orientation: 6,
      isProgressive: false
    },
    hash: "85aafa1803d7b23d236895cd92ae38daa9b3034fb37c23066ef36f4290df3aaf"
  },
  {
    name: "encoded 17x19 shrink256",
    spec: { kind: "encoded", width: 17, height: 19 },
    options: { maxDecodeDimension: 256 },
    inputHash: "2fa50d293bc2af909677354648cd04e136cf03406d845f9ce403ce56a6f2ad67",
    metadata: {
      format: "jpeg",
      width: 17,
      height: 19,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 144,
      hasAlpha: false,
      orientation: 6,
      isProgressive: false,
      size: 1166
    },
    expected: {
      width: 17,
      height: 19,
      format: "jpeg",
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 144,
      hasAlpha: false,
      orientation: 6,
      isProgressive: false
    },
    hash: "85aafa1803d7b23d236895cd92ae38daa9b3034fb37c23066ef36f4290df3aaf"
  },
  {
    name: "encoded 511x512 shrinkundefined",
    spec: { kind: "encoded", width: 511, height: 512 },
    options: {},
    inputHash: "7d5e079a3e240596554ee5e5eb6ff89a81a992580e4f502986269d5538ed5374",
    metadata: {
      format: "jpeg",
      width: 511,
      height: 512,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 144,
      hasAlpha: false,
      orientation: 6,
      isProgressive: false,
      size: 250643
    },
    expected: {
      width: 511,
      height: 512,
      format: "jpeg",
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 144,
      hasAlpha: false,
      orientation: 6,
      isProgressive: false
    },
    hash: "25c57d4162f3b5130b094d45c95d26e312818eec601889b527db1400be61de11"
  },
  {
    name: "encoded 511x512 shrink128",
    spec: { kind: "encoded", width: 511, height: 512 },
    options: { maxDecodeDimension: 128 },
    inputHash: "7d5e079a3e240596554ee5e5eb6ff89a81a992580e4f502986269d5538ed5374",
    metadata: {
      format: "jpeg",
      width: 511,
      height: 512,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 144,
      hasAlpha: false,
      orientation: 6,
      isProgressive: false,
      size: 250643
    },
    expected: {
      width: 128,
      height: 128,
      format: "jpeg",
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 144,
      hasAlpha: false,
      orientation: 6,
      isProgressive: false
    },
    hash: "8c994bc00c784e231e511cd6d3c3fcbf05a56f7e3682f8c6ecc2bfa91ea16457"
  },
  {
    name: "encoded 511x512 shrink256",
    spec: { kind: "encoded", width: 511, height: 512 },
    options: { maxDecodeDimension: 256 },
    inputHash: "7d5e079a3e240596554ee5e5eb6ff89a81a992580e4f502986269d5538ed5374",
    metadata: {
      format: "jpeg",
      width: 511,
      height: 512,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 144,
      hasAlpha: false,
      orientation: 6,
      isProgressive: false,
      size: 250643
    },
    expected: {
      width: 256,
      height: 256,
      format: "jpeg",
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 144,
      hasAlpha: false,
      orientation: 6,
      isProgressive: false
    },
    hash: "305d01e77e813f768bd4fa6bac79682341a3bf2f89f80272fc02334bcb3b6a25"
  },
  {
    name: "encoded 512x512 shrinkundefined",
    spec: { kind: "encoded", width: 512, height: 512 },
    options: {},
    inputHash: "065243074c488e4467fa8af0af0ec65313682098e43c7f6c94abd548ca4aa62f",
    metadata: {
      format: "jpeg",
      width: 512,
      height: 512,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 144,
      hasAlpha: false,
      orientation: 6,
      isProgressive: false,
      size: 261200
    },
    expected: {
      width: 512,
      height: 512,
      format: "jpeg",
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 144,
      hasAlpha: false,
      orientation: 6,
      isProgressive: false
    },
    hash: "e3736bb0b5866fb114dadddde53eda24965f13c560e012344e1aeb05cc90b414"
  },
  {
    name: "encoded 512x512 shrink128",
    spec: { kind: "encoded", width: 512, height: 512 },
    options: { maxDecodeDimension: 128 },
    inputHash: "065243074c488e4467fa8af0af0ec65313682098e43c7f6c94abd548ca4aa62f",
    metadata: {
      format: "jpeg",
      width: 512,
      height: 512,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 144,
      hasAlpha: false,
      orientation: 6,
      isProgressive: false,
      size: 261200
    },
    expected: {
      width: 128,
      height: 128,
      format: "jpeg",
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 144,
      hasAlpha: false,
      orientation: 6,
      isProgressive: false
    },
    hash: "5fa20a883c4b0e1dd61be174f9c362120193691aebaae75729ac28f89890bbcd"
  },
  {
    name: "encoded 512x512 shrink256",
    spec: { kind: "encoded", width: 512, height: 512 },
    options: { maxDecodeDimension: 256 },
    inputHash: "065243074c488e4467fa8af0af0ec65313682098e43c7f6c94abd548ca4aa62f",
    metadata: {
      format: "jpeg",
      width: 512,
      height: 512,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 144,
      hasAlpha: false,
      orientation: 6,
      isProgressive: false,
      size: 261200
    },
    expected: {
      width: 256,
      height: 256,
      format: "jpeg",
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 144,
      hasAlpha: false,
      orientation: 6,
      isProgressive: false
    },
    hash: "b12eed010c8b67b8ac11867c3614c6180dbfdf9e379490ae6f7d607326675598"
  },
  {
    name: "encoded 513x512 shrinkundefined",
    spec: { kind: "encoded", width: 513, height: 512 },
    options: {},
    inputHash: "2de3a9ccdfd3419f330ca6a8cbf456701325c6e9b1883ea8b160418a1f8317c7",
    metadata: {
      format: "jpeg",
      width: 513,
      height: 512,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 144,
      hasAlpha: false,
      orientation: 6,
      isProgressive: false,
      size: 257532
    },
    expected: {
      width: 513,
      height: 512,
      format: "jpeg",
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 144,
      hasAlpha: false,
      orientation: 6,
      isProgressive: false
    },
    hash: "bd9cf8bfaddb9579f8a9544f74ae0cf64d3a83f48c95381eca400b843ebcdf6f"
  },
  {
    name: "encoded 513x512 shrink128",
    spec: { kind: "encoded", width: 513, height: 512 },
    options: { maxDecodeDimension: 128 },
    inputHash: "2de3a9ccdfd3419f330ca6a8cbf456701325c6e9b1883ea8b160418a1f8317c7",
    metadata: {
      format: "jpeg",
      width: 513,
      height: 512,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 144,
      hasAlpha: false,
      orientation: 6,
      isProgressive: false,
      size: 257532
    },
    expected: {
      width: 129,
      height: 128,
      format: "jpeg",
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 144,
      hasAlpha: false,
      orientation: 6,
      isProgressive: false
    },
    hash: "1923de57f546ae5f10397227ff6f02051cd5d49347764a83faa058eae8638ec1"
  },
  {
    name: "encoded 513x512 shrink256",
    spec: { kind: "encoded", width: 513, height: 512 },
    options: { maxDecodeDimension: 256 },
    inputHash: "2de3a9ccdfd3419f330ca6a8cbf456701325c6e9b1883ea8b160418a1f8317c7",
    metadata: {
      format: "jpeg",
      width: 513,
      height: 512,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 144,
      hasAlpha: false,
      orientation: 6,
      isProgressive: false,
      size: 257532
    },
    expected: {
      width: 257,
      height: 256,
      format: "jpeg",
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 144,
      hasAlpha: false,
      orientation: 6,
      isProgressive: false
    },
    hash: "6a638a7063d340889043ca1e68f968bd8da5aa1dbe3a5412443fe26a634e4698"
  },
  {
    name: "encoded 513x9 shrinkundefined",
    spec: { kind: "encoded", width: 513, height: 9 },
    options: {},
    inputHash: "b8faa1b7042f88f70577ba21523f407302078e0d2537cce77013c34aa5e5732d",
    metadata: {
      format: "jpeg",
      width: 513,
      height: 9,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 144,
      hasAlpha: false,
      orientation: 6,
      isProgressive: false,
      size: 6603
    },
    expected: {
      width: 513,
      height: 9,
      format: "jpeg",
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 144,
      hasAlpha: false,
      orientation: 6,
      isProgressive: false
    },
    hash: "1c457f27f9ee3b467bec9df1689a7b792b0d3fa6eb9534d7acf324ab0cd1b30d"
  },
  {
    name: "encoded 513x9 shrink128",
    spec: { kind: "encoded", width: 513, height: 9 },
    options: { maxDecodeDimension: 128 },
    inputHash: "b8faa1b7042f88f70577ba21523f407302078e0d2537cce77013c34aa5e5732d",
    metadata: {
      format: "jpeg",
      width: 513,
      height: 9,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 144,
      hasAlpha: false,
      orientation: 6,
      isProgressive: false,
      size: 6603
    },
    expected: {
      width: 257,
      height: 5,
      format: "jpeg",
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 144,
      hasAlpha: false,
      orientation: 6,
      isProgressive: false
    },
    hash: "ad09728d5f7c750fff571c6e6570160fda37962513b2f25965400008c830c415"
  },
  {
    name: "encoded 513x9 shrink256",
    spec: { kind: "encoded", width: 513, height: 9 },
    options: { maxDecodeDimension: 256 },
    inputHash: "b8faa1b7042f88f70577ba21523f407302078e0d2537cce77013c34aa5e5732d",
    metadata: {
      format: "jpeg",
      width: 513,
      height: 9,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 144,
      hasAlpha: false,
      orientation: 6,
      isProgressive: false,
      size: 6603
    },
    expected: {
      width: 257,
      height: 5,
      format: "jpeg",
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 144,
      hasAlpha: false,
      orientation: 6,
      isProgressive: false
    },
    hash: "ad09728d5f7c750fff571c6e6570160fda37962513b2f25965400008c830c415"
  },
  {
    name: "encoded 513x256 shrinkundefined",
    spec: { kind: "encoded", width: 513, height: 256 },
    options: {},
    inputHash: "51e297c416a7e1fc3e448075596f4bf21811f980cbcd3b5172351e0828d4eaa3",
    metadata: {
      format: "jpeg",
      width: 513,
      height: 256,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 144,
      hasAlpha: false,
      orientation: 6,
      isProgressive: false,
      size: 129114
    },
    expected: {
      width: 513,
      height: 256,
      format: "jpeg",
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 144,
      hasAlpha: false,
      orientation: 6,
      isProgressive: false
    },
    hash: "83379b9a2da5db94f919889a36552fa8769d51acb16d6caad395ef4c9e9d5562"
  },
  {
    name: "encoded 513x256 shrink128",
    spec: { kind: "encoded", width: 513, height: 256 },
    options: { maxDecodeDimension: 128 },
    inputHash: "51e297c416a7e1fc3e448075596f4bf21811f980cbcd3b5172351e0828d4eaa3",
    metadata: {
      format: "jpeg",
      width: 513,
      height: 256,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 144,
      hasAlpha: false,
      orientation: 6,
      isProgressive: false,
      size: 129114
    },
    expected: {
      width: 129,
      height: 64,
      format: "jpeg",
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 144,
      hasAlpha: false,
      orientation: 6,
      isProgressive: false
    },
    hash: "8a4329fd452d90c7f2b174f988ed74ba56189b341e91c39908a90c19b0d083fc"
  },
  {
    name: "encoded 513x256 shrink256",
    spec: { kind: "encoded", width: 513, height: 256 },
    options: { maxDecodeDimension: 256 },
    inputHash: "51e297c416a7e1fc3e448075596f4bf21811f980cbcd3b5172351e0828d4eaa3",
    metadata: {
      format: "jpeg",
      width: 513,
      height: 256,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 144,
      hasAlpha: false,
      orientation: 6,
      isProgressive: false,
      size: 129114
    },
    expected: {
      width: 257,
      height: 128,
      format: "jpeg",
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 144,
      hasAlpha: false,
      orientation: 6,
      isProgressive: false
    },
    hash: "8f8778dc1d7dc24f4f3714c0b00d332c5c3fd3a0f10727f80ea5b8eb17ad935f"
  },
  {
    name: "synthetic c1 sampling1 progfalse sepfalse shrinkundefined",
    spec: {
      kind: "synthetic",
      width: 19,
      height: 17,
      components: 1,
      sampling: 1,
      progressive: false,
      separate: false
    },
    options: {},
    inputHash: "c015783b3229764e8e795fa6f59d40c6530ee10912972c6cce0063c7b4057056",
    metadata: {
      format: "jpeg",
      width: 19,
      height: 17,
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false,
      size: 149
    },
    expected: {
      width: 19,
      height: 17,
      format: "jpeg",
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false
    },
    hash: "a2356300c01208dec2e86e3de0f551c87ccef48259eb1fb1ca3d779ff493579f"
  },
  {
    name: "synthetic c1 sampling1 progfalse sepfalse shrink4",
    spec: {
      kind: "synthetic",
      width: 19,
      height: 17,
      components: 1,
      sampling: 1,
      progressive: false,
      separate: false
    },
    options: { maxDecodeDimension: 4 },
    inputHash: "c015783b3229764e8e795fa6f59d40c6530ee10912972c6cce0063c7b4057056",
    metadata: {
      format: "jpeg",
      width: 19,
      height: 17,
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false,
      size: 149
    },
    expected: {
      width: 5,
      height: 5,
      format: "jpeg",
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false
    },
    hash: "d362ce5dbee533ed03f771163e803032871fbfbe11e8059bc7477bc7d294f23d"
  },
  {
    name: "synthetic c1 sampling1 progfalse septrue shrinkundefined",
    spec: {
      kind: "synthetic",
      width: 19,
      height: 17,
      components: 1,
      sampling: 1,
      progressive: false,
      separate: true
    },
    options: {},
    inputHash: "c015783b3229764e8e795fa6f59d40c6530ee10912972c6cce0063c7b4057056",
    metadata: {
      format: "jpeg",
      width: 19,
      height: 17,
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false,
      size: 149
    },
    expected: {
      width: 19,
      height: 17,
      format: "jpeg",
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false
    },
    hash: "a2356300c01208dec2e86e3de0f551c87ccef48259eb1fb1ca3d779ff493579f"
  },
  {
    name: "synthetic c1 sampling1 progfalse septrue shrink4",
    spec: {
      kind: "synthetic",
      width: 19,
      height: 17,
      components: 1,
      sampling: 1,
      progressive: false,
      separate: true
    },
    options: { maxDecodeDimension: 4 },
    inputHash: "c015783b3229764e8e795fa6f59d40c6530ee10912972c6cce0063c7b4057056",
    metadata: {
      format: "jpeg",
      width: 19,
      height: 17,
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false,
      size: 149
    },
    expected: {
      width: 5,
      height: 5,
      format: "jpeg",
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false
    },
    hash: "d362ce5dbee533ed03f771163e803032871fbfbe11e8059bc7477bc7d294f23d"
  },
  {
    name: "synthetic c1 sampling1 progtrue sepfalse shrinkundefined",
    spec: {
      kind: "synthetic",
      width: 19,
      height: 17,
      components: 1,
      sampling: 1,
      progressive: true,
      separate: false
    },
    options: {},
    inputHash: "86ee721dd52373ca9a83763e78a48a1f147fac9c4cb7fae4c90acb6525eb620b",
    metadata: {
      format: "jpeg",
      width: 19,
      height: 17,
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: true,
      size: 161
    },
    expected: {
      width: 19,
      height: 17,
      format: "jpeg",
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: true
    },
    hash: "a2356300c01208dec2e86e3de0f551c87ccef48259eb1fb1ca3d779ff493579f"
  },
  {
    name: "synthetic c1 sampling1 progtrue sepfalse shrink4",
    spec: {
      kind: "synthetic",
      width: 19,
      height: 17,
      components: 1,
      sampling: 1,
      progressive: true,
      separate: false
    },
    options: { maxDecodeDimension: 4 },
    inputHash: "86ee721dd52373ca9a83763e78a48a1f147fac9c4cb7fae4c90acb6525eb620b",
    metadata: {
      format: "jpeg",
      width: 19,
      height: 17,
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: true,
      size: 161
    },
    expected: {
      width: 19,
      height: 17,
      format: "jpeg",
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: true
    },
    hash: "a2356300c01208dec2e86e3de0f551c87ccef48259eb1fb1ca3d779ff493579f"
  },
  {
    name: "synthetic c1 sampling2 progfalse sepfalse shrinkundefined",
    spec: {
      kind: "synthetic",
      width: 19,
      height: 17,
      components: 1,
      sampling: 2,
      progressive: false,
      separate: false
    },
    options: {},
    inputHash: "1d67d5fdff0662ff678c9f88a661840b581113c5d3d290b43327557c1d9bb619",
    metadata: {
      format: "jpeg",
      width: 19,
      height: 17,
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false,
      size: 157
    },
    expected: {
      width: 19,
      height: 17,
      format: "jpeg",
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false
    },
    hash: "37d17e148a7993bfce35e1fab433e03ebd5da8f03bf00b376a6b13189b2c4d5a"
  },
  {
    name: "synthetic c1 sampling2 progfalse sepfalse shrink4",
    spec: {
      kind: "synthetic",
      width: 19,
      height: 17,
      components: 1,
      sampling: 2,
      progressive: false,
      separate: false
    },
    options: { maxDecodeDimension: 4 },
    inputHash: "1d67d5fdff0662ff678c9f88a661840b581113c5d3d290b43327557c1d9bb619",
    metadata: {
      format: "jpeg",
      width: 19,
      height: 17,
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false,
      size: 157
    },
    expected: {
      width: 5,
      height: 5,
      format: "jpeg",
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false
    },
    hash: "c1bb6e40b0b6465a3e46bc53e769a361c2c4132fba95f051420465a6e26c1b8a"
  },
  {
    name: "synthetic c1 sampling2 progfalse septrue shrinkundefined",
    spec: {
      kind: "synthetic",
      width: 19,
      height: 17,
      components: 1,
      sampling: 2,
      progressive: false,
      separate: true
    },
    options: {},
    inputHash: "1d67d5fdff0662ff678c9f88a661840b581113c5d3d290b43327557c1d9bb619",
    metadata: {
      format: "jpeg",
      width: 19,
      height: 17,
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false,
      size: 157
    },
    expected: {
      width: 19,
      height: 17,
      format: "jpeg",
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false
    },
    hash: "37d17e148a7993bfce35e1fab433e03ebd5da8f03bf00b376a6b13189b2c4d5a"
  },
  {
    name: "synthetic c1 sampling2 progfalse septrue shrink4",
    spec: {
      kind: "synthetic",
      width: 19,
      height: 17,
      components: 1,
      sampling: 2,
      progressive: false,
      separate: true
    },
    options: { maxDecodeDimension: 4 },
    inputHash: "1d67d5fdff0662ff678c9f88a661840b581113c5d3d290b43327557c1d9bb619",
    metadata: {
      format: "jpeg",
      width: 19,
      height: 17,
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false,
      size: 157
    },
    expected: {
      width: 5,
      height: 5,
      format: "jpeg",
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false
    },
    hash: "c1bb6e40b0b6465a3e46bc53e769a361c2c4132fba95f051420465a6e26c1b8a"
  },
  {
    name: "synthetic c1 sampling2 progtrue sepfalse shrinkundefined",
    spec: {
      kind: "synthetic",
      width: 19,
      height: 17,
      components: 1,
      sampling: 2,
      progressive: true,
      separate: false
    },
    options: {},
    inputHash: "fa10ecccf70a07c499671b837bc02fe8b4de1b8f092fdc32a3d95634f17ff09f",
    metadata: {
      format: "jpeg",
      width: 19,
      height: 17,
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: true,
      size: 169
    },
    expected: {
      width: 19,
      height: 17,
      format: "jpeg",
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: true
    },
    hash: "37d17e148a7993bfce35e1fab433e03ebd5da8f03bf00b376a6b13189b2c4d5a"
  },
  {
    name: "synthetic c1 sampling2 progtrue sepfalse shrink4",
    spec: {
      kind: "synthetic",
      width: 19,
      height: 17,
      components: 1,
      sampling: 2,
      progressive: true,
      separate: false
    },
    options: { maxDecodeDimension: 4 },
    inputHash: "fa10ecccf70a07c499671b837bc02fe8b4de1b8f092fdc32a3d95634f17ff09f",
    metadata: {
      format: "jpeg",
      width: 19,
      height: 17,
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: true,
      size: 169
    },
    expected: {
      width: 19,
      height: 17,
      format: "jpeg",
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: true
    },
    hash: "37d17e148a7993bfce35e1fab433e03ebd5da8f03bf00b376a6b13189b2c4d5a"
  },
  {
    name: "synthetic c3 sampling1 progfalse sepfalse shrinkundefined",
    spec: {
      kind: "synthetic",
      width: 19,
      height: 17,
      components: 3,
      sampling: 1,
      progressive: false,
      separate: false
    },
    options: {},
    inputHash: "4facd9f7db99becc0a85d6c2d231268ab973347c7d2ea76906f5db1a5aa50c68",
    metadata: {
      format: "jpeg",
      width: 19,
      height: 17,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false,
      size: 181
    },
    expected: {
      width: 19,
      height: 17,
      format: "jpeg",
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false
    },
    hash: "cc917787872e094a7b55fcd6a54f11e4829a668c16d04c2d6665a5aa4261744e"
  },
  {
    name: "synthetic c3 sampling1 progfalse sepfalse shrink4",
    spec: {
      kind: "synthetic",
      width: 19,
      height: 17,
      components: 3,
      sampling: 1,
      progressive: false,
      separate: false
    },
    options: { maxDecodeDimension: 4 },
    inputHash: "4facd9f7db99becc0a85d6c2d231268ab973347c7d2ea76906f5db1a5aa50c68",
    metadata: {
      format: "jpeg",
      width: 19,
      height: 17,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false,
      size: 181
    },
    expected: {
      width: 5,
      height: 5,
      format: "jpeg",
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false
    },
    hash: "6f6bce2f23f18c164dd11574f3b58294124643f53464a822a9a7ac9f26f739a3"
  },
  {
    name: "synthetic c3 sampling1 progfalse septrue shrinkundefined",
    spec: {
      kind: "synthetic",
      width: 19,
      height: 17,
      components: 3,
      sampling: 1,
      progressive: false,
      separate: true
    },
    options: {},
    inputHash: "48e54862fa348f26ed71ebe9673679c917ac1f51c4b1b68dda6248c2d3a11542",
    metadata: {
      format: "jpeg",
      width: 19,
      height: 17,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false,
      size: 199
    },
    expected: {
      width: 19,
      height: 17,
      format: "jpeg",
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false
    },
    hash: "cc917787872e094a7b55fcd6a54f11e4829a668c16d04c2d6665a5aa4261744e"
  },
  {
    name: "synthetic c3 sampling1 progfalse septrue shrink4",
    spec: {
      kind: "synthetic",
      width: 19,
      height: 17,
      components: 3,
      sampling: 1,
      progressive: false,
      separate: true
    },
    options: { maxDecodeDimension: 4 },
    inputHash: "48e54862fa348f26ed71ebe9673679c917ac1f51c4b1b68dda6248c2d3a11542",
    metadata: {
      format: "jpeg",
      width: 19,
      height: 17,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false,
      size: 199
    },
    expected: {
      width: 19,
      height: 17,
      format: "jpeg",
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false
    },
    hash: "3a1c7dd210a7c61293c0ff6707fd54af6c69fde1ec91b75cb4859f2101fbc0cb"
  },
  {
    name: "synthetic c3 sampling1 progtrue sepfalse shrinkundefined",
    spec: {
      kind: "synthetic",
      width: 19,
      height: 17,
      components: 3,
      sampling: 1,
      progressive: true,
      separate: false
    },
    options: {},
    inputHash: "736802fe9f81afcf69b459d19a0f9c7427810d9e304fb06c90bb50da99c6a448",
    metadata: {
      format: "jpeg",
      width: 19,
      height: 17,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: true,
      size: 217
    },
    expected: {
      width: 19,
      height: 17,
      format: "jpeg",
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: true
    },
    hash: "cc917787872e094a7b55fcd6a54f11e4829a668c16d04c2d6665a5aa4261744e"
  },
  {
    name: "synthetic c3 sampling1 progtrue sepfalse shrink4",
    spec: {
      kind: "synthetic",
      width: 19,
      height: 17,
      components: 3,
      sampling: 1,
      progressive: true,
      separate: false
    },
    options: { maxDecodeDimension: 4 },
    inputHash: "736802fe9f81afcf69b459d19a0f9c7427810d9e304fb06c90bb50da99c6a448",
    metadata: {
      format: "jpeg",
      width: 19,
      height: 17,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: true,
      size: 217
    },
    expected: {
      width: 19,
      height: 17,
      format: "jpeg",
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: true
    },
    hash: "cc917787872e094a7b55fcd6a54f11e4829a668c16d04c2d6665a5aa4261744e"
  },
  {
    name: "synthetic c3 sampling2 progfalse sepfalse shrinkundefined",
    spec: {
      kind: "synthetic",
      width: 19,
      height: 17,
      components: 3,
      sampling: 2,
      progressive: false,
      separate: false
    },
    options: {},
    inputHash: "9c41119a2e349440e6f6e531c9fcceee047b4198dc0c1cfec9d5aa18e5e45b18",
    metadata: {
      format: "jpeg",
      width: 19,
      height: 17,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false,
      size: 177
    },
    expected: {
      width: 19,
      height: 17,
      format: "jpeg",
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false
    },
    hash: "61646474b73e70d88775c556574df067d628f74068164f04a0e216540638bcac"
  },
  {
    name: "synthetic c3 sampling2 progfalse sepfalse shrink4",
    spec: {
      kind: "synthetic",
      width: 19,
      height: 17,
      components: 3,
      sampling: 2,
      progressive: false,
      separate: false
    },
    options: { maxDecodeDimension: 4 },
    inputHash: "9c41119a2e349440e6f6e531c9fcceee047b4198dc0c1cfec9d5aa18e5e45b18",
    metadata: {
      format: "jpeg",
      width: 19,
      height: 17,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false,
      size: 177
    },
    expected: {
      width: 5,
      height: 5,
      format: "jpeg",
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false
    },
    hash: "7195a874f4116a218fbd6a29bdd656743708fec2869f25aa7040c08e9100934d"
  },
  {
    name: "synthetic c3 sampling2 progfalse septrue shrinkundefined",
    spec: {
      kind: "synthetic",
      width: 19,
      height: 17,
      components: 3,
      sampling: 2,
      progressive: false,
      separate: true
    },
    options: {},
    inputHash: "93ef5065cdb4074f15cc8d8b09c1af273fef90ed9a63676e9f88449163e042eb",
    metadata: {
      format: "jpeg",
      width: 19,
      height: 17,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false,
      size: 185
    },
    expected: {
      width: 19,
      height: 17,
      format: "jpeg",
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false
    },
    hash: "3e79b847b336aab6096189176e045d8207d5fec75c7fe686126f3b4c36aff521"
  },
  {
    name: "synthetic c3 sampling2 progfalse septrue shrink4",
    spec: {
      kind: "synthetic",
      width: 19,
      height: 17,
      components: 3,
      sampling: 2,
      progressive: false,
      separate: true
    },
    options: { maxDecodeDimension: 4 },
    inputHash: "93ef5065cdb4074f15cc8d8b09c1af273fef90ed9a63676e9f88449163e042eb",
    metadata: {
      format: "jpeg",
      width: 19,
      height: 17,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false,
      size: 185
    },
    expected: {
      width: 19,
      height: 17,
      format: "jpeg",
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false
    },
    hash: "641e0ed053759561186353db5385b4dba8482db6807e1a490dbafe96dc6ce10f"
  },
  {
    name: "synthetic c3 sampling2 progtrue sepfalse shrinkundefined",
    spec: {
      kind: "synthetic",
      width: 19,
      height: 17,
      components: 3,
      sampling: 2,
      progressive: true,
      separate: false
    },
    options: {},
    inputHash: "2b3c476fdb3d452e66f941ff77eef3eaf2f0634682d76e6f874f9e67525e5225",
    metadata: {
      format: "jpeg",
      width: 19,
      height: 17,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: true,
      size: 210
    },
    expected: {
      width: 19,
      height: 17,
      format: "jpeg",
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: true
    },
    hash: "61646474b73e70d88775c556574df067d628f74068164f04a0e216540638bcac"
  },
  {
    name: "synthetic c3 sampling2 progtrue sepfalse shrink4",
    spec: {
      kind: "synthetic",
      width: 19,
      height: 17,
      components: 3,
      sampling: 2,
      progressive: true,
      separate: false
    },
    options: { maxDecodeDimension: 4 },
    inputHash: "2b3c476fdb3d452e66f941ff77eef3eaf2f0634682d76e6f874f9e67525e5225",
    metadata: {
      format: "jpeg",
      width: 19,
      height: 17,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: true,
      size: 210
    },
    expected: {
      width: 19,
      height: 17,
      format: "jpeg",
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: true
    },
    hash: "61646474b73e70d88775c556574df067d628f74068164f04a0e216540638bcac"
  },
  {
    name: "synthetic c4 sampling1 progfalse sepfalse shrinkundefined",
    spec: {
      kind: "synthetic",
      width: 19,
      height: 17,
      components: 4,
      sampling: 1,
      progressive: false,
      separate: false
    },
    options: {},
    inputHash: "cf5d80a8d024eb8759b3c11f1be737a36e2baa53a78038d6f263b2c8ec1a2ac7",
    metadata: {
      format: "jpeg",
      width: 19,
      height: 17,
      space: "cmyk",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false,
      size: 197
    },
    expected: {
      width: 19,
      height: 17,
      format: "jpeg",
      space: "cmyk",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false
    },
    hash: "b4b346075e1eb4d228089df0b5f05ea9bba9f6e32b5d12082d0a84ac99279c3b"
  },
  {
    name: "synthetic c4 sampling1 progfalse sepfalse shrink4",
    spec: {
      kind: "synthetic",
      width: 19,
      height: 17,
      components: 4,
      sampling: 1,
      progressive: false,
      separate: false
    },
    options: { maxDecodeDimension: 4 },
    inputHash: "cf5d80a8d024eb8759b3c11f1be737a36e2baa53a78038d6f263b2c8ec1a2ac7",
    metadata: {
      format: "jpeg",
      width: 19,
      height: 17,
      space: "cmyk",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false,
      size: 197
    },
    expected: {
      width: 5,
      height: 5,
      format: "jpeg",
      space: "cmyk",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false
    },
    hash: "8b9ffe12c31ee05dc9e2cb0b6f665b7734dee068e12a68d431f01121ef5d84e7"
  },
  {
    name: "synthetic c4 sampling1 progfalse septrue shrinkundefined",
    spec: {
      kind: "synthetic",
      width: 19,
      height: 17,
      components: 4,
      sampling: 1,
      progressive: false,
      separate: true
    },
    options: {},
    inputHash: "b41a1b90ccefe67624abed309532ff93ccdb13241f7018f0893f15dc9d8a4880",
    metadata: {
      format: "jpeg",
      width: 19,
      height: 17,
      space: "cmyk",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false,
      size: 224
    },
    expected: {
      width: 19,
      height: 17,
      format: "jpeg",
      space: "cmyk",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false
    },
    hash: "b4b346075e1eb4d228089df0b5f05ea9bba9f6e32b5d12082d0a84ac99279c3b"
  },
  {
    name: "synthetic c4 sampling1 progfalse septrue shrink4",
    spec: {
      kind: "synthetic",
      width: 19,
      height: 17,
      components: 4,
      sampling: 1,
      progressive: false,
      separate: true
    },
    options: { maxDecodeDimension: 4 },
    inputHash: "b41a1b90ccefe67624abed309532ff93ccdb13241f7018f0893f15dc9d8a4880",
    metadata: {
      format: "jpeg",
      width: 19,
      height: 17,
      space: "cmyk",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false,
      size: 224
    },
    expected: {
      width: 19,
      height: 17,
      format: "jpeg",
      space: "cmyk",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false
    },
    hash: "2e7fcc88500702893554b9020d7886a782c8bea1e4bae72a18f9361f1bc1eb08"
  },
  {
    name: "synthetic c4 sampling1 progtrue sepfalse shrinkundefined",
    spec: {
      kind: "synthetic",
      width: 19,
      height: 17,
      components: 4,
      sampling: 1,
      progressive: true,
      separate: false
    },
    options: {},
    inputHash: "fb24824f102971ca60c922457c7f37d54381b82b8a2b1190d80e7d257f8c2d47",
    metadata: {
      format: "jpeg",
      width: 19,
      height: 17,
      space: "cmyk",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: true,
      size: 246
    },
    expected: {
      width: 19,
      height: 17,
      format: "jpeg",
      space: "cmyk",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: true
    },
    hash: "b4b346075e1eb4d228089df0b5f05ea9bba9f6e32b5d12082d0a84ac99279c3b"
  },
  {
    name: "synthetic c4 sampling1 progtrue sepfalse shrink4",
    spec: {
      kind: "synthetic",
      width: 19,
      height: 17,
      components: 4,
      sampling: 1,
      progressive: true,
      separate: false
    },
    options: { maxDecodeDimension: 4 },
    inputHash: "fb24824f102971ca60c922457c7f37d54381b82b8a2b1190d80e7d257f8c2d47",
    metadata: {
      format: "jpeg",
      width: 19,
      height: 17,
      space: "cmyk",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: true,
      size: 246
    },
    expected: {
      width: 19,
      height: 17,
      format: "jpeg",
      space: "cmyk",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: true
    },
    hash: "b4b346075e1eb4d228089df0b5f05ea9bba9f6e32b5d12082d0a84ac99279c3b"
  },
  {
    name: "synthetic c4 sampling2 progfalse sepfalse shrinkundefined",
    spec: {
      kind: "synthetic",
      width: 19,
      height: 17,
      components: 4,
      sampling: 2,
      progressive: false,
      separate: false
    },
    options: {},
    inputHash: "c429f1f6e8901bcfd2c7ff20d410bf4864246e16c7408d1908c97c73060b704d",
    metadata: {
      format: "jpeg",
      width: 19,
      height: 17,
      space: "cmyk",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false,
      size: 187
    },
    expected: {
      width: 19,
      height: 17,
      format: "jpeg",
      space: "cmyk",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false
    },
    hash: "246c249bf7a5cc67a907137ea1b14aad0aa5465ca0c5a509a8e9dfe07c21cea8"
  },
  {
    name: "synthetic c4 sampling2 progfalse sepfalse shrink4",
    spec: {
      kind: "synthetic",
      width: 19,
      height: 17,
      components: 4,
      sampling: 2,
      progressive: false,
      separate: false
    },
    options: { maxDecodeDimension: 4 },
    inputHash: "c429f1f6e8901bcfd2c7ff20d410bf4864246e16c7408d1908c97c73060b704d",
    metadata: {
      format: "jpeg",
      width: 19,
      height: 17,
      space: "cmyk",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false,
      size: 187
    },
    expected: {
      width: 5,
      height: 5,
      format: "jpeg",
      space: "cmyk",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false
    },
    hash: "75f99c0f14b2812d237a3bd041dbde3f40b2edf0f76035252371bda8b0ac1f7e"
  },
  {
    name: "synthetic c4 sampling2 progfalse septrue shrinkundefined",
    spec: {
      kind: "synthetic",
      width: 19,
      height: 17,
      components: 4,
      sampling: 2,
      progressive: false,
      separate: true
    },
    options: {},
    inputHash: "709a0fc7a60e4caedf6aa39c6f757c9909f15cbb7c280c8476861e81edfb7dc1",
    metadata: {
      format: "jpeg",
      width: 19,
      height: 17,
      space: "cmyk",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false,
      size: 203
    },
    expected: {
      width: 19,
      height: 17,
      format: "jpeg",
      space: "cmyk",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false
    },
    hash: "558c7f2e646f46ee43fc0a7fe5af9671801018a6ffc293fd1a4183c7210de7ab"
  },
  {
    name: "synthetic c4 sampling2 progfalse septrue shrink4",
    spec: {
      kind: "synthetic",
      width: 19,
      height: 17,
      components: 4,
      sampling: 2,
      progressive: false,
      separate: true
    },
    options: { maxDecodeDimension: 4 },
    inputHash: "709a0fc7a60e4caedf6aa39c6f757c9909f15cbb7c280c8476861e81edfb7dc1",
    metadata: {
      format: "jpeg",
      width: 19,
      height: 17,
      space: "cmyk",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false,
      size: 203
    },
    expected: {
      width: 19,
      height: 17,
      format: "jpeg",
      space: "cmyk",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false
    },
    hash: "f626fa63e94d08d3c49cfc9693baf980186c06f3a141b143bc355470b6a40109"
  },
  {
    name: "synthetic c4 sampling2 progtrue sepfalse shrinkundefined",
    spec: {
      kind: "synthetic",
      width: 19,
      height: 17,
      components: 4,
      sampling: 2,
      progressive: true,
      separate: false
    },
    options: {},
    inputHash: "7fd9ba9093492a042116f41b5da81b4e367e15afe8e3b3ee2506cab61fd4fac4",
    metadata: {
      format: "jpeg",
      width: 19,
      height: 17,
      space: "cmyk",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: true,
      size: 231
    },
    expected: {
      width: 19,
      height: 17,
      format: "jpeg",
      space: "cmyk",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: true
    },
    hash: "246c249bf7a5cc67a907137ea1b14aad0aa5465ca0c5a509a8e9dfe07c21cea8"
  },
  {
    name: "synthetic c4 sampling2 progtrue sepfalse shrink4",
    spec: {
      kind: "synthetic",
      width: 19,
      height: 17,
      components: 4,
      sampling: 2,
      progressive: true,
      separate: false
    },
    options: { maxDecodeDimension: 4 },
    inputHash: "7fd9ba9093492a042116f41b5da81b4e367e15afe8e3b3ee2506cab61fd4fac4",
    metadata: {
      format: "jpeg",
      width: 19,
      height: 17,
      space: "cmyk",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: true,
      size: 231
    },
    expected: {
      width: 19,
      height: 17,
      format: "jpeg",
      space: "cmyk",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: true
    },
    hash: "246c249bf7a5cc67a907137ea1b14aad0aa5465ca0c5a509a8e9dfe07c21cea8"
  },
  {
    name: "subsampling threshold 512 c3",
    spec: { kind: "synthetic", width: 512, height: 512, components: 3, sampling: 2 },
    options: {},
    inputHash: "7d0ea9036bd1f385abeb88848eccb784c29db906d609abd6280a989284075dad",
    metadata: {
      format: "jpeg",
      width: 512,
      height: 512,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false,
      size: 7827
    },
    expected: {
      width: 512,
      height: 512,
      format: "jpeg",
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false
    },
    hash: "a6035663fa36b5f4dcef765e0ce2ceaa52254447cf094bfae75c05c670debfe8"
  },
  {
    name: "subsampling threshold 512 c4",
    spec: { kind: "synthetic", width: 512, height: 512, components: 4, sampling: 2 },
    options: {},
    inputHash: "9f526ad921b57d1314855069017c63daa8d3350e0546173c3df123ac94bf35a2",
    metadata: {
      format: "jpeg",
      width: 512,
      height: 512,
      space: "cmyk",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false,
      size: 9112
    },
    expected: {
      width: 512,
      height: 512,
      format: "jpeg",
      space: "cmyk",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false
    },
    hash: "c18126d394a46e2cca868849122350d0231032a98c0e3b0a2f92b6f7fa26d8d9"
  },
  {
    name: "subsampling threshold 513 c3",
    spec: { kind: "synthetic", width: 513, height: 512, components: 3, sampling: 2 },
    options: {},
    inputHash: "d2286d1747be6f5f93ee069b61a4d42ec1e22df627634670a5bcef3c5ad37006",
    metadata: {
      format: "jpeg",
      width: 513,
      height: 512,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false,
      size: 8067
    },
    expected: {
      width: 513,
      height: 512,
      format: "jpeg",
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false
    },
    hash: "61b84e766f4c0d544998f1d6867aa00bfe43720d1fea5d5304945abe9b50ddbe"
  },
  {
    name: "subsampling threshold 513 c4",
    spec: { kind: "synthetic", width: 513, height: 512, components: 4, sampling: 2 },
    options: {},
    inputHash: "7888b4eeb38d2a9b36c110ee83d654d659643c31abcf51eba955a0337fa20a28",
    metadata: {
      format: "jpeg",
      width: 513,
      height: 512,
      space: "cmyk",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false,
      size: 9392
    },
    expected: {
      width: 513,
      height: 512,
      format: "jpeg",
      space: "cmyk",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false
    },
    hash: "1eead9f85e65890f3e2ab85df9e67a20c58df82def6fd814e473cbcbb5c97e7a"
  },
  {
    name: "encoded truncated-1",
    spec: { kind: "encoded", width: 17, height: 19, truncate: -1 },
    options: {},
    inputHash: "5ba11e6c8b5f6ba8c3b3732a3bab5a81eb08656a474a21cd52847d6c7429f7cf",
    metadata: {
      format: "jpeg",
      width: 17,
      height: 19,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 144,
      hasAlpha: false,
      orientation: 6,
      isProgressive: false,
      size: 1165
    },
    expected: {
      width: 17,
      height: 19,
      format: "jpeg",
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 144,
      hasAlpha: false,
      orientation: 6,
      isProgressive: false
    },
    hash: "85aafa1803d7b23d236895cd92ae38daa9b3034fb37c23066ef36f4290df3aaf"
  },
  {
    name: "encoded truncated-2",
    spec: { kind: "encoded", width: 17, height: 19, truncate: -2 },
    options: {},
    inputHash: "09768df6d425eaf9cee351af54353eb4c6611354a306c4fc183dd1df3339ef69",
    metadata: {
      format: "jpeg",
      width: 17,
      height: 19,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 144,
      hasAlpha: false,
      orientation: 6,
      isProgressive: false,
      size: 1164
    },
    expected: {
      width: 17,
      height: 19,
      format: "jpeg",
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 144,
      hasAlpha: false,
      orientation: 6,
      isProgressive: false
    },
    hash: "85aafa1803d7b23d236895cd92ae38daa9b3034fb37c23066ef36f4290df3aaf"
  },
  {
    name: "encoded truncated-3",
    spec: { kind: "encoded", width: 17, height: 19, truncate: -3 },
    options: {},
    inputHash: "1f363c626c01b2f505ee7838464a1501092f36d3f2807a22be9f5e63c3628f74",
    metadata: {
      format: "jpeg",
      width: 17,
      height: 19,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 144,
      hasAlpha: false,
      orientation: 6,
      isProgressive: false,
      size: 1163
    },
    error: "Truncated JPEG entropy data"
  },
  {
    name: "encoded truncated-20",
    spec: { kind: "encoded", width: 17, height: 19, truncate: -20 },
    options: {},
    inputHash: "f69f9cb19258246f03d9bad4398406886e2ed494de4f7d2e83c7527b3cbe1590",
    metadata: {
      format: "jpeg",
      width: 17,
      height: 19,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 144,
      hasAlpha: false,
      orientation: 6,
      isProgressive: false,
      size: 1146
    },
    error: "Truncated JPEG entropy data"
  },
  {
    name: "encoded truncated-100",
    spec: { kind: "encoded", width: 17, height: 19, truncate: -100 },
    options: {},
    inputHash: "711175d67ed2aa8106c9b8bdf07748ff9cc093c85c74760c64fad1eec8947c18",
    metadata: {
      format: "jpeg",
      width: 17,
      height: 19,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 144,
      hasAlpha: false,
      orientation: 6,
      isProgressive: false,
      size: 1066
    },
    error: "Truncated JPEG entropy data"
  },
  {
    name: "encoded truncated-500",
    spec: { kind: "encoded", width: 17, height: 19, truncate: -500 },
    options: {},
    inputHash: "99962bd73e11ce4483fad5ff9cf05a9bd39f066eb08089d54606e29e4aeddebd",
    metadata: {
      format: "jpeg",
      width: 17,
      height: 19,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 144,
      hasAlpha: false,
      orientation: 6,
      isProgressive: false,
      size: 666
    },
    expected: {
      width: 17,
      height: 19,
      format: "jpeg",
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 144,
      hasAlpha: false,
      orientation: 6,
      isProgressive: false
    },
    hash: "d520d853f8aa9bd80f814eda79fdbf7cc5517c569bd942c4ceb54c9e89375df1"
  }
];

import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { decodeJpegToStorage } from "./codecs/jpeg-input-storage.js";
import type { ImageByteStorage } from "./codecs/png-storage.js";

function backing() {
  const pages = new Map<number, Uint8Array>();
  let end = 0;
  const storage: ImageByteStorage = {
    allocate(length) {
      const position = end;
      end += length;
      return position;
    },
    async read(position, length) {
      if (length > 4096 || position < 0 || position + length > end)
        throw new Error("unbounded backing read");
      return Uint8Array.from(
        { length },
        (_, i) => pages.get(Math.floor((position + i) / 4096))?.[(position + i) % 4096] ?? 0
      );
    },
    async write(position, bytes) {
      if (bytes.length > 4096 || position < 0 || position + bytes.length > end)
        throw new Error("unbounded backing write");
      for (let i = 0; i < bytes.length; i++) {
        const at = position + i,
          key = Math.floor(at / 4096);
        let page = pages.get(key);
        if (!page) {
          page = new Uint8Array(4096);
          pages.set(key, page);
        }
        page[at % 4096] = bytes[i]!;
      }
    }
  };
  return storage;
}
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
it.each(jpegInputVectors)("decodes retained JPEG against frozen input $name", async (vector) => {
  const bytes = jpegInputFixture(vector.spec),
    borrowed = new Uint8Array(4096),
    storage = backing();
  expect(digest(bytes)).toBe(vector.inputHash);
  const input = {
    size: bytes.length,
    async read(position: number, length: number) {
      expect(length).toBeLessThanOrEqual(4096);
      borrowed.fill(137);
      borrowed.set(bytes.subarray(position, position + length));
      return borrowed.subarray(0, length);
    }
  };
  const decoded = decodeJpegToStorage(input, storage, new AbortController().signal, vector.options);
  if (vector.error) {
    await expect(decoded).rejects.toThrow(vector.error);
    return;
  }
  const { position, ...metadata } = await decoded;
  expect(metadata).toEqual(vector.expected);
  const hash = createHash("sha256");
  for (let at = 0; at < metadata.width * metadata.height * 4; at += 4096)
    hash.update(
      await storage.read(position + at, Math.min(4096, metadata.width * metadata.height * 4 - at))
    );
  expect(hash.digest("hex")).toBe(vector.hash);
  expect(digest(bytes)).toBe(vector.inputHash);
});

it.each(["png", "ppm", "pgm", "pbm", "bmp", "tiff", "gif", "jpeg"] as const)(
  "publishes retained JPEG as %s without whole-file I/O",
  async (format) => {
    const { MemoryFileSystem } = await import("@poe-code/safe-fs/core"),
      { default: sharp } = await import("./index.js");
    const fs = new MemoryFileSystem(),
      bytes = jpegInputFixture({ kind: "encoded", width: 37, height: 29 });
    await fs.writeFile("/in", bytes);
    const guarded = new Proxy(fs, {
      get(target, key) {
        if (key === "readFile" || key === "writeFile")
          return () => {
            throw new Error("whole-file I/O forbidden");
          };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      }
    });
    const pipeline = (image: ReturnType<typeof sharp>) =>
      image.resize(19, 13).flip().rotate(17).toFormat(format);
    const expected = pipeline(sharp(bytes)).toBufferWithObjectSync(),
      info = await pipeline(sharp("/in", { filesystem: guarded })).toFile("/out"),
      actual = await fs.readFile("/out");
    expect(info).toEqual({ ...expected.info, size: actual.length });
    expect(sharp(actual).raw().toBufferSync()).toEqual(sharp(expected.data).raw().toBufferSync());
    expect((await fs.readdir("/")).map((entry) => entry.name)).toEqual(["in", "out"]);
  }
);
it("resolves JPEG overlays only through the supplied parent filesystem", async () => {
  const { MemoryFileSystem } = await import("@poe-code/safe-fs/core"),
    { default: sharp } = await import("./index.js");
  const fs = new MemoryFileSystem(),
    base = jpegInputFixture({ kind: "encoded", width: 37, height: 29 }),
    overlay = jpegInputFixture({ kind: "encoded", width: 7, height: 9 });
  await fs.writeFile("/base", base);
  await fs.writeFile("/overlay", overlay);
  const guarded = new Proxy(fs, {
    get(target, key) {
      if (key === "readFile" || key === "writeFile")
        return () => {
          throw new Error("whole-file I/O forbidden");
        };
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
  const expected = sharp(base)
    .composite([{ input: overlay, left: 3, top: 4 }])
    .png()
    .toBufferSync();
  await sharp("/base", { filesystem: guarded })
    .composite([{ input: "/overlay", left: 3, top: 4 }])
    .png()
    .toFile("/out");
  expect(
    sharp(await fs.readFile("/out"))
      .raw()
      .toBufferSync()
  ).toEqual(sharp(expected).raw().toBufferSync());
  expect((await fs.readdir("/")).map((entry) => entry.name)).toEqual(["base", "out", "overlay"]);
});

type Event = "source" | "read" | "write" | "allocate";
function harness(
  input: Uint8Array,
  hook?: (event: Event, position: number, length: number) => void
) {
  const memory = new Uint8Array(8 * 1024 * 1024),
    borrowed = new Uint8Array(4096),
    controller = new AbortController();
  let next = 17,
    reads = 0,
    writes = 0;
  const allocations: number[] = [];
  const source = {
    size: input.length,
    async read(position: number, length: number, options?: { signal?: AbortSignal }) {
      expect(options?.signal).toBe(controller.signal);
      expect(length).toBeLessThanOrEqual(4096);
      hook?.("source", position, length);
      await Promise.resolve();
      borrowed.fill(198);
      borrowed.set(input.subarray(position, position + length));
      return borrowed.subarray(0, length);
    }
  };
  const storage = {
    allocate(length: number) {
      hook?.("allocate", next, length);
      allocations.push(length);
      const at = next;
      next += length + 19;
      if (next > memory.length) throw new Error("test backing exhausted");
      return at;
    },
    async read(position: number, length: number, options?: { signal?: AbortSignal }) {
      expect(options?.signal).toBe(controller.signal);
      expect(length).toBeLessThanOrEqual(4096);
      hook?.("read", position, length);
      reads++;
      await Promise.resolve();
      borrowed.fill(177);
      borrowed.set(memory.subarray(position, position + length));
      return borrowed.subarray(0, length);
    },
    async write(position: number, bytes: Uint8Array, options?: { signal?: AbortSignal }) {
      expect(options?.signal).toBe(controller.signal);
      expect(bytes.length).toBeLessThanOrEqual(4096);
      hook?.("write", position, bytes.length);
      writes++;
      await Promise.resolve();
      memory.set(bytes, position);
    }
  };
  return {
    source,
    storage,
    controller,
    memory,
    allocations,
    counts: () => ({ reads, writes }),
    async decode(options?: Parameters<typeof decodeJpegToStorage>[3]) {
      const { position, ...meta } = await decodeJpegToStorage(
        source,
        storage,
        controller.signal,
        options
      );
      return { ...meta, data: memory.slice(position, position + meta.width * meta.height * 4) };
    }
  };
}
const small = () =>
  jpegInputFixture({ kind: "synthetic", width: 17, height: 19, components: 3, sampling: 2 });
for (const spec of [
  { kind: "encoded" as const, width: 1031, height: 37 },
  {
    kind: "synthetic" as const,
    width: 257,
    height: 129,
    components: 3,
    sampling: 2,
    progressive: true
  },
  {
    kind: "synthetic" as const,
    width: 257,
    height: 129,
    components: 4,
    sampling: 2,
    progressive: true
  },
  { kind: "synthetic" as const, width: 513, height: 512, components: 4, sampling: 2 },
  { kind: "synthetic" as const, width: 129, height: 65, components: 3, sampling: 2, separate: true }
])
  it(`matches borrowed source/backing ${JSON.stringify(spec)}`, async () => {
    const input = jpegInputFixture(spec),
      expected = decodeJpegImage(input, { maxDecodeDimension: 128 }),
      env = harness(input);
    expect(await env.decode({ maxDecodeDimension: 128 })).toEqual(expected);
  });
it("isolates simultaneous decoder scratch and caches", async () => {
  const inputs = [
    small(),
    jpegInputFixture({
      kind: "synthetic",
      width: 33,
      height: 29,
      components: 4,
      sampling: 2,
      progressive: true
    })
  ];
  const results = await Promise.all(inputs.map((input) => harness(input).decode()));
  results.forEach((result, i) => expect(result).toEqual(decodeJpegImage(inputs[i]!)));
});
for (const event of ["source", "read", "write", "allocate"] as const)
  it(`retains exact ${event} failure`, async () => {
    const failure = new Error(event);
    const env = harness(small(), (type) => {
      if (type === event) throw failure;
    });
    await expect(env.decode()).rejects.toBe(failure);
  });
for (const event of ["source", "read", "write", "allocate"] as const)
  it(`cancels after ${event}`, async () => {
    const reason = new Error(event);
    const env = harness(small(), (type) => {
      if (type === event) env.controller.abort(reason);
    });
    await expect(env.decode()).rejects.toBe(reason);
  });
it("cancels before admission without acquiring source/storage", async () => {
  let calls = 0;
  const env = harness(small(), () => calls++),
    reason = new Error("start");
  env.controller.abort(reason);
  await expect(env.decode()).rejects.toBe(reason);
  expect(calls).toBe(0);
});
it("rejects pixel limits before backing allocation", async () => {
  const env = harness(small());
  await expect(env.decode({ limitInputPixels: 1 })).rejects.toThrow();
  expect(env.allocations).toEqual([]);
});
it("cancels at scheduler checkpoint", async () => {
  const env = harness(small()),
    reason = new Error("checkpoint"),
    spy = vi.spyOn(defaultRuntime, "yieldTurn").mockImplementation(async () => {
      env.controller.abort(reason);
    });
  try {
    await expect(env.decode()).rejects.toBe(reason);
  } finally {
    spy.mockRestore();
  }
});
it("rejects truncated source ranges", async () => {
  const env = harness(small());
  env.source.read = async () => new Uint8Array();
  await expect(env.decode()).rejects.toThrow("Truncated JPEG source");
});
it("rejects truncated backing ranges", async () => {
  const env = harness(small());
  env.storage.read = async () => new Uint8Array();
  await expect(env.decode()).rejects.toThrow("Truncated JPEG backing storage");
});
for (const position of [-1, NaN, Number.MAX_SAFE_INTEGER])
  it(`rejects invalid backing allocation ${position}`, async () => {
    const env = harness(small());
    env.storage.allocate = () => position;
    await expect(env.decode()).rejects.toThrow("Invalid JPEG backing allocation");
  });
for (const extra of [4088, 4090, 4092, 8190])
  it(`preserves source-window crossings after ${extra} comment bytes`, async () => {
    const plain = small(),
      input = Uint8Array.from([
        255,
        216,
        255,
        254,
        (extra + 2) >>> 8,
        (extra + 2) & 255,
        ...new Array<number>(extra).fill(47),
        ...plain.subarray(2)
      ]);
    expect(await harness(input).decode()).toEqual(decodeJpegImage(input));
  });
it.each(jpegInputVectors.filter((v) => v.error))(
  "preserves malformed input $name",
  async (vector) => {
    const env = harness(jpegInputFixture(vector.spec));
    await expect(env.decode(vector.options)).rejects.toThrow(vector.error);
  }
);
it("does not collect ignored maximum-size marker payloads", async () => {
  const plain = small(),
    input = Uint8Array.from([
      255,
      216,
      255,
      254,
      255,
      255,
      ...new Array<number>(65533).fill(47),
      ...plain.subarray(2)
    ]),
    expected = decodeJpegImage(input),
    env = harness(input),
    Native = Uint8Array;
  let maximum = 0;
  const guarded = new Proxy(Native, {
    construct(target, args) {
      if (typeof args[0] === "number") maximum = Math.max(maximum, args[0]);
      return Reflect.construct(target, args);
    }
  });
  vi.stubGlobal("Uint8Array", guarded);
  try {
    expect(await env.decode()).toEqual(expected);
    expect(maximum).toBeLessThanOrEqual(4096);
  } finally {
    vi.unstubAllGlobals();
  }
});
it("retains four-component conversion when malformed K sampling has no pixels", async () => {
  const input = jpegInputFixture({
    kind: "synthetic",
    width: 3,
    height: 3,
    components: 4,
    sampling: 1
  });
  let marker = 2;
  while (input[marker + 1] !== 0xc0) {
    marker += 2 + (input[marker + 2]! << 8) + input[marker + 3]!;
  }
  input[marker + 20] = 0;
  const expected = decodeJpegImage(input);
  expect(await harness(input).decode()).toEqual(expected);
});
it("bounds entropy pages and one shared backing cache", async () => {
  const input = jpegInputFixture({
      kind: "synthetic",
      width: 257,
      height: 129,
      components: 4,
      sampling: 2,
      progressive: true
    }),
    expected = decodeJpegImage(input),
    env = harness(input),
    Native = Map;
  const peaks: number[] = [];
  class MeasuredMap<K, V> extends Native<K, V> {
    private index = peaks.push(0) - 1;
    override set(key: K, value: V) {
      const result = super.set(key, value);
      peaks[this.index] = Math.max(peaks[this.index] ?? 0, this.size);
      return result;
    }
  }
  vi.stubGlobal("Map", MeasuredMap);
  try {
    expect(await env.decode()).toEqual(expected);
    expect(peaks).toHaveLength(2);
    expect(peaks[0]).toBeLessThanOrEqual(2);
    expect(peaks[1]).toBe(32);
  } finally {
    vi.unstubAllGlobals();
  }
});
it("preserves maximum malformed spectral band across the prepared page boundary", async () => {
  const segment = (m: number, p: number[]) => [
    255,
    m,
    (p.length + 2) >>> 8,
    (p.length + 2) & 255,
    ...p
  ];
  const header = [
    ...segment(219, [0, ...new Array<number>(64).fill(1)]),
    ...segment(194, [8, 0, 1, 0, 1, 1, 1, 17, 0]),
    ...segment(196, [16, ...new Array<number>(15).fill(1), 2, ...new Array<number>(17).fill(15)]),
    ...segment(218, [1, 1, 0, 1, 255, 15])
  ];
  const padding = 4095 - 2 - 4 - header.length;
  const input = Uint8Array.from([
    255,
    216,
    ...segment(254, new Array<number>(padding).fill(42)),
    ...header,
    ...Array.from({ length: 989 }, () => [255, 0]).flat(),
    255,
    217
  ]);
  expect(await harness(input).decode()).toEqual(decodeJpegImage(input));
});
it("scans arbitrarily long restart padding outside the block window", async () => {
  const vector = jpegInputVectors.find(
      (v) => v.name === "consumes restart markers between baseline scan units"
    )!,
    base = jpegInputFixture(vector.spec);
  let offset = 0;
  while (!(base[offset] === 255 && base[offset + 1] === 208)) offset++;
  const input = Uint8Array.from([
    ...base.subarray(0, offset),
    ...new Array<number>(20000).fill(255),
    ...base.subarray(offset)
  ]);
  expect(await harness(input).decode()).toEqual(decodeJpegImage(input));
});
it("cancels during long metadata scanning before allocations", async () => {
  const base = small(),
    input = Uint8Array.from([255, 216, ...new Array<number>(20000).fill(255), ...base.subarray(3)]),
    env = harness(input),
    reason = new Error("metadata checkpoint"),
    spy = vi.spyOn(defaultRuntime, "yieldTurn").mockImplementation(async () => {
      env.controller.abort(reason);
    });
  try {
    await expect(env.decode()).rejects.toBe(reason);
    expect(env.allocations).toEqual([]);
  } finally {
    spy.mockRestore();
  }
});
it("rechecks pixel admission when a later SOF changes the frame dimensions", async () => {
  const base = jpegInputFixture({
    kind: "synthetic",
    width: 3,
    height: 3,
    components: 1,
    sampling: 1
  });
  let sof = 2;
  while (base[sof + 1] !== 0xc0) sof += 2 + (base[sof + 2]! << 8) + base[sof + 3]!;
  const after = sof + 2 + (base[sof + 2]! << 8) + base[sof + 3]!;
  const second = [255, 192, 0, 11, 8, 1, 44, 1, 44, 1, 1, 17, 0];
  const input = Uint8Array.from([...base.subarray(0, after), ...second, ...base.subarray(after)]),
    excess = new Error("oversized frame allocated before admission"),
    env = harness(input, (event, _position, length) => {
      if (event === "allocate" && length > 1000) throw excess;
    });
  await expect(env.decode({ limitInputPixels: 100 })).rejects.toThrow(
    "Input image exceeds pixel limit (300x300 > 100)"
  );
});
for (const cancel of [false, true])
  it(`propagates final dirty-cache flush ${cancel ? "cancellation" : "failure"}`, async () => {
    let writes = 0;
    const reason = new Error("dirty flush");
    const env = harness(small(), (event) => {
      if (event === "write" && ++writes === 5) {
        if (cancel) env.controller.abort(reason);
        else throw reason;
      }
    });
    await expect(env.decode()).rejects.toBe(reason);
    expect(writes).toBe(5);
  });

const workerHash = (bytes: Uint8Array) => {
  let value = 2166136261;
  for (const byte of bytes) value = Math.imul(value ^ byte, 16777619) >>> 0;
  return value;
};
it("decodes retained images and encodes WebP/raw in Workerd using bounded external backing", async () => {
  const cases = [
    { name: "baseline", input: jpegInputFixture({ kind: "encoded", width: 257, height: 129 }) },
    {
      name: "progressive",
      input: jpegInputFixture({
        kind: "synthetic",
        width: 257,
        height: 129,
        components: 3,
        sampling: 2,
        progressive: true
      })
    }
  ];
  const jpeg = cases[0]!.input;
  const tags = [
    [256, 257],
    [257, 129],
    [258, 8],
    [259, 7],
    [262, 2],
    [273, 0],
    [277, 3],
    [278, 129],
    [279, jpeg.length]
  ];
  const start = 8 + 2 + tags.length * 12 + 4,
    tiff = new Uint8Array(start + jpeg.length),
    view = new DataView(tiff.buffer);
  tiff.set([73, 73, 42, 0]);
  view.setUint32(4, 8, true);
  view.setUint16(8, tags.length, true);
  tags.forEach(([tag, value], index) => {
    const at = 10 + index * 12;
    view.setUint16(at, tag!, true);
    view.setUint16(at + 2, 4, true);
    view.setUint32(at + 4, 1, true);
    view.setUint32(at + 8, tag === 273 ? start : value!, true);
  });
  tiff.set(jpeg, start);
  cases.push({ name: "tiff", input: tiff });
  cases.push({name:"webp",input:encodeWebpImage(decodeJpegImage(jpeg))});
  cases.push({name:"text",input:new Uint8Array()});
  cases.push({name:"raw",input:new Uint8Array(Uint16Array.from({length:257*129*4},(_,i)=>(i*433+17)%65536).buffer)});
  const expected = cases.map(({ input, name }) => {
    const { data, data16, ...metadata } = name === "raw"?decodeImage(input,{raw:{width:257,height:129,channels:4,depth:"ushort"}}):name === "text"?decodeImage(undefined,{text:{text:'<span color="red" background="blue">Worker text</span>',width:257,height:129,rgba:true}}):name === "webp"?decodeWebpImage(input):name === "tiff" ? decodeTiffImage(input) : decodeJpegImage(input);
    const steps=computeImageStatsSteps({...metadata,data});let next=steps.next();while(!next.done)next=steps.next();
    const stats=next.value;
    const encoded=encodeWebpImage({...metadata,data});
    const raw=encodeImage({...metadata,data,...(data16?{data16,space:"rgb16" as const}:{})},{format:"raw",rawDepth:"ushort"}).data;
    return { rawLength:raw.length,rawHash:workerHash(raw),stats, metadata, length: data.length, hash: workerHash(data), encodedLength:encoded.length,encodedHash:workerHash(encoded) };
  });
  const stores = cases.map(() => ({
    pages: new Map<number, Uint8Array>(),
    reads: 0,
    writes: 0,
    sourceReads: 0,
    maximum: 0
  }));
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const bundled = await build({
    stdin: {
      resolveDir: root,
      sourcefile: "worker.ts",
      contents: `
 import {decodeRawResource} from './packages/image-ast/src/codecs/resource-storage.ts';
 import {encodeRawFromStorage} from './packages/image-ast/src/codecs/raw-storage.ts';
 import {decodeJpegToStorage} from './packages/image-ast/src/codecs/jpeg-input-storage.ts';
 import {decodeTiffToStorage} from './packages/image-ast/src/codecs/tiff-input-storage.ts';
 import {encodeWebpFromStorage} from './packages/image-ast/src/codecs/webp-storage.ts';
 import {decodeWebpToStorage} from './packages/image-ast/src/codecs/webp-input-storage.ts';
 import {renderTextToStorage} from './packages/image-ast/src/codecs/text-storage.ts';
 import {computeStoredImageStats} from './packages/image-ast/src/ops/stats-storage.ts';
 export default {async fetch(request,env){
  const {id,size,tiff,webp,text,raw}=await request.json(), signal=new AbortController().signal;let next=17,largestAllocation=0,largestTransfer=0,mapPeak=0,allocationCount=0;
  const transfer=async(kind,position,length,bytes)=>{if(length>4096)throw new Error('unbounded transfer');largestTransfer=Math.max(largestTransfer,length);const response=await env.BACKING.fetch('https://backing/'+id+'/'+kind+'?position='+position+'&length='+length,{method:bytes?'POST':'GET',body:bytes});if(!response.ok)throw new Error('backing status '+response.status);return bytes?undefined:new Uint8Array(await response.arrayBuffer());};
  const source={size,read(position,length){return transfer('source',position,length);}};
  const storage={allocate(length){const position=next;next+=length+19;allocationCount++;return position;},read(position,length){return transfer('read',position,length);},write(position,bytes){return transfer('write',position,bytes.length,bytes);}};
  const NativeArray=Uint8Array,NativeMap=Map;
  globalThis.Uint8Array=new Proxy(NativeArray,{construct(target,args){const argument=args[0],length=typeof argument==='number'?argument:argument?.byteLength??argument?.length??0;largestAllocation=Math.max(largestAllocation,length);return Reflect.construct(target,args);}});
  globalThis.Map=class extends NativeMap{set(k,v){const result=super.set(k,v);mapPeak=Math.max(mapPeak,this.size);return result;}};
  let image,stats,rawLength=0,rawHash=2166136261,encodedLength=0,encodedHash=2166136261;try{image=raw?await decodeRawResource(source,storage,{raw:{width:257,height:129,channels:4,depth:"ushort"}},signal):text?await renderTextToStorage({text:{text:'<span color="red" background="blue">Worker text</span>',width:257,height:129,rgba:true}},storage,signal):await (webp?decodeWebpToStorage:tiff?decodeTiffToStorage:decodeJpegToStorage)(source,storage,signal);stats=await computeStoredImageStats(image,storage,signal);for await(const bytes of encodeWebpFromStorage(image,storage,signal)){if(bytes.length>4096)throw new Error("unbounded output");encodedLength+=bytes.length;for(const byte of bytes)encodedHash=Math.imul(encodedHash^byte,16777619)>>>0;}for await(const bytes of encodeRawFromStorage(raw?{...image,space:"rgb16"}:image,storage,signal,{rawDepth:"ushort"})){if(bytes.length>4096)throw new Error("unbounded raw output");rawLength+=bytes.length;for(const byte of bytes)rawHash=Math.imul(rawHash^byte,16777619)>>>0;}}finally{globalThis.Uint8Array=NativeArray;globalThis.Map=NativeMap;}
  const {position,storedData16,...metadata}=image,length=image.width*image.height*4;let hash=2166136261;
  for(let offset=0;offset<length;offset+=4096){const bytes=await storage.read(position+offset,Math.min(4096,length-offset));for(const byte of bytes)hash=Math.imul(hash^byte,16777619)>>>0;}
  return Response.json({rawLength,rawHash,stats,metadata,length,hash,encodedLength,encodedHash,largestAllocation,largestTransfer,mapPeak,allocated:next,allocationCount,nodeGlobals:typeof process!=='undefined'||typeof Buffer!=='undefined'});
 }};`
    },
    bundle: true,
    write: false,
    platform: "browser",
    conditions: ["workerd"],
    format: "esm",
    metafile: true,
    logLevel: "silent"
  });
  expect(Object.values(bundled.metafile!.outputs).flatMap((output) => output.imports)).toEqual([]);
  expect(Object.keys(bundled.metafile!.inputs).some((input) => input.startsWith("node:"))).toBe(
    false
  );
  const runtime = new Miniflare({
    modules: true,
    compatibilityDate: "2026-07-01",
    cf: false,
    script: bundled.outputFiles[0]!.text,
    serviceBindings: {
      BACKING: async (request) => {
        const url = new URL(request.url),
          [, id, operation] = url.pathname.split("/"),
          index = Number(id),
          store = stores[index]!,
          position = Number(url.searchParams.get("position")),
          length = Number(url.searchParams.get("length"));
        if (
          !Number.isSafeInteger(position) ||
          position < 0 ||
          !Number.isSafeInteger(length) ||
          length < 0 ||
          length > 4096
        )
          return new Response("invalid range", { status: 400 });
        store.maximum = Math.max(store.maximum, length);
        if (operation === "source") {
          store.sourceReads++;
          return new Response(cases[index]!.input.slice(position, position + length));
        }
        if (operation === "write") {
          const bytes = new Uint8Array(await request.arrayBuffer());
          if (bytes.length !== length) return new Response("wrong size", { status: 400 });
          store.writes++;
          for (let offset = 0; offset < length; ) {
            const absolute = position + offset,
              page = Math.floor(absolute / 4096),
              local = absolute % 4096,
              count = Math.min(length - offset, 4096 - local);
            let retained = store.pages.get(page);
            if (!retained) {
              retained = new Uint8Array(4096);
              store.pages.set(page, retained);
            }
            retained.set(bytes.subarray(offset, offset + count), local);
            offset += count;
          }
          return new Response(null, { status: 204 });
        }
        if (operation === "read") {
          store.reads++;
          const bytes = new Uint8Array(length);
          for (let offset = 0; offset < length; ) {
            const absolute = position + offset,
              page = Math.floor(absolute / 4096),
              local = absolute % 4096,
              count = Math.min(length - offset, 4096 - local),
              retained = store.pages.get(page);
            if (retained) bytes.set(retained.subarray(local, local + count), offset);
            offset += count;
          }
          return new Response(bytes);
        }
        return new Response("unsupported", { status: 404 });
      }
    }
  });
  try {
    for (const [index, sample] of cases.entries()) {
      const response = await runtime.dispatchFetch("https://jpeg.test/", {
        method: "POST",
        body: JSON.stringify({ id: index, size: sample.input.length, tiff: sample.name === "tiff",webp:sample.name==="webp",text:sample.name==="text",raw:sample.name==="raw" })
      });
      expect(response.status).toBe(200);
      const result = (await response.json()) as Record<string, unknown>;
      expect(result).toMatchObject(expected[index]!);
      expect(result.nodeGlobals).toBe(false);
      expect(result.largestTransfer).toBeLessThanOrEqual(4096);
      expect(result.largestAllocation).toBeLessThanOrEqual(4096);
      expect(result.mapPeak).toBeLessThanOrEqual(32);
      expect(result.allocated).toBeGreaterThan(128 * 1024);
      const store = stores[index]!;
      expect(store.maximum).toBeLessThanOrEqual(4096);
      expect(store.pages.size * 4096).toBeGreaterThan(128 * 1024);
      if(sample.name==="text")expect(store.sourceReads).toBe(0);else expect(store.sourceReads).toBeGreaterThan(0);
      expect(store.reads).toBeGreaterThan(32);
      expect(store.writes).toBeGreaterThan(32);
    }
  } finally {
    await runtime.dispose();
  }
}, 60000);


it("decodes a large baseline JPEG with bounded cooperative scheduling overhead", async () => {
  const input = jpegInputFixture({ kind: "synthetic", width: 513, height: 513, components: 3, sampling: 2 });
  const env = harness(input);
  const checkpoint = vi.spyOn(defaultRuntime, "yieldTurn").mockImplementation(async (signal) => signal.throwIfAborted());
  try {
    expect(await env.decode()).toEqual(decodeJpegImage(input));
    expect(checkpoint.mock.calls.length).toBeLessThanOrEqual(80);
    expect(checkpoint.mock.calls.length).toBeGreaterThan(0);
  } finally {
    checkpoint.mockRestore();
  }
});


it.each([1, 4])("batches wide baseline planes with borrowed storage and %i components", async (components) => {
  const input = jpegInputFixture({ kind: "synthetic", width: 1027, height: 259, components, sampling: 3 });
  expect(await harness(input).decode()).toEqual(decodeJpegImage(input));
});
