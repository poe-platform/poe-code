import { expect, it } from 'vitest';
import { discover } from './discover.js';
import { createDependencyResolver } from './resolver.js';

const b = (value: string) => new TextEncoder().encode(value);
const options = { cwd: b('/work'), budgets: { nodes: 100, bytes: 100000, depth: 10, symlinks: 10 } };

it.each(['mask.ppm', 'filename=mask.ppm', 'f=mask.ppm'])('predicts removelogo bitmap syntax %s independently of native execution', value => {
  const plan = discover('ffmpeg', ['-vf', `removelogo=${value}`, 'out.ppm'].map(b));
  expect(plan.dependencies.filter(dependency => dependency.role === 'filter-resource')).toEqual([
    expect.objectContaining({ value: b('mask.ppm'), access: 'read', literal: false, kind: 'path' }),
  ]);
});

it('keeps bitmap URL and descriptor syntax native-owned while dash is an AVIO filename', () => {
  const plan = discover('ffmpeg', ['-vf', "removelogo=f='https\\://cdn/mask?sig=+%2f',removelogo=f='pipe\\:3',removelogo=-", 'out.ppm'].map(b));
  expect(plan.dependencies.filter(dependency => dependency.role === 'filter-resource').map(dependency => [dependency.value, dependency.kind, dependency.literal])).toEqual([
    [b('https://cdn/mask?sig=+%2f'), 'url', false], [b('pipe:3'), 'descriptor', false], [b('-'), 'path', true],
  ]);
});

it('discovers loaded bitmap names without retokenizing raw bytes or changing cwd', async () => {
  const resolver = await createDependencyResolver(discover('ffmpeg', ['-vf', 'removelogo=/f=elsewhere/name', 'out.ppm'].map(b)), options);
  const loaded = resolver.graph().nodes.find(node => node.filterReader?.filter === 'removelogo')!;
  const value = Uint8Array.from([255, ...b("mask,one;two'.ppm")]);
  const children = await resolver.content(loaded.id, { content: Uint8Array.from([...value, 0, ...b('ignored')]) });
  expect(children.map(node => [node.original, node.location, node.access])).toEqual([
    [value, Uint8Array.from([...b('/work/'), ...value]), 'read'],
  ]);
});

it.each(['movie', 'amovie', 'subtitles'])('keeps %s AVIO dash resources in the file transfer namespace', async filter => {
  const resolver = await createDependencyResolver(discover('ffmpeg', ['-vf', `${filter}=filename=-`, 'out.ppm'].map(b)), options);
  const read = resolver.graph().nodes.find(node => node.access === 'read')!;
  expect(read).toMatchObject({ original: b('-'), kind: 'path', literal: true, location: b('/work/-') });
});
