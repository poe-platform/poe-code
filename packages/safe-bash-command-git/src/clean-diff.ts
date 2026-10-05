import type { FileSystem } from '@poe-code/safe-fs/core';

const cleanDiffOptions = new Set([
  '--stat', '--shortstat', '--numstat', '--name-only', '--name-status',
  '--quiet', '--exit-code', '--no-ext-diff', '--no-color',
]);
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

/** Prove an index/worktree diff is empty without loading repository history. */
export async function isCleanDiff(
  fs: FileSystem, root: string, args: readonly string[], signal: AbortSignal,
): Promise<boolean> {
  if (args[0] !== 'diff' || !args.slice(1).every(arg => cleanDiffOptions.has(arg))) return false;
  if (!globalThis.crypto?.subtle) return false;
  try {
    const index = await fs.readFile(`${root}/.git/index`, { signal });
    if (index.length < 32) return false;
    const view = new DataView(index.buffer, index.byteOffset, index.byteLength);
    if (view.getUint32(0) !== 0x44495243 || view.getUint32(4) !== 2) return false;
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', index.slice(0, -20)));
    if (!digest.every((byte, i) => byte === index[index.length - 20 + i])) return false;
    const count = view.getUint32(8);
    const tracked: { path: string; mode: number; oid: Uint8Array }[] = [];
    let offset = 12;
    for (let i = 0; i < count; i++) {
      if (offset + 62 >= index.length - 20) return false;
      const flags = view.getUint16(offset + 60);
      // Conflict stages, extended entries and assume-unchanged need the full engine.
      if ((flags & 0xf000) !== 0) return false;
      const mode = view.getUint32(offset + 24);
      if (mode !== 0o100644 && mode !== 0o100755 && mode !== 0o120000) return false;
      const end = index.indexOf(0, offset + 62);
      if (end < 0 || end >= index.length - 20) return false;
      const path = decoder.decode(index.subarray(offset + 62, end));
      if (path.split('/').some(part => !part || part === '.' || part === '..' || part === '.git')) return false;
      if ((flags & 0xfff) !== Math.min(end - offset - 62, 0xfff)) return false;
      tracked.push({ path, mode, oid: index.slice(offset + 40, offset + 60) });
      offset += (end - offset + 8) & ~7;
    }
    // Optional extensions start with uppercase letters. Required extensions need
    // the full index reader (for example split indexes).
    while (offset < index.length - 20) {
      if (offset + 8 > index.length - 20 || index[offset]! < 65 || index[offset]! > 90) return false;
      offset += 8 + view.getUint32(offset + 4);
    }
    if (offset !== index.length - 20) return false;
    for (let i = 0; i < tracked.length; i += 32) {
      signal.throwIfAborted();
      const matches = await Promise.all(tracked.slice(i, i + 32).map(async entry => {
        const path = `${root}/${entry.path}`;
        const stat = await fs.lstat(path, { signal });
        let bytes: Uint8Array;
        if (entry.mode === 0o120000) {
          if (stat.type !== 'symlink' || !fs.readlink) return false;
          bytes = encoder.encode(await fs.readlink(path, { signal }));
        } else {
          if (stat.type !== 'file' || (stat.mode & 0o100) !== (entry.mode & 0o100)) return false;
          bytes = await fs.readFile(path, { signal });
        }
        const header = encoder.encode(`blob ${bytes.length}\0`);
        const blob = new Uint8Array(header.length + bytes.length);
        blob.set(header);
        blob.set(bytes, header.length);
        const oid = new Uint8Array(await crypto.subtle.digest('SHA-1', blob));
        return oid.every((byte, j) => byte === entry.oid[j]);
      }));
      if (matches.some(match => !match)) return false;
    }
    signal.throwIfAborted();
    return true;
  } catch {
    signal.throwIfAborted();
    return false;
  }
}
