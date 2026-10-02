import { expect, it } from 'vitest';
import { discover } from './discover.js';
import { createDependencyResolver } from './resolver.js';

const b = (value: string) => new TextEncoder().encode(value);

it.each(['dnn_processing', 'dnn_detect', 'dnn_classify', 'sr', 'derain'])('defers backend-dependent %s model reads without treating tensor names as files', filter => {
  const plan = discover('ffmpeg', ['-vf', `${filter}=model='https\\://example.test/model':input=tensor_in:output=tensor_out`, 'out.nut'].map(b));
  expect(plan.dependencies.filter(item => item.role === 'filter-resource').map(item => [item.value, item.kind])).toEqual([
    [b('https://example.test/model'), 'resource-lookup'],
  ]);
  expect(plan.deferred).toContainEqual({ index: 0, reason: 'filter-runtime' });
});

it.each(['dnn_detect', 'dnn_classify'])('predicts literal %s labels separately from model backend selection', filter => {
  const plan = discover('ffmpeg', ['-filter_complex', `${filter}=labels='pipe\\:3':model=model.xml`, 'out.nut'].map(b));
  expect(plan.dependencies.filter(item => item.role === 'filter-resource').map(item => [item.value, item.kind, item.literal])).toEqual([
    [b('pipe:3'), 'path', true], [b('model.xml'), 'resource-lookup', false],
  ]);
});

it('keeps slash-loaded model bytes as a deferred backend read and labels as literal filenames', async () => {
  const plan = discover('ffmpeg', ['-vf', 'dnn_detect=/model=model.option:/labels=labels.option', 'out.nut'].map(b));
  const resolver = await createDependencyResolver(plan, { cwd: b('/work'), budgets: { nodes: 100, bytes: 10000, depth: 10, symlinks: 10 } });
  const model = resolver.graph().nodes.find(item => item.filterReader?.name === 'model')!;
  const labels = resolver.graph().nodes.find(item => item.filterReader?.name === 'labels')!;
  const filename = Uint8Array.from([255, ...b('model,one.xml')]);
  expect((await resolver.content(model.id, { content: filename })).map(item => [item.original, item.kind])).toEqual([[filename, 'resource-lookup']]);
  expect((await resolver.content(labels.id, { content: b('pipe:3\0ignored') })).map(item => [item.original, item.literal])).toEqual([[b('pipe:3'), true]]);
});
