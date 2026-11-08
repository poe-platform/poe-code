import { describe, expect, it, vi } from 'vitest';
import type { FileReadHandle } from '@poe-code/safe-fs/contracts';
import { uploadDescriptor } from './upload-descriptor.js';

function fixture() {
  let identity = {}; let revision = 1;
  const initialIdentity = identity;
  const data = Uint8Array.of(1,2,3,4);
  const handle: FileReadHandle = {
    stat: vi.fn(async () => ({ type: 'file' as const, size: 4, mode: 0, mtimeMs: 0, atimeMs: 0, ctimeMs: 0 })),
    read: vi.fn(async (position, length) => data.slice(position, position + length)), close: vi.fn(async () => {}),
  };
  const input = { size: '4', digest: '0'.repeat(64) };
  const upload = { ...input, uploadId: 'u', committedOffset: '0', state: 'open' as const };
  const client = {
    beginUpload: vi.fn(async () => upload),
    inspectUpload: vi.fn(async () => upload),
    uploadChunk: vi.fn(async (id: string, offset: string, bytes: Uint8Array) => ({ ...upload, uploadId: id, committedOffset: String(BigInt(offset) + BigInt(bytes.length)), replayed: false })),
    commitUpload: vi.fn(async () => ({ size: upload.size, digest: upload.digest, blobId: 'b' })),
    abortUpload: vi.fn(async () => ({ ...upload, state: 'aborted' as const })),
  };
  const freshness = { descriptor: handle, identity: initialIdentity, version: 'v1', profile: 'revalidate-on-open' as const,
    assertCurrent: vi.fn(async () => { if (identity !== initialIdentity || revision !== 1) throw new Error('stale source'); }),
    invalidate: vi.fn(),
  };
  return { handle, client, input, freshness, mutate: () => { revision++; }, replace: () => { identity = {}; } };
}

it.each(['.', '..'])('rejects an unroutable acquired upload handle %s before canonical reads', async uploadId => {
  const f = fixture();
  f.client.beginUpload.mockResolvedValueOnce({ ...f.input, uploadId, committedOffset: '0', state: 'open' });
  await expect(uploadDescriptor(f.client, f.handle, f.input, {
    maxChunkBytes: 2, freshness: f.freshness,
  })).rejects.toMatchObject({ status: 502 });
  expect(f.handle.read).not.toHaveBeenCalled();
  expect(f.client.uploadChunk).not.toHaveBeenCalled();
  expect(f.client.abortUpload).not.toHaveBeenCalled();
});

it.each(['.', '..', ''])('rejects an unroutable resume upload handle %s before host admission', async uploadId => {
  const f = fixture();
  await expect(uploadDescriptor(f.client, f.handle, f.input, {
    maxChunkBytes: 2, freshness: f.freshness,
    resume: { uploadId, offset: '0', source: f.freshness },
  })).rejects.toMatchObject({ status: 400 });
  expect(f.freshness.assertCurrent).not.toHaveBeenCalled();
  expect(f.client.inspectUpload).not.toHaveBeenCalled();
  expect(f.handle.read).not.toHaveBeenCalled();
});

it.each(['.', '..'])('rejects an unroutable finalized blob handle %s', async blobId => {
  const f = fixture();
  f.client.commitUpload.mockResolvedValueOnce({ ...f.input, blobId });
  await expect(uploadDescriptor(f.client, f.handle, f.input, {
    maxChunkBytes: 2, freshness: f.freshness,
  })).rejects.toMatchObject({ status: 502 });
  expect(f.client.abortUpload).not.toHaveBeenCalled();
});

it.each(['.', '..'])('rejects an unroutable resumed blob handle %s without canonical reads', async blobId => {
  const f = fixture();
  f.client.inspectUpload.mockResolvedValueOnce({ ...f.input, uploadId: 'u', state: 'committed', committedOffset: '4', blobId } as never);
  await expect(uploadDescriptor(f.client, f.handle, f.input, {
    maxChunkBytes: 2, freshness: f.freshness,
    resume: { uploadId: 'u', offset: '4', source: f.freshness },
  })).rejects.toMatchObject({ status: 409 });
  expect(f.handle.read).not.toHaveBeenCalled();
  expect(f.client.abortUpload).not.toHaveBeenCalled();
});

describe('canonical descriptor captures', () => {
  it('recovers the same owned blob identity from a committed resume receipt', async () => {
    const f = fixture();
    let observations = 0;
    const receipt = Object.defineProperty({ ...f.input, uploadId: 'u', state: 'committed', committedOffset: '4' }, 'blobId', {
      enumerable: true, get() { return ++observations === 1 ? 'b' : 'another-tenant-blob'; },
    });
    f.client.inspectUpload.mockResolvedValueOnce(receipt as never);
    expect(await uploadDescriptor(f.client, f.handle, f.input, {
      maxChunkBytes: 2, freshness: f.freshness,
      resume: { uploadId: 'u', offset: '4', source: f.freshness },
    })).toEqual({ ...f.input, blobId: 'b' });
    expect(observations).toBe(1);
    expect(f.handle.read).not.toHaveBeenCalled();
    expect(f.client.commitUpload).not.toHaveBeenCalled();
  });
  it('returns an owned committed blob identity after validating one observation', async () => {
    const f = fixture();
    let observations = 0;
    const receipt = Object.defineProperty({ ...f.input }, 'blobId', {
      enumerable: true, get() { return ++observations === 1 ? 'b' : 'another-tenant-blob'; },
    });
    f.client.commitUpload.mockResolvedValueOnce(receipt as { size: string; digest: string; blobId: string });
    const result = await uploadDescriptor(f.client, f.handle, f.input, {
      maxChunkBytes: 2, freshness: f.freshness,
    });
    expect(result).toEqual({ ...f.input, blobId: 'b' });
    expect(observations).toBe(1);
  });

  it('keeps the committed receipt independent of later transport mutation', async () => {
    const f = fixture();
    const receipt = { ...f.input, blobId: 'b' };
    f.client.commitUpload.mockResolvedValueOnce(receipt);
    const result = await uploadDescriptor(f.client, f.handle, f.input, {
      maxChunkBytes: 2, freshness: f.freshness,
    });
    receipt.blobId = 'another-tenant-blob';
    receipt.digest = 'f'.repeat(64);
    expect(result).toEqual({ ...f.input, blobId: 'b' });
  });
  it('retains freshness and invalidation failures while draining stale staging', async () => {
    const f = fixture();
    const stale = new Error('source replaced');
    const invalidation = new Error('manifest invalidation failed');
    f.freshness.assertCurrent.mockRejectedValueOnce(stale);
    f.freshness.invalidate.mockImplementationOnce(() => { throw invalidation; });
    await expect(uploadDescriptor(f.client, f.handle, f.input, {
      maxChunkBytes: 2, freshness: f.freshness,
      resume: { source: f.freshness, uploadId: 'u', offset: '2' },
    })).rejects.toMatchObject({ errors: [stale, invalidation], cause: stale });
    expect(f.client.abortUpload).toHaveBeenCalledWith('u');
    expect(f.handle.read).not.toHaveBeenCalled();
    expect(f.client.commitUpload).not.toHaveBeenCalled();
  });
  it('retains source and remote retirement failures instead of hiding incomplete cleanup', async () => {
    const f = fixture();
    const stale = new Error('source mutated');
    const cleanup = new Error('staging retirement failed');
    f.freshness.assertCurrent.mockRejectedValueOnce(stale);
    f.client.abortUpload.mockRejectedValueOnce(cleanup);
    await expect(uploadDescriptor(f.client, f.handle, f.input, {
      maxChunkBytes: 2, freshness: f.freshness,
      resume: { source: f.freshness, uploadId: 'u', offset: '2' },
    })).rejects.toMatchObject({ errors: [stale, cleanup], cause: stale });
    expect(f.client.abortUpload).toHaveBeenCalledWith('u');
    expect(f.handle.close).not.toHaveBeenCalled();
  });
  it.each(['size', 'digest'] as const)('validates and transfers one owned observation of the source %s', async field => {
    const f = fixture();
    let observations = 0;
    const declaration = Object.defineProperty({ ...f.input }, field, {
      enumerable: true, get() { return ++observations === 1 ? f.input[field] : field === 'size' ? '2' : '1'.repeat(64); },
    });
    await expect(uploadDescriptor(f.client, f.handle, declaration, {
      maxChunkBytes: 2, freshness: f.freshness,
    })).resolves.toEqual({ ...f.input, blobId: 'b' });
    expect(observations).toBe(1);
    expect(f.client.beginUpload).toHaveBeenCalledWith(f.input, undefined);
    expect(f.handle.read).toHaveBeenLastCalledWith(4, 1, { signal: undefined });
  });
  it('refuses an acquisition receipt for a substituted declaration before reading canonical bytes', async () => {
    const f = fixture();
    f.client.beginUpload.mockImplementationOnce(async (declaration?: typeof f.input) => {
      declaration!.size = '2';
      declaration!.digest = '1'.repeat(64);
      return { ...declaration!, uploadId: 'u', committedOffset: '0', state: 'open' };
    });
    await expect(uploadDescriptor(f.client, f.handle, f.input, {
      maxChunkBytes: 2, freshness: f.freshness,
    })).rejects.toMatchObject({ status: 502 });
    expect(f.handle.read).not.toHaveBeenCalled();
    expect(f.client.uploadChunk).not.toHaveBeenCalled();
    expect(f.client.commitUpload).not.toHaveBeenCalled();
    // A mismatched acknowledgment cannot authorize destructive retirement.
    expect(f.client.abortUpload).not.toHaveBeenCalled();
  });
  it('keeps the admitted declaration when upload acquisition mutates its borrowed argument', async () => {
    const f = fixture();
    f.client.beginUpload.mockImplementationOnce(async (declaration?: typeof f.input) => {
      declaration!.size = '2';
      declaration!.digest = '1'.repeat(64);
      return { ...f.input, uploadId: 'u', committedOffset: '0', state: 'open' };
    });
    await expect(uploadDescriptor(f.client, f.handle, f.input, {
      maxChunkBytes: 2, freshness: f.freshness,
    })).resolves.toEqual({ ...f.input, blobId: 'b' });
    expect(f.client.uploadChunk).toHaveBeenCalledTimes(2);
    expect(f.handle.read).toHaveBeenLastCalledWith(4, 1, { signal: undefined });
    expect(f.input.size).toBe('4');
    expect(f.input.digest).toBe('0'.repeat(64));
  });
  it('pins the admitted upload transport before an asynchronous freshness check', async () => {
    const f = fixture();
    const chunk = f.client.uploadChunk;
    const commit = f.client.commitUpload;
    const redirected = vi.fn(async () => { throw new Error('another tenant transport'); });
    f.freshness.assertCurrent.mockImplementationOnce(async () => {
      f.client.uploadChunk = redirected;
      f.client.commitUpload = redirected;
    });
    await expect(uploadDescriptor(f.client, f.handle, f.input, {
      maxChunkBytes: 2, freshness: f.freshness,
    })).resolves.toMatchObject({ blobId: 'b' });
    expect(chunk).toHaveBeenCalledTimes(2);
    expect(commit).toHaveBeenCalledOnce();
    expect(redirected).not.toHaveBeenCalled();
    expect(f.handle.close).not.toHaveBeenCalled();
  });
  it('invalidates capture when the selected freshness profile changes during a guard', async () => {
    const f = fixture();
    const freshness = { ...f.freshness, profile: 'revalidate-on-open' as 'immutable' | 'revalidate-on-open' };
    freshness.assertCurrent.mockImplementationOnce(async () => { freshness.profile = 'immutable'; });
    await expect(uploadDescriptor(f.client, f.handle, f.input, {
      maxChunkBytes: 2, freshness,
    })).rejects.toMatchObject({ status: 409 });
    expect(freshness.invalidate).toHaveBeenCalledOnce();
    expect(f.client.beginUpload).not.toHaveBeenCalled();
    expect(f.handle.read).not.toHaveBeenCalled();
  });
  it.each(['chunk', 'commit', 'resume'] as const)('invalidates a changed freshness profile during %s and drains staging cleanup', async phase => {
    const f = fixture();
    const freshness = { ...f.freshness, profile: 'revalidate-on-open' as 'immutable' | 'revalidate-on-open' };
    if (phase === 'chunk') f.client.uploadChunk.mockImplementationOnce(async () => {
      freshness.profile = 'immutable';
      return { ...f.input, uploadId: 'u', committedOffset: '2', state: 'open', replayed: false };
    });
    if (phase === 'commit') f.client.commitUpload.mockImplementationOnce(async () => {
      freshness.profile = 'immutable';
      return { ...f.input, blobId: 'b' };
    });
    if (phase === 'resume') f.client.inspectUpload.mockImplementationOnce(async () => {
      freshness.profile = 'immutable';
      return { ...f.input, uploadId: 'u', committedOffset: '2', state: 'open' };
    });
    await expect(uploadDescriptor(f.client, f.handle, f.input, {
      maxChunkBytes: 2, freshness,
      resume: phase === 'resume' ? { source: freshness, uploadId: 'u', offset: '2' } : undefined,
    })).rejects.toMatchObject({ status: 409 });
    expect(freshness.invalidate).toHaveBeenCalledOnce();
    expect(f.client.abortUpload).toHaveBeenCalledWith('u');
    expect(f.handle.close).not.toHaveBeenCalled();
    if (phase !== 'commit') expect(f.client.commitUpload).not.toHaveBeenCalled();
    if (phase === 'resume') expect(f.handle.read).not.toHaveBeenCalled();
  });
  it.each(['new', 'resume', 'reading'] as const)('preserves source freshness when cancellation interrupts a %s capture guard', async phase => {
    const f = fixture();
    const controller = new AbortController();
    const reason = new Error('capture canceled');
    let checks = 0;
    f.freshness.assertCurrent.mockImplementation(async () => {
      checks++;
      if (checks === (phase === 'reading' ? 3 : 1)) {
        controller.abort(reason);
        throw reason;
      }
    });
    await expect(uploadDescriptor(f.client, f.handle, f.input, {
      maxChunkBytes: 2, freshness: f.freshness, signal: controller.signal,
      resume: phase === 'resume' ? { source: f.freshness, uploadId: 'u', offset: '2' } : undefined,
    })).rejects.toBe(reason);
    expect(f.freshness.invalidate).not.toHaveBeenCalled();
    expect(f.client.commitUpload).not.toHaveBeenCalled();
    expect(f.handle.close).not.toHaveBeenCalled();
    if (phase === 'reading') expect(f.client.abortUpload).toHaveBeenCalledWith('u');
    else expect(f.client.abortUpload).not.toHaveBeenCalled();
    if (phase === 'resume') {
      f.client.inspectUpload.mockResolvedValueOnce({ ...f.input, uploadId: 'u', state: 'open', committedOffset: '2' });
      await expect(uploadDescriptor(f.client, f.handle, f.input, {
        maxChunkBytes: 2, freshness: f.freshness, resume: { source: f.freshness, uploadId: 'u', offset: '2' },
      })).resolves.toEqual({ ...f.input, blobId: 'b' });
      expect(f.handle.read).toHaveBeenNthCalledWith(1, 2, 2, { signal: undefined });
      expect(f.client.beginUpload).not.toHaveBeenCalled();
    }
  });
  it.each(['mutate', 'replace'] as const)('retains the admitted freshness guard when callbacks change during source %s', async change => {
    const f = fixture();
    const invalidate = f.freshness.invalidate;
    f.client.uploadChunk.mockImplementationOnce(async () => {
      f[change]();
      f.freshness.assertCurrent = vi.fn(async () => {});
      f.freshness.invalidate = vi.fn();
      return { ...f.input, uploadId: 'u', state: 'open', committedOffset: '2', replayed: false };
    });
    await expect(uploadDescriptor(f.client, f.handle, f.input, {
      maxChunkBytes: 2, freshness: f.freshness,
    })).rejects.toThrow('stale source');
    expect(invalidate).toHaveBeenCalledOnce();
    expect(f.handle.read).toHaveBeenCalledOnce();
    expect(f.client.commitUpload).not.toHaveBeenCalled();
    expect(f.client.abortUpload).toHaveBeenCalledWith('u');
  });
  it.each(['legacy', 'exact'] as const)('retains the authorized %s reader across asynchronous freshness checks', async profile => {
    const f = fixture();
    const originalRead = vi.fn(async (position: number | bigint, count: number) =>
      Uint8Array.of(1, 2, 3, 4).slice(Number(position), Number(position) + count));
    const replacementRead = vi.fn(async (position: number | bigint, count: number) =>
      Uint8Array.of(9, 9, 9, 9).slice(Number(position), Number(position) + count));
    const handle: FileReadHandle = profile === 'exact'
      ? { ...f.handle, exact: { read: originalRead, stat: async () => ({ type: 'file', size: 4n }) } }
      : { ...f.handle, read: originalRead };
    f.freshness.assertCurrent.mockImplementationOnce(async () => {
      Object.assign(handle, profile === 'exact'
        ? { exact: { read: replacementRead, stat: async () => ({ type: 'file', size: 4n }) } }
        : { read: replacementRead });
    });
    f.freshness.descriptor = handle;
    await uploadDescriptor(f.client, handle, f.input, { maxChunkBytes: 2, freshness: f.freshness });
    expect(replacementRead).not.toHaveBeenCalled();
    expect(originalRead).toHaveBeenCalledTimes(3);
    expect(f.client.uploadChunk).toHaveBeenNthCalledWith(1, 'u', '0', Uint8Array.of(1, 2), undefined);
    expect(handle.close).not.toHaveBeenCalled();
  });
  it.each(['mutate', 'replace'] as const)('aborts retained staging when a resumed source is already stale after %s', async change => {
    const f = fixture();
    f[change]();
    await expect(uploadDescriptor(f.client, f.handle, f.input, {
      maxChunkBytes: 2, freshness: f.freshness, resume: { source: f.freshness, uploadId: 'u', offset: '2' },
    })).rejects.toThrow('stale source');
    expect(f.freshness.invalidate).toHaveBeenCalledOnce();
    expect(f.client.abortUpload).toHaveBeenCalledWith('u');
    expect(f.handle.read).not.toHaveBeenCalled();
    expect(f.client.commitUpload).not.toHaveBeenCalled();
    expect(f.handle.close).not.toHaveBeenCalled();
  });
  it.each([undefined, '', 'b'.repeat(257), 1])('refuses an invalid committed blob handle %j', async blobId => {
    const f = fixture();
    f.client.commitUpload.mockResolvedValueOnce({ ...f.input, blobId } as never);
    await expect(uploadDescriptor(f.client, f.handle, f.input, { maxChunkBytes: 2, freshness: f.freshness }))
      .rejects.toMatchObject({ status: 502 });
    expect(f.handle.close).not.toHaveBeenCalled();
    expect(f.client.abortUpload).not.toHaveBeenCalled();
  });
  it('retains the admitted read bound across asynchronous freshness checks', async () => {
    const f = fixture();
    const options = { maxChunkBytes: 2, freshness: f.freshness };
    f.freshness.assertCurrent.mockImplementationOnce(async () => { options.maxChunkBytes = 4; });
    await uploadDescriptor(f.client, f.handle, f.input, options);
    expect(f.handle.read).toHaveBeenNthCalledWith(1, 0, 2, { signal: undefined });
    expect(f.handle.read).toHaveBeenNthCalledWith(2, 2, 2, { signal: undefined });
  });
  it('retains a partially acknowledged upload after transport loss and resumes at the inspected offset', async () => {
    const f = fixture(); const lost = new Error('lost chunk acknowledgement');
    f.client.uploadChunk.mockRejectedValueOnce(lost);
    await expect(uploadDescriptor(f.client, f.handle, f.input, { maxChunkBytes: 2, freshness: f.freshness })).rejects.toBe(lost);
    expect(f.client.abortUpload).not.toHaveBeenCalled();
    f.client.inspectUpload.mockResolvedValueOnce({ ...f.input, uploadId: 'u', state: 'open', committedOffset: '2' });
    await uploadDescriptor(f.client, f.handle, f.input, { maxChunkBytes: 2, freshness: f.freshness, resume: { source: f.freshness, uploadId: 'u', offset: '2' } });
    expect(f.handle.read).toHaveBeenNthCalledWith(2, 2, 2, { signal: undefined });
    expect(f.client.uploadChunk).toHaveBeenNthCalledWith(2, 'u', '2', Uint8Array.of(3, 4), undefined);
    expect(f.client.beginUpload).toHaveBeenCalledOnce();
  });
  it('recovers a malformed chunk acknowledgment from inspected progress on the same fresh descriptor', async () => {
    const f = fixture();
    f.client.uploadChunk.mockResolvedValueOnce({ ...f.input, uploadId: 'u', state: 'open', committedOffset: '0', replayed: false });
    await expect(uploadDescriptor(f.client, f.handle, f.input, { maxChunkBytes: 2, freshness: f.freshness }))
      .rejects.toMatchObject({ status: 502 });
    expect(f.client.abortUpload).not.toHaveBeenCalled();
    f.client.inspectUpload.mockResolvedValueOnce({ ...f.input, uploadId: 'u', state: 'open', committedOffset: '2' });
    await expect(uploadDescriptor(f.client, f.handle, f.input, {
      maxChunkBytes: 2, freshness: f.freshness, resume: { source: f.freshness, uploadId: 'u', offset: '2' },
    })).resolves.toEqual({ ...f.input, blobId: 'b' });
    expect(f.handle.read).toHaveBeenNthCalledWith(2, 2, 2, { signal: undefined });
    expect(f.client.beginUpload).toHaveBeenCalledOnce();
  });
  it('recovers a lost commit acknowledgement only after validating current canonical freshness', async () => {
    const f = fixture(); const lost = new Error('lost commit acknowledgement');
    f.client.commitUpload.mockRejectedValueOnce(lost);
    await expect(uploadDescriptor(f.client, f.handle, f.input, { maxChunkBytes: 4, freshness: f.freshness })).rejects.toBe(lost);
    expect(f.client.abortUpload).not.toHaveBeenCalled();
    f.client.inspectUpload.mockResolvedValue({ ...f.input, uploadId: 'u', state: 'committed', committedOffset: '4', blobId: 'b' });
    f.handle.read.mockClear();
    await expect(uploadDescriptor(f.client, f.handle, f.input, { maxChunkBytes: 4, freshness: f.freshness, resume: { source: f.freshness, uploadId: 'u', offset: '4' } })).resolves.toEqual({ ...f.input, blobId: 'b' });
    expect(f.handle.read).not.toHaveBeenCalled();
    f.replace();
    await expect(uploadDescriptor(f.client, f.handle, f.input, { maxChunkBytes: 4, freshness: f.freshness, resume: { source: f.freshness, uploadId: 'u', offset: '4' } })).rejects.toThrow('stale source');
  });
  it.each([{ blobId: undefined }, { blobId: '' }, { blobId: 'b'.repeat(257) }, { committedOffset: '2' }, { size: '5' }, { digest: 'f'.repeat(64) }])('refuses invalid committed recovery %j without reading or mutating storage', async invalid => {
    const f = fixture();
    f.client.inspectUpload.mockResolvedValueOnce({ ...f.input, uploadId: 'u', state: 'committed', committedOffset: '4', blobId: 'b', ...invalid } as never);
    await expect(uploadDescriptor(f.client, f.handle, f.input, { maxChunkBytes: 2, freshness: f.freshness, resume: { source: f.freshness, uploadId: 'u', offset: '4' } })).rejects.toMatchObject({ status: 409 });
    expect(f.handle.read).not.toHaveBeenCalled(); expect(f.client.uploadChunk).not.toHaveBeenCalled();
    expect(f.client.abortUpload).not.toHaveBeenCalled(); expect(f.client.commitUpload).not.toHaveBeenCalled();
  });
  it.each([{ size: '5' }, { digest: 'f'.repeat(64) }, { uploadId: 'other' }, { committedOffset: '0' }, { state: 'aborted' }])('refuses a mismatched chunk receipt %j before advancing the canonical read', async invalid => {
    const f = fixture();
    f.client.uploadChunk.mockResolvedValueOnce({ ...f.input, uploadId: 'u', committedOffset: '2', state: 'open', replayed: false, ...invalid } as never);
    await expect(uploadDescriptor(f.client, f.handle, f.input, { maxChunkBytes: 2, freshness: f.freshness })).rejects.toMatchObject({ status: 502 });
    expect(f.handle.read).toHaveBeenCalledOnce(); expect(f.client.commitUpload).not.toHaveBeenCalled();
    expect(f.client.abortUpload).not.toHaveBeenCalled();
  });
  it.each([{ size: '5' }, { digest: 'f'.repeat(64) }, { committedOffset: '1' }, { state: 'committed' }])('refuses a mismatched acquisition receipt %j before reading source content', async invalid => {
    const f = fixture();
    f.client.beginUpload.mockResolvedValueOnce({ ...f.input, uploadId: 'u', committedOffset: '0', state: 'open', ...invalid } as never);
    await expect(uploadDescriptor(f.client, f.handle, f.input, { maxChunkBytes: 2, freshness: f.freshness })).rejects.toMatchObject({ status: 502 });
    expect(f.handle.read).not.toHaveBeenCalled(); expect(f.client.commitUpload).not.toHaveBeenCalled();
    expect(f.client.abortUpload).not.toHaveBeenCalled();
  });
  it.each(['size', 'digest'] as const)('rejects a committed blob with a mismatched %s', async field => {
    const f = fixture();
    f.client.commitUpload.mockResolvedValue({ ...f.input, blobId: 'b', [field]: field === 'size' ? '5' : 'f'.repeat(64) });
    await expect(uploadDescriptor(f.client, f.handle, f.input, { maxChunkBytes: 2, freshness: f.freshness })).rejects.toMatchObject({ status: 502 });
    expect(f.handle.close).not.toHaveBeenCalled();
  });
  it('owns read bytes before asynchronous freshness validation reuses a producer buffer', async () => {
    const f = fixture(); const producer = Buffer.from([1, 2, 3, 4]);
    f.handle.read = vi.fn(async position => position === 0 ? producer : new Uint8Array());
    f.freshness.assertCurrent.mockImplementation(async () => {
      if (vi.mocked(f.handle.read).mock.calls.length) producer.fill(9);
    });
    await uploadDescriptor(f.client, f.handle, f.input, { maxChunkBytes: 4, freshness: f.freshness });
    expect(f.client.uploadChunk).toHaveBeenCalledWith('u', '0', Uint8Array.of(1, 2, 3, 4), undefined);
  });
  it('rejects nonbinary canonical replies before uploading', async () => {
    const f = fixture(); f.handle.read = vi.fn(async () => [1, 2] as never);
    await expect(uploadDescriptor(f.client, f.handle, f.input, { maxChunkBytes: 4, freshness: f.freshness })).rejects.toMatchObject({ status: 503 });
    expect(f.client.uploadChunk).not.toHaveBeenCalled(); expect(f.client.abortUpload).toHaveBeenCalledWith('u');
  });
  it.each(['mutate', 'replace'] as const)('checks freshness before the EOF read after final-chunk source %s', async change => {
    const f = fixture();
    f.client.uploadChunk.mockImplementationOnce(async () => {
      f[change]();
      return { ...f.input, uploadId: 'u', state: 'open', committedOffset: '4', replayed: false };
    });
    await expect(uploadDescriptor(f.client, f.handle, f.input, {
      maxChunkBytes: 4, freshness: f.freshness,
    })).rejects.toThrow('stale source');
    expect(f.handle.read).toHaveBeenCalledTimes(1);
    expect(f.freshness.invalidate).toHaveBeenCalledOnce();
    expect(f.client.commitUpload).not.toHaveBeenCalled();
    expect(f.client.abortUpload).toHaveBeenCalledWith('u');
  });
  it('does not read an empty descriptor when cancellation races upload creation', async () => {
    const f = fixture(); const controller = new AbortController(); const reason = new Error('stop');
    f.client.beginUpload.mockImplementationOnce(async () => { controller.abort(reason); return { ...f.input, size: '0', uploadId: 'u', state: 'open', committedOffset: '0' }; });
    await expect(uploadDescriptor(f.client, f.handle, { ...f.input, size: '0' }, {
      maxChunkBytes: 4, freshness: f.freshness, signal: controller.signal,
    })).rejects.toBe(reason);
    expect(f.handle.read).not.toHaveBeenCalled();
    expect(f.client.commitUpload).not.toHaveBeenCalled();
    expect(f.client.abortUpload).toHaveBeenCalledWith('u');
  });
  it('rejects malformed declarations before descriptor or remote acquisition', async () => {
    const f = fixture();
    await expect(uploadDescriptor(f.client, f.handle, { ...f.input, digest: 'invalid' }, {
      maxChunkBytes: 2, freshness: f.freshness,
    })).rejects.toMatchObject({ status: 400 });
    expect(f.client.beginUpload).not.toHaveBeenCalled(); expect(f.handle.read).not.toHaveBeenCalled();
  });
  it('retains the original declaration when the caller mutates it during capture', async () => {
    const f = fixture(); const original = { ...f.input };
    f.freshness.assertCurrent.mockImplementationOnce(async () => { f.input.size = '0'; f.input.digest = 'f'.repeat(64); });
    await uploadDescriptor(f.client, f.handle, f.input, { maxChunkBytes: 2, freshness: f.freshness });
    expect(f.client.beginUpload).toHaveBeenCalledWith(original, undefined);
  });
  it.each(['mutate', 'replace'] as const)('invalidates a manifest on source %s and never finalizes it', async change => {
    const f = fixture();
    f.client.uploadChunk.mockImplementationOnce(async () => { f[change](); return { ...f.input, uploadId: 'u', state: 'open', committedOffset: '2', replayed: false }; });
    await expect(uploadDescriptor(f.client, f.handle, f.input, { maxChunkBytes: 2, freshness: f.freshness })).rejects.toThrow('stale source');
    expect(f.freshness.invalidate).toHaveBeenCalledOnce(); expect(f.client.commitUpload).not.toHaveBeenCalled();
    expect(f.client.abortUpload).toHaveBeenCalledWith('u'); expect(f.handle.close).not.toHaveBeenCalled();
  });
  it('reads only the borrowed admitted descriptor and refuses unsafe legacy offsets before reading', async () => {
    const f = fixture();
    await expect(uploadDescriptor(f.client, f.handle, { ...f.input, size: '9007199254740993' }, { maxChunkBytes: 2, freshness: f.freshness })).rejects.toMatchObject({ status: 422 });
    expect(f.handle.read).not.toHaveBeenCalled(); expect(f.client.beginUpload).not.toHaveBeenCalled();
    expect(await uploadDescriptor(f.client, f.handle, f.input, { maxChunkBytes: 2, freshness: f.freshness })).toMatchObject({ blobId: 'b' });
    expect(f.handle.read).toHaveBeenNthCalledWith(1, 0, 2, { signal: undefined });
    expect(f.handle.close).not.toHaveBeenCalled();
  });
  it('passes exact bigint positions to the canonical exact descriptor on resume', async () => {
    const f = fixture(); const offset = 9007199254740993n;
    const read = vi.fn(async (position: bigint) => position === offset ? Uint8Array.of(5) : new Uint8Array());
    const handle: FileReadHandle = { ...f.handle, exact: { read, stat: async () => ({ type: 'file', size: offset + 1n }) } };
    f.client.inspectUpload.mockResolvedValue({ ...f.input, uploadId: 'u', state: 'open', size: String(offset + 1n), committedOffset: String(offset) });
    f.client.commitUpload.mockResolvedValue({ ...f.input, size: String(offset + 1n), blobId: 'b' });
    f.client.uploadChunk.mockResolvedValue({ ...f.input, uploadId: 'u', state: 'open', size: String(offset + 1n), committedOffset: String(offset + 1n), replayed: false });
    f.freshness.descriptor = handle;
    await uploadDescriptor(f.client, handle, { ...f.input, size: String(offset + 1n) }, {
      maxChunkBytes: 2, freshness: f.freshness, resume: { source: f.freshness, uploadId: 'u', offset: String(offset) },
    });
    expect(read).toHaveBeenNthCalledWith(1, offset, 1, { signal: undefined });
    expect(f.handle.read).not.toHaveBeenCalled();
  });
  it('refuses a resume from a different upload declaration before reading canonical bytes', async () => {
    const f = fixture();
    f.client.inspectUpload.mockResolvedValue({ ...f.input, uploadId: 'u', state: 'open', size: '8', committedOffset: '2' });
    await expect(uploadDescriptor(f.client, f.handle, f.input, { maxChunkBytes: 2, freshness: f.freshness, resume: { source: f.freshness, uploadId: 'u', offset: '2' } })).rejects.toMatchObject({ status: 409 });
    expect(f.handle.read).not.toHaveBeenCalled(); expect(f.client.uploadChunk).not.toHaveBeenCalled();
    expect(f.client.abortUpload).not.toHaveBeenCalled();
  });
});


it.each(['identity', 'version', 'descriptor'] as const)('refuses a capture with mismatched %s authority before upstream reads', async field => {
  const f = fixture();
  const source = { descriptor: f.handle, identity: {}, version: 'v1' };
  const freshness = { ...f.freshness, ...source };
  const resume = { uploadId: 'u', offset: '2', source: { identity: source.identity, version: source.version } };
  if (field === 'identity') resume.source.identity = {};
  if (field === 'version') resume.source.version = 'v2';
  if (field === 'descriptor') freshness.descriptor = { ...f.handle };
  await expect(uploadDescriptor(f.client, f.handle, f.input, { maxChunkBytes: 2, freshness, resume }))
    .rejects.toMatchObject({ status: 422 });
  expect(f.handle.read).not.toHaveBeenCalled();
  expect(f.client.inspectUpload).not.toHaveBeenCalled();
  expect(f.client.abortUpload).not.toHaveBeenCalled();
});

it('refuses an unqualified pathname freshness guard before capture', async () => {
  const f = fixture();
  const { identity: ignoredIdentity, version: ignoredVersion, descriptor: ignoredDescriptor, ...unqualified } = f.freshness;
  await expect(uploadDescriptor(f.client, f.handle, f.input, { maxChunkBytes: 2, freshness: unqualified as never }))
    .rejects.toMatchObject({ status: 422 });
  expect(f.client.beginUpload).not.toHaveBeenCalled();
});


it.each([null, 'pathname', 123, undefined])('rejects an unqualified capture identity %s', async identity => {
  const f = fixture();
  await expect(uploadDescriptor(f.client, f.handle, f.input, {
    maxChunkBytes: 2, freshness: { ...f.freshness, identity } as never,
  })).rejects.toMatchObject({ status: 422 });
  expect(f.handle.read).not.toHaveBeenCalled();
  expect(f.client.beginUpload).not.toHaveBeenCalled();
});

it('keeps resume source admission fixed across asynchronous host validation', async () => {
  const f = fixture();
  const source = { identity: f.freshness.identity, version: f.freshness.version };
  f.client.inspectUpload.mockResolvedValue({ ...f.input, uploadId: 'u', committedOffset: '2', state: 'open' });
  f.freshness.assertCurrent.mockImplementationOnce(async () => { source.identity = {}; source.version = 'another-version'; });
  await uploadDescriptor(f.client, f.handle, f.input, {
    maxChunkBytes: 2, freshness: f.freshness, resume: { uploadId: 'u', offset: '2', source },
  });
  expect(f.client.uploadChunk).toHaveBeenCalledOnce();
  expect(f.handle.read).toHaveBeenNthCalledWith(1, 2, 2, { signal: undefined });
});

it('captures the retained object after pathname replacement when its qualified version remains valid', async () => {
  const f = fixture();
  f.replace();
  // This host guard checks the retained object, independently of the old name.
  f.freshness.assertCurrent.mockImplementation(async () => {});
  await uploadDescriptor(f.client, f.handle, f.input, { maxChunkBytes: 2, freshness: f.freshness });
  expect(f.client.uploadChunk.mock.calls.flatMap(call => Array.from(call[2]))).toEqual([1, 2, 3, 4]);
  expect(f.handle.close).not.toHaveBeenCalled();
});


it.each(['identity', 'version'] as const)('invalidates a capture whose host changes its admitted %s mid-upload', async field => {
  const f = fixture();
  f.client.uploadChunk.mockImplementationOnce(async (id, offset, bytes) => {
    if (field === 'identity') f.freshness.identity = {};
    else f.freshness.version = 'v2';
    return { ...f.input, uploadId: id, committedOffset: String(BigInt(offset) + BigInt(bytes.length)), state: 'open', replayed: false };
  });
  await expect(uploadDescriptor(f.client, f.handle, f.input, { maxChunkBytes: 2, freshness: f.freshness }))
    .rejects.toMatchObject({ status: 409 });
  expect(f.client.uploadChunk).toHaveBeenCalledOnce();
  expect(f.client.commitUpload).not.toHaveBeenCalled();
  expect(f.freshness.invalidate).toHaveBeenCalledOnce();
  expect(f.client.abortUpload).toHaveBeenCalledWith('u');
});
