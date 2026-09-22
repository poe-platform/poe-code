import { expect, it } from 'vitest';
import { parseFilenameExpression } from './filename-expression.js';
import { discover } from './discover.js';
import { createDependencyResolver, resolveDependencies } from './resolver.js';
import { Volume } from 'memfs';
import evidence from '../test-fixtures/native/dependency-sequence-width-native-evidence.json';

const b = (value: string) => new TextEncoder().encode(value);
const options = { cwd: b('/work'), budgets: { nodes: 100, bytes: 100000, depth: 10, symlinks: 10 } };

it.each(['03', '000', '2147481089'])('retains the native width-bearing percent escape %s', width => {
  const value = b(`Case雪\n-%${width}%-%02d.ppm`);
  const original = value.slice();
  const expression = parseFilenameExpression(value, 'sequence');
  expect(expression.complete).toBe(true);
  expect(expression.tokens.map(token => [token.kind, token.value])).toEqual([
    ['literal', Buffer.from(b('Case雪\n-')).toString('latin1')],
    ['literal', '%-'], ['counter', '02'], ['literal', '.ppm'],
  ]);
  expect(value).toEqual(original);
});

it.each(['2147481090', '999999999999999999999', '0002147481090'])('refuses the native width guard %s without expanding it', width => {
  expect(parseFilenameExpression(b(`frame-%${width}d.ppm`), 'sequence').complete).toBe(false);
  expect(parseFilenameExpression(b(`frame-%${width}%-%d.ppm`), 'sequence').complete).toBe(false);
});

it('keeps native percent escapes on ordered input/output aliases with the original spelling', async () => {
  const operand = b('Case雪\n-%03%-%02d.ppm');
  const graph = await resolveDependencies(discover('ffmpeg', [b('-f'), b('image2'), b('-i'), operand, b('-f'), b('image2'), operand]), options);
  expect(graph.status).toBe('live');
  expect(graph.nodes.map(node => [node.original, node.access, node.expression?.complete])).toEqual([
    [operand, 'read', true], [operand, 'write', true],
  ]);
  expect(graph.nodes[0].location).toEqual(graph.nodes[1].location);
  expect(graph.edges).toContainEqual({ from: 0, to: 1, kind: 'before' });
  expect(graph.nodes.every(node => node.live && !node.upload)).toBe(true);
});

it('retains signed URL bytes when the native width guard makes counter expansion invalid', async () => {
  const operand = b('https://cdn/Case-%2147481090d.ppm?sig=+%2f#part');
  const graph = await resolveDependencies(discover('ffprobe', [b('-f'), b('image2'), operand]), options);
  expect(graph.nodes[0]).toMatchObject({ kind: 'url', original: operand, location: operand, upload: false });
  expect(graph.nodes[0].expression).toBeUndefined();
});

it('marks an invalid output counter advisory and incomplete while retaining the write occurrence', async () => {
  const operand = b('Case雪\n-%2147481090d.ppm');
  const graph = await resolveDependencies(discover('ffmpeg', [b('-f'), b('image2'), operand]), options);
  expect(graph.status).toBe('incomplete');
  expect(graph.nodes[0]).toMatchObject({ original: operand, access: 'write', live: true, upload: false, expression: { complete: false } });
  expect(graph.issues).toContainEqual(expect.objectContaining({ node: 0, reason: 'syntax' }));
});

it.each(evidence.cases)('qualifies the native read of $operand independently of static sequence hints', async sample => {
  const resolver = await createDependencyResolver(discover('ffprobe', [b('-f'), b('image2'), b(sample.operand)]), { ...options, cwd: b(evidence.cwd) });
  const prediction = resolver.graph().nodes[0];
  const fallback = sample.operand.includes('2147481090');
  const expectedRead = fallback ? sample.operand : 'Case雪\n-%-01.ppm';
  const stderr = sample.runs[1].stderr;
  const start = stderr.indexOf(" Opening '");
  const end = stderr.indexOf("' for reading", start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  expect(stderr.slice(start + 10, end)).toBe(expectedRead);
  expect(sample.equalStatusStdout && evidence.fixturesUnchanged).toBe(true);
  expect(sample.runs.map(run => run.status)).toEqual([0, 0]);
  expect(JSON.parse(sample.runs[0].stdout).streams[0]).toMatchObject({ width: 1, height: 1 });
  expect(prediction.original).toEqual(b(sample.operand));
  expect(prediction.expression?.complete).toBe(!fallback);
  if (!fallback) {
    const literals = prediction.expression!.tokens.filter(token => token.kind === 'literal').map(token => token.value).join('');
    expect(new Uint8Array(Buffer.from(literals, 'latin1'))).toEqual(b('Case雪\n-%-.ppm'));
    expect(prediction.expression!.tokens.filter(token => token.kind === 'counter').map(token => token.value)).toEqual(['02']);
  }
  // Runtime supplies the actual selected filename. Static discovery neither
  // enumerates frames nor loads/replays this native trace in product code.
  const observed = await resolver.observe({ value: b(expectedRead), access: 'read', sequence: 0 }, prediction.id);
  expect(observed).toMatchObject({ location: b(evidence.cwd + '/' + expectedRead), live: true, upload: false, timing: { certainty: 'observed', sequence: 0 } });
});

it('preserves case-sensitive frame names, missing optional reads and read-write aliases in memory', async () => {
  const volume = Volume.fromJSON({ '/work/Case雪\n-%-01.ppm': 'original', '/work/case雪\n-%-01.ppm': 'collision' });
  const before = volume.toJSON();
  const resolver = await createDependencyResolver(discover('ffprobe', [b('-f'), b('image2'), b('Case雪\n-%03%-%02d.ppm')]), { ...options,
    link: async path => { try { return volume.readlinkSync(new TextDecoder().decode(path), { encoding: 'buffer' }); } catch { return undefined; } },
    directory: async path => volume.statSync(new TextDecoder().decode(path)).isDirectory(),
  });
  const names = ['Case雪\n-%-01.ppm', 'case雪\n-%-01.ppm', 'missing雪\n-%-02.ppm'];
  for (const [sequence, name] of names.entries()) {
    const node = await resolver.observe({ value: b(name), access: sequence === 0 ? 'read-write' : 'read', optional: sequence === 2, sequence });
    expect(node.location).toEqual(b('/work/' + name));
  }
  const graph = resolver.graph();
  expect(graph.nodes[1].location).not.toEqual(graph.nodes[2].location);
  expect(graph.edges.filter(edge => edge.kind === 'observed-before')).toEqual([
    { from: 1, to: 2, kind: 'observed-before' }, { from: 2, to: 3, kind: 'observed-before' },
  ]);
  expect(volume.toJSON()).toEqual(before);
  expect(volume.readFileSync('/work/Case雪\n-%-01.ppm', 'utf8')).toBe('original');
  expect(volume.readFileSync('/work/case雪\n-%-01.ppm', 'utf8')).toBe('collision');
  expect(graph.status).toBe('live');
});
