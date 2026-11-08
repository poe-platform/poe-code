import { expect, it } from 'vitest';
import { discover } from './discover.js';
import { createDependencyResolver, DependencyResolver, DiscoveryBudgetError } from './resolver.js';

const b = (value: string) => new TextEncoder().encode(value);
const t = (value: Uint8Array | undefined) => value && new TextDecoder().decode(value);
const options = { cwd: b('/work'), budgets: { nodes: 100, bytes: 100000, depth: 10, symlinks: 10 } };

it('discovers the selected filter filename reader from loaded content without retokenizing filename bytes', async () => {
  const resolver = await createDependencyResolver(discover('ffmpeg', ['-vf', 'movie=/filename=options/name', 'out'].map(b)), options);
  const loaded = resolver.graph().nodes.find(node => t(node.original) === 'options/name')!;
  const children = await resolver.content(loaded.id, { content: b("雪\nclip,one;two'[3].ppm\0ignored") });
  expect(children.map(node => [t(node.original), t(node.location), node.access])).toEqual([
    ["雪\nclip,one;two'[3].ppm", "/work/雪\nclip,one;two'[3].ppm", 'read'],
  ]);
  expect(resolver.graph().status).toBe('live');
});

it('retains signed movie URLs and inherits protocol policy through loaded filter operands', async () => {
  const resolver = await createDependencyResolver(discover('ffmpeg', ['-vf', 'amovie=/filename=options/name', 'out'].map(b)), { ...options, policy: { allow: ['file'] } });
  const loaded = resolver.graph().nodes.find(node => t(node.original) === 'options/name')!;
  const signed = 'https://cdn/clip?sig=a+%2f&next=/../#frag';
  const [child] = await resolver.content(loaded.id, { content: b(signed) });
  expect([t(child.original), t(child.location), child.kind, child.upload]).toEqual([signed, signed, 'url', false]);
  expect(resolver.graph().issues).toContainEqual(expect.objectContaining({ node: child.id, reason: 'policy' }));
});

it('keeps loaded text/font/LUT files literal, text content synthetic, and filter destinations writable', async () => {
  const resolver = await createDependencyResolver(discover('ffmpeg', ['-vf', 'drawtext=/textfile=a:/fontfile=b:/font=c:/text=d,lut3d=/file=e,psnr=/f=f,metadata=/file=g', 'out'].map(b)), options);
  const expected = [
    ['a', 'pipe:0', 'path', '/work/pipe:0', 'read'],
    ['b', 'font:雪', 'path', '/work/font:雪', 'read'],
    ['c', 'Example Sans', 'resource-lookup', undefined, 'read'],
    ['d', 'movie=not-a-filter', undefined, undefined, undefined],
    ['e', 'lut:one', 'path', '/work/lut:one', 'read'],
    ['f', 'pipe:3', 'path', '/work/pipe:3', 'write'],
    ['g', 'pipe:3', 'descriptor', undefined, 'write'],
  ];
  for (const [name, value, kind, location, access] of expected) {
    const loaded = resolver.graph().nodes.find(node => t(node.original) === name)!;
    const children = await resolver.content(loaded.id, { content: b(value!) });
    expect(children.map(node => [node.kind, t(node.location), node.access])).toEqual(kind ? [[kind, location, access]] : []);
  }
  expect(resolver.graph().status).toBe('live');
});

it('retains loaded filter readers through observed graphs and presets, with reloads producing distinct occurrences', async () => {
  const resolver = new DependencyResolver(options);
  for (const grammar of ['filter', 'preset'] as const) {
    const root = await resolver.add({ value: b('elsewhere/root'), access: 'read', grammar });
    const [loaded] = await resolver.content(root.id, { content: b((grammar === 'preset' ? 'vf=' : '') + 'drawtext=/textfile=options/name') });
    const [first] = await resolver.content(loaded.id, { content: b('A') });
    const [second] = await resolver.content(loaded.id, { content: b('a') });
    expect([t(first.location), t(second.location)]).toEqual(['/work/A', '/work/a']);
    expect(first.id).not.toBe(second.id);
    expect(first.parent).toBe(loaded.id);
    expect(first.live && second.live).toBe(true);
  }
});

it('records input/output aliases and later frame-time reads independently of loaded filter hints', async () => {
  const resolver = await createDependencyResolver(discover('ffmpeg', ['-i', 'same', '-vf', 'psnr=/f=options/name', 'same'].map(b)), options);
  const loaded = resolver.graph().nodes.find(node => t(node.original) === 'options/name')!;
  const [write] = await resolver.content(loaded.id, { content: b('same') });
  const read = await resolver.observe({ value: b('same'), access: 'read', sequence: 1 });
  const reload = await resolver.observe({ value: b('雪\nchanged'), access: 'read', optional: true, sequence: 2 });
  expect(write.location).toEqual(read.location);
  expect(write.id).not.toBe(read.id);
  expect(resolver.graph().nodes.filter(node => t(node.original) === 'same').map(node => node.access)).toEqual(['read', 'write', 'write', 'read']);
  expect(resolver.graph().edges).toContainEqual({ from: read.id, to: reload.id, kind: 'observed-before' });
  expect(reload.live && !reload.upload).toBe(true);
});

it('charges selected filter reader metadata and the full observed buffer against explicit budgets', async () => {
  const resolver = new DependencyResolver({ ...options, budgets: { ...options.budgets, bytes: 30 } });
  await expect(resolver.add({ value: b('a'), access: 'read', grammar: 'filter-option', filterReader: { filter: 'movie', name: 'n'.repeat(30) } })).rejects.toBeInstanceOf(DiscoveryBudgetError);
  expect(resolver.graph().status).toBe('incomplete');
  const limited = new DependencyResolver({ ...options, budgets: { ...options.budgets, bytes: 50 } });
  const loaded = await limited.add({ value: b('a'), access: 'read', grammar: 'filter-option', filterReader: { filter: 'movie', name: 'filename' } });
  expect(await limited.content(loaded.id, { content: b('clip\0' + 'x'.repeat(50)) })).toEqual([]);
  expect(limited.graph().issues).toContainEqual(expect.objectContaining({ node: loaded.id, reason: 'budget' }));
  expect(limited.graph().status).toBe('incomplete');
});
