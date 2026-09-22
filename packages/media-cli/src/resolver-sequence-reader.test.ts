import { expect, it } from 'vitest';
import { discover } from './discover.js';
import { createDependencyResolver, resolveDependencies } from './resolver.js';
import { parseFilenameExpression } from './filename-expression.js';
import { Volume } from 'memfs';
import evidence from '../test-fixtures/native/dependency-sequence-reader-native-evidence.json';

const b = (value: string) => new TextEncoder().encode(value);
const options = { cwd: b('/work'), budgets: { nodes: 100, bytes: 100000, depth: 10, symlinks: 10 } };

it.each(['ffmpeg', 'ffprobe'] as const)('retains %s rejected multiple input counters as advisory live occurrences', async tool => {
  const operand = b('Case雪\n-%02d-%d.ppm');
  const graph = await resolveDependencies(discover(tool, [b('-f'), b('image2'), b('-i'), operand]), options);
  expect(graph.nodes[0]).toMatchObject({ original: operand, access: 'read', live: true, upload: false, expression: { complete: false } });
  expect(graph.status).toBe('incomplete');
});

it('keeps multiple output counters valid on an input/output alias', async () => {
  const operand = b('Case雪\n-%02d-%d.ppm');
  const graph = await resolveDependencies(discover('ffmpeg', [b('-f'), b('image2'), b('-i'), operand, b('-f'), b('image2'), operand]), options);
  expect(graph.nodes.map(node => [node.access, node.expression?.complete])).toEqual([['read', false], ['write', true]]);
  expect(graph.nodes[0].location).toEqual(graph.nodes[1].location);
  expect(graph.edges).toContainEqual({ from: 0, to: 1, kind: 'before' });
});

it.each(['https://cdn/frame-%d-%02d.ppm?sig=a+b#part', 'https://cdn/frame-%d-%02d.ppm?sig=a+%2f#part', 'https://cdn/frame-%%.ppm?sig=a+b#part'])('preserves native input fallback URL %s', async operand => {
  const graph = await resolveDependencies(discover('ffprobe', ['-f', 'image2', operand].map(b)), options);
  expect(graph.nodes[0]).toMatchObject({ original: b(operand), location: b(operand), kind: 'url', upload: false });
  expect(graph.nodes[0].expression).toBeUndefined();
  expect(graph.status).toBe('live');
});

it.each(['plain.ppm', 'Case雪\n-%%.ppm', 'frame-%03%.ppm'])('requires a counter in native sequence grammar %s', operand => {
  expect(parseFilenameExpression(b(operand), 'sequence').complete).toBe(false);
});

it('retains escaped percents alongside a valid counter', async () => {
  const graph = await resolveDependencies(discover('ffprobe', ['-f', 'image2', 'Case雪\n-%%-%02d.ppm'].map(b)), options);
  expect(graph.nodes[0].expression?.complete).toBe(true);
  expect(graph.nodes[0].expression?.tokens.filter(token => token.kind === 'counter')).toHaveLength(1);
});

it.each(evidence.cases)('qualifies independent native fallback/frame read $operand', async sample => {
  const resolver = await createDependencyResolver(discover('ffprobe', ['-f', 'image2', sample.operand].map(b)), { ...options, cwd: b(evidence.cwd) });
  const read = sample.operand === 'Case雪\n-%%-%02d.ppm' ? 'Case雪\n-%-01.ppm' : sample.operand;
  expect(sample.runs[1].stderr).toContain(`Opening '${read}' for reading`);
  expect(sample.equalStatusStdout && evidence.fixturesUnchanged).toBe(true);
  expect(sample.runs.map(run => run.status)).toEqual([0, 0]);
  expect(JSON.parse(sample.runs[0].stdout).streams[0]).toMatchObject({ width: 1, height: 1 });
  const prediction = resolver.graph().nodes[0];
  expect(prediction.original).toEqual(b(sample.operand));
  const observed = await resolver.observe({ value: b(read), access: 'read', sequence: 0 }, prediction.id);
  expect(observed).toMatchObject({ original: b(read), location: b(evidence.cwd + '/' + read), live: true, upload: false, timing: { certainty: 'observed' } });
});

it('keeps case-sensitive changed manifest occurrences and optional alias accesses separate', async () => {
  const volume = Volume.fromJSON({ '/work/lists/Case雪\n-%d-%d.ppm': 'first', '/work/lists/case雪\n-%d-%d.ppm': 'second', '/work/Case雪\n-%d-%d.ppm': 'collision' });
  const resolver = await createDependencyResolver(discover('ffprobe', ['-f', 'concat', 'lists/root'].map(b)), options);
  const root = resolver.graph().nodes[0];
  const [first] = await resolver.content(root.id, { content: b("file 'Case雪\n-%d-%d.ppm'\n") });
  // Concat cannot quote across its native line boundary; do not fabricate a
  // newline filename from this invalid manifest. Runtime can still observe it.
  expect(resolver.graph().status).toBe('incomplete');
  expect(first.original).not.toEqual(b('Case雪\n-%d-%d.ppm'));
  const changed = await resolver.content(root.id, { content: b('file Case.ppm\nfile case.ppm\n') });
  expect(changed.map(node => node.location)).toEqual([b('/work/lists/Case.ppm'), b('/work/lists/case.ppm')]);
  expect(changed.every(node => node.id !== first.id && node.live && !node.upload)).toBe(true);
  const observed = [];
  for (const [sequence, name] of ['Case雪\n-%d-%d.ppm', 'case雪\n-%d-%d.ppm'].entries()) {
    observed.push(await resolver.observe({ value: b(name), base: { kind: 'directory', value: b('/work/lists') }, access: 'read', sequence }, root.id));
  }
  expect(observed.map(node => volume.readFileSync(Buffer.from(node.location!).toString(), 'utf8'))).toEqual(['first', 'second']);
  const optional = await resolver.observe({ value: b('missing'), optional: true, access: 'read-write', sequence: 2 }, root.id);
  expect(optional).toMatchObject({ optional: true, access: 'read-write', location: b('/work/missing'), live: true, upload: false });
});
