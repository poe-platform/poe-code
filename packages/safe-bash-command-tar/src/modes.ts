import { dirname, retainFileSystemCleanup } from "@poe-code/safe-fs/core";
import { compareIdentity, compareFileVersion } from "@poe-code/safe-fs/contracts";
import { ArchiveMetadataMap } from "safe-bash-io-engine/commands/archive/metadata";
import { createArchiveScratchFactory } from "safe-bash-io-engine/commands/archive/scratch";
import { createArchive,manifest } from "./create.js";
import { readArchive } from "./extract.js";
import { quoteName } from "./listing.js";
import type { TarOptions } from "./options.js";
import { autodetected,compressed,Reader,recordPadding } from "./stream.js";
import { resolvePath,type ByteSource,type CommandContext,type FileStaging } from "safe-bash-contracts";
import { encodeBytes,equalBytes } from "safe-bash-io-engine/byte-encoding";
import { bounded,Budget,display,fail,fileSource,maybeStat,operation,vfsPath } from "safe-bash-io-engine/commands/archive/internal";

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
      if (compareIdentity(stat, stat) !== "same" || (target && compareIdentity(target, target) !== "same")) fail("filesystem lacks identity required for hardlink comparison");
      if (!target || compareIdentity(stat, target) !== "same") await difference("Not linked to archive target");
    } else if (entry.type === "0") {
      if (stat.size !== entry.size) { await difference("Size differs"); await reader.discard(entry.size); return; }
      const actual = new Reader(fileSource(context, path, budget.limits), context.signal);
      let equal = true;
      try {
        for await (const chunk of reader.body(entry.size)) {
          const bytes = await actual.exact(chunk.length);
          if (!equalBytes(encodeBytes(chunk), bytes)) equal = false;
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

let mutationSerial = 0;

export async function mutateArchive(context: CommandContext, options: TarOptions, budget: Budget): Promise<void> {
  if (options.archive === "-") fail("archive mutation requires a named archive");
  if (options.compression) fail("cannot modify compressed archives");
  const controller = new AbortController();
  context = { ...context, signal: AbortSignal.any([context.signal, controller.signal]) };
  const { fs, signal } = context;
  const path = vfsPath(context.cwd, options.archive);
  const stat = await maybeStat(context, path);
  if (!stat || stat.type !== "file") fail("archive mutation requires an existing regular file");
  if (compareIdentity(stat, stat) !== "same") fail("cannot safely replace an archive with unknown backing identity");
  const capabilities = await fs.capabilitiesFor?.(path, { signal }) ?? fs.capabilities;
  if (!fs.openReadFile || !fs.createStagedFile || !fs.publishStagedFile || !fs.removeStagedFile
    || capabilities.retainedRead !== true || capabilities.retainedStagingWrite !== true
    || capabilities.retainedStagingCleanup !== true) fail("archive mutation requires retained reads and owned streaming staging");
  const parentPath = dirname(path);
  const parent = await fs.stat(parentPath, { signal });
  let staging: FileStaging | undefined;
  let scratch: ReturnType<typeof createArchiveScratchFactory> | undefined;
  const removeStaging = retainFileSystemCleanup(fs, async view => {
    if (staging?.cleanup) await staging.cleanup.remove();
    else if (staging) await view.removeStagedFile!(staging);
  }, { maxOperations: 16 });
  let closing: Promise<void> | undefined;
  const cleanup = (): Promise<void> => {
    if (!closing) {
      controller.abort(new Error("tar mutation is closed"));
      // Drain the admitted mutation, including acquisition and handle finally
      // blocks, before removing its staging. The microtask also covers cleanup
      // requested synchronously during registration, before work is assigned.
      closing = Promise.resolve().then(async () => {
        await work.catch(() => {});
        try { await scratch?.close(); } finally { await removeStaging(); }
      });
    }
    return closing;
  };
  context.registerCleanup?.(cleanup);
  const work = (async () => {
    signal.throwIfAborted();
    for (let attempt = 0; attempt < budget.limits.maxMembers; attempt++) {
      const temporary = resolvePath(parentPath, `.tar-mutation-${++mutationSerial}`);
      if (temporary === path) continue;
      try {
        staging = await fs.createStagedFile!(temporary, "archive", { type: "file", data: new Uint8Array() }, {
          signal, parent, retainCleanup: true, ...(capabilities.permissions === false ? {} : { mode: stat.mode & 0o7777 }),
        });
        signal.throwIfAborted();
        break;
      } catch (error) {
        signal.throwIfAborted();
        if (typeof error !== "object" || error === null || !("code" in error) || error.code !== "EEXIST") throw error;
      }
    }
    if (!staging?.writer) fail("archive mutation requires a retained staged writer");
    scratch = createArchiveScratchFactory({ context, limits: budget.limits, operation: action => Promise.resolve(action()) }, staging.directory.path);
    await scratch.initialize();
    const mutationDirectory = staging.directory.path;
    const backing = { factory: scratch, ownsPath: (input: string) => input === mutationDirectory || input.startsWith(`${mutationDirectory}/`) || scratch!.ownsPath(input) };
    const writer = staging.writer;
    let changed = false;
    let bytes = 0;
    const add = async (part: Uint8Array) => {
      if (part.length > budget.limits.maxArchiveBytes - bytes) fail("archive byte limit exceeded");
      for (let offset = 0; offset < part.length; offset += budget.limits.chunkSize) {
        signal.throwIfAborted();
        await writer.write(part.subarray(offset, offset + budget.limits.chunkSize), { signal });
      }
      bytes += part.length;
    };
    const times = new ArchiveMetadataMap<number | undefined>(scratch, signal);
    const scan = async (inputPath: string, deleting: boolean) => {
      const expected = await fs.stat(inputPath, { signal });
      if (expected.type !== "file" || compareIdentity(expected, expected) !== "same") fail("concatenation source must be a regular archive with retained identity");
      if (inputPath !== path && compareIdentity(stat, expected) === "same") fail("cannot concatenate an archive to itself");
      const handle = await fs.openReadFile!(inputPath, { signal });
      try {
        const validate = async () => {
          const current = await handle.stat({ signal });
          if (compareIdentity(expected, current) !== "same" || !compareFileVersion(expected, current)) fail("archive changed during preparation");
        };
        await validate();
        const range = async function* (start: number, end: number): ByteSource {
          while (start < end) {
            const chunk = await handle.read(start, Math.min(budget.limits.chunkSize, end - start), { signal });
            if (!chunk.length || chunk.length > end - start) fail("archive changed during preparation");
            start += chunk.length;
            yield chunk;
          }
        };
        const prefix = new Uint8Array(Math.min(6, expected.size));
        let prefixOffset = 0;
        for await (const chunk of range(0, prefix.length)) {
          prefix.set(chunk, prefixOffset);
          prefixOffset += chunk.length;
        }
        if (prefix[0] === 31 && prefix[1] === 139
          || prefix[0] === 66 && prefix[1] === 90 && prefix[2] === 104
          || [253, 55, 122, 88, 90, 0].every((byte, index) => prefix[index] === byte)) fail("cannot modify compressed archives");
        // readArchive checks headers and all padding; copying from the same
        // retained handle preserves PAX/long-name records without retaining bodies.
        await readArchive(context, bounded(range(0, expected.size), budget.limits.maxArchiveBytes, signal, budget.limits.chunkSize), deleting ? options : { ...options, mode: "t", operands: [], excludes: [] }, budget, {
          rejectGlobal: true,
          async member(entry, reader, selected, _root, start) {
            const end = reader.position + entry.size + (512 - entry.size % 512) % 512;
            if (!deleting || !selected) for await (const chunk of range(start, end)) await add(chunk);
            else changed = true;
            if (options.mode === "u") {
              const name = entry.name.endsWith("/") ? entry.name.slice(0, -1) : entry.name;
              const prior = await times.get(name);
              if (!await times.has(name) || entry.mtime === undefined || (prior !== undefined && entry.mtime > prior)) await times.set(name, entry.mtime);
            }
            await reader.discard(entry.size);
          },
        });
        await validate();
      } finally { await handle.close(); }
    };
    await scan(path, options.mode === "delete");
    if (options.mode === "A") {
      for (const operand of options.operands) {
        const inputPath = vfsPath(operand.cwd, operand.name);
        if (inputPath === path) fail("cannot concatenate an archive to itself");
        await scan(inputPath, false);
        changed = true;
      }
    } else if (options.mode === "r" || options.mode === "u") {
      const prepared = await manifest(context, options, budget, backing);
      const entries = { async *[Symbol.asyncIterator]() {
        for await (const source of prepared.entries) {
          if (options.mode === "u") {
            const name = source.entry.name.endsWith("/") ? source.entry.name.slice(0, -1) : source.entry.name;
            if (await times.has(name)) {
              const archived = await times.get(name);
              if (archived === undefined) fail("archive lacks mtime required for update");
              if (source.stat.mtimeMs / 1000 <= archived) continue;
            }
          }
          changed = true;
          yield source;
        }
      } };
      // createArchive's final chunk is its terminator. Delay one chunk so it
      // can be replaced by the single terminator shared by all input archives.
      let pending: Uint8Array | undefined;
      for await (const chunk of createArchive(context, entries, options, budget, backing)) {
        if (pending) await add(pending);
        pending = new Uint8Array(chunk);
      }
      if (!pending || pending.length !== 1024 || pending.some(byte => byte !== 0)) fail("invalid archive terminator");
    }
    await scratch.close();
    if (changed) {
      await add(new Uint8Array(1024));
      let padding = recordPadding(bytes, options.recordSize, budget.limits.maxArchiveBytes);
      while (padding > 0) {
        const length = Math.min(padding, budget.limits.chunkSize);
        await add(new Uint8Array(length));
        padding -= length;
      }
      const finished = await writer.finish({ signal });
      staging = { ...staging, file: { ...staging.file, stat: finished } };
      const current = await maybeStat(context, path);
      if (!current || compareIdentity(stat, current) !== "same" || !compareFileVersion(stat, current)) fail("archive changed during preparation");
      await fs.publishStagedFile!(staging, path, { signal, parent, destination: stat });
      if (options.totals) await budget.output(`Total bytes written: ${bytes}\n`, true);
    }
  })();
  let failure: { reason: unknown } | undefined;
  try { await work; } catch (reason) { failure = { reason }; }
  try { await cleanup(); }
  catch (reason) {
    if (failure) throw new AggregateError([failure.reason, reason], "tar mutation and cleanup failed");
    throw reason;
  }
  if (failure) throw failure.reason;
}
