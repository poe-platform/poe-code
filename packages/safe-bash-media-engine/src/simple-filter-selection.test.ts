import { expect, it } from 'vitest';
import { discover } from './discover.js';
import { createDependencyResolver } from './resolver.js';

const b = (value: string) => new TextEncoder().encode(value);

it.each([
  ['-vf', 'lut3d=file=unused.cube', '-vf', 'null'],
  ['-vf', 'lut3d=file=unused.cube', '-filter:v', 'null'],
  ['-filter:v', 'lut3d=file=unused.cube', '-vf', 'null'],
  ['-filter:v:0', 'lut3d=file=unused.cube', '-filter:v:0', 'null'],
  ['-af', 'arnndn=m=unused.rnnn', '-filter:a', 'anull'],
])('does not predict initialization reads from a replaced simple filter: %j', (...options) => {
  const argv = ['-i', 'source.mkv', ...options, 'out.mkv'].map(b);
  const plan = discover('ffmpeg', argv);
  expect(plan.dependencies.map(dependency => dependency.value)).toEqual([b('source.mkv'), b('out.mkv')]);
  expect(plan.argv).toEqual(argv);
  expect(plan.groups[1].options).toHaveLength(2);
});

it('retains potentially different stream selections and independent output groups', () => {
  const plan = discover('ffmpeg', ['-i', 'source.mkv', '-filter:v:0', 'lut3d=file=first.cube',
    '-filter:v', 'lut3d=file=second.cube', 'first.mkv', '-vf', 'lut3d=file=third.cube', 'second.mkv'].map(b));
  expect(plan.dependencies.map(dependency => dependency.value)).toEqual([
    b('source.mkv'), b('first.cube'), b('second.cube'), b('first.mkv'), b('third.cube'), b('second.mkv'),
  ]);
});

it('retains every complex graph rather than treating it as a replaced simple filter', () => {
  const plan = discover('ffmpeg', ['-filter_complex', 'movie=first.mp4', '-filter_complex', 'movie=second.mp4'].map(b));
  expect(plan.dependencies.map(dependency => dependency.value)).toEqual([b('first.mp4'), b('second.mp4')]);
});

it('retains replaced option-file reads without predicting initialization of their discarded graph', async () => {
  const plan = discover('ffmpeg', ['-i', 'source.mkv', '-/vf', 'unused.graph', '-filter:v', 'null', 'out.mkv'].map(b));
  expect(plan.dependencies[1]).toMatchObject({ role: 'option-file', optionReader: { discardValue: true } });
  const resolver = await createDependencyResolver(plan, { cwd: b('/work'),
    budgets: { nodes: 20, bytes: 1000, depth: 5, symlinks: 5 } });
  const file = resolver.graph().nodes.find(node => node.index === 2)!;
  expect(await resolver.content(file.id, { content: b('lut3d=file=unused.cube') })).toEqual([]);
});

it('lets a later indirect filter replace an inline graph without interpreting its filename', () => {
  const plan = discover('ffmpeg', ['-i', 'source.mkv', '-vf', 'lut3d=file=unused.cube', '-/filter:v', 'selected.graph', 'out.mkv'].map(b));
  expect(plan.dependencies.map(dependency => dependency.value)).toEqual([b('source.mkv'), b('selected.graph'), b('out.mkv')]);
});
