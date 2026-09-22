import { expect, it } from 'vitest';
import { discover } from './discover.js';
import { discoverContent } from './content.js';
import { filterValueResource } from './resources.js';

const b = (value: string) => new TextEncoder().encode(value);

it.each(['-', 'signature%02d.bin', 'pipe\\:3', 'https\\://example.test/signature'])('predicts signature output %s as a literal runtime filename lookup', filename => {
  const plan = discover('ffmpeg', ['-i', 'in.mp4', '-vf', `signature=filename='${filename}'`, 'out.mp4'].map(b));
  const file = plan.dependencies.find(dependency => dependency.role === 'filter-resource');
  expect(file).toMatchObject({ value: b(filename.split('\\').join('')), access: 'write', literal: true, kind: 'resource-lookup', stage: 'runtime' });
  expect(plan.deferred).toContainEqual({ index: 2, reason: 'filter-runtime' });
});

it('retains signature positional options in scripts and defers names selected by native input count', () => {
  const plan = discoverContent({ kind: 'filter-script', location: b('graph.txt'), content: b('signature=off:2:signatures%02d.bin:binary') });
  expect(plan.dependencies).toEqual([expect.objectContaining({ value: b('signatures%02d.bin'), kind: 'resource-lookup', access: 'write', literal: true })]);
  expect(plan.deferred).toBe(true);
});

it('does not predict an output for a disabled empty signature filename', () => {
  expect(filterValueResource('signature', 'filename', b(''))).toBeUndefined();
});

it('keeps slash-loaded signature filenames as reads until native supplies their bytes', () => {
  expect(filterValueResource('signature', '/filename', b('name.txt'))).toEqual({ value: b('name.txt'), literal: false, filterReader: { filter: 'signature', name: 'filename' } });
  expect(filterValueResource('signature', 'filename', new Uint8Array([255, 46, 98, 105, 110]))).toMatchObject({ value: new Uint8Array([255, 46, 98, 105, 110]), literal: true, access: 'write', kind: 'resource-lookup' });
});
