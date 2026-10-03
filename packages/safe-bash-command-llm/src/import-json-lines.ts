import {withEmbeddingJsonRows,type withJsonEmbeddingEntries} from './import-json.js';
import {withEmbeddingJsonDocument} from './import-json-document.js';
import {createLlmSpool} from './retained-spool.js';
import {sourceBytes} from './request-source.js';
import type {LlmCollectionBatchEntry} from './collections-batch.js';

/** Each physical line is one row. Keep its scoped document alive only while the
 * consumer borrows that row; the next line never invalidates borrowed bytes. */
export async function withJsonLinesEmbeddingEntries<T>(options:Parameters<typeof withJsonEmbeddingEntries>[0],input:AsyncIterable<Uint8Array>,operation:(entries:AsyncIterable<LlmCollectionBatchEntry>)=>Promise<T>):Promise<T>{
 const source=sourceBytes(input,options.signal)[Symbol.asyncIterator]();let chunk:Uint8Array|undefined,offset=0,ended=false;
 const advance=async()=>{while(!ended&&(!chunk||offset===chunk.length)){const next=await source.next();if(next.done){ended=true;chunk=undefined;break;}chunk=next.value;offset=0;}return !ended;};
 const entries={async *[Symbol.asyncIterator]():AsyncGenerator<LlmCollectionBatchEntry>{
  try{while(await advance()){
   // Classify the physical line using Python bytes.strip whitespace. Keep its
   // original bytes in caller storage so BOMs and parser locations are preserved.
   const line=await createLlmSpool(options.fs,options.directory,options.signal,'input');
   try{
    let lineDone=false,blank=true;
    while(!lineDone&&await advance()){
     const newline=chunk!.indexOf(10,offset),end=newline<0?chunk!.length:newline+1;
     const bytes=chunk!.subarray(offset,end);offset=end;lineDone=newline>=0;
     if(blank)for(const byte of bytes)if(byte!==32&&(byte<9||byte>13)){blank=false;break;}
     await line.write(bytes);
    }
    if(blank)continue;
   let expose!:()=>void,reject!:(error:unknown)=>void,release!:()=>void,borrowed:AsyncIterable<LlmCollectionBatchEntry>|undefined;
   const ready=new Promise<void>((resolve,fail)=>{expose=resolve;reject=fail;}),released=new Promise<void>(resolve=>{release=resolve;});
   const completed=withEmbeddingJsonDocument(options,line.replay(),document=>withEmbeddingJsonRows(options,document,async rows=>{borrowed=rows;expose();await released;},true));
   void completed.catch(reject);
   try{await ready;yield* borrowed!;}finally{release();await completed;}
   }finally{await line.close();}
  }}finally{await source.return?.();}
 }};
 const iterator=entries[Symbol.asyncIterator]();try{return await operation({[Symbol.asyncIterator]:()=>iterator});}finally{await iterator.return(undefined);}
}
