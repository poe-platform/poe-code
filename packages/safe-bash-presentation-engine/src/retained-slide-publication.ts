import { PagedStorage } from '@poe-code/safe-fs/storage';
import { sha256 } from '@noble/hashes/sha2.js';
import type { ByteSource } from './contracts.js';
import { OfficeError } from './errors.js';
import { openPackageArchive, type RetainedPackageContext } from './retained-package.js';
import { openRetainedSlideSettings } from './retained-slide-settings.js';
import type { MutateSlidesOptions } from './slides.js';
import { stageRetainedOutput, streamJson, type StagedOutput } from './retained-output.js';

export interface RetainedSlideSource {
  readonly size: number;
  read(position: number, maximum: number, options: { readonly signal: AbortSignal }): Promise<Uint8Array>;
  stream(): ByteSource;
}
/** Owns archive and response staging; borrows the caller's immutable input. */
export async function stageRetainedSlideSettings(input: RetainedSlideSource, options: Omit<MutateSlidesOptions, 'position'>,
  settings: RetainedPackageContext, output: { json: boolean; dryRun: boolean; destination?: string; maxOutputBytes: number }) {
  const signal = settings.signal ?? new AbortController().signal;
  const hash = sha256.create();
  for await (const bytes of input.stream()) { signal.throwIfAborted(); hash.update(bytes); }
  const hex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  const before = hex(hash.digest());
  const archive = await openPackageArchive(input, settings);
  let mutation: Awaited<ReturnType<typeof openRetainedSlideSettings>> | undefined, pages: PagedStorage | undefined, response: StagedOutput | undefined;
  let closed = false, closing: Promise<void> | undefined;
  const check = () => { if (closed) throw new OfficeError('invalid-handle', 'Slide output is closed.', 'publish'); signal.throwIfAborted(); };
  const close = () => { closed = true; return closing ??= (async () => {
    const results = await Promise.allSettled([response?.close(), mutation?.close(), pages?.close(), archive.close()]);
    for (const result of results) if (result.status === 'rejected') throw result.reason;
  })(); };
  try {
    mutation = await openRetainedSlideSettings(archive, before, options, settings);
    let size = input.size, fingerprint = before, start = 0;
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
      } }, { replace: mutation.replacement });
      fingerprint = hex(digest.digest());
    }
    async function* bytes(): ByteSource {
      check();
      if (!pages) { yield* input.stream(); check(); return; }
      for (let offset = 0; offset < size; offset += 16384) { check(); yield await pages.read(start + offset, Math.min(16384, size - offset)); }
      check();
    }
    async function* locations() { for await (const location of mutation!.targets()) yield { ...location, fingerprint }; }
    async function* effects() { if (fingerprint !== before) for await (const location of locations()) yield { location, action: 'update', feature: 'F07' }; }
    const dryRun = output.dryRun;
    async function* content(): ByteSource {
      if (output.destination === '-' && !dryRun) { yield* bytes(); return; }
      if (output.json) {
        yield* streamJson({ version: 1, operation: 'slides.set', ok: true, data: {
          effects: effects(), outputs: dryRun ? [] : [{ path: output.destination, sha256: fingerprint, bytes: size }], fingerprint: dryRun ? null : fingerprint
        }, warnings: [], errors: [], affected: mutation!.affected, locations: locations() });
        yield new TextEncoder().encode('\n');
      } else yield new TextEncoder().encode(`${dryRun ? 'Validated' : 'Updated'} ${mutation!.affected} slide(s)\n`);
    }
    response = await stageRetainedOutput(content(), settings, output.maxOutputBytes);
    return Object.freeze({ bytes, size, fingerprint, output: response, close });
  } catch (error) { await close().catch(() => {}); throw error; }
}
