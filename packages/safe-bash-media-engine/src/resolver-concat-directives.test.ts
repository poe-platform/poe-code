import { expect, it } from 'vitest';
import { DependencyResolver } from './resolver.js';

const b = (value: string) => new TextEncoder().encode(value);
const t = (value: Uint8Array) => new TextDecoder().decode(value);
const options = { cwd: b('/work'), budgets: { nodes: 100, bytes: 100000, depth: 10, symlinks: 10 } };

it('marks concat captures without any file directive incomplete', async () => {
  for (const content of ['', '# original comment\n', 'ffconcat version 1.0\nstream\n']) {
    const resolver = new DependencyResolver(options);
    const root = await resolver.add({ value: b('lists/root'), access: 'read', grammar: 'concat' });
    expect(await resolver.content(root.id, { content: b(content) })).toEqual([]);
    expect(resolver.graph().status).toBe('incomplete');
  }
});

it('stops concat prediction at invalid literal version keywords while retaining the parsed prefix', async () => {
  for (const header of ['ffconcat version 2.0', "ffconcat 'version' 1.0", 'ffconcat version', 'ffconcat']) {
    const resolver = new DependencyResolver(options);
    const root = await resolver.add({ value: b('lists/root'), access: 'read', grammar: 'concat' });
    const nodes = await resolver.content(root.id, { content: b(`file A.ppm\n${header}\nfile a.ppm\n`) });
    expect(nodes.map(node => t(node.original))).toEqual(['A.ppm']);
    expect(resolver.graph().status).toBe('incomplete');
    expect(resolver.graph().issues).toContainEqual(expect.objectContaining({ reason: 'syntax' }));
  }
});

it('requires the native file and stream directive contexts before predicting later dependencies', async () => {
  for (const directive of ['duration 1', 'inpoint 0', 'outpoint 1', 'option key value', 'file_packet_meta key value', 'file_packet_metadata key=value', 'exact_stream_id 1', 'stream_meta key value', 'stream_codec ppm', 'stream_extradata 00']) {
    const resolver = new DependencyResolver(options);
    const root = await resolver.add({ value: b('lists/root'), access: 'read', grammar: 'concat' });
    expect(await resolver.content(root.id, { content: b(`${directive}\nfile later.ppm\n`) })).toEqual([]);
    expect(resolver.graph().status).toBe('incomplete');
  }
});

it('uses keyword then quoted-string argument grammar for concat metadata and option directives', async () => {
  for (const directive of ['option key', "file_packet_meta key ''", 'file_packet_metadata', 'stream_meta key']) {
    const resolver = new DependencyResolver(options);
    const root = await resolver.add({ value: b('lists/root'), access: 'read', grammar: 'concat' });
    const nodes = await resolver.content(root.id, { content: b(`file first.ppm\nstream\n${directive}\nfile later.ppm\n`) });
    expect(nodes.map(node => t(node.original))).toEqual(['first.ppm']);
    expect(resolver.graph().status).toBe('incomplete');
  }
});

it('resets concat directive context for changed captures and retains shared ordered members', async () => {
  const resolver = new DependencyResolver(options);
  const root = await resolver.add({ value: b('lists/root'), access: 'read', grammar: 'concat' });
  const nodes = await resolver.content(root.id, { content: b("ffconcat version 1.0 ignored\nfile '雪.ppm'\noption key 'a b'\nstream\nstream_meta key 'a b'\nfile '雪.ppm'\n") });
  expect(nodes.map(node => t(node.location!))).toEqual(['/work/lists/雪.ppm', '/work/lists/雪.ppm']);
  expect(nodes[0].id).not.toBe(nodes[1].id);
  expect(resolver.graph().status).toBe('live');
  expect(await resolver.content(root.id, { content: b('option key value\nfile later.ppm\n') })).toEqual([]);
  expect(resolver.graph().status).toBe('incomplete');
});
