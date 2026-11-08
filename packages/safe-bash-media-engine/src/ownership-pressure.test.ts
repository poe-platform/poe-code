import { expect, it } from 'vitest';
import { discoverImageMagick } from './imagemagick.js';
import { classifyResource } from './network.js';
import { resource } from './resources.js';
import { DependencyResolver } from './resolver.js';
import { createFFmpegShims, grammarRevision, nativeReference } from './index.js';
import { createImageMagickShims } from './imagemagick.js';
import { imageMagickGrammarRevision, imageMagickReference } from './imagemagick.generated.js';
it.each(['ffmpeg', 'identify'] as const)('owns %s shim argv while the native binding waits', async tool => {
  let release!: () => void; const barrier = new Promise<void>(resolve => { release = resolve; });
  let observed: readonly Uint8Array[] | undefined;
  const run = async ({ argv }: { argv: readonly Uint8Array[] }) => { await barrier; observed = argv; return { exitCode: 0 }; };
  const binding = { argv: 'bytes' as const, lateAccess: 'complete' as const, effects: 'live' as const, run };
  const producer = Buffer.from('clip.png');
  const pending = tool === 'ffmpeg'
    ? createFFmpegShims({ ...binding, build: nativeReference.id, grammarRevision }).ffmpeg([producer], {})
    : createImageMagickShims({ ...binding, build: imageMagickReference.id, grammarRevision: imageMagickGrammarRevision }).identify([producer], {});
  producer.fill(120); release(); await pending;
  expect(new TextDecoder().decode(observed![0])).toBe('clip.png');
});
it('bounds many small HLS dependencies and refuses very large observed content before parsing', async () => {
  const encoder = new TextEncoder();
  const resolver = new DependencyResolver({ cwd: encoder.encode('/work'), budgets: { nodes: 16, bytes: 65536, depth: 8, symlinks: 8 } });
  const root = await resolver.add({ value: encoder.encode('list.m3u8'), access: 'read', grammar: 'hls' });
  await resolver.content(root.id, { content: encoder.encode('#EXTM3U\n' + Array.from({ length: 4096 }, (_, i) => `segment-${i}.ts`).join('\n')) });
  expect(resolver.graph().nodes.length).toBeLessThanOrEqual(16);
  expect(resolver.graph().status).toBe('incomplete');
  const before = resolver.graph().nodes.length;
  expect(await resolver.content(root.id, { content: new Uint8Array(8 * 1024 * 1024) })).toEqual([]);
  expect(resolver.graph().nodes).toHaveLength(before);
});

it('owns ImageMagick argv across delayed filesystem classification', async () => {
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const producer = Buffer.from('clip.png');
  const pending = discoverImageMagick('identify', [producer], { accessible: async () => { await barrier; return true; } });
  producer.fill(120); release();
  const result = await pending;
  expect(new TextDecoder().decode(result.argv[0])).toBe('clip.png');
  expect(new TextDecoder().decode(result.resources[0].operand)).toBe('clip.png');
});

it('owns advisory resource and protocol byte identities', () => {
  const producer = Buffer.from('https://host/clip');
  const classified = classifyResource(producer);
  const dependency = resource(0, producer, 'input', 'read', 'input');
  producer.fill(120);
  expect(new TextDecoder().decode(classified.original)).toBe('https://host/clip');
  expect(new TextDecoder().decode(dependency.value)).toBe('https://host/clip');
});

it('owns resolver references before delayed symlink observations', async () => {
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const resolver = new DependencyResolver({ cwd: new TextEncoder().encode('/work'), budgets: { nodes: 8, bytes: 1024, depth: 8, symlinks: 8 }, link: async () => { await barrier; return undefined; } });
  const producer = Buffer.from('clip.png');
  const pending = resolver.add({ value: producer, access: 'read' });
  producer.fill(120); release();
  const node = await pending;
  expect(new TextDecoder().decode(node.original)).toBe('clip.png');
  expect(new TextDecoder().decode(node.location)).toBe('/work/clip.png');
});
