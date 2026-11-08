import {expect,it} from "vitest";
import sharp from "./index.js";
import {MemoryFileSystem} from "@poe-code/safe-fs/core";

const pixels=()=>Uint8Array.from({length:53*37*4},(_,i)=>(i*17+(i>>>5)*31)%256);
const operations=[
 (image:ReturnType<typeof sharp>)=>image,
 (image:ReturnType<typeof sharp>)=>image.resize(31,23).gamma(1.8,2.4).blur(0.6).sharpen().grayscale(),
 (image:ReturnType<typeof sharp>)=>image.resize(27,15).flip().rotate(90).clahe({width:3,height:3}).negate(),
 (image:ReturnType<typeof sharp>)=>image.composite([{input:"/overlay.png",left:3,top:2}]).boolean("/operand.png","or"),
];
for(const [index,operation] of operations.entries()) it(`computes file statistics through retained storage pipeline ${index}`,async()=>{
 const fs=new MemoryFileSystem(),data=pixels();
 const bytes=await sharp(data,{raw:{width:53,height:37,channels:4}}).png().toBuffer();
 await fs.writeFile("/input.png",bytes);await fs.writeFile("/operand.png",bytes);
 await fs.writeFile("/overlay.png",await sharp({create:{width:11,height:7,channels:4,background:"red"}}).png().toBuffer());
 const expected=await operation(sharp(bytes,{filesystem:fs})).stats();
 const guarded=new Proxy(fs,{get(target,key){
  if(key==="readFile" || key==="writeFile") return ()=>{throw new Error("whole-file I/O forbidden");};
  const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;
 }});
 const image=operation(sharp("/input.png",{filesystem:guarded}));
 expect(await image.stats()).toEqual(expected);
 expect(await image.clone().stats()).toEqual(expected);
 expect((await fs.readdir("/")).map(entry=>entry.name).sort()).toEqual(["input.png","operand.png","overlay.png"]);
});

for(const mode of ["success","write","read","cancel","close"] as const) it(`owns spilled statistics handles on ${mode}`,async()=>{
 const fs=new MemoryFileSystem(),controller=new AbortController(),failure=new Error(`injected ${mode}`);
 await fs.mkdir("/scratch");
 const bytes=await sharp({create:{width:2053,height:129,channels:4,background:"red"}}).png().toBuffer();
 await fs.writeFile("/input.png",bytes);
 const expected=await sharp(bytes).stats();
 let sourceHandles=0,scratchHandles=0,opens=0,reads=0,writes=0;
 const guarded=new Proxy(fs,{get(target,key){
  if(key==="readFile" || key==="writeFile") return ()=>{throw new Error("whole-file I/O forbidden");};
  if(key==="openReadFile") return async(...args:Parameters<NonNullable<typeof fs.openReadFile>>)=>{
   const handle=await fs.openReadFile(...args);sourceHandles++;
   return {...handle,async close(){sourceHandles--;await handle.close();}};
  };
  if(key==="open") return async(...args:Parameters<typeof fs.open>)=>{
   expect(args[0].startsWith("/scratch/.storage-")).toBe(true);
   const handle=await fs.open(...args);scratchHandles++;opens++;
   return new Proxy(handle,{get(retained,method){
    if(method==="write") return async(...values:Parameters<typeof handle.write>)=>{
     writes++;
     if(writes===2 && mode==="write") throw failure;
     if(writes===2 && mode==="cancel") controller.abort(failure);
     return handle.write(...values);
    };
    if(method==="read") return async(...values:Parameters<typeof handle.read>)=>{
     reads++;if(reads===2 && mode==="read") throw failure;return handle.read(...values);
    };
    if(method==="close") return async()=>{scratchHandles--;await handle.close();if(mode==="close") throw failure;};
    const value=Reflect.get(retained,method,retained);return typeof value==="function"?value.bind(retained):value;
   }});
  };
  const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;
 }});
 let callbackCount=0;
 const result=sharp("/input.png",{filesystem:guarded,workingDirectory:"/scratch",signal:controller.signal}).stats((error,value)=>{
  callbackCount++;if(mode==="success"){expect(error).toBeNull();expect(value).toEqual(expected);}else expect(error).toBe(failure);
 });
 if(mode==="success") expect(await result).toEqual(expected);else await expect(result).rejects.toBe(failure);
 expect(callbackCount).toBe(1);expect(opens).toBe(1);expect(sourceHandles).toBe(0);expect(scratchHandles).toBe(0);
 expect(await fs.readdir("/scratch")).toEqual([]);
 expect(await fs.readFile("/input.png")).toEqual(bytes);
});

for(const kind of ["raw-file","raw-bytes","text","create"] as const) it(`uses bounded statistics for ${kind}`,async()=>{
 const fs=new MemoryFileSystem(),data=pixels(),raw={width:53,height:37,channels:4 as const};
 await fs.writeFile("/raw",data);
 const guarded=new Proxy(fs,{get(target,key){
  if(key==="readFile" || key==="writeFile")return ()=>{throw new Error("whole-file I/O forbidden");};
  const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;
 }});
 const text={text:'<span color="red">bounded stats</span>',width:73,height:39,rgba:true};
 const create={width:73,height:39,channels:4 as const,background:"blue"};
 const expected=await (kind.startsWith("raw")?sharp(data,{raw}):kind==="text"?sharp({text}):sharp({create})).stats();
 const actual=kind==="raw-file"?sharp("/raw",{raw,filesystem:guarded}):kind==="raw-bytes"?sharp(data,{raw,filesystem:guarded}):kind==="text"?sharp({text,filesystem:guarded}):sharp({create,filesystem:guarded});
 expect(await actual.stats()).toEqual(expected);
});

it("preserves explicitly cached file and resource snapshots",async()=>{
 const fs=new MemoryFileSystem(),bytes=await sharp(pixels(),{raw:{width:53,height:37,channels:4}}).png().toBuffer();
 await fs.writeFile("/input.png",bytes);await fs.writeFile("/other.png",bytes);
 const image=sharp("/input.png",{filesystem:fs}).boolean("/other.png","or");
 await image.toBuffer(); // This explicit buffering API retains its existing cache semantics.
 const expected=image.statsSync();
 await fs.writeFile("/input.png",new Uint8Array());await fs.writeFile("/other.png",new Uint8Array());
 expect(await image.stats()).toEqual(expected);expect(await image.clone().stats()).toEqual(expected);
});

it("rejects a changed retained source and closes it",async()=>{
 const fs=new MemoryFileSystem(),bytes=await sharp(pixels(),{raw:{width:53,height:37,channels:4}}).png().toBuffer();
 await fs.writeFile("/input.png",bytes);let closed=0;
 const guarded=new Proxy(fs,{get(target,key){
  if(key==="readFile")return ()=>{throw new Error("whole-file I/O forbidden");};
  if(key==="openReadFile")return async(...args:Parameters<NonNullable<typeof fs.openReadFile>>)=>{
   const handle=await fs.openReadFile(...args);let calls=0;
   return {...handle,async stat(...values:Parameters<typeof handle.stat>){
    const result=await handle.stat(...values);return ++calls===2?{...result,size:result.size+1}:result;
   },async close(){closed++;await handle.close();}};
  };
  const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;
 }});
 await expect(sharp("/input.png",{filesystem:guarded}).stats()).rejects.toMatchObject({code:"EAGAIN"});
 expect(closed).toBe(1);
});

for(const format of ["png","jpeg","webp","gif","tiff","ppm","pgm","pbm","bmp"] as const) it(`preserves ${format} decoded statistics`,async()=>{
 const fs=new MemoryFileSystem();
 const bytes=await sharp(pixels(),{raw:{width:53,height:37,channels:4}}).toFormat(format).toBuffer();
 const expected=await sharp(bytes).stats();await fs.writeFile("/input",bytes);
 const guarded=new Proxy(fs,{get(target,key){
  if(key==="readFile")return ()=>{throw new Error("whole-file I/O forbidden");};
  const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;
 }});
 expect(await sharp("/input",{filesystem:guarded}).stats()).toEqual(expected);
});

it("honors the same scratch directory for retained file output",async()=>{
 const fs=new MemoryFileSystem();await fs.mkdir("/scratch");let opens=0;
 const guarded=new Proxy(fs,{get(target,key){
  if(key==="open")return async(...args:Parameters<typeof fs.open>)=>{
   expect(args[0].startsWith("/scratch/.storage-")).toBe(true);opens++;return fs.open(...args);
  };
  const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;
 }});
 await sharp({create:{width:2053,height:129,channels:4,background:"red"},filesystem:guarded,workingDirectory:"/scratch"}).png().toFile("/output.png");
 expect(opens).toBe(1);expect(await fs.readdir("/scratch")).toEqual([]);
 expect((await sharp(await fs.readFile("/output.png")).metadata()).width).toBe(2053);
});
