import type {ArchiveMetadataSpool,ArchiveReadSource} from 'safe-bash-io-engine/commands/archive/metadata';
import {ArchiveMetadataMap} from 'safe-bash-io-engine/commands/archive/metadata';
import {createArchiveScratchFactory} from 'safe-bash-io-engine/commands/archive/scratch';
import {DEFAULT_ARCHIVE_LIMITS} from 'safe-bash-io-engine/commands/archive/internal';
import {toByteSource} from 'safe-bash-contracts';
import type {PythonPackageContext} from './provisioning.js';

async function exact(source:ArchiveReadSource,offset:number,length:number):Promise<Uint8Array>{
 const bytes=new Uint8Array(length);
 for(let position=0;position<length;){
  const chunk=await source.read(offset+position,Math.min(65536,length-position));
  if(!chunk.length||chunk.length>length-position)throw new Error('Invalid native ZIP index read');
  bytes.set(chunk,position);position+=chunk.length;
 }
 return bytes;
}

/** Native ZIP records and immutable package-name snapshots share caller-owned sorted runs. */
export class PythonPackageIndex {
 private readonly scratch:ReturnType<typeof createArchiveScratchFactory>;
 private readonly spool:()=>Promise<ArchiveMetadataSpool>;
 private data:ArchiveMetadataSpool|undefined;
 private offsets:ArchiveMetadataSpool|undefined;
 private dataSource:ArchiveReadSource|undefined;
 private offsetSource:ArchiveReadSource|undefined;
 private ends:ArchiveReadSource|undefined;
 private size=0;
 private readonly pages:Array<{source:ArchiveReadSource;offset:number;bytes:Uint8Array}>=[];
 private cached:{ordinal:number;response:string}|undefined;
 private readonly names:ArchiveMetadataMap<number>;
 private readonly headers:ArchiveMetadataMap<{ordinal:number;offset:string}>;
 private readonly boundaries:ArchiveMetadataMap<string>;
 private count=0;
 private sealed=false;
 private failed:{error:unknown}|undefined;
 private tail:Promise<unknown>=Promise.resolve();
 private closing:Promise<void>|undefined;
 constructor(private readonly context:PythonPackageContext,private readonly mode:'wheel'|'names'|'records'='wheel'){
  const discard={async write(){}};
  this.scratch=createArchiveScratchFactory({context:{...context,command:'python',args:[],env:{},stdin:toByteSource(''),stdout:discard,stderr:discard},limits:DEFAULT_ARCHIVE_LIMITS,operation:action=>Promise.resolve().then(action)},context.cwd);
  // Immutable sorted runs share four small read pages. Binary searches otherwise
  // repeat guarded filesystem reads for the same index pointers at every lookup.
  const metadata=this.spool=async():Promise<ArchiveMetadataSpool>=>{
   const spool=await this.scratch();
   let buffer:Uint8Array|undefined=new Uint8Array(16384),used=0;
   const flush=async()=>{if(used){await spool.append(buffer!.subarray(0,used));used=0;}};
   return {append:async bytes=>{
    if(!buffer)throw new Error('Python wheel scratch is sealed');
    for(let at=0;at<bytes.length;){
     const length=Math.min(buffer.length-used,bytes.length-at);
     buffer.set(bytes.subarray(at,at+length),used);used+=length;at+=length;
     if(used===buffer.length)await flush();
    }
   },close:async()=>{buffer=undefined;used=0;await spool.close();},finish:async()=>{
    await flush();buffer=undefined;
    const source=await spool.finish();
    return {size:source.size,read:async(offset,length)=>{
     if(offset>=source.size)return new Uint8Array();
     const base=Math.floor(offset/16384)*16384;
     const found=this.pages.findIndex(page=>page.source===source&&page.offset===base);
     const page=found<0?{source,offset:base,bytes:await exact(source,base,Math.min(16384,source.size-base))}:this.pages.splice(found,1)[0]!;
     this.pages.push(page);if(this.pages.length>4)this.pages.shift();
     return page.bytes.subarray(offset-base,Math.min(page.bytes.length,offset-base+length));
    }};
   }};
  };
  this.boundaries=new ArchiveMetadataMap(metadata,context.signal);
  this.names=new ArchiveMetadataMap(metadata,context.signal);
  this.headers=new ArchiveMetadataMap(metadata,context.signal);
 }
 execute(operation:unknown,args:unknown[]):Promise<unknown>{
  if(this.closing)return Promise.reject(new Error('Python wheel index is closed'));
  const work=this.tail.then(async()=>{
   this.context.signal.throwIfAborted();
   if(this.failed)throw this.failed.error;
   if(this.mode!=='wheel'){
    const name=args[0];
    if(operation==='has'&&(this.sealed||this.mode==='records')&&typeof name==='string')return this.names.has(name);
    if(operation==='get'&&this.mode==='records'&&this.sealed&&typeof name==='string')return await this.names.get(name)??null;
    if(this.sealed)throw new Error('Python package names are sealed');
    if(operation==='add'&&typeof name==='string'){
     const value=this.mode==='records'?args[1]:0;
     if(!Number.isSafeInteger(value)||(value as number)<0)throw new Error('Invalid package record ordinal');
     await this.names.set(name,value as number);return null;
    }
    if(operation==='seal'){this.sealed=true;return null;}
    throw new Error('Invalid Python package name operation');
   }
   if(operation==='append'){
    if(this.sealed)throw new Error('Python wheel index is sealed');
    const [name,offset,payload]=args;
    if(typeof name!=='string'||typeof offset!=='string'||typeof payload!=='string')throw new Error('Invalid native ZIP entry');
    const header=BigInt(offset),ordinal=this.count++;
    if(!Number.isSafeInteger(this.count)||header<=-(1n<<128n)||header>=(1n<<128n))throw new Error('Invalid native ZIP coordinate');
    this.data??=await this.spool();
    this.offsets??=await this.spool();
    const bytes=new TextEncoder().encode(payload),pointer=new Uint8Array(16),view=new DataView(pointer.buffer);
    view.setBigUint64(0,BigInt(this.size),true);view.setBigUint64(8,BigInt(bytes.length),true);
    for(let at=0;at<bytes.length;at+=65536)await this.data.append(bytes.subarray(at,at+65536));
    await this.offsets.append(pointer);this.size+=bytes.length;
    if(!Number.isSafeInteger(this.size))throw new Error('Native ZIP index size overflow');
    await this.names.set(name,ordinal);
    // Python reversed(sorted(...)) reverses equal-offset entries too.
    const order=((1n<<128n)-header).toString().padStart(40,'0')+':'+String(Number.MAX_SAFE_INTEGER-ordinal).padStart(16,'0');
    await this.headers.set(order,{ordinal,offset});
    return null;
   }
   if(operation==='seal'){
    if(this.sealed)throw new Error('Python wheel index is sealed');
    if(typeof args[0]!=='string')throw new Error('Invalid native ZIP directory offset');
    let end=args[0];BigInt(end);
    for await(const [,entry] of this.headers.sortedEntries()){
     await this.boundaries.set(String(entry.ordinal).padStart(16,'0'),end);
     end=entry.offset;
    }
    const boundaries=await this.spool();
    for await(const [,end] of this.boundaries.sortedEntries()){
     const value=BigInt.asUintN(128,BigInt(end)),bytes=new Uint8Array(16),view=new DataView(bytes.buffer);
     view.setBigUint64(0,value&((1n<<64n)-1n),true);view.setBigUint64(8,value>>64n,true);
     await boundaries.append(bytes);
    }
    this.ends=await boundaries.finish();
    this.dataSource=await this.data?.finish();this.offsetSource=await this.offsets?.finish();
    this.sealed=true;
    await Promise.all([this.headers.close(),this.boundaries.close()]);
    return null;
   }
   if(operation==='get'||operation==='name'){
    if(!this.sealed)throw new Error('Python wheel index is not sealed');
    const ordinal=operation==='name'&&typeof args[0]==='string'?await this.names.get(args[0]):args[0];
    const offset=args[1];
    if(!Number.isSafeInteger(offset)||(offset as number)<0)throw new Error('Invalid native ZIP response offset');
    if(ordinal===undefined)return 'null'.slice(offset as number,(offset as number)+8192);
    if(!Number.isSafeInteger(ordinal)||(ordinal as number)<0||(ordinal as number)>=this.count)throw new Error('Invalid native ZIP entry ordinal');
    if(this.cached?.ordinal===ordinal)return this.cached.response.slice(offset as number,(offset as number)+8192);
    const pointer=await exact(this.offsetSource!,(ordinal as number)*16,16),view=new DataView(pointer.buffer);
    const payload=new TextDecoder('utf-8',{fatal:true}).decode(await exact(this.dataSource!,Number(view.getBigUint64(0,true)),Number(view.getBigUint64(8,true))));
    const boundary=await exact(this.ends!,(ordinal as number)*16,16),endView=new DataView(boundary.buffer);
    const end=BigInt.asIntN(128,endView.getBigUint64(0,true)|(endView.getBigUint64(8,true)<<64n)).toString();
    this.cached={ordinal:ordinal as number,response:JSON.stringify([payload,end])};
    return this.cached.response.slice(offset as number,(offset as number)+8192);
   }
   throw new Error('Invalid native ZIP index operation');
  });
  this.tail=work.catch(error=>{this.failed??={error};});
  return work;
 }
 close():Promise<void>{
  return this.closing??=this.tail.then(async()=>{
   this.cached=undefined;this.pages.length=0;
   const results=await Promise.allSettled([this.boundaries.close(),this.names.close(),this.headers.close()]);
   try{await this.scratch.close();}catch(reason){results.push({status:'rejected',reason});}
   const errors=results.filter(result=>result.status==='rejected').map(result=>result.reason);
   if(errors.length===1)throw errors[0];
   if(errors.length)throw new AggregateError(errors,'Python wheel index cleanup failed');
  });
 }
}
