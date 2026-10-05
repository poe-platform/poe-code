import {decodeLlmText,indentLlmText} from "./indent-text.js";
import type {LlmCollectionField,LlmCollectionSimilarity} from './collections-similarity.js';
import {floatText} from './embed-output.js';

function ascii(text:string):string{
 let result='';
 for(let index=0;index<text.length;index++){const code=text.charCodeAt(index);result+=code>127?'\\u'+code.toString(16).padStart(4,'0'):text[index];}
 return result;
}
async function* metadata(field:LlmCollectionField,signal:AbortSignal):AsyncIterable<string>{
 let quoted=false,escaped=false;
 for await(const chunk of decodeLlmText(field.bytes,signal)){
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
export async function* similarOutput(row:LlmCollectionSimilarity,plain:boolean,signal:AbortSignal):AsyncIterable<Uint8Array>{
 const encoder=new TextEncoder();
 async function* chunks():AsyncIterable<string>{
  const score=row.score===null?(plain?'None':'null'):floatText(row.score);
  if(plain){
   yield `${row.id} (${score})\n\n`;
   if(row.content?.size){yield* indentLlmText(row.content.bytes,signal);yield '\n';}
   if(row.metadata?.size){yield '  ';yield* metadata(row.metadata,signal);yield '\n';}
   yield '\n';return;
  }
  yield `{"id": ${ascii(JSON.stringify(row.id))}, "score": ${score}, "content": `;
  if(row.content){yield '"';for await(const chunk of decodeLlmText(row.content.bytes,signal))yield ascii(JSON.stringify(chunk).slice(1,-1));yield '"';}else yield 'null';
  yield ', "metadata": ';
  if(row.metadata)yield* metadata(row.metadata,signal);else yield 'null';
  yield '}\n';
 }
 for await(const chunk of chunks()){signal.throwIfAborted();yield encoder.encode(chunk);}
}
