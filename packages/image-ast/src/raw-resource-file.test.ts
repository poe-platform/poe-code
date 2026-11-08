import {expect,it} from "vitest";
import sharp from "./index.js";
import {MemoryFileSystem} from "@poe-code/safe-fs/core";
import type {SharpInputOptions} from "./ast.js";
it.each(["uchar","char","ushort","short","uint","int","float","double"] as const)("resolves raw %s overlays through retained caller reads",async depth=>{
 const fs=new MemoryFileSystem(),data=Uint8Array.from({length:17*13*4*8},(_,i)=>(i*43+Math.floor(i/7))%256);
 const input=sharp({create:{width:37,height:29,channels:4,background:"blue"}}).png().toBufferSync();
 const raw:NonNullable<SharpInputOptions["raw"]>={width:17,height:13,channels:4,depth};
 await fs.writeFile("/in.png",input);await fs.writeFile("/raw",data);
 const guarded=new Proxy(fs,{get(target,key){if(key==="readFile"||key==="writeFile") return ()=>{throw new Error("whole-file I/O forbidden");};const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;}});
 const expected=sharp(input).boolean(data,"eor",{raw}).png().toBufferSync();
 await sharp("/in.png",{filesystem:guarded}).boolean("/raw","eor",{raw}).png().toFile("/out.png");
 expect(Buffer.compare(sharp(await fs.readFile("/out.png")).raw().toBufferSync(),sharp(expected).raw().toBufferSync())).toBe(0);
 expect((await fs.readdir("/")).map(entry=>entry.name)).toEqual(["in.png","out.png","raw"]);
});
it.each([1,2,3,4] as const)("creates deterministic %i-channel overlay pixels in caller storage",async channels=>{
 const fs=new MemoryFileSystem(),input=sharp({create:{width:37,height:29,channels:4,background:"blue"}}).png().toBufferSync();
 await fs.writeFile("/in.png",input);
 const guarded=new Proxy(fs,{get(target,key){if(key==="readFile"||key==="writeFile") return ()=>{throw new Error("whole-file I/O forbidden");};const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;}});
 const layers=[{input:{create:{width:17,height:13,channels,background:"#e8a84777"}}},{input:{create:{width:19,height:11,channels,noise:{mean:80,sigma:25}}},tile:true}];
 const expected=sharp(input).composite(layers).png().toBufferSync();
 await sharp("/in.png",{filesystem:guarded}).composite(layers).png().toFile("/out.png");
 expect(Buffer.compare(sharp(await fs.readFile("/out.png")).raw().toBufferSync(),sharp(expected).raw().toBufferSync())).toBe(0);
 expect((await fs.readdir("/")).map(entry=>entry.name)).toEqual(["in.png","out.png"]);
});
