import { SsconvertError, type CapabilityContext } from "../contracts.js";

export function invalidBiff(message: string): never {
  throw new SsconvertError("io", `E Invalid Excel BIFF: ${message}`);
}

/** All binary reads, including slices, require explicit admission. */
export class Binary {
  readonly view: DataView;
  constructor(readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  check(offset: number, length: number): void {
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 ||
      offset > this.bytes.length - length) invalidBiff("truncated binary data");
  }
  u8(offset: number): number { this.check(offset, 1); return this.view.getUint8(offset); }
  u16(offset: number): number { this.check(offset, 2); return this.view.getUint16(offset, true); }
  u32(offset: number): number { this.check(offset, 4); return this.view.getUint32(offset, true); }
  f64(offset: number): number { this.check(offset, 8); return this.view.getFloat64(offset, true); }
  slice(offset: number, length: number): Uint8Array { this.check(offset, length); return this.bytes.subarray(offset, offset + length); }
}

const signature = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const free = 0xffffffff, end = 0xfffffffe;
export function isCfb(bytes: Uint8Array): boolean { return signature.every((byte, index) => bytes[index] === byte); }

interface Entry { name: string; type: number; left: number; right: number; child: number; start: number; size: number; }

/** Only root-owned streams are exposed. FAT and directory references are never host paths. */
export function readCfb(bytes: Uint8Array, context: CapabilityContext): ReadonlyMap<string, Uint8Array> {
  context.signal.throwIfAborted();
  if (bytes.length > context.limits.inputBytes) throw new SsconvertError("resource-limit", "ssconvert input bytes limit exceeded");
  const file = new Binary(bytes); file.check(0, 512);
  if (!isCfb(bytes) || file.u16(28) !== 0xfffe) invalidBiff("invalid CFB header");
  const version = file.u16(26), shift = file.u16(30);
  if (!(version === 3 && shift === 9 || version === 4 && shift === 12) || file.u16(32) !== 6)
    invalidBiff("unsupported CFB sector layout");
  const sectorSize = 2 ** shift, sectorCount = Math.floor(bytes.length / sectorSize) - 1;
  if (sectorCount < 0 || bytes.length % sectorSize !== 0 || file.u32(56) !== 4096) invalidBiff("invalid CFB size");
  const sector = (id: number): Binary => {
    context.signal.throwIfAborted();
    if (id >= sectorCount) invalidBiff("CFB sector outside file");
    return new Binary(file.slice((id + 1) * sectorSize, sectorSize));
  };
  const fatCount = file.u32(44), difatCount = file.u32(72), miniCount = file.u32(64);
  if (fatCount > sectorCount || difatCount > sectorCount || miniCount > sectorCount) invalidBiff("invalid CFB chain count");
  const fatIds: number[] = [], seenDifat = new Set<number>();
  const addFat = (id: number) => {
    if (id === free) return;
    if (id >= sectorCount || fatIds.length >= fatCount || fatIds.includes(id)) invalidBiff("invalid CFB FAT sector");
    fatIds.push(id);
  };
  for (let offset = 76; offset < 512; offset += 4) addFat(file.u32(offset));
  let difat = file.u32(68);
  for (let index = 0; index < difatCount; index++) {
    if (seenDifat.has(difat)) invalidBiff("CFB DIFAT cycle"); seenDifat.add(difat);
    const data = sector(difat);
    for (let offset = 0; offset < sectorSize - 4; offset += 4) addFat(data.u32(offset));
    difat = data.u32(sectorSize - 4);
  }
  if (difatCount && difat !== end || fatIds.length !== fatCount) invalidBiff("CFB FAT count mismatch");
  const fatSectors = fatIds.map(sector), fatWidth = sectorSize / 4;
  const nextFat = (id: number): number => {
    if (id >= sectorCount || !fatSectors[Math.floor(id / fatWidth)]) invalidBiff("CFB FAT reference outside table");
    return fatSectors[Math.floor(id / fatWidth)]!.u32(id % fatWidth * 4);
  };
  const chain = (start: number, maximum: number, next: (id: number) => number): number[] => {
    const ids: number[] = [], seen = new Set<number>();
    for (let id = start; id !== end; id = next(id)) {
      context.signal.throwIfAborted();
      if (seen.has(id)) invalidBiff("CFB chain cycle");
      if (ids.length >= maximum) invalidBiff("CFB chain exceeds declared size");
      seen.add(id); ids.push(id);
    }
    return ids;
  };
  let allocated = 0;
  const collect = (ids: readonly number[], size: number, width: number, source: (id: number) => Binary): Uint8Array => {
    if (size > context.limits.inputBytes - allocated) throw new SsconvertError("resource-limit", "ssconvert CFB decoded bytes limit exceeded");
    if (ids.length !== Math.ceil(size / width)) invalidBiff("CFB stream size mismatch");
    allocated += size;
    const result = new Uint8Array(size);
    for (let i = 0; i < ids.length; i++) result.set(source(ids[i]!).slice(0, Math.min(width, size - i * width)), i * width);
    return result;
  };
  const dirIds = chain(file.u32(48), sectorCount, nextFat);
  if (version === 4 && dirIds.length !== file.u32(40)) invalidBiff("CFB directory count mismatch");
  const directory = new Binary(collect(dirIds, dirIds.length * sectorSize, sectorSize, sector));
  const entries: Entry[] = [];
  for (let offset = 0; offset < directory.bytes.length; offset += 128) {
    context.signal.throwIfAborted();
    const type = directory.u8(offset + 66), length = directory.u16(offset + 64);
    if (type && (length < 2 || length > 64 || length % 2 || directory.u16(offset + length - 2) !== 0)) invalidBiff("invalid CFB directory name");
    if (![0, 1, 2, 5].includes(type)) invalidBiff("invalid CFB entry type");
    const high = directory.u32(offset + 124), low = directory.u32(offset + 120);
    const size = version === 3 ? low : high * 2 ** 32 + low;
    if (!Number.isSafeInteger(size) || type && size > bytes.length) invalidBiff("invalid CFB stream size");
    entries.push({ name: type ? new TextDecoder("utf-16le", { fatal: true }).decode(directory.slice(offset, length - 2)) : "",
      type, left: directory.u32(offset + 68), right: directory.u32(offset + 72), child: directory.u32(offset + 76),
      start: directory.u32(offset + 116), size });
  }
  const root = entries[0]; if (!root || root.type !== 5) invalidBiff("missing CFB root");
  const miniIds = chain(file.u32(60), miniCount, nextFat);
  if (miniIds.length !== miniCount) invalidBiff("CFB miniFAT count mismatch");
  const miniFat = new Binary(collect(miniIds, miniCount * sectorSize, sectorSize, sector));
  const miniStream = new Binary(collect(chain(root.start, Math.ceil(root.size / sectorSize), nextFat), root.size, sectorSize, sector));
  const miniSector = (id: number) => new Binary(miniStream.slice(id * 64, 64));
  const nextMini = (id: number) => { if (id >= Math.ceil(root.size / 64)) invalidBiff("CFB mini sector outside stream"); return miniFat.u32(id * 4); };
  const result = new Map<string, Uint8Array>(), visited = new Set<number>(), pending = [root.child];
  while (pending.length) {
    context.signal.throwIfAborted();
    const id = pending.pop()!; if (id === free) continue;
    if (visited.has(id)) invalidBiff("CFB directory cycle"); visited.add(id);
    const entry = entries[id]; if (!entry || !entry.type || entry.type === 5) invalidBiff("invalid CFB directory reference");
    pending.push(entry.left, entry.right);
    if (entry.type !== 2) continue;
    if (result.has(entry.name)) invalidBiff("duplicate CFB stream name");
    const mini = entry.size < 4096;
    result.set(entry.name, collect(chain(entry.start, Math.ceil(entry.size / (mini ? 64 : sectorSize)), mini ? nextMini : nextFat),
      entry.size, mini ? 64 : sectorSize, mini ? miniSector : sector));
  }
  return result;
}

export interface BiffRecord { readonly opcode: number; readonly offset: number; readonly data: Binary; }
export function readBiffRecords(bytes: Uint8Array, context: CapabilityContext): BiffRecord[] {
  const binary = new Binary(bytes), records: BiffRecord[] = [];
  for (let offset = 0; offset < bytes.length;) {
    context.signal.throwIfAborted(); binary.check(offset, 4);
    const opcode = binary.u16(offset), length = binary.u16(offset + 2);
    if (opcode === 0 && length === 0 && bytes.subarray(offset).every(byte => byte === 0)) break;
    if (records.length >= (context.limits.workbookNodes ?? context.limits.inputBytes))
      throw new SsconvertError("resource-limit", "ssconvert BIFF record limit exceeded");
    records.push({ opcode, offset, data: new Binary(binary.slice(offset + 4, length)) }); offset += length + 4;
  }
  return records;
}
