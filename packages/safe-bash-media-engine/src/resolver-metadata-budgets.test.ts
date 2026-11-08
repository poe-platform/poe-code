import { expect, it } from 'vitest';
import { DependencyResolver, DiscoveryBudgetError } from './resolver.js';
import type { AccessReference } from './resolution-types.js';

const b = (value: string) => new TextEncoder().encode(value);
const options = { cwd: b('/work'), budgets: { nodes: 100, bytes: 30, depth: 10, symlinks: 10 } };

it.each<Partial<AccessReference>>([
  { source: '雪\n'.repeat(8) },
  { filterReader: { filter: '雪'.repeat(9), name: 'file' } },
  { filterReader: { filter: 'movie', name: '雪'.repeat(9) } },
  { optionReader: { tool: 'ffmpeg', name: '雪'.repeat(9) } },
])('charges retained UTF-8 metadata before advisory traversal: %j', async metadata => {
  let probes = 0;
  const resolver = new DependencyResolver({ ...options, link: async () => { probes++; return undefined; } });
  await expect(resolver.add({ value: b('x'), access: 'read', ...metadata })).rejects.toBeInstanceOf(DiscoveryBudgetError);
  expect(probes).toBe(0);
  expect(resolver.graph()).toMatchObject({ nodes: [], status: 'incomplete', issues: [{ reason: 'budget' }] });
});

it('charges source metadata on every alias occurrence and preserves the earlier read on refusal', async () => {
  const resolver = new DependencyResolver(options);
  const read = await resolver.observe({ value: b('Case雪\n'), source: 'capture雪', access: 'read', sequence: 1 });
  await expect(resolver.observe({ value: read.original, source: 'capture雪', access: 'write', sequence: 2 }))
    .rejects.toBeInstanceOf(DiscoveryBudgetError);
  const graph = resolver.graph();
  expect(graph.nodes).toEqual([read]);
  expect(graph.status).toBe('incomplete');
  expect(graph.edges).toEqual([]);
});

it('keeps source bytes and signed URL spelling unchanged when metadata fits the budget', async () => {
  const resolver = new DependencyResolver({ ...options, budgets: { ...options.budgets, bytes: 1000 } });
  const value = b('https://cdn/雪?sig=+%2f&next=/../#part');
  const node = await resolver.add({ value, source: 'capture雪\n', access: 'read' });
  expect(node).toMatchObject({ original: value, location: value, source: 'capture雪\n', kind: 'url', live: true, upload: false });
  expect(resolver.graph().status).toBe('live');
});

it('charges source lineage from each changed observed filename list', async () => {
  const resolver = new DependencyResolver({ ...options, budgets: { ...options.budgets, bytes: 240 } });
  const root = await resolver.add({ value: b('lists/' + '雪'.repeat(10)), grammar: 'magick-list', access: 'read' });
  const first = await resolver.content(root.id, { content: b('A') });
  expect(first.map(node => node.original)).toEqual([b('A')]);
  expect(await resolver.content(root.id, { content: b('a') })).toEqual([]);
  const graph = resolver.graph();
  expect(graph.nodes.map(node => node.original)).toEqual([root.original, b('A')]);
  expect(graph.status).toBe('incomplete');
  expect(graph.issues).toContainEqual(expect.objectContaining({ node: root.id, reason: 'budget' }));
});
