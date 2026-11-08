import { expect, it } from 'vitest';
import { DependencyResolver, DiscoveryBudgetError } from './resolver.js';

const b = (value: string) => new TextEncoder().encode(value);
const options = { cwd: b('/work'), budgets: { nodes: 100, bytes: 30, depth: 10, symlinks: 10 } };

it.each(['allow', 'deny'] as const)('charges explicit %s policy bytes before metadata traversal', async list => {
  let probes = 0;
  const resolver = new DependencyResolver({ ...options, link: async () => { probes++; return undefined; } });
  await expect(resolver.add({ value: b('x'), access: 'read', policy: { [list]: ['雪'.repeat(10)] } }))
    .rejects.toBeInstanceOf(DiscoveryBudgetError);
  expect(probes).toBe(0);
  expect(resolver.graph()).toMatchObject({ nodes: [], status: 'incomplete', issues: [{ reason: 'budget' }] });
});

it('charges invocation policy on each retained occurrence instead of treating shared policy as free', async () => {
  const resolver = new DependencyResolver({ ...options, policy: { allow: ['file'], deny: ['https'] } });
  await resolver.add({ value: b('Case'), access: 'read' });
  await expect(resolver.add({ value: b('Case'), access: 'write' })).rejects.toBeInstanceOf(DiscoveryBudgetError);
  expect(resolver.graph().nodes.map(node => node.access)).toEqual(['read']);
  expect(resolver.graph().status).toBe('incomplete');
});

it('charges inherited policy during nested expansion and retains the admitted prefix as incomplete', async () => {
  const resolver = new DependencyResolver({ ...options, budgets: { ...options.budgets, bytes: 42 } });
  const root = await resolver.add({ value: b('concat:a|a'), access: 'read', policy: { allow: ['concat', 'file'] } });
  const graph = resolver.graph();
  expect(graph.nodes.map(node => node.original)).toEqual([b('concat:a|a'), b('a')]);
  expect(graph.nodes[1].parent).toBe(root.id);
  expect(graph.status).toBe('incomplete');
  expect(graph.issues).toContainEqual(expect.objectContaining({ node: root.id, reason: 'budget' }));
});

it('charges the effective replacement policy and allows a valid observation after rejection', async () => {
  const resolver = new DependencyResolver({ ...options, policy: { allow: ['file'.repeat(20)] } });
  await expect(resolver.observe({ value: b('Case'), access: 'read', sequence: 1 })).rejects.toBeInstanceOf(DiscoveryBudgetError);
  const node = await resolver.observe({ value: b('Case'), access: 'read-write', sequence: 1, policy: { allow: ['file'] } });
  expect(node.timing).toMatchObject({ certainty: 'observed', sequence: 1 });
  expect(node.policy).toEqual({ allow: ['file'] });
  expect(node.upload).toBe(false);
});
