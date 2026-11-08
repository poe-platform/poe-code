import { expect, it } from 'vitest';
import { discover } from './discover.js';
import { filterResources } from './resources.js';
import { createDependencyResolver } from './resolver.js';
import { filterResourceAliases } from './options.generated.js';

const b = (value: string) => new TextEncoder().encode(value);

it.each([
  ['lut3d=file=discarded.cube:file=selected.cube', ['selected.cube']],
  ['movie=discarded.wav:filename=selected.wav', ['selected.wav']],
  ['removelogo=filename=discarded.pgm:f=selected.pgm', ['selected.pgm']],
  ['arnndn=m=discarded.rnnn:model=selected.rnnn', ['selected.rnnn']],
  ['psnr=stats_file=discarded.log:f=selected.log', ['selected.log']],
  ['drawtext=textfile=discarded.txt:fontfile=font.ttf:textfile=selected.txt', ['font.ttf', 'selected.txt']],
  ['lut3d=file=discarded.cube:file=', ['']],
  ['lut3d=file=one.cube,lut3d=file=two.cube', ['one.cube', 'two.cube']],
])('predicts effective initialization resources for %s', (graph, paths) => {
  const plan = discover('ffmpeg', ['-vf', graph, 'out.raw'].map(b));
  expect(plan.dependencies.filter(item => item.role === 'filter-resource').map(item => item.value)).toEqual(paths.map(b));
  expect(plan.deferred).toContainEqual({ index: -1, reason: 'native-access' });
});

it('preserves every slash-value read while discarding replaced loaded filename predictions', async () => {
  const graph = 'lut3d=/file=first.option:/file=second.option:file=selected.cube';
  const resolver = await createDependencyResolver(discover('ffmpeg', ['-vf', graph, 'out.raw'].map(b)), {
    cwd: b('/work'), budgets: { nodes: 20, bytes: 10000, depth: 5, symlinks: 5 },
  });
  expect(resolver.graph().nodes.map(item => item.original)).toEqual(['out.raw', 'first.option', 'second.option', 'selected.cube'].map(b));
  for (const name of ['first.option', 'second.option']) {
    const loaded = resolver.graph().nodes.find(item => new TextDecoder().decode(item.original) === name)!;
    expect(await resolver.content(loaded.id, { content: b('discarded.cube') })).toEqual([]);
  }
});

it('retains only the final loaded filename after a literal assignment and repeated slash assignments', async () => {
  const resolver = await createDependencyResolver(discover('ffmpeg', ['-vf', 'lut3d=file=discarded.cube:/file=first.option:/file=selected.option', 'out.raw'].map(b)), {
    cwd: b('/work'), budgets: { nodes: 20, bytes: 10000, depth: 5, symlinks: 5 },
  });
  expect(resolver.graph().nodes.map(item => item.original)).toEqual(['out.raw', 'first.option', 'selected.option'].map(b));
  const first = resolver.graph().nodes.find(item => new TextDecoder().decode(item.original) === 'first.option')!;
  const last = resolver.graph().nodes.find(item => new TextDecoder().decode(item.original) === 'selected.option')!;
  expect(await resolver.content(first.id, { content: b('discarded.cube') })).toEqual([]);
  expect((await resolver.content(last.id, { content: b('selected.cube\0ignored') })).map(item => item.original)).toEqual([b('selected.cube')]);
});

it('preserves raw bytes and distinct case-sensitive option keys', () => {
  const graph = Uint8Array.from([...b('lut3d=file=discarded.cube:file='), 255, ...b('.cube')]);
  expect(filterResources(graph).resources.map(item => item.value)).toEqual([Uint8Array.from([255, ...b('.cube')])]);
  expect(filterResources(b('lut3d=file=selected.cube:FILE=invalid.cube')).resources.map(item => item.value)).toEqual([b('selected.cube')]);
});

it('keeps registered resource aliases immutable across invocations', () => {
  expect(Reflect.set(filterResourceAliases.arnndn, 'm', 'unregistered')).toBe(false);
  expect(filterResources(b('arnndn=model=discarded.rnnn:m=selected.rnnn')).resources.map(item => item.value)).toEqual([b('selected.rnnn')]);
});
