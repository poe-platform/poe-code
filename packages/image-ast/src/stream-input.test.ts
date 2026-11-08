import {expect,it,vi} from "vitest";
import {RetainedStreamInput} from "./streams/input.js";
import sharp from "./index.js";
import {MemoryFileSystem} from "@poe-code/safe-fs/core";

for(const terminal of ["file","stats","metadata"] as const)it(`retains unfinished stream input for ${terminal} without buffering file resources`,async()=>{
 const fs=new MemoryFileSystem(),bytes=await sharp({create:{width:20,height:13,channels:4,background:"red"}}).png().toBuffer();
 const overlay=await sharp({create:{width:3,height:2,channels:4,background:"blue"}}).png().toBuffer();
 await fs.writeFile("/overlay",overlay);
 const guarded=new Proxy(fs,{get(target,key){if(key==="readFile"||key==="writeFile")return ()=>{throw new Error("whole-file I/O forbidden");};const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;}});
 const expected=sharp(bytes).composite([{input:overlay}]).resize(9,7).png();
 const input=sharp({filesystem:guarded,workingDirectory:"/"}).composite([{input:"/overlay"}]).resize(9,7).png();
 const result=terminal==="file"?input.toFile("/out"):terminal==="stats"?input.stats():input.metadata();
 void result.catch(()=>{});
 const writer=input.writable.getWriter();await writer.write(bytes.subarray(0,17));await writer.write(bytes.subarray(17));await writer.close();
 if(terminal==="file"){const info=await result,output=await expected.toBuffer({resolveWithObject:true}),stored=await fs.readFile("/out");expect(info).toEqual({...output.info,size:stored.length});expect(await sharp(stored).raw().toBuffer()).toEqual(await sharp(output.data).raw().toBuffer());}
 else expect(await result).toEqual(terminal==="stats"?await expected.stats():await expected.metadata());
 await input.dispose();
});

it("spills large stream input through caller storage and retains it until the last clone is disposed",async()=>{
 const fs=new MemoryFileSystem(),acquire=fs.open.bind(fs),closed=vi.fn();
 const open=vi.spyOn(fs,"open").mockImplementation(async(...args)=>{const handle=await acquire(...args);return new Proxy(handle,{get(target,key){if(key==="close")return async(...args:Parameters<typeof handle.close>)=>{closed();return handle.close(...args);};const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;}});});
 const input=sharp({raw:{width:1024,height:513,channels:4},filesystem:fs,workingDirectory:"/"});
 const child=input.clone(),writer=input.writable.getWriter(),chunk=new Uint8Array(16384).fill(123);
 for(let i=0;i<128;i++)await writer.write(chunk);await writer.write(chunk.subarray(0,4096));await writer.close();
 expect(open).toHaveBeenCalled();const later=input.clone();await input.dispose();expect(closed).not.toHaveBeenCalled();
 expect(await child.metadata()).toMatchObject({width:1024,height:513});await child.dispose();expect(closed).not.toHaveBeenCalled();
 expect(await later.metadata()).toMatchObject({width:1024,height:513});await later.dispose();expect(closed).toHaveBeenCalledOnce();
 expect(await fs.readdir("/")).toEqual([]);
});

it("never materializes input during retained inspection and file output",async()=>{
 const fs=new MemoryFileSystem(),bytes=await sharp({create:{width:17,height:11,channels:3,background:"green"}}).png().toBuffer();
 const materialize=vi.spyOn(RetainedStreamInput.prototype,"bytes").mockRejectedValue(new Error("input materialization forbidden"));
 const input=sharp({filesystem:fs,workingDirectory:"/"}),writer=input.writable.getWriter();
 try {await writer.write(bytes);await writer.close();await input.metadata();await input.stats();await input.png().toFile("/out");expect(materialize).not.toHaveBeenCalled();}
 finally {materialize.mockRestore();await input.dispose();}
});

it("keeps explicit buffer conveniences reusable after retained input",async()=>{
 const fs=new MemoryFileSystem(),bytes=await sharp({create:{width:13,height:7,channels:4,background:"blue"}}).png().toBuffer();
 const input=sharp({filesystem:fs,workingDirectory:"/"}),writer=input.writable.getWriter();
 const result=input.raw().toBuffer();await writer.write(bytes);await writer.close();
 expect(await result).toEqual(await sharp(bytes).raw().toBuffer());expect(await input.toBuffer()).toEqual(await result);
 await input.dispose();
});

it("cancels a pending terminal before any input arrives",async()=>{
 const fs=new MemoryFileSystem(),controller=new AbortController(),input=sharp({filesystem:fs,signal:controller.signal}),failure=new Error("cancel input");
 const result=input.metadata();controller.abort(failure);await expect(result).rejects.toBe(failure);await input.dispose();
});

it("backpressures writes until caller storage accepts the chunk and closes it on failure",async()=>{
 const fs=new MemoryFileSystem(),failure=new Error("scratch write failed");let closed=0,writes=0;
 const open=fs.open.bind(fs);fs.open=async(...args)=>{const handle=await open(...args);return new Proxy(handle,{get(target,key){if(key==="write")return async()=>{writes++;throw failure;};if(key==="close")return async(...args:Parameters<typeof handle.close>)=>{closed++;return handle.close(...args);};const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;}});};
 const input=sharp({filesystem:fs,workingDirectory:"/"}),writer=input.writable.getWriter();
 await expect(writer.write(new Uint8Array(2*1024*1024))).rejects.toBe(failure);await input.dispose();expect(writes).toBeGreaterThan(0);expect(closed).toBe(1);expect(await fs.readdir("/")).toEqual([]);
});

for(const format of ["png","jpeg","webp","tiff","gif","bmp","ppm","pgm","pbm"] as const)
it(`preserves ${format} stream decoding through retained file output`,async()=>{
 const bytes=await sharp({create:{width:11,height:7,channels:3,background:{r:29,g:73,b:117}}}).toFormat(format).toBuffer();
 const fs=new MemoryFileSystem(),input=sharp({filesystem:fs,workingDirectory:"/"}).raw(),result=input.toFile("/out"),writer=input.writable.getWriter();void result.catch(()=>{});
 for(let i=0;i<bytes.length;i+=17){const chunk=bytes.slice(i,i+17);await writer.write(chunk);chunk.fill(0);}
 await writer.close();const expected=await sharp(bytes).raw().toBuffer({resolveWithObject:true});expect(await result).toEqual(expected.info);expect(await fs.readFile("/out")).toEqual(expected.data);await input.dispose();
});

it("keeps writer backpressure while external scratch acquisition is pending",async()=>{
 const fs=new MemoryFileSystem();let acquired!:()=>void,resume!:()=>void;
 const opened=new Promise<void>(resolve=>{acquired=resolve;}),pending=new Promise<void>(resolve=>{resume=resolve;}),open=fs.open.bind(fs);
 fs.open=async(...args)=>{acquired();await pending;return open(...args);};
 const input=sharp({filesystem:fs,workingDirectory:"/"}),writer=input.writable.getWriter();let accepted=false;
 const writing=writer.write(new Uint8Array(2*1024*1024)).then(()=>{accepted=true;});await opened;expect(accepted).toBe(false);
 resume();await writing;expect(accepted).toBe(true);await writer.abort();
});

it("waits for shared backing cleanup when disposing an unfinished parent and its clones",async()=>{
 const fs=new MemoryFileSystem(),open=fs.open.bind(fs);let resume!:()=>void,closing!:()=>void;
 const pending=new Promise<void>(resolve=>{resume=resolve;}),entered=new Promise<void>(resolve=>{closing=resolve;});
 fs.open=async(...args)=>{const handle=await open(...args);return new Proxy(handle,{get(target,key){if(key==="close")return async(...args:Parameters<typeof handle.close>)=>{closing();await pending;return handle.close(...args);};const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;}});};
 const input=sharp({filesystem:fs,workingDirectory:"/"}),child=input.clone(),writer=input.writable.getWriter();
 await writer.write(new Uint8Array(2*1024*1024));let disposed=false;
 const disposal=input.dispose().then(()=>{disposed=true;});await entered;await Promise.resolve();expect(disposed).toBe(false);
 resume();await disposal;await expect(child.metadata()).rejects.toThrow("Stream cancelled");
});
