import { expect, it } from 'vitest';
import { DependencyResolver } from './resolver.js';
import evidence from '../tests/fixtures/native/dependency-hls-method-native-evidence.json';

const b = (value: string) => new TextEncoder().encode(value);
const options = { cwd: b('/work'), budgets: { nodes: 100, bytes: 100000, depth: 10, symlinks: 10 } };

it.each(['#EXT-X-MAP', '#EXT-X-MEDIA'])
('does not apply key METHOD semantics to %s resources', async tag => {
  const resolver = new DependencyResolver(options);
  const root = await resolver.add({ value: b('https://cdn/live/master?sig=old/a#old'), access: 'read', grammar: 'hls' });
  const content = b(`#EXTM3U\n${tag}:METHOD=NONE,URI="Case雪.bin?sig=+%2f#part"\nsegment.ts\n`);
  const original = content.slice();
  const children = await resolver.content(root.id, { content });
  expect(children.map(node => node.location)).toEqual([b('https://cdn/live/Case雪.bin?sig=+%2f#part'), b('https://cdn/live/segment.ts')]);
  expect(children[0].grammar).toBe(tag === '#EXT-X-MEDIA' ? 'hls' : undefined);
  expect(children.every(node => node.kind === 'url' && node.access === 'read' && node.live && !node.upload)).toBe(true);
  expect(resolver.graph().edges).toContainEqual({ from: children[0].id, to: children[1].id, kind: 'before' });
  expect(content).toEqual(original);
});

it.each(['#EXT-X-KEY', '#EXT-X-SESSION-KEY'])('retains METHOD=NONE suppression for %s', async tag => {
  const resolver = new DependencyResolver(options);
  const root = await resolver.add({ value: b('lists/master'), access: 'read', grammar: 'hls' });
  const children = await resolver.content(root.id, { content: b(`#EXTM3U\n${tag}:METHOD=NONE,URI="optional-absent.key"\nsegment.ts\n`) });
  expect(children.map(node => node.original)).toEqual([b('segment.ts')]);
  expect(resolver.graph().status).toBe('live');
});

it('covers independently observed native map and segment opens with separate read occurrences', async () => {
  const resolver = new DependencyResolver({ ...options, cwd: b(evidence.cwd) });
  const root = await resolver.add({ value: b(evidence.runs[0].argv.at(-1)!), access: 'read', grammar: 'hls' });
  await resolver.content(root.id, { content: b(evidence.manifest) });
  expect(evidence.runs.map(run => run.status)).toEqual([0, 0]);
  expect(evidence.equalStatusStdout).toBe(true);
  expect(evidence.fixturesUnchanged).toBe(true);
  const candidates = [...resolver.graph().nodes];
  let checked = 0;
  for (const line of evidence.runs[1].stderr.split('\n')) {
    const start = line.indexOf(" Opening '");
    const end = line.lastIndexOf("' for reading");
    if (start < 0 || end < 0) continue;
    const filename = line.slice(start + 10, end);
    const index = candidates.findIndex(node => node.access === 'read' && Buffer.from(node.location!).equals(b(filename)));
    expect(index, `independent native read: ${filename}`).toBeGreaterThanOrEqual(0);
    candidates.splice(index, 1);
    checked++;
  }
  expect(checked).toBe(3);
  expect(candidates).toEqual([]);
});
