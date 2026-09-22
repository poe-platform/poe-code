import { expect, it } from 'vitest';
import { Volume } from 'memfs';
import { DependencyResolver } from './resolver.js';
import evidence from '../test-fixtures/native/dependency-directory-traversal-native-evidence.json';

const b = (value: string) => new TextEncoder().encode(value);
const t = (value: Uint8Array) => new TextDecoder().decode(value);
const options = { cwd: b('/work'), budgets: { nodes: 100, bytes: 100000, depth: 10, symlinks: 10 } };

const fixture = () => {
  const volume = Volume.fromJSON({ '/work/Case雪\n.ppm': 'original', '/work/case雪\n.ppm': 'collision', '/work/block': 'file' });
  volume.mkdirSync('/work/deep');
  volume.symlinkSync('block', '/work/link');
  volume.symlinkSync('deep', '/work/good');
  const probes: string[] = [];
  return { volume, probes, resolver: new DependencyResolver({ ...options,
    link: async path => { try { return volume.readlinkSync(t(path), { encoding: 'buffer' }); } catch { return undefined; } },
    exists: async path => volume.existsSync(t(path)),
    directory: async path => { probes.push(t(path)); return volume.statSync(t(path)).isDirectory(); },
  }) };
};

it.each(['block/../Case雪\n.ppm', 'link/../Case雪\n.ppm', 'block/', 'block/.', 'block/..', 'link/'])('retains non-directory traversal %j without inventing a reachable alias', async operand => {
  const { volume, probes, resolver } = fixture();
  const before = volume.toJSON();
  const node = await resolver.add({ value: b(operand), access: 'read', optional: true });
  expect(node.location).toEqual(b('/work/' + operand));
  expect(probes).toEqual(['/work', '/work/block']);
  expect(resolver.graph()).toMatchObject({ status: 'incomplete', issues: [{ node: node.id, reason: 'unresolved' }] });
  expect(volume.toJSON()).toEqual(before);
});

it('preserves ordered alias occurrences and a valid directory symlink parent', async () => {
  const { resolver } = fixture();
  const read = await resolver.add({ value: b('good/../Case雪\n.ppm'), access: 'read' });
  const write = await resolver.observe({ value: b('Case雪\n.ppm'), access: 'write', sequence: 1 });
  const alias = await resolver.observe({ value: b('link/../Case雪\n.ppm'), access: 'read-write', sequence: 2 });
  expect(read.location).toEqual(write.location);
  expect(alias.location).not.toEqual(write.location);
  expect(resolver.graph().edges).toContainEqual({ from: write.id, to: alias.id, kind: 'observed-before' });
  expect([read, write, alias].every(node => node.live && !node.upload)).toBe(true);
});

it.each(['unknown', 'failure'] as const)('keeps %s directory metadata advisory', async mode => {
  const resolver = new DependencyResolver({ ...options, link: async () => undefined,
    directory: async () => { if (mode === 'failure') throw new Error('unavailable'); return undefined; },
  });
  const node = await resolver.observe({ value: b('block/../Case'), access: 'read', sequence: 1 });
  expect(node.location).toEqual(b('/work/block/../Case'));
  expect(node.timing.certainty).toBe('observed');
  expect(resolver.graph().status).toBe('incomplete');
});

it.each(['read', 'write', 'read-write'] as const)('does not probe an optional final %s leaf', async access => {
  const { resolver, probes } = fixture();
  const node = await resolver.add({ value: b('absent雪\n.ppm'), access, optional: true });
  expect(node.location).toEqual(b('/work/absent雪\n.ppm'));
  expect(probes).toEqual(['/work']);
  expect(resolver.graph().status).toBe('live');
});

it('retains per-reader bases on shared and changing manifest captures', async () => {
  const { resolver } = fixture();
  const root = await resolver.add({ value: b('deep/list'), access: 'read', grammar: 'concat' });
  for (const operand of ['link/../Case雪\n.ppm', 'block/../case雪\n.ppm']) {
    // concat line grammar cannot quote a native newline across line boundaries;
    // use the concatf full-buffer grammar for these original byte names instead.
    const [member] = await resolver.content(root.id, { grammar: 'concatf', content: b("'" + operand + "'\n") });
    expect(member.base).toEqual({ kind: 'directory', value: b('/work') });
    expect(member.original).toEqual(b(operand));
    expect(member.location).toEqual(b('/work/' + operand));
    expect(member.live && !member.upload).toBe(true);
  }
  for (let capture = 0; capture < 2; capture++) {
    const [member] = await resolver.content(root.id, { content: b("file '../link/../Case.ppm'\n") });
    expect(member.base).toEqual({ kind: 'resource', value: b('/work/deep/list') });
    expect(member.location).toEqual(b('/work/deep/../link/../Case.ppm'));
  }
  expect(new Set(resolver.graph().nodes.map(node => node.id)).size).toBe(5);
});

it('owns directory probe arguments and avoids discarded suffix probes', async () => {
  const paths: string[] = [];
  const resolver = new DependencyResolver({ ...options, link: async () => undefined,
    directory: async path => { const name = t(path); paths.push(name); path.fill(120); return name === '/work'; },
  });
  const node = await resolver.add({ value: b('block/../Case'), access: 'read' });
  expect(paths).toEqual(['/work', '/work/block']);
  expect(node.trace.map(step => t(step.path))).toEqual(paths);
  expect(node.location).toEqual(b('/work/block/../Case'));
});

// Evidence qualifies an independently constructed graph; no trace is imported
// by product discovery or used to replay native resolution.
it.each(evidence.results)('covers the native $id attempted access with the original opened spelling', async native => {
  const volume = Volume.fromJSON(Object.fromEntries(Object.entries(evidence.fixtures)
    .map(([name, bytes]) => [evidence.cwd + '/' + name, Buffer.from(bytes, 'base64')])));
  for (const directory of evidence.directories) volume.mkdirSync(evidence.cwd + '/' + directory);
  for (const [name, target] of Object.entries(evidence.symlinks)) volume.symlinkSync(target, evidence.cwd + '/' + name);
  const resolver = new DependencyResolver({ ...options, cwd: b(evidence.cwd),
    link: async path => { try { return volume.readlinkSync(t(path), { encoding: 'buffer' }); } catch { return undefined; } },
    exists: async path => volume.existsSync(t(path)),
    directory: async path => volume.statSync(t(path)).isDirectory(),
  });
  const node = await resolver.add({ value: b(native.operand), access: 'read', optional: native.id !== 'valid' });
  const accesses = native.runs[1].accesses.filter(access => Buffer.from(access.path_hex, 'hex').equals(node.original));
  expect(accesses).toHaveLength(1);
  expect(accesses[0].flags & 3).toBe(0);
  expect(native.paired_equal && evidence.fixtures_unchanged).toBe(true);
  expect(native.runs.map(run => run.status)).toEqual(native.id === 'valid' ? [0, 0] : [1, 1]);
  expect(node.location).toEqual(b(evidence.cwd + '/' + (native.id === 'valid' ? 'Case雪\n.ppm' : native.operand)));
  expect(resolver.graph().status).toBe(native.id === 'valid' ? 'live' : 'incomplete');
  expect(node).toMatchObject({ access: 'read', live: true, upload: false, timing: { certainty: 'predicted' } });
});
