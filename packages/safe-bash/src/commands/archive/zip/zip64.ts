import { fail, type ArchiveLimits } from "../internal.js";

function wide(view: DataView, offset: number): number {
  if (offset < 0 || offset + 8 > view.byteLength) fail("ZIP64 truncated numeric field");
  const value = view.getBigUint64(offset, true);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) fail("ZIP64 unsafe numeric field");
  return Number(value);
}

export interface ZipDisks {
  readonly starts: readonly number[];
  readonly lengths: readonly number[];
}

export function zipDiskRecord(disks: ZipDisks | undefined, start: number, end: number): void {
  if (!disks) return;
  let disk = disks.starts.length - 1;
  while (disk >= 0 && disks.starts[disk]! > start) disk--;
  if (disk < 0 || end > disks.starts[disk]! + disks.lengths[disk]!) fail("ZIP record straddles volume boundary");
}

export function zipDiskOffset(disks: ZipDisks | undefined, disk: number, offset: number): number {
  if (!Number.isSafeInteger(disk) || disk < 0 || !Number.isSafeInteger(offset) || offset < 0) fail("ZIP invalid disk offset");
  if (!disks) { if (disk) fail("ZIP multi-disk archive requires a volume resolver"); return offset; }
  if (disk >= disks.starts.length || offset >= disks.lengths[disk]!) fail("ZIP disk offset outside volume");
  return disks.starts[disk]! + offset;
}

export function zip64Directory(view: DataView, end: number, limits: ArchiveLimits, disks?: ZipDisks) {
  zipDiskRecord(disks, end, view.byteLength);
  let members = view.getUint16(end + 10, true);
  let centralSize = view.getUint32(end + 12, true);
  let centralStart = view.getUint32(end + 16, true);
  let centralEnd = end;
  let zip64Disk = -1, zip64DiskMembers = -1;
  let diskMembers = view.getUint16(end + 8, true);
  const disk = view.getUint16(end + 4, true);
  if (!disks && disk) fail("ZIP multi-disk archive requires a volume resolver");
  const centralDisk = view.getUint16(end + 6, true);
  if (disks && disk !== disks.starts.length - 1) fail("ZIP final disk number mismatch");
  if (centralStart !== 0xffffffff) centralStart = zipDiskOffset(disks, centralDisk, centralStart);
  const locator = end >= 20 && view.getUint32(end - 20, true) === 0x07064b50;
  if (locator) {
    zipDiskRecord(disks, end - 20, end);
    const recordDisk = view.getUint32(end - 16, true);
    if (view.getUint32(end - 4, true) !== (disks?.starts.length ?? 1)) fail("ZIP64 multi-disk locator count mismatch");
    centralEnd = zipDiskOffset(disks, recordDisk, wide(view, end - 12));
    if (centralEnd > end - 76 || view.getUint32(centralEnd, true) !== 0x06064b50) fail("ZIP64 invalid end-record span");
    const length = wide(view, centralEnd + 4);
    if (length < 44 || length - 44 > limits.maxPaxBytes || length !== end - 32 - centralEnd) fail("ZIP64 invalid end-record length");
    zipDiskRecord(disks, centralEnd, centralEnd + 12 + length);
    const version = view.getUint16(centralEnd + 14, true);
    if (version < 45 || version > 46) fail("ZIP64 unsupported end-record extraction version");
    if (view.getUint32(centralEnd + 16, true) !== recordDisk || view.getUint32(centralEnd + 20, true) !== centralDisk) fail("ZIP64 inconsistent disk numbers");
    const count = wide(view, centralEnd + 32);
    const wideDiskMembers = wide(view, centralEnd + 24);
    if (wideDiskMembers > count || recordDisk === disk && wideDiskMembers !== diskMembers && diskMembers !== 65535 || members !== 65535 && members !== count || !disks && wideDiskMembers !== count) fail("ZIP64 inconsistent member count");
    if (recordDisk === disk) diskMembers = wideDiskMembers;
    zip64Disk = recordDisk; zip64DiskMembers = wideDiskMembers;
    const size = wide(view, centralEnd + 40);
    const start = zipDiskOffset(disks, centralDisk, wide(view, centralEnd + 48));
    if (centralSize !== 0xffffffff && centralSize !== size || centralStart !== 0xffffffff && centralStart !== start) fail("ZIP64 inconsistent central directory");
    members = count;
    centralSize = size;
    centralStart = start;
  } else if (centralSize === 0xffffffff || centralStart === 0xffffffff) fail("ZIP64 missing end record and locator");
  else if (!disks && diskMembers !== members) fail("ZIP inconsistent member count");
  if (members > limits.maxMembers) fail("ZIP member limit exceeded");
  if (centralStart > limits.maxArchiveBytes || centralSize > limits.maxArchiveBytes || centralSize !== centralEnd - centralStart) fail("ZIP invalid central directory span");
  return { members, centralStart, centralSize, centralEnd, diskMembers, disk, zip64Disk, zip64DiskMembers };
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
  values.forEach(counter);
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
  [offset, count, size, start, recordOffset].forEach(counter);
  if (offset > view.byteLength - 76) fail("ZIP64 truncated end-record destination");
  view.setUint32(offset, 0x06064b50, true);
  view.setBigUint64(offset + 4, 44n, true);
  view.setUint16(offset + 12, 0x32d, true);
  view.setUint16(offset + 14, 45, true);
  view.setUint32(offset + 16, 0, true);
  view.setUint32(offset + 20, 0, true);
  view.setBigUint64(offset + 24, BigInt(count), true);
  view.setBigUint64(offset + 32, BigInt(count), true);
  view.setBigUint64(offset + 40, BigInt(size), true);
  view.setBigUint64(offset + 48, BigInt(start), true);
  view.setUint32(offset + 56, 0x07064b50, true);
  view.setUint32(offset + 60, 0, true);
  view.setBigUint64(offset + 64, BigInt(recordOffset), true);
  view.setUint32(offset + 72, 1, true);
  return offset + 76;
}

function counter(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) fail("ZIP64 unsafe or invalid numeric field");
}

export function zip64Member(size: number, compressed: number, offset: number, force = false, allowed = true, forceSizes = false) {
  [size, compressed, offset].forEach(counter);
  const widths = [size, compressed, offset].map((value, index) => force || forceSizes && index < 2 || value >= 0xffffffff);
  if (!allowed && widths.some(Boolean)) fail("ZIP64 required but disabled");
  return {
    size: widths[0] ? 0xffffffff : size,
    compressed: widths[1] ? 0xffffffff : compressed,
    offset: widths[2] ? 0xffffffff : offset,
    values: [size, compressed, offset].filter((_, index) => widths[index]),
    wide: widths.some(Boolean),
  };
}

export function zipEnd(count: number, size: number, start: number, comment: Uint8Array, force = false, allowed = true): Uint8Array {
  [count, size, start].forEach(counter);
  if (size > Number.MAX_SAFE_INTEGER - start) fail("ZIP64 unsafe directory sum");
  if (comment.length > 65535) fail("ZIP archive comment limit exceeded");
  const wide = force || count >= 65535 || size >= 0xffffffff || start >= 0xffffffff;
  if (wide && !allowed) fail("ZIP64 required but disabled");
  const length = (wide ? 76 : 0) + 22 + comment.length;
  if (start + size > Number.MAX_SAFE_INTEGER - length) fail("ZIP64 unsafe archive sum");
  const bytes = new Uint8Array(length);
  const view = new DataView(bytes.buffer);
  const end = wide ? writeZip64End(view, 0, count, size, start, start + size) : 0;
  view.setUint32(end, 0x06054b50, true);
  view.setUint16(end + 8, Math.min(count, 65535), true);
  view.setUint16(end + 10, Math.min(count, 65535), true);
  view.setUint32(end + 12, size >= 0xffffffff ? 0xffffffff : size, true);
  view.setUint32(end + 16, start >= 0xffffffff ? 0xffffffff : start, true);
  view.setUint16(end + 20, comment.length, true);
  bytes.set(comment, end + 22);
  return bytes;
}

export function zipDescriptor(checksum: number, compressed: number, size: number, wide: boolean, signed = true): Uint8Array {
  [checksum, compressed, size].forEach(counter);
  if (checksum > 0xffffffff) fail("ZIP invalid descriptor checksum");
  if (!wide && (compressed >= 0xffffffff || size >= 0xffffffff)) fail("ZIP64 descriptor required");
  const bytes = new Uint8Array((signed ? 4 : 0) + (wide ? 20 : 12));
  const view = new DataView(bytes.buffer);
  const base = signed ? 4 : 0;
  if (signed) view.setUint32(0, 0x08074b50, true);
  view.setUint32(base, checksum, true);
  if (wide) {
    view.setBigUint64(base + 4, BigInt(compressed), true);
    view.setBigUint64(base + 12, BigInt(size), true);
  } else {
    view.setUint32(base + 4, compressed, true);
    view.setUint32(base + 8, size, true);
  }
  return bytes;
}
