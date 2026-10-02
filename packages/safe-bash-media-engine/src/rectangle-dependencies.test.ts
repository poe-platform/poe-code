import { expect, it } from 'vitest';
import { discover } from './discover.js';
import { filterResources, filterValueResource } from './resources.js';
import { createDependencyResolver } from './resolver.js';

const b = (value: string) => new TextEncoder().encode(value);

it.each([
  ['find_rect', 'object'], ['cover_rect', 'cover'],
])('predicts %s bitmap operands in named, positional and loaded syntax', async (filter, field) => {
  for (const expression of [`${filter}=bitmap.ppm`, `${filter}=${field}=bitmap.ppm`]) {
    const plan = discover('ffmpeg', ['-i', 'source.ppm', '-vf', expression, 'out.ppm'].map(b));
    expect(plan.dependencies.map(item => [item.role, item.value, item.access])).toEqual([
      ['input', b('source.ppm'), 'read'], ['filter-resource', b('bitmap.ppm'), 'read'], ['output', b('out.ppm'), 'write'],
    ]);
  }
  const resolver = await createDependencyResolver(discover('ffmpeg', ['-vf', `${filter}=/${field}=options/name`, 'out.ppm'].map(b)), {
    cwd: b('/work'), budgets: { nodes: 100, bytes: 10000, depth: 10, symlinks: 10 },
  });
  const loaded = resolver.graph().nodes.find(node => node.filterReader?.name === field)!;
  const [bitmap] = await resolver.content(loaded.id, { content: b('bitmap.ppm\0unread.ppm') });
  expect(bitmap).toMatchObject({ original: b('bitmap.ppm'), location: b('/work/bitmap.ppm'), access: 'read', live: true, upload: false });
});

it.each([['find_rect', 'object'], ['cover_rect', 'cover']])('retains %s image-loader AVIO semantics and raw filename bytes', (filter, field) => {
  expect(filterValueResource(filter, field, b('-'))).toEqual({ value: b('-'), literal: true });
  expect(filterValueResource(filter, field, b('pipe:3'))).toEqual({ value: b('pipe:3'), literal: false });
  const value = new Uint8Array([...b(`${filter}=${field}=`), 255, ...b('.ppm')]);
  expect(filterResources(value).resources).toEqual([{ value: new Uint8Array([255, ...b('.ppm')]), literal: false }]);
});

it('does not interpret rectangle thresholds or modes as bitmap paths', () => {
  expect(filterResources(b('find_rect=object=one.ppm:threshold=0.5,cover_rect=cover=two.ppm:mode=cover')).resources.map(item => item.value)).toEqual([b('one.ppm'), b('two.ppm')]);
});
