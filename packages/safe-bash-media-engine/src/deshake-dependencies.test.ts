import { expect, it } from 'vitest';
import { discover } from './discover.js';
import { discoverContent } from './content.js';
import { createDependencyResolver, resolveDependencies } from './resolver.js';

const b = (value: string) => new TextEncoder().encode(value);

it.each(['motion.csv', '-', 'pipe:3', 'https:local', 'motion%03d.csv', ''])('predicts deshake literal log writes: %j', async filename => {
  const escaped = filename.replaceAll(':', '\\:');
  const discovery = discover('ffmpeg', ['-vf', `deshake=filename='${escaped}'`, '-f', 'null', '-'].map(b));
  expect(discovery.dependencies.filter(item => item.role === 'filter-resource')).toEqual([
    expect.objectContaining({ value: b(filename), access: 'write', kind: 'path', literal: true, stage: 'runtime' }),
  ]);
  const graph = await resolveDependencies(discovery, { cwd: b('/work'), budgets: { nodes: 20, bytes: 10000, depth: 5, symlinks: 5 } });
  expect(graph.nodes.find(node => node.access === 'write' && node.kind === 'path'))
    .toMatchObject({ access: 'write', kind: 'path', location: b('/work/' + filename), upload: false });
});

it('uses deshake source positions while ignoring enum constants and instance names', () => {
  const graph = 'deshake@motion=-1:-1:-1:-1:16:16:mirror:8:125:exhaustive:motion.csv:0';
  const discovery = discover('ffmpeg', ['-vf', graph, '-f', 'null', '-'].map(b));
  expect(discovery.dependencies.filter(item => item.role === 'filter-resource').map(item => [item.value, item.access])).toEqual([[b('motion.csv'), 'write']]);
});

it('retains raw log filename bytes independently of argv', () => {
  const filename = Uint8Array.from([255, 46, 99, 115, 118]);
  const graph = Uint8Array.from([...b('deshake=filename='), ...filename]);
  const discovery = discover('ffmpeg', [b('-vf'), graph, b('-f'), b('null'), b('-')]);
  graph.fill(0);
  expect(discovery.dependencies.find(item => item.role === 'filter-resource')).toMatchObject({ value: filename, literal: true, access: 'write' });
});

it('keeps a slash-loaded destination as an AVIO read before its selected literal write', async () => {
  const discovery = discover('ffmpeg', ['-vf', 'deshake=/filename=log-name.txt', '-f', 'null', '-'].map(b));
  expect(discovery.dependencies.find(item => item.role === 'filter-resource')).toMatchObject({ value: b('log-name.txt'), access: 'read', filterReader: { filter: 'deshake', name: 'filename' } });
  const resolver = await createDependencyResolver(discovery, {
    cwd: b('/work'), budgets: { nodes: 20, bytes: 10000, depth: 5, symlinks: 5 },
  });
  const root = resolver.graph().nodes.find(item => item.original.length === 'log-name.txt'.length)!;
  const children = await resolver.content(root.id, { content: b('pipe:3\0ignored.csv') });
  expect(children).toEqual([expect.objectContaining({ original: b('pipe:3'), access: 'write', literal: true, location: b('/work/pipe:3') })]);
});

it('discovers log writes from observed scripts and ffprobe lavfi without an extra probe', () => {
  const graph = b('deshake=filename=motion.csv');
  expect(discoverContent({ kind: 'filter-script', location: b('/scripts/filter'), content: graph }).dependencies)
    .toEqual([expect.objectContaining({ value: b('motion.csv'), access: 'write', literal: true })]);
  const discovery = discover('ffprobe', [b('-f'), b('lavfi'), b('testsrc2=size=64x64,deshake=filename=motion.csv')]);
  expect(discovery.dependencies).toEqual([expect.objectContaining({ value: b('motion.csv'), access: 'write', literal: true })]);
  expect(discovery.deferred).toContainEqual(expect.objectContaining({ reason: 'native-access' }));
});

it('does not invent a log output when the optional filename is unset', () => {
  expect(discover('ffmpeg', ['-vf', 'deshake', '-f', 'null', '-'].map(b)).dependencies.filter(item => item.role === 'filter-resource')).toEqual([]);
});
