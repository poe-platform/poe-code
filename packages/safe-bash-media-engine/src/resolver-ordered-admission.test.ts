import { expect, it } from 'vitest';
import { DependencyResolver, DiscoveryBudgetError } from './resolver.js';

const b = (value: string) => new TextEncoder().encode(value);
const t = (value: Uint8Array) => new TextDecoder().decode(value);
const options = { cwd: b('/work'), budgets: { nodes: 100, bytes: 100000, depth: 10, symlinks: 10 } };

it('keeps overlapping advisory admissions ordered with distinct alias occurrences', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const resolver = new DependencyResolver({ ...options, link: async () => { await gate; return undefined; } });
  const first = resolver.add({ value: b('Case雪\n.ppm'), access: 'read' });
  const second = resolver.add({ value: b('Case雪\n.ppm'), access: 'write' });
  release();
  const nodes = await Promise.all([first, second]);
  expect(nodes.map(node => [node.id, t(node.original), node.access])).toEqual([
    [0, 'Case雪\n.ppm', 'read'], [1, 'Case雪\n.ppm', 'write'],
  ]);
  expect(resolver.graph().edges).toContainEqual({ from: 0, to: 1, kind: 'before' });
});

it('enforces node budgets against overlapping admissions without losing the earlier read', async () => {
  const resolver = new DependencyResolver({ ...options, budgets: { ...options.budgets, nodes: 1 }, link: async () => undefined });
  const first = resolver.add({ value: b('first'), access: 'read' });
  const second = resolver.add({ value: b('second'), access: 'write' });
  await first;
  await expect(second).rejects.toBeInstanceOf(DiscoveryBudgetError);
  expect(resolver.graph().nodes.map(node => t(node.original))).toEqual(['first']);
  expect(resolver.graph().status).toBe('incomplete');
});

it('retains runtime sequence order across metadata awaits and recovers after a rejected sequence', async () => {
  const resolver = new DependencyResolver({ ...options, link: async () => undefined });
  const first = resolver.observe({ value: b('alias'), access: 'read-write', sequence: 8 });
  const invalid = resolver.observe({ value: b('invalid'), access: 'read', sequence: 7 });
  const next = resolver.observe({ value: b('alias'), access: 'write', sequence: 9 });
  await first;
  await expect(invalid).rejects.toThrow('sequence must increase');
  const observed = await next;
  expect(observed.id).toBe(1);
  expect(resolver.graph().edges).toContainEqual({ from: 0, to: 1, kind: 'observed-before' });
  expect(resolver.graph().nodes.map(node => node.timing.sequence)).toEqual([8, 9]);
});

it('owns queued operands before an earlier advisory traversal can mutate them', async () => {
  const later = { value: Buffer.from('case.ppm'), access: 'read' as const };
  const resolver = new DependencyResolver({ ...options, link: async () => { later.value.fill(120); return undefined; } });
  const first = resolver.add({ value: b('Case.ppm'), access: 'read' });
  const second = resolver.add(later);
  await first;
  expect(t((await second).original)).toBe('case.ppm');
});

it('keeps changed captures and nested protocol members contiguous in submission order', async () => {
  const resolver = new DependencyResolver({ ...options, link: async () => undefined });
  const root = await resolver.add({ value: b('lists/root'), access: 'read', grammar: 'concat' });
  const old = resolver.content(root.id, { content: b('file concat:Case.ppm|Case.ppm\n') });
  const changed = resolver.content(root.id, { content: b('file case.ppm\n') });
  const output = resolver.add({ value: b('Case.ppm'), access: 'write' });
  await Promise.all([old, changed, output]);
  expect(resolver.graph().nodes.map(node => [node.id, t(node.original), node.access])).toEqual([
    [0, 'lists/root', 'read'], [1, 'concat:Case.ppm|Case.ppm', 'read'],
    [2, 'Case.ppm', 'read'], [3, 'Case.ppm', 'read'],
    [4, 'case.ppm', 'read'], [5, 'Case.ppm', 'write'],
  ]);
  expect(resolver.graph().nodes.slice(1, 5).map(node => t(node.location!))).toEqual([
    'concat:Case.ppm|Case.ppm', '/work/Case.ppm', '/work/Case.ppm', '/work/lists/case.ppm',
  ]);
});

it('owns queued captures and effective signed URL bases while preserving changed shared playlists', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const resolver = new DependencyResolver({ ...options, link: async () => { await gate; return undefined; } });
  const root = await resolver.add({ value: b('https://origin/master'), access: 'read', grammar: 'hls' });
  const earlier = resolver.add({ value: b('optional'), access: 'read', optional: true });
  const content = Buffer.from('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nshared?sig=+%2f#part\n');
  const location = Buffer.from('https://cdn/live/master?sig=+%2f#old');
  const capture = resolver.content(root.id, { content, location });
  content.fill(120);
  location.fill(120);
  const changed = resolver.content(root.id, { content: b('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=2\nshared?sig=+%2f#part\n'), location: b('https://cdn/live/master?sig=+%2f#old') });
  release();
  await earlier;
  const [[first], [second]] = await Promise.all([capture, changed]);
  expect(first.location).toEqual(second.location);
  expect(t(first.location!)).toBe('https://cdn/live/shared?sig=+%2f#part');
  expect(first.id).not.toBe(second.id);
  expect(first.base.value).toEqual(b('https://cdn/live/master?sig=+%2f#old'));
  expect(resolver.graph().issues.some(issue => issue.reason === 'cycle')).toBe(false);
  expect(resolver.graph().nodes.every(node => node.live && !node.upload)).toBe(true);
});
