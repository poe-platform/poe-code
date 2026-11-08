import { createHash } from 'node:crypto';
import * as nodeFs from 'node:fs/promises';
import { constants } from 'node:fs';
import { posix } from 'node:path';
import type { DependencyEntry, DependencyManifest } from './protocol.js';

export class TreeError extends Error {
  constructor(readonly code: 'missing-blob' | 'wrong-length' | 'wrong-hash' | 'collision' | 'unauthorized' | 'unsupported' | 'unstable-capture') { super(code); }
}
export type TreeFs = Pick<typeof nodeFs, 'mkdtemp' | 'mkdir' | 'open' | 'lstat' | 'readlink' | 'symlink' | 'readdir' | 'rm' | 'realpath'>;
export type TreeRootIdentity = Pick<Awaited<ReturnType<TreeFs['lstat']>>, 'dev' | 'ino' | 'uid' | 'mode'>;
/** Number-based Node stats must represent identity exactly. Missing fields or
 * rounded inode/device values cannot qualify ownership or replacement checks. */
export function assertTreeIdentity(stat: TreeRootIdentity): void {
  for (const value of [stat.dev, stat.ino, stat.uid, stat.mode])
    if (!Number.isSafeInteger(value) || value < 0) throw new TreeError('unsupported');
}
export function textPath(bytes: number[]): string {
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Uint8Array.from(bytes)); }
  catch { throw new TreeError('unsupported'); }
}
export function entryPath(entry: DependencyEntry): string { return entry.path.map(textPath).join('/'); }

/** Conservative Node profile: independently uploaded immutable inputs only.
 * Mutable sources require a canonical native-open bridge and are not advertised.
 * The parent is provisioned by the operator, private to the service. Neither
 * callers nor native processes may mutate staging; namespace drivers mount an
 * isolated read-only view and keep command writes in separate owned state. */
export function admitTree(manifest: DependencyManifest) {
  const root = textPath(manifest.logicalRoot);
  const cwd = textPath(manifest.cwd);
  if (root === '/' || posix.normalize(root) !== root || root.endsWith('/')) throw new TreeError('unsupported');
  const entries = new Map(manifest.entries.map(e => [entryPath(e), e]));
  // Admission keys only: never normalize, rewrite or suffix stored names. This
  // conservative profile refuses common cross-platform aliases even on a
  // case-sensitive volume. Exclusive creation and byte-exact inspection remain
  // authoritative for additional target-filesystem collisions.
  const aliases = new Set<string>();
  for (const entry of manifest.entries) {
    const alias = entryPath(entry).normalize('NFD').toUpperCase().toLowerCase();
    if (aliases.has(alias)) throw new TreeError('collision');
    aliases.add(alias);
    if (entry.metadata || entry.kind === 'hardlink' || entry.source.retainedIdentity !== null
      || (entry.kind === 'file' && entry.identityRef !== undefined)) throw new TreeError('unsupported');
    if (entry.kind !== 'output-intent' && entry.source.freshness !== 'immutable') throw new TreeError('unsupported');
    if (entry.kind === 'symlink' && textPath(entry.target).startsWith('/')) throw new TreeError('unsupported');
  }
  function resolve(relative: string, requirePresent = false): string {
    const pending = relative.split('/'); const parts: string[] = []; let hops = 0;
    while (pending.length) {
      const part = pending.shift()!;
      if (!part || part === '.') continue;
      if (part === '..') { if (!parts.length) throw new TreeError('unauthorized'); parts.pop(); continue; }
      parts.push(part);
      const entry = entries.get(parts.join('/'));
      // Cwd traversal must reach each component before processing a later '..'.
      // Link admission may retain dangling targets for failure at native access.
      if (requirePresent && (!entry || entry.kind === 'output-intent')) throw new TreeError('unsupported');
      if (entry?.kind === 'symlink') {
        if (++hops > 40) throw new TreeError('unsupported');
        parts.pop(); pending.unshift(...textPath(entry.target).split('/'));
      } else if (pending.length && entry && entry.kind !== 'directory') throw new TreeError('unsupported');
    }
    return parts.join('/');
  }
  for (const [path, entry] of entries) if (entry.kind === 'symlink') resolve(path);
  function resolveCwd(path: number[]): string {
    const value = textPath(path);
    if (value !== root && !value.startsWith(`${root}/`)) throw new TreeError('unauthorized');
    const result = resolve(value.slice(root.length), true);
    if (result && entries.get(result)?.kind !== 'directory') throw new TreeError('unsupported');
    return result;
  }
  resolveCwd(manifest.cwd);
  return { root, cwd, entries, resolveCwd };
}

export async function verifyTree(fs: TreeFs, physicalRoot: string, manifest: DependencyManifest, expectedRoot?: TreeRootIdentity, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const expected = new Set(manifest.entries.filter(e => e.kind !== 'output-intent').map(entryPath));
  const verified = new Map<string, Awaited<ReturnType<TreeFs['lstat']>>>();
  async function walk(path: string) {
    signal?.throwIfAborted();
    if (await fs.realpath(path) !== path) throw new TreeError('collision');
    for (const name of await fs.readdir(path, { encoding: 'utf8' })) {
      signal?.throwIfAborted();
      const full = `${path}/${name}`; const relative = full.slice(physicalRoot.length + 1);
      if (!expected.has(relative)) throw new TreeError('collision');
      const stat = await fs.lstat(full);
      assertTreeIdentity(stat);
      if (stat.uid !== rootStat.uid) throw new TreeError('collision');
      if (stat.isDirectory()) await walk(full);
    }
  }
  const rootStat = await fs.lstat(physicalRoot);
  assertTreeIdentity(rootStat);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new TreeError('collision');
  if (expectedRoot && (rootStat.dev !== expectedRoot.dev || rootStat.ino !== expectedRoot.ino
    || rootStat.uid !== expectedRoot.uid || rootStat.mode !== expectedRoot.mode)) throw new TreeError('collision');
  await walk(physicalRoot);
  for (const entry of manifest.entries) {
    signal?.throwIfAborted();
    if (entry.kind === 'output-intent') continue;
    const path = `${physicalRoot}/${entryPath(entry)}`;
    const stat = await fs.lstat(path);
    assertTreeIdentity(stat);
    if (stat.uid !== rootStat.uid) throw new TreeError('collision');
    // Staging is exclusively service-owned at handoff, including descendants.
    // Symlink mode bits do not control writes and commonly read as 0777.
    if (entry.kind !== 'symlink' && (stat.mode & 0o022) !== 0) throw new TreeError('collision');
    verified.set(path, stat);
    if (entry.kind === 'directory') { if (!stat.isDirectory() || stat.isSymbolicLink()) throw new TreeError('collision'); }
    else if (entry.kind === 'symlink') { if (!stat.isSymbolicLink() || !Buffer.from(await fs.readlink(path, { encoding: 'buffer' })).equals(Buffer.from(entry.target))) throw new TreeError('collision'); }
    else if (entry.kind === 'file') {
      if (!stat.isFile() || stat.isSymbolicLink()) throw new TreeError('collision');
      // This profile admits independent files, never hardlinks. Equal bytes
      // cannot qualify an object shared with another tree or canonical data.
      if (!Number.isSafeInteger(stat.nlink)) throw new TreeError('unsupported');
      if (stat.nlink !== 1) throw new TreeError('collision');
      const admittedSize = BigInt(entry.blob.size);
      if (BigInt(stat.size) !== admittedSize) throw new TreeError('wrong-length');
      // Refuse an already redirected ancestor before acquiring any handle.
      // Keep the post-open check too: this probe alone cannot prevent races.
      if (await fs.realpath(posix.dirname(path)) !== posix.dirname(path)) throw new TreeError('collision');
      const file = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        // This compares the owned staging object only, not a source identity or
        // freshness promise. The no-follow open is the pathname safety boundary.
        // O_NOFOLLOW protects only the final component. Reject an ancestor
        // redirected outside the exclusively owned tree, including a link to
        // a relocated object with the same dev/ino. Exclusive staging ownership
        // remains required; path probes cannot qualify concurrent hostile writers.
        if (await fs.realpath(posix.dirname(path)) !== posix.dirname(path)) throw new TreeError('collision');
        const opened = await file.stat();
        assertTreeIdentity(opened);
        if (!opened.isFile() || opened.dev !== stat.dev || opened.ino !== stat.ino
          || opened.uid !== rootStat.uid || opened.nlink !== 1) throw new TreeError('collision');
        if (BigInt(opened.size) !== admittedSize) throw new TreeError('wrong-length');
        const hash = createHash('sha256'); let size = 0n; const buffer = new Uint8Array(65536);
        for (;;) {
          signal?.throwIfAborted();
          // Read at most one byte beyond the admitted length, including for an
          // empty file. Drift must not turn verification into an unbounded read.
          const remaining = admittedSize - size + 1n;
          const count = remaining < BigInt(buffer.length) ? Number(remaining) : buffer.length;
          const { bytesRead } = await file.read(buffer, 0, count, null);
          signal?.throwIfAborted();
          if (!bytesRead) break;
          size += BigInt(bytesRead);
          if (size > admittedSize) throw new TreeError('wrong-length');
          hash.update(buffer.subarray(0, bytesRead));
        }
        if (size !== admittedSize) throw new TreeError('wrong-length');
        if (hash.digest('hex') !== entry.blob.sha256) throw new TreeError('wrong-hash');
        // Hashing the opened object alone cannot verify that the admitted name
        // still refers to it. Detect replacements during the read as well as
        // before open; exclusive ownership is still the concurrency guarantee.
        const current = await fs.lstat(path);
        assertTreeIdentity(current);
        if (!current.isFile() || current.isSymbolicLink()
          || current.dev !== opened.dev || current.ino !== opened.ino
          || current.uid !== rootStat.uid || current.nlink !== 1
          || await fs.realpath(posix.dirname(path)) !== posix.dirname(path)) throw new TreeError('collision');
      } finally { await file.close(); }
    }
  }
  // A link or directory checked early can be replaced while later files are
  // hashed. Recheck the complete namespace before declaring it verified. This
  // detects drift; exclusive staging ownership remains the race prevention
  // guarantee, including the interval between verification and native access.
  await walk(physicalRoot);
  const currentRoot = await fs.lstat(physicalRoot);
  assertTreeIdentity(currentRoot);
  if (!currentRoot.isDirectory() || currentRoot.isSymbolicLink()
    || currentRoot.dev !== rootStat.dev || currentRoot.ino !== rootStat.ino
    || currentRoot.uid !== rootStat.uid || currentRoot.mode !== rootStat.mode) throw new TreeError('collision');
  for (const entry of manifest.entries) {
    signal?.throwIfAborted();
    if (entry.kind === 'output-intent') continue;
    const path = `${physicalRoot}/${entryPath(entry)}`;
    const before = verified.get(path)!;
    const current = await fs.lstat(path);
    assertTreeIdentity(current);
    if (current.dev !== before.dev || current.ino !== before.ino
      || current.mode !== before.mode || current.uid !== rootStat.uid) throw new TreeError('collision');
    if (entry.kind === 'symlink'
      && (!current.isSymbolicLink() || !Buffer.from(await fs.readlink(path, { encoding: 'buffer' })).equals(Buffer.from(entry.target)))) throw new TreeError('collision');
    if (entry.kind === 'directory' && (!current.isDirectory() || current.isSymbolicLink())) throw new TreeError('collision');
    if (entry.kind === 'file' && (!current.isFile() || current.isSymbolicLink()
      || current.nlink !== 1 || current.size !== before.size || current.mtimeMs !== before.mtimeMs
      || current.ctimeMs !== before.ctimeMs)) throw new TreeError('unstable-capture');
  }
}
