import { expect, it, vi } from "vitest";
import { Volume } from "memfs";
import { discoverImageMagick, createImageMagickShims, imageMagickScriptTokens } from "./imagemagick.js";
import { imageMagickReference, imageMagickGrammarRevision } from "./imagemagick.generated.js";
import { imageMagickAccessReferences } from './imagemagick-references.js';
import { imageMagickReaderReferences, parseImageMagickOperand } from './imagemagick-operand.js';
const b = (s: string) => new TextEncoder().encode(s);
const s = (v: Uint8Array) => new TextDecoder().decode(v);
const fs = Volume.fromJSON({ "/literal[0]": "x", "/-resize": "x", "/-unknown/file": "x", "/text.txt": "hello", "/%[text:path]": "literal file", "/script": "# comment\nxc:red -write 'one file.ppm'\n( xc:blue -write two.ppm )\n", "/list": "'a b.png'\nc.png" });
const context = {
  accessible: async (p: Uint8Array) => {
    if (s(p) === '-') return true;
    try { return fs.statSync('/' + s(p)).isFile(); } catch { return false; }
  },
  read: async (p: Uint8Array) => new Uint8Array(fs.readFileSync('/' + s(p)) as Buffer)
};
const scan = (args: string[], tool = "magick") => discoverImageMagick(tool, args.map(b), context);
const resources = (d: Awaited<ReturnType<typeof scan>>) => d.resources.map(r => [s(r.path ?? r.operand), r.access, r.kind]);
it.each(['magick', 'identify', 'mogrify', 'convert'])('uses native directory classification for %s filename lists', async tool => {
  const volume = Volume.fromJSON({'/dirs.txt':'directory', '/mixed.txt':'directory red.ppm', '/red.ppm':'image'});
  volume.mkdirSync('/directory');
  const discoveryContext = {
    accessible: async (path: Uint8Array) => { try { return volume.statSync('/' + s(path)).isFile(); } catch { return false; } },
    isDirectory: async (path: Uint8Array) => { try { return volume.statSync('/' + s(path)).isDirectory(); } catch { return false; } },
    read: async (path: Uint8Array) => new Uint8Array(volume.readFileSync('/' + s(path)) as Buffer)
  };
  for (const [list, expected] of [['dirs.txt', '@dirs.txt'], ['mixed.txt', 'red.ppm']]) {
    const argv = ['@' + list, ...(['magick', 'convert'].includes(tool) ? ['out.ppm'] : [])].map(b);
    const d = await discoverImageMagick(tool, argv, discoveryContext);
    expect(d.resources.filter(r => r.role === 'image' && r.access !== 'write').map(r => s(r.path!))).toEqual([expected]);
    expect(d.argv).toEqual(argv);
  }
});
it('accounts for concatenate directory-list fallback and filtered deletions', async () => {
  const volume = Volume.fromJSON({'/dirs.txt':'directory', '/mixed.txt':'directory a.bin b.bin', '/a.bin':'a', '/b.bin':'b'});
  volume.mkdirSync('/directory');
  const discoveryContext = {
    accessible: async (path: Uint8Array) => { try { return volume.statSync('/' + s(path)).isFile(); } catch { return false; } },
    isDirectory: async (path: Uint8Array) => { try { return volume.statSync('/' + s(path)).isDirectory(); } catch { return false; } },
    read: async (path: Uint8Array) => new Uint8Array(volume.readFileSync('/' + s(path)) as Buffer)
  };
  for (const [list, inputs] of [['dirs.txt', ['@dirs.txt']], ['mixed.txt', ['a.bin', 'b.bin']]] as const) {
    const d = await discoverImageMagick('magick', ['-concatenate', '@' + list, 'out.bin'].map(b), discoveryContext);
    expect(d.resources.filter(r => r.access === 'read-delete').map(r => s(r.path!))).toEqual(inputs);
    expect(d.resources.find(r => r.access === 'write')?.path).toEqual(b('out.bin'));
  }
});
it('keeps filename-list option parameters and defers unknown directory probes', async () => {
  const volume = Volume.fromJSON({'/list':'-read directory a.bin'});
  volume.mkdirSync('/directory');
  for (const unavailable of [false, true]) {
    const d = await discoverImageMagick('magick', ['-concatenate', '@list', 'out.bin'].map(b), {
      accessible: async () => false,
      read: async path => new Uint8Array(volume.readFileSync('/' + s(path)) as Buffer),
      isDirectory: async path => {
        if (unavailable) throw Error('advisory probe failed');
        try { return volume.statSync('/' + s(path)).isDirectory(); } catch { return false; }
      }
    });
    expect(d.resources.filter(r => r.access === 'read-delete').map(r => s(r.path!))).toEqual(['-read', 'directory', 'a.bin']);
    expect(d.deferred.some(r => r.reason.includes('directory filtering'))).toBe(unavailable);
  }
});
it.each(['magick', 'identify', 'convert', 'mogrify'])('retains %s image candidates when an argv list is empty or unreadable', async tool => {
  const volume = Volume.fromJSON({'/empty.txt':''});
  for (const list of ['empty.txt', 'missing.txt']) {
    const argv = ['@' + list, ...(['magick', 'convert'].includes(tool) ? ['out.ppm'] : [])].map(b);
    const discovery = await discoverImageMagick(tool, argv, {
      accessible: async () => false, exists: async () => false,
      read: async path => new Uint8Array(volume.readFileSync('/' + s(path)) as Buffer)
    });
    expect(discovery.resources).toEqual(expect.arrayContaining([
      expect.objectContaining({path:b(list),role:'list',access:'read'}),
      expect.objectContaining({operand:argv[0],path:argv[0],role:'image',kind:'path',access:tool === 'mogrify' ? 'read-write' : 'read'})
    ]));
    expect(discovery.argv).toEqual(argv);
  }
});
it.each(['magick', 'identify', 'convert', 'mogrify'])('keeps %s glob syntax in directory components literal', async tool => {
  const argv = ['group[ab]/red.ppm', ...(['magick', 'convert'].includes(tool) ? ['out.ppm'] : [])].map(b);
  const discovery = await discoverImageMagick(tool, argv, {accessible:async () => false, exists:async () => false});
  expect(discovery.resources[0]).toMatchObject({path:argv[0],kind:'path'});
  expect(discovery.argv).toEqual(argv);
});
it.each(['group[ab]/a.bin', 'group*/a.bin', 'group?/a.bin'])('keeps concatenate directory syntax literal: %s', async name => {
  const discovery = await discoverImageMagick('magick', ['-concatenate', name, 'out.bin'].map(b), {accessible:async () => false, exists:async () => false});
  expect(resources(discovery)).toEqual([['out.bin','write','path'],[name,'read-delete','path']]);
});
it('checks the original coder-prefixed argv spelling before glob expansion', async () => {
  const volume = Volume.fromJSON({'/group/*.ppm':'literal image'});
  const accessible = async (name: string) => {
    try { return volume.statSync('/' + name).isFile(); } catch { return false; }
  };
  expect(await parseImageMagickOperand(b('PPM:group/*.ppm'), {accessible,exists:accessible,expandFilenames:true})).toMatchObject({name:'group/*.ppm',kind:'pattern',coder:'ppm'});
  expect(await parseImageMagickOperand(b('PPM:group/*.ppm'), {accessible,exists:accessible,expandFilenames:false})).toMatchObject({name:'group/*.ppm',kind:'path',coder:'ppm'});
  volume.writeFileSync('/*.ppm', 'cwd literal');
  expect(await parseImageMagickOperand(b('PPM:group/*.ppm'), {accessible,exists:accessible,expandFilenames:true})).toMatchObject({name:'group/*.ppm',kind:'path'});
  volume.mkdirSync('/PPM:group');
  volume.writeFileSync('/PPM:group/*.ppm', 'shadow');
  expect(await parseImageMagickOperand(b('PPM:group/*.ppm'), {accessible,exists:accessible,expandFilenames:true})).toMatchObject({name:'PPM:group/*.ppm',kind:'path'});
});
it('uses the native cwd tail accessibility check for raw concatenate globs', async () => {
  const volume = Volume.fromJSON({'/*.bin':'cwd literal'});
  const accessible = async (path: Uint8Array) => {
    try { return volume.statSync('/' + s(path)).isFile(); } catch { return false; }
  };
  const discovery = await discoverImageMagick('magick', ['-concatenate','group/*.bin','out.bin'].map(b), {accessible});
  expect(resources(discovery)).toEqual([['out.bin','write','path'],['group/*.bin','read-delete','path']]);
});
it.each(['magick', 'convert', 'mogrify'])('discovers normalized %s set-profile filenames without image processing', async tool => {
  const argv = ['red.ppm', '-set', 'profile', 'PPM:text.txt[0]', '+set', 'profile', 'out.ppm'].map(b);
  const discovery = await discoverImageMagick(tool, argv, context);
  expect(discovery.resources.filter(r => r.role === 'profile')).toMatchObject([
    {operand:b('PPM:text.txt[0]'), path:b('text.txt'), selector:true, kind:'path', access:'read'}
  ]);
  expect(discovery.argv).toEqual(argv);
});
it('retains literal coder brackets and modern uninterpreted set-profile filenames', async () => {
  const discovery = await scan(['-define', 'registry:filename:literal=true', 'xc:red', '-set', 'profile', 'PPM:missing.icc[0]', '-set', 'profile', '%[profile:path]', 'out.ppm']);
  expect(discovery.resources.filter(r => r.role === 'profile')).toMatchObject([
    {path:b('missing.icc[0]'), kind:'path'}, {kind:'path',path:b('%[profile:path]')}
  ]);
});
it.each(['magick', 'convert', 'mogrify'])('distinguishes %s set-profile file opens from property interpretation', async tool => {
  for (const available of [true, false, undefined]) {
    const discovery = await discoverImageMagick(tool, ['xc:red', '-set', 'profile', ' \t@profile-name.txt', 'out.ppm'].map(b), {
      accessible:async path => s(path) === 'profile-name.txt' ? available : false,
      exists:async () => false
    });
    const profile = discovery.resources.find(r => r.role === 'profile')!;
    expect(profile.kind).toBe(tool === 'magick' || available === false ? 'path' : 'dynamic');
    if (available !== false) {
      if (tool !== 'magick') expect(profile.path).toBeUndefined();
      expect(discovery.resources.find(r => r.role === 'text')).toMatchObject({path:b('profile-name.txt'), access:'read'});
    }
  }
});
it.each(['convert', 'mogrify'])('defers %s expression-derived set-profile filenames even in literal registry mode', async tool => {
  const discovery = await scan(['-define','registry:filename:literal=true','red.ppm','-set','profile','%[profile:path]','out.ppm'], tool);
  const profile = discovery.resources.find(r => r.role === 'profile')!;
  expect(profile.kind).toBe('dynamic');
  expect(profile.path).toBeUndefined();
});
it.each(['-', 'PPM:-'])('does not predict the suppressed set-profile read from %s', async operand => {
  const discovery = await scan(['xc:red', '-set', 'profile', operand, 'out.ppm']);
  expect(discovery.resources.filter(r => r.role === 'profile')).toEqual([]);
});
it.each(['read', 'write'] as const)('preserves explicit coder brackets in literal mode for missing %s paths', async access => {
  const operand = b('PPM:missing.ppm[0]');
  const parsed = await parseImageMagickOperand(operand, {
    accessible: async () => false, exists: async () => false,
    literalFilenames: true, access
  });
  expect(parsed).toMatchObject({name:'missing.ppm[0]',kind:'path',coder:'ppm'});
  expect(parsed.selector).toBeUndefined();
  const references = await imageMagickReaderReferences(operand, b('/work'), access, {
    accessible: async () => false, exists: async () => false, literalFilenames:true
  });
  expect(references).toMatchObject([{value:operand,path:b('missing.ppm[0]'),kind:'path'}]);
});
it('discovers ordered literal coder writes without requiring destinations to exist', async () => {
  const argv = ['red.ppm','-define','registry:filename:literal=true','(','(','-write','PPM:first.ppm[0]',')',')','+write','PPM:second.ppm[1]','-unknown','PPM:out.ppm[2]'].map(b);
  const discovery = await discoverImageMagick('magick', argv, {accessible:async () => false, exists:async () => false});
  expect(discovery.resources.filter(r => r.access === 'write')).toMatchObject([
    {path:b('first.ppm[0]'),kind:'path'}, {path:b('second.ppm[1]'),kind:'path'}, {path:b('out.ppm[2]'),kind:'path'}
  ]);
  expect(discovery.argv).toEqual(argv);
});
it('uses the original filesystem probe before deciding whether literal coder brackets survive', async () => {
  const files = Volume.fromJSON({'/PPM:shadow.ppm':'file'});
  const accessible = async (path: string) => {
    try { return files.statSync('/' + path).isFile(); } catch { return false; }
  };
  const parsed = await parseImageMagickOperand(b('PPM:shadow.ppm[0]'), {
    accessible, exists:accessible, literalFilenames:true, expandFilenames:true
  });
  expect(parsed).toMatchObject({name:'PPM:shadow.ppm',kind:'path',selector:true});
  expect(parsed.coder).toBeUndefined();
  const missing = await parseImageMagickOperand(b('PPM:missing.ppm[0]'), {
    accessible, exists:accessible, literalFilenames:true, expandFilenames:true
  });
  expect(missing).toMatchObject({name:'missing.ppm[0]',kind:'path',coder:'ppm'});
  expect(missing.selector).toBeUndefined();
  const glob = await parseImageMagickOperand(b('PPM:*.ppm[0]'), {
    accessible, exists:accessible, literalFilenames:true, expandFilenames:true
  });
  expect(glob).toMatchObject({name:'*.ppm[0]',kind:'pattern',coder:'ppm'});
});
it.each(['CAPTION', 'LABEL', 'PANGO', 'VID'])('keeps concatenate %s operands literal where ExpandFilenames skips the coder', async coder => {
  const argv = ['-concatenate', 'a.bin', coder + ':*.bin', 'b.bin', 'out.bin'].map(b);
  const discovery = await discoverImageMagick('magick', argv, {accessible:async () => false, exists:async () => false});
  expect(discovery.resources.find(r => s(r.operand) === coder + ':*.bin')).toMatchObject({
    path:b(coder + ':*.bin'), kind:'path', access:'read-delete'
  });
  expect(discovery.argv).toEqual(argv);
});
it.each(['identify', 'mogrify', 'compare', 'montage', 'composite', 'convert'])('discovers script-alias %s subcommand before implied script handling', async command => {
  const args = ['-negate', 'red.ppm', 'blue.ppm', 'missing.ppm'];
  const direct = await scan(args, command);
  const argv = [command.toUpperCase(), ...args];
  const discovery = await scan(argv, 'magick-script');
  expect(discovery.command).toBe(command);
  expect(resources(discovery)).toEqual(resources(direct));
  expect(discovery.resources.every(r => r.role !== 'script')).toBe(true);
  expect(discovery.argv.map(s)).toEqual(argv);
  expect(discovery.tokens.map(t => t.index)).toEqual(direct.tokens.map(t => t.index + 1));
});
it.each(['magick', 'magick-script'])('does not dispatch installed build helpers as %s subcommands', async tool => {
  const discovery = await scan(['MagickCore-config', 'out.ppm'], tool);
  expect(discovery.command).toBe(tool);
  expect(discovery.resources[0]).toMatchObject({operand:b('MagickCore-config'), access:'read', role:tool === 'magick-script' ? 'script' : 'image'});
});
it.each(['convert', 'mogrify'])('discovers %s -set profile reads independently of native processing', async tool => {
  const argv = ['red.ppm', '-set', 'PrOfIlE', 'missing.icc', '+set', 'profile', 'out.ppm'].map(b);
  const discovery = await discoverImageMagick(tool, argv, context);
  expect(discovery.argv).toEqual(argv);
  expect(discovery.resources.filter(r => r.role === 'profile')).toMatchObject([
    {operand:b('missing.icc'),path:b('missing.icc'),kind:'path',access:'read'}
  ]);
  expect(discovery.deferred.some(r => r.reason.includes('native profile filename'))).toBe(true);
});
it.each(['literal[0]', 'literal[abc]'])('keeps coder-normalized literal bracket file %s distinct from removed selectors', async filename => {
  const volume = Volume.fromJSON({['/' + filename]: 'image bytes'});
  const accessible = async (path: Uint8Array) => volume.existsSync('/' + s(path));
  const operand = b('PPM:' + filename);
  const discovery = await discoverImageMagick('magick', ['-define', 'registry:filename:literal=true', s(operand), 'out.ppm'].map(b), {accessible});
  expect(imageMagickAccessReferences(discovery).references[0]).toMatchObject({value:operand,path:b(filename),kind:'path'});
  expect(await imageMagickReaderReferences(operand, b('/work'), 'read', {
    accessible: async path => volume.existsSync('/' + path), literalFilenames: true
  })).toMatchObject([{value:operand,path:b(filename),kind:'path'}]);
});
it('records suffix removal even when the remaining filename has identical brackets', async () => {
  const operand = b('PPM:literal[0][0]');
  const discovery = await scan([s(operand), 'out.ppm']);
  expect(imageMagickAccessReferences(discovery).references[0]).toMatchObject({value:operand,path:b('literal[0]'),kind:'image-selector'});
  expect(await imageMagickReaderReferences(operand, b('/work'), 'read')).toMatchObject([
    {value:operand,path:b('literal[0]'),kind:'image-selector'}
  ]);
});
it('discovers the script alias concatenate fallback as raw files and input deletions', async () => {
  const argv = ['-concatenate', '@list', 'out.bin'].map(b);
  const discovery = await discoverImageMagick('magick-script', argv, context);
  expect(resources(discovery)).toEqual([
    ['list', 'read', 'path'], ['out.bin', 'write', 'path'],
    ['a b.png', 'read-delete', 'path'], ['c.png', 'read-delete', 'path']
  ]);
  expect(discovery.argv).toEqual(argv);
  expect(discovery.tokens).toEqual([]);
});
it('discovers the script alias list-query fallback without an implicit output', async () => {
  const discovery = await scan(['-list', 'format'], 'magick-script');
  expect(discovery.resources).toEqual([]);
  expect(discovery.tokens).toMatchObject([{raw:b('-list'),values:[b('format')],kind:'option'}]);
  expect(discovery.deferred.some(item => item.reason.includes('missing option operand'))).toBe(false);
});
it.each(['@', '@-', '@-drawing'])('keeps native literal drawing %s separate from file indirection', async drawing => {
  const discovery = await scan(['red.ppm', '-draw', drawing, 'out.ppm']);
  const { references, inline } = imageMagickAccessReferences(discovery);
  const reference = references.find(r => r.grammar === 'mvg')!;
  expect(reference).toMatchObject({value:b(drawing),kind:'synthetic',literal:false});
  expect(reference.path).toBeUndefined();
  expect(inline.get(reference)).toEqual(b(drawing));
});
it.each(['1e0x1E0+0+0', '1:1', '(1x1)', '1x1#', '1\tx1'])('discovers native geometry suffix %s independently of image processing', async selector => {
  const operand = `PPM:red.ppm[${selector}]`;
  const discovery = await scan(['(', '(', operand, ')', ')', '-write', 'first.ppm', 'out.ppm']);
  expect(discovery.resources[0]).toMatchObject({operand:b(operand), path:b('red.ppm'), kind:'path', access:'read'});
  expect(discovery.argv.map(s)).toContain(operand);
  const references = await imageMagickReaderReferences(b(operand), b('/work'), 'read', {accessible:async () => false, exists:async () => false});
  expect(references).toMatchObject([{value:b(operand), path:b('red.ppm'), kind:'image-selector'}]);
});
it('uses geometry suffix hints for filesystem classification while retaining literal bracket files', async () => {
  const files = Volume.fromJSON({'/xc:red': 'file', '/xc:blue[1e0]': 'literal', '/font[1e0]': 'face'});
  const accessible = async (path: Uint8Array) => files.existsSync('/' + s(path));
  const discovery = await discoverImageMagick('magick', ['xc:red[1e0]', '-define', 'registry:filename:literal=true', 'xc:blue[1e0]', '-font', '@font[1e0]', 'out.ppm'].map(b), {accessible, exists:accessible});
  expect(discovery.resources.filter(r => r.role !== 'text').slice(0,3)).toMatchObject([
    {path:b('xc:red'),kind:'path'}, {path:b('xc:blue[1e0]'),kind:'path'}, {path:b('font[1e0]'),role:'font'}
  ]);
  const face = await discoverImageMagick('magick', ['-font', '@font[1e0]', 'caption:hello', 'out.ppm'].map(b), {accessible});
  expect(face.resources.find(r => r.role === 'font')).toMatchObject({path:b('font'),role:'font'});
});
it.each(['-define', '-set'])('recognizes native case-insensitive registry prefixes for %s hints', async option => {
  const setting = option === '-define' ? ['ReGiStRy:filename:literal=true'] : ['ReGiStRy:filename:literal', 'true'];
  const reset = option === '-define' ? ['+define', 'REGISTRY:filename:literal'] : ['+set', 'REGISTRY:filename:literal'];
  const discovery = await scan([option, ...setting, '%02d.ppm', ...reset, '%02d.ppm', 'out.ppm']);
  expect(discovery.resources.filter(r => s(r.operand) === '%02d.ppm').map(r => r.kind)).toEqual(['path', 'dynamic']);
});
it('resets literal registry discovery hints through native -delete without tracking images', async () => {
  const discovery = await scan(['-define', 'registry:filename:literal=true', '(', '%02d.ppm', ')', '-delete', 'ReGiStRy:filename:literal', '%02d.ppm', 'out.ppm']);
  expect(discovery.resources.filter(r => s(r.operand) === '%02d.ppm').map(r => r.kind)).toEqual(['path', 'dynamic']);
  expect(discovery.argv.map(s)).toContain('ReGiStRy:filename:literal');
});
it.each(['-define', '-set'])('matches native case-insensitive registry keys for %s hints', async option => {
  const setting = option === '-define' ? ['REGISTRY:FiLeNaMe:LiTeRaL=true'] : ['REGISTRY:FiLeNaMe:LiTeRaL', 'true'];
  const discovery = await scan([option, ...setting, '%02d.ppm', '-delete', 'registry:FILENAME:LITERAL', '%02d.ppm', 'out.ppm']);
  expect(discovery.resources.filter(r => s(r.operand) === '%02d.ppm').map(r => r.kind)).toEqual(['path', 'dynamic']);
});
it('applies and removes pedantic registry hints at filesystem-sensitive option classification', async () => {
  const discovery = await scan(['-define', 'REGISTRY:OPTION:PEDANTIC=YES', '-unknown/file', '-delete', 'Registry:Option:Pedantic', '-unknown/file', 'out.ppm']);
  expect(discovery.tokens.filter(t => s(t.raw) === '-unknown/file').map(t => t.kind)).toEqual(['option', 'operand']);
});
it('treats a registry definition without equals as an empty native value', async () => {
  const discovery = await scan(['-define', 'registry:filename:literal=true', '%02d.ppm', '-define', 'registry:filename:literal', '%02d.ppm', 'out.ppm']);
  expect(discovery.resources.filter(r => s(r.operand) === '%02d.ppm').map(r => r.kind)).toEqual(['path', 'dynamic']);
});
it.each(['identify', 'compare'])('discovers %s format text using native accessibility without evaluating contents', async command => {
  for (const available of [true, false, undefined]) {
    for (const subcommand of [false, true]) {
      const args = ['-format', ' \t@text.txt', 'red.ppm', 'blue.ppm', ...(command === 'identify' ? [] : ['out.ppm'])];
      const read = vi.fn();
      const discovery = await discoverImageMagick(subcommand ? 'magick' : command, (subcommand ? [command, ...args] : args).map(b), {
        accessible: async path => s(path) === 'text.txt' ? available : false,
        read,
      });
      expect(discovery.resources.filter(r => r.role === 'text').map(r => s(r.path!))).toEqual(available === false ? [] : ['text.txt']);
      expect(imageMagickAccessReferences(discovery).references.filter(r => r.grammar === 'text').map(r => s(r.value))).toEqual(available === false ? [] : [' \t@text.txt']);
      expect(read).not.toHaveBeenCalled();
    }
  }
});
it.each(['identify', 'compare', 'montage', 'composite'])('keeps inaccessible %s format indirection literal', async command => {
  const discovery = await discoverImageMagick(command, ['-format', '@missing.txt', 'red.ppm', 'blue.ppm', ...(command === 'identify' ? [] : ['out.ppm'])].map(b), {accessible: async () => false});
  expect(discovery.resources.filter(r => r.role === 'text')).toEqual([]);
});
it.each(['montage', 'composite'])('does not discover disabled %s launcher metadata reads', async command => {
  for (const subcommand of [false, true]) {
    const args = ['-format', '@text.txt', 'red.ppm', 'blue.ppm', 'out.ppm'];
    const discovery = await discoverImageMagick(subcommand ? 'magick' : command, (subcommand ? [command, ...args] : args).map(b), {accessible: async path => s(path) === 'text.txt'});
    expect(discovery.resources.filter(r => r.role === 'text')).toEqual([]);
  }
});
it.each(['caption', 'label', 'pango'])('uses supplied accessibility for %s reader text without interpreting replacement bytes', async coder => {
  for (const available of [false, true, undefined]) {
    const path = coder === 'label' ? 'text' : 'text[0]';
    const accessible = vi.fn(async (name: string) => name === path ? available : false);
    const references = await imageMagickReaderReferences(b(`${coder}: \t@text[0]`), b('/work'), 'read', {
      accessible, exists: async () => false
    });
    expect(references.filter(r => r.grammar === 'text')).toEqual(available === false ? [] : [
      expect.objectContaining({value:b('@' + path),path:b(path),optional:true})
    ]);
    expect(accessible).toHaveBeenCalledWith(path);
  }
});
it('keeps reader stdin text and failed advisory probes unresolved', async () => {
  const accessible = vi.fn(async () => { throw Error('unavailable'); });
  const stdin = await imageMagickReaderReferences(b('caption:@-'), b('/work'), 'read', {accessible});
  expect(stdin).toMatchObject([{kind:'synthetic'}, {kind:'descriptor',grammar:'text'}]);
  const unknown = await imageMagickReaderReferences(b('caption:@text.txt'), b('/work'), 'read', {accessible});
  expect(unknown).toMatchObject([{kind:'synthetic'}, {path:b('text.txt'),optional:true}]);
});
it.each(['fd:missing', 'FD:3+0', 'fd:'])('defers image blob operand %s without reimplementing native geometry validation', async operand => {
  const discovery = await discoverImageMagick('magick', [operand, 'out.ppm'].map(b), {
    accessible: async () => false, exists: async () => false
  });
  expect(discovery.resources[0]).toMatchObject({operand:b(operand),kind:'dynamic',access:'read'});
  expect(discovery.resources[0].path).toBeUndefined();
  expect(discovery.deferred.some(d => d.reason.includes('native descriptor geometry or literal filename'))).toBe(true);
  const script = await discoverImageMagick('magick-script', [b(operand)]);
  expect(script.resources[0]).toMatchObject({kind:'descriptor',role:'script'});
});
it('keeps accessible fd-prefixed filenames distinct from descriptor and deferred operands', async () => {
  const volume = Volume.fromJSON({'/fd:missing':'image bytes'});
  const accessible = async (path: Uint8Array) => {
    try { return volume.statSync('/' + s(path)).isFile(); } catch { return false; }
  };
  const discovery = await discoverImageMagick('magick', ['fd:missing','fd:3'].map(b), {accessible});
  expect(resources(discovery)).toEqual([['fd:missing','read','path'],['fd:3','write','descriptor']]);
  const reader = await imageMagickReaderReferences(b('fd:missing'), b('/'), 'read', {
    accessible: async name => accessible(b(name))
  });
  expect(reader).toMatchObject([{path:b('fd:missing'),kind:'path',access:'read'}]);
});
it.each(['stream', 'magick'])('discovers %s pixel maps as settings rather than image resources', async tool => {
  const volume = Volume.fromJSON({'/RGB':'not an image', '/@components':'RGB'});
  const accessible = async (path: Uint8Array) => {
    try { return volume.statSync('/' + s(path)).isFile(); } catch { return false; }
  };
  for (const map of ['RGB', '@components', '%[channels]', 'PPM:palette.ppm[0]']) {
    const prefix = tool === 'magick' ? ['stream'] : [];
    const argv = [...prefix, '-map', map, '+map', 'red.ppm', 'missing.ppm', 'out.raw'].map(b);
    const discovery = await discoverImageMagick(tool, argv, {accessible});
    expect(discovery.command).toBe('stream');
    expect(resources(discovery)).toEqual([
      ['red.ppm','read','path'], ['missing.ppm','read','path'], ['out.raw','write','path']
    ]);
    expect(discovery.tokens.filter(t => t.kind === 'option').map(t => [s(t.raw), t.values.map(s)])).toEqual([
      ['-map', [map]], ['+map', []]
    ]);
    expect(discovery.argv).toEqual(argv);
    expect(imageMagickAccessReferences(discovery).references.map(r => s(r.value))).not.toContain(map);
  }
});
it('retains image-cache map resources outside the stream parser', async () => {
  for (const tool of ['magick','convert','mogrify']) {
    const discovery = await scan(['red.ppm','-map','PPM:palette.ppm[0]','out.ppm'], tool);
    expect(discovery.resources.find(r => r.index === 1)).toMatchObject({
      operand:b('PPM:palette.ppm[0]'),path:b('palette.ppm'),access:'read',kind:'path'
    });
  }
});
it.each(['accessible', 'exists'] as const)('defers failed %s probes in standalone image reader discovery', async probe => {
  const options = {
    accessible: async () => false,
    exists: async () => false,
    [probe]: async () => { throw Error('advisory filesystem unavailable'); }
  };
  const operand = b('PPM:literal[0]');
  const parsed = await parseImageMagickOperand(operand, options);
  expect(parsed).toMatchObject({name:'literal',kind:'path'});
  expect(parsed.deferred.some(reason => reason.includes('filesystem-sensitive'))).toBe(true);
  expect(await imageMagickReaderReferences(operand, b('/work'), 'read', options)).toMatchObject([
    {value:operand,path:b('literal'),kind:'image-selector',access:'read'}
  ]);
  expect(operand).toEqual(b('PPM:literal[0]'));
});
it.each(['%02d.ppm', '%[filename:name].ppm'])('keeps literal-registry filename %s out of expression discovery', async name => {
  const volume = Volume.fromJSON({['/' + name]: 'image bytes'});
  const accessible = async (path: Uint8Array) => {
    try { return volume.statSync('/' + s(path)).isFile(); } catch { return false; }
  };
  const argv = ['-define', 'registry:filename:literal=true', '(', '(', name, ')', ')', '-write', 'PPM:' + name, '+define', 'registry:filename:literal', name, 'out.ppm'].map(b);
  const discovery = await discoverImageMagick('magick', argv, {accessible});
  expect(resources(discovery)).toEqual([[name,'read','path'],[name,'write','path'],[name,'read','dynamic'],['out.ppm','write','path']]);
  expect(discovery.argv).toEqual(argv);
  expect(await imageMagickReaderReferences(b('PPM:' + name), b('/work'), 'write', {literalFilenames:true})).toMatchObject([{kind:'path',path:b(name)}]);
});
it.each(['xc', 'gradient', 'caption', 'label', 'pango'])('defers %s destinations independently from synthetic inputs', async coder => {
  const operand = coder + ':@text.txt';
  const discovery = await scan(['xc:red', '-write', operand, 'null:']);
  const destination = discovery.resources.find(r => r.index === 1)!;
  expect(destination).toMatchObject({operand:b(operand),access:'write',kind:'dynamic'});
  expect(destination.path).toBeUndefined();
  expect(discovery.resources.filter(r => r.role === 'text')).toEqual([]);
  expect(discovery.deferred.some(r => r.index === 1 && r.reason.includes('encoder'))).toBe(true);
  expect(await imageMagickReaderReferences(b(operand), b('/work'), 'write')).toMatchObject([{kind:'filename-expression',path:undefined}]);
  const plusWrite = await scan(['xc:red', '+write', operand, 'null:']);
  expect(plusWrite.resources.find(r => r.access === 'write')).toMatchObject({operand:b(operand),kind:'dynamic'});
  const implicit = await scan(['xc:red', operand]);
  expect(implicit.resources.at(-1)).toMatchObject({operand:b(operand),access:'write',kind:'dynamic'});
  expect(implicit.resources.filter(r => r.role === 'text')).toEqual([]);
});
it.each(['magick', 'identify', 'mogrify', 'convert'])('keeps quote-leading %s wildcard operands literal during argv expansion', async tool => {
  for (const quote of ["'", '"']) {
    const name = quote + '*.ppm';
    const argv = [name, ...(['magick', 'convert'].includes(tool) ? ['out.ppm'] : [])].map(b);
    const discovery = await discoverImageMagick(tool, argv, {accessible:async () => false, exists:async () => false});
    expect(discovery.resources[0]).toMatchObject({operand:b(name),path:b(name),kind:'path'});
    expect(discovery.argv).toEqual(argv);
  }
});
it.each(['magick', 'convert'])('keeps quote-leading %s concatenate deletion candidates literal', async tool => {
  for (const quote of ["'", '"']) {
    const name = quote + '*.bin';
    const discovery = await discoverImageMagick(tool, ['-concatenate',name,'out.bin'].map(b), {accessible:async () => false});
    expect(resources(discovery)).toEqual([['out.bin','write','path'],[name,'read-delete','path']]);
  }
});
it.each(['DATA:', 'DaTa:'])('keeps case-insensitive embedded %s sources distinct from files at discovery call sites', async scheme => {
  const value = b('INLINE:' + scheme + 'invalid');
  const filesystem = {accessible: async () => false, exists: async () => false};
  const discovery = await discoverImageMagick('magick', [value, b('out.ppm')], filesystem);
  expect(discovery.resources[0]).toMatchObject({operand:value,kind:'synthetic',access:'read'});
  expect(discovery.resources[0].path).toBeUndefined();
  expect(await imageMagickReaderReferences(value, b('/work'), 'read', filesystem)).toMatchObject([{kind:'synthetic',path:undefined}]);
  expect(await imageMagickReaderReferences(value, b('/work'), 'write', filesystem)).toMatchObject([{kind:'path',path:b(scheme + 'invalid')}]);
  const volume = Volume.fromJSON({['/' + s(value)]:'literal bytes'});
  expect(await imageMagickReaderReferences(value, b('/work'), 'read', {
    accessible: async name => { try { return volume.statSync('/' + name).isFile(); } catch { return false; } }
  })).toMatchObject([{kind:'path',path:value}]);
});
it('distinguishes DATA files from embedded INLINE sources and write destinations', async () => {
  const discovery = await scan(['DATA:encoded.txt','inline:data:image/ppm;base64,AAAA','-write','DATA:first.ppm','INLINE:second.ppm']);
  expect(resources(discovery)).toEqual([
    ['encoded.txt','read','path'], ['inline:data:image/ppm;base64,AAAA','read','synthetic'],
    ['first.ppm','write','path'], ['second.ppm','write','path']
  ]);
});
it('applies INLINE resource classification at native reader positions without validating embedded bytes', async () => {
  const value = b('INLINE:data:invalid');
  expect(await imageMagickReaderReferences(value, b('/work'), 'read')).toMatchObject([{kind:'synthetic', path:undefined}]);
  expect(await imageMagickReaderReferences(value, b('/work'), 'write')).toMatchObject([{kind:'path', path:b('data:invalid')}]);
  const volume = Volume.fromJSON({'/INLINE:data:invalid':'literal'});
  const accessible = async (path: string) => { try { return volume.statSync('/' + path).isFile(); } catch { return false; } };
  expect(await imageMagickReaderReferences(value, b('/work'), 'read', {accessible})).toMatchObject([{kind:'path',path:value}]);
});
it.each(['{a,b}.bin', '[ab].bin', 'unmatched].bin', '%[name]*.bin'])('discovers concatenate glob candidate %s without resolving native effects', async name => {
  const argv = ['-concatenate', name, 'out.bin'].map(b);
  const d = await discoverImageMagick('magick', argv, {accessible:async () => false});
  expect(resources(d)).toEqual([['out.bin','write','path'], [name,'read-delete','pattern']]);
  expect(d.argv).toEqual(argv);
  const volume = Volume.fromJSON({['/' + name]:'literal bytes'});
  const literal = await discoverImageMagick('magick', argv, {accessible:async path => {
    try { return volume.statSync('/' + s(path)).isFile(); } catch { return false; }
  }});
  expect(resources(literal)).toEqual([['out.bin','write','path'], [name,'read-delete','path']]);
});
it.each(['magick', 'identify', 'mogrify'])('discovers %s brace patterns only where argv expansion applies', async tool => {
  const name = '{a,b}.ppm';
  const argv = [name, ...(tool === 'magick' ? ['out.ppm'] : [])].map(b);
  const d = await discoverImageMagick(tool, argv, {accessible:async () => false});
  expect(d.resources[0]).toMatchObject({path:b(name),kind:'pattern'});
  const literal = await discoverImageMagick(tool, argv, {accessible:async path => s(path) === name});
  expect(literal.resources[0]).toMatchObject({path:b(name),kind:'path'});
  const direct = await discoverImageMagick('magick', ['red.ppm','-mask',name,'-write',name,'out.ppm'].map(b), {accessible:async () => false});
  expect(direct.resources.filter(r => s(r.operand) === name).map(r => r.kind)).toEqual(['path','path']);
});
it.each(['magick', 'convert', 'mogrify'])('discovers %s profile image-reader candidates and literal fallback independently', async tool => {
  const argv = ['red.ppm', '-profile', 'PPM:blue.ppm[0]', '-profile', '@profiles[0]', '-profile', 'mpr:profile', 'out.ppm'].map(b);
  const read = vi.fn(async () => b('unexpected.ppm'));
  const discovery = await discoverImageMagick(tool, argv, {accessible:async () => false, exists:async () => false, read});
  const profiles = discovery.resources.filter(r => r.role === 'profile');
  expect(profiles.map(r => [s(r.path ?? r.operand), r.kind])).toEqual([
    ['blue.ppm', 'path'], ['PPM:blue.ppm[0]', 'path'],
    ['@profiles', 'path'], ['@profiles[0]', 'path'],
    ['mpr:profile', 'register'], ['mpr:profile', 'path']
  ]);
  expect(profiles.map(r => s(r.operand))).toEqual(['PPM:blue.ppm[0]', 'PPM:blue.ppm[0]', '@profiles[0]', '@profiles[0]', 'mpr:profile', 'mpr:profile']);
  expect(read).not.toHaveBeenCalled();
  expect(discovery.argv).toEqual(argv);
  expect(discovery.deferred.some(r => r.reason.includes('profile reader'))).toBe(true);
});
it('discovers profile readers in scripts without expanding lists or glob operands', async () => {
  const read = vi.fn(async () => b('red.ppm -profile PPM:*.ppm -profile color.icc +profile "*" -exit'));
  const discovery = await discoverImageMagick('magick-script', [b('profile.mg')], {accessible:async () => false, exists:async () => false, read});
  expect(discovery.resources.filter(r => r.role === 'profile').map(r => [s(r.path ?? r.operand),r.kind])).toEqual([
    ['*.ppm','path'], ['PPM:*.ppm','path'], ['color.icc','path']
  ]);
  expect(read).toHaveBeenCalledTimes(1);
});
it('honors filesystem-sensitive literal profile image filenames', async () => {
  const discovery = await discoverImageMagick('magick', ['red.ppm','-define','registry:filename:literal=true','-profile','PPM:face[0]','out.ppm'].map(b), {
    accessible:async path => s(path) === 'PPM:face[0]', exists:async () => false
  });
  expect(discovery.resources.filter(r => r.role === 'profile')).toEqual([
    expect.objectContaining({operand:b('PPM:face[0]'),path:b('PPM:face[0]'),kind:'path'})
  ]);
});
it('keeps stat-visible colon paths distinct from accessible regular files', async () => {
  const volume = Volume.fromJSON({'/xc:green/child':'x'});
  const discovery = await discoverImageMagick('magick', ['xc:green', 'out.ppm'].map(b), {
    accessible: async path => { try { return volume.statSync('/' + s(path)).isFile(); } catch { return false; } },
    exists: async path => { try { volume.statSync('/' + s(path)); return true; } catch { return false; } }
  });
  expect(discovery.resources[0]).toMatchObject({operand:b('xc:green'),path:b('xc:green'),kind:'path',access:'read'});
});
it('defers colon classification when stat visibility is unknown', async () => {
  const discovery = await discoverImageMagick('magick', ['xc:green', 'out.ppm'].map(b), {accessible:async () => false});
  expect(discovery.deferred.some(d => d.reason.includes('coder or literal'))).toBe(true);
});
it('probes stat with the scene-stripped candidate and preserves failed lookup as unknown', async () => {
  const exists = vi.fn(async (path: Uint8Array) => {
    if (s(path) === 'xc:green') return true;
    throw Error('stat unavailable');
  });
  const discovery = await discoverImageMagick('magick', ['xc:green[0]', 'xc:blue', 'out.ppm'].map(b), {accessible:async () => false, exists});
  expect(exists.mock.calls.map(([path]) => s(path))).toEqual(['xc:green', 'xc:blue']);
  expect(discovery.resources[0]).toMatchObject({path:b('xc:green'),kind:'path'});
  expect(discovery.resources[1]).toMatchObject({kind:'synthetic'});
  expect(discovery.deferred.some(d => d.index === 1 && d.reason.includes('coder or literal'))).toBe(true);
});
it.each(['magick', 'identify', 'mogrify'])('classifies %s filename lists from original operands before coder and selector normalization', async tool => {
  const volume = Volume.fromJSON({'/names[0]':'red.ppm', '/names':'blue.ppm'});
  const read = vi.fn(async (path: Uint8Array) => new Uint8Array(volume.readFileSync('/' + s(path)) as Buffer));
  const argv = ['PPM:@names', '@names[0]', ...(tool === 'magick' ? ['out.ppm'] : [])].map(b);
  const discovery = await discoverImageMagick(tool, argv, {accessible:async () => false, read});
  expect(read.mock.calls.map(([path]) => s(path))).toEqual(['names[0]']);
  expect(resources(discovery)).toContainEqual(['@names', tool === 'mogrify' ? 'read-write' : 'read', 'path']);
  expect(resources(discovery)).toContainEqual(['names[0]', 'read', 'path']);
  expect(resources(discovery)).toContainEqual(['red.ppm', tool === 'mogrify' ? 'read-write' : 'read', 'path']);
  expect(discovery.argv).toEqual(argv);
});
it('keeps original filename-list spelling for explicit reads in observed scripts', async () => {
  const read = vi.fn(async (path: Uint8Array) => b(s(path) === 'task.mg' ? '-read PPM:@names -read @names[0] -write out.ppm' : 'red.ppm'));
  const discovery = await discoverImageMagick('magick-script', [b('task.mg')], {accessible:async () => false, read});
  expect(read.mock.calls.map(([path]) => s(path))).toEqual(['task.mg', 'names[0]']);
  expect(resources(discovery)).toContainEqual(['@names', 'read', 'path']);
  expect(resources(discovery)).toContainEqual(['names[0]', 'read', 'path']);
});
it('uses original operand accessibility at the filename-list expansion call site', async () => {
  const volume = Volume.fromJSON({'/@names':'image bytes', '/names[0]':'red.ppm'});
  const accessible = async (path: Uint8Array) => {
    try { return volume.statSync('/' + s(path)).isFile(); } catch { return false; }
  };
  const read = vi.fn(async (path: Uint8Array) => new Uint8Array(volume.readFileSync('/' + s(path)) as Buffer));
  const discovery = await discoverImageMagick('magick', ['@names[0]', 'out.ppm'].map(b), {accessible, read});
  // The extracted @names is accessible, but the original @names[0] is not.
  expect(read.mock.calls.map(([path]) => s(path))).toEqual(['names[0]']);
  expect(resources(discovery)).toContainEqual(['red.ppm', 'read', 'path']);
  volume.writeFileSync('/@names[0]', 'literal image bytes');
  read.mockClear();
  const literal = await discoverImageMagick('magick', ['@names[0]', 'out.ppm'].map(b), {accessible, read});
  expect(read).not.toHaveBeenCalled();
  expect(literal.resources.some(r => r.role === 'list')).toBe(false);
});
it.each(['magick', 'convert', 'mogrify'])('discovers deprecated %s map cache operands without argv expansion', async tool => {
  const read = vi.fn(async () => b('blue.ppm'));
  const argv = ['red.ppm', '-map', 'PNG:palette.ppm[0]', '-map', '@palette', '-map', '*.ppm', '+map', ...(tool === 'mogrify' ? [] : ['out.ppm'])].map(b);
  const discovery = await discoverImageMagick(tool, argv, {accessible: async () => false, read});
  expect(discovery.resources.filter(r => r.index === 1 || r.index === 3 || r.index === 5).map(r => [s(r.path!), r.access, r.kind])).toEqual([
    ['palette.ppm', 'read', 'path'], ['@palette', 'read', 'path'], ['*.ppm', 'read', 'path']
  ]);
  expect(discovery.tokens.find(t => s(t.raw) === '+map')?.values).toEqual([]);
  expect(discovery.argv).toEqual(argv);
  expect(read).not.toHaveBeenCalled();
});
it('discovers map resources in observed scripts without expanding cache-reader lists', async () => {
  const volume = Volume.fromJSON({'/task.mg': 'red.ppm -map PNG:palette.ppm[0] -map @palette -map *.ppm +map -write out.ppm'});
  const read = vi.fn(async (path: Uint8Array) => new Uint8Array(volume.readFileSync('/' + s(path)) as Buffer));
  const discovery = await discoverImageMagick('magick-script', [b('task.mg')], {accessible: async () => false, read});
  expect(resources(discovery)).toEqual(expect.arrayContaining([
    ['palette.ppm', 'read', 'path'], ['@palette', 'read', 'path'], ['*.ppm', 'read', 'path']
  ]));
  expect(read.mock.calls.map(([path]) => s(path))).toEqual(['task.mg']);
});
it('classifies coder prefixes against the native scene-stripped filesystem candidate', async () => {
  const volume = Volume.fromJSON({ '/xc:purple': 'image', '/xc:red[0]': 'literal' });
  const accessible = vi.fn(async (path: Uint8Array) => {
    try { return volume.statSync('/' + s(path)).isFile(); } catch { return false; }
  });
  const argv = ['xc:purple[0]', 'xc:red[0]', 'out.ppm'].map(b);
  const d = await discoverImageMagick('magick', argv, { accessible });
  expect(resources(d)).toEqual([
    ['xc:purple', 'read', 'path'], ['xc:red[0]', 'read', 'synthetic'], ['out.ppm', 'write', 'path']
  ]);
  expect(d.argv).toEqual(argv);
  expect(accessible).toHaveBeenCalledWith(b('xc:purple'));
  const literal = await discoverImageMagick('magick', ['-define', 'registry:filename:literal=true', 'xc:red[0]', 'out.ppm'].map(b), { accessible });
  expect(resources(literal)[0]).toEqual(['xc:red[0]', 'read', 'path']);
});
it.each(['magick', 'convert', 'mogrify'])('classifies deferred %s caption/comment/label text using native accessibility', async tool => {
  for (const option of ['-caption', '-comment', '-label']) for (const available of [true, undefined, false]) {
    const lookup = vi.fn(async (path: Uint8Array) => s(path) === 'text.txt' ? available : false);
    const argv = [option, ' \t@text.txt', 'red.ppm', ...(tool === 'mogrify' ? [] : ['out.ppm'])].map(b);
    const d = await discoverImageMagick(tool, argv, { accessible: lookup });
    expect(d.argv).toEqual(argv);
    expect(d.resources.filter(r => r.role === 'text').map(r => s(r.path!))).toEqual(available === false ? [] : ['text.txt']);
    expect(lookup).toHaveBeenCalledWith(b('text.txt'));
    if (available !== false) expect(imageMagickAccessReferences(d).references.filter(r => r.grammar === 'text').map(r => s(r.value))).toEqual([' \t@text.txt']);
    if (available === undefined) expect(d.deferred.some(r => r.reason.includes('text indirection'))).toBe(true);
  }
});
it.each(['magick', 'convert', 'mogrify'])('keeps missing %s caption/comment/label text literal and signed resets operand-free', async tool => {
  for (const option of ['caption', 'comment', 'label']) {
    const d = await scan(['-' + option, '@missing.txt', '+' + option, 'red.ppm', ...(tool === 'mogrify' ? [] : ['out.ppm'])], tool);
    expect(d.resources.filter(r => r.role === 'text')).toEqual([]);
    expect(d.tokens.find(t => s(t.raw) === '+' + option)?.values).toEqual([]);
  }
});
it.each(['convert', 'mogrify'])('classifies legacy %s annotate/set text at the property reader', async tool => {
  for (const available of [true, undefined, false]) {
    const lookup = vi.fn(async (path: Uint8Array) => s(path) === 'text.txt' ? available : false);
    const d = await discoverImageMagick(tool, ['red.ppm', '-annotate', '0', ' \t@text.txt', '-set', 'comment', ' \n@text.txt', '+set', '@literal-key', 'out.ppm'].map(b), { accessible: lookup });
    expect(d.resources.filter(r => r.role === 'text').map(r => s(r.path!))).toEqual(available === false ? [] : ['text.txt', 'text.txt']);
    expect(lookup).toHaveBeenCalledWith(b('text.txt'));
    if (available !== false) expect(imageMagickAccessReferences(d).references.filter(r => r.grammar === 'text').map(r => s(r.value))).toEqual([' \t@text.txt', ' \n@text.txt']);
    if (available === undefined) expect(d.deferred.some(r => r.reason.includes('text indirection'))).toBe(true);
  }
});
it.each(['convert', 'mogrify'])('keeps inaccessible legacy %s set text literal', async tool => {
  const d = await scan(['red.ppm', '-set', 'comment', '@missing.txt', 'out.ppm'], tool);
  expect(d.resources.filter(r => r.role === 'text')).toEqual([]);
});
it.each([
  ['convert', ['+function']], ['mogrify', ['+function']],
  ['composite', ['-distort', '1,0,0,1,0,0']], ['composite', ['+distort']],
  ['identify', ['-resize']]
] as const)('keeps preliminary shared-table parameters literal in legacy %s', async (tool, prefix) => {
  const d = await scan([...prefix, '@list', '*.ppm', ...(tool === 'mogrify' || tool === 'identify' ? [] : ['out.ppm'])], tool);
  expect(d.resources.some(r => r.role === 'list')).toBe(false);
  expect(resources(d)).toContainEqual(['@list', tool === 'mogrify' ? 'read-write' : 'read', 'path']);
  if (prefix.length === 1 && prefix[0] !== '-resize') expect(resources(d)).toContainEqual(['*.ppm', tool === 'mogrify' ? 'read-write' : 'read', 'path']);
});
it.each(['convert', 'mogrify'])('keeps image operands after legacy %s +function', async command => {
  for (const tool of [command, 'magick']) {
    const d = await scan([...(tool === 'magick' ? [command] : []), '+function', 'red.ppm', 'blue.ppm', '-write', 'early.ppm', ...(command === 'convert' ? ['out.ppm'] : [])], tool);
    expect(d.tokens[0].values).toEqual([]);
    expect(resources(d)).toEqual([
      ['red.ppm', command === 'mogrify' ? 'read-write' : 'read', 'path'],
      ['blue.ppm', command === 'mogrify' ? 'read-write' : 'read', 'path'],
      ['early.ppm', 'write', 'path'],
      ...(command === 'convert' ? [['out.ppm', 'write', 'path']] : [])
    ]);
  }
});
it.each([['-distort', ['1,0,0,1,0,0']], ['+distort', []]] as const)('discovers composite %s operands using its own signed grammar', async (option, values) => {
  for (const tool of ['composite', 'magick']) {
    const d = await scan([...(tool === 'magick' ? ['composite'] : []), option, ...values, 'red.ppm', 'blue.ppm', 'out.ppm'], tool);
    expect(d.tokens[0].values.map(s)).toEqual(values);
    expect(resources(d)).toEqual([['red.ppm', 'read', 'path'], ['blue.ppm', 'read', 'path'], ['out.ppm', 'write', 'path']]);
  }
});
it.each(['magick', 'convert'])('selects %s concatenate output after expanding a final list', async tool => {
  const d = await discoverImageMagick(tool, ['-concatenate', 'first.bin', '@destinations'].map(b), {
    accessible: async () => false,
    read: async () => b('middle.bin last.bin')
  });
  expect(resources(d)).toEqual([
    ['destinations', 'read', 'path'], ['last.bin', 'write', 'path'],
    ['first.bin', 'read-delete', 'path'], ['middle.bin', 'read-delete', 'path']
  ]);
  expect(d.argv.map(s)).toEqual(['-concatenate', 'first.bin', '@destinations']);
});
it('keeps build helper names as image operands inside magick', async () => {
  for (const [name, entry] of Object.entries(imageMagickReference.executables)) {
    if (entry.kind === 'media') continue;
    const d = await scan([name, 'out.ppm']);
    expect(d.command).toBe('magick');
    expect(resources(d)).toEqual([[name, 'read', 'path'], ['out.ppm', 'write', 'path']]);
  }
});
it('keeps concatenate option parameters literal during preliminary expansion', async () => {
  const read = vi.fn(async () => b('expanded.bin'));
  const d = await discoverImageMagick('magick', ['-concatenate', '-read', '@literal', '*.bin', 'out.bin'].map(b), {
    accessible: async () => false, read
  });
  expect(resources(d)).toEqual([
    ['out.bin', 'write', 'path'], ['-read', 'read-delete', 'path'],
    ['@literal', 'read-delete', 'path'], ['*.bin', 'read-delete', 'pattern']
  ]);
  expect(read).not.toHaveBeenCalled();
});
it.each([undefined, b('')])('retains concatenate raw output when a list has no discovered members: %s', async content => {
  const d = await discoverImageMagick('magick', ['-concatenate', 'first.bin', '@destinations'].map(b), {
    accessible: async () => false, read: async () => content
  });
  expect(resources(d)).toEqual([
    ['destinations', 'read', 'path'], ['@destinations', 'write', 'path'],
    ['first.bin', 'read-delete', 'path']
  ]);
});
it('discovers repeated concatenate lists as separate ordered occurrences', async () => {
  const read = vi.fn(async () => b('a.bin b.bin'));
  const d = await discoverImageMagick('magick', ['-concatenate', '@names', '@names'].map(b), {
    accessible: async () => false, read
  });
  expect(resources(d)).toEqual([
    ['names', 'read', 'path'], ['names', 'read', 'path'], ['b.bin', 'write', 'path'],
    ['a.bin', 'read-delete', 'path'], ['b.bin', 'read-delete', 'path'], ['a.bin', 'read-delete', 'path']
  ]);
  expect(read).toHaveBeenCalledTimes(2);
});
it('keeps script-local -script tokens without recursively reading a native special-option operand', async () => {
  const read = vi.fn(async (path: Uint8Array) => s(path) === 'root.mg'
    ? b('xc:red -write first.ppm -script nested.mg -write later.ppm')
    : b('xc:blue -write invented.ppm'));
  const d = await discoverImageMagick('magick-script', ['root.mg'].map(b), {read});
  expect(read).toHaveBeenCalledTimes(1);
  expect(d.tokens.find(t => s(t.raw) === '-script')?.values.map(s)).toEqual(['nested.mg']);
  expect(resources(d)).toEqual([
    ['root.mg', 'read', 'path'], ['xc:red', 'read', 'synthetic'],
    ['first.ppm', 'write', 'path'], ['later.ppm', 'write', 'path']
  ]);
  expect(d.deferred.some(r => r.reason.includes('script-local special option'))).toBe(true);
});
it.each(['-mask', '-read-mask', '-write-mask', '-clip-mask', '-texture', '-tile', '-affinity', '-remap', '-fill', '-stroke'])('keeps %s cache-reader filenames out of argv list and glob expansion', async option => {
  const read = vi.fn(async () => b('red.ppm blue.ppm'));
  const d = await discoverImageMagick('magick', ['xc:red', option, '@list.txt', option, '*.ppm', 'out.ppm'].map(b), {
    accessible: async () => false, read
  });
  expect(resources(d)).toEqual([
    ['xc:red', 'read', 'synthetic'], ['@list.txt', 'read', 'path'],
    ['*.ppm', 'read', 'path'], ['out.ppm', 'write', 'path']
  ]);
  expect(read).not.toHaveBeenCalled();
  expect(d.argv.map(s)).toEqual(['xc:red', option, '@list.txt', option, '*.ppm', 'out.ppm']);
});
it('uses the same cache-reader filename grammar in observed script tokens', async () => {
  const d = await discoverImageMagick('magick-script', ['task.mg'].map(b), {
    accessible: async () => false, read: async () => b('xc:red -mask @list.txt -fill PNG:*.ppm -write out.ppm')
  });
  expect(resources(d)).toEqual([
    ['task.mg', 'read', 'path'], ['xc:red', 'read', 'synthetic'],
    ['@list.txt', 'read', 'path'], ['*.ppm', 'read', 'path'], ['out.ppm', 'write', 'path']
  ]);
});
it.each(['-fill', '-stroke', '-resize'])('discovers %s property indirection independently of runtime evaluation', async option => {
  for (const available of [true, false, undefined]) {
    const read = vi.fn(async () => b('native-only replacement'));
    const d = await discoverImageMagick('magick', ['red.ppm', option, ' \t@value.txt', 'out.ppm'].map(b), {
      accessible: async () => available, read
    });
    expect(d.resources.filter(r => r.role === 'text').map(r => s(r.path!))).toEqual(available === false ? [] : ['value.txt']);
    if (available !== false) expect(d.deferred.some(r => r.reason.includes('native text replacement'))).toBe(true);
    expect(read).not.toHaveBeenCalled();
  }
});
it('discovers explicit FreeType face filenames without treating them as lists', async () => {
  const d = await scan(['-font','@face[1]','caption:hello','-font','@missing','label:hello','out.ppm']);
  expect(d.resources.filter(r => r.role === 'font').map(r => [s(r.operand), s(r.path!)])).toEqual([
    ['@face[1]', 'face'], ['@missing', 'missing']
  ]);
  expect(d.resources.some(r => r.role === 'list')).toBe(false);
  expect(resources(await scan(['-font','face[1]','caption:hello','out.ppm']))).toContainEqual(['face[1]','read','path']);
});
it.each(['convert', 'mogrify', 'identify', 'montage', 'composite', 'compare'])('discovers literal percent-bearing %s fonts independently of native rendering', async tool => {
  const argv = ['-font', './%font.ttf', 'red.ppm', 'out.ppm'].map(b);
  const discovery = await discoverImageMagick(tool, argv, context);
  expect(discovery.resources.filter(r => r.role === 'font')).toMatchObject([
    {operand:b('./%font.ttf'), path:b('./%font.ttf'), kind:'path', access:'read'}
  ]);
  expect(discovery.argv).toEqual(argv);
});
it('defers short font property expressions rather than treating them as lookup names', async () => {
  const d = await scan(['-font','%f','caption:hello','out.ppm']);
  expect(d.resources.filter(r => r.role === 'font')).toMatchObject([{operand:b('%f'), kind:'dynamic'}]);
});
it('discovers literal passkey and CDL file operands at their distinct native readers', async () => {
  const d = await scan(['red.ppm', '-encipher', '@key[0]', '-decipher', '%[key]', '-cdl', '@grade[0]', '-cdl', 'fd:3', 'out.ppm']);
  expect(resources(d)).toEqual([
    ['red.ppm', 'read', 'path'], ['@key[0]', 'read', 'path'],
    ['%[key]', 'read', 'path'], ['grade[0]', 'read', 'path'],
    ['fd:3', 'read', 'path'], ['out.ppm', 'write', 'path']
  ]);
  expect(d.resources.find(r => r.path && s(r.path) === 'grade[0]')?.operand).toEqual(b('@grade[0]'));
  expect(imageMagickAccessReferences(d).references).toContainEqual(expect.objectContaining({
    value:b('@grade[0]'), path:b('grade[0]'), kind:'path', literal:true, access:'read'
  }));
  expect(d.deferred.some(r => r.reason.includes('property expression'))).toBe(false);
  for (const option of ['-encipher', '-decipher', '-cdl']) {
    expect(resources(await scan(['red.ppm', option, '-', 'out.ppm']))).toContainEqual(['-', 'read', 'descriptor']);
  }
  expect(resources(await scan(['red.ppm', '-cdl', '@-', 'out.ppm']))).toContainEqual(['@-', 'read', 'descriptor']);
});
it('keeps conjure MSL resources distinct from magick-script token streams', async () => {
  for (const [tool, prefix] of [['conjure', []], ['magick', ['conjure']]] as const) {
    const d = await scan([...prefix, 'MSL:script.msl'], tool);
    expect(imageMagickAccessReferences(d).references).toContainEqual(expect.objectContaining({
      value: b('MSL:script.msl'), path: b('script.msl'), grammar: 'msl', access: 'read'
    }));
  }
  const d = await scan(['-script', 'script']);
  expect(imageMagickAccessReferences(d).references.find(r => r.path && s(r.path) === 'script')?.grammar).toBe('magick-script');
});
it('classifies text coder indirection at the native property interpretation call site', async () => {
  for (const coder of ['caption', 'label', 'pango']) {
    for (const available of [true, undefined, false]) {
      const lookup = vi.fn(async (path: Uint8Array) => s(path) === 'text.txt' ? available : false);
      const d = await discoverImageMagick('magick', [`${coder}: \t@text.txt`, 'out.ppm'].map(b), { accessible: lookup });
      expect(d.resources.filter(r => r.role === 'text').map(r => s(r.path!))).toEqual(available === false ? [] : ['text.txt']);
      expect(lookup).toHaveBeenCalledWith(b('text.txt'));
      expect(d.resources.find(r => r.kind === 'synthetic')?.operand).toEqual(b(`${coder}: \t@text.txt`));
      if (available === undefined) expect(d.deferred.some(r => r.reason.includes('text indirection'))).toBe(true);
    }
    const d = await scan([`${coder}:%[comment]`, 'out.ppm']);
    expect(d.resources[0].kind).toBe('synthetic');
    expect(d.deferred.some(r => r.reason.includes('property expression'))).toBe(true);
  }
});
it.each(['caption', 'label', 'pango'])('discovers %s text selectors at its actual native reader', async coder => {
  const files = Volume.fromJSON({'/text.txt':'hello', '/text.txt[0]':'bracket'});
  const accessible = async (path: Uint8Array) => files.existsSync('/' + s(path));
  for (const literal of [false, true]) {
    const operand = `${coder}:@text.txt[0]`;
    const argv = [...(literal ? ['-define','registry:filename:literal=true'] : []), operand, 'out.ppm'].map(b);
    const path = coder === 'label' && !literal ? 'text.txt' : 'text.txt[0]';
    const discovery = await discoverImageMagick('magick', argv, {accessible});
    expect(discovery.resources.filter(r => r.role === 'text')).toMatchObject([{path:b(path),access:'read'}]);
    expect(discovery.resources.find(r => r.kind === 'synthetic')?.operand).toEqual(b(operand));
    expect(discovery.argv).toEqual(argv);
    const references = await imageMagickReaderReferences(b(operand), b('/'), 'read', {
      accessible:async name => accessible(b(name)), literalFilenames:literal,
    });
    expect(references.filter(r => r.grammar === 'text')).toMatchObject([{path:b(path)}]);
  }
});
it('does not recursively expand filename-list members as lists or globs', async () => {
  const files = Volume.fromJSON({ '/names': '@nested @nested frame-*.ppm', '/nested': 'unexpected.ppm' });
  const read = vi.fn(async (path: Uint8Array) => new Uint8Array(files.readFileSync('/' + s(path)) as Buffer));
  const discovery = await discoverImageMagick('identify', [b('@names')], { read });
  expect(resources(discovery)).toEqual([
    ['names', 'read', 'path'], ['@nested', 'read', 'path'],
    ['@nested', 'read', 'path'], ['frame-*.ppm', 'read', 'path'],
  ]);
  expect(read.mock.calls.map(([path]) => s(path))).toEqual(['names']);
});
it("discovers every natively interpreted operand independently of image processing", async () => {
  for (const available of [true, undefined, false]) {
    const d = await discoverImageMagick('magick', ['red.ppm','-annotate',' \t@geometry.txt',' @text.txt','-set',' @key.txt',' \n@value.txt','-function',' @function.txt',' @parameters.txt','out.ppm'].map(b), {
      accessible: async () => available
    });
    expect(d.resources.filter(r => r.role === 'text').map(r => s(r.path!))).toEqual(available === false ? [] : ['geometry.txt','text.txt','key.txt','value.txt','function.txt','parameters.txt']);
    if (available !== false) expect(imageMagickAccessReferences(d).references.filter(r => r.grammar === 'text').map(r => s(r.value))).toEqual([' \t@geometry.txt',' @text.txt',' @key.txt',' \n@value.txt',' @function.txt',' @parameters.txt']);
    if (available === undefined) expect(d.deferred.some(r => r.reason.includes('text indirection'))).toBe(true);
  }
});
it("retains signed always-interpreted operands and defers property evaluation", async () => {
  const d = await scan(['red.ppm','+distort','@method.txt','@points.txt','-annotate','%[geometry]','%[text]','out.ppm']);
  expect(d.resources.filter(r => r.role === 'text').map(r => s(r.path!))).toEqual([]);
  const unknown = await discoverImageMagick('magick', ['red.ppm','+distort','@method.txt','@points.txt','out.ppm'].map(b));
  expect(unknown.resources.filter(r => r.role === 'text').map(r => s(r.path!))).toEqual(['method.txt','points.txt']);
  expect(d.tokens.find(t => s(t.raw) === '+distort')?.values.map(s)).toEqual(['@method.txt','@points.txt']);
  expect(d.deferred.some(r => r.reason.includes('property expression'))).toBe(true);
});
it("discovers print indirection using native whitespace and accessibility classification", async () => {
  for (const accessible of [true, undefined, false]) {
    const lookup = vi.fn(async () => accessible);
    const d = await discoverImageMagick('magick', ['xc:red','-write','first.ppm','-print',' \t@text.txt','-write','second.ppm','-unknown','out.ppm'].map(b), { accessible: lookup });
    expect(d.resources.filter(r => r.role === 'text').map(r => s(r.path!))).toEqual(accessible === false ? [] : ['text.txt']);
    expect(lookup).toHaveBeenCalledWith(b('text.txt'));
    expect(d.tokens.find(t => s(t.raw) === '-print')?.values).toEqual([b(' \t@text.txt')]);
    if (accessible !== false) expect(imageMagickAccessReferences(d).references.find(r => r.grammar === 'text')).toMatchObject({value:b(' \t@text.txt'),path:b('text.txt')});
    if (accessible === undefined) expect(d.deferred.some(r => r.reason.includes('text indirection'))).toBe(true);
  }
});
it("keeps modern write @names and wildcard filenames out of read expansion grammar", async () => {
  const d = await scan(['@list','+append','-write','@first.ppm','+write','PNG:*.ppm','@final.ppm']);
  expect(resources(d)).toEqual([
    ['list','read','path'], ['a b.png','read','path'], ['c.png','read','path'],
    ['@first.ppm','write','path'], ['*.ppm','write','path'], ['@final.ppm','write','path']
  ]);
  const script = await discoverImageMagick('magick-script', [b('task')], {
    accessible: async () => false, read: async () => b('xc:red -write @first.ppm +write PNG:*.ppm -exit')
  });
  expect(resources(script)).toContainEqual(['@first.ppm','write','path']);
  expect(resources(script)).toContainEqual(['*.ppm','write','path']);
  expect(script.resources.filter(r => r.role === 'list')).toHaveLength(0);
});
it("distinguishes explicit writes from legacy and concatenate argv expansion", async () => {
  const d = await scan(['red.ppm','-write','@first.ppm','+write','*.ppm','@list'], 'convert');
  expect(resources(d)).toContainEqual(['@first.ppm','write','path']);
  expect(resources(d)).toContainEqual(['*.ppm','write','path']);
  expect(resources(d)).toContainEqual(['list','read','path']);
  expect(resources(d)).toContainEqual(['a b.png','write','path']);
  expect(resources(await scan(['-concatenate','a.bin','@list']))).toContainEqual(['list','read','path']);
});
it("tracks literal registry hints set and removed through signed -set operations", async () => {
  const d = await scan(['-set','registry:filename:literal','true','literal[0]','+set','registry:filename:literal','literal[0]','out.ppm']);
  expect(resources(d).map(r => r[0])).toEqual(['literal[0]','literal','out.ppm']);
  const p = await scan(['-set','registry:option:pedantic','true','-unknown/file','out.ppm']);
  expect(p.tokens.find(t => s(t.raw) === '-unknown/file')?.kind).toBe('option');
});
it("discovers likely fill and stroke images while deferring native color classification", async () => {
  const d = await scan(['-fill','PNG:paint.png[0]','-stroke','paint.ppm','-fill','red','+stroke','xc:red','out.ppm']);
  expect(resources(d)).toEqual([['paint.png','read','path'],['paint.ppm','read','path'],['xc:red','read','synthetic'],['out.ppm','write','path']]);
  expect(d.deferred.some(d => d.reason.includes('color or image'))).toBe(true);
});
it("discovers the profile resource in -set without evaluating its native key or filename", async () => {
  const d = await scan(['xc:red','-set','profile','color.icc','-set','%[key]','%[value]','+set','profile','out.ppm']);
  expect(d.resources.find(r => r.role === 'profile')).toMatchObject({operand:b('color.icc'),path:b('color.icc'),access:'read'});
  expect(d.deferred.some(d => d.reason.includes('profile filename'))).toBe(true);
  expect(d.resources.filter(r => r.role === 'profile')).toHaveLength(1);
});
it("keeps script fopen names literal rather than applying image coder and selector grammar", async () => {
  for (const name of ['task[0]', 'caption:@task', '@task']) {
    const d = await discoverImageMagick('magick', ['-script', name].map(b), {
      accessible: async () => false, read: async () => b('xc:red -write out.ppm')
    });
    expect(d.resources[0]).toMatchObject({path:b(name),kind:'path',role:'script',access:'read'});
    expect(resources(d)).toContainEqual(['out.ppm','write','path']);
  }
  const stdin = await discoverImageMagick('magick-script', [b('-')]);
  expect(stdin.resources[0]).toMatchObject({kind:'descriptor',role:'script',access:'read'});
});
it("accounts for concatenate with no inputs and modern list queries without implied image output", async () => {
  expect(resources(await scan(['-concatenate','empty.bin']))).toEqual([['empty.bin','write','path']]);
  const query = await scan(['-list','font']);
  expect(resources(query)).toEqual([]);
  expect(query.tokens[0].values.map(s)).toEqual(['font']);
  expect(query.deferred.some(d => d.reason.includes('missing'))).toBe(false);
});
it("reserves the modern final operand before parsing group syntax", async () => {
  const d = await scan(['xc:red', ')']);
  expect(resources(d)).toContainEqual([')','write','path']);
  expect(d.tokens.at(-1)?.kind).toBe('operand');
});
it("reserves legacy implicit outputs before classifying parentheses", async () => {
  for (const tool of ['convert','compare','composite','montage','stream']) {
    const d = await scan(['red.ppm','blue.ppm',')'], tool);
    expect(d.tokens.at(-1)?.kind).toBe('operand');
    expect(resources(d).at(-1)).toEqual([')','write','path']);
  }
  expect((await scan(['red.ppm',')'], 'identify')).tokens.at(-1)?.kind).toBe('close');
});
it("matches native script continuations, control bytes and token completion", () => {
  expect(imageMagickScriptTokens(b('"a\\\nb" c\fd\ve #comment\rnext\nlast\\')).tokens.map(s)).toEqual(['ab','c\fd\ve','next','last']);
  expect(imageMagickScriptTokens(b('one two\0 ignored'))).toEqual({tokens:[b('one')],incomplete:true});
  expect(imageMagickScriptTokens(b('"a\\\r\nb"')).tokens.map(s)).toEqual(['a\\\r\nb']);
});
it("defers expression-bearing fonts while keeping uninterpreted profiles and @text literal", async () => {
  const d = await scan(['-font','%[font:path]','-profile','%[profile:path]','caption:@%[text:path]','out.ppm']);
  expect(resources(d)).toEqual(expect.arrayContaining([['%[font:path]','read','dynamic'],['%[profile:path]','read','path'],['%[text:path]','read','path']]));
  expect(d.resources.filter(r => r.kind === 'dynamic').every(r => !r.path)).toBe(true);
});
it("removes ordered registry hints and inherits them into scripts", async () => {
  const d = await scan(['-define','registry:filename:literal=true','literal[0]','+define','registry:filename:literal','literal[0]','out.ppm']);
  expect(resources(d).map(r => r[0])).toEqual(['literal[0]','literal','out.ppm']);
  const script = await discoverImageMagick('magick', ['-define','registry:option:pedantic=true','-script','script'].map(b), {
    accessible: async () => true, read: async () => b('-unknown -exit')
  });
  expect(script.tokens.find(t => t.source === 'script' && s(t.raw) === '-unknown')?.kind).toBe('option');
});
it("defers concatenate filename expansion while retaining raw deletion candidates", async () => {
  const d = await scan(['-concatenate','*.bin','@list','out.bin']);
  expect(resources(d)).toContainEqual(['*.bin','read-delete','pattern']);
  expect(resources(d)).toContainEqual(['list','read','path']);
  expect(resources(d)).toContainEqual(['a b.png','read-delete','path']);
  expect(d.deferred.some(d => d.reason.includes('concatenate filename expansion'))).toBe(true);
});
it("discovers ordered operands and nested groups without implementing an image list", async () => {
  const d = await scan(['-size', '2x2', '(', 'xc:red', '(', 'PNG:in.png[0]', '+resize', '50%', ')', ')', '-write', 'one.ppm', '-write', 'two.ppm', 'final.ppm']);
  expect(d.tokens.filter(t => t.kind === 'option').map(t => [s(t.raw), t.values.map(s)])).toEqual([['-size',['2x2']], ['+resize',['50%']], ['-write',['one.ppm']], ['-write',['two.ppm']]]);
  expect(resources(d)).toEqual([['xc:red','read','synthetic'], ['in.png','read','path'], ['one.ppm','write','path'], ['two.ppm','write','path'], ['final.ppm','write','path']]);
  expect(d.tokens.find(t => s(t.raw) === 'PNG:in.png[0]')?.depth).toBe(2);
});
it("uses filesystem-sensitive classification at legacy and modern fallback sites", async () => {
  expect(resources(await scan(['literal[0]', 'out.ppm']))[0][0]).toBe('literal');
  expect(resources(await scan(['-define','registry:filename:literal=true','literal[0]', 'out.ppm']))[0][0]).toBe('literal[0]');
  expect(resources(await scan(['-resize', 'out.ppm'], 'identify'))[0][0]).toBe('-resize');
  expect((await scan(['-resize', '2x2', 'out.ppm'])).tokens[0].kind).toBe('option');
  expect(resources(await scan(['-unknown', 'out.ppm']))[0]?.[0]).not.toBe('-unknown');
});
it("discovers text, fonts, profiles and lists separately from synthetic images and registers", async () => {
  const d = await scan(['-font','fonts/a.ttf','-profile','color.icc','caption:@text.txt','@list','-write','mpr:cache','mpr:cache','out.ppm']);
  expect(resources(d)).toEqual(expect.arrayContaining([['fonts/a.ttf','read','path'],['color.icc','read','path'],['text.txt','read','path'],['list','read','path'],['a b.png','read','path'],['c.png','read','path'],['mpr:cache','write','register']]));
  expect(resources(await scan(['+profile','*','xc:red','null:']))).not.toContainEqual(['*','read','pattern']);
});
it("tokenizes scripts without shell expansion and never resumes CLI after -script", async () => {
  const d = await scan(['-script','script','ignored.ppm']);
  expect(resources(d)).toContainEqual(['one file.ppm','write','path']);
  expect(resources(d)).not.toContainEqual(['ignored.ppm','write','path']);
  expect(d.tokens.some(t => t.source === 'script' && s(t.raw) === 'two.ppm')).toBe(false);
  expect(d.tokens.some(t => t.source === 'script' && t.values.some(v => s(v) === 'two.ppm'))).toBe(true);
});
it("accounts for raw concatenate output before reads and input deletion", async () => {
  const d = await scan(['-concatenate','a[0]','xc:red','out']);
  expect(resources(d)).toEqual([['out','write','path'],['a[0]','read-delete','path'],['xc:red','read-delete','path']]);
});
it("discovers deprecated convert concatenate through aliases and subcommand dispatch", async () => {
  for (const [tool, prefix] of [['convert', []], ['magick', ['convert']]] as const) {
    const d = await scan([...prefix, '-concatenate','a[0]','xc:red','@list','out.bin'], tool);
    expect(d.command).toBe('convert');
    expect(resources(d)).toEqual([['list','read','path'],['out.bin','write','path'],['a[0]','read-delete','path'],['xc:red','read-delete','path'],['a b.png','read-delete','path'],['c.png','read-delete','path']]);
    expect(resources(await scan([...prefix, '-concatenate','empty.bin'], tool))).toEqual([['empty.bin','write','path']]);
  }
});
it("defers metadata names, discovery errors and legacy uncertainty without validating", async () => {
  const d = await scan(['xc:red','-write','%[filename:base].png','-unknown','final.ppm']);
  expect(d.deferred.length).toBeGreaterThan(0);
  expect(resources(d)).toContainEqual(['%[filename:base].png','write','dynamic']);
  await expect(discoverImageMagick('magick', ['in[0]','out'].map(b), { accessible: async () => { throw Error('denied'); } })).resolves.toBeDefined();
  expect(resources(await scan(['-negate','a.ppm','b.ppm'],'mogrify'))).toEqual([['a.ppm','read-write','path'],['b.ppm','read-write','path']]);
});
it("preserves native argv, context, status and native-owned partial effects", async () => {
  const run = vi.fn(async () => ({exitCode: 1}));
  const binding = {build: imageMagickReference.id, grammarRevision: imageMagickGrammarRevision, argv: 'bytes' as const, lateAccess: 'complete' as const, effects: 'live' as const, run};
  const argv = ['(', 'xc:red', ')', '+write', 'one.ppm', 'out.ppm'].map(b);
  const ctx = {sentinel: true};
  expect(await createImageMagickShims(binding).magick(argv, ctx)).toEqual({exitCode: 1});
  expect(run).toHaveBeenCalledTimes(1);
  expect(run).toHaveBeenCalledWith(expect.objectContaining({argv, context: ctx}));
});

it('retains admitted ImageMagick methods and receivers after configuration changes', async () => {
  const discoveryContext = vi.fn(function (this: { marker: string }) {
    expect(this.marker).toBe('admitted');
    return {};
  });
  const run = vi.fn(async function (this: { marker: string }) {
    expect(this.marker).toBe('admitted');
    return { exitCode: 7 };
  });
  const binding = { build: imageMagickReference.id, grammarRevision: imageMagickGrammarRevision,
    argv: 'bytes' as const, lateAccess: 'complete' as const, effects: 'live' as const,
    marker: 'admitted', discoveryContext, run };
  const shim = createImageMagickShims(binding).identify;
  binding.run = vi.fn(async () => ({ exitCode: 99 }));
  binding.discoveryContext = vi.fn(() => ({}));
  expect(await shim([b('-version')], {})).toEqual({ exitCode: 7 });
  expect(discoveryContext).toHaveBeenCalledOnce();
  expect(binding.discoveryContext).not.toHaveBeenCalled();
  expect(run).toHaveBeenCalledOnce();
});

it('rejects malformed ImageMagick argv without coercion or native execution', async () => {
  const run = vi.fn(async () => ({ exitCode: 0 }));
  const shim = createImageMagickShims({ build: imageMagickReference.id, grammarRevision: imageMagickGrammarRevision,
    argv: 'bytes', lateAccess: 'complete', effects: 'live', run }).identify;
  for (const argv of [[1], ['-version'], [undefined], new Array(1)]) {
    await expect(shim(argv as never, {})).rejects.toThrow();
  }
  expect(run).not.toHaveBeenCalled();
});

it.each([-1, 256, 1.5, undefined])('rejects invalid ImageMagick native status %s after one execution', async exitCode => {
  const run = vi.fn(async () => ({ exitCode }));
  const shim = createImageMagickShims({ build: imageMagickReference.id, grammarRevision: imageMagickGrammarRevision,
    argv: 'bytes', lateAccess: 'complete', effects: 'live', run: run as never }).identify;
  await expect(shim([b('-version')], {})).rejects.toThrow('Invalid native exit status');
  expect(run).toHaveBeenCalledOnce();
});

it("keeps non-selector brackets literal and resolves coder prefixes before literal checks", async () => {
  expect(resources(await scan(['literal[abc]','out.ppm']))[0][0]).toBe('literal[abc]');
  expect(resources(await scan(['-define','registry:filename:literal=true','PPM:literal[0]','out.ppm']))[0][0]).toBe('literal[0]');
});
it("does not borrow the implicit output as a missing modern option argument", async () => {
  const d = await scan(['xc:red','-write','out.ppm']);
  expect(d.deferred.some(d => d.reason.includes('missing'))).toBe(true);
  expect(d.tokens.find(t => s(t.raw) === '-write')?.values).toEqual([]);
  expect(d.tokens.at(-1)).toMatchObject({raw:b('out.ppm'),kind:'operand'});
});
it.each(['-font', '-profile', '-read', '-write', '+write'])('reserves output before discovery of missing %s operands', async option => {
  const argv = ['xc:red','-write','first.ppm','-negate','+write','second.ppm',option,'out.ppm'].map(b);
  const d = await discoverImageMagick('magick', argv, context);
  expect(d.argv).toEqual(argv);
  expect(d.tokens.find(t => t.index === 6)?.values).toEqual([]);
  expect(d.resources.filter(r => s(r.operand) === 'out.ppm')).toMatchObject([
    {index:7,access:'write',role:'image',kind:'path'}
  ]);
  expect(d.deferred).toContainEqual(expect.objectContaining({index:6,reason:'missing option operand before implicit output'}));
});
it('retains available arguments of a truncated multi-operand option separately from final output', async () => {
  const d = await scan(['xc:red','-set','comment','out.ppm']);
  expect(d.tokens.find(t => s(t.raw) === '-set')?.values).toEqual([b('comment')]);
  expect(d.tokens.at(-1)).toMatchObject({raw:b('out.ppm'),index:3,kind:'operand'});
  expect(resources(d)).toContainEqual(['out.ppm','write','path']);
});
it.each([
  ['convert', '+evaluate'], ['convert', '+evaluate-sequence'], ['convert', '+extent'],
  ['mogrify', '+evaluate'], ['mogrify', '+evaluate-sequence'], ['mogrify', '+extent'],
  ['montage', '+extent']
])('discovers files following the legacy reset %s %s', async (tool, option) => {
  for (const route of [tool, 'magick', 'magick-script']) {
    const argv = [...(route === tool ? [] : [tool]), option, 'red.ppm', 'blue.ppm',
      ...(tool === 'mogrify' ? [] : ['out.ppm'])].map(b);
    const discovery = await discoverImageMagick(route, argv, {accessible:async () => false, exists:async () => false});
    expect(discovery.argv).toEqual(argv);
    expect(discovery.tokens.find(t => s(t.raw) === option)?.values).toEqual([]);
    expect(discovery.resources.filter(r => r.access !== 'write').map(r => s(r.path!))).toEqual(['red.ppm','blue.ppm']);
  }
});
it.each(['+evaluate', '+evaluate-sequence', '+extent'])('keeps modern operand counts for %s', async option => {
  const argv = [option, 'red.ppm', 'blue.ppm', 'out.ppm'].map(b);
  const discovery = await discoverImageMagick('magick', argv);
  expect(discovery.tokens[0].values).toEqual(argv.slice(1, option === '+evaluate' ? 3 : 2));
});
it.each(['+evaluate', '+evaluate-sequence', '+extent'])('keeps legacy expansion separate from reset operand counts for %s', async option => {
  const discovery = await discoverImageMagick('mogrify', [option, '@names', 'red.ppm'].map(b), {
    accessible:async () => false, exists:async () => false, read:async () => b('blue.ppm')
  });
  // ExpandFilenames uses the shared table before MogrifyImageCommand's
  // signed branch. An argument skipped there remains a literal image filename.
  expect(discovery.tokens[0].values).toEqual([]);
  expect(discovery.resources.filter(r => r.role === 'list')).toEqual([]);
  expect(discovery.resources.filter(r => r.role === 'image').map(r => s(r.path!))).toEqual(['@names','red.ppm']);
});
it("tracks legacy signed arities independently for resource-bearing operations", async () => {
  const d = await scan(['+resize','red.ppm','blue.ppm','out.ppm'], 'compare');
  expect(resources(d).map(r => r[0])).toEqual(['red.ppm','blue.ppm','out.ppm']);
  expect(resources(await scan(['-tile','2x2','red.ppm','out.ppm'], 'montage')).map(r => r[0])).toEqual(['red.ppm','out.ppm']);
  expect(resources(await scan(['-tile','red.ppm','blue.ppm','out.ppm'], 'composite')).map(r => r[0])).toEqual(['red.ppm','blue.ppm','out.ppm']);
});
it("distinguishes list grammar from script comments, and literal resource filenames", async () => {
  const d = await discoverImageMagick('magick', ['-font','font[0]','-profile','profile[0]','caption:@text[0]','@names','out.ppm'].map(b), {
    accessible: async path => s(path) === 'text[0]',
    read: async () => b("#hash.ppm 'a b.ppm' c\\d.ppm")
  });
  expect(resources(d)).toEqual(expect.arrayContaining([['font[0]','read','path'],['profile[0]','read','path'],['text[0]','read','path'],['#hash.ppm','read','path'],['c\\d.ppm','read','path']]));
});
it("accounts for mogrify format/path output settings without predicting decoded filenames", async () => {
  const d = await scan(['-path','dest','-format','png','red.ppm','+path','+format','blue.ppm'], 'mogrify');
  expect(resources(d)).toContainEqual(['red.ppm','read','path']);
  expect(resources(d)).toContainEqual(['red.ppm','write','dynamic']);
  expect(resources(d)).toContainEqual(['blue.ppm','read-write','path']);
});
it("treats VID as a file pattern and file coders as files, not synthetic images", async () => {
  expect(resources(await scan(['VID:*.ppm','PNG:source','out.ppm']))).toEqual([['*.ppm','read','pattern'],['source','read','path'],['out.ppm','write','path']]);
});
it("keeps bytes and native status even when optional discovery fails", async () => {
  const argv = [new Uint8Array([255,46,112,112,109]), b('out.ppm')];
  const run = vi.fn(async (request: {argv: readonly Uint8Array[]}) => { expect(request.argv).toEqual(argv); return {exitCode:11}; });
  const shims = createImageMagickShims({build:imageMagickReference.id,grammarRevision:imageMagickGrammarRevision,argv:'bytes',lateAccess:'complete',effects:'live',discoveryContext: () => { throw Error('discovery unavailable'); },run});
  await expect(shims.magick(argv, {})).resolves.toEqual({exitCode:11});
});
it("uses filesystem fallback for modern NonMagick entries and respects pedantic", async () => {
  const ctx = {accessible: async () => true};
  const d = await discoverImageMagick('magick', ['-path','out.ppm'].map(b), ctx);
  expect(resources(d)).toContainEqual(['-path','read','path']);
  const p = await discoverImageMagick('magick', ['-define','registry:option:pedantic=true','-path','out.ppm'].map(b), ctx);
  expect(resources(p)).not.toContainEqual(['-path','read','path']);
});
it("does not expand an accessible literal @filename and does not predict query outputs", async () => {
  const d = await discoverImageMagick('magick', ['@file','out.ppm'].map(b), {accessible: async () => true});
  expect(resources(d)).toContainEqual(['@file','read','path']);
  expect(resources(await scan(['-version']))).toEqual([]);
});
it("keeps output coders file-bearing and percentages inside synthetic sources synthetic", async () => {
  const d = await scan(['gradient:gray(50%)-white','-write','info:report.txt','histogram:out.ppm']);
  expect(resources(d)).toEqual([['gradient:gray(50%)-white','read','synthetic'],['report.txt','write','path'],['out.ppm','write','path']]);
});
it("accepts arbitrary operand names without object-prototype lookup errors", async () => {
  expect(resources(await scan(['constructor','__proto__','out.ppm'])).map(r => r[0])).toEqual(['constructor','__proto__','out.ppm']);
});
it("recognizes coder-prefixed descriptors and literal accessible colon filenames", async () => {
  expect(resources(await scan(['PNG:-','PNG:-']))).toEqual([['PNG:-','read','descriptor'],['PNG:-','write','descriptor']]);
  const d = await discoverImageMagick('magick',['xc:red','out.ppm'].map(b),{accessible:async p => s(p) === 'xc:red'});
  expect(resources(d)).toContainEqual(['xc:red','read','path']);
});

it('discovers indirect stdin text as a descriptor without a filesystem probe', async () => {
  const accessible = vi.fn(async () => false);
  const discovery = await discoverImageMagick('magick', ['xc:red','-print','@-','out.ppm'].map(b), {accessible});
  expect(discovery.resources.find(resource => resource.role === 'text')).toMatchObject({kind:'descriptor',access:'read'});
  expect(discovery.resources.find(resource => resource.role === 'text')?.path).toBeUndefined();
  expect(accessible).not.toHaveBeenCalledWith(b('-'));
});

it.each(['identify', 'mogrify', 'convert', 'compare', 'montage', 'composite'])('discovers legacy %s escaped filenames with command-specific effects', async tool => {
  for (const [entrypoint, prefix] of [[tool, []], ['magick', [tool]]] as const) {
    const args = [...prefix, '--', 'red.ppm', 'blue.ppm', 'out.ppm'];
    const discovery = await discoverImageMagick(entrypoint, args.map(b), {accessible: async () => false, exists: async () => false});
    expect(discovery.tokens.find(t => s(t.raw) === '--')).toMatchObject({kind:'operand',values:[b('red.ppm')]});
    expect(discovery.resources.filter(r => r.role === 'image').map(r => s(r.operand))).toEqual(['red.ppm','blue.ppm','out.ppm']);
    if (tool === 'mogrify') expect(discovery.resources[0].access).toBe('read-write');
    expect(discovery.argv).toEqual(args.map(b));
  }
});

it.each(['identify','mogrify'])('discovers trailing double dash as a literal %s input', async tool => {
  const discovery = await scan(['blue.ppm','--'], tool);
  expect(resources(discovery)).toContainEqual(['--',tool === 'mogrify' ? 'read-write' : 'read','path']);
});
