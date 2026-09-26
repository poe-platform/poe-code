import { SsconvertError, type CapabilityContext } from "../contracts.js";

export class BiffOutput {
  private readonly parts: Uint8Array[] = [];
  length = 0;
  constructor(readonly context: CapabilityContext, readonly maximumRecord: number) {}
  record(opcode: number, payload: Uint8Array = new Uint8Array()): number {
    this.context.signal.throwIfAborted();
    if (payload.length > this.maximumRecord) throw new SsconvertError("unsupported-feature", "Excel BIFF record is too large");
    if (payload.length + 4 > this.context.limits.outputBytes - this.length)
      throw new SsconvertError("resource-limit", "ssconvert BIFF output bytes limit exceeded");
    if (this.parts.length >= (this.context.limits.workbookNodes ?? this.context.limits.outputBytes / 4))
      throw new SsconvertError("resource-limit", "ssconvert BIFF record limit exceeded");
    const at = this.length, bytes = new Uint8Array(payload.length + 4), view = new DataView(bytes.buffer);
    view.setUint16(0, opcode, true); view.setUint16(2, payload.length, true); bytes.set(payload, 4);
    this.parts.push(bytes); this.length += bytes.length; return at;
  }
  finish(): Uint8Array {
    this.context.signal.throwIfAborted();
    const bytes = new Uint8Array(this.length); let at = 0;
    for (const part of this.parts) { bytes.set(part, at); at += part.length; }
    return bytes;
  }
}

export function words(...values: number[]): Uint8Array {
  const bytes = new Uint8Array(values.length * 2), view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setUint16(index * 2, value, true)); return bytes;
}

/** MS-CFB 2.4: small streams share 64-byte mini sectors; directory sizes exclude
 * allocation padding so consumers see exactly the BIFF record stream. */
export function writeCfb(streams: ReadonlyMap<string, Uint8Array>, context: CapabilityContext): Uint8Array {
  context.signal.throwIfAborted();
  if (streams.size + 1 > (context.limits.workbookNodes ?? Infinity))
    throw new SsconvertError("resource-limit", "ssconvert CFB directory node limit exceeded");
  if ((streams.size + 1) * 128 > context.limits.outputBytes)
    throw new SsconvertError("resource-limit", "ssconvert CFB output bytes limit exceeded");
  let work = 0;
  const tick = () => {
    context.signal.throwIfAborted();
    if (++work > (context.limits.workbookWork ?? Infinity))
      throw new SsconvertError("resource-limit", "ssconvert CFB directory work limit exceeded");
  };
  const entries = [...streams].sort(([a], [b]) => { tick(); return a.length - b.length || (a.toUpperCase() < b.toUpperCase() ? -1 : 1); });
  const largeCounts = entries.map(([, bytes]) => bytes.length >= 4096 ? Math.ceil(bytes.length / 512) : 0);
  const miniCounts = entries.map(([, bytes]) => bytes.length < 4096 ? Math.ceil(bytes.length / 64) : 0);
  const miniCount = miniCounts.reduce((sum, size) => sum + size, 0), miniBytes = miniCount * 64;
  const miniDataCount = Math.ceil(miniBytes / 512), miniFatCount = Math.ceil(miniCount / 128);
  const miniStart = largeCounts.reduce((sum, size) => sum + size, 0), miniFatStart = miniStart + miniDataCount;
  const dataCount = miniFatStart + miniFatCount, directoryCount = Math.ceil((entries.length + 1) / 4);
  let fatCount = 0, difatCount = 0;
  for (;;) {
    const nextFat = Math.ceil((dataCount + directoryCount + fatCount + difatCount) / 128);
    const nextDifat = Math.ceil(Math.max(0, nextFat - 109) / 127);
    if (nextFat === fatCount && nextDifat === difatCount) break;
    fatCount = nextFat; difatCount = nextDifat;
  }
  const sectorCount = dataCount + directoryCount + fatCount + difatCount, length = (sectorCount + 1) * 512;
  if (length > context.limits.outputBytes) throw new SsconvertError("resource-limit", "ssconvert CFB output bytes limit exceeded");
  const bytes = new Uint8Array(length), view = new DataView(bytes.buffer);
  const put16 = (at: number, value: number) => view.setUint16(at, value, true);
  const put32 = (at: number, value: number) => view.setUint32(at, value, true);
  const sector = (id: number) => (id + 1) * 512;
  const directory = dataCount, fatStart = directory + directoryCount, difatStart = fatStart + fatCount;
  bytes.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  put16(24, 0x3e); put16(26, 3); put16(28, 0xfffe); put16(30, 9); put16(32, 6);
  put32(44, fatCount); put32(48, directory); put32(56, 4096);
  put32(60, miniFatCount ? miniFatStart : 0xfffffffe); put32(64, miniFatCount);
  put32(68, difatCount ? difatStart : 0xfffffffe); put32(72, difatCount);
  for (let i = 0; i < 109; i++) put32(76 + i * 4, i < fatCount ? fatStart + i : 0xffffffff);
  for (let i = 0; i < difatCount; i++) {
    context.signal.throwIfAborted();
    for (let j = 0; j < 127; j++) { const index = 109 + i * 127 + j;
      put32(sector(difatStart + i) + j * 4, index < fatCount ? fatStart + index : 0xffffffff); }
    put32(sector(difatStart + i) + 508, i + 1 < difatCount ? difatStart + i + 1 : 0xfffffffe);
  }
  for (let i = 0; i < fatCount * 128; i++) put32(sector(fatStart) + i * 4, 0xffffffff);
  const fat = (id: number, next: number) => put32(sector(fatStart) + id * 4, next);
  for (let i = 0; i < miniFatCount * 128; i++) put32(sector(miniFatStart) + i * 4, 0xffffffff);
  const entry = (index: number, name: string, type: number, start: number, size: number) => {
    tick();
    const at = sector(directory) + index * 128;
    for (let i = 0; i < name.length; i++) put16(at + i * 2, name.charCodeAt(i));
    put16(at + 64, (name.length + 1) * 2); bytes[at + 66] = type; bytes[at + 67] = 1;
    put32(at + 68, 0xffffffff); put32(at + 72, 0xffffffff); put32(at + 76, 0xffffffff);
    put32(at + 116, start); put32(at + 120, size);
  };
  entry(0, "Root Entry", 5, miniBytes ? miniStart : 0xfffffffe, miniBytes);
  let start = 0, miniOffset = 0;
  entries.forEach(([name, data], index) => {
    context.signal.throwIfAborted();
    const mini = data.length < 4096, count = mini ? miniCounts[index]! : largeCounts[index]!;
    const first = mini ? miniOffset : start;
    if (data.length) bytes.set(data, mini ? sector(miniStart) + miniOffset * 64 : sector(start));
    entry(index + 1, name, 2, count ? first : 0xfffffffe, data.length);
    for (let id = first; id < first + count; id++) {
      if ((id & 1023) === 0) context.signal.throwIfAborted();
      const next = id + 1 < first + count ? id + 1 : 0xfffffffe;
      if (mini) put32(sector(miniFatStart) + id * 4, next); else fat(id, next);
    }
    if (mini) miniOffset += count; else start += count;
  });
  // MS-CFB 2.6.4: root-owned streams form a red-black search tree. A median
  // tree has at most one incomplete bottom level; coloring only that level
  // red gives every path the same black height without red/red edges.
  const redLevel = Math.floor(Math.log2(entries.length + 1));
  const link = (first: number, last: number, depth: number): number => {
    if (first > last) return 0xffffffff;
    tick();
    const index = Math.floor((first + last) / 2), at = sector(directory) + index * 128;
    bytes[at + 67] = depth === redLevel ? 0 : 1;
    put32(at + 68, link(first, index - 1, depth + 1));
    put32(at + 72, link(index + 1, last, depth + 1));
    return index;
  };
  put32(sector(directory) + 76, link(1, entries.length, 0));
  for (let i = 0; i < miniDataCount; i++) fat(miniStart + i, i + 1 < miniDataCount ? miniStart + i + 1 : 0xfffffffe);
  for (let i = 0; i < miniFatCount; i++) fat(miniFatStart + i, i + 1 < miniFatCount ? miniFatStart + i + 1 : 0xfffffffe);
  for (let i = 0; i < directoryCount; i++) { tick(); fat(directory + i, i + 1 < directoryCount ? directory + i + 1 : 0xfffffffe); }
  for (let i = 0; i < fatCount; i++) fat(fatStart + i, 0xfffffffd);
  for (let i = 0; i < difatCount; i++) fat(difatStart + i, 0xfffffffc);
  return bytes;
}
