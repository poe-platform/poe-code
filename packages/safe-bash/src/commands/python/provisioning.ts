import { sha256 } from '@noble/hashes/sha2.js';
import type { FileSystem } from '../../contracts/filesystem.js';
import { resolvePath as resolve, dirname } from '../../contracts/path.js';
import type { HttpTransport, NetworkAuthorizer } from '../network/types.js';
import { inheritYieldCheckpoint } from '../../contracts/yield.js';
import { PythonPackageConflictError, type PythonPackageManifest, type PythonPackageManifestStore } from './manifest.js';
import { createPythonPackageCache, pythonPackageRuntimeKey as runtimeKey, type PythonPackageCache } from './cache.js';

export type { PythonPackageCache } from './cache.js';
export interface PythonPackageProgress {
 readonly phase: 'download' | 'cached' | 'installed';
 readonly url?: string;
 readonly bytes?: number;
 readonly totalBytes?: number;
}
export interface PythonPackageOptions {
 readonly requirements?: readonly string[];
 readonly requirementFiles?: readonly string[];
 readonly profile?: 'documents';
 readonly offline?: boolean;
 readonly transport?: HttpTransport;
 readonly authorize?: NetworkAuthorizer;
 readonly cache?: PythonPackageCache;
 readonly manifestStore?: PythonPackageManifestStore;
 readonly scope?: string;
 /** Canonical filesystem directory, scoped to this package environment. */
 readonly cacheDirectory?: string;
 readonly maxDownloadBytes?: number;
 /** Byte budget for the built-in memory cache; external cache retention belongs to its owner. */
 readonly maxCacheBytes?: number;
 readonly onProgress?: (event: PythonPackageProgress) => void;
}
export interface PythonPackageStart { readonly session: string; readonly requirements: readonly string[]; readonly offline: boolean }
export interface PythonPackageContext { readonly fs: FileSystem; readonly cwd: string; readonly signal: AbortSignal }
export interface PythonPackagePrepareContext extends PythonPackageContext {
 readonly requirements?: readonly string[];
 readonly requirementFiles?: readonly string[];
 readonly offline?: boolean;
}
export interface PythonPackageEnvironment {
 prepare(context: PythonPackagePrepareContext): Promise<PythonPackageStart>;
 dispatch(operation: string, args: unknown[], context: PythonPackageContext): Promise<unknown>;
 finish(start: PythonPackageStart): void;
 dispose(): Promise<void>;
}
export const pythonDocumentPackages: readonly string[] = Object.freeze([
 'lxml==6.0.2','pillow==12.2.0','python-docx==1.2.0','openpyxl==3.1.5','XlsxWriter==3.2.9',
 'pypdf==6.18.1','fpdf2==2.8.8','fonttools==4.65.0','defusedxml==0.7.1','et-xmlfile==2.0.0','typing-extensions==4.16.0',
]);
const encoder = new TextEncoder();
const decoder = new TextDecoder();
function digest(value: Uint8Array): string { return Array.from(sha256(value),byte=>byte.toString(16).padStart(2,'0')).join(''); }
function failure(message: string, cause?: unknown): Error & {code:string} { return Object.assign(new Error(message,{cause}),{code:'EPACKAGE'}); }
function missing(error: unknown): boolean { return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'; }
function normalizeRequirement(value: string, cwd: string): string {
 const requirement = value.trim();
 if (!requirement || requirement.startsWith('-')) throw failure(`Unsupported requirement: ${value}`);
 if (requirement.endsWith('.whl') && !requirement.includes('://')) return 'file://' + resolve(cwd,requirement).split('/').map(encodeURIComponent).join('/');
 return requirement;
}
interface Session extends PythonPackageContext {
 readonly cache: PythonPackageCache;
 readonly offline: boolean;
 readonly requirements: readonly string[];
 readonly opened: Map<string, Uint8Array>;
 opening: boolean;
 closed: boolean;
 readonly manifest: string;
 readonly manifestCache: PythonPackageCache;
 readonly manifestRevision: string | undefined;
 readonly controller: AbortController;
 readonly aborted: () => void;
}

function checkSession(session: Session): void {
 session.signal.throwIfAborted();
 if(session.closed)throw failure('Python package session is closed');
}

/** Trusted host cache; content is rehashed on every read. No runtime or network work at construction. */
export function createPythonPackageEnvironment(options: PythonPackageOptions = {}): PythonPackageEnvironment {
 if (options.cache && options.cacheDirectory) throw new TypeError('Choose package cache or cacheDirectory, not both');
 if (options.manifestStore && (typeof options.scope !== 'string' || !options.scope.trim() || options.scope.length > 1024)) throw new TypeError('Shared Python manifests require an explicit nonempty scope');
 if (options.scope !== undefined && !options.manifestStore) throw new TypeError('Python scope requires a manifestStore');
 const manifestKey = options.manifestStore ? runtimeKey+'-environment-'+digest(encoder.encode(JSON.stringify(options.scope))) : runtimeKey+'-environment';
 if (options.profile !== undefined && options.profile !== 'documents') throw new TypeError('Unknown Python package profile');
 const maxBytes = options.maxDownloadBytes ?? 64 * 1024 * 1024;
 if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new RangeError('maxDownloadBytes must be a positive integer');
 const maxCacheBytes = options.maxCacheBytes ?? 128 * 1024 * 1024;
 if (!Number.isSafeInteger(maxCacheBytes) || maxCacheBytes < 1) throw new RangeError('maxCacheBytes must be a positive integer');
 const defaultCache = createPythonPackageCache({maxBytes:maxCacheBytes});
 const sessions = new Map<string,Session>();
 const controller = new AbortController();
 const pending = new Set<Promise<unknown>>();
 let disposed = false;
 let disposing: Promise<void> | undefined;
 const admit = <Args extends unknown[], Result>(operation: (...args: Args) => Promise<Result>) => (...args: Args): Promise<Result> => {
  if(disposed)return Promise.reject(failure('Python package environment is disposed'));
  const work=Promise.resolve().then(()=>{if(disposed)throw failure('Python package environment is disposed');return operation(...args);});
  pending.add(work);
  void work.then(()=>{pending.delete(work);},()=>{pending.delete(work);});
  return work;
 };
 let counter = 0;
 let committing = Promise.resolve();
 async function prepare(input: PythonPackagePrepareContext): Promise<PythonPackageStart> {
  const invocation = new AbortController();
  const signal = AbortSignal.any([input.signal, controller.signal, invocation.signal]);
  inheritYieldCheckpoint(input.signal, signal);
  const context = { ...input, signal };
  context.signal.throwIfAborted();
  const directory = options.cacheDirectory === undefined ? undefined : resolve(context.cwd,options.cacheDirectory,runtimeKey);
  const cache = options.cache ?? (directory === undefined ? defaultCache : {
   async get(key: string) { try { return await context.fs.readFile(resolve(directory,key),{signal:context.signal,maxBytes}); } catch(error) { if(missing(error))return undefined;throw error; } },
   async set(key: string,bytes:Uint8Array) { await context.fs.mkdir(directory,{recursive:true,signal:context.signal});await context.fs.writeFile(resolve(directory,key),bytes,{signal:context.signal}); },
  });
  const manifestCache = options.cacheDirectory === undefined ? defaultCache : cache;
  let snapshot: PythonPackageManifest | undefined;
  if(options.manifestStore) {
   try { snapshot=await options.manifestStore.get(manifestKey,context); }
   catch(error) { context.signal.throwIfAborted();throw failure('Cannot read Python package environment manifest',error); }
  }
  context.signal.throwIfAborted();
  if(snapshot!==undefined && (typeof snapshot!=='object' || snapshot===null || typeof snapshot.revision!=='string' || !snapshot.revision || snapshot.revision.length>1024 || !(snapshot.bytes instanceof Uint8Array))) throw failure('Invalid Python package manifest snapshot');
  const manifestRevision = snapshot?.revision;
  const stored = options.manifestStore ? snapshot?.bytes : await manifestCache.get(manifestKey);
  context.signal.throwIfAborted();
  if(stored && stored.length>maxBytes)throw failure('Python package manifest exceeds maxDownloadBytes');
  const manifest = stored === undefined ? '' : decoder.decode(stored);
  let previous: unknown;
  try { previous = stored === undefined ? [] : JSON.parse(manifest); } catch { throw failure('Invalid Python package environment manifest'); }
  if (!Array.isArray(previous) || previous.some(value=>typeof value!=='string')) throw failure('Invalid Python package environment manifest');
  const requirements = [...previous as string[],...(options.profile === 'documents' ? pythonDocumentPackages:[]),...(options.requirements??[]),...(context.requirements??[])].map(value=>normalizeRequirement(value,context.cwd));
  for (const file of [...options.requirementFiles??[],...context.requirementFiles??[]]) {
   const path = resolve(context.cwd,file);
   let source: string;
   try { source = decoder.decode(await context.fs.readFile(path,{signal:context.signal,maxBytes:1024*1024})); } catch(error) { context.signal.throwIfAborted();throw failure(`Cannot read Python requirements ${path}: ${error instanceof Error ? error.message : String(error)}`); }
   for (const line of source.split('\n')) {
    // Only whitespace-delimited hashes begin comments; URL integrity fragments survive.
    const comment=line.split('').findIndex((character,index)=>character==='#' && (index===0 || line[index-1]!.trim()===''));
    const text=(comment<0?line:line.slice(0,comment)).trim(); if (!text)continue;
    if (text.endsWith('\\') || text.startsWith('-')) throw failure(`Unsupported requirements option or continuation in ${path}: ${text}`);
    requirements.push(normalizeRequirement(text,dirname(path)));
   }
  }
  context.signal.throwIfAborted();
  const session=String(++counter);
  const unique=[...new Set(requirements)];
  const aborted=()=>{const current=sessions.get(session);if(current){current.closed=true;current.opened.clear();}sessions.delete(session);};
  sessions.set(session,{...context,cache,manifestCache,manifestRevision,controller:invocation,offline:context.offline??options.offline??false,requirements:unique,opened:new Map(),opening:false,closed:false,manifest,aborted});
  context.signal.addEventListener('abort',aborted,{once:true});
  return {session,requirements:unique,offline:context.offline??options.offline??false};
 }
 async function dispatch(op:string,args:unknown[],_context:PythonPackageContext):Promise<unknown> {
  _context.signal.throwIfAborted();
  const session=sessions.get(String(args[0]));
  if(!session)throw failure('Python package session is closed');
  checkSession(session);
  if(op==='package-commit') {
   const pinned=args[1];
   if(!Array.isArray(pinned)||pinned.some(value=>typeof value!=='string'))throw failure('Invalid installed package manifest');
   // Pins supplement the original sources (including canonical local wheels).
   const merged=[...new Set([...session.requirements,...pinned as string[]])];
   const manifestBytes=encoder.encode(JSON.stringify(merged));
   if(manifestBytes.length>maxBytes)throw failure('Python package manifest exceeds maxDownloadBytes');
   const commit = committing.then(async()=>{
    checkSession(session);
    if(options.manifestStore) {
     const committed=await options.manifestStore.compareAndSet(manifestKey,session.manifestRevision,manifestBytes,{signal:session.signal});
     checkSession(session);
     if(typeof committed!=='boolean')throw failure('Invalid Python package manifest publication result');
     if(!committed)throw new PythonPackageConflictError();
    } else {
     const current = await session.manifestCache.get(manifestKey);
     checkSession(session);
     if(current && current.length>maxBytes)throw failure('Python package manifest exceeds maxDownloadBytes');
     if ((current===undefined?'':decoder.decode(current))!==session.manifest) throw new PythonPackageConflictError();
     await session.manifestCache.set(manifestKey,manifestBytes);
    }
    checkSession(session);
   });
   committing=commit.catch(()=>{});
   await commit;
   options.onProgress?.({phase:'installed'});
   return null;
  }
  if(op==='package-read') {
   const bytes=session.opened.get(String(args[1]));const offset=args[2];const length=args[3];
   if(!bytes||!Number.isSafeInteger(offset)||!Number.isSafeInteger(length)||(offset as number)<0||(length as number)<1||(length as number)>65536)throw failure('Invalid package chunk request');
   return Array.from(bytes.subarray(offset as number,(offset as number)+(length as number)));
  }
  if(op==='package-close') {session.opened.delete(String(args[1]));return null;}
  if(op!=='package-open'||typeof args[1]!=='string')throw failure('Invalid package operation');
  if(session.opening)throw failure('Package download already in progress');
  session.opening=true;
  session.opened.clear();
  try {
  const url=args[1];const expected=args[2];
  if(expected!==undefined && expected!==null && (typeof expected!=='string'||expected.length!==64||Array.from(expected).some(c=>!'0123456789abcdef'.includes(c))))throw failure('Invalid SHA-256 package integrity value');
  const address=runtimeKey+'-url-'+digest(encoder.encode(url));
  const canonicalWheel=url.startsWith('file:')||url.startsWith('emfs:');
  const metadata=canonicalWheel?undefined:await session.cache.get(address);
  checkSession(session);
  let bytes:Uint8Array|undefined;let headers:readonly(readonly[string,string])[]=[];
  if(metadata){
   if(metadata.length>maxBytes)throw failure('Python package cache metadata exceeds maxDownloadBytes');
   let record: {digest:string,headers:readonly(readonly[string,string])[]};
   try { record=JSON.parse(decoder.decode(metadata)) as typeof record; } catch { throw failure(`Invalid package cache metadata: ${url}`); }
   if(typeof record!=='object'||record===null||typeof record.digest!=='string'||record.digest.length!==64||Array.from(record.digest).some(char=>!'0123456789abcdef'.includes(char))||!Array.isArray(record.headers)||record.headers.some(pair=>!Array.isArray(pair)||pair.length!==2||pair.some(value=>typeof value!=='string')))throw failure(`Invalid package cache metadata: ${url}`);
   bytes=await session.cache.get(runtimeKey+'-sha256-'+record.digest);headers=record.headers;
   checkSession(session);
   if(bytes && bytes.length>maxBytes)throw failure('Cached package exceeds maxDownloadBytes');
   // Cache implementations may lend mutable buffers; retain the bytes we authenticate.
   if(bytes)bytes=Uint8Array.from(bytes);
   if(bytes && digest(bytes)!==record.digest)throw failure(`Package cache integrity mismatch: ${url}`);
   if(bytes)options.onProgress?.({phase:'cached',url,bytes:bytes.length});
  }
  if(!bytes){
   if(canonicalWheel){
    const path = new URL(url);
    if(path.host && path.host!=='localhost')throw failure('Local wheels must use the canonical filesystem');
    try { bytes=await session.fs.readFile(decodeURIComponent(path.pathname),{signal:session.signal,maxBytes}); } catch(error) { checkSession(session);throw failure(`Cannot read canonical Python wheel ${path.pathname}: ${error instanceof Error ? error.message : String(error)}`); }
   }else{
    if(session.offline)throw failure(`Offline package cache miss: ${url}`);
    if(!options.transport||!options.authorize)throw failure('Python package download requires configured transport and authorization');
    let current=new URL(url);let redirectFrom:string|undefined;
    for(let redirect=0;;redirect++){
     if(current.protocol!=='https:'&&current.protocol!=='http:')throw failure(`Unsupported package transport protocol: ${current.protocol}`);
     if(current.username||current.password)throw failure('Package URLs with credentials are unsupported');
     let denyPrivate=false;
     const allowed=await options.authorize({url:current.href,method:'GET',attempt:0,signal:session.signal,...redirectFrom===undefined?{}:{redirectFrom},requirePrivateNetworkDeny(){denyPrivate=true;}});
     checkSession(session);
     if(!allowed)throw failure(`Python package download authorization denied: ${current.href}`);
     if(denyPrivate&&!options.transport.supportsPrivateNetworkDeny)throw failure('Package transport cannot enforce private network denial');
     checkSession(session);
     const response=await options.transport({url:current.href,method:'GET',headers:[['accept','application/vnd.pypi.simple.v1+json, application/json;q=0.9, */*;q=0.1']],signal:session.signal,...denyPrivate?{denyPrivateNetworks:true}:{}});
     try{
      checkSession(session);
      if([301,302,303,307,308].includes(response.status)){
       if(redirect>=5)throw failure('Too many package redirects');
       const location=response.headers.find(([key])=>key.toLowerCase()==='location')?.[1];if(!location)throw failure('Package redirect has no location');
       redirectFrom=current.href;current=new URL(location,current);continue;
      }
      if(response.status<200||response.status>=300)throw failure(`Package download failed: HTTP ${response.status} ${current.href}`);
      headers=response.headers;
      const encoding=headers.find(([key])=>key.toLowerCase()==='content-encoding')?.[1].trim().toLowerCase();
      const length=headers.find(([key])=>key.toLowerCase()==='content-length')?.[1];const total=length===undefined||(encoding!==undefined&&encoding!=='identity')?undefined:Number(length);
      if(total!==undefined&&Number.isFinite(total)&&total>maxBytes)throw failure('Package download exceeds maxDownloadBytes');
      const chunks:Uint8Array[]=[];let count=0;
      for await(const chunk of response.body){checkSession(session);if(chunk.length===0)continue;count+=chunk.length;if(count>maxBytes)throw failure('Package download exceeds maxDownloadBytes');chunks.push(Uint8Array.from(chunk));options.onProgress?.({phase:'download',url,bytes:count,...typeof total==='number'&&Number.isSafeInteger(total)?{totalBytes:total}:{}});}
      bytes=new Uint8Array(count);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
      break;
     }finally{await response.dispose();}
    }
   }
   checkSession(session);
   if(expected&&digest(bytes)!==expected)throw failure(`Package integrity mismatch: ${url}`);
   const hash=digest(bytes);
   const metadataBytes=encoder.encode(JSON.stringify({digest:hash,headers}));
   if(metadataBytes.length>maxBytes)throw failure('Python package cache metadata exceeds maxDownloadBytes');
   await session.cache.set(runtimeKey+'-sha256-'+hash,Uint8Array.from(bytes));
   checkSession(session);
   if(!canonicalWheel)await session.cache.set(address,metadataBytes);
   checkSession(session);
  }
  checkSession(session);
  if(expected&&digest(bytes)!==expected)throw failure(`Package integrity mismatch: ${url}`);
  const key=digest(bytes);session.opened.set(key,bytes);
  return {key,size:bytes.length,headers};
  } finally {session.opening=false;}
 }
 return {
  prepare:admit(prepare),dispatch:admit(dispatch),
  finish(start:PythonPackageStart){
   const session=sessions.get(start.session);
   if(session){session.closed=true;session.opened.clear();session.signal.removeEventListener('abort',session.aborted);session.controller.abort(failure('Python package session is closed'));}
   sessions.delete(start.session);
  },
  dispose(){
   if(!disposing){
    disposed=true;
    controller.abort(failure('Python package environment is disposed'));
    disposing=Promise.allSettled([...pending]).then(()=>{sessions.clear();defaultCache.dispose();});
   }
   return disposing;
  },
 };
}
