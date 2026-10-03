import { SsconvertError, type CapabilityContext, type RangeSource, type WorkingStorage } from "@poe-code/spreadsheet-engine/contracts";
import { ownedRangeSource } from "@poe-code/spreadsheet-engine/range-input";
import { Binary, invalidBiff, isCfb } from "./biff-binary.js";

/** Preserve opaque backend failures even when a format probe rejects invalid CFB. */
export class CfbBackendFailure extends Error {
  constructor(readonly cause: unknown) { super("CFB backing operation failed"); }
}

function backend<T>(operation: () => T): T {
  try { return operation(); } catch (error) { if (error instanceof CfbBackendFailure) throw error; throw new CfbBackendFailure(error); }
}
async function backendAsync<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); } catch (error) { if (error instanceof CfbBackendFailure) throw error; throw new CfbBackendFailure(error); }
}

/** Indexes live in caller storage. The no-storage SDK convenience path retains indexes in memory. */
function table(length: number, store: WorkingStorage | undefined, check: () => void) {
  const address = backend(() => store?.allocate(length * 8)), values = store ? undefined : new Map<number, number>();
  const admit = (index: number) => { check(); if (!Number.isSafeInteger(index) || index < 0 || index >= length) invalidBiff("CFB index outside table"); };
  return {
    async get(index: number): Promise<number> {
      admit(index);
      if (!store) return values!.get(index) ?? 0;
      const bytes = await backendAsync(() => store.read(address! + index * 8, 8)); check();
      return new DataView(bytes.buffer, bytes.byteOffset, 8).getFloat64(0, true);
    },
    async set(index: number, value: number) {
      admit(index);
      if (!store) { values!.set(index, value); return; }
      const bytes = new Uint8Array(8); new DataView(bytes.buffer).setFloat64(0, value, true);
      await backendAsync(() => store.write(address! + index * 8, bytes)); check();
    }
  };
}

/** Validate CFB structure without collecting directory, FAT, mini-stream or stream payloads. */
export async function readCfbRanges(input: RangeSource, context: CapabilityContext): Promise<{
  readonly streams: ReadonlyMap<string, RangeSource>; close(): Promise<void>;
}> {
  let closed = false, store: WorkingStorage | undefined, closing: Promise<void> | undefined;
  const close = () => { closed = true; return closing ??= backendAsync(() => store?.close() ?? Promise.resolve()); };
  const check = () => { context.signal.throwIfAborted(); if (closed) throw new SsconvertError("invalid-request", "CFB reader is closed"); };
  context.own(close); check();
  const size = input.size, read = input.read.bind(input);
  if (!Number.isSafeInteger(size) || size < 0) invalidBiff("invalid CFB size");
  if (size > context.limits.inputBytes) throw new SsconvertError("resource-limit", "ssconvert input bytes limit exceeded");
  const source = ownedRangeSource({ size, async read(position, count, options) {
    try { return await read(position, count, options); } catch (error) { if (error instanceof CfbBackendFailure) throw error; throw new CfbBackendFailure(error); }
  } }, context.signal, check, context.own);
  async function exact(source: RangeSource, position: number, count: number, signal?: AbortSignal): Promise<Uint8Array> {
    check(); signal?.throwIfAborted();
    if (position < 0 || position > source.size - count || count > 16384) invalidBiff("truncated CFB data");
    const bytes = new Uint8Array(count);
    for (let offset = 0; offset < count;) {
      const chunk = await source.read(position + offset, count - offset, signal ? { signal } : undefined); check(); signal?.throwIfAborted();
      if (!chunk.length || chunk.length > count - offset) invalidBiff("truncated CFB data");
      bytes.set(chunk, offset); offset += chunk.length;
    }
    return bytes;
  }
  try {
    const file = new Binary(await exact(source, 0, 512));
    if (!isCfb(file.bytes) || file.u16(28) !== 0xfffe) invalidBiff("invalid CFB header");
    const version = file.u16(26), shift = file.u16(30);
    if (!(version === 3 && shift === 9 || version === 4 && shift === 12) || file.u16(32) !== 6) invalidBiff("unsupported CFB sector layout");
    const width = 2 ** shift, sectorCount = Math.floor(size / width) - 1, free = 0xffffffff, end = 0xfffffffe;
    if (sectorCount < 0 || size % width !== 0 || file.u32(56) !== 4096) invalidBiff("invalid CFB size");
    const fatCount = file.u32(44), difatCount = file.u32(72), miniCount = file.u32(64);
    if (fatCount > sectorCount || difatCount > sectorCount || miniCount > sectorCount) invalidBiff("invalid CFB chain count");
    check(); store = backend(() => context.createWorkingStorage?.()); check();
    const fatIds = table(fatCount, store, check), fatSeen = table(sectorCount, store, check), difatSeen = table(sectorCount, store, check);
    const sector = async (id: number, signal?: AbortSignal) => {
      check(); if (id >= sectorCount) invalidBiff("CFB sector outside file");
      return new Binary(await exact(source, (id + 1) * width, width, signal));
    };
    let fats = 0;
    const addFat = async (id: number) => {
      if (id === free) return;
      if (id >= sectorCount || fats >= fatCount || await fatSeen.get(id)) invalidBiff("invalid CFB FAT sector");
      await fatSeen.set(id, 1); await fatIds.set(fats++, id);
    };
    for (let offset = 76; offset < 512; offset += 4) await addFat(file.u32(offset));
    let difat = file.u32(68);
    for (let i = 0; i < difatCount; i++) {
      if (difat >= sectorCount || await difatSeen.get(difat)) invalidBiff("CFB DIFAT cycle");
      await difatSeen.set(difat, 1);
      const data = await sector(difat);
      for (let offset = 0; offset < width - 4; offset += 4) await addFat(data.u32(offset));
      difat = data.u32(width - 4);
    }
    if (difatCount && difat !== end || fats !== fatCount) invalidBiff("CFB FAT count mismatch");
    let cachedFatIndex = -1, cachedFat: Binary | undefined;
    const nextFat = async (id: number): Promise<number> => {
      const index = Math.floor(id / (width / 4));
      if (id >= sectorCount || index >= fatCount) invalidBiff("CFB FAT reference outside table");
      if (index !== cachedFatIndex) {
        const data = await sector(await fatIds.get(index));
        cachedFat = data; cachedFatIndex = index;
      }
      return cachedFat!.u32(id % (width / 4) * 4);
    };
    const chain = async (start: number, maximum: number, next: (id: number) => Promise<number>) => {
      const ids = table(maximum, store, check); let length = 0;
      // Brent's cycle detector needs constant state. A visited-sector table
      // would alternate dirty pages with the output index under small caches.
      let anchor = start, power = 1, distance = 0;
      for (let id = start; id !== end;) {
        check();
        if (length >= maximum) invalidBiff("CFB chain exceeds declared size");
        await ids.set(length++, id);
        id = await next(id); distance++;
        if (id !== end && id === anchor) invalidBiff("CFB chain cycle");
        if (distance === power) { anchor = id; power *= 2; distance = 0; }
      }
      return { ids, length };
    };
    let allocated = 0;
    const stream = (chain: { ids: ReturnType<typeof table>; length: number }, size: number, width: number,
      read: (id: number, offset: number, count: number, signal?: AbortSignal) => Promise<Uint8Array>): RangeSource => {
      if (size > context.limits.inputBytes - allocated) throw new SsconvertError("resource-limit", "ssconvert CFB decoded bytes limit exceeded");
      if (chain.length !== Math.ceil(size / width)) invalidBiff("CFB stream size mismatch");
      allocated += size;
      return Object.freeze({ size, async read(position: number, count: number, options?: { readonly signal?: AbortSignal }) {
        check(); options?.signal?.throwIfAborted();
        if (!Number.isSafeInteger(position) || position < 0 || position > size || !Number.isSafeInteger(count) || count < 0)
          throw new SsconvertError("invalid-request", "Invalid CFB stream range");
        const bytes = new Uint8Array(Math.min(16384, count, size - position));
        for (let offset = 0; offset < bytes.length;) {
          check(); options?.signal?.throwIfAborted();
          const at = position + offset, within = at % width, length = Math.min(width - within, bytes.length - offset);
          const id = await chain.ids.get(Math.floor(at / width));
          const chunk = await read(id, within, length, options?.signal); check(); options?.signal?.throwIfAborted();
          bytes.set(chunk, offset); offset += length;
        }
        return bytes;
      } });
    };
    let cachedSectorIndex = -1, cachedSector: Binary | undefined;
    const normal = async (id: number, offset: number, count: number, signal?: AbortSignal) => {
      let data = id === cachedSectorIndex ? cachedSector : undefined;
      if (!data) {
        data = await sector(id, signal); cachedSector = data; cachedSectorIndex = id;
      }
      return data.slice(offset, count);
    };
    const dirChain = await chain(file.u32(48), sectorCount, nextFat);
    if (version === 4 && dirChain.length !== file.u32(40)) invalidBiff("CFB directory count mismatch");
    const directory = stream(dirChain, dirChain.length * width, width, normal), entries = directory.size / 128;
    const entry = async (id: number) => {
      if (id >= entries) invalidBiff("invalid CFB directory reference");
      const data = new Binary(await exact(directory, id * 128, 128)), type = data.u8(66), length = data.u16(64);
      if (type && (length < 2 || length > 64 || length % 2 || data.u16(length - 2) !== 0)) invalidBiff("invalid CFB directory name");
      if (![0, 1, 2, 5].includes(type)) invalidBiff("invalid CFB entry type");
      const bytes = version === 3 ? data.u32(120) : data.u32(124) * 2 ** 32 + data.u32(120);
      if (!Number.isSafeInteger(bytes) || type && bytes > size) invalidBiff("invalid CFB stream size");
      return { type, name: type ? new TextDecoder("utf-16le", { fatal: true }).decode(data.slice(0, length - 2)) : "",
        left: data.u32(68), right: data.u32(72), child: data.u32(76), start: data.u32(116), size: bytes };
    };
    for (let i = 0; i < entries; i++) await entry(i);
    const root = await entry(0); if (root.type !== 5) invalidBiff("missing CFB root");
    const miniChain = await chain(file.u32(60), miniCount, nextFat);
    if (miniChain.length !== miniCount) invalidBiff("CFB miniFAT count mismatch");
    const miniFat = stream(miniChain, miniCount * width, width, normal);
    const miniStream = stream(await chain(root.start, Math.ceil(root.size / width), nextFat), root.size, width, normal);
    const nextMini = async (id: number) => {
      if (id >= Math.ceil(root.size / 64)) invalidBiff("CFB mini sector outside stream");
      if (id * 64 > root.size - 64) invalidBiff("truncated CFB mini sector");
      return new Binary(await exact(miniFat, id * 4, 4)).u32(0);
    };
    const result = new Map<string, RangeSource>(), visited = table(entries, store, check), pending = table(entries * 2 + 1, store, check);
    let pendingCount = 1; await pending.set(0, root.child);
    while (pendingCount) {
      const id = await pending.get(--pendingCount); if (id === free) continue;
      if (id >= entries) invalidBiff("invalid CFB directory reference");
      if (await visited.get(id)) invalidBiff("CFB directory cycle");
      await visited.set(id, 1);
      const item = await entry(id); if (!item.type || item.type === 5) invalidBiff("invalid CFB directory reference");
      await pending.set(pendingCount++, item.left); await pending.set(pendingCount++, item.right);
      if (item.type !== 2) continue;
      if (result.has(item.name)) invalidBiff("duplicate CFB stream name");
      const mini = item.size < 4096, unit = mini ? 64 : width;
      const ids = await chain(item.start, Math.ceil(item.size / unit), mini ? nextMini : nextFat);
      result.set(item.name, stream(ids, item.size, unit, mini ? (id, offset, count, signal) => exact(miniStream, id * 64 + offset, count, signal) : normal));
    }
    return { streams: result, close };
  } catch (error) { await close(); context.signal.throwIfAborted(); throw error; }
}
