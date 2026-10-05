import { decodeFourCC } from "./binary.js";

const containers = new Set([
  "moov",
  "trak",
  "edts",
  "mdia",
  "minf",
  "dinf",
  "stbl",
  "mvex",
  "moof",
  "traf",
  "mfra",
  "udta",
  "ilst",
  "sinf",
  "schi",
  "tref",
  "gmhd"
]);

/** Shared clipping and UUID rules for resident and range-based box readers. */
export function mp4BoxLayout(prefix: Uint8Array, remaining: number): { type: string; size: number; headerSize: number; uuidOffset?: number } | undefined {
  if (prefix.length < 8) return undefined;
  const view = new DataView(prefix.buffer, prefix.byteOffset, prefix.length);
  let size = view.getUint32(0), headerSize = 8;
  const type = decodeFourCC(prefix, 4);
  if (size === 1) {
    if (prefix.length < 16) return undefined;
    size = view.getUint32(8) * 4294967296 + view.getUint32(12); headerSize = 16;
  } else if (size === 0) size = remaining;
  if (size < headerSize || size > remaining) { size = remaining; if (size < headerSize) return undefined; }
  if (type === "uuid" && headerSize + 16 <= size) return { type, size, headerSize: headerSize + 16, uuidOffset: headerSize };
  return { type, size, headerSize };
}

export function mp4BoxChildrenOffset(type: string, payloadSize: number, metaChildType?: string): number | undefined {
  if (containers.has(type)) return 0;
  if (type !== "meta" || payloadSize < 12) return undefined;
  return metaChildType === "hdlr" || metaChildType === "ilst" || metaChildType === "keys" || metaChildType === "free" ? 4 : 0;
}
