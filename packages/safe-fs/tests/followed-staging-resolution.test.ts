import {expect,it} from "vitest";
import {MemoryFileSystem} from "../src/fs/memory/index.js";
import {MountFileSystem} from "../src/fs/mount/index.js";
import {DeviceFileSystem} from "../src/fs/devices/index.js";
import {scopeFileSystem} from "../src/fs/scoped.js";
import type {FileSystem} from "../src/contracts/filesystem.js";

for(const kind of ["memory","mount","device","scope"] as const)
for(const change of ["none","link","target","ancestor"] as const)
it(`retains final symlink resolution through ${kind} on ${change}`,async()=>{
 const memory=new MemoryFileSystem();await memory.mkdir("/dir");await memory.writeFile("/dir/file",new Uint8Array([7]));await memory.symlink("dir/file","/link");
 const fs:FileSystem=kind==="memory"?memory:kind==="mount"?new MountFileSystem({root:memory}):kind==="device"?new DeviceFileSystem(memory):scopeFileSystem(memory,()=>{},new AbortController().signal);
 const options={followFinalSymlink:true};
 const capabilities=await fs.capabilitiesFor?.("/link",{...options,stagingResolution:true})??fs.capabilities;
 expect(capabilities.synchronousFollowedStagingResolution).toBe(true);
 const receipt=await fs.prepareStagingResolution!("/link",options);
 expect(receipt.path).toBe("/dir/file");expect(receipt.destination?.type).toBe("file");expect(receipt.traversed.some(step=>step.path==="/link"&&step.linkTarget==="dir/file")).toBe(true);
 expect(receipt.validate()).toBe(true);
 if(change==="link"){await memory.unlink("/link");await memory.symlink("dir/file","/link");}
 if(change==="target")await memory.writeFile("/dir/file",new Uint8Array([8]));
 if(change==="ancestor"){await memory.rename("/dir","/held");await memory.mkdir("/dir");await memory.writeFile("/dir/file",new Uint8Array([7]));}
 if(change==="none")expect(receipt.validate()).toBe(true);else expect(()=>receipt.validate()).toThrow(expect.objectContaining({code:"EAGAIN"}));
});

it("captures the final-link policy before returning a guard",async()=>{
 const fs=new MemoryFileSystem();await fs.writeFile("/target",new Uint8Array([1]));await fs.symlink("target","/link");
 const options={followFinalSymlink:true},receipt=await fs.prepareStagingResolution("/link",options);options.followFinalSymlink=false;
 expect(receipt.validate()).toBe(true);
});

for(const kind of ["memory","mount","device","scope"] as const)
it(`atomically rejects a retargeted final link through ${kind}`,async()=>{
 const memory=new MemoryFileSystem();await memory.writeFile("/target",new Uint8Array([1]));await memory.writeFile("/other",new Uint8Array([2]));await memory.symlink("target","/link");
 const fs:FileSystem=kind==="memory"?memory:kind==="mount"?new MountFileSystem({root:memory}):kind==="device"?new DeviceFileSystem(memory):scopeFileSystem(memory,()=>{},new AbortController().signal);
 const receipt=await fs.prepareStagingResolution!("/link",{followFinalSymlink:true});
 const staging=await fs.createStagedFile!("/stage","output",{type:"file",data:new Uint8Array([3])},{parent:receipt.parent,retainCleanup:true});
 try{
  await memory.unlink("/link");await memory.symlink("other","/link");
  await expect(fs.publishStagedFile!(staging,receipt.path,{parent:receipt.parent,destination:receipt.destination,ancestors:receipt.ancestors,commitGuard:receipt.validate})).rejects.toMatchObject({code:"EAGAIN"});
  expect(await memory.readFile("/target")).toEqual(new Uint8Array([1]));expect(await memory.readFile("/other")).toEqual(new Uint8Array([2]));
 }finally{await staging.cleanup!.remove();await staging.cleanup!.close();}
});

for(const kind of ["memory","mount","device","scope"] as const)it(`binds dangling link chains through ${kind} without creating their destinations`,async()=>{
 const memory=new MemoryFileSystem();const fs:FileSystem=kind==="memory"?memory:kind==="mount"?new MountFileSystem({root:memory}):kind==="device"?new DeviceFileSystem(memory):scopeFileSystem(memory,()=>{},new AbortController().signal);await fs.mkdir("/dir");await memory.symlink("dir/missing","/middle");await memory.symlink("middle","/link");
 const receipt=await fs.prepareStagingResolution!("/link",{followFinalSymlink:true});expect(receipt.path).toBe("/dir/missing");expect(receipt.destination).toBeNull();expect(receipt.validate()).toBe(true);
 await fs.writeFile("/dir/missing",new Uint8Array([1]));expect(()=>receipt.validate()).toThrow(expect.objectContaining({code:"EAGAIN"}));
});

it("does not cross the virtual device namespace through a final link",async()=>{
 const memory=new MemoryFileSystem();await memory.symlink("/dev/null","/link");const fs=new DeviceFileSystem(memory);
 expect((await fs.capabilitiesFor("/link",{stagingResolution:true,followFinalSymlink:true})).synchronousFollowedStagingResolution).not.toBe(true);
 await expect(fs.prepareStagingResolution("/link",{followFinalSymlink:true})).rejects.toMatchObject({code:"ENOTSUP"});
});

for(const kind of ["mount","device","scope"] as const)it(`does not invent final-link support through ${kind}`,async()=>{
 const memory=new MemoryFileSystem();await memory.writeFile("/target",new Uint8Array([1]));await memory.symlink("target","/link");
 const backend=new Proxy(memory,{get(target,key){if(key==="capabilities")return {...memory.capabilities,synchronousFollowedStagingResolution:false};const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;}});
 const fs:FileSystem=kind==="mount"?new MountFileSystem({root:backend}):kind==="device"?new DeviceFileSystem(backend):scopeFileSystem(backend,()=>{},new AbortController().signal);
 expect((await fs.capabilitiesFor?.("/link",{stagingResolution:true,followFinalSymlink:true})??fs.capabilities).synchronousFollowedStagingResolution).not.toBe(true);
 await expect(fs.prepareStagingResolution!("/link",{followFinalSymlink:true})).rejects.toMatchObject({code:"ENOTSUP"});
});
