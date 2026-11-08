import { expect, it } from 'vitest';
import { DependencyResolver } from './resolver.js';

const b = (value: string) => new TextEncoder().encode(value);
const t = (value: Uint8Array | undefined) => value && new TextDecoder().decode(value);
const options = { cwd: b('/work'), budgets: { nodes: 100, bytes: 100000, depth: 10, symlinks: 10 } };

it('attributes late shared-playlist accesses without merging occurrences or guessing their base', async () => {
  const resolver = new DependencyResolver(options);
  const root = await resolver.add({ value: b('https://cdn/master?sig=a+%2f'), access: 'read', grammar: 'hls' });
  const playlists = await resolver.content(root.id, { content: b('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nshared/list\n#EXT-X-STREAM-INF:BANDWIDTH=2\nshared/list\n') });
  const accesses = [];
  for (const [index, parent] of playlists.entries()) {
    accesses.push(await resolver.observe({ value: b('../雪\nsegment?sig=+%2f#part'), access: 'read', sequence: index + 1,
      base: { kind: 'resource', value: b('https://redirect/selected/list?token=secret') } }, parent.id));
  }
  expect(accesses.map(node => [node.parent, t(node.original), t(node.location), node.live, node.upload])).toEqual(
    playlists.map(parent => [parent.id, '../雪\nsegment?sig=+%2f#part', 'https://redirect/雪\nsegment?sig=+%2f#part', true, false]));
  expect(accesses[0].id).not.toBe(accesses[1].id);
  const graph = resolver.graph();
  for (const node of accesses) expect(graph.edges).toContainEqual({ from: node.parent, to: node.id, kind: 'depends-on' });
  expect(graph.edges).toContainEqual({ from: accesses[0].id, to: accesses[1].id, kind: 'observed-before' });
  expect(graph.edges.filter(edge => edge.kind === 'before' && accesses.some(node => node.id === edge.to))).toEqual([]);
});

it('keeps observed reload lineage for cycles while allowing changing captures and separate roles', async () => {
  const resolver = new DependencyResolver(options);
  const root = await resolver.add({ value: b('lists/root'), access: 'read', grammar: 'hls' });
  await resolver.content(root.id, { content: b('#EXTM3U\nfirst\n') });
  const reload = await resolver.observe({ value: b('lists/root'), access: 'read-write', grammar: 'hls', sequence: 1 }, root.id);
  expect(reload.access).toBe('read-write');
  const [second] = await resolver.content(reload.id, { content: b('#EXTM3U\nsecond\n') });
  expect(t(second.location)).toBe('/work/lists/second');
  expect(second.parent).toBe(reload.id);
  expect(resolver.graph().issues).toContainEqual(expect.objectContaining({ node: reload.id, reason: 'cycle' }));
  const [changed] = await resolver.content(root.id, { content: b('#EXTM3U\nCase雪\n') });
  expect(t(changed.location)).toBe('/work/lists/Case雪');
  expect(changed.parent).toBe(root.id);
});

it('retains changed keys, init segments and shared playlists from observed ancestor reloads', async () => {
  const resolver = new DependencyResolver(options);
  const location = 'https://cdn/live/master?sig=+%2f#playlist';
  const root = await resolver.observe({ value: b(location), access: 'read', grammar: 'hls', sequence: 1 });
  await resolver.content(root.id, { content: b('#EXTM3U\nold.ts\n') });
  const reload = await resolver.observe({ value: b(location), access: 'read', grammar: 'hls', sequence: 2 }, root.id);
  const children = await resolver.content(reload.id, { content: b('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="keys/new?sig=+%2f#key"\n#EXT-X-MAP:URI="init/new?sig=%2F+"\n#EXT-X-STREAM-INF:BANDWIDTH=1\nshared/list\n#EXT-X-STREAM-INF:BANDWIDTH=2\nshared/list\n') });
  expect(children.map(node => t(node.location))).toEqual([
    'https://cdn/live/keys/new?sig=+%2f#key', 'https://cdn/live/init/new?sig=%2F+',
    'https://cdn/live/shared/list', 'https://cdn/live/shared/list',
  ]);
  expect(children.every(node => node.live && !node.upload && node.parent === reload.id)).toBe(true);
  expect(children.every(node => node.timing.certainty === 'predicted')).toBe(true);
  const graph = resolver.graph();
  expect(graph.status).toBe('incomplete');
  expect(graph.issues).toContainEqual(expect.objectContaining({ node: reload.id, reason: 'cycle' }));
  expect(graph.edges).toContainEqual({ from: root.id, to: reload.id, kind: 'observed-before' });
  for (let index = 1; index < children.length; index++) {
    expect(graph.edges).toContainEqual({ from: children[index - 1].id, to: children[index].id, kind: 'before' });
  }
});

it('still enforces explicit node budgets on already observed cyclic content', async () => {
  const resolver = new DependencyResolver({ ...options, budgets: { ...options.budgets, nodes: 3 } });
  const root = await resolver.add({ value: b('list'), access: 'read', grammar: 'hls' });
  await resolver.content(root.id, { content: b('#EXTM3U\n') });
  const reload = await resolver.observe({ value: b('list'), access: 'read', grammar: 'hls', sequence: 1 }, root.id);
  const children = await resolver.content(reload.id, { content: b('#EXTM3U\nCase.ts\ncase.ts\n') });
  expect(children.map(node => t(node.original))).toEqual(['Case.ts']);
  expect(resolver.graph().status).toBe('incomplete');
  expect(resolver.graph().issues).toContainEqual(expect.objectContaining({ reason: 'budget' }));
});

it('rejects an unknown observation parent before changing the graph or consuming its sequence', async () => {
  const resolver = new DependencyResolver(options);
  const before = resolver.graph();
  await expect(resolver.observe({ value: b('optional'), access: 'read', optional: true, sequence: 7 }, 42)).rejects.toThrow('Unknown dependency parent');
  expect(resolver.graph()).toEqual(before);
  expect((await resolver.observe({ value: b('optional'), access: 'read', optional: true, sequence: 7 })).timing.sequence).toBe(7);
});

it('does not turn a runtime descriptor into a filename merely because it has a reader parent', async () => {
  const visited: string[] = [];
  const resolver = new DependencyResolver({ ...options, link: async path => { visited.push(t(path)!); return undefined; } });
  const parent = await resolver.add({ value: b('reader'), kind: 'synthetic', access: 'read' });
  const descriptor = await resolver.observe({ value: b('-'), access: 'read', sequence: 1 }, parent.id);
  expect([descriptor.kind, descriptor.location, descriptor.parent]).toEqual(['descriptor', undefined, parent.id]);
  expect(visited).toEqual([]);
  expect(resolver.graph().edges).toContainEqual({ from: parent.id, to: descriptor.id, kind: 'depends-on' });
});

it('uses explicit runtime reader semantics for dash files and URL members', async () => {
  const resolver = new DependencyResolver(options);
  const parent = await resolver.add({ value: b('reader'), kind: 'synthetic', access: 'read' });
  const local = await resolver.observe({ value: b('-'), literal: true, access: 'read-write', sequence: 1 }, parent.id);
  const remote = await resolver.observe({ value: b('-'), access: 'read', sequence: 2,
    base: { kind: 'resource', value: b('https://cdn/live/list?sig=+%2f#parent') } }, parent.id);
  expect([local.kind, t(local.location), local.access]).toEqual(['path', '/work/-', 'read-write']);
  expect([remote.kind, t(remote.location), remote.upload]).toEqual(['url', 'https://cdn/live/-', false]);
});
