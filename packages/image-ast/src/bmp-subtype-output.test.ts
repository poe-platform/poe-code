import {expect, it} from "vitest";
import type {OutputEncodeOptions, RgbaImage} from "./ast.js";
import {encodeBmpImage, decodeBmpImage} from "./codecs/netpbm.js";
import {encodeBmpFromStorage, decodeBmpToStorage} from "./codecs/bmp-storage.js";
import type {ImageByteStorage} from "./codecs/png-storage.js";

for(const subtype of ["RGB565","RGB555","ARGB4444","ARGB1555"] as const) for(const bmpFormat of ["bmp3","bmp4"] as const) {
 it(`round-trips ${subtype} in ${bmpFormat} across streamed chunk boundaries`,async()=>{
  const alpha=subtype.startsWith("ARGB"),data=Uint8Array.from(Array.from({length:2051*2},(_,i)=>[i%256,(i*3)%256,(i*7)%256,alpha?(i*11)%256:255]).flat());
  const image:RgbaImage={width:2051,height:2,data,format:"bmp",space:"srgb",channels:alpha?4:3,depth:"uchar",density:72,hasAlpha:alpha};
  const options:OutputEncodeOptions={bmpFormat,bmpSubtype:subtype},expected=encodeBmpImage(image,options),chunks:Uint8Array[]=[];
  const signal=new AbortController().signal;
  const memory=new Uint8Array(data.length*2);memory.set(data);let position=data.length;
  const storage:ImageByteStorage={allocate(size){const start=position;position+=size;return start;},async read(start,length){return memory.slice(start,start+length);},async write(start,bytes){memory.set(bytes,start);}};
  for await(const chunk of encodeBmpFromStorage({...image,position:0},storage,signal,options)) {expect(chunk.length).toBeLessThanOrEqual(4096);chunks.push(chunk);}
  expect(Buffer.concat(chunks)).toEqual(Buffer.from(expected));
  const decoded=decodeBmpImage(expected);
  const stored=await decodeBmpToStorage({size:expected.length,async read(start,length){return expected.slice(start,start+length);}},storage,signal);
  expect(stored.hasAlpha).toBe(alpha);
  expect(memory.slice(stored.position,stored.position+data.length)).toEqual(decoded.data);
  for(let i=0;i<data.length;i++) expect(Math.abs(decoded.data[i]!-data[i]!)).toBeLessThanOrEqual(i%4===3&&subtype==="ARGB1555"?127:subtype==="ARGB4444"?8:4);
 });
}
it("keeps palette output when an alpha subtype does not apply",()=>{
 const image:RgbaImage={width:1,height:1,data:Uint8Array.of(255,255,255,255),format:"bmp",space:"b-w",channels:1,depth:"uchar",density:72,hasAlpha:false};
 expect(encodeBmpImage(image,{bmpSubtype:"ARGB4444"})).toEqual(encodeBmpImage(image));
});
