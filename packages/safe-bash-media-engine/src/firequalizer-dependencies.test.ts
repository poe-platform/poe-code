import { expect, it } from 'vitest';
import { discover } from './discover.js';
import { discoverContent } from './content.js';
import { createDependencyResolver } from './resolver.js';

const b = (value: string) => new TextEncoder().encode(value);

it('uses registered positions rather than enum constants for instance-qualified filters', () => {
  const plan = discover('ffmpeg', ['-af', "firequalizer@eq=0:'entry(0,0)':0.01:5:hann:0:0:0:linlog:dump.txt", '-f', 'null', '-'].map(b));
  expect(plan.dependencies.filter(item => item.role === 'filter-resource').map(item => [item.value, item.access])).toEqual([[b('dump.txt'), 'write']]);
});

it('predicts script and ffprobe lavfi writes from observed bytes without probing metadata', () => {
  const graph = b('anullsrc,firequalizer=dumpfile=dump.txt');
  expect(discoverContent({ kind: 'filter-script', location: b('/scripts/graph'), content: graph }).dependencies).toEqual([
    expect.objectContaining({ value: b('dump.txt'), access: 'write', literal: true }),
  ]);
  const plan = discover('ffprobe', [b('-f'), b('lavfi'), b('-i'), graph, b('-show_streams')]);
  expect(plan.dependencies).toEqual([expect.objectContaining({ value: b('dump.txt'), access: 'write', literal: true })]);
  expect(plan.deferred).toContainEqual({ index: -1, reason: 'native-access' });
});

it.each(['analysis.txt', '-', 'pipe:3', 'https://host/dump', 'dump%03d.txt', ''])('predicts firequalizer literal dump writes: %j', value => {
  const escaped = value.replaceAll(':', '\\:');
  const plan = discover('ffmpeg', ['-af', `firequalizer=dumpfile='${escaped}'`, '-f', 'null', '-'].map(b));
  expect(plan.dependencies.filter(item => item.role === 'filter-resource')).toEqual([
    expect.objectContaining({ value: b(value), access: 'write', kind: 'path', literal: true, stage: 'runtime' }),
  ]);
  expect(plan.deferred).toContainEqual({ index: 0, reason: 'filter-runtime' });
});

it('keeps raw dump paths through graph escaping and option-file observations', async () => {
  const raw = new Uint8Array([255, 58, 46, 116, 120, 116]);
  const plan = discover('ffmpeg', [b('-af'), b('firequalizer=/dumpfile=selected.txt'), b('-f'), b('null'), b('-')]);
  const resolver = await createDependencyResolver(plan, { cwd: b('/work'), budgets: { nodes: 20, bytes: 10000, depth: 5, symlinks: 5 } });
  const selected = resolver.graph().nodes.find(item => item.filterReader?.name === 'dumpfile')!;
  const children = await resolver.content(selected.id, { content: new Uint8Array([...raw, 0, ...b('ignored')]) });
  expect(children).toEqual([expect.objectContaining({ original: raw, location: new Uint8Array([...b('/work/'), ...raw]), access: 'write', literal: true })]);
});

it('does not invent dump dependencies when unset or treat gain expressions as paths', () => {
  const plan = discover('ffprobe', ['-f', 'lavfi', '-i', 'anullsrc,firequalizer=gain=0', '-show_streams'].map(b));
  expect(plan.dependencies).toEqual([]);
  expect(plan.deferred.some(item => item.reason === 'filter-runtime')).toBe(true);
});
