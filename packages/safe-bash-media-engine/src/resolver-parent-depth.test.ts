import { expect, it } from 'vitest';
import { DependencyResolver, DiscoveryBudgetError } from './resolver.js';

const b = (value: string) => new TextEncoder().encode(value);
const options = { cwd: b('/work'), budgets: { nodes: 100, bytes: 100000, depth: 1, symlinks: 10 } };

it('bounds explicit parent chains before probing a dependency beyond the depth budget', async () => {
  const probes: Uint8Array[] = [];
  const resolver = new DependencyResolver({ ...options, link: async path => { probes.push(path); return undefined; } });
  const root = await resolver.add({ value: b('reader'), kind: 'synthetic', access: 'read' });
  const child = await resolver.add({ value: b('nested-reader'), kind: 'synthetic', access: 'read' }, root.id);
  await expect(resolver.add({ value: b('Case雪\n.ppm'), access: 'read', optional: true }, child.id))
    .rejects.toBeInstanceOf(DiscoveryBudgetError);
  expect(probes).toEqual([]);
  expect(resolver.graph()).toMatchObject({ nodes: [{ id: root.id }, { id: child.id }], status: 'incomplete' });
  expect(resolver.graph().issues).toContainEqual(expect.objectContaining({ node: child.id, reason: 'budget' }));
});

it('does not consume a runtime sequence or bytes when parent depth rejects an observation', async () => {
  const resolver = new DependencyResolver(options);
  const root = await resolver.observe({ value: b('reader'), kind: 'synthetic', access: 'read', sequence: 1 });
  const child = await resolver.observe({ value: b('nested-reader'), kind: 'synthetic', access: 'read', sequence: 2 }, root.id);
  await expect(resolver.observe({ value: b('x'.repeat(options.budgets.bytes)), access: 'read', sequence: 3 }, child.id))
    .rejects.toBeInstanceOf(DiscoveryBudgetError);
  expect(resolver.graph().issues).toContainEqual(expect.objectContaining({ node: child.id, detail: expect.stringContaining('depth') }));
  const alias = await resolver.observe({ value: b('reader'), kind: 'synthetic', access: 'read-write', sequence: 3 }, root.id);
  expect(alias).toMatchObject({ parent: root.id, access: 'read-write', timing: { certainty: 'observed', sequence: 3 }, live: true, upload: false });
  expect(resolver.graph().edges).toContainEqual({ from: child.id, to: alias.id, kind: 'observed-before' });
  expect(resolver.graph().status).toBe('incomplete');
});
