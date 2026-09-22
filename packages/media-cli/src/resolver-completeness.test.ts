import { expect, it } from 'vitest';
import { discover, discoverImageMagick } from './index.js';
import { createDependencyResolver, DependencyResolver } from './resolver.js';

const b = (value: string) => new TextEncoder().encode(value);
const t = (value: Uint8Array) => new TextDecoder().decode(value);
const options = { cwd: b('/work'), budgets: { nodes: 100, bytes: 100000, depth: 10, symlinks: 10 } };

it.each(['magick', 'magick-script', 'convert'])('preserves %s concatenate deletion predictions independently of observed effects', async tool => {
  const argv = ['-concatenate', 'first.bin', 'missing.bin', 'second.bin', 'out.bin'].map(b);
  const resolver = await createDependencyResolver(await discoverImageMagick(tool, argv), options);
  expect(resolver.graph().nodes.map(node => [t(node.original), node.access, node.timing.certainty])).toEqual([
    ['out.bin', 'write', 'predicted'],
    ['first.bin', 'read-delete', 'predicted'],
    ['missing.bin', 'read-delete', 'predicted'],
    ['second.bin', 'read-delete', 'predicted'],
  ]);
  const observed = await resolver.observe({ value: b('out.bin'), access: 'write', sequence: 1 });
  expect(observed.timing).toMatchObject({ certainty: 'observed', sequence: 1 });
  expect(resolver.graph().nodes.filter(node => node.timing.certainty === 'observed')).toEqual([observed]);
});

it.each(['ffmpeg', 'ffprobe'] as const)('retains %s unknown grammar as an incomplete advisory graph', async tool => {
  const resolver = await createDependencyResolver(discover(tool, ['-unknown-resolver-fixture', 'pipe:0'].map(b)), options);
  expect(resolver.graph().status).toBe('incomplete');
  expect(resolver.graph().issues).toContainEqual(expect.objectContaining({ reason: 'syntax', detail: expect.stringContaining('unknown-option') }));
  expect(resolver.graph().nodes).toEqual([]);
});

it('retains missing values and native obligations without losing earlier input occurrences', async () => {
  const resolver = await createDependencyResolver(discover('ffmpeg', ['-i', 'Case雪\n.ppm', '-filter_complex'].map(b)), options);
  const graph = resolver.graph();
  expect(graph.status).toBe('incomplete');
  expect(graph.issues).toContainEqual(expect.objectContaining({ reason: 'syntax', detail: expect.stringContaining('missing-value') }));
  expect(graph.issues).toContainEqual(expect.objectContaining({ reason: 'live', detail: expect.stringContaining('native-access') }));
  expect(graph.nodes.map(node => [t(node.original), node.access, node.live, node.upload])).toEqual([['Case雪\n.ppm', 'read', true, false]]);
});

it('preserves ImageMagick grammar failures and earlier predicted writes', async () => {
  const discovery = await discoverImageMagick('magick', ['xc:red', '-write', 'Case雪\n.ppm', '-unknown-resolver-fixture', 'out.ppm'].map(b));
  const resolver = await createDependencyResolver(discovery, options);
  expect(resolver.graph().status).toBe('incomplete');
  expect(resolver.graph().issues).toContainEqual(expect.objectContaining({ reason: 'syntax', detail: expect.stringContaining('unknown option') }));
  expect(resolver.graph().nodes.find(node => t(node.original) === 'Case雪\n.ppm')?.access).toBe('write');
});

it('retains grammar failures from observed scripts alongside ordered aliasing accesses', async () => {
  const resolver = new DependencyResolver(options);
  const script = await resolver.add({ value: b('scripts/job'), access: 'read', grammar: 'magick-script' });
  const children = await resolver.content(script.id, { content: b('Case.ppm -write Case.ppm -unknown-resolver-fixture') });
  expect(children.map(node => [t(node.original), node.access])).toEqual([['Case.ppm', 'read'], ['Case.ppm', 'write']]);
  expect(resolver.graph().status).toBe('incomplete');
  expect(resolver.graph().issues).toContainEqual(expect.objectContaining({ node: script.id, reason: 'syntax', detail: expect.stringContaining('unknown option') }));
  expect(resolver.graph().issues).toContainEqual(expect.objectContaining({ node: script.id, reason: 'live', detail: expect.stringContaining('runtime dependencies') }));
});

it('marks missing ImageMagick script operands incomplete without consuming stdin', async () => {
  const resolver = new DependencyResolver(options);
  const script = await resolver.add({ value: b('pipe:0'), access: 'read', grammar: 'magick-script' });
  await resolver.content(script.id, { location: b('/work/stream'), content: b('xc:red -write') });
  expect(resolver.graph().status).toBe('incomplete');
  expect(resolver.graph().issues).toContainEqual(expect.objectContaining({ node: script.id, reason: 'syntax', detail: expect.stringContaining('missing option operand') }));
  expect(resolver.graph().nodes[0]).toMatchObject({ kind: 'descriptor', location: undefined, upload: false });
});

it('reports runtime deferrals without treating dynamic discovery as a static grammar failure', async () => {
  const resolver = await createDependencyResolver(discover('ffmpeg', ['-i', 'clip', '-vf', 'drawtext=textfile=live.txt:reload=1', 'out'].map(b)), options);
  expect(resolver.graph().status).toBe('live');
  expect(resolver.graph().issues).toContainEqual(expect.objectContaining({ reason: 'live', detail: expect.stringContaining('filter-runtime') }));
  expect(resolver.graph().nodes.every(node => node.live && !node.upload)).toBe(true);
});

it('preserves filename-list literal members and reports native expansion obligations', async () => {
  const resolver = new DependencyResolver(options);
  const list = await resolver.add({ value: b('lists/names'), access: 'read', grammar: 'magick-list' });
  const children = await resolver.content(list.id, { content: b('Case雪.ppm -unknown-resolver-fixture case.ppm') });
  expect(children.map(node => [t(node.original), t(node.location!), node.access])).toEqual([
    ['Case雪.ppm', '/work/Case雪.ppm', 'read'],
    ['-unknown-resolver-fixture', '/work/-unknown-resolver-fixture', 'read'],
    ['case.ppm', '/work/case.ppm', 'read'],
  ]);
  expect(resolver.graph().status).toBe('live');
  expect(resolver.graph().issues).toContainEqual(expect.objectContaining({ node: list.id, reason: 'live', detail: expect.stringContaining('native filename list expansion') }));
});

it('keeps observed filename-list native lookup obligations live on every changed capture', async () => {
  const resolver = new DependencyResolver(options);
  const list = await resolver.add({ value: b('lists/names'), access: 'read', grammar: 'magick-list' });
  const [first] = await resolver.content(list.id, { content: b('Case.ppm') });
  const [second] = await resolver.content(list.id, { content: b('case.ppm') });
  expect(first.id).not.toBe(second.id);
  expect(resolver.graph().status).toBe('live');
  expect(resolver.graph().issues).toContainEqual(expect.objectContaining({ node: list.id, reason: 'live', detail: expect.stringContaining('runtime filesystem bridge') }));
  expect([first, second].every(node => node.live && !node.upload)).toBe(true);
});
