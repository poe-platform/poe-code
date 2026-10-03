import {readBytes,type ByteSource} from 'safe-bash-contracts';
import {Budget,JqLimitError} from './limits.js';

/** Python's JSON bytes encoding probe needs at most four bytes. Transcoding
 * retains only decoder carry and a bounded output chunk, and charges raw input. */
export async function* pythonJsonBytes(source:ByteSource,budget:Budget,surrogatepass=false):AsyncGenerator<Uint8Array>{
 const header=new Uint8Array(4);let count=0,started=false,width=1,little=false,decoder:TextDecoder|undefined;
 let unit=0,unitBytes=0,pendingHigh:number|undefined;const encoder=new TextEncoder();
 const detect=()=>{
  let skip=0;
  if(count>=4&&header[0]===0&&header[1]===0&&header[2]===254&&header[3]===255){width=4;skip=4;}
  else if(count>=4&&header[0]===255&&header[1]===254&&header[2]===0&&header[3]===0){width=4;little=true;skip=4;}
  else if(count>=2&&header[0]===254&&header[1]===255){width=2;skip=2;}
  else if(count>=2&&header[0]===255&&header[1]===254){width=2;little=true;skip=2;}
  else if(count>=3&&header[0]===239&&header[1]===187&&header[2]===191)skip=3;
  else if(count>=4){
   if(header[0]===0)width=header[1]===0?4:2;
   else if(header[1]===0){width=header[2]!==0||header[3]!==0?2:4;little=true;}
  }else if(count===2){if(header[0]===0)width=2;else if(header[1]===0){width=2;little=true;}}
  if(width===2&&!surrogatepass)decoder=new TextDecoder(little?'utf-16le':'utf-16be',{fatal:true,ignoreBOM:true});
  started=true;return header.subarray(skip,count);
 };
 const convert=(bytes:Uint8Array)=>{
  if(width===1)return bytes;
  if(decoder)return encoder.encode(decoder.decode(bytes,{stream:true}));
  const output:number[]=[];
  for(const byte of bytes){
   unit+=byte*2**(little?unitBytes*8:(width-1-unitBytes)*8);unitBytes++;
   if(unitBytes===width){
    if(unit>0x10ffff||!surrogatepass&&unit>=0xd800&&unit<=0xdfff)throw new TypeError('Invalid UTF-32 JSON code point');
    if(width===2&&pendingHigh!==undefined){
     if(unit>=0xdc00&&unit<=0xdfff){appendPythonCodePoint(output,0x10000+((pendingHigh-0xd800)<<10)+unit-0xdc00);pendingHigh=undefined;unit=0;unitBytes=0;continue;}
     appendPythonCodePoint(output,pendingHigh);pendingHigh=undefined;
    }
    if(width===2&&unit>=0xd800&&unit<=0xdbff)pendingHigh=unit;else appendPythonCodePoint(output,unit);
    unit=0;unitBytes=0;
   }
  }
  return Uint8Array.from(output);
 };
 for await(const chunk of readBytes(source,budget.signal)){
  budget.inputBytes+=chunk.length;
  if(budget.inputBytes>budget.limits.maxInputBytes)throw new JqLimitError('maxInputBytes');
  const pending=budget.tickSync();if(pending)await pending;
  if(!chunk.length){const pending=budget.ensureFreshWindow();if(pending)await pending;}
  let offset=0;
  if(!started){while(count<4&&offset<chunk.length)header[count++]=chunk[offset++]!;if(count===4){const bytes=convert(detect());if(bytes.length)yield bytes;}}
  while(offset<chunk.length){
   budget.signal.throwIfAborted();
   const end=Math.min(offset+4096,chunk.length),bytes=convert(chunk.subarray(offset,end));offset=end;
   budget.step(4);const pending=budget.tickSync();if(pending)await pending;
   if(bytes.length)yield bytes;
  }
 }
 if(!started){const bytes=convert(detect());if(bytes.length)yield bytes;}
 if(decoder){const bytes=encoder.encode(decoder.decode());if(bytes.length)yield bytes;}
 if(unitBytes)throw new TypeError(`Truncated UTF-${width*8} JSON code point`);
 if(pendingHigh!==undefined)yield Uint8Array.of(0xe0|(pendingHigh>>12),0x80|((pendingHigh>>6)&63),0x80|(pendingHigh&63));
}

/** UTF-8 surrogatepass encoding preserves individual Python surrogate points. */
export function encodePythonCodePoints(points:readonly number[]):Uint8Array{
 const output:number[]=[];for(const point of points)appendPythonCodePoint(output,point);return Uint8Array.from(output);
}
function appendPythonCodePoint(output:number[],point:number):void{
 if(point<0x80)output.push(point);
 else if(point<0x800)output.push(0xc0|(point>>6),0x80|(point&63));
 else if(point<0x10000)output.push(0xe0|(point>>12),0x80|((point>>6)&63),0x80|(point&63));
 else output.push(0xf0|(point>>18),0x80|((point>>12)&63),0x80|((point>>6)&63),0x80|(point&63));
}
