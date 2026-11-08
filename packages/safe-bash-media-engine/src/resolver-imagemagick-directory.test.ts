import { expect, it } from 'vitest';
import { Volume } from 'memfs';
import { DependencyResolver } from './resolver.js';

const b = (value: string) => new TextEncoder().encode(value);
const s = (value: Uint8Array) => new TextDecoder().decode(value);

it.each([
  ['directory', []],
  ['directory red.ppm', ['red.ppm']],
  ['-read directory red.ppm', ['-read', 'directory', 'red.ppm']],
])('filters observed ImageMagick list directories: %s', async (content, expected) => {
  const volume = Volume.fromJSON({ '/work/red.ppm': 'image' });
  volume.mkdirSync('/work/directory');
  const probes: string[] = [];
  const resolver = new DependencyResolver({
    cwd: b('/work'), budgets: { nodes: 100, bytes: 100000, depth: 10, symlinks: 10 },
    accessible: async path => { try { return volume.statSync(s(path)).isFile(); } catch { return false; } },
    exists: async path => volume.existsSync(s(path)),
    directory: async path => {
      probes.push(s(path));
      try { return volume.statSync(s(path)).isDirectory(); } catch { return false; }
    },
  });
  const root = await resolver.add({ value: b('names.txt'), literal: true, access: 'read', grammar: 'magick-list' });
  const nodes = await resolver.content(root.id, { content: b(content) });
  expect(nodes.map(node => s(node.original))).toEqual(expected);
  expect(probes).toContain('/work/directory');
  expect(nodes.every(node => node.live && !node.upload)).toBe(true);
});

it.each(['unknown', 'failed'])('keeps observed list directory classification %s advisory', async mode => {
  const resolver = new DependencyResolver({
    cwd: b('/work'), budgets: { nodes: 100, bytes: 100000, depth: 10, symlinks: 10 },
    accessible: async () => false,
    directory: async () => { if (mode === 'failed') throw Error('unavailable'); return undefined; },
  });
  const root = await resolver.add({ value: b('names.txt'), literal: true, access: 'read', grammar: 'magick-list' });
  const nodes = await resolver.content(root.id, { content: b('directory red.ppm') });
  expect(nodes.map(node => s(node.original))).toEqual(['directory', 'red.ppm']);
  expect(resolver.graph().issues.some(issue => issue.detail.includes('directory filtering'))).toBe(true);
});

it('probes observed members against cwd without normalizing symlink-sensitive parents', async () => {
  const probes: string[] = [];
  const resolver = new DependencyResolver({
    cwd: b('/work'), budgets: { nodes: 100, bytes: 100000, depth: 10, symlinks: 10 },
    directory: async path => { probes.push(s(path)); return s(path) === '/work/link/../directory'; },
  });
  const root = await resolver.add({ value: b('lists/names.txt'), literal: true, access: 'read', grammar: 'magick-list' });
  const nodes = await resolver.content(root.id, { content: b('link/../directory red.ppm') });
  expect(nodes.map(node => s(node.original))).toEqual(['red.ppm']);
  expect(probes).toContain('/work/link/../directory');
});

it('keeps a real member whose spelling matches the internal list wrapper', async () => {
  const resolver = new DependencyResolver({
    cwd: b('/work'), budgets: { nodes: 100, bytes: 100000, depth: 10, symlinks: 10 },
    directory: async () => false,
  });
  const root = await resolver.add({ value: b('names.txt'), literal: true, access: 'read', grammar: 'magick-list' });
  const nodes = await resolver.content(root.id, { content: b('@__observed_list__') });
  expect(nodes).toMatchObject([{ original: b('@__observed_list__'), location: b('/work/@__observed_list__'), kind: 'path' }]);
});

it('defers an empty observed list fallback without inventing a wrapper filename', async () => {
  const resolver = new DependencyResolver({ cwd: b('/work'), budgets: { nodes: 100, bytes: 100000, depth: 10, symlinks: 10 } });
  const root = await resolver.add({ value: b('names.txt'), literal: true, access: 'read', grammar: 'magick-list' });
  expect(await resolver.content(root.id, { content: b('') })).toEqual([]);
  expect(resolver.graph().issues.some(issue => issue.reason === 'live' && issue.detail.includes('original runtime operand'))).toBe(true);
});
