import type { ExactFileStat } from '@poe-code/safe-fs/core';
import { UploadError } from './upload-protocol.js';
import type { OutputFreshness } from './output-retrieval.js';
import { admitOutputFreshness } from './output-freshness.js';
import type { FileListing } from './wire.generated.js';
export class FileListingError extends Error {
 constructor(readonly code:'EIO'|'EFBIG'){super('Canonical directory listing admission failed');this.name='FileListingError';}
}
/** Own indexed entries and primitive metadata, never backend iteration/JSON hooks.
 * The text listing profile refuses names that cannot be represented losslessly;
 * byte directory callbacks use their separately negotiated object profile. */
export function admitFileListing(input:unknown,maxEntries:number,maxBytes:number):FileListing {
 if(!Number.isSafeInteger(maxEntries)||maxEntries<0||!Number.isSafeInteger(maxBytes)||maxBytes<2)throw new TypeError('Invalid listing bound');
 try {
  if(!Array.isArray(input))throw new FileListingError('EIO');
  const count=input.length;
  if(count>maxEntries)throw new FileListingError('EFBIG');
  const entries:FileListing=[];let remaining=maxBytes-2;
  for(let index=0;index<count;index++){
   if(!Object.hasOwn(input,index))throw new FileListingError('EIO');
   const entry=input[index];
   if(!entry||typeof entry!=='object'||!Object.hasOwn(entry,'name')||!Object.hasOwn(entry,'type')||Object.keys(entry).some(key=>key!=='name'&&key!=='type'))throw new FileListingError('EIO');
   const name=entry.name;const type=entry.type;
   if(typeof name!=='string'||!name||name==='.'||name==='..'||name.includes('/')||name.includes('\0')||!['file','directory','symlink','character','fifo','socket'].includes(type))throw new FileListingError('EIO');
   // UTF-16 length is a lower bound: admit before encoding retained metadata.
   if(name.length>remaining)throw new FileListingError('EFBIG');
   if(new TextDecoder('utf-8',{ignoreBOM:true}).decode(new TextEncoder().encode(name))!==name)throw new FileListingError('EIO');
   const owned={name,type} as FileListing[number];
   remaining-=new TextEncoder().encode(JSON.stringify(owned)).length+(index?1:0);
   if(remaining<0)throw new FileListingError('EFBIG');
   entries.push(owned);
  }
  // Structural metadata accessors may change the listing while it is copied.
  // A prefix is not the complete canonical observation admitted above.
  if(input.length!==count)throw new FileListingError('EIO');
  return entries;
 }catch(error){if(error instanceof FileListingError)throw error;throw new FileListingError('EIO');}
}
export interface FileScope {tenantId:string;sessionId:string;epoch:string;invocationId:string}
export interface FileOpen {namespaceId:string;path:string}
/** A trusted canonical retained object. No host pathname reopening, stat tuple
 * identity synthesis or content-hash identity. Operations must settle on abort. */
export interface RetainedReadFile {
  identity?:object|symbol;
  /** Optional qualified content-version guard for resumable output retrieval.
   * Requires identity above and must identify that same retained object.
   * Retaining a live object alone never promises immutable bytes. */
  freshness?(signal?:AbortSignal):Promise<OutputFreshness>;
  stat(signal:AbortSignal):Promise<ExactFileStat>;
  read(position:bigint,maxBytes:number,signal:AbortSignal):Promise<Uint8Array>;
  close():Promise<void>;
}
export interface FileMetadata {type:ExactFileStat['type'];size:string;mode?:number;uid?:number;gid?:number;atimeNs?:string;mtimeNs?:string;ctimeNs?:string;allocatedBytes?:string;nlink?:string}
export function encodeFileMetadata(stat:ExactFileStat):FileMetadata{
 // Backend getters may expose changing native observations. Validate and encode
 // one captured value per field, including exact bigint sizes and timestamps.
 const {type,size,mode,uid,gid,atimeNs,mtimeNs,ctimeNs,allocatedBytes,nlink}=stat;
 stat={type,size,mode,uid,gid,atimeNs,mtimeNs,ctimeNs,allocatedBytes,nlink};
 if(!['file','directory','symlink','character','fifo','socket'].includes(stat.type))throw new TypeError('Invalid file type');
 if(typeof stat.size!=='bigint'||stat.size<0n||stat.size>9223372036854775807n)throw new TypeError('File size is not representable');
 const value:FileMetadata={type:stat.type,size:stat.size.toString()};
 for(const key of ['mode','uid','gid'] as const)if(stat[key]!==undefined){if(!Number.isSafeInteger(stat[key])||stat[key]!<0||stat[key]!>(key==='mode'?65535:4294967295))throw new TypeError('Invalid file metadata');value[key]=stat[key];}
 for(const key of ['atimeNs','mtimeNs','ctimeNs'] as const)if(stat[key]!==undefined){if(typeof stat[key]!=='bigint'||stat[key]!<-9223372036854775808n||stat[key]!>9223372036854775807n)throw new TypeError('Invalid file timestamp');value[key]=stat[key]!.toString();}
 if(stat.allocatedBytes!==undefined){if(typeof stat.allocatedBytes!=='bigint'||stat.allocatedBytes<0n||stat.allocatedBytes>9223372036854775807n)throw new TypeError('Invalid allocated bytes');value.allocatedBytes=stat.allocatedBytes.toString();}
 if(stat.nlink!==undefined){if(typeof stat.nlink!=='bigint'||stat.nlink<0n||stat.nlink>9223372036854775807n)throw new TypeError('Invalid link count');value.nlink=stat.nlink.toString();}
 return value;
}
interface Record {scope:string;controller:AbortController;resource?:RetainedReadFile;close?:()=>Promise<void>;acquired:Promise<void>;pending:Set<Promise<unknown>>;retiring?:Promise<void>;reading:boolean}
/** Server-local file handle ledger. Admission precedes acquisition and every read
 * is bounded. Caller supplies only already-authorized canonical namespace bindings. */
export function createFileServer(options:{maxHandles:number;maxFrameBytes:number;open(scope:FileScope,input:FileOpen,signal:AbortSignal):Promise<RetainedReadFile>}){
 options={...options,open:options.open.bind(options)};
 for(const n of [options.maxHandles,options.maxFrameBytes])if(!Number.isSafeInteger(n)||n<1)throw new TypeError('Invalid file bound');
 const records=new Map<string,Record>();let disposal:Promise<void>|undefined;const key=(scope:FileScope)=>JSON.stringify([scope.tenantId,scope.sessionId,scope.epoch,scope.invocationId]);
 const guards=new WeakMap<OutputFreshness,Record>();
 function assertGuard(r:Record,guard?:OutputFreshness){if(guard&&guards.get(guard)!==r)throw new TypeError('Freshness binding belongs to another retained file');}
 function visible(scope:FileScope,id:string){const r=records.get(id);if(!r||r.scope!==key(scope))throw new UploadError(404,'Unknown retained file');if(r.retiring)throw new UploadError(410,'File handle admission closed');return r;}
 async function admitted<T>(r:Record,signal:AbortSignal,work:(signal:AbortSignal)=>Promise<T>):Promise<T>{
  const combined=AbortSignal.any([signal,r.controller.signal]);combined.throwIfAborted();
  const task=(async()=>{await r.acquired;combined.throwIfAborted();const result=await work(combined);combined.throwIfAborted();return result;})();r.pending.add(task);
  try{return await task;}finally{r.pending.delete(task);}
 }
 async function close(scope:FileScope,id:string){const r=records.get(id);if(!r||r.scope!==key(scope))throw new UploadError(404,'Unknown retained file');if(r.retiring)return r.retiring;
  // Canonical abort listeners can synchronously reenter retirement. Publish
  // ownership before notifying them so the same retain is never closed twice.
  r.retiring=(async()=>{await r.acquired;await Promise.allSettled([...r.pending]);try{await r.close?.();}finally{records.delete(id);}})();
  r.controller.abort(new UploadError(410,'File handle closed'));
  return r.retiring;
 }
 async function open(scope:FileScope,input:FileOpen,signal:AbortSignal){
  signal.throwIfAborted();if(disposal)throw new UploadError(410,'File server admission closed');if(records.size>=options.maxHandles)throw new UploadError(429,'Retained file capacity');
  const id=crypto.randomUUID();let settle!:()=>void;const acquired=new Promise<void>(r=>{settle=r;});const record:Record={scope:key(scope),controller:new AbortController(),acquired,pending:new Set(),reading:false};records.set(id,record);
  try{record.resource=await options.open({...scope},{...input},AbortSignal.any([signal,record.controller.signal]));
   const resource=record.resource;
   // Own retirement before inspecting admission getters. Failed admission and
   // overlapping disposal must release this retain through the acquired method.
   record.close=resource.close.bind(resource);
   // Pin authority operations while reads continue observing live retained bytes.
   record.resource=Object.freeze({identity:resource.identity,freshness:resource.freshness?.bind(resource),
    stat:resource.stat.bind(resource),read:resource.read.bind(resource),close:record.close});
   signal.throwIfAborted();record.controller.signal.throwIfAborted();return id;}
  catch(error){if(!record.retiring){try{await record.close?.();}catch(cleanup){throw new AggregateError([error,cleanup],'File acquisition cleanup failed',{cause:error});}finally{records.delete(id);}}throw error;}finally{settle();}
 }
 async function freshness(scope:FileScope,id:string,signal=new AbortController().signal):Promise<OutputFreshness|undefined>{
  const r=visible(scope,id);return admitted(r,signal,async s=>{
   const guard=await r.resource!.freshness?.(s);if(!guard)return undefined;
   const admitted=admitOutputFreshness(guard);
   if(r.resource!.identity===undefined||admitted.identity!==r.resource!.identity)throw new TypeError('Freshness identity does not match retained canonical object');
   await admitted.assertCurrent(s);guards.set(admitted,r);return admitted;
  });
 }
 async function stat(scope:FileScope,id:string,signal=new AbortController().signal,guard?:OutputFreshness){const r=visible(scope,id);assertGuard(r,guard);return admitted(r,signal,async s=>{await guard?.assertCurrent(s);const metadata=encodeFileMetadata(await r.resource!.stat(s));await guard?.assertCurrent(s);return metadata;});}
 function stream(scope:FileScope,id:string,start:bigint,end:bigint,signal:AbortSignal,guard?:OutputFreshness):ReadableStream<Uint8Array>{
  if(typeof start!=='bigint'||typeof end!=='bigint'||start<0n||end<start||end>9223372036854775807n)throw new UploadError(416,'Unrepresentable file range');
  const r=visible(scope,id);assertGuard(r,guard);if(r.reading)throw new UploadError(429,'Retained file read already active');signal.throwIfAborted();r.reading=true;
  const controller=new AbortController();const combined=AbortSignal.any([signal,controller.signal,r.controller.signal]);let target:ReadableStreamDefaultController<Uint8Array>;let released=false;let pending:Promise<unknown>|undefined;
  const release=()=>{if(!released){released=true;r.reading=false;combined.removeEventListener('abort',abort);}};
  const abort=()=>{if(released)return;target.error(combined.reason);if(pending)void pending.finally(release).catch(()=>{});else release();};
  return new ReadableStream<Uint8Array>({start(c){target=c;combined.addEventListener('abort',abort,{once:true});if(combined.aborted)abort();},async pull(c){
   pending=(async()=>{try{combined.throwIfAborted();if(start===end){
    // Empty outputs and EOF resumes still certify the admitted content version.
    // Keep validation in the retained lifetime so closure drains it as well.
    if(guard)await admitted(r,combined,s=>guard.assertCurrent(s));
    combined.throwIfAborted();c.close();release();return;}
    const count=Number(end-start>BigInt(options.maxFrameBytes)?BigInt(options.maxFrameBytes):end-start);
    const bytes=await admitted(r,combined,async s=>{await guard?.assertCurrent(s);const value=await r.resource!.read(start,count,s);
     if(!(value instanceof Uint8Array))throw new UploadError(503,'Invalid canonical read response');
     const span=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype),'byteLength')!.get!.call(value) as number;
     if(span>count)throw new UploadError(503,'Invalid canonical read response');
     const bytes=new Uint8Array(value);await guard?.assertCurrent(s);return bytes;});
    if(!(bytes instanceof Uint8Array)||bytes.length>count)throw new UploadError(503,'Invalid canonical read response');
    if(!bytes.length){c.close();release();return;}
    start+=BigInt(bytes.length);c.enqueue(new Uint8Array(bytes));if(start===end){c.close();release();}
   }catch(error){if(!released){c.error(error);release();}}})();await pending;
  },async cancel(reason){controller.abort(reason);await pending;release();}},{highWaterMark:0});
 }
 async function dispose(scope:FileScope){
  const results=await Promise.allSettled([...records].filter(([,r])=>r.scope===key(scope)).map(([id])=>close(scope,id)));
  const failures=results.filter(result=>result.status==='rejected');
  if(failures.length===1)throw failures[0]!.reason;
  if(failures.length)throw new AggregateError(failures.map(result=>result.reason),'Retained file cleanup failed');
 }
 function disposeAll():Promise<void>{
  disposal??=Promise.resolve().then(async()=>{
   const results=await Promise.allSettled([...records].map(([id,r])=>{const[tenantId,sessionId,epoch,invocationId]=JSON.parse(r.scope)as[string,string,string,string];return close({tenantId,sessionId,epoch,invocationId},id);}));
   const failures=results.filter(result=>result.status==='rejected');
   if(failures.length===1)throw failures[0]!.reason;
   if(failures.length)throw new AggregateError(failures.map(result=>result.reason),'Retained file cleanup failed');
  });
  void disposal.catch(()=>{});return disposal;
 }
 return{open,stat,freshness,stream,close,dispose,disposeAll};
}
export type FileServer=ReturnType<typeof createFileServer>;
