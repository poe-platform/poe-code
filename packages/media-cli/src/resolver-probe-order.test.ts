import { expect, it } from 'vitest';
import { Volume } from 'memfs';
import { discover } from './discover.js';
import { resolveDependencies } from './resolver.js';
import evidence from '../test-fixtures/native/dependency-ffprobe-writer-order-native-evidence.json';

const b = (value: string) => new TextEncoder().encode(value);
const options = { cwd: b('/work'), budgets: { nodes: 100, bytes: 100000, depth: 10, symlinks: 10 } };

it.each([
  ['-i', 'Case雪\n.ppm', '-o', 'Case雪\n.ppm'],
  ['-o', 'Case雪\n.ppm', '-i', 'Case雪\n.ppm'],
])('predicts ffprobe writer initialization before input access regardless of argv order: %j', async (...argv) => {
  const volume = Volume.fromJSON({ '/work/Case雪\n.ppm': 'original sentinel' });
  const graph = await resolveDependencies(discover('ffprobe', argv.map(b)), {
    ...options, link: async path => {
      try { return volume.readlinkSync(new TextDecoder().decode(path), { encoding: 'buffer' }); }
      catch { return undefined; }
    },
  });
  expect(graph.nodes.map(node => [node.original, node.access, node.timing.stage])).toEqual([
    [b('Case雪\n.ppm'), 'write', 'output'], [b('Case雪\n.ppm'), 'read', 'input'],
  ]);
  expect(graph.edges).toContainEqual({ from: 0, to: 1, kind: 'before' });
  expect(graph.nodes[0].location).toEqual(graph.nodes[1].location);
  expect(graph.nodes.every(node => node.live && !node.upload && node.timing.certainty === 'predicted')).toBe(true);
  expect(volume.readFileSync('/work/Case雪\n.ppm', 'utf8')).toBe('original sentinel');
});

it('keeps sequential option-file reads before the ffprobe writer and delayed signed input', async () => {
  const signed = 'https://cdn/media?sig=+%2f&next=/../#fragment';
  const graph = await resolveDependencies(discover('ffprobe', [
    '-i', signed, '-o', 'Case.json', '-/show_entries', 'options/雪\nentries',
  ].map(b)), options);
  expect(graph.nodes.map(node => [node.original, node.access])).toEqual([
    [b('options/雪\nentries'), 'read'], [b('Case.json'), 'write'], [b(signed), 'read'],
  ]);
  expect(graph.nodes[2]).toMatchObject({ kind: 'url', location: b(signed), upload: false });
  expect(graph.edges.filter(edge => edge.kind === 'before')).toEqual([
    { from: 0, to: 1, kind: 'before' }, { from: 1, to: 2, kind: 'before' },
  ]);
});

it('preserves FFmpeg input-before-output evaluation for the same alias', async () => {
  const graph = await resolveDependencies(discover('ffmpeg', ['-i', 'same', 'same'].map(b)), options);
  expect(graph.nodes.map(node => node.access)).toEqual(['read', 'write']);
  expect(graph.edges).toContainEqual({ from: 0, to: 1, kind: 'before' });
});

it('reports incomplete discovery when the delayed input exceeds the node budget', async () => {
  const graph = await resolveDependencies(discover('ffprobe', ['-i', 'same', '-o', 'same'].map(b)), {
    ...options, budgets: { ...options.budgets, nodes: 1 },
  });
  expect(graph.nodes.map(node => node.access)).toEqual(['write']);
  expect(graph.status).toBe('incomplete');
  expect(graph.issues).toContainEqual(expect.objectContaining({ reason: 'budget' }));
});

// Native attempted libc calls qualify these original fixtures; no production
// module loads access traces or runs native discovery/replay.
it.each([
  ['separate', ['-i', 'Case雪\n.ppm', '-o', 'Case.json']],
  ['alias-input-first', ['-i', 'Case雪\n.ppm', '-o', 'Case雪\n.ppm']],
  ['alias-output-first', ['-o', 'Case雪\n.ppm', '-i', 'Case雪\n.ppm']],
  ['option-file', ['-i', 'Case雪\n.ppm', '-o', 'Case.json', '-/show_entries', 'options/雪\nentries']],
  ['late-missing', ['-i', 'optional-absent.ppm', '-o', 'Case.json']],
] as const)('covers independently recorded native read/write order for %s', async (id, argv) => {
  const prefix = ['-v', 'error', '-show_entries', 'stream=width,height'];
  const graph = await resolveDependencies(discover('ffprobe', [...prefix, ...argv].map(b)), options);
  const native = evidence.results.find(result => result.id === id)!;
  expect(native.paired_equal).toBe(true);
  expect(native.runs[1].argv).toEqual([...prefix, ...argv]);
  expect(native.runs[0].status).toBe(id.startsWith('alias') || id === 'late-missing' ? 1 : 0);
  const remaining = [...graph.nodes];
  const checked: number[] = [];
  for (const access of native.runs[1].accesses) {
    const path = Buffer.from(access.path_hex, 'hex');
    if (!argv.some(value => path.equals(b(value)))) continue;
    const role = (access.flags & 3) === 0 ? 'read' : (access.flags & 3) === 2 ? 'read-write' : 'write';
    const index = remaining.findIndex(node => Buffer.from(node.original).equals(path) && node.access === role);
    expect(index, `native occurrence ${role}: ${access.path_hex}`).toBeGreaterThanOrEqual(0);
    checked.push(remaining[index].id);
    remaining.splice(index, 1);
  }
  expect(remaining).toEqual([]);
  expect(checked).toEqual(graph.nodes.map(node => node.id));
  for (let index = 1; index < checked.length; index++) {
    expect(graph.edges).toContainEqual({ from: checked[index - 1], to: checked[index], kind: 'before' });
  }
});
