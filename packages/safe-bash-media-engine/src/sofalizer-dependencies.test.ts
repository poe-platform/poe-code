import { expect, it } from 'vitest';
import { discover } from './discover.js';
import { createDependencyResolver } from './resolver.js';

const b = (value: string) => new TextEncoder().encode(value);
const options = { cwd: b('/work'), budgets: { nodes: 100, bytes: 100000, depth: 10, symlinks: 10 } };

it.each(['room.sofa', 'sofa=room.sofa', 'room.sofa:2:10'])('predicts the SOFA reader from %s independently of native execution', value => {
  const plan = discover('ffmpeg', ['-af', `sofalizer=${value}`, 'out.wav'].map(b));
  expect(plan.dependencies.filter(dependency => dependency.role === 'filter-resource')).toEqual([
    expect.objectContaining({ value: b('room.sofa'), access: 'read', literal: true, kind: 'path' }),
  ]);
});

it('keeps SOFA filenames literal and only predicts the final selected value', async () => {
  const resolver = await createDependencyResolver(discover('ffmpeg', ['-af', "sofalizer=sofa=discarded:sofa='pipe\\:3',sofalizer=sofa=-", 'out.wav'].map(b)), options);
  expect(resolver.graph().nodes.filter(node => node.access === 'read').map(node => [node.original, node.location, node.literal])).toEqual([
    [b('pipe:3'), b('/work/pipe:3'), true], [b('-'), b('/work/-'), true],
  ]);
});

it('uses observed slash-loaded SOFA bytes without parsing them as another graph', async () => {
  const resolver = await createDependencyResolver(discover('ffmpeg', ['-af', 'sofalizer=/sofa=room-name', 'out.wav'].map(b)), options);
  const loaded = resolver.graph().nodes.find(node => node.filterReader?.filter === 'sofalizer')!;
  const value = Uint8Array.from([255, ...b("room,one;two'.sofa")]);
  const children = await resolver.content(loaded.id, { content: Uint8Array.from([...value, 0, ...b('ignored')]) });
  expect(children.map(node => [node.original, node.location, node.access, node.literal])).toEqual([
    [value, Uint8Array.from([...b('/work/'), ...value]), 'read', true],
  ]);
  expect(resolver.graph().status).toBe('live');
});

it('does not invent unset SOFA files or reinterpret gain as a filename', () => {
  const plan = discover('ffprobe', ['-f', 'lavfi', '-i', 'amovie=voice.wav,sofalizer=gain=2'].map(b));
  expect(plan.dependencies.map(dependency => dependency.value)).toEqual([b('voice.wav')]);
  expect(plan.deferred).toContainEqual({ index: -1, reason: 'native-access' });
});
