import {expect, it} from "vitest";
import {encodeImage, decodeImage} from "@poe-code/image-ast/portable";
import type {RgbaImage} from "@poe-code/image-ast/portable";
import {MemoryFileSystem} from "@poe-code/safe-fs/core";
import {runConvertCli, runConvertCliSync} from "./index.js";

// Packed rows recorded with native ImageMagick; width 3 exercises row padding.
const vectors = [
 {subtype:"RGB565",alpha:false,masks:[0xf800,0x07e0,0x001f,0],payload:"687910844108000000f8e0071f000000"},
 {subtype:"RGB555",alpha:false,masks:[0x7c00,0x03e0,0x001f,0],payload:"a83c104221040000007ce0031f000000"},
 {subtype:"ARGB4444",alpha:true,masks:[0x0f00,0x00f0,0x000f,0xf000],payload:"347788880110000000fff0800f000000"},
 {subtype:"ARGB1555",alpha:true,masks:[0x7c00,0x03e0,0x001f,0x8000],payload:"a83c10c22104000000fce0831f000000"}
];
const pixels=[255,0,0,255,0,255,0,128,0,0,255,0,123,45,67,127,128,129,130,128,7,8,9,16];
for(const vector of vectors) for(const mode of ["sync","buffered","retained"] as const) {
 it(`packs ${vector.subtype} masks and pixels through ${mode} writes`,async()=>{
  const image:RgbaImage={width:3,height:2,data:Uint8Array.from(pixels.map((v,i)=>!vector.alpha&&i%4===3?255:v)),format:"png",space:"srgb",channels:vector.alpha?4:3,depth:"uchar",density:72,hasAlpha:vector.alpha};
  const input=encodeImage(image,{format:"png"}).data,files=new Map([["/in.png",input]]),filesystem=new MemoryFileSystem();
  await filesystem.writeFile("/in.png",input);
  const args=["/in.png","-define",`bmp:subtype=${vector.subtype.toLowerCase()}`,"-write","/copy.bmp","/out.bmp"];
  const result=mode==="sync"?runConvertCliSync(args,files):await runConvertCli(args,mode==="retained"?{filesystem,cwd:"/"}:files);
  expect(result).toMatchObject({exitCode:0,stderr:""});
  for(const path of ["/copy.bmp","/out.bmp"]) {
   const output=mode==="retained"?await filesystem.readFile(path):files.get(path)!;
   const view=new DataView(output.buffer,output.byteOffset,output.byteLength);
   expect(view.getUint16(28,true)).toBe(16);
   expect(view.getUint32(30,true)).toBe(3);
   expect([54,58,62,66].map(offset=>view.getUint32(offset,true))).toEqual(vector.masks);
   expect(Buffer.from(output.subarray(view.getUint32(10,true))).toString("hex")).toBe(vector.payload);
   expect(view.getUint32(2,true)).toBe(output.length);
   const decoded=decodeImage(output);
   expect(decoded.hasAlpha).toBe(vector.alpha);
   expect(Array.from(decoded.data.slice(0,12))).toEqual([255,0,0,255,0,255,0,vector.subtype==="ARGB4444"?136:255,0,0,255,vector.alpha?0:255]);
  }
 });
}
for(const mode of ["sync","retained"] as const) it(`clears bmp:subtype after -write (${mode})`,async()=>{
 const files=new Map<string,Uint8Array>(),filesystem=new MemoryFileSystem();
 const args=["xc:red","-define","bmp:subtype=RGB565","-write","/copy.bmp","+define","bmp:subtype","/out.bmp"];
 const result=mode==="sync"?runConvertCliSync(args,files):await runConvertCli(args,{filesystem,cwd:"/"});
 expect(result.exitCode).toBe(0);
 for(const [path,bpp] of [["/copy.bmp",16],["/out.bmp",24]] as const) {
  const bytes=mode==="sync"?files.get(path)!:await filesystem.readFile(path);
  expect(new DataView(bytes.buffer,bytes.byteOffset).getUint16(28,true)).toBe(bpp);
 }
});
