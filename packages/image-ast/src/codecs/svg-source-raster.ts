import {defaultRuntime} from "@poe-code/compression";
import type {ImageMetadata} from "../ast.js";
import type {ImageByteSource,ImageByteStorage} from "./png-storage.js";
import {SourceBytes} from "./storage-source.js";
import {svgAttributes,svgCharacter,svgHeaderStart,svgText,svgViewBox,type SvgSpan} from "./svg-metadata-source.js";
import {SvgNumber} from "./svg-number.js";
import {svgPathSteps,svgPathTokenSteps,type SvgPathToken} from "./svg-path.js";
import {SvgRecords} from "./svg-records.js";
import {rasterSvgElement,type SvgMatrix,type SvgPixel,type SvgPoint} from "./svg-renderer.js";
import {applySvgTransform,multiplySvgMatrices} from "./svg-transform.js";

const fieldNames=['cx','cy','fill','fill-opacity','font-size','height','opacity','r','rx','ry','stroke','stroke-opacity','stroke-width','text-anchor','width','x','x1','x2','y','y1','y2','d','points','transform'];
const word=(byte:number|undefined)=>byte!==undefined&&(byte>=48&&byte<=57||byte>=65&&byte<=90||byte>=97&&byte<=122||byte===95);

async function matches(reader:SourceBytes,start:number,end:number,text:string,fold=false):Promise<boolean>{
 if(start+text.length>end)return false;
 for(let index=0;index<text.length;index++){const byte=await reader.at(start+index);if((fold?(byte!|32):byte)!==text.charCodeAt(index))return false;}return true;
}

async function* numbers(source:ImageByteSource,span:SvgSpan,signal:AbortSignal):AsyncGenerator<number>{
 let token:SvgNumber|undefined,started=false,trailingComma=false;
 for await(const chunk of svgText(source,span,signal))for(const char of chunk){
  if(char===','||!char.trim()){
   if(token){yield token.value('number');token=undefined;}
   if(char===','){if(!started){yield 0;started=true;}trailingComma=true;}
  }else{started=true;trailingComma=false;token??=new SvgNumber();token.accept(char);}
 }
 if(token)yield token.value('number');else if(trailingComma||!started)yield 0;
}

function decimal(value:number):string{
 const raw=String(value),at=raw.indexOf('e');if(at<0)return raw;
 let coefficient=raw.slice(0,at),sign='';if(coefficient.startsWith('-')){sign='-';coefficient=coefficient.slice(1);}
 const dot=coefficient.indexOf('.'),digits=coefficient.replace('.',''),point=(dot<0?coefficient.length:dot)+Number(raw.slice(at+1));
 return sign+(point<=0?'0.'+'0'.repeat(-point)+digits:point>=digits.length?digits+'0'.repeat(point-digits.length):digits.slice(0,point)+'.'+digits.slice(point));
}

async function fields(source:ImageByteSource,spans:ReadonlyMap<string,SvgSpan>,signal:AbortSignal):Promise<Record<string,string>>{
 const result:Record<string,string>={};
 for(const [name,span]of spans){
  if(name==='d'||name==='points'||name==='transform')continue;
  if(name==='fill'||name==='stroke'||name==='text-anchor'){
   let value='';for await(const chunk of svgText(source,span,signal)){value+=chunk.slice(0,201-value.length);if(value.length>200)break;}
   // Color inputs already reject strings longer than 200 UTF-16 characters.
   result[name]=value;continue;
  }
  const number=new SvgNumber();for await(const chunk of svgText(source,span,signal))for(const char of chunk)number.accept(char);
  const value=number.value(name==='stroke-opacity'?'number':'float'),unit=name==='opacity'||name==='fill-opacity'||name==='stroke-opacity'?undefined:number.unit();
  result[name]=unit?decimal(value)+unit:String(value);
 }
 return result;
}

async function transform(source:ImageByteSource,reader:SourceBytes,span:SvgSpan|undefined,matrix:SvgMatrix,signal:AbortSignal):Promise<SvgMatrix>{
 if(!span||span[0]===span[1])return matrix;
 let local:SvgMatrix=[1,0,0,1,0,0];
 for(let position=span[0];position<span[1];position++)for(const kind of ['matrix','translate','scale','rotate']){
  if(!await matches(reader,position,span[1],kind,true))continue;
  let at=position+kind.length;
  while(at<span[1]){const char=await svgCharacter(reader,at,span[1]);if(char.text.trim())break;at+=char.length;}
  if(await reader.at(at)!==40)continue;
  const start=++at;while(at<span[1]&&await reader.at(at)!==41)at++;
  if(at===span[1])continue;
  const args:number[]=[];for await(const value of numbers(source,[start,at],signal))if(Number.isFinite(value)&&args.length<6)args.push(value);
  local=applySvgTransform(local,kind,args);position=at;break;
 }
 return multiplySvgMatrices(matrix,local);
}

async function* pathTokens(reader:SourceBytes,span:SvgSpan):AsyncGenerator<SvgPathToken>{
 const steps=svgPathTokenSteps();let next=steps.next();
 try{while(!next.done){
  if(typeof next.value==='number'){const position=span[0]+next.value;next=steps.next(position<span[1]?String.fromCharCode((await reader.at(position))!):undefined);}
  else{yield next.value.token;next=steps.next();}
 }}finally{steps.return();}
}

async function* textCodes(reader:SourceBytes,span:SvgSpan):AsyncGenerator<number>{
 for(let position=span[0];position<span[1];){
  const byte=await reader.at(position);
  if(byte===60){let end=position+1;while(end<span[1]&&await reader.at(end)!==62)end++;if(end>position+1&&end<span[1]){position=end+1;continue;}}
  if(byte===38){
   let matched=false;
   for(const [encoded,decoded]of [['&quot;','"'],['&apos;',"'"],['&#39;',"'"],['&lt;','<'],['&gt;','>'],['&amp;','&']]){
    if(await matches(reader,position,span[1],encoded!)){yield decoded!.charCodeAt(0);position+=encoded!.length;matched=true;break;}
   }
   if(matched)continue;
  }
  const character=await svgCharacter(reader,position,span[1]);position+=character.length;
  for(let index=0;index<character.text.length;index++)yield character.text.charCodeAt(index);
 }
}

/** Parse retained SVG ranges and drive the same geometry as the byte API. */
export async function* svgSourcePixels(source:ImageByteSource,storage:ImageByteStorage,signal:AbortSignal,metadata:ImageMetadata):AsyncGenerator<SvgPixel|undefined>{
 const reader=new SourceBytes(source,signal,'SVG'),header=await svgHeaderStart(reader,source.size);
 const root=header===undefined?new Map<string,SvgSpan>():await svgAttributes(reader,header,source.size,['viewbox']);
 const box=await svgViewBox(source,root.get('viewbox'),signal),{width,height,density}=metadata;
 const vbW=box?.[2]??width/(density/72),vbH=box?.[3]??height/(density/72),scaleX=width/Math.max(1e-6,vbW),scaleY=height/Math.max(1e-6,vbH);
 let active:SvgMatrix=[scaleX,0,0,scaleY,-(box?.[0]??0)*scaleX,-(box?.[1]??0)*scaleY],stack=-1,work=0;
 for(let position=0;position<source.size;position++){
  if(await reader.at(position)!==60)continue;
  const close=await reader.at(position+1)===47,nameStart=position+(close?2:1);
  let tag:string|undefined;
  for(const name of ['text','g','rect','circle','ellipse','line','polygon','polyline','path'])if(await matches(reader,nameStart,source.size,name,true)&&!word(await reader.at(nameStart+name.length))){tag=name;break;}
  if(!tag||tag==='text'&&close)continue;
  let end=nameStart+tag.length;while(end<source.size&&await reader.at(end)!==62)end++;
  if(end===source.size)continue;
  let textSpan:SvgSpan|undefined;
  if(tag==='text'){
   let textEnd=end+1;for(;textEnd<source.size;textEnd++)if(await matches(reader,textEnd,source.size,'</text>',true))break;
   if(textEnd===source.size)continue;
   textSpan=[end+1,textEnd];position=textEnd+6;
  }else position=end;
  const spans=await svgAttributes(reader,nameStart+tag.length,end+1,fieldNames);
  if(tag==='g'){
   if(close){if(stack>=0){const bytes=await storage.read(stack,56,{signal});signal.throwIfAborted();if(bytes.length!==56)throw new Error('Truncated SVG transform stack');const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);stack=view.getFloat64(0,true);active=[view.getFloat64(8,true),view.getFloat64(16,true),view.getFloat64(24,true),view.getFloat64(32,true),view.getFloat64(40,true),view.getFloat64(48,true)];}}
   else if(await reader.at(end-1)!==47){
    const next=await transform(source,reader,spans.get('transform'),active,signal),address=storage.allocate(56),bytes=new Uint8Array(56),view=new DataView(bytes.buffer);
    if(!Number.isSafeInteger(address)||address<0||!Number.isSafeInteger(address+56))throw new RangeError('Invalid SVG backing allocation');
    view.setFloat64(0,stack,true);for(let index=0;index<6;index++)view.setFloat64((index+1)*8,active[index]!,true);
    await storage.write(address,bytes,{signal});signal.throwIfAborted();stack=address;active=next;
   }
   continue;
  }
  if(close)continue;
  const attrs=await fields(source,spans,signal),matrix=await transform(source,reader,spans.get('transform'),active,signal);
  const mapPoint=(x:number,y:number):SvgPoint=>[matrix[0]*x+matrix[2]*y+matrix[4],matrix[1]*x+matrix[3]*y+matrix[5]];
  const points=new SvgRecords(2,storage,signal),text=new SvgRecords(1,storage,signal);let closed=false;
  if(tag==='path'&&spans.has('d')){
   const tokens=pathTokens(reader,spans.get('d')!),steps=svgPathSteps();let next=steps.next();
   try{while(!next.done){if(next.value===undefined)next=steps.next((await tokens.next()).value);else{await points.push(mapPoint(...next.value));next=steps.next();}}closed=next.value;}finally{steps.return(false);await tokens.return(undefined);}
  }else if((tag==='polygon'||tag==='polyline')&&spans.has('points')){
   let x:number|undefined;for await(const number of numbers(source,spans.get('points')!,signal))if(Number.isFinite(number)){if(x===undefined)x=number;else{await points.push(mapPoint(x,number));x=undefined;}}
  }
  if(textSpan)for await(const code of textCodes(reader,textSpan))await text.push([code]);
  await points.finish();await text.finish();
  const steps=rasterSvgElement({tag,attrs,matrix,pointCount:points.length,closed,textLength:text.length},{width,height,vbW,vbH});let next=steps.next();
  try{while(!next.done){
   signal.throwIfAborted();if(++work%16384===0)await defaultRuntime.yieldTurn(signal);
   const event=next.value;
   if(event&&'kind'in event)next=steps.next(event.kind==='point'?await points.get(event.index) as SvgPoint:(await text.get(event.index))[0]);
   else{yield event;next=steps.next();}
  }}finally{steps.return();}
 }
}
