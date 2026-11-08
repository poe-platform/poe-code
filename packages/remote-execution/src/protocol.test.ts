import { describe, expect, it } from 'vitest';
import { validateDependencyManifest, type DependencyManifest } from './protocol.js';
const b = (s: string) => Array.from(new TextEncoder().encode(s));
const source = { authorityId: 'selected-files', path: b('/work/a'), freshness: 'revalidate-on-open' as const, observedVersion: 'v1', retainedIdentity: null, callbackGrantId: 'read-a' };
const fixture = (): DependencyManifest => ({
  version: 1, sessionId: 's', epoch: 'e', namespaceId: 'n', revision: 'm1',
  logicalRoot: b('/work'), cwd: b('/work'), sourceAuthorityId: 'selected-files',
  entries: [{ kind: 'file', path: [b('a')], source: { ...source }, blob: { blobId: 'blob', size: '3', sha256: 'a'.repeat(64) } }],
});
const check = (m: DependencyManifest) => validateDependencyManifest(m, { maxEntries: 100, maxPathBytes: 4096 });
describe('generic dependency manifest protocol (no tool parser or CLI)', () => {
  it('accepts the same JSON document submitted by REST or SDK', () => {
    const m = fixture();
    expect(() => check(JSON.parse(JSON.stringify(m)))).not.toThrow();
    expect(() => check(m)).not.toThrow();
  });
  it('preserves raw byte names and empty directories', () => {
    const m = fixture();
    m.entries = [{ kind: 'directory', path: [[255]], source: { ...source, path: [47, 255] } }];
    expect(() => check(m)).not.toThrow();
    expect(m.entries[0].path).toEqual([[255]]);
  });
  it.each([[0], [47], [46], [46, 46], [], [256], [1.5]].map(component => [component]))('rejects invalid component %j', component => {
    const m = fixture(); m.entries[0].path = [component];
    expect(() => check(m)).toThrow();
  });
  it('rejects duplicates, missing parents and children beneath a symlink', () => {
    const m = fixture(); m.entries.push(m.entries[0]); expect(() => check(m)).toThrow();
    m.entries = [{ ...fixture().entries[0], path: [b('missing'), b('a')] }]; expect(() => check(m)).toThrow();
    m.entries.unshift({ kind: 'symlink', path: [b('missing')], source, target: b('../elsewhere') });
    expect(() => check(m)).toThrow();
  });
  it('requires mutable callbacks and rejects fake immutable observations', () => {
    const m = fixture(); delete m.entries[0].source.callbackGrantId; expect(() => check(m)).toThrow();
    m.entries[0].source.freshness = 'immutable'; expect(() => check(m)).toThrow();
    m.entries[0].source.snapshotId = 'host-issued-snapshot'; expect(() => check(m)).not.toThrow();
  });
  it.each(['-1', '01', '1e3', '9223372036854775808'])('rejects inexact size %s', size => {
    const m = fixture(); if (m.entries[0].kind === 'file') m.entries[0].blob.size = size;
    expect(() => check(m)).toThrow();
  });
  it('keeps symlink targets literal and output intent inert', () => {
    const m = fixture();
    m.entries = [ { kind: 'symlink', path: [b('a')], source, target: b('../clips/part one.mp4') },
      { kind: 'output-intent', path: [b('out')], source, operations: ['create', 'truncate'] } ];
    expect(() => check(m)).not.toThrow();
    expect(m.entries[0]).toHaveProperty('target', b('../clips/part one.mp4'));
  });
  it('rejects unknown fields including arbitrary destinations and argv', () => {
    for (const extra of [{ destination: '/tmp/server' }, { originalArgv: [b('ffmpeg')] }]) {
      expect(() => check(Object.assign(fixture(), extra))).toThrow();
    }
  });
  it('requires a preceding file identity for hardlinks', () => {
    const m = fixture(); m.entries.push({ kind: 'hardlink', path: [b('z')], source, identityRef: 'i' });
    expect(() => check(m)).toThrow();
    if (m.entries[0].kind === 'file') m.entries[0].identityRef = 'i';
    expect(() => check(m)).not.toThrow();
  });
});


describe('directory trees supplied directly by generic callers', () => {
  it.each([
    ['concat', ['clips', 'clips/part one.mp4', 'clips/part two.mp4', 'edit', 'edit/lists', 'edit/lists/cut.ffconcat', 'out']],
    ['filter-font', ['assets', 'assets/grade.cube', 'clips', 'clips/source.mp4', 'filters', 'filters/look.txt', 'fonts', 'fonts/TestSans.ttf', 'out', 'titles', 'titles/current.txt']],
    ['ICC', ['fonts', 'fonts/TestSans.ttf', 'images', 'images/input.tif', 'out', 'profiles', 'profiles/input.icc', 'profiles/output.icc', 'text', 'text/caption.txt']],
    ['image-sequence', ['frames', 'frames/shot_001001.png', 'frames/shot_001002.png', 'out']],
  ])('preserves the original %s tree with /work cwd', (_name, names) => {
    const m = fixture();
    m.entries = names.map(name => {
      const path = name.split('/').map(b);
      const entrySource = { ...source, path: b('/work/' + name) };
      return names.some(other => other.startsWith(name + '/')) || name === 'out'
        ? { kind: 'directory' as const, path, source: entrySource }
        : { kind: 'file' as const, path, source: entrySource, blob: { blobId: name, size: '0', sha256: '0'.repeat(64) } };
    });
    const before = JSON.stringify(m);
    check(m);
    expect(JSON.stringify(m)).toBe(before);
    expect(m.cwd).toEqual(b('/work'));
    expect(m.entries.map(e => e.path.map(c => new TextDecoder().decode(new Uint8Array(c))).join('/'))).toEqual(names);
  });
  it('validates nanosecond timestamps and modes without rounding', () => {
    const m = fixture();
    m.entries[0].metadata = { mode: 0o640, mtimeNs: '9223372036854775807', atimeNs: '-9223372036854775808' };
    expect(() => check(m)).not.toThrow();
    for (const metadata of [{ mode: 0o10000 }, { mtimeNs: '9223372036854775808' }, { atimeNs: '-0' }]) {
      m.entries[0].metadata = metadata;
      expect(() => check(m)).toThrow();
    }
  });
  it('does not admit a different source authority or unknown entry fields', () => {
    const m = fixture(); m.entries[0].source.authorityId = 'all-files';
    expect(() => check(m)).toThrow();
    const other = fixture(); Object.assign(other.entries[0], { destination: '/tmp/server' });
    expect(() => check(other)).toThrow();
  });
  it('checks digest syntax and entry/path budgets before accepting the tree', () => {
    const m = fixture();
    expect(() => validateDependencyManifest(m, { maxEntries: 0, maxPathBytes: 4096 })).toThrow();
    expect(() => validateDependencyManifest(m, { maxEntries: 100, maxPathBytes: 1 })).toThrow();
    if (m.entries[0].kind === 'file') m.entries[0].blob.sha256 = 'z'.repeat(64);
    expect(() => check(m)).toThrow();
  });
});
