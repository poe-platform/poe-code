import { expect, it } from "vitest";
import { parseMp3 } from "./mp3.js";
import { encodeId3 } from "./id3.js";
import { join } from "./binary.js";
import { probeMp3Source, type Mp3Tag } from "./mp3-source.js";
import { readId3Text } from "./id3-source.js";

function frames(count=3, second=251, third=144, fourth=0) {
  const version=(second>>>3)&3, rate=[44100,48000,32000][third>>>2&3]!/(version===3?1:version===2?2:4);
  const bitrate=(version===3?[0,32,40,48,56,64,80,96,112,128,160,192,224,256,320]:[0,8,16,24,32,40,48,56,64,80,96,112,128,144,160])[third>>>4]!*1000;
  const size=Math.floor((version===3?144:72)*bitrate/rate)+(third>>>1&1),bytes=new Uint8Array(size*count);
  for(let i=0;i<count;i++)bytes.set([255,second,third,fourth],i*size);
  return bytes;
}
const source=(bytes:Uint8Array)=>({size:bytes.length,async read(offset:number,length:number){expect(length).toBeLessThanOrEqual(16384);return bytes.slice(offset,offset+length);}});
async function compare(bytes:Uint8Array){
  const {data:ignoredData,nodes:ignoredNodes,pictures:ignoredPictures,...expected}=parseMp3(bytes);
  const { nodes: ignoredSourceNodes, ...actual } = await probeMp3Source(source(bytes));
  expect(actual).toEqual(expected);
}
for(const second of [251,243,227])for(const fourth of [0,192])it(`preserves strict MPEG timing for ${second}/${fourth}`,async()=>{await compare(frames(4,second,144,fourth));});
for(const marker of ['Xing','Info','VBRI'])it(`preserves ${marker} timing and delay/padding`,async()=>{
  const bytes=frames(),view=new DataView(bytes.buffer);bytes.set(new TextEncoder().encode(marker),36);
  if(marker==='VBRI')view.setUint32(50,3);else {view.setUint32(40,1);view.setUint32(44,2);bytes.set(new TextEncoder().encode('LAME'),48);bytes.set([1,32,16],69);}
  await compare(bytes);
});
it('preserves ID3v1 order and ID3v2 precedence while streaming long tags',async()=>{
  const tail=new Uint8Array(128);tail.set(new TextEncoder().encode('TAGold title'));tail[126]=7;tail[127]=13;
  const bytes=join([encodeId3({title:'Écho '.repeat(10000),TZZZ:'extra'}),frames(),tail]);await compare(bytes);
  const tags:Record<string,string>={},events:Mp3Tag[]=[];
  const input=source(bytes),result=await probeMp3Source(input,{onTag:async tag=>{events.push(tag);if('value'in tag)tags[tag.key]=tag.value;else {let text='';for await(const part of readId3Text(input,tag))text+=part;tags[tag.key]=text.split('\0')[0]!.trimEnd();}}});
  expect(result.tags).toEqual({});expect(tags).toEqual(parseMp3(bytes).tags);expect(Object.keys(tags)).toEqual(Object.keys(parseMp3(bytes).tags));expect(events.length).toBe(9);
});
it('rejects malformed frames and inconsistent streams with resident diagnostics',async()=>{
  const invalid=[frames().slice(0,-1),new Uint8Array(4),join([frames(1),frames(1,243)]),encodeId3({title:'no frames'})];
  const badCount=frames();badCount.set(new TextEncoder().encode('Xing'),36);new DataView(badCount.buffer).setUint32(40,1);new DataView(badCount.buffer).setUint32(44,17);invalid.push(badCount);
  for(const bytes of invalid){let message='';try{parseMp3(bytes);}catch(error){message=(error as Error).message;}expect(message).not.toBe('');await expect(probeMp3Source(source(bytes))).rejects.toThrow(message);}
});
it('avoids encoded sample reads and per-frame models for large logical sources',async()=>{
  const count=10000,size=count*417;let reads=0;
  const result=await probeMp3Source({size,async read(offset,length){expect(length).toBeLessThanOrEqual(192);reads++;const bytes=new Uint8Array(length);for(let i=0;i<length;i++){const at=(offset+i)%417;if(at<4)bytes[i]=[255,251,144,0][at]!;}return bytes;}});
  expect(result.streams[0]!.samples).toBe(count*1152);expect(reads).toBeLessThan(count+5);expect(result.nodes).toHaveLength(1);expect(result.nodes[0]!.data).toHaveLength(0);
});
it('propagates source errors, short reads, cancellation and callback errors',async()=>{
  const bytes=join([encodeId3({title:'name'}),frames()]),controller=new AbortController();
  await expect(probeMp3Source(source(bytes),{onTag:async()=>{throw new Error('callback failure');}})).rejects.toThrow('callback failure');
  await expect(probeMp3Source({size:bytes.length,async read(){return new Uint8Array();}})).rejects.toThrow('Truncated or invalid audio structure');
  await expect(probeMp3Source({size:bytes.length,async read(){throw new Error('source failure');}})).rejects.toThrow('source failure');
  await expect(probeMp3Source(source(bytes),{signal:controller.signal,checkpoint:async()=>{controller.abort(new Error('cancelled checkpoint'));}})).rejects.toThrow('cancelled checkpoint');
});
it('owns bounded Xing metadata when source reads reuse a buffer',async()=>{
  const bytes=frames(),view=new DataView(bytes.buffer);bytes.set(new TextEncoder().encode('Xing'),36);view.setUint32(40,7);view.setUint32(44,3);view.setUint32(48,bytes.length);
  const toc=Uint8Array.from({length:100},(_,i)=>i+1);bytes.set(toc,52);
  const borrowed=new Uint8Array(192),result=await probeMp3Source({size:bytes.length,async read(offset,length){borrowed.fill(0);borrowed.set(bytes.subarray(offset,offset+length));return borrowed.subarray(0,length);}});
  expect((result.nodes[0]!.fields!.vbr as {toc:Uint8Array}).toc).toEqual(toc);
});
