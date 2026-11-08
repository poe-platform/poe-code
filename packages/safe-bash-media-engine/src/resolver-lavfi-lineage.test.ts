import { expect, it } from 'vitest';
import { discover } from './discover.js';
import { resolveDependencies } from './resolver.js';

const b = (value: string) => new TextEncoder().encode(value);
const options = { cwd: b('/work'), budgets: { nodes: 100, bytes: 100000, depth: 10, symlinks: 10 } };

// Native AVIO diagnostics are recorded separately in docs/remote-media/
// js-resolver-lavfi-qualification-20260918.json; never loaded by the resolver.
it.each(['ffmpeg', 'ffprobe'] as const)('preserves the native-qualified %s Unicode movie operand', async tool => {
  const graph = await resolveDependencies(discover(tool, ['-f', 'lavfi', '-i', 'movie=Case-resolver-雪.ppm'].map(b)), options);
  expect(graph.nodes[1]).toMatchObject({ original: b('Case-resolver-雪.ppm'), parent: 0, location: b('/work/Case-resolver-雪.ppm'), access: 'read', live: true, upload: false });
});

it.each(['ffmpeg', 'ffprobe'] as const)('links %s lavfi reads to their synthetic reader without making the graph a path base', async tool => {
  const source = 'movie=Case.ppm,drawtext=textfile=live.txt:reload=1';
  const graph = await resolveDependencies(discover(tool, ['-f', 'lavfi', '-i', source].map(b)), options);
  const reader = graph.nodes.find(node => node.kind === 'synthetic')!;
  const resources = graph.nodes.filter(node => node.kind !== 'synthetic');
  expect(resources.map(node => [node.original, node.parent, node.location])).toEqual([
    [b('Case.ppm'), reader.id, b('/work/Case.ppm')],
    [b('live.txt'), reader.id, b('/work/live.txt')],
  ]);
  expect(graph.edges).toContainEqual({ from: reader.id, to: resources[0].id, kind: 'depends-on' });
  expect(graph.edges).toContainEqual({ from: resources[0].id, to: resources[1].id, kind: 'before' });
  expect(resources.every(node => node.live && !node.upload && node.base.kind === 'directory')).toBe(true);
});

it('keeps shared lavfi operands under each reader and preserves its protocol policy and signed bytes', async () => {
  const source = "movie=filename='https\\://cdn/clip?sig=+%2f#part'";
  const graph = await resolveDependencies(discover('ffmpeg', [
    '-f', 'lavfi', '-protocol_whitelist', 'https', '-i', source,
    '-f', 'lavfi', '-protocol_blacklist', 'https', '-i', source,
    'out.ppm',
  ].map(b)), options);
  const readers = graph.nodes.filter(node => node.kind === 'synthetic');
  const resources = graph.nodes.filter(node => node.kind === 'url');
  expect(resources.map(node => node.parent)).toEqual(readers.map(node => node.id));
  expect(resources.map(node => node.original)).toEqual([b('https://cdn/clip?sig=+%2f#part'), b('https://cdn/clip?sig=+%2f#part')]);
  expect(resources.map(node => node.policy)).toEqual([{ allow: ['https'], deny: undefined }, { allow: undefined, deny: ['https'] }]);
  expect(graph.issues.filter(issue => issue.reason === 'policy').map(issue => issue.node)).toEqual([resources[1].id]);
  expect(graph.nodes.at(-1)).toMatchObject({ original: b('out.ppm'), access: 'write' });
});

it('reports an incomplete graph when inline source expansion exhausts its explicit budget', async () => {
  const graph = await resolveDependencies(discover('ffmpeg', [
    '-f', 'lavfi', '-i', 'movie=Case.ppm,drawtext=textfile=live.txt:reload=1', 'out.ppm',
  ].map(b)), { ...options, budgets: { ...options.budgets, nodes: 2 } });
  expect(graph.nodes.map(node => node.original)).toEqual([
    b('movie=Case.ppm,drawtext=textfile=live.txt:reload=1'), b('Case.ppm'),
  ]);
  expect(graph.status).toBe('incomplete');
  expect(graph.issues).toContainEqual(expect.objectContaining({ reason: 'budget' }));
});
