import {yieldTurn} from "safe-bash-contracts/yield";
import {isPythonWhitespace} from "./python-whitespace.js";

export async function* decodeLlmText(source:AsyncIterable<Uint8Array>,signal:AbortSignal):AsyncIterable<string>{
 const decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
 let steps=0;
 for await(const bytes of source){
  if(++steps%256===0)await yieldTurn(signal);
  signal.throwIfAborted();
  for(let offset=0;offset<bytes.length;offset+=2048){
   if(++steps%256===0)await yieldTurn(signal);
   signal.throwIfAborted();yield decoder.decode(bytes.subarray(offset,offset+2048),{stream:true});
  }
 }
 yield decoder.decode();
}

/** Scan line lengths separately from replay, so arbitrary whitespace-only lines
 * preserve Python indent semantics without retaining an entire line. */
export async function* indentLlmText(source:AsyncIterable<Uint8Array>,signal:AbortSignal):AsyncIterable<string>{
 const replay=decodeLlmText(source,signal)[Symbol.asyncIterator]();let pending='',offset=0;
 async function* line(length:number,nonblank:boolean){
  if(nonblank)yield '  ';
  while(length){
   if(offset===pending.length){const next=await replay.next();if(next.done)throw new Error('Stored content changed');pending=next.value;offset=0;if(!pending.length)continue;}
   const count=Math.min(length,pending.length-offset);yield pending.slice(offset,offset+count);offset+=count;length-=count;
  }
 }
 let length=0,nonblank=false;
 try{
  for await(const chunk of decodeLlmText(source,signal))for(const char of chunk){
   length+=char.length;
   if(!isPythonWhitespace(char))nonblank=true;
   if(['\n','\r','\v','\f','\u001c','\u001d','\u001e','\u0085','\u2028','\u2029'].includes(char)){yield* line(length,nonblank);length=0;nonblank=false;}
  }
  if(length)yield* line(length,nonblank);
 }finally{await replay.return?.();}
}
