import { createHash } from 'node:crypto';
import { Volume } from 'memfs';
import { describe, expect, it } from 'vitest';
import { validateDependencyManifest, type DependencyManifest, type ManifestInvocation } from './protocol.js';

const bytes = (text: string) => Array.from(new TextEncoder().encode(text));
const text = (value: number[]) => new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(value));

describe.each(['direct SDK', 'REST JSON'])('%s nested cwd without a tool parser or CLI', transport => {
  it('keeps root-relative entries, source paths, cwd and literal argv in separate domains', () => {
    const files: Record<string, string> = {
      'project/clips/part one.mp4': 'first clip',
      'project/edit/lists/cut.ffconcat': "ffconcat version 1.0\nfile '../../clips/part one.mp4'\n",
    };
    const directories = ['project', 'project/clips', 'project/edit', 'project/edit/lists', 'project/out'];
    const names = [...directories, ...Object.keys(files), 'project/out/joined.mp4'].sort();
    const manifest: DependencyManifest = {
      version: 1, sessionId: 'session', epoch: 'epoch', namespaceId: 'namespace',
      revision: 'manifest-1', logicalRoot: bytes('/work'), cwd: bytes('/work/project'),
      sourceAuthorityId: 'selected-project',
      entries: names.map(name => {
        const source = {
          authorityId: 'selected-project', path: bytes(`/canonical/${name}`),
          freshness: 'revalidate-on-open' as const, observedVersion: null,
          retainedIdentity: null, callbackGrantId: `open:${name}`,
        };
        const path = name.split('/').map(bytes);
        if (directories.includes(name)) return { kind: 'directory' as const, path, source };
        if (!Object.hasOwn(files, name)) return {
          kind: 'output-intent' as const, path, source, operations: ['create' as const, 'truncate' as const],
        };
        return {
          kind: 'file' as const, path, source,
          blob: { blobId: name, size: String(bytes(files[name]).length), sha256: createHash('sha256').update(files[name]).digest('hex') },
        };
      }),
    };
    const originalArgv = ['-f', 'concat', '-safe', '0', '-i', 'edit/lists/cut.ffconcat', '-c', 'copy', 'out/joined.mp4'].map(bytes);
    // Generic callers can also carry empty and non-UTF8 arguments. These are
    // transport observations, not claims that a string-only launcher accepts them.
    originalArgv.push([], [255, 46, 112, 110, 103]);
    const invocation: ManifestInvocation = {
      manifestId: 'manifest', manifestRevision: 'manifest-1', directoryRevision: 'ready-1',
      cwd: bytes('/work/project'), originalArgv,
    };
    const input = transport === 'REST JSON'
      ? JSON.parse(JSON.stringify({ manifest, invocation })) as { manifest: DependencyManifest; invocation: ManifestInvocation }
      : { manifest, invocation };
    const before = JSON.stringify(input);
    validateDependencyManifest(input.manifest, { maxEntries: 100, maxPathBytes: 4096 });

    const tree = new Volume();
    tree.mkdirSync(text(input.manifest.logicalRoot));
    for (const entry of input.manifest.entries) {
      const name = entry.path.map(text).join('/');
      const logicalPath = `${text(input.manifest.logicalRoot)}/${name}`;
      expect(text(entry.source.path)).toBe(`/canonical/${name}`);
      if (entry.kind === 'directory') tree.mkdirSync(logicalPath);
      else if (entry.kind === 'file') {
        const content = files[entry.blob.blobId];
        expect(String(bytes(content).length)).toBe(entry.blob.size);
        expect(createHash('sha256').update(content).digest('hex')).toBe(entry.blob.sha256);
        tree.writeFileSync(logicalPath, content);
      } else expect(tree.existsSync(logicalPath)).toBe(false);
    }
    const cwd = text(input.invocation.cwd);
    const list = `${cwd}/${text(input.invocation.originalArgv[5])}`;
    expect(tree.readFileSync(list, 'utf8')).toBe(files['project/edit/lists/cut.ffconcat']);
    expect(tree.readFileSync(`${cwd}/edit/lists/../../clips/part one.mp4`, 'utf8')).toBe('first clip');
    expect(tree.readdirSync(`${cwd}/out`)).toEqual([]);
    expect(tree.existsSync('/canonical')).toBe(false);
    expect(tree.existsSync('/work/edit')).toBe(false);
    expect(Object.keys(tree.toJSON()).sort()).toEqual([
      '/work/project/clips/part one.mp4', '/work/project/edit/lists/cut.ffconcat', '/work/project/out',
    ]);
    expect(input.invocation.originalArgv).toEqual(originalArgv);
    expect(input.invocation.originalArgv.slice(-2)).toEqual([[], [255, 46, 112, 110, 103]]);
    expect(JSON.stringify(input)).toBe(before);
  });
});
