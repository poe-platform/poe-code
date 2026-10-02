import { expect, it } from 'vitest';
import { DependencyResolver } from './resolver.js';

const b = (value: string) => new TextEncoder().encode(value);
const options = {
  cwd: b('/work'), budgets: { nodes: 100, bytes: 100000, depth: 10, symlinks: 10 },
  link: async (path: Uint8Array) => ['/work/root', '/work/alias'].includes(new TextDecoder().decode(path)) ? b('/shared/list') : undefined,
};

it.each(['file:/work/root', 'file:root'])('detects %s reader aliases without requiring filesystem metadata', async value => {
  const resolver = new DependencyResolver({ ...options, link: undefined });
  const root = await resolver.add({ value: b('root'), access: 'read', grammar: 'hls' });
  const [alias] = await resolver.content(root.id, { content: b('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\n' + value + '\n') });
  expect(alias.original).toEqual(b(value));
  expect(alias.readerLocation).toEqual(b(value));
  expect(await resolver.content(alias.id, { content: b('#EXTM3U\nsegment.ts\n') })).toEqual([]);
  expect(resolver.graph().issues).toContainEqual(expect.objectContaining({ node: alias.id, reason: 'cycle' }));
  expect(resolver.graph().status).toBe('incomplete');
});

it('does not infer aliases by simplifying parents or reinterpreting literal protocol-like filenames', async () => {
  const resolver = new DependencyResolver({ ...options, link: undefined });
  const root = await resolver.add({ value: b('root'), access: 'read', grammar: 'hls' });
  await resolver.content(root.id, { content: b('#EXTM3U\nsegment.ts\n') });
  for (const reference of [
    { value: b('file:/work/link/../root') },
    { value: b('file:/work/root'), literal: true },
  ]) {
    const child = await resolver.add({ ...reference, access: 'read', grammar: 'hls' }, root.id);
    expect(await resolver.content(child.id, { content: b('#EXTM3U\nsegment.ts\n') })).toHaveLength(1);
  }
  expect(resolver.graph().issues.some(issue => issue.reason === 'cycle')).toBe(false);
});

it('retains reader identity when advisory metadata changes between captures', async () => {
  let metadata = true;
  const resolver = new DependencyResolver({ ...options, link: async path => metadata ? options.link(path) : undefined });
  const root = await resolver.add({ value: b('root'), access: 'read', grammar: 'hls' });
  metadata = false;
  const [alias] = await resolver.content(root.id, { content: b('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nfile:/work/root\n') });
  expect(root.location).toEqual(b('/shared/list'));
  expect(alias.location).toEqual(b('file:/work/root'));
  expect(await resolver.content(alias.id, { content: b('#EXTM3U\nsegment.ts\n') })).toEqual([]);
  expect(resolver.graph().issues).toContainEqual(expect.objectContaining({ node: alias.id, reason: 'cycle' }));
});

it('detects ancestor manifest cycles through different symlink spellings', async () => {
  const resolver = new DependencyResolver(options);
  const root = await resolver.add({ value: b('root'), access: 'read', grammar: 'hls' });
  const [alias] = await resolver.content(root.id, { content: b('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nalias\n') });
  expect(await resolver.content(alias.id, { content: b('#EXTM3U\nsegment.ts\n') })).toEqual([]);
  expect(resolver.graph().issues).toContainEqual(expect.objectContaining({ node: alias.id, reason: 'cycle' }));
  expect(resolver.graph().status).toBe('incomplete');
});

it('allows shared sibling symlink targets and redirected observations', async () => {
  const resolver = new DependencyResolver(options);
  const root = await resolver.add({ value: b('root'), access: 'read', grammar: 'hls' });
  const children = await resolver.content(root.id, { location: b('https://cdn/root'), content: b('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nfile:/work/alias\n#EXT-X-STREAM-INF:BANDWIDTH=2\nfile:/work/alias\n') });
  for (const child of children) {
    expect(await resolver.content(child.id, { content: b('#EXTM3U\nsegment.ts\n') })).toHaveLength(1);
  }
  expect(resolver.graph().issues.some(issue => issue.reason === 'cycle')).toBe(false);
});

it('compares file-protocol and plain-path aliases without changing reader bases', async () => {
  const resolver = new DependencyResolver(options);
  const root = await resolver.add({ value: b('root'), access: 'read', grammar: 'hls' });
  const [alias] = await resolver.content(root.id, { content: b('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nfile:/work/alias\n') });
  expect(new TextDecoder().decode(alias.base.value)).toBe('/work/root');
  expect(new TextDecoder().decode(alias.original)).toBe('file:/work/alias');
  expect(await resolver.content(alias.id, { content: b('#EXTM3U\nsegment.ts\n') })).toEqual([]);
  expect(resolver.graph().issues).toContainEqual(expect.objectContaining({ reason: 'cycle' }));
});

it('does not reuse a local canonical key for a redirected child capture', async () => {
  const resolver = new DependencyResolver(options);
  const root = await resolver.add({ value: b('root'), access: 'read', grammar: 'hls' });
  const [alias] = await resolver.content(root.id, { content: b('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nalias\n') });
  const [segment] = await resolver.content(alias.id, { location: b('https://cdn/live/list?sig=a+%2F'), content: b('#EXTM3U\nsegment.ts?sig=b+%2f\n') });
  expect(new TextDecoder().decode(segment.location)).toBe('https://cdn/live/segment.ts?sig=b+%2f');
  expect(resolver.graph().status).toBe('live');
});
