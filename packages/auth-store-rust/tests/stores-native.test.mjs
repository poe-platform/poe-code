import assert from "node:assert/strict";
import { test } from "node:test";
import { Volume, createFsFromVolume } from "memfs";
import * as own from "../dist/index.js";
process.env.TSX_DISABLE_CACHE="1";
const { tsImport } = await import("tsx/esm/api");
const reference = await tsImport("../../auth-store/src/index.ts",import.meta.url);
function memory() { return createFsFromVolume(new Volume()).promises; }
function config(fs,filePath="/home/test/.app/credentials.enc") { return {fs,filePath,salt:"rust-conformance-v1",getMachineIdentity:()=>({hostname:"host",username:"user"}),getRandomBytes:size=>Buffer.alloc(size,7)}; }
const outcome = async action => { try { return {value:await action()}; } catch(error) { return {error:error.message,name:error.name,code:error.code}; } };
test("native encrypted stores interoperate with original AES-GCM file documents", async () => {
  const fs=memory(); const a=new own.EncryptedFileStore(config(fs)); const b=new reference.EncryptedFileStore(config(fs));
  for(const value of ["","secret +🦊\ud800","line\nline","a".repeat(8192)]) {
    await a.set(value); const expected=Buffer.from(value).toString("utf8");assert.equal(await b.get(),expected);
    const native=await fs.readFile(config(fs).filePath,"utf8");
    await b.set(value); assert.equal(await a.get(),expected);assert.equal(await fs.readFile(config(fs).filePath,"utf8"),native);
  }
  await a.delete();assert.equal(await b.get(),null);
});
test("keychain plans and command diagnostics match existing public behavior", async () => {
  const cyclic={};cyclic.self=cyclic;
  for(const operation of ["get","set","delete"]) for(const result of [{stdout:"s\r\n",stderr:"",exitCode:0},{stdout:"",stderr:"missing",exitCode:44},{stdout:" detail ",stderr:" denied ",exitCode:1},{},{exitCode:0.5},{exitCode:0n,stdout:cyclic},Object.create({stdout:"polluted",exitCode:0})]) {
    let expected;
    for(const factory of [reference,own]) {
      let observed;
      const store=new factory.KeychainStore({service:" service ",account:" account ",runCommand:async(...args)=>{observed=args;return result;}});
      const actual={result:await outcome(()=>store[operation]("secret")),observed};
      if(factory===reference)expected=actual;else assert.deepEqual(actual,expected);
    }
  }
  for(const factory of [reference,own]) {
    assert.throws(()=>new factory.KeychainStore({service:" ",account:"account"}),/service must not be empty/);
    const store=new factory.KeychainStore({service:"s",account:"a",runCommand:async()=>{throw new Error("permission denied");}});
    await assert.rejects(store.set("secret"),/Failed to store secret in macOS Keychain: permission denied/);
    await assert.rejects(store.set("a\nb"),/cannot contain line breaks/);
  }
});
test("backend selection and default-path validation match the reference", async () => {
  for(const backend of [undefined," file ","keychain","","unsupported\ud800"]) for(const platform of ["darwin","linux"]) {
    let expected;
    for(const factory of [reference,own]) {
      const result=await outcome(()=>factory.createSecretStore({env:{TEST_RUST_BACKEND:backend},backendEnvVar:"TEST_RUST_BACKEND",platform,fileStore:config(memory()),keychainStore:{service:"s",account:"a"}}).backend);
      if(factory===reference)expected=result;else assert.deepEqual(result,expected);
    }
  }
  for(const directory of ["../escape","a\\..\\b","/absolute","C:\\absolute",".app","a/b",""]) for(const file of [""," ",".","..","a/b","a\\b","a","/a","a/"]) {
    let expected;
    for(const factory of [reference,own]) {
      const result=await outcome(()=>new factory.EncryptedFileStore({...config(memory()),filePath:undefined,getHomeDirectory:()=>"/home/test",defaultDirectory:directory,defaultFileName:file}) && "created");
      if(factory===reference)expected=result;else assert.deepEqual(result,expected);
    }
  }
});
