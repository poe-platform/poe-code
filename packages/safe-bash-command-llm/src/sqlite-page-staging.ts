import {FsError,type FileSystem,type FileStat,type FsOptions} from 'safe-bash-contracts';
import type {ObjectFileStaging} from '@poe-code/safe-fs/core';
import {yieldTurn} from 'safe-bash-contracts/yield';
import {verifySqliteSnapshot} from './sqlite-snapshot.js';

/** Sparse pages live in caller-owned private storage. A linked list in the page
 * headers bounds cleanup by allocated pages rather than the largest sparse
 * offset. Only its head/count and one page are retained in working memory.
 * The caller owns the private directory and any cleanup after backend failure. */
export async function createSqlitePageStaging(fs:FileSystem,options:{directory:string;chunkBytes:number;maxFileBytes:number;signal?:AbortSignal}):Promise<ObjectFileStaging>{
 const {directory,chunkBytes,maxFileBytes,signal}=options;
 signal?.throwIfAborted();
 if(!directory.startsWith('/')||directory==='/'||directory.split('/').slice(1).some(part=>!part||part==='.'||part==='..')||directory.includes('\0'))throw new RangeError('Invalid SQLite private directory');
 if(!Number.isSafeInteger(chunkBytes)||chunkBytes<1||chunkBytes>65536||!Number.isSafeInteger(maxFileBytes)||maxFileBytes<1)throw new RangeError('Invalid SQLite page limits');
 const initialOptions=signal===undefined?{}:{signal};
 const caps=await fs.capabilitiesFor?.(directory,initialOptions)??fs.capabilities;
 if(!caps.retainedRead||!caps.atomicFileMutation||!fs.openReadFile||!fs.writeFileConditional||!fs.removeFileConditional)throw new FsError('ENOTSUP',{message:'SQLite page staging requires retained reads and conditional file mutations'});
 const original=await fs.stat(directory,initialOptions);
 const sameDirectory=(actual:FileStat):boolean=>actual.type==='directory'&&original.identityScope!==undefined&&actual.identityScope===original.identityScope&&(original.opaqueIdentity!==undefined?actual.opaqueIdentity===original.opaqueIdentity:original.dev!==undefined&&original.ino!==undefined&&actual.dev===original.dev&&actual.ino===original.ino);
 if(!sameDirectory(original))throw new FsError('ENOTSUP',{message:'SQLite private directory requires authoritative identity'});
 const parent=async(io:FsOptions={}):Promise<FileStat>=>{const value=await fs.stat(directory,io);if(!sameDirectory(value))throw new FsError('EAGAIN',{path:directory,message:'SQLite private directory changed'});return value;};
 const nonce=crypto.getRandomValues(new Uint8Array(16));
 const prefix=directory+'/.sqlite-page-'+Array.from(nonce,byte=>byte.toString(16).padStart(2,'0')).join('')+'-';
 const maxPages=Math.ceil(maxFileBytes/chunkBytes),headerBytes=33;
 let head=0,count=0,closed=false,failed=false,failure:unknown,busy:Promise<unknown>|undefined,closing:Promise<void>|undefined;
 let pending:{index:number;next:number}|undefined;
 const pageIndex=(index:number):void=>{if(!Number.isSafeInteger(index)||index<0||index>=maxPages)throw new RangeError('Invalid SQLite staging page index');};
 type Page={bytes:Uint8Array;stat:FileStat;next:number};
 const load=async(index:number,io:FsOptions={}):Promise<Page|undefined>=>{
  await parent(io);let reader;
  try{reader=await fs.openReadFile!(prefix+index,io);}catch(error){if(error instanceof FsError&&error.code==='ENOENT')return undefined;throw error;}
  const errors:unknown[]=[];let value:Page|undefined;
  try{
   const stat=await reader.stat(io);verifySqliteSnapshot(stat,stat);
   if(stat.size!==chunkBytes+headerBytes)throw new FsError('EAGAIN',{message:'SQLite staging page was replaced'});
   const bytes=new Uint8Array(stat.size);let position=0;
   while(position<bytes.length){
    const requested=Math.min(16384,bytes.length-position);
    const part=await reader.read(position,requested,io);
    if(!(part instanceof Uint8Array)||!part.length||part.length>requested)throw new FsError('EIO',{message:'Invalid SQLite staging page read'});
    bytes.set(part,position);position+=part.length;
   }
   verifySqliteSnapshot(await reader.stat(io),stat);
   const view=new DataView(bytes.buffer),next=Number(view.getBigUint64(0,true));
   if(!nonce.every((byte,offset)=>bytes[9+offset]===byte)||view.getBigUint64(25,true)!==BigInt(index))throw new FsError('EAGAIN',{message:'SQLite staging page ownership changed'});
   if(!Number.isSafeInteger(next)||next<0||next>maxPages||next===index+1||bytes[8]!>1)throw new FsError('EIO',{message:'Corrupt SQLite staging page header'});
   value={bytes,stat,next};
  }catch(error){errors.push(error);}
  try{await reader.close();}catch(error){errors.push(error);}
  if(errors.length===1)throw errors[0];if(errors.length)throw new AggregateError(errors,'SQLite staging read and cleanup failed');return value;
 };
 const put=async(index:number,bytes:Uint8Array,expected:FileStat|null,io:FsOptions):Promise<void>=>{await fs.writeFileConditional!(prefix+index,bytes,{...io,parent:await parent(io),expected,mode:0o600});};
 const run=<T>(io:FsOptions,action:()=>Promise<T>):Promise<T>=>{
  if(closed)return Promise.reject(new FsError('EBADF',{message:'SQLite page staging is closed'}));
  if(busy)return Promise.reject(new FsError('EBUSY',{message:'SQLite page staging operation overlaps'}));
  if(failed)return Promise.reject(failure);
  try{io.signal?.throwIfAborted();}catch(error){return Promise.reject(error);}
  let resolve!:(value:T|PromiseLike<T>)=>void,reject!:(error:unknown)=>void;
  const task=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});
  busy=task;
  void (async()=>{io.signal?.throwIfAborted();const value=await action();io.signal?.throwIfAborted();return value;})().then(resolve,reject);void task.then(()=>{busy=undefined;},error=>{busy=undefined;failed=true;failure=error;});return task;
 };
 return {
  async readPage(index,io={}){pageIndex(index);return run(io,async()=>{const page=await load(index,io);return page?.bytes[8]===1?page.bytes.slice(headerBytes):undefined;});},
  async writePage(index,input,io={}){
   pageIndex(index);if(!(input instanceof Uint8Array)||input.length!==chunkBytes)throw new RangeError('Invalid SQLite staging page length');
   return run(io,async()=>{
    const bytes=new Uint8Array(chunkBytes+headerBytes);bytes.set(input,headerBytes);
    const existing=await load(index,io),next=existing?.next??head;
    const view=new DataView(bytes.buffer);view.setBigUint64(0,BigInt(next),true);bytes[8]=1;bytes.set(nonce,9);view.setBigUint64(25,BigInt(index),true);
    if(!existing)pending={index,next};
    try{await put(index,bytes,existing?.stat??null,io);}
    catch(error){if(error instanceof FsError&&(error.code==='EEXIST'||error.code==='EAGAIN'))pending=undefined;throw error;}
    if(!existing){head=index+1;count++;pending=undefined;}
   });
  },
  async truncate(size,io={}){
   if(!Number.isSafeInteger(size)||size<0||size>maxFileBytes)throw new RangeError('Invalid SQLite staging truncation');
   return run(io,async()=>{
    let current=head,visited=0;
    while(current){
     await yieldTurn(io.signal);if(++visited>count)throw new FsError('EIO',{message:'Cyclic SQLite staging pages'});
     const index=current-1,page=await load(index,io);if(!page)throw new FsError('EIO',{message:'Missing SQLite staging page'});
     current=page.next;
     if(page.bytes[8]!==1)continue;
     const start=index*chunkBytes;
     if(start>=size){page.bytes[8]=0;await put(index,page.bytes,page.stat,io);}
     else if(size-start<chunkBytes){page.bytes.fill(0,headerBytes+size-start);await put(index,page.bytes,page.stat,io);}
    }
    if(visited!==count)throw new FsError('EIO',{message:'Incomplete SQLite staging page list'});
   });
  },
  close(){
   if(closing)return closing;
   closed=true;
   closing=(async()=>{
    if(busy)await busy.catch(()=>undefined);
    await parent();const errors:unknown[]=[];
    const remove=async(index:number,page:Page):Promise<void>=>{await fs.removeFileConditional!(prefix+index,{parent:await parent(),expected:page.stat});};
    if(pending){try{const page=await load(pending.index);if(page)await remove(pending.index,page);}catch(error){errors.push(error);}pending=undefined;}
    let current=head,visited=0;
    while(current){
     await yieldTurn();
     if(++visited>count){errors.push(new FsError('EIO',{message:'Cyclic SQLite staging pages'}));break;}
     const index=current-1;let page;
     try{page=await load(index);if(!page)throw new FsError('EIO',{message:'Missing SQLite staging page'});}catch(error){errors.push(error);break;}
     current=page.next;
     try{await remove(index,page);}catch(error){errors.push(error);}
    }
    head=0;count=0;
    if(errors.length===1)throw errors[0];if(errors.length)throw new AggregateError(errors,'SQLite page staging cleanup failed');
   })();return closing;
  }
 };
}
