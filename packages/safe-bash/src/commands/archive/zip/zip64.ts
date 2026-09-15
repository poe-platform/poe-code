import { fail, type ArchiveLimits } from "../internal.js";

function wide(view: DataView, offset: number): number {
  if (offset < 0 || offset + 8 > view.byteLength) fail("ZIP64 truncated numeric field");
  const value = view.getBigUint64(offset, true);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) fail("ZIP64 unsafe numeric field");
  return Number(value);
}

export function zip64Directory(view: DataView, end: number, limits: ArchiveLimits) {
  let members = view.getUint16(end + 10, true);
  let centralSize = view.getUint32(end + 12, true);
  let centralStart = view.getUint32(end + 16, true);
  let centralEnd = end;
  const diskMembers = view.getUint16(end + 8, true);
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true)) fail("ZIP multi-disk archive is unsupported");
  const locator = end >= 20 && view.getUint32(end - 20, true) === 0x07064b50;
  if (locator) {
    if (view.getUint32(end - 16, true) || view.getUint32(end - 4, true) !== 1) fail("ZIP64 multi-disk locator is unsupported");
    centralEnd = wide(view, end - 12);
    if (centralEnd + 56 > end - 20 || view.getUint32(centralEnd, true) !== 0x06064b50) fail("ZIP64 invalid end-record span");
    const length = wide(view, centralEnd + 4);
    if (length < 44 || length - 44 > limits.maxPaxBytes || centralEnd + 12 + length !== end - 20) fail("ZIP64 invalid end-record length");
    if (view.getUint16(centralEnd + 14, true) !== 45) fail("ZIP64 unsupported end-record extraction version");
    if (view.getUint32(centralEnd + 16, true) || view.getUint32(centralEnd + 20, true)) fail("ZIP64 multi-disk archive is unsupported");
    const count = wide(view, centralEnd + 32);
    if (wide(view, centralEnd + 24) !== count || members !== 65535 && members !== count || diskMembers !== 65535 && diskMembers !== count) fail("ZIP64 inconsistent member count");
    const size = wide(view, centralEnd + 40);
    const start = wide(view, centralEnd + 48);
    if (centralSize !== 0xffffffff && centralSize !== size || centralStart !== 0xffffffff && centralStart !== start) fail("ZIP64 inconsistent central directory");
    members = count;
    centralSize = size;
    centralStart = start;
  } else if (members === 65535 || centralSize === 0xffffffff || centralStart === 0xffffffff) fail("ZIP64 missing end record and locator");
  else if (diskMembers !== members) fail("ZIP inconsistent member count");
  if (members > limits.maxMembers) fail("ZIP member limit exceeded");
  if (centralStart > limits.maxArchiveBytes || centralSize > limits.maxArchiveBytes || centralStart + centralSize !== centralEnd) fail("ZIP invalid central directory span");
  return { members, centralStart, centralSize, centralEnd };
}

export function zip64Fields(data: Uint8Array | undefined, values: readonly number[]): number[] {
  let offset = 0;
  const view = data && new DataView(data.buffer, data.byteOffset, data.byteLength);
  return values.map((value, index) => {
    if (value !== 0xffffffff) return value;
    if (!view) fail("ZIP64 missing required extra field");
    const width = index === 3 ? 4 : 8;
    if (offset + width > view.byteLength) fail("ZIP64 truncated extra field");
    const resolved = width === 4 ? view.getUint32(offset, true) : wide(view, offset);
    offset += width;
    return resolved;
  });
}

export function stripZip64(bytes: Uint8Array): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const retained: Uint8Array[] = [];
  let length = 0;
  for (let offset = 0; offset < bytes.length;) {
    if (offset + 4 > bytes.length) fail("ZIP truncated extra field");
    const next = offset + 4 + view.getUint16(offset + 2, true);
    if (next > bytes.length) fail("ZIP truncated extra field payload");
    if (view.getUint16(offset, true) !== 1) {
      retained.push(bytes.subarray(offset, next));
      length += next - offset;
    }
    offset = next;
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const field of retained) { result.set(field, offset); offset += field.length; }
  return result;
}

export function zip64Extra(values: readonly number[], retained: Uint8Array): Uint8Array {
  if (retained.length + 4 + values.length * 8 > 65535) fail("ZIP64 extra field limit exceeded");
  const bytes = new Uint8Array(4 + values.length * 8 + retained.length);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, 1, true);
  view.setUint16(2, values.length * 8, true);
  values.forEach((value, index) => view.setBigUint64(4 + index * 8, BigInt(value), true));
  bytes.set(retained, 4 + values.length * 8);
  return bytes;
}

export function writeZip64End(view: DataView, offset: number, count: number, size: number, start: number, recordOffset = offset): number {
  view.setUint32(offset, 0x06064b50, true);
  view.setBigUint64(offset + 4, 44n, true);
  view.setUint16(offset + 12, 0x32d, true);
  view.setUint16(offset + 14, 45, true);
  view.setBigUint64(offset + 24, BigInt(count), true);
  view.setBigUint64(offset + 32, BigInt(count), true);
  view.setBigUint64(offset + 40, BigInt(size), true);
  view.setBigUint64(offset + 48, BigInt(start), true);
  view.setUint32(offset + 56, 0x07064b50, true);
  view.setBigUint64(offset + 64, BigInt(recordOffset), true);
  view.setUint32(offset + 72, 1, true);
  return offset + 76;
}
