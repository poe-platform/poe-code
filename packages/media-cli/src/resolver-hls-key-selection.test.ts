import { expect, it } from 'vitest';
import { DependencyResolver } from './resolver.js';
import evidence from '../test-fixtures/native/dependency-hls-key-selection-native-evidence.json';

const b = (value: string) => new TextEncoder().encode(value);
const options = { cwd: b('/work'), budgets: { nodes: 100, bytes: 100000, depth: 10, symlinks: 10 } };

it.each(['', 'METHOD=UNKNOWN,', 'METHOD=aes-128,', 'METHOD=AES-256,', 'METHOD=SAMPLE-AES-CTR,', 'METHOD="AES-128 ",'])
('does not predict a key read for an inactive native key method %s', async method => {
  const probes: Uint8Array[] = [];
  const resolver = new DependencyResolver({ ...options, link: async path => { probes.push(path); return undefined; } });
  const root = await resolver.add({ value: b('https://cdn/live/master?sig=old/a#old'), access: 'read', grammar: 'hls' });
  const content = b(`#EXTM3U\n#EXT-X-KEY:${method}URI="absent雪.key?sig=+%2f#key"\n#EXT-X-MAP:URI="init.mp4?sig=+%2f#init"\nsegment.ts\n`);
  const original = content.slice();
  const children = await resolver.content(root.id, { content });
  expect(children.map(node => node.original)).toEqual([b('init.mp4?sig=+%2f#init'), b('segment.ts')]);
  expect(children.map(node => node.location)).toEqual([b('https://cdn/live/init.mp4?sig=+%2f#init'), b('https://cdn/live/segment.ts')]);
  expect(resolver.graph().edges).toContainEqual({ from: children[0].id, to: children[1].id, kind: 'before' });
  expect(children.every(node => node.live && !node.upload && node.access === 'read')).toBe(true);
  expect(resolver.graph().status).toBe('live');
  expect(probes).toEqual([]);
  expect(content).toEqual(original);
});

it.each(['AES-128', 'SAMPLE-AES'])('retains signed key operands for the active method %s', async method => {
  const resolver = new DependencyResolver(options);
  const root = await resolver.add({ value: b('https://cdn/live/master'), access: 'read', grammar: 'hls' });
  const children = await resolver.content(root.id, { content: b(`#EXTM3U\n#EXT-X-KEY:METHOD=${method},URI="keys/Case雪.key?sig=+%2f#key"\nsegment.ts\n`) });
  expect(children.map(node => node.location)).toEqual([b('https://cdn/live/keys/Case雪.key?sig=+%2f#key'), b('https://cdn/live/segment.ts')]);
});

it('keeps changed captures, optional runtime reads and input/output aliases as separate live occurrences', async () => {
  const resolver = new DependencyResolver(options);
  const root = await resolver.add({ value: b('lists/master'), access: 'read', grammar: 'hls' });
  const [key, first] = await resolver.content(root.id, { content: b('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="Case雪.key"\nsegment.ts\n') });
  const [second] = await resolver.content(root.id, { content: b('#EXTM3U\n#EXT-X-KEY:METHOD=unknown,URI="case雪.key"\nsegment.ts\n') });
  expect(second.original).toEqual(b('segment.ts'));
  expect(second.location).toEqual(first.location);
  expect(second.id).not.toBe(first.id);
  const output = await resolver.observe({ value: b('lists/Case雪.key'), access: 'read-write', sequence: 1 }, root.id);
  const optional = await resolver.observe({ value: b('case雪\n.key'), access: 'read', optional: true, sequence: 2 }, root.id);
  expect(output.location).toEqual(key.location);
  expect(optional.location).toEqual(b('/work/case雪\n.key'));
  expect(resolver.graph().edges).toContainEqual({ from: output.id, to: optional.id, kind: 'observed-before' });
  expect(resolver.graph().nodes.every(node => node.live && !node.upload)).toBe(true);
});

// Independent diagnostic reads qualify attempted AVIO occurrences only.
// Product discovery never imports evidence or launches these native commands.
it('covers native inactive-method media reads and the active-method missing-key attempt independently', async () => {
  expect(evidence.fixturesUnchanged).toBe(true);
  expect(evidence.before).toEqual(evidence.after);
  let checked = 0;
  for (const sample of evidence.cases) {
    expect(sample.equalStatusStdout).toBe(true);
    expect(sample.runs.map(run => run.status)).toEqual(sample.label === 'active' ? [1, 1] : [0, 0]);
    if (sample.label !== 'active') {
      expect(JSON.parse(sample.runs[0].stdout).streams[0]).toMatchObject({ width: 16, height: 16 });
    }
    const resolver = new DependencyResolver({ ...options, cwd: b(evidence.cwd) });
    const root = await resolver.add({ value: b(sample.path), access: 'read', grammar: 'hls' });
    await resolver.content(root.id, { content: b(sample.manifest) });
    const candidates = [...resolver.graph().nodes];
    for (const filename of sample.runs[1].opens) {
      const index = candidates.findIndex(node => node.access === 'read' && node.location && Buffer.from(node.location).equals(b(filename)));
      expect(index, `independent native read: ${filename}`).toBeGreaterThanOrEqual(0);
      candidates.splice(index, 1);
      checked++;
    }
    expect(sample.runs[1].opens).toHaveLength(2);
    // The active control fails before its predicted media read; that hint is
    // retained without claiming it happened or exposing the key error early.
    expect(candidates).toHaveLength(sample.label === 'active' ? 1 : 0);
  }
  expect(checked).toBe(8);
});
