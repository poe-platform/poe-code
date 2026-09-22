import { expect, it } from 'vitest';
import { DependencyResolver } from './resolver.js';
import evidence from '../test-fixtures/native/dependency-hls-line-boundary-native-evidence.json';

const b = (value: string) => new TextEncoder().encode(value);
const options = { cwd: b('/work'), budgets: { nodes: 100, bytes: 100000, depth: 10, symlinks: 10 } };

it.each([
  'https://cdn/segment?sig=' + 'x'.repeat(4096) + '+%2f#fragment',
  '#EXT-X-MAP:URI="' + '雪'.repeat(1400) + '.mp4"',
  '#EXT-X-STREAM-INF:BANDWIDTH=1,NAME="' + 'x'.repeat(4096) + '"',
])('refuses predictive expansion after an overlong native HLS line without rewriting it', async line => {
  const resolver = new DependencyResolver(options);
  const root = await resolver.add({ value: b('https://cdn/live/list?sig=+%2f#parent'), access: 'read', grammar: 'hls' });
  const content = b('#EXTM3U\nfirst.ts\n' + line + '\nlater.ts\n');
  const original = content.slice();
  const children = await resolver.content(root.id, { content });
  expect(children.map(node => node.original)).toEqual([b('first.ts')]);
  expect(resolver.graph()).toMatchObject({ status: 'incomplete', issues: [expect.objectContaining({ node: root.id, reason: 'unresolved' })] });
  expect(content).toEqual(original);
  expect(children[0]).toMatchObject({ location: b('https://cdn/live/first.ts'), live: true, upload: false });
});

it('counts the native line boundary in bytes and before whitespace chomp', async () => {
  const resolver = new DependencyResolver(options);
  const root = await resolver.add({ value: b('lists/root'), access: 'read', grammar: 'hls' });
  const boundary = '雪'.repeat(1364) + '.ts';
  expect(b(boundary).length).toBe(4095);
  expect((await resolver.content(root.id, { content: b('#EXTM3U\n' + boundary + '\n') }))[0].original).toEqual(b(boundary));
  const children = await resolver.content(root.id, { content: b('#EXTM3U\n' + boundary + ' \n') });
  expect(children).toEqual([]);
  expect(resolver.graph().status).toBe('incomplete');
});

it('keeps changing captures and actual late accesses after a refused prediction', async () => {
  const resolver = new DependencyResolver(options);
  const root = await resolver.add({ value: b('lists/root'), access: 'read', grammar: 'hls' });
  await resolver.content(root.id, { content: b('#EXTM3U\n' + 'x'.repeat(4096) + '\n') });
  const [changed] = await resolver.content(root.id, { content: b('#EXTM3U\nCase雪.ts\n') });
  const late = await resolver.observe({ value: b('case雪\n.ts'), access: 'read-write', optional: true, sequence: 1,
    base: { kind: 'resource', value: b('https://redirect/live/list?sig=+%2f') } }, root.id);
  expect(changed.location).toEqual(b('/work/lists/Case雪.ts'));
  expect(late).toMatchObject({ location: b('https://redirect/live/case雪\n.ts'), live: true, upload: false, timing: { certainty: 'observed', sequence: 1 } });
  expect(resolver.graph().status).toBe('incomplete');
});

it.each(evidence.cases)('qualifies the refused $id prediction against independent native attempted reads', async sample => {
  const resolver = new DependencyResolver({ ...options, cwd: b(evidence.cwd) });
  const filename = evidence.cwd + '/' + sample.id;
  const root = await resolver.add({ value: b(filename), access: 'read', grammar: 'hls' });
  expect(await resolver.content(root.id, { content: b(sample.manifest) })).toEqual([]);
  expect(resolver.graph()).toMatchObject({ status: 'incomplete', issues: [expect.objectContaining({ reason: 'unresolved' })] });
  expect(sample.equalStatusStdout && evidence.fixturesUnchanged).toBe(true);
  expect(sample.runs.map(run => run.status)).toEqual(sample.id === 'comment.m3u8' ? [0, 0] : [1, 1]);
  const nativeReads = sample.runs[1].attemptedReads;
  expect(nativeReads[0]).toBe(filename);
  // Independently specify the actual reader operand. The product neither loads
  // the trace nor uses it to expand the refused static manifest capture.
  const actual = sample.id === 'comment.m3u8' ? evidence.cwd + '/segment.ts' : 'file:' + 'directory/'.repeat(409);
  expect(nativeReads).toEqual([filename, actual]);
  const observed = await resolver.observe({ value: b(actual), access: 'read', sequence: 1 }, root.id);
  expect(observed).toMatchObject({ original: b(actual), live: true, upload: false, timing: { certainty: 'observed', sequence: 1 } });
  if (sample.id === 'operand.m3u8') {
    expect(b(actual).length).toBe(4095);
    expect(sample.manifest.includes(actual + 'directory/')).toBe(true);
    expect(observed.original).not.toEqual(b(sample.manifest.split('\n')[3]));
  }
});
