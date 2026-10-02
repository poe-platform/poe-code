import { describe, expect, it } from 'vitest';
import { discover, discoverImageMagick } from './index.js';
import { DependencyResolver, resolveDependencies } from './resolver.js';
import { resolveLocation } from './resolution-path.js';
import { Volume } from 'memfs';
import type { DependencyGrammar } from './resolution-types.js';
const b = (s: string) => new TextEncoder().encode(s);
const t = (s: Uint8Array | undefined) => s && new TextDecoder().decode(s);
const options = { cwd: b('/work'), budgets: { nodes: 100, bytes: 100000, depth: 10, symlinks: 10 } };
it.each(['mvg', 'magick-script'] as const)('discovers file fonts in observed %s against invocation cwd', async grammar => {
  const volume = Volume.fromJSON({'/work/plain':'font bytes', '/work/face[0]':'font bytes'});
  const probes: string[] = [];
  const resolver = new DependencyResolver({...options, accessible:async path => {
    probes.push(t(path)!);
    try { return volume.statSync(t(path)!).isFile(); } catch { return false; }
  }});
  const drawing = "push graphic-context font 'plain' text 0,0 'x' font 'face[0]' text 0,0 'y' pop graphic-context";
  const root = await resolver.add({value:b('drawings/resource'),access:'read',grammar});
  const nodes = await resolver.content(root.id, {content:b(grammar === 'mvg' ? drawing : `xc:red -write first.ppm -draw "${drawing}" -write second.ppm`)});
  for (const name of ['plain', 'face[0]']) {
    expect(nodes.find(node => t(node.original) === name)).toMatchObject({kind:'path',location:b('/work/' + name),upload:false,timing:{certainty:'predicted'}});
  }
  expect(probes).toContain('/work/plain');
  expect(probes.every(path => path.startsWith('/work/'))).toBe(true);
});
it.each([
  ['magick-script', 'xc:green -write out.ppm'],
  ['magick-list', 'xc:green'],
  ['msl', '<image><read filename="xc:green"/></image>'],
  ['mvg', "image Over 0,0 1,1 'xc:green'"],
  ['magick-script', "xc:red -draw \"image Over 0,0 1,1 'xc:green'\" -write out.ppm"],
] as [DependencyGrammar, string][])('retains stat-visible colon directories in observed %s content', async (grammar, content) => {
  const volume = Volume.fromJSON({'/work/xc:green/child':'x'});
  const resolver = new DependencyResolver({...options,
    accessible: async path => { try { return volume.statSync(t(path)!).isFile(); } catch { return false; } },
    exists: async path => { try { volume.statSync(t(path)!); return true; } catch { return false; } },
  });
  const root = await resolver.add({value:b('resource'),access:'read',grammar});
  const nodes = await resolver.content(root.id, {content:b(content)});
  expect(nodes.find(node => t(node.original) === 'xc:green')).toMatchObject({kind:'path',location:b('/work/xc:green')});
  expect(nodes.find(node => t(node.original) === 'xc:green')).toMatchObject({upload:false,timing:{certainty:'predicted'}});
});
it('keeps failed observed-content filesystem probes advisory and preserves subsequent writes', async () => {
  const resolver = new DependencyResolver({...options,
    accessible: async () => { throw Error('lookup unavailable'); },
    exists: async () => { throw Error('stat unavailable'); },
  });
  const root = await resolver.add({value:b('script'),access:'read',grammar:'magick-script'});
  const nodes = await resolver.content(root.id, {content:b('xc:green -write first.ppm -write second.ppm')});
  expect(nodes.filter(node => node.access === 'write').map(node => t(node.location))).toEqual(['/work/first.ppm','/work/second.ppm']);
  expect(nodes.every(node => node.timing.certainty === 'predicted' && !node.upload)).toBe(true);
  expect(resolver.graph().issues.some(issue => issue.detail.includes('filesystem-sensitive'))).toBe(true);
});
it('does not select inherited JavaScript properties as demuxer grammars', async () => {
  for (const format of ['constructor', 'toString', '__proto__']) {
    const graph = await resolveDependencies(discover('ffmpeg', ['-f', format, '-i', 'input', 'output'].map(b)), options);
    expect(graph.nodes.map(node => node.grammar)).toEqual([undefined, undefined]);
  }
});
it('discovers ordered MSL resources from conjure argv using the XML reader', async () => {
  const discovery = await discoverImageMagick('magick', ['conjure', 'MSL:scripts/task'].map(b));
  const graph = await resolveDependencies(discovery, options);
  const resolver = new DependencyResolver(options);
  const root = await resolver.add(graph.nodes[0]);
  const nodes = await resolver.content(root.id, { content: b('<image><read filename="red.ppm"/><write filename="first.ppm"/><write filename="second.ppm"/><read filename="missing.ppm"/></image>') });
  expect(nodes.map(n => [t(n.location), n.access])).toEqual([
    ['/work/red.ppm', 'read'], ['/work/first.ppm', 'write'],
    ['/work/second.ppm', 'write'], ['/work/missing.ppm', 'read']
  ]);
});
it('retains side-resource filename semantics and defers generated passlog accesses', async () => {
  const graph = await resolveDependencies(discover('ffmpeg', ['-i', 'in.wav', '-stats_enc_pre:a', '-', '-vstats_file', 'pipe:3', '-passlogfile', 'pipe:4', 'out.wav'].map(b)), options);
  expect(graph.nodes.filter(n => ['-', 'pipe:3', 'pipe:4'].includes(t(n.original)!)).map(n => [t(n.original), n.kind, t(n.location)])).toEqual([
    ['pipe:3', 'path', '/work/pipe:3'], ['-', 'path', '/work/-'], ['pipe:4', 'resource-lookup', undefined]
  ]);
});
it('keeps observed preset side-resource syntax consistent with argv discovery', async () => {
  const resolver = new DependencyResolver(options);
  const preset = await resolver.add({ value: b('preset'), access: 'read', grammar: 'preset' });
  const nodes = await resolver.content(preset.id, { content: b('stats_enc_pre:a=-\nvstats_file=pipe:3\npasslogfile=pipe:4\n') });
  expect(nodes.map(n => [t(n.original), n.kind, t(n.location)])).toEqual([
    ['-', 'path', '/work/-'], ['pipe:3', 'path', '/work/pipe:3'], ['pipe:4', 'resource-lookup', undefined]
  ]);
});
const ref = (value: string, grammar?: string) => ({ value: b(value), access: 'read' as const, grammar });
it('retains subtitle macro dependency reads in argv, scripts and presets without treating literal names as endpoints', async () => {
  const filter = "ass=f='pipe\\:0':fontsdir='pipe\\:3'";
  const direct = await resolveDependencies(discover('ffmpeg', ['-vf', filter, 'out'].map(b)), options);
  const resolver = new DependencyResolver(options);
  const script = await resolver.add(ref('script', 'filter'));
  const observed = await resolver.content(script.id, { content: b(filter) });
  const preset = await resolver.add(ref('preset', 'preset'));
  const nested = await resolver.content(preset.id, { content: b('vf=' + filter) });
  for (const nodes of [direct.nodes.filter(n => n.access === 'read'), observed, nested]) {
    expect(nodes.map(n => [t(n.original), t(n.location), n.access, n.literal])).toEqual([
      ['pipe:0', '/work/pipe:0', 'read', true], ['pipe:3', '/work/pipe:3', 'read', true]
    ]);
  }
});
it('transfers preset stream keys and argument files as distinct native reads', async () => {
  const resolver = new DependencyResolver(options);
  const preset = await resolver.add(ref('preset', 'preset'));
  const nested = await resolver.content(preset.id, { content: b('af:a:0=ametadata=mode=print:file=stats.txt\n/af:a:0=graph.txt\n/passlogfile:v=log-option.txt\n') });
  expect(nested.map(n => [t(n.original), n.access, n.grammar])).toEqual([
    ['stats.txt', 'write', undefined], ['graph.txt', 'read', 'filter'], ['log-option.txt', 'read', 'option-file']
  ]);
});
it('retains filter write accesses in direct, observed and preset dependency graphs', async () => {
  const filter = 'ametadata=mode=print:file=stats.txt';
  const direct = await resolveDependencies(discover('ffmpeg', ['-af', filter, 'out'].map(b)), options);
  const resolver = new DependencyResolver(options);
  const script = await resolver.add(ref('script', 'filter'));
  const observed = await resolver.content(script.id, { content: b(filter) });
  const preset = await resolver.add(ref('preset', 'preset'));
  const nested = await resolver.content(preset.id, { content: b('af=' + filter) });
  for (const nodes of [direct.nodes, observed, nested]) {
    expect(nodes.find(n => t(n.original) === 'stats.txt')?.access).toBe('write');
  }
});

it('keeps explicit drawtext font names as lookups in argv and observed filters', async () => {
  const filter = 'drawtext=font=Example Sans:text=hello';
  const direct = await resolveDependencies(discover('ffmpeg', ['-i','clip','-vf',filter,'out'].map(b)), options);
  const r = new DependencyResolver(options);
  const script = await r.add(ref('filters/root', 'filter'));
  const observed = await r.content(script.id, { content: b(filter) });
  for (const nodes of [direct.nodes, observed]) {
    const font = nodes.find(n => t(n.original) === 'Example Sans');
    expect(font?.kind).toBe('resource-lookup');
    expect(font?.location).toBeUndefined();
  }
});

it('keeps HLS variable URIs live without traversing fictitious filenames', async () => {
  const visited: string[] = [];
  const r = new DependencyResolver({ ...options, link: async path => { visited.push(t(path)!); return undefined; } });
  const root = await r.add(ref('lists/root', 'hls'));
  visited.length = 0;
  const nodes = await r.content(root.id, { content: b('#EXTM3U\n#EXT-X-DEFINE:NAME="dir",VALUE="media"\n{$dir}/segment.ts\n') });
  expect(nodes[0].kind).toBe('filename-expression');
  expect(t(nodes[0].original)).toBe('{$dir}/segment.ts');
  expect(visited).toEqual([]);
  expect(nodes[0].live).toBe(true);
});

it('does not infer HLS session data and steering reads from standards vocabulary', async () => {
  const r = new DependencyResolver(options);
  const root = await r.add(ref('https://h/origin', 'hls'));
  const nodes = await r.content(root.id, { location: b('https://cdn/media/master?signature=old'), content: b('#EXTM3U\n#EXT-X-SESSION-DATA:DATA-ID="example",URI="data.json?sig=%2f+X"\n#EXT-X-CONTENT-STEERING:SERVER-URI="../steering?sig=a+b",PATHWAY-ID="a"\n') });
  expect(nodes).toEqual([]);
  expect(r.graph().status).toBe('live');
});

it('uses the last duplicate HLS attribute selected by the native reader', async () => {
  const r = new DependencyResolver(options);
  const root = await r.add(ref('https://h/list', 'hls'));
  const nodes = await r.content(root.id, { content: b('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="first",URI="second"\na.ts\n') });
  expect(nodes.map(node => node.location)).toEqual([b('https://h/second'), b('https://h/a.ts')]);
  expect(r.graph().status).toBe('live');
  expect(r.graph().issues.some(i => i.reason === 'syntax')).toBe(false);
});

it('honors explicit literal paths even when their spelling is a protocol or descriptor', async () => {
  const visited: string[] = [];
  const r = new DependencyResolver({ ...options, link: async path => { visited.push(t(path)!); return undefined; } });
  for (const name of ['name:with%literal', 'https://local/name', 'pipe:0', '-']) {
    const node = await r.add({ ...ref(name), kind: 'path', literal: true });
    expect(node.kind).toBe('path');
    expect(t(node.location)).toBe('/work/' + name.split('/').filter(Boolean).join('/'));
    expect(t(node.original)).toBe(name);
  }
  expect(visited).toContain('/work/pipe:0');
});

it('rejects omitted budgets rather than silently disabling a discovery bound', () => {
  for (const key of ['nodes', 'bytes', 'depth', 'symlinks'] as const) {
    const budgets = { ...options.budgets };
    delete (budgets as Partial<typeof budgets>)[key];
    expect(() => new DependencyResolver({ ...options, budgets })).toThrow('Discovery budgets');
  }
});

it('keeps AVIO descriptor semantics for slash-loaded filter options', async () => {
  const g = await resolveDependencies(discover('ffmpeg', ['-i','clip','-/vf','pipe:0','-/filter_complex','fd:3','out'].map(b)), options);
  for (const name of ['pipe:0', 'fd:3']) {
    const node = g.nodes.find(n => t(n.original) === name)!;
    expect(node.kind).toBe('descriptor');
    expect(node.location).toBeUndefined();
    expect(node.grammar).toBe('filter');
  }
});

it('retains literal preset-file readers during nested assignment expansion', async () => {
  const r = new DependencyResolver(options);
  const root = await r.add(ref('presets/root', 'preset'));
  const [child] = await r.content(root.id, { content: b('fpre=nested:part\n') });
  expect(child.kind).toBe('path');
  expect(t(child.location)).toBe('/work/nested:part');
  expect(child.grammar).toBe('preset');
});

it('retains the synthetic ffprobe lavfi source alongside its ordered filter accesses', async () => {
  const source = 'movie=clip.mp4';
  const g = await resolveDependencies(discover('ffprobe', ['-f','lavfi','-i',source].map(b)), options);
  expect(g.nodes.map(n => [t(n.original), n.kind, n.timing.stage])).toEqual([
    [source, 'synthetic', 'input'], ['clip.mp4', 'path', 'runtime'],
  ]);
});

it('applies ffprobe global reader selection to manifest and image-sequence inputs', async () => {
  for (const [format, filename, grammar, kind] of [
    ['concat', 'lists/root', 'concat', 'path'],
    ['hls', 'https://h/master?sig=a+%2F', 'hls', 'url'],
    ['dash', 'https://h/root', 'dash', 'url'],
    ['image2', 'frames-%03d.png', undefined, 'filename-expression'],
  ] as const) {
    const g = await resolveDependencies(discover('ffprobe', ['-f', format, '-i', filename].map(b)), options);
    expect(g.nodes[0].grammar).toBe(grammar);
    expect(g.nodes[0].kind).toBe(kind);
  }
});

it('uses each filter option reader to distinguish local files from AVIO URLs', async () => {
  const filter = "drawtext=textfile='words\\:part':fontfile='font\\:part',lut3d='lut\\:part',movie=filename='https\\://h/clip?sig=a+%2F',subtitles=filename='https\\://h/sub?sig=a+%2F':fontsdir='fonts\\:part'";
  const expected = [
    ['words:part', 'path', '/work/words:part'],
    ['font:part', 'path', '/work/font:part'],
    ['lut:part', 'path', '/work/lut:part'],
    ['https://h/clip?sig=a+%2F', 'url', 'https://h/clip?sig=a+%2F'],
    ['https://h/sub?sig=a+%2F', 'url', 'https://h/sub?sig=a+%2F'],
    ['fonts:part', 'path', '/work/fonts:part'],
  ];
  const direct = await resolveDependencies(discover('ffmpeg', ['-i','clip','-vf',filter,'out'].map(b)), options);
  expect(direct.nodes.filter(n => n.timing.stage === 'runtime').map(n => [t(n.original), n.kind, t(n.location)])).toEqual(expected);
  const r = new DependencyResolver(options);
  const root = await r.add(ref('filters/root', 'filter'));
  expect((await r.content(root.id, { content: b(filter) })).map(n => [t(n.original), n.kind, t(n.location)])).toEqual(expected);
});

it('resolves URL directory bases without joining the last component to the filename', () => {
  const base = { kind: 'directory' as const, value: b('https://h/assets?sig=old#part') };
  expect(t(resolveLocation(b('a%2Fb?sig=a+%2F#new'), base))).toBe('https://h/assets/a%2Fb?sig=a+%2F#new');
  expect(t(resolveLocation(b('../clip'), base))).toBe('https://h/clip');
});

it('keeps signed HTTP operands out of the image2 filename grammar', async () => {
  const signed = 'https://h/frame.png?sig=%2Fd+X#part';
  const g = await resolveDependencies(discover('ffmpeg', ['-f','image2','-i',signed,'out'].map(b)), options);
  const input = g.nodes.find(n => t(n.original) === signed)!;
  expect(input.kind).toBe('url');
  expect(input.expression).toBeUndefined();
  expect(t(input.location)).toBe(signed);
  expect(g.issues.some(i => i.reason === 'syntax')).toBe(false);
});

it('uses the same resource grammar for observed ImageMagick scripts and argv', async () => {
  const r = new DependencyResolver(options);
  const root = await r.add(ref('scripts/one', 'magick-script'));
  const nodes = await r.content(root.id, { content: b("a.tif[2] -font Helvetica -draw \"image Over 0,0 1,1 'overlay.png'\" -set comment @words -write early.png -write out-%[label].png") });
  expect(nodes.find(n => t(n.original) === 'a.tif[2]')?.kind).toBe('image-selector');
  expect(nodes.find(n => t(n.original) === 'Helvetica')?.kind).toBe('resource-lookup');
  expect(t(nodes.find(n => t(n.original) === 'overlay.png')?.location)).toBe('/work/overlay.png');
  expect(nodes.find(n => t(n.original) === '@words')?.grammar).toBe('text');
  const expression = nodes.find(n => t(n.original) === 'out-%[label].png');
  expect(expression?.filenameDialect).toBe('imagemagick');
  expect(expression?.expression?.complete).toBe(true);
  expect(nodes.findIndex(n => t(n.original) === 'overlay.png')).toBeLessThan(nodes.findIndex(n => t(n.original) === 'early.png'));
});

it('retains DASH inherited segment addressing and namespace-qualified external references', async () => {
  const r = new DependencyResolver(options);
  const root = await r.add(ref('https://h/root/list.mpd', 'dash'));
  const nodes = await r.content(root.id, { content: b('<MPD xmlns:link="http://www.w3.org/1999/xlink"><Period><SegmentTemplate media="$Number$.m4s"/><Representation><BaseURL>video/</BaseURL></Representation></Period><Period><Representation><BaseURL>single.mp4</BaseURL><SegmentBase><Initialization sourceURL="init"/><RepresentationIndex sourceURL="index"/></SegmentBase></Representation></Period><Period link:href="next.mpd"/><Period><Representation><SegmentList><SegmentURL media="a" index="a.idx"/></SegmentList></Representation></Period></MPD>') });
  expect(nodes.map(n => t(n.location))).not.toContain('https://h/root/video/');
  expect(nodes.map(n => t(n.location))).toContain('https://h/root/video/$Number$.m4s');
  expect(nodes.map(n => t(n.location))).toContain('https://h/root/single.mp4');
  expect(nodes.map(n => t(n.location))).toContain('https://h/root/index');
  expect(nodes.find(n => t(n.original) === 'next.mpd')?.grammar).toBe('dash');
  expect(nodes.map(n => t(n.location))).toContain('https://h/root/a.idx');
});

it('detects symlink expansion cycles without confusing a later traversal with recursion', async () => {
  const link = async (path: Uint8Array) => ({ '/work/a': b('b'), '/work/b': b('a'), '/work/good': b('dir') })[t(path)!];
  const r = new DependencyResolver({ ...options, link });
  const cycle = await r.add(ref('a/file'));
  expect(r.graph().issues.some(i => i.node === cycle.id && i.reason === 'cycle')).toBe(true);
  const repeated = await r.add(ref('good/../good/file'));
  expect(t(repeated.location)).toBe('/work/dir/file');
  expect(r.graph().issues.some(i => i.node === repeated.id)).toBe(false);
});

it('inherits DASH initialization when a representation overrides only segment members', async () => {
  const r = new DependencyResolver(options);
  const root = await r.add(ref('https://h/list.mpd', 'dash'));
  const nodes = await r.content(root.id, { content: b('<MPD><Period><SegmentList><Initialization sourceURL="init.mp4"/><SegmentURL media="parent.m4s"/></SegmentList><Representation><BaseURL>video/</BaseURL><SegmentList><SegmentURL media="child.m4s" index="child.idx"/></SegmentList></Representation></Period></MPD>') });
  expect(nodes.map(n => t(n.location))).toEqual(['https://h/video/init.mp4','https://h/video/child.m4s','https://h/video/child.idx']);
});

it('does not invent a script reader for a script-local special option matching the entry name', async () => {
  const r = new DependencyResolver(options);
  const root = await r.add(ref('scripts/root', 'magick-script'));
  const nodes = await r.content(root.id, { content: b('-script __observed_script__') });
  expect(nodes).toEqual([]);
});

it('does not infer a reader grammar from an option-file basename', async () => {
  const g = await resolveDependencies(discover('ffmpeg', ['-/f','concat','-i','clip.wav','out.wav'].map(b)), options);
  const input = g.nodes.find(n => t(n.original) === 'clip.wav')!;
  expect(input.grammar).toBeUndefined();
});

describe('ordered dependency graph', () => {
  it('keeps global access before inputs, outputs after inputs, aliases and original bytes', async () => {
    const g = await resolveDependencies(discover('ffmpeg', ['-i','a','-progress','log','a'].map(b)), options);
    expect(g.nodes.map(n => [t(n.original), n.access])).toEqual([['log','write'],['a','read'],['a','write']]);
    expect(g.nodes[1].location).toEqual(g.nodes[2].location);
    expect(g.nodes[1].id).not.toBe(g.nodes[2].id);
    expect(g.nodes.every(n => n.live)).toBe(true);
    expect(g.edges.some(e => e.kind === 'before')).toBe(true);
  });
  it('preserves symlink-sensitive dotdot, collisions, case and byte spelling', async () => {
    const r = new DependencyResolver({ ...options, link: async path => t(path) === '/work/link' ? b('/else/deep') : undefined });
    const a = await r.add(ref('link/../A\n雪'));
    const c = await r.add(ref('A\n雪'));
    const d = await r.add(ref('a\n雪'));
    expect(t(a.location)).toBe('/else/A\n雪');
    expect(t(a.original)).toBe('link/../A\n雪');
    expect(a.trace.map(s => t(s.path))).toContain('/work/link');
    expect(c.location).not.toEqual(d.location);
  });
  it('never treats HTTP, file protocols, descriptors, fonts or expressions as upload paths', async () => {
    const r = new DependencyResolver(options);
    const values = [ref('https://h/a%2Fb?sig=a+%2F#part'), ref('file:clip'), ref('pipe:0'), { ...ref('Arial'), kind: 'resource-lookup' as const }, { ...ref('frame-%03d.png'), kind: 'output-pattern' as const }];
    const nodes = [];
    for (const value of values) nodes.push(await r.add(value));
    expect(nodes.map(n => n.kind)).toEqual(['url','file-protocol','descriptor','resource-lookup','output-pattern']);
    expect(t(nodes[0].location)).toBe('https://h/a%2Fb?sig=a+%2F#part');
    expect(nodes[0].upload).toBe(false);
    expect(nodes[2].location).toBeUndefined();
  });
  it('expands nested HLS observations with effective URL bases, keys and maps without caching', async () => {
    const r = new DependencyResolver(options);
    const root = await r.add(ref('https://origin/master', 'hls'));
    const children = await r.content(root.id, { location: b('https://cdn/dir/master?sig=x'), content: b('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nsub/list.m3u8?sig=a+%2F\n') });
    expect(t(children[0].location)).toBe('https://cdn/dir/sub/list.m3u8?sig=a+%2F');
    const first = await r.content(children[0].id, { content: b('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="../key?k=1,2"\n#EXT-X-MAP:URI="init.mp4"\nsegment.ts\n') });
    expect(first.map(n => t(n.location))).toEqual(['https://cdn/dir/key?k=1,2','https://cdn/dir/sub/init.mp4','https://cdn/dir/sub/segment.ts']);
    const next = await r.content(children[0].id, { content: b('#EXTM3U\nnext.ts\n') });
    expect(t(next[0].original)).toBe('next.ts');
    expect(next[0].live).toBe(true);
  });
  it('parses concat token grammar and preserves manifest-relative vs script-cwd bases', async () => {
    const r = new DependencyResolver(options);
    const list = await r.add(ref('lists/list', 'concat'));
    const children = await r.content(list.id, { content: b("ffconcat version 1.0\nfile 'a b.wav' ignored\nfile ../same.wav\n") });
    expect(children.map(n => t(n.original))).toEqual(['a b.wav','../same.wav']);
    expect(t(children[0].location)).toBe('/work/lists/a b.wav');
    const script = await r.add(ref('scripts/filter', 'filter'));
    const filters = await r.content(script.id, { content: b("movie=clip.mp4,drawtext=textfile=text.txt:fontfile=font.ttf:reload=1,lut3d=lut.cube,subtitles=sub.srt") });
    expect(filters.map(n => t(n.location))).toEqual(['/work/clip.mp4','/work/text.txt','/work/font.ttf','/work/lut.cube','/work/sub.srt']);
  });
  it('parses DASH XML namespaces, entity references, inherited BaseURL and templates', async () => {
    const r = new DependencyResolver(options);
    const root = await r.add(ref('https://h/root/a.mpd', 'dash'));
    const nodes = await r.content(root.id, { content: b('<MPD xmlns="urn:mpeg:dash:schema:mpd:2011"><BaseURL>../media/</BaseURL><Period><AdaptationSet><Representation><BaseURL>v/</BaseURL><SegmentList><Initialization sourceURL="init?x=1&amp;y=2"/><SegmentURL media="a.m4s"/></SegmentList><SegmentTemplate media="$Number%05d$.m4s" initialization="init-$RepresentationID$.mp4"/></Representation></AdaptationSet></Period></MPD>') });
    expect(nodes.map(n => t(n.location))).toContain('https://h/media/v/init?x=1&y=2');
    const templates = nodes.filter(n => n.expression?.tokens.some(token => token.kind === 'template'));
    expect(templates).toHaveLength(2);
    expect(templates.every(n => n.kind === 'url')).toBe(true);
  });
  it('distinguishes recursion cycles from shared children and reports exhausted budgets', async () => {
    const r = new DependencyResolver(options);
    const a = await r.add(ref('a', 'hls'));
    const [child] = await r.content(a.id, { content: b('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\na\n') });
    await r.content(child.id, { content: b('#EXTM3U\nother\n') });
    expect(r.graph().issues.some(i => i.reason === 'cycle')).toBe(true);
    const limited = new DependencyResolver({ ...options, budgets: { ...options.budgets, nodes: 1 } });
    const root = await limited.add(ref('a', 'hls'));
    await limited.content(root.id, { content: b('#EXTM3U\na\nb\n') });
    expect(limited.graph().status).toBe('incomplete');
    expect(limited.graph().issues.some(i => i.reason === 'budget')).toBe(true);
  });
  it('keeps optional missing resources advisory, and appends runtime discoveries in observed order', async () => {
    const r = new DependencyResolver({ ...options, link: async () => { throw new Error('ENOENT'); } });
    const n = await r.add({ ...ref('missing'), optional: true });
    expect(n.live).toBe(true);
    await r.observe({ ...ref('generated'), access: 'write', sequence: 8 });
    await r.observe({ ...ref('generated'), sequence: 9 });
    expect(r.graph().nodes.slice(-2).map(n => n.timing.sequence)).toEqual([8,9]);
  });
  it('adapts ImageMagick ordered writes, profiles, @content and image selectors', async () => {
    const d = await discoverImageMagick('magick', ['a.tif[2]','-profile','p.icc','-set','comment','@text','-write','early.png','out-%[label].png'].map(b));
    const g = await resolveDependencies(d, options);
    expect(g.nodes.map(n => n.kind)).toContain('image-selector');
    expect(g.nodes.map(n => t(n.location))).toContain('/work/p.icc');
    expect(g.nodes.find(n => t(n.original) === 'out-%[label].png')?.kind).toBe('filename-expression');
    expect(g.nodes.find(n => t(n.original) === 'early.png')?.access).toBe('write');
  });
});

it('retains shared nested dependencies per parent and does not globally deduplicate', async () => {
  const r = new DependencyResolver(options);
  const root = await r.add(ref('https://h/master', 'hls'));
  const children = await r.content(root.id, { content: b('#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,URI="shared"\n#EXT-X-STREAM-INF:BANDWIDTH=1\nshared\n') });
  for (const child of children) await r.content(child.id, { content: b('#EXTM3U\na.ts\n') });
  expect(r.graph().nodes.filter(n => t(n.original) === 'a.ts')).toHaveLength(2);
  expect(r.graph().issues.some(i => i.reason === 'cycle')).toBe(false);
});
it('uses file protocol bases without decoding percent octets', async () => {
  const r = new DependencyResolver(options);
  const root = await r.add(ref('file:/lists/root', 'concat'));
  const [child] = await r.content(root.id, { content: b('file a%20b.wav\n') });
  expect(child.kind).toBe('file-protocol');
  expect(t(child.location)).toBe('file:/lists/a%20b.wav');
});
it('keeps script operation predictions around a script-local special option', async () => {
  const r = new DependencyResolver(options);
  const root = await r.add(ref('scripts/one', 'magick-script'));
  const nodes = await r.content(root.id, { content: b('xc:red -write first.png -script nested -write later.png\n') });
  expect(nodes.map(n => t(n.original))).toEqual(['xc:red','first.png','later.png']);
  expect(nodes[1].access).toBe('write');
  expect(t(nodes[2].location)).toBe('/work/later.png');
});
it('parses MSL writes, config includes/fonts/delegates, SVG external resources, and @ filename lists', async () => {
  const r = new DependencyResolver(options);
  const msl = await r.add(ref('scripts/a.msl', 'msl'));
  expect((await r.content(msl.id, { content: b('<image><read filename="a.png"/><write filename="out.png"/></image>') })).map(n => [t(n.location),n.access])).toEqual([['/work/a.png','read'],['/work/out.png','write']]);
  const config = await r.add(ref('config/type.xml', 'magick-config'));
  const nodes = await r.content(config.id, { content: b('<typemap><include file="sub.xml"/><type glyphs="fonts/a.ttf"/><delegate command="gs -sOutputFile=%o %i"/></typemap>') });
  expect(nodes.map(n => n.kind)).toEqual(['path','path','path','delegate']);
  expect(t(nodes[0].location)).toBe('/work/config/sub.xml');
  expect(t(nodes[1].location)).toBe('/work/fonts/a.ttf');
  expect(t(nodes[2].location)).toBe('/work/config/fonts/a.ttf');
  expect(nodes[3].location).toBeUndefined();
  const svg = await r.add(ref('images/a.svg', 'svg'));
  expect((await r.content(svg.id, { content: b('<svg xmlns="http://www.w3.org/2000/svg"><image href="sub/a.png"/></svg>') })).map(n => t(n.location))).toEqual(['/work/images/sub/a.png']);
  const list = await r.add(ref('lists/names', 'magick-list'));
  expect((await r.content(list.id, { content: b('"a b.png" c\\d.png') })).map(n => t(n.location))).toEqual(['/work/a b.png','/work/c\\d.png']);
});
it('does not expand entity declarations or lose malformed-content status', async () => {
  const r = new DependencyResolver(options);
  const root = await r.add(ref('a.mpd', 'dash'));
  expect(await r.content(root.id, { content: b('<!DOCTYPE MPD [<!ENTITY e SYSTEM "file:///secret">]><MPD>&e;</MPD>') })).toEqual([]);
  expect(r.graph().status).toBe('incomplete');
});
it('resolves root-relative and query-only URL references byte-for-byte', async () => {
  const r = new DependencyResolver(options);
  const root = await r.add(ref('https://h/a/list?old=1#old', 'hls'));
  const nodes = await r.content(root.id, { content: b('#EXTM3U\n?sig=%2f+X#new\n/root/%2F?q=a+b\n//other/a?x=%2f\n') });
  expect(nodes.map(n => t(n.location))).toEqual(['https://h/a/list?sig=%2f+X#new','https://h/root/%2F?q=a+b','https://other/a?x=%2f']);
  expect(nodes.every(n => n.kind === 'url')).toBe(true);
});
it('carries protocol policy through concat protocol children and exposes preset lookup', async () => {
  const g = await resolveDependencies(discover('ffmpeg', ['-protocol_whitelist','file,concat','-i','concat:a.wav|https://h/a?sig=a+%2F','-vpre','custom','out.mp4'].map(b)), options);
  const nested = g.nodes.find(n => t(n.original) === 'https://h/a?sig=a+%2F');
  expect(nested?.policy?.allow).toEqual(['file','concat']);
  expect(g.issues.some(i => i.reason === 'policy')).toBe(true);
  expect(g.nodes.find(n => t(n.original) === 'custom')?.kind).toBe('resource-lookup');
});
it('resolves slash-loaded filter option contents through the frontend adapter', async () => {
  const { createDependencyResolver } = await import('./resolver.js');
  const r = await createDependencyResolver(discover('ffmpeg', ['-i','clip','-/vf','filters/one','out'].map(b)), options);
  const script = r.graph().nodes.find(n => t(n.original) === 'filters/one')!;
  expect(script.grammar).toBe('filter');
  expect((await r.content(script.id, { content: b('lut3d=colors.cube') })).map(n => t(n.location))).toEqual(['/work/colors.cube']);
});
it('does not reorder script-local indices against earlier argv operations', async () => {
  const d = await discoverImageMagick('magick', ['xc:red','-write','early.png','-script','s'].map(b), { read: async () => b('xc:blue -write later.png') });
  const g = await resolveDependencies(d, options);
  expect(g.nodes.map(n => t(n.original))).toEqual(['xc:red','early.png','s','xc:blue','later.png']);
});
it('keeps explicitly literal colon paths in the local namespace', async () => {
  const r = new DependencyResolver(options);
  const n = await r.add({ ...ref('./name:with%literal'), kind: 'path' });
  expect(t(n.location)).toBe('/work/./name:with%literal');
  expect(n.kind).toBe('path');
});
it('detects redirected ancestor cycles using effective content locations', async () => {
  const r = new DependencyResolver(options);
  const root = await r.add(ref('https://origin/list', 'hls'));
  const [child] = await r.content(root.id, { location: b('https://cdn/list'), content: b('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nlist\n') });
  await r.content(child.id, { content: b('#EXTM3U\nsegment.ts\n') });
  expect(r.graph().issues.some(i => i.reason === 'cycle')).toBe(true);
});
it('bounds XML nesting and BaseURL expansion before allocating dependency alternatives', async () => {
  const r = new DependencyResolver({ ...options, budgets: { ...options.budgets, nodes: 3, depth: 3 } });
  const root = await r.add(ref('https://h/a.mpd', 'dash'));
  await r.content(root.id, { content: b('<MPD><BaseURL>a/</BaseURL><BaseURL>b/</BaseURL><Period><BaseURL>c/</BaseURL><BaseURL>d/</BaseURL><Representation><SegmentURL media="one"/></Representation></Period></MPD>') });
  expect(r.graph().nodes).toHaveLength(1);
  expect(r.graph().status).toBe('incomplete');
  expect(r.graph().issues.some(i => i.reason === 'budget')).toBe(true);
});
it('charges symlink metadata against the explicit byte budget', async () => {
  let calls = 0;
  const r = new DependencyResolver({ ...options, budgets: { ...options.budgets, bytes: 20 }, link: async () => { calls++; return b('/' + 'a'.repeat(100)); } });
  await r.add(ref('link'));
  expect(calls).toBe(1);
  expect(r.graph().issues.some(i => i.reason === 'budget')).toBe(true);
});
it('parses MVG image operands without treating quoted drawing text as commands', async () => {
  const r = new DependencyResolver(options);
  const root = await r.add(ref('drawings/a.mvg', 'mvg'));
  const nodes = await r.content(root.id, { content: b("push graphic-context text 0,0 'image Over 0,0 2,2 fake.png' image Over 0,0 2,2 'real image.png' pop graphic-context") });
  expect(nodes.map(n => t(n.location))).toEqual(['/work/real image.png']);
});
it('discovers inline ImageMagick draw image reads at their operation position', async () => {
  const d = await discoverImageMagick('magick', ['xc:red','-draw',"image Over 0,0 1,1 'overlay.png'",'-write','early.png','out.png'].map(b));
  const g = await resolveDependencies(d, options);
  const overlay = g.nodes.find(n => t(n.original) === 'overlay.png');
  expect(t(overlay?.location)).toBe('/work/overlay.png');
  expect(overlay!.id).toBeLessThan(g.nodes.find(n => t(n.original) === 'early.png')!.id);
});
it('does not perform advisory local traversal when inherited protocol policy denies file', async () => {
  let calls = 0;
  const r = new DependencyResolver({ ...options, policy: { allow: ['https'] }, link: async () => { calls++; return undefined; } });
  await r.add(ref('local'));
  expect(calls).toBe(0);
  expect(r.graph().issues.some(i => i.reason === 'policy')).toBe(true);
});
it('retains each child capture ancestry when its parent is observed again at another URL', async () => {
  const r = new DependencyResolver(options);
  const root = await r.add(ref('https://h/start', 'hls'));
  const [oldChild] = await r.content(root.id, { location: b('https://h/old/list'), content: b('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nlist\n') });
  await r.content(root.id, { location: b('https://h/new/list'), content: b('#EXTM3U\nnew.ts\n') });
  await r.content(oldChild.id, { content: b('#EXTM3U\nold.ts\n') });
  expect(r.graph().issues.some(i => i.node === oldChild.id && i.reason === 'cycle')).toBe(true);
});
