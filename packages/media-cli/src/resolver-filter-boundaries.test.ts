import { expect, it } from 'vitest';
import { discover } from './discover.js';
import { createDependencyResolver, DependencyResolver } from './resolver.js';
import evidence from '../tests/fixtures/native/dependency-filter-boundary-native-evidence.json';

const b = (value: string) => new TextEncoder().encode(value);
const options = { cwd: b('/work'), budgets: { nodes: 100, bytes: 100000, depth: 10, symlinks: 10 } };
const first = "lut3d=file='profiles/Case雪.cube'[out]";
const later = "lut3d=file='profiles/case雪.cube'";

it.each(['', ' ', '\n', ']'])('refuses trailing filter garbage %j instead of discovering later readers', async gap => {
  const resolver = await createDependencyResolver(discover('ffmpeg', ['-vf', first + gap + later, 'out'].map(b)), options);
  expect(resolver.graph().nodes.filter(node => node.access === 'read').map(node => node.original)).toEqual([b('profiles/Case雪.cube')]);
  expect(resolver.graph().status).toBe('incomplete');
  expect(resolver.graph().issues).toContainEqual(expect.objectContaining({ reason: 'syntax' }));
});

it.each(['filter', 'preset'] as const)('preserves %s boundaries on changed captures with cwd reader bases', async grammar => {
  const resolver = new DependencyResolver(options);
  const root = await resolver.add({ value: b('elsewhere/script'), access: 'read', grammar });
  for (const gap of ['', ';']) {
    const content = (grammar === 'preset' ? 'vf=' : '') + first + gap + later;
    const nodes = await resolver.content(root.id, { content: b(content) });
    expect(nodes.map(node => node.original)).toEqual(gap ? [b('profiles/Case雪.cube'), b('profiles/case雪.cube')] : [b('profiles/Case雪.cube')]);
    for (const node of nodes) {
      expect(node).toMatchObject({ parent: root.id, base: { kind: 'directory', value: options.cwd }, live: true, upload: false });
    }
  }
  expect(resolver.graph().status).toBe('incomplete');
});

it.each(['ffmpeg', 'ffprobe'] as const)('keeps %s lavfi reader boundaries incomplete', async tool => {
  const resolver = await createDependencyResolver(discover(tool, ['-f', 'lavfi', '-i', first + later].map(b)), options);
  expect(resolver.graph().nodes.filter(node => node.kind !== 'synthetic').map(node => node.original)).toEqual([b('profiles/Case雪.cube')]);
  expect(resolver.graph().status).toBe('incomplete');
});

it.each([',', ';', ' \n;\t'])('retains separate ordered occurrences across valid separator %j', async gap => {
  const graph = first + gap + "[out]lut3d=file='profiles/Case雪.cube'";
  const resolver = new DependencyResolver(options);
  const root = await resolver.add({ value: b('scripts/graph'), access: 'read', grammar: 'filter' });
  const nodes = await resolver.content(root.id, { content: b(graph) });
  expect(nodes.map(node => node.original)).toEqual([b('profiles/Case雪.cube'), b('profiles/Case雪.cube')]);
  expect(nodes[0].id).not.toBe(nodes[1].id);
  expect(resolver.graph().edges).toContainEqual({ from: nodes[0].id, to: nodes[1].id, kind: 'before' });
  expect(resolver.graph().status).toBe('live');
});

it('keeps quoted output labels, newline filenames, signed movie URLs and C-string termination intact', async () => {
  const resolver = new DependencyResolver(options);
  const root = await resolver.add({ value: b('scripts/graph'), access: 'read', grammar: 'filter' });
  const nodes = await resolver.content(root.id, { content: b("lut3d=file='Case雪\n.cube'[link']'one];[link']'one]movie=filename='https\\://cdn/clip?sig=+%2f#part'\0[out]garbage") });
  expect(nodes.map(node => node.original)).toEqual([b('Case雪\n.cube'), b('https://cdn/clip?sig=+%2f#part')]);
  expect(nodes[1]).toMatchObject({ kind: 'url', upload: false, live: true });
  expect(resolver.graph().status).toBe('live');
});

it.each(['second.cube', ':file=second.cube'])('refuses unnamed AVOptions after named options: %s', async suffix => {
  const graph = `lut3d=file=first.cube:${suffix};movie=filename=unreachable.mov`;
  for (const grammar of ['filter', 'preset'] as const) {
    const resolver = new DependencyResolver(options);
    const root = await resolver.add({ value: b('elsewhere/script'), access: 'read', grammar });
    const nodes = await resolver.content(root.id, { content: b((grammar === 'preset' ? 'vf=' : '') + graph) });
    expect(nodes.map(node => node.original)).toEqual([b('first.cube')]);
    expect(resolver.graph().status).toBe('incomplete');
    expect(resolver.graph().issues).toContainEqual(expect.objectContaining({ node: root.id, reason: 'syntax' }));
  }
});

it('qualifies named read occurrences against independent native traces without equating hints with native error timing', async () => {
  expect(evidence.registered_executable_match && evidence.registered_graphparser_match && evidence.fixture_hashes_unchanged).toBe(true);
  for (const result of evidence.results) {
    const [plain, traced] = result.runs;
    expect([traced.status, traced.stdout_sha256]).toEqual([plain.status, plain.stdout_sha256]);
    const resolver = await createDependencyResolver(discover('ffmpeg', result.argv.map(b)), { ...options, cwd: b(evidence.cwd) });
    const graph = resolver.graph();
    const candidates = graph.nodes.filter(node => node.access === 'read' && node.kind === 'path');
    for (const access of result.named_accesses) {
      expect(access.flags & 3).toBe(0);
      const nativeLocation = Buffer.concat([b(evidence.cwd + '/'), Buffer.from(access.path_hex, 'hex')]);
      const index = candidates.findIndex(node => Buffer.from(node.location!).equals(nativeLocation));
      expect(index, `independent native attempted read ${result.id}: ${access.path_hex}`).toBeGreaterThanOrEqual(0);
      candidates.splice(index, 1);
    }
    if (plain.status === 0) {
      expect(candidates).toEqual([]);
      expect(result.named_accesses).toHaveLength(2);
      expect(graph.status).toBe('live');
    } else {
      expect(result.named_accesses).toEqual([]);
      expect(graph.status).toBe('incomplete');
      // Native rejects the whole graph before reader initialization. Earlier
      // static hints remain predictions, never successful or observed accesses.
      expect(candidates.map(node => node.original)).toEqual([b('profiles/Case雪\n.cube')]);
    }
    expect(graph.nodes.every(node => node.live && !node.upload && node.timing.certainty === 'predicted')).toBe(true);
  }
});
