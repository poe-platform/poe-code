import { PagedStorage } from '@poe-code/safe-fs/storage';
import { sha256 } from '@noble/hashes/sha2.js';
import type { ByteSource } from './contracts.js';
import { OfficeError } from './errors.js';
import type { RetainedPackageArchive, RetainedPackageContext } from './retained-package.js';

export interface RetainedMutationSource {
  readonly size: number;
  read(position: number, maximum: number, options: { readonly signal: AbortSignal }): Promise<Uint8Array>;
  stream(): ByteSource;
}
/** Borrow the admitted archive, replacement view and immutable input; own only output pages. */
export async function stageRetainedArchive(input: RetainedMutationSource, originalFingerprint: string,
  archive: RetainedPackageArchive, mutation: { readonly changed: boolean; replacement(part: string): Promise<ByteSource | undefined> }, settings: RetainedPackageContext) {
  const signal = settings.signal ?? new AbortController().signal;
  let pages: PagedStorage | undefined, closed = false, closing: Promise<void> | undefined;
  const check = () => { if (closed) throw new OfficeError('invalid-handle', 'Archive output is closed.', 'publish'); signal.throwIfAborted(); };
  const close = () => { closed = true; return closing ??= pages?.close() ?? Promise.resolve(); };
  const hex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  try {
    let size = input.size, fingerprint = originalFingerprint, start = 0;
    if (mutation.changed) {
      const working = settings.workingStorage;
      pages = new PagedStorage({ fs: working.fs, cwd: working.directory, env: {}, signal }, (working.cacheBytes ?? 1024 * 1024) / 16384);
      start = pages.allocate(0); size = 0; const digest = sha256.create();
      await archive.rewrite({ async write(bytes) {
        check();
        for (let offset = 0; offset < bytes.length; offset += 16384) {
          check(); const owned = new Uint8Array(bytes.subarray(offset, offset + 16384));
          await pages!.append(owned); digest.update(owned); size += owned.length;
        }
      } }, { replace: mutation.replacement, sourceOrder: 'name' });
      fingerprint = hex(digest.digest());
    }
    async function* bytes(): ByteSource {
      check();
      if (!pages) { yield* input.stream(); check(); return; }
      for (let offset = 0; offset < size; offset += 16384) { check(); yield await pages.read(start + offset, Math.min(16384, size - offset)); }
      check();
    }
    return Object.freeze({ bytes, size, fingerprint, close });
  } catch (error) { await close().catch(() => {}); throw error; }
}
