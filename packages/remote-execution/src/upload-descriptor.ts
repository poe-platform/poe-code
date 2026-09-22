import type { FileReadHandle } from '@poe-code/safe-fs/core';
import type { createUploadClient } from './uploads.js';
import { UploadError, uploadInteger, uploadRouteId, validateUploadRequest, type BlobHandle, type UploadRequest } from './upload-protocol.js';

/** Trusted host-local capture identity. Never deserialize from a wire cursor or
 * derive it from a pathname/content hash. Save this binding with upload progress. */
export interface UploadSourceIdentity {
  readonly identity: object | symbol;
  readonly version: string;
}
/** Host-issued canonical binding, never populated from a wire manifest. The host
 * must validate the qualified retained identity and its content revision under
 * a backend guarantee (immutable snapshot/lease or monotonic stable revision).
 * stat size/mtime/inode comparison alone cannot implement this contract. With no
 * such guarantee, refuse capture; callers may instead upload independent bytes.
 * Pathname replacement does not revoke an already-open retained identity.
 * A native pathname open needs its own current namespace authorization; this
 * capture guard never authorizes reopening the descriptor's former pathname. */
export interface UploadFreshness extends UploadSourceIdentity {
  /** Exact caller-owned retained descriptor authorized by this host guard. */
  readonly descriptor: FileReadHandle;
  profile: 'immutable' | 'revalidate-on-open';
  assertCurrent(signal?: AbortSignal): Promise<void>;
  invalidate(cause: unknown): void;
}

/** The caller owns descriptor admission/accounting and close. This function never
 * opens paths, replaces descriptors, or upgrades a live read to a snapshot.
 * A rejected chunk/commit request has an unknown remote outcome: retain the
 * upload for inspection instead of destroying resumable progress. Recovery must
 * inspect its offset and validate the same canonical freshness binding. */
export async function uploadDescriptor(
  client: Pick<ReturnType<typeof createUploadClient>, 'beginUpload' | 'inspectUpload' | 'uploadChunk' | 'commitUpload' | 'abortUpload'>,
  descriptor: FileReadHandle,
  declaration: UploadRequest,
  options: { maxChunkBytes: number; freshness: UploadFreshness; signal?: AbortSignal; resume?: { uploadId: string; offset: string; source: UploadSourceIdentity } },
): Promise<BlobHandle> {
  // Host callbacks may await or mutate borrowed configuration. Retain the
  // admitted bounds and recovery cursor for this capture.
  options = { ...options, resume: options.resume ? { ...options.resume, source: { ...options.resume.source } } : undefined };
  options.signal?.throwIfAborted();
  if (!declaration || typeof declaration !== 'object' || Array.isArray(declaration)) throw new UploadError(400, 'Invalid upload request');
  // Validate the same owned size/digest later sent and checked against receipts.
  // Host getters cannot substitute a second declaration after admission.
  declaration = { ...declaration };
  validateUploadRequest(declaration);
  const size = uploadInteger(declaration.size);
  let offset = uploadInteger(options.resume?.offset ?? '0');
  if (options.resume) uploadRouteId(options.resume.uploadId);
  if (offset > size) throw new UploadError(400, 'Resume exceeds declared size');
  if (!Number.isSafeInteger(options.maxChunkBytes) || options.maxChunkBytes < 1) throw new UploadError(400, 'Invalid chunk bound');
  const exact = descriptor.exact;
  if (!exact && size > BigInt(Number.MAX_SAFE_INTEGER)) throw new UploadError(422, 'Canonical exact descriptor required');
  if (size > 9223372036854775807n) throw new UploadError(422, 'Canonical descriptor offset exceeds signed 64-bit profile');
  if (!options.freshness || !['immutable', 'revalidate-on-open'].includes(options.freshness.profile)) throw new UploadError(422, 'Stable source freshness binding required');
  const { signal, freshness } = options;
  const { descriptor: authorizedDescriptor, identity, version, profile } = freshness;
  if (authorizedDescriptor !== descriptor || identity === null || !['object', 'symbol'].includes(typeof identity)
    || typeof version !== 'string' || !version.length || version.length > 256
    || typeof freshness.assertCurrent !== 'function' || typeof freshness.invalidate !== 'function') {
    throw new UploadError(422, 'Qualified retained source identity and version required');
  }
  if (options.resume && (options.resume.source.identity !== identity || options.resume.source.version !== version)) {
    throw new UploadError(422, 'Resume belongs to another canonical object or content version');
  }

  // Retain the authorized capabilities before host callbacks can await. Keeping
  // their receivers preserves backend revision state without allowing method or
  // exact-facet replacement to change this capture's reader or freshness guard.
  const read = descriptor.read.bind(descriptor);
  const exactRead = exact?.read.bind(exact);
  const assertCurrent = freshness.assertCurrent.bind(freshness);
  const invalidate = freshness.invalidate.bind(freshness);
  // Keep this capture on its admitted authenticated transport, including recovery
  // and retirement. Awaited host guards cannot substitute another client facet.
  client = Object.freeze({
    beginUpload: client.beginUpload.bind(client), inspectUpload: client.inspectUpload.bind(client),
    uploadChunk: client.uploadChunk.bind(client), commitUpload: client.commitUpload.bind(client),
    abortUpload: client.abortUpload.bind(client),
  });
  let id = options.resume?.uploadId;
  let admitted = false;
  let unknownOutcome = false;
  let stale = false;
  function invalidateSource(cause: unknown): never {
    stale = true;
    try { invalidate(cause); }
    catch (failure) {
      throw new AggregateError([cause, failure], 'Source freshness and manifest invalidation failed', { cause });
    }
    throw cause;
  }
  async function current() {
    signal?.throwIfAborted();
    try {
      if (freshness.descriptor !== authorizedDescriptor || freshness.identity !== identity || freshness.version !== version || freshness.profile !== profile)
        throw new UploadError(409, 'Canonical capture binding changed');
      await assertCurrent(signal);
      if (freshness.descriptor !== authorizedDescriptor || freshness.identity !== identity || freshness.version !== version || freshness.profile !== profile)
        throw new UploadError(409, 'Canonical capture binding changed');
    }
    catch (error) {
      // A canceled guard did not establish that the canonical source changed.
      // Preserve resumable staging until this capture has actually admitted it.
      signal?.throwIfAborted();
      invalidateSource(error);
    }
    signal?.throwIfAborted();
  }
  try {
    await current();
    if (id) {
      const { uploadId, state, size: receiptSize, digest, committedOffset, blobId } = await client.inspectUpload(id, signal);
      const receipt = { uploadId, state, size: receiptSize, digest, committedOffset, blobId };
      await current();
      if (receipt.uploadId !== id || !['open', 'committed'].includes(receipt.state) || receipt.size !== declaration.size
        || receipt.digest !== declaration.digest || receipt.committedOffset !== String(offset)) throw new UploadError(409, 'Resume declaration or acknowledged offset mismatch');
      if (receipt.state === 'committed') {
        if (offset !== size || typeof receipt.blobId !== 'string' || !receipt.blobId.length || receipt.blobId.length > 256) throw new UploadError(409, 'Committed upload acknowledgement mismatch');
        try { uploadRouteId(receipt.blobId); }
        catch { throw new UploadError(409, 'Unroutable committed upload acknowledgement'); }
        return { size: declaration.size, digest: declaration.digest, blobId: receipt.blobId };
      }
    } else {
      unknownOutcome = true;
      // Acquisition borrows its own copy. The capture's admitted size/digest
      // remain authoritative for every subsequent read and acknowledgment.
      const { uploadId, state, size: receiptSize, digest, committedOffset } = await client.beginUpload({ ...declaration }, signal);
      const receipt = { uploadId, state, size: receiptSize, digest, committedOffset };
      id = receipt.uploadId;
      admitted = true;
      if (typeof id !== 'string' || !id.length || id.length > 256 || receipt.state !== 'open'
        || receipt.size !== declaration.size || receipt.digest !== declaration.digest || receipt.committedOffset !== '0') {
        throw new UploadError(502, 'Upload acquisition acknowledgement mismatch');
      }
      try { uploadRouteId(id); }
      catch { throw new UploadError(502, 'Unroutable upload acquisition acknowledgement'); }
      unknownOutcome = false;
      signal?.throwIfAborted();
    }
    admitted = true;
    while (offset < size) {
      await current();
      const count = Number(size - offset > BigInt(options.maxChunkBytes) ? BigInt(options.maxChunkBytes) : size - offset);
      const data = exactRead
        ? await exactRead(offset, count, { signal })
        : await read(Number(offset), count, { signal });
      if (!(data instanceof Uint8Array)) throw new UploadError(503, 'Invalid canonical read response');
      const span = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'byteLength')!.get!.call(data) as number;
      if (span > count) throw new UploadError(503, 'Invalid canonical read response');
      // Own the fragment before calling another asynchronous provider hook.
      const owned = new Uint8Array(data);
      await current();
      if (!owned.length) {
        invalidateSource(new UploadError(409, 'Unstable source length'));
      }
      const end = offset + BigInt(owned.length);
      unknownOutcome = true;
      const { uploadId, state, size: receiptSize, digest, committedOffset } = await client.uploadChunk(id, String(offset), owned, signal);
      const receipt = { uploadId, state, size: receiptSize, digest, committedOffset };
      if (receipt.uploadId !== id || receipt.state !== 'open' || receipt.size !== declaration.size
        || receipt.digest !== declaration.digest || receipt.committedOffset !== String(end)) {
        throw new UploadError(502, 'Upload chunk acknowledgement mismatch; inspect before recovery');
      }
      unknownOutcome = false;
      offset = end;
    }
    await current();
    const extra = exactRead ? await exactRead(size, 1, { signal }) : await read(Number(size), 1, { signal });
    if (!(extra instanceof Uint8Array)) throw new UploadError(503, 'Invalid canonical read response');
    const extraSpan = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'byteLength')!.get!.call(extra) as number;
    if (extraSpan > 1) throw new UploadError(503, 'Invalid canonical read response');
    if (extraSpan) invalidateSource(new UploadError(409, 'Source exceeds declaration'));
    await current();
    unknownOutcome = true;
    // A transport receipt is borrowed. Validate and return the same captured
    // identity, including across the final asynchronous freshness check.
    const { size: blobSize, digest, blobId } = await client.commitUpload(id, signal);
    const blob = { size: blobSize, digest, blobId };
    if (blob.size !== declaration.size || blob.digest !== declaration.digest
      || typeof blob.blobId !== 'string' || !blob.blobId.length || blob.blobId.length > 256) throw new UploadError(502, 'Committed blob declaration or handle mismatch');
    try { uploadRouteId(blob.blobId); }
    catch { throw new UploadError(502, 'Unroutable committed blob acknowledgement'); }
    unknownOutcome = false;
    await current();
    return blob;
  } catch (error) {
    // Await cooperative cleanup with a fresh request; preserve original failure.
    if (id && (admitted || stale) && !unknownOutcome) {
      try { await client.abortUpload(id); }
      catch (cleanup) {
        signal?.throwIfAborted();
        throw new AggregateError([error, cleanup], 'Upload capture and staging retirement failed', { cause: error });
      }
    }
    signal?.throwIfAborted();
    throw error;
  }
}
