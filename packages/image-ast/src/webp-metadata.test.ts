import {readWebpMetadataFromSource} from "./codecs/webp-input-storage.js";
import {expect,it} from "vitest";
import {readWebpMetadata} from "./codecs/webp.js";
import {buildExifApp1Segment} from "./codecs/exif.js";

function riff(chunks:readonly [string,Uint8Array][]):Uint8Array {
 const bytes=new Uint8Array(12+chunks.reduce((sum,[,data])=>sum+8+data.length+(data.length&1),0)),view=new DataView(bytes.buffer);
 bytes.set([82,73,70,70]);view.setUint32(4,bytes.length-8,true);bytes.set([87,69,66,80],8);let at=12;
 for(const [name,data] of chunks){bytes.set(new TextEncoder().encode(name),at);view.setUint32(at+4,data.length,true);bytes.set(data,at+8);at+=8+data.length+(data.length&1);}
 return bytes;
}
function frame(kind:"VP8X"|"VP8L"|"VP8 ",width:number,height:number,alpha:boolean):Uint8Array {
 const bytes=new Uint8Array(kind==="VP8L"?5:10),view=new DataView(bytes.buffer);
 if(kind==="VP8X") {bytes[0]=alpha?16:0;for(let i=0;i<3;i++){bytes[4+i]=((width-1)>>>(8*i))&255;bytes[7+i]=((height-1)>>>(8*i))&255;}}
 else if(kind==="VP8L") {bytes[0]=47;view.setUint32(1,((width-1)|((height-1)<<14)|(alpha?1<<28:0))>>>0,true);}
 else {bytes.set([157,1,42],3);view.setUint16(6,width,true);view.setUint16(8,height,true);}
 return bytes;
}
for(const kind of ["VP8X","VP8L","VP8 "] as const)for(const alpha of [false,true])for(const exif of [false,true])it(`preserves WebP metadata ${kind}/${alpha}/${exif}`,async()=>{
 const bytes=riff([[kind,frame(kind,773,259,alpha)],...(exif?[["EXIF",buildExifApp1Segment({orientation:8,density:144})] as [string,Uint8Array]]:[])]);
 const expected=readWebpMetadata(bytes);expect(expected).toMatchSnapshot();
 expect(await readWebpMetadataFromSource(source(bytes),new AbortController().signal)).toEqual(expected);
});
for(const length of [0,11,12,19,20,24,25,29,30,31,32,33,34,35])it(`preserves truncated WebP metadata ${length}`,async()=>{
 const bytes=riff([["VP8X",frame("VP8X",17,19,true)],["EXIF",buildExifApp1Segment({orientation:6,density:300})]]).subarray(0,length);
 let result:unknown;try{result=readWebpMetadata(bytes);}catch(error){result=(error as Error).message;}
 expect(result).toMatchSnapshot();
 let actual:unknown;try{actual=await readWebpMetadataFromSource(source(bytes),new AbortController().signal);}catch(error){actual=(error as Error).message;}
 expect(actual).toEqual(result);
});
it("preserves ordered frame and EXIF overrides",()=>{
 expect(readWebpMetadata(riff([
  ["VP8X",frame("VP8X",170001,190002,false)],
  ["EXIF",buildExifApp1Segment({orientation:6,density:300})],
  ["VP8L",frame("VP8L",16384,16384,true)],
  ["ODD!",Uint8Array.of(1,2,3)],
  ["EXIF",Uint8Array.of(1,2,3)],
  ["VP8 ",frame("VP8 ",17,19,false)]
 ]))).toMatchSnapshot();
});

function source(bytes:Uint8Array) {
 const borrowed=new Uint8Array(4096);
 return {size:bytes.length,async read(at:number,length:number){expect(length).toBeLessThanOrEqual(4096);borrowed.fill(0);borrowed.set(bytes.subarray(at,at+length));return borrowed.subarray(0,length);}};
}
it("keeps source offsets above 32 bits without buffering skipped chunks",async()=>{
 const prefix=riff([["JUNK",new Uint8Array()]]);new DataView(prefix.buffer).setUint32(16,0xffffffff,true);
 const tail=riff([["VP8X",frame("VP8X",17,19,true)]]).subarray(12),start=20+0xffffffff+1,size=start+tail.length;
 let reads=0;
 const metadata=await readWebpMetadataFromSource({size,async read(at,length){
  reads++;expect(length).toBeLessThanOrEqual(4096);const bytes=new Uint8Array(length);
  for(const [base,block] of [[0,prefix],[start,tail]] as const){const low=Math.max(at,base),high=Math.min(at+length,base+block.length);if(low<high)bytes.set(block.subarray(low-base,high-base),low-at);}
  return bytes;
 }},new AbortController().signal);
 expect(metadata).toEqual({...readWebpMetadata(riff([["VP8X",frame("VP8X",17,19,true)]])),size});expect(reads).toBeLessThan(5);
});
for(const cancel of [false,true])it(`propagates WebP metadata ${cancel?"cancellation":"read failure"}`,async()=>{
 const bytes=riff([["JUNK",new Uint8Array(256*1024)],["VP8X",frame("VP8X",17,19,true)]]),backing=source(bytes),controller=new AbortController(),reason=new Error("metadata source failure");let reads=0;
 await expect(readWebpMetadataFromSource({size:bytes.length,async read(at,length){
  if(++reads===2){if(cancel)controller.abort(reason);else throw reason;}
  return backing.read(at,length);
 }},controller.signal)).rejects.toBe(reason);expect(reads).toBe(2);
});
