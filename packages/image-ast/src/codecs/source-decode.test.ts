import {expect,it} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/core";
import {PagedStorage} from "@poe-code/safe-fs/storage";
import * as image from "../index.js";

it("exposes one retained source decoder for encoded images and raw samples",async()=>{
 expect(image).toHaveProperty("decodeImageToStorage");
 const signal=new AbortController().signal,storage=new PagedStorage({fs:new MemoryFileSystem(),cwd:"/",env:{},signal});
 try {const bytes=await image.default({create:{width:7,height:3,channels:4,background:"red"}}).png().toBuffer();
 const source={size:bytes.length,async read(position:number,length:number){return bytes.slice(position,position+length);}};
 const decoded=await image.decodeImageToStorage(source,storage,signal);expect(decoded).toMatchObject({width:7,height:3});expect(await storage.read(decoded.position,4)).toEqual(new Uint8Array([255,0,0,255]));
 const raw=await image.decodeImageToStorage({size:4,async read(){return new Uint8Array([1,2,3,4]);}},storage,signal,{raw:{width:1,height:1,channels:4}});expect(await storage.read(raw.position,4)).toEqual(new Uint8Array([1,2,3,4]));
 }finally{await storage.close();}
});

import * as portable from "../portable.js";
it("exposes retained codec contracts through the portable public entry",()=>{
 expect(portable.decodeImageToStorage).toBe(image.decodeImageToStorage);
 expect(portable.readImageMetadataFromSource).toBe(image.readImageMetadataFromSource);
 expect(portable.computeStoredImageStats).toBe(image.computeStoredImageStats);
});

for(const options of [{create:{width:3,height:2,channels:4 as const,background:"blue"}},{text:{text:"source",width:13,height:7}}])
it(`honors generated input before source access: ${"create" in options?"create":"text"}`,async()=>{
 const signal=new AbortController().signal,storage=new PagedStorage({fs:new MemoryFileSystem(),cwd:"/",env:{},signal});
 const source={get size():number{throw new Error("unused source");},async read(){throw new Error("unused source");}};
 try{const decoded=await image.decodeImageToStorage(source,storage,signal,options),expected=image.decodeImage(undefined,options);expect({width:decoded.width,height:decoded.height}).toEqual({width:expected.width,height:expected.height});expect(await storage.read(decoded.position,4)).toEqual(expected.data.subarray(0,4));}finally{await storage.close();}
});

it("exposes retained encoding with final output information",async()=>{
 expect(image).toHaveProperty("encodeStoredImage");
 const signal=new AbortController().signal,storage=new PagedStorage({fs:new MemoryFileSystem(),cwd:"/",env:{},signal});
 try{const bytes=new Uint8Array([1,2,3,4]),decoded=await image.decodeImageToStorage({size:4,async read(){return bytes;}},storage,signal,{raw:{width:1,height:1,channels:4}}),encoded=image.encodeStoredImage(decoded,storage,signal,{format:"raw"});
 expect((await encoded.next()).value).toEqual(bytes);expect(await encoded.next()).toMatchObject({done:true,value:{format:"raw",size:4,width:1,height:1,channels:4}});
 expect(portable.encodeStoredImage).toBe(image.encodeStoredImage);
 }finally{await storage.close();}
});

it("exposes retained file scoping to adapters using the caller filesystem",async()=>{
 expect(image).toHaveProperty("withImageSource");const fs=new MemoryFileSystem();await fs.writeFile("/in",new Uint8Array([1,2,3]));
 const signal=new AbortController().signal;
 expect(await image.withImageSource("/in",fs,signal,async source=>source.read(0,3,{signal}))).toEqual(new Uint8Array([1,2,3]));
 expect(portable.withImageSource).toBe(image.withImageSource);
});
