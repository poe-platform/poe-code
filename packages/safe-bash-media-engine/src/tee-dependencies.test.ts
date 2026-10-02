import { expect, it } from 'vitest';
import { discover } from './discover.js';
import { resolveDependencies } from './resolver.js';

const b = (value: string) => new TextEncoder().encode(value);

it('keeps tee slave AVIO dash files distinct from explicit pipe and fd outputs', () => {
  const argv = ['-i', 'input.nut', '-map', '0:v?', '-c:v', 'copy', '-f', 'tee',
    '[f=nut]-|[f=nut]pipe:1|[f=nut]fd:|[f=image2]frame-%03d.ppm'].map(b);
  const plan = discover('ffmpeg', argv);
  expect(plan.dependencies.map(item => [item.value, item.kind, item.literal])).toEqual([
    [b('input.nut'), 'path', undefined],
    [b('-'), 'path', true],
    [b('pipe:1'), 'descriptor', undefined],
    [b('fd:'), 'descriptor', undefined],
    [b('frame-%03d.ppm'), 'pattern', undefined],
  ]);
  expect(plan.argv).toEqual(argv);
  expect(plan.deferred).toContainEqual({ index: -1, reason: 'native-access' });
});

it('resolves the tee dash file in cwd while leaving the explicit stdout pipe deferred', async () => {
  const graph = await resolveDependencies(discover('ffmpeg',
    ['-f', 'tee', '[f=nut]-|[f=nut]pipe:1'].map(b)), {
    cwd: b('/work'), budgets: { nodes: 10, bytes: 1000, depth: 5, symlinks: 5 },
  });
  expect(graph.nodes.map(node => [node.original, node.kind, node.location, node.upload])).toEqual([
    [b('-'), 'path', b('/work/-'), false],
    [b('pipe:1'), 'descriptor', undefined, false],
  ]);
  expect(graph.nodes.every(node => node.live)).toBe(true);
});
