import {defaultRuntime} from "@poe-code/compression";
import type {ImageMetadata} from "../ast.js";
import type {ImageByteSource} from "./png-storage.js";
import {SourceBytes} from "./storage-source.js";
import {SvgNumber,scaleSvgNumber} from "./svg-number.js";

type Span=readonly [start:number,end:number];
const word=(byte:number|undefined)=>byte!==undefined&&(byte>=48&&byte<=57||byte>=65&&byte<=90||byte>=97&&byte<=122||byte===95);

/** Preserve the existing SVG header selection without retaining tag text. */
async function headerStart(reader:SourceBytes,size:number):Promise<number|undefined>{
 for(let position=0;position<size;position++){
  if(await reader.at(position)!==60)continue;
  if((((await reader.at(position+1))??0)|32)!==115||(((await reader.at(position+2))??0)|32)!==118||(((await reader.at(position+3))??0)|32)!==103||word(await reader.at(position+4)))continue;
  return position;
 }
 return undefined;
}

async function character(reader:SourceBytes,position:number,end:number):Promise<{text:string;length:number}>{
 const first=await reader.at(position);
 if(first===undefined||position>=end)return {text:"",length:0};
 if(first<128)return {text:String.fromCharCode(first),length:1};
 const length=Math.min(end-position,first>=240&&first<=244?4:first>=224&&first<240?3:first>=194&&first<224?2:1),bytes=new Uint8Array(length);
 bytes[0]=first;let used=1;
 for(let index=1;index<length;index++){
  const next=(await reader.at(position+index))!;
  if(next<128||next>191||index===1&&(first===224&&next<160||first===237&&next>159||first===240&&next<144||first===244&&next>143))break;
  bytes[used++]=next;
 }
 return {text:new TextDecoder().decode(bytes.subarray(0,used)),length:used};
}

async function attributes(reader:SourceBytes,size:number):Promise<ReadonlyMap<string,Span>>{
 const found=new Map<string,Span>(),start=await headerStart(reader,size),names:Record<string,string>={w:"width",h:"height",v:"viewbox"};
 if(start===undefined)return found;
 let boundary=true;
 for(let position=start;position<size;){
  const char=await character(reader,position,size);
  if(char.text===">")return found;
  const name=boundary?names[char.text.toLowerCase()]:undefined;
  if(name&&!found.has(name)){
   let at=position,matched=true;
   for(const letter of name){if((((await reader.at(at))??0)|32)!==letter.charCodeAt(0)){matched=false;break;}at++;}
   if(matched){
    const skip=async()=>{while(at<size){const value=await character(reader,at,size);if(value.text.trim())break;at+=value.length;}};
    await skip();if(await reader.at(at)===61){at++;await skip();const quote=await reader.at(at);
     if(quote===34||quote===39){const begin=++at;for(;at<size;at++){const byte=await reader.at(at);if(byte===62)break;if(byte===34||byte===39){found.set(name,[begin,at]);break;}}}
    }
   }
  }
  boundary=!char.text.trim()||char.text==='"'||char.text==="'";position+=char.length;
 }
 // An unterminated opening tag has no attributes in the convenience parser.
 return new Map();
}

async function* text(source:ImageByteSource,span:Span,signal:AbortSignal):AsyncGenerator<string>{
 const decoder=new TextDecoder();
 for(let position=span[0];position<span[1];position+=4096){
  signal.throwIfAborted();const length=Math.min(4096,span[1]-position),bytes=await source.read(position,length,{signal});signal.throwIfAborted();
  if(!(bytes instanceof Uint8Array)||bytes.length!==length)throw new Error("Truncated SVG source");
  yield decoder.decode(bytes,{stream:true});await defaultRuntime.yieldTurn(signal);
 }
 const last=decoder.decode();if(last)yield last;
}

async function dimension(source:ImageByteSource,span:Span|undefined,fallback:number,signal:AbortSignal):Promise<number>{
 if(!span)return fallback;
 const number=new SvgNumber();for await(const chunk of text(source,span,signal))for(const char of chunk)number.accept(char);
 const value=number.value("float");return Number.isFinite(value)&&value>0?scaleSvgNumber(value,number.unit(),fallback):fallback;
}

async function viewBox(source:ImageByteSource,span:Span|undefined,signal:AbortSignal):Promise<readonly number[]|undefined>{
 if(!span)return undefined;
 const values:number[]=[];let token:SvgNumber|undefined,started=false,trailingComma=false;
 for await(const chunk of text(source,span,signal))for(const char of chunk){
  if(char===","||!char.trim()){
   if(token){values.push(token.value("number"));token=undefined;}
   if(char===","){if(!started){values.push(0);started=true;}trailingComma=true;}
   if(values.length>4)return undefined;
  }else{started=true;trailingComma=false;token??=new SvgNumber();token.accept(char);}
 }
 if(token)values.push(token.value("number"));else if(trailingComma)values.push(0);
 return values.length===4&&values[2]!>0&&values[3]!>0?values:undefined;
}

/** Read only header ranges; source and any backing remain caller-owned. */
export async function readSvgMetadataFromSource(source:ImageByteSource,signal:AbortSignal,options?:{readonly density?:number}):Promise<ImageMetadata>{
 signal.throwIfAborted();const density=options?.density??72,reader=new SourceBytes(source,signal,"SVG"),fields=await attributes(reader,source.size);
 const box=await viewBox(source,fields.get("viewbox"),signal);
 const width=await dimension(source,fields.get("width"),box?.[2]??300,signal);
 const height=await dimension(source,fields.get("height"),box?.[3]??150,signal);
 const scale=density/72;
 signal.throwIfAborted();return {format:"svg",width:Math.max(1,Math.round(width*scale)),height:Math.max(1,Math.round(height*scale)),space:"srgb",channels:4,depth:"uchar",density,hasAlpha:true,size:source.size};
}
