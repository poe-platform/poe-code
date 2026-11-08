import { expect, it } from 'vitest';
import { DependencyResolver, DiscoveryBudgetError } from './resolver.js';

const b = (value: string) => new TextEncoder().encode(value);
const t = (value: Uint8Array | undefined) => value && new TextDecoder().decode(value);
const options = () => ({ cwd: b('/work'), budgets: { nodes: 20, bytes: 10000, depth: 10, symlinks: 10 } });

it('retains invocation cwd and budgets when the caller reuses configuration', async () => {
  const config = options();
  config.budgets.nodes = 1;
  const resolver = new DependencyResolver(config);
  config.cwd.fill(120);
  config.budgets.nodes = 20;
  const first = await resolver.add({ value: b('雪\nA'), access: 'read' });
  expect(t(first.location)).toBe('/work/雪\nA');
  await expect(resolver.add({ value: b('second'), access: 'read' })).rejects.toBeInstanceOf(DiscoveryBudgetError);
  expect(resolver.graph().status).toBe('incomplete');
});

it('retains protocol policy for changing nested manifests after producer mutation', async () => {
  const policy = { allow: ['https'], deny: ['file'] };
  const resolver = new DependencyResolver(options());
  const root = await resolver.add({ value: b('https://cdn/master?sig=a+%2F#old'), access: 'read', grammar: 'hls', policy });
  policy.allow.push('file');
  policy.deny.length = 0;
  const [child] = await resolver.content(root.id, { content: b('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nchild?sig=b+%2F\n') });
  const [segment] = await resolver.content(child.id, { content: b('#EXTM3U\nfile:secret\n') });
  expect(segment.policy).toEqual({ allow: ['https'], deny: ['file'] });
  expect(resolver.graph().issues).toContainEqual(expect.objectContaining({ node: segment.id, reason: 'policy' }));
  expect(t(child.location)).toBe('https://cdn/child?sig=b+%2F');
});

it('owns loaded-option Buffer specifiers across metadata awaits', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const resolver = new DependencyResolver({ ...options(), link: async () => { await gate; return undefined; } });
  const specifier = Buffer.from('v:0');
  const pending = resolver.add({ value: b('graph'), access: 'read', grammar: 'option-file', optionReader: { tool: 'ffmpeg', name: 'vf', specifier } });
  specifier.fill(120);
  release();
  expect(t((await pending).optionReader?.specifier)).toBe('v:0');
});

it('returns graph and occurrence snapshots that cannot change later bases, policy or runtime order', async () => {
  const resolver = new DependencyResolver(options());
  const root = await resolver.add({ value: b('https://cdn/list?sig=a+%2F'), access: 'read', grammar: 'hls', policy: { allow: ['https'] } });
  root.location!.fill(120);
  const graph = resolver.graph();
  graph.nodes[0].location!.fill(121);
  (graph.nodes[0].policy!.allow as string[]).push('file');
  const [child] = await resolver.content(root.id, { content: b('#EXTM3U\nfile:private\n') });
  expect(child.policy).toEqual({ allow: ['https'] });
  expect(t(resolver.graph().nodes[0].location)).toBe('https://cdn/list?sig=a+%2F');
  const observed = await resolver.observe({ value: b('frame'), access: 'read', sequence: 5 });
  (observed.timing as { sequence: number }).sequence = 0;
  await expect(resolver.observe({ value: b('late'), access: 'write', sequence: 4 })).rejects.toThrow('sequence must increase');
});

it('owns runtime sequence and operand metadata before advisory traversal yields', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const resolver = new DependencyResolver({ ...options(), link: async () => { await gate; return undefined; } });
  const reference = { value: b('雪\nA'), access: 'read-write' as const, sequence: 5 };
  const pending = resolver.observe(reference);
  reference.sequence = 100;
  reference.value.fill(120);
  release();
  const observed = await pending;
  expect(observed.timing.sequence).toBe(5);
  expect(t(observed.original)).toBe('雪\nA');
  expect(observed.access).toBe('read-write');
  const next = await resolver.observe({ value: b('雪\nA'), access: 'write', sequence: 6 });
  expect(resolver.graph().edges).toContainEqual({ from: observed.id, to: next.id, kind: 'observed-before' });
});

it('owns observed script bytes while retaining separate changed observations', async () => {
  const resolver = new DependencyResolver(options());
  const root = await resolver.add({ value: b('scripts/job'), access: 'read', grammar: 'magick-script' });
  const content = Buffer.from('A.ppm -write A.ppm\n');
  const pending = resolver.content(root.id, { content });
  content.set(Buffer.from('B.ppm -write B.ppm\n'));
  const first = await pending;
  const second = await resolver.content(root.id, { content });
  expect(first.map(node => [t(node.original), node.access])).toEqual([['A.ppm', 'read'], ['A.ppm', 'write']]);
  expect(second.map(node => [t(node.original), node.access])).toEqual([['B.ppm', 'read'], ['B.ppm', 'write']]);
  expect([...first, ...second].every(node => node.live && !node.upload)).toBe(true);
});
