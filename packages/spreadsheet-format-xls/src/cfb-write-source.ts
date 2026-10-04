import { SsconvertError, type CapabilityContext, type RangeSource } from "@poe-code/spreadsheet-engine/contracts";

interface Copy { readonly name: string; readonly offset: number; readonly length: number; readonly target: number; }
interface Part { readonly bytes: Uint8Array; readonly copies: readonly Copy[]; }

/** Only stream extents reside here; sector chains are calculated as they are emitted. */
export function cfbLayout(sizes: ReadonlyMap<string, number>, context: CapabilityContext): {
  readonly length: number; readonly parts: Iterable<Part>;
} {
  context.signal.throwIfAborted();
  if (sizes.size + 1 > (context.limits.workbookNodes ?? Infinity))
    throw new SsconvertError("resource-limit", "ssconvert CFB directory node limit exceeded");
  const limit = () => { throw new SsconvertError("resource-limit", "ssconvert CFB output bytes limit exceeded"); };
  if ((sizes.size + 1) * 128 > context.limits.outputBytes) limit();
  let work = 0;
  const tick = () => {
    context.signal.throwIfAborted();
    if (++work > (context.limits.workbookWork ?? Infinity))
      throw new SsconvertError("resource-limit", "ssconvert CFB directory work limit exceeded");
  };
  let largeCount = 0, miniCount = 0;
  const entries = [...sizes].sort(([a], [b]) => { tick(); return a.length - b.length || (a.toUpperCase() < b.toUpperCase() ? -1 : 1); })
    .map(([name, size]) => {
      if (!Number.isSafeInteger(size) || size < 0 || size > context.limits.outputBytes) limit();
      const mini = size < 4096, count = Math.ceil(size / (mini ? 64 : 512)), start = mini ? miniCount : largeCount;
      if (mini) miniCount += count; else largeCount += count;
      return { name, size, mini, count, start };
    });
  const miniBytes = miniCount * 64, miniDataCount = Math.ceil(miniBytes / 512), miniFatCount = Math.ceil(miniCount / 128);
  const miniStart = largeCount, miniFatStart = miniStart + miniDataCount;
  const directory = miniFatStart + miniFatCount, directoryCount = Math.ceil((entries.length + 1) / 4);
  let fatCount = 0, difatCount = 0;
  for (;;) {
    const nextFat = Math.ceil((directory + directoryCount + fatCount + difatCount) / 128);
    const nextDifat = Math.ceil(Math.max(0, nextFat - 109) / 127);
    if (nextFat === fatCount && nextDifat === difatCount) break;
    fatCount = nextFat; difatCount = nextDifat;
  }
  const fatStart = directory + directoryCount, difatStart = fatStart + fatCount;
  const length = (difatStart + difatCount + 1) * 512;
  if (!Number.isSafeInteger(length) || length > context.limits.outputBytes) limit();
  const end = 0xfffffffe, free = 0xffffffff;
  const next = (id: number, start: number, count: number) => id + 1 < start + count ? id + 1 : end;
  function* parts(): Generator<Part> {
    const header = new Uint8Array(512), view = new DataView(header.buffer);
    header.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    for (const [at, value] of [[24, 0x3e], [26, 3], [28, 0xfffe], [30, 9], [32, 6]]) view.setUint16(at!, value!, true);
    for (const [at, value] of [[44, fatCount], [48, directory], [56, 4096], [60, miniFatCount ? miniFatStart : end],
      [64, miniFatCount], [68, difatCount ? difatStart : end], [72, difatCount]]) view.setUint32(at!, value!, true);
    for (let i = 0; i < 109; i++) view.setUint32(76 + i * 4, i < fatCount ? fatStart + i : free, true);
    yield { bytes: header, copies: [] };
    for (const entry of entries) if (!entry.mini) {
      for (let offset = 0; offset < entry.count * 512; offset += 16384) {
        context.signal.throwIfAborted();
        const bytes = new Uint8Array(Math.min(16384, entry.count * 512 - offset));
        yield { bytes, copies: [{ name: entry.name, offset, length: Math.min(bytes.length, entry.size - offset), target: 0 }] };
      }
    }
    let miniEntry = 0;
    for (let sector = 0; sector < miniDataCount; sector++) {
      context.signal.throwIfAborted();
      const bytes = new Uint8Array(512), copies: Copy[] = [], begin = sector * 512;
      while (miniEntry < entries.length) {
        const entry = entries[miniEntry]!;
        if (!entry.mini || !entry.count || (entry.start + entry.count) * 64 <= begin) { miniEntry++; continue; }
        if (entry.start * 64 >= begin + 512) break;
        const from = Math.max(begin, entry.start * 64), to = Math.min(begin + 512, entry.start * 64 + entry.size);
        if (to > from) copies.push({ name: entry.name, offset: from - entry.start * 64, length: to - from, target: from - begin });
        if ((entry.start + entry.count) * 64 > begin + 512) break;
        miniEntry++;
      }
      yield { bytes, copies };
    }
    let miniChain = 0;
    for (let sector = 0; sector < miniFatCount; sector++) {
      const bytes = new Uint8Array(512), view = new DataView(bytes.buffer);
      for (let j = 0; j < 128; j++) {
        const id = sector * 128 + j;
        while (miniChain < entries.length && (!entries[miniChain]!.mini || entries[miniChain]!.start + entries[miniChain]!.count <= id)) miniChain++;
        const entry = entries[miniChain];
        view.setUint32(j * 4, entry && id < miniCount ? next(id, entry.start, entry.count) : free, true);
      }
      yield { bytes, copies: [] };
    }
    const redLevel = Math.floor(Math.log2(entries.length + 1));
    for (let sector = 0; sector < directoryCount; sector++) {
      const bytes = new Uint8Array(512), view = new DataView(bytes.buffer);
      for (let slot = 0; slot < 4; slot++) {
        const index = sector * 4 + slot; if (index > entries.length) break;
        tick(); const entry = entries[index - 1], at = slot * 128, name = entry?.name ?? "Root Entry";
        for (let i = 0; i < name.length; i++) view.setUint16(at + i * 2, name.charCodeAt(i), true);
        view.setUint16(at + 64, (name.length + 1) * 2, true); bytes[at + 66] = index ? 2 : 5; bytes[at + 67] = 1;
        view.setUint32(at + 68, free, true); view.setUint32(at + 72, free, true); view.setUint32(at + 76, free, true);
        view.setUint32(at + 116, entry ? entry.count ? entry.start : end : miniBytes ? miniStart : end, true);
        view.setUint32(at + 120, entry?.size ?? miniBytes, true);
        if (!index) view.setUint32(at + 76, entries.length ? Math.floor((1 + entries.length) / 2) : free, true);
        else {
          tick(); let first = 1, last = entries.length, depth = 0;
          for (;;) {
            const middle = Math.floor((first + last) / 2);
            if (middle === index) break;
            if (index < middle) last = middle - 1; else first = middle + 1;
            depth++;
          }
          bytes[at + 67] = depth === redLevel ? 0 : 1;
          view.setUint32(at + 68, first < index ? Math.floor((first + index - 1) / 2) : free, true);
          view.setUint32(at + 72, index < last ? Math.floor((index + 1 + last) / 2) : free, true);
        }
      }
      tick(); yield { bytes, copies: [] };
    }
    let largeChain = 0;
    for (let sector = 0; sector < fatCount; sector++) {
      context.signal.throwIfAborted();
      const bytes = new Uint8Array(512), view = new DataView(bytes.buffer);
      for (let j = 0; j < 128; j++) {
        const id = sector * 128 + j; let value = free;
        if (id < miniStart) {
          while (largeChain < entries.length && (entries[largeChain]!.mini || entries[largeChain]!.start + entries[largeChain]!.count <= id)) largeChain++;
          const entry = entries[largeChain]!; value = next(id, entry.start, entry.count);
        } else if (id < miniFatStart) value = next(id, miniStart, miniDataCount);
        else if (id < directory) value = next(id, miniFatStart, miniFatCount);
        else if (id < fatStart) value = next(id, directory, directoryCount);
        else if (id < difatStart) value = 0xfffffffd;
        else if (id < difatStart + difatCount) value = 0xfffffffc;
        view.setUint32(j * 4, value, true);
      }
      yield { bytes, copies: [] };
    }
    for (let sector = 0; sector < difatCount; sector++) {
      context.signal.throwIfAborted();
      const bytes = new Uint8Array(512), view = new DataView(bytes.buffer);
      for (let j = 0; j < 127; j++) { const index = 109 + sector * 127 + j;
        view.setUint32(j * 4, index < fatCount ? fatStart + index : free, true); }
      view.setUint32(508, next(difatStart + sector, difatStart, difatCount), true);
      yield { bytes, copies: [] };
    }
  }
  return { length, parts: parts() };
}

/** Sources remain caller-owned. Each pull reads only the next <=16 KiB output part. */
export async function* writeCfbSource(streams: ReadonlyMap<string, RangeSource>, context: CapabilityContext): AsyncGenerator<Uint8Array> {
  const layout = cfbLayout(new Map([...streams].map(([name, source]) => [name, source.size])), context);
  for (const part of layout.parts) {
    context.signal.throwIfAborted();
    for (const copy of part.copies) {
      const source = streams.get(copy.name)!;
      for (let at = 0; at < copy.length;) {
        context.signal.throwIfAborted();
        const bytes = await source.read(copy.offset + at, copy.length - at);
        context.signal.throwIfAborted();
        if (!bytes.length || bytes.length > copy.length - at) throw new SsconvertError("io", "CFB source is truncated or returned an oversized range");
        part.bytes.set(bytes, copy.target + at); at += bytes.length;
      }
    }
    yield part.bytes;
  }
}
