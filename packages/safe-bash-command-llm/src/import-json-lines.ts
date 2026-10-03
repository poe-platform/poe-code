import {withJsonEmbeddingEntries} from './import-json.js';
import {sourceBytes} from './request-source.js';
import type {LlmCollectionBatchEntry} from './collections-batch.js';

/** Each physical line is one row. Keep its scoped document alive only while the
 * consumer borrows that row; the next line never invalidates borrowed bytes. */
export async function withJsonLinesEmbeddingEntries<T>(options:Parameters<typeof withJsonEmbeddingEntries>[0],input:AsyncIterable<Uint8Array>,operation:(entries:AsyncIterable<LlmCollectionBatchEntry>)=>Promise<T>):Promise<T>{
 const source=sourceBytes(input,options.signal)[Symbol.asyncIterator]();let chunk:Uint8Array|undefined,offset=0,ended=false;
 const advance=async()=>{while(!ended&&(!chunk||offset===chunk.length)){const next=await source.next();if(next.done){ended=true;chunk=undefined;break;}chunk=next.value;offset=0;}return !ended;};
 const entries={async *[Symbol.asyncIterator]():AsyncGenerator<LlmCollectionBatchEntry>{
  try{while(await advance()){
   const line={async *[Symbol.asyncIterator](){
    yield Uint8Array.of(91);let lineDone=false;
    while(!lineDone&&await advance()){
     const newline=chunk!.indexOf(10,offset),end=newline<0?chunk!.length:newline+1;
     const bytes=chunk!.subarray(offset,end);offset=end;lineDone=newline>=0;yield bytes;
    }
    yield Uint8Array.of(93);
   }};
   let expose!:()=>void,reject!:(error:unknown)=>void,release!:()=>void,borrowed:AsyncIterable<LlmCollectionBatchEntry>|undefined;
   const ready=new Promise<void>((resolve,fail)=>{expose=resolve;reject=fail;}),released=new Promise<void>(resolve=>{release=resolve;});
   const completed=withJsonEmbeddingEntries(options,line,async rows=>{borrowed=rows;expose();await released;});
   void completed.catch(reject);
   try{await ready;yield* borrowed!;}finally{release();await completed;}
  }}finally{await source.return?.();}
 }};
 const iterator=entries[Symbol.asyncIterator]();try{return await operation({[Symbol.asyncIterator]:()=>iterator});}finally{await iterator.return(undefined);}
}
