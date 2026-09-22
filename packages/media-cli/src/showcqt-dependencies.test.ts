import { expect, it } from 'vitest';
import { discover } from './discover.js';
import { createDependencyResolver } from './resolver.js';

const b = (value: string) => new TextEncoder().encode(value);
const options = { cwd: b('/work'), budgets: { nodes: 100, bytes: 100000, depth: 10, symlinks: 10 } };

it('predicts showcqt AVIO axis images and literal font files independently', () => {
  const plan = discover('ffmpeg', ['-filter_complex', "showcqt=axisfile='https\\://example.test/axis.ppm':fontfile='pipe\\:3'", 'out.raw'].map(b));
  expect(plan.dependencies.filter(item => item.role === 'filter-resource').map(item => [item.value, item.kind, item.literal])).toEqual([
    [b('https://example.test/axis.ppm'), 'url', false], [b('pipe:3'), 'path', true],
  ]);
});

it('retains final showcqt filenames and resolves slash-loaded raw bytes at runtime', async () => {
  const plan = discover('ffmpeg', ['-filter_complex', 'showcqt=axisfile=discarded:axisfile=-:/fontfile=font.option', 'out.raw'].map(b));
  const resolver = await createDependencyResolver(plan, options);
  expect(resolver.graph().nodes.filter(item => item.access === 'read').map(item => item.original)).toEqual([b('font.option'), b('-')]);
  const loaded = resolver.graph().nodes.find(item => item.filterReader?.name === 'fontfile')!;
  const filename = Uint8Array.from([255, ...b("font,one;two'.ttf")]);
  const children = await resolver.content(loaded.id, { content: Uint8Array.from([...filename, 0, ...b('ignored')]) });
  expect(children.map(item => [item.original, item.location, item.literal])).toEqual([
    [filename, Uint8Array.from([...b('/work/'), ...filename]), true],
  ]);
});

it('derives showcqt positional resource fields after skipping adjacent aliases', () => {
  const fields = ['64x32', '25', '8', '8', '16', '0', '16', 'sono_v', '3', '1', '1', '0.17', '0', '20', '20000', '1', '0.17', '1', '0', 'font.ttf', 'Sans', 'r(1)', 'axis.ppm'];
  const plan = discover('ffmpeg', ['-filter_complex', `showcqt=${fields.join(':')}`, 'out.raw'].map(b));
  expect(plan.dependencies.filter(item => item.role === 'filter-resource').map(item => item.value)).toEqual([b('font.ttf'), b('axis.ppm')]);
  expect(discover('ffprobe', ['-f', 'lavfi', '-i', 'amovie=in.wav,showcqt=axis=0'].map(b)).dependencies.map(item => item.value)).toEqual([b('in.wav')]);
});
