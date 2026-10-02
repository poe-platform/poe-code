import { expect, it } from 'vitest';
import { DependencyResolver } from './resolver.js';

const b = (value: string) => new TextEncoder().encode(value);
const t = (value: Uint8Array) => new TextDecoder().decode(value);
const options = { cwd: b('/work'), budgets: { nodes: 50, bytes: 100000, depth: 10, symlinks: 10 } };

it('uses literal concat directive keywords rather than filename quoting grammar', async () => {
  for (const keyword of ["'file'", 'fi\\le']) {
    const resolver = new DependencyResolver(options);
    const root = await resolver.add({ value: b('lists/root'), access: 'read', grammar: 'concat' });
    const nodes = await resolver.content(root.id, { content: b(`file first.ppm\n${keyword} absent.ppm\nfile later.ppm\n`) });
    expect(nodes.map(node => t(node.original))).toEqual(['first.ppm']);
    expect(resolver.graph().issues).toContainEqual(expect.objectContaining({ reason: 'syntax' }));
    expect(resolver.graph().status).toBe('incomplete');
  }
});

it('retains concat reference spans and order across CR, CRLF and NUL line boundaries', async () => {
  const resolver = new DependencyResolver(options);
  const root = await resolver.add({ value: b('lists/root'), access: 'read', grammar: 'concat' });
  const content = "file 'A.ppm'\rfile 'a.ppm'\r\nfile '雪.ppm'\0file '../shared.ppm'\n";
  const nodes = await resolver.content(root.id, { content: b(content) });
  expect(nodes.map(node => t(node.original))).toEqual(['A.ppm', 'a.ppm', '雪.ppm', '../shared.ppm']);
  expect(nodes.map(node => t(node.base.value))).toEqual(Array(4).fill('/work/lists/root'));
  expect(nodes.map(node => t(b(content).slice(node.span!.start, node.span!.end)))).toEqual([
    "file 'A.ppm'", "file 'a.ppm'", "file '雪.ppm'", "file '../shared.ppm'",
  ]);
  expect(resolver.graph().edges.filter(edge => edge.kind === 'before')).toEqual([
    { from: nodes[0].id, to: nodes[1].id, kind: 'before' },
    { from: nodes[1].id, to: nodes[2].id, kind: 'before' },
    { from: nodes[2].id, to: nodes[3].id, kind: 'before' },
  ]);
});

it('requires the selected HLS reader header before predicting dependencies', async () => {
  const resolver = new DependencyResolver(options);
  const root = await resolver.add({ value: b('https://cdn/list'), access: 'read', grammar: 'hls' });
  expect(await resolver.content(root.id, { content: b('absent.ts\n') })).toEqual([]);
  expect(resolver.graph().status).toBe('incomplete');
  expect(resolver.graph().issues).toContainEqual(expect.objectContaining({ reason: 'syntax' }));
});

it('applies HLS line chomp without normalizing signed URI bytes or leading spaces', async () => {
  const resolver = new DependencyResolver(options);
  const root = await resolver.add({ value: b('https://cdn/path/list?sig=old'), access: 'read', grammar: 'hls' });
  const content = '#EXTM3U \t\r#EXT-X-KEY:METHOD=AES-128,URI="key?sig=%2f+X#k" \t\r\n#EXT-X-MAP:URI="init?sig=%2F+Y"\0 segment?sig=a+b#f \t\v\f\n';
  const nodes = await resolver.content(root.id, { content: b(content) });
  expect(nodes.map(node => t(node.original))).toEqual(['key?sig=%2f+X#k', 'init?sig=%2F+Y', ' segment?sig=a+b#f']);
  expect(nodes.map(node => t(node.location!))).toEqual([
    'https://cdn/path/key?sig=%2f+X#k', 'https://cdn/path/init?sig=%2F+Y', 'https://cdn/path/ segment?sig=a+b#f',
  ]);
  expect(nodes.every(node => node.live && !node.upload)).toBe(true);
});
