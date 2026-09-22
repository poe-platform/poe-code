import { describe, expect, it } from 'vitest';
import { validateDependencyManifest, type DependencyManifest } from './protocol.js';

const bytes = (value: string) => Array.from(new TextEncoder().encode(value));
function manifest(): DependencyManifest {
  return {
    version: 1, sessionId: 'session', epoch: 'epoch', namespaceId: 'namespace',
    revision: 'manifest-revision', logicalRoot: bytes('/work'), cwd: bytes('/work'),
    sourceAuthorityId: 'selected', entries: [{
      kind: 'file', path: [bytes('a')], source: {
        authorityId: 'selected', path: bytes('/work/a'), freshness: 'revalidate-on-open',
        observedVersion: null, retainedIdentity: null, callbackGrantId: 'open-a',
      },
      blob: { blobId: 'empty-blob', size: '0', sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' },
    }],
  };
}

describe.each([
  { name: 'direct SDK', transport: (value: DependencyManifest) => value },
  { name: 'REST JSON', transport: (value: DependencyManifest): unknown => JSON.parse(JSON.stringify(value)) },
])('$name manifest contracts without tool parsers', ({ transport }) => {
  function check(value: DependencyManifest) {
    const input = transport(value);
    const before = JSON.stringify(input);
    validateDependencyManifest(input, { maxEntries: 100, maxPathBytes: 4096 });
    expect(JSON.stringify(input)).toBe(before);
  }

  it.each(['immutable', 'revalidate-on-open', 'live'] as const)('retains %s observations and required host bindings', freshness => {
    const input = manifest();
    const source = input.entries[0].source;
    source.freshness = freshness;
    source.observedVersion = 'backend-version';
    source.retainedIdentity = 'retained-object';
    if (freshness === 'immutable') source.snapshotId = 'independent-snapshot';
    check(input);
    if (freshness === 'immutable') delete source.snapshotId;
    else delete source.callbackGrantId;
    expect(() => check(input)).toThrow(TypeError);
  });

  it.each(['../clips/part one.mp4', '/work/clips/part one.mp4', './missing', '../../outside'])('preserves literal symlink target %s for host authorization', target => {
    const input = manifest();
    input.entries = [{ kind: 'symlink', path: [bytes('link')], source: input.entries[0].source, target: bytes(target) }];
    check(input);
    expect(input.entries[0]).toHaveProperty('target', bytes(target));
  });

  it('does not infer hardlink identity from equal blob references', () => {
    const input = manifest();
    const file = input.entries[0];
    if (file.kind !== 'file') throw new Error('Expected file fixture');
    file.identityRef = 'group';
    input.entries.push({ kind: 'hardlink', path: [bytes('b')], source: file.source, identityRef: 'group' });
    check(input);
    input.entries[1] = { ...file, path: [bytes('b')] };
    expect(() => check(input)).toThrow(TypeError);
    delete file.identityRef;
    check(input); // Equal bytes remain independent files unless identity is explicitly bound.
  });

  it.each(['mode', 'atimeNs', 'mtimeNs'] as const)('rejects conflicting %s requests across hardlink aliases', field => {
    const input = manifest();
    const file = input.entries[0];
    if (file.kind !== 'file') throw new Error('Expected file fixture');
    file.identityRef = 'group';
    const first = field === 'mode' ? 0o600 : '1';
    const second = field === 'mode' ? 0o640 : '2';
    file.metadata = { [field]: first };
    input.entries.push({ kind: 'hardlink', path: [bytes('b')], source: file.source, identityRef: 'group', metadata: { [field]: second } });
    expect(() => check(input)).toThrow(TypeError);
    input.entries[1].metadata = { [field]: first };
    check(input);
    delete file.metadata;
    check(input); // Omitted metadata is unknown, rather than a conflicting default.
    input.entries.push({ kind: 'hardlink', path: [bytes('c')], source: file.source, identityRef: 'group', metadata: { [field]: second } });
    expect(() => check(input)).toThrow(TypeError);
  });

  it('requires observed directories for output-intent parents and rejects mutation metadata', () => {
    const input = manifest();
    const source = input.entries[0].source;
    input.entries = [{ kind: 'output-intent', path: [bytes('out'), bytes('result')], source, operations: ['create', 'truncate'] }];
    expect(() => check(input)).toThrow(TypeError);
    input.entries.unshift({ kind: 'directory', path: [bytes('out')], source });
    check(input);
    input.entries[1].metadata = { mode: 0o600 };
    expect(() => check(input)).toThrow(TypeError);
    delete input.entries[1].metadata;
    const intent = input.entries[1];
    if (intent.kind !== 'output-intent') throw new Error('Expected intent fixture');
    intent.operations = ['create', 'create'];
    expect(() => check(input)).toThrow(TypeError);
  });

  it.each(['destination', 'serverRoot', 'readAll', 'originalArgv'])('rejects caller field %s rather than expanding authority', field => {
    const input = manifest();
    Object.assign(input, { [field]: '/tmp/arbitrary' });
    expect(() => check(input)).toThrow(TypeError);
  });

  it('rejects missing output-intent operation slots rather than registering an undefined intent', () => {
    const input = manifest();
    const operations: ('create' | 'truncate')[] = ['create', 'truncate'];
    delete operations[1];
    input.entries = [{ kind: 'output-intent', path: [bytes('result')], source: input.entries[0].source, operations }];
    expect(() => check(input)).toThrow(TypeError);
  });
});
