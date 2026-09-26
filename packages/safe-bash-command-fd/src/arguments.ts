import { FdUsageError } from './errors.js';
import { fdTemplate } from './templates.js';
export interface FdArguments {
  patterns: string[]; roots: string[]; mode: 'regex' | 'glob' | 'fixed'; caseMode: 'smart' | 'sensitive' | 'insensitive';
  hidden: boolean; ignore: boolean; ignoreVcs: boolean; ignoreParent: boolean; follow: boolean;
  fullPath: boolean; absolute: boolean; print0: boolean; quiet: boolean; details: boolean;
  minDepth: number; maxDepth: number; maxResults: number; extensions: string[]; types: string[]; excludes: string[];
  sizes: string[]; within: string | undefined; before: string | undefined; format: string | undefined;
  baseDirectory: string | undefined; pathSeparator: string | undefined; stripCwdPrefix: boolean; exec: string[]; batch: boolean; help: boolean; version: boolean;
}
const aliases: Record<string, string> = { C:'base-directory', H:'hidden', I:'no-ignore', u:'unrestricted', L:'follow', g:'glob', F:'fixed-strings', s:'case-sensitive', i:'ignore-case', p:'full-path', a:'absolute-path', '0':'print0', q:'quiet', l:'list-details', d:'max-depth', e:'extension', t:'type', E:'exclude', S:'size', '1':'one', h:'help', V:'version', x:'exec', X:'exec-batch' };
const values = new Set(['path-separator','and','extension','type','exclude','max-depth','min-depth','exact-depth','max-results','size','changed-within','changed-before','format','color','base-directory']);
export function parseFdArguments(argv: readonly string[]): FdArguments {
  const a: FdArguments = { patterns:[], roots:[], mode:'regex', caseMode:'smart', hidden:false, ignore:true, ignoreVcs:true, ignoreParent:true, follow:false, fullPath:false, absolute:false, print0:false, quiet:false, details:false, minDepth:1, maxDepth:Infinity, maxResults:Infinity, extensions:[], types:[], excludes:[], sizes:[], within:undefined, before:undefined, format:undefined, baseDirectory:undefined, pathSeparator:undefined, stripCwdPrefix:false, exec:[], batch:false, help:false, version:false };
  const operands: string[] = []; let ended = false;
  const number = (value: string): number => { if (!value || [...value].some(c => c < '0' || c > '9') || !Number.isSafeInteger(Number(value))) throw new FdUsageError(`invalid count '${value}'`); return Number(value); };
  for (let i=0;i<argv.length;i++) {
    const arg=argv[i]!;
    if (ended || !arg.startsWith('-') || arg === '-') { operands.push(arg); continue; }
    if (arg === '--') { ended=true; continue; }
    const long=arg.startsWith('--'); const eq=arg.indexOf('=');
    const flags=long ? [eq < 0 ? arg.slice(2) : arg.slice(2,eq)] : [...arg.slice(1)];
    for (let j=0;j<flags.length;j++) {
      const flag=long ? flags[j]! : aliases[flags[j]!] ?? flags[j]!;
      if (flag==='exec' || flag==='exec-batch') {
        if (a.exec.length) throw new FdUsageError('execution modes cannot be combined');
        a.batch=flag==='exec-batch';
        while (++i<argv.length && argv[i]!==';') a.exec.push(argv[i]!);
        if (!a.exec.length) throw new FdUsageError('execution command is required');
        break;
      }
      let value='';
      if (values.has(flag)) {
        if (long && eq>=0) value=arg.slice(eq+1);
        else if (!long && j+1<flags.length) { value=arg.slice(j+2); j=flags.length; }
        else { value=argv[++i] ?? ''; if (!value) throw new FdUsageError(`option --${flag} requires a value`); }
      } else if (long && eq>=0) throw new FdUsageError(`option --${flag} does not take a value`);
      switch(flag) {
        case 'hidden': a.hidden=true; break;
        case 'no-ignore': a.ignore=false; break;
        case 'no-ignore-vcs': a.ignoreVcs=false; break;
        case 'no-ignore-parent': a.ignoreParent=false; break;
        case 'unrestricted': a.ignore=false; a.hidden=true; break;
        case 'follow': a.follow=true; break;
        case 'glob': a.mode='glob'; break;
        case 'fixed-strings': a.mode='fixed'; break;
        case 'case-sensitive': a.caseMode='sensitive'; break;
        case 'ignore-case': a.caseMode='insensitive'; break;
        case 'full-path': a.fullPath=true; break;
        case 'base-directory': a.baseDirectory=value; break;
        case 'path-separator': a.pathSeparator=value; break;
        case 'strip-cwd-prefix': a.stripCwdPrefix=true; break;
        case 'absolute-path': a.absolute=true; break;
        case 'print0': a.print0=true; break;
        case 'quiet': case 'has-results': a.quiet=true; break;
        case 'list-details': a.details=true; break;
        case 'one': a.maxResults=1; break;
        case 'max-depth': a.maxDepth=number(value); break;
        case 'min-depth': a.minDepth=number(value); break;
        case 'exact-depth': a.minDepth=a.maxDepth=number(value); break;
        case 'max-results': a.maxResults=number(value) || Infinity; break;
        case 'and': a.patterns.push(value); break;
        case 'extension': a.extensions.push(value.startsWith('.') ? value.slice(1) : value); break;
        case 'type': {
          const type=({f:'file',file:'file',d:'directory',dir:'directory',directory:'directory',l:'symlink',symlink:'symlink',x:'executable',executable:'executable',e:'empty',empty:'empty'} as Record<string,string>)[value];
          if (!type) throw new FdUsageError(`invalid file type '${value}'`); a.types.push(type); break;
        }
        case 'exclude': a.excludes.push(value); break;
        case 'size': a.sizes.push(value); break;
        case 'changed-within': a.within=value; break;
        case 'changed-before': a.before=value; break;
        case 'format': a.format=value; break;
        case 'help': a.help=true; break;
        case 'version': a.version=true; break;
        case 'color': if (!['always','auto','never'].includes(value)) throw new FdUsageError('invalid color mode'); break;
        default: throw new FdUsageError(`unrecognized option '--${flag}'`);
      }
    }
  }
  a.patterns.unshift(operands.shift() ?? ''); a.roots=operands.length ? operands : ['.'];
  if (a.caseMode==='smart') a.caseMode=a.patterns.some(pattern=>[...pattern].some(c=>c.toUpperCase()===c && c.toLowerCase()!==c)) ? 'sensitive' : 'insensitive';
  if (a.exec.length && (a.format!==undefined || a.details)) throw new FdUsageError('execution cannot be combined with formatting');
  if (a.batch && a.exec.reduce((count,token)=>count+fdTemplate(token).count,0)>1) throw new FdUsageError('batch execution accepts only one placeholder');
  return a;
}
