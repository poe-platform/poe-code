import {expect,it} from "vitest";
import sharp from "./index.js";
import {MemoryFileSystem} from "@poe-code/safe-fs/core";
import type {BlendMode} from "./ast.js";
const modes:BlendMode[]=["over","source","clear","dest","in","out","dest-in","dest-out","atop","dest-atop","xor","saturate","add","multiply","screen","overlay","darken","lighten","colour-dodge","colour-burn","hard-light","soft-light","difference","exclusion"];
it.each(modes)("composites PNG files with bounded caller I/O: %s",async blend=>{
 const fs=new MemoryFileSystem(),data=Uint8Array.from({length:39*31*4},(_,i)=>(i*43+Math.floor(i/7))%256);
 const input=sharp(data,{raw:{width:39,height:31,channels:4}}).png().toBufferSync();
 const overlay=sharp(data.subarray(0,7*5*4),{raw:{width:7,height:5,channels:4}}).png().toBufferSync();
 await fs.writeFile("/in.png",input);await fs.writeFile("/layer.png",overlay);
 const guarded=new Proxy(fs,{get(target,key){if(key==="readFile"||key==="writeFile") return ()=>{throw new Error("whole-file I/O forbidden");};const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;}});
 const layers=[{input:overlay,blend,left:3,top:2},{input:overlay,blend:"over" as const,tile:true,premultiplied:true}];
 const expected=sharp(input).composite(layers).png().toBufferWithObjectSync();
 const info=await sharp("/in.png",{filesystem:guarded}).composite(layers.map(layer=>({...layer,input:"/layer.png"}))).png().toFile("/out.png");
 const output=await fs.readFile("/out.png");
 expect(info).toEqual({...expected.info,size:output.length});
 expect(Buffer.compare(sharp(output).raw().toBufferSync(),sharp(expected.data).raw().toBufferSync())).toBe(0);
 expect((await fs.readdir("/")).map(entry=>entry.name)).toEqual(["in.png","layer.png","out.png"]);
});
