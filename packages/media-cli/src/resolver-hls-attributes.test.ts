import { expect, it } from 'vitest';
import { DependencyResolver } from './resolver.js';
import evidence from '../tests/fixtures/native/dependency-hls-attribute-native-evidence.json';

const b = (value: string) => new TextEncoder().encode(value);
const options = { cwd: b('/work'), budgets: { nodes: 100, bytes: 100000, depth: 10, symlinks: 10 } };

it.each([
  ['#EXT-X-KEY:METHOD=AES-128,URI="discard",URI="keys/Case雪.bin?sig=+%2f#key"', 'keys/Case雪.bin?sig=+%2f#key'],
  ['#EXT-X-MAP:URI="init\\,雪\\".mp4?sig=+%2f#part"', 'init,雪".mp4?sig=+%2f#part'],
  ['#EXT-X-MAP:URI=init.mp4\tBYTERANGE="10@0"', 'init.mp4'],
  ['#EXT-X-MAP:URI="init.mp4",\t', 'init.mp4'],
  ['#EXT-X-MAP:URI="init.mp4" UNKNOWN', 'init.mp4'],
] as const)('uses the registered HLS attribute reader for %s', async (tag, filename) => {
  const resolver = new DependencyResolver(options);
  const root = await resolver.add({ value: b('https://cdn/live/master?sig=old/a#old'), access: 'read', grammar: 'hls' });
  const content = b(`#EXTM3U\n${tag}\nsegment.ts\n`);
  const original = content.slice();
  const children = await resolver.content(root.id, { content });
  expect(children.map(node => node.location)).toEqual([b(`https://cdn/live/${filename}`), b('https://cdn/live/segment.ts')]);
  expect(children[0].original).toEqual(b(filename));
  expect(children.every(node => node.access === 'read' && node.kind === 'url' && node.live && !node.upload)).toBe(true);
  expect(content).toEqual(original);
  expect(resolver.graph().status).toBe('live');
  expect(resolver.graph().edges).toContainEqual({ from: children[0].id, to: children[1].id, kind: 'before' });
});

it('covers independently captured native init and segment read occurrences', async () => {
  for (const sample of evidence.cases) {
    const manifest = sample.runs[0].argv.at(-1)!;
    const resolver = new DependencyResolver({ ...options, cwd: b(evidence.cwd) });
    const root = await resolver.add({ value: b(manifest), access: 'read', grammar: 'hls' });
    await resolver.content(root.id, { content: b(sample.manifest) });
    expect(sample.equalStatusStdout).toBe(true);
    expect(sample.fixturesUnchanged).toBe(true);
    expect(sample.runs.map(run => run.status)).toEqual([0, 0]);
    const candidates = [...resolver.graph().nodes];
    let checked = 0;
    for (const line of sample.runs[1].stderr.split('\n')) {
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
  }
});
