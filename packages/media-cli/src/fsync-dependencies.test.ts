import { expect, it } from 'vitest';
import { discover } from './discover.js';
import { createDependencyResolver } from './resolver.js';

const b = (value: string) => new TextEncoder().encode(value);

it.each(['frames.map', 'file=frames.map', 'f=frames.map', "f='https\\://host/map?sig=+%2f'", "f='pipe\\:3'"])(
  'predicts fsync AVIO reads independently: %s', value => {
    const expected = value.includes('https') ? 'https://host/map?sig=+%2f'
      : value.includes('pipe') ? 'pipe:3' : 'frames.map';
    const plan = discover('ffmpeg', ['-vf', `fsync=${value}`, 'out.nut'].map(b));
    expect(plan.dependencies.map(item => [item.value, item.access, item.kind])).toEqual([
      [b(expected), 'read', expected.startsWith('https:') ? 'url' : expected.startsWith('pipe:') ? 'descriptor' : 'path'],
      [b('out.nut'), 'write', 'path'],
    ]);
  },
);

it('retains fsync alias precedence and every slash read before the final AVIO read', async () => {
  const plan = discover('ffmpeg', ['-vf', 'fsync=/file=first.option:/f=last.option', 'out.nut'].map(b));
  expect(plan.dependencies.map(item => item.value)).toEqual([b('first.option'), b('last.option'), b('out.nut')]);
  expect(plan.dependencies[0].filterReader).toEqual({ filter: 'fsync', name: 'file', discardValue: true });
  const resolver = await createDependencyResolver(plan, {
    cwd: b('/work'), budgets: { nodes: 100, bytes: 10000, depth: 10, symlinks: 10 },
  });
  const first = resolver.graph().nodes.find(node => node.filterReader?.name === 'file')!;
  const last = resolver.graph().nodes.find(node => node.filterReader?.name === 'f')!;
  expect(await resolver.content(first.id, { content: b('discarded.map') })).toEqual([]);
  const [child] = await resolver.content(last.id, { content: b('file:frames.map\0ignored') });
  expect(child).toMatchObject({ original: b('file:frames.map'), access: 'read', kind: 'file-protocol' });
});

it('retains explicit empty and literal dash map names while preserving raw filename bytes', () => {
  const raw = Uint8Array.of(255, 128);
  for (const value of [new Uint8Array(), b('-'), raw]) {
    const graph = Uint8Array.from([...b('fsync=file='), ...value]);
    const plan = discover('ffmpeg', [b('-vf'), graph, b('out.nut')]);
    expect(plan.dependencies[0]).toMatchObject({ value, access: 'read', kind: 'path' });
    expect(plan.argv[1]).toEqual(graph);
  }
});
