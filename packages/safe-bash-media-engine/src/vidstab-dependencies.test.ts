import { expect, it } from 'vitest';
import { discover } from './discover.js';
import { createDependencyResolver } from './resolver.js';

const b = (value: string) => new TextEncoder().encode(value);
const options = { cwd: b('/work'), budgets: { nodes: 100, bytes: 100000, depth: 10, symlinks: 10 } };

it.each([
  ['vidstabdetect', 'transforms.trf', 'write'],
  ['vidstabdetect=accuracy=5', 'transforms.trf', 'write'],
  ['vidstabdetect=motion.trf:5', 'motion.trf', 'write'],
  ['vidstabtransform', 'transforms.trf', 'read'],
  ['vidstabtransform=smoothing=0', 'transforms.trf', 'read'],
  ['vidstabtransform=motion.trf:0', 'motion.trf', 'read'],
  ['vidstabtransform=input=', '', 'read'],
  ['vidstabdetect=result=', '', 'write'],
])('predicts the stabilization file for %s independently of execution', (graph, filename, access) => {
  const plan = discover('ffmpeg', ['-vf', graph, 'out.mkv'].map(b));
  expect(plan.dependencies.filter(dependency => dependency.role === 'filter-resource')).toEqual([
    expect.objectContaining({ value: b(filename), access, literal: true, kind: 'path' }),
  ]);
});

it('retains slash reads and only the final explicit filename, with no fallback default', async () => {
  const resolver = await createDependencyResolver(discover('ffmpeg', ['-vf',
    'vidstabtransform=input=discarded:/input=first-name:input=final.trf,vidstabdetect=/result=output-name', 'out.mkv'].map(b)), options);
  expect(resolver.graph().nodes.filter(node => node.timing.stage === 'runtime').map(node => node.original)).toEqual([
    b('first-name'), b('output-name'), b('final.trf'),
  ]);
  const loaded = resolver.graph().nodes.find(node => node.filterReader?.name === 'result')!;
  const filename = Uint8Array.from([255, ...b("file:pipe:3,%02d.trf")]);
  const children = await resolver.content(loaded.id, { content: Uint8Array.from([...filename, 0, ...b('ignored')]) });
  expect(children.map(node => [node.original, node.location, node.access, node.literal])).toEqual([
    [filename, Uint8Array.from([...b('/work/'), ...filename]), 'write', true],
  ]);
});

it('keeps dash, percent and protocol-looking stabilization names in the file namespace', async () => {
  const resolver = await createDependencyResolver(discover('ffprobe', ['-f', 'lavfi', '-i',
    "testsrc,vidstabtransform=input='pipe\\:3',vidstabdetect=result=-,vidstabdetect=result=motion%02d.trf"].map(b)), options);
  expect(resolver.graph().nodes.filter(node => node.literal).map(node => [node.original, node.location, node.access])).toEqual([
    [b('pipe:3'), b('/work/pipe:3'), 'read'], [b('-'), b('/work/-'), 'write'],
    [b('motion%02d.trf'), b('/work/motion%02d.trf'), 'write'],
  ]);
});
