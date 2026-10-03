import { ZipMetadataMap } from "./metadata.js";
import type { ZipMetadataFactory, ZipMetadataSpool } from "./metadata-types.js";
import { ZipRanges, type ZipReadSource } from "./ranges.js";
import { openZipSource, sameZipIdentity } from "./safety.js";
import { collectBytes,readBytes,type ByteSource,type FileStaging,type FileStat } from "safe-bash-contracts";
import { writeFileOutput } from "safe-bash-contracts/filesystem-output";
import { yieldTurn } from "safe-bash-contracts/yield";
import { checkPath,fail,hasIdentity,sameIdentity,vfsPath,type ArchiveLimits,type ZipHost } from "safe-bash-io-engine/commands/archive/internal";
import { ZipFailure } from "./options.js";
import { stageZip,type ZipPublication,type ZipScope } from "./safety.js";
import { zip64RangeDirectory,zip64Fields,type ZipDisks } from "./zip64.js";

export function splitSize(value: string): number {
  if (value === "-") return 0;
  let end = 0;
  while (end < value.length && value[end]! >= "0" && value[end]! <= "9") end++;
  const unit = value.slice(end).toLowerCase();
  const factor = { "": 1, k: 1024, m: 1024 ** 2, g: 1024 ** 3, t: 1024 ** 4 }[unit];
  const raw = Number(value.slice(0, end)) * (factor ?? 0);
  const size = raw < 1024 ? raw * 1024 ** 2 : raw;
  if (!end || factor === undefined || !Number.isSafeInteger(size) || size !== 0 && size < 65536) throw new ZipFailure(16, "Invalid command arguments", "split size must be zero or at least 64 KB");
  return size;
}

export function volumeName(archive: string, disk: number, disks: number): string {
  if (!archive.toLowerCase().endsWith(".zip")) fail("split output requires a .zip filename");
  return disk === disks - 1 ? archive : `${archive.slice(0, -4)}.z${String(disk + 1).padStart(2, "0")}`;
}

export function zipEndOffset(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let found = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset--) {
    if (view.getUint32(offset, true) === 0x06054b50 && offset + 22 + view.getUint16(offset + 20, true) === bytes.length) {
      if (found !== -1) fail("ZIP ambiguous end records");
      found = offset;
    }
  }
  if (found < 0) fail("ZIP missing end record");
  return found;
}

/** Input disks are supplied by the host, then read solely through the invocation VFS. */
export async function resolveZipVolumes(scope: Pick<ZipScope, "context" | "limits" | "operation" | "stat" | "input">, archive: string, final: Uint8Array, host?: ZipHost): Promise<{ bytes: Uint8Array; disks?: ZipDisks; paths: readonly string[]; volumes?: readonly { path: string; stat: FileStat }[] }> {
  const { fs, signal, cwd } = scope.context;
  const end = zipEndOffset(final);
  const view = new DataView(final.buffer, final.byteOffset, final.byteLength);
  const disk = view.getUint16(end + 4, true);
  const locator = end >= 20 && view.getUint32(end - 20, true) === 0x07064b50;
  const count = locator ? view.getUint32(end - 4, true) : disk + 1;
  if (count === 1 && !disk && !view.getUint16(end + 6, true)) return { bytes: final, paths: [archive], ...(view.getUint32(0, true) === 0x08074b50 ? { disks: { starts: [0], lengths: [final.length] } } : {}) };
  if (!host?.volume) fail("ZIP multi-disk archive requires an explicit VFS volume resolver");
  if (count < 2 || count > scope.limits.maxMembers || disk !== count - 1) fail("ZIP invalid volume count");
  const starts: number[] = [], lengths: number[] = [], paths: string[] = [];
  const stats: FileStat[] = [];
  const finalPath = await scope.operation(() => fs.realpath(archive, { signal }));
  const finalStat = await scope.stat(finalPath);
  let total = 0;
  for (let index = 0; index < count; index++) {
    const name = index === count - 1 ? finalPath : await scope.operation(() => host.volume!({ archive, disk: index, disks: count, signal }));
    if (!name) fail("ZIP missing input volume");
    checkPath(name, scope.limits);
    const path = await scope.operation(() => fs.realpath(vfsPath(cwd, name), { signal }));
    const stat = index === count - 1 ? finalStat : await scope.stat(path);
    if (!stat || stat.type !== "file" || !hasIdentity(stat) || stat.nlink !== 1) fail("ZIP volume requires a regular single-link file with known identity");
    if (index !== count - 1 && path === finalPath || paths.includes(path) || stats.some(other => sameIdentity(stat, other))) fail("ZIP repeated or aliased input volume");
    if (!Number.isSafeInteger(stat.size) || stat.size < 1 || stat.size > scope.limits.maxArchiveBytes - total) fail("ZIP volume byte limit exceeded");
    if (index === count - 1 && final.length !== stat.size) fail("ZIP input volume changed while reading");
    starts.push(total); lengths.push(stat.size); paths.push(path); stats.push(stat);
    total += stat.size;
  }
  // Admit every disk before retaining additional payload, then copy each stream directly
  // into one owned allocation instead of keeping all disks plus their assembly.
  if (total > scope.limits.maxInputMemoryBytes - final.buffer.byteLength) fail("ZIP input memory budget exceeded");
  signal.throwIfAborted();
  const bytes = new Uint8Array(total);
  for (let index = 0; index < paths.length; index++) {
    if (index === count - 1) {
      bytes.set(final, starts[index]!);
    } else {
      let size = 0;
      for await (const chunk of readBytes(scope.input(paths[index]!), signal)) {
        if (chunk.length > lengths[index]! - size) fail("ZIP input volume changed while reading");
        if (chunk.buffer.byteLength > scope.limits.maxInputMemoryBytes - bytes.byteLength - final.buffer.byteLength) fail("ZIP input memory budget exceeded");
        bytes.set(chunk, starts[index]! + size);
        size += chunk.length;
        await yieldTurn(signal);
      }
      if (size !== lengths[index]) fail("ZIP input volume changed while reading");
    }
    const before = stats[index]!, after = await scope.stat(paths[index]!);
    if (!after || !sameIdentity(before, after) || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) fail("ZIP input volume changed while reading");
  }
  // Resolver callbacks and reads may change an earlier disk or the final disk.
  for (let index = 0; index < paths.length; index++) {
    const before = stats[index]!, after = await scope.stat(paths[index]!);
    if (!after || !sameIdentity(before, after) || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) fail("ZIP input volume changed while reading");
  }
  return { bytes, disks: { starts, lengths }, paths, volumes: paths.map((path, index) => ({ path, stat: stats[index]! })) };
}

interface RecordSpan { start: number; end: number }

/** Partition a validated single-disk encoding, preserving record boundaries and ciphertext. */
export interface ZipVolume { readonly length: number; source(): ByteSource }

export async function splitZipVolumes(input: Uint8Array, size: number, limits: ArchiveLimits, signal: AbortSignal): Promise<Uint8Array[]> {
  const parts = await splitZipRanges({ size: input.length, read: async (offset, length) => input.slice(offset, offset + length) }, size, limits, signal);
  const result: Uint8Array[] = [];
  for (const part of parts) result.push(await collectBytes(part.source(), { signal, maxBytes: part.length }));
  return result;
}

function volumeMetadata<T>(factory: ZipMetadataFactory | undefined, signal: AbortSignal): {
  set(key: string, value: T): Promise<void>;
  sortedEntries(): AsyncIterable<[string, T]>;
  close(): Promise<void>;
} {
  if (factory) return new ZipMetadataMap<T>(factory, signal);
  const entries = new Map<string, T>();
  return {
    async set(key, value) { entries.set(key, value); },
    async *sortedEntries() { yield* [...entries].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0); },
    async close() { entries.clear(); }
  };
}

export async function splitZipRanges(sourceInput: ZipReadSource, size: number, limits: ArchiveLimits, signal: AbortSignal, metadataFactory?: ZipMetadataFactory): Promise<ZipVolume[]> {
  signal.throwIfAborted();
  const input = new ZipRanges(sourceInput, signal, Math.min(limits.chunkSize, 65536));
  if (!Number.isSafeInteger(size) || size < 65536) fail("ZIP invalid split size");
  if (input.length > limits.maxArchiveBytes - 4) fail("ZIP split archive byte limit exceeded");
  const view = input;
  const tailStart = Math.max(0, input.length - 65577);
  const end = tailStart + zipEndOffset(await input.subarray(tailStart));
  const directory = await zip64RangeDirectory({ byteLength: input.length, getUint16: view.getUint16.bind(view), getUint32: view.getUint32.bind(view), getBigUint64: view.getBigUint64.bind(view) }, end, limits);
  const records = volumeMetadata<RecordSpan>(metadataFactory, signal);
  const central = volumeMetadata<{ start: number; local: number; extraOffset?: number }>(metadataFactory, signal);
  const patches = volumeMetadata<{ offset: number; bytes: Uint8Array; disk: number }>(metadataFactory, signal);
  let patchSpool: ZipMetadataSpool | undefined;
  let delivered = false;
  let recordIndex = 0;
  const record = async (start: number, end: number) => records.set(`${String(start).padStart(16, "0")}:${String(recordIndex++).padStart(16, "0")}`, { start, end });
  try {
  let offset = directory.centralStart;
  for (let index = 0; index < directory.members; index++) {
    signal.throwIfAborted();
    if (offset + 46 > directory.centralEnd || (await view.getUint32(offset, true)) !== 0x02014b50) fail("ZIP invalid central record");
    const name = (await view.getUint16(offset + 28, true)), extra = (await view.getUint16(offset + 30, true)), comment = (await view.getUint16(offset + 32, true));
    const next = offset + 46 + name + extra + comment;
    if (next > directory.centralEnd) fail("ZIP truncated central record");
    let zip64: Uint8Array | undefined, extraOffset: number | undefined;
    for (let field = offset + 46 + name; field < next - comment;) {
      if (field + 4 > next - comment) fail("ZIP truncated extra field");
      const finish = field + 4 + (await view.getUint16(field + 2, true));
      if (finish > next - comment) fail("ZIP truncated extra field");
      if ((await view.getUint16(field, true)) === 1) { zip64 = (await input.subarray(field + 4, finish)); extraOffset = field + 4; }
      field = finish;
    }
    const raw = [(await view.getUint32(offset + 24, true)), (await view.getUint32(offset + 20, true)), (await view.getUint32(offset + 42, true))];
    const values = zip64Fields(zip64, raw);
    const local = values[2]!;
    if (local + 30 > directory.centralStart || (await view.getUint32(local, true)) !== 0x04034b50) fail("ZIP invalid local record");
    const payload = local + 30 + (await view.getUint16(local + 26, true)) + (await view.getUint16(local + 28, true));
    await record(local, payload); await record(offset, next);
    if ((await view.getUint16(local + 6, true)) & 8) {
      const descriptor = payload + values[1]!;
      const wide = (await view.getUint32(local + 18, true)) === 0xffffffff || (await view.getUint32(local + 22, true)) === 0xffffffff;
      await record(descriptor, descriptor + ((await view.getUint32(descriptor, true)) === 0x08074b50 ? 4 : 0) + (wide ? 20 : 12));
    }
    await central.set(String(index).padStart(16, "0"), { start: offset, local, ...(raw[2] === 0xffffffff && extraOffset !== undefined ? { extraOffset: extraOffset + (raw[0] === 0xffffffff ? 8 : 0) + (raw[1] === 0xffffffff ? 8 : 0) } : {}) });
    offset = next;
    await yieldTurn(signal);
  }
  if (directory.centralEnd !== end) { await record(directory.centralEnd, end - 20); await record(end - 20, end); }
  await record(end, input.length);
  const starts = [0];
  const nextVolume = (start: number) => {
    if (starts.length + 1 > limits.maxMembers || starts.length + 1 >= 65535) fail("ZIP split volume count limit exceeded");
    starts.push(start);
  };
  let source = 0, used = 4;
  for await (const [, record] of records.sortedEntries()) {
    if (record.start < source || record.end > input.length || record.end - record.start > size) fail("ZIP record cannot fit in split volume");
    while (record.start - source >= size - used && record.start > source) {
      source += size - used; nextVolume(source); used = 0;
    }
    used += record.start - source; source = record.start;
    if (record.end - record.start > size - used) { nextVolume(source); used = 0; }
    used += record.end - source; source = record.end;
  }
  if (starts.length > limits.maxMembers || starts.length >= 65535) fail("ZIP split volume count limit exceeded");
  const lengths = starts.map((start, index) => (starts[index + 1] ?? input.length) - start + (index === 0 ? 4 : 0));
  const patchCounts = starts.map(() => 0);
  const headerAt = (disk: number) => {
    const set = async (offset: number, width: number, value: number | bigint) => {
      const bytes = new Uint8Array(width);
      const header = new DataView(bytes.buffer);
      if (width === 8) header.setBigUint64(0, BigInt(value), true);
      else if (width === 4) header.setUint32(0, Number(value), true);
      else header.setUint16(0, Number(value), true);
      if (offset < 0 || offset + width > lengths[disk]!) fail("ZIP patch outside volume");
      await patches.set(`${String(disk).padStart(5, "0")}:${String(offset).padStart(16, "0")}`, { offset, bytes, disk });
      patchCounts[disk] = patchCounts[disk]! + 1;
    };
    return { setUint16: (offset: number, value: number, _little: boolean) => set(offset, 2, value),
      setUint32: (offset: number, value: number, _little: boolean) => set(offset, 4, value),
      setBigUint64: (offset: number, value: bigint, _little: boolean) => set(offset, 8, value) };
  };
  await headerAt(0).setUint32(0, 0x08074b50, true);
  const location = (position: number) => {
    let low = 0, high = starts.length;
    while (low + 1 < high) {
      const middle = Math.floor((low + high) / 2);
      if (starts[middle]! <= position) low = middle;
      else high = middle;
    }
    const disk = low;
    return { disk, relative: position - starts[disk]! + (disk === 0 ? 4 : 0) };
  };
  let onLast = 0, onWide = 0;
  const wideDisk = directory.centralEnd !== end ? location(directory.centralEnd).disk : -1;
  for await (const [, record] of central.sortedEntries()) {
    const here = location(record.start), local = location(record.local);
    if (here.disk === starts.length - 1) onLast++;
    if (here.disk === wideDisk) onWide++;
    const header = headerAt(here.disk);
    await header.setUint16(here.relative + 34, local.disk, true);
    if (record.extraOffset === undefined) await header.setUint32(here.relative + 42, local.relative, true);
    else await header.setBigUint64(here.relative + record.extraOffset - record.start, BigInt(local.relative), true);
  }
  const last = starts.length - 1, finish = location(end), centralStart = location(directory.centralStart);
  const header = headerAt(last);
  await header.setUint16(finish.relative + 4, last, true); await header.setUint16(finish.relative + 6, centralStart.disk, true);
  await header.setUint16(finish.relative + 8, Math.min(onLast, 65535), true);
  if ((await view.getUint32(end + 16, true)) !== 0xffffffff) await header.setUint32(finish.relative + 16, centralStart.relative, true);
  if (directory.centralEnd !== end) {
    const wide = location(directory.centralEnd);
    const wideHeader = headerAt(wide.disk);
    await wideHeader.setUint32(wide.relative + 16, wide.disk, true); await wideHeader.setUint32(wide.relative + 20, centralStart.disk, true);
    await wideHeader.setBigUint64(wide.relative + 24, BigInt(onWide), true); await wideHeader.setBigUint64(wide.relative + 48, BigInt(centralStart.relative), true);
    const locator = location(end - 20), locatorHeader = headerAt(locator.disk);
    await locatorHeader.setUint32(locator.relative + 4, wide.disk, true); await locatorHeader.setBigUint64(locator.relative + 8, BigInt(wide.relative), true);
    await locatorHeader.setUint32(locator.relative + 16, starts.length, true);
  }
  const patchStarts = [0];
  for (const count of patchCounts) patchStarts.push(patchStarts.at(-1)! + count * 24);
  let patchSource: ZipReadSource | undefined;
  if (metadataFactory) {
    patchSpool = await metadataFactory();
    const window = new Uint8Array(65520);
    let used = 0;
    for await (const [, patch] of patches.sortedEntries()) {
      const view = new DataView(window.buffer, used, 24);
      view.setBigUint64(0, BigInt(patch.offset), true);
      view.setUint32(8, patch.bytes.length, true);
      window.set(patch.bytes, used + 16);
      used += 24;
      if (used === window.length) { await patchSpool.append(window); used = 0; }
    }
    if (used) await patchSpool.append(window.subarray(0, used));
    patchSource = await patchSpool.finish();
    await patches.close();
  }
  delivered = true;
  return starts.map((start, disk) => {
    return { length: lengths[disk]!, source: async function* (): ByteSource {
      const modifications = (async function* () {
        if (patchSource) {
          const bytes = new ZipRanges(patchSource, signal, 65536);
          for (let offset = patchStarts[disk]!; offset < patchStarts[disk + 1]!; offset += 24) {
            const position = Number(await bytes.getBigUint64(offset, true));
            const width = await bytes.getUint32(offset + 8, true);
            yield { offset: position, bytes: await bytes.subarray(offset + 16, offset + 16 + width) };
          }
        } else {
          for await (const [, patch] of patches.sortedEntries()) if (patch.disk === disk) yield patch;
        }
      })()[Symbol.asyncIterator]();
      let next = await modifications.next();
      let position = 0;
      const chunks = (async function* () {
        if (disk === 0) yield new Uint8Array(4);
        yield* input.stream(start, (starts[disk + 1] ?? input.length) - start);
      })();
      for await (const chunk of chunks) {
        while (!next.done && next.value.offset < position + chunk.length) {
          const modification = next.value;
          const first = Math.max(position, modification.offset);
          const end = Math.min(position + chunk.length, modification.offset + modification.bytes.length);
          if (end > first) chunk.set(modification.bytes.subarray(first - modification.offset, end - modification.offset), first - position);
          if (modification.offset + modification.bytes.length > position + chunk.length) break;
          next = await modifications.next();
        }
        position += chunk.length;
        yield chunk;
      }
    } };
  });
  } finally {
    await records.close();
    await central.close();
    if (!delivered) { await patches.close(); await patchSpool?.close(); }
  }
}

/** All destinations preflight; all volumes staged before the first per-volume publication. */
export async function publishZipVolumes(scope: ZipScope, publication: ZipPublication, parts: readonly (Uint8Array | ZipVolume)[], inputPaths: Iterable<string> | AsyncIterable<string>, before: (path: string, disk: number) => Promise<void>): Promise<void> {
  const { fs, signal } = scope.context;
  if (!fs.publishStagedFile) fail("ZIP split publication requires atomic owned staging");
  const destinations: ZipPublication[] = [];
  for (let disk = 0; disk < parts.length; disk++) {
    const output = volumeName(publication.output, disk, parts.length);
    checkPath(output, scope.limits);
    const existing = await scope.stat(output);
    for await (const path of inputPaths) {
      if (path === output) fail("ZIP split output aliases an input volume");
      if (existing) {
        const stat = await scope.stat(path);
        if (stat && sameIdentity(stat, existing)) fail("ZIP split destination is not a safe regular file");
      }
    }
    if (existing && (existing.type !== "file" || !hasIdentity(existing) || existing.nlink !== 1)) fail("ZIP split destination is not a safe regular file");
    const capabilities = await scope.operation(() => fs.capabilitiesFor?.(output, { signal, create: true }) ?? fs.capabilities);
    if ((capabilities.atomicFileStaging !== true && capabilities.trustedOwnedStaging !== true)) fail("ZIP split publication requires atomic owned staging");
    const part = parts[disk]!;
    destinations.push({ ...publication, output, existing, ...(part instanceof Uint8Array ? { bytes: part } : { source: part.source() }) });
  }
  const staged: FileStaging[] = [];
  const stage = async (disk: number): Promise<void> => {
    if (disk < destinations.length) {
      const prepared = destinations[disk]!;
      const perform = () => stageZip(scope, { ...prepared, stagingPrefix: `zip-volume-${disk + 1}`, reservedPath: prepared.output, parent: prepared.stagingParent ?? prepared.parent, parentStat: prepared.stagingParentStat ?? prepared.parentStat }, async value => {
        staged.push(value);
        await before(prepared.output, disk);
        await stage(disk + 1);
      });
      if (prepared.bytes) await writeFileOutput(scope.context, prepared.bytes, perform);
      else await perform();
      return;
    }
    if (await scope.operation(() => fs.realpath(publication.parentName, { signal })) !== publication.parent) fail("ZIP split parent changed before publication");
    if (publication.stagingName && await scope.operation(() => fs.realpath(publication.stagingName!, { signal })) !== publication.stagingParent) fail("ZIP split staging parent changed before publication");
    for (let index = 0; index < staged.length; index++) {
      const prepared = destinations[index]!;
      await scope.operation(() => fs.publishStagedFile!(staged[index]!, prepared.output, { signal, parent: prepared.parentStat, destination: prepared.existing ?? null }));
    }
  };
  await stage(0);
}

/** Resolve retained volumes without assembling their payloads in memory. */
export async function openZipVolumes(scope: Pick<ZipScope, "context" | "limits" | "operation" | "stat">, archive: string, host?: ZipHost) {
  const final = await openZipSource(scope, archive);
  const retained = [final];
  const close = async () => {
    const results = await Promise.allSettled(retained.map(input => input.close()));
    const errors = results.filter(result => result.status === "rejected").map(result => result.reason);
    if (errors.length) throw new AggregateError(errors, "ZIP volume cleanup failed");
  };
  try {
    const ranges = new ZipRanges(final.source, scope.context.signal, Math.min(scope.limits.chunkSize, 65536));
    const tail = await ranges.subarray(Math.max(0, final.source.size - 65577));
    const end = zipEndOffset(tail);
    const view = new DataView(tail.buffer, tail.byteOffset, tail.length);
    const disk = view.getUint16(end + 4, true);
    const count = end >= 20 && view.getUint32(end - 20, true) === 0x07064b50 ? view.getUint32(end - 4, true) : disk + 1;
    const signature = await ranges.getUint32(0, true);
    if (count === 1 && !disk && !view.getUint16(end + 6, true)) return { source: final.source, paths: [archive], volumes: [{ path: archive, stat: final.stat }], close,
      ...(signature === 0x08074b50 ? { disks: { starts: [0], lengths: [final.source.size] } } : {}) };
    if (!host?.volume) fail("ZIP multi-disk archive requires an explicit VFS volume resolver");
    if (count < 2 || count > scope.limits.maxMembers || disk !== count - 1) fail("ZIP invalid volume count");
    const inputs: typeof retained = [], paths: string[] = [], starts: number[] = [], lengths: number[] = [];
    let size = 0;
    for (let disk = 0; disk < count; disk++) {
      const name = disk === count - 1 ? archive : await scope.operation(() => host.volume!({ archive, disk, disks: count, signal: scope.context.signal }));
      if (!name) fail("ZIP missing input volume");
      checkPath(name, scope.limits);
      const path = await scope.operation(() => scope.context.fs.realpath(vfsPath(scope.context.cwd, name), { signal: scope.context.signal }));
      const input = disk === count - 1 ? final : await openZipSource(scope, path);
      if (input !== final) retained.push(input);
      if (paths.includes(path) || inputs.some(other => sameZipIdentity(other.stat, input.stat))) fail("ZIP repeated or aliased input volume");
      if (input.stat.nlink !== 1) fail("ZIP invalid input volume");
      if (input.source.size < 1 || input.source.size > scope.limits.maxArchiveBytes - size) fail("ZIP volume byte limit exceeded");
      starts.push(size); lengths.push(input.source.size); paths.push(path); inputs.push(input);
      size += input.source.size;
    }
    return { source: { size, async read(offset: number, length: number) {
      const disk = starts.findLastIndex(start => start <= offset);
      if (disk < 0 || offset >= size) return new Uint8Array();
      return inputs[disk]!.source.read(offset - starts[disk]!, Math.min(length, starts[disk]! + lengths[disk]! - offset));
    } }, disks: { starts, lengths }, paths, volumes: inputs.map((input, index) => ({ path: paths[index]!, stat: input.stat })), close };
  } catch (error) { await close(); throw error; }
}
