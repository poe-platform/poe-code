import { expect, it } from 'vitest';
import { discover } from './discover.js';
import { createDependencyResolver } from './resolver.js';

const b = (value: string) => new TextEncoder().encode(value);

it.each(['tree.dot', '-', 'pipe:3', 'https:tree', 'tree%03d.dot', ''])('predicts paletteuse literal diagnostic output %j', value => {
  const plan = discover('ffmpeg', ['-filter_complex', `paletteuse=debug_kdtree='${value.replaceAll(':', '\\:')}'`, 'out.gif'].map(b));
  expect(plan.dependencies.filter(item => item.role === 'filter-resource')).toEqual([
    expect.objectContaining({ value: b(value), access: 'write', kind: 'path', literal: true, stage: 'runtime' }),
  ]);
  expect(plan.deferred).toContainEqual({ index: -1, reason: 'native-access' });
});

it('derives paletteuse positional fields without counting enum constants', () => {
  const plan = discover('ffmpeg', ['-vf', 'paletteuse=none:2:rectangle:0:128:tree.dot', 'out.gif'].map(b));
  expect(plan.dependencies.filter(item => item.role === 'filter-resource').map(item => item.value)).toEqual([b('tree.dot')]);
});

it('keeps slash-loaded paletteuse output names as observed reads followed by literal writes', async () => {
  const resolver = await createDependencyResolver(discover('ffmpeg', ['-vf', 'paletteuse=/debug_kdtree=name.txt', 'out.gif'].map(b)), {
    cwd: b('/work'), budgets: { nodes: 20, bytes: 10000, depth: 5, symlinks: 5 },
  });
  const root = resolver.graph().nodes.find(item => Buffer.from(item.original).equals(b('name.txt')))!;
  expect(root).toMatchObject({ access: 'read', filterReader: { filter: 'paletteuse', name: 'debug_kdtree' } });
  const [output] = await resolver.content(root.id, { content: b('pipe:3\0ignored') });
  expect(output).toMatchObject({ original: b('pipe:3'), location: b('/work/pipe:3'), kind: 'path', access: 'write', literal: true });
});

it('retains only the selected paletteuse output and leaves unset output absent', () => {
  expect(discover('ffmpeg', ['-vf', 'paletteuse', 'out.gif'].map(b)).dependencies.filter(item => item.role === 'filter-resource')).toEqual([]);
  expect(discover('ffmpeg', ['-vf', 'paletteuse=debug_kdtree=discarded.dot:debug_kdtree=selected.dot', 'out.gif'].map(b)).dependencies.filter(item => item.role === 'filter-resource').map(item => item.value)).toEqual([b('selected.dot')]);
});
