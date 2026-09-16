import { dirname, type FileStat } from "../../../contracts/index.js";
import { fail, hasIdentity, sameIdentity, type Budget } from "../internal.js";
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

export async function removeZipSources(scope: ZipScope, sources: readonly ZipMoveSource[], budget: Budget, quiet: boolean): Promise<void> {
  const { fs, signal } = scope.context;
  const pending = [...sources].sort((a, b) => Number(a.expected.type === "directory") - Number(b.expected.type === "directory") || b.path.split("/").length - a.path.split("/").length);
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
