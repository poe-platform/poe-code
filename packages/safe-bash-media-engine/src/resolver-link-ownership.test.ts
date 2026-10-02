import { expect, it } from 'vitest';
import { DependencyResolver } from './resolver.js';

const b = (value: string) => new TextEncoder().encode(value);
const t = (value: Uint8Array) => new TextDecoder().decode(value);
const options = { cwd: b('/work'), budgets: { nodes: 20, bytes: 10000, depth: 8, symlinks: 8 } };

it('keeps traversal spelling when advisory metadata reuses its argument buffer', async () => {
  const resolver = new DependencyResolver({ ...options, link: async path => {
    const name = t(path);
    path.fill(120);
    return name === '/work/alias' ? b('/media/inside') : undefined;
  } });
  const node = await resolver.add({ value: b('alias/../雪\n.ppm'), access: 'read' });
  expect(t(node.original)).toBe('alias/../雪\n.ppm');
  expect(t(node.location!)).toBe('/media/雪\n.ppm');
  expect(node.trace.map(step => t(step.path))).toEqual([
    '/work', '/work/alias', '/media', '/media/inside', '/media/雪\n.ppm',
  ]);
  expect(resolver.graph().status).toBe('live');
});

it('does not fabricate a cycle when distinct symlink arguments are overwritten alike', async () => {
  const resolver = new DependencyResolver({ ...options, link: async path => {
    const name = t(path);
    path.fill(120);
    return name === '/work/a' ? b('b') : name === '/work/b' ? b('/media/image.ppm') : undefined;
  } });
  const node = await resolver.add({ value: b('a'), access: 'read-write' });
  expect(t(node.location!)).toBe('/media/image.ppm');
  expect(node.trace.map(step => t(step.path))).toEqual([
    '/work', '/work/a', '/work/b', '/media', '/media/image.ppm',
  ]);
  expect(resolver.graph().issues).toEqual([]);
  expect(node.access).toBe('read-write');
});

it('retains real symlink cycles even when metadata overwrites its arguments', async () => {
  const resolver = new DependencyResolver({ ...options, link: async path => {
    const name = t(path);
    path.fill(120);
    return name === '/work/a' ? b('b') : name === '/work/b' ? b('a') : undefined;
  } });
  await resolver.add({ value: b('a'), access: 'read' });
  expect(resolver.graph().issues).toContainEqual(expect.objectContaining({ reason: 'cycle' }));
  expect(resolver.graph().nodes[0].trace.map(step => t(step.path))).toEqual([
    '/work', '/work/a', '/work/b', '/work/a',
  ]);
  expect(resolver.graph().status).toBe('incomplete');
});
