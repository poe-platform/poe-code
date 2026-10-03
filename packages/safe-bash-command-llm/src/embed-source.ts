import type {CommandContext} from 'safe-bash-contracts';
import {pathOf} from 'safe-bash-contracts/path';
import type {LlmInputSource} from './types.js';
import {fileSource} from './file-source.js';
import {createLlmSpool} from './retained-spool.js';
import {sourceBytes} from './request-source.js';
import {embeddingText} from './embed-input.js';

/** Acquire reference CLI text/binary input through retained caller storage. */
export async function acquireEmbeddingInput(context:CommandContext,values:Readonly<Record<string,string>>,binary:boolean,admit:(bytes:number)=>void):Promise<LlmInputSource|undefined>{
 let input:LlmInputSource;
 if(values.content){
  const content=values.content,encoder=new TextEncoder();
  input={async dispose(){},bytes:{async *[Symbol.asyncIterator](){for(let offset=0;offset<content.length;){let end=Math.min(offset+4096,content.length);const last=content.charCodeAt(end-1);if(end<content.length&&last>=0xd800&&last<=0xdbff)end--;yield encoder.encode(content.slice(offset,end));offset=end;}}}};
 }else if(values.input&&values.input!=='-'){
  const path=pathOf(context,values.input),stat=await context.fs.stat(path,{signal:context.signal});
  if(!stat.size)return undefined;
  admit(stat.size);input=await fileSource({fs:context.fs,path,signal:context.signal,expectedStat:stat});
 }else{
  let spool:Awaited<ReturnType<typeof createLlmSpool>>|undefined;
  try{
   const stdin=context.stdinInput?{[Symbol.asyncIterator](){return {next:()=>context.stdinInput!.read(16384,context.signal)};}}:context.stdin;
   const decoder=new TextDecoder('utf-8',{fatal:true});
   for await(const bytes of sourceBytes(stdin,context.signal)){
    if(!bytes.length)continue;admit(bytes.length);
    spool??=await createLlmSpool(context.fs,context.cwd,context.signal,'input');
    if(!binary)for(let offset=0;offset<bytes.length;offset+=16384)decoder.decode(bytes.subarray(offset,offset+16384),{stream:true});
    await spool.write(bytes);
   }
   if(!binary)decoder.decode();
   if(!spool)return undefined;
   const retained=spool;input={bytes:retained.replay(),dispose:()=>retained.close()};
  }catch(error){await spool?.close().catch(()=>undefined);throw error;}
 }
 return !binary&&!values.content?{bytes:embeddingText(input.bytes,context.signal),dispose:()=>input.dispose()}:input;
}
