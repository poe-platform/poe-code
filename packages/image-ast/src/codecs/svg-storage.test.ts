import {expect,test} from "vitest";
import * as svg from "./svg-storage.js";
import {decodeSvgImage} from "./svg-pdf.js";
import type {ImageByteStorage} from "./png-storage.js";

function backing() {
 const pages=new Map<number,Uint8Array>();let size=0,reads=0,writes=0;
 const borrowed=new Uint8Array(4096);
 const storage:ImageByteStorage={allocate(length){const position=size;size+=length;return position;},async read(position,length){expect(length).toBeLessThanOrEqual(4096);reads++;borrowed.fill(0);borrowed.set(pages.get(position)?.subarray(0,length)??new Uint8Array(length));return borrowed.subarray(0,length);},async write(position,bytes){expect(bytes.length).toBeLessThanOrEqual(4096);writes++;pages.set(position,new Uint8Array(bytes));}};
 return {storage,pages,get reads(){return reads;},get writes(){return writes;}};
}

test("renders into caller pages and owns borrowed reads across dirty cache eviction",async()=>{
 const bytes=new TextEncoder().encode('<svg width="17000" height="3"><rect width="17000" height="3" fill="blue"/><rect width="17000" height="2" fill="red" opacity="0.5"/><line x1="0" y1="1" x2="16999" y2="1" stroke="green"/></svg>');
 const caller=backing(),expected=decodeSvgImage(bytes);
 const actual=await svg.decodeSvgToStorage(bytes,caller.storage,new AbortController().signal);
 expect(actual).toMatchObject({width:17000,height:3,format:"svg",channels:4,position:0});
 for(let offset=0;offset<expected.data.length;offset+=4096)expect(caller.pages.get(offset)).toEqual(expected.data.slice(offset,offset+4096));
 expect(caller.reads).toBeGreaterThan(16);expect(caller.writes).toBeGreaterThan(caller.pages.size);
});

for(const operation of ["read","write"] as const)test(`preserves caller SVG backing ${operation} failures`,async()=>{
 const bytes=new TextEncoder().encode('<svg width="2" height="2"><rect width="2" height="2"/></svg>'),caller=backing(),failure=new Error('caller '+operation);
 caller.storage[operation]=async()=>{throw failure;};
 await expect(svg.decodeSvgToStorage(bytes,caller.storage,new AbortController().signal)).rejects.toBe(failure);
});

test("observes cancellation during surface initialization",async()=>{
 const controller=new AbortController(),failure=new Error("cancel surface"),caller=backing(),write=caller.storage.write;
 caller.storage.write=async(...args)=>{await write(...args);controller.abort(failure);};
 await expect(svg.decodeSvgToStorage(new TextEncoder().encode('<svg width="2000" height="2000"/>'),caller.storage,controller.signal)).rejects.toBe(failure);
 expect(caller.writes).toBe(1);
});

test("keeps default PNG file output for explicit SVG bytes on the retained SDK path",async()=>{
 const {default:sharp}=await import("../index.js"),{MemoryFileSystem}=await import("@poe-code/safe-fs/core");
 const bytes=new TextEncoder().encode('<svg width="9" height="5"><rect width="9" height="5" fill="red"/></svg>'),fs=new MemoryFileSystem();
 const filesystem=new Proxy(fs,{get(target,key){if(key==="writeFile")return()=>{throw new Error("whole image output");};const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;}});
 const info=await sharp(bytes,{filesystem}).toFile("/out");
 expect(info).toMatchObject({format:"png",width:9,height:5});
 expect(await sharp(await fs.readFile("/out")).raw().toBuffer()).toEqual(decodeSvgImage(bytes).data);
});

test("yields to cancellation while a long stroke paints outside the canvas",async()=>{
 const controller=new AbortController(),failure=new Error("cancel outside stroke"),caller=backing(),write=caller.storage.write;let timer:ReturnType<typeof setTimeout>|undefined;
 caller.storage.write=async(...args)=>{await write(...args);timer=setTimeout(()=>controller.abort(failure),0);};
 const bytes=new TextEncoder().encode('<svg width="2" height="2"><line x1="-10000000" y1="-10" x2="-1" y2="-10" stroke="red"/></svg>');
 try{await expect(svg.decodeSvgToStorage(bytes,caller.storage,controller.signal)).rejects.toBe(failure);}finally{clearTimeout(timer);}
});

test("owns SVG syntax before awaiting caller backing",async()=>{
 const bytes=new TextEncoder().encode('<svg width="2" height="2"><rect width="2" height="2" fill="red"/></svg>'),expected=decodeSvgImage(bytes),caller=backing(),write=caller.storage.write;
 caller.storage.write=async(...args)=>{await write(...args);bytes.fill(0);};
 const result=await svg.decodeSvgToStorage(bytes,caller.storage,new AbortController().signal);
 expect(result).toMatchObject({width:2,height:2});expect(caller.pages.get(0)).toEqual(expected.data);
});
