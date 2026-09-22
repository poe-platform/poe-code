import { expect, it } from 'vitest';
import { Volume } from 'memfs';
import { DependencyResolver } from './resolver.js';
import evidence from '../test-fixtures/native/dependency-concat-metadata-native-evidence.json';
import registered from '../test-fixtures/native/dependency-concat-directives-native-evidence.json';

const b = (value: string) => new TextEncoder().encode(value);
const options = { cwd: b('/work'), budgets: { nodes: 100, bytes: 100000, depth: 10, symlinks: 10 } };

it.each(['missing', '=value', 'key=', 'key=   ', '\\=value', "'key=value'", "key=''"])
('stops advisory concat discovery at malformed nested metadata %s', async value => {
  const resolver = new DependencyResolver(options);
  const root = await resolver.add({ value: b('lists/root'), access: 'read', grammar: 'concat' });
  // Outer quoting preserves bytes for av_dict_parse_string's second token pass.
  const content = b(`file Case雪.ppm\nfile_packet_metadata '${value.split("'").join("'\\''")}'\nfile case雪.ppm\n`);
  const original = content.slice();
  const nodes = await resolver.content(root.id, { content });
  expect(nodes.map(node => node.original)).toEqual([b('Case雪.ppm')]);
  expect(nodes[0].base.value).toEqual(b('/work/lists/root'));
  expect(resolver.graph().status).toBe('incomplete');
  expect(resolver.graph().issues).toContainEqual(expect.objectContaining({ reason: 'syntax' }));
  expect(content).toEqual(original);
});

it.each(['key=value', 'key=value:other=more', "'key=part'=value", 'key\\=part=value', 'key==', "key=' '", 'key=value\\'])
('retains native nested metadata token semantics for %s', async value => {
  const resolver = new DependencyResolver(options);
  const root = await resolver.add({ value: b('lists/root'), access: 'read', grammar: 'concat' });
  const nodes = await resolver.content(root.id, { content: b(`file Case.ppm\nfile_packet_metadata '${value.split("'").join("'\\''")}'\nfile case.ppm\n`) });
  expect(nodes.map(node => node.location)).toEqual([b('/work/lists/Case.ppm'), b('/work/lists/case.ppm')]);
  expect(resolver.graph().status).toBe('live');
  expect(resolver.graph().edges).toContainEqual({ from: nodes[0].id, to: nodes[1].id, kind: 'before' });
});

it('keeps changed shared captures, aliases and absent optional accesses live after a malformed capture', async () => {
  const volume = Volume.fromJSON({ '/work/lists/Case雪\n.ppm': 'first', '/work/lists/case雪\n.ppm': 'second', '/work/Case雪\n.ppm': 'cwd collision' });
  const resolver = new DependencyResolver({ ...options, link: async path => {
    try { return b(volume.readlinkSync(Buffer.from(path).toString()) as string); } catch { return undefined; }
  } });
  const root = await resolver.add({ value: b('lists/root'), access: 'read', grammar: 'concat' });
  await resolver.content(root.id, { content: b("file Case.ppm\nfile_packet_metadata 'key='\nfile absent.ppm\n") });
  const content = b("file 'concatf:lists/shared'\nfile_packet_metadata 'key=value'\nfile 'concatf:lists/shared'\n");
  const shared = await resolver.content(root.id, { content });
  for (const wrapper of shared) {
    const reader = resolver.graph().nodes.find(node => node.parent === wrapper.id)!;
    await resolver.content(reader.id, { content: b("'lists/Case雪\n.ppm'\n'lists/case雪\n.ppm'\n") });
  }
  const graph = resolver.graph();
  expect(graph.nodes.filter(node => Buffer.from(node.original).toString() === 'lists/Case雪\n.ppm')).toHaveLength(2);
  expect(graph.issues.some(issue => issue.reason === 'cycle')).toBe(false);
  const write = await resolver.observe({ value: b('lists/Case雪\n.ppm'), access: 'write', sequence: 1 });
  const read = await resolver.observe({ value: b('lists/Case雪\n.ppm'), access: 'read-write', sequence: 2 });
  const absent = await resolver.observe({ value: b('optional-absent'), access: 'read', optional: true, sequence: 3 });
  expect(write.location).toEqual(read.location);
  expect(write.original).toEqual(b('lists/Case雪\n.ppm'));
  expect(absent).toMatchObject({ optional: true, live: true, upload: false });
  expect(resolver.graph().edges).toContainEqual({ from: write.id, to: read.id, kind: 'observed-before' });
  expect(volume.readFileSync('/work/lists/Case雪\n.ppm', 'utf8')).toBe('first');
  expect(volume.readFileSync('/work/lists/case雪\n.ppm', 'utf8')).toBe('second');
});

it('retains signed nested protocol bytes and native policy after valid metadata', async () => {
  const resolver = new DependencyResolver({ ...options, policy: { allow: ['concat', 'https'] } });
  const root = await resolver.add({ value: b('https://cdn/lists/root?sig=+%2f#old'), access: 'read', grammar: 'concat' });
  const nodes = await resolver.content(root.id, { content: b("file 'concat:https://cdn/Case?sig=+%2f#part|pipe:3'\nfile_packet_metadata 'key=value'\n") });
  const children = resolver.graph().nodes.filter(node => node.parent === nodes[0].id);
  expect(children.map(node => node.original)).toEqual([b('https://cdn/Case?sig=+%2f#part'), b('pipe:3')]);
  expect(children.map(node => node.kind)).toEqual(['url', 'descriptor']);
  expect(children.every(node => node.live && !node.upload)).toBe(true);
  expect(resolver.graph().issues).toContainEqual(expect.objectContaining({ node: children[1].id, reason: 'policy' }));
});

it.each(evidence.cases)('qualifies independent native metadata access occurrences for $name', async sample => {
  expect(evidence.executableSha256).toBe(registered.executableSha256);
  expect(evidence.sources['libavformat/concatdec.c'].sha256).toBe(registered.sourceSha256);
  expect(evidence.fixturesUnchanged).toBe(true);
  expect(sample.equalStatusStdout).toBe(true);
  const valid = sample.name === 'valid' || sample.name === 'quoted';
  expect(sample.runs.map(run => run.status)).toEqual(valid ? [0, 0] : [1, 1]);
  const resolver = new DependencyResolver({ ...options, cwd: b(evidence.cwd) });
  const root = await resolver.add({ value: b(sample.manifest), access: 'read', grammar: 'concat' });
  await resolver.content(root.id, { content: b(sample.content) });
  expect(resolver.graph().status).toBe(valid ? 'live' : 'incomplete');
  const candidates = [...resolver.graph().nodes];
  let checked = 0;
  for (const line of sample.runs[1].stderr.split('\n')) {
    const start = line.indexOf(" Opening '");
    const end = line.lastIndexOf("' for reading");
    if (start < 0 || end < 0) continue;
    const filename = line.slice(start + 10, end);
    const index = candidates.findIndex(node => node.access === 'read' && node.location && Buffer.from(node.location).equals(b(filename)));
    expect(index, `independent native read: ${filename}`).toBeGreaterThanOrEqual(0);
    candidates.splice(index, 1);
    checked++;
  }
  expect(checked).toBe(valid ? 3 : 1);
  // Malformed manifests retain prefix predictions, not evidence of native opens.
  expect(candidates.map(node => node.original)).toEqual(valid ? [] : [b('Case雪.wav')]);
});
