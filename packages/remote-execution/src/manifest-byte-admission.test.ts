import { describe, expect, it } from 'vitest';
import { validateDependencyManifest, type DependencyManifest } from './protocol.js';

function manifest(): DependencyManifest {
  return {
    version: 1, sessionId: 'session', epoch: 'epoch', namespaceId: 'namespace',
    revision: 'revision', logicalRoot: [47, 119], cwd: [47, 119], sourceAuthorityId: 'selected',
    entries: [{ kind: 'symlink', path: [[97]], target: [98], source: {
      authorityId: 'selected', path: [47, 97], freshness: 'live',
      observedVersion: null, retainedIdentity: null, callbackGrantId: 'native-open',
    } }],
  };
}

describe('REST and direct SDK byte-path admission', () => {
  it.each(['logicalRoot', 'cwd', 'source', 'component', 'target'])('rejects a sparse %s byte array in both transports', field => {
    const input = manifest();
    const sparse = [47, 97];
    delete sparse[1];
    if (field === 'logicalRoot' || field === 'cwd') input[field] = sparse;
    if (field === 'source') input.entries[0].source.path = sparse;
    if (field === 'component') { sparse[0] = 97; input.entries[0].path = [sparse]; }
    if (field === 'target' && input.entries[0].kind === 'symlink') input.entries[0].target = sparse;
    const limits = { maxEntries: 10, maxPathBytes: 100 };
    expect(() => validateDependencyManifest(JSON.parse(JSON.stringify(input)), limits)).toThrow(TypeError);
    expect(() => validateDependencyManifest(input, limits)).toThrow(TypeError);
  });

  it('preserves invalid UTF-8 and orders names by unsigned bytes rather than display text', () => {
    const input = manifest();
    const link = input.entries[0];
    input.entries = [
      { ...link, path: [[97]] },
      { ...link, path: [[128]] },
      { ...link, path: [[255]] },
    ];
    const before = JSON.stringify(input);
    validateDependencyManifest(input, { maxEntries: 10, maxPathBytes: 100 });
    expect(JSON.stringify(input)).toBe(before);
    input.entries.reverse();
    expect(() => validateDependencyManifest(input, { maxEntries: 10, maxPathBytes: 100 })).toThrow(TypeError);
  });
});
