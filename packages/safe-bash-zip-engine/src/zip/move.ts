import { dirname,type FileStat } from "safe-bash-contracts";
import { fail,hasIdentity,sameIdentity,type Budget } from "safe-bash-io-engine/commands/archive/internal";
import type { ZipScope } from "./safety.js";

export interface ZipMoveSource {
  readonly path: string;
  readonly source: string;
  readonly parent: FileStat;
  expected: FileStat;
}

export async function inspectZipMoveSource(scope: ZipScope, path: string, source: string): Promise<ZipMoveSource> {
  const { fs, signal } = scope.context;
  const capabilities = await scope.operation(() => fs.capabilitiesFor?.(path, { signal }) ?? fs.capabilities);
  if (capabilities.atomicEntryRemoval !== true || !fs.removeEntryConditional) fail("ZIP move requires atomic conditional source removal");
  const parentPath = await scope.operation(() => fs.realpath(dirname(path), { signal }));
  const parent = await scope.operation(() => fs.lstat(parentPath, { signal }));
  const expected = await scope.operation(() => fs.lstat(path, { signal }));
  if (parent.type !== "directory" || !hasIdentity(parent) || !hasIdentity(expected) || !Number.isSafeInteger(expected.revision)) fail("ZIP move requires known source identity and revision");
  return { path: `${parentPath === "/" ? "" : parentPath}/${path.slice(path.lastIndexOf("/") + 1)}`, source, parent, expected };
}

export interface ZipMoveBacking {
  createMap<T>(): {
    get(key: string): Promise<T | undefined>;
    set(key: string, value: T): Promise<void>;
    sortedEntries(): AsyncIterable<[string, T]>;
  };
  /** Stable scoped identity supplied by the caller's provider-binding registry. */
  identityKey(stat: FileStat): string;
}

export async function removeZipSources(scope: ZipScope, sources: Iterable<ZipMoveSource> | AsyncIterable<ZipMoveSource>, budget: Budget, quiet: boolean, backing?: ZipMoveBacking): Promise<void> {
  const { fs, signal } = scope.context;
  if (backing) {
    const pending = backing.createMap<ZipMoveSource>();
    const revisions = backing.createMap<number>();
    let sequence = 0;
    for await (const entry of sources) {
      signal.throwIfAborted();
      const depth = entry.path.split("/").length;
      const key = `${entry.expected.type === "directory" ? 1 : 0}:${String(Number.MAX_SAFE_INTEGER - depth).padStart(16, "0")}:${String(sequence++).padStart(16, "0")}`;
      await pending.set(key, entry);
    }
    for await (const [, entry] of pending.sortedEntries()) {
      let removed = false;
      try {
        const advanced = await revisions.get(backing.identityKey(entry.expected)) ?? 0;
        if (advanced) {
          const current = await scope.stat(entry.path);
          const revision = Math.min(Number.MAX_SAFE_INTEGER + 1, entry.expected.revision! + advanced);
          if (current && sameIdentity(current, entry.expected) && current.type === entry.expected.type && current.revision === revision) entry.expected = current;
        }
        if (!fs.removeEntryConditional) fail("ZIP conditional source removal unavailable");
        await scope.operation(() => fs.removeEntryConditional!(entry.path, { parent: entry.parent, expected: entry.expected, signal }));
        removed = true;
      } catch {
        signal.throwIfAborted();
        if (entry.expected.type !== "directory" && !quiet) await budget.output(`\tzip warning: error deleting ${entry.source}\n`);
      }
      if (removed) {
        // A successful unlink advances the parent and linked inode once.
        // Applying these owned deltas lazily is equivalent to refreshing every
        // pending alias eagerly; unrelated revisions still fail comparison.
        for (const changed of [entry.parent, entry.expected]) {
          const key = backing.identityKey(changed);
          await revisions.set(key, (await revisions.get(key) ?? 0) + 1);
        }
      }
    }
    return;
  }
  // Explicit compatibility profile for callers without backing storage.
  const buffered: ZipMoveSource[] = [];
  for await (const entry of sources) buffered.push(entry);
  const pending = buffered.sort((a, b) => Number(a.expected.type === "directory") - Number(b.expected.type === "directory") || b.path.split("/").length - a.path.split("/").length);
  const remaining = new Set(pending);
  const identities = new Map<unknown, Map<string, ZipMoveSource[]>>();
  for (const entry of pending) {
    let scoped = identities.get(entry.expected.identityScope);
    if (!scoped) identities.set(entry.expected.identityScope, scoped = new Map());
    const key = `${entry.expected.dev}:${entry.expected.ino}`;
    const grouped = scoped.get(key);
    if (grouped) grouped.push(entry);
    else scoped.set(key, [entry]);
  }
  for (let index = 0; index < pending.length; index++) {
    const entry = pending[index]!;
    try {
      if (!fs.removeEntryConditional) fail("ZIP conditional source removal unavailable");
      await scope.operation(() => fs.removeEntryConditional!(entry.path, { parent: entry.parent, expected: entry.expected, signal }));
      // Removing an owned child updates its parent's revision; unlinking also
      // updates the removed inode's remaining hardlinks. Advance only these
      // known revisions, so unrelated changes still fail the atomic comparison.
      remaining.delete(entry);
      for (const changed of [entry.parent, entry.expected]) {
        const candidates = identities.get(changed.identityScope)?.get(`${changed.dev}:${changed.ino}`) ?? [];
        for (const candidate of candidates) {
          if (!remaining.has(candidate)) continue;
          const revision = Math.min(Number.MAX_SAFE_INTEGER + 1, candidate.expected.revision! + 1);
          const current = await scope.stat(candidate.path);
          if (current && sameIdentity(current, candidate.expected) && current.type === candidate.expected.type && current.revision === revision) candidate.expected = current;
        }
      }
    } catch {
      signal.throwIfAborted();
      if (entry.expected.type !== "directory" && !quiet) await budget.output(`\tzip warning: error deleting ${entry.source}\n`);
    }
  }
}
