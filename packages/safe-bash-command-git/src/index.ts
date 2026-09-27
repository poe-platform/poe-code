import { commandRuntimeIdentity, writeBytes, type CommandDefinition, type VirtualShellPlugin } from 'safe-bash-contracts';
import type { FileSystem } from '@poe-code/safe-fs/core';
import { gitModule } from '#git-wasm';

export interface GitLimits { readonly maxEntries: number; readonly maxBytes: number; readonly maxDepth: number; readonly maxHttpRequests: number; readonly maxHttpBytes: number }
export interface GitHttpRequest { readonly url: string; readonly method: string; readonly headers: Readonly<Record<string,string>>; readonly body: Uint8Array; readonly signal: AbortSignal }
export interface GitHttpResponse { readonly status: number; readonly headers: Readonly<Record<string,string>>; readonly body: Uint8Array }
export interface GitCommandsOptions { readonly http?: (request:GitHttpRequest)=>Promise<GitHttpResponse>; readonly limits?: Partial<GitLimits>; readonly replace?: boolean; readonly wasmModule?: WebAssembly.Module }
interface Entry { path: string; kind: string; mode: number; data: string }
interface Result { exitCode: number; stdout: string; stdoutBytes?: string | null; stderr: string; entries: Entry[] | null; request?: {url:string;method:string;headers:Record<string,string>;body:string} | null }
interface GitExports extends WebAssembly.Exports { memory: WebAssembly.Memory; git_alloc(length:number):number; git_free(ptr:number,length:number):void; git_execute(ptr:number,length:number):number; git_output_len():number }
const encoder=new TextEncoder(), decoder=new TextDecoder();
function encode(bytes:Uint8Array):string { let s=''; for(const b of bytes) s+=b.toString(16).padStart(2,'0'); return s; }
function decode(hex:string):Uint8Array { const bytes=new Uint8Array(hex.length/2); for(let i=0;i<bytes.length;i++) bytes[i]=Number.parseInt(hex.slice(i*2,i*2+2),16); return bytes; }

async function snapshot(fs:FileSystem, limits:GitLimits, signal:AbortSignal):Promise<Entry[]> {
  const entries:Entry[]=[];
  let total=0;
  const pending=[{path:'/',depth:0}];
  while(pending.length) {
    const {path,depth}=pending.pop()!;
    signal.throwIfAborted();
    if(depth>limits.maxDepth) throw new Error('Git filesystem depth limit exceeded');
    for(const child of await fs.readdir(path,{signal,...(limits.maxEntries===Infinity ? {} : {maxEntries:limits.maxEntries-entries.length})})) {
      signal.throwIfAborted();
      if(entries.length>=limits.maxEntries) throw new Error('Git filesystem entry limit exceeded');
      const full=path==='/' ? `/${child.name}` : `${path}/${child.name}`;
      const stat=await fs.lstat(full,{signal});
      if(stat.type==='character') continue;
      total+=encoder.encode(full).length;
      if(stat.type==='file' && total+stat.size>limits.maxBytes) throw new Error('Git filesystem byte limit exceeded');
      let bytes:Uint8Array=new Uint8Array();
      if(stat.type==='directory') pending.push({path:full,depth:depth+1});
      else if(stat.type==='symlink') { if(!fs.readlink) throw new Error('Git requires readlink for symlinks'); bytes=encoder.encode(await fs.readlink(full,{signal})); }
      else if(stat.type==='file') bytes=await fs.readFile(full,{signal,...(limits.maxBytes===Infinity ? {} : {maxBytes:limits.maxBytes-total})});
      else throw new Error('Git does not support device entries');
      total+=bytes.length;
      if(total>limits.maxBytes) throw new Error('Git filesystem byte limit exceeded');
      entries.push({path:full,kind:stat.type,mode:stat.mode,data:encode(bytes)});
    }
  }
  return entries;
}

async function publish(fs:FileSystem, before:Entry[], after:Entry[], signal:AbortSignal):Promise<void> {
  const prior=new Map(before.map(e=>[e.path,e]));
  const next=new Map(after.map(e=>[e.path,e]));
  const removed=before.filter(e=>!next.has(e.path) || next.get(e.path)!.kind!==e.kind).sort((a,b)=>b.path.length-a.path.length);
  for(const e of removed) {
    signal.throwIfAborted();
    if(e.kind==='directory') { if(!fs.rmdir) throw new Error('Git requires rmdir'); await fs.rmdir(e.path,{signal}); }
    else { if(!fs.unlink) throw new Error('Git requires unlink'); await fs.unlink(e.path,{signal}); }
  }
  for(const e of after.filter(e=>e.kind==='directory').sort((a,b)=>a.path.length-b.path.length)) {
    if(prior.get(e.path)?.kind!=='directory') await fs.mkdir(e.path,{recursive:true,signal});
  }
  for(const e of after.filter(e=>e.kind!=='directory')) {
    signal.throwIfAborted();
    const old=prior.get(e.path);
    if(old?.data===e.data && old.kind===e.kind && (old.mode & 0o777)===(e.mode & 0o777)) continue;
    if(e.kind==='symlink') {
      if(!fs.symlink || !fs.unlink) throw new Error('Git requires symlink support');
      if(old?.kind===e.kind) await fs.unlink(e.path,{signal});
      await fs.symlink(decoder.decode(decode(e.data)),e.path,{signal});
    } else {
      await fs.writeFile(e.path,decode(e.data),{signal,mode:e.mode & 0o777});
      if(fs.chmod && ((old?.mode ?? 0) & 0o777)!==(e.mode & 0o777)) await fs.chmod(e.path,e.mode & 0o777,{signal});
    }
  }
}

export function createGitCommand(options:GitCommandsOptions={}):CommandDefinition {
  const limits:GitLimits={maxEntries:Infinity,maxBytes:Infinity,maxDepth:Infinity,maxHttpRequests:Infinity,maxHttpBytes:Infinity,...options.limits};
  for(const [name,value] of Object.entries(limits)) if(value!==Infinity && (!Number.isSafeInteger(value) || value<1)) throw new Error(`${name} must be a positive safe integer or Infinity`);
  return {name:'git',runtimeIdentity:commandRuntimeIdentity,description:'Git repositories in the virtual filesystem',async execute(context) {
    try {
      const before=await snapshot(context.fs,limits,context.signal);
      const module=options.wasmModule ?? gitModule();
      const exports=new WebAssembly.Instance(module).exports as GitExports;
      const responses: {status:number;headers:Readonly<Record<string,string>>;body:string}[]=[];
      let httpBytes=0;
      let result:Result;
      for(;;) {
        context.signal.throwIfAborted();
        const input=encoder.encode(JSON.stringify({cwd:context.cwd,args:context.args,entries:before,responses}));
        const ptr=exports.git_alloc(input.length);
        try {
          new Uint8Array(exports.memory.buffer,ptr,input.length).set(input);
          const output=exports.git_execute(ptr,input.length);
          const length=exports.git_output_len();
          if(length>limits.maxBytes*3+limits.maxEntries*1024+limits.maxHttpBytes*2) throw new Error('Git output byte limit exceeded');
          result=JSON.parse(decoder.decode(new Uint8Array(exports.memory.buffer,output,length))) as Result;
        } finally { exports.git_free(ptr,input.length); }
        if(!result.request) break;
        if(!options.http) throw new Error('Git network transport is not configured');
        if(responses.length>=limits.maxHttpRequests) throw new Error('Git HTTP request limit exceeded');
        const request=result.request;
        const body=decode(request.body);
        httpBytes+=body.length;
        if(httpBytes>limits.maxHttpBytes) throw new Error('Git HTTP byte limit exceeded');
        const response=await options.http({...request,body,signal:context.signal});
        context.signal.throwIfAborted();
        httpBytes+=response.body.length;
        if(httpBytes>limits.maxHttpBytes) throw new Error('Git HTTP byte limit exceeded');
        responses.push({...response,body:encode(response.body)});
      }
      if(result.entries!==null) {
        let size=0;
        if(result.entries.length>limits.maxEntries) throw new Error('Git output entry limit exceeded');
        for(const e of result.entries) size+=encoder.encode(e.path).length+e.data.length/2;
        if(size>limits.maxBytes) throw new Error('Git output filesystem byte limit exceeded');
        await publish(context.fs,before,result.entries,context.signal);
      }
      await writeBytes(context.stdout,typeof result.stdoutBytes==='string' ? decode(result.stdoutBytes) : encoder.encode(result.stdout),context.signal);
      await writeBytes(context.stderr,encoder.encode(result.stderr),context.signal);
      return {exitCode:result.exitCode};
    } catch(error) {
      context.signal.throwIfAborted();
      await writeBytes(context.stderr,encoder.encode(`fatal: ${error instanceof Error ? error.message : 'Git execution failed'}\n`),context.signal);
      return {exitCode:128};
    }
  }};
}
export function createGitCommands(options:GitCommandsOptions={}):readonly CommandDefinition[] { return [createGitCommand(options)]; }
export function gitCommands(options:GitCommandsOptions={}):VirtualShellPlugin {
  const command=createGitCommand(options);
  return {name:'git-commands',setup(host){host.commands.register(command,{replace:options.replace ?? false});}};
}
