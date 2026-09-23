import { collectBytes, resolvePath, type ByteSource, type CommandContext } from "../../contracts/index.js";
import { createArchive, manifest } from "./create.js";
import { readArchive } from "./extract.js";
import { Budget, bounded, display, fail, fileSource, hasIdentity, maybeStat, operation, publish, sameIdentity, vfsPath } from "./internal.js";
import type { TarOptions } from "./options.js";
import { autodetected, compressed, Reader, recorded, recordPadding } from "./stream.js";
import { quoteName } from "./listing.js";

export async function compareArchive(context: CommandContext, options: TarOptions, budget: Budget): Promise<number> {
  let different = false;
  const input = bounded(options.archive === "-" ? context.stdin : fileSource(context, vfsPath(context.cwd, options.archive), budget.limits), budget.limits.maxArchiveBytes, context.signal, budget.limits.chunkSize);
  const source = options.compression ? compressed(input, true, context.signal, budget.limits, options.compression) : autodetected(input, context.signal, budget.limits);
  await readArchive(context, source, options, budget, { async member(entry, reader, selected, root) {
    const difference = async (message: string) => {
      different = true;
      await budget.output(`${display(entry.name)}: ${message}\n`);
    };
    if (!selected) { await reader.discard(entry.size); return; }
    if (entry.name.split("/").includes("..")) fail(`unsafe parent component in member: ${display(entry.name)}`);
    const path = resolvePath(root, entry.name);
    const stat = await maybeStat(context, path);
    if (!stat) { await difference("File is missing"); await reader.discard(entry.size); return; }
    const wanted = entry.type === "5" ? "directory" : entry.type === "2" ? "symlink" : "file";
    if (stat.type !== wanted) { await difference("File type differs"); await reader.discard(entry.size); return; }
    const capabilities = await operation(context, () => context.fs.capabilitiesFor?.(path, { signal: context.signal }) ?? context.fs.capabilities);
    if (capabilities.permissions === false || capabilities.timestamps === false) fail("filesystem lacks metadata required for archive comparison");
    if ((stat.mode & 0o7777) !== entry.mode) await difference("Mode differs");
    if (entry.uid !== undefined) {
      if (stat.uid === undefined) fail("filesystem lacks ownership required for archive comparison");
      if (stat.uid !== entry.uid) await difference("Uid differs");
    }
    if (entry.gid !== undefined) {
      if (stat.gid === undefined) fail("filesystem lacks ownership required for archive comparison");
      if (stat.gid !== entry.gid) await difference("Gid differs");
    }
    if (entry.type !== "2" && entry.mtime !== undefined && Math.floor(stat.mtimeMs / 1000) !== Math.floor(entry.mtime)) await difference("Mod time differs");
    if (entry.type === "2") {
      if (!context.fs.readlink) fail("filesystem lacks readlink required for archive comparison");
      if (await operation(context, () => context.fs.readlink!(path, { signal: context.signal })) !== entry.linkname) await difference("Symlink differs");
    } else if (entry.type === "1") {
      if (entry.linkname.split("/").includes("..")) fail("unsafe hardlink target in archive comparison");
      const target = await maybeStat(context, resolvePath(root, entry.linkname));
      if (!hasIdentity(stat) || (target && !hasIdentity(target))) fail("filesystem lacks identity required for hardlink comparison");
      if (!target || !sameIdentity(stat, target)) await difference("Not linked to archive target");
    } else if (entry.type === "0") {
      if (stat.size !== entry.size) { await difference("Size differs"); await reader.discard(entry.size); return; }
      const actual = new Reader(fileSource(context, path, budget.limits), context.signal);
      let equal = true;
      try {
        for await (const chunk of reader.body(entry.size)) {
          const bytes = await actual.exact(chunk.length);
          if (!Buffer.from(chunk).equals(bytes)) equal = false;
        }
        if (await actual.take(1)) equal = false;
      } finally { await actual.close(); }
      if (!equal) await difference("Contents differ");
      if (options.verbose) await budget.output(`${quoteName(entry.name, options.quotingStyle)}\n`);
      return;
    }
    await reader.discard(entry.size);
  } });
  return different ? 1 : 0;
}

export async function mutateArchive(context: CommandContext, options: TarOptions, budget: Budget): Promise<void> {
  if (options.archive === "-") fail("archive mutation requires a named archive");
  if (options.compression) fail("cannot modify compressed archives");
  const path = vfsPath(context.cwd, options.archive);
  const stat = await maybeStat(context, path);
  if (!stat || stat.type !== "file") fail("archive mutation requires an existing regular file");
  if (!hasIdentity(stat)) fail("cannot safely replace an archive with unknown backing identity");
  const parts: Uint8Array[] = [];
  let changed = false;
  let bytes = 1024;
  const add = (part: Uint8Array) => {
    if (part.length > budget.limits.maxArchiveBytes - bytes) fail("archive byte limit exceeded");
    bytes += part.length;
    parts.push(part);
  };
  const times = new Map<string, number | undefined>();
  const scan = async (inputPath: string, deleting: boolean) => {
    const data = await collectBytes(fileSource(context, inputPath, budget.limits), { ...(Number.isFinite(budget.limits.maxArchiveBytes) ? { maxBytes: budget.limits.maxArchiveBytes } : {}), signal: context.signal });
    const prefix = data.subarray(0, 6);
    if ((prefix[0] === 31 && prefix[1] === 139) || Buffer.from(prefix.subarray(0, 3)).toString() === "BZh" || [253, 55, 122, 88, 90, 0].every((value, index) => prefix[index] === value)) fail("cannot modify compressed archives");
    await readArchive(context, (async function* () { yield data; })(), deleting ? options : { ...options, mode: "t", operands: [], excludes: [] }, budget, {
      rejectGlobal: true,
      async member(entry, reader, selected, _root, start) {
        const end = reader.position + entry.size + (512 - entry.size % 512) % 512;
        if (!deleting || !selected) add(data.subarray(start, end));
        else changed = true;
        const name = entry.name.endsWith("/") ? entry.name.slice(0, -1) : entry.name;
        const prior = times.get(name);
        if (!times.has(name) || entry.mtime === undefined || (prior !== undefined && entry.mtime > prior)) times.set(name, entry.mtime);
        await reader.discard(entry.size);
      },
    });
  };
  await scan(path, options.mode === "delete");
  if (options.mode === "A") {
    for (const operand of options.operands) {
      const inputPath = vfsPath(operand.cwd, operand.name);
      const inputStat = await maybeStat(context, inputPath);
      if (!inputStat || inputStat.type !== "file") fail("concatenation source must be a regular archive");
      if (!hasIdentity(inputStat)) fail("concatenation source has unknown backing identity");
      if (sameIdentity(stat, inputStat)) fail("cannot concatenate an archive to itself");
      await scan(inputPath, false);
      changed = true;
    }
  } else if (options.mode === "r" || options.mode === "u") {
    const prepared = await manifest(context, options, budget);
    const entries = options.mode === "u" ? prepared.entries.filter(source => {
      const name = source.entry.name.endsWith("/") ? source.entry.name.slice(0, -1) : source.entry.name;
      if (!times.has(name)) return true;
      const archived = times.get(name);
      if (archived === undefined) fail("archive lacks mtime required for update");
      return source.stat.mtimeMs / 1000 > archived;
    }) : prepared.entries;
    const created = await collectBytes(createArchive(context, entries, options, budget), { ...(Number.isFinite(budget.limits.maxArchiveBytes - bytes + 1024) ? { maxBytes: budget.limits.maxArchiveBytes - bytes + 1024 } : {}), signal: context.signal });
    add(created.subarray(0, created.length - 1024));
    changed = entries.length > 0;
  }
  if (!changed) return;
  recordPadding(bytes, options.recordSize, budget.limits.maxArchiveBytes);
  parts.push(new Uint8Array(1024));
  // All reads, validation and source creation finish before replacing the archive.
  const current = await maybeStat(context, path);
  if (!current || !sameIdentity(stat, current) || current.size !== stat.size || current.mtimeMs !== stat.mtimeMs || current.ctimeMs !== stat.ctimeMs) fail("archive changed during preparation");
  await operation(context, () => context.fs.rm(path, { signal: context.signal }));
  await publish(context, path, recorded((async function* (): ByteSource { yield* parts; })(), options, budget), stat.mode & 0o7777);
}
