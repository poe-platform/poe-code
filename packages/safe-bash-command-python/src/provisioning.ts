import {header} from 'safe-bash-network-engine/shared';
import {bytesToHex} from 'safe-bash-io-engine/byte-encoding';
import {PythonInstallationRoot} from './installation-root.js';
import {PythonWheelIndex} from './wheel-index.js';
import {publishPythonBuildWheel} from './build-wheel.js';
import {stagePythonPackage} from "./package-download.js";
import {openPythonPackageFile} from './package-file.js';
import { sha256 } from '@noble/hashes/sha2.js';
import type { FileSystem } from "safe-bash-contracts/filesystem";
import { resolvePath as resolve, dirname, basename } from "safe-bash-contracts/path";
import type { HttpTransport, NetworkAuthorizer } from "safe-bash-network-engine/types";
import { inheritYieldCheckpoint } from "safe-bash-contracts/yield";
import { readPackageManifest, PythonPackageConflictError, type PythonPackageManifest, type PythonPackageManifestStore, type PythonInstalledSnapshot, type PythonPackageRecord } from './manifest.js';
import { createPythonPackageCache, pythonPackageRuntimeKey as runtimeKey, type PythonPackageCache } from './cache.js';

export type { PythonPackageCache } from './cache.js';
export interface PythonPackageProgress {
 readonly phase: 'download' | 'cached' | 'installed';
 readonly url?: string;
 readonly bytes?: number;
 readonly totalBytes?: number;
}
export interface PythonPackageInstallOptions {
 /** Limit selected versions without installing unrequested packages. */
 readonly constraints?:readonly string[];
 /** Local constraint files; nested -r entries remain requirements. */
 readonly constraintFiles?:readonly string[];
 /** Local source trees whose installed imports remain linked to caller storage. */
 readonly editable?: readonly string[];
 /** Include prerelease and development candidates during dependency resolution. */
 readonly pre?: boolean;
 /** Select the newest eligible requested roots, retaining satisfying dependencies. */
 readonly upgrade?: boolean;
 /** Reinstall the requested dependency graph even when installed versions satisfy it. */
 readonly forceReinstall?: boolean;
 /** Bypass artifact cache reads and writes; environment snapshots still persist. */
 readonly noCache?: boolean;
}
export interface PythonPackageOptions extends PythonPackageInstallOptions {
 /** Resolve sources and requirement-file option lines before installation; restored pins are unchanged. */
 readonly prepareRequirements?:(requirements:readonly string[],context:PythonPackagePrepareContext)=>Promise<readonly string[]>;
 readonly requirements?: readonly string[];
 readonly requirementFiles?: readonly string[];
 readonly profile?: 'documents';
 readonly offline?: boolean;
 readonly transport?: HttpTransport;
 readonly authorize?: NetworkAuthorizer;
 readonly cache?: PythonPackageCache;
 readonly manifestStore?: PythonPackageManifestStore;
 readonly scope?: string;
 /** Canonical cache directory. Network artifacts otherwise use caller cwd/.python-packages/cache; explicit buffered caches keep their own storage. */
 readonly cacheDirectory?: string;
 readonly maxDownloadBytes?: number;
 readonly maxManifestBytes?: number;
 readonly maxMetadataBytes?: number;
 readonly maxRequirementBytes?: number;
 /** Byte budget for the built-in memory cache; external cache retention belongs to its owner. */
 readonly maxCacheBytes?: number;
 readonly onProgress?: (event: PythonPackageProgress) => void;
}
export interface PythonPackageStart extends Omit<PythonPackageInstallOptions, 'noCache'|'editable'|'constraintFiles'> {
 readonly session: string;
 /** Load installer tooling even when no application requirements are installed. */
 readonly bootstrap?:boolean;
 /** Additional native runtime tooling, excluded from application inventory. */
 readonly bootstrapPackages?:readonly string[];
 /** Combined requirements for compatibility with custom executors. */
 readonly requirements: readonly string[];
 /** Legacy requirements need one dependency-resolution pass before migration. */
 readonly legacy?: boolean;
 /** Installed metadata used only by uninstall; application startup still restores code. */
 readonly records?: readonly PythonPackageRecord[] | undefined;
 /** Prior installation; only legacy manifests resolve dependencies during restore. */
 readonly restore?: readonly string[];
 /** New or host-configured requirements whose dependency closure is resolved. */
 readonly requested?: readonly string[];
 readonly uninstall?: { readonly packages: readonly string[]; readonly yes: boolean };
 readonly offline: boolean;
}
export interface PythonPackageContext { readonly fs: FileSystem; readonly cwd: string; readonly signal: AbortSignal }
export interface PythonPackagePrepareContext extends PythonPackageContext, PythonPackageInstallOptions, Partial<Pick<import('safe-bash-contracts').CommandContext,'env'|'stdout'|'stderr'|'registerCleanup'|'args'>> {
 readonly uninstall?: PythonPackageStart['uninstall'];
 readonly requirements?: readonly string[];
 readonly requirementFiles?: readonly string[];
 readonly offline?: boolean;
}
export interface PythonPackageEnvironment {
 prepare(context: PythonPackagePrepareContext): Promise<PythonPackageStart>;
 dispatch(operation: string, args: unknown[], context: PythonPackageContext): Promise<unknown>;
 finish(start: PythonPackageStart): void | Promise<void>;
 dispose(): Promise<void>;
}
export const pythonDocumentPackages: readonly string[] = Object.freeze([
 'lxml==6.0.2','pillow==12.2.0','python-docx==1.2.0','openpyxl==3.1.5','XlsxWriter==3.2.9',
 'pypdf==6.18.1','fpdf2==2.8.8','fonttools==4.65.0','defusedxml==0.7.1','et-xmlfile==2.0.0','typing-extensions==4.16.0',
]);
const encoder = new TextEncoder();
const decoder = new TextDecoder();
function digest(value: Uint8Array): string { return bytesToHex(sha256(value)); }
function validDigest(value: unknown): value is string {
 if(typeof value!=='string'||value.length!==64)return false;
 for(const char of value)if(!'0123456789abcdef'.includes(char))return false;
 return true;
}
function failure(message: string, cause?: unknown): Error & {code:string} { return Object.assign(new Error(message,{cause}),{code:'EPACKAGE'}); }
function missing(error: unknown): boolean { return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'; }
function* requirementLines(source:string):Generator<string> {
 let start=0,pending='';
 for(let end=0;end<=source.length;end++) {
  if(end<source.length&&!"\n\r\v\f\x1c\x1d\x1e\u0085\u2028\u2029".includes(source[end]!))continue;
  let line=source.slice(start,end);
  if(source[end]==='\r'&&source[end+1]==='\n')end++;
  start=end+1;
  if(line.trimStart()[0]==='#')line=' '+line;
  else if(line.endsWith('\\')) {
   let first=0,last=line.length;
   while(line[first]==='\\')first++;
   while(line[last-1]==='\\')last--;
   pending+=line.slice(first,last);continue;
  }
  yield pending+line;pending='';
 }
 yield pending;
}
function expandRequirement(source:string,env:Readonly<Record<string,string|undefined>>={}):string {
 let text=source;
 for(let start=source.indexOf('${');start>=0;start=source.indexOf('${',start+2)){
  let end=start+2;
  while(end<source.length&&'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_'.includes(source[end]!))end++;
  if(end===start+2||source[end]!=='}')continue;
  const name=source.slice(start+2,end),value=Object.hasOwn(env,name)&&env[name];
  if(value)text=text.replaceAll(source.slice(start,end+1),()=>value);
 }
 return text;
}
function requirementInclude(line:string):readonly [string,boolean]|undefined {
 if(!['-r','-c','--requirem','--const'].some(prefix=>line.startsWith(prefix)))return;
 const words:string[]=[];let word='',quote='',active=false;
 for(let index=0;index<line.length;index++){
  const char=line[index]!;
  if(char==='\\'&&quote!=="'"){
   const next=line[++index];if(next===undefined)throw failure('No escaped character');
   if(quote&&next!==quote&&next!=='\\')word+='\\';
   word+=next;active=true;
  }else if(quote){if(char===quote)quote='';else word+=char;}
  else if(char==='"'||char==="'"){quote=char;active=true;}
  else if(' \t\r\n'.includes(char)){if(active){words.push(word);word='';active=false;}}
  else{word+=char;active=true;}
 }
 if(quote)throw failure('No closing quotation');
 if(active)words.push(word);
 let included:string|undefined,constrained:string|undefined;
 for(let index=0;index<words.length;index++){
  const word=words[index]!,option=word.split('=',1)[0]!;
  const kind=['requirement','constraint'].find(name=>word.startsWith('-'+name[0])||option.startsWith('--'+name.slice(0,name==='requirement'?8:5))&&('--'+name).startsWith(option));
  if(!kind){if(word.startsWith('-'))throw failure(`Unsupported requirement option: ${word}`);continue;}
  const path=word.startsWith('--')?(word.length===option.length?words[++index]:word.slice(option.length+1)):(word.length===2?words[++index]:word.slice(2));
  if(path===undefined)throw failure(`Requirement option needs a file: ${word}`);
  if(kind==='requirement')included??=path;else constrained??=path;
 }
 return included!==undefined?[included,false]:constrained!==undefined?[constrained,true]:undefined;
}
function normalizeRequirement(value: string, cwd: string): string {
 const requirement = value.trim();
 if (!requirement || requirement.startsWith('-')) throw failure(`Unsupported requirement: ${value}`);
 if (requirement.endsWith('.whl') && !requirement.includes('://')) return 'file://' + resolve(cwd,requirement).split('/').map(encodeURIComponent).join('/');
 return requirement;
}
interface PackageArtifact {url?:string;readonly key:string;readonly size:number;read(offset:number,length:number):Uint8Array|Promise<Uint8Array>;close?():Promise<void>}
interface Session extends PythonPackageContext {
 readonly cacheDirectory: string | undefined;
 readonly artifactDirectory: string | undefined;
 readonly noCache: boolean;
 readonly cache: PythonPackageCache;
 readonly offline: boolean;
 readonly requirements: readonly string[];
 opened?: PackageArtifact | undefined;
 readonly retained:Map<string,PackageArtifact>;
 wheelIndex?:PythonWheelIndex|undefined;
 installationRoot?:PythonInstallationRoot|undefined;
 retiring?: Promise<void>;
 retaining?: Promise<void> | undefined;
 opening: boolean;
 closed: boolean;
 readonly manifest: string;
 readonly manifestCache: PythonPackageCache;
 readonly manifestRevision: string | undefined;
 readonly controller: AbortController;
 readonly aborted: () => void;
}

function artifactKey(digest:string):string {return runtimeKey+'-sha256-'+digest;}

/** Trusted host cache; content is rehashed on every read. No runtime or network work at construction. */
export function createPythonPackageEnvironment(options: PythonPackageOptions = {}): PythonPackageEnvironment {
 if (options.cache && options.cacheDirectory) throw new TypeError('Choose package cache or cacheDirectory, not both');
 if (options.manifestStore && (typeof options.scope !== 'string' || !options.scope.trim())) throw new TypeError('Shared Python manifests require an explicit nonempty scope');
 if (options.scope !== undefined && !options.manifestStore) throw new TypeError('Python scope requires a manifestStore');
 const manifestKey = runtimeKey+'-environment'+(options.manifestStore ? '-'+digest(encoder.encode(JSON.stringify(options.scope))) : '');
 if (options.profile !== undefined && options.profile !== 'documents') throw new TypeError('Unknown Python package profile');
 const maxBytes = options.maxDownloadBytes ?? Infinity;
 const maxManifestBytes = options.maxManifestBytes ?? Infinity;
 const maxMetadataBytes = options.maxMetadataBytes ?? Infinity;
 for (const name of ['maxDownloadBytes', 'maxManifestBytes', 'maxMetadataBytes', 'maxRequirementBytes', 'maxCacheBytes'] as const) {
  const value = options[name];
  if (value !== undefined && (!Number.isSafeInteger(value) || value < 1)) throw new RangeError(`${name} must be a positive integer`);
 }
 const checkManifest=(bytes:Uint8Array|undefined)=>{
  if(bytes&&bytes.length>maxManifestBytes)throw failure('Python package manifest exceeds maxManifestBytes');
 };
 const checkMetadata=(bytes:Uint8Array)=>{
  if(bytes.length>maxMetadataBytes)throw failure('Python package cache metadata exceeds maxMetadataBytes');
  return bytes;
 };
 const cacheRecord=(key:string,headers:readonly(readonly[string,string])[],url:string)=>checkMetadata(encoder.encode(JSON.stringify({digest:key,headers,url})));
 const defaultCache = createPythonPackageCache({maxBytes:options.maxCacheBytes});
 const sessions = new Map<string,Session>();
 const controller = new AbortController();
 const pending = new Set<Promise<unknown>>();
 let cleanupFailure: {error:unknown} | undefined;
 const track=<T>(work:Promise<T>,cleanup=false):Promise<T>=>{
  pending.add(work);
  void work.then(()=>pending.delete(work),error=>{if(cleanup)cleanupFailure??={error};pending.delete(work);});
  return work;
 };
 function release(session:Session,all=false):Promise<void> {
  const artifacts:Array<Pick<PackageArtifact,'close'>>=all?[...session.retained.values()]:[];
  if(all&&session.wheelIndex){artifacts.push(session.wheelIndex);session.wheelIndex=undefined;}
  if(all)session.retained.clear();
  if(session.closed&&session.installationRoot){artifacts.push(session.installationRoot);session.installationRoot=undefined;}
  if(session.opened){artifacts.push(session.opened);session.opened=undefined;}
  if(!artifacts.length)return session.retiring??Promise.resolve();
  return track(session.retiring=Promise.allSettled([session.retiring,...artifacts.map(artifact=>Promise.resolve().then(()=>artifact.close?.()))]).then(results=>{
   for(const result of results)if(result.status==='rejected')throw result.reason;
  }),true);
 }
 let disposed = false;
 let disposing: Promise<void> | undefined;
 const admit = <Args extends unknown[], Result>(operation: (...args: Args) => Promise<Result>) => (...args: Args): Promise<Result> => track(Promise.resolve().then(()=>{
  if(disposed)throw failure('Python package environment is disposed');
  return operation(...args);
 }));
 let counter = 0;
 let committing = Promise.resolve();
 async function prepare(input: PythonPackagePrepareContext): Promise<PythonPackageStart> {
  const invocation = new AbortController();
  const signal = AbortSignal.any([input.signal, controller.signal, invocation.signal]);
  inheritYieldCheckpoint(input.signal, signal);
  const context = { ...input, signal };
  signal.throwIfAborted();
  const directory = options.cacheDirectory === undefined ? undefined : resolve(context.cwd,options.cacheDirectory,runtimeKey);
  const noCache=context.noCache??options.noCache??false;
  // Keep the implicit environment manifest in its original owner. Artifact
  // payloads default to caller storage instead of an unbounded memory cache.
  const artifactDirectory=directory??(!options.cache&&!noCache?resolve(context.cwd,'.python-packages','cache',runtimeKey):undefined);
  const cache = options.cache ?? (!artifactDirectory ? defaultCache : {
   async get(key: string) { try { return await context.fs.readFile(resolve(artifactDirectory,key),{signal}); } catch(error) { if(missing(error))return undefined;throw error; } },
   async set(key: string,bytes:Uint8Array) { await context.fs.mkdir(artifactDirectory,{recursive:true,signal});await context.fs.writeFile(resolve(artifactDirectory,key),bytes,{signal}); },
  });
  const manifestCache = directory ? cache : defaultCache;
  let snapshot: PythonPackageManifest | undefined;
  if(options.manifestStore) {
   try { snapshot=await options.manifestStore.get(manifestKey,context); }
   catch(error) { signal.throwIfAborted();throw failure('Cannot read Python package environment manifest',error); }
  }
  signal.throwIfAborted();
  if(snapshot!==undefined && (typeof snapshot!=='object' || snapshot===null || typeof snapshot.revision!=='string' || !snapshot.revision || snapshot.revision.length>1024 || !(snapshot.bytes instanceof Uint8Array))) throw failure('Invalid Python package manifest snapshot');
  const manifestRevision = snapshot?.revision;
  const stored = options.manifestStore ? snapshot?.bytes : await manifestCache.get(manifestKey);
  signal.throwIfAborted();
  checkManifest(stored);
  const manifest = stored === undefined ? '' : decoder.decode(stored);
  let previous: unknown;
  try { previous = stored === undefined ? [] : JSON.parse(manifest); } catch { /* Malformed JSON follows the same manifest validation below. */ }
  const saved = readPackageManifest(previous);
  if (!saved) throw failure('Invalid Python package environment manifest');
  const legacy = Array.isArray(previous);
  const restore = saved.map(value=>normalizeRequirement(value,context.cwd));
  const requirements = [...(options.profile ? pythonDocumentPackages:[]),...(options.requirements??[]),...(context.requirements??[])].map(value=>normalizeRequirement(value,context.cwd));
  const constraints=[...options.constraints??[],...context.constraints??[]];
  const activeFiles=new Set<string>();let requirementBytes=0;
  const readRequirements=async(path:string,constraint=false):Promise<void>=>{
   signal.throwIfAborted();
   let source:string,identity:string;
   try {
    identity=await context.fs.realpath(path,{signal});
    if(activeFiles.has(identity))throw failure(`Recursive Python requirements: ${path}`);
    activeFiles.add(identity);
    const bytes=await context.fs.readFile(path,{signal,...options.maxRequirementBytes!==undefined?{maxBytes:options.maxRequirementBytes-requirementBytes}:{}});
    requirementBytes+=bytes.length;
    if(requirementBytes>(options.maxRequirementBytes??Infinity))throw failure('Python requirements byte limit exceeded');
    source=decoder.decode(bytes);
   } catch(error) { signal.throwIfAborted();throw failure(`Cannot read Python requirements ${path}: ${error instanceof Error ? error.message : String(error)}`); }
   for (const line of requirementLines(source)) {
    // Only whitespace-delimited hashes begin comments; URL integrity fragments survive.
    let comment=line.indexOf('#');
    while(comment>0&&line[comment-1]!.trim())comment=line.indexOf('#',comment+1);
    const text=(comment<0?line:line.slice(0,comment)).trim(); if (!text)continue;
    const expanded=expandRequirement(text,context.env);
    const included=requirementInclude(expanded);
    if(included!==undefined)await readRequirements(resolve(dirname(path),included[0]),included[1]);
    else (constraint?constraints:requirements).push(expanded[0]==='-'&&options.prepareRequirements?expanded:normalizeRequirement(expanded,dirname(path)));
   }
   activeFiles.delete(identity);
  };
  for(const file of [...options.requirementFiles??[],...context.requirementFiles??[]])await readRequirements(resolve(context.cwd,file));
  for(const file of [...options.constraintFiles??[],...context.constraintFiles??[]])await readRequirements(resolve(context.cwd,file),true);
  if((options.editable?.length||context.editable?.length)&&!options.prepareRequirements)throw failure('Editable packages require a source package environment');
  const requested=[...new Set(await options.prepareRequirements?.(requirements,context)??requirements)];
  signal.throwIfAborted();
  const session=String(++counter);
  const unique=[...new Set([...restore,...requested])];
  const aborted=()=>{const current=sessions.get(session);if(current){current.closed=true;void release(current,true);}};
  const offline=context.offline??options.offline??false;
  sessions.set(session,{...context,cacheDirectory:directory,artifactDirectory,noCache,cache,manifestCache,manifestRevision,controller:invocation,offline,requirements:unique,opening:false,retained:new Map(),closed:false,manifest,aborted});
  signal.addEventListener('abort',aborted,{once:true});
  const controls: {pre?:boolean;upgrade?:boolean;forceReinstall?:boolean}={};
  for(const key of ['pre','upgrade','forceReinstall'] as const)if(context[key]??options[key])controls[key]=true;
  return {session,requirements:unique,restore,requested,...constraints.length?{constraints:[...new Set(constraints)]}:{},legacy,records:(previous as {records?:readonly PythonPackageRecord[]}).records,...controls,...input.uninstall ? {uninstall:input.uninstall} : {},offline};
 }
 async function dispatch(op:string,args:unknown[],_context:PythonPackageContext):Promise<unknown> {
  _context.signal.throwIfAborted();
  const session=sessions.get(String(args[0]))!;
  function check():void {
   session?.signal.throwIfAborted();
   if(!session||session.closed)throw failure('Python package session is closed');
  }
  check();
  const {fs,signal,cwd,cacheDirectory:configuredCache}=session;
  const settings={signal};
  if(op==='package-commit') {
   await release(session,true);check();
   const pinned=args[1];
   const saved=readPackageManifest(pinned);
   if(!saved)throw failure('Invalid installed package manifest');
   // Legacy executors publish supplemental pins. Modern executors publish the
   // complete installed state, so removed roots cannot reappear on startup.
   const state=Array.isArray(pinned) ? [...new Set([...session.requirements,...saved])] : {...(pinned as PythonInstalledSnapshot),installed:[...new Set(saved)]};
   const manifestBytes=encoder.encode(JSON.stringify(state));
   checkManifest(manifestBytes);
   const commit = committing.then(async()=>{
    check();
    if(options.manifestStore) {
     const committed=await options.manifestStore.compareAndSet(manifestKey,session.manifestRevision,manifestBytes,settings);
     check();
     if(typeof committed!=='boolean')throw failure('Invalid Python package manifest publication result');
     if(!committed)throw new PythonPackageConflictError();
    } else {
     const current = await session.manifestCache.get(manifestKey);
     check();
     checkManifest(current);
     if ((current===undefined?'':decoder.decode(current))!==session.manifest) throw new PythonPackageConflictError();
     await session.manifestCache.set(manifestKey,manifestBytes);
    }
    check();
   });
   committing=commit.catch(()=>{});
   await commit;
   options.onProgress?.({phase:'installed'});
   return null;
  }
  const root=op==='package-root';
  if(root||op==='package-index'&&args[1]==='start'){
   if(root&&session.installationRoot)return session.installationRoot.path();
   let directory=configuredCache?dirname(configuredCache):cwd;
   if(configuredCache){
    const caps=await fs.capabilitiesFor?.(directory,{signal,create:true})??fs.capabilities;
    if(root?!caps.atomicTreeRemoval:!caps.retainedRead||!caps.retainedStagingWrite||!caps.retainedStagingCleanup)directory=cwd;
   }
   check();
   const storage={fs,signal,cwd:directory};
   if(root)return (session.installationRoot??=new PythonInstallationRoot(storage)).path();
   if(session.wheelIndex)throw failure('Python wheel index already open');
   session.wheelIndex=new PythonWheelIndex(storage);
   return null;
  }
  if(op==='package-index'){
   const operation=args[1];
   if(operation==='close'){
    const index=session.wheelIndex;session.wheelIndex=undefined;
    await index?.close();return null;
   }
   if(!session.wheelIndex)throw failure('Python wheel index is closed');
   return session.wheelIndex.execute(operation,args.slice(2));
  }
  if(op==='package-read'||op==='package-read-retained') {
   const artifact=op==='package-read'?session.opened:session.retained.get(String(args[1])),offset=args[2],length=args[3];
   if(!artifact||(op==='package-read'&&artifact.key!==String(args[1]))||!Number.isSafeInteger(offset)||!Number.isSafeInteger(length)||(offset as number)<0||(length as number)<1||(length as number)>65536)throw failure('Invalid package chunk request');
   const bytes=await artifact.read(offset as number,length as number);check();return Array.from(bytes);
  }
  if(op==='package-retain'){
   let artifact=session.opened;
   if(!artifact||artifact.key!==String(args[1]))throw failure('Invalid package retention request');
   if(artifact.url&&artifact.close){
    const source=artifact;
    const retaining=(async()=>{
    const path=decodeURIComponent(new URL(source.url!).pathname);
    if(!fs.confineExtraction||!fs.prepareDirectory)return;
    const fallback=resolve(cwd,'.python-packages','installed');
    let directory=configuredCache?resolve(configuredCache,'installed'):fallback,probe=directory;
    const required=['retainedStagingWrite','retainedStagingCleanup','retainedRead','atomicFileStaging'] as const;
    for(;;){
     try{
      const capabilities=await fs.capabilitiesFor?.(probe,settings)??fs.capabilities;
      if(required.every(key=>capabilities[key]))break;
      if(directory===fallback)return;
      probe=directory=fallback;
     }catch(error){check();if(!missing(error)||dirname(probe)===probe)throw error;probe=dirname(probe);}
    }
    await fs.mkdir(directory,{recursive:true,signal});
    const target=resolve(directory,source.key,basename(path));
    if(path!==target||probe!==directory){
     check();
     session.opened=undefined;
     const published=await publishPythonBuildWheel({filename:basename(path),artifact:source},directory,maxBytes,session);
     artifact=await openPythonPackageFile(session,decodeURIComponent(new URL(published.url).pathname),maxBytes);
     if(!artifact)throw failure('Installed Python wheels require retained reads');
     if(artifact.key!==published.digest){await artifact.close?.();throw failure('Installed Python wheel changed');}
     session.opened=artifact;
     artifact.url=published.url;
     try{check();}catch(error){await release(session);throw error;}
    }
    const durable=new URL(artifact!.url!);durable.hash='sha256='+artifact!.key;artifact!.url=durable.href;
    })();
    session.retaining=retaining;
    try{await retaining;}finally{session.retaining=undefined;}
   }
   check();
   if(!artifact)throw failure('Installed Python wheel unavailable');
   const token=String(++counter);
   session.retained.set(token,artifact);session.opened=undefined;
   return {token,key:artifact.key,size:artifact.size,...artifact.url?{url:artifact.url}:{}};
  }
  if(op==='package-close') {if(session.opened?.key===String(args[1]))await release(session);return null;}
  if(op!=='package-open'||typeof args[1]!=='string')throw failure('Invalid package operation');
  if(session.opening||session.retaining)throw failure('Package download already in progress');
  session.opening=true;
  try {
  await release(session);check();
  const url=args[1],{artifactDirectory:cacheDirectory,noCache}=session;const expected=args[2];let responseUrl=url;
  const verifyIntegrity=(key:string)=>{if(expected&&key!==expected)throw failure(`Package integrity mismatch: ${url}`);};
  if(expected!==undefined && expected!==null && !validDigest(expected))throw failure('Invalid SHA-256 package integrity value');
  const address=runtimeKey+'-url-'+digest(encoder.encode(url));
  const canonicalWheel=url.startsWith('file:')||url.startsWith('emfs:');
  // Index responses describe mutable candidates; only offline sessions replay them.
  const metadata=canonicalWheel||noCache||(args[3]==='metadata'&&!session.offline)?undefined:await session.cache.get(address);
  check();
  let key="",bytes:Uint8Array|undefined;let headers:readonly(readonly[string,string])[]=[];
  const adopt=async(artifact:PackageArtifact,ready:()=>void|Promise<void>)=>{
   session.opened=artifact;
   if(canonicalWheel)artifact.url=url;
   try{check();await ready();check();return {key:artifact.key,size:artifact.size,headers,url:responseUrl};}
   catch(error){await release(session);throw error;}
  };
  const openArtifact=async(source:string)=>{
   const retained=await openPythonPackageFile(session,source,maxBytes);
   if(retained)return retained;
   const capabilities=await fs.capabilitiesFor?.(source,settings)??fs.capabilities;
   if(capabilities.streamingRead&&fs.readStream){
    for(const directory of configuredCache?[configuredCache,cwd]:[cwd]){
     if(directory!==cwd)await fs.mkdir(directory,{recursive:true,signal});
     const body=(async function*(){yield* fs.readStream!(source,settings);})();
     const staged=await stagePythonPackage(session,directory,body,maxBytes);
     if(staged)return staged;
    }
   }
  };
  if(metadata){
   checkMetadata(metadata);
   let record: {digest:string,url?:string,headers:readonly(readonly[string,string])[]} | undefined;
   try { record=JSON.parse(decoder.decode(metadata)) as typeof record; } catch { /* Invalid JSON follows the same validation path as malformed records. */ }
   if(typeof record!=='object'||record===null||!validDigest(record.digest)||record.url!==undefined&&typeof record.url!=='string'||!Array.isArray(record.headers)||record.headers.some(pair=>!Array.isArray(pair)||pair.length!==2||pair.some(value=>typeof value!=='string')))throw failure(`Invalid package cache metadata: ${url}`);
   headers=record.headers;responseUrl=record.url??url;
   let absent=false;
   if(cacheDirectory){
    let artifact;
    try{artifact=await openArtifact(resolve(cacheDirectory,artifactKey(record.digest)));}catch(error){if(!missing(error))throw error;absent=true;}
    if(artifact){
     return await adopt(artifact,()=>{if(artifact.key!==record.digest)throw failure(`Package cache integrity mismatch: ${url}`);verifyIntegrity(artifact.key);options.onProgress?.({phase:'cached',url,bytes:artifact.size});});
    }
   }
   bytes=absent?undefined:await session.cache.get(artifactKey(record.digest));
   check();
   if(bytes && bytes.length>maxBytes)throw failure('Cached package exceeds maxDownloadBytes');
   // Cache implementations may lend mutable buffers; retain the bytes we authenticate.
   if(bytes)bytes=Uint8Array.from(bytes);
   if(bytes && (key=digest(bytes))!==record.digest)throw failure(`Package cache integrity mismatch: ${url}`);
   if(bytes)options.onProgress?.({phase:'cached',url,bytes:bytes.length});
  }
  if(!bytes){
   if(canonicalWheel){
    const path = new URL(url);
    if(path.host && path.host!=='localhost')throw failure('Local wheels must use the canonical filesystem');
    try {
     const source=decodeURIComponent(path.pathname);
     const artifact=await openArtifact(source);
     if(artifact){
      return await adopt(artifact,()=>verifyIntegrity(artifact.key));
     }
     bytes=Uint8Array.from(await fs.readFile(source,{signal,...Number.isFinite(maxBytes)?{maxBytes}:{} })); } catch(error) { check();throw failure(`Cannot read canonical Python wheel ${path.pathname}: ${error instanceof Error ? error.message : String(error)}`); }
   }else{
    if(session.offline)throw failure(`Offline package cache miss: ${url}`);
    if(!options.transport||!options.authorize)throw failure('Python package download requires configured transport and authorization');
    let current=new URL(url);let redirectFrom:string|undefined;
    for(let redirect=0;;redirect++){
     if(current.protocol!=='https:'&&current.protocol!=='http:')throw failure(`Unsupported package transport protocol: ${current.protocol}`);
     if(current.username||current.password)throw failure('Package URLs with credentials are unsupported');
     let denyPrivate=false;
     const allowed=await options.authorize({url:current.href,method:'GET',attempt:0,signal,...redirectFrom===undefined?{}:{redirectFrom},requirePrivateNetworkDeny(){denyPrivate=true;}});
     check();
     if(!allowed)throw failure(`Python package download authorization denied: ${current.href}`);
     if(denyPrivate&&!options.transport.supportsPrivateNetworkDeny)throw failure('Package transport cannot enforce private network denial');
     check();
     const response=await options.transport({url:current.href,method:'GET',headers:[['accept','application/vnd.pypi.simple.v1+json, application/json;q=0.9, */*;q=0.1']],signal,...denyPrivate?{denyPrivateNetworks:true}:{}});
     try{
      check();
      if([301,302,303,307,308].includes(response.status)){
       if(redirect>=5)throw failure('Too many package redirects');
       const location=header(response.headers,'location');if(!location)throw failure('Package redirect has no location');
       redirectFrom=current.href;current=new URL(location,current);continue;
      }
      if(response.status<200||response.status>=300)throw failure(`Package download failed: HTTP ${response.status} ${current.href}`);
      headers=response.headers;responseUrl=current.href;
      const encoding=header(headers,'content-encoding')?.trim().toLowerCase();
      const length=header(headers,'content-length');const total=length===undefined||(encoding!==undefined&&encoding!=='identity')?undefined:Number(length);
      if(Number.isFinite(total)&&total!>maxBytes)throw failure('Package download exceeds maxDownloadBytes');
      const progress=(count:number)=>options.onProgress?.({phase:'download',url,bytes:count,...Number.isSafeInteger(total)?{totalBytes:total!}:{}});
      if(cacheDirectory||noCache){
       const directory=cacheDirectory??cwd;
       if(cacheDirectory)await fs.mkdir(directory,{recursive:true,signal});
       let metadataBytes:Uint8Array|undefined;
       const verify=(key:string)=>{
        verifyIntegrity(key);
        if(!noCache)metadataBytes=cacheRecord(key,headers,responseUrl);
       };
       const destination=(key:string)=>resolve(directory,artifactKey(key));
       let artifact=await stagePythonPackage(session,directory,response.body,maxBytes,progress,verify,noCache?undefined:destination);
       let streamed=false;
       if(!artifact&&directory!==cwd&&(noCache||fs.writeStream&&(await fs.capabilitiesFor?.(directory,settings)??fs.capabilities).streamingWrite)){
        artifact=await stagePythonPackage(session,cwd,response.body,maxBytes,progress,verify);
        streamed=true;
       }
       if(artifact){
        const retained=artifact;
        return await adopt(retained,async()=>{
         if(!noCache){
          if(streamed)await fs.writeStream!(destination(retained.key),(async function*(){
           for(let offset=0;offset<retained.size;){const chunk=await retained.read(offset,65536);offset+=chunk.length;yield chunk;}
          })(),settings);
          check();
          await session.cache.set(address,metadataBytes!);
         }
        });
       }
      }
      const chunks:Uint8Array[]=[];let count=0;
      for await(const chunk of response.body){check();if(chunk.length===0)continue;count+=chunk.length;if(count>maxBytes)throw failure('Package download exceeds maxDownloadBytes');chunks.push(Uint8Array.from(chunk));progress(count);}
      bytes=new Uint8Array(count);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
      break;
     }finally{await response.dispose();}
    }
   }
   check();
   verifyIntegrity(key=digest(bytes));
   if(!noCache){
   const metadataBytes=cacheRecord(key,headers,responseUrl);
   await session.cache.set(artifactKey(key),Uint8Array.from(bytes));
   check();
   if(!canonicalWheel)await session.cache.set(address,metadataBytes);
   }
  }
  check();
  verifyIntegrity(key);
  const value=bytes;session.opened={key,size:bytes.length,...canonicalWheel?{url}:{},read:(offset,length)=>value.subarray(offset,offset+length)};
  return {key,size:bytes.length,headers,url:responseUrl};
  } finally {session.opening=false;}
 }
 return {
  prepare:admit(prepare),dispatch:admit(dispatch),
  finish(start:PythonPackageStart){
   const session=sessions.get(start.session);
   if(session){session.closed=true;session.signal.removeEventListener('abort',session.aborted);session.controller.abort(failure('Python package session is closed'));sessions.delete(start.session);const retired=release(session,true);return Promise.allSettled([session.retaining,retired]).then(async()=>{try{await retired;}finally{await release(session,true);}});}
  },
  dispose(){
   if(!disposing){
    disposed=true;
    controller.abort(failure('Python package environment is disposed'));
    disposing=Promise.allSettled([...pending]).then(()=>{sessions.clear();defaultCache.dispose();if(cleanupFailure)throw cleanupFailure.error;});
   }
   return disposing;
  },
 };
}
