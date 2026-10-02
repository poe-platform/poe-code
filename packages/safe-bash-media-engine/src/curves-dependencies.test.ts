import { expect, it } from 'vitest';
import { discover } from './discover.js';
import { discoverContent } from './content.js';
import { createDependencyResolver } from './resolver.js';

const b = (value: string) => new TextEncoder().encode(value);

it('uses offset-aware positional curve options and a literal plot output', () => {
  const plan = discover('ffmpeg', ['-vf', 'curves=none:0/0 1/1:0/0 1/1:0/0 1/1:0/0 1/1:0/0 1/1:look.acv:plot.gnuplot', 'out.ppm'].map(b));
  expect(plan.dependencies.slice(0, 2)).toMatchObject([
    { value: b('look.acv'), literal: true, access: 'read' },
    { value: b('plot.gnuplot'), literal: true, access: 'write' },
  ]);
});

it.each(['ffmpeg', 'ffprobe'] as const)('predicts %s literal Photoshop curve reads independently of native execution', async tool => {
  const argv = ['-f', 'lavfi', '-i', "color,curves=psfile='pipe\\:0'"].map(b);
  const plan = discover(tool, argv);
  expect(plan.dependencies).toMatchObject([
    { role: 'filter-resource', value: b('pipe:0'), literal: true, kind: 'path', access: 'read', stage: 'runtime' },
  ]);
  const resolver = await createDependencyResolver(plan, { cwd: b('/work'), budgets: { nodes: 20, bytes: 10000, depth: 5, symlinks: 5 } });
  expect(resolver.graph().nodes).toContainEqual(expect.objectContaining({ original: b('pipe:0'), location: b('/work/pipe:0'), live: true, upload: false }));
  expect(plan.argv).toEqual(argv);
});

it('retains raw curve filenames in scripts and selected slash-loaded values', async () => {
  const name = Uint8Array.of(255, 46, 97, 99, 118);
  const script = new Uint8Array([...b('curves=psfile='), ...name]);
  expect(discoverContent({ kind: 'filter-script', location: b('/elsewhere/filter'), content: script }).dependencies).toMatchObject([
    { value: name, literal: true, access: 'read', base: 'cwd' },
  ]);
  const resolver = await createDependencyResolver(discover('ffmpeg', ['-i', 'in.ppm', '-vf', 'curves=/psfile=selected', 'out.ppm'].map(b)), {
    cwd: b('/work'), budgets: { nodes: 20, bytes: 10000, depth: 5, symlinks: 5 },
  });
  const selected = resolver.graph().nodes.find(node => new TextDecoder().decode(node.original) === 'selected')!;
  const [read] = await resolver.content(selected.id, { content: new Uint8Array([...name, 0, ...b('ignored')]) });
  expect(read).toMatchObject({ original: name, access: 'read', live: true, upload: false });
  expect(read.location).toEqual(new Uint8Array([...b('/work/'), ...name]));
});
