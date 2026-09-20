import assert from "node:assert/strict";
import { test } from "node:test";
import { Volume, createFsFromVolume } from "memfs";
import * as own from "../dist/index.js";
process.env.TSX_DISABLE_CACHE="1";
const { tsImport } = await import("tsx/esm/api");
const reference=await tsImport("../../auth-store/src/index.ts",import.meta.url);
function memory(){return createFsFromVolume(new Volume()).promises;}
const path="/home/test/.app/credentials.enc";
function config(fs){return {fs,filePath:path,salt:"file-stability-v1",getMachineIdentity:()=>({hostname:"host",username:"user"})};}
test("credential permissions, random IVs, tamper rejection and missing documents match",async()=> {
  for(const factory of [reference,own]) {
    const fs=memory();const store=new factory.EncryptedFileStore(config(fs));
    assert.equal(await store.get(),null);await store.set("secret");
    const first=await fs.readFile(path,"utf8");assert.equal((await fs.stat(path)).mode&0o777,0o600);
    await store.set("secret");assert.notEqual(await fs.readFile(path,"utf8"),first);
    for(const body of ["not json","[]","{}",'{"version":2,"iv":"a","authTag":"b","ciphertext":"c"}',JSON.stringify({...JSON.parse(first),authTag:Buffer.alloc(16).toString("base64")}),JSON.stringify({...JSON.parse(first),iv:"a"})]) {
      await fs.writeFile(path,body);assert.equal(await store.get(),null);
    }
    await store.delete();await store.delete();assert.equal(await store.get(),null);
  }
});
test("file and ancestor symlinks are refused without modifying outside state",async()=> {
  for(const factory of [reference,own]) for(const location of ["file","parent","defaultAncestor"]) {
    const fs=memory();await fs.mkdir("/home/test/.app",{recursive:true});await fs.mkdir("/outside/subdir",{recursive:true});await fs.writeFile("/outside/sentinel","outside");
    let input=config(fs);
    if(location==="file")await fs.symlink("/outside/sentinel",path);
    if(location==="parent"){await fs.rmdir("/home/test/.app");await fs.symlink("/outside","/home/test/.app");}
    if(location==="defaultAncestor") {await fs.symlink("/outside","/home/test/.poe-code");input={...input,filePath:undefined,defaultDirectory:".poe-code/mcp-oauth",getHomeDirectory:()=>"/home/test"};}
    const store=new factory.EncryptedFileStore(input);
    for(const operation of ["get","set","delete"])await assert.rejects(store[operation]("secret"),/symbolic link/);
    assert.equal(await fs.readFile("/outside/sentinel","utf8"),"outside");
  }
});
test("operating-system first path segment remains usable when symlinked",async()=> {
  for(const factory of [reference,own]) {
    const fs=memory();await fs.mkdir("/private/var/tmp/home/.app",{recursive:true});await fs.symlink("/private/var","/var");
    const store=new factory.EncryptedFileStore({...config(fs),filePath:"/var/tmp/home/.app/credentials.enc"});await store.set("secret");assert.equal(await store.get(),"secret");
  }
});
test("failed temporary writes, permission hardening and rename preserve the old credential",async()=> {
  for(const factory of [reference,own]) for(const failure of ["writeFile","chmod","rename"]) {
    const fs=memory();const initial=new factory.EncryptedFileStore(config(fs));await initial.set("old");const before=await fs.readFile(path,"utf8");let temporary;
    const injected={...fs,[failure]:async(...args)=>{temporary=args[0];if(failure==="writeFile")await fs.writeFile(...args);throw new Error("injected "+failure);}};
    const store=new factory.EncryptedFileStore(config(injected));await assert.rejects(store.set("new"),new RegExp("injected "+failure));
    assert.equal(await fs.readFile(path,"utf8"),before);assert.equal(await initial.get(),"old");await assert.rejects(fs.lstat(temporary),error=>error.code==="ENOENT");
  }
});
test("colliding temporary symlinks are neither followed nor removed",async()=> {
  for(const factory of [reference,own]) {
    const fs=memory();await fs.mkdir("/home/test/.app",{recursive:true});await fs.writeFile("/outside","sentinel");let temporary;
    const injected={...fs,async writeFile(target,data,options){temporary=target;await fs.symlink("/outside",target);await fs.writeFile(target,data,options);}};
    const store=new factory.EncryptedFileStore(config(injected));await assert.rejects(store.set("new"));
    assert.equal(await fs.readFile("/outside","utf8"),"sentinel");assert.equal((await fs.lstat(temporary)).isSymbolicLink(),true);await assert.rejects(fs.lstat(path),error=>error.code==="ENOENT");
  }
});
test("failed identities can retry and a different machine cannot decrypt credentials",async()=> {
  for(const factory of [reference,own]) {
    const fs=memory();let attempts=0;const store=new factory.EncryptedFileStore({...config(fs),getMachineIdentity:()=>{if(attempts++===0)throw new Error("identity unavailable");return {hostname:"host",username:"user"};}});
    await assert.rejects(store.set("secret"),/identity unavailable/);await store.set("secret");assert.equal(await store.get(),"secret");assert.equal(attempts,2);
    const foreign=new factory.EncryptedFileStore({...config(fs),getMachineIdentity:()=>({hostname:"other",username:"user"})});assert.equal(await foreign.get(),null);
  }
});
test("inherited document and filesystem error fields do not bypass storage policy",async()=> {
  const keys=["version","iv","authTag","ciphertext","code"];
  const originals=new Map(keys.map(key=>[key,Object.getOwnPropertyDescriptor(Object.prototype,key)]));
  try {
    for(const [key,value] of Object.entries({version:1,iv:"a",authTag:"b",ciphertext:"c",code:"ENOENT"}))Object.defineProperty(Object.prototype,key,{value,writable:true,configurable:true});
    for(const factory of [reference,own]) {
      const fs=memory();await fs.mkdir("/home/test/.app",{recursive:true});await fs.writeFile(path,"{}");assert.equal(await new factory.EncryptedFileStore(config(fs)).get(),null);
      const denied={...fs,readFile:async()=>{throw new Error("read denied");}};await assert.rejects(new factory.EncryptedFileStore(config(denied)).get(),/read denied/);
    }
  } finally {for(const [key,descriptor] of originals){if(descriptor)Object.defineProperty(Object.prototype,key,descriptor);else delete Object.prototype[key];}}
});
