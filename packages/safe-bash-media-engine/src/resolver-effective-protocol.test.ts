import { expect, it } from 'vitest';
import { DependencyResolver } from './resolver.js';
import evidence from '../tests/fixtures/native/dependency-effective-protocol-native-evidence.json';

const b = (value: string) => new TextEncoder().encode(value);
const options = { cwd: b('/work'), budgets: { nodes: 100, bytes: 100000, depth: 10, symlinks: 10 } };

it.each(['cache', 'async'])('expands %s selected by a manifest resolution base', async scheme => {
  const resolver = new DependencyResolver(options);
  const root = await resolver.add({ value: b(`${scheme}:lists/root`), access: 'read', grammar: 'hls' });
  const [member] = await resolver.content(root.id, { content: b('#EXTM3U\nCase雪.ts\n') });
  const children = resolver.graph().nodes.filter(node => node.parent === member.id);
  expect(member.original).toEqual(b('Case雪.ts'));
  expect(member.location).toEqual(b(`${scheme}:lists/Case雪.ts`));
  expect(children.map(node => [node.original, node.location, node.access])).toEqual([
    [b('lists/Case雪.ts'), b('/work/lists/Case雪.ts'), 'read'],
  ]);
  expect(children.every(node => node.live && !node.upload)).toBe(true);
});

it('preserves signed network members and policy through an effective nested wrapper', async () => {
  const resolver = new DependencyResolver(options);
  const root = await resolver.add({ value: b('https://origin/master'), access: 'read', grammar: 'hls', policy: { deny: ['https'] } });
  const [member] = await resolver.content(root.id, {
    location: b('cache:async:https://cdn/live/master?old=+%2f#old'),
    content: b('#EXTM3U\nsegment?sig=+%2F#part\n'),
  });
  const async = resolver.graph().nodes.find(node => node.parent === member.id)!;
  const network = resolver.graph().nodes.find(node => node.parent === async?.id)!;
  expect(async?.original).toEqual(b('async:https://cdn/live/segment?sig=+%2F#part'));
  expect(network?.location).toEqual(b('https://cdn/live/segment?sig=+%2F#part'));
  expect(network?.kind).toBe('url');
  expect(network?.policy).toEqual({ deny: ['https'] });
  expect(resolver.graph().issues).toContainEqual(expect.objectContaining({ node: network?.id, reason: 'policy' }));
});

it('enforces nesting budgets on wrappers introduced by a reader base', async () => {
  const resolver = new DependencyResolver({ ...options, budgets: { ...options.budgets, depth: 1 } });
  const root = await resolver.add({ value: b('cache:lists/root'), access: 'read', grammar: 'hls' });
  const [member] = await resolver.content(root.id, { content: b('#EXTM3U\nsegment.ts\n') });
  expect(resolver.graph().issues).toContainEqual(expect.objectContaining({ node: member.id, reason: 'budget' }));
  expect(resolver.graph().status).toBe('incomplete');
});

it('covers independent native concat wrapper opens without turning predictions into observations', async () => {
  const resolver = new DependencyResolver({ ...options, cwd: b(evidence.cwd) });
  const root = await resolver.add({ value: b('cache:lists/root'), access: 'read', grammar: 'concat' });
  const [member] = await resolver.content(root.id, { content: b('ffconcat version 1.0\nfile Case雪.wav\n') });
  expect(evidence.runs.map(run => run.status)).toEqual([0, 0]);
  expect(evidence.equalStatusStdout && evidence.fixturesUnchanged).toBe(true);
  expect(evidence.manifest).toBe('ffconcat version 1.0\nfile Case雪.wav\n');
  const candidates = resolver.graph().nodes.filter(node => node.kind === 'url');
  let checked = 0;
  for (const line of evidence.runs[1].stderr.split('\n')) {
    const start = line.indexOf(" Opening '");
    const end = line.lastIndexOf("' for reading");
    if (start < 0 || end < 0) continue;
    const operand = b(line.slice(start + 10, end));
    const index = candidates.findIndex(node => node.access === 'read' && Buffer.from(node.location!).equals(operand));
    expect(index).toBeGreaterThanOrEqual(0);
    candidates.splice(index, 1);
    checked++;
  }
  expect(checked).toBe(2);
  expect(candidates).toEqual([]);
  const leaf = resolver.graph().nodes.find(node => node.parent === member.id)!;
  expect(leaf.location).toEqual(b(`${evidence.cwd}/lists/Case雪.wav`));
  expect(leaf.timing.certainty).toBe('predicted');
  expect(resolver.graph().edges.some(edge => edge.kind === 'observed-before')).toBe(false);
});
