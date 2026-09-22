import { expect, it } from 'vitest';
import { discover } from './discover.js';
import { createDependencyResolver, DependencyResolver } from './resolver.js';
import evidence from '../tests/fixtures/native/dependency-empty-graph-native-evidence.json';

const b = (value: string) => new TextEncoder().encode(value);
const options = { cwd: b('/work'), budgets: { nodes: 100, bytes: 100000, depth: 10, symlinks: 10 } };

it.each(['', ' \t\r\n', '\0lut3d=file=unreachable.cube', ' \t\0movie=https://cdn/clip?sig=+%2f#part', 'sws_flags=bilinear;', ' sws_flags=bilinear; \t', 'sws_flags=bilinear'])('marks an empty native filter C string %j incomplete without discovering its suffix', async graph => {
  const resolver = new DependencyResolver(options);
  const root = await resolver.add({ value: b('elsewhere/script'), access: 'read', grammar: 'filter' });
  const content = b(graph);
  const original = content.slice();
  expect(await resolver.content(root.id, { content })).toEqual([]);
  expect(content).toEqual(original);
  expect(resolver.graph().status).toBe('incomplete');
  expect(resolver.graph().issues).toContainEqual(expect.objectContaining({ node: root.id, reason: 'syntax' }));
  expect(resolver.graph().nodes).toEqual([root]);
});

it.each(['ffmpeg', 'ffprobe'] as const)('retains empty %s lavfi sources as live occurrences with advisory syntax diagnostics', async tool => {
  const resolver = await createDependencyResolver(discover(tool, ['-f', 'lavfi', '-i', ''].map(b)), options);
  expect(resolver.graph().nodes).toHaveLength(1);
  expect(resolver.graph().nodes[0]).toMatchObject({ kind: 'synthetic', live: true, upload: false, original: b('') });
  expect(resolver.graph().status).toBe('incomplete');
  expect(resolver.graph().issues).toContainEqual(expect.objectContaining({ reason: 'syntax' }));
});

it('retains empty preset graphs and allows a later changed script capture', async () => {
  const resolver = new DependencyResolver(options);
  const preset = await resolver.add({ value: b('presets/job'), access: 'read', grammar: 'preset' });
  expect(await resolver.content(preset.id, { content: b('vf=\n') })).toEqual([]);
  expect(resolver.graph().status).toBe('incomplete');
  const script = await resolver.add({ value: b('elsewhere/script'), access: 'read', grammar: 'filter' });
  await resolver.content(script.id, { content: b('') });
  const children = await resolver.content(script.id, { content: b("lut3d=file='Case雪\n.cube',graphmonitor") });
  expect(children).toHaveLength(1);
  const [read] = children;
  expect(read.original).toEqual(b('Case雪\n.cube'));
  expect(read.location).toEqual(b('/work/Case雪\n.cube'));
  expect(read).toMatchObject({ access: 'read', parent: script.id, live: true, upload: false });
});

it('preserves ordered input/output aliases alongside an empty inline graph diagnostic', async () => {
  const resolver = await createDependencyResolver(discover('ffmpeg', ['-i', 'Case雪\n.ppm', '-vf', '', 'Case雪\n.ppm'].map(b)), options);
  const graph = resolver.graph();
  expect(graph.status).toBe('incomplete');
  expect(graph.nodes.map(node => [node.original, node.access, node.timing.stage])).toEqual([
    [b('Case雪\n.ppm'), 'read', 'input'], [b('Case雪\n.ppm'), 'write', 'output'],
  ]);
  expect(graph.edges).toContainEqual({ from: 0, to: 1, kind: 'before' });
});

it.each([',', ';', ', \t\r\n', '; \t\r\n'])('retains the native accepted trailing separator %j', async suffix => {
  const resolver = new DependencyResolver(options);
  const root = await resolver.add({ value: b('scripts/job'), access: 'read', grammar: 'filter' });
  const [child] = await resolver.content(root.id, { content: b('movie=filename=https\\\\://cdn/clip?sig=+%2f#part' + suffix) });
  expect(child.original).toEqual(b('https://cdn/clip?sig=+%2f#part'));
  expect(child.kind).toBe('url');
  expect(child.upload).toBe(false);
  expect(resolver.graph().status).toBe('live');
});

it('qualifies scaler-prefix reads against independent native access occurrences', async () => {
  expect(evidence.registered_executable_match).toBe(true);
  expect(evidence.registered_graphparser_match).toBe(true);
  expect(evidence.fixturesUnchanged).toBe(true);
  let checked = 0;
  for (const sample of evidence.results) {
    expect(sample.equalStatusStdout).toBe(true);
    const resolver = new DependencyResolver({ ...options, cwd: b(evidence.cwd) });
    const root = await resolver.add({ value: b('elsewhere/script'), access: 'read', grammar: 'filter' });
    const children = await resolver.content(root.id, { content: b(sample.graph) });
    const reads = sample.runs[1].accesses.filter(access => !Buffer.from(access.path_hex, 'hex').toString().startsWith('/'));
    const candidates = [...children];
    for (const access of reads) {
      // O_CLOEXEC is retained in the native evidence; O_ACCMODE is read-only.
      expect(access.flags & 3).toBe(0);
      const location = Buffer.concat([b(evidence.cwd + '/'), Buffer.from(access.path_hex, 'hex')]);
      const index = candidates.findIndex(node => node.access === 'read' && Buffer.from(node.location!).equals(location));
      expect(index, `independent native read: ${access.path_hex}`).toBeGreaterThanOrEqual(0);
      candidates.splice(index, 1);
      checked++;
    }
    expect(candidates).toEqual([]);
    expect(sample.runs[0].status).toBe(reads.length ? 0 : 234);
    expect(resolver.graph().status).toBe(reads.length ? 'live' : 'incomplete');
  }
  expect(checked).toBe(2);
});
