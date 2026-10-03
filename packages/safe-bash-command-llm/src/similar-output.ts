import type {LlmCollectionField,LlmCollectionSimilarity} from './collections-similarity.js';
import {floatText} from './embed-output.js';

function ascii(text:string):string{
 let result='';
 for(let index=0;index<text.length;index++){const code=text.charCodeAt(index);result+=code>127?'\\u'+code.toString(16).padStart(4,'0'):text[index];}
 return result;
}
async function* text(field:LlmCollectionField,signal:AbortSignal):AsyncIterable<string>{
 const decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
 for await(const bytes of field.bytes)for(let offset=0;offset<bytes.length;offset+=2048){signal.throwIfAborted();yield decoder.decode(bytes.subarray(offset,offset+2048),{stream:true});}
 yield decoder.decode();
}
async function* metadata(field:LlmCollectionField,signal:AbortSignal):AsyncIterable<string>{
 let quoted=false,escaped=false;
 for await(const chunk of text(field,signal)){
  let out='';
  for(const char of chunk){
   if(quoted){out+=ascii(char);if(escaped)escaped=false;else if(char==='\\')escaped=true;else if(char==='"')quoted=false;}
   else if(char==='"'){quoted=true;out+=char;}
   else if(char===','||char===':')out+=char+' ';
   else if(char.trim())out+=char;
  }
  yield out;
 }
}
/** Scan line lengths separately from replay, so arbitrary whitespace-only lines
 * preserve Python indent semantics without retaining an entire line. */
async function* indent(field:LlmCollectionField,signal:AbortSignal):AsyncIterable<string>{
 const replay=text(field,signal)[Symbol.asyncIterator]();let pending='',offset=0;
 async function* line(length:number,nonblank:boolean){
  if(nonblank)yield '  ';
  while(length){
   if(offset===pending.length){const next=await replay.next();if(next.done)throw new Error('Stored content changed');pending=next.value;offset=0;if(!pending.length)continue;}
   const count=Math.min(length,pending.length-offset);yield pending.slice(offset,offset+count);offset+=count;length-=count;
  }
 }
 let length=0,nonblank=false;
 try{
  for await(const chunk of text(field,signal))for(const char of chunk){
   length+=char.length;
   if(char==='\ufeff'||char.trim()&&!['\u001c','\u001d','\u001e','\u001f','\u0085'].includes(char))nonblank=true;
   if(['\n','\r','\v','\f','\u001c','\u001d','\u001e','\u0085','\u2028','\u2029'].includes(char)){yield* line(length,nonblank);length=0;nonblank=false;}
  }
  if(length)yield* line(length,nonblank);
 }finally{await replay.return?.();}
}
export async function* similarOutput(row:LlmCollectionSimilarity,plain:boolean,signal:AbortSignal):AsyncIterable<Uint8Array>{
 const encoder=new TextEncoder();
 async function* chunks():AsyncIterable<string>{
  const score=row.score===null?(plain?'None':'null'):floatText(row.score);
  if(plain){
   yield `${row.id} (${score})\n\n`;
   if(row.content?.size){yield* indent(row.content,signal);yield '\n';}
   if(row.metadata?.size){yield '  ';yield* metadata(row.metadata,signal);yield '\n';}
   yield '\n';return;
  }
  yield `{"id": ${ascii(JSON.stringify(row.id))}, "score": ${score}, "content": `;
  if(row.content){yield '"';for await(const chunk of text(row.content,signal))yield ascii(JSON.stringify(chunk).slice(1,-1));yield '"';}else yield 'null';
  yield ', "metadata": ';
  if(row.metadata)yield* metadata(row.metadata,signal);else yield 'null';
  yield '}\n';
 }
 for await(const chunk of chunks()){signal.throwIfAborted();yield encoder.encode(chunk);}
}
