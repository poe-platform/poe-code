import { expect, it } from 'vitest';
import { DependencyResolver } from './resolver.js';
import evidence from '../tests/fixtures/native/dependency-concat-duration-native-evidence.json';
import registered from '../tests/fixtures/native/dependency-concat-directives-native-evidence.json';

const b = (value: string) => new TextEncoder().encode(value);
const options = { cwd: b('/work'), budgets: { nodes: 100, bytes: 100000, depth: 10, symlinks: 10 } };

it.each(['duration', 'inpoint', 'outpoint', 'chapter 7 0'])('stops predictions after malformed %s duration fields', async directive => {
  for (const duration of ['', 'nope', "'1'", '1e3', '1:60', '10000:00:00', '9223372036854775808us', '9223372036854.775808']) {
    const resolver = new DependencyResolver(options);
    const root = await resolver.add({ value: b('elsewhere/list'), access: 'read', grammar: 'concat' });
    const content = b(`file 'Case雪.ppm'\n${directive} ${duration}\nfile case.ppm\n`);
    const original = content.slice();
    const children = await resolver.content(root.id, { content });
    expect(children.map(node => node.original), duration).toEqual([b('Case雪.ppm')]);
    expect(resolver.graph().status).toBe('incomplete');
    expect(resolver.graph().issues).toContainEqual(expect.objectContaining({ reason: 'syntax' }));
    expect(content).toEqual(original);
  }
});

it.each(['0', '-1', '+1', '--1', '-+1', '1.', '1.123456789s', '1.5ms', '1.5us', '1:2', '9999:59:59', '9223372036854775807us', '9223372036854.775807s'])
('retains native duration grammar %s with ordered shared members and independent bases', async duration => {
  const resolver = new DependencyResolver(options);
  const root = await resolver.add({ value: b('lists/root'), access: 'read', grammar: 'concat' });
  const children = await resolver.content(root.id, { content: b(`file Case.ppm\nduration ${duration}\nfile Case.ppm\n`) });
  expect(children.map(node => node.location)).toEqual([b('/work/lists/Case.ppm'), b('/work/lists/Case.ppm')]);
  expect(resolver.graph().status).toBe('live');
  expect(resolver.graph().edges).toContainEqual({ from: children[0].id, to: children[1].id, kind: 'before' });
  expect(children.every(node => node.live && !node.upload)).toBe(true);
});

it('qualifies separate shared read occurrences against independent native AVIO diagnostics', async () => {
  expect(evidence.executableSha256).toBe(registered.executableSha256);
  expect(evidence.sources['libavformat/concatdec.c'].sha256).toBe(registered.sourceSha256);
  const native = evidence.cases.find(item => item.duration === '1.5ms')!;
  const resolver = new DependencyResolver({ ...options, cwd: b(evidence.cwd) });
  const root = await resolver.add({ value: b(native.manifest), access: 'read', grammar: 'concat' });
  // Original fixture recipe is independent of the recorded content and accesses.
  const content = b("ffconcat version 1.0\nfile 'Case雪.wav'\nduration 1.5ms\nfile 'Case雪.wav'\n");
  await resolver.content(root.id, { content });
  expect(native.content).toBe(new TextDecoder().decode(content));
  expect(native.runs.map(run => run.status)).toEqual([0, 0]);
  expect(native.equalStatusStdout && native.fixturesUnchanged).toBe(true);
  const candidates = [...resolver.graph().nodes];
  let reads = 0;
  for (const line of native.runs[1].stderr.split('\n')) {
    const start = line.indexOf(" Opening '");
    const end = line.lastIndexOf("' for reading");
    if (start < 0 || end < 0) continue;
    const path = b(line.slice(start + 10, end));
    const index = candidates.findIndex(node => node.access === 'read' && Buffer.from(node.location!).equals(path));
    expect(index).toBeGreaterThanOrEqual(0);
    candidates.splice(index, 1);
    reads++;
  }
  expect(reads).toBe(3);
  expect(candidates).toEqual([]);
  expect(resolver.graph().nodes.every(node => node.timing.certainty === 'predicted')).toBe(true);
});

it('qualifies malformed grammar separately from later native initialization failures', () => {
  const invalid = ['', 'nope', "'1'", '1e3', '1:60', '10000:00:00', '9223372036854775808us', '9223372036854.775808'];
  for (const native of evidence.cases) {
    expect(native.equalStatusStdout && native.fixturesUnchanged).toBe(true);
    expect(native.runs[1].stderr.includes('invalid duration')).toBe(invalid.includes(native.duration));
    if (invalid.includes(native.duration)) expect(native.runs.map(run => run.status)).toEqual([1, 1]);
  }
  for (const duration of ['-1', '-+1']) {
    expect(evidence.cases.find(item => item.duration === duration)!.runs.map(run => run.status)).toEqual([1, 1]);
  }
});

it('retains changed signed resources, alias roles and optional runtime reads after a grammar stop', async () => {
  const resolver = new DependencyResolver(options);
  const root = await resolver.add({ value: b('https://cdn/lists/root?sig=+%2f#old'), access: 'read', grammar: 'concat' });
  await resolver.content(root.id, { content: b('file old\nduration nope\nfile absent\n') });
  const [changed] = await resolver.content(root.id, { content: b('file ../Case雪?sig=+%2f#new\nduration 1.5ms\n') });
  expect(changed.location).toEqual(b('https://cdn/Case雪?sig=+%2f#new'));
  const read = await resolver.observe({ value: b('Case雪\n.ppm'), access: 'read-write', optional: true, sequence: 1 });
  const write = await resolver.observe({ value: read.original, access: 'write', sequence: 2 });
  expect(write.location).toEqual(read.location);
  expect(write.id).not.toBe(read.id);
  expect(resolver.graph().edges).toContainEqual({ from: read.id, to: write.id, kind: 'observed-before' });
  expect(resolver.graph().status).toBe('incomplete');
});
