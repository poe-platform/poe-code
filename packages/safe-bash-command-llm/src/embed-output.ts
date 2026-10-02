import { yieldTurn } from "safe-bash-contracts/yield";
import { base64Stream } from './base64-stream.js';
export type LlmEmbeddingFormat = 'json' | 'blob' | 'base64' | 'hex';

/** Reference float spelling; retain signed zero and Python's exponent thresholds. */
function floatText(value: number): string {
 if(Object.is(value,-0))return '-0.0';
 const magnitude=Math.abs(value);
 if(magnitude!==0&&(magnitude<0.0001||magnitude>=1e16)){
  const [mantissa,exponent]=value.toExponential().split('e');
  const number=Number(exponent);
  return `${mantissa}e${number<0?'-':'+'}${String(Math.abs(number)).padStart(2,'0')}`;
 }
 return Number.isInteger(value)?`${value}.0`:String(value);
}
/** Encode an already validated vector without allocating a whole output copy. */
export async function* serializeLlmEmbedding(vector:readonly number[],format:LlmEmbeddingFormat,signal:AbortSignal):AsyncIterable<Uint8Array>{
 signal.throwIfAborted();
 if(format!=="json")for(let index=0;index<vector.length;index++){
  if(index&&index%4096===0)await yieldTurn(signal);
  if(!Number.isFinite(Math.fround(vector[index]!)))throw new RangeError("Embedding value exceeds float32 range");
 }
 const encoder=new TextEncoder();
 async function* binary():AsyncIterable<Uint8Array>{
  for(let offset=0;offset<vector.length;offset+=3072){
   signal.throwIfAborted();
   const bytes=new Uint8Array(Math.min(3072,vector.length-offset)*4),view=new DataView(bytes.buffer);
   for(let index=0;index<bytes.length/4;index++){
    const value=vector[offset+index]!;
    view.setFloat32(index*4,value,true);
   }
   yield bytes;
  }
 }
 if(format==='json'){
  yield encoder.encode('[');
  for(let index=0;index<vector.length;index++){signal.throwIfAborted();yield encoder.encode((index?', ':'')+floatText(vector[index]!));}
  yield encoder.encode(']');
 }else if(format==='base64'){
  for await(const text of base64Stream(binary(),signal))yield encoder.encode(text);
 }else{
  for await(const bytes of binary())yield format==='blob'?bytes:encoder.encode(Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join(''));
 }
 signal.throwIfAborted();yield Uint8Array.of(10);
}
