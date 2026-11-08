import {PdfFileSource} from "@poe-code/pdf-ast";
import type {FileSystem} from "@poe-code/safe-fs/contracts";
import type {ImageByteStorage} from "./codecs/png-storage.js";

const pageBytes=16384,recordBytes=pageBytes+8;
type Page={bytes:Uint8Array;dirty:boolean};
async function pageNumber(source:PdfFileSource,index:number,signal:AbortSignal):Promise<number>{
 const bytes=await source.read(index*recordBytes,8,signal);return new DataView(bytes.buffer,bytes.byteOffset,8).getFloat64(0);
}

/** Mutable PDF values over immutable retained staging. Four resident pages and
 * binary merged sorted runs bound memory without requiring random-write authority.
 * Inactive runs have empty caches; newest page versions win during compaction. */
export class PdfValueStorage implements ImageByteStorage {
 private readonly pages=new Map<number,Page>();
 private readonly runs:(PdfFileSource|undefined)[]=[];
 private readonly owned=new Set<PdfFileSource>();
 private end=8;
 private active:Promise<unknown>=Promise.resolve();
 private closing:Promise<void>|undefined;
 constructor(private readonly fs:FileSystem,private readonly directory:string,private readonly signal:AbortSignal){}
 allocate(length:number):number{
  this.signal.throwIfAborted();if(this.closing)throw new Error("PDF value storage is closed");
  if(!Number.isSafeInteger(length)||length<0||length>Number.MAX_SAFE_INTEGER-this.end)throw new RangeError("Invalid PDF backing allocation");
  const position=this.end;this.end+=length;return position;
 }
 private operation<T>(position:number,length:number,signal:AbortSignal|undefined,action:(signal:AbortSignal)=>Promise<T>):Promise<T>{
  const combined=signal?AbortSignal.any([signal,this.signal]):this.signal;
  combined.throwIfAborted();if(this.closing)throw new Error("PDF value storage is closed");
  if(!Number.isSafeInteger(position)||position<0||!Number.isSafeInteger(length)||length<0||length>this.end-position)throw new RangeError("Invalid PDF backing range");
  const work=this.active.then(()=>{combined.throwIfAborted();return action(combined);});
  this.active=work.then(()=>undefined,()=>undefined);return work;
 }
 read(position:number,length:number,options?:{readonly signal?:AbortSignal}):Promise<Uint8Array>{
  return this.operation(position,length,options?.signal,async signal=>{
   const result=new Uint8Array(length);
   for(let offset=0,turns=0;offset<length;){
    if(++turns%64===0)await new Promise<void>(resolve=>setTimeout(resolve,0));
    signal.throwIfAborted();const at=position+offset,page=await this.page(Math.floor(at/pageBytes),signal),start=at%pageBytes,count=Math.min(length-offset,pageBytes-start);
    result.set(page.bytes.subarray(start,start+count),offset);offset+=count;
   }
   signal.throwIfAborted();return result;
  });
 }
 write(position:number,bytes:Uint8Array,options?:{readonly signal?:AbortSignal}):Promise<void>{
  return this.operation(position,bytes.length,options?.signal,async signal=>{
   for(let offset=0,turns=0;offset<bytes.length;){
    if(++turns%64===0)await new Promise<void>(resolve=>setTimeout(resolve,0));
    signal.throwIfAborted();const at=position+offset,page=await this.page(Math.floor(at/pageBytes),signal),start=at%pageBytes,count=Math.min(bytes.length-offset,pageBytes-start);
    page.bytes.set(bytes.subarray(offset,offset+count),start);page.dirty=true;offset+=count;
   }
   signal.throwIfAborted();
  });
 }
 private async page(number:number,signal:AbortSignal):Promise<Page>{
  const cached=this.pages.get(number);
  if(cached){this.pages.delete(number);this.pages.set(number,cached);return cached;}
  if(this.pages.size===4){await this.flush(signal);this.pages.delete(this.pages.keys().next().value!);}
  let bytes:Uint8Array|undefined;
  for(const run of this.runs){
   if(!run)continue;
   try{
    let low=0,high=run.size/recordBytes;
    while(low<high){const middle=Math.floor((low+high)/2),key=await pageNumber(run,middle,signal);if(key<number)low=middle+1;else high=middle;}
    if(low<run.size/recordBytes&&await pageNumber(run,low,signal)===number){bytes=await run.read(low*recordBytes+8,pageBytes,signal);break;}
   }finally{await run.releaseCache();}
  }
  signal.throwIfAborted();const page={bytes:bytes??new Uint8Array(pageBytes),dirty:false};this.pages.set(number,page);return page;
 }
 private async stage(chunks:AsyncIterable<Uint8Array>|Iterable<Uint8Array>,signal:AbortSignal):Promise<PdfFileSource>{
  const source=await PdfFileSource.fromStream(this.fs,this.directory,chunks,{signal,chunkBytes:pageBytes,cacheBytes:pageBytes});
  this.owned.add(source);return source;
 }
 private async flush(signal:AbortSignal):Promise<void>{
  const dirty=[...this.pages].filter(([,page])=>page.dirty).sort(([a],[b])=>a-b);
  if(!dirty.length)return;
  function* records(){for(const [number,page]of dirty){const header=new Uint8Array(8);new DataView(header.buffer).setFloat64(0,number);yield header;yield page.bytes;}}
  let current=await this.stage(records(),signal),level=0;
  while(this.runs[level]){
   const older=this.runs[level]!;
   async function* merge(){
    let a=0,b=0,turns=0;
    while(a<current.size/recordBytes||b<older.size/recordBytes){
     if(++turns%64===0)await new Promise<void>(resolve=>setTimeout(resolve,0));
     signal.throwIfAborted();
     const left=a<current.size/recordBytes?await pageNumber(current,a,signal):Infinity,right=b<older.size/recordBytes?await pageNumber(older,b,signal):Infinity;
     const source=left<=right?current:older,index=left<=right?a:b;
     yield await source.read(index*recordBytes,8,signal);yield await source.read(index*recordBytes+8,pageBytes,signal);
     if(left<=right)a++;if(right<=left)b++;
    }
   }
   const merged=await this.stage(merge(),signal);
   await current.close();this.owned.delete(current);await older.close();this.owned.delete(older);
   this.runs[level]=undefined;current=merged;level++;
  }
  this.runs[level]=current;
  for(const [,page]of dirty)page.dirty=false;
 }
 close():Promise<void>{
  return this.closing??=(async()=>{
   await this.active;this.pages.clear();let failure:{error:unknown}|undefined;
   for(const source of this.owned){try{await source.close();}catch(error){failure??={error};}}
   this.owned.clear();this.runs.length=0;if(failure)throw failure.error;
  })();
 }
}
