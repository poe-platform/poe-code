import { expect, it } from 'vitest';
import { discover } from './discover.js';
import { createDependencyResolver, DependencyResolver } from './resolver.js';
import evidence from '../test-fixtures/native/dependency-filter-evaluation-native-evidence.json';

const b = (value: string) => new TextEncoder().encode(value);
const options = { cwd: b('/work'), budgets: { nodes: 100, bytes: 100000, depth: 10, symlinks: 10 } };
const graph = "lut3d=file='Case雪\n.cube',lut3d=/file=options/first:/file=options/selected:file='case雪\n.cube'";
const reads = ['options/first', 'options/selected', 'Case雪\n.cube', 'case雪\n.cube'];

it('orders graph-wide option value loads before filter initialization reads', async () => {
  const resolver = await createDependencyResolver(discover('ffmpeg', ['-vf', graph, 'out'].map(b)), options);
  expect(resolver.graph().nodes.filter(node => node.access === 'read').map(node => node.original)).toEqual(reads.map(b));
  for (const node of resolver.graph().nodes.filter(node => node.grammar === 'filter-option')) {
    expect(await resolver.content(node.id, { content: b('discarded.cube') })).toEqual([]);
  }
  expect(resolver.graph().nodes.every(node => node.live && !node.upload)).toBe(true);
});

it.each(['filter', 'preset'] as const)('preserves %s evaluation order and cwd bases across changed captures', async grammar => {
  const resolver = new DependencyResolver(options);
  const root = await resolver.add({ value: b('elsewhere/script'), access: 'read', grammar });
  const fixture = grammar === 'preset' ? graph.split('\n').join('-') : graph;
  const expected = grammar === 'preset' ? reads.map(value => value.split('\n').join('-')) : reads;
  for (const source of [fixture, fixture.replace('Case', 'Changed')]) {
    const nodes = await resolver.content(root.id, { content: b((grammar === 'preset' ? 'vf=' : '') + source) });
    expect(nodes.map(node => node.original)).toEqual(expected.map(value => b(source === fixture ? value : value.replace('Case', 'Changed'))));
    expect(nodes.map(node => node.base)).toEqual(nodes.map(() => ({ kind: 'directory', value: options.cwd })));
    for (let index = 1; index < nodes.length; index++) {
      expect(resolver.graph().edges).toContainEqual({ from: nodes[index - 1].id, to: nodes[index].id, kind: 'before' });
    }
  }
});

it('retains the ordered advisory prefix when later graph syntax is incomplete', async () => {
  const resolver = new DependencyResolver(options);
  const root = await resolver.add({ value: b('graphs/script'), access: 'read', grammar: 'filter' });
  const nodes = await resolver.content(root.id, { content: b(graph + '[out]garbage') });
  expect(nodes.map(node => node.original)).toEqual(reads.map(b));
  expect(resolver.graph().status).toBe('incomplete');
});

it('marks a budget-limited evaluation incomplete after retaining its option-load prefix', async () => {
  const resolver = new DependencyResolver({ ...options, budgets: { ...options.budgets, nodes: 3 } });
  const root = await resolver.add({ value: b('graphs/script'), access: 'read', grammar: 'filter' });
  const nodes = await resolver.content(root.id, { content: b(graph) });
  expect(nodes.map(node => node.original)).toEqual(reads.slice(0, 2).map(b));
  expect(resolver.graph()).toMatchObject({ status: 'incomplete', issues: expect.arrayContaining([expect.objectContaining({ reason: 'budget' })]) });
});

it('qualifies separate evaluation occurrences against independent native attempted reads', async () => {
  // Original fixture and two explicitly supplied captures, independent of the
  // trace. Reinitialization counts and native timing cannot be inferred from a
  // static graph. No product API reads traces or launches native discovery.
  const fixture = "lut3d=file='Case雪\n.cube',lut3d=/file=options/first:/file=options/selected:file='profiles/case雪\n.cube'";
  const resolver = new DependencyResolver({ ...options, cwd: b(evidence.cwd) });
  const root = await resolver.add({ value: b('original-inline-graph'), kind: 'synthetic', access: 'read', grammar: 'filter' });
  const first = await resolver.content(root.id, { content: b(fixture), location: b(evidence.cwd) });
  const second = await resolver.content(root.id, { content: b(fixture), location: b(evidence.cwd) });
  const expected = ['options/first', 'options/selected', 'Case雪\n.cube', 'profiles/case雪\n.cube'];
  expect(first.map(node => node.original)).toEqual(expected.map(b));
  expect(second.map(node => node.original)).toEqual(expected.map(b));
  expect(new Set([...first, ...second].map(node => node.id)).size).toBe(8);
  expect(evidence.graph).toBe(fixture);
  expect(evidence.registered_executable_match && evidence.fixtures_unchanged && evidence.equal_status_stdout).toBe(true);
  expect(evidence.runs.map(run => run.status)).toEqual([0, 0]);
  expect(evidence.runs[1].stdout_sha256).toBe(evidence.runs[0].stdout_sha256);
  const candidates = [...first, ...second];
  for (const access of evidence.runs[1].named_accesses) {
    const node = candidates.shift()!;
    expect(access.flags & 3).toBe(0);
    expect(node.access).toBe('read');
    expect(node.original).toEqual(new Uint8Array(Buffer.from(access.path_hex, 'hex')));
    expect(node.location).toEqual(new Uint8Array(Buffer.concat([b(evidence.cwd + '/'), Buffer.from(access.path_hex, 'hex')])));
    expect(node.timing.certainty).toBe('predicted');
  }
  expect(candidates).toEqual([]);
});
