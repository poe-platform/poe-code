import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand } from "./media.js";
import { probe } from "./probe.js";

const encoder=new TextEncoder();
function join(parts:Uint8Array[]){const bytes=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let at=0;for(const part of parts){bytes.set(part,at);at+=part.length;}return bytes;}
function stream(serial:number,fields:string[],opus=true){
  const head=new Uint8Array(opus?19:30),view=new DataView(head.buffer);
  if(opus){head.set(encoder.encode('OpusHead'));head[8]=1;head[9]=2;view.setUint16(10,312,true);}else{head.set([1,...encoder.encode('vorbis')]);head[11]=2;view.setUint32(12,44100,true);head[29]=1;}
  const prefix=opus?encoder.encode('OpusTags'):Uint8Array.from([3,...encoder.encode('vorbis')]),count=new Uint8Array(8);new DataView(count.buffer).setUint32(4,fields.length,true);
  const comments=join([prefix,count,...fields.flatMap(field=>{const text=encoder.encode(field),size=new Uint8Array(4);new DataView(size.buffer).setUint32(0,text.length,true);return[size,text];}),...(opus?[]:[Uint8Array.of(1)])]);
  const pages:Uint8Array[]=[];let sequence=0;
  for(const [index,packet] of [head,comments,Uint8Array.of(1)].entries())for(let at=0;at<=packet.length;){
    const length=Math.min(65025,packet.length-at),last=length<65025,laces=Array.from({length:Math.floor(length/255)},()=>255);if(last)laces.push(length%255);
    const page=new Uint8Array(27+laces.length+length),v=new DataView(page.buffer);page.set([79,103,103,83,0,(index===0&&at===0?2:0)|(at?1:0)|(index===2&&last?4:0)]);
    v.setBigUint64(6,last?(index===2?48000n:0n):0xffffffffffffffffn,true);v.setUint32(14,serial,true);v.setUint32(18,sequence++,true);page[26]=laces.length;page.set(laces,27);page.set(packet.subarray(at,at+length),27+laces.length);
    let crc=0;for(const byte of page){crc^=byte<<24;for(let bit=0;bit<8;bit++)crc=crc<<1^(crc&0x80000000?0x04c11db7:0);}v.setUint32(22,crc>>>0,true);pages.push(page);at+=length;if(last)break;
  }return pages;
}
async function run(bytes:Uint8Array,route:'retained'|'stream'|'stdin',writer='json',extra:string[]=[],invalid=false){
  const base=new MemoryFileSystem();await base.writeFile('/input.ogg',bytes);let closed=false,opened=0,retired=0,output='',diagnostic='';const decoder=new TextDecoder();
  async function* chunks(){const borrowed=new Uint8Array(8191);try{for(let at=0;at<bytes.length;at+=borrowed.length){const length=Math.min(borrowed.length,bytes.length-at);borrowed.set(bytes.subarray(at,at+length));yield borrowed.subarray(0,length);}}finally{closed=true;}}
  const capabilities={...base.capabilities,retainedRead:route==='retained',streamingRead:route!=='retained'};
  const fs=new Proxy(base,{get(target,key){
    if(key==='capabilities')return capabilities;if(key==='capabilitiesFor')return async()=>capabilities;
    if(key==='readFile')return()=>{throw new Error('buffered input forbidden');};if(key==='readStream')return()=>chunks();
    if(key==='openReadFile')return async()=>({stat:()=>base.stat('/input.ogg'),async read(offset:number,length:number){expect(length).toBeLessThanOrEqual(16384);return bytes.slice(offset,offset+length);},async close(){closed=true;}});
    if(key==='open')return async(...args:Parameters<typeof base.open>)=>{const handle=await base.open(...args);opened++;return new Proxy(handle,{get(resource,name){if(name==='close')return async()=>{retired++;await handle.close();};const value=Reflect.get(resource,name,resource);return typeof value==='function'?value.bind(resource):value;}});};
    const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
  }});
  const args=['-of',writer,'-show_streams','-show_format',...extra,route==='stdin'?'-':'/input.ogg'];
  const result=await createFfprobeCommand({limits:{maxOutputBytes:4000000}}).execute({command:'ffprobe',...createCommandArguments(args),cwd:'/',env:{},fs,signal:new AbortController().signal,stdin:route==='stdin'?chunks():{async *[Symbol.asyncIterator](){}},stdout:{async write(chunk){expect(closed).toBe(true);expect(opened-retired).toBeLessThanOrEqual(1);output+=decoder.decode(chunk,{stream:true});}},stderr:{async write(chunk){diagnostic+=new TextDecoder().decode(chunk);}}});
  output+=decoder.decode();expect(retired).toBe(opened);expect(await base.readdir('/')).toEqual([{name:'input.ogg',type:'file'}]);
  if(invalid){expect(result.exitCode).toBe(1);expect(output).toBe('');}else{expect(result.exitCode,diagnostic).toBe(0);expect(output).toBe(probe(bytes,args));}
}
for(const route of ['retained','stdin','stream'] as const)for(const writer of ['json','default','flat','compact','csv'])it(`streams Ogg metadata via ${route}/${writer}`,async()=>{
  await run(join(stream(7,['title='+ 'é😀,"x"\n'.repeat(11000),'title=','TITLE=other','artist=Alice','2=numeric'])),route,writer);
});
it('preserves chained codecs, raw key casing and selected stream fields',async()=>{
  const bytes=join([...stream(7,['title=first','title=second','TITLE=upper']),...stream(2,['ARTIST=last'],false)]);
  for(const route of ['retained','stdin','stream'] as const){await run(bytes,route);await run(bytes,route,'csv:s=||',['-show_entries','stream=codec_name,duration:stream_tags=title,ARTIST:format=nb_streams,duration']);}
});
it('keeps global picture replacement semantics and validates decoded picture lengths',async()=>{
  const picture=new Uint8Array(70032);new DataView(picture.buffer).setUint32(28,70000);const text=Buffer.from(picture).toString('base64');
  const bytes=join([...stream(7,['METADATA_BLOCK_PICTURE=!!!']),...stream(2,['metadata_block_picture='+text])]);
  await run(bytes,'retained','json');await run(join(stream(7,['METADATA_BLOCK_PICTURE=!!!'])),'stdin','json',[],true);
});
it('spills Ogg stream/tag indexes while preserving numeric ordering and duplicates',async()=>{
  const fields=Array.from({length:1500},(_,i)=>'key'+i+'=value'+i);fields.push('3=three','1=one','key0=again');
  await run(join(stream(7,fields)),'retained');
});

it('preserves inherited raw field names and ignores the prototype setter',async()=>{
  const bytes=join(stream(7,['constructor=value','toString=','hasOwnProperty=owned','__defineGetter__=field','__proto__=ignored','title=normal']));
  await run(bytes,'retained');
});
it('preserves multiplexed and first-completed packet ordering',async()=>{
  const a=stream(7,['title=first']),b=stream(2,['TITLE=second'],false);
  await run(join([a[0]!,b[0]!,a[1]!,b[1]!,a[2]!,b[2]!]),'retained');
});
it('emits format-only and empty selected rows without collecting streams',async()=>{
  const bytes=join([...stream(7,['title=first']),...stream(8,['title=second'])]);
  for(const writer of ['json','flat','default'])await run(bytes,'retained',writer,['-select_streams','a:0','-show_entries','stream=:format=duration,nb_streams:format_tags']);
});
