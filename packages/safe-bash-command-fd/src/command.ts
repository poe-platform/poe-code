import { FdUsageError } from './errors.js';
import { assertCommandRequirements } from 'safe-bash-contracts/command-requirements';
import { fdTemplate, formatFdPath } from './templates.js';
export { formatFdPath } from './templates.js';
import { commandRuntimeIdentity, getCommandArguments, writeBytes, FsError, type CommandHandler, type CommandContext, type CommandDefinition, type CommandResult } from 'safe-bash-contracts';
import { resolvePath, posixPath, type FileStat } from '@poe-code/safe-fs/core';
import { parseFdArguments, type FdArguments } from './arguments.js';

export interface FdLimits { readonly maxDepth: number; readonly maxEntries: number }
export interface FdCommandOptions {
  readonly limits?: Partial<FdLimits>;
  readonly execute?: CommandHandler;
  readonly maxDepth?: number;
  readonly maxEntries?: number;
  readonly maxIgnoreFileBytes?: number;
  readonly maxRegexSteps?: number;
  readonly maxRegexBufferBytes?: number;
  readonly replace?: boolean;
}
export interface FdMatcher {
  pattern(source: string, subject: string, mode: FdArguments['mode'], caseMode: FdArguments['caseMode']): Promise<boolean>;
  ignores(contents: string): Promise<readonly {pattern: string; include: boolean}[]>;
  glob(source: string, subject: string, directory: boolean, ancestors: boolean): Promise<boolean>;
}
export type FdMatchingScope = (context: CommandContext, run: (matcher: FdMatcher) => Promise<CommandResult>) => Promise<CommandResult>;
const requirements = [
  {id:'metadata',description:'Inspect search entries',capabilities:['stat']},
  {id:'directory',description:'Traverse directories and detect symlink loops',capabilities:['readdir','realpath']},
  {id:'ignore',description:'Read virtual ignore files',capabilities:['read']},
] as const;
interface Rule { base: string; pattern: string; include: boolean; priority: number }
function rootPrefixNeeded(path: string): boolean { return !path.startsWith('./') && !path.startsWith('../'); }
function sizeFilter(source: string): (size: number) => boolean {
  const parsed=/^([+-]?)(\d+)(b|[kmgt]i?b?)$/iu.exec(source);
  if (!parsed) throw new FdUsageError(`invalid size '${source}'`);
  const unit=(parsed[3] ?? 'b').toLowerCase(); const power='bkmgt'.indexOf(unit[0]!);
  const value=Number(parsed[2]) * (unit.includes('i') ? 1024 : 1000)**power;
  return size => parsed[1]==='+' ? size>=value : parsed[1]==='-' ? size<=value : size===value;
}
function timestamp(source: string, now: number): number {
  const duration=/^(\d+(?:\.\d+)?)\s*(ms|s|sec|seconds?|m|min|minutes?|h|hours?|d|days?|w|weeks?)$/iu.exec(source);
  if (duration) {
    const unit=duration[2]!.toLowerCase(); const factor=unit==='ms' ? 1 : ({s:1000,m:60000,h:3600000,d:86400000,w:604800000} as Record<string,number>)[unit[0]!]!;
    return now-Number(duration[1])*factor;
  }
  const value=source.startsWith('@') ? Number(source.slice(1))*1000 : Date.parse(source); if (!Number.isFinite(value)) throw new FdUsageError(`invalid time '${source}'`); return value;
}
export function createFdCommandWithMatcher(scope: FdMatchingScope, options: FdCommandOptions = {}): CommandDefinition {
  const maxEntries=options.limits?.maxEntries ?? options.maxEntries ?? Infinity;
  for (const [name,value] of Object.entries({...options,...options.limits})) if (name.startsWith('max') && value!==undefined && value!==Infinity && (typeof value!=='number' || !Number.isSafeInteger(value) || value<1)) throw new Error(`${name} must be a positive safe integer or Infinity`);
  return { name:'fd', runtimeIdentity:commandRuntimeIdentity, filesystemRequirements:requirements, description:'Find files and directories in the virtual filesystem', async execute(context) {
    try {
      const carrier=getCommandArguments(context);
      const decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
      for (let i=0;i<context.args.length;i++) decoder.decode(carrier.bytes(i)!);
      const args=parseFdArguments(context.args);
      if (args.help || args.version) {
        await writeBytes(context.stdout,new TextEncoder().encode(args.version ? 'fd (safe-bash)\n' : 'Usage: fd [OPTIONS] [PATTERN] [PATH ...]\nPatterns: -g --glob, -F --fixed-strings, -s --case-sensitive, -i --ignore-case, -p --full-path, --and PATTERN\nFilters: -e EXT, -t TYPE, -E GLOB, -d DEPTH, --min-depth N, --exact-depth N, -S SIZE, --changed-within TIME, --changed-before TIME, -1, --max-results N, -q\nVisibility: -H, -I, --no-ignore-vcs, --no-ignore-parent, -u, -uu, -L\nOutput: -0, -a, -l, --format FORMAT, -x COMMAND ... ;, -X COMMAND ... ;\n'),context.signal);
        return {exitCode:0};
      }
      const searchContext=args.baseDirectory===undefined ? context : {...context,cwd:resolvePath(context.cwd,args.baseDirectory)};
      return await scope(searchContext, matcher => find(searchContext,args,matcher,maxEntries,options.maxIgnoreFileBytes ?? Infinity, options.limits?.maxDepth ?? options.maxDepth ?? Infinity, options.execute));
    } catch(error) {
      context.signal.throwIfAborted();
      await writeBytes(context.stderr,new TextEncoder().encode(`fd: ${error instanceof Error ? error.message : 'internal error'}\n`),context.signal);
      return {exitCode:error instanceof FdUsageError ? 2 : 1};
    }
  }};
}
async function find(context: CommandContext, a: FdArguments, matcher: FdMatcher, maximum: number,maxIgnoreFileBytes: number,maxDepth: number,execute?: CommandHandler): Promise<CommandResult> {
  const signal=context.signal, fs=context.fs, io={signal};
  const sizes=a.sizes.map(sizeFilter), now=Date.now(), within=a.within===undefined ? -Infinity : timestamp(a.within,now), before=a.before===undefined ? Infinity : timestamp(a.before,now);
  const admit=async(path: string,modes: readonly string[]) => {
    assertCommandRequirements(context,requirements,modes);
    const capabilities=await fs.capabilitiesFor?.(path,io);
    signal.throwIfAborted();
    if (capabilities) assertCommandRequirements(context,requirements,modes,capabilities);
  };
  const matches: string[]=[]; let visited=0, found=0, failed=false, executionFailed=false;
  const emit=async (text: string) => writeBytes(context.stdout,new TextEncoder().encode(text),signal);
  const report=async (error: unknown) => { signal.throwIfAborted(); failed=true; await writeBytes(context.stderr,new TextEncoder().encode(`fd: ${error instanceof Error ? error.message : 'filesystem error'}\n`),signal); };
  const invoke=async (paths: string[]) => {
    const command: string[]=[]; let placeholder=false;
    for (const token of a.exec) {
      const has=fdTemplate(token).count>0; placeholder ||= has;
      if (has) for (const path of paths) command.push(formatFdPath(token,path)); else command.push(formatFdPath(token,''));
    }
    if (!placeholder) command.push(...paths);
    const result=context.invoke ? await context.invoke(command[0]!,command.slice(1),{stdin:(async function*(){})(),stdinIsDefault:true,signal}) : execute ? await execute({...context,command:command[0]!,args:command.slice(1),stdin:(async function*(){})()}) : (()=>{throw new Error('command invocation is unavailable');})();
    executionFailed ||= result.exitCode!==0;
  };
  const load=async (dir: string, inherited: Rule[]): Promise<Rule[]> => {
    if (!a.ignore) return inherited;
    const rules=[...inherited];
    for (const [name,priority] of [['.gitignore',0],['.ignore',1],['.fdignore',2]] as const) {
      if (name==='.gitignore' && !a.ignoreVcs) continue;
      const path=posixPath.join(dir,name);
      try {
        await admit(path,['ignore']);
        const text=new TextDecoder('utf-8',{fatal:true}).decode(await fs.readFile(path,{signal,...(Number.isFinite(maxIgnoreFileBytes) ? {maxBytes:maxIgnoreFileBytes} : {})}));
        for (const rule of await matcher.ignores(text)) rules.push({base:dir,priority,...rule});
      } catch(error) { signal.throwIfAborted(); if (!(error instanceof FsError && error.code==='ENOENT')) throw error; }
    }
    return rules;
  };
  const accepted=async(path: string,name: string,directory: boolean,rules: Rule[],searchRoot: string): Promise<boolean> => {
    if (!a.hidden && name.startsWith('.')) return false;
    for (const pattern of a.excludes) if (await matcher.glob(pattern,path.slice(searchRoot==='/' ? 1 : searchRoot.length+1),directory,true) || await matcher.glob(pattern,name,directory,true)) return false;
    let ignored=false, priority=-1;
    for (const rule of rules) if (rule.priority>=priority && await matcher.glob(rule.pattern,path.slice(rule.base==='/' ? 1 : rule.base.length+1),directory,true)) { ignored=!rule.include; priority=rule.priority; }
    return !ignored;
  };
  const selected=async(path: string,name: string,stat: FileStat,depth: number): Promise<boolean> => {
    if (depth<a.minDepth || depth>a.maxDepth) return false;
    const ordinary=a.types.filter(t=>t!=='empty' && t!=='executable');
    if (ordinary.length && !ordinary.includes(stat.type)) return false;
    if (a.types.includes('executable') && (stat.type==='file' ? !(stat.mode&0o111) : !ordinary.includes(stat.type))) return false;
    if (a.types.includes('empty') && !(stat.type==='file' ? stat.size===0 : stat.type==='directory' && (await fs.readdir(path,io)).length===0)) return false;
    if (a.extensions.length && (stat.type!=='file' || !a.extensions.some(e=>name.toLowerCase().endsWith('.'+e.toLowerCase())))) return false;
    if (sizes.length && (stat.type!=='file' || !sizes.every(filter=>filter(stat.size)))) return false;
    if (stat.mtimeMs<=within || stat.mtimeMs>=before) return false;
    for (const pattern of a.patterns) if (pattern && !await matcher.pattern(pattern,a.fullPath ? path : name,a.mode,a.caseMode)) return false;
    return true;
  };
  const walk=async(dir: string,label: string,depth: number,rules: Rule[],ancestors: Set<string>,prefixCwd: boolean,searchRoot: string): Promise<boolean> => {
    signal.throwIfAborted(); if (depth > maxDepth) throw new Error('traversal depth limit exceeded'); if (depth>=a.maxDepth) return false;
    await admit(dir,['metadata','directory']);
    const canonical=await fs.realpath(dir,io);
    if (ancestors.has(canonical)) throw new Error(`filesystem loop at '${label}'`);
    ancestors.add(canonical);
    try {
      const local=await load(dir,rules);
      const entries=await fs.readdir(dir,{signal,...(Number.isFinite(maximum) ? {maxEntries:maximum-visited} : {})});
      entries.sort((l,r)=>l.name<r.name ? -1 : l.name>r.name ? 1 : 0);
      for (const entry of entries) {
        signal.throwIfAborted(); if (++visited>maximum) throw new Error('filesystem entry limit exceeded');
        if ((visited&255)===0) { await new Promise<void>(resolve=>setTimeout(resolve,0)); signal.throwIfAborted(); }
        const path=posixPath.join(dir,entry.name), display=label ? label+(label.endsWith('/') ? '' : '/')+entry.name : entry.name;
        try {
        await admit(path,['metadata']);
        let stat=await fs.lstat(path,io);
        if (stat.type==='symlink' && a.follow) {
          try { stat=await fs.stat(path,io); } catch(error) { signal.throwIfAborted(); if (!(error instanceof FsError && error.code==='ENOENT')) throw error; }
          if (stat.type==='directory' && ancestors.has(await fs.realpath(path,io))) continue;
        }
        const directory=stat.type==='directory';
        if (!await accepted(path,entry.name,directory,local,searchRoot)) continue;
        if (await selected(path,entry.name,stat,depth+1)) {
          found++; const out=a.absolute ? path : !a.stripCwdPrefix && prefixCwd && (a.exec.length || a.print0 || a.details) && !display.startsWith('/') && rootPrefixNeeded(display) ? './'+display : display;
          if (!a.quiet) {
            if (a.exec.length) { if (a.batch) matches.push(out); else await invoke([out]); }
            else if (a.format!==undefined) await emit(formatFdPath(a.format,out)+(a.print0 ? '\0' : '\n'));
            else if (a.details) matches.push(out);
            else await emit(out+(directory ? '/' : '')+(a.print0 ? '\0' : '\n'));
          }
          if (a.quiet || found>=a.maxResults) return true;
        }
        if (directory && await walk(path,display,depth+1,local,ancestors,prefixCwd,searchRoot)) return true;
        } catch(error) { signal.throwIfAborted(); if (!(error instanceof FsError)) throw error; await report(error); }
      }
      return false;
    } finally { ancestors.delete(canonical); }
  };
  // Validate even on an empty tree, before any output or command effects.
  for (const pattern of a.patterns) if (pattern) await matcher.pattern(pattern,'',a.mode,a.caseMode);
  for (const pattern of a.excludes) await matcher.glob(pattern,'',false,false);
  for (const root of a.roots) {
    try {
      const path=resolvePath(context.cwd,root);
      await admit(path,['metadata']);
      if ((await fs.stat(path,io)).type!=='directory') throw new Error(`search path '${root}' is not a directory`);
      let inherited: Rule[]=[];
      if (a.ignoreParent) {
        const parents: string[]=[]; let parent=posixPath.dirname(path);
        if (path!=='/') { while (true) { parents.unshift(parent); if (parent==='/') break; parent=posixPath.dirname(parent); } }
        for (const dir of parents) inherited=await load(dir,inherited);
      }
      if (await walk(path,root==='.' ? '' : root,0,inherited,new Set(),root==='.',path)) break;
    } catch(error) { await report(error); }
  }
  if (a.batch && matches.length) await invoke(matches);
  if (a.details && matches.length) {
    if (!context.invoke) throw new Error('detailed listings require command invocation');
    const result=await context.invoke('ls',['-ld',...matches],{signal});
    executionFailed ||= result.exitCode!==0;
  }
  return {exitCode: a.quiet ? found ? 0 : 1 : executionFailed || failed ? 1 : 0};
}
