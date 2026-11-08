import { expect, it } from 'vitest';
import { Volume } from 'memfs';
import { DependencyResolver } from './resolver.js';
import evidence from '../tests/fixtures/native/dependency-missing-traversal-native-evidence.json';

const b = (value: string) => new TextEncoder().encode(value);
const t = (value: Uint8Array) => new TextDecoder().decode(value);
const options = { cwd: b('/work'), budgets: { nodes: 100, bytes: 100000, depth: 10, symlinks: 10 } };

it('retains an absent optional component before dot-dot instead of selecting an existing input/output alias', async () => {
  const volume = Volume.fromJSON({ '/work/Case雪\n.ppm': 'original', '/work/case雪\n.ppm': 'collision' });
  const probes: string[] = [];
  const resolver = new DependencyResolver({ ...options,
    link: async path => { probes.push(t(path)); return undefined; },
    exists: async path => volume.existsSync(t(path)),
  });
  const missing = await resolver.add({ value: b('absent/../Case雪\n.ppm'), access: 'read', optional: true });
  const output = await resolver.add({ value: b('Case雪\n.ppm'), access: 'write' });
  expect(missing.location).toEqual(b('/work/absent/../Case雪\n.ppm'));
  expect(missing.location).not.toEqual(output.location);
  expect(missing.trace.map(step => t(step.path))).toEqual(['/work', '/work/absent']);
  expect(probes).toEqual(['/work', '/work/absent', '/work', '/work/Case雪\n.ppm']);
  expect(resolver.graph().issues).toContainEqual(expect.objectContaining({ node: missing.id, reason: 'unresolved' }));
  expect(resolver.graph().status).toBe('incomplete');
  expect(volume.toJSON()).toEqual({ '/work/Case雪\n.ppm': 'original', '/work/case雪\n.ppm': 'collision' });
});

it('retains the reader base when a missing symlink target precedes a parent segment', async () => {
  const resolver = new DependencyResolver({ ...options,
    link: async path => t(path) === '/work/lists/link' ? b('/store/absent/deep') : undefined,
    exists: async path => !t(path).startsWith('/store/absent'),
  });
  const root = await resolver.add({ value: b('lists/root'), access: 'read', grammar: 'concat' });
  const [member] = await resolver.content(root.id, { content: b("file 'link/../Case.ppm'\n") });
  expect(member.base.value).toEqual(b('/work/lists/root'));
  expect(member.location).toEqual(b('/work/lists/link/../Case.ppm'));
  expect(member.trace.some(step => t(step.path) === '/store/Case.ppm')).toBe(false);
  expect(resolver.graph().issues).toContainEqual(expect.objectContaining({ node: member.id, reason: 'unresolved' }));
});

it('keeps failed stat metadata advisory and permits later observed access at the same spelling', async () => {
  const resolver = new DependencyResolver({ ...options, link: async () => undefined,
    exists: async () => { throw new Error('metadata unavailable'); },
  });
  const node = await resolver.observe({ value: b('absent/../Case'), access: 'read-write', sequence: 1 });
  expect(node.location).toEqual(b('/work/absent/../Case'));
  expect(node.timing).toMatchObject({ certainty: 'observed', sequence: 1 });
  expect(node.live && !node.upload).toBe(true);
  const next = await resolver.observe({ value: b('Case'), access: 'write', sequence: 2 });
  expect(resolver.graph().edges).toContainEqual({ from: node.id, to: next.id, kind: 'observed-before' });
  expect(resolver.graph().issues).toContainEqual(expect.objectContaining({ node: node.id, reason: 'unresolved' }));
});

it('retains unknown component spelling without charging or probing a discarded suffix', async () => {
  const probes: string[] = [];
  const resolver = new DependencyResolver({ ...options, budgets: { ...options.budgets, bytes: 75 },
    link: async path => { probes.push(t(path)); return undefined; },
    exists: async path => t(path) === '/work' ? true : undefined,
  });
  const node = await resolver.add({ value: b('unknown/../Case'), access: 'read' });
  expect(node.location).toEqual(b('/work/unknown/../Case'));
  expect(probes).toEqual(['/work', '/work/unknown']);
  const descriptor = await resolver.observe({ value: b('pipe:3'), access: 'read', sequence: 1 });
  expect(descriptor.kind).toBe('descriptor');
  expect(resolver.graph().issues.every(issue => issue.reason === 'unresolved')).toBe(true);
});

it.each(['read', 'write', 'read-write'] as const)('leaves an absent final %s leaf advisory without making normal output creation unresolved', async access => {
  const stats: string[] = [];
  const resolver = new DependencyResolver({ ...options, link: async () => undefined,
    exists: async path => { stats.push(t(path)); return t(path) === '/work'; },
  });
  const node = await resolver.add({ value: b('new雪\n.ppm'), access, optional: access === 'read' });
  expect(node.location).toEqual(b('/work/new雪\n.ppm'));
  expect(stats).toEqual(['/work']);
  expect(resolver.graph()).toMatchObject({ status: 'live', issues: [] });
});

// Qualification data are consumed only by this test. Native attempted accesses
// independently cover each original operand; product discovery never loads traces.
it.each(evidence.results)('covers the independent native $id access without inventing a reachable alias', async native => {
  const volume = Volume.fromJSON(Object.fromEntries(Object.entries(evidence.fixtures)
    .map(([name, bytes]) => [evidence.cwd + '/' + name, Buffer.from(bytes, 'base64')])));
  for (const directory of evidence.directories) volume.mkdirSync(evidence.cwd + '/' + directory);
  for (const [name, target] of Object.entries(evidence.symlinks)) volume.symlinkSync(target, evidence.cwd + '/' + name);
  const resolver = new DependencyResolver({ ...options, cwd: b(evidence.cwd),
    link: async path => { try { return volume.readlinkSync(t(path), { encoding: 'buffer' }); } catch { return undefined; } },
    exists: async path => volume.existsSync(t(path)),
  });
  const node = await resolver.add({ value: b(native.operand), access: 'read', optional: native.id !== 'valid' });
  expect(native.paired_equal && evidence.fixtures_unchanged).toBe(true);
  expect(native.runs.map(run => run.status)).toEqual(native.id === 'valid' ? [0, 0] : [1, 1]);
  if (native.id === 'valid') expect(Buffer.from(native.runs[0].stdout_base64, 'base64').toString())
    .toBe('[STREAM]\nwidth=1\nheight=1\n[/STREAM]\n');
  const accesses = native.runs[1].accesses.filter(access => Buffer.from(access.path_hex, 'hex').equals(node.original));
  expect(accesses).toHaveLength(1);
  expect(accesses[0].flags & 3).toBe(0);
  expect(node.access).toBe('read');
  expect(node.location).toEqual(b(evidence.cwd + '/' + (native.id === 'valid' ? 'Case雪\n.ppm' : native.operand)));
  expect(node.live && !node.upload && node.timing.certainty === 'predicted').toBe(true);
  expect(resolver.graph().status).toBe(native.id === 'valid' ? 'live' : 'incomplete');
});
