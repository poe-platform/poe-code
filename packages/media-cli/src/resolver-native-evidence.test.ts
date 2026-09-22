import { expect, it } from 'vitest';
import { DependencyResolver } from './resolver.js';
import evidence from '../test-fixtures/native/js-resolver-qualification-20260918/native.json';

const b = (value: string) => new TextEncoder().encode(value);
const options = { cwd: b('/scratch'), budgets: { nodes: 100, bytes: 100000, depth: 10, symlinks: 10 } };

// Original in-memory corpus, independently qualified by attempted libc opens in
// docs/remote-media/js-resolver-qualification-20260918/native.json. The product
// does not load these traces or use native execution to discover dependencies.
it('preserves shared nested occurrences and native timing separately from static manifest predictions', async () => {
  const resolver = new DependencyResolver(options);
  const root = await resolver.add({ value: b('lists/root'), access: 'read', grammar: 'concat' });
  const playlists = await resolver.content(root.id, { content: b('ffconcat version 1.0\nfile child\noption safe 0\nfile child\noption safe 0\n') });
  for (const playlist of playlists) {
    const children = await resolver.content(playlist.id, { grammar: 'concat', content: b("ffconcat version 1.0\nfile '../frames/Case.ppm'\nfile '../frames/case.ppm'\n") });
    expect(children.map(node => node.location)).toEqual([b('/scratch/lists/../frames/Case.ppm'), b('/scratch/lists/../frames/case.ppm')]);
  }
  const opens = ['lists/root', 'lists/child', 'lists/../frames/Case.ppm', 'lists/../frames/case.ppm',
    'lists/child', 'lists/../frames/Case.ppm', 'lists/../frames/case.ppm'];
  const observed = [];
  for (const [sequence, value] of opens.entries()) observed.push(await resolver.observe({ value: b(value), access: 'read', sequence }));
  const graph = resolver.graph();
  expect(observed.map(node => node.original)).toEqual(opens.map(b));
  expect(new Set(observed.map(node => node.id)).size).toBe(7);
  expect(graph.edges.filter(edge => edge.kind === 'observed-before')).toEqual(observed.slice(1).map((node, index) => ({ from: observed[index].id, to: node.id, kind: 'observed-before' })));
  expect(observed.every(node => node.live && !node.upload && node.timing.certainty === 'observed')).toBe(true);
  expect(graph.nodes.filter(node => node.timing.certainty === 'predicted')).toHaveLength(7);
  expect(graph.status).toBe('live');
  // Qualify occurrence coverage against the independently recorded native reads,
  // not against a command replay or a product-loaded trace. Predicted graph
  // admission order does not assert native open timing.
  const native = evidence.results.find(result => result.id === 'shared-nested-decode')!;
  expect(native.status).toBe(0);
  const candidates = graph.nodes.filter(node => node.timing.certainty === 'predicted');
  for (const access of native.accesses) {
    expect(access.flags).toBe(0);
    const index = candidates.findIndex(node => node.access === 'read'
      && Buffer.from(node.location!).equals(Buffer.concat([b(evidence.cwd + '/'), Buffer.from(access.path_hex, 'hex')])));
    expect(index, `independent native read occurrence: ${access.path_hex}`).toBeGreaterThanOrEqual(0);
    candidates.splice(index, 1);
  }
  expect(candidates).toEqual([]);
});

it('keeps the native symlink reader base even when advisory traversal finds the target', async () => {
  const resolver = new DependencyResolver({ ...options, link: async path => Buffer.from(path).toString() === '/scratch/else/root' ? b('/scratch/lists/root') : undefined });
  const root = await resolver.add({ value: b('else/root'), access: 'read', grammar: 'concat' });
  const children = await resolver.content(root.id, { content: b('ffconcat version 1.0\nfile child\noption safe 0\nfile child\noption safe 0\n') });
  expect(root.location).toEqual(b('/scratch/lists/root'));
  expect(children.map(node => node.location)).toEqual([b('/scratch/else/child'), b('/scratch/else/child')]);
  expect(children.map(node => node.base.value)).toEqual([b('/scratch/else/root'), b('/scratch/else/root')]);
});
