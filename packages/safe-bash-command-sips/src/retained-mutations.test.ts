import {expect,it} from "vitest";
import sharp,{decodeImage,readImageMetadata} from "@poe-code/image-ast";
import {MemoryFileSystem} from "@poe-code/safe-fs/core";
import {runSipsCli} from "./index.js";

// Streaming PNGs can split IDAT differently; the compressed stream and pixels must agree.
function pngData(bytes:Uint8Array):Uint8Array{
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),chunks:Uint8Array[]=[];let size=0;
 for(let offset=8;offset+12<=bytes.length;){const length=view.getUint32(offset);if(view.getUint32(offset+4)===0x49444154){chunks.push(bytes.subarray(offset+8,offset+8+length));size+=length;}offset+=length+12;}
 const result=new Uint8Array(size);let position=0;for(const chunk of chunks){result.set(chunk,position);position+=chunk.length;}return result;
}

const actions=[
 ["-r","90"],["-r","33"],["-f","horizontal"],["-f","vertical"],
 ["--resampleWidth","9"],["--resampleWidth","9","--resampleHeight","7"],
 ["-c","7","9"],["-c","8","10"],["-p","15","19"],["-p","16","20"],
 ["--cropOffset","-2","3","-c","9","17"],["-s","format","png"],
 ["-r","90","--resampleWidth","8","-f","horizontal","-p","11","13"],
 ["-s","formatOptions","best"],["-s","dpiWidth","144"],["-d","description"]
];
for(const format of ["png","jpeg","webp","tiff","gif","bmp","ppm","pgm","pbm","heic","heif","avif"] as const)
for(const args of actions)it(`retains ${format} mutation ${args.join(" ")} in caller storage`,async()=>{
 const pixels=Uint8Array.from({length:15*11*4},(_,index)=>(index*31+Math.floor(index/7))%256);
 const bytes=await sharp(pixels,{raw:{width:15,height:11,channels:4}}).toFormat(format).toBuffer(),fs=new MemoryFileSystem();await fs.writeFile("/in",bytes);
 const files=new Map([["in",bytes]]),argv=[...args,"in","-o","out"],expected=await runSipsCli(argv,files);
 const filesystem=new Proxy(fs,{get(target,key){if(key==="readFile"||key==="writeFile")return ()=>{throw new Error("whole-file mutation I/O forbidden");};const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;}});
 expect(await runSipsCli(argv,{filesystem,cwd:"/"})).toEqual(expected);
 if(expected.exitCode!==0){await expect(fs.stat("/out")).rejects.toMatchObject({code:"ENOENT"});return;}
 const actual=await fs.readFile("/out"),expectedBytes=files.get("out")!;
 expect(decodeImage(actual).data).toEqual(decodeImage(expectedBytes).data);
 const {size:ignoredActualSize,...actualMetadata}=readImageMetadata(actual),{size:ignoredExpectedSize,...expectedMetadata}=readImageMetadata(expectedBytes);
 expect(actualMetadata).toEqual(expectedMetadata);
 if(actualMetadata.format==="png")expect(pngData(actual)).toEqual(pngData(expectedBytes));else expect(actual).toEqual(expectedBytes);
});

import {runIdentifyCli} from "./index.js";
for(const length of [8,32,64])for(const command of ["identify","query","mutate"] as const)
it(`preserves ${command} diagnostics for a ${length}-byte TIFF prefix`,async()=>{
 const bytes=(await sharp({create:{width:13,height:11,channels:4,background:"red"}}).tiff().toBuffer()).slice(0,length),fs=new MemoryFileSystem();await fs.writeFile("/in",bytes);
 const args=command==="identify"?["in"]:command==="query"?["-g","all","in"]:["-r","90","in","-o","out"],run=command==="identify"?runIdentifyCli:runSipsCli;
 const expected=await run(args,new Map([["in",bytes]]));expect(expected.stderr).toContain("Offset is outside the bounds of the DataView");
 expect(await run(args,{filesystem:fs,cwd:"/"})).toEqual(expected);
});
