import { expect, it } from 'vitest';
import { discover } from './discover.js';
import { createDependencyResolver, DependencyResolver } from './resolver.js';
import evidence from '../tests/fixtures/native/dependency-empty-filter-native-evidence.json';

const b = (value: string) => new TextEncoder().encode(value);
const options = { cwd: b('/work'), budgets: { nodes: 100, bytes: 100000, depth: 10, symlinks: 10 } };

it.each([',', ';', '[in],', '@instance,', "'',", ' ,'])('marks an empty filter %j incomplete before later readers', async prefix => {
  const resolver = new DependencyResolver(options);
  const root = await resolver.add({ value: b('elsewhere/script'), access: 'read', grammar: 'filter' });
  const content = b(prefix + "lut3d=file='Case雪\n.cube'");
  const original = content.slice();
  expect(await resolver.content(root.id, { content })).toEqual([]);
  expect(resolver.graph().status).toBe('incomplete');
  expect(resolver.graph().issues).toContainEqual(expect.objectContaining({ reason: 'syntax' }));
  expect(content).toEqual(original);
});

it.each(['filter', 'preset'] as const)('retains the ordered %s prefix and changed captures after an empty filter', async grammar => {
  const resolver = new DependencyResolver(options);
  const root = await resolver.add({ value: b('elsewhere/script'), access: 'read', grammar });
  const prefix = grammar === 'preset' ? 'vf=' : '';
  const children = await resolver.content(root.id, { content: b(prefix + "lut3d=file='Case雪.cube',,lut3d=file=case.cube") });
  expect(children.map(node => node.original)).toEqual([b('Case雪.cube')]);
  expect(children[0]).toMatchObject({ base: { kind: 'directory', value: options.cwd }, live: true, upload: false });
  const changed = await resolver.content(root.id, { content: b(prefix + 'lut3d=file=case.cube') });
  expect(changed.map(node => node.location)).toEqual([b('/work/case.cube')]);
  expect(changed[0].id).not.toBe(children[0].id);
  expect(resolver.graph().status).toBe('incomplete');
});

it.each(['ffmpeg', 'ffprobe'] as const)('propagates empty-filter diagnostics through %s lavfi discovery', async tool => {
  const resolver = await createDependencyResolver(discover(tool, ['-f', 'lavfi', '-i', ',movie=unreachable.mov'].map(b)), options);
  expect(resolver.graph().nodes.filter(node => node.kind !== 'synthetic')).toEqual([]);
  expect(resolver.graph().status).toBe('incomplete');
});

it('qualifies discovery against independent native attempted reads without treating predictions as observed timing', async () => {
  expect(evidence.registered_executable_match).toBe(true);
  expect(evidence.registered_graphparser_match).toBe(true);
  expect(evidence.fixturesUnchanged).toBe(true);
  let checked = 0;
  for (const sample of evidence.results) {
    const resolver = await createDependencyResolver(discover('ffmpeg', sample.argv.map(b)), { ...options, cwd: b(evidence.cwd) });
    const graph = resolver.graph();
    expect(sample.equalStatusStdout).toBe(true);
    expect(sample.runs.map(run => run.status)).toEqual(sample.id === 'valid' ? [0, 0] : [8, 8]);
    expect(graph.status).toBe(sample.id === 'valid' ? 'live' : 'incomplete');
    const candidates = graph.nodes.filter(node => node.access === 'read' && node.location);
    for (const access of sample.runs[1].accesses) {
      // O_CLOEXEC is independent of the native O_ACCMODE read/write bits.
      expect(access.flags & 3).toBe(0);
      const location = Buffer.concat([b(evidence.cwd + '/'), Buffer.from(access.path_hex, 'hex')]);
      const index = candidates.findIndex(node => Buffer.from(node.location!).equals(location));
      expect(index, `independent native read: ${access.path_hex}`).toBeGreaterThanOrEqual(0);
      candidates.splice(index, 1);
      checked++;
    }
    // Malformed graphs may retain an earlier predicted reader that native never
    // initializes. Trace absence does not convert that prediction into an open.
    expect(graph.nodes.every(node => node.timing.certainty === 'predicted' && node.live && !node.upload)).toBe(true);
    expect(sample.runs[1].accesses).toHaveLength(sample.id === 'valid' ? 1 : 0);
  }
  expect(checked).toBe(1);
});
