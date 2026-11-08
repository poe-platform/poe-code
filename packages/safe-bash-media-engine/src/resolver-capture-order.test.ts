import { expect, it } from 'vitest';
import { DependencyResolver } from './resolver.js';

const b = (value: string) => new TextEncoder().encode(value);
const options = { cwd: b('/work'), budgets: { nodes: 100, bytes: 100000, depth: 10, symlinks: 10 } };

it('connects changed captures in submission order without collapsing shared reads', async () => {
  const resolver = new DependencyResolver(options);
  const root = await resolver.add({ value: b('lists/root'), access: 'read', grammar: 'concat' });
  const [first] = await resolver.content(root.id, { content: b("file 'Case雪.ppm'\n") });
  const [second] = await resolver.content(root.id, { content: b("file 'Case雪.ppm'\n") });
  const output = await resolver.add({ value: b('lists/Case雪.ppm'), access: 'write' });
  expect(first.location).toEqual(second.location);
  expect(second.location).toEqual(output.location);
  expect(resolver.graph().edges).toContainEqual({ from: first.id, to: second.id, kind: 'before' });
  expect(resolver.graph().edges).toContainEqual({ from: second.id, to: output.id, kind: 'before' });
  expect(resolver.graph().nodes.every(node => node.live && !node.upload)).toBe(true);
});

it('orders a protocol expansion before the following optional alias access', async () => {
  const resolver = new DependencyResolver(options);
  await resolver.add({ value: b('concat:Case.ppm|case.ppm'), access: 'read' });
  const output = await resolver.add({ value: b('case.ppm'), access: 'read-write', optional: true });
  expect(resolver.graph().edges).toContainEqual({ from: output.id - 1, to: output.id, kind: 'before' });
  expect(output.timing.certainty).toBe('predicted');
});

it('does not claim predicted capture ordering as observed native timing', async () => {
  const resolver = new DependencyResolver(options);
  const first = await resolver.observe({ value: b('Case.ppm'), access: 'read', sequence: 3 });
  const predicted = await resolver.add({ value: b('case.ppm'), access: 'read', optional: true });
  const next = await resolver.observe({ value: b('Case.ppm'), access: 'write', sequence: 4 });
  expect(resolver.graph().edges.filter(edge => edge.kind === 'observed-before')).toEqual([
    { from: first.id, to: next.id, kind: 'observed-before' },
  ]);
  expect(resolver.graph().edges.some(edge => edge.kind === 'before' && edge.to === next.id)).toBe(false);
  expect(predicted.timing.certainty).toBe('predicted');
});
