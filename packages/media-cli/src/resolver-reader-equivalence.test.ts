import { expect, it } from 'vitest';
import { DependencyResolver } from './resolver.js';

const b = (value: string) => new TextEncoder().encode(value);
const options = { cwd: b('/work'), budgets: { nodes: 100, bytes: 100000, depth: 10, symlinks: 10 } };
const playlist = b('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nchild\n');

it.each(['file:/work/./root', 'file:/work//root', 'file:./root', 'file:/./work/root'])('detects reader-equivalent ancestor %s without changing operands', async spelling => {
  const resolver = new DependencyResolver(options);
  const root = await resolver.add({ value: b('root'), access: 'read', grammar: 'hls' });
  await resolver.content(root.id, { content: playlist });
  const child = await resolver.add({ value: b(spelling), access: 'read', grammar: 'hls' }, root.id);
  expect(await resolver.content(child.id, { content: playlist })).toEqual([]);
  expect(resolver.graph().issues).toContainEqual(expect.objectContaining({ node: child.id, reason: 'cycle' }));
  expect(child.original).toEqual(b(spelling));
  expect(child.readerLocation).toEqual(b(spelling));
  expect(child.live).toBe(true);
  expect(child.upload).toBe(false);
});

it('retains parent traversal, case distinctions and signed URL spelling in cycle identities', async () => {
  const resolver = new DependencyResolver(options);
  const root = await resolver.add({ value: b('root'), access: 'read', grammar: 'hls' });
  await resolver.content(root.id, { content: playlist });
  for (const spelling of ['file:/work/link/../root', 'file:/work/Root', 'https://cdn/root?sig=./a//b#v']) {
    const child = await resolver.add({ value: b(spelling), access: 'read', grammar: 'hls' }, root.id);
    expect(await resolver.content(child.id, { content: b('#EXTM3U\nsegment.ts\n') })).toHaveLength(1);
    expect(child.readerLocation).toEqual(b(spelling));
  }
  expect(resolver.graph().issues.some(issue => issue.reason === 'cycle')).toBe(false);
});

it('allows changed observed reloads of reader-equivalent ancestors and preserves ordered aliases', async () => {
  const resolver = new DependencyResolver(options);
  const root = await resolver.add({ value: b('Case\n雪'), access: 'read', grammar: 'hls' });
  await resolver.content(root.id, { content: playlist });
  const reload = await resolver.observe({ value: b('file:/work/./Case\n雪'), access: 'read', grammar: 'hls', sequence: 1 }, root.id);
  const [segment] = await resolver.content(reload.id, { content: b('#EXTM3U\nchanged.ts\n') });
  expect(segment.original).toEqual(b('changed.ts'));
  expect(resolver.graph().issues).toContainEqual(expect.objectContaining({ node: reload.id, reason: 'cycle' }));
  const alias = await resolver.observe({ value: root.original, access: 'read-write', optional: true, sequence: 2 });
  expect(resolver.graph().edges).toContainEqual({ from: reload.id, to: alias.id, kind: 'observed-before' });
  expect(resolver.graph().status).toBe('incomplete');
});

it.each(['file://work/root', 'file:/work/root/', 'file:/work/root/.'])('preserves special leading and terminal directory spelling %s conservatively', async spelling => {
  const resolver = new DependencyResolver(options);
  const root = await resolver.add({ value: b('root'), access: 'read', grammar: 'hls' });
  await resolver.content(root.id, { content: playlist });
  const child = await resolver.add({ value: b(spelling), access: 'read', grammar: 'hls' }, root.id);
  expect(await resolver.content(child.id, { content: b('#EXTM3U\nsegment.ts\n') })).toHaveLength(1);
  expect(resolver.graph().issues.some(issue => issue.reason === 'cycle')).toBe(false);
});

it('keeps shared reader-equivalent siblings and their individual content bases', async () => {
  const resolver = new DependencyResolver(options);
  const root = await resolver.add({ value: b('root'), access: 'read', grammar: 'hls' });
  const children = await resolver.content(root.id, { content: b('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nfile:/lists/./Child\n#EXT-X-STREAM-INF:BANDWIDTH=2\nfile:/lists//Child\n') });
  for (const [index, child] of children.entries()) {
    const [segment] = await resolver.content(child.id, { content: b(`#EXTM3U\nframe-${index}.ts\n`) });
    expect(segment.base.value).toEqual(child.readerLocation);
    expect(segment.original).toEqual(b(`frame-${index}.ts`));
  }
  expect(children).toHaveLength(2);
  expect(resolver.graph().issues.some(issue => issue.reason === 'cycle')).toBe(false);
});
