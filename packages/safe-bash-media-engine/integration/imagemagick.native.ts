/** Local pinned-stock oracle; does not qualify a remote live filesystem bridge. */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createImageMagickShims, imageMagickReference, imageMagickGrammarRevision, type ImageMagickTool } from '../src/index.js';
import { runNative } from './runner.js';
import { DependencyResolver } from '../src/resolver.js';
import { imageMagickReaderReferences } from '../src/imagemagick-operand.js';
import { imageMagickAccessReferences } from '../src/imagemagick-references.js';
import { parseMvg } from '../src/mvg.js';
const b = (s: string) => new TextEncoder().encode(s);
const text = (s: string) => Buffer.from(s, 'base64').toString();
// Native INLINE PNG output embeds creation timestamps. Pin the native clock
// for both launches so byte comparisons retain every chunk without clock drift.
const env = {LC_ALL:'C', LANG:'C', TZ:'UTC', HOME:'/nonexistent', PATH:'/usr/bin:/bin', MAGICK_THREAD_LIMIT:'1', SOURCE_DATE_EPOCH:'1'};
const red = 'P3\n2 1\n255\n255 0 0 255 0 0\n';
const blue = 'P3\n2 1\n255\n0 0 255 0 0 255\n';
const inlineRed = 'data:image/ppm;base64,' + Buffer.from(red).toString('base64');
let cwd: string;
let percentFont: Uint8Array;
beforeAll(async () => {
  const lock = JSON.parse(await readFile(new URL('../metadata/baselines/build-lock.json', import.meta.url), 'utf8'));
  for (const [path, entry] of Object.entries(lock.binaries_and_dylibs) as [string, {sha256:string}][]) expect(createHash('sha256').update(await readFile(path)).digest('hex'), path).toBe(entry.sha256);
  for (const [path, digest] of Object.entries(lock.config_and_font_hashes) as [string,string][]) expect(createHash('sha256').update(await readFile(path)).digest('hex'),path).toBe(digest);
  for (const entry of Object.values(imageMagickReference.executables)) expect(createHash('sha256').update(await readFile(entry.path)).digest('hex'), entry.path).toBe(entry.sha256);
  percentFont = await readFile('/System/Library/Fonts/Supplemental/Arial.ttf');
  cwd = await mkdtemp(join(tmpdir(),'media-cli-imagemagick-'));
});
afterAll(async () => { if (cwd) await rm(cwd, {recursive:true,force:true}); });
async function reset(quoted = false) {
  for (const name of await readdir(cwd)) await rm(join(cwd,name), {recursive:true,force:true});
  await mkdir(join(cwd, 'xc:green'));
  for (const [name, data] of Object.entries({ '%font.ttf':percentFont, '%02d.ppm':red, '%[filename:name].ppm':red, '--':red, 'red.ppm':red, 'blue.ppm':blue, 'literal[0]':red, '-resize':red, 'text.txt':'hello', 'list.txt':'red.ppm\nblue.ppm\n', 'a.bin':'a', 'b.bin':'b', 'xc:purple':red,
    'script.mg': "# no shell expansion\nxc:red -write 'first.ppm'\n( xc:blue -write second.ppm )\n-print 'before-error\\n' -unknown\n",
    'late.mg': "xc:red -write first.ppm\n'not closed",
    'good.mg': 'xc:red -write first.ppm',
    'nested.mg': 'xc:red -write first.ppm -print "first|" -negate -write second.ppm -print "second|" -script good.mg -write out.ppm',
    'task[0]': 'xc:red -write first.ppm',
    'caption:@task': 'xc:red -write first.ppm',
    '@task': 'xc:red -write first.ppm',
    'continued.mg': 'xc:red -write "first\\\n.ppm" -print "a\\\nb" -exit',
    'crlf.mg': 'xc:red -print "a\\\r\nb" -exit',
    'binary.mg': 'xc:red -write first.ppm\n-print incomplete\0 -exit',
    'bins.txt': 'a.bin\nb.bin\n',
    'destinations.txt': 'b.bin out.bin', 'empty.txt':'', '@literal': 'literal', '-read': 'option',
    'MagickCore-config': red, 'xc:red[0]': blue,
    'geometry.txt':'0', 'key.txt':'comment', 'value.txt':'from-file', 'paint.txt':'blue', 'resize.txt':'1x1',
    'method.txt':'AffineProjection', 'points.txt':'1,0,0,1,0,0',
    'function.txt':'Polynomial', 'parameters.txt':'1,0',
    '@key[0]':'secret', '%[key]':'secret',
    'grade[0]':'<ColorCorrectionCollection><ColorCorrection id="identity"><SOPNode><Slope>1 1 1</Slope><Offset>0 0 0</Offset><Power>1 1 1</Power></SOPNode><SatNode><Saturation>1</Saturation></SatNode></ColorCorrection></ColorCorrectionCollection>',
    'literal.mg':'xc:purple -write first.ppm -print first\\| -negate -write second.ppm -print second\\| -unknown',
    'literal-stdin.mg':'xc:purple -write first.ppm -print @- -negate -write second.ppm -print "|second|" -unknown',
    'literal-list.txt':'xc:purple',
    '@palette.ppm':blue, '*.map.ppm':blue,
    'names[0]':'red.ppm', 'names':'blue.ppm',
    'list-spelling.mg':'-read PPM:@palette.ppm -write first.ppm -print first\\| -read @names[0] -negate -write second.ppm -print second\\| -unknown',
    'map.mg':'red.ppm -write first.ppm -print first\\| -map PPM:blue.ppm[0] -write second.ppm -print second\\| -map missing.ppm',
    'directory.mg':'red.ppm -write first.ppm -print first\\| -negate -write second.ppm -print second\\| xc:green -write out.ppm',
    'directory-list.txt':'xc:green',
    'filtered-list.txt':'xc:green blue.ppm',
    'mixed-directory-list.txt':'xc:green a.bin b.bin',
    'directory.mvg':"image Over 0,0 1,1 'xc:green'",
    'directory.msl':'<image><read filename="red.ppm"/><write filename="first.ppm"/><negate/><write filename="second.ppm"/><read filename="xc:green"/></image>',
    'literal.msl':'<image><read filename="xc:purple"/><write filename="first.ppm"/><negate/><write filename="second.ppm"/><read filename="missing.ppm"/></image>',
    'script.msl':'<?xml version="1.0"?><image><read filename="red.ppm"/><write filename="msl.ppm"/></image>',
    'partial.msl':'<?xml version="1.0"?><image><read filename="red.ppm"/><write filename="first.ppm"/><negate/><write filename="second.ppm"/><read filename="missing.ppm"/></image>',
    'encoded.txt': inlineRed, 'DATA:invalid': red, 'text.txt[0]':'bracket',
    'profile-name.txt':'PPM:text.txt[0]', ' \t@profile-name.txt':'raw-profile'
  })) await writeFile(join(cwd,name),data);
  if (quoted) {
    await writeFile(join(cwd,"'red.ppm"),red);
    await writeFile(join(cwd,"'a.bin"),'a');
  }
  await writeFile(join(cwd,'red.png'),Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABAQMAAADO7O3JAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAADUExURf8AABniCTcAAAAKSURBVAjXY2AAAAACAAHiIbwzAAAAAElFTkSuQmCC','base64'));
}
async function effects() {
  const result: Record<string,string> = {};
  for (const name of await readdir(cwd)) if ((await stat(join(cwd,name))).isFile()) result[name] = (await readFile(join(cwd,name))).toString('base64');
  return result;
}
type Case = {name:string; tool:ImageMagickTool; args:string[]; code?:number; stderr?:string; stdout?:string; writes?:string[]; deleted?:string[]; stdin?:string};
const cases: Case[] = [
  {name:'observed filtered list after ordered writes',tool:'magick',
    args:['red.ppm','-write','first.ppm','-print','first|','-negate','+write','second.ppm','-print','second|','@filtered-list.txt','-unknown','out.ppm'],
    code:11,stdout:'first|second|',stderr:'unrecognized option',writes:['first.ppm','second.ppm']},
  ...(['empty.txt', 'missing-list.txt'] as const).flatMap(list => (['magick', 'convert'] as const).map(tool => ({
    name:`${tool} retains ${list} after ordered writes`,tool,
    args:['red.ppm','-write','first.ppm','-print','first|','-negate','+write','second.ppm','-print','second|','@' + list,'out.ppm'],
    code:1,stderr:list,stdout:'first|second|',writes:['first.ppm','second.ppm']
  }))),
  ...(['-font','-profile','-read','-write','+write'] as const).map(option => ({
    name:`reserved final output after missing ${option}`,tool:'magick' as const,
    args:['red.ppm','-write','first.ppm','-print','first|','-negate','+write','second.ppm','-print','second|',option,'out.ppm'],
    code:11,stderr:'missingargument',stdout:'first|second|',writes:['first.ppm','second.ppm']
  })),
  ...(['convert', 'magick'] as const).map(tool => ({
    name:`legacy literal percent font ${tool} before ordered read failure`, tool,
    args:[...(tool === 'magick' ? ['convert'] : []), '-font', './%font.ttf', 'caption:@text.txt', '-write', 'first.ppm', '-print', 'first|', '-negate', '+write', 'second.ppm', '-print', 'second|', 'missing.ppm', 'out.ppm'],
    code:1, stderr:'missing.ppm', stdout:'first|second|', writes:['first.ppm','second.ppm','out.ppm']
  })),
  {name:'legacy literal percent font montage', tool:'montage', args:['-font','./%font.ttf','-label','hello','red.ppm','out.ppm'], code:0, writes:['out.ppm']},
  {name:'legacy literal percent font mogrify', tool:'mogrify', args:['-font','./%font.ttf','-annotate','0','hello','red.ppm','missing.ppm'], code:1, stderr:'missing.ppm', writes:['red.ppm']},

  {name:'MVG literal percent font before ordered failure',tool:'convert',
    args:['red.ppm','-write','first.ppm','-print','first|','-negate','+write','second.ppm','-print','second|','-draw',"font './%font.ttf' text 0,0 'x'",'missing.ppm','out.ppm'],
    code:1,stderr:'missing.ppm',stdout:'first|second|',writes:['first.ppm','second.ppm','out.ppm']},
  ...(['+evaluate', '+evaluate-sequence', '+extent'] as const).flatMap(option =>
    (['convert', 'mogrify'] as const).map(tool => ({
      name:`legacy signed reset ${tool} ${option}`, tool,
      args:tool === 'convert'
        ? ['red.ppm','-write','first.ppm','-print','first|','-negate','+write','second.ppm','-print','second|',option,'blue.ppm','missing.ppm','out.ppm']
        : ['-negate',option,'red.ppm','blue.ppm','missing.ppm'],
      code:1, stderr:'missing.ppm',
      ...(tool === 'convert' ? {stdout:'first|second|',writes:['first.ppm','second.ppm']} : {writes:['red.ppm','blue.ppm']})
    }))),
  {name:'legacy signed reset montage +extent',tool:'montage',
    args:['-font','/System/Library/Fonts/Supplemental/Arial.ttf','+extent','red.ppm','blue.ppm','missing.ppm','out.ppm'],
    code:1,stderr:'missing.ppm',writes:['out.ppm']},
  {name:'modern set-profile opens literal percent filename before property interpretation',tool:'magick',
    args:['red.ppm','-set','filename:name','missing','-set','profile','%[filename:name].ppm',
      '-write','first.ppm','-print','first|','-negate','+write','second.ppm','-print','second|','-unknown','out.ppm'],
    stdout:'first|second|',stderr:'unrecognized option',writes:['first.ppm','second.ppm']},
  {name:'legacy indirect set-profile name preserves ordered partial writes',tool:'convert',
    args:['red.ppm','-set','profile',' \t@profile-name.txt','-write','first.ppm','-print','first|',
      '-negate','+write','second.ppm','-print','second|','-unknown','out.ppm'],
    stdout:'first|second|',stderr:'unrecognized option',writes:['first.ppm','second.ppm']},
  {name:'indirect set-profile name preserves ordered partial writes',tool:'magick',
    args:['red.ppm','-set','profile',' \t@profile-name.txt','-write','first.ppm','-print','first|',
      '-negate','+write','second.ppm','-print','second|','-unknown','out.ppm'],
    stdout:'first|second|',stderr:'unrecognized option',writes:['first.ppm','second.ppm']},
  ...(['magick', 'convert', 'mogrify'] as const).map(tool => ({
    name:`normalized ${tool} set-profile read after ordered writes`, tool,
    args:[...(tool === 'mogrify' ? [] : ['red.ppm']), '-set','profile','PPM:text.txt[0]',
      '-write','first.ppm','-negate','+write','second.ppm','-set','profile','PPM:missing.icc[0]',
      tool === 'mogrify' ? 'red.ppm' : 'out.ppm'],
    stderr:'missing.icc', writes:['first.ppm','second.ppm']
  })),
  {name:'literal coder brackets preserve ordered partial writes',tool:'magick',
    args:['-define','registry:filename:literal=true','(','(','PPM:red.ppm',')',')','-write','PPM:first.ppm[0]','-print','first|','-negate','+write','PPM:second.ppm[1]','-print','second|','PPM:missing.ppm[0]','PPM:out.ppm[2]'],
    code:1,stdout:'first|second|',stderr:'missing.ppm[0]',writes:['first.ppm[0]','second.ppm[1]']},
  ...(['CAPTION', 'LABEL', 'PANGO', 'VID'] as const).map(coder => ({
    name:`concatenate unexpanded ${coder} coder after partial input`, tool:'magick' as const,
    args:['-concatenate','a.bin',coder + ':*.bin','b.bin','out.bin'],code:1,
    stderr:coder.toLowerCase() + ':*.bin',writes:['out.bin'],deleted:['a.bin','b.bin']
  })),
  {name:'script-alias subcommand identify reads before failure',tool:'magick-script',args:['IDENTIFY','-format','%f|','red.ppm','blue.ppm','missing.ppm'],code:1,stdout:'red.ppm|blue.ppm|',stderr:'missing.ppm'},
  {name:'script-alias subcommand mogrify edits before failure',tool:'magick-script',args:['mogrify','-negate','red.ppm','blue.ppm','missing.ppm'],code:1,stderr:'missing.ppm',writes:['red.ppm','blue.ppm']},
  {name:'script-alias subcommand compare dissimilar status',tool:'magick-script',args:['compare','-metric','AE','red.ppm','blue.ppm','out.ppm'],code:1,stderr:'0.666667',writes:['out.ppm']},
  {name:'script-alias subcommand convert ordered partial writes',tool:'magick-script',args:['convert','red.ppm','-write','first.ppm','-print','first|','-negate','+write','second.ppm','-print','second|','-unknown','out.ppm'],code:1,stdout:'first|second|',stderr:'unrecognized option',writes:['first.ppm','second.ppm']},
  ...(['convert', 'mogrify'] as const).map(tool => ({
    name:`legacy ${tool} set profile read after ordered writes`,tool,
    args:[...(tool === 'convert' ? ['red.ppm'] : []), '-write','first.ppm','-negate','+write','second.ppm','-set','PrOfIlE','missing.icc', tool === 'convert' ? 'out.ppm' : 'red.ppm'],
    stderr:'missing.icc',writes:['first.ppm','second.ppm']
  })),
  {name:'script alias concatenate fallback success',tool:'magick-script',args:['-concatenate','@bins.txt','out.bin'],code:0,writes:['out.bin'],deleted:['a.bin','b.bin']},
  {name:'script alias concatenate fallback partial effects',tool:'magick-script',args:['-concatenate','a.bin','missing.bin','b.bin','out.bin'],code:1,stderr:'missing.bin',writes:['out.bin'],deleted:['a.bin','b.bin']},
  {name:'script alias list-query fallback',tool:'magick-script',args:['-list','format'],code:0,stdout:'Format'},
  ...(['/System/Library/Fonts/Supplemental/Arial.ttf', '@/System/Library/Fonts/Supplemental/Arial.ttf[0]', '@missing.ttf[0]'] as const).map(font => ({
    name:`MVG font resource ${font} after ordered writes`,tool:'magick' as const,
    args:['red.ppm','-write','first.ppm','-print','first|','-negate','+write','second.ppm','-print','second|','-draw',`font '${font}' text 0,0 'x'`,'-unknown','out.ppm'],
    code:font === '@missing.ttf[0]' ? 1 : 11,
    stderr:font === '@missing.ttf[0]' ? 'unable to read font' : 'unrecognized option',
    stdout:'first|second|',writes:['first.ppm','second.ppm']
  })),
  ...(['@', '@-', '@-drawing'] as const).map(drawing => ({
    name:`literal drawing ${drawing} after ordered writes`,tool:'magick' as const,
    args:['red.ppm','-write','first.ppm','-print','first|','-negate','+write','second.ppm','-print','second|','-draw',drawing,'out.ppm'],
    code:drawing === '@-' ? 0 : 1,
    ...(drawing === '@-' ? {} : {stderr:'non-conforming drawing primitive'}),
    stdout:'first|second|',writes:['first.ppm','second.ppm',...(drawing === '@-' ? ['out.ppm'] : [])]
  })),
  ...['1e0x1E0+0+0', '1:1', '(1x1)', '1x1#', '1\tx1'].map(selector => ({
    name:`geometry suffix ${selector} before ordered failure`, tool:'magick' as const,
    args:['(', '(', `PPM:red.ppm[${selector}]`, ')', ')', '-write','first.ppm','-print','first|','-negate','+write','second.ppm','-print','second|','-unknown','out.ppm'],
    code:11, stderr:'unrecognized option', stdout:'first|second|', writes:['first.ppm','second.ppm']
  })),
  {name:'ordered registry prefix hints empty definition',tool:'magick',args:['red.ppm','-define','registry:filename:literal=true','-write','%02d.ppm','-print','first|','-define','Registry:Filename:Literal','-negate','+write','%03d.ppm','-print','second|','-unknown','out.ppm'],code:11,stderr:'unrecognized option',stdout:'first|second|',writes:['%02d.ppm','000.ppm']},
  ...(['-define', '-set', '-delete'] as const).map(option => ({
    name:`ordered registry prefix hints ${option}`, tool:'magick' as const,
    args:['red.ppm', ...(option === '-set' ? ['-set','ReGiStRy:FiLeNaMe:LiTeRaL','true'] : ['-define','ReGiStRy:FiLeNaMe:LiTeRaL=true']), '-write','%02d.ppm','-print','first|',
      ...(option === '-delete' ? ['-delete','REGISTRY:FILENAME:LITERAL'] : option === '-set' ? ['+set','REGISTRY:FILENAME:LITERAL'] : ['+define','REGISTRY:FILENAME:LITERAL']),
      '-negate','+write','%03d.ppm','-print','second|','-unknown','out.ppm'],
    code:11, stderr:'unrecognized option', stdout:'first|second|', writes:['%02d.ppm','000.ppm']
  })),
  {name:'reader inaccessible caption text stays literal before ordered failure',tool:'magick',args:['-font','/System/Library/Fonts/Supplemental/Arial.ttf','caption:@missing.txt','-write','first.ppm','-print','first|','-negate','+write','second.ppm','-print','second|','-unknown','out.ppm'],code:11,stderr:'unrecognized option',stdout:'first|second|',writes:['first.ppm','second.ppm']},
  {name:'descriptor geometry remains native after two ordered writes',tool:'magick',args:['red.ppm','-write','first.ppm','-print','first|','-negate','-write','second.ppm','-print','second|','-read','fd:missing','out.ppm'],stderr:'no decode delegate',stdout:'first|second|',writes:['first.ppm','second.ppm']},
  ...(['stream','magick'] as const).map(tool => ({
    name:`stream pixel map preserves ordered raw output before failure ${tool}`,tool,
    args:[...(tool === 'magick' ? ['stream'] : []),'-map','BGR','red.ppm','blue.ppm','missing.ppm','out.raw'],
    code:1,stderr:'missing.ppm',writes:['out.raw']
  })),
  {name:'failed advisory reader probes preserve ordered partial effects',tool:'magick',args:['PPM:red.ppm[0]','-write','first.ppm','-print','first|','-negate','+write','second.ppm','-print','second|','-unknown','out.ppm'],code:11,stderr:'unrecognized option',stdout:'first|second|',writes:['first.ppm','second.ppm']},
  {name:'legacy double dash identify reads both operands',tool:'identify',args:['-format','%f|','blue.ppm','--'],code:0,stdout:'blue.ppm|--|'},
  {name:'legacy double dash mogrify edits before failure',tool:'mogrify',args:['-negate','blue.ppm','--','--','missing.ppm'],code:1,stderr:'missing.ppm',writes:['--','blue.ppm']},
  {name:'legacy double dash convert reads after ordered writes',tool:'convert',args:['red.ppm','-write','first.ppm','-print','first|','-negate','-write','second.ppm','-print','second|','--','blue.ppm','out.ppm'],code:0,stdout:'first|second|',writes:['first.ppm','second.ppm','out.ppm']},
  {name:'synthetic coder destinations retain literal partial writes',tool:'magick',args:['red.ppm','-write','xc:first.ppm','-print','first|','-negate','-write','xc:second.ppm','-print','second|','-unknown','out.ppm'],code:11,stdout:'first|second|',stderr:'no encode delegate',writes:['xc:first.ppm','xc:second.ppm']},
  {name:'quote-leading wildcard after ordered writes stays a literal native read',tool:'magick',args:['red.ppm','-write','first.ppm','-print','first|','-negate','-write','second.ppm','-print','second|',"'*.ppm",'out.ppm'],code:1,stderr:"'*.ppm",stdout:'first|second|',writes:['first.ppm','second.ppm']},
  {name:'quote-leading identify wildcard stays a literal native read',tool:'identify',args:["'*.ppm"],code:1,stderr:"'*.ppm"},
  {name:'quote-leading mogrify wildcard stays a literal native read',tool:'mogrify',args:['-negate',"'*.ppm"],code:1,stderr:"'*.ppm"},
  {name:'quoted concatenate skips glob expansion and retains matching input',tool:'magick',args:['-concatenate',"'*.bin",'b.bin','out.bin'],stderr:"'*.bin",writes:['out.bin'],deleted:['b.bin']},
  {name:'MVG data bypasses accessible file after ordered writes',tool:'magick',args:['red.ppm','-write','first.ppm','-print','first|','-negate','-write','second.ppm','-print','second|','-draw',"image Over 0,0 1,1 'DATA:invalid'",'out.ppm'],code:1,stderr:'corrupt image',stdout:'first|second|',writes:['first.ppm','second.ppm']},
  {name:'inline file and embedded source before ordered failure',tool:'magick',args:['DATA:encoded.txt','-write','first.ppm','-print','first|','inline:'+inlineRed,'-negate','-write','second.ppm','-print','second|','-unknown','out.ppm'],code:11,stderr:'unrecognized option',stdout:'first|second|',writes:['first.ppm','second.ppm']},
  ...(['DATA:', 'DaTa:'] as const).map(scheme => ({name:`case-insensitive inline ${scheme} before ordered failure`,tool:'magick' as const,
    args:['INLINE:' + scheme + inlineRed.slice(5),'-write','first.ppm','-print','first|','-negate','+write','second.ppm','-print','second|','-unknown','out.ppm'],
    code:11,stderr:'unrecognized option',stdout:'first|second|',writes:['first.ppm','second.ppm']})),
  {name:'inline output validation after ordered writes',tool:'magick',args:['red.ppm','-write','first.ppm','-print','first|','-negate','+write','second.ppm','-print','second|','-write','DATA:out.txt','out.ppm'],code:1,stderr:'image type not supported',stdout:'first|second|',writes:['first.ppm','second.ppm']},
  {name:'inline valid outputs before ordered failure',tool:'magick',args:['red.png','-write','INLINE:first.ppm','-print','first|','-negate','+write','INLINE:second.ppm','-print','second|','-unknown','out.ppm'],code:11,stderr:'unrecognized option',stdout:'first|second|',writes:['first.ppm','second.ppm']},
  {name:'argv brace glob magick',tool:'magick',args:['{red,blue}.ppm','-append','out.ppm'],code:0,writes:['out.ppm']},
  {name:'argv brace glob identify',tool:'identify',args:['-format','%f|','{red,blue}.ppm'],code:0,stdout:'blue.ppm|red.ppm|'},
  {name:'argv brace glob mogrify',tool:'mogrify',args:['-negate','{red,blue}.ppm'],code:0},
  ...(['magick','convert'] as const).map(tool => ({name:`profile image reader ${tool} before ordered failure`,tool,
    args:['red.ppm','-profile','PPM:blue.ppm[0]','-write','first.ppm','-print','first|','-negate','-write','second.ppm','-print','second|','-profile','PPM:missing.ppm[0]','out.ppm'],
    code:1,stderr:'missing.ppm',stdout:'first|second|',writes:['first.ppm','second.ppm']})),
  {name:'profile image reader mogrify edits before failure',tool:'mogrify',args:['-profile','PPM:blue.ppm[0]','-negate','red.ppm','blue.ppm','missing.ppm'],code:1,stderr:'missing.ppm',writes:['red.ppm','blue.ppm']},
  {name:'observed directory script after ordered writes',tool:'magick-script',args:['directory.mg'],code:1,stdout:'first|second|',stderr:'xc:green',writes:['first.ppm','second.ppm']},
  {name:'observed directory list after ordered writes',tool:'magick',args:['red.ppm','-write','first.ppm','-print','first|','-negate','-write','second.ppm','-print','second|','@directory-list.txt','out.ppm'],code:1,stdout:'first|second|',stderr:'@directory-list.txt',writes:['first.ppm','second.ppm']},
  {name:'observed directory drawing after ordered writes',tool:'magick',args:['red.ppm','-write','first.ppm','-print','first|','-negate','-write','second.ppm','-print','second|','-draw','@directory.mvg','out.ppm'],code:1,stdout:'first|second|',stderr:'xc:green',writes:['first.ppm','second.ppm']},
  {name:'observed directory MSL after writes',tool:'conjure',args:['MSL:directory.msl'],code:1,stderr:'xc:green',writes:['first.ppm','second.ppm']},
  {name:'stat-visible colon directory after ordered writes',tool:'magick',args:['red.ppm','-write','first.ppm','-print','first|','-negate','-write','second.ppm','-print','second|','xc:green','out.ppm'],code:1,stdout:'first|second|',stderr:'xc:green',writes:['first.ppm','second.ppm']},
  {name:'original list spelling modern writes before failure',tool:'magick',args:['PPM:@palette.ppm','-write','first.ppm','-print','first|','@names[0]','-negate','-write','second.ppm','-print','second|','-unknown','out.ppm'],code:11,stdout:'first|second|',stderr:'unrecognized option',writes:['first.ppm','second.ppm']},
  {name:'original list spelling script writes before failure',tool:'magick-script',args:['list-spelling.mg'],code:11,stdout:'first|second|',stderr:'unrecognized option',writes:['first.ppm','second.ppm']},
  {name:'original list spelling identify reports before failure',tool:'identify',args:['-format','%f|','PPM:@palette.ppm','@names[0]','missing.ppm'],code:1,stdout:'@palette.ppm|red.ppm|',stderr:'missing.ppm'},
  {name:'original list spelling mogrify edits before failure',tool:'mogrify',args:['-negate','PPM:@palette.ppm','@names[0]','missing.ppm'],code:1,stderr:'missing.ppm',writes:['@palette.ppm','red.ppm']},
  ...(['magick', 'convert'] as const).map(tool => ({name:`map ${tool} cache read before ordered failure`,tool,
    args:['red.ppm','-write','first.ppm','-print','first|',...(tool === 'magick' ? ['-map','PPM:blue.ppm[0]'] : ['-negate']),'-write','second.ppm','-print','second|','-map',...(tool === 'magick' ? [] : ['PPM:blue.ppm[0]']),'missing.ppm','out.ppm'],
    code:1,stderr:'missing.ppm',stdout:'first|second|',writes:['first.ppm','second.ppm']})),
  ...(['@palette.ppm', '*.map.ppm'] as const).map(filename => ({name:`map literal cache filename ${filename}`,tool:'magick' as const,
    args:['red.ppm','-write','first.ppm','-print','first|','-map',filename,'-write','second.ppm','-print','second|','-unknown','out.ppm'],
    code:11,stderr:'unrecognized option',stdout:'first|second|',writes:['first.ppm','second.ppm']})),
  {name:'map script cache read before ordered failure',tool:'magick-script',args:['map.mg'],code:1,stderr:'missing.ppm',stdout:'first|second|',writes:['first.ppm','second.ppm']},
  {name:'map mogrify in-place edits before failure',tool:'mogrify',args:['-map','PPM:blue.ppm[0]','-negate','red.ppm','blue.ppm','missing.ppm'],code:1,stderr:'missing.ppm',writes:['red.ppm','blue.ppm']},
  {name:'observed literal script stdin before ordered failure',tool:'magick',args:['-script','literal-stdin.mg'],stdin:'hello',code:11,stdout:'hello|second|',stderr:'unrecognized option',writes:['first.ppm','second.ppm']},
  {name:'observed literal script before ordered failure',tool:'magick',args:['-script','literal.mg'],code:11,stdout:'first|second|',stderr:'unrecognized option',writes:['first.ppm','second.ppm']},
  {name:'observed literal list before ordered failure',tool:'magick',args:['@literal-list.txt','-write','first.ppm','-print','first|','-negate','-write','second.ppm','-print','second|','-unknown','out.ppm'],code:11,stdout:'first|second|',stderr:'unrecognized option',writes:['first.ppm','second.ppm']},
  {name:'observed literal MSL before read failure',tool:'conjure',args:['MSL:literal.msl'],code:1,stderr:'missing.ppm',writes:['first.ppm','second.ppm']},
  ...(['caption', 'comment', 'label'] as const).flatMap(property => (['magick', 'convert', 'mogrify'] as const).flatMap(tool => [
    {name:`deferred ${tool} ${property} accessible text before failure`,tool,
      args:tool === 'mogrify' ? [`-${property}`, ' \t@text.txt', '-negate', 'red.ppm', 'blue.ppm', 'missing.ppm']
        : [`-${property}`, ' \t@text.txt', 'red.ppm', '-write', 'first.ppm', '-print', `%[${property}]|`, '-negate', '-write', 'second.ppm', '-print', 'second|', 'missing.ppm', 'out.ppm'],
      code:1,stderr:'missing.ppm',writes:tool === 'mogrify' ? ['red.ppm','blue.ppm'] : ['first.ppm','second.ppm'],
      ...(tool === 'mogrify' ? {} : {stdout:'hello|second|'})},
    {name:`deferred ${tool} ${property} missing text stays literal`,tool,
      args:tool === 'mogrify' ? [`-${property}`, '@missing.txt', '-negate', 'red.ppm']
        : [`-${property}`, '@missing.txt', 'red.ppm', '-print', `%[${property}]|`, 'out.ppm'],
      code:0,writes:tool === 'mogrify' ? ['red.ppm'] : ['out.ppm'],
      ...(tool === 'mogrify' ? {} : {stdout:'@missing.txt|'})}
  ])),
  {name:'legacy annotate whitespace text before two ordered writes and failure',tool:'convert',args:['-font','/System/Library/Fonts/Supplemental/Arial.ttf','red.ppm','-annotate','0',' \t@text.txt','-write','first.ppm','-print','first|','-negate','-write','second.ppm','-print','second|','missing.ppm','out.ppm'],code:1,stdout:'first|second|',stderr:'missing.ppm',writes:['first.ppm','second.ppm']},
  {name:'legacy set whitespace text before two ordered writes and failure',tool:'convert',args:['red.ppm','-set','comment',' \n@text.txt','-write','first.ppm','-print','%[comment]|','-negate','-write','second.ppm','-print','second|','missing.ppm','out.ppm'],code:1,stdout:'hello|second|',stderr:'missing.ppm',writes:['first.ppm','second.ppm']},
  {name:'legacy set missing text remains literal',tool:'convert',args:['red.ppm','-set','comment','@missing.txt','-print','%[comment]|','out.ppm'],code:0,stdout:'@missing.txt|',writes:['out.ppm']},
  {name:'legacy mogrify whitespace text survives in-place processing before failure',tool:'mogrify',args:['-set','comment',' \t@text.txt','-negate','red.ppm','blue.ppm','missing.ppm'],code:1,stderr:'missing.ppm',writes:['red.ppm','blue.ppm']},
  {name:'legacy convert shared parameters suppress list expansion',tool:'convert',args:['+function','red.ppm','@list.txt','out.ppm'],code:1,stderr:'@list.txt'},
  {name:'legacy mogrify shared parameters suppress list expansion',tool:'mogrify',args:['+function','red.ppm','@list.txt'],code:1,stderr:'@list.txt'},
  {name:'legacy composite minus distort shared parameters suppress list expansion',tool:'composite',args:['-distort','1,0,0,1,0,0','@list.txt','blue.ppm','out.ppm'],code:1,stderr:'@list.txt'},
  {name:'legacy composite plus distort shared parameters suppress list expansion',tool:'composite',args:['+distort','@list.txt','blue.ppm','out.ppm'],code:1,stderr:'@list.txt'},
  {name:'legacy identify accessible option shadow still suppresses parameter expansion',tool:'identify',args:['-format','%f|','-resize','@list.txt'],code:1,stderr:'@list.txt',stdout:'-resize|'},
  {name:'legacy convert plus function retains following images',tool:'convert',args:['+function','red.ppm','blue.ppm','out.ppm'],code:0,stderr:'deprecated',writes:['out.ppm']},
  {name:'legacy mogrify plus function retains in-place inputs before failure',tool:'mogrify',args:['+function','-negate','red.ppm','blue.ppm','missing.ppm'],code:1,stderr:'missing.ppm',writes:['red.ppm','blue.ppm']},
  {name:'composite minus distort has one geometry operand',tool:'composite',args:['-distort','1,0,0,1,0,0','red.ppm','blue.ppm','out.ppm'],code:1,stderr:'unknown method'},
  {name:'composite plus distort has no operands',tool:'composite',args:['+distort','red.ppm','blue.ppm','out.ppm'],code:1,stderr:'unknown method'},
  {name:'magick subcommand dispatch',tool:'magick',args:['compare','-metric','AE','red.ppm','blue.ppm','out.ppm'],code:1,writes:['out.ppm']},
  {name:'literal colon overrides synthetic coder',tool:'magick',args:['xc:purple','out.ppm'],code:0,writes:['out.ppm']},
  {name:'coder stdout descriptor',tool:'magick',args:['red.ppm','PPM:-'],code:0},
  {name:'nested ordered groups',tool:'magick',args:['-size','2x1','(','xc:red','(','xc:blue','-resize','50%',')',')','+append','out.ppm'],code:0,writes:['out.ppm']},
  {name:'two writes before error',tool:'magick',args:['xc:red','-write','first.ppm','-print','first|','-negate','-write','second.ppm','-print','second|','-unknown','out.ppm'],code:11,stderr:'unrecognized option',stdout:'first|second|',writes:['first.ppm','second.ppm']},
  {name:'CDL strips at-sign but preserves literal brackets before ordered failure',tool:'magick',args:['red.ppm','-write','first.ppm','-print','first|','-cdl','@grade[0]','-negate','-write','second.ppm','-print','second|','-unknown','out.ppm'],code:11,stderr:'unrecognized option',stdout:'first|second|',writes:['first.ppm','second.ppm']},
  {name:'missing encipher passkey after two ordered writes',tool:'magick',args:['red.ppm','-write','first.ppm','-print','first|','-negate','-write','second.ppm','-print','second|','-encipher','@missing[0]','out.ppm'],code:1,stderr:'@missing[0]',stdout:'first|second|',writes:['first.ppm','second.ppm']},
  {name:'missing decipher passkey after two ordered writes',tool:'magick',args:['red.ppm','-write','first.ppm','-print','first|','-negate','-write','second.ppm','-print','second|','-decipher','%[missing]','out.ppm'],code:1,stderr:'%[missing]',stdout:'first|second|',writes:['first.ppm','second.ppm']},
  {name:'passkey filenames retain at-sign brackets and percent expressions',tool:'magick',args:['red.ppm','-encipher','@key[0]','-write','first.ppm','-print','encrypted|','-decipher','%[key]','-write','second.ppm','-print','decrypted|','-unknown','out.ppm'],code:11,stderr:'unrecognized option',stdout:'encrypted|decrypted|',writes:['first.ppm','second.ppm']},
  {name:'annotate indirect geometry and text before ordered failure',tool:'magick',args:['-font','/System/Library/Fonts/Supplemental/Arial.ttf','red.ppm','-write','first.ppm','-print','first|','-annotate',' \t@geometry.txt',' @text.txt','-negate','-write','second.ppm','-print','second|','-unknown','out.ppm'],code:11,stderr:'unrecognized option',stdout:'first|second|',writes:['first.ppm','second.ppm']},
  {name:'set indirect key and value before ordered failure',tool:'magick',args:['red.ppm','-write','first.ppm','-set',' @key.txt',' \n@value.txt','-print','%[comment]|','-negate','-write','second.ppm','-print','second|','-unknown','out.ppm'],code:11,stderr:'unrecognized option',stdout:'from-file|second|',writes:['first.ppm','second.ppm']},
  {name:'signed distort and function indirect operands',tool:'magick',args:['red.ppm','+distort',' @method.txt',' @points.txt','-function',' @function.txt',' @parameters.txt','out.ppm'],code:0,writes:['out.ppm']},
  {name:'inaccessible annotate geometry after write remains native error',tool:'magick',args:['red.ppm','-write','first.ppm','-annotate',' @missing.txt','hello','out.ppm'],code:1,stderr:'invalid argument',writes:['first.ppm']},
  {name:'print accessible text with whitespace between ordered writes',tool:'magick',args:['red.ppm','-write','first.ppm','-print',' \t@text.txt','-negate','-write','second.ppm','-print','|second|','-unknown','out.ppm'],code:11,stderr:'unrecognized option',stdout:'hello|second|',writes:['first.ppm','second.ppm']},
  {name:'print missing text stays literal after write',tool:'magick',args:['red.ppm','-write','first.ppm','-print',' \t@missing.txt','out.ppm'],code:0,stdout:'@missing.txt',writes:['first.ppm','out.ppm']},
  {name:'modern writes literal list and glob names before error',tool:'magick',args:['-define','png:exclude-chunks=date,time','red.ppm','-write','@first.ppm','-print','first|','-negate','+write','PNG:*.ppm','-print','second|','-unknown','@final.ppm'],code:11,stderr:'unrecognized option',stdout:'first|second|',writes:['@first.ppm','*.ppm']},
  {name:'modern implicit output literal list name',tool:'magick',args:['red.ppm','@final.ppm'],code:0,writes:['@final.ppm']},
  {name:'modern implicit output literal glob name',tool:'magick',args:['red.ppm','*.ppm'],code:0,writes:['*.ppm']},
  {name:'legacy explicit writes literal list and glob names',tool:'convert',args:['-define','png:exclude-chunks=date,time','red.ppm','-write','@first.ppm','-negate','+write','PNG:*.ppm','out.ppm'],code:0,stderr:'deprecated',writes:['@first.ppm','*.ppm','out.ppm']},
  {name:'same output write order',tool:'magick',args:['red.ppm','-write','first.ppm','-negate','-write','first.ppm','-write','second.ppm','-unknown','out.ppm'],code:11,writes:['first.ppm','second.ppm']},
  {name:'unbalanced after write',tool:'magick',args:['(','xc:red','-write','first.ppm','out.ppm'],code:1,stderr:'unbalanced',writes:['first.ppm']},
  {name:'literal bracket filename',tool:'magick',args:['-define','registry:filename:literal=true','PPM:literal[0]','out.ppm'],code:0,writes:['out.ppm']},
  {name:'remove registry literal after write',tool:'magick',args:['-define','registry:filename:literal=true','PPM:literal[0]','-write','first.ppm','+define','registry:filename:literal','PPM:literal[0]','out.ppm'],code:1,stderr:'literal',writes:['first.ppm']},
  {name:'set registry literal and remove after write',tool:'magick',args:['-set','registry:filename:literal','true','PPM:literal[0]','-write','first.ppm','+set','registry:filename:literal','PPM:literal[0]','out.ppm'],code:1,stderr:'literal',writes:['first.ppm']},
  {name:'fill and stroke image patterns',tool:'magick',args:['red.ppm','-fill','PPM:blue.ppm[0]','-stroke','red.ppm','-draw','rectangle 0,0 1,0','out.ppm'],code:0,writes:['out.ppm']},
  {name:'missing fill after early write',tool:'magick',args:['red.ppm','-write','first.ppm','-fill','missing.ppm','out.ppm'],code:1,stderr:'missing.ppm',writes:['first.ppm']},
  ...(['-read-mask', '-remap', '-fill', '-stroke'] as const).flatMap(option => ['@list.txt', '*.ppm'].map(filename => ({
    name:`cache reader ${option} literal ${filename} after ordered writes`, tool:'magick' as const,
    args:['red.ppm','-write','first.ppm','-print','first|','-negate','+write','second.ppm','-print','second|',option,filename,'out.ppm'],
    code:1, stderr:filename === '@list.txt' && (option === '-fill' || option === '-stroke') ? 'no decode delegate' : filename, stdout:'first|second|', writes:['first.ppm','second.ppm']
  }))),
  ...(['-fill', '-stroke', '-resize'] as const).map(option => ({
    name:`general property ${option} text replacement before ordered failure`, tool:'magick' as const,
    args:['red.ppm','-write','first.ppm','-print','first|',option,option === '-resize' ? '@resize.txt' : '@paint.txt',
      ...(option === '-resize' ? [] : ['-draw','rectangle 0,0 1,0']),
      '-write','second.ppm','-print','second|','-unknown','out.ppm'],
    code:11, stderr:'unrecognized option', stdout:'first|second|', writes:['first.ppm','second.ppm']
  })),
  {name:'coder selector',tool:'magick',args:['PPM:red.ppm[0]','out.ppm'],code:0,writes:['out.ppm']},
  {name:'text indirection font',tool:'magick',args:['-font','/System/Library/Fonts/Supplemental/Arial.ttf','caption:@text.txt','out.ppm'],code:0,writes:['out.ppm']},
  {name:'FreeType explicit face before ordered font failure',tool:'magick',args:['-font','@/System/Library/Fonts/Supplemental/Arial.ttf[0]','caption:@text.txt','-write','first.ppm','-print','first|','-negate','-write','second.ppm','-print','second|','-font','@missing[0]','caption:hello','out.ppm'],code:1,stderr:'missing',stdout:'first|second|',writes:['first.ppm','second.ppm']},
  {name:'caption whitespace text indirection after ordered writes',tool:'magick',args:['-font','/System/Library/Fonts/Supplemental/Arial.ttf','red.ppm','-write','first.ppm','-print','first|','+delete','caption: \t@text.txt','-print','%[caption]|','-write','second.ppm','-unknown','out.ppm'],code:11,stdout:'first|hello|',stderr:'unrecognized option',writes:['first.ppm','second.ppm']},
  {name:'caption missing text remains literal',tool:'magick',args:['-font','/System/Library/Fonts/Supplemental/Arial.ttf','caption: \t@missing.txt','-print','%[caption]|','out.ppm'],code:0,stdout:'@missing.txt|',writes:['out.ppm']},
  {name:'caption reads text created by an earlier native write',tool:'magick',args:['-font','/System/Library/Fonts/Supplemental/Arial.ttf','red.ppm','-format','created-at-runtime','-write','info:created.txt','+delete','caption: \t@created.txt','-print','%[caption]|','out.ppm'],code:0,stdout:'created-at-runtime|',writes:['created.txt','out.ppm']},
  {name:'label whitespace text indirection',tool:'magick',args:['-font','/System/Library/Fonts/Supplemental/Arial.ttf','label: \t@text.txt','-print','%[label]|','out.ppm'],code:0,stdout:'hello|',writes:['out.ppm']},
  {name:'label missing text remains literal',tool:'magick',args:['-font','/System/Library/Fonts/Supplemental/Arial.ttf','label: \t@missing.txt','-print','%[label]|','out.ppm'],code:0,stdout:'@missing.txt|',writes:['out.ppm']},
  {name:'font property expression',tool:'magick',args:['red.ppm','-set','filename:font','/System/Library/Fonts/Supplemental/Arial.ttf','-font','%[filename:font]','caption:@text.txt','out.ppm'],code:0,writes:['out.ppm']},
  {name:'missing profile after write',tool:'magick',args:['red.ppm','-write','first.ppm','-profile','missing.icc','out.ppm'],code:1,stderr:'missing.icc',writes:['first.ppm']},
  {name:'set missing profile after write',tool:'magick',args:['red.ppm','-write','first.ppm','-set','profile','missing.icc','out.ppm'],code:1,stderr:'missing.icc',writes:['first.ppm']},
  {name:'registers',tool:'magick',args:['red.ppm','-write','mpr:r','+delete','mpr:r','out.ppm'],code:0,writes:['out.ppm']},
  {name:'filename list',tool:'magick',args:['@list.txt','+append','out.ppm'],code:0,writes:['out.ppm']},
  {name:'script late option error',tool:'magick',args:['-script','script.mg','ignored.ppm'],code:11,stderr:'unrecognized option',stdout:'before-error',writes:['first.ppm','second.ppm']},
  {name:'script late quote error',tool:'magick-script',args:['late.mg'],code:11,stderr:'quote',writes:['first.ppm']},
  {name:'script EOF',tool:'magick-script',args:['good.mg'],code:0,writes:['first.ppm']},
  {name:'script nested special option fails after two ordered writes',tool:'magick-script',args:['nested.mg'],code:1,stderr:'invalid use of option',stdout:'first|second|',writes:['first.ppm','second.ppm']},
  {name:'script literal brackets',tool:'magick-script',args:['task[0]'],code:0,writes:['first.ppm']},
  {name:'script literal coder-like filename',tool:'magick',args:['-script','caption:@task'],code:0,writes:['first.ppm']},
  {name:'script literal list-like filename',tool:'magick',args:['-script','@task'],code:0,writes:['first.ppm']},
  {name:'script stdin',tool:'magick-script',args:['-'],stdin:'xc:red -write first.ppm',code:0,writes:['first.ppm']},
  {name:'script quoted continuation',tool:'magick-script',args:['continued.mg'],code:0,stdout:'ab',writes:['first.ppm']},
  {name:'script CRLF native print interpretation',tool:'magick-script',args:['crlf.mg'],code:0,stdout:'a\nb'},
  {name:'script binary failure after write',tool:'magick-script',args:['binary.mg'],code:11,stderr:'binary',writes:['first.ppm']},
  {name:'concatenate deletes inputs',tool:'magick',args:['-concatenate','a.bin','b.bin','out.bin'],code:0,writes:['out.bin'],deleted:['a.bin','b.bin']},
  {name:'concatenate no inputs creates empty output',tool:'magick',args:['-concatenate','out.bin'],code:0},
  {name:'concatenate expands glob',tool:'magick',args:['-concatenate','*.bin','out.bin'],code:0,writes:['out.bin'],deleted:['a.bin','b.bin']},
  ...(['magick','convert'] as const).flatMap(tool => ['[ab].bin','{a,b}.bin'].map(pattern => ({
    name:`concatenate grouped glob ${tool} ${pattern}`,tool,args:['-concatenate',pattern,'out.bin'],code:0,writes:['out.bin'],deleted:['a.bin','b.bin']
  }))),
  {name:'concatenate expands list',tool:'magick',args:['-concatenate','@bins.txt','out.bin'],code:0,writes:['out.bin'],deleted:['a.bin','b.bin']},
  {name:'concatenate filters mixed directory list before input deletions',tool:'magick',args:['-concatenate','@mixed-directory-list.txt','out.bin'],code:0,writes:['out.bin'],deleted:['a.bin','b.bin']},
  {name:'directory-only concatenate list keeps literal operand and empty partial output',tool:'magick',args:['-concatenate','@directory-list.txt','out.bin'],code:1,stderr:'@directory-list.txt'},
  {name:'concatenate final list chooses last output and deletes earlier member',tool:'magick',args:['-concatenate','a.bin','@destinations.txt'],code:0,writes:['out.bin'],deleted:['a.bin','b.bin']},
  {name:'concatenate final list preserves partial effects despite missing input',tool:'magick',args:['-concatenate','missing.bin','a.bin','@destinations.txt'],stderr:'missing.bin',writes:['out.bin'],deleted:['a.bin','b.bin']},
  {name:'concatenate preliminary option parameter stays literal',tool:'magick',args:['-concatenate','-read','@literal','out.bin'],code:0,writes:['out.bin'],deleted:['-read','@literal']},
  {name:'concatenate repeated lists retain earlier bytes and later missing-file diagnostics',tool:'magick',args:['-concatenate','@bins.txt','@bins.txt','out.bin'],stderr:'a.bin',writes:['out.bin'],deleted:['a.bin','b.bin']},
  {name:'raw concatenate missing final list retains literal output',tool:'magick',args:['-concatenate','a.bin','@missing.txt'],code:0,writes:['@missing.txt'],deleted:['a.bin']},
  {name:'raw concatenate empty final list retains literal output',tool:'magick',args:['-concatenate','a.bin','@empty.txt'],code:0,writes:['@empty.txt'],deleted:['a.bin']},
  {name:'concatenate missing middle',tool:'magick',args:['-concatenate','a.bin','missing.bin','b.bin','out.bin'],stderr:'missing.bin',writes:['out.bin'],deleted:['a.bin','b.bin']},
  {name:'concatenate deprecated alias deletes raw inputs',tool:'convert',args:['-concatenate','a.bin','b.bin','out.bin'],code:0,stderr:'deprecated',writes:['out.bin'],deleted:['a.bin','b.bin']},
  {name:'concatenate deprecated subcommand deletes inputs despite missing middle',tool:'magick',args:['convert','-concatenate','a.bin','missing.bin','b.bin','out.bin'],stderr:'missing.bin',writes:['out.bin'],deleted:['a.bin','b.bin']},
  {name:'concatenate deprecated alias expands list',tool:'convert',args:['-concatenate','@bins.txt','out.bin'],code:0,writes:['out.bin'],deleted:['a.bin','b.bin']},
  {name:'concatenate deprecated alias final list chooses output',tool:'convert',args:['-concatenate','a.bin','@destinations.txt'],code:0,stderr:'deprecated',writes:['out.bin'],deleted:['a.bin','b.bin']},
  {name:'build helper filename remains magick image operand',tool:'magick',args:['MagickCore-config','out.ppm'],code:0,writes:['out.ppm']},
  {name:'scene-stripped colon file before ordered failure',tool:'magick',args:['xc:purple[0]','-write','first.ppm','-print','first|','-negate','-write','second.ppm','-print','second|','-unknown','out.ppm'],code:11,stderr:'unrecognized option',stdout:'first|second|',writes:['first.ppm','second.ppm']},
  {name:'scene-stripped synthetic source before ordered failure',tool:'magick',args:['xc:red[0]','-write','first.ppm','-print','first|','-negate','-write','second.ppm','-print','second|','-unknown','out.ppm'],code:11,stderr:'unrecognized option',stdout:'first|second|',writes:['first.ppm','second.ppm']},
  {name:'scene-stripped literal registry retains filename before ordered failure',tool:'magick',args:['-define','registry:filename:literal=true','xc:red[0]','-write','first.ppm','-print','first|','-negate','-write','second.ppm','-print','second|','-unknown','out.ppm'],code:11,stderr:'unrecognized option',stdout:'first|second|',writes:['first.ppm','second.ppm']},
  {name:'concatenate deprecated alias no inputs creates empty output',tool:'convert',args:['-concatenate','out.bin'],code:0},
  {name:'identify reports before failure',tool:'identify',args:['-format','%f %m %wx%h\\n','red.ppm','missing.ppm'],code:1,stdout:'red.ppm PPM 2x1',stderr:'missing.ppm'},
  {name:'modern list query',tool:'magick',args:['-list','format'],code:0,stdout:'Format'},
  {name:'modern final parenthesis filename',tool:'magick',args:['red.ppm',')'],code:0,writes:[')']},
  {name:'legacy convert final parenthesis filename',tool:'convert',args:['red.ppm',')'],code:0,writes:[')']},
  {name:'legacy compare final parenthesis filename',tool:'compare',args:['red.ppm','red.ppm',')'],code:0,writes:[')']},
  {name:'legacy composite final parenthesis filename',tool:'composite',args:['red.ppm','blue.ppm',')'],code:0,writes:[')']},
  {name:'legacy montage final parenthesis filename',tool:'montage',args:['-font','/System/Library/Fonts/Supplemental/Arial.ttf','red.ppm',')'],code:0,writes:[')']},
  {name:'legacy stream final parenthesis filename',tool:'stream',args:['red.ppm',')'],code:0,writes:[')']},
  {name:'legacy accessible option filename',tool:'identify',args:['-format','%f %m %wx%h\\n','-resize'],code:0,stdout:'-resize PPM 2x1'},
  {name:'modern known option before accessible filename',tool:'magick',args:['-resize','red.ppm','out.ppm'],code:1,stderr:'no images found'},
  {name:'mogrify partial in place',tool:'mogrify',args:['-negate','red.ppm','missing.ppm'],code:1,stderr:'missing.ppm',writes:['red.ppm']},
  {name:'compare equal',tool:'compare',args:['-metric','AE','red.ppm','red.ppm','out.ppm'],code:0,stderr:'0',writes:['out.ppm']},
  {name:'compare different',tool:'compare',args:['-metric','AE','red.ppm','blue.ppm','out.ppm'],code:1,stderr:'1.33333',writes:['out.ppm']},
  {name:'compare error',tool:'compare',args:['red.ppm','missing.ppm','out.ppm'],code:2,stderr:'missing.ppm'},
  {name:'montage explicit font',tool:'montage',args:['-font','/System/Library/Fonts/Supplemental/Arial.ttf','red.ppm','blue.ppm','out.ppm'],code:0,writes:['out.ppm']},
  {name:'composite',tool:'composite',args:['red.ppm','blue.ppm','out.ppm'],code:0,writes:['out.ppm']},
  {name:'convert deprecated dispatch',tool:'convert',args:['red.ppm','out.ppm'],code:0,stderr:'deprecated',writes:['out.ppm']},
  {name:'stream raw output',tool:'stream',args:['red.ppm','out.raw'],code:0,writes:['out.raw']},
  {name:'conjure MSL',tool:'conjure',args:['MSL:script.msl'],code:1,writes:['msl.ppm']},
  {name:'conjure MSL writes before read failure',tool:'conjure',args:['MSL:partial.msl'],code:1,stderr:'missing.ppm',writes:['first.ppm','second.ppm']},
  {name:'conjure subcommand MSL writes before read failure',tool:'magick',args:['conjure','MSL:partial.msl'],code:1,stderr:'missing.ppm',writes:['first.ppm','second.ppm']},
];
for (const command of ['identify', 'compare', 'montage', 'composite'] as const) {
  for (const subcommand of [false, true]) {
    for (const available of [true, false]) {
      cases.push({
        name:`legacy format ${command} ${subcommand ? 'subcommand' : 'alias'} ${available ? 'accessible' : 'missing'} text`,
        tool:subcommand ? 'magick' : command,
        args:[...(subcommand ? [command] : []), ...(command === 'montage' ? ['-font', '/System/Library/Fonts/Supplemental/Arial.ttf'] : []),
          '-format', available ? command === 'montage' || command === 'composite' ? '@text.txt' : ' \t@text.txt' : '@missing.txt', 'red.ppm', 'blue.ppm', ...(command === 'identify' ? ['missing.ppm'] : ['out.ppm'])],
        code:command === 'identify' || command === 'compare' ? 1 : 0,
        ...(command === 'identify' ? {stderr:'missing.ppm', stdout:available ? 'hellohello' : '@missing.txt@missing.txt'}
          : command === 'compare' ? {stdout:available ? 'hello' : '@missing.txt'} : {}),
        ...(command === 'identify' ? {} : {writes:['out.ppm']}),
      });
    }
  }
}
for (const filename of ['%02d.ppm', '%[filename:name].ppm']) cases.push({
  name:'literal-registry percent filename ' + filename, tool:'magick',
  args:['-define','registry:filename:literal=true','(','(',filename,')',')','-write','PPM:first' + filename,'-print','first|','-negate','+write','PPM:second' + filename,'-print','second|','-unknown','out.ppm'],
  code:11, stdout:'first|second|', stderr:'unrecognized option', writes:['first' + filename,'second' + filename]
});
for (const coder of ['caption', 'label'] as const) for (const literal of [false, true]) {
  const content = coder === 'label' && !literal ? 'hello' : 'bracket';
  cases.push({
    name:`text reader selector ${coder} ${literal ? 'literal' : 'canonical'} before ordered failure`, tool:'magick',
    args:['-font','/System/Library/Fonts/Supplemental/Arial.ttf', ...(literal ? ['-define','registry:filename:literal=true'] : []),
      `${coder}:@text.txt[0]`, '-write','first.ppm','-print',`%[${coder}]|`, '-negate','+write','second.ppm','-print','second|','-unknown','out.ppm'],
    code:11, stdout:content + '|second|', stderr:'unrecognized option', writes:['first.ppm','second.ppm']
  });
}
it.each(cases)('pinned native: $name', async c => {
  const quoted = c.name.startsWith('quote-leading') || c.name.startsWith('quoted concatenate');
  await reset(quoted);
  const context = {cwd,env,stdin:c.stdin ? b(c.stdin) : new Uint8Array()};
  const argv = c.args.map(b);
  const native = await runNative(imageMagickReference.executables[c.tool].path, argv, context);
  const expected = await effects();
  if (c.name.includes('retains ') && c.name.endsWith('after ordered writes')) {
    expect(text(native.stdout)).toBe('first|second|');
    expect(expected['first.ppm']).not.toBe(expected['second.ppm']);
    if (c.tool === 'magick') expect(expected).not.toHaveProperty('out.ppm');
    else expect(expected['out.ppm']).toBe(expected['second.ppm']);
  }
  if (c.name.startsWith('reserved final output after missing ')) {
    expect(expected['first.ppm']).not.toBe(expected['second.ppm']);
    expect(expected).not.toHaveProperty('out.ppm');
    expect(text(native.stdout)).toBe('first|second|');
    expect(text(native.stderr)).toContain(c.args.at(-2));
  }
  if (c.name.startsWith('legacy literal percent font') && c.stdout) {
    expect(text(native.stdout)).toBe(c.stdout);
    expect(expected['first.ppm']).not.toBe(expected['second.ppm']);
    expect(expected['out.ppm']).toBe(expected['second.ppm']);
  }
  if (c.name === 'literal coder brackets preserve ordered partial writes') {
    expect(expected['first.ppm[0]']).not.toBe(expected['second.ppm[1]']);
    expect(expected).not.toHaveProperty('out.ppm[2]');
    expect(expected).not.toHaveProperty('first.ppm');
    expect(expected).not.toHaveProperty('second.ppm');
  }
  if (c.name.startsWith('script-alias subcommand mogrify')) {
    expect(expected['red.ppm']).not.toBe(Buffer.from(red).toString('base64'));
    expect(expected['blue.ppm']).not.toBe(Buffer.from(blue).toString('base64'));
  }
  if (c.name.startsWith('script-alias subcommand convert')) expect(expected['first.ppm']).not.toBe(expected['second.ppm']);
  if (c.name.includes('set profile read after ordered writes')) {
    expect(native.exitCode).toBe(1);
    if (c.tool === 'convert') {
      expect(expected['first.ppm']).not.toBe(expected['second.ppm']);
      expect(expected['out.ppm']).toBe(expected['second.ppm']);
    } else {
      // Mogrify defers explicit writes until its pending operations finish.
      expect(expected['first.ppm']).toBe(Buffer.from('P6\n2 1\n255\n\x00\xff\xff\x00\xff\xff', 'latin1').toString('base64'));
      expect(expected['second.ppm']).toBe(expected['first.ppm']);
      expect(expected['red.ppm']).toBe(Buffer.from(red).toString('base64'));
    }
  }
  if (c.name.startsWith('text reader selector ')) {
    expect(expected['first.ppm']).not.toBe(expected['second.ppm']);
    expect(expected).not.toHaveProperty('out.ppm');
    expect(text(native.stdout)).toBe(c.stdout);
  }
  if (c.name === 'descriptor geometry remains native after two ordered writes') {
    expect(native.exitCode).not.toBe(0);
    expect(expected['first.ppm']).not.toBe(expected['second.ppm']);
    expect(expected).not.toHaveProperty('out.ppm');
  }
  if (c.code !== undefined) expect(native.exitCode, text(native.stderr)).toBe(c.code);
  if (c.name.startsWith('stream pixel map')) {
    expect(native.stdout).toBe('');
    expect(Buffer.from(expected['out.raw'], 'base64')).toEqual(Buffer.from([
      0,0,255,0,0,255,255,0,0,255,0,0
    ]));
  }
  if (c.name.startsWith('quote-leading') || c.name.startsWith('quoted concatenate')) {
    expect(text(expected["'red.ppm"])).toBe(red);
    expect(text(expected["'a.bin"])).toBe('a');
    if (c.name.includes('ordered writes')) {
      expect(text(native.stdout)).toBe('first|second|');
      expect(expected['first.ppm']).not.toBe(expected['second.ppm']);
      expect(expected).not.toHaveProperty('out.ppm');
    }
    if (c.name.startsWith('quoted concatenate')) expect(text(expected['out.bin'])).toBe('b');
  }
  if (c.name.startsWith('profile image reader')) {
    if (c.tool === 'mogrify') {
      expect(text(expected['red.ppm'])).not.toBe(red);
      expect(text(expected['blue.ppm'])).not.toBe(blue);
    } else {
      expect(text(native.stdout)).toBe('first|second|');
      expect(expected['first.ppm']).not.toBe(expected['second.ppm']);
    }
  }
  if (c.name.startsWith('deferred ')) {
    if (c.tool === 'mogrify') {
      expect(text(expected['red.ppm'])).not.toBe(red);
      if (c.name.includes('before failure')) expect(text(expected['blue.ppm'])).not.toBe(blue);
    } else {
      expect(text(native.stdout)).toBe(c.stdout);
      if (c.name.includes('before failure')) expect(expected['first.ppm']).not.toBe(expected['second.ppm']);
    }
  }
  if (c.name.startsWith('map ')) {
    if (c.tool === 'mogrify') {
      expect(text(expected['red.ppm'])).not.toBe(red);
      expect(text(expected['blue.ppm'])).not.toBe(blue);
    } else {
      expect(text(native.stdout)).toBe(c.stdout);
      expect(expected['first.ppm']).not.toBe(expected['second.ppm']);
      const probe = await runNative(imageMagickReference.executables.identify.path, ['-format','%[pixel:p{0,0}]',c.tool === 'convert' ? 'out.ppm' : 'second.ppm'].map(b), context);
      expect(text(probe.stdout)).toContain('0,0,255');
    }
  }
  if (c.stderr) expect(text(native.stderr).toLowerCase()).toContain(c.stderr);
  if (c.stdout) expect(text(native.stdout)).toContain(c.stdout);
  for (const name of c.writes ?? []) expect(expected[name]?.length).toBeGreaterThan(0);
  for (const name of c.deleted ?? []) expect(expected).not.toHaveProperty(name);
  if (c.name.startsWith('original list spelling')) {
    if (c.tool === 'magick' || c.tool === 'magick-script') {
      expect(text(native.stdout)).toBe('first|second|');
      expect(expected['first.ppm']).not.toBe(expected['second.ppm']);
      expect(expected).not.toHaveProperty('out.ppm');
    }
    if (c.tool === 'mogrify') {
      expect(text(expected['@palette.ppm'])).not.toBe(blue);
      expect(text(expected['red.ppm'])).not.toBe(red);
      expect(text(expected['blue.ppm'])).toBe(blue);
    }
  }
  if (c.name === 'literal colon overrides synthetic coder') {
    const probe = await runNative(imageMagickReference.executables.identify.path, ['-format','%[pixel:p{0,0}]','out.ppm'].map(b), context);
    expect(text(probe.stdout)).toContain('255,0,0');
  }
  if (c.name.startsWith('scene-stripped')) {
    expect(text(native.stdout)).toBe('first|second|');
    expect(expected['first.ppm']).not.toBe(expected['second.ppm']);
    expect(expected).not.toHaveProperty('out.ppm');
    const probe = await runNative(imageMagickReference.executables.identify.path, ['-format','%[pixel:p{0,0}]','first.ppm'].map(b), context);
    expect(text(probe.stdout)).toContain(c.name.includes('literal registry') ? '0,0,255' : '255,0,0');
  }
  if (c.name === 'coder stdout descriptor') expect(text(native.stdout).startsWith('P6')).toBe(true);
  if (c.name.startsWith('concatenate')) expect(text(expected['out.bin'])).toBe(c.name.includes('option parameter') ? 'optionliteral' : c.args.length - (c.args[0] === 'convert' ? 1 : 0) === 2 ? '' : 'ab');
  if (c.name.startsWith('raw concatenate')) expect(text(expected[c.args.at(-1)!])).toBe('a');
  if (c.name === 'two writes before error') expect(expected['first.ppm']).not.toBe(expected['second.ppm']);
  if (c.name === 'directory-only concatenate list keeps literal operand and empty partial output') {
    expect(expected['out.bin']).toBe('');
    expect(text(expected['a.bin'])).toBe('a');
    expect(text(expected['b.bin'])).toBe('b');
  }
  if (c.name.startsWith('cache reader') || c.name.startsWith('general property')) {
    expect(text(native.stdout)).toBe(c.stdout);
    expect(expected['first.ppm']).not.toBe(expected['second.ppm']);
    expect(expected).not.toHaveProperty('out.ppm');
  }
  if (c.name === 'FreeType explicit face before ordered font failure') {
    expect(text(native.stdout)).toBe(c.stdout);
    expect(expected['first.ppm']).not.toBe(expected['second.ppm']);
    expect(expected).not.toHaveProperty('out.ppm');
  }
  if (c.name.includes('passkey') || c.name.startsWith('CDL')) {
    expect(text(native.stdout)).toBe(c.stdout);
    expect(expected['first.ppm']).not.toBe(expected['second.ppm']);
    expect(expected).not.toHaveProperty('out.ppm');
  }
  if (c.name.includes('MSL writes before read failure')) expect(expected['first.ppm']).not.toBe(expected['second.ppm']);
  if (c.name === 'annotate indirect geometry and text before ordered failure' || c.name === 'set indirect key and value before ordered failure') {
    expect(expected['first.ppm']).not.toBe(expected['second.ppm']);
    expect(expected).not.toHaveProperty('out.ppm');
    expect(text(native.stdout)).toBe(c.stdout);
  }
  if (c.name === 'inaccessible annotate geometry after write remains native error') expect(expected).not.toHaveProperty('out.ppm');
  if (c.name === 'print accessible text with whitespace between ordered writes') {
    expect(expected['first.ppm']).not.toBe(expected['second.ppm']);
    expect(expected).not.toHaveProperty('out.ppm');
    expect(text(native.stdout)).toBe('hello|second|');
  }
  if (c.name === 'caption whitespace text indirection after ordered writes') {
    expect(text(native.stdout)).toBe('first|hello|');
    expect(expected['first.ppm']).not.toBe(expected['second.ppm']);
    expect(expected).not.toHaveProperty('out.ppm');
  }
  if (c.name === 'modern writes literal list and glob names before error') {
    expect(expected['@first.ppm']).not.toBe(expected['*.ppm']);
    expect(expected).not.toHaveProperty('@final.ppm');
  }
  if (c.name === 'same output write order') expect(expected['first.ppm']).toBe(expected['second.ppm']);
  if (c.name === 'mogrify partial in place') expect(text(expected['red.ppm'])).not.toBe(red);
  if (c.name === 'argv brace glob mogrify') {
    expect(text(expected['red.ppm'])).not.toBe(red);
    expect(text(expected['blue.ppm'])).not.toBe(blue);
  }
  if (c.name.includes('legacy mogrify whitespace text')) {
    expect(text(expected['red.ppm'])).not.toBe(red);
    expect(text(expected['blue.ppm'])).not.toBe(blue);
  }
  if (c.name.startsWith('legacy annotate whitespace') || c.name.startsWith('legacy set whitespace')) {
    expect(text(native.stdout)).toBe(c.stdout);
    expect(expected['first.ppm']).not.toBe(expected['second.ppm']);
    // Legacy convert continues after this read error and writes its final image
    // despite returning failure. Preserve that observed effect as well.
    expect(expected['out.ppm']).toBe(expected['second.ppm']);
  }
  if (c.name === 'legacy mogrify plus function retains in-place inputs before failure') {
    expect(text(expected['red.ppm'])).not.toBe(red);
    expect(text(expected['blue.ppm'])).not.toBe(blue);
    expect(expected).not.toHaveProperty('missing.ppm');
  }
  if (c.name.startsWith('script')) expect(expected).not.toHaveProperty('ignored.ppm');
  if (c.name.includes('nested special option')) {
    expect(text(native.stdout)).toBe('first|second|');
    expect(expected['first.ppm']).not.toBe(expected['second.ppm']);
    expect(expected).not.toHaveProperty('out.ppm');
  }
  await reset(quoted);
  let observed: Awaited<ReturnType<typeof runNative>> | undefined;
  const shims = createImageMagickShims<typeof context>({
    build:imageMagickReference.id,grammarRevision:imageMagickGrammarRevision,argv:'bytes',lateAccess:'complete',effects:'live',
    discoveryContext: ctx => {
      // Preserve byte paths and kernel traversal, including symlink-sensitive .. .
      const nativePath = (path: Uint8Array) => path[0] === 47 ? Buffer.from(path) : Buffer.concat([Buffer.from(ctx.cwd + '/'), path]);
      return {
        exists: async path => { try { await stat(nativePath(path)); return true; } catch { return false; } },
        isDirectory: async path => { try { return (await stat(nativePath(path))).isDirectory(); } catch { return false; } },
        accessible: async path => {
          if (path.length === 1 && path[0] === 45) return true;
          try {
            const name = nativePath(path);
            if (!(await stat(name)).isFile()) return false;
            await access(name);
            return true;
          } catch { return false; }
        },
        read: async path => readFile(nativePath(path))
      };
    },
    async run(request) {
      if (c.name === 'concatenate filters mixed directory list before input deletions' || c.name === 'directory-only concatenate list keeps literal operand and empty partial output') {
        expect(request.argv).toEqual(argv);
        expect(request.discovery.resources.filter(r => r.access === 'read-delete').map(r => Buffer.from(r.path!).toString())).toEqual(
          c.code === 0 ? ['a.bin', 'b.bin'] : ['@directory-list.txt']
        );
        expect(request.discovery.resources.find(r => r.access === 'write')?.path).toEqual(b('out.bin'));
        expect((await stat(join(cwd, 'xc:green'))).isDirectory()).toBe(true);
      }
      if (c.name.startsWith('reserved final output after missing ')) {
        expect(request.argv).toEqual(argv);
        expect(request.discovery.tokens.find(token => token.index === argv.length - 2)?.values).toEqual([]);
        expect(request.discovery.resources.filter(resource => Buffer.from(resource.operand).toString() === 'out.ppm')).toMatchObject([
          {index:argv.length - 1,access:'write',role:'image',kind:'path'}
        ]);
      }
      if (c.name === 'modern set-profile opens literal percent filename before property interpretation') {
        expect(request.argv).toEqual(argv);
        expect(request.discovery.resources.filter(r => r.role === 'profile')).toMatchObject([
          {operand:b('%[filename:name].ppm'),path:b('%[filename:name].ppm'),kind:'path',access:'read'}
        ]);
        expect(text(native.stderr)).not.toContain('unable to read blob');
        expect(expected['first.ppm']).not.toBe(expected['second.ppm']);
      }
      if (c.name === 'legacy indirect set-profile name preserves ordered partial writes') {
        expect(request.argv).toEqual(argv);
        expect(request.discovery.resources.find(r => r.role === 'profile')).toMatchObject({kind:'dynamic',access:'read'});
        expect(request.discovery.resources.find(r => r.role === 'profile')!.path).toBeUndefined();
        expect(request.discovery.resources.find(r => r.role === 'text')).toMatchObject({path:b('profile-name.txt'),access:'read'});
        expect(text(native.stderr)).not.toContain('unable to read blob');
        expect(expected['first.ppm']).not.toBe(expected['second.ppm']);
      }
      if (c.name === 'indirect set-profile name preserves ordered partial writes') {
        expect(request.argv).toEqual(argv);
        expect(request.discovery.resources.filter(r => r.role === 'profile')).toMatchObject([
          {operand:b(' \t@profile-name.txt'),path:b(' \t@profile-name.txt'),kind:'path',access:'read'}
        ]);
        expect(request.discovery.resources.find(r => r.role === 'text')).toMatchObject({path:b('profile-name.txt'),access:'read'});
        expect(expected['first.ppm']).not.toBe(expected['second.ppm']);
        expect(expected).not.toHaveProperty('out.ppm');
        expect(text(native.stderr)).not.toContain('unable to open');
      }
      if (c.name.startsWith('normalized ') && c.name.includes('set-profile')) {
        expect(request.argv).toEqual(argv);
        expect(request.discovery.resources.filter(r => r.role === 'profile')).toMatchObject([
          {operand:b('PPM:text.txt[0]'),path:b('text.txt'),selector:true,kind:'path',access:'read'},
          {operand:b('PPM:missing.icc[0]'),path:b('missing.icc'),selector:true,kind:'path',access:'read'}
        ]);
        expect(text(native.stderr)).not.toContain('PPM:text.txt[0]');
        expect(text(native.stderr)).not.toContain('missing.icc[0]');
        if (c.tool === 'mogrify') expect(expected['first.ppm']).toBe(expected['second.ppm']);
        else expect(expected['first.ppm']).not.toBe(expected['second.ppm']);
      }
      if (c.name.startsWith('legacy literal percent font') && c.stdout) {
    expect(text(native.stdout)).toBe(c.stdout);
    expect(expected['first.ppm']).not.toBe(expected['second.ppm']);
    expect(expected['out.ppm']).toBe(expected['second.ppm']);
  }
  if (c.name === 'literal coder brackets preserve ordered partial writes') {
        expect(request.argv).toEqual(argv);
        expect(request.discovery.resources.filter(r => r.access === 'write')).toMatchObject([
          {path:b('first.ppm[0]'),kind:'path'}, {path:b('second.ppm[1]'),kind:'path'}, {path:b('out.ppm[2]'),kind:'path'}
        ]);
        expect(request.discovery.resources.find(r => Buffer.from(r.operand).toString() === 'PPM:missing.ppm[0]')).toMatchObject({path:b('missing.ppm[0]'),kind:'path'});
      }
      if (c.name.startsWith('script-alias subcommand')) {
        expect(request.discovery.command).toBe(c.args[0].toLowerCase());
        expect(request.discovery.resources.every(r => r.role !== 'script')).toBe(true);
        expect(request.discovery.argv).toEqual(argv);
        const images = request.discovery.resources.filter(r => r.role === 'image');
        if (c.args[0].toLowerCase() === 'mogrify') expect(images).toMatchObject([
          {path:b('red.ppm'),access:'read-write'}, {path:b('blue.ppm'),access:'read-write'}, {path:b('missing.ppm'),access:'read-write'}
        ]);
        if (c.args[0].toLowerCase() === 'identify') expect(images.map(r => Buffer.from(r.path!).toString())).toEqual(['red.ppm','blue.ppm','missing.ppm']);
        if (c.args[0].toLowerCase() === 'convert') expect(images.filter(r => r.access === 'write').map(r => Buffer.from(r.path!).toString())).toEqual(['first.ppm','second.ppm','out.ppm']);
      }
      if (c.name.includes('set profile read after ordered writes')) {
        expect(request.argv).toEqual(argv);
        expect(request.discovery.resources.filter(r => r.role === 'profile')).toMatchObject([
          {operand:b('missing.icc'),path:b('missing.icc'),kind:'path',access:'read'}
        ]);
      }
      if (c.name === 'literal bracket filename') {
        expect(request.argv).toEqual(argv);
        expect(imageMagickAccessReferences(request.discovery).references[0])
          .toMatchObject({value:b('PPM:literal[0]'),path:b('literal[0]'),kind:'path'});
        expect(await imageMagickReaderReferences(b('PPM:literal[0]'), b(cwd), 'read', {
          literalFilenames:true,
          accessible:async path => { try { return (await stat(join(cwd,path))).isFile(); } catch { return false; } }
        })).toMatchObject([{value:b('PPM:literal[0]'),path:b('literal[0]'),kind:'path'}]);
      }
      if (request.discovery.resources.some(resource => resource.access === 'read-delete')) {
        const references = imageMagickAccessReferences(request.discovery).references;
        expect(references.filter(reference => reference.access === 'read-delete').map(reference => reference.value))
          .toEqual(request.discovery.resources.filter(resource => resource.access === 'read-delete').map(resource => resource.operand));
        expect(request.argv).toEqual(argv);
      }
      if (c.name.startsWith('text reader selector ')) {
        const path = c.name.includes('label canonical') ? 'text.txt' : 'text.txt[0]';
        expect(request.discovery.resources.filter(r => r.role === 'text')).toMatchObject([{path:b(path),access:'read'}]);
        expect(request.argv).toEqual(argv);
      }
      if (c.name.startsWith('script alias concatenate fallback')) {
        expect(request.argv).toEqual(argv);
        expect(text(expected['out.bin'])).toBe('ab');
        expect(request.discovery.resources.filter(r => r.role === 'image').map(r => [Buffer.from(r.path!).toString(),r.access])).toEqual([
          ['out.bin','write'],['a.bin','read-delete'],
          ...(c.name.includes('partial') ? [['missing.bin','read-delete']] : []),
          ['b.bin','read-delete']
        ]);
      }
      if (c.name === 'script alias list-query fallback') {
        expect(request.argv).toEqual(argv);
        expect(request.discovery.resources).toEqual([]);
        expect(request.discovery.tokens).toMatchObject([{raw:b('-list'),values:[b('format')]}]);
        expect(request.discovery.deferred.some(item => item.reason.includes('missing option operand'))).toBe(false);
      }
      if (c.name.startsWith('legacy literal percent font')) expect(request.discovery.resources.filter(r => r.role === 'font')).toMatchObject([
        {operand:b('./%font.ttf'),path:b('./%font.ttf'),kind:'path',access:'read'}
      ]);
      if (c.name === 'MVG literal percent font before ordered failure') {
        expect(text(native.stdout)).toBe(c.stdout);
        expect(expected['first.ppm']).not.toBe(expected['second.ppm']);
        const drawing = imageMagickAccessReferences(request.discovery).references.find(r => r.grammar === 'mvg')!;
        const parsed = await parseMvg(drawing.value, b(cwd), 10);
        expect(parsed.references).toMatchObject([{value:b('./%font.ttf'),path:b('./%font.ttf'),kind:'path',literal:true}]);
      }
      if (c.name.startsWith('MVG font resource ')) {
        expect(request.argv).toEqual(argv);
        expect(expected['first.ppm']).not.toBe(expected['second.ppm']);
        expect(expected).not.toHaveProperty('out.ppm');
        const drawing = imageMagickAccessReferences(request.discovery).references.find(r => r.grammar === 'mvg')!;
        const resources = await parseMvg(drawing.value, b(cwd), 10, {
          accessible:async path => { try { return (await stat(path.startsWith('/') ? path : join(cwd,path))).isFile(); } catch { return false; } }
        });
        const font = c.args[11].split("'")[1];
        const path = font.startsWith('@') ? font.slice(1, -3) : font;
        expect(resources.references).toMatchObject([{value:b(font),path:b(path),kind:'path',literal:true}]);
      }
      if (c.name.startsWith('literal drawing ')) {
        expect(request.argv).toEqual(argv);
        expect(expected['first.ppm']).not.toBe(expected['second.ppm']);
        const {references, inline} = imageMagickAccessReferences(request.discovery);
        const drawing = references.find(r => r.grammar === 'mvg')!;
        expect(drawing).toMatchObject({kind:'synthetic',literal:false});
        expect(drawing.path).toBeUndefined();
        expect(inline.get(drawing)).toEqual(argv[11]);
      }
      if (c.name.startsWith('geometry suffix ')) {
        expect(text(native.stdout)).toBe('first|second|');
        expect(expected['first.ppm']).not.toBe(expected['second.ppm']);
        expect(expected).not.toHaveProperty('out.ppm');
        expect(request.argv).toEqual(argv);
        expect(request.discovery.resources[0]).toMatchObject({operand:argv[2],path:b('red.ppm'),kind:'path',access:'read'});
      }
      if (c.name.startsWith('legacy format ')) {
        const readsText = ['identify', 'compare'].includes(request.discovery.command) && c.name.includes('accessible text');
        expect(request.discovery.resources.filter(r => r.role === 'text').map(r => Buffer.from(r.path!).toString())).toEqual(readsText ? ['text.txt'] : []);
        expect(request.argv).toEqual(argv);
        expect(text(native.stdout)).toBe(c.stdout ?? '');
      }
      if (c.name === 'reader inaccessible caption text stays literal before ordered failure') {
        const references = await imageMagickReaderReferences(b('caption:@missing.txt'), b(cwd), 'read', {
          accessible: async () => false, exists: async () => false
        });
        expect(references).toMatchObject([{kind:'synthetic'}]);
        expect(references).toHaveLength(1);
        expect(request.argv).toEqual(argv);
        expect(text(native.stdout)).toBe('first|second|');
        expect(expected['first.ppm']).not.toBe(expected['second.ppm']);
        expect(expected).not.toHaveProperty('out.ppm');
      }
      if (c.name === 'descriptor geometry remains native after two ordered writes') {
        expect(request.discovery.resources.find(r => Buffer.from(r.operand).toString() === 'fd:missing')).toMatchObject({kind:'dynamic',access:'read'});
        expect(request.argv).toEqual(argv);
      }
      if (c.name.startsWith('stream pixel map')) {
        expect(request.argv).toEqual(argv);
        expect(request.discovery.command).toBe('stream');
        expect(request.discovery.resources.map(r => Buffer.from(r.operand).toString())).toEqual([
          'red.ppm','blue.ppm','missing.ppm','out.raw'
        ]);
      }
      if (c.name === 'failed advisory reader probes preserve ordered partial effects') {
        for (const probe of ['accessible', 'exists'] as const) {
          const references = await imageMagickReaderReferences(request.argv[0], b(cwd), 'read', {
            accessible: async () => false, exists: async () => false,
            [probe]: async () => { throw Error('advisory filesystem unavailable'); }
          });
          expect(references).toMatchObject([{value:argv[0],path:b('red.ppm'),kind:'image-selector'}]);
        }
        expect(request.argv).toEqual(argv);
        expect(text(native.stdout)).toBe('first|second|');
        expect(expected['first.ppm']).not.toBe(expected['second.ppm']);
        expect(expected).not.toHaveProperty('out.ppm');
      }
      if (c.name.startsWith('literal-registry percent')) {
        const filename = c.args[4];
        expect(text(native.stdout)).toBe('first|second|');
        expect(expected['first' + filename]).not.toBe(expected['second' + filename]);
        expect(expected).not.toHaveProperty('out.ppm');
        expect(request.discovery.resources.slice(0,3)).toMatchObject([
          {path:b(filename),kind:'path',access:'read'},
          {path:b('first' + filename),kind:'path',access:'write'},
          {path:b('second' + filename),kind:'path',access:'write'}
        ]);
        expect(request.argv).toEqual(argv);
      }
      if (c.name === 'synthetic coder destinations retain literal partial writes') {
        expect(text(native.stdout)).toBe('first|second|');
        expect(text(native.stderr)).toContain('unrecognized option');
        expect(expected['xc:first.ppm']).not.toBe(expected['xc:second.ppm']);
        expect(expected).not.toHaveProperty('out.ppm');
        expect(request.discovery.resources.filter(r => r.access === 'write').slice(0,2)).toMatchObject([
          {operand:b('xc:first.ppm'),kind:'dynamic'}, {operand:b('xc:second.ppm'),kind:'dynamic'}
        ]);
        expect(request.argv).toEqual(argv);
      }
      if (quoted) {
        const operand = c.args.find(arg => arg.startsWith("'"))!;
        expect(request.discovery.resources.find(r => Buffer.from(r.operand).toString() === operand)).toMatchObject({path:b(operand),kind:'path'});
        expect(request.argv).toEqual(argv);
      }
      if (c.name.startsWith('MVG data')) {
        const resolver = new DependencyResolver({cwd:b(cwd),budgets:{nodes:100,bytes:100000,depth:10,symlinks:10},accessible:async () => true,exists:async () => true});
        const root = await resolver.add({value:b('inline-drawing'),literal:true,access:'read',grammar:'mvg'});
        const nodes = await resolver.content(root.id,{content:b(c.args[c.args.indexOf('-draw') + 1])});
        expect(nodes).toMatchObject([{original:b('DATA:invalid'),kind:'synthetic',location:undefined}]);
        expect(expected['first.ppm']).not.toBe(expected['second.ppm']);
        expect(expected).not.toHaveProperty('out.ppm');
        expect(text(native.stdout)).toBe('first|second|');
        expect(request.argv).toEqual(argv);
      }
      if (c.name.startsWith('legacy double dash')) {
        expect(request.discovery.tokens.find(t => Buffer.from(t.raw).toString() === '--')).toMatchObject({kind:'operand',values:c.tool === 'convert' ? [b('blue.ppm')] : c.tool === 'mogrify' ? [b('--')] : []});
        if (c.tool !== 'convert') expect(request.discovery.resources.some(r => Buffer.from(r.operand).toString() === '--' && r.kind === 'path')).toBe(true);
        expect(request.discovery.resources.some(r => Buffer.from(r.operand).toString() === 'blue.ppm')).toBe(true);
        expect(request.argv).toEqual(argv);
        if (c.tool === 'mogrify') {
          expect(expected['--']).not.toBe(Buffer.from(red).toString('base64'));
          expect(expected['blue.ppm']).not.toBe(Buffer.from(blue).toString('base64'));
        }
        if (c.tool === 'convert') expect(expected['first.ppm']).not.toBe(expected['second.ppm']);
      }
      if (c.name.startsWith('case-insensitive inline ')) {
        expect(request.discovery.resources[0]).toMatchObject({operand:argv[0],kind:'synthetic',access:'read'});
        expect(request.discovery.resources[0].path).toBeUndefined();
        expect(expected['first.ppm']).not.toBe(expected['second.ppm']);
        expect(expected).not.toHaveProperty('out.ppm');
        expect(text(native.stdout)).toBe('first|second|');
        expect(request.argv).toEqual(argv);
      }
      if (c.name.startsWith('inline ')) {
        expect(request.discovery.resources.filter(r => r.kind === 'path').map(r => Buffer.from(r.path!).toString())).toEqual(c.name.includes('embedded') ? ['encoded.txt','first.ppm','second.ppm','out.ppm'] : c.name.includes('validation') ? ['red.ppm','first.ppm','second.ppm','out.txt','out.ppm'] : ['red.png','first.ppm','second.ppm','out.ppm']);
        if (c.name.includes('valid outputs')) expect(text(expected['first.ppm']).startsWith('data:image/png;base64,')).toBe(true);
        expect(expected['first.ppm']).not.toBe(expected['second.ppm']);
        expect(expected).not.toHaveProperty('out.ppm');
        expect(text(native.stdout)).toBe('first|second|');
        expect(request.argv).toEqual(argv);
      }
      if (c.name.startsWith('argv brace glob')) {
        expect(request.discovery.resources.find(r => Buffer.from(r.operand).toString() === '{red,blue}.ppm')).toMatchObject({path:b('{red,blue}.ppm'),kind:'pattern'});
        expect(request.argv).toEqual(argv);
      }
      if (c.name.startsWith('concatenate grouped glob')) {
        expect(request.discovery.resources.find(r => r.access === 'read-delete')).toMatchObject({operand:b(c.args[1]),path:b(c.args[1]),kind:'pattern'});
        expect(request.argv).toEqual(argv);
      }
      if (c.name.startsWith('profile image reader')) {
        expect(request.discovery.resources.filter(r => r.role === 'profile' && r.path).map(r => Buffer.from(r.path!).toString())).toEqual(
          c.tool === 'mogrify' ? ['blue.ppm','PPM:blue.ppm[0]'] : ['blue.ppm','PPM:blue.ppm[0]','missing.ppm','PPM:missing.ppm[0]']
        );
        expect(request.argv).toEqual(argv);
      }
      if (c.name === 'stat-visible colon directory after ordered writes') {
        expect(request.discovery.resources.find(r => Buffer.from(r.operand).toString() === 'xc:green')).toMatchObject({path:b('xc:green'),kind:'path',access:'read'});
        expect(expected['first.ppm']).not.toBe(expected['second.ppm']);
        expect(expected).not.toHaveProperty('out.ppm');
        expect(request.argv).toEqual(argv);
      }
      if (c.name.startsWith('original list spelling')) {
        expect(request.discovery.resources.filter(r => r.role === 'list').map(r => Buffer.from(r.path!).toString())).toEqual(['names[0]']);
        expect(request.discovery.resources.some(r => r.role === 'image' && r.path && Buffer.from(r.path).toString() === '@palette.ppm')).toBe(true);
        expect(request.argv).toEqual(argv);
      }
      if (c.name.startsWith('ordered registry prefix hints')) {
        expect(request.discovery.resources.find(r => Buffer.from(r.operand).toString() === '%02d.ppm')).toMatchObject({kind:'path',access:'write',path:b('%02d.ppm')});
        expect(request.discovery.resources.find(r => Buffer.from(r.operand).toString() === '%03d.ppm')).toMatchObject({kind:'dynamic',access:'write'});
        expect(expected['%02d.ppm']).not.toBe(expected['000.ppm']);
        expect(expected).not.toHaveProperty('out.ppm');
        expect(request.argv).toEqual(argv);
      }
      if (c.name.startsWith('map ')) {
        const maps = request.discovery.resources.filter(r => r.role === 'image' && request.discovery.tokens.some(t => t.source === r.source && t.index === r.index && Buffer.from(t.raw).toString() === '-map'));
        expect(maps.map(r => Buffer.from(r.path!).toString())).toEqual(c.tool === 'mogrify' || c.tool === 'convert' ? ['blue.ppm'] : c.name.includes('literal cache') ? [c.args[6]] : ['blue.ppm','missing.ppm']);
        expect(maps.every(r => r.access === 'read' && r.kind === 'path')).toBe(true);
        expect(request.discovery.resources.some(r => r.role === 'list')).toBe(false);
        expect(request.argv).toEqual(argv);
      }
      if (c.name === 'scene-stripped colon file before ordered failure') {
        expect(request.discovery.resources[0]).toMatchObject({operand:b('xc:purple[0]'),path:b('xc:purple'),kind:'path',access:'read'});
      }
      if (c.name === 'scene-stripped synthetic source before ordered failure') expect(request.discovery.resources[0]).toMatchObject({operand:b('xc:red[0]'),kind:'synthetic',access:'read'});
      if (c.name.includes('scene-stripped literal registry')) expect(request.discovery.resources[0]).toMatchObject({operand:b('xc:red[0]'),path:b('xc:red[0]'),kind:'path',access:'read'});
      if (c.name.startsWith('deferred ')) expect(request.discovery.resources.filter(r => r.role === 'text').map(r => Buffer.from(r.path!).toString())).toEqual(c.name.includes('before failure') ? ['text.txt'] : []);
      if (c.name.startsWith('legacy annotate whitespace') || c.name.startsWith('legacy set whitespace') || c.name.includes('legacy mogrify whitespace text')) {
        expect(request.discovery.resources.filter(r => r.role === 'text').map(r => Buffer.from(r.path!).toString())).toEqual(['text.txt']);
      }
      if (c.name === 'legacy set missing text remains literal') expect(request.discovery.resources.filter(r => r.role === 'text')).toEqual([]);
      if (c.name.includes('suppress list expansion') || c.name.includes('suppresses parameter expansion')) {
        expect(request.discovery.resources.some(r => r.role === 'list')).toBe(false);
        expect(request.discovery.resources.some(r => r.path && Buffer.from(r.path).toString() === '@list.txt')).toBe(true);
      }
      if (c.name.startsWith('legacy convert plus function') || c.name.startsWith('legacy mogrify plus function') || c.name.startsWith('composite minus distort') || c.name.startsWith('composite plus distort')) {
        const images = request.discovery.resources.filter(r => r.role === 'image' && r.access !== 'write').map(r => Buffer.from(r.path!).toString());
        expect(images).toEqual(c.tool === 'mogrify' ? ['red.ppm','blue.ppm','missing.ppm'] : ['red.ppm','blue.ppm']);
      }
      if (c.name.includes('final list chooses') || c.name.includes('final list preserves')) {
        expect(request.discovery.resources.filter(r => r.access === 'write').map(r => Buffer.from(r.path!).toString())).toEqual(['out.bin']);
        expect(request.discovery.resources.filter(r => r.access === 'read-delete').map(r => Buffer.from(r.path!).toString())).toContain('b.bin');
      }
      if (c.name.startsWith('concatenate unexpanded')) {
        expect(request.discovery.resources.find(r => Buffer.from(r.operand).toString() === c.args[2])).toMatchObject({kind:'path',path:b(c.args[2]),access:'read-delete'});
      }
      if (c.name.startsWith('raw concatenate')) expect(request.discovery.resources.filter(r => r.access === 'write').map(r => Buffer.from(r.path!).toString())).toEqual([c.args.at(-1)]);
      if (c.name.includes('option parameter stays literal')) expect(request.discovery.resources.some(r => r.role === 'list')).toBe(false);
      if (c.name === 'caption reads text created by an earlier native write') {
        // Discovery precedes the file's creation. Native still reads it later;
        // predictions cannot serve as a closed upload/access or validation list.
        expect(request.discovery.resources.filter(r => r.role === 'text')).toEqual([]);
      }
      if (c.name.startsWith('observed literal')) {
        const grammar = c.name.includes('script') ? 'magick-script' : c.name.includes('list') ? 'magick-list' : 'msl';
        const filename = c.name.includes('stdin') ? 'literal-stdin.mg' : grammar === 'magick-script' ? 'literal.mg' : grammar === 'magick-list' ? 'literal-list.txt' : 'literal.msl';
        const resolver = new DependencyResolver({cwd:b(cwd),budgets:{nodes:100,bytes:100000,depth:10,symlinks:10},
          accessible: async path => { try { await access(Buffer.from(path)); return (await stat(Buffer.from(path))).isFile(); } catch { return false; } }});
        const root = await resolver.add({value:b(filename),literal:true,access:'read',grammar});
        const children = await resolver.content(root.id,{content:await readFile(join(cwd,filename))});
        expect(children.find(node => Buffer.from(node.original).toString() === 'xc:purple')).toMatchObject({kind:'path',location:b(cwd + '/xc:purple'),upload:false});
        expect(expected['first.ppm']).not.toBe(expected['second.ppm']);
        expect(expected).not.toHaveProperty('out.ppm');
        if (grammar !== 'msl') expect(text(native.stdout)).toBe(c.stdout);
        if (c.name.includes('stdin')) expect(children.find(node => node.grammar === 'text')).toMatchObject({kind:'descriptor',location:undefined});
      }
      if (c.name.startsWith('observed filtered list')) {
        const resolver = new DependencyResolver({cwd:b(cwd),budgets:{nodes:100,bytes:100000,depth:10,symlinks:10},
          accessible: async path => { try { return (await stat(Buffer.from(path))).isFile(); } catch { return false; } },
          directory: async path => { try { return (await stat(Buffer.from(path))).isDirectory(); } catch { return false; } }});
        const root = await resolver.add({value:b('filtered-list.txt'),literal:true,access:'read',grammar:'magick-list'});
        const children = await resolver.content(root.id,{content:await readFile(join(cwd,'filtered-list.txt'))});
        expect(children.map(node => Buffer.from(node.original).toString())).toEqual(['blue.ppm']);
        expect(text(native.stdout)).toBe('first|second|');
        expect(text(native.stderr)).not.toContain('xc:green');
        expect(expected['first.ppm']).not.toBe(expected['second.ppm']);
        expect(expected).not.toHaveProperty('out.ppm');
        expect(request.argv).toEqual(argv);
      }
      if (c.name.startsWith('observed directory')) {
        const grammar = c.name.includes('script') ? 'magick-script' : c.name.includes('list') ? 'magick-list' : c.name.includes('drawing') ? 'mvg' : 'msl';
        const filename = grammar === 'magick-script' ? 'directory.mg' : grammar === 'magick-list' ? 'directory-list.txt' : grammar === 'mvg' ? 'directory.mvg' : 'directory.msl';
        const resolver = new DependencyResolver({cwd:b(cwd),budgets:{nodes:100,bytes:100000,depth:10,symlinks:10},
          accessible: async path => { try { return (await stat(Buffer.from(path))).isFile(); } catch { return false; } },
          directory: async path => { try { return (await stat(Buffer.from(path))).isDirectory(); } catch { return false; } },
          exists: async path => { try { await stat(Buffer.from(path)); return true; } catch { return false; } }});
        const root = await resolver.add({value:b(filename),literal:true,access:'read',grammar});
        const children = await resolver.content(root.id,{content:await readFile(join(cwd,filename))});
        if (grammar === 'magick-list') expect(children).toEqual([]);
        else expect(children.find(node => Buffer.from(node.original).toString() === 'xc:green')).toMatchObject({kind:'path',location:b(cwd + '/xc:green'),upload:false});
        expect(expected['first.ppm']).not.toBe(expected['second.ppm']);
      }
      if (c.name.startsWith('legacy signed reset')) {
        const option = c.args.find(arg => ['+evaluate','+evaluate-sequence','+extent'].includes(arg));
        expect(request.discovery.tokens.find(t => Buffer.from(t.raw).toString() === option)?.values).toEqual([]);
        expect(request.discovery.resources.filter(r => r.role === 'image' && r.access !== 'write').map(r => Buffer.from(r.path!).toString()))
          .toEqual(['red.ppm','blue.ppm','missing.ppm']);
        expect(request.argv).toEqual(argv);
        if (c.tool === 'convert') expect(expected['first.ppm']).not.toBe(expected['second.ppm']);
        if (c.tool === 'mogrify') {
          if (option === '+extent') {
            // The command parser consumes no value; the image handler still
            // attempts native geometry parsing. Its failure prevents edits.
            expect(expected['red.ppm']).toBe(Buffer.from(red).toString('base64'));
            expect(expected['blue.ppm']).toBe(Buffer.from(blue).toString('base64'));
          } else {
            expect(expected['red.ppm']).not.toBe(Buffer.from(red).toString('base64'));
            expect(expected['blue.ppm']).not.toBe(Buffer.from(blue).toString('base64'));
          }
        }
      }
      observed = await runNative(request.executable.path,request.argv,request.context);
      return {exitCode:observed.exitCode};
    }
  });
  expect(await shims[c.tool](argv,context)).toEqual({exitCode:native.exitCode});
  expect(observed).toEqual(native);
  expect(await effects()).toEqual(expected);
});
it.each(Object.keys(imageMagickReference.executables) as ImageMagickTool[])('installed alias identity and dispatch: %s', async tool => {
  const context = {cwd,env,stdin:new Uint8Array()};
  const argv = [tool.endsWith('-config') ? '--version' : '-version'].map(b);
  const native = await runNative(imageMagickReference.executables[tool].path,argv,context);
  let observed;
  const shims = createImageMagickShims<typeof context>({build:imageMagickReference.id,grammarRevision:imageMagickGrammarRevision,argv:'bytes',lateAccess:'complete',effects:'live',async run(r) { observed = await runNative(r.executable.path,r.argv,r.context); return {exitCode:observed.exitCode}; }});
  await shims[tool](argv,context);
  expect(observed).toEqual(native);
  expect(text(native.stdout).length + text(native.stderr).length).toBeGreaterThan(0);
});
it.each(['directory', 'coder glob', 'concatenate'] as const)('native filename expansion call sites: %s', async family => {
  const setup = async () => {
    await reset();
    await mkdir(join(cwd, 'group[ab]'));
    await writeFile(join(cwd, 'group[ab]/red.ppm'), red);
    await writeFile(join(cwd, 'group[ab]/a.bin'), 'a');
    if (family === 'coder glob') await writeFile(join(cwd, 'group[ab]/*.ppm'), blue);
  };
  const tool = family === 'coder glob' ? 'identify' : 'magick';
  const argv = (family === 'directory'
    ? ['group[ab]/red.ppm','-write','first.ppm','-print','first|','-negate','+write','second.ppm','-print','second|','missing.ppm','out.ppm']
    : family === 'coder glob' ? ['-format','%f|','PPM:group[ab]/*.ppm','missing.ppm']
    : ['-concatenate','group[ab]/a.bin','missing.bin','out.bin']).map(b);
  const context = {cwd,env,stdin:new Uint8Array()};
  await setup();
  const native = await runNative(imageMagickReference.executables[tool].path, argv, context);
  const expected = await effects();
  expect(native.exitCode).toBe(1);
  expect(text(native.stderr)).toContain(family === 'concatenate' ? 'missing.bin' : 'missing.ppm');
  if (family === 'directory') {
    expect(text(native.stdout)).toBe('first|second|');
    expect(expected['first.ppm']).toBeDefined();
    expect(expected['second.ppm']).toBeDefined();
    expect(expected['first.ppm']).not.toBe(expected['second.ppm']);
    expect(expected).not.toHaveProperty('out.ppm');
  } else if (family === 'coder glob') {
    expect(text(native.stdout)).toBe('*.ppm|red.ppm|');
  } else {
    expect(text(expected['out.bin'])).toBe('a');
    await expect(stat(join(cwd,'group[ab]/a.bin'))).rejects.toMatchObject({code:'ENOENT'});
  }
  await setup();
  const shims = createImageMagickShims<typeof context>({
    build:imageMagickReference.id,grammarRevision:imageMagickGrammarRevision,argv:'bytes',lateAccess:'complete',effects:'live',
    discoveryContext: () => {
      const nativePath = (path: Uint8Array) => path[0] === 47 ? Buffer.from(path) : Buffer.concat([Buffer.from(cwd + '/'),path]);
      return {
        accessible: async path => { try { const name = nativePath(path); await access(name); return (await stat(name)).isFile(); } catch { return false; } },
        exists: async path => { try { await stat(nativePath(path)); return true; } catch { return false; } }
      };
    },
    async run(request) {
      expect(request.argv).toEqual(argv);
      expect(request.discovery.resources.find(r => r.access === (family === 'concatenate' ? 'read-delete' : 'read'))).toMatchObject({
        kind:family === 'coder glob' ? 'pattern' : 'path',
        path:b(family === 'directory' ? 'group[ab]/red.ppm' : family === 'coder glob' ? 'group[ab]/*.ppm' : 'group[ab]/a.bin')
      });
      const observed = await runNative(request.executable.path, request.argv, request.context);
      expect(observed).toEqual(native);
      return {exitCode:observed.exitCode};
    }
  });
  expect(await shims[tool](argv,context)).toEqual({exitCode:native.exitCode});
  expect(await effects()).toEqual(expected);
  if (family === 'concatenate') await expect(stat(join(cwd,'group[ab]/a.bin'))).rejects.toMatchObject({code:'ENOENT'});
});
