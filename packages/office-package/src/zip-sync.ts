import { ByteCodecError, transformBytes } from "@poe-code/compression";

// Synchronous stored/raw-DEFLATE ZIP access for office document fast paths.
function crc32Bytes(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    c ^= data[i]!;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

export function createStoredZipArchive(entries: Readonly<Record<string, Uint8Array>>): Uint8Array {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;
  let count = 0;

  for (const [name, content] of Object.entries(entries)) {
    const nameBytes = new TextEncoder().encode(name);
    const crc = crc32Bytes(content);
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(localHeader.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0, true);
    lv.setUint16(8, 0, true); // stored
    lv.setUint32(14, crc, true);
    lv.setUint32(18, content.length, true);
    lv.setUint32(22, content.length, true);
    lv.setUint16(26, nameBytes.length, true);
    localHeader.set(nameBytes, 30);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(centralHeader.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(10, 0, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, content.length, true);
    cv.setUint32(24, content.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    centralHeader.set(nameBytes, 46);

    localParts.push(localHeader, content);
    centralParts.push(centralHeader);
    offset += localHeader.length + content.length;
    count++;
  }

  const centralSize = centralParts.reduce((s, p) => s + p.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, count, true);
  ev.setUint16(10, count, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  const total = offset + centralSize + 22;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of [...localParts, ...centralParts, eocd]) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}

export function readZipArchiveEntries(zipBytes: Uint8Array): Map<string, Uint8Array> {
  const map = new Map<string, Uint8Array>();
  const view = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);
  let eocdPos = -1;
  for (let i = zipBytes.length - 22; i >= Math.max(0, zipBytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdPos = i;
      break;
    }
  }
  if (eocdPos < 0) throw new Error("Invalid ZIP: missing end of central directory");
  const count = view.getUint16(eocdPos + 10, true);
  let cdPos = view.getUint32(eocdPos + 16, true);

  for (let i = 0; i < count; i++) {
    if (cdPos + 46 > zipBytes.length || view.getUint32(cdPos, true) !== 0x02014b50) {
      throw new Error("Invalid ZIP: truncated central directory");
    }
    const method = view.getUint16(cdPos + 10, true);
    const compSize = view.getUint32(cdPos + 20, true);
    const nameLen = view.getUint16(cdPos + 28, true);
    const extraLen = view.getUint16(cdPos + 30, true);
    const commentLen = view.getUint16(cdPos + 32, true);
    const localOffset = view.getUint32(cdPos + 42, true);
    if (cdPos + 46 + nameLen + extraLen + commentLen > zipBytes.length ||
        localOffset + 30 > zipBytes.length || view.getUint32(localOffset, true) !== 0x04034b50) {
      throw new Error("Invalid ZIP: truncated or invalid entry header");
    }
    const name = new TextDecoder().decode(zipBytes.subarray(cdPos + 46, cdPos + 46 + nameLen));

    const localNameLen = view.getUint16(localOffset + 26, true);
    const localExtraLen = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    if (dataStart + compSize > zipBytes.length) {
      throw new Error("Invalid ZIP: truncated entry data");
    }
    const rawData = zipBytes.subarray(dataStart, dataStart + compSize);

    if (method === 0) {
      map.set(name, new Uint8Array(rawData));
    } else if (method === 8) {
      try {
        map.set(name, transformBytes(rawData, {direction: "decode", format: "raw"}));
      } catch (error) {
        // Preserve this byte API's established backend diagnostics.
        if (error instanceof ByteCodecError) {
          throw new Error(error.code === "truncated" ? "buffer error" : error.message);
        }
        throw error;
      }
    }
    cdPos += 46 + nameLen + extraLen + commentLen;
  }
  return map;
}
