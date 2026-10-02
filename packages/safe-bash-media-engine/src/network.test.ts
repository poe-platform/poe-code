import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { discover } from './discover.js';
import { resource } from './resources.js';
import { DependencyResolver, resolveDependencies } from './resolver.js';
import { classifyResource, filesystemCandidates } from './network.js';
import { resolveLocation } from './resolution-path.js';
const b = (s: string) => new TextEncoder().encode(s);
it.each([
  'https://localhost/single-use?sig=%2f+synthetic',
  'udp://127.0.0.1:9000?pkt_size=128',
  'tcp://localhost:9000?listen=1',
  'unknown:opaque',
])('excludes native reader %s even when other hints describe a local snapshot', async reader => {
  const resolver = new DependencyResolver(options);
  const node = await resolver.add({ value: b('snapshot'), access: 'read' });
  expect(filesystemCandidates({ ...resolver.graph(), nodes: [{ ...node,
    readerLocation: b(reader),
  }] })).toEqual([]);
});
it('owns a filesystem candidate reader operand before the producer reuses its buffer', async () => {
  const resolver = new DependencyResolver(options);
  const node = await resolver.add({ value: b('local'), access: 'read' });
  const [candidate] = filesystemCandidates({ ...resolver.graph(), nodes: [node] });
  node.readerLocation!.fill(120);
  expect(candidate.readerLocation).toEqual(b('/work/local'));
});
it('rejects a non-byte native reader operand at the materialization candidate boundary', async () => {
  const resolver = new DependencyResolver(options);
  const node = await resolver.add({ value: b('local'), access: 'read' });
  expect(() => filesystemCandidates({ ...resolver.graph(), nodes: [{ ...node,
    readerLocation: 'https://localhost/single-use' as unknown as Uint8Array,
  }] })).toThrow('Filesystem candidates require original byte fields');
});
it.each(['segment.ts?sig=%2f+%FF', '/segment.ts'])('rejects a snapshot location concealing network member %s', async value => {
  const resolver = new DependencyResolver(options);
  const node = await resolver.add({ value: b(value), access: 'read',
    base: { kind: 'resource', value: b('http://localhost/nested/index.m3u8?token=synthetic') } });
  const snapshot = { ...node, kind: 'path' as const, location: b('/work/snapshot') };
  expect(filesystemCandidates({ ...resolver.graph(), nodes: [snapshot] })).toEqual([]);
});
it('owns the reader base once before classifying a filesystem candidate', async () => {
  const resolver = new DependencyResolver(options);
  const node = await resolver.add({ value: b('segment.ts'), access: 'read' });
  let reads = 0;
  const base = { kind: 'resource' as const, get value() {
    reads++;
    return b(reads === 1 ? 'http://localhost/nested/index.m3u8' : '/work/index.m3u8');
  } };
  expect(filesystemCandidates({ ...resolver.graph(), nodes: [{ ...node, base }] })).toEqual([]);
  expect(reads).toBe(1);
});
it.each(['value', 'original', 'path', 'location'] as const)('rejects non-byte %s at the filesystem candidate boundary', async field => {
  const resolver = new DependencyResolver(options);
  const node = await resolver.add({ value: b('local'), access: 'read' });
  const malformed = { ...node, [field]: 'https://localhost/single-use?sig=synthetic' };
  expect(() => filesystemCandidates({ ...resolver.graph(), nodes: [malformed as unknown as typeof node] }))
    .toThrow('Filesystem candidates require original byte fields');
});
it('rejects a non-byte resolution base before filesystem candidate materialization', async () => {
  const resolver = new DependencyResolver(options);
  const node = await resolver.add({ value: b('local'), access: 'read' });
  const malformed = { ...node, base: { kind: 'resource', value: 'https://localhost/index.m3u8' } };
  expect(() => filesystemCandidates({ ...resolver.graph(), nodes: [malformed as unknown as typeof node] }))
    .toThrow('Filesystem candidates require original byte fields');
});
it.each(['//cdn.invalid', '//cdn.invalid?sig=%2f+%FF&x=1&x=2', '//cdn.invalid#fragment'])('preserves an authority-only native reference %s without adding a path', reference => {
  expect(resolveLocation(b(reference), { kind: 'resource', value: b('https://origin.invalid/nested/index.m3u8?parent=synthetic') }))
    .toEqual(b('https:' + reference));
});
it.each(['custom_scheme:segment?sig=%2f+%FF', 'custom,option:segment'])('uses native URL reference syntax for %s rather than joining it to a network parent', reference => {
  expect(resolveLocation(b(reference), { kind: 'resource', value: b('https://origin.invalid/nested/index.m3u8?parent=synthetic') }))
    .toEqual(b(reference));
});
it('classifies a native reference with an unrecognized AVIO scheme as a caller cwd file', async () => {
  const link = vi.fn<(path: Uint8Array) => Promise<Uint8Array | undefined>>(async () => undefined);
  const resolver = new DependencyResolver({ ...options, link });
  const parent = await resolver.add({ value: b('https://origin.invalid/nested/index.m3u8'), access: 'read', grammar: 'hls' });
  const [child] = await resolver.content(parent.id, { content: b('#EXTM3U\n#EXTINF:1,\ncustom_scheme:segment.ts\n') });
  expect(child).toMatchObject({ original: b('custom_scheme:segment.ts'), kind: 'path', location: b('/work/custom_scheme:segment.ts') });
  expect(link.mock.calls.map(([path]) => path)).toEqual([b('/work'), b('/work/custom_scheme:segment.ts')]);
  expect(filesystemCandidates(resolver.graph())).toEqual([child]);
});
it.each(['reference', 'base'] as const)('resolves native URL bytes despite shadowed %s length', field => {
  const reference = Buffer.from('segment.ts?sig=%2f+\xff&x=1&x=2', 'latin1');
  const location = b('https://localhost/nested/index.m3u8?parent=synthetic');
  Object.defineProperty(field === 'reference' ? reference : location, 'length', { value: 0 });
  expect(resolveLocation(reference, { kind: 'resource', value: location })).toEqual(
    new Uint8Array(Buffer.from('https://localhost/nested/segment.ts?sig=%2f+\xff&x=1&x=2', 'latin1')),
  );
  expect(classifyResource(resolveLocation(reference, { kind: 'resource', value: location })).kind).toBe('native-protocol');
});
it.each(['resolver', 'discovery'] as const)('keeps %s cwd bytes rather than a caller-supplied iterator', async route => {
  const cwd = b('/work');
  const iterator = vi.fn(() => b('/substituted')[Symbol.iterator]());
  cwd[Symbol.iterator] = iterator;
  const resolver = new DependencyResolver({ ...options, cwd });
  const node = route === 'resolver' ? await resolver.add({ value: b('clip.wav'), access: 'read' })
    : (await resolveDependencies(discover('ffprobe', [b('clip.wav')]), { ...options, cwd })).nodes[0];
  expect(node.location).toEqual(b('/work/clip.wav'));
  expect(iterator).not.toHaveBeenCalled();
});
it('classifies resource bytes before reading shadowed operand metadata', () => {
  const value = b('https://localhost/single-use?sig=%2f+%FF');
  Object.defineProperty(value, 'length', { value: 0 });
  expect(resource(0, value, 'input', 'read', 'input')).toMatchObject({
    kind: 'url', value: b('https://localhost/single-use?sig=%2f+%FF'),
  });
});
it('does not let a graph array filter put native URLs in filesystem candidates', async () => {
  const resolver = new DependencyResolver(options);
  const node = await resolver.add({ value: b('https://localhost/single-use?sig=synthetic'), access: 'read' });
  const nodes = [node];
  const filter = vi.fn(() => nodes);
  Object.defineProperty(nodes, 'filter', { value: filter });
  expect(filesystemCandidates({ ...resolver.graph(), nodes })).toEqual([]);
  expect(filter).not.toHaveBeenCalled();
});
it('replays the recorded redirected HLS location without fetching or materializing its native URLs', async () => {
  const oracle = JSON.parse(readFileSync(new URL('../tests/fixtures/hls-redirect-oracle.json', import.meta.url), 'utf8'));
  expect(oracle.status).toBe(0);
  const discovery = discover('ffprobe', oracle.argv.slice(1).map(b));
  expect(discovery.argv).toEqual(oracle.argv.slice(1).map(b));
  const input = discovery.dependencies.find(node => node.role === 'input')!;
  expect(input.kind).toBe('url');
  const link = vi.fn(async () => undefined);
  const resolver = new DependencyResolver({ ...options, link });
  const parent = await resolver.add({ value: input.value, grammar: 'hls', access: 'read', stage: input.stage });
  const entry = new URL(oracle.argv.at(-1));
  const redirected = entry.origin + oracle.requests[1].path;
  const [segment] = await resolver.content(parent.id, { location: b(redirected), content: b(oracle.playlist) });
  expect(segment.location).toEqual(b(entry.origin + oracle.requests[2].path));
  expect(oracle.requests.map((request: { x_oracle: string }) => request.x_oracle)).toEqual(['synthetic', 'synthetic', 'synthetic']);
  expect(filesystemCandidates(resolver.graph())).toEqual([]);
  expect(link).not.toHaveBeenCalled();
});
it('discovers indexed URL and request option bytes without calling a caller-owned map', () => {
  const argv = ['-headers', 'X-Oracle: synthetic\r\n', '-i', 'https://localhost/single-use?sig=%2f+%FF', '-f', 'null', '-'].map(b);
  const map = vi.fn(() => ['-i', '/work/snapshot', '-f', 'null', '-'].map(b));
  Object.defineProperty(argv, 'map', { value: map });
  const discovery = discover('ffmpeg', argv);
  expect(discovery.argv).toEqual(Array.from({ length: argv.length }, (_, index) => argv[index]));
  expect(discovery.dependencies.find(node => node.role === 'input')).toMatchObject({
    kind: 'url', value: b('https://localhost/single-use?sig=%2f+%FF'), stage: 'input',
  });
  expect(map).not.toHaveBeenCalled();
});
it('classifies native URL bytes despite shadowed operand length metadata', () => {
  const original = b('https://localhost/single-use?sig=%2f+%FF');
  Object.defineProperty(original, 'length', { value: 0 });
  expect(classifyResource(original)).toEqual({
    original: b('https://localhost/single-use?sig=%2f+%FF'),
    kind: 'native-protocol', protocol: 'https',
  });
});
it('excludes a URL disguised by length metadata from filesystem candidates', async () => {
  const resolver = new DependencyResolver(options);
  const node = await resolver.add({ value: b('https://localhost/single-use?sig=synthetic'), access: 'read' });
  Object.defineProperty(node.original, 'length', { value: 0 });
  Object.defineProperty(node.location!, 'length', { value: 0 });
  expect(filesystemCandidates({ ...resolver.graph(), nodes: [{ ...node, kind: 'path' }] })).toEqual([]);
});
const options = { cwd: b('/work'), budgets: { nodes: 100, bytes: 10000, depth: 10, symlinks: 10 } };
it('owns filesystem traversal bytes when returning materialization candidates', async () => {
  const resolver = new DependencyResolver({ ...options, link: async path =>
    new TextDecoder().decode(path) === '/work/alias' ? b('local') : undefined });
  await resolver.add({ value: b('alias'), access: 'read' });
  const graph = resolver.graph();
  const [candidate] = filesystemCandidates(graph);
  const original = structuredClone(candidate.trace);
  for (const entry of graph.nodes[0].trace) {
    entry.path.fill(120);
    entry.target?.fill(120);
  }
  expect(candidate.trace).toEqual(original);
});
it.each(['local', '-'])('excludes a network value hidden behind local graph metadata for %s', async original => {
  const resolver = new DependencyResolver(options);
  const node = await resolver.add({ value: b(original), access: 'read',
    base: { kind: 'resource', value: b('/work/list.m3u8') } });
  expect(filesystemCandidates({ ...resolver.graph(), nodes: [{ ...node,
    value: b('http://localhost/single-use?sig=%2f+synthetic'),
  }] })).toEqual([]);
});
it('owns candidate value bytes before returning filesystem materialization hints', async () => {
  const resolver = new DependencyResolver(options);
  const node = await resolver.add({ value: b('local'), access: 'read' });
  const [candidate] = filesystemCandidates({ ...resolver.graph(), nodes: [node] });
  node.value.fill(120);
  expect(candidate.value).toEqual(b('local'));
});
it.each([':opaque', '://host/dir/list'])('keeps an empty native protocol in %s out of filesystem discovery', async source => {
  const link = vi.fn(async () => undefined);
  const resolver = new DependencyResolver({ ...options, link });
  const node = await resolver.add({ value: b('child'), access: 'read', base: { kind: 'resource', value: b(source) } });
  expect(node.kind).toBe('url');
  expect(classifyResource(node.location!).kind).toBe('native-protocol');
  expect(filesystemCandidates(resolver.graph())).toEqual([]);
  expect(link).not.toHaveBeenCalled();
});
it.each(['concat', 'hls'] as const)('classifies a local %s member named dash as a filesystem candidate', async grammar => {
  const resolver = new DependencyResolver(options);
  const parent = await resolver.add({ value: b('lists/index'), grammar, access: 'read' });
  const [child] = await resolver.content(parent.id, { content: b(grammar === 'concat' ? "file '-'\n" : '#EXTM3U\n#EXTINF:1,\n-\n') });
  expect(child.location).toEqual(b('/work/lists/-'));
  expect(filesystemCandidates(resolver.graph())).toContainEqual(child);
  const stdin = await resolver.add({ value: b('-'), access: 'read' });
  expect(filesystemCandidates(resolver.graph())).not.toContainEqual(stdin);
});
it('keeps a network playlist member named dash out of filesystem candidates', async () => {
  const resolver = new DependencyResolver(options);
  const parent = await resolver.add({ value: b('http://localhost/index?sig=synthetic'), grammar: 'hls', access: 'read' });
  const [child] = await resolver.content(parent.id, { content: b('#EXTM3U\n#EXTINF:1,\n-\n') });
  expect(child.location).toEqual(b('http://localhost/-'));
  expect(filesystemCandidates(resolver.graph())).toEqual([]);
});
it.each([
  ['', 'http://host/playlist?sig=%2f+%FF#native'],
  ['//cdn?sig=%2f+%FF', 'http://cdn?sig=%2f+%FF'],
  ['//cdn#native', 'http://cdn#native'],
])('preserves native empty-path reference spelling for %s', (child, expected) => {
  expect(resolveLocation(b(child), { kind: 'resource', value: b('http://host/playlist?sig=%2f+%FF#native') })).toEqual(b(expected));
});
describe('native network resources', () => {
  it.each([
    ['https://localhost/single-use?sig=%2f+%FF', 'local', 'native-protocol'],
    ['/work/clip', 'https://other.invalid/clip', 'filesystem'],
  ] as const)('classifies indexed original bytes for %s without invoking a custom iterator', (original, substituted, kind) => {
    const value = b(original);
    const iterator = vi.fn(() => b(substituted)[Symbol.iterator]());
    value[Symbol.iterator] = iterator;
    expect(classifyResource(value)).toMatchObject({ original: b(original), kind });
    expect(iterator).not.toHaveBeenCalled();
  });
  it('keeps network bytes out of filesystem candidates when advisory objects disguise their iterators', async () => {
    const resolver = new DependencyResolver(options);
    await resolver.add({ value: b('https://localhost/single-use?sig=%2f+%FF'), access: 'read' });
    const graph = resolver.graph();
    const node = graph.nodes[0];
    node.original[Symbol.iterator] = () => b('local')[Symbol.iterator]();
    node.location![Symbol.iterator] = () => b('/work/snapshot')[Symbol.iterator]();
    expect(filesystemCandidates({ ...graph, nodes: [{ ...node, kind: 'path' }] })).toEqual([]);
  });
  it('requires original operand bytes rather than coercing a network URL to a path', () => {
    for (const value of ['https://localhost/single-use?sig=synthetic', [104, 116, 116, 112]]) {
      expect(() => classifyResource(value as unknown as Uint8Array)).toThrow('Resource classification requires original bytes');
    }
  });
  it('does not let a local path hint conceal an original network URL', async () => {
    const link = vi.fn(async () => undefined);
    const resolver = new DependencyResolver({ ...options, link });
    const original = b('http://localhost/single-use?sig=synthetic');
    const node = await resolver.add({ value: original, path: b('/work/snapshot'), kind: 'path', access: 'read' });
    expect(node.kind).toBe('url');
    expect(node.location).toEqual(original);
    expect(link).not.toHaveBeenCalled();
    expect(filesystemCandidates(resolver.graph())).toEqual([]);
  });
  it.each(['https://host/a?sig=%2f+%FF', '/work/clip'])('owns resolved absolute operand bytes for %s', value => {
    const original = Buffer.from(value);
    const resolved = resolveLocation(original, { kind: 'directory', value: b('/work') });
    original.fill(0);
    expect(resolved).toEqual(b(value));
  });
  it('uses the same scheme grammar in discovery and resolution', () => {
    expect(resource(0, b('1:local'), 'input', 'read', 'input').kind).toBe('url');
    expect(resource(0, b('FILE:local'), 'input', 'read', 'input').kind).toBe('url');
    expect(resource(0, b('PIPE:0'), 'input', 'read', 'input').kind).toBe('url');
  });
  it.each(['http://localhost/a?sig=%2f+%FF', 'udp://127.0.0.1:9000?listen=1', 'crypto+https://host/a', 'cache:http://host/a', 'unknown:opaque', '1:opaque', 'FILE:opaque', 'PIPE:0', 'subfile,,start,0,end,100,,:http://host/a'])('excludes %s from filesystem candidates', async value => {
    const resolver = new DependencyResolver(options);
    await resolver.add({ value: b(value), access: 'read' });
    expect(filesystemCandidates(resolver.graph())).toEqual([]);
    expect(classifyResource(b(value)).original).toEqual(b(value));
  });
  it('does not trust a path hint to admit a URL into a filesystem manifest', async () => {
    const resolver = new DependencyResolver(options);
    await resolver.add({ value: b('https://host/a'), kind: 'path', access: 'read' });
    await resolver.add({ value: b('local'), access: 'read' });
    expect(filesystemCandidates(resolver.graph()).map(n => n.original)).toEqual([b('local')]);
  });
  it.each(['path', 'file-protocol', 'image-selector', 'glob', 'output-pattern', 'filename-expression'] as const)('does not traverse a network operand with a misleading %s hint', async kind => {
    const link = vi.fn(async () => undefined);
    const resolver = new DependencyResolver({ ...options, link });
    const value = b('http://localhost/a?sig=%2f+%FF');
    const node = await resolver.add({ value, kind, access: 'read' });
    expect(node.kind).toBe('url');
    expect(node.location).toEqual(value);
    expect(link).not.toHaveBeenCalled();
  });
  it('resolves a path hint in an observed network context without filesystem traversal', async () => {
    const link = vi.fn(async () => undefined);
    const resolver = new DependencyResolver({ ...options, link });
    const node = await resolver.add({ value: b('segment.ts?sig=%2f+X'), kind: 'path', access: 'read', base: { kind: 'resource', value: b('http://localhost/nested/index.m3u8?parent=synthetic') } });
    expect(node.location).toEqual(b('http://localhost/nested/segment.ts?sig=%2f+X'));
    expect(node.kind).toBe('url');
    expect(filesystemCandidates(resolver.graph())).toEqual([]);
    expect(link).not.toHaveBeenCalled();
  });
  it.each(['file-protocol', 'image-selector', 'glob', 'output-pattern', 'filename-expression'] as const)('classifies a relative %s hint under a redirected network resource as native access', async kind => {
    const link = vi.fn(async () => undefined);
    const resolver = new DependencyResolver({ ...options, link });
    const node = await resolver.add({ value: b('segment.ts?sig=%2f+%FF'), kind, access: 'read',
      base: { kind: 'resource', value: b('http://localhost/nested/index.m3u8?parent=synthetic') } });
    expect(node.kind).toBe('url');
    expect(node.original).toEqual(b('segment.ts?sig=%2f+%FF'));
    expect(node.location).toEqual(b('http://localhost/nested/segment.ts?sig=%2f+%FF'));
    expect(filesystemCandidates(resolver.graph())).toEqual([]);
    expect(link).not.toHaveBeenCalled();
  });
  it('keeps native request options and stage without reading any endpoint', async () => {
    const argv = ['-headers', 'X-Oracle: synthetic\r\n', '-cookies', 's=synthetic; domain=a.invalid; path=/', '-i', 'http://localhost/live?sig=%ff+X', '-f', 'null', '-'].map(b);
    const d = discover('ffmpeg', argv);
    expect(d.argv).toEqual(argv);
    expect(d.dependencies.find(n => n.kind === 'url')?.stage).toBe('input');
    const link = vi.fn();
    const resolver = new DependencyResolver({ ...options, link });
    await resolver.add({ value: argv[5], access: 'read' });
    expect(link).not.toHaveBeenCalled();
  });
  it('resolves observed redirects, signed children, keys and init without carrying parent queries', async () => {
    const resolver = new DependencyResolver(options);
    const parent = await resolver.add({ value: b('http://host/entry?original=synthetic'), grammar: 'hls', access: 'read' });
    const children = await resolver.content(parent.id, { location: b('http://host/nested/index.m3u8?token=synthetic'), content: b('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key?sig=%2f+X"\n#EXT-X-MAP:URI="init"\n#EXTINF:1,\nsegment.ts\n') });
    expect(children.map(n => new TextDecoder().decode(n.location))).toEqual(['http://host/nested/key?sig=%2f+X', 'http://host/nested/init', 'http://host/nested/segment.ts']);
    expect(filesystemCandidates(resolver.graph())).toEqual([]);
    const next = await resolver.content(parent.id, { location: b('http://host/nested/index.m3u8'), content: b('#EXTM3U\n#EXTINF:1,\nnext.ts\n') });
    expect(next[0].location).toEqual(b('http://host/nested/next.ts'));
    expect(next[0].timing.stage).toBe('runtime');
  });
});
it('keeps literal preset and filter readers eligible for transfer while excluding AVIO option descriptors', async () => {
  const graph = await resolveDependencies(discover('ffmpeg', ['-/vf', 'pipe:0', '-fpre', 'https:local', '-i', 'in.wav', '-vf', "lut3d=file='fd\\:3'", 'out.wav'].map(b)), {
    cwd: b('/work'), budgets: { nodes: 30, bytes: 10000, depth: 10, symlinks: 10 }
  });
  expect(filesystemCandidates(graph).map(node => new TextDecoder().decode(node.original))).toEqual(['https:local', 'in.wav', 'out.wav', 'fd:3']);
});

it.each([
  ['crypto:dir/list.m3u8?parent=synthetic', '../key?sig=%2f+%FF', 'crypto:dir/../key?sig=%2f+%FF'],
  ['cache:http://host/dir/list.m3u8?parent=synthetic', '../segment.ts', 'cache:http://host/dir/../segment.ts'],
])('preserves native pseudo-URL path semantics for %s', (source, child, expected) => {
  expect(resolveLocation(b(child), { kind: 'resource', value: b(source) })).toEqual(b(expected));
});


it('returns the same owned filesystem bytes that were classified', async () => {
  const resolver = new DependencyResolver(options);
  const node = await resolver.add({ value: b('local'), access: 'read' });
  let reads = 0;
  const changing = { ...node, get location() {
    return ++reads <= 2 ? b('/work/local') : b('https://caller.invalid/single-use?sig=synthetic');
  } };
  const [candidate] = filesystemCandidates({ ...resolver.graph(), nodes: [changing] });
  expect(candidate.location).toEqual(b('/work/local'));
  expect(reads).toBe(1);
  node.original.fill(120);
  expect(candidate.original).toEqual(b('local'));
});
