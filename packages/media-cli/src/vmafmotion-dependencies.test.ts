import { expect, it } from 'vitest';
import { discover } from './discover.js';
import { createDependencyResolver } from './resolver.js';

const b = (value: string) => new TextEncoder().encode(value);
const options = { cwd: b('/work'), budgets: { nodes: 100, bytes: 100000, depth: 10, symlinks: 10 } };

it.each(['stats_file=motion.txt', 'motion.txt'])('predicts vmafmotion output %s independently of execution', value => {
  const plan = discover('ffmpeg', ['-vf', `vmafmotion=${value}`, 'out.ppm'].map(b));
  expect(plan.dependencies.filter(dependency => dependency.role === 'filter-resource')).toEqual([
    expect.objectContaining({ value: b('motion.txt'), access: 'write', literal: true, kind: 'path' }),
  ]);
});

it('distinguishes native stdout from literal URL, descriptor and pattern spellings', () => {
  const plan = discover('ffmpeg', ['-vf', "vmafmotion=stats_file=-,vmafmotion=stats_file='pipe\\:3',vmafmotion=stats_file='https\\:motion%02d.txt'", 'out.ppm'].map(b));
  expect(plan.dependencies.filter(dependency => dependency.role === 'filter-resource').map(dependency => [dependency.value, dependency.access, dependency.kind, dependency.literal])).toEqual([
    [b('-'), 'write', 'descriptor', false],
    [b('pipe:3'), 'write', 'path', true],
    [b('https:motion%02d.txt'), 'write', 'path', true],
  ]);
});

it('keeps the optional statistics output absent when its option is unset', () => {
  const plan = discover('ffmpeg', ['-vf', 'vmafmotion', 'out.ppm'].map(b));
  expect(plan.dependencies.filter(dependency => dependency.role === 'filter-resource')).toEqual([]);
});

it('reads a slash-loaded destination as AVIO then discovers a literal raw-byte write in cwd', async () => {
  const resolver = await createDependencyResolver(discover('ffmpeg', ['-vf', 'vmafmotion=/stats_file=elsewhere/name', 'out.ppm'].map(b)), options);
  const loaded = resolver.graph().nodes.find(node => node.filterReader?.filter === 'vmafmotion')!;
  expect(loaded).toMatchObject({ access: 'read', location: b('/work/elsewhere/name') });
  const name = Uint8Array.from([255, ...b("motion,one;two'%02d.txt")]);
  const children = await resolver.content(loaded.id, { content: Uint8Array.from([...name, 0, ...b('ignored')]) });
  expect(children.map(node => [node.original, node.location, node.access, node.kind])).toEqual([
    [name, Uint8Array.from([...b('/work/'), ...name]), 'write', 'path'],
  ]);
});
