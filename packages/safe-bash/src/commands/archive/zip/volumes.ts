import { collectBytes, type FileStat, type FileStaging } from "../../../contracts/index.js";
import { yieldTurn } from "../../../contracts/yield.js";
import { writeFileOutput } from "../../../contracts/filesystem-output.js";
import { checkPath, fail, hasIdentity, sameIdentity, vfsPath, type ArchiveLimits, type ZipHost } from "../internal.js";
import { ZipFailure } from "./options.js";
import { stageZip, type ZipPublication, type ZipScope } from "./safety.js";
import { zip64Directory, zip64Fields, type ZipDisks } from "./zip64.js";

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
  const parts: Uint8Array[] = [], starts: number[] = [], lengths: number[] = [], paths: string[] = [];
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
    const bytes = index === count - 1 ? final : await collectBytes(scope.input(path), { signal, maxBytes: stat.size });
    const after = await scope.stat(path);
    if (bytes.length !== stat.size || !after || !sameIdentity(stat, after) || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs) fail("ZIP input volume changed while reading");
    starts.push(total); lengths.push(bytes.length); paths.push(path); stats.push(stat);
    total += bytes.length;
    parts.push(bytes);
  }
  // Later resolver callbacks and reads may change an earlier, already-read disk.
  for (let index = 0; index < paths.length; index++) {
    const before = stats[index]!, after = await scope.stat(paths[index]!);
    if (!after || !sameIdentity(before, after) || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) fail("ZIP input volume changed while reading");
  }
  const bytes = new Uint8Array(total);
  for (let index = 0; index < parts.length; index++) {
    for (let offset = 0; offset < parts[index]!.length; offset += scope.limits.chunkSize) {
      signal.throwIfAborted();
      bytes.set(parts[index]!.subarray(offset, offset + scope.limits.chunkSize), starts[index]! + offset);
      await yieldTurn(signal);
    }
  }
  return { bytes, disks: { starts, lengths }, paths, volumes: paths.map((path, index) => ({ path, stat: stats[index]! })) };
}

interface RecordSpan { start: number; end: number }

/** Partition a validated single-disk encoding, preserving record boundaries and ciphertext. */
export async function splitZipVolumes(input: Uint8Array, size: number, limits: ArchiveLimits, signal: AbortSignal): Promise<Uint8Array[]> {
  signal.throwIfAborted();
  if (!Number.isSafeInteger(size) || size < 65536) fail("ZIP invalid split size");
  if (input.length > limits.maxArchiveBytes - 4) fail("ZIP split archive byte limit exceeded");
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const end = zipEndOffset(input);
  const directory = zip64Directory(view, end, limits);
  const records: RecordSpan[] = [], central: Array<{ start: number; local: number; extraOffset?: number }> = [];
  let offset = directory.centralStart;
  for (let index = 0; index < directory.members; index++) {
    signal.throwIfAborted();
    if (offset + 46 > directory.centralEnd || view.getUint32(offset, true) !== 0x02014b50) fail("ZIP invalid central record");
    const name = view.getUint16(offset + 28, true), extra = view.getUint16(offset + 30, true), comment = view.getUint16(offset + 32, true);
    const next = offset + 46 + name + extra + comment;
    if (next > directory.centralEnd) fail("ZIP truncated central record");
    let zip64: Uint8Array | undefined, extraOffset: number | undefined;
    for (let field = offset + 46 + name; field < next - comment;) {
      if (field + 4 > next - comment) fail("ZIP truncated extra field");
      const finish = field + 4 + view.getUint16(field + 2, true);
      if (finish > next - comment) fail("ZIP truncated extra field");
      if (view.getUint16(field, true) === 1) { zip64 = input.subarray(field + 4, finish); extraOffset = field + 4; }
      field = finish;
    }
    const raw = [view.getUint32(offset + 24, true), view.getUint32(offset + 20, true), view.getUint32(offset + 42, true)];
    const values = zip64Fields(zip64, raw);
    const local = values[2]!;
    if (local + 30 > directory.centralStart || view.getUint32(local, true) !== 0x04034b50) fail("ZIP invalid local record");
    const payload = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    records.push({ start: local, end: payload }, { start: offset, end: next });
    if (view.getUint16(local + 6, true) & 8) {
      const descriptor = payload + values[1]!;
      const wide = view.getUint32(local + 18, true) === 0xffffffff || view.getUint32(local + 22, true) === 0xffffffff;
      records.push({ start: descriptor, end: descriptor + (view.getUint32(descriptor, true) === 0x08074b50 ? 4 : 0) + (wide ? 20 : 12) });
    }
    central.push({ start: offset, local, ...(raw[2] === 0xffffffff && extraOffset !== undefined ? { extraOffset: extraOffset + (raw[0] === 0xffffffff ? 8 : 0) + (raw[1] === 0xffffffff ? 8 : 0) } : {}) });
    offset = next;
    await yieldTurn(signal);
  }
  if (directory.centralEnd !== end) records.push({ start: directory.centralEnd, end: end - 20 }, { start: end - 20, end });
  records.push({ start: end, end: input.length });
  records.sort((a, b) => a.start - b.start);
  const starts = [0];
  let source = 0, used = 4;
  for (const record of records) {
    if (record.start < source || record.end > input.length || record.end - record.start > size) fail("ZIP record cannot fit in split volume");
    while (record.start - source >= size - used && record.start > source) {
      source += size - used; starts.push(source); used = 0;
    }
    used += record.start - source; source = record.start;
    if (record.end - record.start > size - used) { starts.push(source); used = 0; }
    used += record.end - source; source = record.end;
  }
  if (starts.length > limits.maxMembers || starts.length >= 65535) fail("ZIP split volume count limit exceeded");
  const parts = starts.map((start, index) => new Uint8Array((starts[index + 1] ?? input.length) - start + (index === 0 ? 4 : 0)));
  new DataView(parts[0]!.buffer).setUint32(0, 0x08074b50, true);
  for (let index = 0; index < parts.length; index++) {
    const finish = starts[index + 1] ?? input.length;
    for (let pos = starts[index]!; pos < finish; pos += limits.chunkSize) {
      signal.throwIfAborted();
      parts[index]!.set(input.subarray(pos, Math.min(finish, pos + limits.chunkSize)), pos - starts[index]! + (index === 0 ? 4 : 0));
      await yieldTurn(signal);
    }
  }
  const location = (position: number) => {
    let disk = starts.length - 1;
    while (starts[disk]! > position) disk--;
    return { disk, relative: position - starts[disk]! + (disk === 0 ? 4 : 0) };
  };
  for (const record of central) {
    const here = location(record.start), local = location(record.local);
    const header = new DataView(parts[here.disk]!.buffer);
    header.setUint16(here.relative + 34, local.disk, true);
    if (record.extraOffset === undefined) header.setUint32(here.relative + 42, local.relative, true);
    else header.setBigUint64(here.relative + record.extraOffset - record.start, BigInt(local.relative), true);
  }
  const last = parts.length - 1, finish = location(end), centralStart = location(directory.centralStart);
  const header = new DataView(parts[last]!.buffer);
  const onLast = central.filter(record => location(record.start).disk === last).length;
  header.setUint16(finish.relative + 4, last, true); header.setUint16(finish.relative + 6, centralStart.disk, true);
  header.setUint16(finish.relative + 8, Math.min(onLast, 65535), true);
  if (view.getUint32(end + 16, true) !== 0xffffffff) header.setUint32(finish.relative + 16, centralStart.relative, true);
  if (directory.centralEnd !== end) {
    const wide = location(directory.centralEnd);
    const wideHeader = new DataView(parts[wide.disk]!.buffer);
    const onWide = central.filter(record => location(record.start).disk === wide.disk).length;
    wideHeader.setUint32(wide.relative + 16, wide.disk, true); wideHeader.setUint32(wide.relative + 20, centralStart.disk, true);
    wideHeader.setBigUint64(wide.relative + 24, BigInt(onWide), true); wideHeader.setBigUint64(wide.relative + 48, BigInt(centralStart.relative), true);
    const locator = location(end - 20), locatorHeader = new DataView(parts[locator.disk]!.buffer);
    locatorHeader.setUint32(locator.relative + 4, wide.disk, true); locatorHeader.setBigUint64(locator.relative + 8, BigInt(wide.relative), true);
    locatorHeader.setUint32(locator.relative + 16, parts.length, true);
  }
  return parts;
}

/** All destinations preflight; all volumes staged before the first per-volume publication. */
export async function publishZipVolumes(scope: ZipScope, publication: ZipPublication, parts: readonly Uint8Array[], inputPaths: readonly string[], before: (path: string, disk: number) => Promise<void>): Promise<void> {
  const { fs, signal } = scope.context;
  if (!fs.publishStagedFile) fail("ZIP split publication requires atomic owned staging");
  const destinations: ZipPublication[] = [];
  const forbidden = new Set(inputPaths);
  const inputStats = await Promise.all(inputPaths.map(path => scope.stat(path)));
  for (let disk = 0; disk < parts.length; disk++) {
    const output = volumeName(publication.output, disk, parts.length);
    checkPath(output, scope.limits);
    if (forbidden.has(output)) fail("ZIP split output aliases an input volume");
    const existing = await scope.stat(output);
    if (existing && (existing.type !== "file" || !hasIdentity(existing) || existing.nlink !== 1 || inputStats.some(stat => stat && sameIdentity(stat, existing)))) fail("ZIP split destination is not a safe regular file");
    const capabilities = await scope.operation(() => fs.capabilitiesFor?.(output, { signal, create: true }) ?? fs.capabilities);
    if (capabilities.atomicFileStaging !== true) fail("ZIP split publication requires atomic owned staging");
    destinations.push({ ...publication, output, existing, bytes: parts[disk]! });
  }
  const staged: FileStaging[] = [];
  const stage = async (disk: number): Promise<void> => {
    if (disk < destinations.length) {
      const prepared = destinations[disk]!;
      await writeFileOutput(scope.context, prepared.bytes!, () => stageZip(scope, { ...prepared, stagingPrefix: `zip-volume-${disk + 1}`, reservedPath: prepared.output, parent: prepared.stagingParent ?? prepared.parent, parentStat: prepared.stagingParentStat ?? prepared.parentStat }, async value => {
        staged.push(value);
        await before(prepared.output, disk);
        await stage(disk + 1);
      }));
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
