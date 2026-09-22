import { expect, it } from 'vitest';
import { Volume } from 'memfs';
import { DependencyResolver } from './resolver.js';
import evidence from '../test-fixtures/native/js-resolver-qualification-20260918/native.json';

const b = (value: string) => new TextEncoder().encode(value);
const t = (value: Uint8Array) => new TextDecoder().decode(value);
const options = { cwd: b('/work'), budgets: { nodes: 100, bytes: 100000, depth: 10, symlinks: 10 } };

it('exposes the reader operand separately from advisory symlink resolution and owns both snapshots', async () => {
  const volume = Volume.fromJSON({ '/storage/lists/root': 'file Case.ppm\n' });
  volume.mkdirSync('/work/entry', { recursive: true });
  volume.symlinkSync('/storage/lists/root', '/work/entry/root');
  const resolver = new DependencyResolver({ ...options, link: async path => {
    try { return volume.readlinkSync(t(path), { encoding: 'buffer' }); } catch { return undefined; }
  } });
  const root = await resolver.add({ value: b('entry/root'), access: 'read', grammar: 'concat' });
  expect(root.readerLocation).toEqual(b('/work/entry/root'));
  expect(root.location).toEqual(b('/storage/lists/root'));
  root.readerLocation!.fill(120);
  resolver.graph().nodes[0].readerLocation!.fill(121);
  const [child] = await resolver.content(root.id, { content: b('file Case.ppm\n') });
  expect(child.base.value).toEqual(b('/work/entry/root'));
  expect(child.readerLocation).toEqual(b('/work/entry/Case.ppm'));
  expect(resolver.graph().nodes[0].readerLocation).toEqual(b('/work/entry/root'));
});

it('retains symlink-sensitive parents, collisions and optional input/output aliases on runtime accesses', async () => {
  const resolver = new DependencyResolver({ ...options,
    link: async path => t(path) === '/work/alias' ? b('/storage/deep') : undefined,
  });
  const read = await resolver.observe({ value: b('alias/../Case雪\n.ppm'), access: 'read', sequence: 1 });
  const write = await resolver.observe({ value: b('Case雪\n.ppm'), base: { kind: 'directory', value: b('/storage') }, access: 'write', sequence: 2 });
  const absent = await resolver.observe({ value: b('case雪\n.ppm'), optional: true, access: 'read-write', sequence: 3 });
  expect(read.readerLocation).toEqual(b('/work/alias/../Case雪\n.ppm'));
  expect(read.location).toEqual(write.location);
  expect(write.readerLocation).toEqual(b('/storage/Case雪\n.ppm'));
  expect(absent.readerLocation).toEqual(b('/work/case雪\n.ppm'));
  expect(resolver.graph().edges.filter(edge => edge.kind === 'observed-before')).toEqual([
    { from: read.id, to: write.id, kind: 'observed-before' },
    { from: write.id, to: absent.id, kind: 'observed-before' },
  ]);
  expect([read, write, absent].every(node => node.live && !node.upload)).toBe(true);
});

it('keeps signed network operands, effective manifest bases and file-protocol spelling distinct', async () => {
  const resolver = new DependencyResolver(options);
  const root = await resolver.add({ value: b('https://origin/list?sig=a+%2f#old'), access: 'read', grammar: 'hls' });
  expect(root.readerLocation).toEqual(root.original);
  const [key, init, segment] = await resolver.content(root.id, {
    location: b('https://cdn/live/list?sig=redirect/a#base'),
    content: b('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="?sig=key+%2f#key"\n#EXT-X-MAP:URI="init?sig=+%2F#init"\n../Case.ts?sig=+%2f#frame\n'),
  });
  expect([key, init, segment].map(node => node.readerLocation)).toEqual([
    b('https://cdn/live/list?sig=key+%2f#key'), b('https://cdn/live/init?sig=+%2F#init'), b('https://cdn/Case.ts?sig=+%2f#frame'),
  ]);
  const file = await resolver.add({ value: b('file:pipe:0'), access: 'read' });
  expect(file.readerLocation).toEqual(b('file:pipe:0'));
  expect(file.location).toEqual(b('file:/work/pipe:0'));
  const pipe = await resolver.add({ value: b('pipe:0'), access: 'read' });
  expect(pipe.readerLocation).toBeUndefined();
});

it('qualifies reader operands against independent native access occurrences without deduplicating shared lists', async () => {
  const resolver = new DependencyResolver({ ...options, cwd: b(evidence.cwd) });
  const root = await resolver.add({ value: b('lists/root'), access: 'read', grammar: 'concat' });
  const lists = await resolver.content(root.id, { content: b('ffconcat version 1.0\nfile child\noption safe 0\nfile child\noption safe 0\n') });
  for (const list of lists) await resolver.content(list.id, { grammar: 'concat', content: b("ffconcat version 1.0\nfile '../frames/Case.ppm'\nfile '../frames/case.ppm'\n") });
  const candidates = [...resolver.graph().nodes];
  const native = evidence.results.find(result => result.id === 'shared-nested-decode')!;
  expect(native.status).toBe(0);
  for (const access of native.accesses) {
    const operand = Buffer.concat([b(evidence.cwd + '/'), Buffer.from(access.path_hex, 'hex')]);
    const index = candidates.findIndex(node => node.access === 'read' && Buffer.from(node.readerLocation!).equals(operand));
    expect(index).toBeGreaterThanOrEqual(0);
    candidates.splice(index, 1);
  }
  expect(candidates).toEqual([]);
});
