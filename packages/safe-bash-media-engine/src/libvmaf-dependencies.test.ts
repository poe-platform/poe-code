import { expect, it } from 'vitest';
import { discover } from './discover.js';
import { discoverContent } from './content.js';
import { createDependencyResolver } from './resolver.js';

const b = (value: string) => new TextEncoder().encode(value);

it.each(['log_path=metrics.json', 'metrics.json', 'metrics.json:json:mean:1:1'])('predicts the libvmaf log writer from %s', value => {
  const plan = discover('ffmpeg', ['-filter_complex', `[0:v][1:v]libvmaf@quality=${value}`, 'out.raw'].map(b));
  expect(plan.dependencies.filter(dependency => dependency.role === 'filter-resource')).toEqual([
    expect.objectContaining({ value: b('metrics.json'), access: 'write', literal: true, kind: 'path', stage: 'runtime' }),
  ]);
});

it.each(['-', 'pipe\\:3', 'https\\:metrics', 'metrics%03d.json'])('keeps the libvmaf log %s in the literal file namespace', name => {
  const value = name.replaceAll('\\', '');
  const plan = discover('ffmpeg', ['-filter_complex', `[0:v][1:v]libvmaf=log_path='${name}'`, 'out.raw'].map(b));
  expect(plan.dependencies.filter(dependency => dependency.role === 'filter-resource')).toEqual([
    expect.objectContaining({ value: b(value), access: 'write', literal: true, kind: 'path' }),
  ]);
});

it('keeps unset logs absent and explicit empty log names present for native application', () => {
  expect(discover('ffmpeg', ['-vf', 'libvmaf', 'out'].map(b)).dependencies.filter(dependency => dependency.role === 'filter-resource')).toEqual([]);
  expect(discover('ffmpeg', ['-vf', 'libvmaf=log_path=', 'out'].map(b)).dependencies.filter(dependency => dependency.role === 'filter-resource')).toEqual([
    expect.objectContaining({ value: b(''), access: 'write', literal: true }),
  ]);
});

it('preserves raw log bytes in observed filter scripts and presets', () => {
  const filename = Uint8Array.from([255, ...b('.json')]);
  for (const kind of ['filter-script', 'preset'] as const) {
    const content = Uint8Array.from([...b((kind === 'preset' ? 'filter_complex=' : '') + '[0:v][1:v]libvmaf=log_path='), ...filename]);
    const plan = discoverContent({ kind, location: b('elsewhere/graph'), content });
    expect(plan.dependencies).toEqual([
      expect.objectContaining({ value: filename, access: 'write', literal: true, kind: 'path', base: 'cwd' }),
    ]);
  }
});

it('expands an observed slash-loaded log name without parsing its bytes as a graph', async () => {
  const resolver = await createDependencyResolver(discover('ffmpeg', ['-filter_complex', '[0:v][1:v]libvmaf=/log_path=elsewhere/name', 'out.raw'].map(b)), {
    cwd: b('/work'), budgets: { nodes: 100, bytes: 100000, depth: 10, symlinks: 10 },
  });
  const loaded = resolver.graph().nodes.find(node => node.filterReader?.filter === 'libvmaf')!;
  expect(loaded).toMatchObject({ access: 'read', location: b('/work/elsewhere/name') });
  const filename = Uint8Array.from([255, ...b("metrics,one;two'%03d.json")]);
  const children = await resolver.content(loaded.id, { content: Uint8Array.from([...filename, 0, ...b('ignored')]) });
  expect(children.map(node => [node.original, node.location, node.access, node.kind])).toEqual([
    [filename, Uint8Array.from([...b('/work/'), ...filename]), 'write', 'path'],
  ]);
});

it('discovers ffprobe lavfi log writes without probing stream metadata', () => {
  const plan = discover('ffprobe', ['-f', 'lavfi', '-i', 'testsrc2,split[a][b];[a][b]libvmaf=log_path=metrics.json'].map(b));
  expect(plan.dependencies.filter(dependency => dependency.role === 'filter-resource')).toEqual([
    expect.objectContaining({ value: b('metrics.json'), access: 'write', literal: true }),
  ]);
  expect(plan.deferred).toContainEqual({ index: -1, reason: 'native-access' });
});
