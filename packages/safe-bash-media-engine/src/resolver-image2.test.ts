import { expect, it } from 'vitest';
import { discover } from './discover.js';
import { resolveDependencies } from './resolver.js';

const b = (value: string) => new TextEncoder().encode(value);
const options = { cwd: b('/work'), budgets: { nodes: 100, bytes: 100000, depth: 10, symlinks: 10 } };

it.each(['file:frames%03d.ppm', 'https://example.test/frames%03d.ppm'])('predicts image2 expansion before opening the AVIO output %s', async target => {
  const graph = await resolveDependencies(discover('ffmpeg', ['-f', 'image2', target].map(b)), options);
  expect(graph.nodes[0].expression?.dialect).toBe('sequence');
  expect(graph.nodes[0].original).toEqual(b(target));
  expect(graph.nodes[0].location).toEqual(b(target));
  expect(graph.nodes[0].base).toEqual({ kind: 'directory', value: b('/work') });
});

it.each(['file:frames%Y.ppm', 'https://example.test/frames%Y.ppm'])('defers image2 clock expansion for AVIO output %s', async target => {
  const graph = await resolveDependencies(discover('ffmpeg', ['-f', 'image2', '-strftime', '1', target].map(b)), options);
  expect(graph.nodes[0].kind).toBe('resource-lookup');
  expect(graph.nodes[0].expression).toBeUndefined();
});

it.each(['ffmpeg', 'ffprobe'] as const)('predicts %s image2 AVIO input sequences without treating URLs as local globs', async tool => {
  for (const target of ['file:seq%02d.ppm', 'https://example.test/seq%02d.ppm']) {
    const sequence = await resolveDependencies(discover(tool, ['-f', 'image2', '-i', target].map(b)), options);
    expect(sequence.nodes[0].expression?.dialect).toBe('sequence');
    expect(sequence.nodes[0].original).toEqual(b(target));
    const glob = await resolveDependencies(discover(tool, ['-f', 'image2', '-pattern_type', 'glob', '-i', target].map(b)), options);
    expect(glob.nodes[0].expression).toBeUndefined();
    expect(glob.nodes[0].kind).not.toBe('glob');
  }
});

it('keeps image2 update filenames literal, ahead of strftime and frame_pts', async () => {
  const graph = await resolveDependencies(discover('ffmpeg', ['-f', 'image2', '-update', '1', '-strftime', '1', '-frame_pts', '1', 'still%03d.ppm'].map(b)), options);
  expect(graph.nodes[0]).toMatchObject({ kind: 'path', location: b('/work/still%03d.ppm') });
  expect(graph.nodes[0].expression).toBeUndefined();
});

it('defers image2 clock-derived filenames instead of treating them as frame counters', async () => {
  const graph = await resolveDependencies(discover('ffmpeg', ['-f', 'image2', '-strftime', '1', 'frame-%Y-%m-%d.ppm'].map(b)), options);
  expect(graph.nodes[0].kind).toBe('resource-lookup');
  expect(graph.nodes[0].expression).toBeUndefined();
  expect(graph.nodes[0].original).toEqual(b('frame-%Y-%m-%d.ppm'));
});

it('defers unparsed image2 filename switches and leaves native scalar parsing alone', async () => {
  for (const switches of [['-update', 'true'], ['-strftime', 'invalid']]) {
    const graph = await resolveDependencies(discover('ffmpeg', ['-f', 'image2', ...switches, 'still%03d.ppm'].map(b)), options);
    const output = graph.nodes.find(node => node.access === 'write')!;
    expect(output.kind).toBe('resource-lookup');
    expect(output.expression).toBeUndefined();
  }
});

it('uses the last image2 switch in each output group', async () => {
  const graph = await resolveDependencies(discover('ffmpeg', ['-f', 'image2', '-update', '1', '-update', '0', 'first%03d.ppm', '-f', 'image2', '-update', '1', 'second%03d.ppm'].map(b)), options);
  expect(graph.nodes.map(node => node.kind)).toEqual(['output-pattern', 'path']);
});

it('uses ffprobe global image2 pattern options, including options after the input', async () => {
  for (const [pattern, target, kind] of [
    ['glob', 'seq*.ppm', 'glob'],
    ['none', 'seq%02d.ppm', 'path'],
    ['sequence', 'seq%02d.ppm', 'filename-expression'],
  ] as const) {
    const graph = await resolveDependencies(discover('ffprobe', ['-f', 'image2', '-i', target, '-pattern_type', pattern].map(b)), options);
    expect(graph.nodes[0].kind).toBe(kind);
    expect(graph.nodes[0].original).toEqual(b(target));
    expect(graph.nodes[0].expression?.dialect).toBe(kind === 'filename-expression' ? 'sequence' : undefined);
  }
});

it('does not interpret an unobserved pattern option-file basename as its value', async () => {
  const graph = await resolveDependencies(discover('ffprobe', ['-f', 'image2', '-/pattern_type', 'glob', 'seq*.ppm'].map(b)), options);
  const input = graph.nodes.find(node => node.index === 4)!;
  expect(input.kind).toBe('path');
  expect(input.expression).toBeUndefined();
});

it('keeps image2 grammar out of side-resource filenames', async () => {
  const graph = await resolveDependencies(discover('ffmpeg', ['-f', 'image2', '-stats_enc_pre:v', 'stats%02d.txt', 'out%02d.ppm'].map(b)), options);
  expect(graph.nodes.map(node => [node.original, node.kind])).toEqual([
    [b('stats%02d.txt'), 'path'], [b('out%02d.ppm'), 'output-pattern'],
  ]);
});

it('keeps each FFmpeg input pattern mode in its own group', async () => {
  const graph = await resolveDependencies(discover('ffmpeg', ['-f', 'image2', '-pattern_type', 'glob', '-i', 'seq*.ppm', '-f', 'image2', '-pattern_type', 'none', '-i', 'seq%02d.ppm', 'out.mkv'].map(b)), options);
  expect(graph.nodes.map(node => [node.original, node.kind])).toEqual([
    [b('seq*.ppm'), 'glob'], [b('seq%02d.ppm'), 'path'], [b('out.mkv'), 'path'],
  ]);
});
