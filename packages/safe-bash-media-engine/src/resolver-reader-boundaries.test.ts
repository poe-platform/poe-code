import { expect, it } from 'vitest';
import { DependencyResolver } from './resolver.js';

const b = (value: string) => new TextEncoder().encode(value);
const t = (value: Uint8Array | undefined) => value && new TextDecoder().decode(value);
const options = { cwd: b('/work'), budgets: { nodes: 100, bytes: 100000, depth: 10, symlinks: 10 } };

it('joins playlist references against an authority-only effective URL without using query slashes as directories', async () => {
  const resolver = new DependencyResolver(options);
  const root = await resolver.add({ value: b('https://cdn?sig=a/b#old'), access: 'read', grammar: 'hls' });
  const children = await resolver.content(root.id, { content: b('#EXTM3U\nclip?sig=c+%2F#frame\n?sig=next/a\n#EXT-X-KEY:METHOD=AES-128,URI="//keys/a/../key?sig=x+%2F#key"\n') });
  expect(children.map(node => t(node.location))).toEqual([
    'https://cdn/clip?sig=c+%2F#frame',
    'https://cdn?sig=next/a',
    'https://keys/key?sig=x+%2F#key',
  ]);
  expect(children.every(node => node.kind === 'url' && node.live && !node.upload)).toBe(true);
  expect(t(root.original)).toBe('https://cdn?sig=a/b#old');
});

it('records explicit descriptor protocol refusals without inspecting or consuming descriptors', async () => {
  let metadataCalls = 0;
  const resolver = new DependencyResolver({ ...options, policy: { allow: ['file', 'concat'] }, link: async () => { metadataCalls++; return undefined; } });
  const pipe = await resolver.add({ value: b('pipe:0'), access: 'read' });
  const fd = await resolver.add({ value: b('fd:3'), access: 'read-write' });
  expect(resolver.graph().issues.filter(issue => issue.reason === 'policy').map(issue => issue.node)).toEqual([pipe.id, fd.id]);
  expect(metadataCalls).toBe(0);
  expect([pipe, fd].every(node => node.kind === 'descriptor' && node.location === undefined)).toBe(true);
  expect(resolver.graph().status).toBe('incomplete');
});

it('uses image filename grammar for observed lists without recursively expanding their entries', async () => {
  const resolver = new DependencyResolver(options);
  const root = await resolver.add({ value: b('@lists/names'), path: b('lists/names'), literal: true, access: 'read', grammar: 'magick-list' });
  const children = await resolver.content(root.id, { content: b('"PNG:雪\nframe.tif[2]" @nested @nested label:@text https://cdn/a?sig=x+%2F#frag frame-*.png @__observed_list__') });
  expect(children.map(node => [t(node.original), node.kind, t(node.location), node.grammar])).toEqual([
    ['PNG:雪\nframe.tif[2]', 'image-selector', '/work/雪\nframe.tif', undefined],
    ['@nested', 'path', '/work/@nested', undefined],
    ['@nested', 'path', '/work/@nested', undefined],
    ['text', 'path', '/work/text', 'text'],
    ['label:@text', 'synthetic', undefined, undefined],
    ['https://cdn/a?sig=x+%2F#frag', 'url', 'https://cdn/a?sig=x+%2F#frag', undefined],
    ['frame-*.png', 'path', '/work/frame-*.png', undefined],
    ['@__observed_list__', 'path', '/work/@__observed_list__', undefined],
  ]);
  expect(children.filter(node => t(node.original) === '@nested')).toHaveLength(2);
  expect(resolver.graph().status).toBe('live');
});

it.each([
  ['magick-script', 'xc:red -write first.ppm -negate -write second.ppm -unknown'],
  ['magick-list', 'xc:red xc:blue'],
  ['msl', '<image><read filename="xc:red"/><write filename="first.ppm"/><read filename="xc:blue"/></image>'],
] as const)('uses invocation filesystem classification for observed %s content', async (grammar, content) => {
  const probes: string[] = [];
  const resolver = new DependencyResolver({ ...options, accessible: async (path: Uint8Array) => {
    probes.push(t(path)!);
    return t(path) === '/work/xc:red';
  } });
  const root = await resolver.add({ value: b('reader'), literal: true, access: 'read', grammar });
  const children = await resolver.content(root.id, { content: b(content) });
  expect(children.find(node => t(node.original) === 'xc:red')).toMatchObject({ kind: 'path', location: b('/work/xc:red'), upload: false });
  expect(probes).toContain('/work/xc:red');
  if (grammar !== 'magick-script') expect(children.find(node => t(node.original) === 'xc:blue')).toMatchObject({ kind: 'synthetic', location: undefined });
});

it('keeps failed filesystem probes advisory and preserves traversal bytes', async () => {
  const probes: string[] = [];
  const resolver = new DependencyResolver({ ...options, cwd: b('/work/link/..'), accessible: async (path: Uint8Array) => {
    probes.push(t(path)!);
    throw Error('metadata unavailable');
  } });
  const root = await resolver.add({ value: b('reader'), literal: true, access: 'read', grammar: 'magick-script' });
  const children = await resolver.content(root.id, { content: b('xc:red -write first.ppm -negate +write second.ppm -unknown') });
  expect(probes).toContain('/work/link/../xc:red');
  expect(children.filter(node => node.access === 'write').map(node => t(node.original))).toEqual(['first.ppm', 'second.ppm']);
  expect(children.every(node => node.live && !node.upload)).toBe(true);
});

it('keeps native stdin text accessibility separate from a literal dash file', async () => {
  const probes: string[] = [];
  const resolver = new DependencyResolver({ ...options, accessible: async (path: Uint8Array) => {
    probes.push(t(path)!);
    return false;
  } });
  const root = await resolver.add({ value: b('reader'), literal: true, access: 'read', grammar: 'magick-script' });
  const children = await resolver.content(root.id, { content: b('xc:red -print @- -exit') });
  expect(children.find(node => node.grammar === 'text' && t(node.original) === '@-')).toMatchObject({kind:'descriptor',location:undefined});
  expect(probes).not.toContain('/work/-');
});
