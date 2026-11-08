import { Volume } from 'memfs';
import { expect, it, vi } from 'vitest';
import { inspectOutputTree, retrieveOutputs } from './output-retrieval.js';

it('does not copy an untouched source reopened after generating a hard-link output', async () => {
  const manifest: EffectManifest = { jobId: 'reopened-input', outputs: ['input'], effectBarrier: '4', outputComplete: true,
    processOutcome: { kind: 'exited', exitCode: 1 }, effects: [
      { operationId: '0', sequence: '0', operation: 'open', state: 'applied', namespaceId: 'work', path: '/work/input', identityId: 'input' },
      { operationId: '1', sequence: '1', operation: 'link', state: 'applied', namespaceId: 'work', path: '/work/input', destination: '/work/generated', identityId: 'input' },
      { operationId: '2', sequence: '2', operation: 'open', state: 'applied', namespaceId: 'work', path: '/work/input', identityId: 'input' },
      { operationId: '3', sequence: '3', operation: 'open', state: 'applied', namespaceId: 'work', path: '/work/generated', identityId: 'input' },
    ] };
  expect(inspectOutputTree(manifest, '/work').files).toEqual([
    { path: '/work/generated', relativePath: 'generated', identityId: 'input' },
  ]);
  const volume = Volume.fromJSON({ '/out/prior': 'unrelated' });
  const result = await retrieveOutputs(manifest, '/work', {
    async metadata() { return { type: 'file', size: '2' }; },
    async range() { return new ReadableStream({ start(controller) { controller.enqueue(Uint8Array.of(0, 255)); controller.close(); } }); },
  }, { async mkdir() {}, async open(path) {
    const fd = volume.openSync('/out/' + path, 'w+');
    return { async write(position, bytes) { return volume.writeSync(fd, bytes, 0, bytes.length, Number(position)); },
      async truncate(size) { volume.ftruncateSync(fd, Number(size)); }, async close() { volume.closeSync(fd); } };
  } });
  expect(result).toMatchObject({ processOutcome: manifest.processOutcome, transfer: { state: 'complete' } });
  expect(volume.readdirSync('/out')).toEqual(['generated', 'prior']);
  expect(volume.readFileSync('/out/generated')).toEqual(Buffer.from([0, 255]));
});

it('transfers known outputs but reports retained outputs missing all effect observations', async () => {
  const manifest: EffectManifest = { jobId: 'partial-ledger', outputs: ['known', 'unobserved'], effectBarrier: '1', outputComplete: true,
    processOutcome: { kind: 'exited', exitCode: 1 }, effects: [
      { operationId: '1', sequence: '1', operation: 'created', state: 'applied', namespaceId: 'work', path: '/work/segment.ts', identityId: 'known' },
    ] };
  expect(inspectOutputTree(manifest, '/work')).toMatchObject({ retainedIdentities: ['known', 'unobserved'], unlocatedIdentities: ['unobserved'] });
  const volume = Volume.fromJSON({ '/out/prior': 'unrelated' });
  const metadata = vi.fn(async () => ({ type: 'file' as const, size: '2' }));
  const result = await retrieveOutputs(manifest, '/work', { metadata,
    async range() { return new ReadableStream({ start(controller) { controller.enqueue(Uint8Array.of(0, 255)); controller.close(); } }); },
  }, { async mkdir() {}, async open(path) {
    const fd = volume.openSync('/out/' + path, 'w+');
    return { async write(position, bytes) { return volume.writeSync(fd, bytes, 0, bytes.length, Number(position)); },
      async truncate(size) { volume.ftruncateSync(fd, Number(size)); }, async close() { volume.closeSync(fd); } };
  } });
  expect(result).toMatchObject({ manifest, processOutcome: manifest.processOutcome,
    transfer: { state: 'failed', error: expect.objectContaining({ message: 'Output namespace location unavailable: unobserved' }) } });
  expect(metadata.mock.calls).toEqual([['known', undefined]]);
  expect(result.transfer.cursor.completed).toEqual(new Set(['segment.ts']));
  expect(volume.readFileSync('/out/segment.ts')).toEqual(Buffer.from([0, 255]));
  expect(volume.readdirSync('/out')).toEqual(['prior', 'segment.ts']);
});

it.each(['partial', 'complete', 'directory'] as const)('refuses %s progress on another destination before any destination effects', async progress => {
  const manifest: EffectManifest = { jobId: 'destination-bound', outputs: progress === 'directory' ? [] : ['image'], effectBarrier: '1', outputComplete: true,
    processOutcome: { kind: 'exited', exitCode: 1 }, effects: [
      { operationId: '0', sequence: '0', operation: progress === 'directory' ? 'mkdir' : 'created', state: 'applied', namespaceId: 'work',
        path: '/work/image', ...(progress === 'directory' ? {} : { identityId: 'image' }) },
    ] };
  const volume = Volume.fromJSON({ '/first/prior': 'unrelated', '/second/prior': 'unrelated' });
  const guard = { identity: {}, version: '1', async assertCurrent() {} };
  const source = { async freshness() { return guard; }, async metadata() { return { type: 'file' as const, size: '2' }; },
    async range(_identity: string, start: bigint) { return new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(Uint8Array.of(0, 255).slice(Number(start))); controller.close(); } }); } };
  const first = await retrieveOutputs(manifest, '/work', source, { async mkdir(path) { volume.mkdirSync('/first/' + path); }, async open(path) {
    const fd = volume.openSync('/first/' + path, 'w+');
    return { async write(position, bytes) { if (progress === 'partial' && position > 0n) throw new Error('EDQUOT'); return volume.writeSync(fd, bytes, 0, progress === 'partial' ? 1 : bytes.length, Number(position)); },
      async truncate(size) { volume.ftruncateSync(fd, Number(size)); }, async close() { volume.closeSync(fd); } };
  } });
  const mkdir = vi.fn(async () => {}); const open = vi.fn();
  const resumed = await retrieveOutputs(manifest, '/work', source, { mkdir, open }, first.transfer.cursor);
  expect(resumed).toMatchObject({ processOutcome: manifest.processOutcome, transfer: { state: 'failed', error: expect.objectContaining({ message: expect.stringContaining('destination') }) } });
  expect(mkdir).not.toHaveBeenCalled(); expect(open).not.toHaveBeenCalled();
  expect(volume.readFileSync('/second/prior', 'utf8')).toBe('unrelated');
  if (progress !== 'directory') expect(volume.readFileSync('/first/image')).toEqual(Buffer.from(progress === 'partial' ? [0] : [0, 255]));
});

it.each(['sequence-conflict', 'duplicate-settlement'] as const)('rejects %s receipts before destination effects while preserving native exit', async conflict => {
  const manifest: EffectManifest = { jobId: 'ordered-effects', outputs: ['image'], effectBarrier: '2', outputComplete: true,
    processOutcome: { kind: 'exited', exitCode: 1 }, effects: [
      { operationId: 'create', sequence: '2', operation: 'created', state: 'applied', namespaceId: 'work', path: '/work/image', identityId: 'image' },
      { operationId: conflict === 'sequence-conflict' ? 'remove' : 'create', sequence: '2', operation: conflict === 'sequence-conflict' ? 'unlink' : 'created', state: 'applied', namespaceId: 'work', path: '/work/image', identityId: 'image' },
    ] };
  expect(() => inspectOutputTree(manifest, '/work')).toThrow('Conflicting output effect receipt');
  const open = vi.fn(); const mkdir = vi.fn(); const metadata = vi.fn(); const range = vi.fn();
  const result = await retrieveOutputs(manifest, '/work', { metadata, range }, { open, mkdir });
  expect(result).toMatchObject({ manifest, processOutcome: manifest.processOutcome, transfer: { state: 'failed', error: expect.any(TypeError) } });
  expect(open).not.toHaveBeenCalled(); expect(mkdir).not.toHaveBeenCalled();
  expect(metadata).not.toHaveBeenCalled(); expect(range).not.toHaveBeenCalled();
});

it('projects concurrent receipt settlement in observation order with shared requested sequences', () => {
  const manifest: EffectManifest = { jobId: 'concurrent', outputs: ['image'], effectBarrier: '2', outputComplete: true, effects: [
    { operationId: 'remove', sequence: '1', operation: 'unlink', state: 'requested', namespaceId: 'work', path: '/work/image' },
    { operationId: 'create', sequence: '2', operation: 'created', state: 'requested', namespaceId: 'work', path: '/work/image' },
    { operationId: 'create', sequence: '2', operation: 'created', state: 'applied', namespaceId: 'work', path: '/work/image', identityId: 'image' },
    { operationId: 'remove', sequence: '1', operation: 'unlink', state: 'applied', namespaceId: 'work', path: '/work/image', identityId: 'image' },
  ] };
  expect(inspectOutputTree(manifest, '/work')).toMatchObject({ files: [], detachedIdentities: ['image'], unresolvedEffects: [] });
});

it.each(['mkdir', 'symlink', 'link', 'created', 'modified', 'write', 'append', 'truncate', 'metadata'] as const)(
  'reports a settled unlocated %s receipt after transferring independent outputs', async operation => {
    const manifest: EffectManifest = { jobId: 'missing-location', outputs: ['segment'], effectBarrier: '2', outputComplete: true,
      processOutcome: { kind: 'exited', exitCode: 1 }, effects: [
        { operationId: '0', sequence: '0', operation, state: 'applied', namespaceId: 'work', acknowledgedBytes: '1' },
        { operationId: '1', sequence: '1', operation: 'created', state: 'applied', namespaceId: 'work', path: '/work/segment.ts', identityId: 'segment' },
      ] };
    expect(inspectOutputTree(manifest, '/work').unresolvedEffects).toEqual(['0']);
    const volume = Volume.fromJSON({ '/out/prior': 'unrelated' });
    const result = await retrieveOutputs(manifest, '/work', {
      async metadata() { return { type: 'file', size: '0' }; }, async range() { throw new Error('Empty output'); },
    }, { async mkdir() {}, async open(path) {
      volume.writeFileSync('/out/' + path, '');
      return { async write() { return 0; }, async truncate() {}, async close() {} };
    } });
    expect(result).toMatchObject({ processOutcome: manifest.processOutcome, transfer: { state: 'failed' } });
    expect(result.transfer.cursor.completed).toEqual(new Set(['segment.ts']));
    expect(volume.readdirSync('/out')).toEqual(['prior', 'segment.ts']);
  });

it('keeps the retained source of a settled link downloadable when its destination was not observed', async () => {
  const manifest: EffectManifest = { jobId: 'missing-link-destination', outputs: ['image'], effectBarrier: '2', outputComplete: true,
    processOutcome: { kind: 'exited', exitCode: 1 }, effects: [
      { operationId: '0', sequence: '0', operation: 'created', state: 'applied', namespaceId: 'work', path: '/work/intermediate.png', identityId: 'image' },
      { operationId: '1', sequence: '1', operation: 'link', state: 'applied', namespaceId: 'work', path: '/work/intermediate.png', identityId: 'image' },
    ] };
  expect(inspectOutputTree(manifest, '/work')).toMatchObject({
    files: [{ path: '/work/intermediate.png', relativePath: 'intermediate.png', identityId: 'image' }], unresolvedEffects: ['1'],
  });
  const volume = Volume.fromJSON({ '/out/prior': 'unrelated' });
  const result = await retrieveOutputs(manifest, '/work', {
    async metadata() { return { type: 'file', size: '0' }; }, async range() { throw new Error('Empty output'); },
  }, { async mkdir() {}, async open(path) {
    volume.writeFileSync('/out/' + path, '');
    return { async write() { return 0; }, async truncate() {}, async close() {} };
  } });
  expect(result).toMatchObject({ processOutcome: manifest.processOutcome, transfer: { state: 'failed' } });
  expect(result.transfer.cursor.completed).toEqual(new Set(['intermediate.png']));
  expect(volume.readdirSync('/out')).toEqual(['intermediate.png', 'prior']);
});

it.each(['applied', 'unknown'] as const)('does not recreate an empty generated directory after an unlocated %s rmdir', state => {
  const manifest: EffectManifest = { jobId: 'missing-rmdir-location', outputs: ['segment'], effectBarrier: '3', outputComplete: true, effects: [
    { operationId: '0', sequence: '0', operation: 'mkdir', state: 'applied', namespaceId: 'work', path: '/work/empty' },
    { operationId: '1', sequence: '1', operation: 'created', state: 'applied', namespaceId: 'work', path: '/work/hls/segment.ts', identityId: 'segment' },
    { operationId: '2', sequence: '2', operation: 'rmdir', state, namespaceId: 'work' },
  ] };
  expect(inspectOutputTree(manifest, '/work')).toMatchObject({
    files: [{ path: '/work/hls/segment.ts', relativePath: 'hls/segment.ts', identityId: 'segment' }],
    directories: [{ path: '/work/hls', relativePath: 'hls' }], unresolvedEffects: ['2'],
  });
});

it.each(['rename', 'unlink'] as const)('does not reconstruct stale aliases after a settled identity-only %s receipt', async operation => {
  const manifest: EffectManifest = { jobId: 'settled-namespace', outputs: ['image', 'segment'], effectBarrier: '4', outputComplete: true,
    processOutcome: { kind: 'exited', exitCode: 1 }, effects: [
      { operationId: '0', sequence: '0', operation: 'created', state: 'applied', namespaceId: 'work', path: '/work/intermediate.png', identityId: 'image' },
      { operationId: '1', sequence: '1', operation, state: 'applied', namespaceId: 'work', identityId: 'image' },
      { operationId: '2', sequence: '2', operation: 'write', state: 'applied', namespaceId: 'work', path: '/work/intermediate.png', identityId: 'image', acknowledgedBytes: '1' },
      { operationId: '3', sequence: '3', operation: 'created', state: 'applied', namespaceId: 'work', path: '/work/segment.ts', identityId: 'segment' },
    ] };
  expect(inspectOutputTree(manifest, '/work')).toMatchObject({
    files: [{ path: '/work/segment.ts', relativePath: 'segment.ts', identityId: 'segment' }],
    retainedIdentities: ['image', 'segment'], unlocatedIdentities: ['image'], unresolvedEffects: ['1'],
  });
  const volume = Volume.fromJSON({ '/out/prior': 'unrelated' });
  const result = await retrieveOutputs(manifest, '/work', {
    async metadata() { return { type: 'file', size: '0' }; }, async range() { throw new Error('Empty output'); },
  }, { async mkdir() {}, async open(path) {
    volume.writeFileSync('/out/' + path, '');
    return { async write() { return 0; }, async truncate() {}, async close() {} };
  } });
  expect(result).toMatchObject({ processOutcome: manifest.processOutcome, transfer: { state: 'failed' } });
  expect(volume.readdirSync('/out')).toEqual(['prior', 'segment.ts']);
});

it('does not reconstruct stale aliases after an identity-only uncertain namespace receipt', async () => {
  const manifest: EffectManifest = { jobId: 'identity-only-rename', outputs: ['image', 'segment'], effectBarrier: '4', outputComplete: true,
    processOutcome: { kind: 'exited', exitCode: 1 }, effects: [
      { operationId: '0', sequence: '0', operation: 'created', state: 'applied', namespaceId: 'work', path: '/work/intermediate.png', identityId: 'image' },
      { operationId: '1', sequence: '1', operation: 'rename', state: 'unknown', namespaceId: 'work', identityId: 'image' },
      { operationId: '2', sequence: '2', operation: 'write', state: 'applied', namespaceId: 'work', path: '/work/intermediate.png', identityId: 'image', acknowledgedBytes: '1' },
      { operationId: '3', sequence: '3', operation: 'created', state: 'applied', namespaceId: 'work', path: '/work/segment.ts', identityId: 'segment' },
    ] };
  expect(inspectOutputTree(manifest, '/work')).toMatchObject({
    files: [{ path: '/work/segment.ts', relativePath: 'segment.ts', identityId: 'segment' }],
    retainedIdentities: ['image', 'segment'], unlocatedIdentities: ['image'], unresolvedEffects: ['1'],
  });
  const volume = Volume.fromJSON({ '/out/prior': 'unrelated' });
  const metadata = vi.fn(async () => ({ type: 'file' as const, size: '0' }));
  const result = await retrieveOutputs(manifest, '/work', { metadata, async range() { throw new Error('Empty output'); } }, {
    async mkdir() {}, async open(path) {
      volume.writeFileSync('/out/' + path, '');
      return { async write() { return 0; }, async truncate() {}, async close() {} };
    },
  });
  expect(result).toMatchObject({ processOutcome: manifest.processOutcome, transfer: { state: 'failed' } });
  expect(volume.readdirSync('/out')).toEqual(['prior', 'segment.ts']);
  expect(metadata).toHaveBeenCalledExactlyOnceWith('segment', undefined);
});

it.each([false, true])('preserves the generated alias when same-object rename is a native no-op (reverse: %s)', async reverse => {
  const manifest: EffectManifest = { jobId: 'same-object-rename', outputs: ['image'], effectBarrier: '3', outputComplete: true,
    processOutcome: { kind: 'exited', exitCode: 1 }, effects: [
      { operationId: '0', sequence: '0', operation: 'open', state: 'applied', namespaceId: 'work', path: '/work/input.ppm', identityId: 'image' },
      { operationId: '1', sequence: '1', operation: 'link', state: 'applied', namespaceId: 'work', path: '/work/input.ppm', destination: '/work/intermediate.ppm', identityId: 'image' },
      { operationId: '2', sequence: '2', operation: 'rename', state: 'applied', namespaceId: 'work', path: reverse ? '/work/intermediate.ppm' : '/work/input.ppm', destination: reverse ? '/work/input.ppm' : '/work/intermediate.ppm', identityId: 'image' },
    ] };
  expect(inspectOutputTree(manifest, '/work')).toMatchObject({ files: [
    { path: '/work/intermediate.ppm', relativePath: 'intermediate.ppm', identityId: 'image' },
  ], unlocatedIdentities: [], unavailablePaths: [] });
  const volume = Volume.fromJSON({ '/out/prior': 'unrelated' });
  const result = await retrieveOutputs(manifest, '/work', {
    async metadata() { return { type: 'file', size: '0' }; },
    async range() { throw new Error('Empty output'); },
  }, { async mkdir() {}, async open(path) {
    volume.writeFileSync('/out/' + path, '');
    return { async write() { return 0; }, async truncate() {}, async close() {} };
  } });
  expect(result).toMatchObject({ processOutcome: manifest.processOutcome, transfer: { state: 'complete' } });
  expect(volume.readdirSync('/out')).toEqual(['intermediate.ppm', 'prior']);
});

it.each(['open', 'created', 'unlink', 'unknown-rename'] as const)('invalidates an untouched namespace observation after %s before moving an output alias', mutation => {
  const manifest: EffectManifest = { jobId: 'replaced-input', outputs: ['image'], effectBarrier: '4', outputComplete: true,
    processOutcome: { kind: 'exited', exitCode: 1 }, effects: [
      { operationId: '0', sequence: '0', operation: 'open', state: 'applied', namespaceId: 'work', path: '/work/input', identityId: 'image' },
      { operationId: '1', sequence: '1', operation: 'link', state: 'applied', namespaceId: 'work', path: '/work/input', destination: '/work/generated', identityId: 'image' },
      { operationId: '2', sequence: '2', operation: mutation === 'unknown-rename' ? 'rename' : mutation,
        state: mutation === 'unknown-rename' ? 'unknown' : 'applied', namespaceId: 'work', path: '/work/input',
        ...(mutation === 'open' || mutation === 'created' ? { identityId: 'replacement' } : {}),
        ...(mutation === 'unknown-rename' ? { destination: '/work/elsewhere' } : {}) },
      { operationId: '3', sequence: '3', operation: 'rename', state: 'applied', namespaceId: 'work', path: '/work/generated', destination: '/work/input', identityId: 'image' },
    ] };
  const tree = inspectOutputTree(manifest, '/work');
  expect(tree.files).toEqual([{ path: '/work/input', relativePath: 'input', identityId: 'image' }]);
  expect(tree.unavailablePaths).toEqual([]);
  expect(tree.manifest.processOutcome).toEqual({ kind: 'exited', exitCode: 1 });
});

it('moves untouched namespace observations with their directory without promoting them to outputs', () => {
  const manifest: EffectManifest = { jobId: 'directory-alias', outputs: ['image'], effectBarrier: '5', outputComplete: true, effects: [
    { operationId: '0', sequence: '0', operation: 'mkdir', state: 'applied', namespaceId: 'work', path: '/work/images' },
    { operationId: '1', sequence: '1', operation: 'open', state: 'applied', namespaceId: 'work', path: '/work/images/input', identityId: 'image' },
    { operationId: '2', sequence: '2', operation: 'link', state: 'applied', namespaceId: 'work', path: '/work/images/input', destination: '/work/images/generated', identityId: 'image' },
    { operationId: '3', sequence: '3', operation: 'rename', state: 'applied', namespaceId: 'work', path: '/work/images', destination: '/work/renamed' },
    { operationId: '4', sequence: '4', operation: 'rename', state: 'applied', namespaceId: 'work', path: '/work/renamed/generated', destination: '/work/renamed/input', identityId: 'image' },
  ] };
  expect(inspectOutputTree(manifest, '/work')).toMatchObject({
    files: [{ path: '/work/renamed/generated', relativePath: 'renamed/generated', identityId: 'image' }],
    directories: [{ path: '/work/renamed', relativePath: 'renamed' }],
    unlocatedIdentities: [], unavailablePaths: [],
  });
});

it('transfers available outputs after a receipt identifies an object without retained retrieval authority', async () => {
  const manifest: EffectManifest = { jobId: 'partial-retains', outputs: ['known'], effectBarrier: '2', outputComplete: true,
    processOutcome: { kind: 'exited', exitCode: 1 }, effects: [
      { operationId: '0', sequence: '0', operation: 'created', state: 'applied', namespaceId: 'work', path: '/work/missing', identityId: 'missing' },
      { operationId: '1', sequence: '1', operation: 'created', state: 'applied', namespaceId: 'work', path: '/work/known', identityId: 'known' },
    ] };
  expect(inspectOutputTree(manifest, '/work')).toMatchObject({
    files: [{ path: '/work/known', relativePath: 'known', identityId: 'known' }],
    unavailablePaths: [{ path: '/work/missing', relativePath: 'missing' }],
    retainedIdentities: ['known'],
  });
  const volume = Volume.fromJSON({ '/out/prior': 'unrelated' });
  const metadata = vi.fn(async (identity: string) => {
    if (identity !== 'known') throw new Error('No retained retrieval authority');
    return { type: 'file' as const, size: '0' };
  });
  const result = await retrieveOutputs(manifest, '/work', { metadata, async range() { throw new Error('empty output'); } }, {
    async mkdir() {}, async open(path) {
      volume.writeFileSync('/out/' + path, '');
      return { async write() { return 0; }, async truncate() {}, async close() {} };
    },
  });
  expect(result).toMatchObject({ processOutcome: manifest.processOutcome, transfer: { state: 'failed' } });
  expect(result.transfer.cursor.completed).toEqual(new Set(['known']));
  expect(metadata).toHaveBeenCalledExactlyOnceWith('known', undefined);
  expect(volume.readFileSync('/out/prior', 'utf8')).toBe('unrelated');
  expect(volume.existsSync('/out/missing')).toBe(false);
});

it('preserves a generated hard-link destination when a fresh open observes its sole output location', () => {
  const manifest: EffectManifest = { jobId: 'link-open', outputs: ['input'], effectBarrier: '3', outputComplete: true, effects: [
    { operationId: '0', sequence: '0', operation: 'open', state: 'applied', namespaceId: 'work', path: '/work/input', identityId: 'input' },
    { operationId: '1', sequence: '1', operation: 'link', state: 'applied', namespaceId: 'work', destination: '/work/alias', identityId: 'input' },
    { operationId: '2', sequence: '2', operation: 'open', state: 'applied', namespaceId: 'work', path: '/work/alias', identityId: 'input' },
  ] };
  expect(inspectOutputTree(manifest, '/work')).toMatchObject({ files: [
    { path: '/work/alias', relativePath: 'alias', identityId: 'input' },
  ], unlocatedIdentities: [] });
});

it('uses initial opens to locate later writes across a rename without promoting untouched link sources', () => {
  const manifest: EffectManifest = { jobId: 'initial-opens', outputs: ['image', 'input'], effectBarrier: '5', outputComplete: true,
    processOutcome: { kind: 'exited', exitCode: 1 }, effects: [
      { operationId: '0', sequence: '0', operation: 'open', state: 'applied', namespaceId: 'work', path: '/work/image', identityId: 'image' },
      { operationId: '1', sequence: '1', operation: 'open', state: 'applied', namespaceId: 'work', path: '/work/input', identityId: 'input' },
      { operationId: '2', sequence: '2', operation: 'rename', state: 'applied', namespaceId: 'work', path: '/work/image', destination: '/work/replaced' },
      { operationId: '3', sequence: '3', operation: 'write', state: 'applied', namespaceId: 'work', identityId: 'image', acknowledgedBytes: '2' },
      { operationId: '4', sequence: '4', operation: 'link', state: 'applied', namespaceId: 'work', identityId: 'input', destination: '/work/alias' },
    ] };
  expect(inspectOutputTree(manifest, '/work')).toMatchObject({ files: [
    { path: '/work/replaced', relativePath: 'replaced', identityId: 'image' },
    { path: '/work/alias', relativePath: 'alias', identityId: 'input' },
  ], unlocatedIdentities: [], unavailablePaths: [] });
});

it('does not relocate retained IO through a stale pathname after uncertain namespace settlement', () => {
  const manifest: EffectManifest = { jobId: 'uncertain', outputs: ['output'], effectBarrier: '3', outputComplete: true, effects: [
    { operationId: '1', sequence: '1', operation: 'created', state: 'applied', namespaceId: 'work', path: '/work/a', identityId: 'output' },
    { operationId: '2', sequence: '2', operation: 'rename', state: 'unknown', namespaceId: 'work', path: '/work/a', destination: '/work/b' },
    { operationId: '3', sequence: '3', operation: 'write', state: 'applied', namespaceId: 'work', path: '/work/a', identityId: 'output', acknowledgedBytes: '1' },
  ] };
  expect(inspectOutputTree(manifest, '/work')).toMatchObject({ files: [], unlocatedIdentities: ['output'], unresolvedEffects: ['2'] });
});

it('does not retrieve a former output name after a settled open proves an untouched replacement occupies it', () => {
  const manifest: EffectManifest = { jobId: 'replacement', outputs: ['old'], effectBarrier: '2', outputComplete: true, effects: [
    { operationId: '1', sequence: '1', operation: 'modified', state: 'applied', namespaceId: 'work', path: '/work/image', identityId: 'old' },
    { operationId: '2', sequence: '2', operation: 'open', state: 'applied', namespaceId: 'work', path: '/work/image', identityId: 'untouched' },
  ] };
  const tree = inspectOutputTree(manifest, '/work');
  expect(tree.files).toEqual([]);
  expect(tree.detachedIdentities).toEqual(['old']);
  expect(tree.retainedIdentities).toEqual(['old']);
  expect(tree.unlocatedIdentities).toEqual([]);
});

it.each([0, -1, 0.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1])('refuses invalid transfer bound %s before canonical reads or destination effects', async maxFrameBytes => {
  const manifest: EffectManifest = { jobId: 'bounded', outputs: [], effectBarrier: '0', outputComplete: true, effects: [] };
  const metadata = vi.fn(); const range = vi.fn(); const mkdir = vi.fn(); const open = vi.fn();
  const result = await retrieveOutputs(manifest, '/work', { metadata, range }, { mkdir, open }, undefined, undefined, { maxFrameBytes });
  expect(result.transfer).toMatchObject({ state: 'failed', error: new TypeError('Invalid output transfer frame bound') });
  expect(metadata).not.toHaveBeenCalled(); expect(range).not.toHaveBeenCalled(); expect(mkdir).not.toHaveBeenCalled(); expect(open).not.toHaveBeenCalled();
});

it.each([false, true])('refuses oversized transfer frames while preserving acknowledged canonical progress (shadowed: %s)', async shadowed => {
  const manifest: EffectManifest = { jobId: 'bounded', outputs: ['o'], effectBarrier: '1', outputComplete: true,
    processOutcome: { kind: 'exited', exitCode: 1 },
    effects: [{ operationId: '1', sequence: '1', operation: 'created', state: 'applied', namespaceId: 'work', path: '/work/file', identityId: 'o' }] };
  const write = vi.fn(async (_position: bigint, bytes: Uint8Array) => bytes.length);
  const truncate = vi.fn(async () => {}); const close = vi.fn(async () => {});
  const cancel = vi.fn(); let frame = 0;
  const oversized = Uint8Array.of(1, 2, 3);
  if (shadowed) {
    Object.defineProperty(oversized, 'length', { value: 1 });
    Object.defineProperty(oversized, 'byteLength', { value: 1 });
  }
  const result = await retrieveOutputs(manifest, '/work', {
    async metadata() { return { type: 'file', size: '5' }; },
    async range() { return new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(++frame === 1 ? Uint8Array.of(0, 255) : oversized); }, cancel,
    }, { highWaterMark: 0 }); },
  }, { async mkdir() {}, async open() { return { write, truncate, close }; } }, undefined, undefined, { maxFrameBytes: 2 });
  expect(result.transfer).toMatchObject({ state: 'failed', error: new Error('Output range frame exceeds transfer bound') });
  expect(result.transfer.cursor.offsets.get('file')).toBe(2n);
  expect(result.transfer.cursor.completed.size).toBe(0);
  expect(write).toHaveBeenCalledExactlyOnceWith(0n, Uint8Array.of(0, 255), undefined);
  expect(truncate).not.toHaveBeenCalled(); expect(close).toHaveBeenCalledOnce(); expect(cancel).toHaveBeenCalledOnce();
});

it('preserves ordered source bytes when a partial-write consumer mutates its admitted buffer', async () => {
  const volume = Volume.fromJSON({ '/out/file': '' });
  const manifest: EffectManifest = { jobId: 'j', outputs: ['o'], effectBarrier: '1', outputComplete: true,
    processOutcome: { kind: 'exited', exitCode: 1 },
    effects: [{ operationId: '1', sequence: '1', operation: 'created', state: 'applied', namespaceId: 'work', path: '/work/file', identityId: 'o' }] };
  const bytes = Uint8Array.of(0, 255, 17);
  const result = await retrieveOutputs(manifest, '/work', {
    async metadata() { return { type: 'file', size: '3' }; },
    async range() { return new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }); },
  }, { async mkdir() {}, async open() {
    const fd = volume.openSync('/out/file', 'r+');
    return {
      async write(position, buffer) {
        const count = volume.writeSync(fd, buffer, 0, 1, Number(position));
        buffer.fill(42);
        return count;
      },
      async truncate(size) { volume.ftruncateSync(fd, Number(size)); },
      async close() { volume.closeSync(fd); },
    };
  } });
  expect(result).toMatchObject({ processOutcome: { kind: 'exited', exitCode: 1 }, transfer: { state: 'complete' } });
  expect(result.transfer.cursor.offsets.get('file')).toBe(3n);
  expect(volume.readFileSync('/out/file')).toEqual(Buffer.from([0, 255, 17]));
  expect(bytes).toEqual(Uint8Array.of(0, 255, 17));
});

it('keeps retrieval on the admitted source and destination capabilities across awaited host work', async () => {
  const manifest: EffectManifest = { jobId: 'j', outputs: ['o'], effectBarrier: '1', outputComplete: true,
    effects: [{ operationId: '1', sequence: '1', operation: 'created', state: 'applied', namespaceId: 'work', path: '/work/file', identityId: 'o' }] };
  const redirected = vi.fn(async () => { throw new Error('substituted authority'); });
  const write = vi.fn(async (_position: bigint, bytes: Uint8Array) => {
    file.truncate = redirected; file.close = redirected;
    return bytes.length;
  });
  const truncate = vi.fn(async () => {}); const close = vi.fn(async () => {});
  const file = { write, truncate, close };
  const source = { async metadata() { return { type: 'file' as const, size: '1' }; },
    async range() { return new ReadableStream<Uint8Array>({ start(c) { c.enqueue(Uint8Array.of(255)); c.close(); } }); },
    async freshness() {
      source.metadata = redirected; source.range = redirected; destination.open = redirected;
      return { identity: {}, version: '1', async assertCurrent() {} };
    } };
  const destination = { async mkdir() {}, async open() { return file; } };
  const result = await retrieveOutputs(manifest, '/work', source, destination);
  expect(result.transfer.state).toBe('complete');
  expect(write).toHaveBeenCalledOnce(); expect(truncate).toHaveBeenCalledOnce(); expect(close).toHaveBeenCalledOnce();
  expect(redirected).not.toHaveBeenCalled();
});

it.each(['truncate', 'close'] as const)('detects source mutation during final destination %s without rolling back acknowledged bytes', async phase => {
  const volume = Volume.fromJSON({ '/out/file': '' });
  const manifest: EffectManifest = { jobId: 'j', outputs: ['o'], effectBarrier: '1', outputComplete: true,
    effects: [{ operationId: '1', sequence: '1', operation: 'created', state: 'applied', namespaceId: 'work', path: '/work/file', identityId: 'o' }] };
  let stale = false;
  const error = new Error('canonical version changed');
  const freshness = { identity: {}, version: '1', async assertCurrent() { if (stale) throw error; } };
  const source = { async freshness() { return freshness; }, async metadata() { return { type: 'file' as const, size: '2' }; },
    async range() { return new ReadableStream<Uint8Array>({ start(c) { c.enqueue(Uint8Array.of(0, 255)); c.close(); } }); } };
  const close = vi.fn(async () => { if (phase === 'close') stale = true; });
  const result = await retrieveOutputs(manifest, '/work', source, { async mkdir() {}, async open() {
    return { async write(position, bytes) { volume.writeFileSync('/out/file', bytes); expect(position).toBe(0n); return bytes.length; },
      async truncate() { if (phase === 'truncate') stale = true; }, close };
  } });
  expect(result.transfer).toMatchObject({ state: 'failed', error });
  expect(result.transfer.cursor.offsets.get('file')).toBe(2n);
  expect(result.transfer.cursor.completed.size).toBe(0);
  expect(volume.readFileSync('/out/file')).toEqual(Buffer.from([0, 255]));
  expect(close).toHaveBeenCalledOnce();
});

it.each(['unqualified', 'lost-binding'] as const)('rejects %s completed output reuse before transferring another file', async mode => {
  const volume = Volume.fromJSON({ '/out/prior': 'unrelated' });
  const manifest: EffectManifest = { jobId: 'j', outputs: ['first', 'second'], effectBarrier: '2', outputComplete: true,
    processOutcome: { kind: 'exited', exitCode: 1 }, effects: ['first', 'second'].map((identityId, index) => ({
      operationId: String(index), sequence: String(index), operation: 'created', state: 'applied',
      namespaceId: 'work', path: '/work/' + identityId, identityId,
    })) };
  const identity = {}; let fail = true;
  const source = {
    ...(mode === 'lost-binding' ? { async freshness() { return { identity, version: '1', async assertCurrent() {} }; } } : {}),
    async metadata() { return { type: 'file' as const, size: '1' }; },
    async range() { return new ReadableStream<Uint8Array>({ start(c) { c.enqueue(Uint8Array.of(255)); c.close(); } }); },
  };
  const open = vi.fn(async (path: string) => {
    if (path === 'second' && fail) throw new Error('destination quota');
    const fd = volume.openSync('/out/' + path, 'w+');
    return { async write(position: bigint, bytes: Uint8Array) { return volume.writeSync(fd, bytes, 0, bytes.length, Number(position)); },
      async truncate(size: bigint) { volume.ftruncateSync(fd, Number(size)); }, async close() { volume.closeSync(fd); } };
  });
  const destination = { async mkdir() {}, open };
  const first = await retrieveOutputs(manifest, '/work', source, destination);
  expect(first.transfer.state).toBe('failed');
  expect(first.transfer.cursor.completed).toEqual(new Set(['first']));
  first.transfer.cursor.sources?.clear();
  open.mockClear(); fail = false;
  const resumed = await retrieveOutputs(manifest, '/work', source, destination, first.transfer.cursor);
  expect(resumed).toMatchObject({ processOutcome: manifest.processOutcome, transfer: { state: 'failed', path: 'first' } });
  expect(open).not.toHaveBeenCalled();
  expect(volume.readFileSync('/out/first')).toEqual(Buffer.from([255]));
  expect(volume.existsSync('/out/second')).toBe(false);
  expect(volume.readFileSync('/out/prior', 'utf8')).toBe('unrelated');
});

it.each(['unlink', 'rename'] as const)('tracks a generated symlink through %s without enumerating its target', operation => {
  const manifest: EffectManifest = { jobId: 'j', outputs: [], effectBarrier: '2', outputComplete: true,
    processOutcome: { kind: 'exited', exitCode: 1 }, effects: [
      { operationId: '1', sequence: '1', operation: 'symlink', state: 'applied', namespaceId: 'work', path: '/work/alias' },
      { operationId: '2', sequence: '2', operation, state: 'applied', namespaceId: 'work', path: '/work/alias',
        ...(operation === 'rename' ? { destination: '/work/moved' } : {}) },
    ] };
  const tree = inspectOutputTree(manifest, '/work');
  expect(tree.files).toEqual([]);
  expect(tree.unavailablePaths).toEqual(operation === 'rename' ? [{ path: '/work/moved', relativePath: 'moved' }] : []);
  expect(tree.manifest.processOutcome).toEqual(manifest.processOutcome);
});

it.each(['version', 'identity', 'guard'] as const)('rejects changed completed output %s before resuming a later file without rolling back settled bytes', async change => {
  const volume = Volume.fromJSON({ '/out/prior': 'unrelated' });
  const manifest: EffectManifest = { jobId: 'j', outputs: ['first', 'second'], effectBarrier: '2', outputComplete: true,
    processOutcome: { kind: 'exited', exitCode: 1 }, effects: ['first', 'second'].map((identityId, index) => ({
      operationId: String(index), sequence: String(index), operation: 'created', state: 'applied',
      namespaceId: 'work', path: '/work/' + identityId, identityId,
    })) };
  let identity = {}; let version = '1'; let fail = true; let guard = true;
  const secondIdentity = {};
  const source = {
    async freshness(id: string) {
      if (id === 'first' && !guard) return undefined;
      return { identity: id === 'first' ? identity : secondIdentity, version: id === 'first' ? version : '1', async assertCurrent() {} };
    },
    async metadata() { return { type: 'file' as const, size: '1' }; },
    async range() { return new ReadableStream<Uint8Array>({ start(c) { c.enqueue(Uint8Array.of(255)); c.close(); } }); },
  };
  const open = vi.fn(async (path: string) => {
    if (path === 'second' && fail) throw new Error('destination read-only');
    const fd = volume.openSync('/out/' + path, 'w+');
    return { async write(position: bigint, bytes: Uint8Array) { return volume.writeSync(fd, bytes, 0, bytes.length, Number(position)); },
      async truncate(size: bigint) { volume.ftruncateSync(fd, Number(size)); }, async close() { volume.closeSync(fd); } };
  });
  const destination = { async mkdir() {}, open };
  const cursor = { completed: new Set<string>(), offsets: new Map<string, bigint>() };
  expect((await retrieveOutputs(manifest, '/work', source, destination, cursor)).transfer.state).toBe('failed');
  expect(cursor.completed).toEqual(new Set(['first']));
  open.mockClear(); fail = false;
  if (change === 'version') version = '2';
  if (change === 'identity') identity = {};
  if (change === 'guard') guard = false;
  const result = await retrieveOutputs(manifest, '/work', source, destination, cursor);
  expect(result).toMatchObject({ processOutcome: manifest.processOutcome, transfer: { state: 'failed', path: 'first' } });
  expect(open).not.toHaveBeenCalled();
  expect(volume.readFileSync('/out/first')).toEqual(Buffer.from([255]));
  expect(volume.existsSync('/out/second')).toBe(false);
  expect(volume.readFileSync('/out/prior', 'utf8')).toBe('unrelated');
});

it('refuses changing generic source freshness before binding resumable output bytes', async () => {
  const manifest: EffectManifest = { jobId: 'j', outputs: ['a'], effectBarrier: '1', outputComplete: true,
    effects: [{ operationId: '1', sequence: '1', operation: 'created', state: 'applied', namespaceId: 'work', path: '/work/a', identityId: 'a' }] };
  const identity = {}; let identityReads = 0; let versionReads = 0; let validatorReads = 0;
  const assertCurrent = vi.fn(async () => {});
  const guard = {
    get identity() { return ++identityReads === 1 ? identity : {}; },
    get version() { return ++versionReads === 1 ? '1' : '2'; },
    get assertCurrent() { validatorReads++; return assertCurrent; },
  };
  const result = await retrieveOutputs(manifest, '/work', {
    async freshness() { return guard; }, async metadata() { return { type: 'file', size: '1' }; },
    async range() { return new ReadableStream({ start(controller) { controller.enqueue(Uint8Array.of(255)); controller.close(); } }); },
  }, { async mkdir() {}, async open() { return { async write() { return 1; }, async truncate() {}, async close() {} }; } });
  expect(result.transfer).toMatchObject({ state: 'failed', error: new TypeError('Canonical output freshness binding changed') });
  expect(result.transfer.cursor.sources?.size ?? 0).toBe(0);
  expect(validatorReads).toBe(1);
  expect(assertCurrent).not.toHaveBeenCalled();
});

it('keeps an acknowledged prefix but refuses suffix and resume when its mutable source guard rebinds', async () => {
  const manifest: EffectManifest = { jobId: 'j', outputs: ['a'], effectBarrier: '1', outputComplete: true,
    processOutcome: { kind: 'exited', exitCode: 1 },
    effects: [{ operationId: '1', sequence: '1', operation: 'created', state: 'applied', namespaceId: 'work', path: '/work/a', identityId: 'a' }] };
  let version = '1'; let frame = 0;
  const guard = { identity: {}, version, async assertCurrent() { if (this.version !== version) throw new Error('stale'); } };
  const range = vi.fn(async () => new ReadableStream<Uint8Array>({ pull(controller) {
    if (++frame === 2) { version = '2'; guard.version = version; }
    controller.enqueue(Uint8Array.of(frame)); if (frame === 2) controller.close();
  } }, { highWaterMark: 0 }));
  const source = { freshness: async () => guard, metadata: async () => ({ type: 'file' as const, size: '2' }), range };
  const volume = Volume.fromJSON({ '/out/a': '' });
  const open = vi.fn(async () => ({
    async write(position: bigint, bytes: Uint8Array) { const fd = volume.openSync('/out/a', 'r+');
      try { return volume.writeSync(fd, bytes, 0, bytes.length, Number(position)); } finally { volume.closeSync(fd); }
    }, truncate: vi.fn(async () => {}), close: vi.fn(async () => {}),
  }));
  const destination = { mkdir: async () => {}, open };
  const first = await retrieveOutputs(manifest, '/work', source, destination);
  expect(first).toMatchObject({ processOutcome: { kind: 'exited', exitCode: 1 }, transfer: { state: 'failed', error: new TypeError('Canonical output freshness binding changed') } });
  expect(first.transfer.cursor.offsets.get('a')).toBe(1n);
  expect(volume.readFileSync('/out/a')).toEqual(Buffer.from([1]));
  const resumed = await retrieveOutputs(manifest, '/work', source, destination, first.transfer.cursor);
  expect(resumed.transfer.state).toBe('failed');
  expect(open).toHaveBeenCalledOnce(); expect(range).toHaveBeenCalledOnce();
  expect(volume.readFileSync('/out/a')).toEqual(Buffer.from([1]));
});

it('reports a settled link without retained identity and preserves displaced output retrieval', async () => {
  const manifest: EffectManifest = { jobId: 'j', outputs: ['old'], effectBarrier: '2', outputComplete: true,
    processOutcome: { kind: 'exited', exitCode: 1 }, effects: [
      { operationId: '1', sequence: '1', operation: 'created', state: 'applied', namespaceId: 'work', path: '/work/result', identityId: 'old' },
      { operationId: '2', sequence: '2', operation: 'link', state: 'applied', namespaceId: 'work', destination: '/work/result' },
    ] };
  expect(inspectOutputTree(manifest, '/work')).toMatchObject({ files: [], detachedIdentities: ['old'],
    unavailablePaths: [{ path: '/work/result', relativePath: 'result' }] });
  const open = vi.fn(async () => { throw new Error('Unknown link occupant'); });
  const result = await retrieveOutputs(manifest, '/work', {
    async metadata() { throw new Error('Must not retrieve displaced identity at its former name'); },
    async range() { throw new Error('No current retained occupant'); },
  }, { async mkdir() {}, open });
  expect(result).toMatchObject({ processOutcome: manifest.processOutcome, transfer: { state: 'failed' } });
  expect(open).not.toHaveBeenCalled();
  manifest.effects.push({ operationId: '3', sequence: '3', operation: 'unlink', state: 'applied', namespaceId: 'work', path: '/work/result' });
  expect(inspectOutputTree(manifest, '/work').unavailablePaths).toEqual([]);
});

it.each(['created', 'truncate'] as const)('reports a settled %s without retained identity after transferring available outputs', async operation => {
  const manifest: EffectManifest = { jobId: 'j', outputs: ['known'], effectBarrier: '3', outputComplete: true,
    processOutcome: { kind: 'exited', exitCode: 1 }, effects: [
      { operationId: '1', sequence: '1', operation: 'created', state: 'applied', namespaceId: 'work', path: '/work/known', identityId: 'known' },
      { operationId: '2', sequence: '2', operation, state: 'applied', namespaceId: 'work', path: '/work/intermediate' },
      { operationId: '3', sequence: '3', operation: 'rename', state: 'applied', namespaceId: 'work', path: '/work/intermediate', destination: '/work/result' },
    ] };
  expect(inspectOutputTree(manifest, '/work')).toMatchObject({ unavailablePaths: [{ path: '/work/result', relativePath: 'result' }] });
  const volume = Volume.fromJSON({ '/out/prior': 'unrelated' });
  const result = await retrieveOutputs(manifest, '/work', {
    async metadata() { return { type: 'file', size: '0' }; }, async range() { throw new Error('empty output'); },
  }, { async mkdir() {}, async open(path) {
    volume.writeFileSync('/out/' + path, '');
    return { async write() { return 0; }, async truncate() {}, async close() {} };
  } });
  expect(result).toMatchObject({ processOutcome: manifest.processOutcome, transfer: { state: 'failed', error: expect.any(Error) } });
  expect(result.transfer.cursor.completed).toEqual(new Set(['known']));
  expect(volume.readFileSync('/out/prior', 'utf8')).toBe('unrelated');
  expect(volume.existsSync('/out/result')).toBe(false);
  manifest.effects.push({ operationId: '4', sequence: '4', operation: 'unlink', state: 'applied', namespaceId: 'work', path: '/work/result' });
  expect(inspectOutputTree(manifest, '/work').unavailablePaths).toEqual([]);
});

it('does not use an older retained identity to retrieve a later output with failed retention', () => {
  const manifest: EffectManifest = { jobId: 'j', outputs: ['old'], effectBarrier: '3', outputComplete: true, effects: [
    { operationId: '1', sequence: '1', operation: 'created', state: 'applied', namespaceId: 'work', path: '/work/result', identityId: 'old' },
    { operationId: '2', sequence: '2', operation: 'created', state: 'applied', namespaceId: 'work', path: '/work/result' },
    { operationId: '3', sequence: '3', operation: 'write', state: 'applied', namespaceId: 'work', path: '/work/result', identityId: 'old', acknowledgedBytes: '1' },
  ] };
  expect(inspectOutputTree(manifest, '/work')).toMatchObject({
    files: [], detachedIdentities: ['old'], unavailablePaths: [{ path: '/work/result', relativePath: 'result' }],
  });
});

it('reports an unretained rename destination instead of silently claiming the output tree is complete', async () => {
  const manifest: EffectManifest = { jobId: 'j', outputs: [], effectBarrier: '1', outputComplete: true, effects: [
    { operationId: '1', sequence: '1', operation: 'rename', state: 'applied', namespaceId: 'work', path: '/work/input', destination: '/work/result' },
  ] };
  expect(inspectOutputTree(manifest, '/work')).toMatchObject({
    files: [], unavailablePaths: [{ path: '/work/result', relativePath: 'result' }],
  });
  const result = await retrieveOutputs(manifest, '/work', {
    async metadata() { throw new Error('Never reopen an unknown rename occupant'); }, async range() { throw new Error('No retained identity'); },
  }, { async mkdir() {}, async open() { throw new Error('No retained identity'); } });
  expect(result.transfer.state).toBe('failed');
});

it('resolves an unavailable path only when a later namespace receipt establishes a retained occupant', () => {
  const manifest: EffectManifest = { jobId: 'j', outputs: ['new'], effectBarrier: '3', outputComplete: true, effects: [
    { operationId: '1', sequence: '1', operation: 'created', state: 'applied', namespaceId: 'work', path: '/work/generated/result' },
    { operationId: '2', sequence: '2', operation: 'rename', state: 'applied', namespaceId: 'work', path: '/work/generated', destination: '/work/moved' },
    { operationId: '3', sequence: '3', operation: 'link', state: 'applied', namespaceId: 'work', destination: '/work/moved/result', identityId: 'new' },
  ] };
  expect(inspectOutputTree(manifest, '/work')).toMatchObject({
    files: [{ path: '/work/moved/result', relativePath: 'moved/result', identityId: 'new' }], unavailablePaths: [],
  });
});

it('preserves a generated directory after a rename to its own name', () => {
  const manifest: EffectManifest = { jobId: 'j', outputs: [], effectBarrier: '2', outputComplete: true, effects: [
    { operationId: '1', sequence: '1', operation: 'mkdir', state: 'applied', namespaceId: 'work', path: '/work/generated' },
    { operationId: '2', sequence: '2', operation: 'rename', state: 'applied', namespaceId: 'work', path: '/work/generated', destination: '/work/generated' },
  ] };
  expect(inspectOutputTree(manifest, '/work').directories).toEqual([{ path: '/work/generated', relativePath: 'generated' }]);
});

it('detaches an output replaced by a rename from an untracked source', () => {
  const manifest: EffectManifest = { jobId: 'j', outputs: ['old'], effectBarrier: '3', outputComplete: true, effects: [
    { operationId: '1', sequence: '1', operation: 'created', state: 'applied', namespaceId: 'work', path: '/work/result', identityId: 'old' },
    { operationId: '2', sequence: '2', operation: 'rename', state: 'applied', namespaceId: 'work', path: '/work/untracked', destination: '/work/result' },
    { operationId: '3', sequence: '3', operation: 'write', state: 'applied', namespaceId: 'work', path: '/work/result', identityId: 'old', acknowledgedBytes: '1' },
  ] };
  expect(inspectOutputTree(manifest, '/work')).toMatchObject({ files: [], detachedIdentities: ['old'], retainedIdentities: ['old'], unlocatedIdentities: [] });
});

it('keeps a displaced retained identity detached after a link replaces its name', () => {
  const manifest: EffectManifest = { jobId: 'j', outputs: ['old', 'new'], effectBarrier: '3', outputComplete: true, effects: [
    { operationId: '1', sequence: '1', operation: 'created', state: 'applied', namespaceId: 'work', path: '/work/result', identityId: 'old' },
    { operationId: '2', sequence: '2', operation: 'link', state: 'applied', namespaceId: 'work', destination: '/work/result', identityId: 'new' },
    { operationId: '3', sequence: '3', operation: 'write', state: 'applied', namespaceId: 'work', path: '/work/result', identityId: 'old', acknowledgedBytes: '1' },
  ] };
  expect(inspectOutputTree(manifest, '/work')).toMatchObject({ files: [{ path: '/work/result', relativePath: 'result', identityId: 'new' }], detachedIdentities: ['old'] });
});

it('reports retained effects with no observed namespace location instead of claiming empty reconstruction succeeded', async () => {
  const manifest: EffectManifest = { jobId: 'j', outputs: ['a'], effectBarrier: '1', outputComplete: true,
    processOutcome: { kind: 'exited', exitCode: 1 }, effects: [
      { operationId: '1', sequence: '1', operation: 'write', state: 'applied', namespaceId: 'work', identityId: 'a', acknowledgedBytes: '1' },
    ] };
  expect(inspectOutputTree(manifest, '/work').unlocatedIdentities).toEqual(['a']);
  const result = await retrieveOutputs(manifest, '/work', { async metadata() { throw new Error('must inspect location first'); }, async range() { throw new Error('must inspect location first'); } }, { async mkdir() {}, async open() { throw new Error('no destination effects'); } });
  expect(result).toMatchObject({ manifest, processOutcome: { kind: 'exited', exitCode: 1 }, transfer: { state: 'failed', error: expect.any(Error) } });
});

it('retrieves known files before reporting remaining unlocated output effects', async () => {
  const manifest: EffectManifest = { jobId: 'j', outputs: ['known', 'unknown'], effectBarrier: '2', outputComplete: true, effects: [
    { operationId: '1', sequence: '1', operation: 'created', state: 'applied', namespaceId: 'work', path: '/work/known', identityId: 'known' },
    { operationId: '2', sequence: '2', operation: 'write', state: 'applied', namespaceId: 'work', identityId: 'unknown', acknowledgedBytes: '1' },
  ] };
  const volume = Volume.fromJSON({ '/out/prior': 'unrelated' });
  const result = await retrieveOutputs(manifest, '/work', { async metadata() { return { type: 'file', size: '0' }; }, async range() { throw new Error('empty'); } }, {
    async mkdir() {}, async open(path) { volume.writeFileSync('/out/' + path, ''); return { async write() { return 0; }, async truncate() {}, async close() {} }; },
  });
  expect(result.transfer.state).toBe('failed');
  expect(result.transfer.cursor.completed).toEqual(new Set(['known']));
  expect(volume.readFileSync('/out/known')).toEqual(Buffer.alloc(0));
  expect(volume.readFileSync('/out/prior', 'utf8')).toBe('unrelated');
});

it('does not promote a prior retained open with only zero-progress IO into the output tree', async () => {
  const manifest: EffectManifest = { jobId: 'j', outputs: ['prior'], effectBarrier: '2', outputComplete: true, effects: [
    { operationId: '1', sequence: '1', operation: 'open', state: 'applied', namespaceId: 'work', path: '/work/prior', identityId: 'prior' },
    { operationId: '2', sequence: '2', operation: 'write', state: 'applied', namespaceId: 'work', identityId: 'prior', acknowledgedBytes: '0' },
  ] };
  expect(inspectOutputTree(manifest, '/work').files).toEqual([]);
  expect((await retrieveOutputs(manifest, '/work', { async metadata() { throw new Error('unrelated input'); }, async range() { throw new Error('unrelated input'); } }, { async mkdir() {}, async open() { throw new Error('unrelated input'); } })).transfer.state).toBe('complete');
});

it('uses an observed open to place later handle-only writes after rename without reopening the former path', () => {
  const manifest: EffectManifest = { jobId: 'j', outputs: ['a'], effectBarrier: '3', outputComplete: true, effects: [
    { operationId: '1', sequence: '1', operation: 'open', state: 'applied', namespaceId: 'work', path: '/work/input', identityId: 'a' },
    { operationId: '2', sequence: '2', operation: 'rename', state: 'applied', namespaceId: 'work', path: '/work/input', destination: '/work/result' },
    { operationId: '3', sequence: '3', operation: 'write', state: 'applied', namespaceId: 'work', identityId: 'a', acknowledgedBytes: '1' },
  ] };
  expect(inspectOutputTree(manifest, '/work').files).toEqual([{ path: '/work/result', relativePath: 'result', identityId: 'a' }]);
});

it('inspects only settled job effects, surviving auxiliary paths and detached replacement identities', () => {
  const manifest: EffectManifest = { jobId: 'inspection', outputs: ['old', 'new', 'log'], effectBarrier: '7', outputComplete: false,
    processOutcome: { kind: 'exited', exitCode: 1 }, effects: [
      { operationId: '1', sequence: '1', operation: 'modified', state: 'applied', namespaceId: 'work', path: '/work/image', identityId: 'old' },
      { operationId: '2', sequence: '2', operation: 'created', state: 'applied', namespaceId: 'work', path: '/work/tmp', identityId: 'new' },
      { operationId: '3', sequence: '3', operation: 'rename', state: 'applied', namespaceId: 'work', path: '/work/tmp', destination: '/work/image' },
      { operationId: '4', sequence: '4', operation: 'created', state: 'applied', namespaceId: 'work', path: '/work/passlog-0.log', identityId: 'log' },
      { operationId: '5', sequence: '5', operation: 'unlink', state: 'applied', namespaceId: 'work', path: '/work/passlog-0.log' },
      { operationId: '6', sequence: '6', operation: 'mkdir', state: 'applied', namespaceId: 'work', path: '/work/hls/empty' },
      { operationId: '7', sequence: '7', operation: 'created', state: 'failed', namespaceId: 'work', path: '/work/later', identityId: 'log' },
    ] };
  const tree = inspectOutputTree(manifest, '/work');
  expect(tree.files).toEqual([{ path: '/work/image', relativePath: 'image', identityId: 'new' }]);
  expect(tree.directories).toEqual([{ path: '/work/hls', relativePath: 'hls' }, { path: '/work/hls/empty', relativePath: 'hls/empty' }]);
  expect(tree.retainedIdentities).toEqual(['old', 'new', 'log']);
  expect(tree.detachedIdentities).toEqual(['old', 'log']);
  manifest.effects.length = 0;
  expect(tree.manifest.effects).toHaveLength(7);
  expect(tree.manifest.processOutcome).toEqual({ kind: 'exited', exitCode: 1 });
});
import type { EffectManifest } from './wire.generated.js';

it('returns the inspected partial manifest when destination transfer fails after native exit', async () => {
  const manifest: EffectManifest = { jobId: 'j', outputs: ['a'], effectBarrier: '1', outputComplete: false,
    processOutcome: { kind: 'exited', exitCode: 1 }, effects: [
      { operationId: '1', sequence: '1', operation: 'created', state: 'applied', namespaceId: 'work', path: '/work/a', identityId: 'a' },
    ] };
  const result = await retrieveOutputs(manifest, '/work', {
    async metadata() { return { type: 'file', size: '0' }; }, async range() { throw new Error('empty'); },
  }, { async mkdir() {}, async open() { throw new Error('EROFS'); } });
  expect(result).toMatchObject({ manifest, processOutcome: manifest.processOutcome, transfer: { state: 'failed', path: 'a' } });
  manifest.effects.length = 0;
  expect(result).toMatchObject({ manifest: { effects: [expect.objectContaining({ identityId: 'a' })] } });
});

it('preserves the interrupted transfer cause when destination closure throws synchronously', async () => {
  const interrupted = new Error('range interrupted'); const closure = new Error('destination close failed');
  let cancelled = 0;
  const manifest: EffectManifest = { jobId: 'j', outputs: ['a'], effectBarrier: '1', outputComplete: true, processOutcome: { kind: 'exited', exitCode: 1 }, effects: [
    { operationId: '1', sequence: '1', operation: 'created', state: 'applied', namespaceId: 'work', path: '/work/a', identityId: 'a' },
  ] };
  const source = { async metadata() { return { type: 'file' as const, size: '1' }; }, async range() {
    return new ReadableStream<Uint8Array>({ pull(controller) { controller.error(interrupted); }, cancel() { cancelled++; } }, { highWaterMark: 0 });
  } };
  const result = await retrieveOutputs(manifest, '/work', source, { async mkdir() {}, async open() {
    return { async write(_position: bigint, bytes: Uint8Array) { return bytes.length; }, async truncate() {}, close(): Promise<void> { throw closure; } };
  } });
  expect(result.processOutcome).toEqual(manifest.processOutcome);
  expect(result.transfer.state).toBe('failed');
  if (result.transfer.state === 'failed') {
    expect(result.transfer.error).toBeInstanceOf(AggregateError);
    expect((result.transfer.error as AggregateError).errors).toContain(interrupted);
    expect((result.transfer.error as AggregateError).errors).toContain(closure);
    expect(result.transfer.cursor.completed.size).toBe(0);
  }
  expect(cancelled).toBe(0); // An errored stream is already closed.
});

it.each(['write', 'append'])('does not retrieve prior files from a zero-byte %s receipt', async operation => {
  const manifest: EffectManifest = { jobId: 'j', outputs: [], effectBarrier: '1', outputComplete: true, effects: [
    { operationId: '1', sequence: '1', operation, state: 'applied', namespaceId: 'work', path: '/work/prior', identityId: 'prior', acknowledgedBytes: '0' },
  ] };
  const source = { async metadata() { throw new Error('Unchanged input'); }, async range() { throw new Error('Unchanged input'); } };
  const destination = { async mkdir() {}, async open() { throw new Error('Unchanged input'); } };
  expect((await retrieveOutputs(manifest, '/work', source, destination)).transfer.state).toBe('complete');
});

it('reconstructs a retained hard link after unlinking its original name', async () => {
  const manifest: EffectManifest = { jobId: 'j', outputs: ['a'], effectBarrier: '3', outputComplete: true, effects: [
    { operationId: '1', sequence: '1', operation: 'created', state: 'applied', namespaceId: 'work', path: '/work/a', identityId: 'a' },
    { operationId: '2', sequence: '2', operation: 'link', state: 'applied', namespaceId: 'work', destination: '/work/b', identityId: 'a' },
    { operationId: '3', sequence: '3', operation: 'unlink', state: 'applied', namespaceId: 'work', path: '/work/a', identityId: 'a' },
  ] };
  const opened: string[] = [];
  expect(inspectOutputTree(manifest, '/work').detachedIdentities).toEqual([]);
  const source = { async metadata() { return { type: 'file' as const, size: '0' }; }, async range() { throw new Error('empty'); } };
  const destination = { async mkdir() {}, async open(path: string) { opened.push(path); return { async write() { return 0; }, async truncate() {}, async close() {} }; } };
  expect((await retrieveOutputs(manifest, '/work', source, destination)).transfer.state).toBe('complete');
  expect(opened).toEqual(['b']);
});

it('preserves both names when rename settles between hard links to the same identity', async () => {
  const manifest: EffectManifest = { jobId: 'j', outputs: ['a'], effectBarrier: '3', outputComplete: true, effects: [
    { operationId: '1', sequence: '1', operation: 'created', state: 'applied', namespaceId: 'work', path: '/work/a', identityId: 'a' },
    { operationId: '2', sequence: '2', operation: 'link', state: 'applied', namespaceId: 'work', destination: '/work/b', identityId: 'a' },
    { operationId: '3', sequence: '3', operation: 'rename', state: 'applied', namespaceId: 'work', path: '/work/a', destination: '/work/b', identityId: 'a' },
  ] };
  const opened: string[] = [];
  const source = { async metadata() { return { type: 'file' as const, size: '0' }; }, async range() { throw new Error('empty'); } };
  const destination = { async mkdir() {}, async open(path: string) { opened.push(path); return { async write() { return 0; }, async truncate() {}, async close() {} }; } };
  expect((await retrieveOutputs(manifest, '/work', source, destination)).transfer.state).toBe('complete');
  expect(opened).toEqual(['a', 'b']);
});

it.each(['append', 'metadata'])('reconstructs a retained file whose only mutation is %s', async operation => {
  const volume = Volume.fromJSON({ '/out/prior': 'unrelated' });
  const manifest: EffectManifest = { jobId: 'j', outputs: ['retained'], effectBarrier: '1', outputComplete: false, processOutcome: { kind: 'exited', exitCode: 1 }, effects: [
    { operationId: '1', sequence: '1', operation, state: 'applied', namespaceId: 'work', path: '/work/passlog', identityId: 'retained' },
  ] };
  const bytes = Uint8Array.of(0, 255);
  const source = { async metadata() { return { type: 'file' as const, size: '2', mode: 0o600 }; }, async range() { return new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes); c.close(); } }); } };
  const destination = { async mkdir() {}, async open(path: string, metadata: { mode?: number }) {
    const fd = volume.openSync('/out/' + path, 'w+', metadata.mode);
    return { async write(position: bigint, value: Uint8Array) { return volume.writeSync(fd, value, 0, value.length, Number(position)); }, async truncate(size: bigint) { volume.ftruncateSync(fd, Number(size)); }, async close() { volume.closeSync(fd); } };
  } };
  const result = await retrieveOutputs(manifest, '/work', source, destination);
  expect(result.transfer.state).toBe('complete');
  expect(result.processOutcome).toEqual(manifest.processOutcome);
  expect(volume.readFileSync('/out/passlog')).toEqual(Buffer.from(bytes));
  expect(volume.statSync('/out/passlog').mode & 0o777).toBe(0o600);
  expect(volume.readFileSync('/out/prior', 'utf8')).toBe('unrelated');
});

it('reconstructs parents of empty generated directories with non-recursive destinations', async () => {
  const volume = Volume.fromJSON({ '/out/prior': 'unrelated' });
  const manifest: EffectManifest = { jobId: 'j', outputs: [], effectBarrier: '1', outputComplete: true, effects: [
    { operationId: '1', sequence: '1', operation: 'mkdir', state: 'applied', namespaceId: 'work', path: '/work/generated/nested/empty' },
  ] };
  const source = { async metadata() { throw new Error('unexpected file'); }, async range() { throw new Error('unexpected range'); } };
  const destination = { async mkdir(path: string) { volume.mkdirSync('/out/' + path); }, async open() { throw new Error('unexpected open'); } };
  expect((await retrieveOutputs(manifest, '/work', source, destination)).transfer.state).toBe('complete');
  expect(volume.statSync('/out/generated/nested/empty').isDirectory()).toBe(true);
  expect(volume.readFileSync('/out/prior', 'utf8')).toBe('unrelated');
});

it('reconstructs a retained rename identity even when its source has no earlier output receipt', async () => {
  const volume = Volume.fromJSON({ '/out/prior': 'unrelated' });
  const manifest: EffectManifest = { jobId: 'j', outputs: ['retained'], effectBarrier: '1', outputComplete: true, effects: [
    { operationId: '1', sequence: '1', operation: 'rename', state: 'applied', namespaceId: 'work', path: '/work/input', destination: '/work/result', identityId: 'retained' },
  ] };
  const requested: string[] = [];
  const source = { async metadata(identity: string) { requested.push(identity); return { type: 'file' as const, size: '0' }; }, async range() { throw new Error('empty output'); } };
  const destination = { async mkdir(path: string) { volume.mkdirSync('/out/' + path); }, async open(path: string) { volume.writeFileSync('/out/' + path, ''); return { async write() { throw new Error('empty output'); }, async truncate() {}, async close() {} }; } };
  expect((await retrieveOutputs(manifest, '/work', source, destination)).transfer.state).toBe('complete');
  expect(requested).toEqual(['retained']);
  expect(volume.existsSync('/out/result')).toBe(true);
  expect(volume.existsSync('/out/input')).toBe(false);
});

it('owns binary output fragments before freshness hooks reuse a producer buffer', async () => {
  const manifest: EffectManifest = { jobId: 'j', effectBarrier: '1', outputComplete: true, outputs: ['a'], effects: [
    { operationId: '1', sequence: '1', operation: 'created', state: 'applied', namespaceId: 'work', path: '/work/a', identityId: 'a' },
  ] };
  const producer = Buffer.from([0, 255]); let borrowed = false; let emitted = false;
  const freshness = { identity: {}, version: '1', assertCurrent: async () => { if (borrowed) producer.fill(9); } };
  const source = {
    freshness: vi.fn().mockResolvedValue(freshness), metadata: async () => ({ type: 'file' as const, size: '2' }),
    range: async () => new ReadableStream<Uint8Array>({ pull(controller) {
      if (emitted) controller.close();
      else { emitted = true; borrowed = true; controller.enqueue(producer); }
    } }, { highWaterMark: 0 }),
  };
  const visible = new Uint8Array(2);
  const destination = { mkdir: async () => {}, open: async () => ({
    write: async (position: bigint, bytes: Uint8Array) => { visible.set(bytes, Number(position)); return bytes.length; },
    truncate: async () => {}, close: async () => {},
  }) };
  expect((await retrieveOutputs(manifest, '/work', source, destination)).transfer.state).toBe('complete');
  expect(visible).toEqual(Uint8Array.of(0, 255));
});
it.each(['unqualified', 'mutation', 'authority', 'guard-replacement', 'mid-resume'] as const)('refuses output suffix resume after %s without touching acknowledged destination bytes', async change => {
  const manifest: EffectManifest = { jobId: 'j', effectBarrier: '1', outputComplete: true, outputs: ['a'], effects: [
    { operationId: '1', sequence: '1', operation: 'created', state: 'applied', namespaceId: 'work', path: '/work/a', identityId: 'a' },
  ] };
  let bytes = Uint8Array.of(1, 2); let identity = {}; let revision = '1'; let interrupted = true;
  const originalIdentity = identity;
  const originalFreshness = { identity, version: revision, assertCurrent: async () => {
    if (identity !== originalIdentity || revision !== '1') throw new Error('stale retained source');
  } };
  const source = {
    metadata: async () => ({ type: 'file' as const, size: '2', mtimeNs: '0' }),
    range: async (_id: string, start: bigint) => new ReadableStream<Uint8Array>({ start(controller) {
      if (change === 'mid-resume' && !interrupted) { bytes = Uint8Array.of(3, 4); revision = '2'; }
      controller.enqueue(bytes.slice(Number(start))); controller.close();
    } }),
    ...(change === 'unqualified' ? {} : { freshness: async () => {
      if (change === 'guard-replacement' || change === 'mid-resume') return originalFreshness;
      const object = identity; const version = revision;
      return { identity: object, version, assertCurrent: async () => { if (identity !== object || revision !== version) throw new Error('stale retained source'); } };
    } }),
  };
  const visible = new Uint8Array(2);
  const open = vi.fn(async () => ({
    write: async (position: bigint, data: Uint8Array) => {
      if (interrupted && position > 0n) throw new Error('EDQUOT');
      const count = interrupted ? 1 : data.length; visible.set(data.slice(0, count), Number(position)); return count;
    }, truncate: async () => {}, close: async () => {},
  }));
  const cursor = { completed: new Set<string>(), offsets: new Map<string, bigint>() };
  const destination = { mkdir: async () => {}, open };
  const first = await retrieveOutputs(manifest, '/work', source, destination, cursor);
  expect(first.transfer.state).toBe('failed'); expect(cursor.offsets.get('a')).toBe(1n);
  interrupted = false;
  if (change === 'mutation') { bytes = Uint8Array.of(3, 4); revision = '2'; }
  if (change === 'authority') { identity = {}; bytes = Uint8Array.of(3, 4); }
  if (change === 'guard-replacement') {
    bytes = Uint8Array.of(3, 4); revision = '2'; originalFreshness.assertCurrent = async () => {};
  }
  if (change === 'mid-resume') originalFreshness.assertCurrent = async () => {};
  open.mockClear();
  const resumed = await retrieveOutputs(manifest, '/work', source, destination, cursor);
  expect(resumed.transfer.state).toBe('failed');
  if (change === 'mid-resume') expect(open).toHaveBeenCalledOnce();
  else expect(open).not.toHaveBeenCalled();
  expect(visible).toEqual(Uint8Array.of(1, 0));
});
it('reconstructs only job effects, resumes partial destination writes and preserves native failure', async () => {
  const volume = Volume.fromJSON({ '/out/prior': 'unrelated' });
  const manifest: EffectManifest = { jobId: 'j', effectBarrier: '6', outputComplete: true, processOutcome: { kind: 'exited', exitCode: 1 }, outputs: ['a', 'b'], effects: [
    { operationId: '1', sequence: '1', operation: 'mkdir', state: 'applied', namespaceId: 'work', path: '/work/hls' },
    { operationId: '2', sequence: '2', operation: 'created', state: 'applied', namespaceId: 'work', path: '/work/hls/a', identityId: 'a' },
    { operationId: '3', sequence: '3', operation: 'rename', state: 'applied', namespaceId: 'work', path: '/work/hls/a', destination: '/work/hls/b' },
    { operationId: '4', sequence: '4', operation: 'created', state: 'applied', namespaceId: 'work', path: '/work/passlog', identityId: 'b' },
    { operationId: '5', sequence: '5', operation: 'unlink', state: 'applied', namespaceId: 'work', path: '/work/passlog' },
    { operationId: '6', sequence: '6', operation: 'created', state: 'failed', namespaceId: 'work', path: '/work/later', identityId: 'b' },
  ] };
  const bytes = Uint8Array.of(0, 255, 2); let quota = true; const ranges: bigint[] = [];
  const freshness = { identity: {}, version: '1', assertCurrent: vi.fn(async () => {}) };
  const source = { freshness: vi.fn().mockResolvedValue(freshness), metadata: async () => ({ type: 'file' as const, size: '3' }), async range(_id: string, start: bigint) { ranges.push(start); return new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes.slice(Number(start))); c.close(); } }); } };
  let mkdirCount = 0;
  const destination = {
    async mkdir(path: string) { mkdirCount++; volume.mkdirSync('/out/' + path, { recursive: true }); },
    async open(path: string) {
      const fd = volume.openSync('/out/' + path, volume.existsSync('/out/' + path) ? 'r+' : 'w+');
      return { async write(position: bigint, value: Uint8Array) { if (quota && position > 0n) throw new Error('EDQUOT'); const count = quota ? 1 : value.length; volume.writeSync(fd, value, 0, count, Number(position)); return count; }, async truncate(size: bigint) { volume.ftruncateSync(fd, Number(size)); }, async close() { volume.closeSync(fd); } };
    },
  };
  const cursor = { completed: new Set<string>(), offsets: new Map<string, bigint>() };
  const first = await retrieveOutputs(manifest, '/work', source, destination, cursor);
  expect(first.transfer.state).toBe('failed'); expect(cursor.offsets.get('hls/b')).toBe(1n);
  expect(first.processOutcome).toEqual({ kind: 'exited', exitCode: 1 });
  quota = false;
  expect((await retrieveOutputs(manifest, '/work', source, destination, cursor)).transfer.state).toBe('complete');
  expect(ranges).toEqual([0n, 1n]); expect(mkdirCount).toBe(1);
  expect(volume.readFileSync('/out/hls/b')).toEqual(Buffer.from(bytes));
  expect(volume.readFileSync('/out/prior', 'utf8')).toBe('unrelated');
  expect(volume.existsSync('/out/passlog')).toBe(false);
});

it('keeps directories and empty outputs while excluding a retained identity written after unlink', async () => {
  const volume = Volume.fromJSON({ '/out/prior': 'old' });
  const manifest: EffectManifest = { jobId: 'j', effectBarrier: '5', outputComplete: true, outputs: ['a', 'empty'], effects: [
    { operationId: '1', sequence: '1', operation: 'created', state: 'applied', namespaceId: 'work', path: '/work/a', identityId: 'a' },
    { operationId: '2', sequence: '2', operation: 'unlink', state: 'applied', namespaceId: 'work', path: '/work/a', identityId: 'a' },
    { operationId: '3', sequence: '3', operation: 'write', state: 'applied', namespaceId: 'work', path: '/work/a', identityId: 'a', acknowledgedBytes: '1' },
    { operationId: '4', sequence: '4', operation: 'mkdir', state: 'applied', namespaceId: 'work', path: '/work/generated' },
    { operationId: '5', sequence: '5', operation: 'created', state: 'applied', namespaceId: 'work', path: '/work/existing/empty', identityId: 'empty' },
  ] };
  const metadata = async () => ({ type: 'file' as const, size: '0' });
  const source = { metadata, async range() { throw new Error('empty files need no range'); } };
  const destination = { async mkdir(path: string) { volume.mkdirSync('/out/' + path, { recursive: true }); }, async open(path: string) { volume.writeFileSync('/out/' + path, ''); return { async write() { return 0; }, async truncate() {}, async close() {} }; } };
  const result = await retrieveOutputs(manifest, '/work', source, destination);
  expect(result.transfer.state).toBe('complete');
  expect(volume.existsSync('/out/a')).toBe(false);
  expect(volume.statSync('/out/generated').isDirectory()).toBe(true);
  expect(volume.statSync('/out/existing/empty').size).toBe(0);
});

it('resumes a truncated range from the last settled byte and reports read-only destinations separately', async () => {
  const volume = Volume.fromJSON({ '/out/a': '' });
  const manifest: EffectManifest = { jobId: 'j', effectBarrier: '1', outputComplete: false, processOutcome: { kind: 'signaled', signal: 'SIGTERM', signalNumber: 15 }, outputs: ['a'], effects: [{ operationId: '1', sequence: '1', operation: 'created', state: 'applied', namespaceId: 'work', path: '/work/a', identityId: 'a' }] };
  let interrupted = true; const starts: bigint[] = [];
  const freshness = { identity: {}, version: '1', assertCurrent: vi.fn(async () => {}) };
  const source = { freshness: vi.fn().mockResolvedValue(freshness), metadata: async () => ({ type: 'file' as const, size: '3' }), async range(_id: string, start: bigint) { starts.push(start); let pulled = false; return new ReadableStream<Uint8Array>({ pull(c) { if (interrupted && pulled) c.error(new Error('transport interrupted')); else { pulled = true; c.enqueue(interrupted ? Uint8Array.of(255) : Uint8Array.of(0, 2)); if (!interrupted) c.close(); } } }, { highWaterMark: 0 }); } };
  const destination = { async mkdir() {}, async open() { const fd = volume.openSync('/out/a', 'r+'); return { async write(position: bigint, value: Uint8Array) { volume.writeSync(fd, value, 0, value.length, Number(position)); return value.length; }, async truncate(size: bigint) { volume.ftruncateSync(fd, Number(size)); }, async close() { volume.closeSync(fd); } }; } };
  const cursor = { completed: new Set<string>(), offsets: new Map<string, bigint>() };
  expect((await retrieveOutputs(manifest, '/work', source, destination, cursor)).transfer.state).toBe('failed');
  expect(cursor.offsets.get('a')).toBe(1n);
  interrupted = false;
  expect((await retrieveOutputs(manifest, '/work', source, destination, cursor)).transfer.state).toBe('complete');
  expect(starts).toEqual([0n, 1n]); expect(volume.readFileSync('/out/a')).toEqual(Buffer.from([255, 0, 2]));
  const readOnly = await retrieveOutputs(manifest, '/work', source, { ...destination, async open() { throw new Error('EROFS'); } });
  expect(readOnly.transfer.state).toBe('failed'); expect(readOnly.processOutcome).toEqual(manifest.processOutcome);
});

it('does not reconstruct the displaced identity after an in-place replacement', async () => {
  const manifest: EffectManifest = { jobId: 'j', outputs: ['old', 'new'], effectBarrier: '4', outputComplete: true, effects: [
    { operationId: '1', sequence: '1', operation: 'modified', state: 'applied', namespaceId: 'work', path: '/work/a', identityId: 'old' },
    { operationId: '2', sequence: '2', operation: 'created', state: 'applied', namespaceId: 'work', path: '/work/tmp', identityId: 'new' },
    { operationId: '3', sequence: '3', operation: 'rename', state: 'applied', namespaceId: 'work', path: '/work/tmp', destination: '/work/a', identityId: 'new' },
    { operationId: '4', sequence: '4', operation: 'write', state: 'applied', namespaceId: 'work', path: '/work/a', identityId: 'old' },
  ] };
  const requested: string[] = [];
  const source = { async metadata(identity: string) { requested.push(identity); return { type: 'file' as const, size: '0' }; }, async range() { throw new Error('unexpected'); } };
  const destination = { async mkdir() {}, async open() { return { async write() { return 0; }, async truncate() {}, async close() {} }; } };
  expect((await retrieveOutputs(manifest, '/work', source, destination)).transfer.state).toBe('complete');
  expect(requested).toEqual(['new']);
});

it('reports a missing output retain rather than silently omitting a created file', async () => {
  const manifest: EffectManifest = { jobId: 'j', outputs: [], effectBarrier: '1', outputComplete: true, processOutcome: { kind: 'exited', exitCode: 0 }, effects: [{ operationId: '1', sequence: '1', operation: 'created', state: 'applied', namespaceId: 'work', path: '/work/a', identityId: 'missing' }] };
  const source = { async metadata() { throw new Error('retain unavailable'); }, async range() { throw new Error('unexpected'); } };
  const destination = { async mkdir() {}, async open() { throw new Error('unexpected'); } };
  const result = await retrieveOutputs(manifest, '/work', source, destination);
  expect(result.transfer.state).toBe('failed'); expect(result.processOutcome).toEqual({ kind: 'exited', exitCode: 0 });
});

it('keeps retained writes at the renamed path after the old pathname is reused', async () => {
  const volume = Volume.fromJSON({ '/out/prior': 'unrelated' });
  const manifest: EffectManifest = { jobId: 'j', outputs: ['retained', 'replacement'], effectBarrier: '4', outputComplete: true, effects: [
    { operationId: '1', sequence: '1', operation: 'created', state: 'applied', namespaceId: 'work', path: '/work/a', identityId: 'retained' },
    { operationId: '2', sequence: '2', operation: 'rename', state: 'applied', namespaceId: 'work', path: '/work/a', destination: '/work/b', identityId: 'retained' },
    { operationId: '3', sequence: '3', operation: 'created', state: 'applied', namespaceId: 'work', path: '/work/a', identityId: 'replacement' },
    { operationId: '4', sequence: '4', operation: 'write', state: 'applied', namespaceId: 'work', path: '/work/a', identityId: 'retained', acknowledgedBytes: '1' },
  ] };
  const source = { async metadata() { return { type: 'file' as const, size: '1' }; }, async range(identity: string) { return new ReadableStream<Uint8Array>({ start(c) { c.enqueue(Uint8Array.of(identity === 'retained' ? 1 : 2)); c.close(); } }); } };
  const destination = { async mkdir() {}, async open(path: string) { const fd = volume.openSync('/out/' + path, 'w+'); return { async write(position: bigint, bytes: Uint8Array) { return volume.writeSync(fd, bytes, 0, bytes.length, Number(position)); }, async truncate(size: bigint) { volume.ftruncateSync(fd, Number(size)); }, async close() { volume.closeSync(fd); } }; } };
  expect((await retrieveOutputs(manifest, '/work', source, destination)).transfer.state).toBe('complete');
  expect(volume.readFileSync('/out/a')).toEqual(Buffer.from([2]));
  expect(volume.readFileSync('/out/b')).toEqual(Buffer.from([1]));
});

it.each(['write', 'append', 'metadata'])('excludes %s through an identity displaced by pathname recreation', async operation => {
  const manifest: EffectManifest = { jobId: 'j', outputs: ['old', 'new'], effectBarrier: '3', outputComplete: true, effects: [
    { operationId: '1', sequence: '1', operation: 'modified', state: 'applied', namespaceId: 'work', path: '/work/a', identityId: 'old' },
    { operationId: '2', sequence: '2', operation: 'created', state: 'applied', namespaceId: 'work', path: '/work/a', identityId: 'new' },
    { operationId: '3', sequence: '3', operation, state: 'applied', namespaceId: 'work', path: '/work/a', identityId: 'old' },
  ] };
  const requested: string[] = [];
  const source = { async metadata(identity: string) { requested.push(identity); return { type: 'file' as const, size: '0' }; }, async range() { throw new Error('unexpected'); } };
  const destination = { async mkdir() {}, async open() { return { async write() { return 0; }, async truncate() {}, async close() {} }; } };
  expect((await retrieveOutputs(manifest, '/work', source, destination)).transfer.state).toBe('complete');
  expect(requested).toEqual(['new']);
});

it('retrieves many surviving auxiliary files from the manifest without listing prior files', async () => {
  const volume = Volume.fromJSON({ '/out/prior': 'unrelated' });
  const contents = new Map([['passlog', Uint8Array.of(1, 0)], ['segment', Uint8Array.of(255)], ['image', Uint8Array.of(2)]]);
  const manifest: EffectManifest = { jobId: 'j', outputs: [...contents.keys()], effectBarrier: '3', outputComplete: true, processOutcome: { kind: 'exited', exitCode: 1 }, effects: [...contents.keys()].map((identityId, index) => ({ operationId: String(index), sequence: String(index + 1), operation: 'created', state: 'applied' as const, namespaceId: 'work', path: '/work/' + identityId, identityId })) };
  const source = { async metadata(id: string) { return { type: 'file' as const, size: String(contents.get(id)!.length) }; }, async range(id: string) { return new ReadableStream<Uint8Array>({ start(c) { c.enqueue(contents.get(id)!); c.close(); } }); } };
  const destination = { async mkdir() {}, async open(path: string) { const fd = volume.openSync('/out/' + path, 'w+'); return { async write(position: bigint, value: Uint8Array) { return volume.writeSync(fd, value, 0, value.length, Number(position)); }, async truncate(size: bigint) { volume.ftruncateSync(fd, Number(size)); }, async close() { volume.closeSync(fd); } }; } };
  expect((await retrieveOutputs(manifest, '/work', source, destination)).transfer.state).toBe('complete');
  for (const [path, bytes] of contents) expect(volume.readFileSync('/out/' + path)).toEqual(Buffer.from(bytes));
  expect(volume.readFileSync('/out/prior', 'utf8')).toBe('unrelated');
});

it('settles an owned write before consumer closure and preserves earlier completed files on resume', async () => {
  const volume = Volume.fromJSON({ '/out/prior': 'unrelated' });
  const abort = new AbortController(); const closure = new Error('consumer closed');
  const contents = new Map([['first', Uint8Array.of(255)], ['second', Uint8Array.of(1, 0)]]);
  const manifest: EffectManifest = { jobId: 'j', outputs: [...contents.keys()], effectBarrier: '2', outputComplete: true, processOutcome: { kind: 'exited', exitCode: 1 }, effects: [...contents.keys()].map((identityId, index) => ({ operationId: String(index), sequence: String(index + 1), operation: 'created', state: 'applied' as const, namespaceId: 'work', path: '/work/' + identityId, identityId })) };
  const ranges: [string, bigint][] = []; const cancelled: string[] = []; const closed: string[] = []; let stop = true;
  const freshness = { identity: {}, version: '1', assertCurrent: vi.fn(async () => {}) };
  const source = {
    freshness: vi.fn().mockResolvedValue(freshness),
    async metadata(identity: string) { return { type: 'file' as const, size: String(contents.get(identity)!.length) }; },
    async range(identity: string, start: bigint) {
      ranges.push([identity, start]); let emitted = false;
      return new ReadableStream<Uint8Array>({ pull(c) { if (emitted) c.close(); else { emitted = true; c.enqueue(contents.get(identity)!.slice(Number(start))); } }, cancel() { cancelled.push(identity); } }, { highWaterMark: 0 });
    },
  };
  const destination = { async mkdir() {}, async open(path: string) {
    const fd = volume.openSync('/out/' + path, volume.existsSync('/out/' + path) ? 'r+' : 'w+');
    return { async write(position: bigint, bytes: Uint8Array) {
      const count = stop && path === 'second' ? 1 : bytes.length;
      volume.writeSync(fd, bytes, 0, count, Number(position));
      if (stop && path === 'second') abort.abort(closure);
      return count;
    }, async truncate(size: bigint) { volume.ftruncateSync(fd, Number(size)); }, async close() { volume.closeSync(fd); closed.push(path); } };
  } };
  const cursor = { completed: new Set<string>(), offsets: new Map<string, bigint>() };
  const first = await retrieveOutputs(manifest, '/work', source, destination, cursor, abort.signal);
  expect(first.transfer).toMatchObject({ state: 'failed', path: 'second', error: closure });
  expect(first.processOutcome).toEqual({ kind: 'exited', exitCode: 1 });
  expect(cursor.completed).toEqual(new Set(['first'])); expect(cursor.offsets.get('second')).toBe(1n);
  expect(cancelled).toEqual(['second']); expect(closed).toEqual(['first', 'second']);
  expect(volume.readFileSync('/out/first')).toEqual(Buffer.from([255]));
  expect(volume.readFileSync('/out/second')).toEqual(Buffer.from([1]));
  stop = false;
  expect((await retrieveOutputs(manifest, '/work', source, destination, cursor)).transfer.state).toBe('complete');
  expect(ranges).toEqual([['first', 0n], ['second', 0n], ['second', 1n]]);
  expect(volume.readFileSync('/out/second')).toEqual(Buffer.from([1, 0]));
});

it('cancels a pending source read on consumer closure without truncating or losing native exit', async () => {
  const abort = new AbortController(); const reason = new Error('consumer closed');
  let reading!: () => void; const pending = new Promise<void>(resolve => { reading = resolve; });
  let cancelled = 0; let truncated = 0; let closed = 0;
  const manifest: EffectManifest = { jobId: 'j', outputs: ['a'], effectBarrier: '1', outputComplete: true, processOutcome: { kind: 'exited', exitCode: 1 }, effects: [
    { operationId: '1', sequence: '1', operation: 'created', state: 'applied', namespaceId: 'work', path: '/work/a', identityId: 'a' },
  ] };
  const source = { async metadata() { return { type: 'file' as const, size: '1' }; }, async range() {
    return new ReadableStream<Uint8Array>({ pull() { reading(); }, cancel() { cancelled++; } }, { highWaterMark: 0 });
  } };
  const destination = { async mkdir() {}, async open() { return { async write(bytes: bigint, value: Uint8Array) { return value.length; }, async truncate() { truncated++; }, async close() { closed++; } }; } };
  const transfer = retrieveOutputs(manifest, '/work', source, destination, undefined, abort.signal);
  await pending; abort.abort(reason);
  const result = await transfer;
  expect(result.transfer).toMatchObject({ state: 'failed', error: reason });
  expect(result.processOutcome).toEqual(manifest.processOutcome);
  expect(cancelled).toBe(1); expect(closed).toBe(1); expect(truncated).toBe(0);
});

it.each(['job', 'revision', 'root'] as const)('rejects resume against a different %s before touching the destination', async change => {
  const volume = Volume.fromJSON({ '/out/a': '' });
  const manifest: EffectManifest = { jobId: 'first-job', outputs: ['a'], effectBarrier: '1', outputComplete: true, effects: [
    { operationId: '1', sequence: '1', operation: 'created', state: 'applied', namespaceId: 'work', path: '/work/a', identityId: 'a' },
  ] };
  const source = { async metadata() { return { type: 'file' as const, size: '0' }; }, async range() { throw new Error('empty output'); } };
  let opens = 0;
  const destination = { async mkdir() {}, async open() { opens++; return { async write() { throw new Error('empty output'); }, async truncate() { volume.truncateSync('/out/a', 0); }, async close() {} }; } };
  const cursor = { completed: new Set<string>(), offsets: new Map<string, bigint>() };
  expect((await retrieveOutputs(manifest, '/work', source, destination, cursor)).transfer.state).toBe('complete');
  const changed = { ...manifest, ...(change === 'job' ? { jobId: 'second-job' } : change === 'revision' ? { effectBarrier: '2' } : {}), processOutcome: { kind: 'exited' as const, exitCode: 1 } };
  const result = await retrieveOutputs(changed, change === 'root' ? '/other' : '/work', source, destination, cursor);
  expect(result.transfer).toMatchObject({ state: 'failed', error: expect.any(Error) });
  expect(result.processOutcome).toEqual(changed.processOutcome);
  expect(opens).toBe(1);
});

it('reports consumer cancellation after the final directory settles without undoing it', async () => {
  const volume = Volume.fromJSON({ '/out/prior': 'unrelated' });
  const abort = new AbortController(); const reason = new Error('consumer closed');
  const manifest: EffectManifest = { jobId: 'j', outputs: [], effectBarrier: '1', outputComplete: true,
    processOutcome: { kind: 'exited', exitCode: 1 }, effects: [
      { operationId: '1', sequence: '1', operation: 'mkdir', state: 'applied', namespaceId: 'work', path: '/work/generated' },
    ] };
  const result = await retrieveOutputs(manifest, '/work', {
    async metadata() { throw new Error('No files'); }, async range() { throw new Error('No files'); },
  }, { async mkdir(path) { volume.mkdirSync('/out/' + path); abort.abort(reason); },
    async open() { throw new Error('No files'); } }, undefined, abort.signal);
  expect(result).toMatchObject({ processOutcome: manifest.processOutcome, transfer: { state: 'failed', error: reason } });
  expect(result.transfer.cursor.directories).toEqual(new Set(['generated']));
  expect(volume.statSync('/out/generated').isDirectory()).toBe(true);
  expect(volume.readFileSync('/out/prior', 'utf8')).toBe('unrelated');
});

it.each(['future-native-effect', 'native-replacement'] as const)('reports an output retained by %s without a located mutation instead of claiming successful empty retrieval', async operation => {
  const manifest: EffectManifest = { jobId: 'j', outputs: ['retained'], effectBarrier: '1', outputComplete: true,
    processOutcome: { kind: 'exited', exitCode: 1 }, effects: [
      { operationId: '1', sequence: '1', operation, state: 'applied', namespaceId: 'work', identityId: 'retained' },
    ] };
  expect(inspectOutputTree(manifest, '/work').unlocatedIdentities).toEqual(['retained']);
  const open = vi.fn(async () => { throw new Error('No verified output path'); });
  const result = await retrieveOutputs(manifest, '/work', {
    async metadata() { throw new Error('No path enumeration'); },
    async range() { throw new Error('No path enumeration'); },
  }, { async mkdir() {}, open });
  expect(result).toMatchObject({ manifest, processOutcome: manifest.processOutcome,
    transfer: { state: 'failed', error: expect.any(Error) } });
  expect(open).not.toHaveBeenCalled();
});
