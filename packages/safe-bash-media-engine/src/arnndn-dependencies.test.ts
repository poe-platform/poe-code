import { expect, it } from 'vitest';
import { discover } from './discover.js';
import { createDependencyResolver } from './resolver.js';

const b = (value: string) => new TextEncoder().encode(value);
const options = { cwd: b('/work'), budgets: { nodes: 100, bytes: 100000, depth: 10, symlinks: 10 } };

it.each(['voice.rnnn', 'model=voice.rnnn', 'm=voice.rnnn'])('predicts arnndn model syntax %s independently of native execution', value => {
  const plan = discover('ffmpeg', ['-af', `arnndn=${value}`, 'out.wav'].map(b));
  expect(plan.dependencies.filter(dependency => dependency.role === 'filter-resource')).toEqual([
    expect.objectContaining({ value: b('voice.rnnn'), access: 'read', literal: true, kind: 'path' }),
  ]);
});

it('keeps literal model names in the filesystem namespace, including dash and protocol spellings', async () => {
  const resolver = await createDependencyResolver(discover('ffmpeg', ['-af', "arnndn=m='pipe\\:3',arnndn=m='https\\://host/model',arnndn=-", 'out.wav'].map(b)), options);
  expect(resolver.graph().nodes.filter(node => node.access === 'read').map(node => [node.original, node.kind, node.literal, node.location])).toEqual([
    [b('pipe:3'), 'path', true, b('/work/pipe:3')],
    [b('https://host/model'), 'path', true, b('/work/https://host/model')],
    [b('-'), 'path', true, b('/work/-')],
  ]);
});

it('applies observed model option bytes without retokenizing or probing streams', async () => {
  const resolver = await createDependencyResolver(discover('ffmpeg', ['-af', 'arnndn=/m=elsewhere/name', 'out.wav'].map(b)), options);
  const loaded = resolver.graph().nodes.find(node => node.filterReader?.filter === 'arnndn')!;
  const value = Uint8Array.from([255, ...b("voice,one;two'.rnnn")]);
  const children = await resolver.content(loaded.id, { content: Uint8Array.from([...value, 0, ...b('ignored')]) });
  expect(children.map(node => [node.original, node.location, node.access, node.literal])).toEqual([
    [value, Uint8Array.from([...b('/work/'), ...value]), 'read', true],
  ]);
  expect(resolver.graph().status).toBe('live');
});

it('retains runtime model changes as late reads and does not invent a model from mix', () => {
  const plan = discover('ffprobe', ['-f', 'lavfi', '-i', 'amovie=voice.wav,arnndn=m=voice.rnnn:mix=0.5'].map(b));
  expect(plan.dependencies.map(dependency => dependency.value)).toEqual([b('voice.wav'), b('voice.rnnn')]);
  expect(plan.deferred).toContainEqual({ index: -1, reason: 'native-access' });
  expect(plan.deferred.some(item => item.reason === 'filter-runtime')).toBe(true);
});
