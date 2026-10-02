import { expect, it, vi } from 'vitest';
import { DependencyResolver, resolveDependencies } from './resolver.js';
import { discover } from './discover.js';

const b = (value: string) => new TextEncoder().encode(value);
const options = { cwd: b('/work'), budgets: { nodes: 100, bytes: 100000, depth: 10, symlinks: 10 } };

it.each(['pipe:0', 'fd:3', 'https:clip.wav', 'file:clip.wav', '-', '-leading.wav'])('resolves file:%s as a literal filename in cwd', async filename => {
  const argv = ['-i', `file:${filename}`, 'file:pipe:1'].map(b);
  const graph = await resolveDependencies(discover('ffmpeg', argv), options);
  expect(graph.nodes.map(node => [node.original, node.location, node.kind, node.access])).toEqual([
    [b(`file:${filename}`), b(`file:/work/${filename}`), 'file-protocol', 'read'],
    [b('file:pipe:1'), b('file:/work/pipe:1'), 'file-protocol', 'write'],
  ]);
  expect(graph.nodes.every(node => !node.upload && node.live)).toBe(true);
});

it('traverses raw file-protocol filename bytes in cwd without a second protocol lookup', async () => {
  const filename = new Uint8Array([...b('pipe:'), 255, ...b('.wav')]);
  const original = new Uint8Array([...b('file:'), ...filename]);
  const link = vi.fn(async (_path: Uint8Array) => undefined);
  const resolver = new DependencyResolver({ ...options, link });
  const node = await resolver.add({ value: original, access: 'read' });
  expect(node.original).toEqual(original);
  expect(node.location).toEqual(new Uint8Array([...b('file:/work/'), ...filename]));
  expect(link.mock.calls.map(call => call[0])).toEqual([b('/work'), new Uint8Array([...b('/work/'), ...filename])]);
  expect(node.kind).toBe('file-protocol');
});
