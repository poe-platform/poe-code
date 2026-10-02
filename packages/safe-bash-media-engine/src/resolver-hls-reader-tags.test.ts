import { expect, it } from 'vitest';
import { DependencyResolver } from './resolver.js';
import evidence from '../tests/fixtures/native/dependency-hls-reader-tags-native-evidence.json';

const b = (value: string) => new TextEncoder().encode(value);
const options = { cwd: b('/work'), budgets: { nodes: 100, bytes: 100000, depth: 10, symlinks: 10 } };

// Registered hls.c skips these comments rather than selecting their resources.
it.each(['SESSION-KEY', 'I-FRAME-STREAM-INF', 'PART', 'PRELOAD-HINT', 'RENDITION-REPORT', 'SESSION-DATA', 'CONTENT-STEERING'])(
  'does not invent native accesses for EXT-X-%s', async tag => {
    const probes: Uint8Array[] = [];
    const resolver = new DependencyResolver({ ...options, link: async path => { probes.push(path); return undefined; } });
    const root = await resolver.add({ value: b('lists/master'), access: 'read', grammar: 'hls' });
    probes.length = 0;
    const field = tag === 'CONTENT-STEERING' ? 'SERVER-URI' : 'URI';
    const content = b(`#EXTM3U\n#EXT-X-${tag}:METHOD=AES-128,${field}="optional-absent雪.key?sig=+%2f#part"\n#EXTINF:1,\nCase.ts\n`);
    const children = await resolver.content(root.id, { content });
    expect(children.map(node => node.original)).toEqual([b('Case.ts')]);
    expect(children[0].readerLocation).toEqual(b('/work/lists/Case.ts'));
    expect(probes.some(path => new TextDecoder().decode(path).includes('optional-absent'))).toBe(false);
    expect(resolver.graph().status).toBe('live');
  },
);

it('retains changed captures, signed URLs and ordered aliases around ignored tags', async () => {
  const resolver = new DependencyResolver(options);
  const root = await resolver.add({ value: b('https://cdn/lists/master?sig=old#base'), access: 'read', grammar: 'hls' });
  for (const name of ['Case雪.ts', 'case雪.ts']) {
    const content = b(`#EXTM3U\n#EXT-X-SESSION-KEY:METHOD=AES-128,URI="pipe:0"\n#EXT-X-MAP:URI="init.mp4?sig=+%2f#part"\n#EXTINF:1,\n${name}\n`);
    const original = content.slice();
    const children = await resolver.content(root.id, { content });
    expect(children.map(node => node.original)).toEqual([b('init.mp4?sig=+%2f#part'), b(name)]);
    expect(children.map(node => node.readerLocation)).toEqual([b('https://cdn/lists/init.mp4?sig=+%2f#part'), b(`https://cdn/lists/${name}`)]);
    expect(content).toEqual(original);
  }
  const alias = await resolver.observe({ value: b('https://cdn/lists/Case雪.ts'), access: 'read-write', optional: true, sequence: 1 }, root.id);
  expect(alias).toMatchObject({ live: true, upload: false, timing: { certainty: 'observed', sequence: 1 } });
  expect(resolver.graph().nodes).toHaveLength(6);
});

it('qualifies native attempted reads and ignored tags independently of static predictions', async () => {
  const resolver = new DependencyResolver({ ...options, cwd: b(evidence.cwd) });
  const root = await resolver.add({ value: b(evidence.runs[0].argv.at(-1)!), access: 'read', grammar: 'hls' });
  await resolver.content(root.id, { content: b(evidence.manifest) });
  expect(evidence.runs.map(run => run.status)).toEqual([0, 0]);
  expect(evidence.equalStatusStdout).toBe(true);
  expect(evidence.fixturesUnchanged).toBe(true);
  const candidates = [...resolver.graph().nodes];
  let checked = 0, skipped = 0;
  for (const line of evidence.runs[1].stderr.split('\n')) {
    if (line.includes("Skip ('#EXT-X-")) skipped++;
    const start = line.indexOf(" Opening '");
    const end = line.lastIndexOf("' for reading");
    if (start < 0 || end < 0) continue;
    const filename = line.slice(start + 10, end);
    const index = candidates.findIndex(node => node.access === 'read' && Buffer.from(node.readerLocation!).equals(b(filename)));
    expect(index, `independent native read: ${filename}`).toBeGreaterThanOrEqual(0);
    candidates.splice(index, 1);
    checked++;
  }
  expect(checked).toBe(2);
  expect(skipped).toBe(7);
  expect(candidates).toEqual([]);
});
