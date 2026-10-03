import {FsError,type FileSystem} from 'safe-bash-contracts';
import {PythonTextDecoder,PythonTextDecodeError} from 'safe-bash-csv-engine/text-decoder';
import {fileSource} from './file-source.js';
import {createLlmSpool} from './retained-spool.js';
import {embeddingText} from './embed-input.js';
import {sourceBytes} from './request-source.js';
import type {LlmCollectionBatchEntry} from './collections-batch.js';

export interface LlmEmbeddingFile {readonly path:string;readonly id:string;readonly displayPath?:string}
export interface LlmFileEmbeddingOptions {
 readonly fs:FileSystem;readonly directory:string;readonly signal:AbortSignal;
 readonly encodings?:readonly string[];readonly binary?:boolean;
 readonly prefix?:string;readonly prepend?:string;readonly maxInputBytes?:number;
 readonly admit?:(bytes:number)=>void;
 readonly undecodable?:(path:string)=>void|Promise<void>;
}
type Spool=Awaited<ReturnType<typeof createLlmSpool>>;
/** Files and decoded attempts live in caller storage. Each yielded entry is
 * borrowed until disposal or the next entry, as in the CSV/JSON import APIs. */
export async function withFileEmbeddingEntries<T>(options:LlmFileEmbeddingOptions,files:AsyncIterable<LlmEmbeddingFile>,operation:(entries:AsyncIterable<LlmCollectionBatchEntry>)=>Promise<T>):Promise<T>{
 const {fs,directory,signal}=options,maxBytes=options.maxInputBytes??Infinity;
 if(maxBytes!==Infinity&&(!Number.isSafeInteger(maxBytes)||maxBytes<0))throw new RangeError('Invalid embedding input byte limit');
 if(options.binary&&options.encodings?.length)throw new TypeError('--binary cannot be used with --encoding');
 const encoder=new TextEncoder();
 const entries={async *[Symbol.asyncIterator]():AsyncGenerator<LlmCollectionBatchEntry>{
  for await(const file of files){
   signal.throwIfAborted();
   const stat=await fs.stat(file.path,{signal});if(stat.type==='directory')continue;
   const input=await fileSource({fs,path:file.path,signal,maxBytes,expectedStat:stat});
   let raw:Spool|undefined,selected:Spool|undefined,failed=false,retire:(()=>void)|undefined;
   try{
    raw=await createLlmSpool(fs,directory,signal,'input');
    for await(const bytes of sourceBytes(input.bytes,signal)){options.admit?.(bytes.length);await raw.write(bytes);}
    await input.dispose();
    const binary=!!options.binary&&stat.size>0;
    if(binary)selected=raw;
    else if(options.binary)selected=await createLlmSpool(fs,directory,signal,'input');
    else for(const encoding of options.encodings?.length?options.encodings:['utf-8','latin-1']){
     const decoder=new PythonTextDecoder(encoding),candidate=await createLlmSpool(fs,directory,signal,'input');
     let accepted=false,failedAttempt=false;
     try{
      const decoded={async *[Symbol.asyncIterator](){
       for await(const bytes of raw!.replay())for(let offset=0;offset<bytes.length;offset+=4096){signal.throwIfAborted();yield encoder.encode(decoder.decode(bytes.subarray(offset,offset+4096),{stream:true}));}
       yield encoder.encode(decoder.decode());
      }};
      let size=0;
      for await(const bytes of embeddingText(decoded,signal)){
       if(bytes.length>maxBytes-size)throw new RangeError('Embedding input byte limit exceeded');size+=bytes.length;await candidate.write(bytes);
      }
      accepted=true;
     }catch(error){failedAttempt=true;signal.throwIfAborted();if(!(error instanceof PythonTextDecodeError))throw error;failedAttempt=false;}
     finally{if(!accepted)try{await candidate.close();}catch(error){if(!failedAttempt)await Promise.reject(error);}}
     if(accepted){const previous=selected;selected=candidate;await previous?.close();}
    }
    if(!selected){await options.undecodable?.(file.displayPath??file.path);continue;}
    const retained=selected;let closed=false,consumed=false;retire=()=>{closed=true;};
    yield {id:(options.prefix??'')+file.id,binary,input:{async dispose(){closed=true;await retained.close();},bytes:{async *[Symbol.asyncIterator](){
     if(closed||consumed)throw new FsError('EBADF',{message:'File embedding lease is closed'});consumed=true;
     if(!binary&&options.prepend)for(let offset=0;offset<options.prepend.length;){
      signal.throwIfAborted();if(closed)throw new FsError('EBADF',{message:'File embedding lease is closed'});
      let end=Math.min(offset+4096,options.prepend.length);const last=options.prepend.charCodeAt(end-1);if(end<options.prepend.length&&last>=0xd800&&last<=0xdbff)end--;
      yield encoder.encode(options.prepend.slice(offset,end));offset=end;
     }
     for await(const bytes of retained.replay()){if(closed)throw new FsError('EBADF',{message:'File embedding lease is closed'});yield bytes;}
    }}}};
   }catch(error){failed=true;throw error;}
   finally{
    retire?.();const errors:unknown[]=[];
    for(const close of [()=>input.dispose(),()=>selected?.close(),()=>raw?.close()])try{await close();}catch(error){errors.push(error);}
    if(!failed&&errors.length)await Promise.reject(new AggregateError(errors,'File embedding cleanup failed'));
   }
  }
 }};
 const iterator=entries[Symbol.asyncIterator]();let failed=false;
 try{return await operation({[Symbol.asyncIterator]:()=>iterator});}catch(error){failed=true;throw error;}finally{try{await iterator.return(undefined);}catch(error){if(!failed)await Promise.reject(error);}}
}
