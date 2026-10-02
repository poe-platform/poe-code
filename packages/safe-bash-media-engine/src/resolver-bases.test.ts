import { expect, it } from 'vitest';
import { DependencyResolver, DiscoveryBudgetError } from './resolver.js';

const b = (value: string) => new TextEncoder().encode(value);
const t = (value: Uint8Array | undefined) => value && new TextDecoder().decode(value);
const options = { cwd: b('/work'), budgets: { nodes: 100, bytes: 10000, depth: 10, symlinks: 10 } };

it('resolves manifest members from the reader spelling across symlinks and shared nested lists', async () => {
  const resolver = new DependencyResolver({ ...options, link: async path => {
    const links: Record<string, string> = {
      '/work/entry/list': '/storage/manifests/list',
      '/work/entry/nested/list': '/storage/shared/list',
      '/work/other/list': '/storage/shared/list',
    };
    const target = links[t(path)!];
    return target ? b(target) : undefined;
  } });
  const root = await resolver.add({ value: b('entry/list'), access: 'read', grammar: 'concat' });
  expect(t(root.location)).toBe('/storage/manifests/list');
  const [nested] = await resolver.content(root.id, { content: b("file 'nested/list'\n") });
  expect(t(nested.base.value)).toBe('/work/entry/list');
  expect(t(nested.location)).toBe('/storage/shared/list');
  const other = await resolver.add({ value: b('other/list'), access: 'read', grammar: 'concat' });
  for (const [node, expected] of [[nested, '/work/entry/nested/clip.ppm'], [other, '/work/other/clip.ppm']] as const) {
    const [member] = await resolver.content(node.id, { grammar: 'concat', content: b("file 'clip.ppm'\n") });
    expect(t(member.location)).toBe(expected);
  }
  const [changed] = await resolver.content(root.id, { content: b("file '../next.ppm'\n") });
  expect(t(changed.base.value)).toBe('/work/entry/list');
  expect(t(changed.original)).toBe('../next.ppm');
  expect(t(changed.location)).toBe('/work/next.ppm');
  expect(resolver.graph().status).toBe('live');
});

it('retains file protocol manifest bases without substituting symlink targets', async () => {
  const resolver = new DependencyResolver({ ...options, link: async path => t(path) === '/work/entry/list' ? b('/storage/list') : undefined });
  const root = await resolver.add({ value: b('file:entry/list'), access: 'read', grammar: 'concat' });
  expect(t(root.location)).toBe('file:/storage/list');
  const [member] = await resolver.content(root.id, { content: b("file 'clip.ppm'\n") });
  expect(t(member.base.value)).toBe('file:entry/list');
  expect(t(member.location)).toBe('file:/work/entry/clip.ppm');
  expect(member.kind).toBe('file-protocol');
});

it('uses an observed effective URL instead of a local symlink target for manifest children', async () => {
  const resolver = new DependencyResolver({ ...options, link: async path => t(path) === '/work/list' ? b('/storage/list') : undefined });
  const root = await resolver.add({ value: b('list'), access: 'read', grammar: 'hls' });
  const nodes = await resolver.content(root.id, {
    location: b('https://cdn/live/list.m3u8?sig=parent'),
    content: b('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="../key?sig=a+%2F#key"\n#EXT-X-MAP:URI="init?sig=b+%2F"\nsegment?sig=c+%2F\n'),
  });
  expect(nodes.map(node => t(node.location))).toEqual([
    'https://cdn/key?sig=a+%2F#key', 'https://cdn/live/init?sig=b+%2F', 'https://cdn/live/segment?sig=c+%2F',
  ]);
  expect(nodes.every(node => node.kind === 'url' && !node.upload)).toBe(true);
});

it('uses the pinned DASH reader BaseURL grammar rather than generic XML bases', async () => {
  const resolver = new DependencyResolver(options);
  const root = await resolver.add({ value: b('https://cdn/root/list.mpd?sig=original'), access: 'read', grammar: 'dash' });
  const nodes = await resolver.content(root.id, { content: b('<MPD><Period><Representation xml:base="video/"><BaseURL xml:base="alternate/">clip.mp4?sig=a+%2F</BaseURL><SegmentBase><Initialization sourceURL="init.mp4?sig=b+%2F"/></SegmentBase></Representation></Period></MPD>') });
  expect(nodes.map(node => [t(node.original), t(node.location)])).toEqual([
    ['clip.mp4?sig=a+%2F', 'https://cdn/root/clip.mp4?sig=a+%2F'],
    ['init.mp4?sig=b+%2F', 'https://cdn/root/init.mp4?sig=b+%2F'],
  ]);
  expect(nodes.every(node => node.live && !node.upload && node.access === 'read')).toBe(true);
});

it('retains inherited XML bases for SVG external resources', async () => {
  const resolver = new DependencyResolver(options);
  const root = await resolver.add({ value: b('https://cdn/root/image.svg'), access: 'read', grammar: 'svg' });
  const nodes = await resolver.content(root.id, { content: b('<svg xml:base="images/"><g xml:base="alternate/"><image href="a.png?sig=a+%2F"/></g></svg>') });
  expect(nodes.map(node => t(node.location))).toEqual(['https://cdn/root/images/alternate/a.png?sig=a+%2F']);
});

it('preserves trailing directory requirements after canonical symlink traversal', async () => {
  const resolver = new DependencyResolver({ ...options, link: async path => t(path) === '/work/alias' ? b('/media/image.ppm') : undefined });
  for (const suffix of ['/', '/.']) {
    const node = await resolver.add({ value: b('alias' + suffix), access: 'read' });
    expect(t(node.original)).toBe('alias' + suffix);
    expect(t(node.location)).toBe('/media/image.ppm' + suffix);
  }
  const targetDirectory = new DependencyResolver({ ...options, link: async path => t(path) === '/work/alias' ? b('/media/image.ppm/') : undefined });
  expect(t((await targetDirectory.add({ value: b('alias'), access: 'read' })).location)).toBe('/media/image.ppm/');
});

it('charges parsed paths and explicit bases before admitting a reference', async () => {
  for (const extra of [
    { path: b('x'.repeat(50)) },
    { base: { kind: 'directory' as const, value: b('/' + 'x'.repeat(50)) } },
  ]) {
    const resolver = new DependencyResolver({ ...options, budgets: { ...options.budgets, bytes: 30 } });
    await expect(resolver.add({ value: b('x'), access: 'read', ...extra })).rejects.toBeInstanceOf(DiscoveryBudgetError);
    expect(resolver.graph().status).toBe('incomplete');
    expect(resolver.graph().nodes).toEqual([]);
  }
});

it('charges effective observation URLs even when content has no dependencies', async () => {
  const resolver = new DependencyResolver({ ...options, budgets: { ...options.budgets, bytes: 30 } });
  const root = await resolver.add({ value: b('x'), access: 'read', grammar: 'text' });
  await resolver.content(root.id, { content: b(''), location: b('https://cdn/' + 'x'.repeat(50)) });
  expect(resolver.graph().status).toBe('incomplete');
  expect(resolver.graph().issues.some(issue => issue.reason === 'budget')).toBe(true);
});

it('resolves bare relative file-protocol manifest members beside the cwd reader', async () => {
  const resolver = new DependencyResolver(options);
  const root = await resolver.add({ value: b('file:list'), access: 'read', grammar: 'concat' });
  const [member] = await resolver.content(root.id, { content: b('file clip.ppm\n') });
  expect(t(member.base.value)).toBe('file:list');
  expect(t(member.location)).toBe('file:/work/clip.ppm');
});

it('treats a manifest dash as a relative filename or URI rather than invocation stdin', async () => {
  for (const [value, grammar, content, expected, kind] of [
    ['lists/list', 'concat', 'file -\n', '/work/lists/-', 'path'],
    ['https://cdn/live/list?sig=a+%2F', 'hls', '#EXTM3U\n-\n', 'https://cdn/live/-', 'url'],
  ] as const) {
    const resolver = new DependencyResolver(options);
    const root = await resolver.add({ value: b(value), access: 'read', grammar });
    const [member] = await resolver.content(root.id, { content: b(content) });
    expect(member.kind).toBe(kind);
    expect(t(member.location)).toBe(expected);
    expect(t(member.original)).toBe('-');
    expect(member.upload).toBe(false);
  }
});

it('keeps concat protocol member ordering as graph edges including repeated members', async () => {
  const resolver = new DependencyResolver(options);
  const root = await resolver.add({ value: b('concat:a|b|a'), access: 'read' });
  const graph = resolver.graph();
  const children = graph.nodes.filter(node => node.parent === root.id);
  expect(children.map(node => t(node.original))).toEqual(['a', 'b', 'a']);
  expect(graph.edges.filter(edge => edge.kind === 'before')).toEqual([
    { from: children[0].id, to: children[1].id, kind: 'before' },
    { from: children[1].id, to: children[2].id, kind: 'before' },
  ]);
});

it('keeps a dash inside a protocol wrapper as a native file name without changing explicit pipes', async () => {
  const resolver = new DependencyResolver(options);
  const root = await resolver.add({ value: b('concat:-|pipe:3'), access: 'read' });
  const children = resolver.graph().nodes.filter(node => node.parent === root.id);
  expect(children.map(node => node.kind)).toEqual(['path', 'descriptor']);
  expect(t(children[0].location)).toBe('/work/-');
  expect(t(children[0].original)).toBe('-');
  expect(children[1].location).toBeUndefined();
});
