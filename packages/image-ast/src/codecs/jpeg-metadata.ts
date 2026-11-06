import type { ImageMetadata } from "../ast.js";
import { JpegTables } from "./jpeg-tables.js";
import { parseExifBuffer } from "./exif.js";
export interface JpegMetadataState {
  properties?: Record<string, string>;
  icc?: Uint8Array;
  iccParts?: Map<number, Uint8Array>;
  iccCount?: number;
  jpegSamplingFactor?: string;
  tables?: JpegTables;
  quality?: number | undefined;
  width: number;
  height: number;
  channels: 1 | 2 | 3 | 4;
  isProgressive: boolean;
  density: number;
  resolution?: ImageMetadata["resolution"];
  orientation: number | undefined;
}
/** Read headers through SOS: quantization tables can follow the frame header. */
export function applyJpegMetadata(
  state: JpegMetadataState,
  marker: number,
  payload: Uint8Array
): boolean {
  if (marker === 0xfe) {
    state.properties ??= {};
    state.properties.comment = (state.properties.comment ?? "") + new TextDecoder().decode(payload);
  }
  let { width, height, channels, isProgressive, density, orientation } = state;
  if (marker === 0xe2 && payload.length >= 14 && new TextDecoder().decode(payload.subarray(0, 12)) === "ICC_PROFILE\0") {
    const index = payload[12]!, count = payload[13]!;
    if (!index || index > count || (state.iccCount !== undefined && state.iccCount !== count) || state.iccParts?.has(index)) throw new Error("Invalid JPEG ICC sequence");
    state.iccCount = count;
    (state.iccParts ??= new Map()).set(index, payload.slice(14));
    if (state.iccParts.size === count) {
      let length = 0;
      for (const part of state.iccParts.values()) length += part.length;
      state.icc = new Uint8Array(length); let offset = 0;
      for (let i = 1; i <= count; i++) { const part = state.iccParts.get(i)!; state.icc.set(part, offset); offset += part.length; }
    }
  }
  if (marker === 0xda && state.iccParts && !state.icc) throw new Error("Incomplete JPEG ICC sequence");
  if (marker === 0xdb) {
    state.tables ??= new JpegTables();
    state.tables.read(marker, payload);
    state.quality = estimateJpegQuality(state.tables.quantTables);
  }
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
      const yDensity = (payload[10]! << 8) | payload[11]!;
      const xDensity = (payload[8]! << 8) | payload[9]!;
      if (xDensity > 0) {
        state.resolution = {x:xDensity,y:yDensity,unit:units===1?"inch":units===2?"cm":"unknown"};
        if (units === 1) density = xDensity;
        else if (units === 2) density = Math.round(xDensity * 2.54);
      }
    }
  } else if (marker === 0xe1 && payload.length >= 8) {
    // EXIF APP1
    const exif = parseExifBuffer(payload);
    if (exif.orientation !== undefined) orientation = exif.orientation;
    if (exif.resolution !== undefined) state.resolution = exif.resolution;
    if (exif.density !== undefined) density = exif.density;
  } else if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
    isProgressive = marker === 0xc2;
    height = (payload[1]! << 8) | payload[2]!;
    width = (payload[3]! << 8) | payload[4]!;
    const comps = payload[5]!;
    channels = comps === 1 ? 1 : comps === 4 ? 4 : 3;
    if (comps > 0 && payload.length >= 6 + comps * 3) {
      const factors: string[] = [];
      for (let i = 0; i < comps; i++) {
        const factor = payload[7 + i * 3]!;
        factors.push(`${factor >>> 4}x${factor & 15}`);
      }
      state.jpegSamplingFactor = factors.join(",");
    }
  }
  Object.assign(state, { width, height, channels, isProgressive, density, orientation });
  return marker === 0xda;
}

// ImageMagick coders/jpeg.c quality thresholds for color and grayscale JPEGs.
const COLOR_HASH = [
  1020, 1015, 932, 848, 780, 735, 702, 679, 660, 645,
  632, 623, 613, 607, 600, 594, 589, 585, 581, 571,
  555, 542, 529, 514, 494, 474, 457, 439, 424, 410,
  397, 386, 373, 364, 351, 341, 334, 324, 317, 309,
  299, 294, 287, 279, 274, 267, 262, 257, 251, 247,
  243, 237, 232, 227, 222, 217, 213, 207, 202, 198,
  192, 188, 183, 177, 173, 168, 163, 157, 153, 148,
  143, 139, 132, 128, 125, 119, 115, 108, 104, 99,
  94, 90, 84, 79, 74, 70, 64, 59, 55, 49,
  45, 40, 34, 30, 25, 20, 15, 11, 6, 4,
  0
];
const COLOR_SUMS = [
  32640, 32635, 32266, 31495, 30665, 29804, 29146, 28599, 28104, 27670,
  27225, 26725, 26210, 25716, 25240, 24789, 24373, 23946, 23572, 22846,
  21801, 20842, 19949, 19121, 18386, 17651, 16998, 16349, 15800, 15247,
  14783, 14321, 13859, 13535, 13081, 12702, 12423, 12056, 11779, 11513,
  11135, 10955, 10676, 10392, 10208, 9928, 9747, 9564, 9369, 9193,
  9017, 8822, 8639, 8458, 8270, 8084, 7896, 7710, 7527, 7347,
  7156, 6977, 6788, 6607, 6422, 6236, 6054, 5867, 5684, 5495,
  5305, 5128, 4945, 4751, 4638, 4442, 4248, 4065, 3888, 3698,
  3509, 3326, 3139, 2957, 2775, 2586, 2405, 2216, 2037, 1846,
  1666, 1483, 1297, 1109, 927, 735, 554, 375, 201, 128,
  0
];
const GRAY_HASH = [
  510, 505, 422, 380, 355, 338, 326, 318, 311, 305,
  300, 297, 293, 291, 288, 286, 284, 283, 281, 280,
  279, 278, 277, 273, 262, 251, 243, 233, 225, 218,
  211, 205, 198, 193, 186, 181, 177, 172, 168, 164,
  158, 156, 152, 148, 145, 142, 139, 136, 133, 131,
  129, 126, 123, 120, 118, 115, 113, 110, 107, 105,
  102, 100, 97, 94, 92, 89, 87, 83, 81, 79,
  76, 74, 70, 68, 66, 63, 61, 57, 55, 52,
  50, 48, 44, 42, 39, 37, 34, 31, 29, 26,
  24, 21, 18, 16, 13, 11, 8, 6, 3, 2,
  0
];
const GRAY_SUMS = [
  16320, 16315, 15946, 15277, 14655, 14073, 13623, 13230, 12859, 12560,
  12240, 11861, 11456, 11081, 10714, 10360, 10027, 9679, 9368, 9056,
  8680, 8331, 7995, 7668, 7376, 7084, 6823, 6562, 6345, 6125,
  5939, 5756, 5571, 5421, 5240, 5086, 4976, 4829, 4719, 4616,
  4463, 4393, 4280, 4166, 4092, 3980, 3909, 3835, 3755, 3688,
  3621, 3541, 3467, 3396, 3323, 3247, 3170, 3096, 3021, 2952,
  2874, 2804, 2727, 2657, 2583, 2509, 2437, 2362, 2290, 2211,
  2136, 2068, 1996, 1915, 1858, 1773, 1692, 1620, 1552, 1477,
  1398, 1326, 1251, 1179, 1109, 1031, 961, 884, 814, 736,
  667, 592, 518, 441, 369, 292, 221, 151, 86, 64,
  0
];

function estimateJpegQuality(tables: readonly Uint16Array[]): number | undefined {
  const luma = tables[0], chroma = tables[1];
  if (!luma) return undefined;
  let sum = 0;
  for (const table of tables) if (table) for (const value of table) sum += value;
  // DQT entries are zigzag ordered: natural indices 2 and 53 are 5 and 58.
  const value = luma[5]! + luma[58]! + (chroma ? chroma[0]! + chroma[63]! : 0);
  const hashes = chroma ? COLOR_HASH : GRAY_HASH;
  const sums = chroma ? COLOR_SUMS : GRAY_SUMS;
  for (let i = 0; i < 100; i++) {
    if (value < hashes[i]! && sum < sums[i]!) continue;
    return (value <= hashes[i]! && sum <= sums[i]!) || i >= 50 ? i + 1 : undefined;
  }
  return undefined;
}
